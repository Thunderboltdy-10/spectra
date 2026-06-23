import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { dayKey, getUserByClerkId } from "./helpers";
import { vRole } from "./shared";
import { purgeUserData } from "./userLifecycle";
import { updateUserInPlatformStats } from "./platformStatsAggregates";
import { getCapacitySnapshot, requireCapacity } from "./accessControl";
import { isSuperAdminEmail } from "./constants";

function randomToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let token = "";
  for (let i = 0; i < 48; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

const INVITATION_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const INVITATION_RATE_LIMIT_MAX = 50;

async function requireAdmin(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string, orgId?: Id<"orgs">) {
  const actor = await getUserByClerkId(ctx, actorClerkId, orgId);
  if (!actor) throw new Error("Unauthorized");
  if (actor.role !== "admin" && !isSuperAdminEmail(actor.email)) throw new Error("Admin access required");
  return actor;
}

function isSeatCountedMember(email: string) {
  void email;
  return true;
}

async function findExistingMemberByEmail(
  ctx: Parameters<typeof getUserByClerkId>[0],
  orgId: Id<"orgs">,
  email: string,
) {
  const indexed = await ctx.db
    .query("users")
    .withIndex("by_org_email", (q) => q.eq("orgId", orgId).eq("email", email))
    .unique();
  if (indexed) {
    return indexed;
  }

  const fallback = await ctx.db
    .query("users")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(500);
  return fallback.find((member) => member.email.toLowerCase() === email) ?? null;
}

async function enforceInvitationRateLimit(
  ctx: MutationCtx,
  invitedBy: Id<"users">,
) {
  const since = Date.now() - INVITATION_RATE_LIMIT_WINDOW_MS;
  const recent = await ctx.db
    .query("schoolInvitations")
    .withIndex("by_invited_by_created", (q) => q.eq("invitedBy", invitedBy).gte("createdAt", since))
    .take(INVITATION_RATE_LIMIT_MAX + 1);
  if (recent.length >= INVITATION_RATE_LIMIT_MAX) {
    throw new Error("INVITATION_RATE_LIMIT: You have reached the limit of 50 invitations in the last hour.");
  }
}

async function expirePendingInvitationsForEmail(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    email: string;
    excludeInvitationId?: Id<"schoolInvitations">;
  },
) {
  const invitations = await ctx.db
    .query("schoolInvitations")
    .withIndex("by_email", (q) => q.eq("email", args.email))
    .take(200);

  const expiredIds: Id<"schoolInvitations">[] = [];
  for (const invitation of invitations) {
    if (invitation.orgId !== args.orgId) continue;
    if (invitation.status !== "pending") continue;
    if (args.excludeInvitationId && invitation._id === args.excludeInvitationId) continue;
    await ctx.db.patch(invitation._id, {
      status: "expired",
    });
    expiredIds.push(invitation._id);
  }

  return expiredIds;
}

/**
 * Dashboard stats for an admin's school
 */
export const getSchoolDashboard = query({
  args: { actorClerkId: v.string(), orgId: v.optional(v.id("orgs")) },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId, args.orgId);
    const today = dayKey();

    const [members, analyticsToday, invitations, org, capacity] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect(),
      ctx.db
        .query("studentAnalytics")
        .withIndex("by_org_day", (q) => q.eq("orgId", actor.orgId))
        .collect()
        .then((rows) => rows.filter((row) => row.day === today)),
      ctx.db
        .query("schoolInvitations")
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .collect()
        .then((invs) => invs.filter((i) => i.status === "pending" && i.expiresAt > Date.now())),
      ctx.db.get(actor.orgId),
      getCapacitySnapshot(ctx, actor.orgId),
    ]);

    const countableMembers = members.filter((member) => isSeatCountedMember(member.email));
    const studentCount = countableMembers.filter((m) => m.role === "student").length;
    const teacherCount = countableMembers.filter((m) => m.role === "teacher").length;
    const adminCount = countableMembers.filter((m) => m.role === "admin").length;

    return {
      memberCount: countableMembers.length,
      studentCount,
      teacherCount,
      adminCount,
      messagesToday: analyticsToday.reduce((sum, row) => sum + row.messagesCount, 0),
      pendingInvitations: invitations.length,
      capacity,
      orgName: org?.name,
      orgSlug: org?.slug,
      isActive: org?.isActive ?? true,
    };
  },
});

/**
 * Paginated member list with optional search and role filter
 */
