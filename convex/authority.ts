import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { bumpPolicyVersion, capabilitiesForLevel, evaluateAccess, loadResource, requireCapability } from "./authorityShared";
import { getActiveMembership, getAuthenticatedActor } from "./identityShared";
import { writeAuditEvent } from "./auditShared";
import { releaseClaimsForAccount } from "./regionClaims";

const resourceType = v.union(v.literal("workspace"), v.literal("artifact"), v.literal("agent"));
const level = v.union(v.literal("read"), v.literal("modify"));

export const access = query({
  args: { resourceType, resourceId: v.string() },
  handler: async (ctx, args) => {
    const decision = await evaluateAccess(ctx, args.resourceType, args.resourceId);
    return { allowed: decision.allowed, level: decision.level, capabilities: decision.capabilities, reason: decision.reason, sources: decision.sources };
  },
});

export const listGrants = query({
  args: { resourceType, resourceId: v.string() },
  handler: async (ctx, args) => {
    await requireCapability(ctx, args.resourceType, args.resourceId, "share");
    const now = Date.now();
    const grants = await ctx.db.query("accessGrants").withIndex("by_resource", (q) => q.eq("resourceType", args.resourceType).eq("resourceId", args.resourceId)).collect();
    return grants.filter((grant) => !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now)).map((grant) => ({ grantId: grant._id, principalType: grant.principalType, principalId: grant.principalId, level: grant.level, source: grant.source, expiresAt: grant.expiresAt, createdAt: grant.createdAt }));
  },
});

export const invite = mutation({
  args: { resourceType, resourceId: v.string(), inviteeAccountId: v.id("accounts"), level, expiresAt: v.optional(v.number()), message: v.optional(v.string()), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const decision = await requireCapability(ctx, args.resourceType, args.resourceId, "share");
    const loaded = await loadResource(ctx, args.resourceType, args.resourceId);
    if (!loaded) throw new Error("RESOURCE_NOT_FOUND: The resource does not exist.");
    const invitee = await ctx.db.get(args.inviteeAccountId);
    const membership = invitee ? await getActiveMembership(ctx, invitee._id) : null;
    if (!invitee || invitee.status !== "active" || !membership || membership.schoolId !== decision.actor.schoolId) throw new Error("SHARING_SCHOOL_BOUNDARY: Select an active member of this school.");
    if (invitee._id === loaded.ownerAccountId) throw new Error("SHARING_OWNER_INVARIANT: The owner already has full access.");
    const now = Date.now();
    if (args.expiresAt && args.expiresAt <= now) throw new Error("SHARING_EXPIRY_INVALID: Expiry must be in the future.");
    const prior = await ctx.db.query("shareInvitations").withIndex("by_resource_invitee", (q) => q.eq("resourceType", args.resourceType).eq("resourceId", args.resourceId).eq("inviteeAccountId", invitee._id)).collect();
    const accepted = prior.find((candidate) => candidate.status === "accepted" && candidate.grantId);
    if (accepted?.grantId) {
      const grant = await ctx.db.get(accepted.grantId);
      if (grant && !grant.revokedAt) throw new Error("SHARING_ALREADY_ACCEPTED: Change this collaborator's permission instead.");
    }
    const pending = prior.find((candidate) => candidate.status === "pending");
    let invitationId;
    if (pending) {
      await ctx.db.patch(pending._id, { level: args.level, expiresAt: args.expiresAt, message: args.message?.trim().slice(0, 500), updatedAt: now });
      invitationId = pending._id;
    } else {
      invitationId = await ctx.db.insert("shareInvitations", { schoolId: decision.actor.schoolId, resourceType: args.resourceType, resourceId: args.resourceId, inviterAccountId: decision.actor.accountId, inviteeAccountId: invitee._id, level: args.level, status: "pending", message: args.message?.trim().slice(0, 500), expiresAt: args.expiresAt, createdAt: now, updatedAt: now });
    }
    await writeAuditEvent(ctx, { actorAccountId: decision.actor.accountId, schoolId: loaded.schoolId, action: "authority.invitation.sent", targetType: args.resourceType, targetId: args.resourceId, metadata: { invitationId, inviteeAccountId: invitee._id, level: args.level, expiresAt: args.expiresAt ?? null }, requestId: args.requestId, retentionClass: "security" });
    return { invitationId, status: "pending" as const };
  },
});

