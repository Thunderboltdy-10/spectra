import { query } from "./functions";
import { mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  bumpPolicyVersion,
  capabilitiesForLevel,
  evaluateAccess,
  evaluateAccessForActor,
  getVerifiedViewerDomain,
  loadResource,
  requireCapability,
} from "./authorityShared";
import {
  getActiveMembership,
  getActorForAccountId,
  getAuthenticatedActor,
  type AuthenticatedActor,
} from "./identityShared";
import { writeAuditEvent } from "./auditShared";
import {
  findNodesForSource,
  placeSourceNode,
  purgeAccountSourceNodes,
  workspaceContextNodes,
  sharesWithWorkspace,
} from "./orgTreeShared";
import { releaseClaimsForAccount } from "./regionClaims";
import { placeSharedWorkspace } from "./workspaceLinksShared";
import {
  projectQuizContentForLearner,
  projectTimetableSharedContent,
} from "./quizPrivacy";

const resourceType = v.union(
  v.literal("workspace"),
  v.literal("artifact"),
  v.literal("agent"),
);
const level = v.union(v.literal("read"), v.literal("modify"));

type PublicLinkViewerDecision =
  | "allowed"
  | "sign_in_required"
  | "email_unverified"
  | "domain_restricted";

async function publicLinkViewerDecision(
  ctx: QueryCtx,
  domainRestriction?: string,
): Promise<PublicLinkViewerDecision> {
  if (!domainRestriction) return "allowed";
  const viewer = await getVerifiedViewerDomain(ctx);
  if (!viewer.authenticated) return "sign_in_required";
  if (!viewer.verified || !viewer.domain) return "email_unverified";
  return viewer.domain === domainRestriction ? "allowed" : "domain_restricted";
}

/**
 * A public link is live only while its creator could still create it: an
 * active, verified account with a current membership in an active school that
 * still holds `publish` on the resource. Removing a student, suspending or
 * offboarding a school, or revoking a teacher's grant therefore closes every
 * anonymous link they issued instead of leaving a minor's work public.
 */
async function publicLinkCreatorStillPublishes(
  ctx: QueryCtx,
  link: Doc<"publicLinks">,
  loadedSchoolId: Id<"schools"> | undefined,
) {
  if (loadedSchoolId !== link.schoolId) return false;
  const creator = await getActorForAccountId(ctx, link.createdByAccountId);
  if (!creator || creator.schoolId !== link.schoolId) return false;
  const decision = await evaluateAccessForActor(
    ctx,
    creator,
    link.resourceType,
    link.resourceId,
  );
  return decision.allowed && decision.capabilities.includes("publish");
}

async function publicRuntimeBuild(
  ctx: QueryCtx,
  artifact: Doc<"spectraArtifacts">,
) {
  if (artifact.blueprintKey !== "code") return undefined;
  const build = await ctx.db
    .query("spectraRuntimeBuilds")
    .withIndex("by_artifact_status", (q) =>
      q.eq("artifactId", artifact._id).eq("status", "published"),
    )
    .order("desc")
    .first();
  const storageUrl = build?.storageId
    ? await ctx.storage.getUrl(build.storageId)
    : null;
  return build && storageUrl
    ? {
        buildId: build._id,
        artifactVersionId: build.artifactVersionId,
        runtime: build.runtime,
        sourceHash: build.sourceHash,
        payloadHash: build.payloadHash,
        sdkVersion: build.sdkVersion,
        sourceBytes: build.sourceBytes,
        outputBytes: build.outputBytes,
        payloadBytes: build.payloadBytes,
        publishedAt: build.publishedAt,
        storageUrl,
      }
    : undefined;
}

export const access = query({
  args: { resourceType, resourceId: v.string() },
  handler: async (ctx, args) => {
    const decision = await evaluateAccess(
      ctx,
      args.resourceType,
      args.resourceId,
    );
    return {
      allowed: decision.allowed,
      level: decision.level,
      capabilities: decision.capabilities,
      reason: decision.reason,
      sources: decision.sources,
    };
  },
});

