import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import { vRole } from "./shared";
import type { Id } from "./_generated/dataModel";

const SUPER_ADMIN_EMAILS = [
  "pablo.martinez.dovale@gmail.com",
];

async function requireSuperAdmin(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  if (!SUPER_ADMIN_EMAILS.includes(actor.email)) {
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

    return {
      totalOrgs: orgs.length,
      totalUsers: users.length,
      totalMessages: messages.length,
    };
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
    await requireSuperAdmin(ctx, args.actorClerkId);

    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Org not found");

    // Try to find existing user by email in this org
    const allUsers = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const existingInOrg = allUsers.find((u) => u.email === args.email);

    if (existingInOrg) {
      await ctx.db.patch(existingInOrg._id, {
        role: "admin",
        updatedAt: Date.now(),
      });
      return { userId: existingInOrg._id, updated: true };
    }

    // Try to find existing user in any org
    const allOrgUsers = await ctx.db.query("users").collect();
    const existingAnywhere = allOrgUsers.find((u) => u.email === args.email);

    if (existingAnywhere) {
      // Move user to this org as admin
      await ctx.db.patch(existingAnywhere._id, {
        orgId: args.orgId,
        role: "admin",
        updatedAt: Date.now(),
      });
      return { userId: existingAnywhere._id, transferred: true };
    }

    // Create a placeholder user record (will be fully populated on first login)
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: `pending-${args.email}-${now}`,
      email: args.email,
      name: args.name ?? args.email,
      role: "admin",
      orgId: args.orgId,
      invitedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { userId, created: true };
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
