import { query } from "./functions";
import { internalMutation, mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  bumpPolicyVersion,
  evaluateAccessForActor,
  evaluateArtifactAccessForActor,
  requireCapability,
} from "./authorityShared";
import { sendShareInvitation } from "./authority";
import { writeAuditEvent } from "./auditShared";
import { requireSpectraActor, requireWorkspaceCapability } from "./spectraShared";
import { sharesWithWorkspace, workspaceContextNodes, type OrgNode } from "./orgTreeShared";
import { hydrateNodes } from "./orgTreeViews";
import { linkOf, linkWorkspace, unlinkWorkspace } from "./workspaceLinksShared";

/*
 * Sharing inside a workspace, kept simple: a workspace shared with people
 * shows them only the works its authors chose to share with it. Each work
 * starts private (or shared, when the workspace says new work is shared), and
 * several are switched at once from a selection. A workspace shared with you
 * can show inside one of your own, so a teacher's Physics appears in your
 * Physics class rather than beside it (workspaceLinksShared).
 */

/** How many works from linked workspaces a shelf shows; past this, the author's own workspace has the rest. */
const SHARED_WORKS_LIMIT = 120;
/** A class is a few dozen people; a roster past this is not one class. */
const CLASS_INVITE_LIMIT = 200;
const SELECTION_LIMIT = 200;

type Ctx = Parameters<typeof requireSpectraActor>[0];

async function readable(ctx: Ctx, actor: Awaited<ReturnType<typeof requireSpectraActor>>, workspaceId: Id<"spectraWorkspaces">) {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.status !== "active") return null;
  const access = await evaluateAccessForActor(ctx, actor, "workspace", workspaceId);
  return access.allowed && access.level ? { workspace, level: access.level } : null;
}

async function ownerName(ctx: Ctx, cache: Map<string, string>, accountId: Id<"accounts">) {
  const cached = cache.get(accountId);
  if (cached !== undefined) return cached;
  const account = await ctx.db.get(accountId);
  const name = account?.name?.trim() || "Someone";
  cache.set(accountId, name);
  return name;
}

export const setShareNewWork = mutation({
  args: { workspaceId: v.id("spectraWorkspaces"), shareNewWork: v.boolean() },
  handler: async (ctx, args) => {
    await requireWorkspaceCapability(ctx, args.workspaceId, "share");
    await ctx.db.patch(args.workspaceId, {
      shareNewWork: args.shareNewWork || undefined,
      updatedAt: Date.now(),
    });
    return { shareNewWork: args.shareNewWork };
  },
});

/**
 * Share several of your works with the people of the workspace each sits in,
 * or make them private again. Works not in a workspace, or not yours to
 * share, are left as they were and counted.
 */
export const setWorksShared = mutation({
  args: {
    nodeIds: v.optional(v.array(v.id("orgNodes"))),
    /** Picked in Select, which knows works rather than their places: each of the actor's places of each. */
    artifactIds: v.optional(v.array(v.string())),
    shared: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    let changed = 0;
    let skipped = 0;
    const nodeIds = new Set<Id<"orgNodes">>(args.nodeIds ?? []);
    for (const sourceId of (args.artifactIds ?? []).slice(0, SELECTION_LIMIT)) {
      const artifactId = ctx.db.normalizeId("spectraArtifacts", sourceId);
      if (!artifactId) continue;
      const places = await ctx.db
        .query("orgNodes")
        .withIndex("by_account_kind_source", (q) =>
          q.eq("accountId", actor.accountId).eq("kind", "work").eq("sourceId", artifactId),
        )
        .take(20);
      const inWorkspace = places.filter((node) => node.deletedAt === undefined && node.workspaceContextId);
      if (!inWorkspace.length) skipped += 1;
      for (const node of inWorkspace) nodeIds.add(node._id);
    }
    for (const nodeId of [...nodeIds].slice(0, SELECTION_LIMIT)) {
      const node = await ctx.db.get(nodeId);
      if (
        !node ||
        node.accountId !== actor.accountId ||
        node.kind !== "work" ||
        !node.sourceId ||
        !node.workspaceContextId ||
        node.deletedAt !== undefined
      ) {
        skipped += 1;
        continue;
      }
      if (sharesWithWorkspace(node) === args.shared) continue;
      const decision = await requireCapability(ctx, "artifact", node.sourceId, "share").catch(() => null);
      if (!decision) {
        skipped += 1;
        continue;
      }
      await ctx.db.patch(node._id, { accessProjection: args.shared ? true : undefined });
      await bumpPolicyVersion(ctx, "artifact", node.sourceId, actor.schoolId, actor.accountId);
      changed += 1;
    }
    if (changed)
      await writeAuditEvent(ctx, {
        actorAccountId: actor.accountId,
        schoolId: actor.schoolId,
        action: args.shared ? "workspace.works.shared" : "workspace.works.private",
        targetType: "workspace",
        targetId: "selection",
        metadata: { changed, skipped },
        retentionClass: "security",
      });
    return { changed, skipped };
  },
});

