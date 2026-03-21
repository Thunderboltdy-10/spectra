import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import { vStudyMode, vThinkingLevel, vRouterMode, vCitation, vRouteTrace } from "./shared";
import { computeCompactionWindow } from "./compaction";

function compactMessageText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function summarizeChatTitle(value: string) {
  const words = compactMessageText(value).split(" ").filter(Boolean);
  if (words.length === 0) return "New chat";
  if (words.length === 1) return `${words[0]} session`.slice(0, 80);
  return words.slice(0, 5).join(" ").slice(0, 80);
}

function buildManualCompactionSummary(messages: Array<{ role: "user" | "assistant" | "system"; content: string; mode: string }>) {
  const userGoals = messages
    .filter((message) => message.role === "user")
    .map((message) => compactMessageText(message.content).slice(0, 150))
    .filter(Boolean);

  const assistantGuidance = messages
    .filter((message) => message.role === "assistant")
    .map((message) => compactMessageText(message.content).slice(0, 150))
    .filter(Boolean);

  const lines = [
    "Goals",
    ...userGoals.slice(0, 3).map((line) => `- ${line}`),
    "Attempts",
    ...userGoals.slice(3, 6).map((line) => `- ${line}`),
    "Key Guidance",
    ...assistantGuidance.slice(0, 4).map((line) => `- ${line}`),
    "Outstanding Questions",
    userGoals.length > 0 ? `- ${userGoals[userGoals.length - 1]}` : "- No unresolved question captured.",
    "Next Steps",
    "- Continue from recent messages and verify against cited sources/rubric.",
  ];

  return lines.join("\n").slice(0, 2000);
}

function mergeContextSummary(existingSummary: string | undefined, generatedSummary: string) {
  const next = generatedSummary.trim();
  if (!next) return existingSummary?.trim() ?? "";
  const existing = existingSummary?.trim();
  const merged = existing ? `${existing}\n\n---\n${next}` : next;
  if (merged.length <= 2000) return merged;
  return merged.slice(-2000);
}

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
      .sort((a, b) => b.updatedAt - a.updatedAt);

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
      learningContext: undefined,
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
    clientMessageId: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    attachments: v.optional(v.array(v.string())),
    attachmentResourceIds: v.optional(v.array(v.id("resources"))),
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
    thinkingContent: v.optional(v.string()),
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
    const normalizedClientMessageId =
      typeof args.clientMessageId === "string" && args.clientMessageId.trim().length > 0
        ? args.clientMessageId.trim()
        : undefined;

    if (args.role === "user" && normalizedClientMessageId) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_chat_client_message", (q) =>
          q
            .eq("chatId", chat._id)
            .eq("clientMessageId", normalizedClientMessageId),
        )
        .unique();

      if (existing && existing.userId === actor._id && existing.role === "user") {
        return { messageId: existing._id, deduped: true };
      }
    }

    const messageId = await ctx.db.insert("messages", {
      orgId: actor.orgId,
      packId: args.packId ?? chat.packId,
      chatId: chat._id,
      userId: actor._id,
      clientMessageId: args.role === "user" ? normalizedClientMessageId : undefined,
      role: args.role,
      mode: args.mode,
      content: args.content,
      attachments: args.attachments,
      attachmentResourceIds: args.attachmentResourceIds,
      enhancedContent: args.enhancedContent,
      citations: args.citations,
      modelRequested: args.modelRequested,
      modelUsed: args.modelUsed,
      whyThisResponse: args.whyThisResponse,
      usageIn: args.usageIn,
      usageOut: args.usageOut,
      verificationPassed: args.verificationPassed,
      thinkingContent: args.thinkingContent,
      routeTrace: args.routeTrace,
      createdAt: now,
    });

    await ctx.db.patch(chat._id, {
      updatedAt: now,
      title:
        chat.title === "New chat" && args.role === "user"
          ? summarizeChatTitle(args.content)
          : chat.title,
      mode: args.mode,
    });

    return { messageId, deduped: false };
  },
});

export const editMessageAndPrune = mutation({
  args: {
    actorClerkId: v.string(),
    messageId: v.id("messages"),
    newContent: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const target = await ctx.db.get(args.messageId);
    if (!target || target.userId !== actor._id || target.role !== "user") {
      throw new Error("Message not found");
    }

    const chat = await ctx.db.get(target.chatId);
    if (!chat || chat.ownerUserId !== actor._id || chat.deletedAt) {
      throw new Error("Chat not found");
    }

    const clean = args.newContent.trim();
    if (!clean) {
      throw new Error("Message cannot be empty");
    }

    const all = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", target.chatId))
      .collect();
    const sorted = all.sort((a, b) => a.createdAt - b.createdAt);
    const idx = sorted.findIndex((row) => row._id === args.messageId);
    if (idx === -1) {
      throw new Error("Message not found");
    }

    await ctx.db.patch(target._id, {
      content: clean,
      enhancedContent: undefined,
    });

    for (let i = idx + 1; i < sorted.length; i += 1) {
      const row = sorted[i]!;
      await ctx.db.delete(row._id);
    }

    await ctx.db.patch(chat._id, {
      updatedAt: Date.now(),
      title: summarizeChatTitle(clean) || chat.title,
    });

    return {
      chatId: target.chatId,
      prunedCount: Math.max(0, sorted.length - idx - 1),
    };
  },
});

