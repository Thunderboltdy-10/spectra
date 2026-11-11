import { traceEvent, traceSpan } from "@/features/spectra/ai/harness/run-trace";
import "server-only";
import { runLog } from "./run-log";

import { createHash, randomUUID } from "node:crypto";
import { HocuspocusProvider } from "@hocuspocus/provider";
import WebSocket from "ws";
import { framedWebSocket } from "../../../../shared/collaboration-framing.mjs";
import * as Y from "yjs";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { AiDurableAckGate } from "@/features/spectra/ai/ai-durable-ack";
import { applyAdmittedProviderUpdate, type AiBeforeCommit } from "./admitted-ai-update";
import { assertPreparedAiCommit, loadAdmittedAiUpdate, prepareCanonicalAiUpdate, retryCanonicalAiMutation, type NativeAiHead, type AiCanonicalBridge } from "./canonical-ai-update";
import { createCollaborationGatewayBridgeClient } from "../../../../scripts/collaboration-gateway-bridge-client.mjs";
import { commitPreparedNativeAiRequest, type NativeAiCommitWireRequest } from "@/lib/native-ai-commit-server";
import { durableFrontierHash } from "../../../../scripts/collaboration-canonical-room.mjs";
import { getConvexUrl } from "@/lib/env";
import {
  collaborationDocumentName,
  collaborationGatewayUrl,
  collaborationProtocolVersion,
  signCollaborationSession,
} from "@/lib/collaboration-token";
import {
  readArtifactYjsDocument,
  snapshotArtifactRegions,
  type ArtifactLiveValue,
  type ArtifactRegionSnapshot,
  type ArtifactYjsMutationPlan,
} from "@/features/spectra/collaboration/artifact-yjs-model";
import { buildArtifactLivePreviewBeats } from "@/features/spectra/collaboration/interaction-choreography";
import {
  beatsDuration,
  MAX_KEPT_PERFORMANCES,
  MAX_PERFORMANCE_BYTES,
  PERFORMANCE_FIELD,
  performancePatches,
  performanceSeed,
  readPerformances,
  tempoForBacklog,
  type AiPerformance,
} from "@/features/spectra/collaboration/performance";
import {
  ARTIFACT_TYPE_KEYS,
  type ArtifactTypeKey,
} from "@/features/spectra/artifacts/types";
import { validateArtifactContent } from "@/features/spectra/artifacts/registry";
import { applyAiArtifactContentPolicy, validateAiArtifactWriteContent } from "@/features/spectra/operations/artifact-write-content";
import { normalizeArtifactContent } from "@/features/spectra/ai/content-normalization";
import { refreshGeneratedArtifactSummary } from "@/features/spectra/operations/hollow-content";
import type { ActorIdentity as FabricActor } from "@/features/spectra/collaboration/interaction-model";
import {
  NATIVE_WORK_LIVE_META_MAP,
  planNativeArtifactYjsMutation,
  readNativeArtifactYjsDocument,
} from "@/features/spectra/work/models/yjs/native-artifact-model";
import { workYjsAdapter } from "@/features/spectra/work/models/yjs/registry";
import { workYjsOrigins } from "@/features/spectra/work/models/yjs/origins";
import { boundedRegionClaims, claimAcquireAction } from "../../../../shared/region-claim-policy";
import { realtimeProviderForWorkType } from "@/features/spectra/realtime/providers/provider-factory";
import { gateAiArtifactMutation } from "@/features/spectra/commands/office/operation-gate";
import { fidelityRegionMap } from "@/features/spectra/commands/office/fidelity-regions";
import type { CompatibilityProfile } from "@/features/spectra/commands/types";
import type { WorkType } from "@/features/spectra/work/registry";
import {
  capabilityById,
  capabilityForLocalId,
} from "@/features/spectra/capabilities/catalog";

import { deviceBaseline, deviceProjectionOf } from "../collaboration/device-work";
import { deviceRoomEndpoint, deviceStoreCall } from "@/lib/device-store";

type ArtifactRecord = {
  _id: string;
  blueprintKey: string;
  schemaVersion?: number;
  title: string;
  summary?: string;
  tags: string[];
  content: unknown;
  compatibilityProfile?: CompatibilityProfile;
  storageHome?: "device";
  storageStoreId?: string;
};

type ActorIdentity = {
  accountId: string;
  schoolId: string;
  name: string;
};

type CollaborationSession = {
  actor: ActorIdentity;
  artifact: ArtifactRecord;
  clientId: string;
  actorKind: "ai" | "human";
  documentName: string;
  token: string;
  url: string;
  providerKind: "hocuspocus";
  level: "read" | "modify";
  policyVersion: number;
  /** Kept on the person's computer: Bridge is the room. */
  device?: { protocols?: string[] };
};

type AiRealtimeProvider = {
  readonly document: Y.Doc;
  readonly synced: boolean;
  readonly isAuthenticated: boolean;
  readonly hasUnsyncedChanges: boolean;
  beginDurableTransaction?(): void;
  applyCommittedUpdate?(update: Uint8Array): void;
  awareness?: {
    getLocalState(): { user?: unknown } | null;
    getStates(): Map<unknown, { user?: unknown }>;
  };
  setAwarenessField(field: string, value: unknown): void;
  flushPendingUpdates(): void;
  subscribeState(listener: () => void): () => void;
  /** Work on a computer: says what it now holds and keeps a point to return to. */
  deviceCheckpoint?(input: { source: string; summary?: string; actor?: string; runId?: string; schemaVersion: number }): Promise<number | null>;
  destroy(): void;
};

class HocuspocusAiRealtimeProvider implements AiRealtimeProvider {
  private readonly durableAck = new AiDurableAckGate();
  private readonly checkpointWaiters = new Map<string, (versionId: number | null) => void>();

  constructor(readonly transport: HocuspocusProvider) {}

  deviceCheckpoint(input: { source: string; summary?: string; actor?: string; runId?: string; schemaVersion: number }) {
    const projection = deviceProjectionOf(this.document, input.schemaVersion);
    if (projection) this.transport.sendStateless(JSON.stringify({ type: "spectra.device_projection", projection }));
    const confirmationId = randomUUID();
    return new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        this.checkpointWaiters.delete(confirmationId);
        resolve(null);
      }, 3_000);
      this.checkpointWaiters.set(confirmationId, (versionId) => {
        clearTimeout(timer);
        resolve(versionId);
      });
      this.transport.sendStateless(JSON.stringify({
        type: "spectra.device_checkpoint",
        source: input.source,
        confirmationId,
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.actor ? { actor: input.actor } : {}),
        ...(input.runId ? { runId: input.runId } : {}),
      }));
    });
  }

  get document() {
    return this.transport.document;
  }

  get synced() {
    return this.transport.synced;
  }

  get isAuthenticated() {
    return this.transport.isAuthenticated;
  }

  get hasUnsyncedChanges() {
    return this.transport.hasUnsyncedChanges || this.durableAck.isDirty;
  }

  beginDurableTransaction() {
    this.durableAck.beginTransaction();
  }

  applyCommittedUpdate(update: Uint8Array) {
    // The sink already appended these exact bytes. Provider origin suppresses
    // a second authored upload while the refresh hint wakes other open peers.
    applyAdmittedProviderUpdate(this.transport, update, `admitted:${randomUUID()}`);
  }

  handleStateless(payload: string) {
    try {
      const message = JSON.parse(payload) as {
        type?: string;
        updateIds?: unknown;
        documentHash?: string;
        confirmationId?: string;
        versionId?: number;
      };
      if (message.type === "spectra.device_checkpoint_saved") {
        const waiting = message.confirmationId ? this.checkpointWaiters.get(message.confirmationId) : undefined;
        if (waiting) {
          this.checkpointWaiters.delete(message.confirmationId!);
          waiting(typeof message.versionId === "number" ? message.versionId : null);
        }
        return;
      }
      const updateIds = Array.isArray(message.updateIds)
        ? message.updateIds.filter(
            (value): value is string =>
              typeof value === "string" && value.length <= 400,
          )
        : [];
      if (message.type === "spectra.durable_ack" && message.documentHash) {
        const hash = createHash("sha256").update(Y.encodeStateAsUpdate(this.document)).digest("hex");
        if (hash === message.documentHash) this.durableAck.confirmCurrentDocument();
        return;
      }
      if (typeof message.type === "string")
        this.durableAck.handleGatewayMessage(message.type, updateIds);
    } catch {
      // Ignore malformed gateway metadata. The captured durability epoch still
      // prevents a false clean state before pending/ack arrive.
    }
  }

  get awareness() {
    return this.transport.awareness as AiRealtimeProvider["awareness"];
  }

  setAwarenessField(field: string, value: unknown) {
    this.transport.setAwarenessField(field, value);
  }

  flushPendingUpdates() {
    this.transport.flushPendingUpdates();
  }

  subscribeState(listener: () => void) {
    const awareness = this.transport.awareness;
    if (!awareness) return () => undefined;
    awareness.on("change", listener);
    return () => awareness.off("change", listener);
  }

  destroy() {
    this.transport.destroy();
  }
}

