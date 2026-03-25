import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { dayKey, getUserByClerkId } from "./helpers";
import { estimateUsageCostCents, summarizeEffectiveUsageCost, type UsagePricing } from "../shared/spending";

function monthKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 7);
}

function normalizeModelId(value: string) {
  return value.trim().toLowerCase().replace(/:free$/i, "");
}

function modelLeaf(value: string) {
  const normalized = normalizeModelId(value);
  const leaf = normalized.split("/").pop();
  return leaf ?? normalized;
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

function buildPricingLookup(
  rows: Array<{ modelId: string; inputCostPerM?: number; outputCostPerM?: number; isFree?: boolean }>,
) {
  const direct = new Map<string, UsagePricing>();
  const byNormalized = new Map<string, UsagePricing>();
  const leafCounts = new Map<string, number>();
  const leafPricing = new Map<string, UsagePricing>();

  for (const row of rows) {
    const rawKey = row.modelId.trim().toLowerCase();
    const normalized = normalizeModelId(row.modelId);
    const leaf = modelLeaf(row.modelId);
    const pricing = {
      inputCostPerM: row.inputCostPerM,
      outputCostPerM: row.outputCostPerM,
      isFree: row.isFree ?? false,
    };

    // Store under raw key (preserves :free suffix) — no collision
    direct.set(rawKey, pricing);

    // For normalized key, prefer the non-free variant (higher cost) to avoid
    // a :free sibling's zero pricing shadowing the paid model's pricing
    const isFreeVariant = rawKey.endsWith(":free");
    if (!byNormalized.has(normalized) || isFreeVariant === false) {
      byNormalized.set(normalized, pricing);
    }

    leafCounts.set(leaf, (leafCounts.get(leaf) ?? 0) + 1);
    if (!leafPricing.has(leaf)) {
      leafPricing.set(leaf, pricing);
    }
  }

  return { direct, byNormalized, leafCounts, leafPricing };
}

function resolveUsagePricing(
  pricingLookup: ReturnType<typeof buildPricingLookup>,
  modelId: string,
) {
  // Try exact raw key first (respects :free suffix)
  const rawKey = modelId.trim().toLowerCase();
  const direct = pricingLookup.direct.get(rawKey);
  if (direct) return direct;

  // Fall back to normalized key (strips :free for lookup)
  const normalized = normalizeModelId(modelId);
  const byNorm = pricingLookup.byNormalized.get(normalized);
  if (byNorm) return byNorm;

  const leaf = modelLeaf(modelId);
  if ((pricingLookup.leafCounts.get(leaf) ?? 0) === 1) {
    return pricingLookup.leafPricing.get(leaf);
  }

  return undefined;
}

function summarizeUsageWithPricing(
  rows: Array<{
    model: string;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    costCents?: number;
  }>,
  pricingLookup: ReturnType<typeof buildPricingLookup>,
) {
  const base = summarizeEffectiveUsageCost(rows);
  const estimatedUnpricedCostCents = Number(
    rows
      .filter((row) => Math.max(0, row.costCents ?? 0) <= 0 && Math.max(0, row.totalTokens ?? 0) > 0)
      .reduce((sum, row) => sum + estimateUsageCostCents(row, resolveUsagePricing(pricingLookup, row.model)), 0)
      .toFixed(6),
  );

  return {
    ...base,
    estimatedUnpricedCostCents,
    effectiveCostCents: base.knownCostCents + estimatedUnpricedCostCents,
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
    finishReason: v.optional(v.string()),
    truncatedByLength: v.optional(v.boolean()),
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
      finishReason: args.finishReason,
      truncatedByLength: args.truncatedByLength,
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
    openRouterCost: v.optional(v.number()),
    cacheSavingsCents: v.optional(v.number()),
    finishReason: v.optional(v.string()),
    truncatedByLength: v.optional(v.boolean()),
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
        const normalized = normalizeModelId(args.model);
        const normalizedLeaf = modelLeaf(args.model);
        const modelRows = await ctx.db
          .query("modelCatalog")
          .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
          .collect();
        const leafMatches = modelRows.filter((row) => modelLeaf(row.modelId) === normalizedLeaf);
        const fuzzyMatch = modelRows.find((row) => {
          const candidate = normalizeModelId(row.modelId);
          return candidate === normalized;
        }) ?? (leafMatches.length === 1 ? leafMatches[0] : undefined);
        if (typeof inPrice !== "number") inPrice = fuzzyMatch?.inputCostPerM;
        if (typeof outPrice !== "number") outPrice = fuzzyMatch?.outputCostPerM;
      }
    }

    const hasKnownPricing =
      (typeof inPrice === "number" && Number.isFinite(inPrice)) ||
      (typeof outPrice === "number" && Number.isFinite(outPrice));

    const openRouterCost =
      typeof args.openRouterCost === "number" && Number.isFinite(args.openRouterCost)
        ? Math.max(0, args.openRouterCost)
        : undefined;

    const inputPricePerM = typeof inPrice === "number" && Number.isFinite(inPrice) ? inPrice : 0;
    const outputPricePerM = typeof outPrice === "number" && Number.isFinite(outPrice) ? outPrice : 0;
    const estimatedRawCostCents =
      (
        ((args.inputTokens / 1_000_000) * inputPricePerM) +
        ((args.outputTokens / 1_000_000) * outputPricePerM)
      ) * 100;
    const directCostCents =
      openRouterCost !== undefined
        ? Number((openRouterCost * 100).toFixed(6))
        : undefined;
    const costCents = Math.max(
      0,
      Number((directCostCents ?? estimatedRawCostCents).toFixed(6)),
    );
    const cacheSavingsCents =
      typeof args.cacheSavingsCents === "number" && Number.isFinite(args.cacheSavingsCents)
        ? Math.max(0, Number(args.cacheSavingsCents.toFixed(6)))
        : undefined;

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
      cacheSavingsCents,
      finishReason: args.finishReason,
      truncatedByLength: args.truncatedByLength,
      pricingNote:
        openRouterCost !== undefined
          ? "Cost sourced directly from OpenRouter usage."
          : hasKnownPricing
            ? undefined
            : "Pricing unknown at record time; cost defaulted to zero.",
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

export const recordUsageWithCostInternal = internalMutation({
  args: {
    userId: v.id("users"),
    orgId: v.id("orgs"),
    chatId: v.optional(v.id("chats")),
    messageId: v.optional(v.id("messages")),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    openRouterCost: v.optional(v.number()),
    cacheSavingsCents: v.optional(v.number()),
    finishReason: v.optional(v.string()),
    truncatedByLength: v.optional(v.boolean()),
    inputCostPerM: v.optional(v.number()),
    outputCostPerM: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.orgId !== args.orgId) {
      throw new Error("User not found");
    }

    const day = dayKey();
    const now = Date.now();
    const totalTokens = Math.max(0, args.inputTokens + args.outputTokens);

    let inPrice = args.inputCostPerM;
    let outPrice = args.outputCostPerM;
    if (typeof inPrice !== "number" || typeof outPrice !== "number") {
      const directModelRow = await ctx.db
        .query("modelCatalog")
        .withIndex("by_org_model", (q) => q.eq("orgId", args.orgId).eq("modelId", args.model))
        .unique();
      if (typeof inPrice !== "number") inPrice = directModelRow?.inputCostPerM;
      if (typeof outPrice !== "number") outPrice = directModelRow?.outputCostPerM;

      if (typeof inPrice !== "number" || typeof outPrice !== "number") {
        const normalized = normalizeModelId(args.model);
        const normalizedLeaf = modelLeaf(args.model);
        const modelRows = await ctx.db
          .query("modelCatalog")
          .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
          .collect();
        const leafMatches = modelRows.filter((row) => modelLeaf(row.modelId) === normalizedLeaf);
        const fuzzyMatch = modelRows.find((row) => {
          const candidate = normalizeModelId(row.modelId);
          return candidate === normalized;
        }) ?? (leafMatches.length === 1 ? leafMatches[0] : undefined);
        if (typeof inPrice !== "number") inPrice = fuzzyMatch?.inputCostPerM;
        if (typeof outPrice !== "number") outPrice = fuzzyMatch?.outputCostPerM;
      }
    }

    const hasKnownPricing =
      (typeof inPrice === "number" && Number.isFinite(inPrice)) ||
      (typeof outPrice === "number" && Number.isFinite(outPrice));

    const openRouterCost =
      typeof args.openRouterCost === "number" && Number.isFinite(args.openRouterCost)
        ? Math.max(0, args.openRouterCost)
        : undefined;

    const inputPricePerM = typeof inPrice === "number" && Number.isFinite(inPrice) ? inPrice : 0;
    const outputPricePerM = typeof outPrice === "number" && Number.isFinite(outPrice) ? outPrice : 0;
    const estimatedRawCostCents =
      (
        ((args.inputTokens / 1_000_000) * inputPricePerM) +
        ((args.outputTokens / 1_000_000) * outputPricePerM)
      ) * 100;
    const directCostCents =
      openRouterCost !== undefined
        ? Number((openRouterCost * 100).toFixed(6))
        : undefined;
    const costCents = Math.max(
      0,
      Number((directCostCents ?? estimatedRawCostCents).toFixed(6)),
    );
    const cacheSavingsCents =
      typeof args.cacheSavingsCents === "number" && Number.isFinite(args.cacheSavingsCents)
        ? Math.max(0, Number(args.cacheSavingsCents.toFixed(6)))
        : undefined;

    const existingDaily = await ctx.db
      .query("usageDaily")
      .withIndex("by_org_day", (q) => q.eq("orgId", args.orgId).eq("day", day))
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
        orgId: args.orgId,
        day,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        totalTokens,
        updatedAt: now,
      });
    }

    await ctx.db.insert("usageEvents", {
      orgId: args.orgId,
      userId: args.userId,
      chatId: args.chatId,
      messageId: args.messageId,
      model: args.model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens,
      costCents,
      cacheSavingsCents,
      finishReason: args.finishReason,
      truncatedByLength: args.truncatedByLength,
      pricingNote:
        openRouterCost !== undefined
          ? "Cost sourced directly from OpenRouter usage."
          : hasKnownPricing
            ? undefined
            : "Pricing unknown at record time; cost defaulted to zero.",
      day,
      createdAt: now,
    });

    const key = monthKey(now);
    const existingMonth = await ctx.db
      .query("userSpending")
      .withIndex("by_user_month", (q) => q.eq("userId", args.userId).eq("monthKey", key))
      .unique();

    if (existingMonth) {
      await ctx.db.patch(existingMonth._id, {
        totalCostCents: Math.max(0, existingMonth.totalCostCents + costCents),
        lastUpdatedAt: now,
      });
    } else {
      await ctx.db.insert("userSpending", {
        userId: args.userId,
        orgId: args.orgId,
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
    const modelRows = await ctx.db
      .query("modelCatalog")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();
    const monthlyUsage = usageRows.filter((row) => dayBelongsToMonth(row.day, key));
    const pricingLookup = buildPricingLookup(modelRows);
    const monthlyTokens = monthlyUsage.reduce((sum, row) => sum + Math.max(0, row.totalTokens ?? 0), 0);
    const monthlyEvents = monthlyUsage.length;
    const monthlyCostCentsFromEvents = Number(
      monthlyUsage
        .reduce((sum, row) => sum + Math.max(0, row.costCents ?? 0), 0)
        .toFixed(6),
    );
    const usageCost = summarizeUsageWithPricing(monthlyUsage, pricingLookup);
    const knownCostCents = Math.max(storedTotalCostCents, usageCost.knownCostCents, monthlyCostCentsFromEvents);
    const effectiveCostCents = Math.max(knownCostCents, usageCost.effectiveCostCents);
    const totalSpentEur = effectiveCostCents / 100;
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

    const budgetTier =
      effectiveCostCents >= hardLimitCents
        ? "free_only"
        : effectiveCostCents >= cheapOnlyLimitCents
          ? "cheap_only"
          : effectiveCostCents >= softLimitCents
            ? "expensive_blocked"
            : "normal";
    const allowPaidModels = org.allowPaidModels ?? true;
    const tier = allowPaidModels ? budgetTier : "free_only";

    return {
      totalSpentEur,
      totalCostCents: effectiveCostCents,
      knownCostCents,
      estimatedUnpricedCostCents: usageCost.estimatedUnpricedCostCents,
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
      monthlyUnpricedEvents: usageCost.monthlyUnpricedEvents,
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
    const usageRows = await ctx.db
      .query("usageEvents")
      .withIndex("by_user_day", (q) => q.eq("userId", actor._id))
      .collect();
    const modelRows = await ctx.db
      .query("modelCatalog")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();

    const limit = Math.min(Math.max(args.months ?? 6, 1), 24);
    const pricingLookup = buildPricingLookup(modelRows);
    const usageByMonth = new Map<string, Array<(typeof usageRows)[number]>>();
    for (const row of usageRows) {
      const key = row.day.slice(0, 7);
      const bucket = usageByMonth.get(key) ?? [];
      bucket.push(row);
      usageByMonth.set(key, bucket);
    }
    const storedByMonth = new Map(rows.map((row) => [row.monthKey, row]));
    const monthKeys = Array.from(new Set([...storedByMonth.keys(), ...usageByMonth.keys()])).sort((a, b) =>
      a < b ? 1 : -1,
    );

    return monthKeys
      .slice(0, limit)
      .map((monthKey) => {
        const stored = storedByMonth.get(monthKey);
        const usageCost = summarizeUsageWithPricing(usageByMonth.get(monthKey) ?? [], pricingLookup);
        const totalCostCents = Math.max(stored?.totalCostCents ?? 0, usageCost.effectiveCostCents);
        return {
          monthKey,
          totalCostCents,
          totalSpentEur: totalCostCents / 100,
          knownCostCents: Math.max(stored?.totalCostCents ?? 0, usageCost.knownCostCents),
          estimatedUnpricedCostCents: usageCost.estimatedUnpricedCostCents,
          monthlyUnpricedEvents: usageCost.monthlyUnpricedEvents,
        };
      });
  },
});
