import { query } from "./functions";
import { mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  bumpPolicyVersion,
  capabilitiesForLevel,
  evaluateArtifactAccessForActor,
  loadResource,
  requireCapability,
} from "./authorityShared";
import { writeAuditEvent } from "./auditShared";
import { findNodesForSource, sharesWithWorkspace } from "./orgTreeShared";
import { getAuthenticatedActor } from "./identityShared";

/*
 * Who a shared work is with, kept to what people expect from shared documents:
 * invited people can open it and read it; the author can let one person edit,
 * or everyone at once, which makes them all collaborators. Anyone who can open
 * the work sees who else can; only its author sees who changed what (History).
 */

const resourceType = v.union(v.literal("workspace"), v.literal("artifact"), v.literal("agent"));
const PEOPLE_LIMIT = 200;
const VERSIONS_SCANNED = 200;

/** Let everyone this is shared with edit it, or put them all back to reading it. */
export const setEveryoneCanEdit = mutation({
  args: { resourceType, resourceId: v.string(), canEdit: v.boolean() },
  handler: async (ctx, args) => {
    const decision = await requireCapability(ctx, args.resourceType, args.resourceId, "share");
    const level = args.canEdit ? ("modify" as const) : ("read" as const);
    const now = Date.now();
    const invitations = await ctx.db
      .query("shareInvitations")
      .withIndex("by_resource", (q) => q.eq("resourceType", args.resourceType).eq("resourceId", args.resourceId))
      .take(PEOPLE_LIMIT * 2);
    let changed = 0;
    for (const invitation of invitations) {
      if (invitation.status !== "pending" && invitation.status !== "accepted") continue;
      if (invitation.level !== level) {
        await ctx.db.patch(invitation._id, { level, updatedAt: now });
        changed += 1;
      }
      const grant = invitation.grantId ? await ctx.db.get(invitation.grantId) : null;
      if (grant && !grant.revokedAt && grant.level !== level)
        await ctx.db.patch(grant._id, { level, capabilities: capabilitiesForLevel(level), updatedAt: now });
    }
    const loaded = await loadResource(ctx, args.resourceType, args.resourceId);
    const policyVersion = await bumpPolicyVersion(ctx, args.resourceType, args.resourceId, loaded?.schoolId, decision.actor.accountId);
    await writeAuditEvent(ctx, {
      actorAccountId: decision.actor.accountId,
      schoolId: loaded?.schoolId,
      action: "authority.collaborators.level_changed",
      targetType: args.resourceType,
      targetId: args.resourceId,
      metadata: { level, changed, policyVersion },
      retentionClass: "security",
    });
    return { level, changed };
  },
});

type Person = {
  accountId: Id<"accounts">;
  name: string;
  avatarUrl?: string;
  role: "owner" | "edit" | "view";
  /** Through which workspace, when it was not shared with them directly. */
  through?: string;
  edited: boolean;
};

/**
 * Everyone who can open a work: its author, the people it was shared with and
 * the people of the workspaces it is shared in, and, for its author only,
 * whether each has changed it. Readable by anyone who can open the work.
 */
export const forArtifact = query({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
    const decision = await evaluateArtifactAccessForActor(ctx, actor, args.artifactId);
    if (!decision.allowed || !decision.loaded) return null;
    const artifact = decision.loaded.resource;
    let now: number | undefined;
    const levels = new Map<string, { level: "read" | "modify"; through?: string }>();
    const raise = (accountId: string, level: "read" | "modify", through?: string) => {
      const current = levels.get(accountId);
      if (!current || (current.level === "read" && level === "modify")) levels.set(accountId, { level, through: current && !through ? undefined : through });
    };
    const active = (grant: { revokedAt?: number; expiresAt?: number }) => !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > (now ??= Date.now()));

    const direct = await ctx.db
      .query("accessGrants")
      .withIndex("by_resource", (q) => q.eq("resourceType", "artifact").eq("resourceId", artifact._id))
      .take(PEOPLE_LIMIT);
    for (const grant of direct)
      if (active(grant) && grant.principalType === "account" && grant.principalId && grant.source === "direct") raise(grant.principalId, grant.level);

    let schoolWide: { level: "read" | "modify"; through?: string } | null = null;
    for (const placement of await findNodesForSource(ctx, "work", artifact._id)) {
      if (placement.deletedAt !== undefined || !placement.workspaceContextId || !sharesWithWorkspace(placement)) continue;
      const workspace = await ctx.db.get(placement.workspaceContextId);
      if (!workspace || workspace.status !== "active") continue;
      const grants = await ctx.db
        .query("accessGrants")
        .withIndex("by_resource", (q) => q.eq("resourceType", "workspace").eq("resourceId", workspace._id))
        .take(PEOPLE_LIMIT);
      for (const grant of grants) {
        if (!active(grant) || grant.source !== "direct") continue;
        if (grant.principalType === "school") schoolWide = { level: grant.level, through: workspace.title };
        else if (grant.principalType === "account" && grant.principalId) raise(grant.principalId, grant.level, workspace.title);
      }
      if (workspace.ownerAccountId !== artifact.ownerAccountId) raise(workspace.ownerAccountId, "read", workspace.title);
    }
    levels.delete(artifact.ownerAccountId);

    // Who changed it is the author's to see, as History is.
    const isOwner = decision.reason === "owner";
    // Nobody else has it: the header shows nothing, so skip the heaviest rows in the database.
    const versions = isOwner && (levels.size > 0 || schoolWide)
      ? await ctx.db
          .query("spectraArtifactVersions")
          .withIndex("by_artifact_created", (q) => q.eq("artifactId", artifact._id))
          .order("desc")
          .take(VERSIONS_SCANNED)
      : [];
    const editors = new Set(versions.flatMap((version) => version.creatorAccountIds ?? []).map(String));

    const ids = [artifact.ownerAccountId as string, ...levels.keys()].slice(0, PEOPLE_LIMIT);
    const people: Person[] = [];
    for (const accountId of ids) {
      const account = await ctx.db.get(accountId as Id<"accounts">);
      if (!account) continue;
      const entry = levels.get(accountId);
      people.push({
        accountId: account._id,
        name: account.name?.trim() || "Someone",
        avatarUrl: account.avatarUrl,
        role: accountId === artifact.ownerAccountId ? "owner" : entry?.level === "modify" ? "edit" : "view",
        through: entry?.through,
        edited: editors.has(accountId),
      });
    }
    const order = { owner: 0, edit: 1, view: 2 } as const;
    people.sort((a, b) => order[a.role] - order[b.role] || Number(b.edited) - Number(a.edited) || a.name.localeCompare(b.name));
    return {
      people,
      schoolWide,
      shared: people.length > 1 || Boolean(schoolWide),
      isOwner,
      canShare: decision.capabilities.includes("share"),
      myLevel: decision.level,
    };
  },
});
