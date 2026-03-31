import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getUserByClerkId } from "./helpers";
import { MODEL_DEFAULTS } from "./constants";

type Rating = "low" | "medium" | "high";
type MultiRating = "none" | "basic" | "strong";
type ChallengerState = "challenger" | "normal" | "deprioritized";
type ModelInput = {
  modelId: string;
  name: string;
  provider: string;
  description: string;
  contextLength?: number;
  inputCostPerM?: number;
  outputCostPerM?: number;
  supportedParameters?: string[];
  promptCachingSupported?: boolean;
  cachePricingReadPerM?: number;
  cachePricingWritePerM?: number;
  endpointLatencyP50Ms?: number;
  endpointUptimePercent?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  tags: string[];
  costRating?: string;
  speedRating?: string;
  reasoningRating?: string;
  multimodalRating?: string;
  recommendedForPhysics: boolean;
  isFree?: boolean;
  isFeatured?: boolean;
  featuredOrder?: number;
  capabilities?: {
    reasoning: number;
    creative: number;
    code: number;
    vision: number;
    speed: number;
  };
  strengthText?: string;
  strengthEmbedding?: number[];
  releaseDate?: string;
  knowledgeCutoff?: string;
  curatedNotes?: string;
  benchmarkMMLU?: number;
  benchmarkHumanEval?: number;
  arenaElo?: number;
};

const FEATURED_LABELS: Record<string, string> = {
  "stepfun/step-3.5-flash:free": "Fast Included",
  "minimax/minimax-m2.5:free": "Deep Reasoning",
  "anthropic/claude-sonnet-4.5": "Best Writing",
  "openai/gpt-5.4-mini": "Best Reasoning",
  "openai/gpt-5.4-nano": "Smart & Cheap",
  "google/gemma-3-27b-vision:free": "Vision",
};

const seededModels = [
  {
    modelId: MODEL_DEFAULTS.tutorFast,
    name: "Step 3.5 Flash",
    provider: "Stepfun",
    description: "Fast free model for tutoring, hints, and quick explanations.",
    tags: ["tutor", "fast", "free", "fresh"],
    costRating: "low",
    speedRating: "high",
    reasoningRating: "medium",
    multimodalRating: "basic",
    recommendedForPhysics: true,
    isFree: true,
    isFeatured: true,
    featuredOrder: 1,
  },
  {
    modelId: MODEL_DEFAULTS.tutorHigh,
    name: "MiniMax M2.5",
    provider: "MiniMax",
    description: "Free reasoning-focused model for multi-step academic analysis.",
    tags: ["reasoning", "free"],
    costRating: "low",
    speedRating: "medium",
    reasoningRating: "high",
    multimodalRating: "none",
    recommendedForPhysics: true,
    isFree: true,
    isFeatured: true,
    featuredOrder: 2,
  },
  {
    modelId: MODEL_DEFAULTS.marker,
    name: "Qwen3 Next 80B",
    provider: "Qwen",
    description: "Strong free grading model for rubric-driven feedback and verification.",
    tags: ["marker", "academic", "reasoning", "free"],
    costRating: "low",
    speedRating: "medium",
    reasoningRating: "high",
    multimodalRating: "none",
    recommendedForPhysics: true,
    isFree: true,
  },
  {
    modelId: MODEL_DEFAULTS.multimodal,
    name: "Gemma 3 27B Vision",
    provider: "Google",
    description: "Vision-capable model for file-heavy tutoring and image analysis.",
    tags: ["vision", "free"],
    costRating: "low",
    speedRating: "medium",
    reasoningRating: "medium",
    multimodalRating: "strong",
    recommendedForPhysics: true,
    isFree: true,
    isFeatured: true,
    featuredOrder: 6,
  },
  {
    modelId: MODEL_DEFAULTS.openrouterAuto,
    name: "OpenRouter Auto",
    provider: "OpenRouter",
    description: "OpenRouter chooses an available model automatically.",
    tags: ["auto", "reliability"],
    costRating: "medium",
    speedRating: "medium",
    reasoningRating: "medium",
    multimodalRating: "basic",
    recommendedForPhysics: false,
  },
  {
    modelId: MODEL_DEFAULTS.glmAir,
    name: "GLM 4.5 Air",
    provider: "Z-AI",
    description: "Lightweight efficient model for fast tutoring and general academic tasks.",
    tags: ["tutor", "fast", "free"],
    costRating: "low",
    speedRating: "high",
    reasoningRating: "medium",
    multimodalRating: "none",
    recommendedForPhysics: true,
    isFree: true,
  },
  {
    modelId: MODEL_DEFAULTS.gptOss,
    name: "GPT-OSS 120B",
    provider: "OpenAI",
    description: "Large open-source model with strong reasoning capabilities for complex problems.",
    tags: ["reasoning", "free", "large"],
    costRating: "low",
    speedRating: "medium",
    reasoningRating: "high",
    multimodalRating: "none",
    recommendedForPhysics: true,
    isFree: true,
  },
  {
    modelId: MODEL_DEFAULTS.markerHard,
    name: "Nemotron 3 Super 120B",
    provider: "NVIDIA",
    description: "High-capacity free model for harder rubric checks and depth-heavy tasks.",
    tags: ["reasoning", "marker", "free"],
    costRating: "low",
    speedRating: "medium",
    reasoningRating: "high",
    multimodalRating: "none",
    recommendedForPhysics: true,
    isFree: true,
  },
];

