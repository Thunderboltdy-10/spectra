import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import { MODEL_DEFAULTS } from "./constants";

type Rating = "low" | "medium" | "high";
type MultiRating = "none" | "basic" | "strong";

const FEATURED_LABELS: Record<string, string> = {
  "google/gemini-2.0-flash-exp:free": "Fast & Free",
  "deepseek/deepseek-r1-0528:free": "Deep Reasoning",
  "anthropic/claude-sonnet-4-5": "Best Writing",
  "google/gemini-2.5-pro": "Best Reasoning",
  "openai/gpt-4.1-mini": "Smart & Cheap",
  "google/gemma-3-27b-vision:free": "Vision",
};

const seededModels = [
  {
    modelId: MODEL_DEFAULTS.tutorFast,
    name: "Gemini 2.0 Flash",
    provider: "Google",
    description: "Fast 1M-context model for tutoring, hints, and quick explanations.",
    tags: ["tutor", "fast", "free"],
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
    name: "DeepSeek R1",
    provider: "DeepSeek",
    description: "Deep reasoning model for multi-step academic problems and complex analysis.",
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
    name: "Llama 3.3 70B",
    provider: "Meta",
    description: "High-accuracy grading model for rubric-driven feedback and verification.",
    tags: ["marker", "academic", "free"],
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
    name: "GLM-4.5 Air",
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

const vModelInput = v.object({
  modelId: v.string(),
  name: v.string(),
  provider: v.string(),
  description: v.string(),
  contextLength: v.optional(v.number()),
  inputCostPerM: v.optional(v.number()),
  outputCostPerM: v.optional(v.number()),
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
      .collect();

    return rows.sort((a, b) => {
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
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();

    const featured = models
      .filter((model) => model.isFeatured)
      .sort((a, b) => (a.featuredOrder ?? 999) - (b.featuredOrder ?? 999))
      .map((model) => ({
        ...model,
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
        isFree: args.modelId.includes(":free"),
      };
    }

    return {
      modelId: model.modelId,
      inputCostPerM: model.inputCostPerM,
      outputCostPerM: model.outputCostPerM,
      isFree: model.isFree ?? false,
    };
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
        strengthEmbedding: model.strengthEmbedding,
        updatedAt: now,
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
        strengthEmbedding: model.strengthEmbedding,
        updatedAt: now,
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
    const now = Date.now();
    for (const model of args.models) {
      const existing = await ctx.db
        .query("modelCatalog")
        .withIndex("by_org_model", (q) => q.eq("orgId", args.orgId).eq("modelId", model.modelId))
        .unique();

      const payload = {
        orgId: args.orgId,
        modelId: model.modelId,
        name: model.name,
        provider: model.provider,
        description: model.description,
        contextLength: model.contextLength,
        inputCostPerM: model.inputCostPerM,
        outputCostPerM: model.outputCostPerM,
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
        strengthEmbedding: model.strengthEmbedding,
        updatedAt: now,
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
