import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import { vRole } from "./shared";
import type { Id } from "./_generated/dataModel";

const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS ?? "pablo.martinez.dovale@gmail.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

async function requireSuperAdmin(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  if (!SUPER_ADMIN_EMAILS.has(actor.email.toLowerCase())) {
    throw new Error("Super admin access required");
  }
  return actor;
}

/**
 * List all orgs with member counts
 */
export const listAllOrgs = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const orgs = await ctx.db.query("orgs").collect();

    const orgsWithCounts = await Promise.all(
      orgs.map(async (org) => {
        const members = await ctx.db
          .query("users")
          .withIndex("by_org", (q) => q.eq("orgId", org._id))
          .collect();
        return {
          ...org,
          memberCount: members.length,
        };
      }),
    );

    return orgsWithCounts.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * Get full org data with members list
 */
export const getOrgDetail = query({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Org not found");

    const members = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    const logoUrl =
      org.logoStorageId
        ? await ctx.storage.getUrl(org.logoStorageId).catch(() => null)
        : null;

    return {
      org: { ...org, logoUrl: logoUrl ?? undefined },
      members,
    };
  },
});

/**
 * Get global stats: total orgs, total users, total messages
 */
export const getGlobalStats = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const [orgs, users, messages] = await Promise.all([
      ctx.db.query("orgs").collect(),
      ctx.db.query("users").collect(),
      ctx.db.query("messages").collect(),
    ]);
    const totalAdmins = users.filter((user) => user.role === "admin").length;

    return {
      totalOrgs: orgs.length,
      totalUsers: users.length,
      totalMessages: messages.length,
      totalAdmins,
    };
  },
});

/**
 * List all admin users across schools.
 */
export const listAllAdmins = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);
    const [admins, orgs] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("orgs").collect(),
    ]);
    const orgById = new Map(orgs.map((org) => [org._id, org]));
    return admins
      .filter((user) => user.role === "admin")
      .map((admin) => ({
        ...admin,
        orgName: orgById.get(admin.orgId)?.name ?? "Unknown",
        orgSlug: orgById.get(admin.orgId)?.slug ?? "unknown",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Create a new school org
 */
export const createOrg = mutation({
  args: {
    actorClerkId: v.string(),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    schoolType: v.optional(v.string()),
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    maxStudents: v.optional(v.number()),
    tokenBudgetDaily: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx, args.actorClerkId);

    const existing = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing) throw new Error(`Org with slug "${args.slug}" already exists`);

    const now = Date.now();
    const orgId = await ctx.db.insert("orgs", {
      name: args.name,
      slug: args.slug,
      description: args.description,
      schoolType: args.schoolType,
      country: args.country,
      timezone: args.timezone,
      maxStudents: args.maxStudents,
      tokenBudgetDaily: args.tokenBudgetDaily ?? 500000,
      verifyMarkerPassEnabled: false,
      isActive: true,
      createdBy: actor.email,
      createdAt: now,
      updatedAt: now,
    });

    return { orgId };
  },
});

/**
 * Update school settings
 */
export const updateOrg = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    schoolType: v.optional(v.string()),
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    maxStudents: v.optional(v.number()),
    tokenBudgetDaily: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    allowPaidModels: v.optional(v.boolean()),
    soulEnabled: v.optional(v.boolean()),
    adaptiveQuizEnabled: v.optional(v.boolean()),
    spacedRepetitionEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Org not found");

    const { actorClerkId: _clerkId, orgId: _orgId, ...updates } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        patch[key] = value;
      }
    }

    await ctx.db.patch(args.orgId, patch);
    return { ok: true };
  },
});

/**
 * Deactivate an org (sets isActive to false)
 */