function asRating(value: string | undefined): Rating {
  if (value === "low" || value === "high") {
    return value;
  }
  return "medium";
}

function asMulti(value: string | undefined): MultiRating {
  if (value === "none" || value === "strong") {
    return value;
  }
  return "basic";
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function reliabilityFromCounts(successCount: number, failureCount: number) {
  const success = Math.max(0, successCount);
  const failure = Math.max(0, failureCount);
  return clamp01((success + 1) / (success + failure + 2));
}

function latencyScore(avgLatencyMs: number) {
  if (!Number.isFinite(avgLatencyMs) || avgLatencyMs <= 0) return 0.58;
  if (avgLatencyMs <= 2_500) return 1;
  if (avgLatencyMs <= 4_500) return 0.82;
  if (avgLatencyMs <= 7_500) return 0.6;
  if (avgLatencyMs <= 11_000) return 0.36;
  return 0.2;
}

function feedbackScore(positiveCount: number, negativeCount: number) {
  const positive = Math.max(0, positiveCount);
  const negative = Math.max(0, negativeCount);
  const total = positive + negative;
  if (total <= 0) return 0.5;
  const balance = (positive - negative) / total;
  return clamp01((balance + 1) / 2);
}

function evaluateQuality(params: {
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  lengthFinishCount?: number;
  positiveFeedbackCount?: number;
  negativeFeedbackCount?: number;
}) {
  const totalRuns = Math.max(0, params.successCount + params.failureCount);
  const reliability = reliabilityFromCounts(params.successCount, params.failureCount);
  const latency = latencyScore(params.avgLatencyMs);
  const feedback = feedbackScore(params.positiveFeedbackCount ?? 0, params.negativeFeedbackCount ?? 0);
  const lengthRate = totalRuns > 0 ? Math.max(0, (params.lengthFinishCount ?? 0) / totalRuns) : 0;
  const qualityScore = clamp01(
    (0.55 * reliability)
    + (0.2 * latency)
    + (0.15 * feedback)
    + (0.1 * (1 - clamp01(lengthRate))),
  );

  return {
    totalRuns,
    reliability,
    qualityScore,
  };
}

function stripLargeModelFields<T extends { strengthEmbedding?: number[] }>(row: T) {
  const { strengthEmbedding: _strengthEmbedding, ...rest } = row;
  return rest;
}

async function upsertModelCatalogBatch(
  ctx: Pick<MutationCtx, "db">,
  orgId: Id<"orgs">,
  models: ModelInput[],
  now: number,
) {
  for (const model of models) {
    const existing = await ctx.db
      .query("modelCatalog")
      .withIndex("by_org_model", (q) => q.eq("orgId", orgId).eq("modelId", model.modelId))
      .unique();

    const payload = {
      orgId,
      modelId: model.modelId,
      name: model.name,
      provider: model.provider,
      description: model.description,
      contextLength: model.contextLength,
      inputCostPerM: model.inputCostPerM,
      outputCostPerM: model.outputCostPerM,
      supportedParameters: model.supportedParameters,
      promptCachingSupported: model.promptCachingSupported,
      cachePricingReadPerM: model.cachePricingReadPerM,
      cachePricingWritePerM: model.cachePricingWritePerM,
      endpointLatencyP50Ms: model.endpointLatencyP50Ms,
      endpointUptimePercent: model.endpointUptimePercent,
      inputModalities: model.inputModalities,
      outputModalities: model.outputModalities,
      tags: model.tags,
      costRating: asRating(model.costRating),
      speedRating: asRating(model.speedRating),
      reasoningRating: asRating(model.reasoningRating),
      multimodalRating: asMulti(model.multimodalRating),
      recommendedForPhysics: model.recommendedForPhysics,
      isFree: model.isFree,
      isFeatured: model.isFeatured,
      featuredOrder: model.featuredOrder,
      capabilities: model.capabilities,
      strengthText: model.strengthText,
      releaseDate: model.releaseDate,
      knowledgeCutoff: model.knowledgeCutoff,
      curatedNotes: model.curatedNotes,
      benchmarkMMLU: model.benchmarkMMLU,
      benchmarkHumanEval: model.benchmarkHumanEval,
      arenaElo: model.arenaElo,
      updatedAt: now,
      ...(model.strengthEmbedding !== undefined ? { strengthEmbedding: model.strengthEmbedding } : {}),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("modelCatalog", {
        ...payload,
        createdAt: now,
      });
    }
  }
}

const vModelInput = v.object({
  modelId: v.string(),
  name: v.string(),
  provider: v.string(),
  description: v.string(),
  contextLength: v.optional(v.number()),
  inputCostPerM: v.optional(v.number()),
  outputCostPerM: v.optional(v.number()),
  supportedParameters: v.optional(v.array(v.string())),
  promptCachingSupported: v.optional(v.boolean()),
  cachePricingReadPerM: v.optional(v.number()),
  cachePricingWritePerM: v.optional(v.number()),
  endpointLatencyP50Ms: v.optional(v.number()),
  endpointUptimePercent: v.optional(v.number()),
  inputModalities: v.optional(v.array(v.string())),
  outputModalities: v.optional(v.array(v.string())),
  tags: v.array(v.string()),
  costRating: v.optional(v.string()),
  speedRating: v.optional(v.string()),
  reasoningRating: v.optional(v.string()),
  multimodalRating: v.optional(v.string()),
  recommendedForPhysics: v.boolean(),
  isFree: v.optional(v.boolean()),
  isFeatured: v.optional(v.boolean()),
  featuredOrder: v.optional(v.number()),
  capabilities: v.optional(v.object({
    reasoning: v.number(),
    creative: v.number(),
    code: v.number(),
    vision: v.number(),
    speed: v.number(),
  })),
  strengthText: v.optional(v.string()),
  strengthEmbedding: v.optional(v.array(v.float64())),
  releaseDate: v.optional(v.string()),
  knowledgeCutoff: v.optional(v.string()),
  curatedNotes: v.optional(v.string()),
  benchmarkMMLU: v.optional(v.number()),
  benchmarkHumanEval: v.optional(v.number()),
  arenaElo: v.optional(v.number()),
});

export const seedCatalogIfEmpty = mutation({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Actor not found");
    }

    const existing = await ctx.db
      .query("modelCatalog")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .first();

    if (existing) {
      return { inserted: 0 };
    }

    const now = Date.now();
    for (const model of seededModels) {
      await ctx.db.insert("modelCatalog", {
        ...model,
        orgId: actor.orgId,
        contextLength: undefined,
        inputCostPerM: undefined,
        outputCostPerM: undefined,
        costRating: model.costRating as Rating,
        speedRating: model.speedRating as Rating,
        reasoningRating: model.reasoningRating as Rating,
        multimodalRating: model.multimodalRating as MultiRating,
        isFree: model.isFree,
        isFeatured: model.isFeatured,
        featuredOrder: model.featuredOrder,
        strengthText: `${model.name} by ${model.provider}. ${model.description}`,
        strengthEmbedding: undefined,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { inserted: seededModels.length };
  },
});

export const listModels = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Actor not found");
    }

    const rows = await ctx.db
      .query("modelCatalog")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .take(200);

    return rows
      .map((row) => stripLargeModelFields(row))
      .sort((a, b) => {
      const aOrder = typeof a.featuredOrder === "number" ? a.featuredOrder : Number.MAX_SAFE_INTEGER;
      const bOrder = typeof b.featuredOrder === "number" ? b.featuredOrder : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.name.localeCompare(b.name);
      });
  },
});

