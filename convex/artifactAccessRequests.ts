import { mutation, query } from "./functions";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { capabilitiesForLevel, bumpPolicyVersion, evaluateAccessForActor } from "./authorityShared";
import { writeAuditEvent } from "./auditShared";
import { getActorForAccountId, getAuthenticatedActor } from "./identityShared";
import { requireArtifactCapability } from "./spectraShared";

const level = v.union(v.literal("read"), v.literal("modify"));

async function requireActor(ctx: Parameters<typeof getAuthenticatedActor>[0]) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return actor;
}

async function requireReadableContainer(
  ctx: Parameters<typeof getAuthenticatedActor>[0],
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>,
  containerType: "artifact" | "thread",
  containerId: string,
) {
  if (containerType === "artifact") {
    const artifactId = ctx.db.normalizeId("spectraArtifacts", containerId);
    if (!artifactId) throw new Error("EMBED_CONTAINER_NOT_FOUND");
    await requireArtifactCapability(ctx, artifactId, "read");
    return;
  }
  const threadId = ctx.db.normalizeId("spectraThreads", containerId);
  const thread = threadId ? await ctx.db.get(threadId) : null;
  if (!thread || thread.status === "deleted" || thread.ownerAccountId !== actor.accountId || thread.schoolId !== actor.schoolId) {
    throw new Error("EMBED_CONTAINER_NOT_FOUND");
  }
}

export const request = mutation({
  args: {
    embedId: v.id("artifactEmbeds"),
    requestedLevel: v.optional(level),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const embed = await ctx.db.get(args.embedId);
    if (!embed || embed.removedAt) throw new Error("EMBED_NOT_FOUND");
    await requireReadableContainer(ctx, actor, embed.containerType, embed.containerId);
    const source = await ctx.db.get(embed.sourceArtifactId);
    if (!source || source.status === "deleted" || source.schoolId !== actor.schoolId || embed.schoolId !== actor.schoolId) {
      throw new Error("ACCESS_REQUEST_UNAVAILABLE: This source cannot receive an access request.");
    }
    const current = await evaluateAccessForActor(ctx, actor, source.blueprintKey === "agent" ? "agent" : "artifact", source._id);
    if (current.allowed && current.capabilities.includes("read")) return { status: "already_has_access" as const };

    const prior = await ctx.db
      .query("artifactAccessRequests")
      .withIndex("by_embed_requester", (q) => q.eq("embedId", embed._id).eq("requesterAccountId", actor.accountId))
      .order("desc")
      .collect();
    const pending = prior.find((entry) => entry.status === "pending");
    if (pending) return { requestId: pending._id, status: "pending" as const };
    const recentlyDeclined = prior.find((entry) => entry.status === "declined" && Date.now() - entry.updatedAt < 24 * 60 * 60 * 1000);
    if (recentlyDeclined) throw new Error("ACCESS_REQUEST_RECENTLY_DECLINED: The owner declined this request recently.");

    const now = Date.now();
    const requestId = await ctx.db.insert("artifactAccessRequests", {
      embedId: embed._id,
      sourceArtifactId: source._id,
      schoolId: actor.schoolId,
      requesterAccountId: actor.accountId,
      ownerAccountId: source.ownerAccountId,
      requestedLevel: args.requestedLevel ?? "read",
      status: "pending",
      message: args.message?.trim().slice(0, 500),
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "authority.access_request.created",
      targetType: source.blueprintKey === "agent" ? "agent" : "artifact",
      targetId: source._id,
      metadata: { requestId, embedId: embed._id, requestedLevel: args.requestedLevel ?? "read" },
      retentionClass: "security",
    });
    return { requestId, status: "pending" as const };
  },
});

export const cancel = mutation({
  args: { requestId: v.id("artifactAccessRequests") },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.requesterAccountId !== actor.accountId || request.status !== "pending") {
      throw new Error("ACCESS_REQUEST_UNAVAILABLE: This request is no longer pending.");
    }
    const now = Date.now();
    await ctx.db.patch(request._id, { status: "cancelled", updatedAt: now, resolvedAt: now, resolvedByAccountId: actor.accountId });
    return { requestId: request._id, status: "cancelled" as const };
  },
});

export const listForSource = query({
  args: { sourceArtifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    await requireArtifactCapability(ctx, args.sourceArtifactId, "share");
    const requests = await ctx.db
      .query("artifactAccessRequests")
      .withIndex("by_source_status", (q) => q.eq("sourceArtifactId", args.sourceArtifactId).eq("status", "pending"))
      .order("desc")
      .collect();
    return Promise.all(requests.map(async (request) => {
      const [requester, embed] = await Promise.all([ctx.db.get(request.requesterAccountId), ctx.db.get(request.embedId)]);
      return {
        requestId: request._id,
        requestedLevel: request.requestedLevel,
        message: request.message,
        createdAt: request.createdAt,
        requester: requester ? { accountId: requester._id, name: requester.name, email: requester.email, avatarUrl: requester.avatarUrl } : null,
        context: embed && !embed.removedAt ? { containerType: embed.containerType, containerId: embed.containerId } : null,
      };
    }));
  },
});

