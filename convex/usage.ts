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

function monthRangeFromKey(key: string) {
  const [yearRaw, monthRaw] = key.split("-");
  const year = Number.parseInt(yearRaw ?? "", 10);
  const month = Number.parseInt(monthRaw ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return {
      startDay: `${key}-01`,
      endDayExclusive: `${key}-32`,
    };
  }
  const start = new Date(Date.UTC(year, month - 1, 1));
  const next = new Date(Date.UTC(year, month, 1));
  return {
    startDay: start.toISOString().slice(0, 10),
    endDayExclusive: next.toISOString().slice(0, 10),
  };
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
      const directModelRow = await ctx.db
        .query("modelCatalog")
        .withIndex("by_org_model", (q) => q.eq("orgId", actor.orgId).eq("modelId", args.model))
        .unique();
      if (typeof inPrice !== "number") inPrice = directModelRow?.inputCostPerM;
      if (typeof outPrice !== "number") outPrice = directModelRow?.outputCostPerM;

      if (typeof inPrice !== "number" || typeof outPrice !== "number") {
        const normalized = args.model.trim().toLowerCase().replace(/:free$/i, "");
        const modelRows = await ctx.db
          .query("modelCatalog")
          .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
          .collect();
        const fuzzyMatch = modelRows.find((row) => {
          const candidate = row.modelId.trim().toLowerCase().replace(/:free$/i, "");
          return (
            candidate === normalized
            || candidate.endsWith(normalized)
            || normalized.endsWith(candidate)
          );
        });
        if (typeof inPrice !== "number") inPrice = fuzzyMatch?.inputCostPerM;
        if (typeof outPrice !== "number") outPrice = fuzzyMatch?.outputCostPerM;
      }
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

    const { startDay, endDayExclusive } = monthRangeFromKey(key);
    const usageRows = await ctx.db
      .query("usageEvents")
      .withIndex("by_user_day", (q) =>
        q
          .eq("userId", actor._id)
          .gte("day", startDay)
          .lt("day", endDayExclusive),
      )
      .collect();
    const monthlyUsage = usageRows.filter((row) => dayBelongsToMonth(row.day, key));
    const monthlyTokens = monthlyUsage.reduce((sum, row) => sum + Math.max(0, row.totalTokens ?? 0), 0);
    const monthlyEvents = monthlyUsage.length;
    const monthlyCostCentsFromEvents = Number(
      monthlyUsage
        .reduce((sum, row) => sum + Math.max(0, row.costCents ?? 0), 0)
        .toFixed(6),
    );
    const totalCostCents = Math.max(storedTotalCostCents, monthlyCostCentsFromEvents);
    const UNPRICED_CENTS_PER_M_IN = 100;
    const UNPRICED_CENTS_PER_M_OUT = 300;
    const monthlyUnpricedEvents = monthlyUsage.reduce(
      (sum, row) => sum + (Math.max(0, row.totalTokens ?? 0) > 0 && Math.max(0, row.costCents ?? 0) <= 0 ? 1 : 0),
      0,
    );
    const unpricedEstimateCents = monthlyUsage
      .filter((row) => Math.max(0, row.costCents ?? 0) <= 0 && Math.max(0, row.totalTokens ?? 0) > 0)
      .reduce((sum, row) => {
        const totalTokens = Math.max(0, row.totalTokens ?? 0);
        const inputTokens = Math.max(0, row.inputTokens ?? Math.round(totalTokens * 0.4));
        const outputTokens = Math.max(0, row.outputTokens ?? Math.max(0, totalTokens - inputTokens));
        return sum
          + ((inputTokens / 1_000_000) * UNPRICED_CENTS_PER_M_IN)
          + ((outputTokens / 1_000_000) * UNPRICED_CENTS_PER_M_OUT);
      }, 0);
    const effectiveCostCents = totalCostCents + unpricedEstimateCents;
    const totalSpentEur = totalCostCents / 100;
    const monthlyTokenBudget = Math.max(1, org.tokenBudgetDaily * daysInMonthFromKey(key));
    const tokenUsagePercent = (monthlyTokens / monthlyTokenBudget) * 100;
    const budgetUsagePercent = hardLimitCents > 0 ? (effectiveCostCents / hardLimitCents) * 100 : 0;
    const activityUsagePercent =
      budgetUsagePercent > 0.05
        ? budgetUsagePercent
        : tokenUsagePercent > 0.05
          ? tokenUsagePercent
          : monthlyEvents > 0
            ? Math.min(100, monthlyEvents * 0.35)
            : 0;

    const tier =
      effectiveCostCents >= hardLimitCents
        ? "free_only"
        : effectiveCostCents >= cheapOnlyLimitCents
          ? "cheap_only"
          : effectiveCostCents >= softLimitCents
            ? "expensive_blocked"
            : "normal";

    return {
      totalSpentEur,
      totalCostCents,
      tier,
      softLimitReached: effectiveCostCents >= softLimitCents,
      hardLimitReached: effectiveCostCents >= hardLimitCents,
      softLimitCents,
      cheapOnlyLimitCents,
      hardLimitCents,
      budgetUsagePercent,
      activityUsagePercent,
      tokenUsagePercent,
      monthlyTokens,
      monthlyEvents,
      monthlyUnpricedEvents,
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