type AiConnectionObserver = {
  onOpen?: () => void;
  onStatus?: (status: string) => void;
  onAuthenticated?: () => void;
  onSynced?: () => void;
  onError?: (error: Error) => void;
};

async function createAiRealtimeProvider(params: {
  session: CollaborationSession;
  document: Y.Doc;
  observer?: AiConnectionObserver;
}): Promise<AiRealtimeProvider> {
  const { session, document, observer } = params;
  const providerBox: { current?: HocuspocusAiRealtimeProvider } = {};
  const deviceProtocols = session.device?.protocols;
  const socketClass = deviceProtocols
    ? class HubSocket extends WebSocket {
        constructor(url: string | URL) {
          super(url, deviceProtocols);
        }
      }
    : WebSocket;
  const rawProvider = new HocuspocusProvider({
    url: session.url,
    WebSocketPolyfill: framedWebSocket(socketClass),
    name: session.documentName,
    document,
    token: session.token,
    flushDelay: 40,
    onOpen: () => observer?.onOpen?.(),
    onStatus: ({ status }) => observer?.onStatus?.(status),
    onAuthenticated: () => observer?.onAuthenticated?.(),
    onSynced: () => observer?.onSynced?.(),
    onStateless: ({ payload }) => providerBox.current?.handleStateless(payload),
    onAuthenticationFailed: ({ reason }) =>
      observer?.onError?.(
        new Error(
          `AI_ARTIFACT_PERMISSION_REVOKED: ${reason || "Collaboration access was rejected."}`,
        ),
      ),
    onDisconnect: ({ event }) => {
      if (event.code === 4403)
        observer?.onError?.(
          new Error(
            `AI_ARTIFACT_PERMISSION_REVOKED: ${event.reason || "Access was removed."}`,
          ),
        );
      else if (!rawProvider.synced || rawProvider.hasUnsyncedChanges)
        observer?.onError?.(
          new Error(
            `AI_ARTIFACT_CONNECTION_CLOSED: The collaboration gateway closed before synchronization (${event.code}${event.reason ? `: ${event.reason}` : ""}).`,
          ),
        );
    },
  } as ConstructorParameters<typeof HocuspocusProvider>[0] & {
    WebSocketPolyfill: ReturnType<typeof framedWebSocket>;
  });
  providerBox.current = new HocuspocusAiRealtimeProvider(rawProvider);
  return providerBox.current;
}

/** When each run's hand is next free on an artifact, so its edits play in turn. */
const performanceClock = new Map<string, number>();

type RegionClaim = {
  claimId: string;
  status: "active" | "queued";
  leaseExpiresAt: number;
  conflict: null | {
    claimId: string;
    actorKind: "human" | "ai";
    regionId: string;
    leaseExpiresAt: number;
    queuePosition: number;
  };
};

export class AiArtifactRegionConflictError extends Error {
  readonly code = "AI_ARTIFACT_REGION_QUEUED";

