import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import { vStudyMode } from "./shared";

type AgentDoc = {
  orgId: string;
  creatorUserId: string;
  visibility: "public" | "private" | "shared";
  collaborators?: string[];
};

type ActorDoc = {
  _id: string;
  role: "student" | "teacher" | "admin";
};

function defaultIconForCategory(category: string) {
  const value = category.trim().toLowerCase();
  if (/math|calculus|algebra|statistics/.test(value)) return "Calculator";
  if (/science|chemistry|biology|physics/.test(value)) return "FlaskConical";
  if (/writing|english|language arts|essay/.test(value)) return "PenTool";
  if (/history|politics|social studies/.test(value)) return "Landmark";
  if (/coding|programming|cs|computer/.test(value)) return "Code2";
  if (/language|linguistics/.test(value)) return "Languages";
  if (/art|music|design/.test(value)) return "Palette";
  if (/philosophy|logic/.test(value)) return "Sigma";
  if (/geography|global|world/.test(value)) return "Globe2";
  return "Bot";
}

function isAgentCollaborator(agent: AgentDoc, userId: string) {
  return (agent.collaborators ?? []).includes(userId);
}

function canEditAgent(agent: AgentDoc, actor: ActorDoc) {
  return actor.role === "admin" || agent.creatorUserId === actor._id || isAgentCollaborator(agent, actor._id);
}

function canManageCollaborators(agent: AgentDoc, actor: ActorDoc) {
  return actor.role === "admin" || agent.creatorUserId === actor._id;
}

function canChangeVisibility(agent: AgentDoc, actor: ActorDoc) {
  return agent.creatorUserId === actor._id;
}

function canViewAgent(agent: AgentDoc, actor: ActorDoc) {
  return agent.visibility === "public" || canEditAgent(agent, actor);
}

export const createAgent = mutation({
  args: {
    actorClerkId: v.string(),
    name: v.string(),
    description: v.string(),
    systemPrompt: v.string(),
    avatarEmoji: v.optional(v.string()),
    avatarIcon: v.optional(v.string()),
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
    visibility: v.union(v.literal("public"), v.literal("private"), v.literal("shared")),
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
      avatarIcon: args.avatarIcon ?? defaultIconForCategory(args.category),
      category: args.category,
      preferredModel: args.preferredModel,
      preferredMode: args.preferredMode,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      originalDescription: args.originalDescription,
      allowedTools: args.allowedTools,
      modelAllowlist: args.modelAllowlist,
      modelDenylist: args.modelDenylist,
      collaborators: [],
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
    avatarIcon: v.optional(v.string()),
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
    visibility: v.optional(v.union(v.literal("public"), v.literal("private"), v.literal("shared"))),
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

    if (!canEditAgent(agent, actor)) {
      throw new Error("Only creator, collaborator, or admin can update this agent");
    }

    if (args.visibility !== undefined && !canChangeVisibility(agent, actor)) {
      throw new Error("Only the agent creator can change visibility");
    }

    await ctx.db.patch(args.agentId, {
      name: args.name ?? agent.name,
      description: args.description ?? agent.description,
      systemPrompt: args.systemPrompt ?? agent.systemPrompt,
      avatarEmoji: args.avatarEmoji ?? agent.avatarEmoji,
      avatarIcon:
        args.avatarIcon ??
        agent.avatarIcon ??
        defaultIconForCategory(args.category ?? agent.category),
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

    if (!canEditAgent(agent, actor)) {
      throw new Error("Only creator, collaborator, or admin can update this agent");
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
      .filter((agent) => canViewAgent(agent, actor))
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

    if (!canViewAgent(agent, actor)) {
      throw new Error("Not authorized for this agent");
    }

    return agent;
  },
});

export const listCollaborators = query({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
    search: v.optional(v.string()),
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

    if (!canViewAgent(agent, actor)) {
      throw new Error("Not authorized for this agent");
    }

    const canManage = canManageCollaborators(agent, actor);
    const searchQuery = args.search?.trim().toLowerCase() ?? "";
    const collaboratorSet = new Set(agent.collaborators ?? []);

    const users = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();

    const collaborators = users
      .filter((user) => collaboratorSet.has(user._id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((user) => ({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      }));

    const candidates = canManage
      ? users
          .filter((user) => user._id !== agent.creatorUserId && !collaboratorSet.has(user._id))
          .filter((user) => {
            if (!searchQuery) return true;
            const haystack = `${user.name} ${user.email}`.toLowerCase();
            return haystack.includes(searchQuery);
          })
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 30)
          .map((user) => ({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
          }))
      : [];

    return {
      canManage,
      collaborators,
      candidates,
    };
  },
});

export const inviteCollaborator = mutation({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
    userId: v.id("users"),
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

    if (!canManageCollaborators(agent, actor)) {
      throw new Error("Only creator or admin can invite collaborators");
    }

    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser || targetUser.orgId !== actor.orgId) {
      throw new Error("Collaborator must be in the same school");
    }

    if (targetUser._id === agent.creatorUserId) {
      throw new Error("Agent owner is already an editor");
    }

    const existing = agent.collaborators ?? [];
    if (existing.includes(targetUser._id)) {
      return { ok: true };
    }

    await ctx.db.patch(agent._id, {
      collaborators: [...existing, targetUser._id],
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const removeCollaborator = mutation({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
    userId: v.id("users"),
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

    if (!canManageCollaborators(agent, actor)) {
      throw new Error("Only creator or admin can remove collaborators");
    }

    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser || targetUser.orgId !== actor.orgId) {
      throw new Error("Collaborator must be in the same school");
    }

    const existing = agent.collaborators ?? [];
    if (!existing.includes(targetUser._id)) {
      return { ok: true };
    }

    await ctx.db.patch(agent._id, {
      collaborators: existing.filter((id) => id !== targetUser._id),
      updatedAt: Date.now(),
    });

    return { ok: true };
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

    return result.filter((agent) => canViewAgent(agent, actor));
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
