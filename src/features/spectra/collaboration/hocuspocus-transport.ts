"use client";

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import * as Y from "yjs";
import { framedWebSocket } from "../../../../shared/collaboration-framing.mjs";
import { encodeDurableFrontier } from "../../../../shared/collaboration-durable-frontier.mjs";
import { readDurableRoomAnchor, recoveryRegionIds, type DurableRoomAnchor } from "../../../../shared/collaboration-recovery.mjs";
import type {
  AdmittedUpdateDescriptor,
  AdmittedUpdateReceipt,
  ArtifactCollaborationTransport,
  CollaborationPresence,
  DocumentStage,
  DocumentStageBlock,
  CollaborationSyncState,
  CollaborationTransportSnapshot,
  LocalRecoveryAncestry,
  RecoveryCurrent,
} from "./types";
import { readInteractionState } from "./interaction-model";
import { readPerformances } from "./performance";
import { committedPerformancesFor, subscribeCommittedPerformances } from "./committed-performances";
import { currentWorkSpeed } from "./work-speed";
import { PerformanceStage } from "./performance-stage";
import { readArtifactYjsDocument } from "./artifact-yjs-model";
import { readNativeArtifactYjsDocument } from "../work/models/yjs/native-artifact-model";
import { resolveDocumentRelativeSelection } from "../work/models/yjs/relative-position";
import { ScopedCollaborationSnapshots } from "./scoped-snapshots";
import { COLLAB_RECONNECT } from "./reconnect-backoff";
import { coalesceInFlight } from "@/lib/coalesce-inflight";
import {
  SYNC_RETRY_POLICY,
  syncRetryDelayMs,
} from "../../../../shared/sync-retry-policy";
import {
  collaborationAccessRevoked,
  collaborationNeedsSignIn,
} from "./auth-session";
import { requestSpectra } from "../data/request";
import { base64ToBytes, deviceProjectionOf, type DeviceSeed } from "./device-work";
import { enterDeviceRoom } from "../bridge/device-works";

type SessionResponse = {
  /** Kept on a computer: Bridge is the room, and this is what a new work starts from. */
  device?: { storeId: string; seed: DeviceSeed };
  token: string;
  documentName: string;
  provider: "self_hosted_yjs";
  url: string;
  expiresInMs: number;
  level: "read" | "modify";
  accountId: string;
  displayName: string;
};

/** How long typing settles before Bridge is told what the work now says. */
const DEVICE_PROJECTION_MS = 2_000;
/** Lists show when a work was last edited, to within this. */
const DEVICE_TOUCH_MS = 5 * 60_000;

function collaborationCursor(
  value: unknown,
): NonNullable<CollaborationPresence["cursor"]> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.x !== "number" ||
    !Number.isFinite(candidate.x) ||
    typeof candidate.y !== "number" ||
    !Number.isFinite(candidate.y)
  )
    return undefined;
  const rawAnchor =
    candidate.anchor && typeof candidate.anchor === "object"
      ? (candidate.anchor as Record<string, unknown>)
      : null;
  const anchorKind = rawAnchor?.kind;
  const anchorId = rawAnchor?.id;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const offsetX =
    typeof rawAnchor?.offsetX === "number" && Number.isFinite(rawAnchor.offsetX)
      ? clamp01(rawAnchor.offsetX)
      : typeof rawAnchor?.offset === "number" && Number.isFinite(rawAnchor.offset)
        ? clamp01(rawAnchor.offset)
        : undefined;
  const offsetY =
    typeof rawAnchor?.offsetY === "number" && Number.isFinite(rawAnchor.offsetY)
      ? clamp01(rawAnchor.offsetY)
      : undefined;
  const charOffset =
    typeof rawAnchor?.charOffset === "number" &&
    Number.isFinite(rawAnchor.charOffset)
      ? Math.max(0, Math.floor(rawAnchor.charOffset))
      : undefined;
  const lineIndex =
    typeof rawAnchor?.lineIndex === "number" &&
    Number.isFinite(rawAnchor.lineIndex)
      ? Math.max(0, Math.floor(rawAnchor.lineIndex))
      : undefined;
  const anchor =
    (anchorKind === "block" ||
      anchorKind === "address" ||
      anchorKind === "region" ||
      anchorKind === "path" ||
      anchorKind === "selector") &&
    typeof anchorId === "string" &&
    anchorId.trim()
      ? ({
          kind: anchorKind,
          id: anchorId.trim(),
          ...(offsetX !== undefined ? { offset: offsetX, offsetX } : {}),
          ...(offsetY !== undefined ? { offsetY } : {}),
          ...(charOffset !== undefined ? { charOffset } : {}),
          ...(lineIndex !== undefined ? { lineIndex } : {}),
        } satisfies NonNullable<CollaborationPresence["cursor"]>["anchor"])
      : undefined;
  const mode =
    candidate.mode === "pointer" ||
    candidate.mode === "typing" ||
    candidate.mode === "selecting"
      ? candidate.mode
      : undefined;
  const cursor: NonNullable<CollaborationPresence["cursor"]> = {
    x: candidate.x,
    y: candidate.y,
    ...(typeof candidate.updatedAt === "number" &&
    Number.isFinite(candidate.updatedAt)
      ? { updatedAt: candidate.updatedAt }
      : {}),
    ...(mode ? { mode } : {}),
    ...(anchor ? { anchor } : {}),
  };
  return cursor;
}

function documentStage(value: unknown): DocumentStage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<DocumentStage>;
  if (typeof candidate.operationId !== "string" || !Array.isArray(candidate.blocks)) return undefined;
  const blocks = candidate.blocks.filter(
    (block): block is DocumentStageBlock =>
      Boolean(block) &&
      typeof block.id === "string" &&
      (block.state === "pending" || block.state === "arriving" || block.state === "placed" ||
        (block.state === "writing" && typeof (block as { text?: unknown }).text === "string")),
  );
  const carry = candidate.carry;
  return {
    operationId: candidate.operationId,
    blocks,
    ...(carry && typeof carry.blockId === "string" && typeof carry.workId === "string" &&
    (carry.phase === "lift" || carry.phase === "fly" || carry.phase === "drop")
      ? { carry: { blockId: carry.blockId, workId: carry.workId, phase: carry.phase, ...(typeof carry.seamBlockId === "string" ? { seamBlockId: carry.seamBlockId } : {}), ...(typeof carry.flightMs === "number" ? { flightMs: carry.flightMs } : {}) } }
      : {}),
  };
}

