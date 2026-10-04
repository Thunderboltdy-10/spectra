import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vUiObservation, vUiObserverInterests } from "./spectraUiObservationSchema";
import { providerProjectionIntent, providerProjectionReceipt } from "./managebacProjectionContract";
import { EMBEDDING_DIMENSIONS } from "./embeddingProvider";
import { vSemanticKind as semanticIndexedKind } from "./semanticKeys";
import { vSchoolSyncKind, vSchoolSyncMode, vSchoolSyncState, vSchoolSyncTrigger } from "./schoolSyncSchema";
import {
  artifactEmbedContainerTypeValidator,
  artifactEmbedContextPolicyValidator,
  artifactEmbedInteractionValidator,
  artifactEmbedModeValidator,
  artifactEmbedVersionPolicyValidator,
} from "../shared/artifact-embed";

export default defineSchema({
  schools: defineTable({
    name: v.string(),
    slug: v.string(),
    verifiedDomains: v.array(v.string()),
    locale: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    academicYearStart: v.optional(v.string()),
    academicYearEnd: v.optional(v.string()),
    accessibilityDefaults: v.optional(
      v.object({
        reducedMotion: v.boolean(),
        increasedContrast: v.boolean(),
        largerText: v.boolean(),
      }),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("suspended"),
      v.literal("archived"),
    ),
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
    .index("by_status", ["status"])
    .index("by_status_last_seen", ["status", "lastSeenAt"]),

  accountPreferences: defineTable({
    accountId: v.id("accounts"),
    scope: v.union(
      v.literal("account"),
      v.literal("workspace"),
      v.literal("work_type"),
      v.literal("device"),
    ),
    scopeKey: v.string(),
    values: v.any(),
    schemaVersion: v.number(),
    migrationNotes: v.optional(v.array(v.string())),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_scope_key", ["accountId", "scope", "scopeKey"]),

  schoolMemberships: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    role: v.union(
      v.literal("student"),
      v.literal("teacher"),
      v.literal("school_admin"),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("invited"),
      v.literal("suspended"),
      v.literal("ended"),
    ),
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
    role: v.union(
      v.literal("student"),
      v.literal("teacher"),
      v.literal("school_admin"),
    ),
    tokenHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    invitedByAccountId: v.id("accounts"),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_school_status", ["schoolId", "status"])
    .index("by_school_email_status", ["schoolId", "email", "status"])
    .index("by_email_status", ["email", "status"]),

  schoolGroups: defineTable({
    schoolId: v.id("schools"),
    name: v.string(),
    description: v.optional(v.string()),
    type: v.union(
      v.literal("class"),
      v.literal("department"),
      v.literal("programme"),
      v.literal("custom"),
    ),
    source: v.union(v.literal("manual"), v.literal("managebac")),
    sourceKey: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdByAccountId: v.id("accounts"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_school_status", ["schoolId", "status"])
    .index("by_school_source", ["schoolId", "source", "sourceKey"]),

  schoolGroupMembers: defineTable({
    schoolId: v.id("schools"),
    groupId: v.id("schoolGroups"),
    accountId: v.id("accounts"),
    role: v.union(v.literal("member"), v.literal("manager")),
    createdByAccountId: v.id("accounts"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_group", ["groupId", "createdAt"])
    .index("by_group_account", ["groupId", "accountId"])
    .index("by_account", ["accountId", "createdAt"])
    // School export pages through one school's rows instead of every tenant's.
    .index("by_school", ["schoolId", "createdAt"]),

  schoolAnnouncements: defineTable({
    schoolId: v.id("schools"),
    title: v.string(),
    body: v.string(),
    targetKind: v.union(
      v.literal("school"),
      v.literal("roles"),
      v.literal("groups"),
    ),
    targetIds: v.array(v.string()),
    audienceSnapshotCount: v.number(),
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("cancelled"),
    ),
    scheduledAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    createdByAccountId: v.id("accounts"),
    updatedByAccountId: v.id("accounts"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_school_status", ["schoolId", "status"])
    .index("by_status_scheduled", ["status", "scheduledAt"])
    .index("by_school_created", ["schoolId", "createdAt"]),

  schoolAnnouncementDeliveries: defineTable({
    schoolId: v.id("schools"),
    announcementId: v.id("schoolAnnouncements"),
    accountId: v.id("accounts"),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("read"),
    ),
    failureCode: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_announcement", ["announcementId", "status"])
    .index("by_account_status", ["accountId", "status", "createdAt"])
    .index("by_school_created", ["schoolId", "createdAt"]),

  feedbackReports: defineTable({
    schoolId: v.optional(v.id("schools")),
    reporterAccountId: v.id("accounts"),
    category: v.union(
      v.literal("feature_request"),
      v.literal("improvement"),
      v.literal("issue"),
      v.literal("content_accuracy"),
      v.literal("performance"),
      v.literal("integration"),
      v.literal("other"),
    ),
    sentiment: v.union(
      v.literal("positive"),
      v.literal("neutral"),
      v.literal("negative"),
    ),
    subject: v.string(),
    message: v.string(),
    status: v.union(
      v.literal("new"),
      v.literal("triaged"),
      v.literal("in_progress"),
      v.literal("resolved"),
      v.literal("closed"),
    ),
    visibility: v.literal("reporter_and_responders"),
    assignedAccountId: v.optional(v.id("accounts")),
    responderScope: v.optional(
      v.union(v.literal("school"), v.literal("platform")),
    ),
    response: v.optional(v.string()),
    respondedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_school_status", ["schoolId", "status", "createdAt"])
    .index("by_reporter_created", ["reporterAccountId", "createdAt"])
    .index("by_status_created", ["status", "createdAt"])
    .index("by_created", ["createdAt"]),

  schoolRequests: defineTable({
    schoolId: v.optional(v.id("schools")),
    requestedByAccountId: v.id("accounts"),
    type: v.union(
      v.literal("seat_change"),
      v.literal("integration"),
      v.literal("export"),
      v.literal("support"),
      v.literal("offboarding"),
      v.literal("other"),
    ),
    subject: v.string(),
    detail: v.string(),
    priority: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high"),
      v.literal("urgent"),
    ),
    status: v.union(
      v.literal("open"),
      v.literal("acknowledged"),
      v.literal("in_progress"),
      v.literal("resolved"),
      v.literal("closed"),
    ),
    responseDueAt: v.optional(v.number()),
    assignedAccountId: v.optional(v.id("accounts")),
    response: v.optional(v.string()),
    respondedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_school_status", ["schoolId", "status", "createdAt"])
    .index("by_status_priority", ["status", "priority", "createdAt"]),

  platformIncidents: defineTable({
    title: v.string(),
    summary: v.string(),
    affectedServices: v.array(v.string()),
    severity: v.union(
      v.literal("minor"),
      v.literal("major"),
      v.literal("critical"),
    ),
    status: v.union(
      v.literal("investigating"),
      v.literal("identified"),
      v.literal("monitoring"),
      v.literal("resolved"),
    ),
    createdByAccountId: v.id("accounts"),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_severity_updated", ["severity", "updatedAt"]),

  schoolLifecycleJobs: defineTable({
    schoolId: v.id("schools"),
    type: v.union(
      v.literal("activate"),
      v.literal("suspend"),
      v.literal("export"),
      v.literal("offboard"),
      v.literal("purge"),
    ),
    status: v.union(
      v.literal("draft"),
      v.literal("awaiting_approval"),
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    requestedByAccountId: v.id("accounts"),
    approvedByAccountIds: v.array(v.id("accounts")),
    reason: v.string(),
    typedConfirmation: v.optional(v.string()),
    impact: v.object({
      // Set when the artifact count stopped at its read budget: it is a floor.
      artifactsAtLeast: v.optional(v.boolean()),
      activeMembers: v.number(),
      artifacts: v.number(),
      workspaces: v.number(),
      integrations: v.number(),
    }),
    // A version 2 export stores its manifest here and its rows in `schoolExportParts`.
    exportStorageId: v.optional(v.id("_storage")),
    // A resumable export position. A school is exported in bounded pages
    // across several actions, and the position only advances with a committed part.
    exportProgress: v.optional(
      v.object({
        position: v.union(
          v.object({
            section: v.number(),
            range: v.number(),
            cursor: v.union(v.string(), v.null()),
            // Nested sections page their parents, then each parent's rows.
            parentCursor: v.optional(v.union(v.string(), v.null())),
            parentsDone: v.optional(v.boolean()),
            pendingParents: v.optional(v.array(v.string())),
          }),
          v.null(),
        ),
        parts: v.number(),
        rows: v.number(),
        bytes: v.number(),
        leaseId: v.string(),
        leaseExpiresAt: v.number(),
        takeovers: v.number(),
      }),
    ),
    prerequisiteExportJobId: v.optional(v.id("schoolLifecycleJobs")),
    reversibleUntil: v.optional(v.number()),
    errorSummary: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_school_created", ["schoolId", "createdAt"])
    .index("by_status_created", ["status", "createdAt"]),

  schoolExportParts: defineTable({
    jobId: v.id("schoolLifecycleJobs"),
    schoolId: v.id("schools"),
    index: v.number(),
    section: v.string(),
    rows: v.number(),
    bytes: v.number(),
    storageId: v.id("_storage"),
    createdAt: v.number(),
  }).index("by_job_index", ["jobId", "index"]),

  schoolPurgeProgress: defineTable({
    jobId: v.id("schoolLifecycleJobs"),
    schoolId: v.id("schools"),
    stage: v.union(
      v.literal("freeze"),
      v.literal("dependent_rows"),
      v.literal("school_rows"),
      v.literal("finalize"),
      v.literal("completed"),
    ),
    tableIndex: v.number(),
    cursor: v.optional(v.string()),
    deletedRows: v.number(),
    deletedStorageObjects: v.number(),
    irreversibleAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_stage_updated", ["stage", "updatedAt"]),

  // One resumable erasure per account (convex/accountErasure.ts). The row
  // outlives the erasure as the idempotency key for repeated IdP events.
  accountErasureJobs: defineTable({
    accountId: v.id("accounts"),
    trigger: v.literal("identity_deleted"),
    stage: v.union(
      v.literal("works"),
      v.literal("await_works"),
      v.literal("account_rows"),
      v.literal("placements"),
      v.literal("workspaces"),
      v.literal("finalize"),
      v.literal("completed"),
      // Restarted too often without progress; parked for an operator, who
      // resumes it at `resumeStage` (accountErasure:resumeNeedsAttention).
      v.literal("failed_needs_attention"),
    ),
    step: v.number(),
    tableIndex: v.number(),
    cursor: v.optional(v.string()),
    // Cron restarts since the job last made progress (backoff and alerting).
    stalledRestarts: v.optional(v.number()),
    resumeStage: v.optional(v.union(
      v.literal("works"),
      v.literal("await_works"),
      v.literal("account_rows"),
      v.literal("placements"),
      v.literal("workspaces"),
      v.literal("finalize"),
    )),
    needsAttentionAt: v.optional(v.number()),
    keptWorks: v.number(),
    deletedWorks: v.number(),
    // Works whose own deletion job ended failed or retained (pinned elsewhere).
    retainedWorks: v.number(),
    deletedRows: v.number(),
    deletedStorageObjects: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_account", ["accountId"])
    .index("by_stage_updated", ["stage", "updatedAt"]),

  schoolOnboardingSagas: defineTable({
    idempotencyKey: v.string(),
    schoolId: v.id("schools"),
    initialAdminEmail: v.string(),
    status: v.union(
      v.literal("reserved"),
      v.literal("invited"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    completedSteps: v.array(
      v.union(
        v.literal("identity_reserved"),
        v.literal("capability_charter_applied"),
        v.literal("limits_created"),
        v.literal("admin_invited"),
      ),
    ),
    invitationId: v.optional(v.id("membershipInvitations")),
    errorSummary: v.optional(v.string()),
    createdByAccountId: v.id("accounts"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_school", ["schoolId"]),

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
    resourceType: v.union(
      v.literal("workspace"),
      v.literal("artifact"),
      v.literal("agent"),
    ),
    resourceId: v.string(),
    principalType: v.union(
      v.literal("account"),
      v.literal("school"),
      v.literal("public"),
    ),
    principalId: v.optional(v.string()),
    level: v.union(v.literal("read"), v.literal("modify")),
    capabilities: v.array(
      v.union(
        v.literal("read"),
        v.literal("modify"),
        v.literal("share"),
        v.literal("delete"),
        v.literal("restore"),
        v.literal("use"),
        v.literal("comment"),
        v.literal("publish"),
      ),
    ),
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
    .index("by_resource_principal_live_expiry", [
      "resourceType", "resourceId", "principalType", "principalId",
      "source", "revokedAt", "expiresAt",
    ])
    .index("by_principal_resource_source", [
      "principalType",
      "principalId",
      "resourceType",
      "source",
    ])
    .index("by_school", ["schoolId", "resourceType"])
    .index("by_school_principal_source_revoked", [
      "schoolId", "principalType", "principalId", "source", "revokedAt",
    ])
    .index("by_inherited_workspace", ["inheritedFromWorkspaceId"]),

  shareInvitations: defineTable({
    schoolId: v.id("schools"),
    resourceType: v.union(
      v.literal("workspace"),
      v.literal("artifact"),
      v.literal("agent"),
    ),
    resourceId: v.string(),
    inviterAccountId: v.id("accounts"),
    inviteeAccountId: v.id("accounts"),
    level: v.union(v.literal("read"), v.literal("modify")),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
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
    .index("by_resource_inviter_status", [
      "resourceType",
      "resourceId",
      "inviterAccountId",
      "status",
    ])
    .index("by_resource", ["resourceType", "resourceId", "createdAt"])
    .index("by_resource_invitee", [
      "resourceType",
      "resourceId",
      "inviteeAccountId",
    ]),

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
    resourceType: v.union(
      v.literal("workspace"),
      v.literal("artifact"),
      v.literal("agent"),
    ),
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
    resourceType: v.union(
      v.literal("workspace"),
      v.literal("artifact"),
      v.literal("agent"),
    ),
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
    metadata: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null()),
      ),
    ),
    requestId: v.optional(v.string()),
    retentionClass: v.union(
      v.literal("operational"),
      v.literal("security"),
      v.literal("legal"),
    ),
    createdAt: v.number(),
  })
    .index("by_school_created", ["schoolId", "createdAt"])
    .index("by_actor_created", ["actorAccountId", "createdAt"])
    .index("by_action_created", ["action", "createdAt"]),

  meterEvents: defineTable({
    schoolId: v.optional(v.id("schools")),
    accountId: v.optional(v.id("accounts")),
    category: v.union(
      v.literal("storage_bytes"),
      v.literal("bandwidth_bytes"),
      v.literal("model_input_tokens"),
      v.literal("model_output_tokens"),
      v.literal("render_milliseconds"),
      v.literal("collaboration_bytes"),
    ),
    quantity: v.number(),
    sourceType: v.string(),
    sourceId: v.optional(v.string()),
    idempotencyKey: v.string(),
    dimensions: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    ),
    occurredAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_school_created", ["schoolId", "createdAt"])
    .index("by_account_created", ["accountId", "createdAt"]),

  usageMeters: defineTable({
    schoolId: v.optional(v.id("schools")),
    accountId: v.optional(v.id("accounts")),
    category: v.union(
      v.literal("storage_bytes"),
      v.literal("bandwidth_bytes"),
      v.literal("model_input_tokens"),
      v.literal("model_output_tokens"),
      v.literal("render_milliseconds"),
      v.literal("collaboration_bytes"),
    ),
    day: v.string(),
    dimensionsKey: v.string(),
    quantity: v.number(),
    dimensions: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    ),
    updatedAt: v.number(),
  })
    .index("by_school_day", ["schoolId", "day"])
    .index("by_account_day", ["accountId", "day"])
    .index("by_day", ["day"])
    .index("by_school_category_day", ["schoolId", "category", "day"])
    .index("by_meter", [
      "schoolId",
      "accountId",
      "category",
      "day",
      "dimensionsKey",
    ]),

  // One row per school, limit category and period ("day:2026-09-28",
  // "month:2026-09", "total"), kept by recordMeterEvent so AI admission
  // reads a school's usage in O(1) instead of summing usageMeters.
  schoolUsageTotals: defineTable({
    schoolId: v.id("schools"),
    category: v.literal("model_tokens"),
    periodKey: v.string(),
    quantity: v.number(),
    updatedAt: v.number(),
  }).index("by_school_period", ["schoolId", "category", "periodKey"]),

  operationalCounters: defineTable({
    schoolId: v.optional(v.id("schools")),
    day: v.string(),
    category: v.union(
      v.literal("artifact_created"),
      v.literal("thread_message"),
      v.literal("ai_run_started"),
      v.literal("ai_run_failed"),
      v.literal("workspace_created"),
      v.literal("workspace_imported"),
      v.literal("agent_invocation"),
    ),
    dimension: v.string(),
    quantity: v.number(),
    updatedAt: v.number(),
  })
    .index("by_school_day", ["schoolId", "day"])
    .index("by_day", ["day"])
    .index("by_day_category", ["day", "category"])
    .index("by_counter", ["schoolId", "day", "category", "dimension"]),

  limitPolicies: defineTable({
    schoolId: v.optional(v.id("schools")),
    scope: v.union(v.literal("platform_default"), v.literal("school")),
    rules: v.array(
      v.object({
        category: v.union(
          v.literal("storage_bytes"),
          v.literal("bandwidth_bytes"),
          v.literal("model_tokens"),
          v.literal("render_milliseconds"),
          v.literal("collaboration_bytes"),
        ),
        period: v.union(
          v.literal("day"),
          v.literal("month"),
          v.literal("total"),
        ),
        warningAt: v.optional(v.number()),
        maximum: v.number(),
      }),
    ),
    enforcement: v.union(
      v.literal("disabled"),
      v.literal("simulate"),
      v.literal("enforced"),
    ),
    updatedByAccountId: v.id("accounts"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_scope_school", ["scope", "schoolId"]),

  secretRecords: defineTable({
    schoolId: v.optional(v.id("schools")),
    purpose: v.string(),
    ciphertext: v.string(),
    nonce: v.string(),
    authTag: v.string(),
    algorithm: v.literal("aes-256-gcm"),
    keyVersion: v.number(),
    fingerprint: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("rotated"),
      v.literal("revoked"),
    ),
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

  schoolIntegrations: defineTable({
    schoolId: v.id("schools"),
    provider: v.literal("managebac"),
    baseUrl: v.string(),
    referenceUrl: v.optional(v.string()),
    authHeaderName: v.string(),
    authScheme: v.union(v.literal("raw"), v.literal("bearer")),
    status: v.union(
      v.literal("disconnected"),
      v.literal("validating"),
      v.literal("connected"),
      v.literal("degraded"),
      v.literal("blocked"),
      v.literal("revoked"),
    ),
    tokenMode: v.literal("read_only"),
    secretPurpose: v.string(),
    credentialFingerprint: v.optional(v.string()),
    providerVersion: v.optional(v.string()),
    manifestVersion: v.number(),
    manifestSourceHash: v.optional(v.string()),
    capabilityCoverage: v.object({
      discovered: v.number(),
      verifiedReadable: v.number(),
      unverified: v.number(),
      failed: v.number(),
      quarantined: v.number(),
    }),
    syncPolicy: v.object({
      frequencyMinutes: v.number(),
      autoCreateClasses: v.boolean(),
      autoImportTasks: v.boolean(),
      autoApplySafeUpdates: v.boolean(),
      conflictMode: v.union(v.literal("review"), v.literal("ask_me")),
    }),
    freshnessSlaMinutes: v.number(),
    requestBudgetPerMinute: v.number(),
    bootstrapVersion: v.number(),
    lastValidatedAt: v.optional(v.number()),
    lastSyncAt: v.optional(v.number()),
    nextSyncAt: v.optional(v.number()),
    blockedReason: v.optional(v.string()),
    rotationDueAt: v.optional(v.number()),
    createdByAccountId: v.id("accounts"),
    updatedByAccountId: v.id("accounts"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_school_provider", ["schoolId", "provider"])
    .index("by_status_next_sync", ["status", "nextSyncAt"]),

  integrationCapabilities: defineTable({
    integrationId: v.id("schoolIntegrations"),
    schoolId: v.id("schools"),
    category: v.string(),
    name: v.string(),
    recordType: v.string(),
    method: v.literal("GET"),
    path: v.string(),
    purpose: v.string(),
    scope: v.union(
      v.literal("personal"),
      v.literal("class"),
      v.literal("school"),
    ),
    minimumRole: v.union(
      v.literal("student"),
      v.literal("teacher"),
      v.literal("school_admin"),
    ),
    pagination: v.union(
      v.literal("none"),
      v.literal("page"),
      v.literal("cursor"),
      v.literal("unknown"),
    ),
    changeStrategy: v.union(
      v.literal("full_reconciliation"),
      v.literal("modified_since"),
      v.literal("cursor"),
      v.literal("unknown"),
    ),
    freshnessSlaMinutes: v.number(),
    contractVersion: v.string(),
    responseSchemaHash: v.optional(v.string()),
    permissionState: v.union(
      v.literal("read_only"),
      v.literal("not_enabled"),
      v.literal("unverified"),
    ),
    verificationStatus: v.union(
      v.literal("verified"),
      v.literal("failed"),
      v.literal("quarantined"),
      v.literal("unverified"),
    ),
    routeSource: v.union(
      v.literal("tenant_reference"),
      v.literal("api_manager"),
      v.literal("manual_verified"),
    ),
    personalIdParameter: v.optional(v.string()),
    normalization: v.any(),
    lastVerifiedAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    lastErrorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_integration", ["integrationId"])
    .index("by_integration_category", ["integrationId", "category"])
    .index("by_integration_path", ["integrationId", "path"])
    .index("by_school_status", ["schoolId", "verificationStatus"]),

  externalIdentityMappings: defineTable({
    integrationId: v.id("schoolIntegrations"),
    schoolId: v.id("schools"),
    accountId: v.id("accounts"),
    providerUserId: v.optional(v.string()),
    providerUserIdHash: v.optional(v.string()),
    verifiedEmailHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("verified"),
      v.literal("no_match"),
      v.literal("ambiguous"),
      v.literal("revoked"),
    ),
    evidenceCapabilityId: v.optional(v.id("integrationCapabilities")),
    /** The student's year group from the identity lookup; CAS is read per year group. */
    providerYearGroupId: v.optional(v.string()),
    matchCount: v.number(),
    resolvedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_integration_account", ["integrationId", "accountId"])
    .index("by_school_status", ["schoolId", "status"])
    .index("by_provider_hash", ["integrationId", "providerUserIdHash"]),

  /**
   * A person's explicit ManageBac class scope. This is deliberately separate
   * from the provider membership rows: a membership is evidence of access,
   * while this row is the user's planning choice. One row per account,
   * integration, class and academic period makes add/remove idempotent and
   * prevents a same-named provider class from crossing account or rollover
   * boundaries.
   */
  managebacClassSelections: defineTable({
    integrationId: v.id("schoolIntegrations"),
    schoolId: v.id("schools"),
    accountId: v.id("accounts"),
    providerClassId: v.string(),
    providerRecordKey: v.string(),
    academicPeriodKey: v.optional(v.string()),
    selected: v.boolean(),
    retention: v.union(
      v.literal("keep_in_spectra"),
      v.literal("archive_projection"),
    ),
    selectionRevision: v.number(),
    selectedAt: v.optional(v.number()),
    deselectedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_integration", ["accountId", "integrationId"])
    .index("by_account_period", ["accountId", "academicPeriodKey"])
    .index("by_integration_account_class", [
      "integrationId",
      "accountId",
      "providerClassId",
    ])
    .index("by_selection_revision", [
      "integrationId",
      "accountId",
      "selectionRevision",
    ]),

  externalRecords: defineTable({
    integrationId: v.id("schoolIntegrations"),
    schoolId: v.id("schools"),
    providerRecordId: v.string(),
    providerRecordKey: v.string(),
    /** Canonical identity; legacy rows may be backfilled lazily. */
    sourceIdentityKey: v.optional(v.string()),
    recordType: v.string(),
    classification: v.union(
      v.literal("personal"),
      v.literal("class"),
      v.literal("school"),
      v.literal("public_resource"),
    ),
    audienceScope: v.union(
      v.literal("mapped_user"),
      v.literal("class_members"),
      v.literal("authorized_staff"),
      v.literal("school"),
    ),
    mappedAccountId: v.optional(v.id("accounts")),
    providerClassId: v.optional(v.string()),
    academicPeriodKey: v.optional(v.string()),
    /** The student's kind of data this personal record belongs to (shared/school-sync.ts).
     * Set at commit; preferences, purges and the School API read by it. */
    syncKind: v.optional(vSchoolSyncKind),
    normalized: v.any(),
    payloadVersion: v.string(),
    sourceHash: v.string(),
    sourceState: v.optional(
      v.union(
        v.literal("available"),
        v.literal("changed"),
        v.literal("temporarily_unavailable"),
        v.literal("missing"),
        v.literal("removed"),
      ),
    ),
    sourceStateAt: v.optional(v.number()),
    sourceStateReason: v.optional(v.string()),
    sourceModifiedAt: v.optional(v.number()),
    provenanceUrl: v.optional(v.string()),
    tombstone: v.boolean(),
    tombstonedAt: v.optional(v.number()),
    fetchedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_integration_key", ["integrationId", "providerRecordKey"])
    .index("by_source_identity", ["integrationId", "sourceIdentityKey"])
    .index("by_integration_type", ["integrationId", "recordType"])
    .index("by_account_type", ["mappedAccountId", "recordType"])
    .index("by_visibility_membership", ["integrationId", "providerClassId", "academicPeriodKey", "mappedAccountId", "recordType"])
    .index("by_class_type", ["providerClassId", "recordType"])
    .index("by_account_kind_class", ["mappedAccountId", "syncKind", "providerClassId"])
    .index("by_school_updated", ["schoolId", "updatedAt"]),

  externalRecordRelations: defineTable({
    integrationId: v.id("schoolIntegrations"),
    schoolId: v.id("schools"),
    sourceRecordId: v.id("externalRecords"),
    targetRecordId: v.id("externalRecords"),
    relationType: v.union(
      v.literal("belongs_to_class"),
      v.literal("assigned_to"),
      v.literal("scheduled_as"),
      v.literal("resource_for"),
      v.literal("assessment_for"),
      v.literal("deadline_for"),
      v.literal("derived_from"),
    ),
    createdAt: v.number(),
  })
    .index("by_source", ["sourceRecordId"])
    .index("by_target", ["targetRecordId"])
    .index("by_integration", ["integrationId"]),

  /**
   * Durable ledger for the bounded legacy identity migration. A duplicate is
   * recorded instead of deleted so existing overlays and projections remain
   * recoverable while an administrator resolves the provenance link.
   */
  externalRecordIdentityMigrations: defineTable({
    integrationId: v.id("schoolIntegrations"),
    schoolId: v.id("schools"),
    legacyRecordId: v.id("externalRecords"),
    canonicalKey: v.string(),
    status: v.union(v.literal("linked"), v.literal("duplicate")),
    survivorRecordId: v.optional(v.id("externalRecords")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacy_record", ["legacyRecordId"])
    .index("by_canonical_key", ["integrationId", "canonicalKey"]),

  externalRecordOverlays: defineTable({
    recordId: v.id("externalRecords"),
    schoolId: v.id("schools"),
    accountId: v.id("accounts"),
    notes: v.optional(v.string()),
    completion: v.optional(v.boolean()),
    reminders: v.optional(v.array(v.number())),
    tags: v.array(v.string()),
    alternativeStartAt: v.optional(v.number()),
    alternativeEndAt: v.optional(v.number()),
    placementWorkspaceId: v.optional(v.id("spectraWorkspaces")),
    linkedArtifactIds: v.array(v.id("spectraArtifacts")),
    sourceHashAtEdit: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_record_account", ["recordId", "accountId"])
    .index("by_account_updated", ["accountId", "updatedAt"])
    // School export pages through one school's rows instead of every tenant's.
    .index("by_school", ["schoolId", "updatedAt"]),

  externalSyncRuns: defineTable({
    integrationId: v.id("schoolIntegrations"),
    schoolId: v.id("schools"),
    accountId: v.optional(v.id("accounts")),
    kind: v.union(
      v.literal("validation"),
      v.literal("identity"),
      v.literal("bootstrap"),
      v.literal("scheduled"),
      v.literal("manual"),
      v.literal("reconciliation"),
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("leased"),
      v.literal("running"),
      v.literal("awaiting_review"),
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    trigger: v.union(
      v.literal("user"),
      v.literal("school_admin"),
      v.literal("schedule"),
      v.literal("bootstrap"),
      v.literal("retry"),
      v.literal("ai"),
    ),
    bootstrapVersion: v.optional(v.number()),
    stage: v.string(),
    capabilityIds: v.array(v.id("integrationCapabilities")),
    currentCapabilityId: v.optional(v.id("integrationCapabilities")),
    cursorState: v.optional(v.any()),
    /** Staged provider projection work; the run stays running until it drains. */
    projectionWorkRemaining: v.optional(v.number()),
    projectionIngestionComplete: v.optional(v.boolean()),
    counts: v.object({
      fetched: v.number(),
      created: v.number(),
      updated: v.number(),
      unchanged: v.number(),
      tombstoned: v.number(),
      projected: v.number(),
      skipped: v.number(),
      quarantined: v.number(),
      conflicts: v.number(),
      errors: v.number(),
    }),
    leaseOwner: v.optional(v.string()),
    /** Fences late provider responses from an expired/replaced worker. */
    leaseToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    /** Snapshot of the account's class selection at claim time. */
    selectionRevision: v.optional(v.number()),
    /** The student's kind of data this job syncs. A school-wide reconciliation has none. */
    syncKind: v.optional(vSchoolSyncKind),
    /** Optional class scope carried by class-specific sync runs. */
    providerClassId: v.optional(v.string()),
    academicPeriodKey: v.optional(v.string()),
    attemptCount: v.number(),
    nextAttemptAt: v.number(),
    errorCode: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_next_attempt", ["status", "nextAttemptAt"])
    .index("by_integration_created", ["integrationId", "createdAt"])
    .index("by_account_created", ["accountId", "createdAt"])
    .index("by_integration_account_status", [
      "integrationId",
      "accountId",
      "status",
    ])
    .index("by_integration_account_kind_status", ["integrationId", "accountId", "syncKind", "status"])
    .index("by_integration_status", ["integrationId", "status"])
    .index("by_school_created", ["schoolId", "createdAt"]),

  externalSyncCapabilityRuns: defineTable({
    syncRunId: v.id("externalSyncRuns"),
    integrationId: v.id("schoolIntegrations"),
    capabilityId: v.id("integrationCapabilities"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
      v.literal("quarantined"),
      v.literal("skipped"),
    ),
    pageCount: v.number(),
    recordCount: v.number(),
    cursor: v.optional(v.string()),
    retryAfterAt: v.optional(v.number()),
    schemaHash: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sync_run", ["syncRunId"])
    .index("by_capability_created", ["capabilityId", "createdAt"]),

  /**
   * One row per record a sync pass saw, written with the page that saw it.
   * A pass can span several requests, so the reconciliation that removes
   * records the provider no longer lists reads these rows instead of a key
   * set carried by one request. Deleted when the pass closes.
   */
  externalSyncSeenKeys: defineTable({
    syncRunId: v.id("externalSyncRuns"),
    schoolId: v.id("schools"),
    sourceIdentityKey: v.string(),
    providerRecordKey: v.string(),
  })
    .index("by_run_identity", ["syncRunId", "sourceIdentityKey"])
    .index("by_run_provider", ["syncRunId", "providerRecordKey"])
    .index("by_school", ["schoolId"]),

  externalSyncConflicts: defineTable({
    /** An accepted resolution still applying: rebase/keep to canonical rooms,
     * or any resolution across a school-wide record's projections in batches. */
    projectionResolution: v.optional(
      v.union(
        v.literal("rebase"),
        v.literal("keep_overlay"),
        v.literal("detach"),
        v.literal("archive_projection"),
        v.literal("link_existing"),
      ),
    ),
    projectionWorkRemaining: v.optional(v.number()),
    syncRunId: v.id("externalSyncRuns"),
    integrationId: v.id("schoolIntegrations"),
    schoolId: v.id("schools"),
    accountId: v.optional(v.id("accounts")),
    recordId: v.id("externalRecords"),
    projectionType: v.union(
      v.literal("workspace"),
      v.literal("planner_task"),
      v.literal("timetable_event"),
      v.literal("resource"),
      v.literal("link"),
    ),
    projectionId: v.optional(v.string()),
    kind: v.union(
      v.literal("source_changed"),
      v.literal("source_removed"),
      v.literal("duplicate_projection"),
      v.literal("changed_due_date"),
      v.literal("ambiguous_relation"),
      v.literal("customization_overlap"),
    ),
    oldSource: v.any(),
    newSource: v.any(),
    overlay: v.optional(v.any()),
    affectedLinks: v.array(v.string()),
    suggestedActions: v.array(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("resolved"),
      v.literal("dismissed"),
    ),
    resolution: v.optional(
      v.union(
        v.literal("rebase"),
        v.literal("keep_overlay"),
        v.literal("detach"),
        v.literal("archive_projection"),
        v.literal("link_existing"),
      ),
    ),
    resolvedByAccountId: v.optional(v.id("accounts")),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_integration_status", ["integrationId", "status"])
    .index("by_account_status", ["accountId", "status"])
    .index("by_record_status", ["recordId", "status"]),

  externalQuarantineRecords: defineTable({
    syncRunId: v.id("externalSyncRuns"),
    integrationId: v.id("schoolIntegrations"),
    schoolId: v.id("schools"),
    capabilityId: v.id("integrationCapabilities"),
    providerRecordKeyHash: v.string(),
    payloadHash: v.string(),
    sanitizedSample: v.optional(v.any()),
    reasonCode: v.string(),
    contractVersion: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("reprocessed"),
      v.literal("dismissed"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_integration_status", ["integrationId", "status"])
    .index("by_sync_run", ["syncRunId"]),

  externalProjections: defineTable({
    integrationId: v.id("schoolIntegrations"),
    schoolId: v.id("schools"),
    recordId: v.id("externalRecords"),
    accountId: v.optional(v.id("accounts")),
    projectionType: v.union(
      v.literal("workspace"),
      v.literal("planner_task"),
      v.literal("timetable_event"),
      v.literal("resource"),
      v.literal("link"),
    ),
    projectionId: v.string(),
    providerKey: v.string(),
    sourceHash: v.string(),
    pendingProvider: v.optional(providerProjectionIntent),
    providerReceipt: v.optional(providerProjectionReceipt),
    overlayHash: v.optional(v.string()),
    state: v.union(
      v.literal("active"),
      v.literal("detached"),
      v.literal("tombstoned"),
      v.literal("conflicted"),
    ),
    bootstrapVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_record_type", ["recordId", "projectionType"])
    .index("by_provider_key", ["integrationId", "providerKey"])
    .index("by_projection", ["projectionType", "projectionId"])
    .index("by_account_updated", ["accountId", "updatedAt"])
    /** A personal sync reads its own projections of a widely shared source. */
    .index("by_account_record", ["accountId", "recordId"]),

  /**
   * Account-scoped receipt for an explicit provider-resource download. The
   * provider record id never comes from a URL, and a source revision is never
   * overwritten by a later import. This ledger is also the retry/replay seam.
   */
  managebacResourceImports: defineTable({
    integrationId: v.id("schoolIntegrations"),
    schoolId: v.id("schools"),
    accountId: v.id("accounts"),
    sourceRecordId: v.id("externalRecords"),
    sourceHash: v.string(),
    requestKey: v.string(),
    status: v.union(
      v.literal("started"),
      v.literal("importing"),
      v.literal("imported"),
      v.literal("failed"),
    ),
    artifactId: v.optional(v.id("spectraArtifacts")),
    contentHash: v.optional(v.string()),
    bytes: v.optional(v.number()),
    mimeType: v.optional(v.string()),
    nativeFormat: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_source", ["accountId", "sourceRecordId", "sourceHash"])
    .index("by_account_source_record", ["accountId", "sourceRecordId"])
    .index("by_account_request", ["accountId", "requestKey"])
    .index("by_school_updated", ["schoolId", "updatedAt"]),

  /**
   * A student's mode for one kind of School data (docs/product/SCHOOL.md). No row means the
   * kind's default. Background sync reads these; nothing syncs for Off.
   */
  schoolSyncPreferences: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    integrationId: v.id("schoolIntegrations"),
    kind: vSchoolSyncKind,
    mode: vSchoolSyncMode,
    updatedAt: v.number(),
  })
    .index("by_account_integration_kind", ["accountId", "integrationId", "kind"])
    .index("by_school", ["schoolId"]),

  /** One class's mode for one kind, overriding the student's mode for that kind. */
  schoolSyncClassOverrides: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    integrationId: v.id("schoolIntegrations"),
    providerClassId: v.string(),
    kind: vSchoolSyncKind,
    mode: vSchoolSyncMode,
    updatedAt: v.number(),
  })
    .index("by_account_integration_kind_class", ["accountId", "integrationId", "kind", "providerClassId"])
    .index("by_school", ["schoolId"]),

  /**
   * Where one student's sync job for one kind stands: last and next run, and the last problem
   * in plain words. `dueAt` is when the background worker should run it next.
   */
  schoolSyncStates: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    integrationId: v.id("schoolIntegrations"),
    kind: vSchoolSyncKind,
    state: vSchoolSyncState,
    dueAt: v.optional(v.number()),
    dueTrigger: v.optional(vSchoolSyncTrigger),
    lastRunAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    lastSyncRunId: v.optional(v.id("externalSyncRuns")),
    errorCode: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_account_integration_kind", ["accountId", "integrationId", "kind"])
    .index("by_due", ["dueAt"])
    .index("by_school", ["schoolId"]),

  /**
   * A file one student keeps from School: a dropbox submission fetched on demand, or CAS
   * evidence they added. Readable only by that student. Bytes live in storage once per
   * student and content hash.
   */
  schoolFiles: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    integrationId: v.id("schoolIntegrations"),
    /** The submission or CAS experience it belongs to. */
    sourceRecordId: v.id("externalRecords"),
    origin: v.union(v.literal("dropbox"), v.literal("cas_evidence")),
    providerFileId: v.optional(v.string()),
    filename: v.string(),
    mimeType: v.string(),
    state: v.union(v.literal("listed"), v.literal("fetching"), v.literal("cached"), v.literal("failed")),
    bytes: v.optional(v.number()),
    /** SHA-256 of the bytes, hex. */
    contentHash: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    /** Text extracted for search, bounded. */
    extractedText: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    fetchedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_source", ["accountId", "sourceRecordId"])
    .index("by_account_hash", ["accountId", "contentHash"])
    .index("by_account_updated", ["accountId", "updatedAt"])
    .index("by_storage", ["storageId"])
    .index("by_school", ["schoolId"]),

  /** A CAS reflection written in Spectra. ManageBac's API can't store it (CAS_WRITE_BACK). */
  casReflections: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    experienceRecordId: v.id("externalRecords"),
    body: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_experience", ["accountId", "experienceRecordId"])
    .index("by_school", ["schoolId"]),

  /** Which of the seven CAS learning outcomes one experience meets, tagged by the student. */
  casOutcomeTags: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    experienceRecordId: v.id("externalRecords"),
    outcomes: v.array(v.number()),
    updatedAt: v.number(),
  })
    .index("by_account_experience", ["accountId", "experienceRecordId"])
    .index("by_school", ["schoolId"]),

  calendarItems: defineTable({
    ownerAccountId: v.id("accounts"),
    schoolId: v.id("schools"),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    kind: v.union(
      v.literal("official_event"),
      v.literal("official_deadline"),
      v.literal("task"),
      v.literal("scheduled_work_block"),
      v.literal("personal_event"),
      v.literal("milestone"),
      v.literal("reminder"),
    ),
    title: v.string(),
    notes: v.optional(v.string()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    allDay: v.boolean(),
    timezone: v.string(),
    timePrecision: v.union(
      v.literal("exact"),
      v.literal("verified_period"),
      v.literal("date_only"),
      v.literal("unknown"),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("removed"),
    ),
    sourceLocked: v.boolean(),
    sourceProvider: v.optional(v.string()),
    sourceRecordId: v.optional(v.id("externalRecords")),
    sourceKey: v.optional(v.string()),
    sourceHash: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceFreshAt: v.optional(v.number()),
    sourceCapabilityState: v.optional(
      v.union(
        v.literal("available"),
        v.literal("refreshing"),
        v.literal("stale"),
        v.literal("partial"),
        v.literal("permission_denied"),
        v.literal("unsupported"),
        v.literal("schema_incompatible"),
        v.literal("unavailable"),
      ),
    ),
    location: v.optional(v.string()),
    teacher: v.optional(v.string()),
    classId: v.optional(v.string()),
    planArtifactId: v.optional(v.id("spectraArtifacts")),
    planTaskId: v.optional(v.string()),
    taskItemId: v.optional(v.id("calendarItems")),
    officialDeadlineItemId: v.optional(v.id("calendarItems")),
    linkedArtifactIds: v.array(v.id("spectraArtifacts")),
    recurrence: v.optional(v.string()),
    legacyArtifactId: v.optional(v.id("spectraArtifacts")),
    legacyEventId: v.optional(v.string()),
    /** Caller-owned identity for retrying one scheduled work-block request. */
    idempotencyKey: v.optional(v.string()),
    /** Original request and source identity; canonical targets remain on the block. */
    scheduleScope: v.optional(v.object({
      requestTaskItemId: v.optional(v.id("calendarItems")),
      requestPlanTaskId: v.optional(v.string()),
      sourceRecordId: v.optional(v.id("externalRecords")),
    })),
    revision: v.number(),
    createdBy: v.union(
      v.literal("human"),
      v.literal("ai"),
      v.literal("source"),
      v.literal("migration"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_start", ["ownerAccountId", "startAt"])
    .index("by_account_status", ["ownerAccountId", "status"])
    .index("by_account_kind", ["ownerAccountId", "kind"])
    .index("by_source_key", ["ownerAccountId", "sourceKey"])
    .index("by_source_record", ["sourceRecordId"])
    .index("by_plan_task", ["planArtifactId", "planTaskId"])
    .index("by_task_item", ["taskItemId"])
    .index("by_legacy_event", ["legacyArtifactId", "legacyEventId"])
    .index("by_schedule_idempotency", ["ownerAccountId", "idempotencyKey"]),

  // Calendar discovery never needs the payload-bearing planner/timetable
  // artifact or the canonical calendar row. These two compact tables are
  // maintained by the same mutation trigger as their canonical writers.
  calendarItemReadModels: defineTable({
    readModelVersion: v.number(),
    itemId: v.id("calendarItems"),
    ownerAccountId: v.id("accounts"),
    schoolId: v.id("schools"),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    kind: v.union(
      v.literal("official_event"),
      v.literal("official_deadline"),
      v.literal("task"),
      v.literal("scheduled_work_block"),
      v.literal("personal_event"),
      v.literal("milestone"),
      v.literal("reminder"),
    ),
    title: v.string(),
    notes: v.optional(v.string()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    allDay: v.boolean(),
    timezone: v.string(),
    timePrecision: v.union(
      v.literal("exact"),
      v.literal("verified_period"),
      v.literal("date_only"),
      v.literal("unknown"),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("removed"),
    ),
    sourceLocked: v.boolean(),
    sourceProvider: v.optional(v.string()),
    sourceRecordId: v.optional(v.id("externalRecords")),
    sourceKey: v.optional(v.string()),
    sourceHash: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceFreshAt: v.optional(v.number()),
    sourceCapabilityState: v.optional(
      v.union(
        v.literal("available"),
        v.literal("refreshing"),
        v.literal("stale"),
        v.literal("partial"),
        v.literal("permission_denied"),
        v.literal("unsupported"),
        v.literal("schema_incompatible"),
        v.literal("unavailable"),
      ),
    ),
    location: v.optional(v.string()),
    teacher: v.optional(v.string()),
    classId: v.optional(v.string()),
    planArtifactId: v.optional(v.id("spectraArtifacts")),
    planTaskId: v.optional(v.string()),
    taskItemId: v.optional(v.id("calendarItems")),
    officialDeadlineItemId: v.optional(v.id("calendarItems")),
    linkedArtifactIds: v.array(v.id("spectraArtifacts")),
    recurrence: v.optional(v.string()),
    legacyArtifactId: v.optional(v.id("spectraArtifacts")),
    legacyEventId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    revision: v.number(),
    createdBy: v.union(
      v.literal("human"),
      v.literal("ai"),
      v.literal("source"),
      v.literal("migration"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_item", ["itemId"])
    .index("by_account_status_start", ["ownerAccountId", "status", "startAt"])
    .index("by_account_status_end", ["ownerAccountId", "status", "endAt"])
    .index("by_account_status_kind", ["ownerAccountId", "status", "kind"])
    .index("by_account_status_title", ["ownerAccountId", "status", "title"])
    .index("by_account_status_title_item", ["ownerAccountId", "status", "title", "itemId"])
    .index("by_account_status_source", [
      "ownerAccountId",
      "status",
      "kind",
      "sourceRecordId",
    ])
    .index("by_account_source_kind", ["ownerAccountId", "sourceRecordId", "kind"])
    .index("by_account_task_status", ["ownerAccountId", "taskItemId", "status"])
    .index("by_account_status_kind_updated_item", [
      "ownerAccountId",
      "status",
      "kind",
      "updatedAt",
      "itemId",
    ])
    .index("by_account_updated", ["ownerAccountId", "updatedAt"]),

  // One row per UTC day makes overlap discovery indexed and bounded. Very
  // long-running items also get a `__wide__` row so no date range is silently
  // truncated when a block spans more than the materialized horizon.
  calendarItemRangeBuckets: defineTable({
    readModelVersion: v.number(),
    itemId: v.id("calendarItems"),
    ownerAccountId: v.id("accounts"),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("removed"),
    ),
    bucketKey: v.string(),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
  })
    .index("by_account_status_bucket", [
      "ownerAccountId",
      "status",
      "bucketKey",
    ])
    .index("by_item_bucket", ["itemId", "bucketKey"]),

  calendarPlanTaskReadModels: defineTable({
    readModelVersion: v.number(),
    planArtifactId: v.id("spectraArtifacts"),
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    planUpdatedAt: v.number(),
    planTitle: v.string(),
    taskId: v.string(),
    title: v.string(),
    notes: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    taskStatus: v.union(v.literal("active"), v.literal("completed")),
    scheduled: v.boolean(),
    planStatus: v.union(
      v.literal("active"),
      v.literal("draft"),
      v.literal("archived"),
      v.literal("deleted"),
    ),
    sourceRecordId: v.optional(v.id("externalRecords")),
    updatedAt: v.number(),
  })
    .index("by_plan_task", ["planArtifactId", "taskId"])
    .index("by_plan", ["planArtifactId"])
    .index("by_account_status", ["ownerAccountId", "planStatus", "taskStatus"])
    .index("by_account_plan_status_updated", [
      "ownerAccountId",
      "planStatus",
      "updatedAt",
    ])
    .index("by_account_plan_status_updated_task", [
      "ownerAccountId",
      "planStatus",
      "updatedAt",
      "planArtifactId",
      "taskId",
    ])
    .index("by_account_updated", ["ownerAccountId", "updatedAt"]),

  // Calendar migration state is a compact, resumable companion to the legacy
  // timetable artifact. It avoids reopening every timetable body on mount.
  calendarMigrationReadModels: defineTable({
    readModelVersion: v.number(),
    legacyArtifactId: v.id("spectraArtifacts"),
    ownerAccountId: v.id("accounts"),
    schoolId: v.id("schools"),
    artifactStatus: v.union(
      v.literal("active"),
      v.literal("draft"),
      v.literal("archived"),
      v.literal("deleted"),
    ),
    migrationStatus: v.union(
      v.literal("missing"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    migratedCount: v.number(),
    skippedCount: v.number(),
    eventOffset: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_legacy_artifact", ["legacyArtifactId"])
    .index("by_account_status", [
      "ownerAccountId",
      "artifactStatus",
      "migrationStatus",
    ])
    .index("by_account_artifact_status", [
      "ownerAccountId",
      "artifactStatus",
      "updatedAt",
    ])
    .index("by_account_artifact_status_updated_legacy", [
      "ownerAccountId",
      "artifactStatus",
      "updatedAt",
      "legacyArtifactId",
    ])
    .index("by_account_updated", ["ownerAccountId", "updatedAt"]),

  calendarPeriodMaps: defineTable({
    schoolId: v.id("schools"),
    periodKey: v.string(),
    label: v.string(),
    startMinutes: v.number(),
    endMinutes: v.number(),
    timezone: v.string(),
    weekdays: v.array(v.number()),
    verifiedByAccountId: v.id("accounts"),
    verifiedAt: v.number(),
    source: v.union(v.literal("school_admin"), v.literal("provider_contract")),
    sourceVersion: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_school_period", ["schoolId", "periodKey"])
    .index("by_school_updated", ["schoolId", "updatedAt"]),

  calendarMigrations: defineTable({
    ownerAccountId: v.id("accounts"),
    schoolId: v.id("schools"),
    legacyArtifactId: v.id("spectraArtifacts"),
    version: v.number(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    migratedCount: v.number(),
    skippedCount: v.number(),
    errorSummary: v.optional(v.string()),
    eventOffset: v.optional(v.number()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_legacy_artifact", ["legacyArtifactId"])
    .index("by_account_status", ["ownerAccountId", "status"]),

  spectraWorkspaces: defineTable({
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    title: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    starterKey: v.optional(v.string()),
    sourceContext: v.optional(
      v.object({
        provider: v.string(),
        integrationId: v.id("schoolIntegrations"),
        sourceRecordId: v.id("externalRecords"),
        providerClassId: v.optional(v.string()),
        academicPeriodKey: v.optional(v.string()),
        sourceHash: v.string(),
        freshAt: v.number(),
        projectedTitle: v.optional(v.string()),
        capabilityState: v.union(
          v.literal("available"),
          v.literal("stale"),
          v.literal("partial"),
        ),
        availableCapabilities: v.array(v.string()),
        missingCapabilities: v.array(v.string()),
      }),
    ),
    aiState: v.optional(
      v.union(
        v.literal("creating"),
        v.literal("updating"),
        v.literal("edited"),
        v.literal("failed"),
      ),
    ),
    aiRunId: v.optional(v.id("spectraAiRuns")),
    aiExecutionId: v.optional(v.string()),
    aiPending: v.optional(v.boolean()),
    aiStateExpiresAt: v.optional(v.number()),
    aiPreview: v.optional(
      v.object({
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        icon: v.optional(v.string()),
        color: v.optional(v.string()),
        startedAt: v.number(),
      }),
    ),
    permanentDeleteJobId: v.optional(v.id("workspaceDeletionJobs")),
    status: v.union(v.literal("active"), v.literal("archived")),
    defaultView: v.union(
      v.literal("cards"),
      // Legacy storage-only values. D30 forbids new writes and every read is
      // normalized by spectraWorkspaces.liveWorkspace. Remove these literals
      // only after the separately executed data migration has rewritten rows.
      v.literal("canvas"),
      v.literal("timeline"),
      v.literal("library"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastActivityAt: v.number(),
  })
    .index("by_account_status", ["ownerAccountId", "status"])
    .index("by_account_status_activity", [
      "ownerAccountId",
      "status",
      "lastActivityAt",
    ])
    .index("by_account_starter", ["ownerAccountId", "starterKey"])
    .index("by_school_status", ["schoolId", "status"])
    .index("by_school_starter_status", ["schoolId", "starterKey", "status"])
    .index("by_school_activity", ["schoolId", "lastActivityAt"])
    .index("by_school_status_activity", ["schoolId", "status", "lastActivityAt"])
    .index("by_account_activity", ["ownerAccountId", "lastActivityAt"])
    .index("by_ai_run", ["aiRunId"]),

  workspaceDeletionJobs: defineTable({
    workspaceId: v.id("spectraWorkspaces"),
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    requestedByAccountId: v.id("accounts"),
    phase: v.union(
      v.literal("detach_artifact_metadata"),
      v.literal("move_children"),
      v.literal("detach_threads"),
      v.literal("detach_runs"),
      v.literal("delete_memory_evidence"),
      v.literal("expire_memory_claims"),
      v.literal("finalize"),
      v.literal("complete"),
    ),
    cursor: v.optional(v.string()),
    movedChildCount: v.number(),
    detachedArtifactCount: v.number(),
    detachedThreadCount: v.number(),
    detachedRunCount: v.number(),
    deletedEvidenceCount: v.number(),
    expiredClaimCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId", "createdAt"])
    .index("by_phase_updated", ["phase", "updatedAt"]),

  spectraArtifacts: defineTable({
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    resourceClass: v.optional(
      v.union(
        v.literal("artifact"),
        v.literal("resource"),
        v.literal("thread_reference"),
      ),
    ),
    nativeFormat: v.optional(v.string()),
    compatibilityProfile: v.optional(
      v.union(
        v.literal("strict-native"),
        v.literal("enhanced"),
        v.literal("spectra-native"),
      ),
    ),
    blueprintKey: v.string(),
    title: v.string(),
    summary: v.optional(v.string()),
    content: v.any(),
    schemaVersion: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    projectionPayloadRef: v.optional(v.string()),
    projectionPayloadDigest: v.optional(v.string()),
    pendingPayloadRef: v.optional(v.string()),
    pendingContentHash: v.optional(v.string()),
    pendingBaseRevision: v.optional(v.string()),
    protectedBaseContent: v.optional(v.any()),
    protectedBaseContentHash: v.optional(v.string()),
    protectedBaseTextIndex: v.optional(v.string()),
    protectedOriginal: v.optional(v.boolean()),
    currentVersionId: v.optional(v.id("spectraArtifactVersions")),
    syncState: v.optional(
      v.union(
        v.literal("synchronizing"),
        v.literal("synchronized"),
        v.literal("reconnecting"),
        v.literal("unsynchronized"),
        v.literal("conflict"),
        v.literal("permission_lost"),
      ),
    ),
    validity: v.optional(
      v.union(v.literal("valid"), v.literal("invalid"), v.literal("checking")),
    ),
    validityIssues: v.optional(
      v.array(
        v.object({
          code: v.string(),
          regionId: v.optional(v.string()),
          message: v.string(),
        }),
      ),
    ),
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
    deletionGeneration: v.optional(v.number()),
    deletionRequestedAt: v.optional(v.number()),
    aiState: v.optional(
      v.union(
        v.literal("creating"),
        v.literal("updating"),
        v.literal("edited"),
        v.literal("failed"),
      ),
    ),
    aiRunId: v.optional(v.id("spectraAiRuns")),
    aiExecutionId: v.optional(v.string()),
    aiProgress: v.optional(v.number()),
    aiStateExpiresAt: v.optional(v.number()),
    aiPreview: v.optional(
      v.object({
        title: v.optional(v.string()),
        summary: v.optional(v.string()),
        content: v.optional(v.any()),
        tags: v.optional(v.array(v.string())),
        changedPaths: v.optional(v.array(v.string())),
        effectTitle: v.optional(v.string()),
        effectDetail: v.optional(v.string()),
        effectActivity: v.optional(
          v.union(
            v.literal("create"),
            v.literal("edit"),
            v.literal("verify"),
            v.literal("other"),
          ),
        ),
        effectRegionHint: v.optional(v.string()),
        effectOperationIndex: v.optional(v.number()),
        startedAt: v.number(),
      }),
    ),
    aiEffects: v.optional(
      v.array(
        v.object({
          effectId: v.string(),
          runId: v.id("spectraAiRuns"),
          executionId: v.string(),
          operationIndex: v.optional(v.number()),
          title: v.string(),
          detail: v.optional(v.string()),
          activity: v.union(
            v.literal("create"),
            v.literal("edit"),
            v.literal("verify"),
            v.literal("other"),
          ),
          regionHint: v.optional(v.string()),
          regionIds: v.array(v.string()),
          changedPaths: v.array(v.string()),
          state: v.union(v.literal("active"), v.literal("settling")),
          startedAt: v.number(),
          updatedAt: v.number(),
          expiresAt: v.optional(v.number()),
        }),
      ),
    ),
    createdFrom: v.optional(
      v.object({
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
        operationId: v.optional(v.id("spectraOperations")),
        allocationContentDigest: v.optional(v.string()),
        sourceArtifactIds: v.optional(v.array(v.id("spectraArtifacts"))),
        sourceThreadIds: v.optional(v.array(v.id("spectraThreads"))),
        sourceAttachmentNames: v.optional(v.array(v.string())),
        sourceAttachmentIds: v.optional(v.array(v.string())),
        sourceBundle: v.optional(v.any()),
        contextSummary: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_status", ["ownerAccountId", "status"])
    .index("by_account_updated", ["ownerAccountId", "updatedAt"])
    .index("by_account_created", ["ownerAccountId", "createdAt"])
    .index("by_account_status_updated", [
      "ownerAccountId",
      "status",
      "updatedAt",
    ])
    .index("by_account_blueprint", ["ownerAccountId", "blueprintKey"])
    .index("by_pending_payload_ref", ["pendingPayloadRef"])
    .index("by_blueprint_status_updated", [
      "blueprintKey",
      "status",
      "updatedAt",
    ])
    .index("by_school_status", ["schoolId", "status", "updatedAt"])
    .index("by_ai_run", ["aiRunId"])
    .index("by_created_thread", ["createdFrom.threadId", "updatedAt"])
    .index("by_created_workspace", ["createdFrom.workspaceId"])
    .searchIndex("search_text", {
      searchField: "textIndex",
      filterFields: ["ownerAccountId", "blueprintKey", "status"],
    }),

  // Library/board reads must never hydrate the payload-bearing artifact row.
  // This bounded projection is maintained transactionally by the artifact and
  // organization write seams; `projection` is an explicit allowlist assembled
  // in orgTreeShared rather than a spread of the source document.
  spectraArtifactSummaries: defineTable({
    // Versioned authority/read metadata.  Legacy rows may omit these fields
    // until the bounded backfill has visited them; readers must use the
    // canonical row only for that mixed-record repair path.
    readModelVersion: v.optional(v.number()),
    artifactId: v.id("spectraArtifacts"),
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    blueprintKey: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("draft"),
      v.literal("archived"),
      v.literal("deleted"),
    ),
    updatedAt: v.number(),
    searchText: v.string(),
    createdAt: v.optional(v.number()),
    createdFromThreadId: v.optional(v.id("spectraThreads")),
    createdFromWorkspaceId: v.optional(v.id("spectraWorkspaces")),
    aiRunId: v.optional(v.id("spectraAiRuns")),
    currentVersionId: v.optional(v.id("spectraArtifactVersions")),
    contentHash: v.optional(v.string()),
    schemaVersion: v.optional(v.number()),
    deletionGeneration: v.optional(v.number()),
    projection: v.any(),
  })
    .index("by_artifact", ["artifactId"])
    .index("by_account_created", ["ownerAccountId", "createdAt"])
    .index("by_account_status_updated", [
      "ownerAccountId",
      "status",
      "updatedAt",
    ])
    .index("by_school_status_updated_id", ["schoolId", "status", "updatedAt", "artifactId"])
    .index("by_account_status_updated_id", ["ownerAccountId", "status", "updatedAt", "artifactId"])
    .index("by_account_blueprint_status_updated", [
      "ownerAccountId",
      "blueprintKey",
      "status",
      "updatedAt",
    ])
    .index("by_created_thread", ["createdFromThreadId", "updatedAt"])
    .index("by_ai_run", ["aiRunId", "updatedAt"]),

  // Revision facts are needed by synchronization/detail consumers but are not
  // part of the hot Library/board summary. Keeping them separate prevents a
  // content checkpoint from changing an undisplayed field on every list row.
  spectraArtifactRevisionFacts: defineTable({
    readModelVersion: v.number(),
    artifactId: v.id("spectraArtifacts"),
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    currentVersionId: v.optional(v.id("spectraArtifactVersions")),
    contentHash: v.optional(v.string()),
    schemaVersion: v.optional(v.number()),
    deletionGeneration: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_artifact", ["artifactId"]),

  bridgeDevices: defineTable({
    accountId: v.id("accounts"),
    payloadUploadCursor: v.optional(v.string()),
    installationId: v.optional(v.string()),
    name: v.string(),
    platform: v.string(),
    credentialHash: v.string(),
    protocolVersion: v.string(),
    appVersion: v.string(),
    pairedAt: v.number(),
    lastSeenAt: v.number(),
    state: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("lost"),
    ),
  })
    .index("by_account_installation", ["accountId", "installationId"])
    .index("by_account_state", ["accountId", "state"])
    .index("by_credential_hash", ["credentialHash"]),

  bridgePairingChallenges: defineTable({
    accountId: v.id("accounts"),
    challengeHash: v.string(),
    shortCode: v.string(),
    browserOrigin: v.string(),
    expiresAt: v.number(),
    confirmedAt: v.optional(v.number()),
    consumedAt: v.optional(v.number()),
  })
    .index("by_challenge_hash", ["challengeHash"])
    .index("by_account_expiry", ["accountId", "expiresAt"]),

  bridgeMounts: defineTable({
    accountId: v.id("accounts"),
    deviceId: v.id("bridgeDevices"),
    rootLabel: v.string(),
    grantId: v.string(),
    rootKey: v.optional(v.string()),
    rootOrgNodeId: v.optional(v.id("orgNodes")),
    policyId: v.optional(v.id("syncPolicies")),
    state: v.union(
      v.literal("active"),
      v.literal("detached"),
      v.literal("revoked"),
    ),
    fileCount: v.number(),
    lastScanAt: v.optional(v.number()),
    lastScanId: v.optional(v.string()),
    doubleSyncRisk: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_state", ["accountId", "state"])
    .index("by_device_state", ["deviceId", "state"])
    .index("by_device_root_key", ["deviceId", "rootKey"])
    .index("by_device_grant", ["deviceId", "grantId"]),

  syncPolicies: defineTable({
    accountId: v.id("accounts"),
    scopeKind: v.union(
      v.literal("account"),
      v.literal("mount"),
      v.literal("workspace"),
      v.literal("folder"),
      v.literal("item"),
    ),
    scopeId: v.string(),
    preset: v.union(
      v.literal("spectra"),
      v.literal("device"),
      v.literal("both"),
      v.literal("linked"),
    ),
    contentDirection: v.union(
      v.literal("local-to-spectra"),
      v.literal("spectra-to-local"),
      v.literal("bidirectional"),
      v.literal("manual"),
    ),
    discovery: v.union(
      v.literal("auto"),
      v.literal("ask"),
      v.literal("explicit"),
    ),
    structure: v.union(
      v.literal("independent"),
      v.literal("mirror-to-disk"),
      v.literal("mirror-from-disk"),
      v.literal("mirror-both"),
      v.literal("ask"),
    ),
    cloudContent: v.union(
      v.literal("full"),
      v.literal("metadata-only"),
      v.literal("none"),
    ),
    localMirrorGrantId: v.optional(v.string()),
    includeGlobs: v.array(v.string()),
    excludeGlobs: v.array(v.string()),
    timing: v.union(
      v.literal("continuous"),
      v.literal("on-save-open"),
      v.literal("manual"),
    ),
    protectedOriginal: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_account_scope", ["accountId", "scopeKind", "scopeId"]),

  syncPolicyChanges: defineTable({
    accountId: v.id("accounts"),
    scopeKind: v.union(
      v.literal("account"),
      v.literal("mount"),
      v.literal("workspace"),
      v.literal("folder"),
      v.literal("item"),
    ),
    scopeId: v.string(),
    action: v.union(v.literal("override"), v.literal("revert")),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    actorKind: v.union(
      v.literal("user"),
      v.literal("ai"),
      v.literal("migration"),
    ),
    idempotencyKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_account_key", ["accountId", "idempotencyKey"])
    .index("by_scope_created", [
      "accountId",
      "scopeKind",
      "scopeId",
      "createdAt",
    ]),

  storageStrategyTransitions: defineTable({
    accountId: v.id("accounts"),
    workId: v.id("spectraArtifacts"),
    idempotencyKey: v.string(),
    fromPreset: v.union(
      v.literal("spectra"),
      v.literal("device"),
      v.literal("both"),
      v.literal("linked"),
    ),
    toPreset: v.union(
      v.literal("spectra"),
      v.literal("device"),
      v.literal("both"),
      v.literal("linked"),
    ),
    state: v.union(
      v.literal("pending"),
      v.literal("verified"),
      v.literal("failed"),
      v.literal("conflicted"),
      v.literal("cancelled"),
    ),
    before: v.any(),
    after: v.optional(v.any()),
    errorCode: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_key", ["accountId", "idempotencyKey"])
    .index("by_account_state", ["accountId", "state"])
    .index("by_work_created", ["workId", "createdAt"])
    .index("by_state_updated", ["state", "updatedAt"]),

  syncStructureDecisions: defineTable({
    accountId: v.id("accounts"),
    scopeKind: v.union(
      v.literal("account"),
      v.literal("mount"),
      v.literal("workspace"),
      v.literal("folder"),
      v.literal("item"),
    ),
    scopeId: v.string(),
    direction: v.union(
      v.literal("spectra-to-disk"),
      v.literal("disk-to-spectra"),
    ),
    action: v.union(v.literal("propagate"), v.literal("ignore")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_account_scope_direction", [
    "accountId",
    "scopeKind",
    "scopeId",
    "direction",
  ]),

  syncDiscoveryRequests: defineTable({
    accountId: v.id("accounts"),
    deviceId: v.id("bridgeDevices"),
    mountId: v.id("bridgeMounts"),
    localResourceId: v.string(),
    relativePath: v.string(),
    size: v.number(),
    contentHash: v.optional(v.string()),
    nativeFormat: v.string(),
    state: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("ignored"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_mount_state", ["mountId", "state"])
    .index("by_device_resource", ["deviceId", "localResourceId"]),

  workReplicas: defineTable({
    accountId: v.id("accounts"),
    workId: v.id("spectraArtifacts"),
    kind: v.union(v.literal("cloud"), v.literal("local")),
    deviceId: v.optional(v.id("bridgeDevices")),
    mountId: v.optional(v.id("bridgeMounts")),
    localResourceId: v.optional(v.string()),
    relativePath: v.optional(v.string()),
    nativeFormat: v.string(),
    payloadRef: v.optional(v.string()),
    pendingPayloadRef: v.optional(v.string()),
    pendingContentHash: v.optional(v.string()),
    pendingBaseRevision: v.optional(v.string()),
    lastSeenScanId: v.optional(v.string()),
    protectedOriginal: v.optional(v.boolean()),
    preservedCarryVersion: v.optional(v.number()),
    fidelityMap: v.optional(v.any()),
    compatibilityProfile: v.optional(
      v.union(
        v.literal("strict-native"),
        v.literal("enhanced"),
        v.literal("spectra-native"),
      ),
    ),
    revision: v.string(),
    baseRevision: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    projectionBasePayloadRef: v.optional(v.string()),
    projectionBaseRevision: v.optional(v.string()),
    projectionBaseContent: v.optional(v.any()),
    projectionBaseContentHash: v.optional(v.string()),
    projectionBaseTextIndex: v.optional(v.string()),
    projectionBaseFidelityMap: v.optional(v.any()),
    nativeReceipt: v.optional(v.any()),
    state: v.union(
      v.literal("current"),
      v.literal("ahead"),
      v.literal("behind"),
      v.literal("diverged"),
      v.literal("pending"),
      v.literal("error"),
      v.literal("unavailable"),
    ),
    lastVerifiedAt: v.optional(v.number()),
    retryAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    errorAt: v.optional(v.number()),
    unavailableReason: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_work", ["workId"])
    .index("by_account_state", ["accountId", "state"])
    .index("by_mount", ["mountId"])
    .index("by_device_resource", ["deviceId", "localResourceId"])
    .index("by_device_state", ["deviceId", "state"])
    .index("by_device_mount_path", ["deviceId", "mountId", "relativePath"])
    .index("by_work_kind", ["workId", "kind"])
    .index("by_payload_ref", ["payloadRef"])
    .index("by_pending_payload_ref", ["pendingPayloadRef"])
    .index("by_projection_base_payload_ref", ["projectionBasePayloadRef"])
    .index("by_state_updated", ["state", "updatedAt"]),

  syncOperations: defineTable({
    accountId: v.id("accounts"),
    workId: v.id("spectraArtifacts"),
    replicaId: v.optional(v.id("workReplicas")),
    idempotencyKey: v.string(),
    direction: v.union(
      v.literal("local-to-cloud"),
      v.literal("cloud-to-local"),
      v.literal("migration"),
      v.literal("external"),
    ),
    revisionBefore: v.optional(v.string()),
    revisionAfter: v.optional(v.string()),
    state: v.union(
      v.literal("pending"),
      v.literal("applied"),
      v.literal("verified"),
      v.literal("failed"),
      v.literal("conflicted"),
    ),
    actorKind: v.union(
      v.literal("user"),
      v.literal("ai"),
      v.literal("external-edit"),
      v.literal("reconciliation"),
      v.literal("migration"),
      v.literal("restore"),
    ),
    runId: v.optional(v.id("spectraAiRuns")),
    nativeReceipt: v.optional(v.any()),
    reconciliationReceipt: v.optional(v.object({
      versionId: v.id("spectraArtifactVersions"),
      roomId: v.id("collaborationRooms"),
      sequence: v.number(),
      updateDigest: v.string(),
      projectionHash: v.string(),
      localReplicaId: v.id("workReplicas"),
      localPayloadRef: v.string(),
      localRevision: v.string(),
      nativeBaseRevision: v.optional(v.string()),
      committedAt: v.number(),
    })),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_key", ["accountId", "idempotencyKey"])
    .index("by_account_key_replica", ["accountId", "idempotencyKey", "replicaId"])
    .index("by_work_created", ["workId", "createdAt"])
    .index("by_state_updated", ["state", "updatedAt"]),

  syncConflicts: defineTable({
    accountId: v.id("accounts"),
    workId: v.id("spectraArtifacts"),
    replicaIds: v.array(v.id("workReplicas")),
    regionIds: v.array(v.string()),
    partNames: v.array(v.string()),
    previews: v.optional(
      v.array(
        v.object({
          regionId: v.string(),
          spectra: v.string(),
          external: v.string(),
        }),
      ),
    ),
    localRevision: v.string(),
    spectraRevision: v.string(),
    localPayloadRef: v.optional(v.string()),
    spectraPayloadRef: v.optional(v.string()),
    state: v.union(
      v.literal("open"),
      v.literal("resolving-spectra"),
      v.literal("resolved-merged"),
      v.literal("resolved-local"),
      v.literal("resolved-spectra"),
      v.literal("forked"),
      v.literal("abandoned"),
    ),
    resolutionRequestId: v.optional(v.id("bridgeWriteRequests")),
    forkedWorkId: v.optional(v.id("spectraArtifacts")),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_work_state", ["workId", "state"])
    .index("by_account_state", ["accountId", "state"])
    .index("by_local_payload_ref", ["localPayloadRef"])
    .index("by_spectra_payload_ref", ["spectraPayloadRef"])
    .index("by_state_updated", ["state", "updatedAt"]),

  bridgeWriteRequests: defineTable({
    accountId: v.id("accounts"),
    workId: v.id("spectraArtifacts"),
    replicaId: v.id("workReplicas"),
    deviceId: v.id("bridgeDevices"),
    mountId: v.id("bridgeMounts"),
    localResourceId: v.string(),
    relativePath: v.string(),
    payloadRef: v.string(),
    baseRevision: v.string(),
    targetRevision: v.string(),
    contentHash: v.string(),
    idempotencyKey: v.string(),
    regionIds: v.array(v.string()),
    partNames: v.array(v.string()),
    projectionBaseContent: v.optional(v.any()),
    projectionBaseContentHash: v.optional(v.string()),
    projectionBaseTextIndex: v.optional(v.string()),
    projectionBaseFidelityMap: v.optional(v.any()),
    nativeReceipt: v.optional(v.any()),
    state: v.union(
      v.literal("pending"),
      v.literal("claimed"),
      v.literal("verified"),
      v.literal("failed"),
      v.literal("conflicted"),
    ),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    // An Office unlock can race with the Bridge's "still locked" response.
    // Preserve that signal until the active claim completes so it can retry
    // on the shared first-delay window instead of the old exponential delay.
    officeUnlockedAt: v.optional(v.number()),
    // A claim is a lease, not just a request state. These additive fields let
    // a late worker acknowledgement be rejected after a reclaim.
    claimGeneration: v.optional(v.number()),
    claimToken: v.optional(v.string()),
    retryAt: v.optional(v.number()),
    attemptCount: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_device_state", ["deviceId", "state"])
    .index("by_device_state_retry", ["deviceId", "state", "retryAt"])
    .index("by_device_state_claimed", ["deviceId", "state", "claimedAt"])
    .index("by_replica_state", ["replicaId", "state"])
    .index("by_work_created", ["workId", "createdAt"])
    .index("by_account_key", ["accountId", "idempotencyKey"])
    .index("by_account_key_replica", ["accountId", "idempotencyKey", "replicaId"])
    .index("by_payload_state", ["payloadRef", "state"])
    .index("by_state_updated", ["state", "updatedAt"]),

  bridgeFsRequests: defineTable({
    accountId: v.id("accounts"),
    workId: v.id("spectraArtifacts"),
    replicaId: v.id("workReplicas"),
    deviceId: v.id("bridgeDevices"),
    mountId: v.id("bridgeMounts"),
    nodeId: v.optional(v.id("orgNodes")),
    localResourceId: v.string(),
    direction: v.union(
      v.literal("spectra-to-disk"),
      v.literal("disk-to-spectra"),
    ),
    kind: v.union(v.literal("move"), v.literal("rename"), v.literal("delete")),
    sourceRelativePath: v.string(),
    targetRelativePath: v.optional(v.string()),
    idempotencyKey: v.string(),
    state: v.union(
      v.literal("approval-required"),
      v.literal("pending"),
      v.literal("claimed"),
      v.literal("verified"),
      v.literal("failed"),
      v.literal("conflicted"),
      v.literal("ignored"),
    ),
    explanation: v.string(),
    claimedAt: v.optional(v.number()),
    claimGeneration: v.optional(v.number()),
    claimToken: v.optional(v.string()),
    attemptCount: v.optional(v.number()),
    retryAt: v.optional(v.number()),
    baseRevision: v.optional(v.string()),
    actualRelativePath: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_device_state", ["deviceId", "state"])
    .index("by_device_state_claimed", ["deviceId", "state", "claimedAt"])
    .index("by_account_state", ["accountId", "state"])
    .index("by_device_state_retry", ["deviceId", "state", "retryAt"])
    .index("by_account_key", ["accountId", "idempotencyKey"])
    .index("by_work_created", ["workId", "createdAt"])
    .index("by_state_updated", ["state", "updatedAt"]),

  payloadObjects: defineTable({
    accountId: v.id("accounts"),
    hash: v.string(),
    storageId: v.id("_storage"),
    bytes: v.number(),
    mediaType: v.string(),
    refCount: v.number(),
    state: v.union(
      v.literal("active"),
      v.literal("quarantined"),
      v.literal("released"),
    ),
    releasedAt: v.optional(v.number()),
    createdAt: v.number(),
    verifiedAt: v.number(),
  })
    .index("by_account_hash", ["accountId", "hash"])
    .index("by_storage", ["storageId"])
    .index("by_storage_state", ["storageId", "state"])
    .index("by_state_verified", ["state", "verifiedAt"]),

  replicaTruthMigrations: defineTable({
    key: v.string(),
    state: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    cursor: v.optional(v.string()),
    scanned: v.number(),
    repaired: v.number(),
    conflicts: v.number(),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  spectraRuntimeBuilds: defineTable({
    artifactId: v.id("spectraArtifacts"),
    artifactVersionId: v.id("spectraArtifactVersions"),
    schoolId: v.optional(v.id("schools")),
    createdByAccountId: v.id("accounts"),
    runtime: v.union(
      v.literal("browser"),
      v.literal("react"),
      v.literal("python"),
    ),
    runtimeVersion: v.optional(v.string()),
    status: v.union(
      v.literal("uploading"),
      v.literal("published"),
      v.literal("superseded"),
      v.literal("failed"),
    ),
    sourceHash: v.string(),
    payloadHash: v.optional(v.string()),
    sdkVersion: v.string(),
    entryFileId: v.string(),
    dependencies: v.record(v.string(), v.string()),
    assetIds: v.optional(v.array(v.id("artifactAssets"))),
    storageId: v.optional(v.id("_storage")),
    sourceBytes: v.number(),
    outputBytes: v.number(),
    payloadBytes: v.optional(v.number()),
    buildDurationMs: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    publishedAt: v.optional(v.number()),
    supersededAt: v.optional(v.number()),
  })
    .index("by_artifact_status", ["artifactId", "status"])
    .index("by_storage", ["storageId"])
      .index("by_artifact_version", ["artifactId", "artifactVersionId"])
    .index("by_creator_created", ["createdByAccountId", "createdAt"]),

  artifactUserStates: defineTable({
    artifactId: v.id("spectraArtifacts"),
    schoolId: v.id("schools"),
    accountId: v.id("accounts"),
    kind: v.literal("timetable"),
    state: v.any(),
    revision: v.number(),
    byteLength: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_artifact_account_kind", ["artifactId", "accountId", "kind"])
    .index("by_account_updated", ["accountId", "updatedAt"])
    .index("by_artifact_updated", ["artifactId", "updatedAt"])
    .index("by_kind_updated", ["kind", "updatedAt"]),

  memoryPreferences: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    enabled: v.boolean(),
    capturePaused: v.boolean(),
    categoryControls: v.object({
      declaredFacts: v.boolean(),
      preferences: v.boolean(),
      decisions: v.boolean(),
      workflows: v.boolean(),
      commitments: v.boolean(),
      learningSignals: v.boolean(),
      relationships: v.boolean(),
      workspaceConventions: v.boolean(),
    }),
    capsuleTargetTokens: v.number(),
    lastExportedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_school_updated", ["schoolId", "updatedAt"]),

  memoryClaims: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    scope: v.union(
      v.literal("private_global"),
      v.literal("private_school"),
      v.literal("workspace"),
      v.literal("shared_artifact"),
      v.literal("system"),
    ),
    scopeSchoolId: v.optional(v.id("schools")),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    subjectKind: v.union(
      v.literal("user"),
      v.literal("workspace"),
      v.literal("artifact"),
      v.literal("workflow"),
      v.literal("relationship"),
    ),
    subjectId: v.optional(v.string()),
    claimType: v.union(
      v.literal("declared_fact"),
      v.literal("inferred_preference"),
      v.literal("correction"),
      v.literal("decision"),
      v.literal("recurring_workflow"),
      v.literal("commitment"),
      v.literal("mistake_avoidance"),
      v.literal("learning_signal"),
      v.literal("relationship"),
      v.literal("workspace_convention"),
    ),
    proposition: v.string(),
    normalizedProposition: v.string(),
    propositionHash: v.string(),
    embedding: v.optional(v.array(v.float64())),
    embeddingVersion: v.optional(v.string()),
    embeddingInputHash: v.optional(v.string()),
    embeddingUpdatedAt: v.optional(v.number()),
    embeddingPartition: v.optional(v.string()),
    assertion: v.union(v.literal("asserted"), v.literal("inferred")),
    confidence: v.number(),
    sensitivity: v.union(v.literal("standard"), v.literal("restricted")),
    status: v.union(
      v.literal("proposed"),
      v.literal("active"),
      v.literal("disputed"),
      v.literal("superseded"),
      v.literal("expired"),
      v.literal("deleted"),
    ),
    createdBy: v.union(
      v.literal("user"),
      v.literal("policy"),
      v.literal("model"),
    ),
    validFrom: v.number(),
    expiresAt: v.optional(v.number()),
    lastConfirmedAt: v.optional(v.number()),
    supersedesId: v.optional(v.id("memoryClaims")),
    supersededById: v.optional(v.id("memoryClaims")),
    deletionRequestedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_status_updated", ["accountId", "status", "updatedAt"])
    .index("by_account_scope_status", ["accountId", "scope", "status"])
    .index("by_account_hash", ["accountId", "propositionHash"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_artifact_status", ["artifactId", "status"])
    .index("by_school_status", ["schoolId", "status"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: ["accountId", "schoolId", "status", "embeddingPartition"],
    })
    .searchIndex("search_normalized_proposition", {
      searchField: "normalizedProposition",
      filterFields: ["accountId", "schoolId", "status", "scope", "workspaceId", "artifactId"],
    }),

  memoryEvidence: defineTable({
    claimId: v.id("memoryClaims"),
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    sourceType: v.union(
      v.literal("user_statement"),
      v.literal("thread"),
      v.literal("artifact"),
      v.literal("workspace"),
      v.literal("managebac"),
      v.literal("product_event"),
      v.literal("correction"),
    ),
    sourceId: v.optional(v.string()),
    sourceVersionId: v.optional(v.string()),
    sourceRegionId: v.optional(v.string()),
    sourceEventId: v.optional(v.string()),
    excerptHash: v.string(),
    excerptPreview: v.optional(v.string()),
    captureReason: v.string(),
    accessStatus: v.union(
      v.literal("available"),
      v.literal("revoked"),
      v.literal("deleted"),
      v.literal("school_changed"),
    ),
    observedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_claim_created", ["claimId", "createdAt"])
    .index("by_claim_source_access_created", ["claimId", "sourceType", "accessStatus", "createdAt"])
    .index("by_account_created", ["accountId", "createdAt"])
    .index("by_source", ["sourceType", "sourceId"]),

  memoryRelations: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    fromClaimId: v.optional(v.id("memoryClaims")),
    toClaimId: v.optional(v.id("memoryClaims")),
    fromSubject: v.string(),
    toSubject: v.string(),
    relationType: v.union(
      v.literal("works_on"),
      v.literal("prefers"),
      v.literal("corrected"),
      v.literal("depends_on"),
      v.literal("related_to"),
      v.literal("collaborates_with"),
      v.literal("follows_workflow"),
    ),
    confidence: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_from", ["accountId", "fromSubject"])
    .index("by_from_claim", ["fromClaimId"])
    .index("by_to_claim", ["toClaimId"]),

  memoryCapsules: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    scope: v.union(
      v.literal("private_global"),
      v.literal("private_school"),
      v.literal("workspace"),
      v.literal("workflow"),
    ),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    text: v.string(),
    claimIds: v.array(v.id("memoryClaims")),
    tokenCount: v.number(),
    generationVersion: v.number(),
    contentHash: v.string(),
    stale: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_scope", ["accountId", "scope"])
    .index("by_account_workspace", ["accountId", "workspaceId"])
    .index("by_school_updated", ["schoolId", "updatedAt"]),

  memoryRetrievalEvents: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    runId: v.optional(v.id("spectraAiRuns")),
    purpose: v.string(),
    queryHash: v.string(),
    candidateClaimIds: v.array(v.id("memoryClaims")),
    selectedClaimIds: v.array(v.id("memoryClaims")),
    exclusionCounts: v.object({
      scope: v.number(),
      permission: v.number(),
      stale: v.number(),
      disputed: v.number(),
      budget: v.number(),
    }),
    estimatedTokens: v.number(),
    actualTokens: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_account_created", ["accountId", "createdAt"])
    .index("by_run", ["runId"])
    .index("by_school_created", ["schoolId", "createdAt"])
    .index("by_created", ["createdAt"]),

  memoryJobs: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    kind: v.union(
      v.literal("capture"),
      v.literal("consolidate"),
      v.literal("regenerate_capsule"),
      v.literal("expire"),
      v.literal("delete"),
      v.literal("embed"),
    ),
    idempotencyKey: v.string(),
    payload: v.any(),
    status: v.union(
      v.literal("queued"),
      v.literal("leased"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    attemptCount: v.number(),
    availableAt: v.number(),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_kind_status_available", ["kind", "status", "availableAt"])
    .index("by_status_available", ["status", "availableAt"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_account_created", ["accountId", "createdAt"])
    .index("by_idempotency", ["idempotencyKey"]),

  memoryEvaluationRuns: defineTable({
    schoolId: v.optional(v.id("schools")),
    scope: v.union(v.literal("platform"), v.literal("school")),
    sampledClaims: v.number(),
    sampledCapsules: v.number(),
    metrics: v.object({
      evidenceBackedRate: v.number(),
      duplicateRate: v.number(),
      correctionFailureRate: v.number(),
      deletionFailureRate: v.number(),
      contaminationFailureRate: v.number(),
      scopeFailureRate: v.number(),
      capsuleBudgetFailureRate: v.number(),
    }),
    passed: v.boolean(),
    durationMs: v.number(),
    createdAt: v.number(),
  })
    .index("by_scope_created", ["scope", "createdAt"])
    .index("by_school_created", ["schoolId", "createdAt"]),

  flashcardStudyStates: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    artifactId: v.id("spectraArtifacts"),
    cardId: v.string(),
    direction: v.optional(v.union(v.literal("forward"), v.literal("reverse"))),
    cardVersionId: v.optional(v.id("spectraArtifactVersions")),
    // What the card was asking when this state was last updated. When the deck
    // is edited, comparing this against the card's current meaning is how the
    // learner's progress is preserved for a reworded card and retired for a
    // rewritten one, without either side overwriting the other (§11B).
    meaningFingerprint: v.optional(v.string()),
    // The learner's own note on the card. Deck content never writes here.
    note: v.optional(v.string()),
    algorithm: v.string(),
    algorithmVersion: v.number(),
    attempts: v.number(),
    ease: v.number(),
    stabilityDays: v.number(),
    difficulty: v.number(),
    lapses: v.number(),
    nextDueAt: v.number(),
    lastReviewedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_artifact", ["accountId", "artifactId"])
    .index("by_account_artifact_card", ["accountId", "artifactId", "cardId"])
    .index("by_account_due", ["accountId", "nextDueAt"]),

  flashcardStudyReviews: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    artifactId: v.id("spectraArtifacts"),
    cardId: v.string(),
    direction: v.optional(v.union(v.literal("forward"), v.literal("reverse"))),
    cardVersionId: v.optional(v.id("spectraArtifactVersions")),
    clientReviewId: v.string(),
    rating: v.union(
      v.literal("again"),
      v.literal("hard"),
      v.literal("good"),
      v.literal("easy"),
    ),
    previousNextDueAt: v.optional(v.number()),
    scheduledDays: v.number(),
    elapsedMs: v.optional(v.number()),
    reviewedAt: v.number(),
  })
    .index("by_account_client", ["accountId", "clientReviewId"])
    .index("by_account_artifact_created", [
      "accountId",
      "artifactId",
      "reviewedAt",
    ])
    .index("by_artifact_created", ["artifactId", "reviewedAt"]),

  quizPracticeAttempts: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.id("schools"),
    artifactId: v.id("spectraArtifacts"),
    artifactVersionId: v.optional(v.id("spectraArtifactVersions")),
    clientAttemptId: v.string(),
    status: v.union(v.literal("in_progress"), v.literal("submitted")),
    quizSnapshot: v.any(),
    contentHash: v.string(),
    presentationManifest: v.array(
      v.object({
        questionId: v.string(),
        optionOrder: v.array(v.string()),
      }),
    ),
    score: v.optional(v.number()),
    maxScore: v.optional(v.number()),
    percentage: v.optional(v.number()),
    clientSubmissionId: v.optional(v.string()),
    startedAt: v.number(),
    submittedAt: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
    // Set when the attempt was submitted after its own clock ran out, so the
    // result can say so instead of quietly looking like an ordinary one.
    timeElapsed: v.optional(v.boolean()),
    updatedAt: v.number(),
  })
    .index("by_account_client", ["accountId", "clientAttemptId"])
    .index("by_account_artifact_started", [
      "accountId",
      "artifactId",
      "startedAt",
    ])
    .index("by_artifact_started", ["artifactId", "startedAt"]),

  quizPracticeResponses: defineTable({
    attemptId: v.id("quizPracticeAttempts"),
    accountId: v.id("accounts"),
    questionId: v.string(),
    response: v.any(),
    clientMutationId: v.string(),
    updatedAt: v.number(),
  })
    .index("by_attempt_question", ["attemptId", "questionId"])
    .index("by_account_mutation", ["accountId", "clientMutationId"])
    .index("by_attempt", ["attemptId", "updatedAt"]),

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
    snapshotStrategy: v.optional(
      v.union(
        v.literal("normalized"),
        v.literal("content_addressed"),
        v.literal("yjs_snapshot"),
      ),
    ),
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
    .index("by_integrity_hash", ["integrityHash"])
    .index("by_snapshot_ref", ["snapshotRef"])
    .index("by_before_snapshot_ref", ["beforeSnapshotRef"]),

  agentReleases: defineTable({
    agentId: v.id("spectraArtifacts"),
    schoolId: v.id("schools"),
    versionId: v.id("spectraArtifactVersions"),
    releaseNumber: v.number(),
    status: v.union(
      v.literal("published"),
      v.literal("suspended"),
      v.literal("deprecated"),
    ),
    rollout: v.optional(
      v.union(
        v.literal("internal_test"),
        v.literal("limited"),
        v.literal("published"),
      ),
    ),
    evalRunId: v.optional(v.id("agentEvalRuns")),
    contentHash: v.optional(v.string()),
    releaseNotes: v.optional(v.string()),
    publishedByAccountId: v.id("accounts"),
    publishedAt: v.number(),
    deprecatedAt: v.optional(v.number()),
  })
    .index("by_agent_number", ["agentId", "releaseNumber"])
    .index("by_agent_status_rollout_number", ["agentId", "status", "rollout", "releaseNumber"])
    .index("by_agent_status", ["agentId", "status"])
    .index("by_school_published", ["schoolId", "publishedAt"]),

  /**
   * Background Foundry compilation (§10.8). These are durable internal runs
   * whose status surfaces inside Agent Foundry — never as a Live Dock tab.
   */
  agentCompilerJobs: defineTable({
    agentId: v.id("spectraArtifacts"),
    schoolId: v.id("schools"),
    creatorAccountId: v.id("accounts"),
    /** Internal run id; presentation is always in_surface for these. */
    runId: v.string(),
    /** Draft hash this job compiled, so a stale job can be detected. */
    draftHash: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    stages: v.array(
      v.object({
        stage: v.string(),
        status: v.union(
          v.literal("pending"),
          v.literal("running"),
          v.literal("completed"),
          v.literal("failed"),
          v.literal("skipped"),
        ),
        label: v.string(),
        detail: v.optional(v.string()),
        processed: v.optional(v.number()),
        total: v.optional(v.number()),
        startedAt: v.optional(v.number()),
        completedAt: v.optional(v.number()),
        error: v.optional(v.string()),
      }),
    ),
    diagnostics: v.optional(
      v.array(
        v.object({
          severity: v.string(),
          stage: v.string(),
          message: v.string(),
          subjectId: v.optional(v.string()),
        }),
      ),
    ),
    /** Compiled result, written once the job completes. */
    result: v.optional(v.any()),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_agent_started", ["agentId", "startedAt"])
    .index("by_agent_status", ["agentId", "status"])
    .index("by_run", ["runId"]),

  agentEvalRuns: defineTable({
    agentId: v.id("spectraArtifacts"),
    schoolId: v.id("schools"),
    creatorAccountId: v.id("accounts"),
    contentHash: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("passed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    modelId: v.string(),
    provider: v.string(),
    threshold: v.number(),
    caseCount: v.number(),
    passedCount: v.number(),
    averageScore: v.number(),
    results: v.array(
      v.object({
        caseId: v.string(),
        category: v.string(),
        // Evaluation layer this case belongs to (§10.10). Absent on runs
        // recorded before layered evaluation existed.
        layer: v.optional(v.string()),
        judgedBy: v.optional(v.string()),
        required: v.boolean(),
        score: v.number(),
        passed: v.boolean(),
        reason: v.string(),
        responseExcerpt: v.string(),
        latencyMs: v.number(),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
      }),
    ),
    // What this evaluation could not establish, stated rather than implied.
    limitations: v.optional(
      v.array(
        v.object({
          kind: v.string(),
          layer: v.optional(v.string()),
          detail: v.string(),
        }),
      ),
    ),
    verificationStrength: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_agent_created", ["agentId", "createdAt"])
    .index("by_agent_hash_status", ["agentId", "contentHash", "status"])
    .index("by_school_created", ["schoolId", "createdAt"]),

  agentFeedback: defineTable({
    agentId: v.id("spectraArtifacts"),
    agentVersionId: v.id("spectraArtifactVersions"),
    schoolId: v.id("schools"),
    reviewerAccountId: v.id("accounts"),
    runId: v.optional(v.id("spectraAiRuns")),
    rating: v.number(),
    category: v.union(
      v.literal("helpful"),
      v.literal("accuracy"),
      v.literal("clarity"),
      v.literal("safety"),
      v.literal("resource_quality"),
      v.literal("other"),
    ),
    comment: v.optional(v.string()),
    consentToShareComment: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_agent_created", ["agentId", "createdAt"])
    .index("by_reviewer_run", ["reviewerAccountId", "runId"])
    .index("by_school_created", ["schoolId", "createdAt"]),

  agentUsageAggregates: defineTable({
    agentId: v.id("spectraArtifacts"),
    agentVersionId: v.id("spectraArtifactVersions"),
    schoolId: v.id("schools"),
    day: v.string(),
    invocations: v.number(),
    completed: v.number(),
    failed: v.number(),
    cancelled: v.number(),
    totalLatencyMs: v.number(),
    modelInputTokens: v.number(),
    modelOutputTokens: v.number(),
    updatedAt: v.number(),
  })
    .index("by_agent_day", ["agentId", "day"])
    .index("by_agent_version_day", ["agentId", "agentVersionId", "day"])
    .index("by_school_day", ["schoolId", "day"]),

  agentImprovementProposals: defineTable({
    agentId: v.id("spectraArtifacts"),
    schoolId: v.id("schools"),
    proposedByAccountId: v.id("accounts"),
    evidence: v.string(),
    proposedPatch: v.any(),
    expectedImpact: v.string(),
    evalRunId: v.optional(v.id("agentEvalRuns")),
    status: v.union(
      v.literal("proposed"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("superseded"),
    ),
    decidedByAccountId: v.optional(v.id("accounts")),
    decisionNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_agent_status", ["agentId", "status", "createdAt"])
    .index("by_school_created", ["schoolId", "createdAt"]),

  agentFollows: defineTable({
    agentId: v.id("spectraArtifacts"),
    schoolId: v.id("schools"),
    accountId: v.id("accounts"),
    pinnedReleaseId: v.optional(v.id("agentReleases")),
    status: v.union(v.literal("following"), v.literal("unfollowed")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_status", ["accountId", "status", "updatedAt"])
    .index("by_agent_account", ["agentId", "accountId"])
    .index("by_school_status", ["schoolId", "status", "updatedAt"]),

  artifactSnapshotObjects: defineTable({
    schoolId: v.optional(v.id("schools")),
    hash: v.string(),
    strategy: v.union(
      v.literal("normalized"),
      v.literal("content_addressed"),
      v.literal("yjs_snapshot"),
    ),
    payload: v.any(),
    byteLength: v.number(),
    refCount: v.number(),
    state: v.union(
      v.literal("hot"),
      v.literal("cold"),
      v.literal("corrupt"),
      v.literal("deleted"),
    ),
    createdAt: v.number(),
    lastReferencedAt: v.number(),
    verifiedAt: v.optional(v.number()),
  })
    .index("by_school_hash", ["schoolId", "hash"])
    .index("by_state_reference", ["state", "lastReferencedAt"]),

  collaborationDurablePayloads: defineTable({
    artifactId: v.id("spectraArtifacts"),
    accountId: v.id("accounts"),
    kind: v.union(
      v.literal("yjs-update"),
      v.literal("yjs-snapshot"),
      v.literal("projection"),
    ),
    digest: v.string(),
    storageId: v.id("_storage"),
    byteLength: v.number(),
    mediaType: v.string(),
    manifestVersion: v.number(),
    policyVersion: v.optional(v.number()),
    dependencies: v.optional(v.object({ assetIds: v.array(v.string()), nativePayloadHashes: v.array(v.string()), nativePayloadRefs: v.array(v.string()) })),
    status: v.union(v.literal("active"), v.literal("released")),
    createdAt: v.number(),
    releasedAt: v.optional(v.number()),
  })
    .index("by_storage", ["storageId"])
    .index("by_storage_status", ["storageId", "status"])
    .index("by_digest", ["digest"])
    .index("by_artifact_digest", ["artifactId", "digest"])
    .index("by_artifact_kind", ["artifactId", "kind"])
    .index("by_status_created", ["status", "createdAt"]),

  collaborationPayloadOwners: defineTable({
    payloadRef: v.string(),
    ownerId: v.string(),
    ownerTable: v.string(),
  })
    .index("by_payload", ["payloadRef"])
    .index("by_owner", ["ownerId"]),

  collaborationRooms: defineTable({
    artifactId: v.id("spectraArtifacts"),
    schoolId: v.optional(v.id("schools")),
    typeKey: v.string(),
    provider: v.literal("self_hosted_yjs"),
    partitionKey: v.string(),
    schemaVersion: v.number(),
    policyVersion: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("compacting"),
      v.literal("recovering"),
      v.literal("closed"),
    ),
    nextSequence: v.number(),
    snapshotSequence: v.number(),
    uncompactedBytes: v.number(),
    lastSnapshotAt: v.optional(v.number()),
    lastProjectionSequence: v.optional(v.number()),
    lastProjectionAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_artifact_partition", ["artifactId", "partitionKey"])
    .index("by_school_status", ["schoolId", "status"]),

  collaborationReceipts: defineTable({
    roomId: v.id("collaborationRooms"),
    idempotencyKey: v.string(),
    sequence: v.number(),
    actorAccountId: v.id("accounts"),
    clientId: v.string(),
    stateVectorHash: v.string(),
    digest: v.string(),
    byteLength: v.number(),
    createdAt: v.number(),
  })
    .index("by_room_idempotency", ["roomId", "idempotencyKey"]),

  collaborationUpdates: defineTable({
    roomId: v.id("collaborationRooms"),
    schoolId: v.optional(v.id("schools")),
    sequence: v.number(),
    /** Trusted provider import identity, independent of native file operations. */
    providerSourceOperationId: v.optional(v.string()),
    update: v.bytes(),
    byteLength: v.number(),
    stateVectorHash: v.string(),
    actorAccountId: v.id("accounts"),
    clientId: v.string(),
    idempotencyKey: v.string(),
    changeGroupId: v.optional(v.id("changeGroups")),
    nativeReconciliationOperationId: v.optional(v.id("syncOperations")),
    regionIds: v.array(v.string()),
    createdAt: v.number(),
    payloadRef: v.optional(v.string()),
    payloadDigest: v.optional(v.string()),
    payloadManifest: v.optional(v.any()),
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
    payloadRef: v.optional(v.string()),
    payloadDigest: v.optional(v.string()),
    payloadManifest: v.optional(v.any()),
    byteLength: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("verified"),
      v.literal("corrupt"),
      v.literal("superseded"),
    ),
    createdBy: v.union(
      v.literal("compactor"),
      v.literal("recovery"),
      v.literal("migration"),
    ),
    createdAt: v.number(),
    verifiedAt: v.optional(v.number()),
    accountId: v.optional(v.id("accounts")),
    policyVersion: v.optional(v.number()),
  })
    .index("by_room_sequence", ["roomId", "throughSequence"])
    .index("by_room_status_sequence", ["roomId", "status", "throughSequence"])
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
    status: v.union(
      v.literal("active"),
      v.literal("queued"),
      v.literal("paused"),
      v.literal("released"),
      v.literal("rejected"),
    ),
    queuePosition: v.optional(v.number()),
    leaseExpiresAt: v.number(),
    resolution: v.optional(
      v.union(
        v.literal("apply"),
        v.literal("keep_current"),
        // Written only by the retired merge editor; kept so existing rows validate.
        v.literal("merge"),
        v.literal("cancel"),
        v.literal("expired"),
        v.literal("permission_revoked"),
        v.literal("run_stopped"),
      ),
    ),
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
    authorKind: v.optional(v.union(v.literal("human"), v.literal("ai"))),
    authorDisplayName: v.optional(v.string()),
    body: v.string(),
    anchor: v.object({
      regionId: v.string(),
      semanticAnchor: v.optional(v.any()),
      relativePosition: v.optional(v.bytes()),
      geometry: v.optional(v.any()),
      fallbackExcerpt: v.optional(v.string()),
    }),
    mentionedAccountIds: v.array(v.id("accounts")),
    status: v.union(
      v.literal("open"),
      v.literal("resolved"),
      v.literal("orphaned"),
      v.literal("deleted"),
    ),
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
    mode: v.union(
      v.literal("all"),
      v.literal("mentions_replies"),
      v.literal("off"),
    ),
    updatedAt: v.number(),
  })
    .index("by_artifact_account", ["artifactId", "accountId"])
    .index("by_artifact_mode", ["artifactId", "mode"]),

  artifactCommentNotifications: defineTable({
    artifactId: v.id("spectraArtifacts"),
    commentId: v.id("artifactComments"),
    recipientAccountId: v.id("accounts"),
    kind: v.union(
      v.literal("mention"),
      v.literal("reply"),
      v.literal("all_comments"),
    ),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
  })
    .index("by_recipient_created", ["recipientAccountId", "createdAt"])
    .index("by_recipient_read", ["recipientAccountId", "readAt"])
    .index("by_comment_recipient", ["commentId", "recipientAccountId"]),

  plannerReminderDeliveries: defineTable({
    artifactId: v.id("spectraArtifacts"),
    schoolId: v.optional(v.id("schools")),
    recipientAccountId: v.id("accounts"),
    reminderId: v.string(),
    taskTitle: v.string(),
    dueAt: v.number(),
    scheduledFor: v.number(),
    nextReminderAt: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    idempotencyKey: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    attempts: v.number(),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    deliveredAt: v.optional(v.number()),
    readAt: v.optional(v.number()),
  })
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_recipient_created", ["recipientAccountId", "createdAt"])
    .index("by_status_retry", ["status", "nextAttemptAt"])
    .index("by_status_next_reminder", ["status", "nextReminderAt"])
    .index("by_artifact_status", ["artifactId", "status"])
    .index("by_artifact_scheduled", ["artifactId", "scheduledFor"]),

  timetableReminderDeliveries: defineTable({
    artifactId: v.id("spectraArtifacts"),
    schoolId: v.id("schools"),
    recipientAccountId: v.id("accounts"),
    eventId: v.string(),
    reminderKey: v.string(),
    eventTitle: v.string(),
    eventStart: v.optional(v.number()),
    recurrence: v.optional(v.string()),
    reminderMinutes: v.optional(v.number()),
    occurrenceStart: v.number(),
    scheduledFor: v.number(),
    nextReminderAt: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    sourceGeneration: v.optional(v.string()),
    idempotencyKey: v.string(),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("delivered"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    readAt: v.optional(v.number()),
  })
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_recipient_created", ["recipientAccountId", "createdAt"])
    .index("by_status_next_reminder", ["status", "nextReminderAt"])
    .index("by_artifact_status", ["artifactId", "status"])
    .index("by_artifact_recipient_status", [
      "artifactId",
      "recipientAccountId",
      "status",
    ])
    .index("by_artifact_scheduled", ["artifactId", "scheduledFor"]),

  changeGroups: defineTable({
    artifactId: v.id("spectraArtifacts"),
    schoolId: v.optional(v.id("schools")),
    source: v.union(
      v.literal("human"),
      v.literal("ai"),
      v.literal("import"),
      v.literal("restore"),
      v.literal("migration"),
    ),
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
    restoreRequestId: v.optional(v.string()),
    restoreRequestFingerprint: v.optional(v.string()),
    restoreHeadHash: v.optional(v.string()),
    restoreReceipt: v.optional(v.object({
      outcome: v.union(v.literal("restored"), v.literal("unchanged")),
      versionId: v.optional(v.id("spectraArtifactVersions")), roomId: v.id("collaborationRooms"),
      sequence: v.number(), updateDigest: v.optional(v.string()), nativeResult: v.any(), committedAt: v.number(),
    })),
    summary: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("committed"),
      v.literal("abandoned"),
    ),
    openedAt: v.number(),
    lastActivityAt: v.number(),
    committedAt: v.optional(v.number()),
    versionId: v.optional(v.id("spectraArtifactVersions")),
  })
    .index("by_artifact_status_activity", [
      "artifactId",
      "status",
      "lastActivityAt",
    ])
    .index("by_run", ["runId"])
    .index("by_version", ["versionId"])
    .index("by_artifact_restore_request", ["artifactId", "actorAccountId", "restoreRequestId"]),

  artifactEmbeds: defineTable({
    containerType: artifactEmbedContainerTypeValidator,
    containerId: v.string(),
    containerRegionId: v.string(),
    sourceArtifactId: v.id("spectraArtifacts"),
    schoolId: v.optional(v.id("schools")),
    mode: artifactEmbedModeValidator,
    interaction: artifactEmbedInteractionValidator,
    versionPolicy: artifactEmbedVersionPolicyValidator,
    pinnedVersionId: v.optional(v.id("spectraArtifactVersions")),
    displayPreferences: v.optional(v.any()),
    contextPolicy: artifactEmbedContextPolicyValidator,
    createdByAccountId: v.id("accounts"),
    placementOperationId: v.optional(v.string()),
    placementFingerprint: v.optional(v.string()),
    placementReceipt: v.optional(v.string()),
    // Server-observed membership at an exact canonical/collaboration head.
    // This caches placement evidence only; every read rechecks authority.
    placementProof: v.optional(v.object({
      version: v.literal(1),
      headHash: v.string(),
      observedAt: v.number(),
    })),
    // A provisional row is only a short-lived intent. The canonical writer
    // clears this when it commits a matching version; a scheduled expiry
    // removes a row whose editor insertion never happened.
    placementExpiresAt: v.optional(v.number()),
    // Source deletion makes the source unavailable, but does not remove a
    // surviving placement/container owner of a pinned version.
    sourceUnavailableAt: v.optional(v.number()),
    placementState: v.optional(
      v.union(
        v.literal("provisional"),
        v.literal("confirmed"),
        v.literal("removed"),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    removedAt: v.optional(v.number()),
  })
    .index("by_container", ["containerType", "containerId"])
    .index("by_source", ["sourceArtifactId", "createdAt"])
    .index("by_placement_operation", [
      "containerType",
      "containerId",
      "placementOperationId",
    ])
    .index("by_pinned_version", ["pinnedVersionId"]),

  artifactAccessRequests: defineTable({
    embedId: v.id("artifactEmbeds"),
    sourceArtifactId: v.id("spectraArtifacts"),
    schoolId: v.id("schools"),
    requesterAccountId: v.id("accounts"),
    ownerAccountId: v.id("accounts"),
    requestedLevel: v.union(v.literal("read"), v.literal("modify")),
    resolvedLevel: v.optional(v.union(v.literal("read"), v.literal("modify"))),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("cancelled"),
    ),
    message: v.optional(v.string()),
    grantId: v.optional(v.id("accessGrants")),
    invitationId: v.optional(v.id("shareInvitations")),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolvedByAccountId: v.optional(v.id("accounts")),
  })
    .index("by_embed_requester", ["embedId", "requesterAccountId", "createdAt"])
    .index("by_embed_status", ["embedId", "status", "createdAt"])
    .index("by_source_status", ["sourceArtifactId", "status", "createdAt"])
    .index("by_requester_status", [
      "requesterAccountId",
      "status",
      "createdAt",
    ]),

  artifactImportJobs: defineTable({
    artifactId: v.optional(v.id("spectraArtifacts")),
    artifactVersionId: v.optional(v.id("spectraArtifactVersions")),
    operationId: v.optional(v.string()),
    targetVersionId: v.optional(v.id("spectraArtifactVersions")),
    targetStateVectorHash: v.optional(v.string()),
    targetRoomId: v.optional(v.id("collaborationRooms")),
    targetAppendHead: v.optional(v.number()),
    targetProjectionHead: v.optional(v.number()),
    baseRevisionCaptured: v.optional(v.boolean()),
    importedContentHash: v.optional(v.string()),
    commitReceipt: v.optional(v.string()),
    importedContent: v.optional(v.any()),
    schoolId: v.optional(v.id("schools")),
    ownerAccountId: v.id("accounts"),
    typeKey: v.string(),
    format: v.string(),
    originalAssetRef: v.string(),
    originalStorageId: v.optional(v.id("_storage")),
    uploadReceipt: v.optional(v.string()),
    candidateStorageId: v.optional(v.id("_storage")),
    originalName: v.optional(v.string()),
    originalMimeType: v.optional(v.string()),
    originalBytes: v.optional(v.number()),
    originalSha256: v.optional(v.string()),
    retentionOwnerAccountId: v.optional(v.id("accounts")),
    retentionReason: v.optional(v.string()),
    status: v.union(
      v.literal("uploading"),
      v.literal("uploaded"),
      v.literal("parsing"),
      v.literal("preview"),
      v.literal("awaiting_commit"),
      v.literal("imported"),
      v.literal("quarantined"),
      v.literal("failed"),
    ),
    fidelityReport: v.optional(
      v.array(
        v.object({
          scope: v.string(),
          level: v.union(
            v.literal("exact"),
            v.literal("adapted"),
            v.literal("unsupported"),
          ),
          message: v.string(),
        }),
      ),
    ),
    unsupportedFeatures: v.array(v.string()),
    quarantineReason: v.optional(v.string()),
    parserVersion: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_storage", ["originalStorageId"])
    .index("by_candidate_storage", ["candidateStorageId"])
    .index("by_owner_status", ["ownerAccountId", "status"])
    .index("by_artifact", ["artifactId"])
    .index("by_school_created", ["schoolId", "createdAt"]),

  artifactIntakeReleaseReceipts: defineTable({
    artifactId: v.id("spectraArtifacts"),
    ownerAccountId: v.id("accounts"),
    storageId: v.id("_storage"),
    bytes: v.number(),
    family: v.string(),
    sourceId: v.string(),
    releasedAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_artifact", ["artifactId", "releasedAt"]),

  artifactDeletionJobs: defineTable({
    artifactId: v.id("spectraArtifacts"),
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    generation: v.number(),
    phase: v.union(
      v.literal("placements"),
      v.literal("children"),
      v.literal("artifact"),
      v.literal("retained"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    cursor: v.optional(v.string()),
    deletedRows: v.number(),
    releasedBytes: v.number(),
    scannedRows: v.optional(v.number()),
    retainedRows: v.optional(v.number()),
    terminalRows: v.optional(v.number()),
    attemptCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    activeAttemptId: v.optional(v.string()),
    activeAttemptAt: v.optional(v.number()),
  })
    .index("by_artifact_generation", ["artifactId", "generation"])
    .index("by_owner_updated", ["ownerAccountId", "updatedAt"]),

  artifactAssets: defineTable({
    artifactId: v.id("spectraArtifacts"),
    schoolId: v.optional(v.id("schools")),
    uploadedByAccountId: v.id("accounts"),
    storageId: v.optional(v.id("_storage")),
    candidateStorageId: v.optional(v.id("_storage")),
    uploadReceipt: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    altText: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
    retentionOwnerAccountId: v.optional(v.id("accounts")),
    retentionReason: v.optional(v.string()),
    path: v.string(),
    name: v.string(),
    mediaType: v.string(),
    bytes: v.number(),
    sha256: v.string(),
    status: v.union(
      v.literal("uploading"),
      v.literal("active"),
      v.literal("quarantined"),
      v.literal("revoked"),
    ),
    quarantineReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    activatedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    revokedByAccountId: v.optional(v.id("accounts")),
  })
    .index("by_artifact_status", ["artifactId", "status"])
    .index("by_storage", ["storageId"])
    .index("by_candidate_storage", ["candidateStorageId"])
    .index("by_artifact_path", ["artifactId", "path"])
    .index("by_artifact_digest", ["artifactId", "sha256"])
    .index("by_uploader_created", ["uploadedByAccountId", "createdAt"])
    // School purge deletes one school's assets instead of scanning every tenant's.
    .index("by_school", ["schoolId"]),

  // Semantic layer (src/features/spectra/semantic/README.md). One row per passage of an item
  // declared in convex/semanticSources.ts (artifacts, threads, calendar items, school data). The `v*Key` fields are vector prefilter
  // partitions that embed the vector version, so vectors from another model never match; the
  // plain keys filter full-text search. Every read re-checks access on the source item.
  semanticChunks: defineTable({
    itemKind: semanticIndexedKind,
    itemId: v.string(),
    chunkKey: v.string(),
    ordinal: v.number(),
    schoolId: v.optional(v.id("schools")),
    ownerAccountId: v.optional(v.id("accounts")),
    title: v.string(),
    label: v.optional(v.string()),
    regionId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    /** Only the owner may find this passage (quiz answers, private timetable details). */
    ownerOnly: v.optional(v.boolean()),
    text: v.string(),
    searchText: v.string(),
    contentHash: v.string(),
    embedding: v.optional(v.array(v.float64())),
    embeddingVersion: v.optional(v.string()),
    workspaceKey: v.optional(v.string()),
    audienceKey: v.optional(v.string()),
    vOwnerKey: v.optional(v.string()),
    vWorkspaceKey: v.optional(v.string()),
    vWorkspaceKey2: v.optional(v.string()),
    vItemKey: v.optional(v.string()),
    vAudienceKey: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_item", ["itemKind", "itemId", "chunkKey"])
    .index("by_owner_kind", ["ownerAccountId", "itemKind"])
    .index("by_school", ["schoolId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: ["vOwnerKey", "vWorkspaceKey", "vWorkspaceKey2", "vItemKey", "vAudienceKey"],
    })
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["itemKind", "ownerAccountId", "schoolId", "workspaceKey", "audienceKey"],
    }),

  // One row per indexed item: its centroid for Related, lineage for copy detection, and the
  // source generation that makes re-indexing idempotent.
  semanticItems: defineTable({
    itemKind: semanticIndexedKind,
    itemId: v.string(),
    schoolId: v.optional(v.id("schools")),
    ownerAccountId: v.optional(v.id("accounts")),
    title: v.string(),
    subtype: v.optional(v.string()),
    contentDigest: v.string(),
    lineageIds: v.array(v.string()),
    /** Item key of the source this one mirrors (a calendar deadline of a school record). */
    mirrors: v.optional(v.string()),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    /** Event start or due date. */
    timeAt: v.optional(v.number()),
    sourceUpdatedAt: v.number(),
    indexedAt: v.number(),
    chunkCount: v.number(),
    embeddingVersion: v.optional(v.string()),
    embeddingState: v.union(v.literal("complete"), v.literal("pending"), v.literal("disabled")),
    centroid: v.optional(v.array(v.float64())),
    vOwnerKey: v.optional(v.string()),
    vWorkspaceKey: v.optional(v.string()),
    vWorkspaceKey2: v.optional(v.string()),
    vItemKey: v.optional(v.string()),
    vAudienceKey: v.optional(v.string()),
  })
    .index("by_item", ["itemKind", "itemId"])
    .index("by_owner_kind", ["ownerAccountId", "itemKind"])
    .index("by_school", ["schoolId"])
    .index("by_state", ["embeddingState", "indexedAt"])
    .index("by_owner_updated", ["ownerAccountId", "sourceUpdatedAt"])
    .vectorIndex("by_centroid", {
      vectorField: "centroid",
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: ["vOwnerKey", "vWorkspaceKey", "vWorkspaceKey2", "vItemKey", "vAudienceKey"],
    }),

  // Debounced re-index work. Saves only touch this row; embedding happens in actions.
  semanticIndexQueue: defineTable({
    itemKind: semanticIndexedKind,
    itemId: v.string(),
    schoolId: v.optional(v.id("schools")),
    status: v.union(v.literal("waiting"), v.literal("running")),
    dueAt: v.number(),
    firstQueuedAt: v.number(),
    lastTouchedAt: v.number(),
    leaseOwner: v.optional(v.string()),
    attempts: v.number(),
    rerun: v.optional(v.boolean()),
  })
    .index("by_item", ["itemKind", "itemId"])
    .index("by_status_due", ["status", "dueAt"])
    .index("by_school", ["schoolId"]),

  // Related neighbours per viewer and item. Candidate ids only: every read re-checks access, and
  // a re-index of the item (new generation) or the TTL retires the row.
  semanticRelatedCache: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    itemKind: semanticIndexedKind,
    itemId: v.string(),
    generation: v.number(),
    embeddingVersion: v.string(),
    neighbors: v.array(v.object({ itemKind: semanticIndexedKind, itemId: v.string(), similarity: v.number() })),
    expiresAt: v.number(),
  })
    .index("by_account_item", ["accountId", "itemKind", "itemId"])
    .index("by_expires", ["expiresAt"])
    .index("by_school", ["schoolId"]),

  // Singleton: the earliest dispatch already scheduled, so dispatch chains collapse into one.
  semanticDispatcher: defineTable({ scheduledFor: v.number() }),

  semanticBackfills: defineTable({
    /** A registered kind, then "sweep", "memory", "done" (convex/semanticIndex.ts). */
    phase: v.string(),
    cursor: v.optional(v.string()),
    pageSize: v.number(),
    scanned: v.number(),
    enqueued: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_started", ["startedAt"]),

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

  // The organizational tree (ARCHITECTURE-STORAGE §3). One tree per account:
  // Library is the whole tree, a Workspace view is the subtree under a
  // workspace node. Work and threads have exactly one primary node; every
  // other appearance is a `link`. Never stores filesystem paths (D27).
  orgNodes: defineTable({
    accountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    parentId: v.union(v.id("orgNodes"), v.null()),
    kind: v.union(
      v.literal("folder"),
      v.literal("workspace"),
      v.literal("work"),
      v.literal("thread"),
      v.literal("link"),
    ),
    // Folders/workspaces own their name; work/thread/link nodes carry a cached
    // copy of the source title so listings and search need no fan-out read.
    name: v.string(),
    // work → spectraArtifacts._id · thread → spectraThreads._id
    // workspace → spectraWorkspaces._id · link → target orgNodes._id
    sourceId: v.optional(v.string()),
    orderKey: v.string(),
    // The kind of thing this is, as a reader would name it: a work's blueprint
    // key, or the node kind for threads, folders, workspaces and links. Cached
    // here so a board column of one type is an indexed range rather than a scan
    // of the account (CANON D42).
    typeKey: v.optional(v.string()),
    // When the thing itself last changed — a content commit, a retitle, a run
    // finishing — as distinct from `updatedAt`, which is when its *placement*
    // last changed. Every recency-ordered surface reads this, and it is indexed
    // so those surfaces can page instead of collecting.
    activityAt: v.optional(v.number()),
    // Nearest ancestor workspace, maintained transactionally on every move.
    // Absent = the account's root scope (General is a real workspace, so work
    // is never contextless).
    workspaceContextId: v.optional(v.id("spectraWorkspaces")),
    placedByAccountId: v.optional(v.id("accounts")),
    accessProjection: v.optional(v.boolean()),
    pinned: v.optional(v.boolean()),
    // Direct live children only. Writes maintain this transactionally; old
    // rows are filled by orgTree.backfillChildCounts before rollout.
    childCount: v.optional(v.number()),
    // Soft delete: the whole subtree is stamped, `trashedRootId` names the node
    // the user actually deleted so restore is one operation.
    deletedAt: v.optional(v.number()),
    trashedRootId: v.optional(v.id("orgNodes")),
    isTrashRoot: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_parent_order", ["accountId", "parentId", "orderKey"])
    .index("by_account_parent_live_order", [
      "accountId",
      "parentId",
      "deletedAt",
      "orderKey",
    ])
    .index("by_account_parent_live_type_order", [
      "accountId",
      "parentId",
      "deletedAt",
      "typeKey",
      "orderKey",
    ])
    .index("by_account_parent_live_name", [
      "accountId",
      "parentId",
      "deletedAt",
      "name",
    ])
    .index("by_account_parent_live_type_name", [
      "accountId",
      "parentId",
      "deletedAt",
      "typeKey",
      "name",
    ])
    .index("by_account_parent_live_activity", [
      "accountId",
      "parentId",
      "deletedAt",
      "activityAt",
    ])
    .index("by_account_parent_live_type_activity", [
      "accountId",
      "parentId",
      "deletedAt",
      "typeKey",
      "activityAt",
    ])
    .index("by_parent", ["parentId"])
    .index("by_account_kind_source", ["accountId", "kind", "sourceId"])
    .index("by_account_live_kind_activity", [
      "accountId",
      "deletedAt",
      "kind",
      "activityAt",
    ])
    .index("by_kind_source", ["kind", "sourceId"])
    .index("by_kind_source_live", ["kind", "sourceId", "deletedAt"])
    .index("by_account_workspace", ["accountId", "workspaceContextId"])
    .index("by_workspace_context", ["workspaceContextId"])
    .index("by_workspace_context_live_kind_activity", [
      "workspaceContextId",
      "deletedAt",
      "kind",
      "activityAt",
    ])
    .index("by_account_deleted", ["accountId", "deletedAt"])
    .index("by_trashed_root", ["trashedRootId"])
    .index("by_account_trash_root", ["accountId", "isTrashRoot", "deletedAt"])
    /* The board's windows. `deletedAt` sits in each one so a trashed subtree is
       excluded by the range rather than filtered out of it, which keeps a page
       of results exactly a page of reads. */
    .index("by_account_live_activity", ["accountId", "deletedAt", "activityAt"])
    .index("by_account_live_pinned_name", [
      "accountId",
      "deletedAt",
      "pinned",
      "name",
    ])
    .index("by_account_live_type_activity", [
      "accountId",
      "deletedAt",
      "typeKey",
      "activityAt",
    ])
    .index("by_account_live_workspace_activity", [
      "accountId",
      "deletedAt",
      "workspaceContextId",
      "activityAt",
    ])
    .index("by_account_live_workspace_type_activity", [
      "accountId",
      "deletedAt",
      "workspaceContextId",
      "typeKey",
      "activityAt",
    ])
    .index("by_parent_live_activity", ["parentId", "deletedAt", "activityAt"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["accountId", "kind", "deletedAt"],
    }),

  workspaceImportJobs: defineTable({
    schoolId: v.optional(v.id("schools")),
    accountId: v.id("accounts"),
    fileName: v.string(),
    sha256: v.string(),
    status: v.union(v.literal("imported"), v.literal("quarantined")),
    formatVersion: v.optional(v.number()),
    originalManifest: v.optional(v.any()),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    report: v.object({
      placed: v.number(),
      skipped: v.number(),
      unsupported: v.array(v.string()),
      warnings: v.array(v.string()),
    }),
    createdAt: v.number(),
    completedAt: v.number(),
  })
    .index("by_account_created", ["accountId", "createdAt"])
    .index("by_workspace", ["workspaceId"]),

  spectraThreads: defineTable({
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    title: v.string(),
    /** The owner named this chat; generated titles never replace it. */
    titleSetByOwner: v.optional(v.boolean()),
    summaryShort: v.optional(v.string()),
    summaryLong: v.optional(v.string()),
    origin: v.union(
      v.literal("chat"),
      v.literal("workspace"),
      v.literal("artifact"),
    ),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
    pinned: v.optional(v.boolean()),
    messageCount: v.optional(v.number()),
    previewText: v.optional(v.string()),
    contextWorkspaceIds: v.optional(v.array(v.id("spectraWorkspaces"))),
    contextArtifactIds: v.optional(v.array(v.id("spectraArtifacts"))),
    readSchemaVersion: v.optional(v.number()),
    lastRunId: v.optional(v.id("spectraAiRuns")),
    retainedAgentId: v.optional(v.id("spectraArtifacts")),
    retainedAgentVersionId: v.optional(v.id("spectraArtifactVersions")),
    status: v.union(
      v.literal("active"),
      v.literal("archived"),
      v.literal("deleted"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessageAt: v.optional(v.number()),
  })
    .index("by_account_status", ["ownerAccountId", "status"])
    .index("by_account_school_status_updated", [
      "ownerAccountId",
      "schoolId",
      "status",
      "updatedAt",
    ])
    .index("by_school_status", ["schoolId", "status", "updatedAt"])
    .index("by_workspace", ["workspaceId"])
    .index("by_artifact", ["artifactId"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["ownerAccountId", "schoolId", "status", "workspaceId"],
    }),

  spectraMessages: defineTable({
    threadId: v.id("spectraThreads"),
    schoolId: v.optional(v.id("schools")),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
      v.literal("tool"),
    ),
    content: v.string(),
    runId: v.optional(v.id("spectraAiRuns")),
    clientMessageId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    ordinal: v.optional(v.number()),
  })
    .index("by_thread", ["threadId"])
    .index("by_school_created", ["schoolId", "createdAt"])
    .index("by_thread_created", ["threadId", "createdAt"])
    .index("by_thread_ordinal", ["threadId", "ordinal"])
    .index("by_thread_client", ["threadId", "clientMessageId"])
    .index("by_run", ["runId"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["threadId"],
    }),

  spectraAiRuns: defineTable({
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    sourceSurface: v.union(
      v.literal("chat"),
      v.literal("workspace"),
      v.literal("artifact"),
    ),
    phase: v.optional(
      v.union(
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
      ),
    ),
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
    decision: v.optional(
      v.union(
        v.literal("answer"),
        v.literal("operate"),
        v.literal("clarify"),
        v.literal("refuse"),
      ),
    ),
    planIntent: v.optional(v.any()),
    finalSummary: v.optional(v.string()),
    dockSummary: v.optional(
      v.object({
        checkpointSummary: v.optional(v.string()),
        recentSteps: v.array(v.string()),
        inputRequest: v.optional(v.any()),
      }),
    ),
    suggestedThreadTitle: v.optional(v.string()),
    suggestedThreadSummary: v.optional(v.string()),
    error: v.optional(v.string()),
    modelUsed: v.optional(v.string()),
    providerUsed: v.optional(v.string()),
    selectedAgentId: v.optional(v.id("spectraArtifacts")),
    selectedAgentVersionId: v.optional(v.id("spectraArtifactVersions")),
    agentUsageStartedAt: v.optional(v.number()),
    agentUsageSettledAt: v.optional(v.number()),
    agentRouting: v.optional(
      v.object({
        confidence: v.number(),
        reason: v.string(),
        source: v.union(
          v.literal("automatic"),
          v.literal("continued"),
          v.literal("explicit"),
        ),
        reversible: v.boolean(),
      }),
    ),
    usage: v.optional(v.any()),
    // Tokens already metered for the current execution. Usage arrives more
    // than once (heartbeat snapshot, Stop, the worker's own final report), so
    // each report meters only what this total has not yet counted.
    meteredUsage: v.optional(
      v.object({
        executionId: v.string(),
        inputTokens: v.number(),
        outputTokens: v.number(),
        // Per worker: a replacement worker reports its own cumulative usage
        // from zero, so each worker is metered against its own total.
        workers: v.optional(
          v.array(
            v.object({
              workerId: v.string(),
              inputTokens: v.number(),
              outputTokens: v.number(),
            }),
          ),
        ),
      }),
    ),
    sessionId: v.optional(v.string()),
    submissionKey: v.optional(v.string()),
    executionId: v.optional(v.string()),
    attemptId: v.optional(v.string()),
    outcome: v.optional(
      v.union(
        v.literal("proposed"),
        v.literal("awaiting_input"),
        v.literal("executing"),
        v.literal("answer_only"),
        v.literal("canonical_saved"),
        v.literal("native_pending"),
        v.literal("native_verified"),
        v.literal("native_superseded"),
        v.literal("cancelled"),
        v.literal("failed"),
      ),
    ),
    clarification: v.optional(
      v.object({
        id: v.string(),
        messageId: v.optional(v.id("spectraMessages")),
        executionId: v.string(),
        status: v.union(
          v.literal("pending"),
          v.literal("selected"),
          v.literal("consumed"),
          v.literal("expired"),
        ),
        options: v.array(
          v.object({
            key: v.string(),
            title: v.string(),
            description: v.optional(v.string()),
          }),
        ),
        questions: v.optional(
          v.array(
            v.object({
              id: v.string(),
              prompt: v.string(),
              options: v.array(
                v.object({
                  key: v.string(),
                  title: v.string(),
                  description: v.optional(v.string()),
                }),
              ),
            }),
          ),
        ),
        targetIds: v.array(v.string()),
        targetRevisions: v.optional(v.any()),
        authority: v.object({
          ownerAccountId: v.string(),
          schoolId: v.optional(v.string()),
          capturedAt: v.number(),
        }),
        createdAt: v.number(),
        selectedAt: v.optional(v.number()),
        selectedKey: v.optional(v.string()),
        consumedAt: v.optional(v.number()),
      }),
    ),
    lastRetryKey: v.optional(v.string()),
    eventSequence: v.optional(v.number()),
    traceDegraded: v.optional(v.boolean()),
    approval: v.optional(
      v.object({
        executionId: v.string(),
        status: v.union(
          v.literal("pending"),
          v.literal("accepted"),
          v.literal("rejected"),
          v.literal("revised"),
        ),
        reasons: v.array(v.string()),
        revision: v.optional(v.string()),
        requestedAt: v.number(),
        claimedAt: v.optional(v.number()),
        decidedAt: v.optional(v.number()),
      }),
    ),
    recoveryState: v.optional(
      v.union(v.literal("interrupted"), v.literal("partial")),
    ),
    retryable: v.optional(v.boolean()),
    preservedPartial: v.optional(v.boolean()),
    uiObserverInterests: v.optional(vUiObserverInterests),
    workerId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    contextSnapshot: v.optional(v.any()),
    // Server-owned original request, answers and unexecuted staged candidates
    // of a request paused for clarification (spectraRunContinuations.ts).
    clarificationContinuation: v.optional(v.any()),
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
    .index("by_artifact", ["artifactId"])
    .index("by_status_lease", ["status", "leaseExpiresAt"]),

  spectraRunJobs: defineTable({
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    status: v.union(
      v.literal("queued"),
      v.literal("leased"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
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
    originalFileId: v.optional(v.string()),
    sha256: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("uploading"),
        v.literal("active"),
        v.literal("quarantined"),
      ),
    ),
    uploadReceipt: v.optional(v.string()),
    quarantineReason: v.optional(v.string()),
    name: v.string(),
    mimeType: v.string(),
    size: v.number(),
    handling: v.union(
      v.literal("pdf"),
      v.literal("text"),
      v.literal("docx"),
      v.literal("xlsx"),
      v.literal("pptx"),
      v.literal("image"),
    ),
    extractedText: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    sourceMap: v.optional(v.any()),
    provenance: v.optional(v.any()),
    updatedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_storage", ["storageId"])
      .index("by_run_execution", ["runId", "executionId"])
    .index("by_owner_created", ["ownerAccountId", "createdAt"]),

  spectraOperations: defineTable({
    runId: v.optional(v.id("spectraAiRuns")),
    executionId: v.optional(v.string()),
    planRootOperationId: v.optional(v.id("spectraOperations")),
    planIndex: v.optional(v.number()),
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
    uiObservation: v.optional(vUiObservation),
    affected: v.array(v.object({ type: v.string(), id: v.string() })),
    requiresConfirmation: v.optional(v.boolean()),
    pendingArtifactId: v.optional(v.id("spectraArtifacts")),
    pendingWorkspaceId: v.optional(v.id("spectraWorkspaces")),
    conflict: v.optional(
      v.object({
        claimId: v.id("regionClaims"),
        artifactId: v.id("spectraArtifacts"),
        clientId: v.string(),
        regionId: v.string(),
        blockerActorKind: v.union(v.literal("human"), v.literal("ai")),
        queuePosition: v.number(),
        baseSnapshot: v.any(),
        proposedSnapshot: v.optional(v.any()),
        createdAt: v.number(),
      }),
    ),
    undoData: v.optional(v.any()),
    createdAt: v.number(),
    executedAt: v.optional(v.number()),
  })
    .index("by_run", ["runId"])
    .index("by_run_execution_status", ["runId", "executionId", "status"])
    .index("by_plan_root_index", ["planRootOperationId", "planIndex"])
    .index("by_type_status", ["type", "status"]),

  spectraResultCards: defineTable({
    runId: v.id("spectraAiRuns"),
    // New cards can be discovered without opening the run payload. Optional
    // keeps old cards readable until the bounded card backfill completes.
    ownerAccountId: v.optional(v.id("accounts")),
    schoolId: v.optional(v.id("schools")),
    runSummaryVersion: v.optional(v.number()),
    runSummary: v.optional(v.any()),
    surface: v.union(
      v.literal("chat"),
      v.literal("workspace"),
      v.literal("artifact"),
    ),
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
    actions: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        targetType: v.optional(
          v.union(
            v.literal("artifact"),
            v.literal("thread"),
            v.literal("run"),
            v.literal("workspace"),
          ),
        ),
        targetId: v.optional(v.string()),
      }),
    ),
    provenance: v.optional(v.any()),
    hiddenAt: v.optional(v.number()),
    keptAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_owner_updated", ["ownerAccountId", "updatedAt"])
    .index("by_owner_surface_updated", [
      "ownerAccountId",
      "surface",
      "updatedAt",
    ])
    .index("by_owner_workspace_updated", [
      "ownerAccountId",
      "workspaceId",
      "updatedAt",
    ])
    .index("by_owner_artifact_updated", [
      "ownerAccountId",
      "artifactId",
      "updatedAt",
    ])
    .index("by_updated", ["updatedAt"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_artifact_status", ["artifactId", "status"]),

  // Live dock/list readers must not hydrate a result card's untrusted full
  // provenance/evidence payload. The canonical card remains for explicit run
  // trace/detail reads; this same-transaction row is the bounded hot shape.
  spectraResultCardSummaries: defineTable({
    readModelVersion: v.number(),
    cardId: v.id("spectraResultCards"),
    runId: v.id("spectraAiRuns"),
    ownerAccountId: v.optional(v.id("accounts")),
    schoolId: v.optional(v.id("schools")),
    surface: v.union(
      v.literal("chat"),
      v.literal("workspace"),
      v.literal("artifact"),
    ),
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
    actions: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        targetType: v.optional(
          v.union(
            v.literal("artifact"),
            v.literal("thread"),
            v.literal("run"),
            v.literal("workspace"),
          ),
        ),
        targetId: v.optional(v.string()),
      }),
    ),
    // Kept beside the card so result-card lists do not need a run join. It is
    // the same bounded run projection used by the live tab, never the run row.
    runSummary: v.optional(v.any()),
    // This is compactResultCardForRead's allowlist, never the canonical
    // evidence/provenance object.
    provenance: v.optional(v.any()),
    hiddenAt: v.optional(v.number()),
    keptAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_card", ["cardId"])
    .index("by_run", ["runId"])
    .index("by_owner_updated", ["ownerAccountId", "updatedAt"])
    .index("by_owner_surface_updated", [
      "ownerAccountId",
      "surface",
      "updatedAt",
    ])
    .index("by_owner_workspace_updated", [
      "ownerAccountId",
      "workspaceId",
      "updatedAt",
    ])
    .index("by_owner_artifact_updated", [
      "ownerAccountId",
      "artifactId",
      "updatedAt",
    ])
    .index("by_updated", ["updatedAt"]),

  // A single durable fence lets hot readers retain a bounded legacy fallback
  // during rollout, then stop probing canonical cards once the cursor-shaped
  // backfill has completed. New card writes are maintained by the same
  // transaction trigger after that fence is set.
  spectraReadModelMigrations: defineTable({
    key: v.string(),
    version: v.number(),
    state: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    cursor: v.optional(v.string()),
    scanned: v.number(),
    repaired: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // One tiny row per canonical run, independent of visible tabs or surfaces.
  // Prompts, plans, context and heartbeat fields never enter analytics reads.
  spectraAnalyticsRunSummaries: defineTable({
    readModelVersion: v.number(),
    runId: v.id("spectraAiRuns"),
    ownerAccountId: v.id("accounts"),
    status: v.union(
      v.literal("queued"), v.literal("running"),
      v.literal("awaiting_confirmation"), v.literal("awaiting_resolution"),
      v.literal("completed"), v.literal("failed"), v.literal("cancelled"),
    ),
    createdAt: v.number(),
    title: v.string(),
  })
    .index("by_run", ["runId"])
    .index("by_account_created", ["ownerAccountId", "createdAt"]),

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

  /*
   * The AI harness checkpoint for one run: the loop state at the last tool
   * boundary, the operation recorded for each tool call that writes, the
   * open question or approval, the user's answer, and messages the user sent
   * while the run worked. One row per run (spectraHarness.ts).
   */
  spectraHarnessStates: defineTable({
    runId: v.id("spectraAiRuns"),
    ownerAccountId: v.id("accounts"),
    executionId: v.string(),
    state: v.any(),
    toolOperations: v.optional(v.any()),
    pending: v.optional(v.any()),
    answer: v.optional(v.any()),
    steers: v.optional(
      v.array(v.object({ text: v.string(), createdAt: v.number() })),
    ),
    updatedAt: v.number(),
  }).index("by_run", ["runId"]),

  spectraRunTabs: defineTable({
    ownerAccountId: v.id("accounts"),
    schoolId: v.optional(v.id("schools")),
    runId: v.id("spectraAiRuns"),
    threadId: v.id("spectraThreads"),
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    // Kept flat so an artifact-scoped dock can use an index without opening
    // the canonical run row or decoding its context/plan payload.
    artifactId: v.optional(v.id("spectraArtifacts")),
    surface: v.union(
      v.literal("chat"),
      v.literal("workspace"),
      v.literal("artifact"),
    ),
    selected: v.optional(v.boolean()),
    hiddenAt: v.optional(v.number()),
    projectionVersion: v.optional(v.number()),
    threadTitle: v.optional(v.string()),
    runSummary: v.optional(
      v.object({
        _id: v.id("spectraAiRuns"),
        executionId: v.optional(v.string()),
        attemptId: v.optional(v.string()),
        outcome: v.optional(
          v.union(
            v.literal("proposed"),
            v.literal("awaiting_input"),
            v.literal("executing"),
            v.literal("answer_only"),
            v.literal("canonical_saved"),
            v.literal("native_pending"),
            v.literal("native_verified"),
            v.literal("native_superseded"),
            v.literal("cancelled"),
            v.literal("failed"),
          ),
        ),
        status: v.union(
          v.literal("queued"),
          v.literal("running"),
          v.literal("awaiting_confirmation"),
          v.literal("awaiting_resolution"),
          v.literal("completed"),
          v.literal("failed"),
          v.literal("cancelled"),
        ),
        phase: v.optional(
          v.union(
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
          ),
        ),
        sourceSurface: v.union(
          v.literal("chat"),
          v.literal("workspace"),
          v.literal("artifact"),
        ),
        threadId: v.optional(v.id("spectraThreads")),
        workspaceId: v.optional(v.id("spectraWorkspaces")),
        artifactId: v.optional(v.id("spectraArtifacts")),
        userPrompt: v.string(),
        decision: v.optional(
          v.union(
            v.literal("answer"),
            v.literal("operate"),
            v.literal("clarify"),
            v.literal("refuse"),
          ),
        ),
        finalSummary: v.optional(v.string()),
        error: v.optional(v.string()),
        modelUsed: v.optional(v.string()),
        providerUsed: v.optional(v.string()),
        attemptCount: v.optional(v.number()),
        recoveryState: v.optional(
          v.union(v.literal("interrupted"), v.literal("partial")),
        ),
        retryable: v.optional(v.boolean()),
        traceDegraded: v.optional(v.boolean()),
        selectedAgentId: v.optional(v.id("spectraArtifacts")),
        selectedAgentVersionId: v.optional(v.id("spectraArtifactVersions")),
        dockSummary: v.optional(
          v.object({
            checkpointSummary: v.optional(v.string()),
            recentSteps: v.array(v.string()),
            inputRequest: v.optional(v.any()),
          }),
        ),
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_updated", ["ownerAccountId", "updatedAt"])
    .index("by_account_run", ["ownerAccountId", "runId"])
    .index("by_account_thread", ["ownerAccountId", "threadId"])
    .index("by_account_workspace", [
      "ownerAccountId",
      "workspaceId",
      "updatedAt",
    ])
    .index("by_account_artifact", ["ownerAccountId", "artifactId", "updatedAt"])
    .index("by_run", ["runId"])
    .index("by_thread", ["threadId"])
    .index("by_projection_version", ["projectionVersion", "updatedAt"]),

  // Legacy read-only tombstone retained because dropping a live Convex table
  // is destructive. There are no product readers or writers; administration
  // export/purge keeps the rows recoverable until an explicit migration owns
  // their disposition.
  spectraFocusSpaces: defineTable({
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    title: v.string(),
    selected: v.array(
      v.object({
        type: v.union(
          v.literal("artifact"),
          v.literal("thread"),
          v.literal("workspaceItem"),
        ),
        id: v.string(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),
});
