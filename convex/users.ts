import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getOrCreateDefaultOrg, getUserByClerkId } from "./helpers";
import { api } from "./_generated/api";

function normalizeRole(inputRole?: string): "student" | "teacher" | "admin" {
  if (inputRole === "teacher" || inputRole === "admin") {
    return inputRole;
  }
  return "student";
}

export const ensureUser = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    requestedRole: v.optional(v.string()),
    bootstrapAdmin: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await getUserByClerkId(ctx, args.clerkId);
    const orgId = existing?.orgId ?? (await getOrCreateDefaultOrg(ctx));
    const now = Date.now();

    let role = normalizeRole(args.requestedRole);
    if (args.bootstrapAdmin) {
      role = "admin";
    }

    if (existing) {
      const nextRole = existing.role === "admin" ? "admin" : role;
      await ctx.db.patch(existing._id, {
        email: args.email,
        name: args.name,
        role: nextRole,
        updatedAt: now,
      });

      await ctx.runMutation(api.seed.seedDemoPack, {
        orgId,
        ownerUserId: existing._id,
      });
      await ctx.runMutation(api.seed.seedDefaultAgents, {
        orgId,
        creatorUserId: existing._id,
      });
      await ctx.runMutation(api.seed.migrateLegacyDemoCopy, { orgId });

      return { ...existing, role: nextRole, orgId };
    }

    const userId = await ctx.db.insert("users", {
      clerkId: args.clerkId,
      email: args.email,
      name: args.name,
      role,
      orgId,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.runMutation(api.seed.seedDemoPack, {
      orgId,
      ownerUserId: userId,
    });
    await ctx.runMutation(api.seed.seedDefaultAgents, {
      orgId,
      creatorUserId: userId,
    });
    await ctx.runMutation(api.seed.migrateLegacyDemoCopy, { orgId });

    return {
      _id: userId,
      clerkId: args.clerkId,
      email: args.email,
      name: args.name,
      role,
      orgId,
    };
  },
});

export const me = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    return getUserByClerkId(ctx, args.clerkId);
  },
});

export const syncFromWebhook = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await getUserByClerkId(ctx, args.clerkId);
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email,
        name: args.name,
        updatedAt: now,
      });

      await ctx.runMutation(api.seed.seedDefaultAgents, {
        orgId: existing.orgId,
        creatorUserId: existing._id,
      });

      return { userId: existing._id, updated: true };
    }

    const orgId = await getOrCreateDefaultOrg(ctx);
    const userId = await ctx.db.insert("users", {
      clerkId: args.clerkId,
      email: args.email,
      name: args.name,
      role: "student",
      orgId,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.runMutation(api.seed.seedDemoPack, {
      orgId,
      ownerUserId: userId,
    });
    await ctx.runMutation(api.seed.seedDefaultAgents, {
      orgId,
      creatorUserId: userId,
    });
    await ctx.runMutation(api.seed.migrateLegacyDemoCopy, { orgId });

    return { userId, created: true };
  },
});

export const listUsersInOrg = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || actor.role !== "admin") {
      throw new Error("Only admin can list users");
    }

    return ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();
  },
});

export const updateRole = mutation({
  args: {
    actorClerkId: v.string(),
    targetUserId: v.id("users"),
    role: v.union(v.literal("student"), v.literal("teacher"), v.literal("admin")),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || actor.role !== "admin") {
      throw new Error("Only admin can update roles");
    }

    const target = await ctx.db.get(args.targetUserId);
    if (!target || target.orgId !== actor.orgId) {
      throw new Error("Invalid target user");
    }

    await ctx.db.patch(args.targetUserId, { role: args.role, updatedAt: Date.now() });
    return { ok: true };
  },
});