export const listMembers = query({
  args: {
    actorClerkId: v.string(),
    orgId: v.optional(v.id("orgs")),
    role: v.optional(vRole),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId, args.orgId);

    const limit = Math.min(100, Math.max(1, args.limit ?? 50));

    let members = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();

    if (args.role) {
      members = members.filter((m) => m.role === args.role);
    }

    if (args.search?.trim()) {
      const q = args.search.trim().toLowerCase();
      members = members.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q),
      );
    }

    members.sort((a, b) => b.createdAt - a.createdAt);

    // Simple cursor-based pagination using createdAt
    let startIndex = 0;
    if (args.cursor) {
      const cursorIdx = members.findIndex((m) => m._id === args.cursor);
      if (cursorIdx !== -1) startIndex = cursorIdx + 1;
    }

    const page = members.slice(startIndex, startIndex + limit);
    const nextCursor = page.length === limit ? page[page.length - 1]?._id : undefined;

    return {
      members: page,
      nextCursor,
      totalCount: members.length,
    };
  },
});

/**
 * List pending invitations for the school
 */
export const listInvitations = query({
  args: {
    actorClerkId: v.string(),
    orgId: v.optional(v.id("orgs")),
    status: v.optional(
      v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("revoked")),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId, args.orgId);

    const now = Date.now();
    let invitations = await ctx.db
      .query("schoolInvitations")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();

    // Auto-expire past-due pending invitations
    invitations = invitations.map((inv) => {
      if (inv.status === "pending" && inv.expiresAt < now) {
        return { ...inv, status: "expired" as const };
      }
      return inv;
    });

    if (args.status) {
      invitations = invitations.filter((i) => i.status === args.status);
    }

    return invitations.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * Analytics: messages per day, mode usage, quiz scores (last 30 days)
 */
export const getSchoolAnalytics = query({
  args: {
    actorClerkId: v.string(),
    orgId: v.optional(v.id("orgs")),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId, args.orgId);

    const daysBack = Math.min(Math.max(args.days ?? 30, 1), 90);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffDay = cutoff.toISOString().slice(0, 10);

    const analyticsRows = await ctx.db
      .query("studentAnalytics")
      .withIndex("by_org_day", (q) => q.eq("orgId", actor.orgId))
      .collect();

    const filtered = analyticsRows.filter((r) => r.day >= cutoffDay);

    // Messages per day
    const messagesPerDay = new Map<string, number>();
    const modeUsage = new Map<string, number>();
    const allQuizScores: number[] = [];

    for (const row of filtered) {
      messagesPerDay.set(row.day, (messagesPerDay.get(row.day) ?? 0) + row.messagesCount);
      for (const mode of row.modesUsed) {
        modeUsage.set(mode, (modeUsage.get(mode) ?? 0) + 1);
      }
      allQuizScores.push(...(row.quizScores ?? []));
    }

    const messagesPerDayArray = Array.from(messagesPerDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, count]) => ({ day, count }));

    const modeUsageArray = Array.from(modeUsage.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([mode, count]) => ({ mode, count }));

    const avgQuizScore =
      allQuizScores.length > 0
        ? allQuizScores.reduce((s, n) => s + n, 0) / allQuizScores.length
        : undefined;

    return {
      messagesPerDay: messagesPerDayArray,
      modeUsage: modeUsageArray,
      avgQuizScore,
      totalQuizAttempts: allQuizScores.length,
    };
  },
});

/**
 * Invite a member by email - creates a schoolInvitation with 7-day expiry
 */
export const inviteMember = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.optional(v.id("orgs")),
    email: v.string(),
    role: vRole,
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId, args.orgId);
    if (args.role === "admin") {
      throw new Error("Only super admin can invite admins");
    }

    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Invalid email address");

    // Check if already a member
    const existingMember = await findExistingMemberByEmail(ctx, actor.orgId, email);
    if (existingMember) {
      throw new Error("User is already a member of this school");
    }

    await enforceInvitationRateLimit(ctx, actor._id);

    const existingPending = await ctx.db
      .query("schoolInvitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect()
      .then((rows) => rows.find((row) => row.orgId === actor.orgId && row.status === "pending" && row.expiresAt > Date.now()));
    if (existingPending) {
      return { invitationId: existingPending._id, token: existingPending.token, alreadyPending: true };
    }

    await expirePendingInvitationsForEmail(ctx, {
      orgId: actor.orgId,
      email,
    });

    await requireCapacity(ctx, actor.orgId);

    const now = Date.now();
    const invitationId = await ctx.db.insert("schoolInvitations", {
      orgId: actor.orgId,
      email,
      role: args.role,
      invitedBy: actor._id,
      status: "pending",
      token: randomToken(),
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });

    const invitation = await ctx.db.get(invitationId);

    return {
      invitationId,
      token: invitation?.token,
    };
  },
});

/**
 * Cancel a pending invitation
 */
