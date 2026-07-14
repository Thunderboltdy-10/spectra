import type { ArtifactTypeKey } from "../artifacts/types";
import type { ArtifactCardView } from "../components/artifact-card";

export type SpectraBlueprintKey = ArtifactTypeKey | "thread_reference";

export type SpectraWorkspace = {
  _id: string;
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  status: "active" | "archived";
  defaultView: "cards" | "canvas" | "timeline" | "library";
  aiState?: "creating" | "updating" | "edited" | "failed";
  aiRunId?: string;
  aiStateExpiresAt?: number;
  aiPreview?: { title?: string; description?: string; icon?: string; color?: string; startedAt: number };
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  ownership?: "owned" | "shared";
  accessLevel?: "read" | "modify" | null;
  accessReason?: string;
  isShared?: boolean;
  sharedWithCount?: number;
};

export type SpectraArtifact = {
  _id: string;
  blueprintKey: SpectraBlueprintKey;
  title: string;
  summary?: string;
  content?: unknown;
  tags: string[];
  status: "active" | "draft" | "archived" | "deleted";
  aiState?: "creating" | "updating" | "edited" | "failed";
  aiRunId?: string;
  aiProgress?: number;
  aiStateExpiresAt?: number;
  aiPreview?: { title?: string; summary?: string; content?: unknown; tags?: string[]; changedPaths?: string[]; startedAt: number };
  createdAt: number;
  updatedAt: number;
  placements?: Array<{
    workspaceId: string;
    workspaceTitle: string;
    workspaceItemId: string;
    pinned?: boolean;
  }>;
  placementStatus?: "inbox" | "shared" | "workspace";
  ownership?: "owned" | "shared";
  accessLevel?: "read" | "modify" | null;
  accessReason?: string;
  isShared?: boolean;
  sharedWithCount?: number;
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
  relationType: "related" | "supports" | "contradicts" | "source_for" | "generated_from" | "follow_up" | "belongs_with";
  label?: string;
  explanation?: string;
  createdBy: "user" | "ai" | "system";
  workspaceId?: string;
  direction: "incoming" | "outgoing";
  artifact: { id: string; title: string; summary?: string; blueprintKey: SpectraBlueprintKey; updatedAt: number } | null;
  createdAt: number;
  updatedAt: number;
};

export type SpectraArtifactVersion = {
  _id: string;
  artifactId: string;
  source: "manual" | "ai" | "revert" | "import" | "restore" | "migration" | "checkpoint";
  runId?: string;
  before: { title: string; summary?: string; content: unknown; tags: string[] };
  after: { title: string; summary?: string; content: unknown; tags: string[] };
  summary?: string;
  name?: string;
  stateVectorHash?: string;
  integrityHash?: string;
  changeGroupIds?: string[];
  creatorAccountIds?: string[];
  provenance?: { regionIds?: string[]; clientId?: string; source?: string };
  createdAt: number;
};

export type SpectraWorkspaceItem = {
  _id: string;
  workspaceId: string;
  sourceType: "artifact" | "thread" | "task" | "widget" | "custom";
  sourceId: string;
  viewData: {
    titleOverride?: string;
    compactSummary?: string;
    cardVariant?: string;
    pinned?: boolean;
    hidden?: boolean;
  };
  layout: {
    view: "cards" | "canvas" | "timeline";
    position?: { x: number; y: number };
    size?: { w: number; h: number };
    zIndex?: number;
    collapsed?: boolean;
  };
  artifact: SpectraArtifact | null;
  thread?: SpectraThread | null;
  createdAt: number;
  updatedAt: number;
};