function collaborationSelection(
  value: unknown,
): CollaborationPresence["selection"] | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== "text") return undefined;
  if (!Array.isArray(candidate.ranges)) return undefined;
  const relativeValue =
    candidate.relative && typeof candidate.relative === "object"
      ? (candidate.relative as Record<string, unknown>)
      : null;
  const relative =
    relativeValue &&
    typeof relativeValue.blockId === "string" &&
    relativeValue.anchor instanceof Uint8Array &&
    relativeValue.head instanceof Uint8Array
      ? {
          blockId: relativeValue.blockId,
          anchor: relativeValue.anchor,
          head: relativeValue.head,
        }
      : undefined;
  const ranges = candidate.ranges.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const range = entry as Record<string, unknown>;
    if (
      typeof range.blockId !== "string" ||
      !range.blockId.trim() ||
      typeof range.startOffset !== "number" ||
      typeof range.endOffset !== "number"
    )
      return [];
    const lineIndex =
      typeof range.lineIndex === "number" && Number.isFinite(range.lineIndex)
        ? Math.max(0, Math.floor(range.lineIndex))
        : undefined;
    return [
      {
        blockId: range.blockId.trim(),
        startOffset: Math.max(0, Math.floor(range.startOffset)),
        endOffset: Math.max(0, Math.floor(range.endOffset)),
        ...(lineIndex !== undefined ? { lineIndex } : {}),
      },
    ];
  });
  return {
    kind: "text",
    collapsed: Boolean(candidate.collapsed) || ranges.every(
      (range) => range.startOffset === range.endOffset,
    ),
    ...(typeof candidate.text === "string"
      ? { text: candidate.text.slice(0, 280) }
      : {}),
    ranges,
    ...(relative ? { relative } : {}),
  };
}

