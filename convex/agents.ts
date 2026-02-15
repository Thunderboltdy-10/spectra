import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import { vStudyMode } from "./shared";

export const createAgent = mutation({
  args: {
    actorClerkId: v.string(),
    name: v.string(),
    description: v.string(),
    systemPrompt: v.string(),
    avatarEmoji: v.optional(v.string()),
    category: v.string(),
    preferredModel: v.optional(v.string()),
    preferredMode: v.optional(vStudyMode),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    originalDescription: v.optional(v.string()),
    allowedTools: v.optional(v.array(v.string())),
    modelAllowlist: v.optional(v.array(v.string())),
    modelDenylist: v.optional(v.array(v.string())),
    attachmentPolicy: v.optional(v.string()),
    visibility: v.union(v.literal("public"), v.literal("private")),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const now = Date.now();
    const agentId = await ctx.db.insert("agents", {
      orgId: actor.orgId,
      creatorUserId: actor._id,
      name: args.name,
      description: args.description,
      systemPrompt: args.systemPrompt,
      avatarEmoji: args.avatarEmoji || "🎓",
      category: args.category,
      preferredModel: args.preferredModel,
      preferredMode: args.preferredMode,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      originalDescription: args.originalDescription,
      allowedTools: args.allowedTools,
      modelAllowlist: args.modelAllowlist,
      modelDenylist: args.modelDenylist,
      attachmentPolicy: args.attachmentPolicy,
      visibility: args.visibility,
      usageCount: 0,
      guidelinesSummary: undefined,
      guidelinesTopicMap: [],
      resourceCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return { agentId };
  },
});

export const updateAgent = mutation({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    avatarEmoji: v.optional(v.string()),
    category: v.optional(v.string()),
    preferredModel: v.optional(v.string()),
    preferredMode: v.optional(vStudyMode),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    originalDescription: v.optional(v.string()),
    allowedTools: v.optional(v.array(v.string())),
    modelAllowlist: v.optional(v.array(v.string())),
    modelDenylist: v.optional(v.array(v.string())),
    attachmentPolicy: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("public"), v.literal("private"))),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== actor.orgId) {
      throw new Error("Agent not found");
    }

    if (agent.creatorUserId !== actor._id && actor.role !== "admin") {
      throw new Error("Only creator or admin can update this agent");
    }

    await ctx.db.patch(args.agentId, {
      name: args.name ?? agent.name,
      description: args.description ?? agent.description,
      systemPrompt: args.systemPrompt ?? agent.systemPrompt,
      avatarEmoji: args.avatarEmoji ?? agent.avatarEmoji,
      category: args.category ?? agent.category,
      preferredModel: args.preferredModel ?? agent.preferredModel,
      preferredMode: args.preferredMode ?? agent.preferredMode,
      temperature: args.temperature ?? agent.temperature,
      maxTokens: args.maxTokens ?? agent.maxTokens,
      originalDescription: args.originalDescription ?? agent.originalDescription,
      allowedTools: args.allowedTools ?? agent.allowedTools,
      modelAllowlist: args.modelAllowlist ?? agent.modelAllowlist,
      modelDenylist: args.modelDenylist ?? agent.modelDenylist,
      attachmentPolicy: args.attachmentPolicy ?? agent.attachmentPolicy,
      visibility: args.visibility ?? agent.visibility,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const updateAgentGuidelines = mutation({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
    guidelinesSummary: v.string(),
    guidelinesTopicMap: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== actor.orgId) {
      throw new Error("Agent not found");
    }

    if (actor.role !== "admin" && agent.creatorUserId !== actor._id) {
      throw new Error("Only creator or admin can update this agent");
    }

    await ctx.db.patch(args.agentId, {
      guidelinesSummary: args.guidelinesSummary,
      guidelinesTopicMap: args.guidelinesTopicMap.slice(0, 24),
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const deleteAgent = mutation({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== actor.orgId) {
      throw new Error("Agent not found");
    }

    if (agent.creatorUserId !== actor._id && actor.role !== "admin") {
      throw new Error("Only creator or admin can delete this agent");
    }

    await ctx.db.delete(args.agentId);
    return { ok: true };
  },
});

export const listAgents = query({
  args: {
    actorClerkId: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const base = args.category
      ? await ctx.db
          .query("agents")
          .withIndex("by_org_category", (q) => q.eq("orgId", actor.orgId).eq("category", args.category!))
          .collect()
      : await ctx.db
          .query("agents")
          .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
          .collect();

    return base
      .filter((agent) => agent.visibility === "public" || agent.creatorUserId === actor._id)
      .sort((a, b) => b.usageCount - a.usageCount || b.updatedAt - a.updatedAt);
  },
});

export const getAgent = query({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== actor.orgId) {
      throw new Error("Agent not found");
    }

    if (agent.visibility === "private" && agent.creatorUserId !== actor._id && actor.role !== "admin") {
      throw new Error("Not authorized for this agent");
    }

    return agent;
  },
});

export const searchAgents = query({
  args: {
    actorClerkId: v.string(),
    query: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const result = await ctx.db
      .query("agents")
      .withSearchIndex("search_name", (q) => q.search("name", args.query).eq("orgId", actor.orgId))
      .take(30);

    return result.filter((agent) => agent.visibility === "public" || agent.creatorUserId === actor._id);
  },
});

export const incrementUsageCount = mutation({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== actor.orgId) {
      throw new Error("Agent not found");
    }

    await ctx.db.patch(agent._id, {
      usageCount: agent.usageCount + 1,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const recordAgentModelUse = mutation({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
    modelId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== actor.orgId) {
      throw new Error("Agent not found");
    }

    const existing = await ctx.db
      .query("agentModelStats")
      .withIndex("by_agent_model", (q) => q.eq("agentId", args.agentId).eq("modelId", args.modelId))
      .unique();

    const now = Date.now();
    if (!existing) {
      await ctx.db.insert("agentModelStats", {
        agentId: args.agentId,
        modelId: args.modelId,
        totalUses: 1,
        positiveRatings: 0,
        negativeRatings: 0,
        avgResponseQuality: 0.5,
        lastUsedAt: now,
      });
      return { ok: true };
    }

    await ctx.db.patch(existing._id, {
      totalUses: existing.totalUses + 1,
      lastUsedAt: now,
    });
    return { ok: true };
  },
});

export const recordAgentModelFeedback = mutation({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
    modelId: v.string(),
    positive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== actor.orgId) throw new Error("Unauthorized");

    const stat = await ctx.db
      .query("agentModelStats")
      .withIndex("by_agent_model", (q) => q.eq("agentId", args.agentId).eq("modelId", args.modelId))
      .unique();
    if (!stat) return { ok: true };

    const positiveRatings = stat.positiveRatings + (args.positive ? 1 : 0);
    const negativeRatings = stat.negativeRatings + (args.positive ? 0 : 1);
    const totalRatings = positiveRatings + negativeRatings;
    const avgResponseQuality = totalRatings > 0 ? positiveRatings / totalRatings : stat.avgResponseQuality;

    await ctx.db.patch(stat._id, {
      positiveRatings,
      negativeRatings,
      avgResponseQuality,
      lastUsedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const getTopModelsForAgent = query({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== actor.orgId) throw new Error("Agent not found");

    const stats = await ctx.db
      .query("agentModelStats")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();

    return stats
      .map((row) => ({
        modelId: row.modelId,
        score: Math.max(0, Math.min(1, row.avgResponseQuality)),
        totalUses: row.totalUses,
      }))
      .sort((a, b) => b.score - a.score || b.totalUses - a.totalUses)
      .slice(0, Math.min(10, Math.max(1, args.limit ?? 5)));
  },
});