export const listIncomingInvitations = query({
  args: {},
  handler: async (ctx) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
    const now = Date.now();
    const invitations = await ctx.db.query("shareInvitations").withIndex("by_invitee_status", (q) => q.eq("inviteeAccountId", actor.accountId).eq("status", "pending")).order("desc").collect();
    return Promise.all(invitations.filter((invitation) => !invitation.expiresAt || invitation.expiresAt > now).map(async (invitation) => {
      const [resource, inviter] = await Promise.all([loadResource(ctx, invitation.resourceType, invitation.resourceId), ctx.db.get(invitation.inviterAccountId)]);
      if (!resource || resource.schoolId !== actor.schoolId) return null;
      return { invitationId: invitation._id, resourceType: invitation.resourceType, resourceId: invitation.resourceId, level: invitation.level, message: invitation.message, expiresAt: invitation.expiresAt, createdAt: invitation.createdAt, inviter: inviter ? { accountId: inviter._id, name: inviter.name, avatarUrl: inviter.avatarUrl } : null, resource: { title: resource.resource.title, typeKey: "blueprintKey" in resource.resource ? resource.resource.blueprintKey : "workspace" } };
    })).then((rows) => rows.filter((row): row is NonNullable<typeof row> => Boolean(row)));
  },
});

export const acceptShareInvitation = mutation({
  args: { invitationId: v.id("shareInvitations"), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.inviteeAccountId !== actor.accountId || invitation.status !== "pending") throw new Error("SHARING_INVITATION_UNAVAILABLE: This invitation is no longer pending.");
    const now = Date.now();
    if (invitation.expiresAt && invitation.expiresAt <= now) {
      await ctx.db.patch(invitation._id, { status: "expired", respondedAt: now, updatedAt: now });
      throw new Error("SHARING_INVITATION_EXPIRED: Ask the owner to invite you again.");
    }
    const loaded = await loadResource(ctx, invitation.resourceType, invitation.resourceId);
    if (!loaded || loaded.schoolId !== actor.schoolId) throw new Error("SHARING_RESOURCE_UNAVAILABLE: The shared item is no longer available.");
    const grantId = await ctx.db.insert("accessGrants", { schoolId: actor.schoolId, resourceType: invitation.resourceType, resourceId: invitation.resourceId, principalType: "account", principalId: actor.accountId, level: invitation.level, capabilities: capabilitiesForLevel(invitation.level), source: "direct", expiresAt: invitation.expiresAt, createdByAccountId: invitation.inviterAccountId, createdAt: now, updatedAt: now });
    await ctx.db.patch(invitation._id, { status: "accepted", grantId, respondedAt: now, updatedAt: now });
    const policyVersion = await bumpPolicyVersion(ctx, invitation.resourceType, invitation.resourceId, loaded.schoolId, invitation.inviterAccountId);
    await writeAuditEvent(ctx, { actorAccountId: actor.accountId, schoolId: actor.schoolId, action: "authority.invitation.accepted", targetType: invitation.resourceType, targetId: invitation.resourceId, metadata: { invitationId: invitation._id, grantId, level: invitation.level, policyVersion }, requestId: args.requestId, retentionClass: "security" });
    return { grantId, resourceType: invitation.resourceType, resourceId: invitation.resourceId, level: invitation.level, appearsIn: "shared" as const, policyVersion };
  },
});

export const declineShareInvitation = mutation({
  args: { invitationId: v.id("shareInvitations") },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.inviteeAccountId !== actor.accountId || invitation.status !== "pending") throw new Error("SHARING_INVITATION_UNAVAILABLE: This invitation is no longer pending.");
    const now = Date.now();
    await ctx.db.patch(invitation._id, { status: "declined", respondedAt: now, updatedAt: now });
    return { invitationId: invitation._id, status: "declined" as const };
  },
});

