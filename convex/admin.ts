import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";

export const getOrgSettings = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const org = await ctx.db.get(actor.orgId);
    return { org, actorRole: actor.role };
  },
});

export const updateOrgSettings = mutation({
  args: {
    actorClerkId: v.string(),
    verifyMarkerPassEnabled: v.optional(v.boolean()),
    tokenBudgetDaily: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || actor.role !== "admin") {
      throw new Error("Only admin can update org settings");
    }

    const org = await ctx.db.get(actor.orgId);
    if (!org) {
      throw new Error("Org not found");
    }

    await ctx.db.patch(actor.orgId, {
      verifyMarkerPassEnabled:
        args.verifyMarkerPassEnabled !== undefined ? args.verifyMarkerPassEnabled : org.verifyMarkerPassEnabled,
      tokenBudgetDaily: args.tokenBudgetDaily ?? org.tokenBudgetDaily,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const usageOverview = query({
  args: {
    actorClerkId: v.string(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || actor.role !== "admin") {
      throw new Error("Only admin can view usage overview");
    }

    const lookback = Math.min(Math.max(args.days ?? 7, 1), 30);
    const rows = await ctx.db
      .query("usageDaily")
      .withIndex("by_org_day", (q) => q.eq("orgId", actor.orgId))
      .collect();

    return rows
      .sort((a, b) => (a.day < b.day ? 1 : -1))
      .slice(0, lookback)
      .reverse();
  },
});