/** Show a workspace shared with you inside one of your own. */
export const link = mutation({
  args: {
    workspaceId: v.id("spectraWorkspaces"),
    linkedWorkspaceId: v.id("spectraWorkspaces"),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const own = await ctx.db.get(args.workspaceId);
    if (!own || own.ownerAccountId !== actor.accountId || own.status !== "active")
      throw new Error("WORKSPACE_LINK_OWN: Choose one of your own workspaces.");
    if (args.workspaceId === args.linkedWorkspaceId)
      throw new Error("WORKSPACE_LINK_SELF: A workspace cannot show inside itself.");
    const linked = await readable(ctx, actor, args.linkedWorkspaceId);
    if (!linked || linked.workspace.ownerAccountId === actor.accountId)
      throw new Error("WORKSPACE_LINK_SHARED: Only a workspace shared with you can be linked.");
    await linkWorkspace(ctx, actor, args.workspaceId, linked.workspace);
    return { workspaceId: args.workspaceId };
  },
});

/** Put a linked workspace back on its own in the Library. */
export const unlink = mutation({
  args: { linkedWorkspaceId: v.id("spectraWorkspaces") },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const linked = await ctx.db.get(args.linkedWorkspaceId);
    if (!linked) return { unlinked: false };
    const access = await readable(ctx, actor, linked._id);
    await unlinkWorkspace(ctx, actor, linked, Boolean(access));
    return { unlinked: true };
  },
});

/**
 * For one of your workspaces: what shows inside it, and which workspaces
 * shared with you could. For a workspace shared with you: where it shows.
 */
