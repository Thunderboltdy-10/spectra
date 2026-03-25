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
  vFeedbackCategory,
  vFeedbackStatus,
} from "./shared";

export default defineSchema({
  orgs: defineTable({
    name: v.string(),
    slug: v.string(),
    tokenBudgetDaily: v.number(),
    verifyMarkerPassEnabled: v.boolean(),
    allowPaidModels: v.optional(v.boolean()),
    orchestratorV2Enabled: v.optional(v.boolean()),
    searxngEnabled: v.optional(v.boolean()),
    monthlyBudgetCentsPerUser: v.optional(v.number()),
    budgetMarginPercent: v.optional(v.number()),
    maxResourceFileSizeBytes: v.optional(v.number()),
    soulEnabled: v.optional(v.boolean()),
    agentModelBoostEnabled: v.optional(v.boolean()),
    adaptiveQuizEnabled: v.optional(v.boolean()),
    spacedRepetitionEnabled: v.optional(v.boolean()),
    logoStorageId: v.optional(v.id("_storage")),
    primaryColor: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    welcomeMessage: v.optional(v.string()),
    description: v.optional(v.string()),
    schoolType: v.optional(v.string()),
    country: v.optional(v.string()),
    curriculum: v.optional(v.string()),
    examBoard: v.optional(v.string()),
    gradeLevels: v.optional(v.array(v.string())),
    timezone: v.optional(v.string()),
    maxStudents: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdBy: v.optional(v.string()),
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
    userStreakId: v.optional(v.id("userStreaks")),
    invitedAt: v.optional(v.number()),
    lastActiveAt: v.optional(v.number()),
    onboardingComplete: v.optional(v.boolean()),
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
    status: v.union(v.literal("uploaded"), v.literal("processing"), v.literal("processed"), v.literal("failed")),
    error: v.optional(v.string()),
    processingAttempts: v.optional(v.number()),
    pinned: v.optional(v.boolean()),
    saveToLibrary: v.optional(v.boolean()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_pack", ["packId"])
    .index("by_agent", ["agentId"])
    .index("by_owner_scope", ["ownerUserId", "scope"])
    .index("by_org_scope", ["orgId", "scope"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_expires", ["expiresAt"])
    .index("by_org_updated", ["orgId", "updatedAt"]),

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
    subjectArea: v.optional(v.string()),
    gradeLevel: v.optional(v.string()),
    systemPrompt: v.string(),
    avatarEmoji: v.string(),
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
    collaborators: v.optional(v.array(v.id("users"))),
    attachmentPolicy: v.optional(v.string()),
    accessLevel: v.optional(v.union(v.literal("private"), v.literal("class"), v.literal("school"))),
    moderationStatus: v.optional(v.union(v.literal("approved"), v.literal("pending"))),
    isStudentCreated: v.optional(v.boolean()),
    visibility: v.union(v.literal("public"), v.literal("private"), v.literal("shared")),
    usageCount: v.number(),
    lastUsedAt: v.optional(v.number()),
    guidelinesSummary: v.optional(v.string()),
    guidelinesTopicMap: v.optional(v.array(v.string())),
    guidelinesRubricHints: v.optional(v.array(v.string())),
    guidelinesMisconceptions: v.optional(v.array(v.string())),
    guidelinesVocabulary: v.optional(v.array(v.string())),
    guidelinesExamStructure: v.optional(v.array(v.string())),
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
    latestUserPrompt: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
    mode: vStudyMode,
    thinkingLevel: vThinkingLevel,
    routerMode: vRouterMode,
    manualModel: v.optional(v.string()),
    usePersonalResources: v.boolean(),
    contextSummary: v.optional(v.string()),
    learningContext: v.optional(v.string()),
    recentContext: v.optional(v.string()),
    recentContextAt: v.optional(v.number()),
    compactedUntilMessageId: v.optional(v.id("messages")),
    compactedAt: v.optional(v.number()),
    compactionQuality: v.optional(v.union(v.literal("manual"), v.literal("llm"), v.literal("hybrid"))),
    contextSummaryVersion: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_owner_updated", ["ownerUserId", "updatedAt"])
    .index("by_owner_pack_updated", ["ownerUserId", "packId", "updatedAt"])
    .index("by_org", ["orgId"]),

  messages: defineTable({
    orgId: v.id("orgs"),
    packId: v.optional(v.id("packs")),
    chatId: v.id("chats"),
    userId: v.id("users"),
    clientMessageId: v.optional(v.string()),
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
    cancelled: v.optional(v.boolean()),
    parentMessageId: v.optional(v.id("messages")),
    siblingIndex: v.optional(v.number()),
    siblingCount: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_chat", ["chatId"])
    .index("by_chat_created", ["chatId", "createdAt"])
    .index("by_chat_client_message", ["chatId", "clientMessageId"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_org", ["orgId"])
    .index("by_parent_message", ["parentMessageId"])
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
    cacheSavingsCents: v.optional(v.number()),
    pricingNote: v.optional(v.string()),
    finishReason: v.optional(v.string()),
    truncatedByLength: v.optional(v.boolean()),
    day: v.string(),
    createdAt: v.number(),
  })
    .index("by_org_day", ["orgId", "day"])
    .index("by_user_day", ["userId", "day"])
    .index("by_org_model_day", ["orgId", "model", "day"]),

  artifacts: defineTable({
    ownerUserId: v.id("users"),
    orgId: v.id("orgs"),
    type: v.string(),
    title: v.string(),
    content: v.any(),
    layout: v.optional(v.any()),
    status: v.union(v.literal("active"), v.literal("archived")),
    pinnedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_updated", ["ownerUserId", "updatedAt"])
    .index("by_org", ["orgId"])
    .index("by_type", ["type"])
    .index("by_owner_type", ["ownerUserId", "type"]),

  artifactVersions: defineTable({
    artifactId: v.id("artifacts"),
    diff: v.any(),
    authorType: v.union(v.literal("user"), v.literal("agent")),
    authorAgentId: v.optional(v.id("agents")),
    sourceChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    createdAt: v.number(),
  })
    .index("by_artifact", ["artifactId"])
    .index("by_chat", ["sourceChatId"]),

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
  })
    .index("by_user", ["userId"])
    .index("by_user_org", ["userId", "orgId"]),

  userMemoryEntries: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    key: v.string(),
    text: v.string(),
    embedding: v.array(v.float64()),
    category: v.union(
      v.literal("identity"),
      v.literal("academic"),
      v.literal("preference"),
      v.literal("topic"),
      v.literal("artifact"),
      v.literal("correction"),
    ),
    confidence: v.number(),
    status: v.union(v.literal("pending"), v.literal("confirmed")),
    sourceType: v.union(v.literal("extraction"), v.literal("user_explicit"), v.literal("correction")),
    sourceChatId: v.optional(v.id("chats")),
    relatedArtifacts: v.optional(v.array(v.string())),
    negativeTopicLinks: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_org", ["userId", "orgId"])
    .index("by_user_org_category", ["userId", "orgId", "category"])
    .index("by_user_org_status", ["userId", "orgId", "status"])
    .index("by_source_chat", ["sourceChatId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: ["userId", "orgId"],
    }),

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

  achievements: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    type: v.string(),
    name: v.string(),
    description: v.string(),
    xpEarned: v.number(),
    earnedAt: v.number(),
  }).index("by_user", ["userId"]),

  userStreaks: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    currentStreak: v.number(),
    longestStreak: v.number(),
    lastActiveDate: v.string(),
    totalXp: v.number(),
    chatTurns: v.optional(v.number()),
    tutorSessions: v.optional(v.number()),
    researchSessionsWithSources: v.optional(v.number()),
    imageResponses: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  studyTimers: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    chatId: v.optional(v.id("chats")),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    totalSeconds: v.number(),
    sessionType: v.union(v.literal("pomodoro"), v.literal("free")),
  }).index("by_user", ["userId"]),

  messageBookmarks: defineTable({
    userId: v.id("users"),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_chat", ["chatId"]),

  chatBranches: defineTable({
    originalChatId: v.id("chats"),
    parentMessageId: v.id("messages"),
    branchChatId: v.id("chats"),
    createdAt: v.number(),
  }).index("by_original", ["originalChatId"]),

  notifications: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    type: v.string(),
    title: v.string(),
    body: v.string(),
    actionUrl: v.optional(v.string()),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_unread", ["userId", "read"]),

  conversationTemplates: defineTable({
    orgId: v.id("orgs"),
    mode: v.string(),
    title: v.string(),
    description: v.string(),
    starterPrompts: v.array(v.string()),
    isDefault: v.boolean(),
    createdAt: v.number(),
  }).index("by_org_mode", ["orgId", "mode"]),

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

  quizSessions: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    messageId: v.id("messages"),
    answers: v.array(v.object({ questionId: v.string(), selected: v.string() })),
    startedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_user", ["userId"]),

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
    // New storage-based fields (preferred)
    storageId: v.optional(v.id("_storage")),
    servingUrl: v.optional(v.string()),
    thumbnailStorageId: v.optional(v.id("_storage")),
    thumbnailUrl: v.optional(v.string()),
    // Legacy field — old documents stored base64/URL here directly
    imageUrl: v.optional(v.string()),
    prompt: v.string(),
    model: v.optional(v.string()),
    size: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
    pinnedAt: v.optional(v.number()),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_chat", ["chatId"])
    .index("by_expires", ["expiresAt"])
    .index("by_pinned", ["userId", "pinned"]),

  feedback: defineTable({
    userId: v.optional(v.string()),
    orgId: v.optional(v.id("orgs")),
    category: vFeedbackCategory,
    message: v.string(),
    screenshotStorageId: v.optional(v.id("_storage")),
    context: v.object({
      mode: v.optional(v.string()),
      page: v.optional(v.string()),
      device: v.optional(v.string()),
      traceId: v.optional(v.string()),
      chatId: v.optional(v.string()),
      lastMessage: v.optional(v.string()),
      activeMode: v.optional(v.string()),
      activeModel: v.optional(v.string()),
      viewportSize: v.optional(v.string()),
    }),
    status: vFeedbackStatus,
    adminReply: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"]),

  auditLog: defineTable({
    actorUserId: v.id("users"),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    details: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_actor", ["actorUserId"])
    .index("by_created", ["createdAt"]),

  modelCatalog: defineTable({
    orgId: v.id("orgs"),
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

  modelRuntimeStats: defineTable({
    orgId: v.id("orgs"),
    modelId: v.string(),
    successCount: v.number(),
    failureCount: v.number(),
    totalLatencyMs: v.number(),
    avgLatencyMs: v.number(),
    consecutiveFailureCount: v.optional(v.number()),
    lastFailureAt: v.optional(v.number()),
    lengthFinishCount: v.optional(v.number()),
    totalResponseChars: v.optional(v.number()),
    positiveFeedbackCount: v.optional(v.number()),
    negativeFeedbackCount: v.optional(v.number()),
    qualityScore: v.optional(v.number()),
    challengerState: v.optional(v.union(v.literal("challenger"), v.literal("normal"), v.literal("deprioritized"))),
    lastEvaluatedAt: v.optional(v.number()),
    lastUsedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_model", ["orgId", "modelId"]),

  schoolInvitations: defineTable({
    orgId: v.id("orgs"),
    email: v.string(),
    role: vRole,
    invitedBy: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired")),
    token: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_email", ["email"])
    .index("by_token", ["token"]),

  accessRequests: defineTable({
    orgId: v.id("orgs"),
    requesterClerkId: v.optional(v.string()),
    email: v.string(),
    name: v.string(),
    message: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("invited"),
      v.literal("rejected"),
    ),
    resolvedRole: v.optional(vRole),
    resolvedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_email", ["orgId", "email"])
    .index("by_requester", ["requesterClerkId"]),

  userSoulPreferences: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    learningStyle: v.optional(v.string()),
    preferredDifficulty: v.optional(v.string()),
    interests: v.optional(v.array(v.string())),
    weakAreas: v.optional(v.array(v.string())),
    preferredModes: v.optional(v.array(v.string())),
    communicationStyle: v.optional(v.string()),
    customGuidance: v.optional(v.string()),
    onboardingComplete: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["orgId"]),

  errorEvents: defineTable({
    level: v.string(),
    message: v.string(),
    source: v.optional(v.string()),
    stack: v.optional(v.string()),
    metadata: v.optional(v.string()),
    actorClerkId: v.optional(v.string()),
    chatId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"]),
});