export const listFeaturedModels = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Actor not found");
    }

    const models = await ctx.db
      .query("modelCatalog")
      .withIndex("by_org_featured", (q) => q.eq("orgId", actor.orgId).eq("isFeatured", true))
      .take(40);

    const featured = models
      .sort((a, b) => (a.featuredOrder ?? 999) - (b.featuredOrder ?? 999))
      .map((model) => ({
        ...stripLargeModelFields(model),
        label: FEATURED_LABELS[model.modelId] ?? "Featured",
      }));

    return featured;
  },
});

export const getMostUsedModels = query({
  args: {
    actorClerkId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Actor not found");
    }

    const limit = Math.max(1, Math.min(args.limit ?? 5, 20));
    const usage = await ctx.db
      .query("usageEvents")
      .withIndex("by_org_day", (q) => q.eq("orgId", actor.orgId))
      .collect();

    const counts = new Map<string, number>();
    for (const event of usage) {
      counts.set(event.model, (counts.get(event.model) ?? 0) + 1);
    }

    const ranked = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([modelId, count]) => ({ modelId, count }));

    const catalog = await ctx.db
      .query("modelCatalog")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();

    const byId = new Map(catalog.map((model) => [model.modelId, model]));
    return ranked
      .map((entry) => {
        const model = byId.get(entry.modelId);
        if (!model) return null;
        return {
          ...model,
          usageCount: entry.count,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  },
});

export const getMostUsedModelsByUser = query({
  args: {
    actorClerkId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Actor not found");
    }

    const limit = Math.max(1, Math.min(args.limit ?? 5, 20));
    const usage = await ctx.db
      .query("usageEvents")
      .withIndex("by_user_day", (q) => q.eq("userId", actor._id))
      .collect();

    const counts = new Map<string, number>();
    for (const event of usage) {
      counts.set(event.model, (counts.get(event.model) ?? 0) + 1);
    }

    const ranked = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([modelId, count]) => ({ modelId, count }));

    const catalog = await ctx.db
      .query("modelCatalog")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();

    const byId = new Map(catalog.map((model) => [model.modelId, model]));
    return ranked.map((entry) => {
      const model = byId.get(entry.modelId);
      if (!model) {
        return {
          _id: `unknown-${entry.modelId}`,
          orgId: actor.orgId,
          modelId: entry.modelId,
          name: entry.modelId.split("/").pop() ?? entry.modelId,
          provider: entry.modelId.split("/")[0] ?? "Unknown",
          description: "Usage-based model entry",
          tags: ["usage"],
          costRating: "medium" as Rating,
          speedRating: "medium" as Rating,
          reasoningRating: "medium" as Rating,
          multimodalRating: "none" as MultiRating,
          recommendedForPhysics: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          usageCount: entry.count,
        };
      }
      return {
        ...model,
        usageCount: entry.count,
      };
    });
  },
});