export const deactivateOrg = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Org not found");

    await ctx.db.patch(args.orgId, {
      isActive: false,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

/**
 * Find or create a user and assign them as admin of a given org
 */
export const assignOrgAdmin = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Org not found");
    const normalizedEmail = args.email.trim().toLowerCase();

    // Try to find existing user by email in this org
    const allUsers = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const existingInOrg = allUsers.find((u) => u.email.toLowerCase() === normalizedEmail);

    if (existingInOrg) {
      await ctx.db.patch(existingInOrg._id, {
        role: "admin",
        updatedAt: Date.now(),
      });
      return { userId: existingInOrg._id, updated: true };
    }

    // Try to find existing user in any org
    const allOrgUsers = await ctx.db.query("users").collect();
    const existingAnywhere = allOrgUsers.find((u) => u.email.toLowerCase() === normalizedEmail);

    if (existingAnywhere) {
      await ctx.db.patch(existingAnywhere._id, {
        orgId: args.orgId,
        role: "admin",
        updatedAt: Date.now(),
      });
      return { userId: existingAnywhere._id, transferred: true };
    }

    const now = Date.now();
    const existingInvitation = await ctx.db
      .query("schoolInvitations")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .collect();
    
    const pendingForOrg = existingInvitation.find(
      (inv) => inv.orgId === args.orgId && inv.status === "pending" && inv.expiresAt > now
    );
    
    if (pendingForOrg) {
      await ctx.db.patch(pendingForOrg._id, {
        role: "admin",
        expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      });
      return { invitationId: pendingForOrg._id, invitationUpdated: true };
    }

    for (const inv of existingInvitation) {
      if (inv.orgId === args.orgId && inv.status === "pending") {
        await ctx.db.patch(inv._id, { status: "expired" });
      }
    }

    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let token = "";
    for (let i = 0; i < 48; i++) {
      token += chars[Math.floor(Math.random() * chars.length)];
    }

    const invitationId = await ctx.db.insert("schoolInvitations", {
      orgId: args.orgId,
      email: normalizedEmail,
      role: "admin",
      invitedBy: actor._id as Id<"users">,
      status: "pending",
      token,
      createdAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });

    return { invitationId, invitationCreated: true };
  },
});

/**
 * Super admin can update any member role within a school.
 */
export const updateOrgMemberRole = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
    userId: v.id("users"),
    role: vRole,
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    if (user.orgId !== args.orgId) throw new Error("User is not in this school");

    if (user.role === "admin" && args.role !== "admin") {
      const admins = await ctx.db
        .query("users")
        .withIndex("by_org_role", (q) => q.eq("orgId", args.orgId).eq("role", "admin"))
        .collect();
      if (admins.length <= 1) {
        throw new Error("School must keep at least one admin");
      }
    }

    await ctx.db.patch(args.userId, {
      role: args.role,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Super admin can remove members from a school.
 */
export const removeOrgMember = mutation({
  args: {
    actorClerkId: v.string(),
    orgId: v.id("orgs"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    if (user.orgId !== args.orgId) throw new Error("User is not in this school");

    if (user.role === "admin") {
      const admins = await ctx.db
        .query("users")
        .withIndex("by_org_role", (q) => q.eq("orgId", args.orgId).eq("role", "admin"))
        .collect();
      if (admins.length <= 1) {
        throw new Error("School must keep at least one admin");
      }
    }

    await ctx.db.delete(args.userId);
    return { ok: true };
  },
});

/**
 * Move a user from one org to another
 */
export const transferUser = mutation({
  args: {
    actorClerkId: v.string(),
    userId: v.id("users"),
    targetOrgId: v.id("orgs"),
    role: v.optional(vRole),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.actorClerkId);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    const targetOrg = await ctx.db.get(args.targetOrgId);
    if (!targetOrg) throw new Error("Target org not found");

    await ctx.db.patch(args.userId, {
      orgId: args.targetOrgId,
      role: args.role ?? user.role,
      updatedAt: Date.now(),
    });

    return { ok: true, fromOrgId: user.orgId, toOrgId: args.targetOrgId };
  },
});
