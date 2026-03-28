import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import { vStudyMode, vThinkingLevel, vRouterMode, vCitation, vRouteTrace } from "./shared";
import { computeCompactionWindow } from "./compaction";
import { MODEL_DEFAULTS } from "./constants";
import { internal } from "./_generated/api";
import { getOpenRouterApiKey, warnOpenRouterMissing } from "./env";

function compactMessageText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function summarizeChatTitle(value: string) {
  const words = compactMessageText(value).split(" ").filter(Boolean);
  if (words.length === 0) return "New chat";
  if (words.length === 1) return `${words[0]} session`.slice(0, 80);
  return words.slice(0, 5).join(" ").slice(0, 80);
}

function collectArtifactReferences(messages: Array<{ role: "user" | "assistant" | "system"; content: string }>) {
  const artifactRegex = /\b(artifact|flashcard|deck|document|canvas|diagram|image|timeline|table|bookmark)\b/i;
  return messages
    .map((message) => compactMessageText(message.content))
    .filter((line) => artifactRegex.test(line))
    .slice(0, 6)
    .map((line) => `- ${line.slice(0, 180)}`);
}

function collectUnresolvedGoals(messages: Array<{ role: "user" | "assistant" | "system"; content: string }>) {
  const userPrompts = messages
    .filter((message) => message.role === "user")
    .map((message) => compactMessageText(message.content))
    .filter(Boolean);
  if (userPrompts.length === 0) {
    return ["- No unresolved goal captured."];
  }
  return userPrompts.slice(-3).map((line) => `- ${line.slice(0, 180)}`);
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
    "Unresolved Goals",
    ...collectUnresolvedGoals(messages),
    "Artifact References",
    ...collectArtifactReferences(messages),
    "Next Steps",
    "- Continue from recent messages and verify against cited sources/rubric.",
  ];

  return lines.join("\n").slice(0, 2000);
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function compactionTranscript(messages: Array<{ role: "user" | "assistant" | "system"; content: string; mode: string }>) {
  return messages
    .map((message) => `${message.role.toUpperCase()} [${message.mode}]: ${compactMessageText(message.content).slice(0, 320)}`)
    .join("\n\n")
    .slice(0, 16_000);
}

async function generateLlmCompactionSummary(params: {
  messages: Array<{ role: "user" | "assistant" | "system"; content: string; mode: string }>;
}) {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    warnOpenRouterMissing("chat_compaction");
    return null;
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_DEFAULTS.tutorFast,
      temperature: 0.1,
      max_tokens: 420,
      messages: [
        {
          role: "system",
          content:
            "Summarize this study chat for context compaction. Output plain text only with these headings exactly: Goals, Attempts, Key Guidance, Outstanding Questions, Unresolved Goals, Artifact References, Next Steps. Keep it concise (120-220 words) and preserve unresolved goals and artifact mentions.",
        },
        {
          role: "user",
          content: compactionTranscript(params.messages),
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Compaction summary request failed: ${await response.text()}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number | string;
      completion_tokens?: number | string;
      cost?: number | string;
    };
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) return null;
  return {
    summary: content.slice(0, 2000),
    usage: json.usage
      ? {
          prompt_tokens: toFiniteNumber(json.usage.prompt_tokens),
          completion_tokens: toFiniteNumber(json.usage.completion_tokens),
          cost: toFiniteNumber(json.usage.cost),
        }
      : undefined,
  };
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
    workstreamId: v.optional(v.id("workstreams")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const max = Math.max(1, Math.min(args.limit ?? 120, 300));
    const chats = args.packId
      ? await ctx.db
          .query("chats")
          .withIndex("by_owner_pack_updated", (q) => q.eq("ownerUserId", actor._id).eq("packId", args.packId))
          .order("desc")
          .take(max)
      : args.workstreamId
        ? await ctx.db
            .query("chats")
            .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
            .order("desc")
            .take(max)
            .then((rows) => rows.filter((c) => c.ownerUserId === actor._id && c.orgId === actor.orgId))
        : await ctx.db
            .query("chats")
            .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id))
            .order("desc")
            .take(max);

    return chats
      .filter((chat) => !chat.deletedAt)
      .filter((chat) => (args.packId ? chat.packId === args.packId : true))
      .filter((chat) => (args.workstreamId ? chat.workstreamId === args.workstreamId : true))
      .slice(0, max)
      .map((chat) => ({
        _id: chat._id,
        title: chat.title,
        latestUserPrompt: chat.latestUserPrompt?.slice(0, 120),
        mode: chat.mode,
        packId: chat.packId,
        agentId: chat.agentId,
        workstreamId: chat.workstreamId,
        pinned: chat.pinned,
        updatedAt: chat.updatedAt,
      }));
  },
});