export const links = query({
  args: { workspaceId: v.id("spectraWorkspaces") },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) return null;
    const names = new Map<string, string>();
    if (workspace.ownerAccountId !== actor.accountId) {
      const row = await linkOf(ctx, actor.accountId, workspace._id);
      const into = row ? await ctx.db.get(row.workspaceId) : null;
      // Where it could show instead: the actor's own workspaces, the same class first.
      const mine = await ctx.db
        .query("spectraWorkspaces")
        .withIndex("by_account_status_activity", (q) =>
          q.eq("ownerAccountId", actor.accountId).eq("status", "active"),
        )
        .order("desc")
        .take(40);
      const classId = workspace.sourceContext?.providerClassId;
      const places = mine
        .map((own) => ({
          workspaceId: own._id,
          title: own.title,
          sameClass: Boolean(classId) && own.sourceContext?.providerClassId === classId,
        }))
        .sort((a, b) => Number(b.sameClass) - Number(a.sameClass));
      return {
        own: false as const,
        isClass: false,
        shareNewWork: workspace.shareNewWork === true,
        linkedInto: into ? { workspaceId: into._id, title: into.title } : null,
        author: await ownerName(ctx, names, workspace.ownerAccountId),
        places,
        linked: [],
        candidates: [],
      };
    }
    const rows = await ctx.db
      .query("workspaceLinks")
      .withIndex("by_account_workspace", (q) =>
        q.eq("accountId", actor.accountId).eq("workspaceId", workspace._id),
      )
      .collect();
    const linked = [];
    for (const row of rows) {
      const found = await readable(ctx, actor, row.linkedWorkspaceId);
      if (!found) continue;
      linked.push({
        workspaceId: found.workspace._id,
        title: found.workspace.title,
        author: await ownerName(ctx, names, found.workspace.ownerAccountId),
        level: found.level,
      });
    }
    // Workspaces shared with you directly, not yet shown here.
    const grants = await ctx.db
      .query("accessGrants")
      .withIndex("by_principal_resource_source", (q) =>
        q
          .eq("principalType", "account")
          .eq("principalId", actor.accountId)
          .eq("resourceType", "workspace")
          .eq("source", "direct"),
      )
      .take(100);
    const now = Date.now();
    const candidates = [];
    const seen = new Set(linked.map((row) => row.workspaceId as string));
    for (const grant of grants) {
      if (grant.revokedAt || (grant.expiresAt && grant.expiresAt <= now)) continue;
      if (seen.has(grant.resourceId) || grant.resourceId === workspace._id) continue;
      seen.add(grant.resourceId);
      const id = ctx.db.normalizeId("spectraWorkspaces", grant.resourceId);
      const shared = id ? await ctx.db.get(id) : null;
      if (!shared || shared.status !== "active" || shared.ownerAccountId === actor.accountId) continue;
      const row = await linkOf(ctx, actor.accountId, shared._id);
      const into = row ? await ctx.db.get(row.workspaceId) : null;
      candidates.push({
        workspaceId: shared._id,
        title: shared.title,
        author: await ownerName(ctx, names, shared.ownerAccountId),
        level: grant.level,
        linkedInto: into ? into.title : null,
        sameClass:
          Boolean(shared.sourceContext?.providerClassId) &&
          shared.sourceContext?.providerClassId === workspace.sourceContext?.providerClassId,
      });
    }
    candidates.sort((a, b) => Number(b.sameClass) - Number(a.sameClass));
    return {
      own: true as const,
      isClass: Boolean(workspace.sourceContext?.providerClassId),
      shareNewWork: workspace.shareNewWork === true,
      linkedInto: null,
      author: null,
      places: [],
      linked,
      candidates,
    };
  },
});

/**
 * The works shared with you that belong on this workspace's shelf: from the
 * workspaces linked into it when it is yours, or its own when it was shared
 * with you. Only works their authors shared with the workspace, and only
 * those you can still read, each with whose it is and whether you may edit it.
 */
export const sharedWorks = query({
  args: { workspaceId: v.id("spectraWorkspaces") },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) return [];
    const sources: Id<"spectraWorkspaces">[] =
      workspace.ownerAccountId === actor.accountId
        ? (
            await ctx.db
              .query("workspaceLinks")
              .withIndex("by_account_workspace", (q) =>
                q.eq("accountId", actor.accountId).eq("workspaceId", workspace._id),
              )
              .collect()
          ).map((row) => row.linkedWorkspaceId)
        : [workspace._id];
    const names = new Map<string, string>();
    const groups = [];
    let budget = SHARED_WORKS_LIMIT;
    for (const sourceId of sources) {
      if (budget <= 0) break;
      const source = await readable(ctx, actor, sourceId);
      if (!source) continue;
      const seen = new Set<string>();
      const candidates: OrgNode[] = [];
      for (const node of await workspaceContextNodes(ctx, sourceId, "work")) {
        if (node.accountId === actor.accountId || !sharesWithWorkspace(node) || !node.sourceId) continue;
        if (seen.has(node.sourceId)) continue;
        seen.add(node.sourceId);
        candidates.push(node);
      }
      candidates.sort((a, b) => (b.activityAt ?? b.updatedAt) - (a.activityAt ?? a.updatedAt));
      const works = [];
      for (const node of candidates) {
        if (works.length >= budget) break;
        const artifactId = ctx.db.normalizeId("spectraArtifacts", node.sourceId!);
        if (!artifactId) continue;
        const access = await evaluateArtifactAccessForActor(ctx, actor, artifactId);
        if (!access.allowed || !access.level) continue;
        const [view] = await hydrateNodes(ctx, [node], { withSource: true });
        if (!view || view.source?.available === false) continue;
        works.push({
          ...view,
          // Somebody else's work: the actor's menus act on it as shared, never as their own row.
          source: view.source ? { ...view.source, owned: false, shared: true } : view.source,
          author: await ownerName(ctx, names, node.accountId),
          accessLevel: access.level,
        });
      }
      budget -= works.length;
      groups.push({
        workspaceId: source.workspace._id,
        title: source.workspace.title,
        author: await ownerName(ctx, names, source.workspace.ownerAccountId),
        level: source.level,
        works,
      });
    }
    return groups;
  },
});

