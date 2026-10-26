import type { ArtifactTypeKey } from "../artifacts/types";
import type { CompilerStageState as FoundryCompilerStageState } from "../agents/foundry/compiler";
import type { CompiledAgentResult } from "../agents/foundry/foundry-document";
import type { ArtifactCardView } from "../components/artifact-card";
import type { PublishedCodeBuildProjection } from "../code/published-build";
import type { QuizExperience } from "../quiz/experience";
import type { TimetablePersonalState } from "../timetable/model";
import { spectraBus } from "../events";
import { coalesceInFlight } from "@/lib/coalesce-inflight";
import { createCatalogPageCache, type CatalogPage } from "./catalog-page-cache";
import { requestSpectra } from "./request";
import type { SchoolSyncKind } from "../../../../shared/school-sync";

export type SpectraBlueprintKey = ArtifactTypeKey | "thread_reference" | "resource";

export type SpectraAiEffect = {
  effectId: string;
  runId: string;
  executionId: string;
  operationIndex?: number;
  title: string;
  detail?: string;
  activity: "create" | "edit" | "verify" | "other";
  regionHint?: string;
  regionIds: string[];
  changedPaths: string[];
  state: "active" | "settling";
  startedAt: number;
  updatedAt: number;
  expiresAt?: number;
};

export type SpectraMemoryScope =
  | "private_global"
  | "private_school"
  | "workspace"
  | "shared_artifact"
  | "system";

export type SpectraMemoryClaimType =
  | "declared_fact"
  | "inferred_preference"
  | "correction"
  | "decision"
  | "recurring_workflow"
  | "commitment"
  | "mistake_avoidance"
  | "learning_signal"
  | "relationship"
  | "workspace_convention";

export type SpectraMemoryCategories = {
  declaredFacts: boolean;
  preferences: boolean;
  decisions: boolean;
  workflows: boolean;
  commitments: boolean;
  learningSignals: boolean;
  relationships: boolean;
  workspaceConventions: boolean;
};

export type SpectraMemoryPreferences = {
  enabled: boolean;
  capturePaused: boolean;
  categoryControls: SpectraMemoryCategories;
  capsuleTargetTokens: number;
  updatedAt: number;
};

export type SpectraMemoryEvidence = {
  _id: string;
  sourceType:
    | "user_statement"
    | "thread"
    | "artifact"
    | "workspace"
    | "managebac"
    | "product_event"
    | "correction";
  sourceId?: string;
  sourceVersionId?: string;
  sourceRegionId?: string;
  excerptPreview?: string;
  captureReason: string;
  accessStatus: "available" | "revoked" | "deleted" | "school_changed";
  observedAt: number;
};

export type SpectraMemoryClaim = {
  _id: string;
  scope: SpectraMemoryScope;
  workspaceId?: string;
  artifactId?: string;
  subjectKind: "user" | "workspace" | "artifact" | "workflow" | "relationship";
  subjectId?: string;
  claimType: SpectraMemoryClaimType;
  proposition: string;
  assertion: "asserted" | "inferred";
  confidence: number;
  status: "proposed" | "active" | "disputed" | "superseded" | "expired";
  createdBy: "user" | "policy" | "model";
  validFrom: number;
  expiresAt?: number;
  lastConfirmedAt?: number;
  supersedesId?: string;
  createdAt: number;
  updatedAt: number;
  evidence: SpectraMemoryEvidence[];
};

export type SpectraManageBacIntegration = {
  _id: string;
  provider: "managebac";
  baseUrl: string;
  referenceUrl?: string;
  authHeaderName: string;
  authScheme: "raw" | "bearer";
  status:
    "draft" | "validating" | "connected" | "degraded" | "blocked" | "revoked";
  tokenMode: "read_only";
  credentialFingerprint?: string;
  providerVersion?: string;
  manifestVersion: number;
  capabilityCoverage: {
    discovered: number;
    verifiedReadable: number;
    unverified: number;
    failed: number;
    quarantined: number;
  };
  syncPolicy: {
    frequencyMinutes: number;
    autoCreateClasses: boolean;
    autoImportTasks: boolean;
    autoApplySafeUpdates: boolean;
    conflictMode: "review" | "ask_me";
  };
  freshnessSlaMinutes: number;
  requestBudgetPerMinute: number;
  bootstrapVersion: number;
  lastValidatedAt?: number;
  lastSyncAt?: number;
  nextSyncAt?: number;
  blockedReason?: string;
  rotationDueAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type SpectraManageBacCapability = {
  _id: string;
  category: string;
  name: string;
  recordType: string;
  method?: "GET";
  path?: string;
  purpose: string;
  scope: "personal" | "class" | "school";
  minimumRole?: "student" | "teacher" | "school_admin";
  permissionState: "read_only" | "not_enabled" | "unverified";
  verificationStatus: "verified" | "failed" | "quarantined" | "unverified";
  freshnessSlaMinutes: number;
  contractVersion?: string;
  responseSchemaHash?: string;
  routeSource?: "tenant_reference" | "api_manager" | "manual_verified";
  normalization?: unknown;
  lastVerifiedAt?: number;
  lastErrorCode?: string;
};

export type SpectraManageBacRecord = {
  _id: string;
  recordType: string;
  classification?: "personal" | "class" | "school" | "public_resource";
  audienceScope?:
    "mapped_user" | "class_members" | "authorized_staff" | "school";
  providerClassId?: string;
  academicPeriodKey?: string;
  normalized: Record<string, unknown>;
  sourceModifiedAt?: number;
  fetchedAt: number;
  tombstone: boolean;
  sourceHash?: string;
  sourceState?: "available" | "changed" | "temporarily_unavailable" | "missing" | "removed";
  provenanceUrl?: string;
};

export type SpectraManageBacSyncRun = {
  _id: string;
  kind: "identity" | "bootstrap" | "manual" | "scheduled" | "reconciliation";
  status:
    | "queued"
    | "leased"
    | "running"
    | "awaiting_review"
    | "completed"
    | "partial"
    | "failed"
    | "cancelled";
  stage: string;
  counts: {
    fetched: number;
    created: number;
    updated: number;
    unchanged: number;
    tombstoned: number;
    projected: number;
    skipped: number;
    quarantined: number;
    conflicts: number;
    errors: number;
  };
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  errorCode?: string;
  errorSummary?: string;
};

export type SpectraManageBacConflict = {
  _id: string;
  kind: string;
  projectionType: string;
  oldSource: unknown;
  newSource: unknown;
  overlay?: unknown;
  affectedLinks: string[];
  suggestedActions: string[];
  status: "open" | "resolved" | "dismissed";
  createdAt: number;
};

export type SpectraManageBacOverview = {
  admin: boolean;
  data: {
    integration: SpectraManageBacIntegration | null;
    /** Non-secret admin hint from MANAGEBAC_BASE_URL when no integration exists. */
    envBaseUrlHint?: string;
    /** True only on a local stack whose server has MANAGEBAC_API_KEY; deployments never use it. */
    envTokenAvailable?: boolean;
    school?: { _id: string; name: string } | null;
    periodMaps?: Array<{
      _id: string;
      periodKey: string;
      label: string;
      startMinutes: number;
      endMinutes: number;
      timezone: string;
      weekdays: number[];
      verifiedAt: number;
      source: "school_admin" | "provider_contract";
    }>;
    mapping?: {
      status: "pending" | "verified" | "no_match" | "ambiguous" | "revoked";
      matchCount?: number;
      resolvedAt?: number;
      updatedAt: number;
    } | null;
    capabilities: SpectraManageBacCapability[];
    syncRuns: SpectraManageBacSyncRun[];
    conflicts: SpectraManageBacConflict[];
    records?: SpectraManageBacRecord[];
    previews?: SpectraManageBacRecord[];
    quarantine?: Array<{
      _id: string;
      capabilityId: string;
      reasonCode: string;
      contractVersion: string;
      status: "open" | "reprocessed" | "dismissed";
      createdAt: number;
    }>;
    identityQueue?: Array<{
      mappingId: string;
      account: { name: string; email: string } | null;
      status: string;
      matchCount: number;
      updatedAt: number;
    }>;
  };
};

export type SpectraWorkspace = {
  _id: string;
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  status: "active" | "archived";
  defaultView: "cards" | "library";
  aiState?: "creating" | "updating" | "edited" | "failed";
  aiRunId?: string;
  aiStateExpiresAt?: number;
  aiPreview?: {
    title?: string;
    description?: string;
    icon?: string;
    color?: string;
    startedAt: number;
  };
  createdAt: number;
  updatedAt: number;
  currentVersionId?: string;
  lastActivityAt: number;
  ownership?: "owned" | "shared";
  accessLevel?: "read" | "modify" | null;
  capabilities?: Array<
    | "read"
    | "modify"
    | "share"
    | "delete"
    | "restore"
    | "use"
    | "comment"
    | "publish"
  >;
  accessReason?: string;
  isShared?: boolean;
  sharedWithCount?: number;
};

export type SpectraWorkspacePortableManifest = {
  format: "spectra-workspace";
  version: 1;
  exportedAt: number;
  workspace: {
    title: string;
    description?: string;
    icon?: string;
    color?: string;
    defaultView: "cards" | "library";
  };
  placements: Array<{
    artifactId: string;
    title: string;
    blueprintKey: SpectraBlueprintKey;
    /** Folder names inside the workspace, outermost first. */
    path?: string[];
    pinned?: boolean;
  }>;
};

export type SpectraWorkspaceManifestReport = {
  exported?: number;
  omitted?: number;
  placed?: number;
  skipped?: number;
  unsupported: string[];
  warnings: string[];
};

export type SpectraArtifact = {
  _id: string;
  blueprintKey: SpectraBlueprintKey;
  resourceClass?: "artifact" | "resource" | "thread_reference";
  nativeFormat?: string;
  compatibilityProfile?: "strict-native" | "enhanced" | "spectra-native";
  title: string;
  summary?: string;
  content?: unknown;
  tags: string[];
  status: "active" | "draft" | "archived" | "deleted";
  aiState?: "creating" | "updating" | "edited" | "failed";
  aiRunId?: string;
  aiProgress?: number;
  aiStateExpiresAt?: number;
  aiPreview?: {
    title?: string;
    summary?: string;
    content?: unknown;
    tags?: string[];
    changedPaths?: string[];
    effectTitle?: string;
    effectDetail?: string;
    effectActivity?: "create" | "edit" | "verify" | "other";
    effectRegionHint?: string;
    effectOperationIndex?: number;
    startedAt: number;
  };
  aiEffects?: SpectraAiEffect[];
  createdAt: number;
  updatedAt: number;
  currentVersionId?: string;
  placements?: Array<{
    workspaceId: string;
    workspaceTitle: string;
    nodeId: string;
    pinned?: boolean;
  }>;
  placementStatus?: "inbox" | "shared" | "workspace";
  /** False on compact agent cards; selected actions must resolve current placements. */
  placementsComplete?: boolean;
  ownership?: "owned" | "shared";
  accessLevel?: "read" | "modify" | null;
  capabilities?: Array<
    | "read"
    | "modify"
    | "share"
    | "delete"
    | "restore"
    | "use"
    | "comment"
    | "publish"
  >;
  accessReason?: string;
  isShared?: boolean;
  sharedWithCount?: number;
  owner?: { name: string; avatarUrl?: string };
  agentRelease?: {
    versionId: string;
    releaseNumber: number;
    publishedAt: number;
  } | null;
  createdFrom?: {
    source: "chat" | "workspace" | "artifact" | "manual" | "ai";
    threadId?: string;
    runId?: string;
    workspaceId?: string;
    sourceArtifactIds?: string[];
    sourceThreadIds?: string[];
    sourceAttachmentNames?: string[];
    contextSummary?: string;
  };
};

export type SpectraArtifactLink = {
  _id: string;
  sourceArtifactId: string;
  targetArtifactId: string;
  relationType:
    | "related"
    | "supports"
    | "contradicts"
    | "source_for"
    | "generated_from"
    | "follow_up"
    | "belongs_with";
  label?: string;
  explanation?: string;
  createdBy: "user" | "ai" | "system";
  workspaceId?: string;
  direction: "incoming" | "outgoing";
  artifact: {
    id: string;
    title: string;
    summary?: string;
    blueprintKey: SpectraBlueprintKey;
    updatedAt: number;
  } | null;
  createdAt: number;
  updatedAt: number;
};

export type SpectraArtifactVersion = {
  _id: string;
  artifactId: string;
  parentVersionId?: string;
  source:
    | "manual"
    | "ai"
    | "revert"
    | "import"
    | "restore"
    | "migration"
    | "checkpoint";
  runId?: string;
  before?: {
    title: string;
    summary?: string;
    content: unknown;
    tags: string[];
  };
  after?: { title: string; summary?: string; content: unknown; tags: string[] };
  snapshotState?: "ready" | "corrupt" | "unavailable";
  snapshotError?: string;
  summary?: string;
  name?: string;
  stateVectorHash?: string;
  integrityHash?: string;
  changeGroupIds?: string[];
  creatorAccountIds?: string[];
  provenance?: { regionIds?: string[]; clientId?: string; source?: string };
  versionNumber?: number;
  creators?: Array<{ accountId: string; name: string; avatarUrl?: string }>;
  run?: { runId: string; finalSummary?: string };
  createdAt: number;
};

export type SpectraArtifactVersionSummary = Pick<SpectraArtifactVersion,
  "_id" | "artifactId" | "parentVersionId" | "source" | "runId" | "summary" | "name" |
  "createdAt" | "creatorAccountIds" | "creators"
>;

export type SpectraArtifactVersionPage = {
  versions: SpectraArtifactVersionSummary[];
  continueCursor: string | null;
  isDone: boolean;
};

/**
 * One thing inside a workspace: the tree node that puts it there, plus the work
 * or thread it points at. There is exactly one node per item, so a title and a
 * pin are properties of the item itself rather than of a per-view row.
 */
export type SpectraWorkspaceItem = {
  nodeId: string;
  workspaceId: string;
  parentId: string | null;
  kind: "work" | "thread";
  sourceId: string;
  name: string;
  pinned: boolean;
  orderKey: string;
  artifact: SpectraArtifact | null;
  thread?: SpectraThread | null;
  createdAt: number;
  updatedAt: number;
};

export type SpectraRun = {
  _id: string;
  executionId?: string;
  attemptId?: string;
  outcome?: "proposed" | "awaiting_input" | "executing" | "answer_only" | "canonical_saved" | "native_pending" | "native_verified" | "native_superseded" | "cancelled" | "failed";
  status:
    | "queued"
    | "running"
    | "awaiting_confirmation"
    | "awaiting_resolution"
    | "completed"
    | "failed"
    | "cancelled";
  phase?:
    | "created"
    | "preparing"
    | "planning"
    | "reading"
    | "retrieving"
    | "creating"
    | "updating"
    | "applying"
    | "streaming"
    | "checking"
    | "approval"
    | "conflict"
    | "completed"
    | "stopped"
    | "interrupted"
    | "partial"
    | "failed";
  sourceSurface: "chat" | "workspace" | "artifact";
  threadId?: string;
  workspaceId?: string;
  artifactId?: string;
  userPrompt: string;
  decision?: "answer" | "operate" | "clarify" | "refuse";
  planIntent?: unknown;
  finalSummary?: string;
  error?: string;
  modelUsed?: string;
  providerUsed?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    elapsedMs?: number;
  };
  attemptCount?: number;
  recoveryState?: "interrupted" | "partial";
  retryable?: boolean;
  traceDegraded?: boolean;
  selectedAgentId?: string;
  selectedAgentVersionId?: string;
  createdAt: number;
  updatedAt: number;
};

