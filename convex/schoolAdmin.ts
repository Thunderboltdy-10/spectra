import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { dayKey, getUserByClerkId } from "./helpers";
import { vRole } from "./shared";

function randomToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let token = "";
  for (let i = 0; i < 48; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

async function requireAdmin(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  if (actor.role !== "admin") throw new Error("Admin access required");
  return actor;
}

async function getStudentSeatSnapshot(ctx: Parameters<typeof getUserByClerkId>[0], orgId: Id<"orgs">) {
  const [org, students, pendingStudentInvitations] = await Promise.all([
    ctx.db.get(orgId),
    ctx.db
      .query("users")
      .withIndex("by_org_role", (q) => q.eq("orgId", orgId).eq("role", "student"))
      .collect(),
    ctx.db
      .query("schoolInvitations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()
      .then((invitations) =>
        invitations.filter(
          (invitation) =>
            invitation.role === "student"
            && invitation.status === "pending"
            && invitation.expiresAt > Date.now(),
        ),
      ),
  ]);

  const maxStudents =
    typeof org?.maxStudents === "number" && Number.isFinite(org.maxStudents) && org.maxStudents > 0
      ? Math.floor(org.maxStudents)
      : null;

  return {
    maxStudents,
    currentStudents: students.length,
    pendingStudentInvitations: pendingStudentInvitations.length,
  };
}

/**
 * Dashboard stats for an admin's school
 */
export const getSchoolDashboard = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId);
    const today = dayKey();

    const [members, analyticsToday, invitations, org] = await Promise.all([
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
    ]);

    const studentCount = members.filter((m) => m.role === "student").length;
    const teacherCount = members.filter((m) => m.role === "teacher").length;
    const adminCount = members.filter((m) => m.role === "admin").length;

    return {
      memberCount: members.length,
      studentCount,
      teacherCount,
      adminCount,
      messagesToday: analyticsToday.reduce((sum, row) => sum + row.messagesCount, 0),
      pendingInvitations: invitations.length,
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
    role: v.optional(vRole),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId);

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
    status: v.optional(
      v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired")),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId);

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
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId);

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
    email: v.string(),
    role: vRole,
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId);
    if (args.role === "admin") {
      throw new Error("Only super admin can invite admins");
    }

    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Invalid email address");

    // Check if already a member
    const members = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();
    if (members.some((m) => m.email.toLowerCase() === email)) {
      throw new Error("User is already a member of this school");
    }

    if (args.role === "student") {
      const seatSnapshot = await getStudentSeatSnapshot(ctx, actor.orgId);
      if (
        typeof seatSnapshot.maxStudents === "number"
        && seatSnapshot.currentStudents + seatSnapshot.pendingStudentInvitations >= seatSnapshot.maxStudents
      ) {
        throw new Error("SEAT_LIMIT_REACHED: Student seat limit reached for this school.");
      }
    }

    // Cancel any existing pending invitation for this email
    const existing = await ctx.db
      .query("schoolInvitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    for (const inv of existing) {
      if (inv.orgId === actor.orgId && inv.status === "pending") {
        await ctx.db.patch(inv._id, { status: "expired" });
      }
    }

    const now = Date.now();
    const invitationId = await ctx.db.insert("schoolInvitations", {
      orgId: actor.orgId,
      email,
      role: args.role,
      invitedBy: actor._id,
      status: "pending",
      token: randomToken(),
      createdAt: now,
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
    invitationId: v.id("schoolInvitations"),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new Error("Invitation not found");
    if (invitation.orgId !== actor.orgId) throw new Error("Not authorized");
    if (invitation.status !== "pending") throw new Error("Invitation is not pending");

    await ctx.db.patch(args.invitationId, { status: "expired" });
    return { ok: true };
  },
});

/**
 * Resend invitation - resets token and extends expiry by 7 days
 */
export const resendInvitation = mutation({
  args: {
    actorClerkId: v.string(),
    invitationId: v.id("schoolInvitations"),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new Error("Invitation not found");
    if (invitation.orgId !== actor.orgId) throw new Error("Not authorized");

    const now = Date.now();
    await ctx.db.patch(args.invitationId, {
      token: randomToken(),
      status: "pending",
      createdAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });

    return { ok: true };
  },
});

/**
 * Remove a member from the org
 */
export const removeMember = mutation({
  args: {
    actorClerkId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId);

    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    if (target.orgId !== actor.orgId) throw new Error("User is not in your school");
    if (target._id === actor._id) throw new Error("Cannot remove yourself");
    if (target.role === "admin") throw new Error("Only super admin can remove admins");

    await ctx.db.delete(args.userId);
    return { ok: true };
  },
});

/**
 * Update a member's role
 */
export const updateMemberRole = mutation({
  args: {
    actorClerkId: v.string(),
    userId: v.id("users"),
    role: vRole,
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx, args.actorClerkId);
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

    let orgLogoUrl: string | undefined;
    if (org?.logoStorageId) {
      orgLogoUrl = (await ctx.storage.getUrl(org.logoStorageId).catch(() => null)) ?? undefined;
    }

    return {
      ...invitation,
      orgName: org?.name,
      orgWelcomeMessage: org?.welcomeMessage,
      orgLogoUrl,
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

export const acceptInvitation = mutation({
  args: {
    invitationId: v.id("schoolInvitations"),
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    role: vRole,
    orgId: v.id("orgs"),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new Error("Invitation not found");
    if (invitation.status !== "pending") throw new Error("Invitation is not pending");
    if (invitation.expiresAt <= Date.now()) {
      await ctx.db.patch(args.invitationId, { status: "expired" });
      throw new Error("Invitation has expired");
    }
    if (invitation.email.toLowerCase() !== args.email.toLowerCase()) {
      throw new Error("Email mismatch");
    }

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (args.role === "student") {
      const seatSnapshot = await getStudentSeatSnapshot(ctx, args.orgId);
      const existingStudentInOrg =
        existingUser && existingUser.orgId === args.orgId && existingUser.role === "student";
      if (
        typeof seatSnapshot.maxStudents === "number"
        && seatSnapshot.currentStudents - (existingStudentInOrg ? 1 : 0) >= seatSnapshot.maxStudents
      ) {
        throw new Error("SEAT_LIMIT_REACHED: Student seat limit reached for this school.");
      }
    }

    const now = Date.now();

    if (existingUser) {
      await ctx.db.patch(existingUser._id, {
        orgId: args.orgId,
        role: args.role,
        email: args.email,
        name: args.name,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("users", {
        clerkId: args.clerkId,
        email: args.email,
        name: args.name,
        role: args.role,
        orgId: args.orgId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.invitationId, {
      status: "accepted",
    });

    return { ok: true };
  },
});