export const listRecentAssistantModels = query({
  args: {
    actorClerkId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const limit = Math.max(1, Math.min(args.limit ?? 24, 80));
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_user_created", (q) => q.eq("userId", actor._id))
      .order("desc")
      .take(Math.max(limit * 4, 40));

    const models: string[] = [];
    for (const row of rows) {
      if (row.role !== "assistant") continue;
      if (!row.modelUsed || !row.modelUsed.trim()) continue;
      models.push(row.modelUsed.trim());
      if (models.length >= limit) break;
    }
    return models;
  },
});

export const createChat = mutation({
  args: {
    actorClerkId: v.string(),
    packId: v.optional(v.id("packs")),
    agentId: v.optional(v.id("agents")),
    workstreamId: v.optional(v.id("workstreams")),
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

    if (args.workstreamId) {
      const workstream = await ctx.db.get(args.workstreamId);
      if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
        throw new Error("Workstream not found");
      }
    }

    const now = Date.now();
    const chatId = await ctx.db.insert("chats", {
      orgId: actor.orgId,
      packId: args.packId,
      agentId,
      workstreamId: args.workstreamId,
      ownerUserId: actor._id,
      title: args.title ?? "New chat",
      latestUserPrompt: undefined,
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
      .withIndex("by_chat_created", (q) => q.eq("chatId", args.chatId))
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
    parentMessageId: v.optional(v.id("messages")),
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
    cancelled: v.optional(v.boolean()),
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

    let parentMessageId = undefined as typeof args.parentMessageId;
    let siblingIndex: number | undefined;
    let siblingCount: number | undefined;
    let existingAssistantSiblings: Array<{ _id: NonNullable<typeof args.parentMessageId>; createdAt: number }> = [];

    if (args.role === "assistant" && args.parentMessageId) {
      const parent = await ctx.db.get(args.parentMessageId);
      if (!parent || parent.chatId !== chat._id || parent.userId !== actor._id || parent.role !== "user") {
        throw new Error("Invalid assistant parent message");
      }

      parentMessageId = parent._id;
      const siblings = await ctx.db
        .query("messages")
        .withIndex("by_parent_message", (q) => q.eq("parentMessageId", parent._id))
        .collect();
      existingAssistantSiblings = siblings
        .filter((row) => row.role === "assistant")
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((row) => ({ _id: row._id, createdAt: row.createdAt }));
      siblingIndex = existingAssistantSiblings.length;
      siblingCount = existingAssistantSiblings.length + 1;
    }

    const messageId = await ctx.db.insert("messages", {
      orgId: actor.orgId,
      packId: args.packId ?? chat.packId,
      chatId: chat._id,
      userId: actor._id,
      clientMessageId: args.role === "user" ? normalizedClientMessageId : undefined,
      role: args.role,
      parentMessageId,
      siblingIndex,
      siblingCount,
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
      cancelled: args.cancelled,
      createdAt: now,
    });

    if (args.role === "assistant" && parentMessageId && typeof siblingCount === "number") {
      const orderedAssistantSiblings = [...existingAssistantSiblings, { _id: messageId, createdAt: now }]
        .sort((a, b) => a.createdAt - b.createdAt);
      for (let i = 0; i < orderedAssistantSiblings.length; i += 1) {
        const row = orderedAssistantSiblings[i]!;
        await ctx.db.patch(row._id, {
          siblingIndex: i,
          siblingCount: orderedAssistantSiblings.length,
        });
      }
    }

    await ctx.db.patch(chat._id, {
      updatedAt: now,
      title:
        chat.title === "New chat" && args.role === "user"
          ? summarizeChatTitle(args.content)
          : chat.title,
      latestUserPrompt:
        args.role === "user"
          ? compactMessageText(args.content).slice(0, 120)
          : chat.latestUserPrompt,
      mode: args.mode,
    });

    return { messageId, deduped: false };
  },
});

export const editMessageAsSibling = mutation({
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

    const allMessages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", target.chatId))
      .collect();
    const groupParent = target.parentMessageId ?? target._id;
    const siblingCandidates = allMessages
      .filter((row) => row.role === "user")
      .filter((row) => (row.parentMessageId ?? row._id) === groupParent)
      .sort((a, b) => a.createdAt - b.createdAt);

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      orgId: target.orgId,
      packId: target.packId,
      chatId: target.chatId,
      userId: target.userId,
      role: "user",
      mode: target.mode,
      content: clean,
      attachments: target.attachments,
      attachmentResourceIds: target.attachmentResourceIds,
      citations: [],
      modelRequested: undefined,
      modelUsed: undefined,
      whyThisResponse: undefined,
      usageIn: undefined,
      usageOut: undefined,
      verificationPassed: undefined,
      thinkingContent: undefined,
      routeTrace: undefined,
      cancelled: undefined,
      parentMessageId: groupParent,
      siblingIndex: siblingCandidates.length,
      siblingCount: siblingCandidates.length + 1,
      createdAt: now,
    });

    const orderedSiblings = [
      ...siblingCandidates.map((row) => ({ _id: row._id, createdAt: row.createdAt })),
      { _id: messageId, createdAt: now },
    ]
      .sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 0; i < orderedSiblings.length; i += 1) {
      const row = orderedSiblings[i]!;
      await ctx.db.patch(row._id, {
        siblingIndex: i,
        siblingCount: orderedSiblings.length,
      });
    }

    await ctx.db.patch(chat._id, {
      updatedAt: now,
      title: summarizeChatTitle(clean) || chat.title,
      latestUserPrompt: compactMessageText(clean).slice(0, 120),
    });

    return {
      chatId: target.chatId,
      messageId,
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
    let latestUserPrompt: string | undefined;
    const chatId = await ctx.db.insert("chats", {
      orgId: sourceChat.orgId,
      packId: sourceChat.packId,
      agentId: sourceChat.agentId,
      ownerUserId: sourceChat.ownerUserId,
      title: branchedTitle,
      latestUserPrompt: sourceChat.latestUserPrompt,
      mode: sourceChat.mode,
      thinkingLevel: sourceChat.thinkingLevel,
      routerMode: sourceChat.routerMode,
      manualModel: sourceChat.manualModel,
      usePersonalResources: sourceChat.usePersonalResources,
      contextSummary: sourceChat.contextSummary,
      learningContext: sourceChat.learningContext,
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 0; i <= pivotIndex; i += 1) {
      const row = sorted[i]!;
      if (row.role === "user") {
        latestUserPrompt = compactMessageText(row.content).slice(0, 120);
      }
      await ctx.db.insert("messages", {
        orgId: row.orgId,
        packId: row.packId,
        chatId,
        userId: row.userId,
        role: row.role,
        parentMessageId: row.parentMessageId,
        siblingIndex: row.siblingIndex,
        siblingCount: row.siblingCount,
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
        cancelled: row.cancelled,
        createdAt: now + i,
      });
    }

    if (latestUserPrompt) {
      await ctx.db.patch(chatId, {
        latestUserPrompt,
        updatedAt: now + pivotIndex + 1,
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
    agentId: v.optional(v.union(v.id("agents"), v.null())),
    workstreamId: v.optional(v.union(v.id("workstreams"), v.null())),
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

    let nextAgentId = chat.agentId;
    if (args.agentId !== undefined) {
      if (args.agentId === null) {
        nextAgentId = undefined;
      } else {
        const agent = await ctx.db.get(args.agentId);
        if (!agent || agent.orgId !== actor.orgId) {
          throw new Error("Agent not found");
        }
        const canAccess =
          actor.role === "admin"
          || agent.visibility === "public"
          || agent.creatorUserId === actor._id
          || (agent.collaborators ?? []).includes(actor._id);
        if (!canAccess) {
          throw new Error("Not authorized for this agent");
        }
        nextAgentId = agent._id;
      }
    }

    let nextWorkstreamId = chat.workstreamId;
    if (args.workstreamId !== undefined) {
      if (args.workstreamId === null) {
        nextWorkstreamId = undefined;
      } else {
        const workstream = await ctx.db.get(args.workstreamId);
        if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
          throw new Error("Workstream not found");
        }
        nextWorkstreamId = workstream._id;
      }
    }

    await ctx.db.patch(args.chatId, {
      mode: args.mode ?? chat.mode,
      thinkingLevel: args.thinkingLevel ?? chat.thinkingLevel,
      routerMode: args.routerMode ?? chat.routerMode,
      manualModel: args.manualModel ?? chat.manualModel,
      agentId: nextAgentId,
      workstreamId: nextWorkstreamId,
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

export const setLearningContext = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    learningContext: v.optional(v.string()),
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
      learningContext: args.learningContext,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const setRecentContext = mutation({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    recentContext: v.optional(v.string()),
    recentContextAt: v.optional(v.number()),
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
      recentContext: args.recentContext,
      recentContextAt: args.recentContextAt,
      updatedAt: Date.now(),
    } as any);

    return { ok: true };
  },
});

export const loadCompactionContextInternal = internalQuery({
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

    const allMessages = await ctx.db
      .query("messages")
      .withIndex("by_chat_created", (q) => q.eq("chatId", args.chatId))
      .collect();
    const sorted = allMessages.sort((a, b) => a.createdAt - b.createdAt);

    return {
      actorId: actor._id,
      actorOrgId: actor.orgId,
      chat: {
        _id: chat._id,
        contextSummary: chat.contextSummary,
        compactedUntilMessageId: chat.compactedUntilMessageId,
        contextSummaryVersion: chat.contextSummaryVersion,
      },
      messages: sorted.map((message) => ({
        _id: message._id,
        createdAt: message.createdAt,
        role: message.role,
        content: message.content,
        mode: message.mode,
      })),
    };
  },
});

export const applyCompactionInternal = internalMutation({
  args: {
    chatId: v.id("chats"),
    contextSummary: v.string(),
    compactedUntilMessageId: v.id("messages"),
    compactedAt: v.number(),
    contextSummaryVersion: v.number(),
    compactionQuality: v.union(v.literal("manual"), v.literal("llm"), v.literal("hybrid")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.chatId, {
      contextSummary: args.contextSummary,
      compactedUntilMessageId: args.compactedUntilMessageId,
      compactedAt: args.compactedAt,
      compactionQuality: args.compactionQuality,
      contextSummaryVersion: args.contextSummaryVersion,
      updatedAt: args.compactedAt,
    });
    return { ok: true };
  },
});

export const manualCompact: ReturnType<typeof action> = action({
  args: {
    actorClerkId: v.string(),
    chatId: v.id("chats"),
    keepLatestMessages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.chats.loadCompactionContextInternal, {
      actorClerkId: args.actorClerkId,
      chatId: args.chatId,
    });

    const window = computeCompactionWindow({
      messages: data.messages,
      keepLatestMessages: args.keepLatestMessages ?? 6,
      compactedUntilMessageId: data.chat.compactedUntilMessageId,
    });

    if (!window.ok) {
      return {
        ok: false,
        reason: window.reason,
        compactedMessages: 0,
        currentMessages: data.messages.length,
        minimumMessages: 12,
      };
    }

    const manualSummary = buildManualCompactionSummary(
      window.toCompact.map((message) => ({
        role: message.role,
        content: message.content,
        mode: message.mode,
      })),
    );

    let generatedSummary = manualSummary;
    let compactionQuality: "manual" | "llm" | "hybrid" = "manual";
    try {
      const llmSummary = await generateLlmCompactionSummary({
        messages: window.toCompact.map((message) => ({
          role: message.role,
          content: message.content,
          mode: message.mode,
        })),
      });
      if (llmSummary?.summary?.trim()) {
        const mustKeep = [
          ...collectUnresolvedGoals(window.toCompact),
          ...collectArtifactReferences(window.toCompact),
        ];
        const missingLines = mustKeep.filter((line) => {
          const needle = line.replace(/^- /, "").toLowerCase();
          return needle && !llmSummary.summary.toLowerCase().includes(needle.slice(0, 48));
        });
        generatedSummary =
          missingLines.length > 0
            ? `${llmSummary.summary.trim()}\n\nUnresolved Goals & Artifact References\n${missingLines.join("\n")}`.slice(0, 2000)
            : llmSummary.summary.trim().slice(0, 2000);
        compactionQuality = missingLines.length > 0 ? "hybrid" : "llm";

        if (llmSummary.usage) {
          await ctx.runMutation(internal.usage.recordUsageWithCostInternal, {
            userId: data.actorId,
            orgId: data.actorOrgId,
            chatId: args.chatId,
            model: MODEL_DEFAULTS.tutorFast,
            inputTokens: Math.max(0, Math.round(llmSummary.usage.prompt_tokens ?? 0)),
            outputTokens: Math.max(0, Math.round(llmSummary.usage.completion_tokens ?? 0)),
            openRouterCost:
              typeof llmSummary.usage.cost === "number" && Number.isFinite(llmSummary.usage.cost)
                ? Math.max(0, Number(llmSummary.usage.cost.toFixed(8)))
                : undefined,
          }).catch(() => {});
        }
      }
    } catch {
      compactionQuality = "manual";
      generatedSummary = manualSummary;
    }

    const contextSummary = mergeContextSummary(data.chat.contextSummary, generatedSummary);
    const compactedAt = Date.now();

    await ctx.runMutation(internal.chats.applyCompactionInternal, {
      chatId: data.chat._id,
      contextSummary,
      compactedUntilMessageId: window.compactedUntilMessageId,
      compactedAt,
      compactionQuality,
      contextSummaryVersion: (data.chat.contextSummaryVersion ?? 0) + 1,
    });

    return {
      ok: true,
      compactedMessages: window.toCompact.length,
      retainedMessages: window.retainedMessages,
      compactedUntilMessageId: window.compactedUntilMessageId,
      contextSummary,
      compactionQuality,
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