export type SpectraThread = {
  _id: string;
  title: string;
  summaryShort?: string;
  previewText?: string;
  origin: "chat" | "workspace" | "artifact";
  workspaceId?: string;
  artifactId?: string;
  pinned?: boolean;
  messageCount?: number;
  status: "active" | "archived" | "deleted";
  createdAt: number;
  updatedAt: number;
  lastMessageAt?: number;
  lastRunId?: string;
  contexts?: {
    workspaces?: Array<{ id: string; title: string }>;
    artifacts?: Array<{ id: string; title: string }>;
  };
  contextWorkspaceIds?: string[];
  contextArtifactIds?: string[];
  readSchemaVersion?: number;
};

export type SpectraMessage = {
  _id: string;
  threadId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  runId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

export type SpectraThreadTrace = {
  run: SpectraRun;
  operations: SpectraOperation[];
  cards: SpectraResultCard[];
  events?: SpectraRunEvent[];
  artifacts: SpectraArtifact[];
  eventPage?: { hasMore: boolean; after: number; nextCursor?: string | null };
  operationPage?: { hasMore: boolean; before?: string | null };
  cardPage?: { hasMore: boolean; before?: string | null };
};

export type SpectraRunEvent = {
  _id: string;
  runId: string;
  executionId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
};

export type SpectraThreadDetail = {
  thread: SpectraThread;
  messages: SpectraMessage[];
  traces: SpectraThreadTrace[];
  viewerName?: string;
  messagePage?: { hasOlder: boolean; olderBefore?: string };
  tracePage?: { limit: number };
  activeExecution?: { run: SpectraRun } | null;
};

export type SpectraThreadPage = {
  threads: SpectraThread[];
  hasMore: boolean;
  nextCursor?: string | null;
};

export type SpectraResultAction = {
  key: string;
  label: string;
  targetType?: "artifact" | "thread" | "run" | "workspace";
  targetId?: string;
};

export type SpectraResultCard = {
  _id: string;
  runId: string;
  status: SpectraRun["status"];
  variant: "status" | "artifact" | "thread" | "operation" | "error";
  title: string;
  summary?: string;
  actions: SpectraResultAction[];
  hiddenAt?: number;
  keptAt?: number;
  createdAt: number;
  updatedAt: number;
  run?: SpectraRun;
  provenance?: {
    artifactIds?: string[];
    artifactTitles?: string[];
    threadId?: string;
    workspaceId?: string;
    workspaceTitle?: string;
    attachmentNames?: string[];
    agentId?: string;
    agentVersionId?: string;
    agentTitle?: string;
    agentRoutingReason?: string;
    agentRoutingSource?: "automatic" | "continued" | "explicit";
  };
};

export type SpectraOperation = {
  _id: string;
  runId?: string;
  type: string;
  status:
    "proposed" | "executing" | "waiting" | "executed" | "failed" | "cancelled";
  input: unknown;
  output?: unknown;
  affected: Array<{ type: string; id: string }>;
  requiresConfirmation?: boolean;
  pendingArtifactId?: string;
  pendingWorkspaceId?: string;
  conflict?: {
    claimId: string;
    artifactId: string;
    clientId: string;
    regionId: string;
    blockerActorKind: "human" | "ai";
    queuePosition: number;
    baseSnapshot: unknown;
    proposedSnapshot?: unknown;
    createdAt: number;
  };
  createdAt: number;
  executedAt?: number;
};

export type SpectraRunDetail = {
  run: SpectraRun;
  cards: SpectraResultCard[];
  operations: SpectraOperation[];
};

export type SpectraRunTab = {
  _id: string;
  runId: string;
  threadId: string;
  workspaceId?: string;
  surface: "chat" | "workspace" | "artifact";
  selected?: boolean;
  hiddenAt?: number;
  createdAt: number;
  updatedAt: number;
  run: SpectraRun;
  thread: SpectraThread;
  card?: SpectraResultCard | null;
  inputRequest?:
    | {
        kind: "choice";
        messageId: string;
        clarificationId?: string;
        executionId?: string;
        prompt: string;
        options: Array<{ key?: string; title: string; description?: string | null }>;
      }
    | {
        kind: "choice_batch";
        messageId: string;
        clarificationId?: string;
        executionId?: string;
        questions: Array<{
          id: string;
          prompt: string;
          options: Array<{ key?: string; title: string; description?: string | null }>;
        }>;
      }
    | null;
  checkpointSummary?: string;
  recentSteps?: string[];
};

export type SpectraArtifactComment = {
  _id: string;
  artifactId: string;
  parentCommentId?: string;
  authorAccountId: string;
  author: { accountId: string; name: string; avatarUrl?: string; kind?: "human" | "ai" } | null;
  body: string;
  anchor: {
    regionId: string;
    semanticAnchor?: {
      workId: string;
      workType: ArtifactTypeKey;
      kind: string;
      path: string[];
      stableIds?: Record<string, string>;
      fallbackExcerpt?: string;
      schemaVersion: number;
    };
    relativePosition?: ArrayBuffer;
    fallbackExcerpt?: string;
    geometry?: unknown;
  };
  mentionedAccountIds: string[];
  mentions: Array<{ accountId: string; name: string; avatarUrl?: string }>;
  status: "open" | "resolved" | "orphaned" | "deleted";
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  resolvedByAccountId?: string;
};

export type SpectraArtifactCommentNotification = {
  _id: string;
  artifactId: string;
  commentId: string;
  kind: "mention" | "reply" | "all_comments";
  createdAt: number;
  readAt?: number;
  artifact: {
    artifactId: string;
    title: string;
    blueprintKey: SpectraBlueprintKey;
  };
  comment: { body: string; regionId: string };
  author: { accountId: string; name: string; avatarUrl?: string; kind?: "human" | "ai" } | null;
};

export type SpectraPlannerReminderNotification = {
  _id: string;
  artifactId: string;
  recipientAccountId: string;
  reminderId: string;
  taskTitle: string;
  dueAt: number;
  scheduledFor: number;
  status: "pending" | "delivered" | "failed" | "cancelled";
  attempts: number;
  createdAt: number;
  deliveredAt?: number;
  readAt?: number;
};

export type SpectraTimetableReminderNotification = {
  _id: string;
  artifactId: string;
  recipientAccountId: string;
  eventId: string;
  reminderKey: string;
  eventTitle: string;
  artifactTitle: string;
  occurrenceStart: number;
  scheduledFor: number;
  createdAt: number;
  deliveredAt: number;
  readAt?: number;
};

export type SpectraArtifactEmbed =
  import("../../../../shared/artifact-embed").ArtifactEmbedReference & {
  effectiveInteraction?: "read" | "interact" | "edit";
  /** The reader may change the embedded work itself: it can be edited in place. */
  canEditSource?: boolean;
  /** Opaque current-host placement witness; never source authority. */
  placementRefreshKey?: string;
  canConfigure?: boolean;
  canRequestAccess?: boolean;
  accessRequest?: { requestId: string; status: "pending"; createdAt: number };
  source?: {
    artifactId: string;
    title: string;
    summary?: string;
    blueprintKey: SpectraBlueprintKey;
    tags?: string[];
    updatedAt?: number;
    snapshot?: {
      title?: string;
      summary?: string;
      tags?: string[];
      content?: unknown;
    };
  };
  version?: {
    versionId: string;
    createdAt: number;
    summary?: string;
    name?: string;
  };
  /** The computer the work is kept on, when its contents live only there. */
  keptOn?: { deviceName: string };
  runtimeBuild?: {
    buildId: string;
    artifactVersionId: string;
    runtime: "browser" | "react" | "python";
    sourceHash: string;
    payloadHash?: string;
    sdkVersion: string;
    sourceBytes: number;
    outputBytes: number;
    payloadBytes?: number;
    publishedAt?: number;
  };
  runtimeResources?: Record<string, unknown>;
};

export type SpectraArtifactAccessRequest = {
  requestId: string;
  requestedLevel: "read" | "modify";
  message?: string;
  createdAt: number;
  requester: {
    accountId: string;
    name: string;
    email: string;
    avatarUrl?: string;
  } | null;
  context: { containerType: "artifact" | "thread"; containerId: string } | null;
};

export type SpectraOverview = {
  needsSchool?: boolean;
  workspaces: SpectraWorkspace[];
  selectedWorkspaceId?: string;
  workspace: {
    workspace: SpectraWorkspace;
    items: SpectraWorkspaceItem[];
  } | null;
  artifacts: SpectraArtifact[];
  runs: SpectraRun[];
  resultCards: SpectraResultCard[];
};

export type SpectraShareInvitation = {
  invitationId: string;
  resourceType: "workspace" | "artifact" | "agent";
  resourceId: string;
  level: "read" | "modify";
  message?: string;
  expiresAt?: number;
  createdAt: number;
  inviter: { accountId: string; name: string; avatarUrl?: string } | null;
  resource: { title: string; typeKey: SpectraBlueprintKey | "workspace" };
};

export type SpectraSchoolMember = {
  accountId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  role: "student" | "teacher" | "school_admin";
};

export type SpectraShareEntry = {
  invitationId: string;
  status: "pending" | "accepted";
  level: "read" | "modify";
  expiresAt?: number;
  acceptedAt?: number;
  grantId?: string;
  account: {
    accountId: string;
    name: string;
    email: string;
    avatarUrl?: string;
  } | null;
};

export type SpectraPublicLinkEntry = {
  linkId: string;
  level: "read";
  expiresAt?: number;
  createdAt: number;
  /** A link Spectra made in one of your runs: Share can copy it again. */
  madeBySpectra?: { runId: string; operationId: string };
};

export type SpectraInheritedAccessEntry = {
  account: {
    accountId: string;
    name: string;
    email: string;
    avatarUrl?: string;
  };
  inheritedLevel: "read" | "modify";
  directLevel: "read" | "modify" | null;
  effectiveLevel: "read" | "modify" | null;
  sources: Array<{
    workspaceId: string;
    workspaceTitle: string;
    level: "read" | "modify";
  }>;
  exception: {
    overrideId: string;
    effect: "deny" | "restrict";
    maxLevel?: "read" | "modify";
  } | null;
};

type JsonRecord = Record<string, unknown>;

const overviewCache = new Map<
  string,
  { value: SpectraOverview; cachedAt: number }
>();
const workspaceCache = new Map<
  string,
  { value: SpectraOverview["workspace"]; cachedAt: number }
>();
const CACHE_TTL = 5 * 60_000;
const FIRST_PAINT_FETCH_TTL_MS = 1_100;
const CACHE_LOCAL_ACTIONS = new Set([
  "hideResultCard",
  "keepResultCard",
]);

export function peekSpectraWorkspace(workspaceId: string) {
  const cached = workspaceCache.get(workspaceId);
  return cached && Date.now() - cached.cachedAt < CACHE_TTL
    ? cached.value
    : null;
}

export function invalidateSpectraCache(scope?: { workspaceId?: string }) {
  overviewCache.clear();
  spectraWorkspaceCatalog.invalidate();
  spectraAgentCatalog.invalidate();
  if (scope?.workspaceId) workspaceCache.delete(scope.workspaceId);
  else workspaceCache.clear();
}

// Connection failures are reworded in ./request; every call below uses it.
export { SPECTRA_REQUEST_UNREACHABLE } from "./request";
const SPECTRA_REQUEST_FAILED =
  "Spectra could not finish this request. Try again in a moment.";

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    T | { error?: { code?: string; message?: string } } | { error?: string } | null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? typeof payload.error === "string"
          ? payload.error
          : payload.error?.message
        : undefined;
    const error = new Error(message || SPECTRA_REQUEST_FAILED);
    if (payload && typeof payload === "object" && "error" in payload &&
        payload.error && typeof payload.error === "object") {
      throw Object.assign(error, { data: payload.error });
    }
    throw error;
  }
  return payload as T;
}