export const invite = mutation({
  args: {
    resourceType,
    resourceId: v.string(),
    inviteeAccountId: v.id("accounts"),
    level,
    expiresAt: v.optional(v.number()),
    message: v.optional(v.string()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const decision = await requireCapability(
      ctx,
      args.resourceType,
      args.resourceId,
      "share",
    );
    return sendShareInvitation(ctx, decision.actor, args);
  },
});

/**
 * One invitation from someone already allowed to share the resource. Shared
 * by the single invite and the class invite, so both keep the school
 * boundary, the owner and self rules, and the one-pending-per-person rule.
 */
export async function sendShareInvitation(
  ctx: MutationCtx,
  actor: AuthenticatedActor,
  args: {
    resourceType: "workspace" | "artifact" | "agent";
    resourceId: string;
    inviteeAccountId: Id<"accounts">;
    level: "read" | "modify";
    expiresAt?: number;
    message?: string;
    requestId?: string;
  },
) {
  const loaded = await loadResource(ctx, args.resourceType, args.resourceId);
  if (!loaded)
    throw new Error("RESOURCE_NOT_FOUND: The resource does not exist.");
  const invitee = await ctx.db.get(args.inviteeAccountId);
  const membership = invitee
    ? await getActiveMembership(ctx, invitee._id)
    : null;
  if (
    !invitee ||
    invitee.status !== "active" ||
    !membership ||
    membership.schoolId !== actor.schoolId
  )
    throw new Error(
      "SHARING_SCHOOL_BOUNDARY: Select an active member of this school.",
    );
  if (invitee._id === loaded.ownerAccountId)
    throw new Error(
      "SHARING_OWNER_INVARIANT: The owner already has full access.",
    );
  if (invitee._id === actor.accountId)
    throw new Error(
      "SHARING_SELF_INVARIANT: You already have access to this work.",
    );
  const now = Date.now();
  if (args.expiresAt && args.expiresAt <= now)
    throw new Error("SHARING_EXPIRY_INVALID: Expiry must be in the future.");
  const prior = await ctx.db
    .query("shareInvitations")
    .withIndex("by_resource_invitee", (q) =>
      q
        .eq("resourceType", args.resourceType)
        .eq("resourceId", args.resourceId)
        .eq("inviteeAccountId", invitee._id),
    )
    .collect();
  const accepted = prior.find(
    (candidate) => candidate.status === "accepted" && candidate.grantId,
  );
  if (accepted?.grantId) {
    const grant = await ctx.db.get(accepted.grantId);
    if (grant && !grant.revokedAt)
      throw new Error(
        "SHARING_ALREADY_ACCEPTED: Change this collaborator's permission instead.",
      );
  }
  const pending = prior.find((candidate) => candidate.status === "pending");
  let invitationId;
  if (pending) {
    await ctx.db.patch(pending._id, {
      level: args.level,
      expiresAt: args.expiresAt,
      message: args.message?.trim().slice(0, 500),
      updatedAt: now,
    });
    invitationId = pending._id;
  } else {
    invitationId = await ctx.db.insert("shareInvitations", {
      schoolId: actor.schoolId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      inviterAccountId: actor.accountId,
      inviteeAccountId: invitee._id,
      level: args.level,
      status: "pending",
      message: args.message?.trim().slice(0, 500),
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
  }
  await writeAuditEvent(ctx, {
    actorAccountId: actor.accountId,
    schoolId: loaded.schoolId,
    action: "authority.invitation.sent",
    targetType: args.resourceType,
    targetId: args.resourceId,
    metadata: {
      invitationId,
      inviteeAccountId: invitee._id,
      level: args.level,
      expiresAt: args.expiresAt ?? null,
    },
    requestId: args.requestId,
    retentionClass: "security",
  });
  return { invitationId, status: "pending" as const };
}

export async function loadIncomingShareInvitations(
  ctx: QueryCtx,
  actor: AuthenticatedActor,
) {
  const now = Date.now();
  const invitations = await ctx.db
    .query("shareInvitations")
    .withIndex("by_invitee_status", (q) =>
      q.eq("inviteeAccountId", actor.accountId).eq("status", "pending"),
    )
    .order("desc")
    .collect();
  return Promise.all(
    invitations
      .filter(
        (invitation) => !invitation.expiresAt || invitation.expiresAt > now,
      )
      .map(async (invitation) => {
        const [resource, inviter] = await Promise.all([
          loadResource(ctx, invitation.resourceType, invitation.resourceId),
          ctx.db.get(invitation.inviterAccountId),
        ]);
        if (!resource || resource.schoolId !== actor.schoolId) return null;
        return {
          invitationId: invitation._id,
          resourceType: invitation.resourceType,
          resourceId: invitation.resourceId,
          level: invitation.level,
          message: invitation.message,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
          inviter: inviter
            ? {
                accountId: inviter._id,
                name: inviter.name,
                avatarUrl: inviter.avatarUrl,
              }
            : null,
          resource: {
            title: resource.resource.title,
            typeKey:
              "blueprintKey" in resource.resource
                ? resource.resource.blueprintKey
                : "workspace",
          },
        };
      }),
  ).then((rows) =>
    rows.filter((row): row is NonNullable<typeof row> => Boolean(row)),
  );
}

export const listIncomingInvitations = query({
  args: {},
  handler: async (ctx) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error(
        "AUTH_NO_SCHOOL: An active school membership is required.",
      );
    return loadIncomingShareInvitations(ctx, actor);
  },
});

async function placeAcceptedShare(
  ctx: MutationCtx,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  resourceType: "workspace" | "artifact" | "agent",
  resourceId: string,
  title: string,
) {
  if (resourceType === "workspace") {
    const workspaceId = ctx.db.normalizeId("spectraWorkspaces", resourceId);
    return workspaceId ? placeSharedWorkspace(ctx, actor, workspaceId) : null;
  }
  await placeSourceNode(ctx, {
    accountId: actor.accountId,
    schoolId: actor.schoolId,
    kind: "work",
    sourceId: resourceId,
    name: title,
    keepExistingPlacement: true,
  });
  return null;
}

export const acceptShareInvitation = mutation({
  args: {
    invitationId: v.id("shareInvitations"),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error(
        "AUTH_NO_SCHOOL: An active school membership is required.",
      );
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.inviteeAccountId !== actor.accountId)
      throw new Error(
        "SHARING_INVITATION_UNAVAILABLE: This invitation is no longer pending.",
      );
    const now = Date.now();
    if (invitation.expiresAt && invitation.expiresAt <= now) {
      if (invitation.status === "pending")
        await ctx.db.patch(invitation._id, {
          status: "expired",
          respondedAt: now,
          updatedAt: now,
        });
      throw new Error(
        "SHARING_INVITATION_EXPIRED: Ask the owner to invite you again.",
      );
    }
    const loaded = await loadResource(
      ctx,
      invitation.resourceType,
      invitation.resourceId,
    );
    if (!loaded || loaded.schoolId !== actor.schoolId)
      throw new Error(
        "SHARING_RESOURCE_UNAVAILABLE: The shared item is no longer available.",
      );
    if (invitation.status === "accepted" && invitation.grantId) {
      const linkedInto = await placeAcceptedShare(
        ctx,
        actor,
        invitation.resourceType,
        invitation.resourceId,
        loaded.resource.title,
      );
      return {
        linkedInto,
        grantId: invitation.grantId,
        resourceType: invitation.resourceType,
        resourceId: invitation.resourceId,
        level: invitation.level,
        appearsIn: "shared" as const,
        alreadyAccepted: true,
        policyVersion: 0,
      };
    }
    if (invitation.status !== "pending")
      throw new Error(
        "SHARING_INVITATION_UNAVAILABLE: This invitation is no longer pending.",
      );
    const grantId = await ctx.db.insert("accessGrants", {
      schoolId: actor.schoolId,
      resourceType: invitation.resourceType,
      resourceId: invitation.resourceId,
      principalType: "account",
      principalId: actor.accountId,
      level: invitation.level,
      capabilities: capabilitiesForLevel(invitation.level),
      source: "direct",
      expiresAt: invitation.expiresAt,
      createdByAccountId: invitation.inviterAccountId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(invitation._id, {
      status: "accepted",
      grantId,
      respondedAt: now,
      updatedAt: now,
    });
    const linkedInto = await placeAcceptedShare(
      ctx,
      actor,
      invitation.resourceType,
      invitation.resourceId,
      loaded.resource.title,
    );
    const policyVersion = await bumpPolicyVersion(
      ctx,
      invitation.resourceType,
      invitation.resourceId,
      loaded.schoolId,
      invitation.inviterAccountId,
    );
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "authority.invitation.accepted",
      targetType: invitation.resourceType,
      targetId: invitation.resourceId,
      metadata: {
        invitationId: invitation._id,
        grantId,
        level: invitation.level,
        policyVersion,
      },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return {
      linkedInto,
      grantId,
      resourceType: invitation.resourceType,
      resourceId: invitation.resourceId,
      level: invitation.level,
      appearsIn: "shared" as const,
      policyVersion,
    };
  },
});

export const declineShareInvitation = mutation({
  args: { invitationId: v.id("shareInvitations") },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error(
        "AUTH_NO_SCHOOL: An active school membership is required.",
      );
    const invitation = await ctx.db.get(args.invitationId);
    if (
      !invitation ||
      invitation.inviteeAccountId !== actor.accountId ||
      invitation.status !== "pending"
    )
      throw new Error(
        "SHARING_INVITATION_UNAVAILABLE: This invitation is no longer pending.",
      );
    const now = Date.now();
    await ctx.db.patch(invitation._id, {
      status: "declined",
      respondedAt: now,
      updatedAt: now,
    });
    return { invitationId: invitation._id, status: "declined" as const };
  },
});

export const changeAcceptedLevel = mutation({
  args: {
    invitationId: v.id("shareInvitations"),
    level,
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.status !== "accepted" || !invitation.grantId)
      throw new Error(
        "SHARING_COLLABORATOR_UNAVAILABLE: This collaborator has not accepted access.",
      );
    const decision = await requireCapability(
      ctx,
      invitation.resourceType,
      invitation.resourceId,
      "share",
    );
    const grant = await ctx.db.get(invitation.grantId);
    if (!grant || grant.revokedAt)
      throw new Error(
        "SHARING_GRANT_NOT_FOUND: The accepted access no longer exists.",
      );
    const now = Date.now();
    await ctx.db.patch(grant._id, {
      level: args.level,
      capabilities: capabilitiesForLevel(args.level),
      updatedAt: now,
    });
    await ctx.db.patch(invitation._id, { level: args.level, updatedAt: now });
    const loaded = await loadResource(
      ctx,
      invitation.resourceType,
      invitation.resourceId,
    );
    const policyVersion = await bumpPolicyVersion(
      ctx,
      invitation.resourceType,
      invitation.resourceId,
      loaded?.schoolId,
      decision.actor.accountId,
    );
    await writeAuditEvent(ctx, {
      actorAccountId: decision.actor.accountId,
      schoolId: loaded?.schoolId,
      action: "authority.collaborator.level_changed",
      targetType: invitation.resourceType,
      targetId: invitation.resourceId,
      metadata: {
        invitationId: invitation._id,
        inviteeAccountId: invitation.inviteeAccountId,
        level: args.level,
        policyVersion,
      },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { level: args.level, policyVersion };
  },
});

export const revoke = mutation({
  args: {
    resourceType,
    resourceId: v.string(),
    grantId: v.id("accessGrants"),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const decision = await requireCapability(
      ctx,
      args.resourceType,
      args.resourceId,
      "share",
    );
    const grant = await ctx.db.get(args.grantId);
    if (
      !grant ||
      grant.resourceType !== args.resourceType ||
      grant.resourceId !== args.resourceId
    )
      throw new Error("SHARING_GRANT_NOT_FOUND: The grant is unavailable.");
    const now = Date.now();
    await ctx.db.patch(grant._id, { revokedAt: now, updatedAt: now });
    const inviteeAccountId =
      grant.principalType === "account" && grant.principalId
        ? ctx.db.normalizeId("accounts", grant.principalId)
        : null;
    if (inviteeAccountId) {
      const invitations = await ctx.db
        .query("shareInvitations")
        .withIndex("by_resource_invitee", (q) =>
          q
            .eq("resourceType", args.resourceType)
            .eq("resourceId", args.resourceId)
            .eq("inviteeAccountId", inviteeAccountId),
        )
        .collect();
      await Promise.all(
        invitations
          .filter(
            (invitation) =>
              invitation.status === "accepted" &&
              invitation.grantId === grant._id,
          )
          .map((invitation) =>
            ctx.db.patch(invitation._id, {
              status: "revoked",
              revokedAt: now,
              updatedAt: now,
            }),
          ),
      );
      if (args.resourceType === "artifact" || args.resourceType === "agent") {
        const artifactId = ctx.db.normalizeId(
          "spectraArtifacts",
          args.resourceId,
        );
        if (artifactId) {
          await purgeAccountSourceNodes(
            ctx,
            inviteeAccountId,
            "work",
            artifactId,
            { keepProjecting: true },
          );
          await releaseClaimsForAccount(ctx, artifactId, inviteeAccountId, now);
        }
      }
    }
    const loaded = await loadResource(ctx, args.resourceType, args.resourceId);
    const policyVersion = await bumpPolicyVersion(
      ctx,
      args.resourceType,
      args.resourceId,
      loaded?.schoolId,
      decision.actor.accountId,
    );
    await writeAuditEvent(ctx, {
      actorAccountId: decision.actor.accountId,
      schoolId: loaded?.schoolId,
      action: "authority.grant.revoked",
      targetType: args.resourceType,
      targetId: args.resourceId,
      metadata: { grantId: grant._id, policyVersion },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { grantId: grant._id, revokedAt: now, policyVersion };
  },
});

export const revokePendingInvitation = mutation({
  args: {
    invitationId: v.id("shareInvitations"),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.status !== "pending")
      throw new Error(
        "SHARING_INVITATION_UNAVAILABLE: This invitation is no longer pending.",
      );
    const decision = await requireCapability(
      ctx,
      invitation.resourceType,
      invitation.resourceId,
      "share",
    );
    const now = Date.now();
    await ctx.db.patch(invitation._id, {
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: decision.actor.accountId,
      schoolId: invitation.schoolId,
      action: "authority.invitation.revoked",
      targetType: invitation.resourceType,
      targetId: invitation.resourceId,
      metadata: {
        invitationId: invitation._id,
        inviteeAccountId: invitation.inviteeAccountId,
      },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { invitationId: invitation._id, status: "revoked" as const };
  },
});

export const shareState = query({
  args: { resourceType, resourceId: v.string() },
  handler: async (ctx, args) => {
    await requireCapability(ctx, args.resourceType, args.resourceId, "share");
    const now = Date.now();
    const invitations = await ctx.db
      .query("shareInvitations")
      .withIndex("by_resource", (q) =>
        q
          .eq("resourceType", args.resourceType)
          .eq("resourceId", args.resourceId),
      )
      .order("desc")
      .collect();
    return Promise.all(
      invitations
        .filter(
          (invitation) =>
            (invitation.status === "pending" ||
              invitation.status === "accepted") &&
            (!invitation.expiresAt || invitation.expiresAt > now),
        )
        .map(async (invitation) => {
          const account = await ctx.db.get(invitation.inviteeAccountId);
          return {
            invitationId: invitation._id,
            status: invitation.status,
            level: invitation.level,
            expiresAt: invitation.expiresAt,
            acceptedAt:
              invitation.status === "accepted"
                ? invitation.respondedAt
                : undefined,
            account: account
              ? {
                  accountId: account._id,
                  name: account.name,
                  email: account.email,
                  avatarUrl: account.avatarUrl,
                }
              : null,
            grantId: invitation.grantId,
          };
        }),
    );
  },
});

export const artifactInheritedAudience = query({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.status === "deleted")
      throw new Error("RESOURCE_NOT_FOUND: The artifact does not exist.");
    const artifactResourceType =
      artifact.blueprintKey === "agent"
        ? ("agent" as const)
        : ("artifact" as const);
    const decision = await requireCapability(
      ctx,
      artifactResourceType,
      args.artifactId,
      "share",
    );
    const placements = await findNodesForSource(ctx, "work", args.artifactId);
    const now = Date.now();
    const audience = new Map<
      string,
      {
        accountId: Id<"accounts">;
        inheritedLevel: "read" | "modify";
        sources: Array<{
          workspaceId: Id<"spectraWorkspaces">;
          workspaceTitle: string;
          level: "read" | "modify";
        }>;
      }
    >();

    for (const placement of placements) {
      if (placement.deletedAt !== undefined || !placement.workspaceContextId)
        continue;
      const workspace = await ctx.db.get(placement.workspaceContextId);
      if (
        !workspace ||
        workspace.status !== "active" ||
        workspace.schoolId !== decision.actor.schoolId
      )
        continue;
      const projectsAccess = sharesWithWorkspace(placement);
      if (!projectsAccess) continue;
      const grants = await ctx.db
        .query("accessGrants")
        .withIndex("by_resource", (q) =>
          q.eq("resourceType", "workspace").eq("resourceId", workspace._id),
        )
        .collect();
      for (const grant of grants) {
        if (
          grant.source !== "direct" ||
          grant.principalType !== "account" ||
          !grant.principalId ||
          grant.revokedAt ||
          (grant.expiresAt && grant.expiresAt <= now)
        )
          continue;
        const accountId = ctx.db.normalizeId("accounts", grant.principalId);
        if (!accountId || accountId === artifact.ownerAccountId) continue;
        const prior = audience.get(accountId);
        const inheritedLevel =
          prior?.inheritedLevel === "modify" || grant.level === "modify"
            ? ("modify" as const)
            : ("read" as const);
        audience.set(accountId, {
          accountId,
          inheritedLevel,
          sources: [
            ...(prior?.sources ?? []),
            {
              workspaceId: workspace._id,
              workspaceTitle: workspace.title,
              level: grant.level,
            },
          ],
        });
      }
    }

    return Promise.all(
      [...audience.values()].map(async (entry) => {
        const [account, override, directGrants] = await Promise.all([
          ctx.db.get(entry.accountId),
          ctx.db
            .query("artifactAccessOverrides")
            .withIndex("by_artifact_account", (q) =>
              q
                .eq("artifactId", args.artifactId)
                .eq("accountId", entry.accountId),
            )
            .unique(),
          ctx.db
            .query("accessGrants")
            .withIndex("by_resource", (q) =>
              q
                .eq("resourceType", artifactResourceType)
                .eq("resourceId", args.artifactId),
            )
            .collect(),
        ]);
        const directLevel = directGrants
          .filter(
            (grant) =>
              grant.source === "direct" &&
              grant.principalType === "account" &&
              grant.principalId === entry.accountId &&
              !grant.revokedAt &&
              (!grant.expiresAt || grant.expiresAt > now),
          )
          .reduce<"read" | "modify" | null>(
            (combined, grant) =>
              combined === "modify" || grant.level === "modify"
                ? "modify"
                : "read",
            null,
          );
        const inheritedAfterException =
          override?.effect === "deny"
            ? null
            : override?.effect === "restrict" && override.maxLevel === "read"
              ? ("read" as const)
              : entry.inheritedLevel;
        const effectiveLevel =
          directLevel === "modify" || inheritedAfterException === "modify"
            ? ("modify" as const)
            : directLevel === "read" || inheritedAfterException === "read"
              ? ("read" as const)
              : null;
        return {
          account: account
            ? {
                accountId: account._id,
                name: account.name,
                email: account.email,
                avatarUrl: account.avatarUrl,
              }
            : null,
          inheritedLevel: entry.inheritedLevel,
          directLevel,
          effectiveLevel,
          sources: entry.sources,
          exception: override
            ? {
                overrideId: override._id,
                effect: override.effect,
                maxLevel: override.maxLevel,
              }
            : null,
        };
      }),
    ).then((entries) => entries.filter((entry) => entry.account));
  },
});

export const setArtifactException = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    accountId: v.id("accounts"),
    effect: v.union(v.literal("deny"), v.literal("restrict")),
    maxLevel: v.optional(level),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.status === "deleted")
      throw new Error("RESOURCE_NOT_FOUND: The artifact does not exist.");
    const artifactResourceType =
      artifact.blueprintKey === "agent"
        ? ("agent" as const)
        : ("artifact" as const);
    const decision = await requireCapability(
      ctx,
      artifactResourceType,
      args.artifactId,
      "share",
    );
    if (args.accountId === decision.loaded.ownerAccountId)
      throw new Error(
        "SHARING_OWNER_INVARIANT: Owner access cannot be removed.",
      );
    const targetActor = await getActorForAccountId(ctx, args.accountId);
    if (!targetActor || targetActor.schoolId !== decision.actor.schoolId)
      throw new Error(
        "SHARING_SCHOOL_BOUNDARY: Select an active member of this school.",
      );
    if (args.effect === "restrict" && !args.maxLevel)
      throw new Error(
        "SHARING_RESTRICTION_INVALID: A restricted access level is required.",
      );
    const existing = await ctx.db
      .query("artifactAccessOverrides")
      .withIndex("by_artifact_account", (q) =>
        q.eq("artifactId", args.artifactId).eq("accountId", args.accountId),
      )
      .unique();
    const now = Date.now();
    let overrideId;
    if (existing) {
      await ctx.db.patch(existing._id, {
        effect: args.effect,
        maxLevel: args.effect === "restrict" ? args.maxLevel : undefined,
        updatedAt: now,
      });
      overrideId = existing._id;
    } else {
      overrideId = await ctx.db.insert("artifactAccessOverrides", {
        schoolId: decision.loaded.schoolId,
        artifactId: args.artifactId,
        accountId: args.accountId,
        effect: args.effect,
        maxLevel: args.effect === "restrict" ? args.maxLevel : undefined,
        createdByAccountId: decision.actor.accountId,
        createdAt: now,
        updatedAt: now,
      });
    }
    const policyVersion = await bumpPolicyVersion(
      ctx,
      artifactResourceType,
      args.artifactId,
      decision.loaded.schoolId,
      decision.actor.accountId,
    );
    const directGrants = await ctx.db
      .query("accessGrants")
      .withIndex("by_resource", (q) =>
        q
          .eq("resourceType", artifactResourceType)
          .eq("resourceId", args.artifactId),
      )
      .collect();
    const retainsDirectModify = directGrants.some(
      (grant) =>
        grant.principalType === "account" &&
        grant.principalId === args.accountId &&
        grant.level === "modify" &&
        !grant.revokedAt &&
        (!grant.expiresAt || grant.expiresAt > now),
    );
    if (
      (args.effect === "deny" || args.maxLevel === "read") &&
      !retainsDirectModify
    ) {
      await releaseClaimsForAccount(ctx, args.artifactId, args.accountId, now);
    }
    if (
      args.effect === "deny" &&
      !directGrants.some(
        (grant) =>
          grant.principalType === "account" &&
          grant.principalId === args.accountId &&
          !grant.revokedAt &&
          (!grant.expiresAt || grant.expiresAt > now),
      )
    ) {
      await purgeAccountSourceNodes(
        ctx,
        args.accountId,
        "work",
        args.artifactId,
        { keepProjecting: true },
      );
    }
    await writeAuditEvent(ctx, {
      actorAccountId: decision.actor.accountId,
      schoolId: decision.loaded.schoolId,
      action: "authority.artifact_exception.changed",
      targetType: artifactResourceType,
      targetId: args.artifactId,
      metadata: {
        accountId: args.accountId,
        effect: args.effect,
        maxLevel: args.maxLevel ?? null,
        policyVersion,
      },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { overrideId, policyVersion };
  },
});

export const clearArtifactException = mutation({
  args: {
    artifactId: v.id("spectraArtifacts"),
    accountId: v.id("accounts"),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.status === "deleted")
      throw new Error("RESOURCE_NOT_FOUND: The artifact does not exist.");
    const artifactResourceType =
      artifact.blueprintKey === "agent"
        ? ("agent" as const)
        : ("artifact" as const);
    const decision = await requireCapability(
      ctx,
      artifactResourceType,
      args.artifactId,
      "share",
    );
    const existing = await ctx.db
      .query("artifactAccessOverrides")
      .withIndex("by_artifact_account", (q) =>
        q.eq("artifactId", args.artifactId).eq("accountId", args.accountId),
      )
      .unique();
    if (!existing) return { cleared: false, policyVersion: null };
    await ctx.db.delete(existing._id);
    const policyVersion = await bumpPolicyVersion(
      ctx,
      artifactResourceType,
      args.artifactId,
      decision.loaded.schoolId,
      decision.actor.accountId,
    );
    await writeAuditEvent(ctx, {
      actorAccountId: decision.actor.accountId,
      schoolId: decision.loaded.schoolId,
      action: "authority.artifact_exception.cleared",
      targetType: artifactResourceType,
      targetId: args.artifactId,
      metadata: { accountId: args.accountId, policyVersion },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { cleared: true, policyVersion };
  },
});

export const createPublicLink = mutation({
  args: {
    resourceType,
    resourceId: v.string(),
    tokenHash: v.string(),
    expiresAt: v.optional(v.number()),
    domainRestriction: v.optional(v.string()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const decision = await requireCapability(
      ctx,
      args.resourceType,
      args.resourceId,
      "publish",
    );
    if (args.tokenHash.length < 40 || args.tokenHash.length > 128)
      throw new Error(
        "PUBLIC_LINK_TOKEN_INVALID: Generate a secure link token.",
      );
    const now = Date.now();
    if (args.expiresAt && args.expiresAt <= now)
      throw new Error(
        "PUBLIC_LINK_EXPIRY_INVALID: Expiry must be in the future.",
      );
    const duplicate = await ctx.db
      .query("publicLinks")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (duplicate)
      throw new Error(
        "PUBLIC_LINK_TOKEN_COLLISION: Generate a new secure link token.",
      );
    const linkId = await ctx.db.insert("publicLinks", {
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      schoolId: decision.loaded.schoolId,
      tokenHash: args.tokenHash,
      level: "read",
      domainRestriction: args.domainRestriction?.trim().toLowerCase(),
      expiresAt: args.expiresAt,
      createdByAccountId: decision.actor.accountId,
      createdAt: now,
      updatedAt: now,
    });
    const policyVersion = await bumpPolicyVersion(
      ctx,
      args.resourceType,
      args.resourceId,
      decision.loaded.schoolId,
      decision.actor.accountId,
    );
    const policy = await ctx.db
      .query("resourcePolicies")
      .withIndex("by_resource", (q) =>
        q
          .eq("resourceType", args.resourceType)
          .eq("resourceId", args.resourceId),
      )
      .unique();
    if (!policy)
      throw new Error(
        "PUBLIC_LINK_POLICY_UNAVAILABLE: Public access could not be activated.",
      );
    await ctx.db.patch(policy._id, { publicEnabled: true, updatedAt: now });
    await writeAuditEvent(ctx, {
      actorAccountId: decision.actor.accountId,
      schoolId: decision.loaded.schoolId,
      action: "authority.public_link.created",
      targetType: args.resourceType,
      targetId: args.resourceId,
      metadata: {
        linkId,
        expiresAt: args.expiresAt ?? null,
        domainRestriction: args.domainRestriction ?? null,
        policyVersion,
      },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { linkId, policyVersion, level: "read" as const };
  },
});

export const listPublicLinks = query({
  args: { resourceType, resourceId: v.string() },
  handler: async (ctx, args) => {
    const decision = await requireCapability(
      ctx,
      args.resourceType,
      args.resourceId,
      "publish",
    );
    const now = Date.now();
    const links = await ctx.db
      .query("publicLinks")
      .withIndex("by_resource", (q) =>
        q
          .eq("resourceType", args.resourceType)
          .eq("resourceId", args.resourceId),
      )
      .order("desc")
      .collect();
    const active = links.filter(
      (link) => !link.revokedAt && (!link.expiresAt || link.expiresAt > now),
    );
    return Promise.all(
      active.map(async (link) => {
        // Only the owner of the run that made a link can fetch its address
        // again; everyone else sees it as any other link.
        const run = link.aiOrigin ? await ctx.db.get(link.aiOrigin.runId) : null;
        const madeBySpectra =
          link.aiOrigin && run?.ownerAccountId === decision.actor.accountId
            ? link.aiOrigin
            : undefined;
        return {
          linkId: link._id,
          level: link.level,
          domainRestriction: link.domainRestriction,
          expiresAt: link.expiresAt,
          createdAt: link.createdAt,
          ...(madeBySpectra ? { madeBySpectra } : {}),
        };
      }),
    );
  },
});

export const revokePublicLink = mutation({
  args: { linkId: v.id("publicLinks"), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link)
      throw new Error("PUBLIC_LINK_NOT_FOUND: The link is unavailable.");
    const decision = await requireCapability(
      ctx,
      link.resourceType,
      link.resourceId,
      "publish",
    );
    const now = Date.now();
    await ctx.db.patch(link._id, { revokedAt: now, updatedAt: now });
    const remaining = await ctx.db
      .query("publicLinks")
      .withIndex("by_resource", (q) =>
        q
          .eq("resourceType", link.resourceType)
          .eq("resourceId", link.resourceId),
      )
      .collect();
    const anyActive = remaining.some(
      (candidate) =>
        candidate._id !== link._id &&
        !candidate.revokedAt &&
        (!candidate.expiresAt || candidate.expiresAt > now),
    );
    const policyVersion = await bumpPolicyVersion(
      ctx,
      link.resourceType,
      link.resourceId,
      decision.loaded.schoolId,
      decision.actor.accountId,
    );
    const policy = await ctx.db
      .query("resourcePolicies")
      .withIndex("by_resource", (q) =>
        q
          .eq("resourceType", link.resourceType)
          .eq("resourceId", link.resourceId),
      )
      .unique();
    if (policy)
      await ctx.db.patch(policy._id, {
        publicEnabled: anyActive,
        updatedAt: now,
      });
    await writeAuditEvent(ctx, {
      actorAccountId: decision.actor.accountId,
      schoolId: link.schoolId,
      action: "authority.public_link.revoked",
      targetType: link.resourceType,
      targetId: link.resourceId,
      metadata: { linkId: link._id, policyVersion },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { linkId: link._id, revokedAt: now, policyVersion };
  },
});

export const resolvePublicLink = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("publicLinks")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    const now = Date.now();
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt <= now))
      return null;
    if ((await publicLinkViewerDecision(ctx, link.domainRestriction)) !== "allowed")
      return null;
    const policy = await ctx.db
      .query("resourcePolicies")
      .withIndex("by_resource", (q) =>
        q
          .eq("resourceType", link.resourceType)
          .eq("resourceId", link.resourceId),
      )
      .unique();
    if (!policy?.publicEnabled) return null;
    const loaded = await loadResource(ctx, link.resourceType, link.resourceId);
    if (!loaded || loaded.lifecycle === "deleted") return null;
    if (!(await publicLinkCreatorStillPublishes(ctx, link, loaded.schoolId)))
      return null;
    return {
      resourceType: link.resourceType,
      resourceId: link.resourceId,
      level: link.level,
      policyVersion: policy.version,
      expiresAt: link.expiresAt,
    };
  },
});

export const publicProjection = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("publicLinks")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    const now = Date.now();
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt <= now))
      return null;
    const viewerDecision = await publicLinkViewerDecision(
      ctx,
      link.domainRestriction,
    );
    if (viewerDecision !== "allowed") return { access: viewerDecision };
    const policy = await ctx.db
      .query("resourcePolicies")
      .withIndex("by_resource", (q) =>
        q
          .eq("resourceType", link.resourceType)
          .eq("resourceId", link.resourceId),
      )
      .unique();
    if (!policy?.publicEnabled) return null;
    const loaded = await loadResource(ctx, link.resourceType, link.resourceId);
    if (!loaded || loaded.lifecycle === "deleted") return null;
    if (!(await publicLinkCreatorStillPublishes(ctx, link, loaded.schoolId)))
      return null;

    if (link.resourceType === "workspace") {
      const workspace = loaded.resource;
      if (!("defaultView" in workspace) || workspace.status !== "active")
        return null;
      const placements = await workspaceContextNodes(
        ctx,
        workspace._id,
        "work",
      );
      const artifacts = (
        await Promise.all(
          placements
            .filter(
              (placement) =>
                Boolean(placement.sourceId) &&
                placement.accessProjection !== false,
            )
            .map(async (placement) => {
              const artifactId = ctx.db.normalizeId(
                "spectraArtifacts",
                placement.sourceId!,
              );
              const artifact = artifactId ? await ctx.db.get(artifactId) : null;
              if (
                !artifact ||
                artifact.status !== "active" ||
                artifact.schoolId !== workspace.schoolId ||
                artifact.blueprintKey === "thread_reference"
              )
                return null;
              const projectsAccess = sharesWithWorkspace(placement);
              if (!projectsAccess) return null;
              return {
                artifactId: artifact._id,
                title: artifact.title,
                summary: artifact.summary,
                blueprintKey: artifact.blueprintKey,
                content:
                  artifact.blueprintKey === "quiz"
                    ? projectQuizContentForLearner(artifact.content)
                    : artifact.blueprintKey === "timetable"
                      ? projectTimetableSharedContent(artifact.content)
                      : artifact.content,
                runtimeBuild: await publicRuntimeBuild(ctx, artifact),
                updatedAt: artifact.updatedAt,
              };
            }),
        )
      ).filter((artifact): artifact is NonNullable<typeof artifact> =>
        Boolean(artifact),
      );
      return {
        resourceType: "workspace" as const,
        level: "read" as const,
        policyVersion: policy.version,
        expiresAt: link.expiresAt,
        workspace: {
          workspaceId: workspace._id,
          title: workspace.title,
          description: workspace.description,
          icon: workspace.icon,
          color: workspace.color,
          defaultView: workspace.defaultView,
          updatedAt: workspace.updatedAt,
        },
        artifacts,
      };
    }

    const artifact = loaded.resource;
    if (
      !("blueprintKey" in artifact) ||
      artifact.status !== "active" ||
      artifact.blueprintKey === "thread_reference"
    )
      return null;
    return {
      resourceType: link.resourceType,
      level: "read" as const,
      policyVersion: policy.version,
      expiresAt: link.expiresAt,
      artifact: {
        artifactId: artifact._id,
        title: artifact.title,
        summary: artifact.summary,
        blueprintKey: artifact.blueprintKey,
        content:
          artifact.blueprintKey === "quiz"
            ? projectQuizContentForLearner(artifact.content)
            : artifact.blueprintKey === "timetable"
              ? projectTimetableSharedContent(artifact.content)
              : artifact.content,
        runtimeBuild: await publicRuntimeBuild(ctx, artifact),
        updatedAt: artifact.updatedAt,
      },
    };
  },
});