export const resolve = mutation({
  args: {
    requestId: v.id("artifactAccessRequests"),
    decision: v.union(v.literal("approve"), v.literal("decline")),
    level: v.optional(level),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.status !== "pending") throw new Error("ACCESS_REQUEST_UNAVAILABLE: This request is no longer pending.");
    const source = await ctx.db.get(request.sourceArtifactId);
    if (!source || source.status === "deleted") throw new Error("ACCESS_REQUEST_SOURCE_UNAVAILABLE");
    const { actor } = await requireArtifactCapability(ctx, source._id, "share");
    if (request.schoolId !== actor.schoolId || request.ownerAccountId !== source.ownerAccountId) throw new Error("ACCESS_REQUEST_SCHOOL_BOUNDARY");
    const requesterActor = await getActorForAccountId(ctx, request.requesterAccountId);
    if (!requesterActor || requesterActor.schoolId !== actor.schoolId) throw new Error("ACCESS_REQUEST_REQUESTER_UNAVAILABLE");
    const now = Date.now();

    if (args.decision === "decline") {
      await ctx.db.patch(request._id, { status: "declined", updatedAt: now, resolvedAt: now, resolvedByAccountId: actor.accountId });
      await writeAuditEvent(ctx, {
        actorAccountId: actor.accountId,
        schoolId: actor.schoolId,
        action: "authority.access_request.declined",
        targetType: source.blueprintKey === "agent" ? "agent" : "artifact",
        targetId: source._id,
        metadata: { requestId: request._id, requesterAccountId: request.requesterAccountId },
        retentionClass: "security",
      });
      return { requestId: request._id, status: "declined" as const };
    }

    const approvedLevel = args.level ?? request.requestedLevel;
    const resourceType = source.blueprintKey === "agent" ? "agent" as const : "artifact" as const;
    const grants = await ctx.db.query("accessGrants").withIndex("by_resource", (q) => q.eq("resourceType", resourceType).eq("resourceId", source._id)).collect();
    const existingGrant = grants.find((grant) => grant.source === "direct" && grant.principalType === "account" && grant.principalId === request.requesterAccountId && !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now));
    let grantId: Id<"accessGrants">;
    const grantedLevel = existingGrant?.level === "modify" || approvedLevel === "modify" ? "modify" as const : "read" as const;
    if (existingGrant) {
      grantId = existingGrant._id;
      if (existingGrant.level !== grantedLevel) {
        await ctx.db.patch(existingGrant._id, { level: grantedLevel, capabilities: capabilitiesForLevel(grantedLevel), updatedAt: now });
      }
    } else {
      grantId = await ctx.db.insert("accessGrants", {
        schoolId: actor.schoolId,
        resourceType,
        resourceId: source._id,
        principalType: "account",
        principalId: request.requesterAccountId,
        level: grantedLevel,
        capabilities: capabilitiesForLevel(grantedLevel),
        source: "direct",
        createdByAccountId: actor.accountId,
        createdAt: now,
        updatedAt: now,
      });
    }

    const invitations = await ctx.db.query("shareInvitations").withIndex("by_resource_invitee", (q) => q.eq("resourceType", resourceType).eq("resourceId", source._id).eq("inviteeAccountId", request.requesterAccountId)).collect();
    let invitationId: Id<"shareInvitations">;
    const accepted = invitations.find((invitation) => invitation.status === "accepted" && invitation.grantId === grantId);
    if (accepted) {
      invitationId = accepted._id;
      await ctx.db.patch(accepted._id, { level: grantedLevel, updatedAt: now });
    } else {
      await Promise.all(invitations.filter((invitation) => invitation.status === "pending").map((invitation) => ctx.db.patch(invitation._id, { status: "revoked", revokedAt: now, updatedAt: now })));
      invitationId = await ctx.db.insert("shareInvitations", {
        schoolId: actor.schoolId,
        resourceType,
        resourceId: source._id,
        inviterAccountId: actor.accountId,
        inviteeAccountId: request.requesterAccountId,
        level: grantedLevel,
        status: "accepted",
        message: "Approved access requested from an embedded artifact.",
        grantId,
        createdAt: request.createdAt,
        updatedAt: now,
        respondedAt: now,
      });
    }

    await ctx.db.patch(request._id, {
      status: "approved",
      resolvedLevel: grantedLevel,
      grantId,
      invitationId,
      updatedAt: now,
      resolvedAt: now,
      resolvedByAccountId: actor.accountId,
    });
    const policyVersion = await bumpPolicyVersion(ctx, resourceType, source._id, source.schoolId, actor.accountId);
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "authority.access_request.approved",
      targetType: resourceType,
      targetId: source._id,
      metadata: { requestId: request._id, requesterAccountId: request.requesterAccountId, level: grantedLevel, grantId, policyVersion },
      retentionClass: "security",
    });
    return { requestId: request._id, status: "approved" as const, level: grantedLevel, grantId, invitationId, policyVersion };
  },
});
