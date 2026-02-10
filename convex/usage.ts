import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { dayKey, getUserByClerkId } from "./helpers";

function monthKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 7);
}

export const recordUsage = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.optional(v.id("chats")),
    messageId: v.optional(v.id("messages")),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const day = dayKey();
    const totalTokens = Math.max(0, args.inputTokens + args.outputTokens);

    const existingDaily = await ctx.db
      .query("usageDaily")
      .withIndex("by_org_day", (q) => q.eq("orgId", actor.orgId).eq("day", day))
      .unique();

    if (existingDaily) {
      await ctx.db.patch(existingDaily._id, {
        inputTokens: existingDaily.inputTokens + args.inputTokens,
        outputTokens: existingDaily.outputTokens + args.outputTokens,
        totalTokens: existingDaily.totalTokens + totalTokens,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("usageDaily", {
        orgId: actor.orgId,
        day,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        totalTokens,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.insert("usageEvents", {
      orgId: actor.orgId,
      userId: actor._id,
      chatId: args.chatId,
      messageId: args.messageId,
      model: args.model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens,
      day,
      createdAt: Date.now(),
    });

    return { ok: true };
  },
});

export const recordUsageWithCost = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.optional(v.id("chats")),
    messageId: v.optional(v.id("messages")),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    inputCostPerM: v.optional(v.number()),
    outputCostPerM: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const day = dayKey();
    const now = Date.now();
    const totalTokens = Math.max(0, args.inputTokens + args.outputTokens);

    const inPrice = args.inputCostPerM ?? 0;
    const outPrice = args.outputCostPerM ?? 0;
    const costCents = Math.max(
      0,
      Math.round((((args.inputTokens / 1_000_000) * inPrice) + ((args.outputTokens / 1_000_000) * outPrice)) * 100),
    );

    const existingDaily = await ctx.db
      .query("usageDaily")
      .withIndex("by_org_day", (q) => q.eq("orgId", actor.orgId).eq("day", day))
      .unique();

    if (existingDaily) {
      await ctx.db.patch(existingDaily._id, {
        inputTokens: existingDaily.inputTokens + args.inputTokens,
        outputTokens: existingDaily.outputTokens + args.outputTokens,
        totalTokens: existingDaily.totalTokens + totalTokens,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("usageDaily", {
        orgId: actor.orgId,
        day,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        totalTokens,
        updatedAt: now,
      });
    }

    await ctx.db.insert("usageEvents", {
      orgId: actor.orgId,
      userId: actor._id,
      chatId: args.chatId,
      messageId: args.messageId,
      model: args.model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens,
      costCents,
      day,
      createdAt: now,
    });

    const key = monthKey(now);
    const existingMonth = await ctx.db
      .query("userSpending")
      .withIndex("by_user_month", (q) => q.eq("userId", actor._id).eq("monthKey", key))
      .unique();

    if (existingMonth) {
      await ctx.db.patch(existingMonth._id, {
        totalCostCents: Math.max(0, existingMonth.totalCostCents + costCents),
        lastUpdatedAt: now,
      });
    } else {
      await ctx.db.insert("userSpending", {
        userId: actor._id,
        orgId: actor.orgId,
        monthKey: key,
        totalCostCents: costCents,
        lastUpdatedAt: now,
      });
    }

    return { ok: true, costCents };
  },
});

export const checkBudget = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const org = await ctx.db.get(actor.orgId);
    if (!org) {
      throw new Error("Org not found");
    }

    const day = dayKey();
    const existing = await ctx.db
      .query("usageDaily")
      .withIndex("by_org_day", (q) => q.eq("orgId", actor.orgId).eq("day", day))
      .unique();

    const used = existing?.totalTokens ?? 0;
    const remaining = org.tokenBudgetDaily - used;

    return {
      used,
      remaining,
      budget: org.tokenBudgetDaily,
      overBudget: remaining <= 0,
    };
  },
});

export const checkUserBudget = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const key = monthKey();
    const month = await ctx.db
      .query("userSpending")
      .withIndex("by_user_month", (q) => q.eq("userId", actor._id).eq("monthKey", key))
      .unique();

    const totalCostCents = month?.totalCostCents ?? 0;
    const totalSpentEur = totalCostCents / 100;

    const tier =
      totalSpentEur >= 9
        ? "free_only"
        : totalSpentEur >= 7
          ? "cheap_only"
          : "normal";

    return {
      totalSpentEur,
      totalCostCents,
      tier,
      softLimitReached: totalSpentEur >= 7,
      hardLimitReached: totalSpentEur >= 9,
      monthKey: key,
    } as const;
  },
});

export const getUserSpendingHistory = query({
  args: {
    actorClerkId: v.string(),
    months: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const rows = await ctx.db
      .query("userSpending")
      .withIndex("by_user_month", (q) => q.eq("userId", actor._id))
      .collect();

    const limit = Math.min(Math.max(args.months ?? 6, 1), 24);

    return rows
      .sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1))
      .slice(0, limit)
      .map((row) => ({
        monthKey: row.monthKey,
        totalCostCents: row.totalCostCents,
        totalSpentEur: row.totalCostCents / 100,
      }));
  },
});