export const changeAcceptedLevel = mutation({
  args: { invitationId: v.id("shareInvitations"), level, requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.status !== "accepted" || !invitation.grantId) throw new Error("SHARING_COLLABORATOR_UNAVAILABLE: This collaborator has not accepted access.");
    const decision = await requireCapability(ctx, invitation.resourceType, invitation.resourceId, "share");
    const grant = await ctx.db.get(invitation.grantId);
    if (!grant || grant.revokedAt) throw new Error("SHARING_GRANT_NOT_FOUND: The accepted access no longer exists.");
    const now = Date.now();
    await ctx.db.patch(grant._id, { level: args.level, capabilities: capabilitiesForLevel(args.level), updatedAt: now });
    await ctx.db.patch(invitation._id, { level: args.level, updatedAt: now });
    const loaded = await loadResource(ctx, invitation.resourceType, invitation.resourceId);
    const policyVersion = await bumpPolicyVersion(ctx, invitation.resourceType, invitation.resourceId, loaded?.schoolId, decision.actor.accountId);
    await writeAuditEvent(ctx, { actorAccountId: decision.actor.accountId, schoolId: loaded?.schoolId, action: "authority.collaborator.level_changed", targetType: invitation.resourceType, targetId: invitation.resourceId, metadata: { invitationId: invitation._id, inviteeAccountId: invitation.inviteeAccountId, level: args.level, policyVersion }, requestId: args.requestId, retentionClass: "security" });
    return { level: args.level, policyVersion };
  },
});

export const revoke = mutation({
  args: { resourceType, resourceId: v.string(), grantId: v.id("accessGrants"), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const decision = await requireCapability(ctx, args.resourceType, args.resourceId, "share");
    const grant = await ctx.db.get(args.grantId);
    if (!grant || grant.resourceType !== args.resourceType || grant.resourceId !== args.resourceId) throw new Error("SHARING_GRANT_NOT_FOUND: The grant is unavailable.");
    const now = Date.now();
    await ctx.db.patch(grant._id, { revokedAt: now, updatedAt: now });
    const inviteeAccountId = grant.principalType === "account" && grant.principalId ? ctx.db.normalizeId("accounts", grant.principalId) : null;
    if (inviteeAccountId) {
      const invitations = await ctx.db.query("shareInvitations").withIndex("by_resource_invitee", (q) => q.eq("resourceType", args.resourceType).eq("resourceId", args.resourceId).eq("inviteeAccountId", inviteeAccountId)).collect();
      await Promise.all(invitations.filter((invitation) => invitation.status === "accepted" && invitation.grantId === grant._id).map((invitation) => ctx.db.patch(invitation._id, { status: "revoked", revokedAt: now, updatedAt: now })));
      if (args.resourceType === "artifact" || args.resourceType === "agent") {
        const artifactId = ctx.db.normalizeId("spectraArtifacts", args.resourceId);
        if (artifactId) {
          const placements = await ctx.db.query("spectraWorkspaceItems").withIndex("by_source", (q) => q.eq("sourceType", "artifact").eq("sourceId", artifactId)).collect();
          await Promise.all(placements
            .filter((placement) => placement.placedByAccountId === inviteeAccountId && placement.accessProjection !== true)
            .map((placement) => ctx.db.delete(placement._id)));
          await releaseClaimsForAccount(ctx, artifactId, inviteeAccountId, now);
        }
      }
    }
    const loaded = await loadResource(ctx, args.resourceType, args.resourceId);
    const policyVersion = await bumpPolicyVersion(ctx, args.resourceType, args.resourceId, loaded?.schoolId, decision.actor.accountId);
    await writeAuditEvent(ctx, { actorAccountId: decision.actor.accountId, schoolId: loaded?.schoolId, action: "authority.grant.revoked", targetType: args.resourceType, targetId: args.resourceId, metadata: { grantId: grant._id, policyVersion }, requestId: args.requestId, retentionClass: "security" });
    return { grantId: grant._id, revokedAt: now, policyVersion };
  },
});