/**
 * Invite everyone in the workspace's ManageBac class. Each accepts as with any
 * share; their copy of the class then shows this workspace's shared works.
 */
export const inviteClass = mutation({
  args: {
    workspaceId: v.id("spectraWorkspaces"),
    level: v.union(v.literal("read"), v.literal("modify")),
  },
  handler: async (ctx, args) => {
    const { actor, workspace } = await requireWorkspaceCapability(ctx, args.workspaceId, "share");
    const providerClassId = (workspace as Doc<"spectraWorkspaces">).sourceContext?.providerClassId;
    if (!providerClassId)
      throw new Error("WORKSPACE_NO_CLASS: This workspace is not a ManageBac class.");
    const memberships = await ctx.db
      .query("externalRecords")
      .withIndex("by_class_type", (q) =>
        q.eq("providerClassId", providerClassId).eq("recordType", "membership"),
      )
      .take(CLASS_INVITE_LIMIT * 4);
    const people = new Set<Id<"accounts">>();
    for (const record of memberships) {
      if (record.tombstone || !record.mappedAccountId) continue;
      if (record.schoolId && record.schoolId !== actor.schoolId) continue;
      if (record.mappedAccountId === actor.accountId) continue;
      people.add(record.mappedAccountId);
      if (people.size >= CLASS_INVITE_LIMIT) break;
    }
    let invited = 0;
    let already = 0;
    let skipped = 0;
    for (const inviteeAccountId of people) {
      try {
        await sendShareInvitation(ctx, actor, {
          resourceType: "workspace",
          resourceId: workspace._id,
          inviteeAccountId,
          level: args.level,
        });
        invited += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.startsWith("SHARING_ALREADY_ACCEPTED") || message.startsWith("SHARING_OWNER_INVARIANT")) already += 1;
        else skipped += 1;
      }
    }
    return { invited, already, skipped, classSize: people.size };
  },
});

/**
 * Once, when works became private by default: a workspace already shared with
 * someone keeps showing its owner's works as it did, so nobody loses what
 * they could open the day before. Run until it reports done.
 */
export const keepSharedWorkspacesVisible = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("accessGrants")
      .paginate({ cursor: args.cursor ?? null, numItems: 100 });
    let patched = 0;
    for (const grant of page.page) {
      if (grant.resourceType !== "workspace" || grant.source !== "direct" || grant.revokedAt) continue;
      const workspaceId = ctx.db.normalizeId("spectraWorkspaces", grant.resourceId);
      const workspace = workspaceId ? await ctx.db.get(workspaceId) : null;
      if (!workspace) continue;
      for (const node of await workspaceContextNodes(ctx, workspace._id, "work")) {
        if (node.accessProjection !== undefined || node.accountId !== workspace.ownerAccountId) continue;
        await ctx.db.patch(node._id, { accessProjection: true });
        patched += 1;
      }
    }
    return { patched, done: page.isDone, cursor: page.continueCursor };
  },
});

/**
 * Where a copy of a work from this workspace lands: here, when the actor can
 * add to it; else the actor's own workspace this one shows inside (a teacher's
 * Physics copied into the student's Physics); else nowhere named (General).
 */
export const copyDestination = query({
  args: { workspaceId: v.id("spectraWorkspaces") },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx);
    const access = await evaluateAccessForActor(ctx, actor, "workspace", args.workspaceId).catch(() => null);
    if (access?.allowed && access.capabilities.includes("modify")) return args.workspaceId;
    const row = await linkOf(ctx, actor.accountId, args.workspaceId);
    return row ? row.workspaceId : null;
  },
});
