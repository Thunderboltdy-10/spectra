import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { dayKey, getUserByClerkId } from "./helpers";

function monthKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 7);
}

function dayBelongsToMonth(day: string, key: string) {
  return day.startsWith(`${key}-`);
}

function daysInMonthFromKey(key: string) {
  const [yearRaw, monthRaw] = key.split("-");
  const year = Number.parseInt(yearRaw ?? "", 10);
  const month = Number.parseInt(monthRaw ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return 30;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
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

    let inPrice = args.inputCostPerM;
    let outPrice = args.outputCostPerM;
    if (typeof inPrice !== "number" || typeof outPrice !== "number") {
      const modelRow = await ctx.db
        .query("modelCatalog")
        .withIndex("by_org_model", (q) => q.eq("orgId", actor.orgId).eq("modelId", args.model))
        .unique();
      if (typeof inPrice !== "number") inPrice = modelRow?.inputCostPerM;
      if (typeof outPrice !== "number") outPrice = modelRow?.outputCostPerM;
    }

    const hasKnownPricing =
      (typeof inPrice === "number" && Number.isFinite(inPrice)) ||
      (typeof outPrice === "number" && Number.isFinite(outPrice));
    const inputPricePerM = typeof inPrice === "number" && Number.isFinite(inPrice) ? inPrice : 0;
    const outputPricePerM = typeof outPrice === "number" && Number.isFinite(outPrice) ? outPrice : 0;
    const rawCostCents =
      (
        ((args.inputTokens / 1_000_000) * inputPricePerM) +
        ((args.outputTokens / 1_000_000) * outputPricePerM)
      ) * 100;
    const costCents = Math.max(0, Number(rawCostCents.toFixed(6)));

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
      pricingNote: hasKnownPricing ? undefined : "Pricing unknown at record time; cost defaulted to zero.",
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

    const storedTotalCostCents = Math.max(0, month?.totalCostCents ?? 0);

    const org = await ctx.db.get(actor.orgId);
    if (!org) {
      throw new Error("Org not found");
    }

    const defaultHardLimitCents = 900;

    const configuredBudget = org.monthlyBudgetCentsPerUser;
    const configuredMargin = org.budgetMarginPercent;

    const hardLimitCents =
      typeof configuredBudget === "number" && Number.isFinite(configuredBudget) && configuredBudget > 0
        ? Math.round(configuredBudget)
        : defaultHardLimitCents;

    const marginPercent = Math.min(
      40,
      Math.max(5, typeof configuredMargin === "number" && Number.isFinite(configuredMargin) ? configuredMargin : 20),
    );
    const softLimitCents = Math.max(0, Math.floor(hardLimitCents * (1 - marginPercent / 100)));
    const cheapOnlyLimitCents = Math.max(0, Math.floor(hardLimitCents * 0.9));

    const usageRows = await ctx.db
      .query("usageEvents")
      .withIndex("by_user_day", (q) => q.eq("userId", actor._id))
      .collect();
    const modelRows = await ctx.db
      .query("modelCatalog")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();
    const modelPricingById = new Map(
      modelRows.map((row) => [
        row.modelId,
        {
          inputCostPerM: row.inputCostPerM,
          outputCostPerM: row.outputCostPerM,
          isFree: row.isFree,
        },
      ]),
    );
    const monthlyUsage = usageRows.filter((row) => dayBelongsToMonth(row.day, key));
    const monthlyTokens = monthlyUsage.reduce((sum, row) => sum + Math.max(0, row.totalTokens ?? 0), 0);
    const monthlyEvents = monthlyUsage.length;
    const monthlyCostCentsFromEvents = Number(
      monthlyUsage
        .reduce((sum, row) => {
          const recorded = Math.max(0, row.costCents ?? 0);
          if (recorded > 0) return sum + recorded;

          const pricing = modelPricingById.get(row.model);
          if (!pricing) return sum;
          if (pricing.isFree) return sum;

          const inPrice = typeof pricing.inputCostPerM === "number" ? pricing.inputCostPerM : 0;
          const outPrice = typeof pricing.outputCostPerM === "number" ? pricing.outputCostPerM : 0;
          if (inPrice <= 0 && outPrice <= 0) return sum;

          const estimated =
            (
              ((Math.max(0, row.inputTokens ?? 0) / 1_000_000) * inPrice) +
              ((Math.max(0, row.outputTokens ?? 0) / 1_000_000) * outPrice)
            ) * 100;
          return sum + Math.max(0, estimated);
        }, 0)
        .toFixed(6),
    );
    const totalCostCents = Math.max(storedTotalCostCents, monthlyCostCentsFromEvents);
    const totalSpentEur = totalCostCents / 100;
    const monthlyTokenBudget = Math.max(1, org.tokenBudgetDaily * daysInMonthFromKey(key));
    const tokenUsagePercent = (monthlyTokens / monthlyTokenBudget) * 100;
    const budgetUsagePercent = hardLimitCents > 0 ? (totalCostCents / hardLimitCents) * 100 : 0;
    const activityUsagePercent =
      budgetUsagePercent > 0.05
        ? budgetUsagePercent
        : tokenUsagePercent > 0.05
          ? tokenUsagePercent
          : monthlyEvents > 0
            ? Math.min(100, monthlyEvents * 0.35)
            : 0;

    const tier =
      totalCostCents >= hardLimitCents
        ? "free_only"
        : totalCostCents >= cheapOnlyLimitCents
          ? "cheap_only"
          : totalCostCents >= softLimitCents
            ? "expensive_blocked"
            : "normal";

    return {
      totalSpentEur,
      totalCostCents,
      tier,
      softLimitReached: totalCostCents >= softLimitCents,
      hardLimitReached: totalCostCents >= hardLimitCents,
      softLimitCents,
      cheapOnlyLimitCents,
      hardLimitCents,
      budgetUsagePercent,
      activityUsagePercent,
      tokenUsagePercent,
      monthlyTokens,
      monthlyEvents,
      monthlyTokenBudget,
      monthlyCostCentsFromEvents,
      marginPercent,
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
