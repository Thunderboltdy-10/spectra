import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  schools: defineTable({
    name: v.string(),
    slug: v.string(),
    verifiedDomains: v.array(v.string()),
    status: v.union(v.literal("active"), v.literal("suspended"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"]),

  accounts: defineTable({
    clerkId: v.string(),
    email: v.string(),
    emailVerified: v.boolean(),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("deactivated")),
    lastSeenAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_status", ["status"]),

  schoolMemberships: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    role: v.union(v.literal("student"), v.literal("teacher"), v.literal("school_admin")),
    status: v.union(v.literal("active"), v.literal("invited"), v.literal("suspended"), v.literal("ended")),
    joinedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_status", ["accountId", "status"])
    .index("by_school", ["schoolId"])
    .index("by_school_role", ["schoolId", "role"])
    .index("by_school_status", ["schoolId", "status"]),

  operatorSchoolSessions: defineTable({
    operatorAccountId: v.id("accounts"),
    schoolId: v.id("schools"),
    label: v.string(),
    reason: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_operator", ["operatorAccountId", "createdAt"])
    .index("by_operator_active", ["operatorAccountId", "expiresAt"])
    .index("by_school", ["schoolId", "createdAt"]),

  accessGrants: defineTable({
    schoolId: v.optional(v.id("schools")),
    resourceType: v.union(v.literal("workspace"), v.literal("artifact"), v.literal("agent")),
    resourceId: v.string(),
    principalType: v.union(v.literal("account"), v.literal("school"), v.literal("public")),
    principalId: v.optional(v.string()),
    level: v.union(v.literal("read"), v.literal("modify")),
    source: v.union(v.literal("direct"), v.literal("workspace_inheritance")),
    inheritedFromWorkspaceId: v.optional(v.id("spectraWorkspaces")),
    createdByAccountId: v.id("accounts"),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_resource", ["resourceType", "resourceId"])
    .index("by_principal", ["principalType", "principalId"])
    .index("by_school", ["schoolId", "resourceType"])
    .index("by_inherited_workspace", ["inheritedFromWorkspaceId"]),

  artifactAccessOverrides: defineTable({
    schoolId: v.optional(v.id("schools")),
    artifactId: v.id("spectraArtifacts"),
    accountId: v.id("accounts"),
    effect: v.literal("deny"),
    createdByAccountId: v.id("accounts"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_artifact_account", ["artifactId", "accountId"])
    .index("by_account", ["accountId"]),

  auditEvents: defineTable({
    schoolId: v.optional(v.id("schools")),
    actorAccountId: v.id("accounts"),
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    action: v.string(),
    targetType: v.string(),
    targetId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_school_created", ["schoolId", "createdAt"])
    .index("by_actor_created", ["actorAccountId", "createdAt"])
    .index("by_action_created", ["action", "createdAt"]),

  usageMeters: defineTable({
    schoolId: v.optional(v.id("schools")),
    accountId: v.optional(v.id("accounts")),
    category: v.union(v.literal("storage_bytes"), v.literal("bandwidth_bytes"), v.literal("model_input_tokens"), v.literal("model_output_tokens"), v.literal("render_milliseconds"), v.literal("collaboration_bytes")),
    day: v.string(),
    quantity: v.number(),
    dimensions: v.optional(v.any()),
    updatedAt: v.number(),
  })
    .index("by_school_day", ["schoolId", "day"])
    .index("by_account_day", ["accountId", "day"])
    .index("by_school_category_day", ["schoolId", "category", "day"]),

  limitPolicies: defineTable({
    schoolId: v.optional(v.id("schools")),
    scope: v.union(v.literal("platform_default"), v.literal("school")),
    storageBytes: v.optional(v.number()),
    monthlyModelTokens: v.optional(v.number()),
    monthlyBandwidthBytes: v.optional(v.number()),
    enforcement: v.union(v.literal("disabled"), v.literal("simulate"), v.literal("enforced")),
    updatedByAccountId: v.id("accounts"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_scope_school", ["scope", "schoolId"]),

  secretRecords: defineTable({
    schoolId: v.optional(v.id("schools")),
    purpose: v.string(),
    ciphertext: v.string(),
    keyVersion: v.number(),
    fingerprint: v.string(),
    status: v.union(v.literal("active"), v.literal("rotated"), v.literal("revoked")),
    createdByAccountId: v.id("accounts"),
    createdAt: v.number(),
    rotatedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_school_purpose", ["schoolId", "purpose"])
    .index("by_status", ["status"]),

  spectraWorkspaces: defineTable({
    ownerAccountId: v.id("users"),
    schoolId: v.optional(v.id("orgs")),
    title: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    starterKey: v.optional(v.string()),
    aiState: v.optional(v.union(v.literal("creating"), v.literal("updating"), v.literal("edited"), v.literal("failed"))),
    aiRunId: v.optional(v.id("spectraAiRuns")),
    aiExecutionId: v.optional(v.string()),
    aiPending: v.optional(v.boolean()),
    aiStateExpiresAt: v.optional(v.number()),
    aiPreview: v.optional(v.object({ title: v.optional(v.string()), description: v.optional(v.string()), icon: v.optional(v.string()), color: v.optional(v.string()), startedAt: v.number() })),
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
    .index("by_account_status", ["ownerAccountId", "status"])
    .index("by_account_starter", ["ownerAccountId", "starterKey"])
    .index("by_school_status", ["schoolId", "status"])
    .index("by_account_activity", ["ownerAccountId", "lastActivityAt"]),

  spectraArtifacts: defineTable({
    ownerAccountId: v.id("users"),
    schoolId: v.optional(v.id("orgs")),
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
    aiState: v.optional(v.union(v.literal("creating"), v.literal("updating"), v.literal("edited"), v.literal("failed"))),
    aiRunId: v.optional(v.id("spectraAiRuns")),
    aiExecutionId: v.optional(v.string()),
    aiProgress: v.optional(v.number()),
    aiStateExpiresAt: v.optional(v.number()),
    aiPreview: v.optional(v.object({
      title: v.optional(v.string()),
      summary: v.optional(v.string()),
      content: v.optional(v.any()),
      tags: v.optional(v.array(v.string())),
      changedPaths: v.optional(v.array(v.string())),
      startedAt: v.number(),
    })),
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
      sourceArtifactIds: v.optional(v.array(v.id("spectraArtifacts"))),
      sourceThreadIds: v.optional(v.array(v.id("spectraThreads"))),
      sourceAttachmentNames: v.optional(v.array(v.string())),
      contextSummary: v.optional(v.string()),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_status", ["ownerAccountId", "status"])
    .index("by_account_updated", ["ownerAccountId", "updatedAt"])
    .index("by_account_status_updated", ["ownerAccountId", "status", "updatedAt"])
    .index("by_account_blueprint", ["ownerAccountId", "blueprintKey"])
    .index("by_created_workspace", ["createdFrom.workspaceId"])
    .searchIndex("search_text", {
      searchField: "textIndex",
      filterFields: ["ownerAccountId", "blueprintKey", "status"],
    }),

  spectraArtifactVersions: defineTable({
    artifactId: v.id("spectraArtifacts"),
    ownerAccountId: v.id("users"),
    source: v.union(v.literal("manual"), v.literal("ai"), v.literal("revert")),
    runId: v.optional(v.id("spectraAiRuns")),
    before: v.any(),
    after: v.any(),
    summary: v.optional(v.string()),
    provenance: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_artifact_created", ["artifactId", "createdAt"])
    .index("by_run", ["runId"]),

  spectraArtifactLinks: defineTable({
    ownerAccountId: v.id("users"),
    schoolId: v.optional(v.id("orgs")),
    sourceArtifactId: v.id("spectraArtifacts"),
    targetArtifactId: v.id("spectraArtifacts"),
    relationType: v.union(
      v.literal("related"),
      v.literal("supports"),
      v.literal("contradicts"),
      v.literal("source_for"),
      v.literal("generated_from"),
      v.literal("follow_up"),
      v.literal("belongs_with"),
    ),
    label: v.optional(v.string()),
    explanation: v.optional(v.string()),
    provenance: v.object({
      source: v.union(v.literal("user"), v.literal("ai"), v.literal("system")),
      runId: v.optional(v.id("spectraAiRuns")),
      reason: v.optional(v.string()),
    }),
    createdBy: v.union(v.literal("user"), v.literal("ai"), v.literal("system")),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_source", ["sourceArtifactId", "createdAt"])
    .index("by_target", ["targetArtifactId", "createdAt"])
    .index("by_workspace", ["workspaceId", "createdAt"])
    .index("by_pair", ["sourceArtifactId", "targetArtifactId"]),

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
    ownerAccountId: v.id("users"),
    schoolId: v.optional(v.id("orgs")),
    title: v.string(),
    summaryShort: v.optional(v.string()),
    summaryLong: v.optional(v.string()),
    origin: v.union(v.literal("chat"), v.literal("workspace"), v.literal("artifact")),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    pinned: v.optional(v.boolean()),
    messageCount: v.optional(v.number()),
    lastRunId: v.optional(v.id("spectraAiRuns")),
    status: v.union(v.literal("active"), v.literal("archived"), v.literal("deleted")),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessageAt: v.optional(v.number()),
  })
    .index("by_account_status", ["ownerAccountId", "status"])
    .index("by_workspace", ["workspaceId"])
    .index("by_artifact", ["artifactId"]),

  spectraMessages: defineTable({
    threadId: v.id("spectraThreads"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool")),
    content: v.string(),
    runId: v.optional(v.id("spectraAiRuns")),
    clientMessageId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_created", ["threadId", "createdAt"])
    .index("by_thread_client", ["threadId", "clientMessageId"])
    .index("by_run", ["runId"]),

  spectraAiRuns: defineTable({
    ownerAccountId: v.id("users"),
    schoolId: v.optional(v.id("orgs")),
    sourceSurface: v.union(v.literal("chat"), v.literal("workspace"), v.literal("artifact")),
    phase: v.optional(v.union(
      v.literal("created"),
      v.literal("preparing"),
      v.literal("planning"),
      v.literal("reading"),
      v.literal("retrieving"),
      v.literal("creating"),
      v.literal("updating"),
      v.literal("applying"),
      v.literal("streaming"),
      v.literal("checking"),
      v.literal("approval"),
      v.literal("completed"),
      v.literal("stopped"),
      v.literal("interrupted"),
      v.literal("partial"),
      v.literal("failed"),
    )),
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
    suggestedThreadTitle: v.optional(v.string()),
    suggestedThreadSummary: v.optional(v.string()),
    error: v.optional(v.string()),
    modelUsed: v.optional(v.string()),
    providerUsed: v.optional(v.string()),
    usage: v.optional(v.any()),
    sessionId: v.optional(v.string()),
    submissionKey: v.optional(v.string()),
    executionId: v.optional(v.string()),
    lastRetryKey: v.optional(v.string()),
    eventSequence: v.optional(v.number()),
    traceDegraded: v.optional(v.boolean()),
    approval: v.optional(v.object({
      executionId: v.string(),
      status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("rejected"), v.literal("revised")),
      reasons: v.array(v.string()),
      revision: v.optional(v.string()),
      requestedAt: v.number(),
      claimedAt: v.optional(v.number()),
      decidedAt: v.optional(v.number()),
    })),
    recoveryState: v.optional(v.union(v.literal("interrupted"), v.literal("partial"))),
    retryable: v.optional(v.boolean()),
    preservedPartial: v.optional(v.boolean()),
    workerId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    contextSnapshot: v.optional(v.any()),
    attemptCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_account_status", ["ownerAccountId", "status"])
    .index("by_account_created", ["ownerAccountId", "createdAt"])
    .index("by_account_submission", ["ownerAccountId", "submissionKey"])
    .index("by_workspace", ["workspaceId"])
    .index("by_thread", ["threadId"])
    .index("by_artifact", ["artifactId"]),

  spectraOperations: defineTable({
    runId: v.optional(v.id("spectraAiRuns")),
    executionId: v.optional(v.string()),
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
    pendingArtifactId: v.optional(v.id("spectraArtifacts")),
    pendingWorkspaceId: v.optional(v.id("spectraWorkspaces")),
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
    provenance: v.optional(v.any()),
    hiddenAt: v.optional(v.number()),
    keptAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_artifact_status", ["artifactId", "status"]),

  spectraRunEvents: defineTable({
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    sequence: v.number(),
    type: v.string(),
    payload: v.any(),
    createdAt: v.number(),
  })
    .index("by_run_sequence", ["runId", "sequence"])
    .index("by_run_created", ["runId", "createdAt"]),

  spectraRunTabs: defineTable({
    ownerAccountId: v.id("users"),
    schoolId: v.optional(v.id("orgs")),
    runId: v.id("spectraAiRuns"),
    threadId: v.id("spectraThreads"),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    surface: v.union(v.literal("chat"), v.literal("workspace"), v.literal("artifact")),
    selected: v.optional(v.boolean()),
    hiddenAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_updated", ["ownerAccountId", "updatedAt"])
    .index("by_account_run", ["ownerAccountId", "runId"])
    .index("by_account_thread", ["ownerAccountId", "threadId"])
    .index("by_thread", ["threadId"]),

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