export const revokePendingInvitation = mutation({
  args: { invitationId: v.id("shareInvitations"), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.status !== "pending") throw new Error("SHARING_INVITATION_UNAVAILABLE: This invitation is no longer pending.");
    const decision = await requireCapability(ctx, invitation.resourceType, invitation.resourceId, "share");
    const now = Date.now();
    await ctx.db.patch(invitation._id, { status: "revoked", revokedAt: now, updatedAt: now });
    await writeAuditEvent(ctx, { actorAccountId: decision.actor.accountId, schoolId: invitation.schoolId, action: "authority.invitation.revoked", targetType: invitation.resourceType, targetId: invitation.resourceId, metadata: { invitationId: invitation._id, inviteeAccountId: invitation.inviteeAccountId }, requestId: args.requestId, retentionClass: "security" });
    return { invitationId: invitation._id, status: "revoked" as const };
  },
});

export const shareState = query({
  args: { resourceType, resourceId: v.string() },
  handler: async (ctx, args) => {
    await requireCapability(ctx, args.resourceType, args.resourceId, "share");
    const now = Date.now();
    const invitations = await ctx.db.query("shareInvitations").withIndex("by_resource", (q) => q.eq("resourceType", args.resourceType).eq("resourceId", args.resourceId)).order("desc").collect();
    return Promise.all(invitations.filter((invitation) => (invitation.status === "pending" || invitation.status === "accepted") && (!invitation.expiresAt || invitation.expiresAt > now)).map(async (invitation) => {
      const account = await ctx.db.get(invitation.inviteeAccountId);
      return { invitationId: invitation._id, status: invitation.status, level: invitation.level, expiresAt: invitation.expiresAt, acceptedAt: invitation.status === "accepted" ? invitation.respondedAt : undefined, account: account ? { accountId: account._id, name: account.name, email: account.email, avatarUrl: account.avatarUrl } : null, grantId: invitation.grantId };
    }));
  },
});

export const setArtifactException = mutation({
  args: { artifactId: v.id("spectraArtifacts"), accountId: v.id("accounts"), effect: v.union(v.literal("deny"), v.literal("restrict")), maxLevel: v.optional(level), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const decision = await requireCapability(ctx, "artifact", args.artifactId, "share");
    if (args.accountId === decision.actor.accountId) throw new Error("SHARING_OWNER_INVARIANT: Owner access cannot be removed.");
    if (args.effect === "restrict" && !args.maxLevel) throw new Error("SHARING_RESTRICTION_INVALID: A restricted access level is required.");
    const existing = await ctx.db.query("artifactAccessOverrides").withIndex("by_artifact_account", (q) => q.eq("artifactId", args.artifactId).eq("accountId", args.accountId)).unique();
    const now = Date.now();
    let overrideId;
    if (existing) {
      await ctx.db.patch(existing._id, { effect: args.effect, maxLevel: args.effect === "restrict" ? args.maxLevel : undefined, updatedAt: now });
      overrideId = existing._id;
    } else {
      overrideId = await ctx.db.insert("artifactAccessOverrides", { schoolId: decision.loaded.schoolId, artifactId: args.artifactId, accountId: args.accountId, effect: args.effect, maxLevel: args.effect === "restrict" ? args.maxLevel : undefined, createdByAccountId: decision.actor.accountId, createdAt: now, updatedAt: now });
    }
    const policyVersion = await bumpPolicyVersion(ctx, "artifact", args.artifactId, decision.loaded.schoolId, decision.actor.accountId);
    await writeAuditEvent(ctx, { actorAccountId: decision.actor.accountId, schoolId: decision.loaded.schoolId, action: "authority.artifact_exception.changed", targetType: "artifact", targetId: args.artifactId, metadata: { accountId: args.accountId, effect: args.effect, maxLevel: args.maxLevel ?? null, policyVersion }, requestId: args.requestId, retentionClass: "security" });
    return { overrideId, policyVersion };
  },
});