export const getModelLeaderboard = query({
  args: {
    actorClerkId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Actor not found");
    }

    const usage = await ctx.db
      .query("usageEvents")
      .withIndex("by_org_day", (q) => q.eq("orgId", actor.orgId))
      .collect();

    const totals = new Map<string, { totalTokens: number; usageCount: number }>();
    for (const event of usage) {
      const current = totals.get(event.model) ?? { totalTokens: 0, usageCount: 0 };
      current.totalTokens += Math.max(0, event.totalTokens ?? 0);
      current.usageCount += 1;
      totals.set(event.model, current);
    }

    const catalog = await ctx.db
      .query("modelCatalog")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();
    const modelById = new Map(catalog.map((model) => [model.modelId, model]));

    const limit = Math.max(1, Math.min(args.limit ?? 25, 100));
    return [...totals.entries()]
      .sort((a, b) => b[1].totalTokens - a[1].totalTokens || b[1].usageCount - a[1].usageCount)
      .slice(0, limit)
      .map(([modelId, aggregate]) => {
        const known = modelById.get(modelId);
        return {
          modelId,
          provider: known?.provider ?? modelId.split("/")[0] ?? "Unknown",
          name: known?.name ?? (modelId.split("/").pop() ?? modelId),
          totalTokens: aggregate.totalTokens,
          usageCount: aggregate.usageCount,
        };
      });
  },
});

export const listWithEmbeddings = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Actor not found");
    }

    return ctx.db
      .query("modelCatalog")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();
  },
});