export const branchFromMessage = mutation({
  args: {
    actorClerkId: v.string(),
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const pivot = await ctx.db.get(args.messageId);
    if (!pivot || pivot.userId !== actor._id) {
      throw new Error("Message not found");
    }

    const sourceChat = await ctx.db.get(pivot.chatId);
    if (!sourceChat || sourceChat.ownerUserId !== actor._id || sourceChat.deletedAt) {
      throw new Error("Chat not found");
    }

    const allMessages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", sourceChat._id))
      .collect();
    const sorted = allMessages.sort((a, b) => a.createdAt - b.createdAt);
    const pivotIndex = sorted.findIndex((message) => message._id === pivot._id);
    if (pivotIndex < 0) {
      throw new Error("Message not found");
    }

    const now = Date.now();
    const branchedTitleBase = pivot.content.trim().slice(0, 56) || sourceChat.title;
    const branchedTitle = `${branchedTitleBase} (branch)`.slice(0, 80);
    const chatId = await ctx.db.insert("chats", {
      orgId: sourceChat.orgId,
      packId: sourceChat.packId,
      agentId: sourceChat.agentId,
      ownerUserId: sourceChat.ownerUserId,
      title: branchedTitle,
      mode: sourceChat.mode,
      thinkingLevel: sourceChat.thinkingLevel,
      routerMode: sourceChat.routerMode,
      manualModel: sourceChat.manualModel,
      usePersonalResources: sourceChat.usePersonalResources,
      contextSummary: sourceChat.contextSummary,
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 0; i <= pivotIndex; i += 1) {
      const row = sorted[i]!;
      await ctx.db.insert("messages", {
        orgId: row.orgId,
        packId: row.packId,
        chatId,
        userId: row.userId,
        role: row.role,
        mode: row.mode,
        content: row.content,
        attachments: row.attachments,
        attachmentResourceIds: row.attachmentResourceIds,
        enhancedContent: row.enhancedContent,
        citations: row.citations,
        modelRequested: row.modelRequested,
        modelUsed: row.modelUsed,
        whyThisResponse: row.whyThisResponse,
        usageIn: row.usageIn,
        usageOut: row.usageOut,
        verificationPassed: row.verificationPassed,
        thinkingContent: row.thinkingContent,
        routeTrace: row.routeTrace,
        createdAt: now + i,
      });
    }

    return { chatId };
  },
});

export const searchMessages = query({
  args: {
    actorClerkId: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const clean = args.query.trim();
    if (!clean) return [];

    const hits = await ctx.db
      .query("messages")
      .withSearchIndex("search_content", (q) => q.search("content", clean).eq("userId", actor._id))
      .take(Math.min(80, Math.max(1, args.limit ?? 30)));

    const out: Array<{
      chatId: string;
      chatTitle: string;
      messageSnippet: string;
      createdAt: number;
      messageId: string;
    }> = [];

    for (const hit of hits) {
      const chat = await ctx.db.get(hit.chatId);
      if (!chat || chat.ownerUserId !== actor._id || chat.deletedAt) continue;
      out.push({
        chatId: hit.chatId,
        chatTitle: chat.title,
        messageSnippet: hit.content.slice(0, 180),
        createdAt: hit.createdAt,
        messageId: hit._id,
      });
    }

    return out.sort((a, b) => b.createdAt - a.createdAt);
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

export const manualCompact = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    keepLatestMessages: v.optional(v.number()),
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

    const allMessages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();
    const sorted = allMessages.sort((a, b) => a.createdAt - b.createdAt);
    const window = computeCompactionWindow({
      messages: sorted.map((message) => ({
        _id: message._id,
        createdAt: message.createdAt,
        role: message.role,
        content: message.content,
        mode: message.mode,
      })),
      keepLatestMessages: args.keepLatestMessages ?? 6,
      compactedUntilMessageId: chat.compactedUntilMessageId,
    });

    if (!window.ok) {
      return {
        ok: false,
        reason: window.reason,
        compactedMessages: 0,
        currentMessages: sorted.length,
        minimumMessages: 20,
      };
    }

    const generatedSummary = buildManualCompactionSummary(
      window.toCompact.map((message) => ({
        role: message.role,
        content: message.content,
        mode: message.mode,
      })),
    );
    const contextSummary = mergeContextSummary(chat.contextSummary, generatedSummary);
    const compactedAt = Date.now();

    await ctx.db.patch(chat._id, {
      contextSummary,
      compactedUntilMessageId: window.compactedUntilMessageId,
      compactedAt,
      contextSummaryVersion: (chat.contextSummaryVersion ?? 0) + 1,
      updatedAt: compactedAt,
    });

    return {
      ok: true,
      compactedMessages: window.toCompact.length,
      retainedMessages: window.retainedMessages,
      compactedUntilMessageId: window.compactedUntilMessageId,
      contextSummary,
    };
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
    expectedClientMessageId: v.optional(v.string()),
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

    const expectedClientMessageId =
      typeof args.expectedClientMessageId === "string" && args.expectedClientMessageId.trim().length > 0
        ? args.expectedClientMessageId.trim()
        : undefined;

    if (expectedClientMessageId) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_chat_client_message", (q) =>
          q
            .eq("chatId", args.chatId)
            .eq("clientMessageId", expectedClientMessageId),
        )
        .unique();
      if (existing && existing.userId === actor._id && existing.role === "user") {
        await ctx.db.delete(existing._id);
        await ctx.db.patch(chat._id, { updatedAt: Date.now() });
        return { deleted: true };
      }
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