export const createPublicLink = mutation({
  args: { resourceType, resourceId: v.string(), tokenHash: v.string(), expiresAt: v.optional(v.number()), domainRestriction: v.optional(v.string()), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const decision = await requireCapability(ctx, args.resourceType, args.resourceId, "publish");
    if (args.tokenHash.length < 40 || args.tokenHash.length > 128) throw new Error("PUBLIC_LINK_TOKEN_INVALID: Generate a secure link token.");
    const now = Date.now();
    if (args.expiresAt && args.expiresAt <= now) throw new Error("PUBLIC_LINK_EXPIRY_INVALID: Expiry must be in the future.");
    const duplicate = await ctx.db.query("publicLinks").withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash)).unique();
    if (duplicate) throw new Error("PUBLIC_LINK_TOKEN_COLLISION: Generate a new secure link token.");
    const linkId = await ctx.db.insert("publicLinks", { resourceType: args.resourceType, resourceId: args.resourceId, schoolId: decision.loaded.schoolId, tokenHash: args.tokenHash, level: "read", domainRestriction: args.domainRestriction?.trim().toLowerCase(), expiresAt: args.expiresAt, createdByAccountId: decision.actor.accountId, createdAt: now, updatedAt: now });
    const existingPolicy = await ctx.db.query("resourcePolicies").withIndex("by_resource", (q) => q.eq("resourceType", args.resourceType).eq("resourceId", args.resourceId)).unique();
    let policyVersion;
    if (existingPolicy) {
      policyVersion = existingPolicy.version + 1;
      await ctx.db.patch(existingPolicy._id, { publicEnabled: true, version: policyVersion, updatedByAccountId: decision.actor.accountId, updatedAt: now });
    } else {
      policyVersion = 1;
      await ctx.db.insert("resourcePolicies", { resourceType: args.resourceType, resourceId: args.resourceId, schoolId: decision.loaded.schoolId, version: policyVersion, publicEnabled: true, updatedByAccountId: decision.actor.accountId, createdAt: now, updatedAt: now });
    }
    await writeAuditEvent(ctx, { actorAccountId: decision.actor.accountId, schoolId: decision.loaded.schoolId, action: "authority.public_link.created", targetType: args.resourceType, targetId: args.resourceId, metadata: { linkId, expiresAt: args.expiresAt ?? null, domainRestriction: args.domainRestriction ?? null, policyVersion }, requestId: args.requestId, retentionClass: "security" });
    return { linkId, policyVersion, level: "read" as const };
  },
});

export const revokePublicLink = mutation({
  args: { linkId: v.id("publicLinks"), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new Error("PUBLIC_LINK_NOT_FOUND: The link is unavailable.");
    const decision = await requireCapability(ctx, link.resourceType, link.resourceId, "publish");
    const now = Date.now();
    await ctx.db.patch(link._id, { revokedAt: now, updatedAt: now });
    const remaining = await ctx.db.query("publicLinks").withIndex("by_resource", (q) => q.eq("resourceType", link.resourceType).eq("resourceId", link.resourceId)).collect();
    const anyActive = remaining.some((candidate) => candidate._id !== link._id && !candidate.revokedAt && (!candidate.expiresAt || candidate.expiresAt > now));
    const policy = await ctx.db.query("resourcePolicies").withIndex("by_resource", (q) => q.eq("resourceType", link.resourceType).eq("resourceId", link.resourceId)).unique();
    const policyVersion = (policy?.version ?? 0) + 1;
    if (policy) await ctx.db.patch(policy._id, { publicEnabled: anyActive, version: policyVersion, updatedByAccountId: decision.actor.accountId, updatedAt: now });
    await writeAuditEvent(ctx, { actorAccountId: decision.actor.accountId, schoolId: link.schoolId, action: "authority.public_link.revoked", targetType: link.resourceType, targetId: link.resourceId, metadata: { linkId: link._id, policyVersion }, requestId: args.requestId, retentionClass: "security" });
    return { linkId: link._id, revokedAt: now, policyVersion };
  },
});

export const resolvePublicLink = query({
  args: { tokenHash: v.string(), viewerDomain: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const link = await ctx.db.query("publicLinks").withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash)).unique();
    const now = Date.now();
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt <= now)) return null;
    if (link.domainRestriction && link.domainRestriction !== args.viewerDomain?.trim().toLowerCase()) return null;
    const policy = await ctx.db.query("resourcePolicies").withIndex("by_resource", (q) => q.eq("resourceType", link.resourceType).eq("resourceId", link.resourceId)).unique();
    if (!policy?.publicEnabled) return null;
    const loaded = await loadResource(ctx, link.resourceType, link.resourceId);
    if (!loaded || loaded.lifecycle === "deleted") return null;
    return { resourceType: link.resourceType, resourceId: link.resourceId, level: link.level, policyVersion: policy.version, expiresAt: link.expiresAt };
  },
});
