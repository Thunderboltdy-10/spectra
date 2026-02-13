import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import { vStudyMode, vThinkingLevel, vRouterMode, vCitation, vRouteTrace } from "./shared";

export const listChats = query({
  args: {
    actorClerkId: v.string(),
    packId: v.optional(v.id("packs")),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const chats = await ctx.db
      .query("chats")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", actor._id))
      .collect();

    const sorted = chats
      .filter((chat) => !chat.deletedAt)
      .filter((chat) => (args.packId ? chat.packId === args.packId : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30);

    const withPrompt = await Promise.all(
      sorted.map(async (chat) => {
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
          .collect();

        const latestUser = [...messages].reverse().find((message) => message.role === "user");
        return {
          ...chat,
          latestUserPrompt: latestUser?.content?.slice(0, 120),
        };
      }),
    );

    return withPrompt;
  },
});

export const createChat = mutation({
  args: {
    actorClerkId: v.string(),
    packId: v.optional(v.id("packs")),
    agentId: v.optional(v.id("agents")),
    mode: vStudyMode,
    thinkingLevel: vThinkingLevel,
    routerMode: vRouterMode,
    manualModel: v.optional(v.string()),
    usePersonalResources: v.boolean(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    if (args.packId) {
      const pack = await ctx.db.get(args.packId);
      if (!pack || pack.orgId !== actor.orgId) {
        throw new Error("Pack not found");
      }
    }

    const agentId = args.agentId;
    if (agentId) {
      const agent = await ctx.db.get(agentId);
      if (!agent || agent.orgId !== actor.orgId) {
        throw new Error("Agent not found");
      }
      if (agent.visibility === "private" && agent.creatorUserId !== actor._id && actor.role !== "admin") {
        throw new Error("Not authorized for this agent");
      }
    }

    const now = Date.now();
    const chatId = await ctx.db.insert("chats", {
      orgId: actor.orgId,
      packId: args.packId,
      agentId,
      ownerUserId: actor._id,
      title: args.title ?? "New chat",
      mode: args.mode,
      thinkingLevel: args.thinkingLevel,
      routerMode: args.routerMode,
      manualModel: args.manualModel,
      usePersonalResources: args.usePersonalResources,
      contextSummary: undefined,
      createdAt: now,
      updatedAt: now,
    });

    return { chatId };
  },
});

export const getChat = query({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.orgId !== actor.orgId || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();

    return {
      chat,
      messages: messages.sort((a, b) => a.createdAt - b.createdAt),
    };
  },
});

export const appendMessage = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    enhancedContent: v.optional(v.string()),
    mode: vStudyMode,
    packId: v.optional(v.id("packs")),
    citations: v.array(vCitation),
    modelRequested: v.optional(v.string()),
    modelUsed: v.optional(v.string()),
    whyThisResponse: v.optional(v.string()),
    usageIn: v.optional(v.number()),
    usageOut: v.optional(v.number()),
    verificationPassed: v.optional(v.boolean()),
    routeTrace: vRouteTrace,
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.orgId !== actor.orgId || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      orgId: actor.orgId,
      packId: args.packId ?? chat.packId,
      chatId: chat._id,
      userId: actor._id,
      role: args.role,
      mode: args.mode,
      content: args.content,
      enhancedContent: args.enhancedContent,
      citations: args.citations,
      modelRequested: args.modelRequested,
      modelUsed: args.modelUsed,
      whyThisResponse: args.whyThisResponse,
      usageIn: args.usageIn,
      usageOut: args.usageOut,
      verificationPassed: args.verificationPassed,
      routeTrace: args.routeTrace,
      createdAt: now,
    });

    await ctx.db.patch(chat._id, {
      updatedAt: now,
      title:
        chat.title === "New chat" && args.role === "user"
          ? args.content.slice(0, 60)
          : chat.title,
      mode: args.mode,
    });

    return { messageId };
  },
});

export const updateChatSettings = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    mode: v.optional(vStudyMode),
    thinkingLevel: v.optional(vThinkingLevel),
    routerMode: v.optional(vRouterMode),
    manualModel: v.optional(v.string()),
    usePersonalResources: v.optional(v.boolean()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    await ctx.db.patch(args.chatId, {
      mode: args.mode ?? chat.mode,
      thinkingLevel: args.thinkingLevel ?? chat.thinkingLevel,
      routerMode: args.routerMode ?? chat.routerMode,
      manualModel: args.manualModel ?? chat.manualModel,
      usePersonalResources: args.usePersonalResources ?? chat.usePersonalResources,
      title: args.title ?? chat.title,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const setContextSummary = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    contextSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    await ctx.db.patch(chat._id, {
      contextSummary: args.contextSummary,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const setChatTitle = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    await ctx.db.patch(args.chatId, {
      title: args.title,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const pinChat = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    await ctx.db.patch(args.chatId, {
      pinned: args.pinned,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const deleteChat = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    await ctx.db.patch(args.chatId, { deletedAt: Date.now(), updatedAt: Date.now() });
    return { ok: true };
  },
});

export const deleteLastAssistantMessage = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();

    const lastAssistant = [...messages]
      .sort((a, b) => a.createdAt - b.createdAt)
      .reverse()
      .find((message) => message.role === "assistant");

    if (!lastAssistant) {
      return { deleted: false };
    }

    await ctx.db.delete(lastAssistant._id);
    await ctx.db.patch(chat._id, { updatedAt: Date.now() });
    return { deleted: true };
  },
});

export const deleteLastUserMessage = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    expectedContent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();

    const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
    const last = sorted[sorted.length - 1];
    if (!last || last.role !== "user") {
      return { deleted: false };
    }

    if (args.expectedContent && last.content.trim() !== args.expectedContent.trim()) {
      return { deleted: false };
    }

    await ctx.db.delete(last._id);
    await ctx.db.patch(chat._id, { updatedAt: Date.now() });
    return { deleted: true };
  },
});