export const getModelPricing = query({
  args: {
    actorClerkId: v.string(),
    modelId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Actor not found");
    }

    const model = await ctx.db
      .query("modelCatalog")
      .withIndex("by_org_model", (q) => q.eq("orgId", actor.orgId).eq("modelId", args.modelId))
      .unique();

    if (!model) {
      return {
        modelId: args.modelId,
        inputCostPerM: undefined,
        outputCostPerM: undefined,
        cachePricingReadPerM: undefined,
        cachePricingWritePerM: undefined,
        isFree: args.modelId.includes(":free"),
      };
    }

    return {
      modelId: model.modelId,
      inputCostPerM: model.inputCostPerM,
      outputCostPerM: model.outputCostPerM,
      cachePricingReadPerM: model.cachePricingReadPerM,
      cachePricingWritePerM: model.cachePricingWritePerM,
      isFree: model.isFree ?? false,
    };
  },
});

export const listRuntimeStats = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Actor not found");
    }

    return ctx.db
      .query("modelRuntimeStats")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();
  },
});

export const recordModelRun = mutation({
  args: {
    actorClerkId: v.string(),
    modelId: v.string(),
    success: v.boolean(),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Actor not found");
    }

    const now = Date.now();
    const latency = Math.max(0, Math.round(args.latencyMs ?? 0));
    const existing = await ctx.db
      .query("modelRuntimeStats")
      .withIndex("by_org_model", (q) => q.eq("orgId", actor.orgId).eq("modelId", args.modelId))
      .unique();

    if (!existing) {
      const successCount = args.success ? 1 : 0;
      const failureCount = args.success ? 0 : 1;
      await ctx.db.insert("modelRuntimeStats", {
        orgId: actor.orgId,
        modelId: args.modelId,
        successCount,
        failureCount,
        totalLatencyMs: latency,
        avgLatencyMs: latency,
        consecutiveFailureCount: args.success ? 0 : 1,
        lastFailureAt: args.success ? undefined : now,
        lengthFinishCount: 0,
        totalResponseChars: 0,
        positiveFeedbackCount: 0,
        negativeFeedbackCount: 0,
        challengerState: "challenger",
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true };
    }

    const successCount = existing.successCount + (args.success ? 1 : 0);
    const failureCount = existing.failureCount + (args.success ? 0 : 1);
    const totalLatencyMs = existing.totalLatencyMs + latency;
    const totalRuns = Math.max(1, successCount + failureCount);
    const avgLatencyMs = Math.round(totalLatencyMs / totalRuns);
    const consecutiveFailureCount = args.success
      ? 0
      : (existing.consecutiveFailureCount ?? 0) + 1;
    const lastFailureAt = args.success ? existing.lastFailureAt : now;

    await ctx.db.patch(existing._id, {
      successCount,
      failureCount,
      totalLatencyMs,
      avgLatencyMs,
      consecutiveFailureCount,
      lastFailureAt,
      lastUsedAt: now,
      updatedAt: now,
    });

    return { ok: true };
  },
});

export const recordModelQualitySignals = mutation({
  args: {
    actorClerkId: v.string(),
    modelId: v.string(),
    finishReason: v.optional(v.string()),
    responseLength: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Actor not found");
    }

    const now = Date.now();
    const lengthFinishIncrement = args.finishReason?.trim().toLowerCase() === "length" ? 1 : 0;
    const responseCharsIncrement = Math.max(0, Math.round(args.responseLength ?? 0));
    if (lengthFinishIncrement <= 0 && responseCharsIncrement <= 0) {
      return { ok: true, updated: false };
    }

    const existing = await ctx.db
      .query("modelRuntimeStats")
      .withIndex("by_org_model", (q) => q.eq("orgId", actor.orgId).eq("modelId", args.modelId))
      .unique();

    if (!existing) {
      await ctx.db.insert("modelRuntimeStats", {
        orgId: actor.orgId,
        modelId: args.modelId,
        successCount: 0,
        failureCount: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
        consecutiveFailureCount: 0,
        lastFailureAt: undefined,
        lengthFinishCount: lengthFinishIncrement,
        totalResponseChars: responseCharsIncrement,
        positiveFeedbackCount: 0,
        negativeFeedbackCount: 0,
        challengerState: "challenger",
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true, updated: true };
    }

    await ctx.db.patch(existing._id, {
      lengthFinishCount: (existing.lengthFinishCount ?? 0) + lengthFinishIncrement,
      totalResponseChars: (existing.totalResponseChars ?? 0) + responseCharsIncrement,
      updatedAt: now,
    });

    return { ok: true, updated: true };
  },
});

