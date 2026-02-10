import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import { MODEL_DEFAULTS } from "./constants";

type Rating = "low" | "medium" | "high";
type MultiRating = "none" | "basic" | "strong";

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
        inputCostPerM: 0,
        outputCostPerM: 0,
      };
    }

    return {
      modelId: model.modelId,
      inputCostPerM: model.inputCostPerM ?? 0,
      outputCostPerM: model.outputCostPerM ?? 0,
      isFree: model.isFree ?? false,
    };
  },
});

export const upsertModelCatalog = mutation({
  args: {
    actorClerkId: v.string(),
    models: v.array(
      v.object({
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
        capabilities: v.optional(v.object({
          reasoning: v.number(),
          creative: v.number(),
          code: v.number(),
          vision: v.number(),
          speed: v.number(),
        })),
      }),
    ),
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
        .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
        .filter((q) => q.eq(q.field("modelId"), model.modelId))
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
        capabilities: model.capabilities,
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
    models: v.array(
      v.object({
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
        capabilities: v.optional(v.object({
          reasoning: v.number(),
          creative: v.number(),
          code: v.number(),
          vision: v.number(),
          speed: v.number(),
        })),
      }),
    ),
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
        capabilities: model.capabilities,
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