export async function getSpectraOverview(workspaceId?: string, force = false) {
  const key = workspaceId ?? "home";
  const cached = overviewCache.get(key);
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL)
    return cached.value;
  const params = new URLSearchParams({ action: "overview" });
  if (workspaceId) params.set("workspaceId", workspaceId);
  const value = await readJson<SpectraOverview>(
    await requestSpectra(`/api/spectra?${params.toString()}`, { cache: "no-store" }),
  );
  overviewCache.set(key, { value, cachedAt: Date.now() });
  if (workspaceId && value.workspace)
    workspaceCache.set(workspaceId, {
      value: value.workspace,
      cachedAt: Date.now(),
    });
  return value;
}

export async function getSpectraWorkspace(workspaceId: string, force = false) {
  const cached = workspaceCache.get(workspaceId);
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL)
    return { workspace: cached.value };
  const qs = new URLSearchParams({ action: "workspace", workspaceId });
  const value = await readJson<{ workspace: SpectraOverview["workspace"] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
  workspaceCache.set(workspaceId, {
    value: value.workspace,
    cachedAt: Date.now(),
  });
  return value;
}

export function getSpectraWorkspacePage(cursor?: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ action: "workspaceGraphPage" });
  if (cursor) params.set("cursor", cursor);
  return requestSpectra(`/api/spectra?${params}`, { cache: "no-store", signal }).then(readJson<CatalogPage<SpectraWorkspace>>);
}
export function getSpectraAgentPage(cursor?: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ action: "agentGraphPage" });
  if (cursor) params.set("cursor", cursor);
  return requestSpectra(`/api/spectra?${params}`, { cache: "no-store", signal }).then(readJson<CatalogPage<SpectraArtifact>>);
}
export function getSpectraWorkspaceMetadata(workspaceId: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ action: "workspaceMetadata", workspaceId });
  return requestSpectra(`/api/spectra?${params}`, { cache: "no-store", signal }).then(readJson<{ workspace: SpectraWorkspace | null }>);
}
export const spectraWorkspaceCatalog = createCatalogPageCache<SpectraWorkspace>((_key, cursor, signal) => getSpectraWorkspacePage(cursor, signal));
export const spectraAgentCatalog = createCatalogPageCache<SpectraArtifact>((_key, cursor, signal) => getSpectraAgentPage(cursor, signal));

