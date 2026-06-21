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
    managebacConfig: v.optional(
      v.object({
        baseUrl: v.optional(v.string()),
        encryptedToken: v.string(),
        tokenLastFour: v.optional(v.string()),
        studentMappings: v.optional(
          v.array(
            v.object({
              clerkId: v.string(),
              managebacStudentId: v.string(),
              email: v.optional(v.string()),
            }),
          ),
        ),
        syncEnabled: v.optional(v.boolean()),
        syncFrequencyHours: v.optional(v.number()),
        lastSyncAt: v.optional(v.number()),
        lastSyncStatus: v.optional(v.union(v.literal("idle"), v.literal("success"), v.literal("error"))),
        lastSyncError: v.optional(v.string()),
        availableEndpoints: v.optional(v.any()),
        announcementsCache: v.optional(v.any()),
        lastSyncDetails: v.optional(v.any()),
        updatedAt: v.optional(v.number()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"]),

  managebacUserLinks: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    clerkId: v.string(),
    email: v.string(),
    managebacStudentId: v.optional(v.string()),
    managebacStudentName: v.optional(v.string()),
    managebacGradeLevel: v.optional(v.string()),
    resolutionStatus: v.union(v.literal("resolved"), v.literal("not_found"), v.literal("ambiguous"), v.literal("error")),
    resolutionCheckedAt: v.number(),
    resolutionError: v.optional(v.string()),
    lastHydratedAt: v.optional(v.number()),
    lastHydrationStatus: v.optional(v.union(v.literal("idle"), v.literal("success"), v.literal("error"))),
    lastHydrationError: v.optional(v.string()),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_org_email", ["orgId", "email"])
    .index("by_org_student_id", ["orgId", "managebacStudentId"]),

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
    .index("by_email", ["email"])
    .index("by_org", ["orgId"])
    .index("by_clerk_id_org", ["clerkId", "orgId"])
    .index("by_org_email", ["orgId", "email"])
    .index("by_org_role", ["orgId", "role"])
    .index("by_role", ["role"]),

  userPreferences: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    defaultLanding: v.union(v.literal("smart"), v.literal("workspace"), v.literal("chat")),
    workspaceLayout: v.optional(
      v.object({
        x: v.number(),
        y: v.number(),
        z: v.number(),
      }),
    ),
    workspaceViewMode: v.optional(v.union(v.literal("byType"), v.literal("byTopic"), v.literal("timeline"))),
    workspaceBackgroundMode: v.optional(v.union(v.literal("dots"), v.literal("blank"), v.literal("grid"))),
    workspaceHubVisibility: v.optional(v.union(v.literal("hidden"), v.literal("collapsed"), v.literal("expanded"))),
    workspaceAutoSelectContext: v.optional(v.boolean()),
    editorDefaultMode: v.optional(v.union(v.literal("agentic"), v.literal("notion"), v.literal("simple"))),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

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

  
  workspaceItems: defineTable({
    orgId: v.id("orgs"),
    ownerUserId: v.id("users"),
    workstreamId: v.optional(v.id("workstreams")),
    type: v.union(
      v.literal("thread"),
      v.literal("document"),
      v.literal("planner"),
      v.literal("board"),
      v.literal("visualization"),
      v.literal("media"),
      v.literal("reference"),
      v.literal("custom"),
      v.literal("utility")
    ),
    itemType: v.optional(v.union(
      v.literal("thread"),
      v.literal("artifact"),
      v.literal("planner"),
      v.literal("utility"),
      v.literal("custom"),
    )),
    sourceKind: v.optional(v.union(
      v.literal("chat"),
      v.literal("artifact"),
      v.literal("plannerItem"),
      v.literal("utility"),
      v.literal("custom"),
    )),
    sourceId: v.optional(v.string()),
    renderMode: v.optional(v.string()),
    sourceChatId: v.optional(v.id("chats")),
    sourceArtifactId: v.optional(v.id("artifacts")),
    sourcePlannerItemId: v.optional(v.id("plannerItems")),
    title: v.string(),
    contentSummary: v.optional(v.string()),
    x: v.number(),
    y: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    zIndex: v.optional(v.number()),
    category: v.optional(v.union(
      v.literal("threads"),
      v.literal("documents"),
      v.literal("planner"),
      v.literal("boards"),
      v.literal("visualizations"),
      v.literal("media"),
      v.literal("references"),
      v.literal("custom"),
    )),
    status: v.union(v.literal("active"), v.literal("archived")),
    pinned: v.optional(v.boolean()),
    collapsed: v.optional(v.boolean()),
    hidden: v.optional(v.boolean()),
    visualGroup: v.optional(v.string()),
    renderProps: v.optional(v.any()),
    provenanceSource: v.optional(v.union(
      v.literal("user"),
      v.literal("ai"),
      v.literal("system"),
    )),
    provenanceAction: v.optional(v.string()),
    topicCluster: v.optional(v.string()),
    clusterOverride: v.optional(v.string()),
    searchText: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workstream", ["workstreamId"])
    .index("by_owner", ["ownerUserId"])
    .index("by_source_artifact", ["sourceArtifactId"])
    .index("by_source_chat", ["sourceChatId"])
    .index("by_source_planner", ["sourcePlannerItemId"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["ownerUserId", "orgId", "workstreamId", "status", "itemType"],
    }),

  workspaceTopicClusters: defineTable({
    orgId: v.id("orgs"),
    ownerUserId: v.id("users"),
    workstreamId: v.id("workstreams"),
    clusterId: v.string(),
    generatedTitle: v.string(),
    userTitle: v.optional(v.string()),
    lastAppliedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workstream", ["workstreamId"])
    .index("by_workstream_cluster", ["workstreamId", "clusterId"]),

  ghostSuggestions: defineTable({
    orgId: v.id("orgs"),
    ownerUserId: v.id("users"),
    workstreamId: v.id("workstreams"),
    linkedAgentId: v.optional(v.id("agents")),
    sourceWorkspaceMutationId: v.optional(v.id("workspaceMutations")),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("dismissed"),
      v.literal("expired"),
    ),
    suggestionKind: v.union(
      v.literal("note"),
      v.literal("planner"),
      v.literal("quiz"),
      v.literal("flashcard_deck"),
      v.literal("visualization"),
      v.literal("code_project"),
    ),
    confidenceTier: v.union(
      v.literal("high"),
      v.literal("medium"),
      v.literal("low"),
    ),
    confidenceScore: v.number(),
    title: v.string(),
    summary: v.optional(v.string()),
    content: v.optional(v.string()),
    renderMode: v.optional(v.string()),
    category: v.optional(v.string()),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    similarityKey: v.string(),
    contextHash: v.string(),
    contextSignals: v.array(v.string()),
    resourceContext: v.optional(v.string()),
    generationModel: v.string(),
    modelLane: v.string(),
    generationReason: v.string(),
    unseenSessions: v.number(),
    lastSeenSessionKey: v.optional(v.string()),
    acceptedArtifactId: v.optional(v.id("artifacts")),
    acceptedWorkspaceItemId: v.optional(v.id("workspaceItems")),
    dismissedAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    expiredAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_workstream_status", ["ownerUserId", "workstreamId", "status"])
    .index("by_workstream_status", ["workstreamId", "status"])
    .index("by_similarity", ["ownerUserId", "similarityKey"])
    .index("by_status_updated", ["status", "updatedAt"]),

  ghostRegenerationState: defineTable({
    orgId: v.id("orgs"),
    ownerUserId: v.id("users"),
    workstreamId: v.id("workstreams"),
    status: v.union(v.literal("scheduled"), v.literal("running"), v.literal("idle")),
    scheduledAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    contextHash: v.optional(v.string()),
    trigger: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_workstream", ["workstreamId"])
    .index("by_owner_workstream", ["ownerUserId", "workstreamId"])
    .index("by_status_updated", ["status", "updatedAt"]),

  workspaceMutations: defineTable({
    orgId: v.id("orgs"),
    ownerUserId: v.id("users"),
    workstreamId: v.optional(v.id("workstreams")),
    targetWorkstreamId: v.optional(v.id("workstreams")),
    mutationType: v.string(),
    source: v.union(v.literal("user"), v.literal("ai"), v.literal("system")),
    summary: v.optional(v.string()),
    targetItemIds: v.optional(v.array(v.id("workspaceItems"))),
    affectedWorkstreamIds: v.optional(v.array(v.id("workstreams"))),
    revisionKey: v.optional(v.string()),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    revertData: v.optional(v.any()),
    status: v.union(v.literal("applied"), v.literal("reverted")),
    createdAt: v.number(),
    updatedAt: v.number(),
    revertedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_workstream", ["workstreamId"])
    .index("by_target_workstream", ["targetWorkstreamId"]),

  workspaceCommandResults: defineTable({
    orgId: v.id("orgs"),
    ownerUserId: v.id("users"),
    workstreamId: v.id("workstreams"),
    sourceChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    intent: v.union(
      v.literal("note"),
      v.literal("planner"),
      v.literal("thread"),
      v.literal("result"),
      v.literal("widget"),
    ),
    status: v.union(v.literal("processing"), v.literal("completed"), v.literal("dismissed")),
    title: v.string(),
    summary: v.string(),
    detail: v.optional(v.string()),
    variant: v.optional(v.union(
      v.literal("summary"),
      v.literal("answer"),
      v.literal("artifact"),
      v.literal("planner"),
      v.literal("thread"),
    )),
    targetKind: v.optional(v.union(
      v.literal("artifact"),
      v.literal("plannerItem"),
      v.literal("chat"),
      v.literal("workspaceItem"),
      v.literal("result"),
    )),
    targetId: v.optional(v.string()),
    topicCluster: v.optional(v.string()),
    timelineAt: v.optional(v.number()),
    signalStrength: v.optional(v.number()),
    threadStatus: v.optional(v.union(
      v.literal("open"),
      v.literal("resolved"),
      v.literal("blocked"),
    )),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
    dismissedAt: v.optional(v.number()),
  })
    .index("by_workstream_status", ["workstreamId", "status"])
    .index("by_workstream_updated", ["workstreamId", "updatedAt"])
    .index("by_chat", ["sourceChatId"]),

  workspaceWidgets: defineTable({
    orgId: v.id("orgs"),
    ownerUserId: v.id("users"),
    workstreamId: v.optional(v.id("workstreams")),
    kind: v.string(),
    title: v.string(),
    x: v.number(),
    y: v.number(),
    w: v.number(),
    h: v.number(),
    collapsed: v.optional(v.boolean()),
    hidden: v.optional(v.boolean()),
    state: v.optional(v.any()),
    source: v.optional(v.union(v.literal("user"), v.literal("ai"), v.literal("system"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_updated", ["ownerUserId", "updatedAt"])
    .index("by_workstream_updated", ["workstreamId", "updatedAt"]),

  workstreams: defineTable({
    ownerUserId: v.id("users"),
    orgId: v.id("orgs"),
    type: v.union(v.literal("subject"), v.literal("project"), v.literal("general")),
    title: v.string(),
    description: v.optional(v.string()),
    emoji: v.optional(v.string()),
    color: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("completed"), v.literal("archived")),
    canvasX: v.optional(v.number()),
    canvasY: v.optional(v.number()),
    canvasWidth: v.optional(v.number()),
    canvasHeight: v.optional(v.number()),
    subjectCode: v.optional(v.string()),
    managebacClassId: v.optional(v.string()),
    managebacContext: v.optional(v.any()),
    managebacInactiveSince: v.optional(v.number()),
    linkedAgentId: v.optional(v.id("agents")),
    linkedPackId: v.optional(v.id("packs")),
    defaultMode: v.optional(vStudyMode),
    defaultThinking: v.optional(vThinkingLevel),
    artifactCount: v.optional(v.number()),
    threadCount: v.optional(v.number()),
    lastActivityAt: v.optional(v.number()),
    workspaceRevision: v.optional(v.number()),
    workspaceRevisionKey: v.optional(v.string()),
    lastWorkspaceMutationId: v.optional(v.id("workspaceMutations")),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_owner_status", ["ownerUserId", "status"])
    .index("by_owner_updated", ["ownerUserId", "updatedAt"])
    .index("by_owner_status_updated", ["ownerUserId", "status", "updatedAt"])
    .index("by_org", ["orgId"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["ownerUserId", "orgId", "status", "type"],
    }),

  workstreamMemory: defineTable({
    workstreamId: v.id("workstreams"),
    ownerUserId: v.id("users"),
    orgId: v.id("orgs"),
    key: v.string(),
    text: v.string(),
    textHash: v.optional(v.string()),
    embedding: v.array(v.float64()),
    category: v.union(
      v.literal("concept"),
      v.literal("progress"),
      v.literal("preference"),
      v.literal("deadline"),
      v.literal("correction"),
      v.literal("resource_link"),
    ),
    confidence: v.number(),
    freshness: v.number(),
    sourceType: v.union(
      v.literal("chat_extraction"),
      v.literal("artifact_link"),
      v.literal("user_explicit"),
      v.literal("managebac_sync"),
      v.literal("agent_inference"),
    ),
    sourceChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    sourceArtifactId: v.optional(v.id("artifacts")),
    status: v.union(v.literal("active"), v.literal("superseded"), v.literal("dismissed")),
    supersededBy: v.optional(v.id("workstreamMemory")),
    archivedAt: v.optional(v.number()),
    lastDecayedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workstream", ["workstreamId"])
    .index("by_workstream_category", ["workstreamId", "category"])
    .index("by_workstream_status", ["workstreamId", "status"])
    .index("by_source_chat", ["sourceChatId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: ["workstreamId", "ownerUserId", "orgId", "status", "category"],
    }),

  plannerItems: defineTable({
    ownerUserId: v.id("users"),
    orgId: v.id("orgs"),
    workstreamId: v.optional(v.id("workstreams")),
    title: v.string(),
    description: v.optional(v.string()),
    type: v.union(v.literal("deadline"), v.literal("milestone"), v.literal("goal"), v.literal("reminder")),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    status: v.union(v.literal("pending"), v.literal("in_progress"), v.literal("completed"), v.literal("cancelled")),
    dueAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    sourceType: v.union(v.literal("user_manual"), v.literal("ai_suggested"), v.literal("managebac_sync")),
    sourceArtifactId: v.optional(v.id("artifacts")),
    sourceChatId: v.optional(v.id("chats")),
    managebacItemId: v.optional(v.string()),
    sourceDeleted: v.optional(v.boolean()),
    sourceUpdatedAt: v.optional(v.number()),
    syncConflictSummary: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_owner_status", ["ownerUserId", "status"])
    .index("by_workstream", ["workstreamId"])
    .index("by_due", ["dueAt"]),

  notes: defineTable({
    ownerUserId: v.id("users"),
    orgId: v.id("orgs"),
    workstreamId: v.optional(v.id("workstreams")),
    artifactId: v.optional(v.id("artifacts")),
    title: v.string(),
    content: v.any(),
    contentPlaintext: v.optional(v.string()),
    editorMode: v.union(v.literal("agentic"), v.literal("notion"), v.literal("simple")),
    sourceType: v.optional(v.union(v.literal("user_manual"), v.literal("ai_generated"), v.literal("managebac_sync"))),
    managebacItemId: v.optional(v.string()),
    sourceDeleted: v.optional(v.boolean()),
    sourceUpdatedAt: v.optional(v.number()),
    syncConflictSummary: v.optional(v.string()),
    lastAiEditId: v.optional(v.string()),
    pendingDiffs: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_updated", ["ownerUserId", "updatedAt"])
    .index("by_workstream", ["workstreamId"])
    .index("by_artifact", ["artifactId"])
    .searchIndex("search_content", {
      searchField: "contentPlaintext",
      filterFields: ["ownerUserId", "orgId"],
    }),

  chats: defineTable({
    orgId: v.id("orgs"),
    packId: v.optional(v.id("packs")),
    agentId: v.optional(v.id("agents")),
    workstreamId: v.optional(v.id("workstreams")),
    artifactId: v.optional(v.id("artifacts")),
    threadType: v.optional(v.union(v.literal("conversation"), v.literal("artifact_edit"))),
    ownerUserId: v.id("users"),
    title: v.string(),
    latestUserPrompt: v.optional(v.string()),
    messageCount: v.optional(v.number()),
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
    .index("by_workstream", ["workstreamId"])
    .index("by_artifact", ["artifactId"])
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
    eventType: v.optional(v.union(v.literal("model"), v.literal("search"))),
    provider: v.optional(v.string()),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    costCents: v.optional(v.number()),
    cacheSavingsCents: v.optional(v.number()),
    searchOperation: v.optional(v.string()),
    searchUnits: v.optional(v.number()),
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
    workstreamId: v.optional(v.id("workstreams")),
    type: v.string(),
    title: v.string(),
    content: v.any(),
    editorMode: v.optional(v.union(
      v.literal("standard"),
      v.literal("ai_enhanced"),
      v.literal("simple"),
      v.literal("notion"),
      v.literal("agentic"),
    )),
    contentPlaintext: v.optional(v.string()),
    sourceType: v.optional(v.union(v.literal("user_manual"), v.literal("ai_generated"), v.literal("managebac_sync"))),
    managebacItemId: v.optional(v.string()),
    sourceDeleted: v.optional(v.boolean()),
    sourceUpdatedAt: v.optional(v.number()),
    syncConflictSummary: v.optional(v.string()),
    lastAiEditId: v.optional(v.string()),
    pendingDiffs: v.optional(v.any()),
    legacyNoteId: v.optional(v.id("notes")),
    layout: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    linkedAgentId: v.optional(v.id("agents")),
    linkedChatId: v.optional(v.id("chats")),
    status: v.union(v.literal("active"), v.literal("archived")),
    pinnedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_updated", ["ownerUserId", "updatedAt"])
    .index("by_org", ["orgId"])
    .index("by_type", ["type"])
    .index("by_workstream", ["workstreamId"])
    .index("by_owner_type", ["ownerUserId", "type"])
    .index("by_legacy_note", ["legacyNoteId"])
    .searchIndex("search_content", {
      searchField: "contentPlaintext",
      filterFields: ["ownerUserId", "orgId", "type", "status", "workstreamId"],
    }),

  artifactVersions: defineTable({
    artifactId: v.id("artifacts"),
    diff: v.any(),
    snapshot: v.optional(v.any()),
    authorType: v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    authorAgentId: v.optional(v.id("agents")),
    sourceChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    description: v.optional(v.string()),
    status: v.optional(v.union(v.literal("applied"), v.literal("confirmed"), v.literal("discarded"))),
    createdAt: v.number(),
  })
    .index("by_artifact", ["artifactId"])
    .index("by_chat", ["sourceChatId"]),

  userSpending: defineTable({
    userId: v.id("users"),
    orgId: v.id("orgs"),
    monthKey: v.string(),
    totalCostCents: v.number(),
    knownCostCents: v.optional(v.number()),
    estimatedUnpricedCostCents: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    totalEvents: v.optional(v.number()),
    modelEvents: v.optional(v.number()),
    searchEvents: v.optional(v.number()),
    modelCostCents: v.optional(v.number()),
    searchCostCents: v.optional(v.number()),
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
    sourceMessageId: v.optional(v.id("messages")),
    sourceArtifactId: v.optional(v.id("artifacts")),
    sourceWorkstreamId: v.optional(v.id("workstreams")),
    freshness: v.optional(v.number()),
    scope: v.optional(v.union(v.literal("global"), v.literal("workstream"))),
    archivedAt: v.optional(v.number()),
    lastDecayedAt: v.optional(v.number()),
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
      filterFields: ["userId", "orgId", "scope", "status"],
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
    benchmarkArtificialAnalysisIntelligence: v.optional(v.number()),
    benchmarkArtificialAnalysisCoding: v.optional(v.number()),
    benchmarkArtificialAnalysisMath: v.optional(v.number()),
    arenaElo: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_featured", ["orgId", "isFeatured"])
    .index("by_org_model", ["orgId", "modelId"]),

  catalogSyncState: defineTable({
    orgId: v.optional(v.id("orgs")),
    source: v.string(),
    fingerprint: v.string(),
    modelCount: v.number(),
    includeEmbeddings: v.boolean(),
    endpointStatsCount: v.optional(v.number()),
    lastSyncedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_source_org", ["source", "orgId"])
    .index("by_updated", ["updatedAt"]),

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
    .index("by_org_status", ["orgId", "status"])
    .index("by_email", ["email"])
    .index("by_invited_by_created", ["invitedBy", "createdAt"])
    .index("by_token", ["token"]),

  platformStats: defineTable({
    singletonKey: v.string(),
    totalOrgs: v.number(),
    totalUsers: v.number(),
    totalMessages: v.number(),
    totalAdmins: v.number(),
    lastComputedAt: v.number(),
  })
    .index("by_singleton", ["singletonKey"]),

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

  spectraWorkspaces: defineTable({
    ownerUserId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    title: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    // Transitional compatibility for documents written before workspace pinning
    // moved to spectraWorkspaceItems.viewData. Seed repair removes this field.
    pinned: v.optional(v.boolean()),
    status: v.union(v.literal("active"), v.literal("archived")),
    defaultView: v.union(
      v.literal("cards"),
      v.literal("canvas"),
      v.literal("timeline"),
      v.literal("library"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastActivityAt: v.number(),
  })
    .index("by_owner_status", ["ownerUserId", "status"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_owner_activity", ["ownerUserId", "lastActivityAt"]),

  spectraArtifacts: defineTable({
    ownerUserId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    blueprintKey: v.string(),
    title: v.string(),
    summary: v.optional(v.string()),
    content: v.any(),
    textIndex: v.optional(v.string()),
    tags: v.array(v.string()),
    // Transitional compatibility for legacy object-level pinning. Pin state
    // now belongs to spectraWorkspaceItems.viewData.
    pinned: v.optional(v.boolean()),
    status: v.union(
      v.literal("active"),
      v.literal("draft"),
      v.literal("archived"),
      v.literal("deleted"),
    ),
    createdFrom: v.optional(v.object({
      source: v.union(
        v.literal("chat"),
        v.literal("workspace"),
        v.literal("artifact"),
        v.literal("manual"),
        v.literal("ai"),
      ),
      threadId: v.optional(v.id("spectraThreads")),
      runId: v.optional(v.id("spectraAiRuns")),
      workspaceId: v.optional(v.id("spectraWorkspaces")),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_status", ["ownerUserId", "status"])
    .index("by_owner_updated", ["ownerUserId", "updatedAt"])
    .index("by_owner_status_updated", ["ownerUserId", "status", "updatedAt"])
    .index("by_owner_blueprint", ["ownerUserId", "blueprintKey"])
    .index("by_created_workspace", ["createdFrom.workspaceId"])
    .searchIndex("search_text", {
      searchField: "textIndex",
      filterFields: ["ownerUserId", "blueprintKey", "status"],
    }),

  spectraWorkspaceItems: defineTable({
    workspaceId: v.id("spectraWorkspaces"),
    sourceType: v.union(
      v.literal("artifact"),
      v.literal("thread"),
      v.literal("task"),
      v.literal("widget"),
      v.literal("custom"),
    ),
    sourceId: v.string(),
    viewData: v.object({
      titleOverride: v.optional(v.string()),
      compactSummary: v.optional(v.string()),
      cardVariant: v.optional(v.string()),
      pinned: v.optional(v.boolean()),
      hidden: v.optional(v.boolean()),
    }),
    layout: v.object({
      view: v.union(v.literal("cards"), v.literal("canvas"), v.literal("timeline")),
      position: v.optional(v.object({ x: v.number(), y: v.number() })),
      size: v.optional(v.object({ w: v.number(), h: v.number() })),
      zIndex: v.optional(v.number()),
      collapsed: v.optional(v.boolean()),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_updated", ["workspaceId", "updatedAt"])
    .index("by_workspace_source", ["workspaceId", "sourceType", "sourceId"])
    .index("by_source", ["sourceType", "sourceId"]),

  spectraThreads: defineTable({
    ownerUserId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    title: v.string(),
    summaryShort: v.optional(v.string()),
    summaryLong: v.optional(v.string()),
    origin: v.union(v.literal("chat"), v.literal("workspace"), v.literal("artifact")),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    status: v.union(v.literal("active"), v.literal("archived"), v.literal("deleted")),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessageAt: v.optional(v.number()),
  })
    .index("by_owner_status", ["ownerUserId", "status"])
    .index("by_workspace", ["workspaceId"])
    .index("by_artifact", ["artifactId"]),

  spectraMessages: defineTable({
    threadId: v.id("spectraThreads"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool")),
    content: v.string(),
    runId: v.optional(v.id("spectraAiRuns")),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_run", ["runId"]),

  spectraAiRuns: defineTable({
    ownerUserId: v.id("users"),
    orgId: v.optional(v.id("orgs")),
    sourceSurface: v.union(v.literal("chat"), v.literal("workspace"), v.literal("artifact")),
    threadId: v.optional(v.id("spectraThreads")),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("awaiting_confirmation"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    userPrompt: v.string(),
    decision: v.optional(v.union(v.literal("answer"), v.literal("operate"), v.literal("clarify"), v.literal("refuse"))),
    planIntent: v.optional(v.any()),
    finalSummary: v.optional(v.string()),
    error: v.optional(v.string()),
    modelUsed: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    attemptCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_owner_status", ["ownerUserId", "status"])
    .index("by_owner_created", ["ownerUserId", "createdAt"])
    .index("by_workspace", ["workspaceId"])
    .index("by_thread", ["threadId"])
    .index("by_artifact", ["artifactId"]),

  spectraOperations: defineTable({
    runId: v.optional(v.id("spectraAiRuns")),
    actorType: v.union(v.literal("user"), v.literal("ai"), v.literal("system")),
    type: v.string(),
    status: v.union(
      v.literal("proposed"),
      v.literal("executing"),
      v.literal("executed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    input: v.any(),
    output: v.optional(v.any()),
    affected: v.array(v.object({ type: v.string(), id: v.string() })),
    requiresConfirmation: v.optional(v.boolean()),
    undoData: v.optional(v.any()),
    createdAt: v.number(),
    executedAt: v.optional(v.number()),
  })
    .index("by_run", ["runId"])
    .index("by_type_status", ["type", "status"]),

  spectraResultCards: defineTable({
    runId: v.id("spectraAiRuns"),
    surface: v.union(v.literal("chat"), v.literal("workspace"), v.literal("artifact")),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("awaiting_confirmation"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    variant: v.union(
      v.literal("status"),
      v.literal("artifact"),
      v.literal("thread"),
      v.literal("operation"),
      v.literal("error"),
    ),
    title: v.string(),
    summary: v.optional(v.string()),
    actions: v.array(v.object({
      key: v.string(),
      label: v.string(),
      targetType: v.optional(v.union(
        v.literal("artifact"),
        v.literal("thread"),
        v.literal("run"),
        v.literal("workspace"),
      )),
      targetId: v.optional(v.string()),
    })),
    hiddenAt: v.optional(v.number()),
    keptAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_artifact_status", ["artifactId", "status"]),

  spectraFocusSpaces: defineTable({
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    title: v.string(),
    selected: v.array(v.object({
      type: v.union(v.literal("artifact"), v.literal("thread"), v.literal("workspaceItem")),
      id: v.string(),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"]),
});