export type SpectraRun = {
  _id: string;
  executionId?: string;
  status: "queued" | "running" | "awaiting_confirmation" | "awaiting_resolution" | "completed" | "failed" | "cancelled";
  phase?: "created" | "preparing" | "planning" | "reading" | "retrieving" | "creating" | "updating" | "applying" | "streaming" | "checking" | "approval" | "conflict" | "completed" | "stopped" | "interrupted" | "partial" | "failed";
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
  traceDegraded?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type SpectraThread = {
  _id: string;
  title: string;
  summaryShort?: string;
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
    focusMode?: "global" | "workspace" | "artifact" | "selection" | "thread";
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
  status: "proposed" | "executing" | "waiting" | "executed" | "failed" | "cancelled";
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
};

export type SpectraArtifactComment = {
  _id: string;
  artifactId: string;
  parentCommentId?: string;
  authorAccountId: string;
  author: { accountId: string; name: string; avatarUrl?: string } | null;
  body: string;
  anchor: {
    regionId: string;
    fallbackExcerpt?: string;
    geometry?: unknown;
  };
  mentionedAccountIds: string[];
  mentions: Array<{ accountId: string; name: string; avatarUrl?: string }>;
  status: "open" | "resolved" | "orphaned";
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
  artifact: { artifactId: string; title: string; blueprintKey: SpectraBlueprintKey };
  comment: { body: string; regionId: string };
  author: { accountId: string; name: string; avatarUrl?: string } | null;
};

export type SpectraArtifactEmbed = {
  embedId: string;
  containerType: "artifact" | "thread";
  containerId: string;
  containerRegionId: string;
  mode: "compact" | "expanded";
  interaction: "read" | "interact" | "edit";
  effectiveInteraction?: "read" | "interact" | "edit";
  versionPolicy: "live" | "pinned";
  contextPolicy: "none" | "summary" | "visible_region";
  displayPreferences?: Record<string, unknown>;
  state: "ready" | "no_access" | "deleted" | "archived" | "version_unavailable";
  canRequestAccess?: boolean;
  source?: {
    artifactId: string;
    title: string;
    summary?: string;
    blueprintKey: SpectraBlueprintKey;
    tags?: string[];
    updatedAt?: number;
    snapshot?: { title?: string; summary?: string; tags?: string[]; content?: unknown };
  };
  version?: { versionId: string; createdAt: number; summary?: string; name?: string };
  createdAt: number;
  updatedAt: number;
};

export type SpectraOverview = {
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
  account: { accountId: string; name: string; email: string; avatarUrl?: string } | null;
};

type JsonRecord = Record<string, unknown>;

const overviewCache = new Map<string, { value: SpectraOverview; cachedAt: number }>();
const workspaceCache = new Map<string, { value: SpectraOverview["workspace"]; cachedAt: number }>();
let workspacesCache: { value: SpectraWorkspace[]; cachedAt: number } | null = null;
const CACHE_TTL = 5 * 60_000;
const CACHE_LOCAL_ACTIONS = new Set([
  "acquireRegionClaim",
  "renewRegionClaim",
  "releaseRegionClaim",
  "resolveRegionConflict",
  "hideResultCard",
  "keepResultCard",
]);

export function peekSpectraWorkspace(workspaceId: string) {
  const cached = workspaceCache.get(workspaceId);
  return cached && Date.now() - cached.cachedAt < CACHE_TTL ? cached.value : null;
}

export function invalidateSpectraCache(scope?: { workspaceId?: string }) {
  overviewCache.clear();
  workspacesCache = null;
  if (scope?.workspaceId) workspaceCache.delete(scope.workspaceId);
  else workspaceCache.clear();
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as T | { error?: { message?: string } } | { error?: string } | null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? typeof payload.error === "string"
          ? payload.error
          : payload.error?.message
        : undefined;
    throw new Error(message || `Spectra request failed (${response.status})`);
  }
  return payload as T;
}

export async function getSpectraOverview(workspaceId?: string, force = false) {
  const key = workspaceId ?? "home";
  const cached = overviewCache.get(key);
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL) return cached.value;
  const params = new URLSearchParams({ action: "overview" });
  if (workspaceId) params.set("workspaceId", workspaceId);
  const value = await readJson<SpectraOverview>(await fetch(`/api/spectra?${params.toString()}`, { cache: "no-store" }));
  overviewCache.set(key, { value, cachedAt: Date.now() });
  if (workspaceId && value.workspace) workspaceCache.set(workspaceId, { value: value.workspace, cachedAt: Date.now() });
  return value;
}

export async function getSpectraWorkspace(workspaceId: string, force = false) {
  const cached = workspaceCache.get(workspaceId);
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL) return { workspace: cached.value };
  const qs = new URLSearchParams({ action: "workspace", workspaceId });
  const value = await readJson<{ workspace: SpectraOverview["workspace"] }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
  workspaceCache.set(workspaceId, { value: value.workspace, cachedAt: Date.now() });
  return value;
}

export async function getSpectraWorkspaces(force = false) {
  if (!force && workspacesCache && Date.now() - workspacesCache.cachedAt < CACHE_TTL) return workspacesCache.value;
  const value = await readJson<{ workspaces: SpectraWorkspace[] }>(await fetch("/api/spectra?action=workspaces", { cache: "no-store" }));
  workspacesCache = { value: value.workspaces, cachedAt: Date.now() };
  return value.workspaces;
}