export const cancelInvitation = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.optional(v.id("orgs")),
    invitationId: v.id("schoolInvitations"),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId, args.orgId);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new Error("Invitation not found");
    if (invitation.orgId !== actor.orgId) throw new Error("Not authorized");
    if (invitation.status === "revoked") return { ok: true, alreadyRevoked: true };
    if (invitation.status !== "pending") throw new Error("Only a pending invitation can be revoked.");

    const now = Date.now();
    await ctx.db.patch(args.invitationId, { status: "revoked", revokedAt: now, updatedAt: now });
    return { ok: true };
  },
});

/**
 * Resend invitation - resets token and extends expiry by 7 days
 */
export const resendInvitation = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.optional(v.id("orgs")),
    invitationId: v.id("schoolInvitations"),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId, args.orgId);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new Error("Invitation not found");
    if (invitation.orgId !== actor.orgId) throw new Error("Not authorized");
    if (invitation.status === "accepted") {
      throw new Error("Accepted invitations cannot be resent");
    }
    const wasActive = invitation.status === "pending" && invitation.expiresAt > Date.now();

    const email = invitation.email.trim().toLowerCase();
    const expiredIds = await expirePendingInvitationsForEmail(ctx, {
      orgId: actor.orgId,
      email,
      excludeInvitationId: invitation._id,
    });

    void expiredIds;
    await requireCapacity(ctx, actor.orgId, { excludeInvitationId: invitation._id });

    const now = Date.now();
    await ctx.db.patch(args.invitationId, {
      token: randomToken(),
      status: "pending",
      createdAt: now,
      updatedAt: now,
      revokedAt: undefined,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });

    const refreshed = await ctx.db.get(args.invitationId);
    return {
      ok: true,
      token: refreshed?.token,
      email,
      role: invitation.role,
      reactivated: !wasActive,
    };
  },
});

/**
 * Remove a member from the org
 */
export const removeMember = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.optional(v.id("orgs")),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId, args.orgId);

    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    if (target.orgId !== actor.orgId) throw new Error("User is not in your school");
    if (target._id === actor._id) throw new Error("Cannot remove yourself");
    if (target.role === "admin") throw new Error("Only super admin can remove admins");

    const purgeSummary = await purgeUserData(ctx, {
      actor,
      target,
      replacementOwner: actor,
    });
    await ctx.runMutation(internal.auditLog.logAction, {
      actorUserId: actor._id as Id<"users">,
      action: "school_admin.remove_member",
      targetType: "user",
      targetId: args.userId,
      details: JSON.stringify({
        orgId: actor.orgId,
        role: target.role,
        email: target.email,
        purgeSummary,
      }),
    });
    return { ok: true };
  },
});

/**
 * Update a member's role
 */
export const updateMemberRole = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.optional(v.id("orgs")),
    userId: v.id("users"),
    role: vRole,
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId, args.orgId);
    if (args.role === "admin") {
      throw new Error("Only super admin can assign admin role");
    }

    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    if (target.orgId !== actor.orgId) throw new Error("User is not in your school");
    if (target.role === "admin") throw new Error("Only super admin can change admin roles");

    await ctx.db.patch(args.userId, {
      role: args.role,
      updatedAt: Date.now(),
    });
    await updateUserInPlatformStats(
      ctx,
      { _id: target._id, role: target.role },
      { _id: target._id, role: args.role },
    );

    return { ok: true };
  },
});


/**
 * Look up a school invitation by token (public - no auth required)
 */
export const getInvitationByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invitation = await ctx.db
      .query("schoolInvitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!invitation) return null;

    const org = await ctx.db.get(invitation.orgId);
    const capacity = await getCapacitySnapshot(ctx, invitation.orgId, { excludeInvitationId: invitation._id });

    let orgLogoUrl: string | undefined;
    if (org?.logoStorageId) {
      orgLogoUrl = (await ctx.storage.getUrl(org.logoStorageId).catch(() => null)) ?? undefined;
    }

    return {
      ...invitation,
      orgName: org?.name,
      orgWelcomeMessage: org?.welcomeMessage,
      orgLogoUrl,
      capacityFull: capacity.full,
    };
  },
});

/**
 * Update org branding fields
 */
export const updateBranding = mutation({
  args: {
    actorClerkId: v.string(),
    primaryColor: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    welcomeMessage: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(actor.orgId);
    if (!org) throw new Error("Org not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.primaryColor !== undefined) patch.primaryColor = args.primaryColor;
    if (args.accentColor !== undefined) patch.accentColor = args.accentColor;
    if (args.welcomeMessage !== undefined) patch.welcomeMessage = args.welcomeMessage;
    if (args.logoStorageId !== undefined) {
      // Delete old logo if replacing
      if (org.logoStorageId && org.logoStorageId !== args.logoStorageId) {
        await ctx.storage.delete(org.logoStorageId).catch(() => {});
      }
      patch.logoStorageId = args.logoStorageId;
    }

    await ctx.db.patch(actor.orgId, patch);
    return { ok: true };
  },
});