export const recordModelFeedbackSignal = mutation({
  args: {
    actorClerkId: v.string(),
    modelId: v.string(),
    positive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Actor not found");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("modelRuntimeStats")
      .withIndex("by_org_model", (q) => q.eq("orgId", actor.orgId).eq("modelId", args.modelId))
      .unique();

    const positiveIncrement = args.positive ? 1 : 0;
    const negativeIncrement = args.positive ? 0 : 1;

    if (!existing) {
      await ctx.db.insert("modelRuntimeStats", {
        orgId: actor.orgId,
        modelId: args.modelId,
        successCount: 0,
        failureCount: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
        consecutiveFailureCount: 0,
        lastFailureAt: undefined,
        lengthFinishCount: 0,
        totalResponseChars: 0,
        positiveFeedbackCount: positiveIncrement,
        negativeFeedbackCount: negativeIncrement,
        challengerState: "challenger",
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true };
    }

    await ctx.db.patch(existing._id, {
      positiveFeedbackCount: (existing.positiveFeedbackCount ?? 0) + positiveIncrement,
      negativeFeedbackCount: (existing.negativeFeedbackCount ?? 0) + negativeIncrement,
      updatedAt: now,
    });

    return { ok: true };
  },
});

export const evaluateChallengerLane = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("modelRuntimeStats").collect();
    const now = Date.now();
    let updated = 0;

    for (const row of rows) {
      const quality = evaluateQuality({
        successCount: row.successCount,
        failureCount: row.failureCount,
        avgLatencyMs: row.avgLatencyMs,
        lengthFinishCount: row.lengthFinishCount,
        positiveFeedbackCount: row.positiveFeedbackCount,
        negativeFeedbackCount: row.negativeFeedbackCount,
      });

      const nextState: ChallengerState =
        quality.totalRuns < 12
          ? "challenger"
          : quality.qualityScore < 0.3
            ? "deprioritized"
            : "normal";

      const qualityRounded = Number(quality.qualityScore.toFixed(4));
      const stateChanged = (row.challengerState ?? "challenger") !== nextState;
      const qualityChanged = row.qualityScore !== qualityRounded;
      if (!stateChanged && !qualityChanged) {
        continue;
      }

      await ctx.db.patch(row._id, {
        challengerState: nextState,
        qualityScore: qualityRounded,
        lastEvaluatedAt: now,
        updatedAt: now,
      });
      updated += 1;
    }

    return { ok: true, evaluated: rows.length, updated };
  },
});

export const upsertModelCatalog = mutation({
  args: {
    actorClerkId: v.string(),
    models: v.array(vModelInput),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || actor.role !== "admin") {
      throw new Error("Only admin can refresh model catalog");
    }

    const now = Date.now();
    for (const model of args.models) {
      const existing = await ctx.db
        .query("modelCatalog")
        .withIndex("by_org_model", (q) => q.eq("orgId", actor.orgId).eq("modelId", model.modelId))
        .unique();

      const payload = {
        orgId: actor.orgId,
        modelId: model.modelId,
        name: model.name,
        provider: model.provider,
        description: model.description,
        contextLength: model.contextLength,
        inputCostPerM: model.inputCostPerM,
        outputCostPerM: model.outputCostPerM,
        supportedParameters: model.supportedParameters,
        promptCachingSupported: model.promptCachingSupported,
        cachePricingReadPerM: model.cachePricingReadPerM,
        cachePricingWritePerM: model.cachePricingWritePerM,
        endpointLatencyP50Ms: model.endpointLatencyP50Ms,
        endpointUptimePercent: model.endpointUptimePercent,
        inputModalities: model.inputModalities,
        outputModalities: model.outputModalities,
        tags: model.tags,
        costRating: asRating(model.costRating),
        speedRating: asRating(model.speedRating),
        reasoningRating: asRating(model.reasoningRating),
        multimodalRating: asMulti(model.multimodalRating),
        recommendedForPhysics: model.recommendedForPhysics,
        isFree: model.isFree,
        isFeatured: model.isFeatured,
        featuredOrder: model.featuredOrder,
        capabilities: model.capabilities,
        strengthText: model.strengthText,
        releaseDate: model.releaseDate,
        knowledgeCutoff: model.knowledgeCutoff,
        curatedNotes: model.curatedNotes,
        benchmarkMMLU: model.benchmarkMMLU,
        benchmarkHumanEval: model.benchmarkHumanEval,
        arenaElo: model.arenaElo,
        updatedAt: now,
        ...(model.strengthEmbedding !== undefined ? { strengthEmbedding: model.strengthEmbedding } : {}),
      };

      if (existing) {
        await ctx.db.patch(existing._id, payload);
      } else {
        await ctx.db.insert("modelCatalog", { ...payload, createdAt: now });
      }
    }

    return { ok: true, count: args.models.length };
  },
});