export async function getSpectraArtifacts(params?: {
  placement?: "all" | "inbox" | "shared" | "workspace";
  blueprintKey?: SpectraBlueprintKey | "all";
  search?: string;
}) {
  const qs = new URLSearchParams({ action: "artifacts", placement: params?.placement ?? "all" });
  if (params?.blueprintKey && params.blueprintKey !== "all") qs.set("blueprintKey", params.blueprintKey);
  if (params?.search?.trim()) qs.set("search", params.search.trim());
  return readJson<{ artifacts: SpectraArtifact[] }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraArtifact(artifactId: string) {
  const qs = new URLSearchParams({ action: "artifact", artifactId });
  return readJson<{ artifact: SpectraArtifact }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function searchSpectra(query: string) {
  const qs = new URLSearchParams({ action: "search", search: query });
  return readJson<{ artifacts: SpectraArtifact[]; workspaces: SpectraWorkspace[] }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
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
  return readJson<{ resultCards: SpectraResultCard[] }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraRunDetail(runId: string) {
  const qs = new URLSearchParams({ action: "runDetail", runId });
  return readJson<SpectraRunDetail>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

const runTabsRequests = new Map<string, { at: number; promise: Promise<{ runTabs: SpectraRunTab[] }> }>();
const runEventRequests = new Map<string, { at: number; promise: Promise<{ events: SpectraRunEvent[] }> }>();

export async function getSpectraRunTabs(options: { includeHidden?: boolean; limit?: number } = {}) {
  const qs = new URLSearchParams({ action: "runTabs" });
  if (options.includeHidden) qs.set("includeHidden", "true");
  if (options.limit) qs.set("limit", String(options.limit));
  const key = qs.toString();
  const existing = runTabsRequests.get(key);
  if (existing && Date.now() - existing.at < 1_100) return existing.promise;
  const promise = fetch(`/api/spectra?${key}`, { cache: "no-store" }).then((response) => readJson<{ runTabs: SpectraRunTab[] }>(response));
  runTabsRequests.set(key, { at: Date.now(), promise });
  void promise.catch(() => { if (runTabsRequests.get(key)?.promise === promise) runTabsRequests.delete(key); });
  return promise;
}

export async function getSpectraShareInvitations() {
  return readJson<{ invitations: SpectraShareInvitation[] }>(await fetch("/api/spectra?action=shareInvitations", { cache: "no-store" }));
}

export async function searchSpectraSchoolMembers(search: string, limit = 20) {
  const qs = new URLSearchParams({ action: "schoolMembers", search, limit: String(limit) });
  return readJson<{ members: SpectraSchoolMember[] }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraShareState(resourceType: "workspace" | "artifact" | "agent", resourceId: string) {
  const qs = new URLSearchParams({ action: "shareState", resourceType, resourceId });
  return readJson<{ shares: SpectraShareEntry[] }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraRunEvents(runId: string, after = 0) {
  const qs = new URLSearchParams({ action: "runEvents", runId, after: String(after) });
  const key = qs.toString();
  const existing = runEventRequests.get(key);
  if (existing && Date.now() - existing.at < 850) return existing.promise;
  const promise = fetch(`/api/spectra?${key}`, { cache: "no-store" }).then((response) => readJson<{ events: SpectraRunEvent[] }>(response));
  runEventRequests.set(key, { at: Date.now(), promise });
  void promise.catch(() => { if (runEventRequests.get(key)?.promise === promise) runEventRequests.delete(key); });
  return promise;
}

export async function getSpectraOperationConflict(operationId: string) {
  const qs = new URLSearchParams({ action: "operationConflict", operationId });
  return readJson<{ conflict: {
    runId: string;
    executionId?: string;
    operationId: string;
    operationType: string;
    input: unknown;
    conflict: NonNullable<SpectraOperation["conflict"]>;
    claimStatus: "active" | "queued" | "paused" | "released" | "rejected";
    currentStateVectorHash: string;
    currentSnapshot: unknown;
  } }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function resolveSpectraOperationConflict(
  operationId: string,
  resolution: "apply" | "keep_current" | "merge" | "cancel",
  mergedInput?: unknown,
) {
  return postSpectra<{ runId: string; operationId: string; queued: boolean }>({
    action: "resolveAiArtifactConflict",
    operationId,
    resolution,
    ...(mergedInput !== undefined ? { mergedInput } : {}),
  });
}

export async function getSpectraArtifactVersions(artifactId: string, limit = 20) {
  const qs = new URLSearchParams({ action: "artifactVersions", artifactId, limit: String(limit) });
  return readJson<{ versions: SpectraArtifactVersion[] }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraArtifactComments(artifactId: string, includeResolved = false, limit = 200) {
  const qs = new URLSearchParams({
    action: "artifactComments",
    artifactId,
    includeResolved: String(includeResolved),
    limit: String(limit),
  });
  return readJson<{ comments: SpectraArtifactComment[] }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraArtifactCommentPreference(artifactId: string) {
  const qs = new URLSearchParams({ action: "artifactCommentPreference", artifactId });
  return readJson<{ mode: "all" | "mentions_replies" | "off" }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraArtifactCommentNotifications(unreadOnly = false, limit = 50) {
  const qs = new URLSearchParams({ action: "artifactCommentNotifications", unreadOnly: String(unreadOnly), limit: String(limit) });
  return readJson<{ notifications: SpectraArtifactCommentNotification[] }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraArtifactLinks(artifactId: string) {
  const qs = new URLSearchParams({ action: "artifactLinks", artifactId });
  return readJson<{ links: SpectraArtifactLink[] }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraArtifactEmbeds(containerType: "artifact" | "thread", containerId: string) {
  const qs = new URLSearchParams({ action: "artifactEmbeds", containerType, containerId });
  return readJson<{ embeds: SpectraArtifactEmbed[] }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraArtifactEmbed(embedId: string) {
  const qs = new URLSearchParams({ action: "artifactEmbed", embedId });
  return readJson<{ embed: SpectraArtifactEmbed }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraThreads(params?: { includeArchived?: boolean; limit?: number }) {
  const qs = new URLSearchParams({ action: "threads" });
  if (params?.includeArchived) qs.set("includeArchived", "true");
  if (params?.limit) qs.set("limit", String(params.limit));
  return readJson<{ threads: SpectraThread[] }>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function getSpectraThread(threadId: string) {
  const qs = new URLSearchParams({ action: "thread", threadId });
  return readJson<SpectraThreadDetail>(await fetch(`/api/spectra?${qs.toString()}`, { cache: "no-store" }));
}

export async function clearSpectraRunAgent(runId: string) {
  return readJson<{ cleared: boolean; threadId?: string }>(await fetch("/api/spectra/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "clear_agent", runId }),
  }));
}

export async function postSpectra<T>(body: JsonRecord) {
  const value = await readJson<T>(await fetch("/api/spectra", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  if (typeof body.action !== "string" || !CACHE_LOCAL_ACTIONS.has(body.action)) {
    invalidateSpectraCache({ workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : undefined });
  }
  if (typeof window !== "undefined" && typeof body.action === "string" && ["createWorkspace", "updateWorkspace", "deleteWorkspace"].includes(body.action)) {
    window.dispatchEvent(new Event("spectra:workspaces-changed"));
  }
  return value;
}

export function toArtifactCardView(artifact: SpectraArtifact): ArtifactCardView {
  const placements = artifact.placements ?? [];
  return {
    id: artifact._id,
    title: artifact.title,
    blueprintKey: artifact.blueprintKey,
    summary: artifact.summary ?? "No summary yet.",
    meta: placements.length > 0
      ? placements.map((placement) => placement.workspaceTitle).join(", ")
      : "Unplaced",
    placement: artifact.placementStatus ?? (placements.length > 0 ? "workspace" : "inbox"),
    shared: artifact.isShared,
    accessLevel: artifact.accessLevel ?? undefined,
    aiState: artifact.aiState === "edited" && artifact.aiStateExpiresAt && artifact.aiStateExpiresAt <= Date.now() ? undefined : artifact.aiState,
    aiProgress: artifact.aiProgress,
  };
}

export function workspaceItemToArtifactCardView(item: SpectraWorkspaceItem): ArtifactCardView | null {
  if (!item.artifact) return null;
  return {
    id: item.artifact._id,
    title: item.viewData.titleOverride ?? item.artifact.title,
    blueprintKey: item.artifact.blueprintKey,
    summary: item.viewData.compactSummary ?? item.artifact.summary ?? "No summary yet.",
    meta: "Workspace card",
    placement: "workspace",
  };
}