export async function exportSpectraWorkspaceManifest(workspaceId: string) {
  const qs = new URLSearchParams({
    action: "exportWorkspaceManifest",
    workspaceId,
  });
  return readJson<{
    manifest: SpectraWorkspacePortableManifest;
    report: SpectraWorkspaceManifestReport;
  }>(await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraArtifacts(params?: {
  placement?: "all" | "inbox" | "shared" | "workspace";
  blueprintKey?: SpectraBlueprintKey | "all";
  search?: string;
  signal?: AbortSignal;
}) {
  const qs = new URLSearchParams({
    action: "artifacts",
    placement: params?.placement ?? "all",
  });
  if (params?.blueprintKey && params.blueprintKey !== "all")
    qs.set("blueprintKey", params.blueprintKey);
  if (params?.search?.trim()) qs.set("search", params.search.trim());
  return readJson<{ artifacts: SpectraArtifact[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store", signal: params?.signal }),
  );
}

export async function getSpectraArtifact(artifactId: string, options?: { signal?: AbortSignal }) {
  const qs = new URLSearchParams({ action: "artifact", artifactId });
  return readJson<{ artifact: SpectraArtifact }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store", signal: options?.signal }),
  );
}

export async function getSpectraArtifactForDeepLink(artifactId: string, options?: { signal?: AbortSignal }) {
  const qs = new URLSearchParams({ action: "artifact", artifactId });
  const response = await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store", signal: options?.signal });
  if (response.status === 404) return { artifact: null };
  if (response.status === 403) {
    const payload = await response.clone().json().catch(() => null);
    if (payload?.error?.code === "AUTH_RESOURCE_FORBIDDEN")
      return { artifact: null };
  }
  return readJson<{ artifact: SpectraArtifact | null }>(response);
}

export async function getSpectraArtifactUserState(artifactId: string) {
  const qs = new URLSearchParams({
    action: "artifactUserState",
    artifactId,
  });
  return readJson<{
    state: TimetablePersonalState | null;
    revision: number;
    updatedAt: number | null;
  }>(await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function saveSpectraArtifactUserState(input: {
  artifactId: string;
  state: TimetablePersonalState;
}) {
  return postSpectra<{
    state: TimetablePersonalState;
    revision: number;
    updatedAt: number;
  }>({
    action: "saveArtifactUserState",
    artifactId: input.artifactId,
    state: input.state,
  });
}

export async function getSpectraMemory(params?: {
  search?: string;
  status?: SpectraMemoryClaim["status"];
  scope?: SpectraMemoryScope;
  claimType?: SpectraMemoryClaimType;
  limit?: number;
}) {
  const query = new URLSearchParams({ action: "memory" });
  if (params?.search?.trim()) query.set("search", params.search.trim());
  if (params?.status) query.set("status", params.status);
  if (params?.scope) query.set("scope", params.scope);
  if (params?.claimType) query.set("claimType", params.claimType);
  if (params?.limit) query.set("limit", String(params.limit));
  return readJson<{
    preferences: SpectraMemoryPreferences;
    claims: SpectraMemoryClaim[];
  }>(await requestSpectra(`/api/spectra?${query.toString()}`, { cache: "no-store" }));
}

export async function updateSpectraMemoryPreferences(
  input: Partial<
    Pick<
      SpectraMemoryPreferences,
      "enabled" | "capturePaused" | "categoryControls" | "capsuleTargetTokens"
    >
  >,
) {
  return postSpectra<SpectraMemoryPreferences>({
    action: "updateMemoryPreferences",
    ...input,
  });
}

export async function rememberSpectraMemory(input: {
  proposition: string;
  scope: SpectraMemoryScope;
  claimType: SpectraMemoryClaimType;
  workspaceId?: string;
  artifactId?: string;
  captureReason?: string;
}) {
  return postSpectra<{ claimId: string; merged: boolean }>({
    action: "rememberMemory",
    ...input,
  });
}

export async function correctSpectraMemory(
  claimId: string,
  proposition: string,
) {
  return postSpectra<{ claimId: string; merged: boolean }>({
    action: "correctMemory",
    claimId,
    proposition,
  });
}

export async function disputeSpectraMemory(claimId: string, disputed = true) {
  return postSpectra<{ claimId: string; status: "disputed" | "active" }>({
    action: "disputeMemory",
    claimId,
    disputed,
  });
}

export async function forgetSpectraMemory(claimId: string) {
  return postSpectra<{ forgotten: boolean }>({
    action: "forgetMemory",
    claimId,
  });
}

export async function clearSpectraMemory(confirmation: string) {
  return postSpectra<{ forgottenCount: number }>({
    action: "clearMemory",
    confirmation,
  });
}

export async function exportSpectraMemory() {
  return readJson<Record<string, unknown>>(
    await requestSpectra("/api/spectra?action=memoryExport", { cache: "no-store" }),
  );
}

async function postManageBac<T>(body: Record<string, unknown>) {
  return readJson<T>(
    await requestSpectra("/api/spectra/managebac", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function getSpectraManageBacOverview() {
  return readJson<SpectraManageBacOverview>(
    await requestSpectra("/api/spectra/managebac?action=overview", {
      cache: "no-store",
    }),
  );
}

export async function configureSpectraManageBac(input: {
  baseUrl: string;
  token: string;
}) {
  return postManageBac<{ integrationId: string }>({
    action: "configure",
    ...input,
  });
}

export async function replaceSpectraManageBacManifest(input: {
  integrationId: string;
  providerVersion?: string;
  capabilities: Array<Record<string, unknown>>;
}) {
  return postManageBac<{
    integrationId: string;
    manifestVersion: number;
    coverage: SpectraManageBacIntegration["capabilityCoverage"];
  }>({ action: "replaceManifest", ...input });
}

export async function importSpectraManageBacReference(input: {
  integrationId: string;
  document: Record<string, unknown>;
}) {
  return postManageBac<{
    integrationId: string;
    manifestVersion: number;
    discovered: number;
    warning: string;
  }>({ action: "importReference", ...input });
}

export async function resolveSpectraManageBacIdentity() {
  const result = await postManageBac<{ identity: { result: { status: string } }; classes?: { jobs: SpectraSchoolSyncJob[]; queued: SchoolSyncKind[] } }>({
    action: "resolveIdentity",
    syncClasses: true,
  });
  if (result.identity?.result?.status !== "verified")
    throw new Error("Spectra couldn't uniquely match your verified email to a ManageBac student. Ask your school to check the email on your ManageBac account.");
  return result;
}

/** One job of a student's "Sync now": one kind of School data. */
export type SpectraSchoolSyncJob = {
  kind: SchoolSyncKind;
  syncRunId?: string;
  summaries?: Array<{ capabilityId: string; name: string; pages: number; records: number; skipped?: string }>;
  completion?: unknown;
  /** The request's time budget ran out; the job continues in the background. */
  suspended?: true;
  errorCode?: string;
  errorSummary?: string;
};

/**
 * Syncs the student's School data now: one kind, or every kind that isn't
 * Off. Kinds the request had no time for are queued and run in the
 * background (`queued`). See convex/school.README.md.
 */
export async function syncSpectraManageBac(kind?: SchoolSyncKind) {
  return postManageBac<{ jobs: SpectraSchoolSyncJob[]; queued: SchoolSyncKind[] }>({
    action: "sync",
    ...(kind ? { kind } : {}),
  });
}

export async function syncSpectraManageBacOnLogin() {
  return postManageBac<{ jobs: SpectraSchoolSyncJob[]; queued: SchoolSyncKind[]; skipped?: boolean; reason?: string; nextAttemptAt?: number }>({ action: "syncOnLogin" });
}

/** Requests one school reconciliation may take to finish a large school's pass. */
const MANAGEBAC_RECONCILIATION_REQUESTS = 12;

/** The school-wide reconciliation of shared routes (administrators only). */
export async function reconcileSpectraManageBacSchool() {
  // Each request stops at the route's time budget and leaves the pass saved;
  // the next request continues it, so a large school finishes in a few.
  let result = await postManageBac<Record<string, unknown>>({ action: "sync", kind: "reconciliation" });
  for (
    let request = 1;
    request < MANAGEBAC_RECONCILIATION_REQUESTS &&
    result.suspended === true &&
    result.errorCode === "INTEGRATION_SYNC_TIME_BUDGET";
    request += 1
  )
    result = await postManageBac<Record<string, unknown>>({ action: "sync", kind: "reconciliation" });
  return result;
}

/**
 * Opens a file the student handed in: the first call downloads it from
 * ManageBac into the student's storage; read it with `api.school.fileUrl`.
 */
export async function fetchSpectraSchoolFile(input: { submissionRecordId: string; providerFileId: string }) {
  return postManageBac<{
    status: "cached" | "fetched";
    schoolFileId: string;
    deduplicated?: boolean;
  }>({ action: "fetchSchoolFile", ...input });
}

export async function selectSpectraManageBacClasses(input: {
  recordIds: string[];
  expectedRevision?: number;
  retention?: "keep_in_spectra" | "archive_projection";
}) {
  return postManageBac<{
    selectionRevision: number;
    selectedClassIds: string[];
    selectedRecordIds: string[];
    deselectedRecordIds?: string[];
    retention?: "keep_in_spectra" | "archive_projection";
    materialization?: {
      requested: number;
      created: number;
      refreshed: number;
      projected: number;
      skipped: number;
    };
    release?: {
      requested: number;
      removed: number;
      skipped: number;
      done?: boolean;
    };
    outcome?: "selection_saved";
  }>({ action: "selectClasses", ...input });
}

export async function importSpectraManageBacResource(input: {
  sourceRecordId: string;
  refresh?: boolean;
  requestKey?: string;
}) {
  return postManageBac<{
    status: "started" | "resume" | "imported" | "update_available" | "source_unavailable";
    importId?: string;
    artifactId?: string;
    priorArtifactId?: string;
    sourceHash?: string;
    replayed?: boolean;
  }>({ action: "importResource", ...input });
}

export async function resolveSpectraManageBacConflict(input: {
  conflictId: string;
  resolution:
    | "rebase"
    | "keep_overlay"
    | "detach"
    | "archive_projection"
    | "link_existing";
  linkProjectionId?: string;
}) {
  return postManageBac<{ conflictId: string; resolution: string }>({
    action: "resolveConflict",
    ...input,
  });
}

export async function disconnectSpectraManageBac() {
  return postManageBac<{ disconnected: boolean }>({
    action: "disconnect",
  });
}

/** Looks again at a blocked connection with the key already saved; opens it if ManageBac takes the key. */
export async function recheckSpectraManageBac() {
  return postManageBac<{ outcome: "reopened" | "not_blocked" | "key_missing" | "key_refused" | "unreachable"; status?: number }>({
    action: "recheck",
  });
}

export async function upsertSpectraCalendarPeriodMap(input: {
  periodKey: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
  timezone: string;
  weekdays: number[];
}) {
  return postManageBac<{ periodMapId: string; verifiedAt: number }>({
    action: "upsertPeriodMap",
    ...input,
  });
}

export async function removeSpectraCalendarPeriodMap(periodMapId: string) {
  return postManageBac<{ removed: true }>({
    action: "removePeriodMap",
    periodMapId,
  });
}

export type SpectraFlashcardRating = "again" | "hard" | "good" | "easy";

export type SpectraFlashcardStudyState = {
  stateId: string;
  cardId: string;
  direction: "forward" | "reverse";
  cardVersionId?: string;
  algorithm: string;
  algorithmVersion: number;
  attempts: number;
  ease: number;
  stabilityDays: number;
  difficulty: number;
  lapses: number;
  nextDueAt: number;
  lastReviewedAt?: number;
  /** The learner's private note on this card. */
  note?: string;
  /** The card was rewritten since this was last studied, so it is due again. */
  changedSinceStudied?: boolean;
  previews: Record<
    SpectraFlashcardRating,
    { nextDueAt: number; label: string }
  >;
};

/** What the deck's edits did to this person's progress (§11B). */
export type SpectraFlashcardStudyUpdate = {
  changedCardIds: string[];
  /** Cards the deck no longer offers whose progress is kept for their return. */
  retainedCardIds: string[];
  studiedCardIds: string[];
};

export async function getSpectraFlashcardStudy(artifactId: string) {
  const qs = new URLSearchParams({ action: "flashcardStudy", artifactId });
  return readJson<{
    states: SpectraFlashcardStudyState[];
    dueCount: number;
    update: SpectraFlashcardStudyUpdate;
  }>(await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function setSpectraFlashcardNote(input: {
  artifactId: string;
  cardId: string;
  direction: "forward" | "reverse";
  note: string;
}) {
  return postSpectra<{
    cardId: string;
    direction: "forward" | "reverse";
    note: string;
  }>({ action: "setFlashcardNote", ...input });
}

export async function reviewSpectraFlashcard(input: {
  artifactId: string;
  cardId: string;
  direction: "forward" | "reverse";
  rating: SpectraFlashcardRating;
  clientReviewId: string;
  elapsedMs?: number;
}) {
  return postSpectra<{
    state: SpectraFlashcardStudyState;
    reused: boolean;
  }>({ action: "reviewFlashcard", ...input });
}

export type SpectraQuizPracticeQuestion = {
  id: string;
  prompt: string;
  type:
    | "multiple_choice"
    | "short_answer"
    | "true_false"
    | "select_all"
    | "ordering"
    | "numeric"
    | "fill_blank"
    | "long_response"
    | "matching";
  options: string[];
  matchingPairs?: Array<{ id: string; left: string }>;
  matchingChoices?: string[];
  points: number;
  difficulty?: string;
  timeLimitSeconds?: number;
  media?: unknown;
};

export type SpectraQuizPracticeResult = {
  questionId: string;
  correct: boolean | null;
  awardedPoints: number;
  maxPoints: number;
  response: string | string[];
  expected: string | string[];
  explanation?: string;
  advisoryFeedback?: string;
};

export type SpectraQuizPracticeAttempt = {
  attemptId: string;
  artifactId: string;
  artifactVersionId?: string;
  contentHash: string;
  status: "in_progress" | "submitted";
  questions: SpectraQuizPracticeQuestion[];
  responses: Record<string, string | string[]>;
  score?: number;
  maxScore?: number;
  percentage?: number;
  startedAt: number;
  submittedAt?: number;
  elapsedMs?: number;
  results?: SpectraQuizPracticeResult[];
  instructions?: string;
  settings?: Record<string, unknown>;
  /** How this quiz is used, resolved server-side (§11C). */
  experience?: QuizExperience;
  /**
   * Milliseconds left, counted from the server's own `startedAt` rather than
   * from anything the tab remembers, so a refresh resumes the same clock and
   * cannot extend it. `null` means this quiz is untimed.
   */
  timeRemainingMs?: number | null;
  /** Whether the reveal policy has released answers to this learner yet. */
  answersRevealed?: boolean;
  /** Set when the attempt was submitted after its clock ran out. */
  timeElapsed?: boolean;
};

export async function getSpectraQuizPracticeAttempts(
  artifactId: string,
  limit = 20,
) {
  const qs = new URLSearchParams({
    action: "quizPracticeAttempts",
    artifactId,
    limit: String(limit),
  });
  return readJson<{ attempts: SpectraQuizPracticeAttempt[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export type SpectraQuizResponseSummary =
  | { available: false; reason: string }
  | {
      available: true;
      attemptCount: number;
      submittedCount: number;
      inProgressCount: number;
      timeElapsedCount: number;
      averagePercentage?: number;
      questions: Array<{
        questionId: string;
        prompt: string;
        answered: number;
        correct: number;
        commonResponses: Array<{ response: string; count: number }>;
      }>;
    };

/**
 * Cohort-level results for the quiz's owner. No account is named and no single
 * response is returned, so the same call is safe for an anonymous quiz (§11C).
 */
export async function getSpectraQuizResponseSummary(artifactId: string) {
  const qs = new URLSearchParams({
    action: "quizResponseSummary",
    artifactId,
  });
  return readJson<SpectraQuizResponseSummary>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function startSpectraQuizPractice(input: {
  artifactId: string;
  clientAttemptId: string;
}) {
  return postSpectra<SpectraQuizPracticeAttempt>({
    action: "startQuizPractice",
    ...input,
  });
}

export async function saveSpectraQuizPracticeResponse(input: {
  attemptId: string;
  questionId: string;
  response: string | string[];
  clientMutationId: string;
}) {
  return postSpectra<{
    responseId: string;
    reused: boolean;
    /** The server's own remaining time, used to re-anchor the countdown. */
    timeRemainingMs?: number | null;
    result?: SpectraQuizPracticeResult;
  }>({
    action: "saveQuizPracticeResponse",
    ...input,
  });
}

export async function submitSpectraQuizPractice(input: {
  attemptId: string;
  clientSubmissionId: string;
}) {
  return postSpectra<SpectraQuizPracticeAttempt>({
    action: "submitQuizPractice",
    ...input,
  });
}

export async function searchSpectra(query: string, options?: { signal?: AbortSignal }) {
  const qs = new URLSearchParams({ action: "search", search: query });
  return readJson<{
    artifacts: SpectraArtifact[];
    workspaces: SpectraWorkspace[];
  }>(await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store", signal: options?.signal }));
}

export async function getSpectraResultCards(params?: {
  surface?: "chat" | "workspace" | "artifact";
  workspaceId?: string;
  artifactId?: string;
  includeHidden?: boolean;
  limit?: number;
}) {
  const qs = new URLSearchParams({ action: "resultCards" });
  if (params?.surface) qs.set("surface", params.surface);
  if (params?.workspaceId) qs.set("workspaceId", params.workspaceId);
  if (params?.artifactId) qs.set("artifactId", params.artifactId);
  if (params?.includeHidden) qs.set("includeHidden", "true");
  if (params?.limit) qs.set("limit", String(params.limit));
  return readJson<{ resultCards: SpectraResultCard[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function getSpectraRunDetail(runId: string) {
  const qs = new URLSearchParams({ action: "runDetail", runId });
  return readJson<SpectraRunDetail>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

const runTabsRequests = new Map<
  string,
  { at: number; promise: Promise<{ runTabs: SpectraRunTab[] }> }
>();
const runEventRequests = new Map<
  string,
  { at: number; promise: Promise<{ events: SpectraRunEvent[] }> }
>();
const shareInvitationRequests = new Map<
  string,
  { at: number; promise: Promise<{ invitations: SpectraShareInvitation[] }> }
>();
const notificationCenterRequests = new Map<
  string,
  {
    at: number;
    promise: Promise<{
      comments: SpectraArtifactCommentNotification[];
      planner: SpectraPlannerReminderNotification[];
      timetable: SpectraTimetableReminderNotification[];
      invitations: SpectraShareInvitation[];
    }>;
  }
>();
const threadIndexRequests = new Map<
  string,
  { at: number; promise: Promise<SpectraThreadPage> }
>();

export const SPECTRA_THREAD_INDEX_LIMIT = 40;

export function invalidateSpectraRunTabsCache() {
  runTabsRequests.clear();
}

export async function getSpectraRunTabs(
  options: {
    includeHidden?: boolean;
    limit?: number;
    force?: boolean;
    threadId?: string;
    workspaceId?: string;
    artifactId?: string;
    surface?: "chat" | "workspace" | "artifact";
    /** Only tabs touched since this time. */
    since?: number;
  } = {},
) {
  const qs = new URLSearchParams({ action: "runTabs" });
  if (options.since) qs.set("since", String(options.since));
  if (options.includeHidden) qs.set("includeHidden", "true");
  if (options.limit) qs.set("limit", String(options.limit));
  if (options.threadId) qs.set("threadId", options.threadId);
  if (options.workspaceId) qs.set("workspaceId", options.workspaceId);
  if (options.artifactId) qs.set("artifactId", options.artifactId);
  if (options.surface) qs.set("surface", options.surface);
  const key = qs.toString();
  return coalesceInFlight(
    runTabsRequests,
    key,
    FIRST_PAINT_FETCH_TTL_MS,
    () =>
      requestSpectra(`/api/spectra?${key}`, { cache: "no-store" }).then((response) =>
        readJson<{ runTabs: SpectraRunTab[] }>(response),
      ),
    { force: options.force },
  );
}

export async function getSpectraShareInvitations(options: { force?: boolean } = {}) {
  return coalesceInFlight(
    shareInvitationRequests,
    "shareInvitations",
    FIRST_PAINT_FETCH_TTL_MS,
    () =>
      requestSpectra("/api/spectra?action=shareInvitations", { cache: "no-store" }).then(
        (response) =>
          readJson<{ invitations: SpectraShareInvitation[] }>(response),
      ),
    { force: options.force },
  );
}

export async function getSpectraNotificationCenter(
  unreadOnly = false,
  limit = 30,
  options: { force?: boolean } = {},
) {
  const qs = new URLSearchParams({
    action: "notificationCenter",
    unreadOnly: String(unreadOnly),
    limit: String(limit),
  });
  return coalesceInFlight(
    notificationCenterRequests,
    qs.toString(),
    FIRST_PAINT_FETCH_TTL_MS,
    () =>
      requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }).then(
        (response) =>
          readJson<{
            comments: SpectraArtifactCommentNotification[];
            planner: SpectraPlannerReminderNotification[];
            timetable: SpectraTimetableReminderNotification[];
            invitations: SpectraShareInvitation[];
          }>(response),
      ),
    { force: options.force },
  );
}

export async function searchSpectraSchoolMembers(search: string, limit = 20) {
  const qs = new URLSearchParams({
    action: "schoolMembers",
    search,
    limit: String(limit),
  });
  return readJson<{ members: SpectraSchoolMember[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function getSpectraShareState(
  resourceType: "workspace" | "artifact" | "agent",
  resourceId: string,
) {
  const qs = new URLSearchParams({
    action: "shareState",
    resourceType,
    resourceId,
  });
  return readJson<{ shares: SpectraShareEntry[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function getSpectraPublicLinks(
  resourceType: "workspace" | "artifact" | "agent",
  resourceId: string,
) {
  const qs = new URLSearchParams({
    action: "publicLinks",
    resourceType,
    resourceId,
  });
  return readJson<{ publicLinks: SpectraPublicLinkEntry[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function getSpectraInheritedAudience(artifactId: string) {
  const qs = new URLSearchParams({
    action: "artifactInheritedAudience",
    artifactId,
  });
  return readJson<{ audience: SpectraInheritedAccessEntry[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function getSpectraArtifactAccessRequests(artifactId: string) {
  const qs = new URLSearchParams({
    action: "artifactAccessRequests",
    artifactId,
  });
  return readJson<{ requests: SpectraArtifactAccessRequest[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function getSpectraRunEvents(runId: string, after = 0) {
  const qs = new URLSearchParams({
    action: "runEvents",
    runId,
    after: String(after),
  });
  const key = qs.toString();
  const existing = runEventRequests.get(key);
  if (existing && Date.now() - existing.at < 850) return existing.promise;
  const promise = requestSpectra(`/api/spectra?${key}`, { cache: "no-store" }).then(
    (response) => readJson<{ events: SpectraRunEvent[] }>(response),
  );
  runEventRequests.set(key, { at: Date.now(), promise });
  void promise.catch(() => {
    if (runEventRequests.get(key)?.promise === promise)
      runEventRequests.delete(key);
  });
  return promise;
}

export async function getSpectraOperationConflict(operationId: string) {
  const qs = new URLSearchParams({ action: "operationConflict", operationId });
  return readJson<{
    conflict: {
      runId: string;
      executionId?: string;
      operationId: string;
      operationType: string;
      input: unknown;
      conflict: NonNullable<SpectraOperation["conflict"]>;
      claimStatus: "active" | "queued" | "paused" | "released" | "rejected";
      currentStateVectorHash: string;
      currentSnapshot: unknown;
    };
  }>(await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function resolveSpectraOperationConflict(
  operationId: string,
  resolution: "apply" | "keep_current" | "cancel",
) {
  return postSpectra<{ runId: string; operationId: string; queued: boolean }>({
    action: "resolveAiArtifactConflict",
    operationId,
    resolution,
  });
}

export async function getSpectraArtifactVersions(
  artifactId: string,
  limit = 20,
  cursor?: string,
  signal?: AbortSignal,
) {
  const qs = new URLSearchParams({
    action: "artifactVersions",
    artifactId,
    limit: String(limit),
  });
  if (cursor !== undefined) qs.set("cursor", cursor);
  return readJson<SpectraArtifactVersionPage>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store", signal }),
  );
}

export async function getSpectraArtifactVersion(
  artifactId: string,
  versionId: string,
  signal?: AbortSignal,
) {
  const qs = new URLSearchParams({ action: "artifactVersion", artifactId, versionId });
  return readJson<{ version: SpectraArtifactVersion | null }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store", signal }),
  );
}

export type SpectraAgentRelease = {
  releaseId: string;
  versionId: string;
  releaseNumber: number;
  status: "published" | "suspended" | "deprecated";
  rollout?: "internal_test" | "limited" | "published";
  evalRunId?: string;
  releaseNotes?: string;
  publishedAt: number;
};

export type SpectraAgentEvalResult = {
  caseId: string;
  category: string;
  required: boolean;
  score: number;
  passed: boolean;
  reason: string;
  responseExcerpt: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type SpectraAgentEvalRun = {
  _id: string;
  contentHash: string;
  status: "running" | "passed" | "failed";
  modelId: string;
  provider: string;
  threshold: number;
  caseCount: number;
  passedCount: number;
  averageScore: number;
  results: SpectraAgentEvalResult[];
  startedAt: number;
  completedAt?: number;
};

export type SpectraAgentAnalytics = {
  invocations: number;
  completionRate: number | null;
  averageLatencyMs: number | null;
  feedback: {
    count: number;
    averageRating: number | null;
    categories: Array<[string, number]>;
    comments: Array<{
      rating: number;
      category: string;
      comment?: string;
      createdAt: number;
    }>;
  };
  evals: SpectraAgentEvalRun[];
  proposals: Array<{
    _id: string;
    evidence: string;
    expectedImpact: string;
    proposedPatch: {
      instructionsText?: string;
      routingDescription?: string;
      routingExamples?: string[];
      boundaries?: string[];
    };
    evalRunId?: string;
    status: "proposed" | "accepted" | "rejected";
    createdAt: number;
  }>;
  privacy: string;
};

export type SpectraAgentResourceHealth = {
  id?: string;
  artifactId: string;
  health:
    "available" | "missing" | "version_unavailable" | "permission_revoked";
  versionId?: string;
  title?: string;
  blueprintKey?: string;
};

export async function getSpectraAgentReleases(agentId: string) {
  const qs = new URLSearchParams({ action: "agentReleases", agentId });
  return readJson<{ releases: SpectraAgentRelease[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function publishSpectraAgent(
  agentId: string,
  releaseNotes?: string,
  rollout: "internal_test" | "limited" | "published" = "published",
) {
  return postSpectra<{
    releaseId: string;
    versionId: string;
    releaseNumber: number;
    publishedAt: number;
  }>({
    action: "publishAgent",
    agentId,
    releaseNotes,
    rollout,
  });
}

export async function getSpectraAgentEvalRuns(agentId: string) {
  const qs = new URLSearchParams({ action: "agentEvalRuns", agentId });
  return readJson<{
    currentContentHash: string;
    runs: SpectraAgentEvalRun[];
  }>(await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraAgentResourceHealth(agentId: string) {
  const qs = new URLSearchParams({ action: "agentResourceHealth", agentId });
  return readJson<{ resources: SpectraAgentResourceHealth[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function evaluateSpectraAgent(agentId: string, threshold = 0.8) {
  return readJson<{
    evalRunId: string;
    status: "passed" | "failed";
    contentHash: string;
    passedCount: number;
    caseCount: number;
    averageScore: number;
    results: SpectraAgentEvalResult[];
  }>(
    await requestSpectra("/api/spectra/agents/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, threshold }),
    }),
  );
}

export async function generateSpectraAgentEvalSuite(agentId: string) {
  return readJson<{
    cases: Array<{
      id: string;
      prompt: string;
      expected: string;
      category: string;
      required: boolean;
    }>;
  }>(
    await requestSpectra("/api/spectra/agents/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate", agentId }),
    }),
  );
}

export async function getSpectraAgentAnalytics(agentId: string) {
  const qs = new URLSearchParams({ action: "agentAnalytics", agentId });
  return readJson<{ analytics: SpectraAgentAnalytics }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function manageSpectraAgentRelease(
  releaseId: string,
  releaseAction: "promote" | "rollback" | "suspend" | "deprecate",
) {
  return postSpectra<{ releaseId: string; action: string; updatedAt: number }>({
    action: "manageAgentRelease",
    releaseId,
    releaseAction,
  });
}

export async function submitSpectraAgentFeedback(input: {
  agentId: string;
  agentVersionId: string;
  runId?: string;
  rating: number;
  category:
    | "helpful"
    | "accuracy"
    | "clarity"
    | "safety"
    | "resource_quality"
    | "other";
  comment?: string;
  consentToShareComment: boolean;
}) {
  return postSpectra<{ feedbackId: string }>({
    action: "submitAgentFeedback",
    ...input,
  });
}

export async function proposeSpectraAgentImprovement(input: {
  agentId: string;
  evidence: string;
  proposedPatch: {
    instructionsText?: string;
    routingDescription?: string;
    routingExamples?: string[];
    boundaries?: string[];
  };
  expectedImpact: string;
  evalRunId?: string;
}) {
  return postSpectra<{ proposalId: string }>({
    action: "proposeAgentImprovement",
    ...input,
  });
}

export async function decideSpectraAgentImprovement(
  proposalId: string,
  decision: "accepted" | "rejected",
  note?: string,
) {
  return postSpectra<{ proposalId: string; status: string }>({
    action: "decideAgentImprovement",
    proposalId,
    decision,
    note,
  });
}

export type SpectraPublicAgent = {
  agentId: string;
  title: string;
  summary?: string;
  tags: string[];
  purpose: string;
  audienceIntent: string;
  routingDescription: string;
  skills: string[];
  owner: { name: string; avatarUrl?: string };
  releaseNumber: number;
  publishedAt: number;
  rating: number | null;
  ratingCount: number;
};

export async function getSpectraPublicAgents(params?: {
  search?: string;
  limit?: number;
  signal?: AbortSignal;
}) {
  const qs = new URLSearchParams({ action: "publicAgents" });
  if (params?.search?.trim()) qs.set("search", params.search.trim());
  if (params?.limit) qs.set("limit", String(params.limit));
  return readJson<{ agents: SpectraPublicAgent[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store", signal: params?.signal }),
  );
}

export type SpectraInstalledAgent = SpectraPublicAgent & {
  installedAt: number;
  pinnedReleaseId?: string;
  ownedByViewer: boolean;
};

/** Agents installed from Discover — a reference to a published release. */
export async function getSpectraInstalledAgents(options?: { signal?: AbortSignal }) {
  const qs = new URLSearchParams({ action: "installedAgents" });
  return readJson<{ agents: SpectraInstalledAgent[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store", signal: options?.signal }),
  );
}

/** Install or uninstall a published agent release. */
export async function setSpectraAgentInstalled(
  agentId: string,
  installed: boolean,
  pinnedReleaseId?: string,
) {
  return postSpectra<{ followId: string; following: boolean }>({
    action: "followAgent",
    agentId,
    following: installed,
    pinnedReleaseId,
  });
}

export async function addSpectraPublicAgent(agentId: string) {
  return postSpectra<{ grantId: string; added: boolean }>({
    action: "addPublicAgent",
    agentId,
  });
}

export type SpectraSignedAgentManifest = Record<string, unknown> & {
  format: "spectra.agent";
  version: 1;
  content: unknown;
  integrity: {
    algorithm: "HMAC-SHA256";
    keyId: string;
    signature: string;
  };
};

export async function signSpectraAgentManifest(
  manifest: Record<string, unknown>,
) {
  return readJson<{ ok: true; manifest: SpectraSignedAgentManifest }>(
    await requestSpectra("/api/spectra/agents/manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sign", manifest }),
    }),
  );
}

export async function verifySpectraAgentManifest(manifest: unknown) {
  return readJson<{
    ok: true;
    manifest: Record<string, unknown> & {
      format: "spectra.agent";
      version: 1;
      content: unknown;
    };
  }>(
    await requestSpectra("/api/spectra/agents/manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify", manifest }),
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Agent Foundry (Phase 10)                                            */
/* ------------------------------------------------------------------ */

async function foundryRequest<T>(body: Record<string, unknown>) {
  return readJson<{ ok: true } & T>(
    await requestSpectra("/api/spectra/agents/foundry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function compileSpectraAgentFoundation(input: {
  agentId: string;
  objective: string;
  interaction: string;
}) {
  return foundryRequest<{
    mission: unknown;
    title?: string;
    summary?: string;
    securityConcerns: unknown[];
  }>({ operation: "foundation", ...input });
}

export async function nextSpectraFoundrySection(agentId: string) {
  return foundryRequest<{
    sufficient: boolean;
    sufficiency: unknown;
    section: unknown;
    archetypes?: string[];
  }>({ operation: "next", agentId });
}

/** Reads a source for an agent: pasted `text`, or an attached file read on the server. */
export async function extractSpectraFoundryEvidence(input: {
  agentId: string;
  sourceId: string;
  kind: string;
} & ({ text: string } | { attachment: { name: string; mimeType: string; size: number; handling: string; data?: string } })) {
  return foundryRequest<{ extraction: unknown }>({
    operation: "extract",
    ...input,
  });
}

export type SpectraFoundryCompilerJob = {
  jobId: string;
  runId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stages: FoundryCompilerStageState[];
  diagnostics?: Array<{
    severity: string;
    stage: string;
    message: string;
    subjectId?: string;
  }>;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  stale: boolean;
  /** What a completed compilation drafted; null until one completes. */
  result: CompiledAgentResult | null;
};

export async function compileSpectraFoundrySkills(agentId: string) {
  return foundryRequest<
    CompiledAgentResult & {
      jobId: string;
      diagnostics: SpectraFoundryCompilerJob["diagnostics"];
    }
  >({ operation: "compile", agentId });
}

/** Latest background compilation, shown inside Foundry rather than the Live Dock. */
export async function getSpectraFoundryCompilerJob(agentId: string) {
  return foundryRequest<{ job: SpectraFoundryCompilerJob | null }>({
    operation: "compileStatus",
    agentId,
  });
}

export async function getSpectraArtifactComments(
  artifactId: string,
  includeResolved = false,
  limit = 200,
) {
  const qs = new URLSearchParams({
    action: "artifactComments",
    artifactId,
    includeResolved: String(includeResolved),
    limit: String(limit),
  });
  return readJson<{ comments: SpectraArtifactComment[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function getSpectraArtifactCommentPreference(artifactId: string) {
  const qs = new URLSearchParams({
    action: "artifactCommentPreference",
    artifactId,
  });
  return readJson<{ mode: "all" | "mentions_replies" | "off" }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function getSpectraArtifactCommentNotifications(
  unreadOnly = false,
  limit = 50,
) {
  const qs = new URLSearchParams({
    action: "artifactCommentNotifications",
    unreadOnly: String(unreadOnly),
    limit: String(limit),
  });
  return readJson<{ notifications: SpectraArtifactCommentNotification[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function markSpectraArtifactCommentNotificationsRead(
  notificationIds: string[],
) {
  return postSpectra<{ updated: number }>({
    action: "markArtifactCommentNotificationsRead",
    notificationIds,
  });
}

export async function getSpectraPlannerReminderNotifications(
  unreadOnly = false,
  limit = 50,
) {
  const qs = new URLSearchParams({
    action: "plannerReminderNotifications",
    unreadOnly: String(unreadOnly),
    limit: String(limit),
  });
  return readJson<{ notifications: SpectraPlannerReminderNotification[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function markSpectraPlannerReminderNotificationsRead(
  deliveryIds: string[],
) {
  return postSpectra<{ updated: number }>({
    action: "markPlannerReminderNotificationsRead",
    deliveryIds,
  });
}

export async function getSpectraTimetableReminderNotifications(
  unreadOnly = false,
  limit = 50,
) {
  const qs = new URLSearchParams({
    action: "timetableReminderNotifications",
    unreadOnly: String(unreadOnly),
    limit: String(limit),
  });
  return readJson<{ notifications: SpectraTimetableReminderNotification[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function markSpectraTimetableReminderNotificationsRead(
  deliveryIds: string[],
) {
  return postSpectra<{ updated: number }>({
    action: "markTimetableReminderNotificationsRead",
    deliveryIds,
  });
}

export async function getSpectraArtifactLinks(artifactId: string) {
  const qs = new URLSearchParams({ action: "artifactLinks", artifactId });
  return readJson<{ links: SpectraArtifactLink[] }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function getSpectraArtifactEmbed(embedId: string) {
  const qs = new URLSearchParams({ action: "artifactEmbed", embedId });
  return readJson<{ embed: SpectraArtifactEmbed }>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function getSpectraThreads(params?: {
  includeArchived?: boolean;
  limit?: number;
  cursor?: string;
  /** Titles and ids only, without the works and workspaces each thread is about. */
  brief?: boolean;
  force?: boolean;
}) {
  // No abort signal: the request is shared, and one caller leaving must not fail the others.
  const qs = new URLSearchParams({ action: "threads" });
  if (params?.includeArchived) qs.set("includeArchived", "true");
  if (params?.brief) qs.set("brief", "true");
  qs.set("limit", String(params?.limit ?? SPECTRA_THREAD_INDEX_LIMIT));
  if (params?.cursor) qs.set("cursor", params.cursor);
  const key = qs.toString();
  return coalesceInFlight(
    threadIndexRequests,
    key,
    FIRST_PAINT_FETCH_TTL_MS,
    () =>
      requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }).then(
        (response) => readJson<SpectraThreadPage>(response),
      ),
    { force: params?.force },
  );
}

export async function getSpectraThread(threadId: string) {
  const qs = new URLSearchParams({ action: "thread", threadId });
  return readJson<SpectraThreadDetail>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }),
  );
}

export async function getSpectraThreadMessages(
  threadId: string,
  before?: string | number,
  limit = 48,
) {
  const qs = new URLSearchParams({
    action: "threadMessages",
    threadId,
    limit: String(limit),
  });
  if (before !== undefined) qs.set("before", String(before));
  return readJson<{
    messages: SpectraMessage[];
    hasOlder: boolean;
    olderBefore?: string;
  }>(await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraThreadRunTrace(
  threadId: string,
  runId: string,
  options: {
    family?: "operations" | "cards" | "events";
    eventAfter?: number;
    eventsCursor?: string;
    operationsBefore?: string;
    cardsBefore?: string;
    skipOperations?: boolean;
    skipCards?: boolean;
    skipEvents?: boolean;
    includeArtifacts?: boolean;
    limit?: number;
  } = {},
) {
  const qs = new URLSearchParams({
    action: "threadRunTrace",
    threadId,
    runId,
    eventAfter: String(options.eventAfter ?? 0),
    limit: String(options.limit ?? 40),
  });
  if (options.family) qs.set("family", options.family);
  if (options.eventsCursor) qs.set("eventsCursor", options.eventsCursor);
  if (options.operationsBefore) qs.set("operationsBefore", options.operationsBefore);
  if (options.cardsBefore) qs.set("cardsBefore", options.cardsBefore);
  if (options.skipOperations) qs.set("skipOperations", "true");
  if (options.skipCards) qs.set("skipCards", "true");
  if (options.skipEvents) qs.set("skipEvents", "true");
  if (options.includeArtifacts) qs.set("includeArtifacts", "true");
  return readJson<{
    run: SpectraRun;
    operations: SpectraOperation[];
    cards: SpectraResultCard[];
    events: SpectraRunEvent[];
    artifacts: SpectraArtifact[];
    eventPage?: { hasMore: boolean; after: number; nextCursor?: string | null };
    operationPage?: { hasMore: boolean; before?: string | null };
    cardPage?: { hasMore: boolean; before?: string | null };
  }>(await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function clearSpectraRunAgent(runId: string) {
  return readJson<{ cleared: boolean; threadId?: string }>(
    await requestSpectra("/api/spectra/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_agent", runId }),
    }),
  );
}

export async function postSpectra<T>(body: JsonRecord) {
  const value = await readJson<T>(
    await requestSpectra("/api/spectra", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if (
    typeof body.action !== "string" ||
    !CACHE_LOCAL_ACTIONS.has(body.action)
  ) {
    invalidateSpectraCache({
      workspaceId:
        typeof body.workspaceId === "string" ? body.workspaceId : undefined,
    });
  }
  if (
    typeof window !== "undefined" &&
    typeof body.action === "string" &&
    [
      "createWorkspace",
      "importWorkspaceManifest",
      "updateWorkspace",
      "deleteWorkspace",
    ].includes(body.action)
  ) {
    spectraBus.emit("workspaces.changed", {});
  }
  return value;
}

export async function getPublishedCodeBuild(artifactId: string) {
  const params = new URLSearchParams({ artifactId });
  return readJson<{
    ok: true;
    build: PublishedCodeBuildProjection | null;
    sourceMatchesCurrent: boolean;
  }>(
    await requestSpectra(`/api/spectra/runtime/publish?${params.toString()}`, {
      cache: "no-store",
    }),
  );
}

export async function publishCodeBuild(
  artifactId: string,
  expectedSourceHash: string,
) {
  return readJson<{
    ok: true;
    build: PublishedCodeBuildProjection;
    reused: boolean;
  }>(
    await requestSpectra("/api/spectra/runtime/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "publish",
        artifactId,
        expectedSourceHash,
      }),
    }),
  );
}

export async function unpublishCodeBuild(artifactId: string) {
  return readJson<{ ok: true; unpublished: boolean }>(
    await requestSpectra("/api/spectra/runtime/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unpublish", artifactId }),
    }),
  );
}

export type SpectraArtifactImport = {
  jobId: string;
  artifactVersionId?: string;
  format: string;
  name?: string;
  bytes?: number;
  status:
    | "uploading"
    | "uploaded"
    | "parsing"
    | "preview"
    | "awaiting_commit"
    | "imported"
    | "quarantined"
    | "failed";
  fidelityReport?: Array<{
    scope: string;
    level: "exact" | "adapted" | "unsupported";
    message: string;
  }>;
  unsupportedFeatures: string[];
  quarantineReason?: string;
  downloadUrl?: string | null;
  createdAt: number;
  completedAt?: number;
};

export type SpectraArtifactCommitReceipt = {
  kind: "artifact-import";
  operationId: string | null;
  importJobId: string;
  artifactId: string;
  versionId: string;
  commitReceipt: string;
};

export async function beginArtifactImportOriginal(input: {
  artifactId: string;
  typeKey: string;
  format: string;
  name: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}) {
  return readJson<{ ok: true; jobId: string }>(
    await requestSpectra("/api/spectra/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "begin", ...input }),
    }),
  );
}

export async function uploadArtifactImportOriginal(jobId: string, blob: Blob) {
  const query = new URLSearchParams({ jobId });
  return readJson<{ ok: true; jobId: string; status: string }>(
    await requestSpectra(`/api/spectra/imports?${query.toString()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: blob,
    }),
  );
}

export async function completeArtifactImport(input: {
  jobId: string;
  typeKey: SpectraBlueprintKey;
  status: "imported" | "quarantined" | "failed";
  fidelityReport: Array<{
    scope: string;
    level: "exact" | "adapted" | "unsupported";
    message: string;
  }>;
  unsupportedFeatures: string[];
  quarantineReason?: string;
  importedContent?: unknown;
}) {
  return readJson<{
    ok: true;
    jobId: string;
    status: "imported" | "awaiting_commit" | "quarantined" | "failed";
    versionId?: string;
    reused?: boolean;
    importJobId?: string;
    artifactId?: string;
    commitReceipt?: string | null;
    receipt?: SpectraArtifactCommitReceipt | null;
    commitDeferred?: boolean;
  }>(
    await requestSpectra("/api/spectra/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete", ...input }),
    }),
  );
}

export async function abortArtifactImportUpload(jobId: string, reason: string) {
  return readJson<{ ok: true; aborted: boolean }>(
    await requestSpectra("/api/spectra/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "abort", jobId, reason }),
    }),
  );
}

export async function getArtifactImports(artifactId: string) {
  const query = new URLSearchParams({ artifactId });
  return readJson<{ ok: true; imports: SpectraArtifactImport[] }>(
    await requestSpectra(`/api/spectra/imports?${query.toString()}`, {
      cache: "no-store",
    }),
  );
}

export type SpectraArtifactAsset = {
  assetId: string;
  path?: string;
  name?: string;
  mediaType?: string;
  bytes?: number;
  sha256?: string;
  status: "active" | "quarantined" | "revoked" | "missing";
  quarantineReason?: string;
  downloadUrl?: string | null;
  createdAt?: number;
  revokedAt?: number;
};

export async function getArtifactAssets(
  artifactId: string,
  assetIds?: string[],
) {
  const query = new URLSearchParams({ artifactId });
  assetIds?.forEach((assetId) => query.append("assetId", assetId));
  return readJson<{ ok: true; assets: SpectraArtifactAsset[] }>(
    await requestSpectra(`/api/spectra/assets?${query.toString()}`, {
      cache: "no-store",
    }),
  );
}

export async function uploadArtifactAsset(input: {
  artifactId: string;
  path: string;
  name: string;
  mediaType: string;
  sha256: string;
  blob: Blob;
  uploadReceipt?: string;
}) {
  const query = new URLSearchParams({
    artifactId: input.artifactId,
    path: input.path,
    name: input.name,
    ...(input.uploadReceipt ? { uploadReceipt: input.uploadReceipt } : {}),
  });
  return readJson<{ ok: true; assetId: string; reused: boolean; uploadReceipt?: string; status?: string; storageId?: string }>(
    await requestSpectra(`/api/spectra/assets?${query.toString()}`, {
      method: "PUT",
      headers: {
        "Content-Type": input.mediaType,
        "X-Spectra-Sha256": input.sha256,
        "X-Spectra-Bytes": String(input.blob.size),
        ...(input.uploadReceipt ? { "X-Spectra-Upload-Receipt": input.uploadReceipt } : {}),
      },
      body: input.blob,
    }),
  );
}

export async function revokeArtifactAsset(assetId: string) {
  const query = new URLSearchParams({ assetId });
  return readJson<{ ok: true; revoked: boolean }>(
    await requestSpectra(`/api/spectra/assets?${query.toString()}`, {
      method: "DELETE",
    }),
  );
}

export function toArtifactCardView(
  artifact: SpectraArtifact,
): ArtifactCardView {
  const placements = artifact.placements ?? [];
  return {
    id: artifact._id,
    title: artifact.title,
    blueprintKey: artifact.blueprintKey,
    summary: artifact.summary ?? "No summary yet.",
    meta:
      placements.length > 0
        ? placements.map((placement) => placement.workspaceTitle).join(", ")
        : "General",
    placement:
      artifact.placementStatus ??
      (placements.length > 0 ? "workspace" : "inbox"),
    updatedAt: artifact.updatedAt,
    createdAt: artifact.createdAt,
    aiStateExpiresAt: artifact.aiStateExpiresAt,
    shared: artifact.isShared,
    accessLevel: artifact.accessLevel ?? undefined,
    accessExplanation:
      artifact.ownership === "shared"
        ? artifact.accessReason === "workspace_inheritance"
          ? `Access through ${placements.map((placement) => placement.workspaceTitle).join(", ") || "a workspace"}`
          : "Shared directly with you"
        : undefined,
    aiState:
      artifact.aiState === "edited" &&
      artifact.aiStateExpiresAt &&
      artifact.aiStateExpiresAt <= Date.now()
        ? undefined
        : artifact.aiState,
    aiProgress: artifact.aiProgress,
  };
}

export function workspaceItemToArtifactCardView(
  item: SpectraWorkspaceItem,
): ArtifactCardView | null {
  if (!item.artifact) return null;
  return {
    id: item.artifact._id,
    title: item.name,
    blueprintKey: item.artifact.blueprintKey,
    summary: item.artifact.summary ?? "No summary yet.",
    meta: "Workspace card",
    placement: "workspace",
    updatedAt: item.artifact.updatedAt,
    createdAt: item.artifact.createdAt,
    aiStateExpiresAt: item.artifact.aiStateExpiresAt,
    shared: item.artifact.isShared,
    accessLevel: item.artifact.accessLevel ?? undefined,
    accessExplanation:
      item.artifact.ownership === "shared"
        ? item.artifact.accessReason === "workspace_inheritance"
          ? "Access through this workspace"
          : "Shared directly with you"
        : undefined,
    aiState:
      item.artifact.aiState === "edited" &&
      item.artifact.aiStateExpiresAt &&
      item.artifact.aiStateExpiresAt <= Date.now()
        ? undefined
        : item.artifact.aiState,
    aiProgress: item.artifact.aiProgress,
  };
}

/**
 * Copy a work as the reader's own. With a workspace, the copy lands there when
 * the reader can add to it, or in their own workspace it shows inside; with a
 * folder node, right beside the original.
 */
export async function copySpectraArtifact(artifactId: string, place?: { workspaceId?: string; parentNodeId?: string }) {
  return postSpectra<{ artifactId: string }>({ action: "copyArtifact", artifactId, ...place });
}