function clientIdentity(artifactId: string) {
  const key = `spectra.collaboration.client.${artifactId}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.sessionStorage.setItem(key, value);
  return value;
}

const collaborationSessionRequests = new Map<
  string,
  { at: number; promise: Promise<SessionResponse> }
>();

export function collaborationSessionRequestKey(
  artifactId: string,
  partitionKey: string,
  clientId: string,
  schemaVersion: number,
) {
  return `${artifactId}:${partitionKey}:${clientId}:${schemaVersion}`;
}

function roomClosed(message: string) {
  return /^COLLABORATION_(ROOM_CLOSED|SESSION_FORBIDDEN)\b/.test(message);
}

async function fetchCollaborationSession(
  artifactId: string,
  partitionKey: string,
  clientId: string,
  schemaVersion: number,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SYNC_RETRY_POLICY.collaborationConnectTimeoutMs);
  try {
    const response = await requestSpectra("/api/spectra/collaboration/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artifactId,
        partitionKey,
        clientId,
        schemaVersion,
        realtimeProvider: "hocuspocus",
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = (await response.json()) as
      | SessionResponse
      | { error?: string | { code?: string; message?: string } };
    if (!response.ok || !("token" in payload)) {
      const failure = "error" in payload ? payload.error : undefined;
      const error =
        typeof failure === "string"
          ? failure
          : failure?.code && failure.code !== "INTERNAL_ERROR"
            ? `${failure.code}: ${failure.message ?? ""}`
            : failure?.message;
      throw new Error(error || "Could not start collaboration.");
    }
    return payload.device ? await enterDeviceRoom(artifactId, payload) : payload;
  } catch (error) {
    if (timedOut) throw new Error("COLLABORATION_CONNECT_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function session(
  artifactId: string,
  partitionKey: string,
  clientId: string,
  schemaVersion: number,
) {
  return coalesceInFlight(
    collaborationSessionRequests,
    collaborationSessionRequestKey(
      artifactId,
      partitionKey,
      clientId,
      schemaVersion,
    ),
    1_100,
    () =>
      fetchCollaborationSession(
        artifactId,
        partitionKey,
        clientId,
        schemaVersion,
      ),
  );
}

export class HocuspocusArtifactTransport implements ArtifactCollaborationTransport {
  readonly document = new Y.Doc();
  readonly clientId: string;
  private provider: HocuspocusProvider | null = null;
  private websocketProvider: HocuspocusProviderWebsocket | null = null;
  // Handshake quarantine. The provider only ever sees `providerDocument`.
  // Local edits reach it immediately while the socket is synchronized; a
  // restored/offline branch stays in `document` until the gateway admits it
  // against its saved room anchor, so the initial Yjs handshake can neither
  // upload the draft nor overwrite it with newer native state.
  private providerDocument = new Y.Doc();
  private quarantined = false;
  private connectionStarted = false;
  private rebuildingProvider = false;
  private providerChangeVersion = 0;
  private authoredRegionIds: string[] = [];
  private recoveryCurrentRequests = new Map<string, { resolve: (value: RecoveryCurrent) => void;
    reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly snapshots = new ScopedCollaborationSnapshots();
  private state: CollaborationSyncState = "connecting";
  private level: "read" | "modify" | null = null;
  private accountId?: string;
  private displayName?: string;
  private providerUnsynchronizedChanges = 0;
  private durablePendingUpdateIds = new Set<string>();
  private localDurabilityPending = false;
  private localRecoveryPending = false;
  private localRecoveryDeliveryPending = false;
  private recoveryConfirmation: { id: string; changeVersion: number } | null = null;
  private recoveryConfirmationSequence = 0;
  private recoveryVectorRequest: string | null = null;
  private nativeConflict: CollaborationTransportSnapshot["recoveryConflict"];
  private durableAnchor: DurableRoomAnchor | undefined;
  private localChangeVersion = 0;
  private documentChangeVersion = 0;
  private durabilityEpoch = 0;
  private unsynchronizedChanges = 0;
  private presence: CollaborationPresence[] = [];
  private awarenessEntries: Array<{ clientId: number | string; user?: unknown }> = [];
  private readonly performanceStage = new PerformanceStage(
    (performance) =>
      readNativeArtifactYjsDocument(this.document, performance.typeKey) ??
      readArtifactYjsDocument(this.document, performance.typeKey),
    () => this.publishPresence(),
    undefined,
    currentWorkSpeed,
  );
  private readonly stopCommittedPerformances = subscribeCommittedPerformances(() => this.playCommittedPerformances());
  private playCommittedPerformances() {
    if (this.destroyed || !this.level) return;
    for (const performance of committedPerformancesFor(this.artifactId)) {
      const live = readNativeArtifactYjsDocument(this.document, performance.typeKey) ?? readArtifactYjsDocument(this.document, performance.typeKey);
      if (live) this.performanceStage.ingest([performance]);
    }
  }
  private presenceSignature = "[]";
  private localPresence: CollaborationPresence | null = null;
  private localPresenceSignature = "";
  private error?: string;
  private destroyed = false;
  private intentionallyDisconnected = false;
  private authorizationTimer?: number;
  private authorizationRefreshRunning = false;
  private connectionRetryTimer?: number;
  private connectionRetryAttempt = 0;
  private readonly onLocalDocumentUpdate = (
    update: Uint8Array,
    origin: unknown,
  ) => {
    this.documentChangeVersion += 1;
    this.playCommittedPerformances();
    this.scheduleDeviceProjection();
    this.localDurabilityPending = true;
    if (origin !== this.provider && this.connectionStarted) {
      if (!this.provider?.synced) {
        this.quarantined = true;
        this.localRecoveryPending = true;
      }
      const regionId = origin && typeof origin === "object" ? (origin as { regionId?: unknown }).regionId : undefined;
      this.authoredRegionIds = recoveryRegionIds([...this.authoredRegionIds,
        ...(typeof regionId === "string" ? regionId.split(",") : ["artifact:structure"])]);
      if (!this.quarantined) Y.applyUpdate(this.providerDocument, update, origin);
    }
    if (
      !origin ||
      typeof origin !== "object" ||
      (origin as { clientId?: unknown }).clientId !== this.clientId
    ) {
      this.updateSynchronizationState();
      return;
    }
    // Provider sync means the gateway accepted a Yjs frame, not that Convex
    // appended it. Mark locally-authored work pending before Hocuspocus can
    // report a transient clean state; the durable ack is the only exit.
    this.localDurabilityPending = true;
    this.localChangeVersion += 1;
    this.updateSynchronizationState();
  };

  constructor(
    private readonly artifactId: string,
    private readonly partitionKey = "root",
    private readonly schemaVersion = 1,
  ) {
    this.clientId = clientIdentity(artifactId);
    this.document.on("update", this.onLocalDocumentUpdate);
    this.providerDocument.on("update", this.onProviderDocumentUpdate);
  }

  private readonly onProviderDocumentUpdate = (update: Uint8Array, origin: unknown) => {
    this.providerChangeVersion += 1;
    if (!this.quarantined && origin === this.provider) Y.applyUpdate(this.document, update, this.provider);
  };

  /** Opens the quarantine after admission or a covering durable frontier.
   * Both merges use the provider origin: the draft was already delivered (or
   * is durable), so Hocuspocus must not upload it a second time. */
  private releaseQuarantine() {
    if (!this.quarantined) return;
    Y.applyUpdate(this.document, Y.encodeStateAsUpdate(this.providerDocument, Y.encodeStateVector(this.document)), this.provider);
    Y.applyUpdate(this.providerDocument, Y.encodeStateAsUpdate(this.document, Y.encodeStateVector(this.providerDocument)), this.provider);
    this.quarantined = false;
  }

  private rebuildProviderReplica() {
    if (this.destroyed || this.rebuildingProvider) return;
    this.rebuildingProvider = true;
    this.localRecoveryPending = true;
    this.quarantined = true;
    // The old replica may contain a sent but unacknowledged branch. Discard it
    // before it can run another handshake; the draft remains in `document`.
    this.websocketProvider?.disconnect();
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.provider?.destroy(); this.provider = null;
      this.websocketProvider?.destroy(); this.websocketProvider = null;
      this.providerDocument.off("update", this.onProviderDocumentUpdate);
      this.providerDocument.destroy(); this.providerDocument = new Y.Doc();
      this.providerDocument.on("update", this.onProviderDocumentUpdate);
      this.rebuildingProvider = false;
      if (!this.intentionallyDisconnected) this.scheduleConnectionRetry();
    });
  }

  restoreDurableAnchor(anchor: DurableRoomAnchor) {
    if (this.destroyed || this.durableAnchor) return;
    this.durableAnchor = readDurableRoomAnchor(anchor) ?? undefined;
  }

  getSnapshot = (): CollaborationTransportSnapshot =>
    this.snapshots.getSnapshot();
  getSyncSnapshot = this.snapshots.getSyncSnapshot;
  getPresenceSnapshot = this.snapshots.getPresenceSnapshot;
  getPresencePreviewSnapshot = this.snapshots.getPresencePreviewSnapshot;
  subscribe = this.snapshots.subscribe;
  subscribeSync = this.snapshots.subscribeSync;
  subscribePresence = this.snapshots.subscribePresence;
  subscribePresencePreview = this.snapshots.subscribePresencePreview;

  markLocalRecoveryPending(conflict?: CollaborationTransportSnapshot["recoveryConflict"], ancestry?: LocalRecoveryAncestry) {
    if (this.destroyed || this.localRecoveryPending) return;
    // Restored IndexedDB work is authored state even though its Yjs update
    // origin is LOCAL_PERSISTENCE_ORIGIN. Keep it pending until the gateway
    // confirms the complete merged document hash, never just socket sync.
    this.localRecoveryPending = true;
    this.quarantined = true;
    this.authoredRegionIds = recoveryRegionIds(ancestry?.authoredRegionIds ?? ["artifact:structure"]);
    this.durableAnchor = readDurableRoomAnchor(ancestry?.recoveryAnchor) ?? undefined;
    this.localDurabilityPending = true;
    if (conflict) {
      this.nativeConflict = conflict;
      this.update({ state: "unsynchronized", recoveryConflict: conflict,
        error: "A native edit changed the same part of this work. The local draft is preserved for review." });
      return;
    }
    this.updateSynchronizationState();
    this.sendLocalRecoveryUpdate();
  }

  private sendLocalRecoveryUpdate() {
    const provider = this.provider;
    if (
      !this.localRecoveryPending ||
      this.nativeConflict ||
      this.localRecoveryDeliveryPending ||
      !provider?.synced ||
      this.level === "read" ||
      this.state === "permission_lost" ||
      this.state === "closed"
    )
      return;
    this.localRecoveryDeliveryPending = true;
    try {
      // Ask for the committed causal base. A restored branch can contain a
      // tiny edit to a large artifact; its whole body need not be uploaded.
      this.recoveryVectorRequest = `vector:${++this.recoveryConfirmationSequence}`;
      provider.sendStateless(JSON.stringify({ type: "spectra.recovery_request", confirmationId: this.recoveryVectorRequest,
        recoveryAnchor: this.durableAnchor ?? null, regionIds: this.authoredRegionIds }));
    } catch {
      this.recoveryVectorRequest = null;
      this.localRecoveryDeliveryPending = false;
      this.updateSynchronizationState("Spectra could not request the saved baseline. Retry synchronization to recover the local draft.");
    }
  }

  private sendLocalRecoveryDelta(requestId: string, encodedVector: string) {
    const provider = this.provider;
    if (!provider?.synced || requestId !== this.recoveryVectorRequest || this.destroyed || this.level !== "modify") return;
    try {
      if (encodedVector.length > 180_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encodedVector)) throw new Error("COLLABORATION_RECOVERY_VECTOR_INVALID");
      const vector = Uint8Array.from(atob(encodedVector), character => character.charCodeAt(0));
      Y.decodeStateVector(vector);
      // encodeStateAsUpdate retains deletes and unresolved causal dependencies.
      // A genuinely large new branch uses the existing negotiated framing.
      const delta = Y.encodeStateAsUpdate(this.document, vector);
      provider.documentUpdateHandler(delta, {
        clientId: this.clientId,
        kind: "spectra-local-recovery",
      });
      this.recoveryVectorRequest = null;
      provider.flushPendingUpdates();
      // The gateway admitted this branch against its saved anchor. Later
      // edits flow normally; durability still requires a covering frontier.
      this.releaseQuarantine();
      this.requestDurableConfirmation();
    } catch {
      this.recoveryVectorRequest = null;
      this.recoveryConfirmation = null;
      this.localRecoveryDeliveryPending = false;
      this.updateSynchronizationState(
        "Spectra could not resend the locally saved draft yet. It will retry when the connection is available.",
      );
    }
  }

  private requestDurableConfirmation() {
    if (this.nativeConflict) return;
    if (!this.provider?.synced || this.recoveryConfirmation || !this.localDurabilityPending || this.destroyed) return;
    const confirmation = { id: `recovery:${++this.recoveryConfirmationSequence}`, changeVersion: this.localChangeVersion };
    this.recoveryConfirmation = confirmation;
    this.provider.sendStateless(JSON.stringify({ type: "spectra.durable_confirm", confirmationId: confirmation.id }));
  }

  private confirmDurableFrontier(confirmedHash: string, candidateAnchor?: unknown) {
    if (this.nativeConflict) return;
    if (!/^[a-f0-9]{64}$/.test(confirmedHash)) return;
    const candidate = this.quarantined ? new Y.Doc() : this.document;
    if (candidate !== this.document) {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.document));
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.providerDocument));
    }
    const frontier = encodeDurableFrontier(Y, candidate);
    if (candidate !== this.document) candidate.destroy();
    if (!frontier) return;
    const version = this.documentChangeVersion;
    const epoch = this.durabilityEpoch;
    const providerVersion = this.providerChangeVersion;
    void crypto.subtle.digest("SHA-256", new Uint8Array(frontier)).then(digest => {
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (this.destroyed || epoch !== this.durabilityEpoch || version !== this.documentChangeVersion ||
          providerVersion !== this.providerChangeVersion || hash !== confirmedHash) return;
      const anchor = readDurableRoomAnchor(candidateAnchor);
      if (anchor?.frontierHash === hash && (!this.durableAnchor || anchor.roomId !== this.durableAnchor.roomId ||
          anchor.nextSequence >= this.durableAnchor.nextSequence)) this.durableAnchor = anchor;
      // A covering durable frontier proves the room already has the whole
      // branch, so the quarantine may open in both directions.
      this.releaseQuarantine();
      this.authoredRegionIds = [];
      this.durablePendingUpdateIds.clear();
      this.localDurabilityPending = false;
      this.localRecoveryPending = false;
      this.localRecoveryDeliveryPending = false;
      this.recoveryConfirmation = null;
      this.updateSynchronizationState();
    }).catch(() => undefined);
  }

  /** Bridge says what it holds by state vector; nothing else has hashed it. */
  private confirmDeviceFrontier(vectorBase64: string) {
    if (this.destroyed || this.nativeConflict) return;
    const candidate = this.quarantined ? this.providerDocument : this.document;
    let vector: Map<number, number>;
    try { vector = Y.decodeStateVector(base64ToBytes(vectorBase64)); } catch { return; }
    for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(this.document)))
      if ((vector.get(client) ?? 0) < clock) return;
    if (candidate !== this.document) this.releaseQuarantine();
    this.authoredRegionIds = [];
    this.durablePendingUpdateIds.clear();
    this.localDurabilityPending = false;
    this.localRecoveryPending = false;
    this.localRecoveryDeliveryPending = false;
    this.recoveryConfirmation = null;
    this.updateSynchronizationState();
  }

  private onDevice = false;
  private deviceProjectionTimer: ReturnType<typeof setTimeout> | undefined;
  private deviceListing = "";
  private deviceTouchedAt = 0;

  private scheduleDeviceProjection() {
    if (!this.onDevice || this.deviceProjectionTimer !== undefined) return;
    this.deviceProjectionTimer = setTimeout(() => {
      this.deviceProjectionTimer = undefined;
      this.sendDeviceProjection();
    }, DEVICE_PROJECTION_MS);
  }

  /** Bridge searches and lists from what this says; the list here only needs the name. */
  private sendDeviceProjection() {
    const provider = this.provider;
    if (!provider?.synced) return this.scheduleDeviceProjection();
    const projection = deviceProjectionOf(this.document, this.schemaVersion);
    if (!projection) return;
    provider.sendStateless(JSON.stringify({ type: "spectra.device_projection", projection }));
    const listing = JSON.stringify([projection.title, projection.summary ?? "", projection.tags]);
    const now = Date.now();
    if (listing === this.deviceListing && now - this.deviceTouchedAt < DEVICE_TOUCH_MS) return;
    this.deviceListing = listing;
    this.deviceTouchedAt = now;
    void requestSpectra("/api/spectra", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "touchDeviceWork",
        artifactId: this.artifactId,
        title: projection.title,
        summary: projection.summary ?? "",
        tags: projection.tags,
        edited: true,
      }),
    }).catch(() => undefined);
  }

  private update(next: Partial<CollaborationTransportSnapshot>) {
    if (next.state) this.state = next.state;
    if (next.level !== undefined) this.level = next.level;
    if (next.accountId !== undefined) this.accountId = next.accountId;
    if (next.displayName !== undefined) this.displayName = next.displayName;
    if (next.unsynchronizedChanges !== undefined)
      this.unsynchronizedChanges = next.unsynchronizedChanges;
    if (next.presence) this.presence = next.presence;
    if ("error" in next) this.error = next.error;
    this.snapshots.apply({
      ...(this.nativeConflict ? { recoveryConflict: this.nativeConflict } : {}),
      ...(this.durableAnchor ? { durableAnchor: this.durableAnchor } : {}),
      state: this.state,
      level: this.level,
      ...(this.accountId ? { accountId: this.accountId } : {}),
      ...(this.displayName ? { displayName: this.displayName } : {}),
      unsynchronizedChanges: this.unsynchronizedChanges,
      ...(next.presence ? { presence: this.presence } : {}),
      ...(this.error ? { error: this.error } : {}),
    });
  }

  private updateSynchronizationState(error?: string) {
    const yjsPending =
      this.providerUnsynchronizedChanges +
      this.durablePendingUpdateIds.size +
      (this.localDurabilityPending ? 1 : 0);
    const terminal =
      this.state === "permission_lost" || this.state === "closed";
    const recoveryNeedsModifyAccess =
      this.localRecoveryPending && this.level === "read";
    this.update({
      unsynchronizedChanges: yjsPending,
      ...(error !== undefined ? { error } : {}),
      ...(terminal
        ? {}
        : recoveryNeedsModifyAccess
          ? {
              state: "unsynchronized",
              error: "Your locally saved edit needs modify access before it can sync.",
            }
        : {
            state:
              error !== undefined
                ? "unsynchronized"
                : yjsPending > 0
                  ? "synchronizing"
                  : this.provider?.synced
                    ? "synchronized"
                    : this.state,
          }),
    });
  }

  /** One awareness entry as presence. */
  private presenceFromEntry(entry: { clientId: number | string; user?: unknown }): CollaborationPresence {
    const user =
      entry.user && typeof entry.user === "object"
        ? (entry.user as Record<string, unknown>)
        : {};
    const clientId =
      typeof user.clientId === "string"
        ? user.clientId
        : String(entry.clientId);
    return {
      clientId,
      // Protocol v2 frame, when the peer publishes one. Everything
      // below is the superseded v1 shape kept for older peers.
      ...(readInteractionState(user.interactionState, clientId)
        ? {
            interactionState: readInteractionState(
              user.interactionState,
              clientId,
            ),
          }
        : {}),
      ...(typeof user.accountId === "string"
        ? { accountId: user.accountId }
        : {}),
      ...(typeof user.name === "string" ? { name: user.name } : {}),
      ...(typeof user.color === "string"
        ? { color: user.color }
        : {}),
      ...(user.actorKind === "ai" || user.actorKind === "human"
        ? { actorKind: user.actorKind as "ai" | "human" }
        : {}),
      ...(typeof user.runId === "string"
        ? { runId: user.runId }
        : {}),
      ...(typeof user.operationId === "string"
        ? { operationId: user.operationId }
        : {}),
      ...(typeof user.activeRegionId === "string"
        ? { activeRegionId: user.activeRegionId }
        : {}),
      ...(Array.isArray(user.activeRegionIds) &&
      user.activeRegionIds.every(
        (regionId) => typeof regionId === "string",
      )
        ? { activeRegionIds: user.activeRegionIds as string[] }
        : {}),
      ...(Array.isArray(user.previewPatches) &&
      user.previewPatches.every(
        (patch) =>
          patch &&
          typeof patch === "object" &&
          typeof (patch as { path?: unknown }).path === "string" &&
          "value" in patch,
      )
        ? {
            previewPatches: user.previewPatches as Array<{
              path: string;
              value: unknown;
            }>,
          }
        : {}),
      ...(Number.isInteger(user.previewSequence)
        ? { previewSequence: user.previewSequence as number }
        : {}),
      ...(user.previewPhase === "streaming"
        ? { previewPhase: "streaming" as const }
        : {}),
      ...(user.previewGesture === "erasing" ||
      user.previewGesture === "typing" ||
      user.previewGesture === "selecting"
        ? { previewGesture: user.previewGesture }
        : {}),
      ...(user.interaction &&
      typeof user.interaction === "object" &&
      typeof (user.interaction as { kind?: unknown }).kind ===
        "string"
        ? {
            interaction: user.interaction as CollaborationPresence["interaction"],
          }
        : {}),
      ...(collaborationCursor(user.cursor)
        ? { cursor: collaborationCursor(user.cursor) }
        : {}),
      ...(collaborationSelection(user.selection) !== undefined
        ? { selection: collaborationSelection(user.selection) }
        : {}),
      ...(user.menu &&
      typeof user.menu === "object" &&
      (user.menu as { open?: unknown }).open === true &&
      typeof (user.menu as { label?: unknown }).label === "string" &&
      Array.isArray((user.menu as { options?: unknown }).options)
        ? {
            menu: {
              open: true as const,
              label: String((user.menu as { label: string }).label),
              options: (
                (user.menu as { options: unknown[] }).options ?? []
              ).flatMap((option) => {
                if (!option || typeof option !== "object") return [];
                const entry = option as Record<string, unknown>;
                if (
                  typeof entry.value !== "string" ||
                  typeof entry.label !== "string"
                )
                  return [];
                return [
                  {
                    value: entry.value,
                    label: entry.label,
                  },
                ];
              }),
              ...(typeof (user.menu as { highlighted?: unknown })
                .highlighted === "string"
                ? {
                    highlighted: String(
                      (user.menu as { highlighted: string })
                        .highlighted,
                    ),
                  }
                : {}),
            },
          }
        : user.menu === null
          ? { menu: null }
          : {}),
      ...(user.viewport !== undefined
        ? { viewport: user.viewport }
        : {}),
      ...(documentStage(user.documentStage)
        ? { documentStage: documentStage(user.documentStage) }
        : {}),
    };
  }

  /**
   * Presence from the last awareness states, with each performing AI shown by
   * its local performance: the same record shape a live peer publishes.
   */
  private publishPresence() {
    const entries = this.awarenessEntries.map((entry) => {
      const user = entry.user && typeof entry.user === "object" ? (entry.user as Record<string, unknown>) : {};
      const clientId = typeof user.clientId === "string" ? user.clientId : String(entry.clientId);
      const performed = this.performanceStage.presence().get(clientId);
      return performed ? { clientId: entry.clientId, user: { ...user, ...performed } } : entry;
    });
    const listed = new Set(
      entries.map((entry) => {
        const user = entry.user as Record<string, unknown> | undefined;
        return typeof user?.clientId === "string" ? user.clientId : String(entry.clientId);
      }),
    );
    // The AI's connection may already be gone; its hand keeps going here.
    for (const [clientId, record] of this.performanceStage.presence())
      if (!listed.has(clientId)) entries.push({ clientId, user: record });
    const resolvedPresence = entries.map((entry) => this.resolveRelativePresence(this.presenceFromEntry(entry)));
    // Awareness callbacks rebuild wrapper objects. Compare one compact
    // array signature instead of stringifying both sides for every peer.
    const signature = JSON.stringify(resolvedPresence);
    if (signature !== this.presenceSignature) {
      this.presenceSignature = signature;
      this.update({ presence: resolvedPresence });
    }
  }

  private resolveRelativePresence(
    presence: CollaborationPresence,
  ): CollaborationPresence {
    const relative = presence.selection?.relative;
    if (!relative) return presence;
    const resolved = resolveDocumentRelativeSelection(this.document, relative);
    if (!resolved) return presence;
    return {
      ...presence,
      selection: {
        ...presence.selection,
        kind: "text",
        collapsed: resolved.anchor === resolved.head,
        ranges: [
          {
            blockId: resolved.blockId,
            startOffset: Math.min(resolved.anchor, resolved.head),
            endOffset: Math.max(resolved.anchor, resolved.head),
          },
        ],
      },
    };
  }

  private startAuthorizationWatch() {
    if (this.authorizationTimer !== undefined) return;
    this.authorizationTimer = window.setInterval(() => {
      // Read-only collaborators need an active recheck because an upgrade has
      // no edit message that would naturally force server reauthorization.
      // Keep the watch narrow so private and modify sessions create no polling
      // traffic during normal editing. A stuck permission_lost door is the
      // exception: a gateway restart can look like a revoke until the next
      // session proves the person still belongs in the room.
      const needsAccessRecheck =
        this.level === "read" ||
        this.level === null ||
        this.state === "permission_lost";
      if (
        this.destroyed ||
        this.intentionallyDisconnected ||
        !needsAccessRecheck ||
        this.authorizationRefreshRunning
      )
        return;
      this.authorizationRefreshRunning = true;
      void session(
        this.artifactId,
        this.partitionKey,
        this.clientId,
        this.schemaVersion,
      )
        .then((refreshed) => {
          if (
            this.destroyed ||
            (refreshed.level === this.level && this.state !== "permission_lost")
          )
            return;
          this.update({
            state: "reconnecting",
            level: refreshed.level,
            accountId: refreshed.accountId,
            displayName: refreshed.displayName,
            error: undefined,
          });
          // Reconnect so the gateway's connection-level readOnly flag is
          // rebuilt from the new token before the editor is unlocked.
          this.websocketProvider?.disconnect();
          void this.websocketProvider?.connect();
        })
        .catch((error) => {
          const reason =
            error instanceof Error ? error.message : "Access was removed.";
          if (this.destroyed) return;
          const revoked = collaborationAccessRevoked(reason);
          this.update({
            state: revoked ? "permission_lost" : "reconnecting",
            level: null,
            error: revoked
              ? reason
              : "COLLABORATION_AUTHORIZATION_UNAVAILABLE",
          });
          this.websocketProvider?.disconnect();
        })
        .finally(() => {
          this.authorizationRefreshRunning = false;
        });
    }, 2_000);
  }

  async connect() {
    if (this.destroyed || this.provider) return;
    this.connectionStarted = true;
    if (this.connectionRetryTimer !== undefined) {
      window.clearTimeout(this.connectionRetryTimer);
      this.connectionRetryTimer = undefined;
    }
    this.update({ state: "connecting", error: undefined });
    this.intentionallyDisconnected = false;
    try {
      const initial = await session(
        this.artifactId,
        this.partitionKey,
        this.clientId,
        this.schemaVersion,
      );
      // A route transition or HMR teardown can happen while the server session
      // is still being issued. Never resurrect a provider after its transport
      // has been destroyed; doing so creates an invisible reconnect/token loop.
      if (this.destroyed || this.intentionallyDisconnected) return;
      this.onDevice = Boolean(initial.device);
      this.update({
        level: initial.level,
        accountId: initial.accountId,
        displayName: initial.displayName,
      });
      this.playCommittedPerformances();
      const websocketProvider = new HocuspocusProviderWebsocket({
        WebSocketPolyfill: framedWebSocket(WebSocket),
        url: initial.url,
        autoConnect: false,
        delay: COLLAB_RECONNECT.delay,
        factor: COLLAB_RECONNECT.factor,
        minDelay: COLLAB_RECONNECT.minDelay,
        maxDelay: COLLAB_RECONNECT.maxDelay,
        jitter: COLLAB_RECONNECT.jitter,
        maxAttempts: COLLAB_RECONNECT.maxAttempts,
        initialDelay: COLLAB_RECONNECT.initialDelay,
      });
      const provider = new HocuspocusProvider({
        websocketProvider,
        name: initial.documentName,
        document: this.providerDocument,
        flushDelay: 180,
        token: async () => {
          if (this.destroyed) throw new Error("COLLABORATION_CLOSED");
          try {
            const refreshed = await session(
              this.artifactId,
              this.partitionKey,
              this.clientId,
              this.schemaVersion,
            );
            this.update({
              level: refreshed.level,
              accountId: refreshed.accountId,
              displayName: refreshed.displayName,
              error: undefined,
            });
            return refreshed.token;
          } catch (error) {
            const reason =
              error instanceof Error
                ? error.message
                : "Could not start collaboration.";
            if (roomClosed(reason)) {
              this.intentionallyDisconnected = true;
              this.websocketProvider?.disconnect();
              this.settleClosed();
              throw error;
            }
            this.update({
              state: collaborationNeedsSignIn(reason)
                ? "unsynchronized"
                : this.state === "connecting"
                  ? "connecting"
                  : "reconnecting",
              level: null,
              error: reason,
            });
            throw error;
          }
        },
        onStatus: ({ status }) => {
          if (status === "connected") {
            this.connectionRetryAttempt = 0;
            if (this.connectionRetryTimer !== undefined) {
              window.clearTimeout(this.connectionRetryTimer);
              this.connectionRetryTimer = undefined;
            }
            if (this.localPresence)
              this.provider?.setAwarenessField("user", this.localPresence);
            this.update({
              state: this.provider?.synced ? "synchronized" : "synchronizing",
            });
          } else if (
            !this.intentionallyDisconnected &&
            this.state !== "permission_lost" &&
            this.state !== "closed"
          )
            this.update({
              state:
                this.state === "connecting" ? "connecting" : "reconnecting",
            });
        },
        onSynced: ({ state }) => {
          if (this.provider !== provider) return;
          if (this.state === "permission_lost" || this.state === "closed")
            return;
          if (!state) {
            this.update({ state: "synchronizing" });
            return;
          }
          // Content restored before the provider existed (a clean cache) was
          // never offered to the room. If the room lacks any of it, treat it as
          // a branch that needs admission rather than silently diverging.
          if (!this.quarantined && !this.localRecoveryPending &&
              !Y.snapshotContainsUpdate(Y.snapshot(this.providerDocument), Y.encodeStateAsUpdate(this.document))) {
            this.quarantined = true;
            this.localRecoveryPending = true;
            this.localDurabilityPending = true;
            this.authoredRegionIds = recoveryRegionIds([...this.authoredRegionIds, "artifact:structure"]);
          }
          this.sendLocalRecoveryUpdate();
          this.requestDurableConfirmation();
          this.updateSynchronizationState();
          this.playCommittedPerformances();
        },
        onUnsyncedChanges: ({ number }) => {
          if (this.provider !== provider) return;
          this.providerUnsynchronizedChanges = number;
          this.updateSynchronizationState();
        },
        onAwarenessChange: ({ states }) => {
          this.awarenessEntries = states.map((entry) => ({ clientId: entry.clientId, user: entry.user }));
          for (const entry of states) this.performanceStage.ingest(readPerformances(entry.user));
          this.publishPresence();
        },
        onAuthenticationFailed: ({ reason }) => {
          const revoked = collaborationAccessRevoked(reason);
          this.update({
            state: revoked ? "permission_lost" : "reconnecting",
            level: null,
            error: revoked ? reason || "Access was removed." : undefined,
          });
        },
        onStateless: ({ payload }) => {
          if (this.provider !== provider) return;
          try {
            const message = JSON.parse(payload) as {
              type?: string;
              updateIds?: unknown;
              documentHash?: unknown;
              confirmationId?: unknown;
              frontierHash?: unknown;
              deviceStateVector?: unknown;
              durableAnchor?: unknown;
              stateVector?: unknown;
              code?: unknown;
              regionIds?: unknown;
              nativeOperationId?: unknown;
              message?: unknown;
              updateBase64?: unknown;
              anchor?: unknown;
              admitted?: unknown;
            };
            if (message.type === "spectra.recovery_current") {
              const requestId = typeof message.confirmationId === "string" ? message.confirmationId : "";
              const pending = this.recoveryCurrentRequests.get(requestId);
              if (!pending) return;
              this.recoveryCurrentRequests.delete(requestId); clearTimeout(pending.timer);
              const anchor = readDurableRoomAnchor(message.anchor);
              if (!anchor || typeof message.updateBase64 !== "string" || !this.level) {
                pending.reject(new Error("LOCAL_RECOVERY_CURRENT_UNAVAILABLE")); return;
              }
              const update = Uint8Array.from(atob(message.updateBase64), character => character.charCodeAt(0));
              const verify = new Y.Doc();
              try {
                Y.applyUpdate(verify, update);
                const frontier = encodeDurableFrontier(Y, verify);
                if (!frontier) throw new Error("LOCAL_RECOVERY_CURRENT_UNAVAILABLE");
                const level = this.level;
                void crypto.subtle.digest("SHA-256", new Uint8Array(frontier)).then(digest => {
                  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
                  if (hash !== anchor.frontierHash || this.destroyed || !this.level) pending.reject(new Error("LOCAL_RECOVERY_CURRENT_CHANGED"));
                  else pending.resolve({ update, anchor, level });
                }).catch(error => pending.reject(error));
              } catch (error) { pending.reject(error instanceof Error ? error : new Error(String(error))); }
              finally { verify.destroy(); }
              return;
            }
            if (message.type === "spectra.recovery_vector") {
              if (message.admitted === true && typeof message.confirmationId === "string" && typeof message.stateVector === "string")
                this.sendLocalRecoveryDelta(message.confirmationId, message.stateVector);
              return;
            }
            if (message?.type === "spectra.permission_changed") {
              void fetchCollaborationSession(
                this.artifactId,
                this.partitionKey,
                this.clientId,
                this.schemaVersion,
              )
                .then((refreshed) => {
                  if (this.destroyed) return;
                  this.update({
                    level: refreshed.level,
                    accountId: refreshed.accountId,
                    displayName: refreshed.displayName,
                    ...(this.localRecoveryPending &&
                    refreshed.level === "modify"
                      ? {
                          state: this.provider?.synced
                            ? "synchronizing"
                            : "reconnecting",
                        }
                      : {}),
                    error: undefined,
                  });
                  if (refreshed.level === "modify")
                    this.sendLocalRecoveryUpdate();
                })
                .catch((error) => {
                  const reason =
                    error instanceof Error
                      ? error.message
                      : "Access was removed.";
                  if (this.destroyed) return;
                  if (collaborationNeedsSignIn(reason)) {
                    this.update({
                      state: "unsynchronized",
                      level: null,
                      error: reason,
                    });
                    return;
                  }
                  if (this.destroyed) return;
                  if (!collaborationAccessRevoked(reason)) {
                    this.update({
                      state: "reconnecting",
                      level: null,
                      error: "COLLABORATION_AUTHORIZATION_UNAVAILABLE",
                    });
                    this.websocketProvider?.disconnect();
                    return;
                  }
                  this.update({
                    state: "permission_lost",
                    level: null,
                    error: reason,
                  });
                });
              return;
            }
            const updateIds = Array.isArray(message.updateIds)
              ? message.updateIds.filter(
                  (value): value is string =>
                    typeof value === "string" && value.length <= 400,
                )
              : [];
            if (message.type === "spectra.durable_frontier") {
              if (typeof message.deviceStateVector === "string") this.confirmDeviceFrontier(message.deviceStateVector);
              else if (typeof message.frontierHash === "string") this.confirmDurableFrontier(message.frontierHash, message.durableAnchor);
              return;
            }
            if (message.type === "spectra.durable_pending") {
              for (const updateId of updateIds)
                this.durablePendingUpdateIds.add(updateId);
              this.updateSynchronizationState();
              return;
            }
            if (message.type === "spectra.durable_ack") {
              if (typeof message.confirmationId === "string") {
                const confirmation = this.recoveryConfirmation;
                if (!confirmation || confirmation.id !== message.confirmationId || this.destroyed) return;
                this.recoveryConfirmation = null;
                if (typeof message.deviceStateVector === "string") this.confirmDeviceFrontier(message.deviceStateVector);
                else if (typeof message.frontierHash === "string") this.confirmDurableFrontier(message.frontierHash, message.durableAnchor);
                this.updateSynchronizationState();
                return;
              }
              if (typeof message.documentHash === "string" && /^[a-f0-9]{64}$/.test(message.documentHash)) {
                const confirmedHash = message.documentHash;
                const captured = Y.encodeStateAsUpdate(this.document);
                void crypto.subtle.digest("SHA-256", new Uint8Array(captured)).then((digest) => {
                  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
                  const current = Y.encodeStateAsUpdate(this.document);
                  if (this.destroyed || hash !== confirmedHash || captured.length !== current.length || !captured.every((byte, index) => byte === current[index])) return;
                  this.durablePendingUpdateIds.clear();
                  this.localDurabilityPending = false;
                  this.localRecoveryPending = false;
                  this.localRecoveryDeliveryPending = false;
                  this.recoveryConfirmation = null;
                  this.updateSynchronizationState();
                });
                return;
              }
              for (const updateId of updateIds)
                this.durablePendingUpdateIds.delete(updateId);
              // IDs prove the sender's updates only. A remote update may have
              // arrived meanwhile; only a matching complete frontier can make
              // the current document/cache remotely durable.
              this.updateSynchronizationState();
              return;
            }
            if (message.type === "spectra.durable_failed") {
              if (message.code === "COLLABORATION_NATIVE_OVERLAP") {
                this.nativeConflict = {
                  regionIds: Array.isArray(message.regionIds) ? message.regionIds.filter((value): value is string => typeof value === "string").slice(0, 128) : [],
                  nativeOperationId: typeof message.nativeOperationId === "string" ? message.nativeOperationId : null,
                };
                this.quarantined = true;
              }
              this.updateSynchronizationState(
                typeof message.message === "string"
                  ? message.message
                  : "This edit could not be synchronized. Your local draft is still available.",
              );
            }
          } catch {
            // Ignore malformed stateless payloads from the gateway.
          }
        },
        onDisconnect: ({ event }) => {
          this.durabilityEpoch += 1;
          // A gateway restart discards only its in-memory acknowledgement set.
          // Yjs keeps the local document and re-sends its state-vector delta on
          // reconnect, where it receives a fresh durable pending/ack lifecycle.
          this.durablePendingUpdateIds.clear();
          this.localRecoveryDeliveryPending = false;
          this.recoveryVectorRequest = null;
          this.recoveryConfirmation = null;
          const revoked =
            event.code === 4403 && collaborationAccessRevoked(event.reason);
          // 4409 is Spectra's durable-reject close. Keep unsynchronized + error
          // even when the provider reports zero pending (pre-apply rejection),
          // and do not wipe a prior spectra.durable_failed message.
          const durableReject = event.code === 4409;
          const pending =
            this.providerUnsynchronizedChanges +
            (this.localDurabilityPending ? 1 : 0);
          const unsynchronizedChanges =
            durableReject && pending === 0 ? 1 : pending;
          this.update({
            state: revoked
              ? "permission_lost"
              : durableReject
                ? "unsynchronized"
                : event.code === 4403
                  ? "reconnecting"
                  : pending > 0
                    ? "unsynchronized"
                    : "reconnecting",
            unsynchronizedChanges,
            error: revoked
              ? event.reason || "Access was removed."
              : durableReject
                ? this.error ||
                  "This edit could not be accepted. Spectra is reloading the latest permitted version while keeping the local draft available for review."
                : undefined,
          });
          if (this.provider === provider && this.localDurabilityPending) this.rebuildProviderReplica();
        },
      });
      this.websocketProvider = websocketProvider;
      this.provider = provider;
      // An externally supplied websocket is not managed by HocuspocusProvider.
      // Attach first so the provider can authenticate and start Yjs sync as
      // soon as the socket opens; then explicitly own connect/disconnect/destroy.
      provider.attach();
      this.localPresence = {
        clientId: this.clientId,
        accountId: initial.accountId,
        name: initial.displayName,
        actorKind: "human",
      };
      this.localPresenceSignature = JSON.stringify(this.localPresence);
      provider.setAwarenessField("user", this.localPresence);
      this.startAuthorizationWatch();
      await websocketProvider.connect();
    } catch (error) {
      this.provider?.destroy();
      this.provider = null;
      this.websocketProvider?.destroy();
      this.websocketProvider = null;
      if (roomClosed(error instanceof Error ? error.message : "")) {
        this.settleClosed();
        return;
      }
      this.update({
        state: "unsynchronized",
        error:
          error instanceof Error
            ? error.message
            : "Could not start collaboration.",
      });
      this.scheduleConnectionRetry();
    }
  }

  /** A closed room (an archived or retired work) will not reopen by retrying.
   * Settle read-only with nothing pending, instead of a reconnect loop that
   * keeps a phantom draft "held on this device". */
  private settleClosed() {
    this.update({ state: "closed", level: "read", unsynchronizedChanges: 0, error: undefined });
  }

  private scheduleConnectionRetry() {
    if (
      this.destroyed ||
      this.intentionallyDisconnected ||
      this.connectionRetryTimer !== undefined
    )
      return;
    const attempt = this.connectionRetryAttempt + 1;
    this.connectionRetryAttempt = attempt;
    const delay = syncRetryDelayMs(
      attempt,
      `collaboration-connect:${this.artifactId}:${this.partitionKey}`,
    );
    this.connectionRetryTimer = window.setTimeout(() => {
      this.connectionRetryTimer = undefined;
      void this.connect();
    }, delay);
  }

  disconnect() {
    this.intentionallyDisconnected = true;
    if (this.connectionRetryTimer !== undefined) {
      window.clearTimeout(this.connectionRetryTimer);
      this.connectionRetryTimer = undefined;
    }
    if (this.authorizationTimer !== undefined) {
      window.clearInterval(this.authorizationTimer);
      this.authorizationTimer = undefined;
    }
    this.websocketProvider?.disconnect();
    this.update({
      state: this.unsynchronizedChanges > 0 ? "unsynchronized" : "closed",
    });
  }

  destroy() {
    if (this.destroyed) return;
    if (this.deviceProjectionTimer !== undefined) {
      clearTimeout(this.deviceProjectionTimer);
      this.deviceProjectionTimer = undefined;
      try { this.sendDeviceProjection(); } catch { /* Bridge saved the words already. */ }
      if (this.deviceProjectionTimer !== undefined) clearTimeout(this.deviceProjectionTimer);
    }
    this.destroyed = true;
    this.durabilityEpoch += 1;
    this.intentionallyDisconnected = true;
    if (this.connectionRetryTimer !== undefined) {
      window.clearTimeout(this.connectionRetryTimer);
      this.connectionRetryTimer = undefined;
    }
    if (this.authorizationTimer !== undefined) {
      window.clearInterval(this.authorizationTimer);
      this.authorizationTimer = undefined;
    }
    this.provider?.destroy();
    this.provider = null;
    this.providerDocument.destroy();
    for (const pending of this.recoveryCurrentRequests.values()) { clearTimeout(pending.timer); pending.reject(new Error("COLLABORATION_CLOSED")); }
    this.recoveryCurrentRequests.clear();
    this.websocketProvider?.destroy();
    this.websocketProvider = null;
    this.stopCommittedPerformances();
    this.performanceStage.destroy();
    this.document.off("update", this.onLocalDocumentUpdate);
    this.document.destroy();
    this.update({ state: "closed", presence: [] });
    this.snapshots.clear();
  }

  async retry() {
    if (this.destroyed) throw new Error("COLLABORATION_CLOSED");
    if (this.nativeConflict) return;
    if (this.state === "permission_lost")
      throw new Error("COLLABORATION_ACCESS_LOST");
    if (!this.provider) {
      this.intentionallyDisconnected = false;
      this.connectionRetryAttempt = 0;
      await this.connect();
      return;
    }
    this.intentionallyDisconnected = false;
    this.update({ state: "reconnecting", error: undefined });
    await this.websocketProvider?.connect();
    // A socket connect is a no-op while already open. A sync-step round trip
    // still asks the gateway for the actual state-vector delta so retry is a
    // real reconciliation rather than a cosmetic status transition.
    this.provider.forceSync();
    this.provider.flushPendingUpdates();
    await this.flush();
  }

  async readRecoveryCurrent(signal?: AbortSignal): Promise<RecoveryCurrent> {
    signal?.throwIfAborted();
    if (!this.provider) await this.connect();
    const start = Date.now();
    while (!this.provider?.synced || !this.level) {
      signal?.throwIfAborted();
      if (this.destroyed || this.state === "permission_lost" || Date.now() - start > 10_000)
        throw new Error("LOCAL_RECOVERY_CURRENT_UNAVAILABLE");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const confirmationId = `current:${++this.recoveryConfirmationSequence}`;
    return new Promise<RecoveryCurrent>((resolve, reject) => {
      const timer = setTimeout(() => { this.recoveryCurrentRequests.delete(confirmationId); reject(new Error("LOCAL_RECOVERY_CURRENT_UNAVAILABLE")); }, 10_000);
      this.recoveryCurrentRequests.set(confirmationId, { resolve, reject, timer });
      this.provider!.sendStateless(JSON.stringify({ type: "spectra.recovery_current", confirmationId }));
    });
  }

  setPresence(fields: Omit<CollaborationPresence, "clientId">) {
    const nextPresence = {
      ...(this.localPresence ?? {}),
      ...fields,
      clientId: this.clientId,
    };
    const signature = JSON.stringify(nextPresence);
    if (signature === this.localPresenceSignature) return;
    this.localPresence = nextPresence;
    this.localPresenceSignature = signature;
    this.provider?.setAwarenessField("user", this.localPresence);
  }

  transact(regionId: string, change: () => void) {
    if (this.state === "permission_lost" || this.level === "read")
      throw new Error("COLLABORATION_READ_ONLY: You have read-only access.");
    // Hocuspocus remains only as a compatibility provider, but it must not
    // freeze a native Y.Doc while reconnecting. Its provider records local
    // updates and state-vector sync merges them when the socket returns.
    this.document.transact(change, {
      kind: "spectra-region",
      regionId,
      clientId: this.clientId,
    });
  }

  async consumeAdmittedUpdate(admitted: AdmittedUpdateDescriptor, receipt: AdmittedUpdateReceipt, confirmationId: string) {
    const provider = this.provider;
    if (this.destroyed || !provider) throw new Error("COLLABORATION_NOT_CONNECTED");
    if (admitted.encoding === "inline") {
      const update = Uint8Array.from(atob(admitted.updateBase64), (character) => character.charCodeAt(0));
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", update)),
        (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (!update.byteLength || digest !== receipt.updateDigest) throw new Error("COLLABORATION_ADMITTED_UPDATE_INVALID");
      // Provider origin: the gateway already holds these bytes durably, so
      // Hocuspocus must not enqueue them as another local write.
      Y.applyUpdate(this.document, update, provider);
      provider.sendStateless(JSON.stringify({ type: "spectra.canonical_refresh", confirmationId }));
      return;
    }
    provider.sendStateless(JSON.stringify({ type: "spectra.canonical_refresh", confirmationId }));
    // A payload or compacted-replay receipt carries no bytes, and the gateway
    // skips that refresh merge while other edits are persisting. Display only
    // durable canonical state proven to cover this receipt.
    const current = await this.readRecoveryCurrent();
    if (current.anchor.roomId !== receipt.roomId || current.anchor.nextSequence <= receipt.sequence)
      throw new Error("COLLABORATION_ADMITTED_UPDATE_BEHIND");
    if (this.destroyed || !this.provider) throw new Error("COLLABORATION_NOT_CONNECTED");
    Y.applyUpdate(this.document, current.update, this.provider);
  }

  async flush() {
    if (!this.provider) throw new Error("COLLABORATION_NOT_CONNECTED");
    this.provider.flushPendingUpdates();
    // Hocuspocus records a just-transacted update on its next task. Checking
    // `hasUnsyncedChanges` immediately can therefore report a false clean
    // state, causing the region claim to be released before the gateway has
    // authorized and persisted the update.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
    if (
      this.provider.synced &&
      !this.provider.hasUnsyncedChanges &&
      this.durablePendingUpdateIds.size === 0 &&
      !this.localDurabilityPending
    )
      return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(
          new Error(
            "COLLABORATION_SYNC_TIMEOUT: The edit is still unsynchronized.",
          ),
        );
      }, 12_000);
      const unsubscribe = this.subscribe(() => {
        if (this.state === "permission_lost" || this.state === "closed") {
          cleanup();
          reject(new Error("COLLABORATION_ACCESS_LOST"));
        } else if (
          this.state === "synchronized" &&
          this.unsynchronizedChanges === 0
        ) {
          cleanup();
          resolve();
        }
      });
      function cleanup() {
        window.clearTimeout(timeout);
        unsubscribe();
      }
    });
  }
}