export const syncModelCatalog = mutation({
  args: {
    actorClerkId: v.string(),
    models: v.array(vModelInput),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Actor not found");
    }

    const now = Date.now();
    for (const model of args.models) {
      const existing = await ctx.db
        .query("modelCatalog")
        .withIndex("by_org_model", (q) => q.eq("orgId", actor.orgId).eq("modelId", model.modelId))
        .unique();

      const payload = {
        orgId: actor.orgId,
        modelId: model.modelId,
        name: model.name,
        provider: model.provider,
        description: model.description,
        contextLength: model.contextLength,
        inputCostPerM: model.inputCostPerM,
        outputCostPerM: model.outputCostPerM,
        supportedParameters: model.supportedParameters,
        promptCachingSupported: model.promptCachingSupported,
        cachePricingReadPerM: model.cachePricingReadPerM,
        cachePricingWritePerM: model.cachePricingWritePerM,
        endpointLatencyP50Ms: model.endpointLatencyP50Ms,
        endpointUptimePercent: model.endpointUptimePercent,
        inputModalities: model.inputModalities,
        outputModalities: model.outputModalities,
        tags: model.tags,
        costRating: asRating(model.costRating),
        speedRating: asRating(model.speedRating),
        reasoningRating: asRating(model.reasoningRating),
        multimodalRating: asMulti(model.multimodalRating),
        recommendedForPhysics: model.recommendedForPhysics,
        isFree: model.isFree,
        isFeatured: model.isFeatured,
        featuredOrder: model.featuredOrder,
        capabilities: model.capabilities,
        strengthText: model.strengthText,
        releaseDate: model.releaseDate,
        knowledgeCutoff: model.knowledgeCutoff,
        curatedNotes: model.curatedNotes,
        benchmarkMMLU: model.benchmarkMMLU,
        benchmarkHumanEval: model.benchmarkHumanEval,
        arenaElo: model.arenaElo,
        updatedAt: now,
        ...(model.strengthEmbedding !== undefined ? { strengthEmbedding: model.strengthEmbedding } : {}),
      };

      if (existing) {
        await ctx.db.patch(existing._id, payload);
      } else {
        await ctx.db.insert("modelCatalog", {
          ...payload,
          createdAt: now,
        });
      }
    }

    return { ok: true, count: args.models.length };
  },
});

export const upsertModelCatalogForOrg = internalMutation({
  args: {
    orgId: v.id("orgs"),
    models: v.array(vModelInput),
  },
  handler: async (ctx, args) => {
    const batchSize = 20;
    const now = Date.now();
    const initialBatch = args.models.slice(0, batchSize);
    const remaining = args.models.slice(batchSize);

    await upsertModelCatalogBatch(ctx, args.orgId, initialBatch, now);

    if (remaining.length > 0) {
      await ctx.scheduler.runAfter(0, internal.models.upsertModelCatalogChunk, {
        orgId: args.orgId,
        models: remaining,
      });
    }

    return { ok: true, count: args.models.length };
  },
});

export const upsertModelCatalogChunk = internalMutation({
  args: {
    orgId: v.id("orgs"),
    models: v.array(vModelInput),
  },
  handler: async (ctx, args) => {
    const batchSize = 20;
    const now = Date.now();
    const batch = args.models.slice(0, batchSize);
    const remaining = args.models.slice(batchSize);

    await upsertModelCatalogBatch(ctx, args.orgId, batch, now);

    if (remaining.length > 0) {
      await ctx.scheduler.runAfter(0, internal.models.upsertModelCatalogChunk, {
        orgId: args.orgId,
        models: remaining,
      });
    }

    return { ok: true, processed: batch.length, remaining: remaining.length };
  },
});