  constructor(
    readonly claim: RegionClaim,
    readonly artifactId: string,
    readonly operationId: string,
    readonly clientId: string,
    readonly baseSnapshot?: ArtifactRegionSnapshot,
    readonly proposedSnapshot?: ArtifactRegionSnapshot,
  ) {
    super(
      `AI_ARTIFACT_REGION_QUEUED: ${claim.conflict?.regionId ?? "occupied region"}`,
    );
    this.name = "AiArtifactRegionConflictError";
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Native profile + fidelity the human workbar already uses. Replica fetch
 * failure must not invent PRESERVED refusals, so the fallback is spectra-native
 * with an empty region map — the same default a Spectra-owned file has.
 */
async function nativeGateContext(artifact: ArtifactRecord): Promise<{
  compatibilityProfile: CompatibilityProfile;
  fidelity: Record<string, "NATIVE" | "EQUIVALENT" | "PRESERVED" | "EXTENSION">;
}> {
  const profile = artifact.compatibilityProfile ?? "spectra-native";
  try {
    const truth = await convexQuery<
      { workId: string },
      { replicas?: Array<{ fidelityMap?: unknown }> } | null
    >("replicas:forWork", { workId: artifact._id });
    if (!truth) throw new Error("WORK_NOT_FOUND");
    const entries =
      truth.replicas?.flatMap((replica) => {
        const map = recordValue(replica.fidelityMap);
        return Array.isArray(map.entries)
          ? map.entries.map((entry) => recordValue(entry))
          : [];
      }) ?? [];
    return {
      compatibilityProfile: profile,
      fidelity: fidelityRegionMap(entries),
    };
  } catch {
    return {
      compatibilityProfile: profile,
      fidelity: { artifact: "NATIVE" },
    };
  }
}

function requireArtifactType(value: string): ArtifactTypeKey {
  if (!(ARTIFACT_TYPE_KEYS as readonly string[]).includes(value)) {
    throw new Error(`ARTIFACT_TYPE_UNSUPPORTED: ${value}`);
  }
  return value as ArtifactTypeKey;
}

function choreographyForOperations(
  typeKey: ArtifactTypeKey,
  operations?: string[],
) {
  if (!operations?.length) return undefined;
  for (const operation of operations) {
    const definition =
      capabilityById(operation) ??
      capabilityForLocalId(typeKey as WorkType, operation);
    if (definition?.choreography) return definition.choreography;
  }
  return undefined;
}

function readLiveYjsDocument(document: Y.Doc, typeKey: ArtifactTypeKey) {
  return (
    readNativeArtifactYjsDocument(document, typeKey) ??
    readArtifactYjsDocument(document, typeKey)
  );
}

function planLiveYjsMutation(
  document: Y.Doc,
  typeKey: ArtifactTypeKey,
  value: ArtifactLiveValue,
) {
  return planNativeArtifactYjsMutation(document, typeKey, value, {
    clientId: "spectra-ai-runtime",
    kind: "ai",
    name: "Spectra AI",
  });
}

function stateVectorHash(document: Y.Doc) {
  return createHash("sha256")
    .update(Y.encodeStateVector(document))
    .digest("base64url");
}

// Dense native models can take seconds to project/validate. Let socket messages
// and lease heartbeats run between stages instead of blocking them for a whole
// read/validate/plan/rebase pipeline.
const yieldForCollaboration = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function createCollaborationSession(
  artifactId: string,
  clientId: string,
  level: "read" | "modify" = "modify",
  actorKind: "ai" | "human" = "ai",
): Promise<CollaborationSession> {
  const [actor, artifact] = await Promise.all([
    convexQuery<Record<string, never>, ActorIdentity | null>("identity:me", {}),
    convexQuery<{ artifactId: string }, ArtifactRecord>(
      "spectraArtifacts:get",
      { artifactId },
    ),
  ]);
  if (!actor)
    throw new Error(
      "AUTH_NOT_SIGNED_IN: The AI worker no longer has an authenticated owner.",
    );
  const typeKey = requireArtifactType(artifact.blueprintKey);
  const resourceType = typeKey === "agent" ? "agent" : "artifact";
  if (artifact.storageHome === "device") {
    const access = await convexQuery<
      { resourceType: string; resourceId: string },
      { allowed: boolean; level: "read" | "modify" | null }
    >("authority:access", { resourceType, resourceId: artifactId });
    if (!access.allowed || (level === "modify" && access.level !== "modify"))
      throw new Error("AI_ARTIFACT_PERMISSION_REVOKED: Access was removed before the live document could be loaded.");
    const summary = await deviceStoreCall<{ storeId?: string }>(actor.accountId, "summary", {}, 4_000).catch(() => null);
    if (!summary)
      throw new Error("DEVICE_WORK_UNAVAILABLE: This artifact is kept on the person's computer, and Spectra Bridge isn't reachable right now.");
    if (summary.storeId !== artifact.storageStoreId)
      throw new Error("DEVICE_WORK_ELSEWHERE: This artifact is kept on another of the person's computers, which isn't reachable from here.");
    const baseline = deviceBaseline({
      typeKey,
      title: artifact.title,
      summary: artifact.summary,
      tags: artifact.tags,
      schemaVersion: artifact.schemaVersion ?? 1,
      content: artifact.content,
    });
    await deviceStoreCall(actor.accountId, "seed", {
      artifactId,
      stateBase64: baseline.stateBase64,
      projection: baseline.projection,
    });
    const endpoint = await deviceRoomEndpoint(actor.accountId);
    return {
      actor,
      artifact,
      clientId,
      actorKind,
      documentName: collaborationDocumentName(artifactId, "root", artifact.blueprintKey),
      token: endpoint.token,
      providerKind: realtimeProviderForWorkType(typeKey),
      level,
      policyVersion: 0,
      url: endpoint.url,
      device: { ...(endpoint.protocols ? { protocols: endpoint.protocols } : {}) },
    };
  }
  const [room, access] = await Promise.all([
    convexMutation<
      { artifactId: string; partitionKey: string; schemaVersion: number },
      { roomId: string; policyVersion: number; schemaVersion: number }
    >("collaboration:ensureRoom", {
      artifactId,
      partitionKey: "root",
      schemaVersion: artifact.schemaVersion ?? 1,
    }),
    convexQuery<
      { resourceType: string; resourceId: string },
      { allowed: boolean; level: "read" | "modify" | null }
    >("authority:access", { resourceType, resourceId: artifactId }),
  ]);
  const allowed =
    access.allowed &&
    (level === "read"
      ? access.level === "read" || access.level === "modify"
      : access.level === "modify");
  if (!allowed) {
    throw new Error(
      level === "read"
        ? "AI_ARTIFACT_PERMISSION_REVOKED: Read access was removed before the live document could be loaded."
        : "AI_ARTIFACT_PERMISSION_REVOKED: Modify access was removed before the operation committed.",
    );
  }
  const documentName = collaborationDocumentName(
    artifactId,
    "root",
    artifact.blueprintKey,
  );
  const token = await signCollaborationSession({
    artifactId,
    roomId: room.roomId,
    partitionKey: "root",
    documentName,
    accountId: actor.accountId,
    schoolId: actor.schoolId,
    clientId,
    // The gateway appends owner attribution for AI awareness. Keep the token's
    // authenticated display name as the owner so it never becomes
    // "Pablo's AI's AI" after sanitization.
    displayName: actor.name.trim() || "Spectra",
    level,
    policyVersion: room.policyVersion,
    schemaVersion: room.schemaVersion ?? artifact.schemaVersion ?? 1,
    protocolVersion: collaborationProtocolVersion(),
    permissionEpoch: room.policyVersion,
    actorKind,
    access: level === "modify" ? "edit" : "read_only",
    internalCapabilities:
      level === "modify"
        ? ["view", "edit", "interact", "ai_mutate"]
        : ["view", "interact"],
  });
  const providerKind = realtimeProviderForWorkType(typeKey);
  return {
    actor,
    artifact,
    clientId,
    actorKind,
    documentName,
    token,
    providerKind,
    level,
    policyVersion: room.policyVersion,
    url: collaborationGatewayUrl(),
  };
}

function waitUntil(
  predicate: () => boolean,
  getError: () => Error | null,
  timeoutMs: number,
  timeoutMessage: string | (() => string),
) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      const error = getError();
      if (error) return reject(error);
      if (predicate()) return resolve();
      if (Date.now() - startedAt >= timeoutMs) {
        return reject(
          new Error(
            typeof timeoutMessage === "function"
              ? timeoutMessage()
              : timeoutMessage,
          ),
        );
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

async function releaseClaims(
  claims: RegionClaim[],
  clientId: string,
  resolution: "apply" | "cancel",
) {
  for (const claim of [...claims].reverse()) {
    await convexMutation<
      { claimId: string; clientId: string; resolution: "apply" | "cancel" },
      unknown
    >("regionClaims:release", {
      claimId: claim.claimId,
      clientId,
      resolution,
    }).catch(() => undefined);
  }
}

function abortError(signal?: AbortSignal) {
  if (!signal?.aborted) return null;
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The AI run was stopped.", "AbortError");
}

/** Prefer stable block ids + line scopes so TipTap can ink the live bullet. */
function normalizeStagedDocumentPath(
  path: string,
  streamValue: ArtifactLiveValue,
  lineIndex: number,
) {
  const match = path.match(/^(\/blocks\/)([^/]+)(\/.*)?$/i);
  if (!match) return path;
  const [, prefix, rawId, rest = ""] = match;
  let blockId = decodeURIComponent(rawId!);
  if (/^\d+$/.test(blockId)) {
    const blocks = (
      streamValue.content as { blocks?: Array<{ id?: unknown }> } | undefined
    )?.blocks;
    const indexed = Array.isArray(blocks) ? blocks[Number(blockId)] : undefined;
    if (indexed && typeof indexed.id === "string") blockId = indexed.id;
  }
  const lineSuffix =
    Number.isFinite(lineIndex) && lineIndex >= 0
      ? `/lines/${Math.floor(lineIndex)}`
      : "";
  if (rest.startsWith("/lines/")) return `${prefix}${blockId}${rest}`;
  if (rest === "/text" || rest.startsWith("/text"))
    return `${prefix}${blockId}${lineSuffix}`;
  return `${prefix}${blockId}${rest || lineSuffix}`;
}

async function acquirePlanClaims(params: {
  artifactId: string;
  clientId: string;
  runId: string;
  operationId: string;
  claimActorKind?: "ai" | "human";
  baseStateVectorHash: string;
  plan: ArtifactYjsMutationPlan;
  signal?: AbortSignal;
  onConflict?: (conflict: {
    regionId: string;
    queuePosition: number;
    actorKind: "human" | "ai";
  }) => void | Promise<void>;
  onConflictResolved?: () => void | Promise<void>;
  baseSnapshot?: ArtifactRegionSnapshot;
  proposedSnapshot?: ArtifactRegionSnapshot;
}) {
  const claims: RegionClaim[] = [];
  const claimActorKind = params.claimActorKind ?? "ai";
  for (const region of boundedRegionClaims(params.plan.regions)) {
    let notified = false;
    for (;;) {
      const aborted = abortError(params.signal);
      if (aborted) {
        await releaseClaims(claims, params.clientId, "cancel");
        throw aborted;
      }
      const claim = await convexMutation<
        {
          artifactId: string;
          partitionKey: string;
          clientId: string;
          regionId: string;
          overlapDomains: string[];
          baseStateVectorHash: string;
          actorKind: "ai" | "human";
          runId?: string;
          operationId?: string;
        },
        RegionClaim
      >("regionClaims:acquire", {
        artifactId: params.artifactId,
        partitionKey: "root",
        clientId: params.clientId,
        regionId: region.regionId,
        overlapDomains: region.overlapDomains,
        baseStateVectorHash: params.baseStateVectorHash,
        actorKind: claimActorKind,
        // Human restore is user-initiated after the run finished. AI claims
        // require a live run plus a real spectraOperations id; synthetic
        // `revert:` ids fail validation and completed runs fail the running
        // check. Omit both so acquire does not impersonate an active operation.
        ...(claimActorKind === "ai"
          ? { runId: params.runId, operationId: params.operationId }
          : {}),
      });
      const action = claimAcquireAction(claim.status);
      if (action === "apply") {
        if (notified) await params.onConflictResolved?.();
        claims.push(claim);
        break;
      }
      if (action === "refuse") {
        await releaseClaims([...claims, claim], params.clientId, "cancel");
        throw new AiArtifactRegionConflictError(
          claim,
          params.artifactId,
          params.operationId,
          params.clientId,
          params.baseSnapshot,
          params.proposedSnapshot,
        );
      }
      // Keep the queued lease. Cancelling it lets a second AI re-acquire as
      // active and apply a stale plan, which forks the paragraph.
      if (!notified) {
        await params.onConflict?.({
          regionId: claim.conflict?.regionId ?? region.regionId,
          queuePosition: claim.conflict?.queuePosition ?? 1,
          actorKind: claim.conflict?.actorKind ?? "human",
        });
        notified = true;
      }
      const waitMs = Math.min(
        1_600,
        280 + (claim.conflict?.queuePosition ?? 1) * 180,
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, waitMs);
        const onAbort = () => {
          clearTimeout(timer);
          reject(
            abortError(params.signal) ??
              new DOMException("Aborted", "AbortError"),
          );
        };
        if (params.signal?.aborted) {
          onAbort();
          return;
        }
        params.signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
  }
  return claims;
}

function humanHeldRegions(provider: AiRealtimeProvider): Set<string> {
  const held = new Set<string>();
  for (const state of provider.awareness?.getStates().values() ?? []) {
    const user =
      state?.user && typeof state.user === "object"
        ? (state.user as Record<string, unknown>)
        : null;
    const interaction =
      user?.interactionState &&
      typeof user.interactionState === "object" &&
      !Array.isArray(user.interactionState)
        ? (user.interactionState as Record<string, unknown>)
        : null;
    const actor =
      interaction?.actor &&
      typeof interaction.actor === "object" &&
      !Array.isArray(interaction.actor)
        ? (interaction.actor as Record<string, unknown>)
        : null;
    const act =
      interaction?.act &&
      typeof interaction.act === "object" &&
      !Array.isArray(interaction.act)
        ? (interaction.act as Record<string, unknown>)
        : null;
    const lifecycle = interaction?.lifecycle;
    if (
      actor?.kind !== "human" ||
      act?.kind === "idle" ||
      act?.kind === "hover" ||
      lifecycle === "idle" ||
      lifecycle === "completed" ||
      lifecycle === "settled" ||
      lifecycle === "failed" ||
      lifecycle === "cancelled"
    )
      continue;
    for (const regionId of Array.isArray(interaction?.heldRegionIds)
      ? interaction.heldRegionIds
      : []) {
      if (typeof regionId === "string" && regionId) held.add(regionId);
    }
  }
  return held;
}

async function waitForHumanRegions(params: {
  provider: AiRealtimeProvider;
  plan: ArtifactYjsMutationPlan;
  signal?: AbortSignal;
  onConflict?: (conflict: {
    regionId: string;
    queuePosition: number;
    actorKind: "human" | "ai";
  }) => void | Promise<void>;
  onConflictResolved?: () => void | Promise<void>;
}) {
  const requested = new Set(
    params.plan.regions.map((region) => region.regionId),
  );
  const firstHeld = () =>
    [...humanHeldRegions(params.provider)].find((regionId) =>
      requested.has(regionId),
    );
  let occupied = firstHeld();
  if (!occupied) return;
  await params.onConflict?.({
    regionId: occupied,
    queuePosition: 1,
    actorKind: "human",
  });
  await new Promise<void>((resolve, reject) => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      unsubscribe();
      params.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const evaluate = () => {
      occupied = firstHeld();
      if (occupied) {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        return;
      }
      if (idleTimer) return;
      // The short idle threshold is deliberately a single debounce after the
      // release event. It is not a polling loop and lets a finishing human
      // transaction/blur settle before semantic target re-resolution.
      idleTimer = setTimeout(() => finish(), 1_200);
    };
    const onAbort = () =>
      finish(
        abortError(params.signal) ?? new DOMException("Aborted", "AbortError"),
      );
    const unsubscribe = params.provider.subscribeState(evaluate);
    params.signal?.addEventListener("abort", onAbort, { once: true });
    evaluate();
  });
  await params.onConflictResolved?.();
}

async function synchronizeMutation(params: {
  document: Y.Doc;
  provider: AiRealtimeProvider;
  session: CollaborationSession;
  runId: string;
  executionId: string;
  operationId: string;
  claimActorKind?: "ai" | "human";
  plan: ArtifactYjsMutationPlan;
  desired: ArtifactLiveValue;
  streamBase?: ArtifactLiveValue;
  /** What the edit is about, so the hand reaches for the right control first. */
  choreography?: { target: string; region?: string };
  getConnectionError: () => Error | null;
  signal?: AbortSignal;
  onConflict?: (conflict: {
    regionId: string;
    queuePosition: number;
    actorKind: "human" | "ai";
  }) => void | Promise<void>;
  onConflictResolved?: () => void | Promise<void>;
  baseSnapshot?: ArtifactRegionSnapshot;
  proposedSnapshot?: ArtifactRegionSnapshot;
  beforeCommit?: AiBeforeCommit;
  nativeHead?: NativeAiHead;
  canonicalBridge?: AiCanonicalBridge;
  /** Resolve this operation against the fenced durable base when no native
   * package fixes the result; the admitted delta is prepared from that base. */
  admittedDesired?: (fencedBase: ArtifactLiveValue) => ArtifactLiveValue;
  /**
   * Re-read the live model after a human-held target becomes free. A queued
   * operation may have waited through several collaborator transactions; its
   * visible performance and conflict snapshots must start from that new truth,
   * not from the value that existed when the model response first arrived.
   */
  rebaseAfterHumanWait?: () => Promise<{
    plan: ArtifactYjsMutationPlan;
    desired: ArtifactLiveValue;
    streamBase: ArtifactLiveValue;
    baseSnapshot: ArtifactRegionSnapshot;
    proposedSnapshot: ArtifactRegionSnapshot;
  } | undefined>;
}) {
  const logPhase = (phase: string, detail: Record<string, unknown> = {}) =>
    runLog().info("spectra.ai.artifact.phase", {
      phase,
      artifactId: params.session.artifact._id,
      runId: params.runId,
      operationId: params.operationId,
      synced: params.provider.synced,
      hasUnsyncedChanges: params.provider.hasUnsyncedChanges,
      ...detail,
    });
  let plan = params.plan;
  let desired = params.desired;
  let streamBase = params.streamBase;
  let baseSnapshot = params.baseSnapshot;
  let proposedSnapshot = params.proposedSnapshot;
  if (plan.regions.length === 0) return { changedRegionIds: [] as string[] };
  const presence = params.provider.awareness?.getLocalState()?.user;
  const presenceRecord =
    presence && typeof presence === "object"
      ? (presence as Record<string, unknown>)
      : {};
  /**
   * The AI's fabric identity. Owner attribution travels with every frame so a
   * peer never has to guess whose AI is editing, and so the AI inherits its
   * owner's presence colour instead of a separate "robot" palette.
   */
  const ownerName = params.session.actor.name.trim();
  const claimActorKind = params.claimActorKind ?? "ai";
  const fabricActor: FabricActor = {
    clientId: params.session.clientId,
    kind: claimActorKind,
    name:
      claimActorKind === "human"
        ? ownerName || "You"
        : ownerName
          ? `${ownerName}'s AI`
          : "Spectra AI",
    ...(claimActorKind === "ai"
      ? {
          ownerAccountId: params.session.actor.accountId,
          ...(ownerName ? { ownerName } : {}),
          runId: params.runId,
          operationId: params.operationId,
        }
      : { accountId: params.session.actor.accountId }),
  };
  const fabricTypeKey = requireArtifactType(
    params.session.artifact.blueprintKey,
  );
  const startingRegionId = plan.regions[0]?.regionId;
  params.provider.setAwarenessField("user", {
    ...presenceRecord,
    ...(startingRegionId
      ? {
          activeRegionId: startingRegionId,
          activeRegionIds: [startingRegionId],
        }
      : {}),
  });
  // Provisional human work is already real collaboration state even though it
  // has not produced a Yjs transaction yet. Respect that exact semantic region
  // before acquiring durable claims, otherwise AI can commit underneath a
  // collaborator's local draft and later announce a result their blur erases.
  // User-initiated restore must not queue behind the same viewer's caret.
  if (claimActorKind !== "human") {
    await waitForHumanRegions({
      provider: params.provider,
      plan,
      signal: params.signal,
      onConflict: params.onConflict,
      onConflictResolved: params.onConflictResolved,
    });
  }
  const rebased = await params.rebaseAfterHumanWait?.();
  if (rebased) {
    plan = rebased.plan;
    desired = rebased.desired;
    streamBase = rebased.streamBase;
    baseSnapshot = rebased.baseSnapshot;
    proposedSnapshot = rebased.proposedSnapshot;
  }
  if (plan.regions.length === 0) {
    return { changedRegionIds: [] as string[] };
  }
  const authoredFrontier = durableFrontierHash(params.document);
  // Every AI write holds its regions, alone or not: the room append checks
  // them and takes the run's attribution from them.
  const heldRegions = [...boundedRegionClaims(plan.regions)];
  // On a computer nobody else can be editing at the same time from elsewhere,
  // and Yjs merges the person's own typing.
  const claims = params.session.device ? [] : await acquirePlanClaims({
    artifactId: params.session.artifact._id,
    clientId: params.session.clientId,
    runId: params.runId,
    operationId: params.operationId,
    claimActorKind,
    baseStateVectorHash: stateVectorHash(params.document),
    plan,
    signal: params.signal,
    onConflict: params.onConflict,
    onConflictResolved: params.onConflictResolved,
    baseSnapshot,
    proposedSnapshot,
  });
  const afterClaimWait = await params.rebaseAfterHumanWait?.();
  if (afterClaimWait) {
    plan = afterClaimWait.plan;
    desired = afterClaimWait.desired;
    streamBase = afterClaimWait.streamBase;
    baseSnapshot = afterClaimWait.baseSnapshot;
    proposedSnapshot = afterClaimWait.proposedSnapshot;
  }
  logPhase("claims-acquired", { regionCount: plan.regions.length });
  let renewing = true;
  const renewal = setInterval(() => {
    if (!renewing) return;
    for (const claim of claims) {
      void convexMutation<
        { claimId: string; clientId: string; baseStateVectorHash: string },
        unknown
      >("regionClaims:renew", {
        claimId: claim.claimId,
        clientId: params.session.clientId,
        baseStateVectorHash: stateVectorHash(params.document),
      }).catch(() => undefined);
    }
  }, 12_000);
  const clearStreamingPresence = () => {
    const settledPresence = params.provider.awareness?.getLocalState()?.user;
    const settledRecord =
      settledPresence && typeof settledPresence === "object"
        ? (settledPresence as Record<string, unknown>)
        : {};
    const idlePresence = { ...settledRecord };
    delete idlePresence.previewPatches;
    delete idlePresence.previewSequence;
    delete idlePresence.previewPhase;
    delete idlePresence.previewGesture;
    delete idlePresence.activeRegionId;
    delete idlePresence.activeRegionIds;
    delete idlePresence.cursor;
    delete idlePresence.selection;
    delete idlePresence.interaction;
    delete idlePresence.menu;
    delete idlePresence.interactionState;
    params.provider.setAwarenessField("user", idlePresence);
  };
  let publishedPerformanceId: string | undefined;
  let publishedPerformance: AiPerformance | undefined;
  try {
    // One performance per edit. Viewers expand it locally into the hand's
    // gestures; the durable write never waits for the animation.
    if (claimActorKind === "ai" && streamBase) {
      const { before, after } = performancePatches(streamBase, desired);
      publishedPerformanceId = `${params.operationId}:${params.executionId}`;
      if (after.length) {
        const clockKey = `${params.session.artifact._id}:${params.runId}`;
        const now = Date.now();
        const startAt = Math.max(now + 60, performanceClock.get(clockKey) ?? 0);
        const tempo = tempoForBacklog(startAt - now);
        const seed = performanceSeed(params.operationId);
        const beats = buildArtifactLivePreviewBeats(streamBase, desired, params.choreography, { seed, tempo });
        const estimateMs = beatsDuration(beats);
        const performance: AiPerformance = {
          v: 1,
          id: publishedPerformanceId,
          runId: params.runId,
          operationId: params.operationId,
          artifactId: params.session.artifact._id,
          typeKey: fabricTypeKey,
          actor: fabricActor,
          regionIds: plan.regions.map((region) => region.regionId),
          startAt,
          estimateMs,
          seed,
          tempo,
          ...(params.choreography ? { choreography: params.choreography } : {}),
          before,
          after,
        };
        if (JSON.stringify(performance).length <= MAX_PERFORMANCE_BYTES) {
          publishedPerformance = performance;
          performanceClock.set(clockKey, startAt + estimateMs + 300);
          if (performanceClock.size > 200) performanceClock.delete(performanceClock.keys().next().value!);
          const current = params.provider.awareness?.getLocalState()?.user;
          const record = current && typeof current === "object" ? (current as Record<string, unknown>) : {};
          const kept = readPerformances(record).filter((entry) => entry.startAt + entry.estimateMs > now);
          params.provider.setAwarenessField("user", {
            ...record,
            [PERFORMANCE_FIELD]: [...kept, performance].slice(-MAX_KEPT_PERFORMANCES),
          });
        }
        logPhase("performance-published", { beatCount: beats.length, estimateMs, tempo });
      }
      // The thread's "updating" ledger: which places this edit touches. It
      // moves the artifact's updatedAt, so it lands before the head below is
      // read, or the commit would see its own marker as a newer write.
      const stagedPaths = [...new Set(after.map((patch) =>
        normalizeStagedDocumentPath(patch.path.startsWith("/content/") ? patch.path.slice("/content".length) : patch.path, desired, 0),
      ))].slice(0, 32);
      if (stagedPaths.length) {
        await convexMutation("spectraArtifacts:stageAiPatch", {
          artifactId: params.session.artifact._id,
          runId: params.runId,
          executionId: params.executionId,
          title: desired.title,
          ...(desired.summary !== undefined ? { summary: desired.summary } : {}),
          tags: desired.tags,
          changedPaths: stagedPaths,
        }).catch(() => undefined);
      }
    }
    let preparedResult: Awaited<ReturnType<typeof prepareCanonicalAiUpdate>> | undefined;
    let preparation: Promise<Awaited<ReturnType<typeof prepareCanonicalAiUpdate>>> | undefined;
    let finalHead = params.nativeHead;
    if (finalHead) {
      const fresh = await convexQuery<{ artifactId: string; aiOperation: { runId: string; executionId: string; operationId: string } }, NativeAiHead>(
        "nativeAiCommit:head", { artifactId: params.session.artifact._id, aiOperation: {
          runId: params.runId, executionId: params.executionId, operationId: params.operationId,
        } });
      // A native package is prepared for one exact base. Without one, the
      // operation is resolved against whatever fenced base admission reads.
      if (fresh.committedResult || fresh.operationDigest !== finalHead.operationDigest ||
          (params.beforeCommit && (fresh.sourceContentIdentity !== finalHead.sourceContentIdentity ||
          fresh.room?._id !== finalHead.room?._id || fresh.room?.nextSequence !== finalHead.room?.nextSequence)))
        throw new Error("AI_NATIVE_CANONICAL_STALE");
      // Preview metadata changes updatedAt without changing authored content.
      finalHead = fresh;
    }
    const prepareAdmittedUpdate = async (normalizedDesired: ArtifactLiveValue | ((fencedBase: ArtifactLiveValue) => ArtifactLiveValue)) => {
      if (!finalHead || !params.canonicalBridge || !params.provider.applyCommittedUpdate)
        throw new Error("AI_NATIVE_ADMISSION_UNAVAILABLE");
      if (preparation) throw new Error("AI_NATIVE_UPDATE_ALREADY_PREPARED");
      preparation = prepareCanonicalAiUpdate({ head: finalHead, bridge: params.canonicalBridge,
        authoredFrontier, desired: normalizedDesired, clientId: params.session.clientId, operationId: params.operationId });
      preparedResult = await preparation;
      // An Office file's readback can touch more than the AI asked for (Excel
      // clears a formula's cached result). The append must hold every region
      // it writes, so the commit claims what the readback added.
      const holds = (regionId: string) => heldRegions.some((region) =>
        region.regionId === "artifact:structure" || region.overlapDomains.includes("artifact:structure") ||
        region.regionId === regionId || region.overlapDomains.includes(regionId));
      const extra = (preparedResult.prepared.append.regionIds ?? []).filter((regionId) => !holds(regionId));
      if (extra.length) {
        const added = await acquirePlanClaims({
          artifactId: params.session.artifact._id, clientId: params.session.clientId, runId: params.runId,
          operationId: params.operationId, claimActorKind, baseStateVectorHash: stateVectorHash(params.document),
          plan: { regions: extra.map((regionId) => ({ regionId, overlapDomains: [regionId] })), apply: () => undefined },
          signal: params.signal, onConflict: params.onConflict, onConflictResolved: params.onConflictResolved,
        });
        claims.push(...added);
        heldRegions.push(...extra.map((regionId) => ({ regionId, overlapDomains: [regionId] })));
      }
      return preparedResult.prepared;
    };
    let admitted = await params.beforeCommit?.({
      desired,
      changedRegionIds: plan.regions.map((region) => region.regionId),
      prepareAdmittedUpdate,
    });
    if (!admitted && finalHead && !preparation) {
      // No native package: the same single admission appends the exact delta,
      // AI history and operation receipt. The live socket never authors it.
      const prepared = await prepareAdmittedUpdate(params.admittedDesired ?? desired);
      const request = { ...prepared, requestDigest: "", aiOperation: { runId: params.runId,
        executionId: params.executionId, operationId: params.operationId } } as NativeAiCommitWireRequest;
      admitted = await commitPreparedNativeAiRequest(request);
    }
    let acceptedFrontier: { artifactId: string; runId: string; executionId: string; operationId: string;
      sequence: number; before: ArtifactLiveValue; after: ArtifactLiveValue } | undefined;
    if (admitted) {
      if (!params.canonicalBridge || !params.provider.applyCommittedUpdate) throw new Error("AI_NATIVE_ADMISSION_UNAVAILABLE");
      if (!admitted.duplicate) {
        if (!preparedResult) throw new Error("AI_ADMITTED_PREPARATION_MISMATCH");
        assertPreparedAiCommit(preparedResult.prepared, admitted);
      }
      const update = await loadAdmittedAiUpdate(admitted, params.canonicalBridge, {
        artifactId: params.session.artifact._id, accountId: params.session.actor.accountId, policyVersion: params.session.policyVersion,
      });
      params.provider.applyCommittedUpdate(update);
      if (!admitted.duplicate && preparedResult) acceptedFrontier = {
        artifactId: params.session.artifact._id, runId: params.runId, executionId: params.executionId,
        operationId: params.operationId, sequence: admitted.receipt.sequence,
        before: preparedResult.before, after: preparedResult.after,
      };
    } else {
      // A prepared candidate may never fall through to a second, unadmitted plan.
      if (preparation || finalHead) throw new Error("AI_NATIVE_COMMIT_RECEIPT_REQUIRED");
      params.provider.beginDurableTransaction?.();
      params.document.transact(plan.apply, { kind: "spectra-ai-operation", runId: params.runId, operationId: params.operationId });
    }
    logPhase("transaction-applied");
    params.provider.flushPendingUpdates();
    logPhase("updates-flushed");
    try {
      if (!admitted) {
        await waitUntil(
          () => params.provider.synced && !params.provider.hasUnsyncedChanges,
          () => abortError(params.signal) ?? params.getConnectionError(),
          12_000,
          "AI_ARTIFACT_CONNECTION_STALLED: The collaboration room did not confirm the live edit.",
        );
      }
    } catch (error) {
      const connection =
        abortError(params.signal) ?? params.getConnectionError();
      if (connection) throw connection;
      if (params.provider.synced && !params.provider.hasUnsyncedChanges) {
        logPhase("room-synced-after-flush", {
          hasUnsyncedChanges: params.provider.hasUnsyncedChanges,
        });
      } else {
        throw error;
      }
    }
    logPhase("provider-acknowledged");
    await releaseClaims(claims, params.session.clientId, "apply");
    logPhase("claims-released");
    return {
      changedRegionIds: plan.regions.map((region) => region.regionId),
      ...(acceptedFrontier ? { acceptedFrontier } : {}),
      ...(publishedPerformance ? { performance: publishedPerformance } : {}),
    };
  } catch (error) {
    logPhase("failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Viewers already playing this edit let go of it rather than finish it.
    if (publishedPerformanceId) {
      const current = params.provider.awareness?.getLocalState()?.user;
      const record = current && typeof current === "object" ? (current as Record<string, unknown>) : {};
      params.provider.setAwarenessField("user", {
        ...record,
        [PERFORMANCE_FIELD]: readPerformances(record).map((entry) =>
          entry.id === publishedPerformanceId ? { ...entry, withdrawn: true as const } : entry),
      });
    }
    await releaseClaims(claims, params.session.clientId, "cancel");
    throw error;
  } finally {
    renewing = false;
    clearInterval(renewal);
    clearStreamingPresence();
  }
}

/**
 * Read the synchronized collaborative Yjs document for an artifact.
 * Returns null when the room is uninitialized, unreachable, or invalid so
 * callers can fall back to the Convex baseline without failing the run.
 */
export async function readLiveArtifactValue(params: {
  artifactId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<ArtifactLiveValue | null> {
  const timeoutMs = Math.max(500, Math.min(params.timeoutMs ?? 4_000, 12_000));
  const aborted = abortError(params.signal);
  if (aborted) throw aborted;
  const clientId = `ai-read:${params.artifactId}:${randomUUID()}`.slice(0, 180);
  let session: CollaborationSession;
  try {
    session = await createCollaborationSession(
      params.artifactId,
      clientId,
      "read",
    );
  } catch {
    return null;
  }
  const typeKey = requireArtifactType(session.artifact.blueprintKey);
  const document = new Y.Doc();
  let connectionError: Error | null = null;
  let provider: AiRealtimeProvider;
  try {
    provider = await createAiRealtimeProvider({
      session,
      document,
      observer: { onError: (error) => (connectionError = error) },
    });
  } catch {
    document.destroy();
    return null;
  }
  try {
    await waitUntil(
      () => provider.synced && provider.isAuthenticated,
      () => abortError(params.signal) ?? connectionError,
      timeoutMs,
      () =>
        `AI_ARTIFACT_CONNECT_TIMEOUT: Live artifact read timed out after ${timeoutMs}ms.`,
    );
    try {
      return readLiveYjsDocument(document, typeKey);
    } catch {
      // Invalid / sparse live state — fall back to Convex baseline.
      return null;
    }
  } catch {
    return null;
  } finally {
    provider.destroy();
    document.destroy();
  }
}

/**
 * Deterministic per-type content policy applied to every AI write after
 * schema validation. For presentations, generated References slides are
 * rebuilt from actual slide citations by default. An explicit request to keep
 * an exact narrative slide count may instead retain verified citations in
 * native notes/metadata without adding a separate slide.
 */
async function applyAiArtifactMutationAttempt(params: {
  artifactId: string;
  runId: string;
  operationId: string;
  executionId: string;
  prompt?: string;
  /** User-initiated snapshot restore (Undo this run). Not an active AI op. */
  claimActorKind?: "ai" | "human";
  resolveDesired: (current: ArtifactLiveValue) => ArtifactLiveValue;
  signal?: AbortSignal;
  onConflict?: (conflict: {
    regionId: string;
    queuePosition: number;
    actorKind: "human" | "ai";
  }) => void | Promise<void>;
  onConflictResolved?: () => void | Promise<void>;
  collaborationClientId?: string;
  checkpointBeforeAi?: boolean;
  replacePendingCreate?: boolean;
  operations?: string[];
  beforeCommit?: AiBeforeCommit;
  /**
   * Durable proof of this write. Artifact create/update operations are
   * admitted with an operation write receipt. A live reference insertion
   * (an application command) is proven by its own placement receipt instead.
   */
  receipt?: "artifact-write" | "placement";
}) {
  // The browser client id identifies the owner/viewer, not the AI body. Reusing
  // it for the worker makes every observer with that id discard the AI cursor
  // as its own local presence. This is especially easy to trigger on queued
  // continuation, where the human id is deliberately carried into the resume
  // request. Keep attribution in `ownerAccountId`, but give every operation a
  // distinct collaboration transport identity.
  const ownerClientHint = params.collaborationClientId?.trim()
    ? `:${params.collaborationClientId.trim().slice(0, 36)}`
    : "";
  const claimActorKind = params.claimActorKind ?? "ai";
  const clientId = (
    claimActorKind === "human"
      ? `restore:${params.runId}:${randomUUID()}`
      : `ai:${params.runId}:${params.operationId}${ownerClientHint}:${randomUUID()}`
  ).slice(0, 180);
  const session = await createCollaborationSession(
    params.artifactId,
    clientId,
    "modify",
    claimActorKind,
  );
  const typeKey = requireArtifactType(session.artifact.blueprintKey);
  // Every AI artifact write is admitted once by the signed sink. The
  // Hocuspocus gateway room is that sink's canonical store.
  const onDevice = Boolean(session.device);
  const admitsArtifactWrite = !onDevice && claimActorKind === "ai" && params.receipt !== "placement";
  const readHead = () => convexQuery<{ artifactId: string; aiOperation: { runId: string; executionId: string; operationId: string } }, NativeAiHead>(
    "nativeAiCommit:head", { artifactId: params.artifactId, aiOperation: {
      runId: params.runId, executionId: params.executionId, operationId: params.operationId,
    } });
  let nativeHead = admitsArtifactWrite ? await readHead() : undefined;
  const canonicalBridge: AiCanonicalBridge | undefined = nativeHead
    ? createCollaborationGatewayBridgeClient({ convexUrl: getConvexUrl(), bridgeKey: process.env.SPECTRA_COLLAB_BRIDGE_KEY! }) : undefined;
  if (!onDevice && !params.replacePendingCreate && !nativeHead?.committedResult) {
    const native = await nativeGateContext(session.artifact);
    const gate = gateAiArtifactMutation({
      type: typeKey as WorkType,
      operations: params.operations,
      compatibilityProfile: native.compatibilityProfile,
      fidelity: native.fidelity,
    });
    if (!gate.allowed) {
      throw new Error(`AI_OPERATION_REFUSED: ${gate.reason}`);
    }
  }
  const document = new Y.Doc();
  let connectionError: Error | null = null;
  let connectionStatus = "initializing";
  let opened = false;
  let authenticated = false;
  let syncEventReceived = false;

  const provider = await createAiRealtimeProvider({
    session,
    document,
    observer: {
      onOpen: () => {
        opened = true;
      },
      onStatus: (status) => {
        connectionStatus = status;
      },
      onAuthenticated: () => {
        authenticated = true;
      },
      onSynced: () => {
        syncEventReceived = true;
      },
      onError: (error) => {
        connectionError = error;
      },
    },
  });
  const connectStartedAt = Date.now();
  try {
    await waitUntil(
      () => provider.synced && provider.isAuthenticated,
      () => abortError(params.signal) ?? connectionError,
      12_000,
      () =>
        `AI_ARTIFACT_CONNECT_TIMEOUT: The live artifact could not be synchronized within 12s (status=${connectionStatus}, opened=${opened}, authenticated=${authenticated || provider.isAuthenticated}, syncEvent=${syncEventReceived}, synced=${provider.synced}, elapsedMs=${Date.now() - connectStartedAt}). Fast-fail so pending shells can be discarded instead of pulsing indefinitely.`,
    );
    traceEvent("yjs.connect", { ms: Date.now() - connectStartedAt });
    runLog().info("spectra.ai.artifact.connect", {
      artifactId: params.artifactId,
      runId: params.runId,
      operationId: params.operationId,
      connectMs: Date.now() - connectStartedAt,
      status: connectionStatus,
      authenticated: authenticated || provider.isAuthenticated,
      synced: provider.synced,
    });
    if (nativeHead?.committedResult) {
      if (!canonicalBridge || !provider.applyCommittedUpdate) throw new Error("AI_NATIVE_ADMISSION_UNAVAILABLE");
      provider.applyCommittedUpdate(await loadAdmittedAiUpdate(nativeHead.committedResult, canonicalBridge, {
        artifactId: params.artifactId, accountId: session.actor.accountId, policyVersion: session.policyVersion,
      }));
      // Later replay state cannot attest this operation's original projection.
      return { artifactId: params.artifactId, changedRegionIds: [] as string[], duplicate: true };
    }
    const presenceName =
      claimActorKind === "human"
        ? session.actor.name.trim() || "You"
        : session.actor.name.trim()
          ? `${session.actor.name.trim()}'s AI`
          : "Spectra AI";
    // Arrive as present-but-idle. No cursor coordinate is published: before the
    // first operation envelope there is no control to point at, and inventing a
    // position is exactly how a decorative cursor ends up parked mid-canvas.
    provider.setAwarenessField("user", {
      clientId,
      accountId: session.actor.accountId,
      name: presenceName,
      displayName: presenceName,
      actorKind: claimActorKind,
      ...(claimActorKind === "ai"
        ? { runId: params.runId, operationId: params.operationId }
        : {}),
      interactionState: {
        v: 2 as const,
        actor: {
          clientId,
          kind: claimActorKind,
          name: presenceName,
          ownerAccountId: session.actor.accountId,
          ...(session.actor.name.trim()
            ? { ownerName: session.actor.name.trim() }
            : {}),
          ...(claimActorKind === "ai"
            ? { runId: params.runId, operationId: params.operationId }
            : {}),
        },
        act: { kind: "idle" as const },
        lifecycle: "queued" as const,
        target: null,
        at: Date.now(),
      },
    });

    // Awareness is a visible part of the operation, not disposable metadata.
    // Give the gateway one bounded paint window to fan out the AI collaborator
    // before a fast Yjs transaction can finish and tear down the provider.
    if (claimActorKind === "ai") {
      await traceSpan("yjs.ai_wait", {}, () => new Promise<void>((resolve) => setTimeout(resolve, 350)));
    }

    let current = readLiveYjsDocument(document, typeKey);
    await yieldForCollaboration();
    if (!current) {
      const baselineContent = normalizeArtifactContent(
        typeKey,
        session.artifact.content,
      );
      const baselineValidation = validateArtifactContent(
        typeKey,
        baselineContent,
      );
      if (!baselineValidation.success) {
        const issue = baselineValidation.error.issues[0];
        const path = issue?.path?.length ? issue.path.join(".") : "";
        const detail = issue?.message ?? "Pending artifact content is invalid.";
        throw new Error(
          path
            ? `AI_ARTIFACT_BASELINE_INVALID: Invalid input at ${path}: ${detail}`
            : `AI_ARTIFACT_BASELINE_INVALID: ${detail}`,
        );
      }
      const baseline: ArtifactLiveValue = {
        title: session.artifact.title,
        ...(session.artifact.summary
          ? { summary: session.artifact.summary }
          : {}),
        tags: session.artifact.tags,
        content: baselineValidation.data,
      };
      const baselinePlan = planLiveYjsMutation(document, typeKey, baseline);
      await synchronizeMutation({
        document,
        provider,
        session,
        runId: params.runId,
        executionId: params.executionId,
        operationId: params.operationId,
        claimActorKind,
        plan: baselinePlan,
        desired: baseline,
        getConnectionError: () => connectionError,
        signal: params.signal,
        onConflict: params.onConflict,
        onConflictResolved: params.onConflictResolved,
        baseSnapshot: snapshotArtifactRegions(
          typeKey,
          baseline,
          baselinePlan.regions.map((region) => region.regionId),
        ),
        proposedSnapshot: snapshotArtifactRegions(
          typeKey,
          baseline,
          baselinePlan.regions.map((region) => region.regionId),
        ),
      });
      current = readLiveYjsDocument(document, typeKey);
      // The baseline advanced the durable room this head described.
      if (nativeHead) nativeHead = await readHead();
    }
    if (!current)
      throw new Error(
        "AI_ARTIFACT_INITIALIZATION_FAILED: The live artifact model is unavailable.",
      );

    // A pending create may have been opened while the model was still
    // authoring. Its default projection is presentation scaffolding, never an
    // authored baseline. Another client can race the gateway bootstrap and
    // merge that placeholder into the room, so create operations must derive
    // the final value from their requested payload and replace the whole
    // pending structure atomically. Updates still rebase against live state.
    const pendingCreate = params.replacePendingCreate === true;

    const resolveValidatedValue = (
      base: ArtifactLiveValue,
    ): ArtifactLiveValue => {
      const desired = params.resolveDesired(base);
      const desiredContent = validateAiArtifactWriteContent(typeKey, desired.content);
      const nextSummary = refreshGeneratedArtifactSummary({
        blueprintKey: typeKey,
        title: desired.title.trim() || "Untitled artifact",
        content: desiredContent,
        currentSummary: base.summary,
        nextSummary: desired.summary,
      });
      return {
        title: desired.title.trim() || "Untitled artifact",
        ...(nextSummary ? { summary: nextSummary } : {}),
        tags: [
          ...new Set(desired.tags.map((tag) => tag.trim()).filter(Boolean)),
        ].slice(0, 80),
        content: applyAiArtifactContentPolicy(
          typeKey,
          desiredContent,
          params.prompt ?? "",
        ),
      };
    };
    const normalizedDesired = resolveValidatedValue(current);
    await yieldForCollaboration();
    const initialPlan = planLiveYjsMutation(
      document,
      typeKey,
      normalizedDesired,
    );
    await yieldForCollaboration();
    if (initialPlan.regions.length === 0)
      return {
        artifactId: params.artifactId,
        changedRegionIds: [] as string[],
      };

    if (onDevice) {
      if (params.checkpointBeforeAi !== false && !params.replacePendingCreate)
        await provider.deviceCheckpoint?.({
          source: claimActorKind === "human" ? "before_restore" : "before_ai",
          runId: params.runId,
          schemaVersion: session.artifact.schemaVersion ?? 1,
        });
    } else if (params.checkpointBeforeAi !== false && !nativeHead) {
      await convexMutation<
        { artifactId: string; runId: string; executionId: string },
        unknown
      >("changeGroups:checkpointBeforeAi", {
        artifactId: params.artifactId,
        runId: params.runId,
        executionId: params.executionId,
      });
    }
    // Claims are acquired inside synchronizeMutation. Re-resolve once against
    // the synchronized Y.Doc so a just-finished non-overlapping human edit is
    // preserved by field-level patch operations rather than overwritten from
    // an earlier database projection.
    let plannedStateVector = durableFrontierHash(document);
    const refreshed = readLiveYjsDocument(document, typeKey);
    await yieldForCollaboration();
    if (!refreshed) throw new Error("AI_ARTIFACT_LIVE_STATE_LOST");
    const refreshedValue = pendingCreate
      ? normalizedDesired
      : resolveValidatedValue(refreshed);
    await yieldForCollaboration();
    const refreshedPlan = pendingCreate
      ? {
          regions: [
            {
              regionId: "artifact:structure",
              overlapDomains: ["artifact:structure"],
            },
          ],
          apply: () => {
            const adapter = workYjsAdapter(typeKey);
            adapter.applyProjection(
              document,
              refreshedValue.content,
              workYjsOrigins({
                clientId: "spectra-ai-runtime",
                kind: "ai",
                name: "Spectra AI",
              }).ai,
            );
            const meta = document.getMap<unknown>(NATIVE_WORK_LIVE_META_MAP);
            meta.set("title", refreshedValue.title);
            meta.set("summary", refreshedValue.summary ?? "");
            meta.set("tags", [...refreshedValue.tags]);
          },
        }
      : planLiveYjsMutation(document, typeKey, refreshedValue);
    await yieldForCollaboration();
    const changedRegionIds = refreshedPlan.regions.map(
      (region) => region.regionId,
    );
    const baseSnapshot = snapshotArtifactRegions(typeKey, refreshed, changedRegionIds);
    await yieldForCollaboration();
    const proposedSnapshot = snapshotArtifactRegions(typeKey, refreshedValue, changedRegionIds);
    await yieldForCollaboration();
    const result = await synchronizeMutation({
      document,
      provider,
      session,
      runId: params.runId,
      executionId: params.executionId,
      operationId: params.operationId,
      claimActorKind,
      plan: refreshedPlan,
      desired: refreshedValue,
      streamBase: refreshed,
      choreography: choreographyForOperations(typeKey, params.operations),
      getConnectionError: () => connectionError,
      signal: params.signal,
      onConflict: params.onConflict,
      onConflictResolved: params.onConflictResolved,
      beforeCommit: params.beforeCommit,
      nativeHead,
      canonicalBridge,
      admittedDesired: pendingCreate ? () => normalizedDesired : resolveValidatedValue,
      baseSnapshot,
      proposedSnapshot,
      rebaseAfterHumanWait: async () => {
        const nextStateVector = durableFrontierHash(document);
        if (nextStateVector === plannedStateVector) return undefined;
        plannedStateVector = nextStateVector;
        const liveBase = readLiveYjsDocument(document, typeKey);
        await yieldForCollaboration();
        if (!liveBase) throw new Error("AI_ARTIFACT_LIVE_STATE_LOST");
        if (pendingCreate) {
          return {
            plan: refreshedPlan,
            desired: normalizedDesired,
            streamBase: liveBase,
            baseSnapshot: snapshotArtifactRegions(typeKey, liveBase, [
              "artifact:structure",
            ]),
            proposedSnapshot: snapshotArtifactRegions(
              typeKey,
              normalizedDesired,
              ["artifact:structure"],
            ),
          };
        }
        const liveDesired = resolveValidatedValue(liveBase);
        await yieldForCollaboration();
        const livePlan = planLiveYjsMutation(document, typeKey, liveDesired);
        await yieldForCollaboration();
        const liveRegionIds = livePlan.regions.map((region) => region.regionId);
        return {
          plan: livePlan,
          desired: liveDesired,
          streamBase: liveBase,
          baseSnapshot: snapshotArtifactRegions(
            typeKey,
            liveBase,
            liveRegionIds,
          ),
          proposedSnapshot: snapshotArtifactRegions(
            typeKey,
            liveDesired,
            liveRegionIds,
          ),
        };
      },
    });
    if (onDevice)
      await provider.deviceCheckpoint?.({
        source: claimActorKind === "human" ? "restore" : "ai",
        runId: params.runId,
        ...(claimActorKind === "ai" ? { actor: "Spectra" } : {}),
        schemaVersion: session.artifact.schemaVersion ?? 1,
      });
    return { artifactId: params.artifactId, ...result };
  } finally {
    const lastPresence = provider.awareness?.getLocalState()?.user;
    if (lastPresence && typeof lastPresence === "object") {
      const idle = { ...(lastPresence as Record<string, unknown>) };
      delete idle.previewPatches;
      delete idle.previewSequence;
      delete idle.previewPhase;
      delete idle.previewGesture;
      delete idle.activeRegionId;
      delete idle.activeRegionIds;
      delete idle.selection;
      delete idle.interaction;
      delete idle.menu;
      delete idle.cursor;
      provider.setAwarenessField("user", idle);
    }
    provider.destroy();
    document.destroy();
  }
}

export async function applyAiArtifactMutation(params: Parameters<typeof applyAiArtifactMutationAttempt>[0]) {
  return retryCanonicalAiMutation(() => applyAiArtifactMutationAttempt(params), params.signal);
}
