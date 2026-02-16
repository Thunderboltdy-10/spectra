import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { EMBEDDING_DIMENSIONS } from "./constants";
import {
  vStudyMode,
  vThinkingLevel,
  vRouterMode,
  vStrictness,
  vRole,
  vScope,
  vCitation,
  vRouteTrace,
} from "./shared";

export default defineSchema({
  orgs: defineTable({
    name: v.string(),
    slug: v.string(),
    tokenBudgetDaily: v.number(),
    verifyMarkerPassEnabled: v.boolean(),
    allowPaidModels: v.optional(v.boolean()),
    orchestratorV2Enabled: v.optional(v.boolean()),
    soulEnabled: v.optional(v.boolean()),
    agentModelBoostEnabled: v.optional(v.boolean()),
    adaptiveQuizEnabled: v.optional(v.boolean()),
    spacedRepetitionEnabled: v.optional(v.boolean()),
    logoStorageId: v.optional(v.id("_storage")),
    primaryColor: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    welcomeMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"]),

  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    role: vRole,
    orgId: v.id("orgs"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_org", ["orgId"])
    .index("by_org_role", ["orgId", "role"]),

  packs: defineTable({
    orgId: v.id("orgs"),
    ownerUserId: v.id("users"),
    name: v.string(),
    subject: v.string(),
    academicYear: v.string(),
    strictness: vStrictness,
    defaultModel: v.optional(v.string()),
    allowedModels: v.array(v.string()),
    guidelinesSummary: v.optional(v.string()),
    guidelinesTopicMap: v.array(v.string()),
    guidelinesRubricHints: v.array(v.string()),
    guidelinesMisconceptions: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_owner", ["ownerUserId"]),

  resources: defineTable({
    orgId: v.id("orgs"),
    ownerUserId: v.id("users"),
    packId: v.optional(v.id("packs")),
    agentId: v.optional(v.id("agents")),
    scope: vScope,
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    contentHash: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    parsedCharCount: v.number(),
    status: v.union(v.literal("uploaded"), v.literal("processed"), v.literal("failed")),
    error: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_pack", ["packId"])
    .index("by_agent", ["agentId"])
    .index("by_owner_scope", ["ownerUserId", "scope"])
    .index("by_org_scope", ["orgId", "scope"]),

  chunks: defineTable({
    orgId: v.id("orgs"),
    packId: v.optional(v.id("packs")),
    agentId: v.optional(v.id("agents")),
    ownerUserId: v.optional(v.id("users")),
    scope: vScope,
    resourceId: v.id("resources"),
    filename: v.string(),
    page: v.optional(v.number()),
    text: v.string(),
    embedding: v.array(v.float64()),
    createdAt: v.number(),
    })
    .index("by_resource", ["resourceId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: ["orgId", "packId", "agentId", "ownerUserId", "scope"],
    }),

  agents: defineTable({
    orgId: v.id("orgs"),
    creatorUserId: v.id("users"),
    name: v.string(),
    description: v.string(),
    systemPrompt: v.string(),
    avatarEmoji: v.string(),
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
    usageCount: v.number(),
    guidelinesSummary: v.optional(v.string()),
    guidelinesTopicMap: v.optional(v.array(v.string())),
    resourceCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_creator", ["creatorUserId"])
    .index("by_org_category", ["orgId", "category"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["orgId", "visibility"],
    }),

  agentModelStats: defineTable({
    agentId: v.id("agents"),
    modelId: v.string(),
    totalUses: v.number(),
    positiveRatings: v.number(),
    negativeRatings: v.number(),
    avgResponseQuality: v.number(),
    lastUsedAt: v.number(),
  })
    .index("by_agent", ["agentId"])
    .index("by_agent_model", ["agentId", "modelId"]),

  chats: defineTable({
    orgId: v.id("orgs"),
    packId: v.optional(v.id("packs")),
    agentId: v.optional(v.id("agents")),
    ownerUserId: v.id("users"),
    title: v.string(),
    pinned: v.optional(v.boolean()),
    mode: vStudyMode,
    thinkingLevel: vThinkingLevel,
    routerMode: vRouterMode,
    manualModel: v.optional(v.string()),
    usePersonalResources: v.boolean(),
    contextSummary: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_org", ["orgId"]),

  messages: defineTable({
    orgId: v.id("orgs"),
    packId: v.optional(v.id("packs")),
    chatId: v.id("chats"),
    userId: v.id("users"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    mode: vStudyMode,
    content: v.string(),
    attachments: v.optional(v.array(v.string())),
    attachmentResourceIds: v.optional(v.array(v.id("resources"))),
    enhancedContent: v.optional(v.string()),
    citations: v.array(vCitation),
    modelRequested: v.optional(v.string()),
    modelUsed: v.optional(v.string()),
    whyThisResponse: v.optional(v.string()),
    usageIn: v.optional(v.number()),
    usageOut: v.optional(v.number()),
    verificationPassed: v.optional(v.boolean()),
    thinkingContent: v.optional(v.string()),
    routeTrace: vRouteTrace,
    createdAt: v.number(),
  })
    .index("by_chat", ["chatId"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_org", ["orgId"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["userId"],
    }),

  usageDaily: defineTable({
    orgId: v.id("orgs"),
    day: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_day", ["orgId", "day"]),

  usageEvents: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    chatId: v.optional(v.id("chats")),
    messageId: v.optional(v.id("messages")),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    costCents: v.optional(v.number()),
    pricingNote: v.optional(v.string()),
    day: v.string(),
    createdAt: v.number(),
  })
    .index("by_org_day", ["orgId", "day"])
    .index("by_user_day", ["userId", "day"]),

  userSpending: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    monthKey: v.string(),
    totalCostCents: v.number(),
    lastUpdatedAt: v.number(),
  })
    .index("by_user_month", ["userId", "monthKey"])
    .index("by_org_month", ["orgId", "monthKey"]),

  userMemory: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    rawMemoryText: v.string(),
    entries: v.array(
      v.object({
        key: v.string(),
        value: v.string(),
        confidence: v.number(),
        extractedAt: v.number(),
      }),
    ),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  studentAnalytics: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    day: v.string(),
    sessionsCount: v.number(),
    messagesCount: v.number(),
    topicsExplored: v.array(v.string()),
    modesUsed: v.array(v.string()),
    modelsUsed: v.array(v.string()),
    quizScores: v.array(v.number()),
    quizDifficultyLevel: v.optional(v.number()),
    totalTokensUsed: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_day", ["userId", "day"])
    .index("by_org_day", ["orgId", "day"]),

  weeklySummaries: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    weekKey: v.string(),
    insights: v.array(v.string()),
    suggestions: v.array(v.string()),
    strengths: v.array(v.string()),
    improvements: v.array(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_org_week", ["orgId", "weekKey"]),

  nudges: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    type: v.string(),
    message: v.string(),
    actionUrl: v.optional(v.string()),
    dismissed: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["orgId"]),

  flashcardProgress: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    cardHash: v.string(),
    easeFactor: v.number(),
    interval: v.number(),
    nextReviewAt: v.number(),
    repetitions: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_card", ["userId", "cardHash"])
    .index("by_user_due", ["userId", "nextReviewAt"]),

  quizResults: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    questions: v.array(
      v.object({
        id: v.string(),
        prompt: v.string(),
        selected: v.optional(v.string()),
        correct: v.optional(v.string()),
        isCorrect: v.boolean(),
        explanation: v.optional(v.string()),
      }),
    ),
    score: v.number(),
    total: v.number(),
    submittedAt: v.number(),
  })
    .index("by_user_submitted", ["userId", "submittedAt"])
    .index("by_chat_submitted", ["chatId", "submittedAt"])
    .index("by_message", ["messageId"]),

  flashcardDecks: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    chatId: v.id("chats"),
    sourceMessageId: v.optional(v.id("messages")),
    title: v.string(),
    cards: v.array(
      v.object({
        front: v.string(),
        back: v.string(),
        cardHash: v.string(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastReviewedAt: v.optional(v.number()),
  })
    .index("by_user_updated", ["userId", "updatedAt"])
    .index("by_chat_updated", ["chatId", "updatedAt"]),

  orgSoulDocs: defineTable({
    orgId: v.id("orgs"),
    title: v.string(),
    section: v.string(),
    content: v.string(),
    version: v.number(),
    publishedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"]),

  orgSoulChunks: defineTable({
    orgId: v.id("orgs"),
    docId: v.id("orgSoulDocs"),
    text: v.string(),
    embedding: v.array(v.float64()),
    createdAt: v.number(),
  })
    .index("by_doc", ["docId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: ["orgId"],
    }),

  generatedImages: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    chatId: v.id("chats"),
    prompt: v.string(),
    imageUrl: v.string(),
    model: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_chat", ["chatId"]),

  modelCatalog: defineTable({
    orgId: v.id("orgs"),
    modelId: v.string(),
    name: v.string(),
    provider: v.string(),
    description: v.string(),
    contextLength: v.optional(v.number()),
    inputCostPerM: v.optional(v.number()),
    outputCostPerM: v.optional(v.number()),
    tags: v.array(v.string()),
    costRating: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    speedRating: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    reasoningRating: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    multimodalRating: v.union(v.literal("none"), v.literal("basic"), v.literal("strong")),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_model", ["orgId", "modelId"]),
});
