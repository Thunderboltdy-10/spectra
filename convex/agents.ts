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
