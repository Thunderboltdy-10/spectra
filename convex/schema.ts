import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  schools: defineTable({
    name: v.string(),
    slug: v.string(),
    verifiedDomains: v.array(v.string()),
    status: v.union(v.literal("active"), v.literal("suspended"), v.literal("archived")),
    timezone: v.string(),
    policyVersion: v.number(),
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

  membershipInvitations: defineTable({
    schoolId: v.id("schools"),
    email: v.string(),
    role: v.union(v.literal("student"), v.literal("teacher"), v.literal("school_admin")),
    tokenHash: v.string(),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked"), v.literal("expired")),
    invitedByAccountId: v.id("accounts"),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_school_status", ["schoolId", "status"])
    .index("by_email_status", ["email", "status"]),

  operatorSchoolSessions: defineTable({
    operatorAccountId: v.id("accounts"),
    schoolId: v.id("schools"),
    label: v.string(),
    reason: v.string(),
    mode: v.union(v.literal("inspect"), v.literal("manage")),
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
    capabilities: v.array(v.union(
      v.literal("read"),
      v.literal("modify"),
      v.literal("share"),
      v.literal("delete"),
      v.literal("restore"),
      v.literal("use"),
      v.literal("comment"),
      v.literal("publish"),
    )),
    source: v.union(v.literal("direct"), v.literal("workspace_inheritance")),
    inheritedFromWorkspaceId: v.optional(v.id("spectraWorkspaces")),
    expiresAt: v.optional(v.number()),
    createdByAccountId: v.id("accounts"),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_resource", ["resourceType", "resourceId"])
    .index("by_principal", ["principalType", "principalId"])
    .index("by_school", ["schoolId", "resourceType"])
    .index("by_inherited_workspace", ["inheritedFromWorkspaceId"]),

  shareInvitations: defineTable({
    schoolId: v.id("schools"),
    resourceType: v.union(v.literal("workspace"), v.literal("artifact"), v.literal("agent")),
    resourceId: v.string(),
    inviterAccountId: v.id("accounts"),
    inviteeAccountId: v.id("accounts"),
    level: v.union(v.literal("read"), v.literal("modify")),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined"), v.literal("revoked"), v.literal("expired")),
    message: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    grantId: v.optional(v.id("accessGrants")),
    createdAt: v.number(),
    updatedAt: v.number(),
    respondedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_invitee_status", ["inviteeAccountId", "status", "createdAt"])
    .index("by_inviter_status", ["inviterAccountId", "status", "createdAt"])
    .index("by_resource", ["resourceType", "resourceId", "createdAt"])
    .index("by_resource_invitee", ["resourceType", "resourceId", "inviteeAccountId"]),

  artifactAccessOverrides: defineTable({
    schoolId: v.optional(v.id("schools")),
    artifactId: v.id("spectraArtifacts"),
    accountId: v.id("accounts"),
    effect: v.union(v.literal("deny"), v.literal("restrict")),
    maxLevel: v.optional(v.union(v.literal("read"), v.literal("modify"))),
    createdByAccountId: v.id("accounts"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_artifact_account", ["artifactId", "accountId"])
    .index("by_account", ["accountId"]),

  resourcePolicies: defineTable({
    resourceType: v.union(v.literal("workspace"), v.literal("artifact"), v.literal("agent")),
    resourceId: v.string(),
    schoolId: v.optional(v.id("schools")),
    version: v.number(),
    publicEnabled: v.boolean(),
    updatedByAccountId: v.id("accounts"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_resource", ["resourceType", "resourceId"])
    .index("by_school", ["schoolId", "updatedAt"]),

  publicLinks: defineTable({
    resourceType: v.union(v.literal("workspace"), v.literal("artifact"), v.literal("agent")),
    resourceId: v.string(),
    schoolId: v.optional(v.id("schools")),
    tokenHash: v.string(),
    level: v.literal("read"),
    domainRestriction: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdByAccountId: v.id("accounts"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_resource", ["resourceType", "resourceId"]),

  auditEvents: defineTable({
    schoolId: v.optional(v.id("schools")),
    actorAccountId: v.id("accounts"),
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    action: v.string(),
    targetType: v.string(),
    targetId: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()))),
    requestId: v.optional(v.string()),
    retentionClass: v.union(v.literal("operational"), v.literal("security"), v.literal("legal")),
    createdAt: v.number(),
  })
    .index("by_school_created", ["schoolId", "createdAt"])
    .index("by_actor_created", ["actorAccountId", "createdAt"])
    .index("by_action_created", ["action", "createdAt"]),

  meterEvents: defineTable({
    schoolId: v.optional(v.id("schools")),
    accountId: v.optional(v.id("accounts")),
    category: v.union(v.literal("storage_bytes"), v.literal("bandwidth_bytes"), v.literal("model_input_tokens"), v.literal("model_output_tokens"), v.literal("render_milliseconds"), v.literal("collaboration_bytes")),
    quantity: v.number(),
    sourceType: v.string(),
    sourceId: v.optional(v.string()),
    idempotencyKey: v.string(),
    dimensions: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
    occurredAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_school_created", ["schoolId", "createdAt"])
    .index("by_account_created", ["accountId", "createdAt"]),

  usageMeters: defineTable({
    schoolId: v.optional(v.id("schools")),
    accountId: v.optional(v.id("accounts")),
    category: v.union(v.literal("storage_bytes"), v.literal("bandwidth_bytes"), v.literal("model_input_tokens"), v.literal("model_output_tokens"), v.literal("render_milliseconds"), v.literal("collaboration_bytes")),
    day: v.string(),
    dimensionsKey: v.string(),
    quantity: v.number(),
    dimensions: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
    updatedAt: v.number(),
  })
    .index("by_school_day", ["schoolId", "day"])
    .index("by_account_day", ["accountId", "day"])
    .index("by_school_category_day", ["schoolId", "category", "day"])
    .index("by_meter", ["schoolId", "accountId", "category", "day", "dimensionsKey"]),

  limitPolicies: defineTable({
    schoolId: v.optional(v.id("schools")),
    scope: v.union(v.literal("platform_default"), v.literal("school")),
    rules: v.array(v.object({
      category: v.union(v.literal("storage_bytes"), v.literal("bandwidth_bytes"), v.literal("model_tokens"), v.literal("render_milliseconds"), v.literal("collaboration_bytes")),
      period: v.union(v.literal("day"), v.literal("month"), v.literal("total")),
      warningAt: v.optional(v.number()),
      maximum: v.number(),
    })),
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
    nonce: v.string(),
    authTag: v.string(),
    algorithm: v.literal("aes-256-gcm"),
    keyVersion: v.number(),
    fingerprint: v.string(),
    status: v.union(v.literal("active"), v.literal("rotated"), v.literal("revoked")),
    label: v.string(),
    createdByAccountId: v.id("accounts"),
    createdAt: v.number(),
    rotatedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_school_purpose", ["schoolId", "purpose"])
    .index("by_status", ["status"]),

  secretBridgeNonces: defineTable({
    nonce: v.string(),
    operation: v.string(),
    accountId: v.id("accounts"),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_nonce", ["nonce"])
    .index("by_expiry", ["expiresAt"]),

  spectraWorkspaces: defineTable({
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
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
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    blueprintKey: v.string(),
    title: v.string(),
    summary: v.optional(v.string()),
    content: v.any(),
    schemaVersion: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    currentVersionId: v.optional(v.id("spectraArtifactVersions")),
    syncState: v.optional(v.union(
      v.literal("synchronizing"),
      v.literal("synchronized"),
      v.literal("reconnecting"),
      v.literal("unsynchronized"),
      v.literal("conflict"),
      v.literal("permission_lost"),
    )),
    validity: v.optional(v.union(v.literal("valid"), v.literal("invalid"), v.literal("checking"))),
    validityIssues: v.optional(v.array(v.object({ code: v.string(), regionId: v.optional(v.string()), message: v.string() }))),
    liveStateVectorHash: v.optional(v.string()),
    lastSynchronizedAt: v.optional(v.number()),
    textIndex: v.optional(v.string()),
    tags: v.array(v.string()),
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
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    parentVersionId: v.optional(v.id("spectraArtifactVersions")),
    source: v.union(
      v.literal("manual"),
      v.literal("ai"),
      v.literal("revert"),
      v.literal("import"),
      v.literal("restore"),
      v.literal("migration"),
      v.literal("checkpoint"),
    ),
    runId: v.optional(v.id("spectraAiRuns")),
    operationIds: v.optional(v.array(v.id("spectraOperations"))),
    changeGroupIds: v.optional(v.array(v.id("changeGroups"))),
    creatorAccountIds: v.optional(v.array(v.id("accounts"))),
    schemaVersion: v.optional(v.number()),
    snapshotStrategy: v.optional(v.union(v.literal("normalized"), v.literal("content_addressed"), v.literal("yjs_snapshot"))),
    snapshotRef: v.optional(v.string()),
    beforeSnapshotRef: v.optional(v.string()),
    stateVectorHash: v.optional(v.string()),
    integrityHash: v.optional(v.string()),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    summary: v.optional(v.string()),
    name: v.optional(v.string()),
    provenance: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_artifact_created", ["artifactId", "createdAt"])
    .index("by_run", ["runId"])
    .index("by_parent", ["parentVersionId"])
    .index("by_integrity_hash", ["integrityHash"]),

  artifactSnapshotObjects: defineTable({
    schoolId: v.optional(v.id("schools")),
    hash: v.string(),
    strategy: v.union(v.literal("normalized"), v.literal("content_addressed"), v.literal("yjs_snapshot")),
    payload: v.any(),
    byteLength: v.number(),
    refCount: v.number(),
    state: v.union(v.literal("hot"), v.literal("cold"), v.literal("corrupt"), v.literal("deleted")),
    createdAt: v.number(),
    lastReferencedAt: v.number(),
    verifiedAt: v.optional(v.number()),
  })
    .index("by_school_hash", ["schoolId", "hash"])
    .index("by_state_reference", ["state", "lastReferencedAt"]),

  collaborationRooms: defineTable({
    artifactId: v.id("spectraArtifacts"),
    schoolId: v.optional(v.id("schools")),
    typeKey: v.string(),
    provider: v.literal("self_hosted_yjs"),
    partitionKey: v.string(),
    schemaVersion: v.number(),
    policyVersion: v.number(),
    status: v.union(v.literal("active"), v.literal("compacting"), v.literal("recovering"), v.literal("closed")),
    nextSequence: v.number(),
    snapshotSequence: v.number(),
    uncompactedBytes: v.number(),
    lastSnapshotAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_artifact_partition", ["artifactId", "partitionKey"])
    .index("by_school_status", ["schoolId", "status"]),

  collaborationUpdates: defineTable({
    roomId: v.id("collaborationRooms"),
    schoolId: v.optional(v.id("schools")),
    sequence: v.number(),
    update: v.bytes(),
    byteLength: v.number(),
    stateVectorHash: v.string(),
    actorAccountId: v.id("accounts"),
    clientId: v.string(),
    idempotencyKey: v.string(),
    changeGroupId: v.optional(v.id("changeGroups")),
    regionIds: v.array(v.string()),
    createdAt: v.number(),
  })
    .index("by_room_sequence", ["roomId", "sequence"])
    .index("by_room_idempotency", ["roomId", "idempotencyKey"])
    .index("by_change_group", ["changeGroupId"]),

  collaborationSnapshots: defineTable({
    roomId: v.id("collaborationRooms"),
    artifactId: v.id("spectraArtifacts"),
    schoolId: v.optional(v.id("schools")),
    throughSequence: v.number(),
    update: v.bytes(),
    stateVector: v.bytes(),
    contentHash: v.string(),
    schemaVersion: v.number(),
    status: v.union(v.literal("pending"), v.literal("verified"), v.literal("corrupt"), v.literal("superseded")),
    createdBy: v.union(v.literal("compactor"), v.literal("recovery"), v.literal("migration")),
    createdAt: v.number(),
    verifiedAt: v.optional(v.number()),
  })
    .index("by_room_sequence", ["roomId", "throughSequence"])
    .index("by_artifact_created", ["artifactId", "createdAt"])
    .index("by_status", ["status", "createdAt"]),

  regionClaims: defineTable({
    artifactId: v.id("spectraArtifacts"),
    roomId: v.optional(v.id("collaborationRooms")),
    schoolId: v.optional(v.id("schools")),
    actorKind: v.union(v.literal("human"), v.literal("ai")),
    actorAccountId: v.id("accounts"),
    runId: v.optional(v.id("spectraAiRuns")),
    operationId: v.optional(v.id("spectraOperations")),
    clientId: v.string(),
    regionId: v.string(),
    overlapDomains: v.array(v.string()),
    baseStateVectorHash: v.string(),
    proposedStateRef: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("queued"), v.literal("paused"), v.literal("released"), v.literal("rejected")),
    queuePosition: v.optional(v.number()),
    leaseExpiresAt: v.number(),
    resolution: v.optional(v.union(v.literal("apply"), v.literal("keep_current"), v.literal("merge"), v.literal("cancel"), v.literal("expired"), v.literal("permission_revoked"), v.literal("run_stopped"))),
    createdAt: v.number(),
    updatedAt: v.number(),
    releasedAt: v.optional(v.number()),
  })
    .index("by_artifact_status", ["artifactId", "status"])
    .index("by_artifact_expiry", ["artifactId", "leaseExpiresAt"])
    .index("by_run_status", ["runId", "status"])
    .index("by_client_status", ["clientId", "status"]),

  artifactComments: defineTable({
    artifactId: v.id("spectraArtifacts"),
    schoolId: v.optional(v.id("schools")),
    parentCommentId: v.optional(v.id("artifactComments")),
    authorAccountId: v.id("accounts"),
    body: v.string(),
    anchor: v.object({
      regionId: v.string(),
      relativePosition: v.optional(v.bytes()),
      geometry: v.optional(v.any()),
      fallbackExcerpt: v.optional(v.string()),
    }),
    mentionedAccountIds: v.array(v.id("accounts")),
    status: v.union(v.literal("open"), v.literal("resolved"), v.literal("orphaned"), v.literal("deleted")),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolvedByAccountId: v.optional(v.id("accounts")),
  })
    .index("by_artifact_status", ["artifactId", "status"])
    .index("by_parent", ["parentCommentId", "createdAt"])
    .index("by_author", ["authorAccountId", "createdAt"]),

  artifactCommentPreferences: defineTable({
    artifactId: v.id("spectraArtifacts"),
    accountId: v.id("accounts"),
    mode: v.union(v.literal("all"), v.literal("mentions_replies"), v.literal("off")),
    updatedAt: v.number(),
  })
    .index("by_artifact_account", ["artifactId", "accountId"])
    .index("by_artifact_mode", ["artifactId", "mode"]),

  artifactCommentNotifications: defineTable({
    artifactId: v.id("spectraArtifacts"),
    commentId: v.id("artifactComments"),
    recipientAccountId: v.id("accounts"),
    kind: v.union(v.literal("mention"), v.literal("reply"), v.literal("all_comments")),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
  })
    .index("by_recipient_created", ["recipientAccountId", "createdAt"])
    .index("by_recipient_read", ["recipientAccountId", "readAt"])
    .index("by_comment_recipient", ["commentId", "recipientAccountId"]),

  changeGroups: defineTable({
    artifactId: v.id("spectraArtifacts"),
    schoolId: v.optional(v.id("schools")),
    source: v.union(v.literal("human"), v.literal("ai"), v.literal("import"), v.literal("restore"), v.literal("migration")),
    actorAccountId: v.id("accounts"),
    clientId: v.optional(v.string()),
    runId: v.optional(v.id("spectraAiRuns")),
    operationIds: v.array(v.id("spectraOperations")),
    regionIds: v.array(v.string()),
    baseStateVectorHash: v.string(),
    baseVersionId: v.optional(v.id("spectraArtifactVersions")),
    baseSnapshot: v.optional(v.any()),
    finalStateVectorHash: v.optional(v.string()),
    finalSnapshot: v.optional(v.any()),
    finalIntegrityHash: v.optional(v.string()),
    summary: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("committed"), v.literal("abandoned")),
    openedAt: v.number(),
    lastActivityAt: v.number(),
    committedAt: v.optional(v.number()),
    versionId: v.optional(v.id("spectraArtifactVersions")),
  })
    .index("by_artifact_status_activity", ["artifactId", "status", "lastActivityAt"])
    .index("by_run", ["runId"])
    .index("by_version", ["versionId"]),

  artifactEmbeds: defineTable({
    containerType: v.union(v.literal("artifact"), v.literal("thread")),
    containerId: v.string(),
    containerRegionId: v.string(),
    sourceArtifactId: v.id("spectraArtifacts"),
    schoolId: v.optional(v.id("schools")),
    mode: v.union(v.literal("compact"), v.literal("expanded")),
    interaction: v.union(v.literal("read"), v.literal("interact"), v.literal("edit")),
    versionPolicy: v.union(v.literal("live"), v.literal("pinned")),
    pinnedVersionId: v.optional(v.id("spectraArtifactVersions")),
    displayPreferences: v.optional(v.any()),
    contextPolicy: v.union(v.literal("none"), v.literal("summary"), v.literal("visible_region")),
    createdByAccountId: v.id("accounts"),
    createdAt: v.number(),
    updatedAt: v.number(),
    removedAt: v.optional(v.number()),
  })
    .index("by_container", ["containerType", "containerId"])
    .index("by_source", ["sourceArtifactId", "createdAt"])
    .index("by_pinned_version", ["pinnedVersionId"]),

  artifactImportJobs: defineTable({
    artifactId: v.optional(v.id("spectraArtifacts")),
    schoolId: v.optional(v.id("schools")),
    ownerAccountId: v.id("accounts"),
    typeKey: v.string(),
    format: v.string(),
    originalAssetRef: v.string(),
    status: v.union(v.literal("uploaded"), v.literal("parsing"), v.literal("preview"), v.literal("imported"), v.literal("quarantined"), v.literal("failed")),
    fidelityReport: v.optional(v.array(v.object({ scope: v.string(), level: v.union(v.literal("exact"), v.literal("adapted"), v.literal("unsupported")), message: v.string() }))),
    unsupportedFeatures: v.array(v.string()),
    quarantineReason: v.optional(v.string()),
    parserVersion: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_owner_status", ["ownerAccountId", "status"])
    .index("by_artifact", ["artifactId"])
    .index("by_school_created", ["schoolId", "createdAt"]),

  spectraArtifactLinks: defineTable({
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
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
    placedByAccountId: v.optional(v.id("accounts")),
    accessProjection: v.optional(v.boolean()),
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
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    title: v.string(),
    summaryShort: v.optional(v.string()),
    summaryLong: v.optional(v.string()),
    origin: v.union(v.literal("chat"), v.literal("workspace"), v.literal("artifact")),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    pinned: v.optional(v.boolean()),
    messageCount: v.optional(v.number()),
    lastRunId: v.optional(v.id("spectraAiRuns")),
    retainedAgentId: v.optional(v.id("spectraArtifacts")),
    retainedAgentVersionId: v.optional(v.id("spectraArtifactVersions")),
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
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
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
      v.literal("conflict"),
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
      v.literal("awaiting_resolution"),
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
    selectedAgentId: v.optional(v.id("spectraArtifacts")),
    selectedAgentVersionId: v.optional(v.id("spectraArtifactVersions")),
    agentRouting: v.optional(v.object({
      confidence: v.number(),
      reason: v.string(),
      source: v.union(v.literal("automatic"), v.literal("continued"), v.literal("explicit")),
      reversible: v.boolean(),
    })),
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

  spectraRunJobs: defineTable({
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    status: v.union(v.literal("queued"), v.literal("leased"), v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
    payload: v.any(),
    workerId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    availableAt: v.number(),
    attempt: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_status_available", ["status", "availableAt"])
    .index("by_run_execution", ["runId", "executionId"])
    .index("by_worker_status", ["workerId", "status"]),

  spectraRunAttachments: defineTable({
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    ownerAccountId: v.id("accounts"),
    storageId: v.optional(v.id("_storage")),
    name: v.string(),
    mimeType: v.string(),
    size: v.number(),
    handling: v.union(v.literal("pdf"), v.literal("text"), v.literal("docx")),
    extractedText: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_run_execution", ["runId", "executionId"])
    .index("by_owner_created", ["ownerAccountId", "createdAt"]),

  spectraOperations: defineTable({
    runId: v.optional(v.id("spectraAiRuns")),
    executionId: v.optional(v.string()),
    actorType: v.union(v.literal("user"), v.literal("ai"), v.literal("system")),
    type: v.string(),
    status: v.union(
      v.literal("proposed"),
      v.literal("executing"),
      v.literal("waiting"),
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
    conflict: v.optional(v.object({
      claimId: v.id("regionClaims"),
      artifactId: v.id("spectraArtifacts"),
      clientId: v.string(),
      regionId: v.string(),
      blockerActorKind: v.union(v.literal("human"), v.literal("ai")),
      queuePosition: v.number(),
      baseSnapshot: v.any(),
      proposedSnapshot: v.optional(v.any()),
      createdAt: v.number(),
    })),
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
      v.literal("awaiting_resolution"),
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
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
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
