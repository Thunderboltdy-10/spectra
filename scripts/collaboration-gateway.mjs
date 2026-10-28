import { Server } from "@hocuspocus/server";
import { artifactProjection } from "./collaboration-artifact-projection.mjs";
import { createHash } from "node:crypto";
import { MAX_ASSEMBLED_BYTES, installServerFraming, selectFrameProtocol } from "../shared/collaboration-framing.mjs";
import { jwtVerify } from "jose";
import * as Y from "yjs";
import { encodeDurableFrontier } from "../shared/collaboration-durable-frontier.mjs";
import { readDurableRoomAnchor, recoveryRegionIds } from "../shared/collaboration-recovery.mjs";
import * as decoding from "lib0/decoding";
import { messageYjsSyncStep2, messageYjsUpdate } from "y-protocols/sync";
import {
  initializeNativeArtifactDocument,
  isNativeArtifactDocument,
  nativeArtifactProjection,
  nativeChangedRegionIds,
  NATIVE_PROJECTION_REGION,
} from "./collaboration-native-projection.mjs";
import { createCheckpointScheduler } from "./collaboration-checkpoint.mjs";
import { gatewayHealthPayload } from "./collaboration-health.mjs";
import {
  applyStoredRoomUpdates,
  encodeStoredRoomSnapshot,
  shouldCompactRoom,
  shouldRepairNativeProjection,
  shouldRecoverNativeRoom,
} from "./collaboration-room-state.mjs";
import {
  MAX_DURABLE_UPDATE_BYTES,
  MAX_REALTIME_MESSAGE_BYTES,
  MAX_COMPACTION_STATE_VECTOR_BYTES,
  DURABLE_FAILURE_USER_MESSAGE,
  DURABLE_REJECT_CLOSE_CODE,
  canonicalDurableUpdate,
} from "./collaboration-update-envelope.mjs";
import {
  planMergedUpdatePersist,
  compactionSnapshotDecision,
  compactionDeferredHealthRecord,
  createDurablePayloadManifest,
} from "./collaboration-durable-capacity.mjs";
import { createCollaborationGatewayBridgeClient, serializeCollaborationBridge } from "./collaboration-gateway-bridge-client.mjs";
import { createCanonicalRoom, prepareCanonicalAppend, mergeCanonicalIntoLive, nativeOverlap } from "./collaboration-canonical-room.mjs";
import {
  durableHeadKey,
  isRebaseablePersistenceFailure,
  permanentPersistenceFailure,
  samePersistenceBatch,
  chainPersistThenCompact,
  collaborationFailureMessage,
  collaborationRetryDelayMs,
  createCollaborationAuthorizationGuard,
  drainGatewayForShutdown,
  GATEWAY_RESTARTING_CLOSE,
  persistenceFlushDelay,
} from "./collaboration-persist.mjs";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
const tokenSecret = process.env.SPECTRA_COLLAB_TOKEN_SECRET;
const bridgeKey = process.env.SPECTRA_COLLAB_BRIDGE_KEY;
if (!convexUrl) throw new Error("COLLABORATION_CONVEX_URL_MISSING");
if (!tokenSecret || tokenSecret.length < 32)
  throw new Error("COLLABORATION_TOKEN_CONFIG_MISSING");
if (!bridgeKey || bridgeKey.length < 32)
  throw new Error("COLLABORATION_BRIDGE_CONFIG_MISSING");
if (
  process.env.SPECTRA_COLLAB_SERVED_BY !== "serve-collaboration-gateway.mjs" &&
  process.env.SPECTRA_COLLAB_ALLOW_RAW !== "1"
) {
  throw new Error(
    "COLLABORATION_GATEWAY_USE_SERVE: Start via `SPECTRA_COLLAB_PORT=1234 node scripts/serve-collaboration-gateway.mjs` (matched .env.local secrets + port). Set SPECTRA_COLLAB_ALLOW_RAW=1 only for deliberate raw debugging.",
  );
}
const tokenFingerprint = createHash("sha256")
  .update(tokenSecret, "utf8")
  .digest("hex")
  .slice(0, 12);
process.stdout.write(
  `Spectra collaboration gateway secrets tokenFp=${tokenFingerprint} bind=${process.env.SPECTRA_COLLAB_PORT || 1234}\n`,
);

const rawBridge = createCollaborationGatewayBridgeClient({
  convexUrl,
  bridgeKey,
});
const serializedBridge = serializeCollaborationBridge(rawBridge);
// authorize/policy must not wait behind load/spill/snapshot — those can run for
// seconds on large rooms while beforeHandleMessage only has a 1s Convex budget
// once the action finally starts. append stays parallel for the same reason.
const PARALLEL_BRIDGE_OPS = new Set(["append", "authorize", "policy"]);
const bridge = (operation, payload, options) =>
  PARALLEL_BRIDGE_OPS.has(operation)
    ? rawBridge(operation, payload, options)
    : serializedBridge(operation, payload, options);
const jwtKey = new TextEncoder().encode(tokenSecret);
const META_MAP = "spectra:artifact-meta";
const REGION_MAP = "spectra:artifact-regions";


const GATEWAY_PROTOCOL_VERSION = 1;
// Must match shared/collaboration-bridge.ts — recover/repair projections that
// exceed this cannot ride the signed exchange envelope.
const PERSISTENCE_RETRY_MAX_MS = 5_000;
const PERSISTENCE_REBASE_MAX_ATTEMPTS = 8;
const GATEWAY_STARTED_AT = Date.now();
const activeConnections = new Set();
const authorizationGuard = createCollaborationAuthorizationGuard({
  authorize: context => bridge("authorize", {
    accountId: context.accountId,
    artifactId: context.artifactId,
    partitionKey: context.partitionKey,
    policyVersion: context.policyVersion,
  }, { retryAttempts: 1 }),
  closeConnection: (connection, code, reason) => {
    activeConnections.delete(connection);
    if (code === 4403) sendGatewayState(connection, { type: "spectra.permission_changed" });
    try { connection.webSocket.close(code, reason); } catch { /* Already closed. */ }
  },
});
const authenticatedRequests = new WeakSet();
const documentMessageTails = new WeakMap();
const pendingMessageReleases = new Map();
const acceptedDocumentMessages = new Map();
const unappliedDocumentMessages = new WeakSet();
const documentPersistenceQueues = new WeakMap();
const documentCheckpointSchedulers = new WeakMap();
const canonicalRooms = new WeakMap();
const documentDurableAnchors = new WeakMap();
const openDocuments = new Map();
const checkpointSchedulers = new Set();
// Rooms that may hold accepted updates Convex has not stored yet. Shutdown
// drains exactly these; a room leaves the set once its queue is empty.
const persistenceDocuments = new Set();
let shuttingDown = false;
let policySweepRunning = false;
let lastPersistenceFailure = null;
let lastCompactionDeferred = null;
let convexReadiness = { at: 0, status: "not_ready", detail: "Convex has not been probed yet." };

async function probeConvexReadiness() {
  const now = Date.now();
  if (now - convexReadiness.at < 5_000) return convexReadiness;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_200);
  try {
    const response = await fetch(`${String(convexUrl).replace(/\/$/, "")}/instance_name`, {
      signal: controller.signal,
      cache: "no-store",
    });
    const text = (await response.text()).trim();
    convexReadiness = response.ok && text
      ? { at: now, status: "ready", detail: text }
      : { at: now, status: "not_ready", detail: `HTTP ${response.status}` };
  } catch (error) {
    convexReadiness = {
      at: now,
      status: "not_ready",
      detail: error instanceof Error ? error.message : "Convex did not answer.",
    };
  } finally {
    clearTimeout(timeout);
  }
  return convexReadiness;
}

async function acquireDocumentMessage(document, socketId) {
  const previous = documentMessageTails.get(document) ?? Promise.resolve();
  let releaseCurrent;
  const current = new Promise((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.then(() => current);
  documentMessageTails.set(document, tail);
  await previous;
  const queue = pendingMessageReleases.get(socketId) ?? [];
  queue.push(() => {
    unappliedDocumentMessages.delete(document);
    releaseCurrent();
    if (documentMessageTails.get(document) === tail)
      documentMessageTails.delete(document);
  });
  pendingMessageReleases.set(socketId, queue);
}

function releaseDocumentMessage(socketId) {
  const queue = pendingMessageReleases.get(socketId);
  const release = queue?.shift();
  release?.();
  if (!queue?.length) pendingMessageReleases.delete(socketId);
}

function documentStateVectorHash(document) {
  return createHash("sha256")
    .update(Y.encodeStateVector(document))
    .digest("base64url");
}

function documentFrontierHash(document) {
  const frontier = encodeDurableFrontier(Y, document);
  return frontier ? createHash("sha256").update(frontier).digest("hex") : null;
}

function sendGatewayState(connection, payload) {
  try {
    connection.sendStateless(JSON.stringify(payload));
  } catch {
    // The originating tab may close while a durable batch is in flight. The
    // update still belongs in the room log even when nobody remains to ack it.
  }
}

function messageQueue(socketId) {
  const queue = acceptedDocumentMessages.get(socketId) ?? [];
  if (!acceptedDocumentMessages.has(socketId))
    acceptedDocumentMessages.set(socketId, queue);
  return queue;
}

function checkpointScheduler(document) {
  const existing = documentCheckpointSchedulers.get(document);
  if (existing) return existing;
  const created = createCheckpointScheduler({
    idleMs: 30_000,
    maxMs: Number.POSITIVE_INFINITY,
    persist: async (payload) => {
      try {
        const stored = await bridge("load", payload);
        if (!stored || (stored.lastProjectionSequence ?? 0) >= stored.nextSequence - 1) return;
        const canonical = applyStoredRoomUpdates(Y, stored);
        try {
          const projectionJson = artifactProjection(canonical, payload.schemaVersion);
          if (!projectionJson) return;
          return await bridge("checkpoint", {
            ...payload, throughSequence: stored.nextSequence - 1,
            stateVectorHash: createHash("sha256").update(Y.encodeStateVector(canonical)).digest("base64url"),
            projectionJson, projectionHash: createHash("sha256").update(projectionJson).digest("base64url"),
          });
        } finally { canonical.destroy(); }
      } catch (error) {
        process.stderr.write(
          `[checkpoint] ${error instanceof Error ? error.message : String(error)}\n`,
        );
        forceCanonicalReconnect(payload, "COLLABORATION_CHECKPOINT_FAILED");
        throw error;
      }
    },
  });
  documentCheckpointSchedulers.set(document, created);
  checkpointSchedulers.add(created);
  return created;
}

function persistenceQueue(document) {
  const existing = documentPersistenceQueues.get(document);
  if (existing) return existing;
  const created = {
    pending: [],
    firstPendingAt: null,
    pendingBytes: 0,
    flushing: null,
    timer: null,
    chain: chainPersistThenCompact({
      persist: (batch) =>
        persistAcceptedMessages(document, batch.entries),
      compact: (batch) => compactStoredRoom(batch.entries[0]?.context),
      onCompactError: (error) => {
        process.stderr.write(
          `[compact] ${collaborationFailureMessage(error)}\n`,
        );
      },
    }),
  };
  documentPersistenceQueues.set(document, created);
  return created;
}

function gatewayRestarting() {
  // Hocuspocus closes the socket with this code and reason. The client keeps
  // the edit locally and re-sends it to the next gateway.
  return Object.assign(new Error("COLLABORATION_GATEWAY_RESTARTING"), GATEWAY_RESTARTING_CLOSE);
}

function persistenceDirty(document) {
  const queue = documentPersistenceQueues.get(document);
  return Boolean(queue?.pending.length || queue?.flushing || unappliedDocumentMessages.has(document));
}

function settlePersistenceDocument(document) {
  if (!persistenceDirty(document)) persistenceDocuments.delete(document);
}

function canonicalRoom(document, context) {
  let room = canonicalRooms.get(document);
  if (!room) {
    room = { context, session: null };
    room.session = createCanonicalRoom({
      expectedRoomId: context.roomId,
      load: afterSequence => bridge("load", {
        artifactId: room.context.artifactId, partitionKey: room.context.partitionKey,
        accountId: room.context.accountId, policyVersion: room.context.policyVersion, afterSequence,
      }),
    });
    canonicalRooms.set(document, room);
  }
  room.context = context;
  return room.session;
}

async function catchUpCanonicalRoom(document, context) {
  await flushPersistence(document);
  return canonicalRoom(document, context).run(async session => {
    const { document: canonical, stored } = await session.refresh();
    const pending = documentPersistenceQueues.get(document);
    if (pending?.pending.length || pending?.flushing || unappliedDocumentMessages.has(document)) return stored.nextSequence;
    mergeCanonicalIntoLive(canonical, document);
    const frontierHash = documentFrontierHash(canonical);
    if (frontierHash) {
      const durableAnchor = { roomId: stored.roomId, nextSequence: stored.nextSequence, frontierHash };
      documentDurableAnchors.set(document, durableAnchor);
      document.broadcastStateless(JSON.stringify({ type: "spectra.durable_frontier", frontierHash, durableAnchor }));
    }
    const open = openDocuments.get(durableHeadKey(context));
    if (open?.document === document) open.nextSequence = stored.nextSequence;
    return stored.nextSequence;
  });
}

const compactionState = new Map();
let compactionInFlight = false;

async function compactStoredRoom(context, { countAppend = true } = {}) {
  if (!context?.artifactId || !context?.partitionKey) return;
  const key = durableHeadKey(context);
  const local = compactionState.get(key) ?? {
    appends: 0,
    lastSnapshotAt: null,
  };
  if (countAppend) {
    local.appends += 1;
    compactionState.set(key, local);
  }
  const due =
    local.appends >= 200 ||
    (local.lastSnapshotAt == null && local.appends >= 8);
  if (!due || compactionInFlight) return;
  compactionInFlight = true;
  try {
    const open = openDocuments.get(key);
    if (open) await catchUpCanonicalRoom(open.document, context);
    const stored = await bridge("load", {
      artifactId: context.artifactId,
      partitionKey: context.partitionKey,
      accountId: context.accountId,
      policyVersion: context.policyVersion,
    });
    const throughSequence = (stored?.nextSequence ?? 1) - 1;
    const currentSnapshotSequence = stored?.snapshot?.throughSequence ?? 0;
    if (
      !stored?.roomId ||
      throughSequence <= currentSnapshotSequence ||
      throughSequence <= 0
    )
      return;
    if (
      !shouldCompactRoom({
        uncompactedBytes: stored.uncompactedBytes ?? 0,
        updateCount: stored.updates?.length ?? 0,
        lastSnapshotAt: stored.lastSnapshotAt ?? null,
      })
    ) {
      local.appends = stored.updates?.length ?? 0;
      local.lastSnapshotAt = stored.lastSnapshotAt ?? local.lastSnapshotAt;
      compactionState.set(key, local);
      return;
    }
    const { update, stateVector } = encodeStoredRoomSnapshot(Y, stored);
    const decision = compactionSnapshotDecision(update, stateVector, {
      maxUpdateBytes: MAX_DURABLE_UPDATE_BYTES,
      maxStateVectorBytes: MAX_COMPACTION_STATE_VECTOR_BYTES,
    });
    if (decision.action !== "inline") {
      // Never silently skip: spill snapshot bytes when the update envelope is
      // the problem; otherwise surface degraded health for state-vector bloat.
      lastCompactionDeferred = compactionDeferredHealthRecord({
        artifactId: context.artifactId,
        partitionKey: context.partitionKey,
        reason: decision.reason,
        updateBytes: decision.updateBytes,
        stateVectorBytes: decision.stateVectorBytes,
      });
      if (decision.action === "spill") {
        const manifest = createDurablePayloadManifest({
          kind: "yjs-snapshot",
          bytes: update,
          encoding: "payload-ref",
          payloadRef: "pending",
        });
        const storedPayload = await bridge("storeDurablePayload", {
          artifactId: context.artifactId,
          partitionKey: context.partitionKey,
          accountId: context.accountId,
          kind: "yjs-snapshot",
          digest: manifest.digest,
          mediaType: manifest.mediaType,
          bytesBase64: Buffer.from(update).toString("base64"),
      policyVersion: context.policyVersion,
        });
        manifest.payloadRef = storedPayload.payloadRef;
        await bridge("snapshot", {
          artifactId: context.artifactId,
          partitionKey: context.partitionKey,
          roomId: stored.roomId,
          throughSequence,
          update: "",
          stateVector: Buffer.from(stateVector).toString("base64"),
          contentHash: createHash("sha256").update(update).digest("base64url"),
          schemaVersion: stored.schemaVersion,
          payloadManifest: manifest,
          payloadRef: storedPayload.payloadRef,
          payloadDigest: manifest.digest,
          byteLength: update.byteLength,
      accountId: context.accountId,
      policyVersion: context.policyVersion,
        });
        lastCompactionDeferred = null;
      } else {
        return;
      }
    } else {
    await bridge("snapshot", {
      artifactId: context.artifactId,
      partitionKey: context.partitionKey,
      roomId: stored.roomId,
      throughSequence,
      update: Buffer.from(update).toString("base64"),
      stateVector: Buffer.from(stateVector).toString("base64"),
      contentHash: createHash("sha256").update(update).digest("base64url"),
      schemaVersion: stored.schemaVersion,
      accountId: context.accountId,
      policyVersion: context.policyVersion,
    });
    }
    local.appends = 0;
    local.lastSnapshotAt = Date.now();
    compactionState.set(key, local);
  } finally {
    compactionInFlight = false;
  }
}

function forceCanonicalReconnect(context, reason) {
  for (const peer of activeConnections) {
    if (
      peer.context?.artifactId !== context.artifactId ||
      peer.context?.partitionKey !== context.partitionKey
    )
      continue;
    if (!reason.includes("COLLABORATION_NATIVE_OVERLAP")) sendGatewayState(peer, {
      type: "spectra.durable_failed",
      message: DURABLE_FAILURE_USER_MESSAGE,
    });
    try {
      peer.webSocket.close(DURABLE_REJECT_CLOSE_CODE, reason);
    } catch {
      // Another policy path may already have closed the peer.
    }
  }
}

function rejectPeerUpdate(connection, reason) {
  // Pre-apply rejection only advances this peer's local Y.Doc. Tell that peer
  // the truth before closing so the UI does not silently reconnect as clean.
  sendGatewayState(connection, {
    type: "spectra.durable_failed",
    message: DURABLE_FAILURE_USER_MESSAGE,
  });
  try {
    connection.webSocket.close(DURABLE_REJECT_CLOSE_CODE, reason);
  } catch {
    // The peer may already have disconnected while authorization ran.
  }
}

async function appendWithRetry(prepare, entries) {
  let attempt = 0;
  let rebaseAttempts = 0;
  let prepared = null;
  for (;;) {
    try {
      await reauthorizePersistenceEntries(entries);
      prepared ??= await prepare();
      const result = await bridge("append", prepared.payload);
      lastPersistenceFailure = null;
      await reauthorizePersistenceEntries(entries);
      return { result, ...prepared };
    } catch (error) {
      if (isRebaseablePersistenceFailure(error) && rebaseAttempts < PERSISTENCE_REBASE_MAX_ATTEMPTS) {
        // An explicit CAS rejection proves the attempt did not commit. Only
        // then may its derived projection/frontier be replaced. An ambiguous
        // network failure retries the exact envelope and operation identity.
        prepared = null;
        rebaseAttempts += 1;
      }
      const persistenceMessage = collaborationFailureMessage(error);
      attempt += 1;
      lastPersistenceFailure = {
        code: persistenceMessage.match(/COLLABORATION_[A-Z_]+/)?.[0] ?? "COLLABORATION_APPEND_FAILED",
        at: Date.now(), attempt,
      };
      if (permanentPersistenceFailure(error) || attempt >= 12 ||
          (isRebaseablePersistenceFailure(error) && rebaseAttempts >= PERSISTENCE_REBASE_MAX_ATTEMPTS)) {
        forceCanonicalReconnect(entries[0].context, persistenceMessage);
        throw error;
      }
      const retryMs = Math.min(PERSISTENCE_RETRY_MAX_MS, collaborationRetryDelayMs(error, attempt - 1));
      process.stderr.write(`[durable append] retrying in ${retryMs}ms (${persistenceMessage})\n`);
      await new Promise(resolve => setTimeout(resolve, retryMs));
    }
  }
}

async function persistAcceptedMessages(document, entries) {
  if (!entries.length) return;
  let index = 0;
  while (index < entries.length) {
    const group = [entries[index++]];
    while (index < entries.length && samePersistenceBatch(group[0], entries[index])) group.push(entries[index++]);
    const first = group[0];
    const context = first.context;
    const mergePlan = planMergedUpdatePersist(Y, group.map(entry => entry.documentUpdate), MAX_DURABLE_UPDATE_BYTES);
    // A group is one CAS and acknowledgement boundary, inline or spilled.
    const update = mergePlan.mode === "spill" ? mergePlan.update : mergePlan.batches[0].merged;
    const updateHash = createHash("sha256").update(update).digest("base64url");
    let updateEnvelope = { update: Buffer.from(update).toString("base64") };
    if (mergePlan.mode === "spill") {
      const storedPayload = await bridge("storeDurablePayload", {
        artifactId: context.artifactId, partitionKey: context.partitionKey,
        accountId: context.accountId, policyVersion: context.policyVersion,
        kind: "yjs-update", digest: mergePlan.manifest.digest,
        mediaType: mergePlan.manifest.mediaType, bytesBase64: Buffer.from(update).toString("base64"),
      });
      updateEnvelope = {
        update: "", payloadRef: storedPayload.payloadRef,
        payloadDigest: mergePlan.manifest.digest, byteLength: update.byteLength,
        payloadManifest: { ...mergePlan.manifest, payloadRef: storedPayload.payloadRef },
      };
    }
    await canonicalRoom(document, context).run(async session => {
      let canonical;
      let rebuild = false;
      const accepted = await appendWithRetry(async () => {
        if (rebuild) session.invalidate();
        rebuild = true;
        const refreshed = await session.refresh();
        canonical = refreshed.document;
        const authoredRegions = first.nativeProjectionBefore && group.at(-1).nativeProjectionAfter
          ? nativeChangedRegionIds(first.nativeProjectionBefore, group.at(-1).nativeProjectionAfter)
          : group.flatMap(entry => entry.regionIds);
        const overlap = nativeOverlap({ baseSequence: first.baseSequence, authoredRegions,
          nativeRegions: refreshed.nativeRegions, historyFloor: refreshed.historyFloor });
        if (overlap) {
          for (const entry of group) sendGatewayState(entry.connection, {
            type: "spectra.durable_failed", code: "COLLABORATION_NATIVE_OVERLAP",
            message: "A native edit changed the same part of this work. Your local draft is preserved; review the conflicting changes before retrying.",
            regionIds: [overlap.regionId], nativeOperationId: overlap.operationId,
          });
          throw new Error("COLLABORATION_NATIVE_OVERLAP");
        }
        const native = isNativeArtifactDocument(canonical);
        const beforeModel = native ? null : artifactModelState(canonical);
        let publicationChanged = false;
        const prepared = prepareCanonicalAppend({
          document: canonical, stored: refreshed.stored, update,
          projection: doc => artifactProjection(doc, context.schemaVersion),
          regions: (before, after) => {
            if (!native && !isNativeArtifactDocument(canonical)) {
              const afterModel = artifactModelState(canonical);
              const changed = changedArtifactRegions(beforeModel, afterModel);
              publicationChanged = afterModel.metadata.some(([key, value]) => key === "typeKey" && value === "quiz") &&
                changed.some(region => region === "quiz:published" || region === "artifact:structure");
              return changed;
            }
            const previous = before ? JSON.parse(before) : null;
            const next = after ? JSON.parse(after) : null;
            publicationChanged = next?.typeKey === "quiz" &&
              (previous?.content?.published === true) !== (next.content?.published === true);
            return nativeChangedRegionIds(previous, next);
          },
        });
        if (!prepared.regionIds.length && isNativeArtifactDocument(canonical)) prepared.regionIds = [NATIVE_PROJECTION_REGION];
        // Publish/unpublish is a server-visible gate. Commit its projection in
        // this same append, rather than waiting for the 30-second checkpoint.
        const immediateProjection = publicationChanged || context.actorKind === "ai" || group.some(entry => entry.nativeInitialization);
        const projectionJson = immediateProjection ? prepared.projectionJson : null;
        const { frontierHash, projectionJson: _projection, ...cas } = prepared;
        return {
          frontierHash,
          payload: {
            ...cas, ...updateEnvelope,
            artifactId: context.artifactId, partitionKey: context.partitionKey,
            accountId: context.accountId, actorKind: context.actorKind,
            clientId: context.clientId, policyVersion: context.policyVersion,
            idempotencyKey: `${context.clientId}:${updateHash}`,
            claimBaseStateVectorHash: first.baseStateVectorHash,
            nativeInitialization: group.some(entry => entry.nativeInitialization),
            projectionJson,
            projectionHash: projectionJson ? createHash("sha256").update(projectionJson).digest("base64url") : null,
          },
        };
      }, group);
      let nextSequence = accepted.result.sequence + 1;
      if (accepted.result.duplicate) {
        // A prior process may have committed this delta before losing its ack.
        // Read its current descendants instead of advancing from our attempt.
        session.invalidate();
        const refreshed = await session.refresh();
        canonical = refreshed.document;
        nextSequence = refreshed.stored.nextSequence;
      } else session.commit(accepted.result.sequence);
      // Do not let native LWW state erase a later speculative branch before
      // that branch's native-overlap check. Publish only after the whole
      // captured batch drains and no newer batch is pending.
      if (index === entries.length && !documentPersistenceQueues.get(document)?.pending.length &&
          !unappliedDocumentMessages.has(document)) {
        mergeCanonicalIntoLive(canonical, document);
        const open = openDocuments.get(durableHeadKey(context));
        if (open?.document === document) open.nextSequence = Math.max(open.nextSequence, accepted.result.sequence + 1);
      }
      for (const entry of group) sendGatewayState(entry.connection, {
        type: "spectra.durable_ack", updateIds: [entry.messageId],
      });
      const frontierHash = documentFrontierHash(canonical);
      if (frontierHash) {
        const durableAnchor = { roomId: context.roomId, nextSequence, frontierHash };
        documentDurableAnchors.set(document, durableAnchor);
        document.broadcastStateless(JSON.stringify({ type: "spectra.durable_frontier", frontierHash, durableAnchor }));
      }
      checkpointScheduler(document).note({
        artifactId: context.artifactId, partitionKey: context.partitionKey,
        accountId: context.accountId, clientId: context.clientId,
        policyVersion: context.policyVersion, schemaVersion: context.schemaVersion,
        roomId: context.roomId, stateVectorHash: documentStateVectorHash(canonical),
        throughSequence: accepted.result.sequence,
      });
    });
  }
}
function schedulePersistence(document, entry) {
  const queue = persistenceQueue(document);
  persistenceDocuments.add(document);
  if (queue.pending.length === 0) {
    queue.firstPendingAt = Date.now();
  }
  queue.pending.push(entry);
  queue.pendingBytes += entry.documentUpdate.byteLength;
  sendGatewayState(entry.connection, {
    type: "spectra.durable_pending",
    updateIds: [entry.messageId],
  });
  if (queue.timer) clearTimeout(queue.timer);
  const delay = persistenceFlushDelay({
    firstAt: queue.firstPendingAt,
    entries: queue.pending.length,
    bytes: queue.pendingBytes,
  });
  if (delay === 0) {
    // A full pending batch applies backpressure until it is durable. Keep at
    // most one active snapshot plus one pending snapshot during a slow append.
    return flushPersistence(document);
  }
  queue.timer = setTimeout(() => {
    queue.timer = null;
    void flushPersistence(document).catch(() => undefined);
  }, delay);
  queue.timer.unref?.();
}

async function flushPersistence(document) {
  const queue = documentPersistenceQueues.get(document);
  if (!queue) return;
  if (queue.flushing) {
    await queue.flushing;
    return flushPersistence(document);
  }
  clearTimeout(queue.timer);
  queue.timer = null;
  const lastPending = queue.pending.at(-1);
  if (lastPending && isNativeArtifactDocument(document))
    lastPending.nativeProjectionAfter = nativeArtifactProjection(document, lastPending.context.schemaVersion);
  const entries = queue.pending.splice(0);
  queue.firstPendingAt = null;
  queue.pendingBytes = 0;
  if (!entries.length) {
    settlePersistenceDocument(document);
    return queue.chain.persistTail;
  }
  const flushing = queue.chain.enqueue({ entries }).catch(error => {
      lastPersistenceFailure = { code: "COLLABORATION_APPEND_FAILED", at: Date.now(), attempt: 1 };
      forceCanonicalReconnect(entries[0].context, collaborationFailureMessage(error));
      throw error;
    }).finally(() => {
      if (queue.flushing === flushing) queue.flushing = null;
      settlePersistenceDocument(document);
    });
  queue.flushing = flushing;
  return flushing;
}

function sessionClaims(payload, documentName) {
  const required = [
    "artifactId",
    "roomId",
    "partitionKey",
    "documentName",
    "accountId",
    "schoolId",
    "clientId",
    "displayName",
    "level",
  ];
  for (const key of required)
    if (typeof payload[key] !== "string" || !payload[key])
      throw new Error("COLLABORATION_TOKEN_INVALID");
  if (
    payload.kind !== "spectra_collaboration" ||
    payload.documentName !== documentName ||
    (payload.actorKind !== "human" && payload.actorKind !== "ai") ||
    typeof payload.policyVersion !== "number" ||
    typeof payload.schemaVersion !== "number" ||
    typeof payload.exp !== "number"
  )
    throw new Error("COLLABORATION_TOKEN_INVALID");
  return payload;
}

function presenceColor(accountId) {
  const colors = [
    "#2f8f83",
    "#4c78c4",
    "#8a63c7",
    "#c06a42",
    "#a67c23",
    "#4f8a52",
    "#b85578",
    "#567f96",
  ];
  let hash = 0;
  for (const character of accountId)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

function boundedPresence(value, max = 4_000) {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value).length <= max ? value : undefined;
  } catch {
    return undefined;
  }
}

function interactionPresence(value, context, actorKind) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const source = value;
  // A cumulative speculative document can exceed the awareness budget even
  // when the semantic actor/target/act frame is tiny. Never drop the actor
  // with its payload: preserve the causal v2 body and omit only oversized
  // speculation. Legacy previewPatches are bounded independently below.
  const boundedWhole = boundedPresence(source, 28_000);
  const state = boundedWhole ?? {
    v: source.v,
    actor: source.actor,
    act: source.act,
    lifecycle: source.lifecycle,
    target: source.target,
    dropTarget: source.dropTarget,
    menu: boundedPresence(source.menu, 4_000),
    speculation: boundedPresence(source.speculation, 20_000),
    note:
      typeof source.note === "string" ? source.note.slice(0, 160) : undefined,
    heldRegionIds: Array.isArray(source.heldRegionIds)
      ? source.heldRegionIds.filter((id) => typeof id === "string").slice(0, 64)
      : undefined,
    at: source.at,
  };
  if (state.v !== 2) return undefined;
  const actor =
    state.actor &&
    typeof state.actor === "object" &&
    !Array.isArray(state.actor)
      ? state.actor
      : {};
  // Identity is gateway-authenticated. The client may describe the action and
  // target, but it cannot impersonate another collaborator or another owner's
  // AI by embedding arbitrary actor fields in the semantic frame.
  return {
    ...state,
    actor: {
      ...actor,
      clientId: context.clientId,
      kind: actorKind,
      name:
        actorKind === "ai"
          ? `${context.displayName}'s AI`
          : context.displayName,
      accountId: context.accountId,
      ...(actorKind === "ai"
        ? {
            ownerAccountId: context.accountId,
            ownerName: context.displayName,
          }
        : {}),
      ...(actorKind === "ai" && typeof actor.runId === "string"
        ? { runId: actor.runId.slice(0, 120) }
        : {}),
      ...(actorKind === "ai" && typeof actor.operationId === "string"
        ? { operationId: actor.operationId.slice(0, 120) }
        : {}),
    },
  };
}

function artifactModelState(document) {
  const metadata = document.getMap(META_MAP);
  const sortedEntries = (map) =>
    [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
  return {
    metadata: sortedEntries(metadata),
    regions: sortedEntries(document.getMap(REGION_MAP)),
    descriptors: sortedEntries(
      document.getMap("spectra:artifact-region-descriptors"),
    ),
  };
}

function changedArtifactRegions(before, after) {
  if (!before) return ["artifact:structure"];
  const beforeMeta = new Map(before.metadata);
  const afterMeta = new Map(after.metadata);
  const changed = new Set();
  const structuralMetadata = [
    "initialized",
    "modelVersion",
    "typeKey",
    "schemaVersion",
    "rootTemplate",
  ];
  if (
    structuralMetadata.some(
      (key) =>
        JSON.stringify(beforeMeta.get(key)) !==
        JSON.stringify(afterMeta.get(key)),
    ) ||
    JSON.stringify(before.descriptors) !== JSON.stringify(after.descriptors)
  )
    return ["artifact:structure"];
  for (const field of ["title", "summary", "tags"])
    if (
      JSON.stringify(beforeMeta.get(field)) !==
      JSON.stringify(afterMeta.get(field))
    )
      changed.add(`metadata:${field}`);
  const beforeRegions = new Map(before.regions);
  const afterRegions = new Map(after.regions);
  for (const regionId of new Set([
    ...beforeRegions.keys(),
    ...afterRegions.keys(),
  ]))
    if (beforeRegions.get(regionId) !== afterRegions.get(regionId))
      changed.add(regionId);
  return [...changed];
}

function extractYjsUpdate(frame) {
  const decoder = decoding.createDecoder(frame);
  decoding.readVarString(decoder);
  const outerType = decoding.readVarUint(decoder);
  if (outerType !== 0 && outerType !== 4) {
    return null;
  }
  const syncType = decoding.readVarUint(decoder);
  if (syncType !== messageYjsSyncStep2 && syncType !== messageYjsUpdate)
    return null;
  return decoding.readVarUint8Array(decoder);
}

async function refreshAuthorization(context) {
  return authorizationGuard.refresh(context);
}

async function reauthorize(context) {
  return authorizationGuard.require(context);
}

async function reauthorizePersistenceEntries(entries) {
  const contexts = new Map();
  for (const entry of entries) {
    const context = entry.context;
    const key = JSON.stringify([
      context.artifactId,
      context.partitionKey,
      context.accountId,
      context.actorKind,
      context.clientId,
      context.policyVersion,
    ]);
    if (!contexts.has(key)) contexts.set(key, context);
  }
  for (const context of contexts.values()) {
    const authorization = await bridge("authorize", {
      accountId: context.accountId,
      artifactId: context.artifactId,
      partitionKey: context.partitionKey,
      policyVersion: context.policyVersion,
    }, { retryAttempts: 1 });
    if (!authorization?.allowed)
      throw new Error("COLLABORATION_ACCESS_REVOKED");
    context.canModify = authorization.canModify === true;
    context.authorizationCheckedAt = Date.now();
    if (!context.canModify) throw new Error("COLLABORATION_READ_ONLY");
  }
}

const server = new Server({
  name: "spectra-collaboration",
  address: process.env.SPECTRA_COLLAB_HOST || "0.0.0.0",
  port: Number(process.env.SPECTRA_COLLAB_PORT || 1234),
  timeout: 30_000,
  debounce: 2_000,
  maxDebounce: 10_000,
  quiet: true,
  websocketOptions: {
    maxPayload: MAX_REALTIME_MESSAGE_BYTES,
    // crossws defaults to declining every subprotocol. Browsers reject that
    // handshake when the framing client has offered one.
    handleProtocols: selectFrameProtocol,
  },
  maxUnauthenticatedQueueSize: MAX_REALTIME_MESSAGE_BYTES,
  maxUnauthenticatedQueueMessages: 64,
  maxPendingDocuments: 4,
  // Hocuspocus' own signal handler exits as soon as its rooms unload, while
  // accepted updates may still be on their way to Convex. `shutdown` owns it.
  stopOnSignals: false,

  async onRequest({ request, response }) {
    if (!request.url?.startsWith("/_spectra/health")) return;
    const convex = await probeConvexReadiness();
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify({
        ...gatewayHealthPayload({
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          connections: activeConnections.size,
          lastPersistenceFailure,
          lastCompactionDeferred,
          startedAt: GATEWAY_STARTED_AT,
          convex: { status: convex.status, detail: convex.detail },
        }),
      }),
    );
    // Hocuspocus uses an empty rejection to signal that a request hook has
    // fully handled the response and its default welcome body should not run.
    throw null;
  },

  async onAuthenticate({ token, documentName, connectionConfig, request }) {
    try {
      const verified = await jwtVerify(token, jwtKey, {
        issuer: "spectra",
        audience: "spectra-collaboration-gateway",
        algorithms: ["HS256"],
      });
      const claims = sessionClaims(verified.payload, documentName);
      const context = {
        artifactId: claims.artifactId,
        roomId: claims.roomId,
        partitionKey: claims.partitionKey,
        accountId: claims.accountId,
        schoolId: claims.schoolId,
        clientId: claims.clientId,
        displayName: claims.displayName,
        actorKind: claims.actorKind,
        policyVersion: claims.policyVersion,
        schemaVersion: claims.schemaVersion,
        expiresAt: claims.exp,
        canModify: claims.level === "modify",
        authorizationCheckedAt: 0,
      };
      await reauthorize(context);
      authenticatedRequests.add(request);
      connectionConfig.readOnly = !context.canModify;
      return context;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown authentication failure";
      process.stderr.write(
        `Spectra collaboration authentication failed: ${message}\n`,
      );
      throw error;
    }
  },

  async connected({ connection }) {
    const document = connection.document;
    try { await reauthorize(connection.context); }
    catch {
      connection.webSocket.close(connection.context.authorizationRevoked ? 4403 : 1013,
        connection.context.authorizationRevoked ? "Access or permissions changed" : "Authorization temporarily unavailable");
      return;
    }
    activeConnections.add(connection);
    openDocuments.set(durableHeadKey(connection.context), { document, nextSequence: 0 });
    try { await catchUpCanonicalRoom(document, connection.context); }
    catch (error) { forceCanonicalReconnect(connection.context, collaborationFailureMessage(error)); }
    const unwatch = authorizationGuard.watch(connection);
    connection.onClose(() => {
      activeConnections.delete(connection);
      unwatch();
    });
  },

  async beforeHandleMessage({
    context,
    document,
    update: frame,
    socketId,
    connection,
  }) {
    if (shuttingDown) throw gatewayRestarting();
    await reauthorize(context);
    const incomingUpdate = extractYjsUpdate(frame);
    if (!incomingUpdate || incomingUpdate.byteLength === 0) return;
    // Hocuspocus can run hooks from different sockets concurrently. Hold a
    // per-document gate through `afterHandleMessage`, when the accepted update
    // has actually been applied to the shared Y.Doc. Without this, two valid
    // edits can both derive the same base vector and one is rejected as stale
    // even when the collaborators changed independent regions.
    await acquireDocumentMessage(document, socketId);
    try {
      // Shutdown began while this message waited for the room: once the drain
      // has started, only updates already in the room may still be applied.
      if (shuttingDown) throw gatewayRestarting();
      await reauthorize(context);
      const nativeBefore = isNativeArtifactDocument(document);
      // Sync step 2 often contains the complete client state on room join.
      // Accept the bounded realtime frame, but persist only the canonical
      // room delta so a rich document does not inflate one small edit past the
      // Convex append envelope. A genuinely large new delta still fails closed.
      const documentUpdate = canonicalDurableUpdate(
        Y,
        document,
        incomingUpdate,
      );
      if (!documentUpdate) {
        // A retry after a lost acknowledgement may already be in this Y.Doc.
        // Its no-op is acknowledged only after earlier accepted writes drain.
        messageQueue(socketId).push({ context: { ...context }, connection, noop: true });
        delete context.recoveryAdmission;
        return;
      }
      if (!context.canModify) throw new Error("COLLABORATION_READ_ONLY");
      const recovery = context.recoveryAdmission;
      if (recovery) {
        await canonicalRoom(document, context).run(async session => {
          const refreshed = await session.refresh();
          const overlap = nativeOverlap({ baseSequence: recovery.anchor.nextSequence, authoredRegions: recovery.regionIds,
            nativeRegions: refreshed.nativeRegions, historyFloor: refreshed.historyFloor });
          if (refreshed.stored.roomId !== recovery.anchor.roomId || overlap) {
            sendGatewayState(connection, { type: "spectra.durable_failed", code: "COLLABORATION_NATIVE_OVERLAP",
              regionIds: [overlap?.regionId ?? "artifact:structure"], nativeOperationId: overlap?.operationId ?? null,
              message: "The saved version changed while reconnecting. Your local draft is preserved for review." });
            throw new Error("COLLABORATION_NATIVE_OVERLAP");
          }
        });
      }
      if (documentUpdate.byteLength > MAX_ASSEMBLED_BYTES) {
        process.stderr.write(
          `[beforeHandleMessage] oversized canonical delta incoming=${incomingUpdate.byteLength} durable=${documentUpdate.byteLength} canonical=${Y.encodeStateAsUpdate(document).byteLength} native=${nativeBefore}\n`,
        );
        throw new Error("COLLABORATION_GATEWAY_UPDATE_SIZE");
      }
      const before = artifactModelState(document);
      const baseStateVectorHash = documentStateVectorHash(document);
      const previousPending = documentPersistenceQueues.get(document)?.pending.at(-1);
      const continuesNativeBatch = nativeBefore && previousPending?.nativeBefore &&
        samePersistenceBatch(previousPending, { context, nativeInitialization: false });
      if (nativeBefore && previousPending && !continuesNativeBatch)
        previousPending.nativeProjectionAfter = nativeArtifactProjection(document, previousPending.context.schemaVersion);
      const nativeProjectionBefore = nativeBefore && !continuesNativeBatch
        ? nativeArtifactProjection(document, context.schemaVersion)
        : null;
      const updateHash = createHash("sha256")
        .update(documentUpdate)
        .digest("base64url");
      // Keep the pre-apply hook deliberately cheap. Hocuspocus applies and
      // broadcasts as soon as this returns; projection and Convex persistence
      // are batched only after peers have received the keystroke.
      // Hocuspocus awaits between this hook and apply. Canonical native state
      // must not replace the authored base during that captured interval.
      unappliedDocumentMessages.add(document);
      persistenceDocuments.add(document);
      messageQueue(socketId).push({
        context: { ...context },
        connection,
        documentUpdate,
        before,
        nativeBefore,
        nativeProjectionBefore,
        baseStateVectorHash,
        baseSequence: recovery?.anchor.nextSequence ?? openDocuments.get(durableHeadKey(context))?.nextSequence,
        messageId: `${context.clientId}:${updateHash}`,
      });
      delete context.recoveryAdmission;
    } catch (error) {
      delete context.recoveryAdmission;
      releaseDocumentMessage(socketId);
      const reason =
        error instanceof Error
          ? error.message
          : "COLLABORATION_UPDATE_REJECTED";
      // A restart is not a rejection: the next gateway judges this update.
      if (shuttingDown) throw gatewayRestarting();
      process.stderr.write(`[beforeHandleMessage] ${reason}\n`);
      // A rejected update leaves this peer's local Y.Doc ahead of the canonical
      // room. Emit durable_failed before the close so the client marks
      // unsynchronized with a truthful message instead of a silent reconnect.
      rejectPeerUpdate(connection, reason);
      throw error;
    }
  },

  async afterHandleMessage({ socketId, document }) {
    unappliedDocumentMessages.delete(document);
    const queue = acceptedDocumentMessages.get(socketId);
    const accepted = queue?.shift();
    if (!queue?.length) acceptedDocumentMessages.delete(socketId);
    try {
      if (!accepted) return;
      if (accepted.noop) {
        await flushPersistence(document);
        sendGatewayState(accepted.connection, {
          type: "spectra.durable_ack", updateIds: [],
          documentHash: createHash("sha256").update(Y.encodeStateAsUpdate(document)).digest("hex"),
        });
        return;
      }
      const stateVectorHash = documentStateVectorHash(document);
      const nativeAfter = isNativeArtifactDocument(document);
      const regionIds = nativeAfter
        ? [NATIVE_PROJECTION_REGION]
        : changedArtifactRegions(accepted.before, artifactModelState(document));
      if (regionIds.length > 128)
        throw new Error("COLLABORATION_MODEL_CHANGE_UNRECOGNIZED");
      await schedulePersistence(document, {
        ...accepted,
        stateVectorHash,
        regionIds,
        nativeInitialization: nativeAfter && !accepted.nativeBefore,
      });
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "COLLABORATION_UPDATE_REJECTED";
      process.stderr.write(`[afterHandleMessage] ${reason}\n`);
      forceCanonicalReconnect(accepted?.context ?? {}, reason);
      throw error;
    } finally {
      // Ordinary updates release after apply. A full pending batch also waits
      // for storage, bounding memory when durable I/O falls behind incoming edits.
      releaseDocumentMessage(socketId);
      settlePersistenceDocument(document);
    }
  },

  async beforeHandleAwareness({ context, states }) {
    if (!context) {
      states.clear();
      return;
    }
    await reauthorize(context);
    for (const [clientId, state] of states) {
      const supplied =
        state?.user && typeof state.user === "object" ? state.user : {};
      const actorKind =
        supplied.actorKind === "ai" || supplied.actorKind === "human"
          ? supplied.actorKind
          : "human";
      const interactionState = interactionPresence(
        supplied.interactionState,
        context,
        actorKind,
      );
      const activeRegionIds = Array.isArray(supplied.activeRegionIds)
        ? supplied.activeRegionIds
            .filter((regionId) => typeof regionId === "string")
            .map((regionId) => regionId.slice(0, 240))
            .slice(0, 32)
        : undefined;
      states.set(clientId, {
        user: {
          clientId: context.clientId,
          accountId: context.accountId,
          // AI connections keep the owner's accountId/name so peers can render
          // owner-specific presence like "Pablo's Spectra".
          name:
            actorKind === "ai"
              ? `${context.displayName}'s AI`
              : context.displayName,
          color: presenceColor(context.accountId),
          actorKind,
          ...(actorKind === "ai" && typeof supplied.runId === "string"
            ? { runId: supplied.runId.slice(0, 120) }
            : {}),
          ...(actorKind === "ai" && typeof supplied.operationId === "string"
            ? { operationId: supplied.operationId.slice(0, 120) }
            : {}),
          ...(typeof supplied.activeRegionId === "string"
            ? { activeRegionId: supplied.activeRegionId.slice(0, 240) }
            : {}),
          ...(activeRegionIds && activeRegionIds.length > 0
            ? { activeRegionIds }
            : {}),
          ...(actorKind === "ai" &&
          boundedPresence(supplied.previewPatches, 24_000) !== undefined
            ? {
                previewPatches: boundedPresence(
                  supplied.previewPatches,
                  24_000,
                ),
              }
            : {}),
          ...(actorKind === "ai" && Number.isInteger(supplied.previewSequence)
            ? { previewSequence: supplied.previewSequence }
            : {}),
          ...(actorKind === "ai" && supplied.previewPhase === "streaming"
            ? { previewPhase: "streaming" }
            : {}),
          // Protocol v2 is the authoritative interaction envelope. It binds
          // actor identity, semantic target, native act, provisional patches,
          // held regions and lifecycle into one authenticated awareness frame.
          // Dropping it forces clients to reconstruct choreography from the
          // legacy cursor/preview fields, visually separating the "fake human"
          // performance from the real mutation.
          ...(interactionState ? { interactionState } : {}),
          ...(boundedPresence(supplied.cursor) !== undefined
            ? { cursor: boundedPresence(supplied.cursor) }
            : {}),
          ...(boundedPresence(supplied.selection) !== undefined
            ? { selection: boundedPresence(supplied.selection) }
            : {}),
          ...(boundedPresence(supplied.viewport) !== undefined
            ? { viewport: boundedPresence(supplied.viewport) }
            : {}),
        },
      });
    }
  },

  async onStateless({ connection, document, payload }) {
    // A recovery confirmation follows the restored update on the same ordered
    // socket. Capture its durable barrier under the apply gate, then release
    // that gate before I/O so other collaborators can continue editing.
    if (payload.length > 70_000) return;
    let request;
    try { request = JSON.parse(payload); } catch { return; }
    if (!["spectra.durable_confirm", "spectra.recovery_request", "spectra.recovery_current", "spectra.canonical_refresh"].includes(request?.type) ||
        typeof request.confirmationId !== "string" ||
        !/^[a-zA-Z0-9:-]{1,120}$/.test(request.confirmationId)) return;
    try {
      await reauthorize(connection.context);
      await acquireDocumentMessage(document, connection.socketId);
      let barrier;
      let frontierHash;
      try {
        await reauthorize(connection.context);
        frontierHash = documentFrontierHash(document);
        barrier = flushPersistence(document);
      }
      finally { releaseDocumentMessage(connection.socketId); }
      await barrier;
      if (request.type === "spectra.recovery_request" || request.type === "spectra.recovery_current" ||
          request.type === "spectra.canonical_refresh") {
        await canonicalRoom(document, connection.context).run(async session => {
          const refreshed = await session.refresh();
          const { document: canonical, stored } = refreshed;
          if (request.type === "spectra.recovery_current") {
            sendGatewayState(connection, { type: "spectra.recovery_current", confirmationId: request.confirmationId,
              updateBase64: Buffer.from(Y.encodeStateAsUpdate(canonical)).toString("base64"),
              anchor: { roomId: stored.roomId, nextSequence: stored.nextSequence, frontierHash: documentFrontierHash(canonical) } });
            return;
          }
          if (request.type === "spectra.recovery_request") {
            const anchor = readDurableRoomAnchor(request.recoveryAnchor);
            const regionIds = recoveryRegionIds(request.regionIds);
            const overlap = anchor ? nativeOverlap({ baseSequence: anchor.nextSequence, authoredRegions: regionIds.length ? regionIds : ["artifact:structure"],
              nativeRegions: refreshed.nativeRegions, historyFloor: refreshed.historyFloor }) : null;
            if (!anchor || anchor.roomId !== stored.roomId || anchor.nextSequence > stored.nextSequence || overlap ||
                (anchor.nextSequence === stored.nextSequence && anchor.frontierHash !== documentFrontierHash(canonical))) {
              sendGatewayState(connection, { type: "spectra.durable_failed", code: "COLLABORATION_NATIVE_OVERLAP",
                regionIds: [overlap?.regionId ?? "artifact:structure"], nativeOperationId: overlap?.operationId ?? null,
                message: "The local draft needs review against the saved version before it can sync." });
              return;
            }
            connection.context.recoveryAdmission = { anchor, regionIds: regionIds.length ? regionIds : ["artifact:structure"] };
          }
          const vector = request.type === "spectra.recovery_request" ? Y.encodeStateVector(canonical) : null;
          if (vector && vector.byteLength > MAX_COMPACTION_STATE_VECTOR_BYTES)
            throw new Error("COLLABORATION_RECOVERY_VECTOR_SIZE");
          const pending = documentPersistenceQueues.get(document);
          if (!pending?.pending.length && !pending?.flushing && !unappliedDocumentMessages.has(document))
            mergeCanonicalIntoLive(canonical, document);
          if (request.type === "spectra.recovery_request") sendGatewayState(connection, {
            type: "spectra.recovery_vector", confirmationId: request.confirmationId,
            admitted: true,
            stateVector: Buffer.from(vector).toString("base64"),
          });
        });
        return;
      }
      const durableAnchor = documentDurableAnchors.get(document);
      sendGatewayState(connection, {
        type: "spectra.durable_ack",
        confirmationId: request.confirmationId,
        frontierHash,
        ...(durableAnchor?.frontierHash === frontierHash ? { durableAnchor } : {}),
        updateIds: [],
      });
    } catch (error) {
      // Hocuspocus dispatches stateless frames without awaiting them, so a
      // rejection here becomes an unhandled rejection that exits the whole
      // gateway and drops every room. This peer hears the failure instead.
      const reason = collaborationFailureMessage(error);
      process.stderr.write(`[stateless] ${reason}\n`);
      rejectPeerUpdate(connection, reason);
    }
  },

  async onLoadDocument({ context }) {
    await reauthorize(context);
    let stored = await bridge("load", {
      artifactId: context.artifactId,
      partitionKey: context.partitionKey,
      accountId: context.accountId,
      policyVersion: context.policyVersion,
    });
    let storedDocument = applyStoredRoomUpdates(Y, stored);
    if (isNativeArtifactDocument(storedDocument)) {
      const observedStateVectorHash = documentStateVectorHash(storedDocument);
      const durableHeadSequence = Math.max(
        0,
        (stored?.nextSequence ?? 1) - 1,
      );
      const shouldRecover = shouldRecoverNativeRoom({
        liveStateVectorHash: stored?.liveStateVectorHash,
        observedStateVectorHash,
      });
      const shouldRepair =
        !shouldRecover &&
        shouldRepairNativeProjection({
          durableHeadSequence,
          lastProjectionSequence: stored?.lastProjectionSequence ?? null,
        }) &&
        typeof stored?.roomId === "string" &&
        typeof stored?.liveStateVectorHash === "string";
      if (shouldRecover || shouldRepair) {
        // Repair/recover must land a repaired durable head when possible.
        // Never put oversized observedProjectionJson in the signed envelope —
        // spill when it fits, else hash-only recover (contentHash attest).
        try {
          const observedProjectionJson = artifactProjection(
            storedDocument,
            context.schemaVersion,
          );
          if (!observedProjectionJson) {
            process.stderr.write(
              `[onLoadDocument:repair] missing projection — cannot repair artifact=${context.artifactId}\n`,
            );
          } else {
            const observedProjectionHash = createHash("sha256")
              .update(observedProjectionJson)
              .digest("base64url");
            const projectionForBridge = observedProjectionJson;
            const spilledRef = null;
            if (shouldRecover) {
              await bridge("recover", {
                artifactId: context.artifactId,
                partitionKey: context.partitionKey,
                accountId: context.accountId,
                clientId: context.clientId,
                policyVersion: context.policyVersion,
                expectedNextSequence: stored.nextSequence,
                expectedStateVectorHash: stored.liveStateVectorHash,
                observedStateVectorHash,
                ...(projectionForBridge
                  ? { observedProjectionJson: projectionForBridge }
                  : {}),
                observedProjectionHash,
                ...(spilledRef
                  ? { observedProjectionPayloadRef: spilledRef }
                  : {}),
              });
              stored = await bridge("load", {
                artifactId: context.artifactId,
                partitionKey: context.partitionKey,
      accountId: context.accountId,
      policyVersion: context.policyVersion,
              });
              storedDocument.destroy();
              storedDocument = applyStoredRoomUpdates(Y, stored);
            } else if (projectionForBridge) {
              await bridge("checkpoint", {
                artifactId: context.artifactId,
                partitionKey: context.partitionKey,
                accountId: context.accountId,
                clientId: context.clientId,
                policyVersion: context.policyVersion,
                roomId: stored.roomId,
                expectedNextSequence: stored.nextSequence,
                expectedLastProjectionSequence:
                  stored.lastProjectionSequence ?? 0,
                stateVectorHash: stored.liveStateVectorHash,
                projectionJson: projectionForBridge,
                projectionHash: observedProjectionHash,
                throughSequence: durableHeadSequence,
              });
              stored = await bridge("load", {
                artifactId: context.artifactId,
                partitionKey: context.partitionKey,
      accountId: context.accountId,
      policyVersion: context.policyVersion,
              });
              storedDocument.destroy();
              storedDocument = applyStoredRoomUpdates(Y, stored);
            } else {
              process.stderr.write(
                `[onLoadDocument:repair] checkpoint deferred — projection not inline (chars=${observedProjectionJson.length})\n`,
              );
            }
          }
        } catch (repairError) {
          const repairReason =
            repairError instanceof Error
              ? repairError.message
              : String(repairError);
          process.stderr.write(
            `[onLoadDocument:repair] ${repairReason} — opening stored room after repair failure\n`,
          );
        }
      }
    }

    if (isNativeArtifactDocument(storedDocument)) {
      const encoded = Y.encodeStateAsUpdate(storedDocument);
      storedDocument.destroy();
      await reauthorize(context);
      return encoded;
    }
    storedDocument.destroy();
    stored = await bridge("load", {
      artifactId: context.artifactId,
      partitionKey: context.partitionKey,
      includeInitialProjection: true,
      accountId: context.accountId,
      policyVersion: context.policyVersion,
    });
    const document = new Y.Doc();
    if (stored?.initialProjection) {
      if (!initializeNativeArtifactDocument(document, stored.initialProjection))
        throw new Error("COLLABORATION_NATIVE_BOOTSTRAP_UNSUPPORTED");
      const update = Y.encodeStateAsUpdate(document);
      const stateVectorHash = createHash("sha256")
        .update(Y.encodeStateVector(document))
        .digest("base64url");
      const projectionJson = artifactProjection(
        document,
        context.schemaVersion,
      );
      if (!projectionJson)
        throw new Error("COLLABORATION_NATIVE_BOOTSTRAP_PROJECTION_MISSING");
      const projectionHash = createHash("sha256")
        .update(projectionJson)
        .digest("base64url");
      const bootstrapPayload = {
        artifactId: context.artifactId,
        partitionKey: context.partitionKey,
        accountId: context.accountId,
        clientId: context.clientId,
        policyVersion: context.policyVersion,
        artifactUpdatedAt: stored.initialProjection.artifactUpdatedAt,
        expectedNextSequence: stored.nextSequence,
        stateVectorHash,
        projectionHash,
      };
      // Blob bodies never enter a Convex function argument.
      if (update.byteLength > MAX_DURABLE_UPDATE_BYTES) {
        const updateManifest = createDurablePayloadManifest({
          kind: "yjs-update",
          bytes: Buffer.from(update),
          encoding: "payload-ref",
          payloadRef: "pending",
        });
        const storedUpdate = await bridge("storeDurablePayload", {
          artifactId: context.artifactId,
          partitionKey: context.partitionKey,
          accountId: context.accountId,
          kind: "yjs-update",
          digest: updateManifest.digest,
          mediaType: updateManifest.mediaType,
          bytesBase64: Buffer.from(update).toString("base64"),
      policyVersion: context.policyVersion,
        });
        bootstrapPayload.update = "";
        bootstrapPayload.payloadRef = storedUpdate.payloadRef;
        bootstrapPayload.payloadDigest = updateManifest.digest;
        bootstrapPayload.payloadManifest = {
          ...updateManifest,
          payloadRef: storedUpdate.payloadRef,
        };
        bootstrapPayload.byteLength = update.byteLength;
        process.stderr.write(
          `[onLoadDocument:bootstrap] spilled yjs update bytes=${update.byteLength} ref=${storedUpdate.payloadRef}\n`,
        );
      } else {
        bootstrapPayload.update = Buffer.from(update).toString("base64");
      }
      bootstrapPayload.projectionJson = projectionJson;
      await bridge("bootstrap", bootstrapPayload);
    }
    await reauthorize(context);
    return document;
  },

  async onStoreDocument({ lastContext }) {
    if (!lastContext) return;
    await reauthorize(lastContext);
    await compactStoredRoom(lastContext, { countAppend: false });
  },
  async onDisconnect({ document, clientsCount }) {
    if (clientsCount === 0) {
      try {
        await flushPersistence(document);
        await documentCheckpointSchedulers.get(document)?.flush();
      } catch (error) {
        // The durable failure has already been surfaced. Hocuspocus does not
        // await close hooks, so rejecting here would crash unrelated rooms.
        process.stderr.write(`[disconnect] ${collaborationFailureMessage(error)}\n`);
      }
      settlePersistenceDocument(document);
      for (const [key, open] of openDocuments) if (open.document === document) openDocuments.delete(key);
      await canonicalRooms.get(document)?.session.dispose();
      canonicalRooms.delete(document);
    }
  },
});

async function enforceActivePolicyVersions() {
  if (policySweepRunning || activeConnections.size === 0) return;
  policySweepRunning = true;
  try {
    const grouped = new Map();
    for (const connection of activeConnections) {
      const context = connection.context;
      if (!context?.artifactId || !context?.partitionKey) continue;
      const key = `${context.artifactId}\u0000${context.partitionKey}`;
      const group = grouped.get(key) ?? {
        artifactId: context.artifactId,
        partitionKey: context.partitionKey,
        connections: [],
      };
      group.connections.push(connection);
      grouped.set(key, group);
    }
    await Promise.all(
      [...grouped.values()].map(async (group) => {
        try {
          const current = await bridge("policy", {
            artifactId: group.artifactId,
            partitionKey: group.partitionKey,
          });
          const nowSeconds = Math.floor(Date.now() / 1000);
          // Independent connection leases share only concurrent checks for
          // the same actor and room; revocation deadlines stay unchanged.
          await Promise.all(group.connections.map(connection =>
            refreshAuthorization(connection.context).catch(() => undefined)));
          for (const connection of group.connections) {
            const context = connection.context;
            const actorRevoked = context.authorizationRevoked === true;
            if (!activeConnections.has(connection)) continue;
            const stale =
              actorRevoked ||
              !current?.available ||
              current.policyVersion !== context.policyVersion ||
              context.expiresAt <= nowSeconds;
            if (!stale) continue;
            activeConnections.delete(connection);
            try {
              connection.sendStateless(
                JSON.stringify({ type: "spectra.permission_changed" }),
              );
            } catch {}
            connection.webSocket.close(4403, "Access or permissions changed");
          }
          const permitted = group.connections.find(connection => activeConnections.has(connection));
          const open = openDocuments.get(durableHeadKey(group));
          if (permitted && open && (current.roomId !== permitted.context.roomId || current.nextSequence !== open.nextSequence)) {
            try { await catchUpCanonicalRoom(open.document, permitted.context); }
            catch (error) { forceCanonicalReconnect(permitted.context, collaborationFailureMessage(error)); }
          }
        } catch {
          // Independent connection deadlines still expire stale grants while
          // policy I/O fails or hangs; a failed sweep cannot extend authority.
        }
      }),
    );
  } finally {
    policySweepRunning = false;
  }
}

const policySweep = setInterval(() => {
  void enforceActivePolicyVersions();
}, 5_000);
policySweep.unref?.();

installServerFraming(server, request => authenticatedRequests.has(request));
await server.listen();
process.stdout.write(
  `Spectra collaboration gateway listening on ${process.env.SPECTRA_COLLAB_PORT || 1234}\n`,
);

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(policySweep);
  authorizationGuard.dispose();
  const { unflushed } = await drainGatewayForShutdown({
    stopAccepting: () => server.httpServer.close(),
    closeConnections: () => {
      const sockets = new Set([...activeConnections].map(connection => connection.webSocket));
      for (const document of server.hocuspocus.documents.values())
        for (const connection of document.getConnections()) sockets.add(connection.webSocket);
      for (const socket of sockets) {
        try { socket.close(GATEWAY_RESTARTING_CLOSE.code, GATEWAY_RESTARTING_CLOSE.reason); }
        catch { /* Already closed. */ }
      }
    },
    dirtyDocuments: () => [...persistenceDocuments].filter(persistenceDirty),
    flushDocument: flushPersistence,
    flushCheckpoints: () => Promise.allSettled([...checkpointSchedulers].map(scheduler => scheduler.flush())),
    describeDocument: document => {
      const pending = documentPersistenceQueues.get(document)?.pending ?? [];
      const context = pending[0]?.context;
      return `artifact=${context?.artifactId ?? document.name} partition=${context?.partitionKey ?? "?"} pendingUpdates=${pending.length}`;
    },
    log: line => process.stderr.write(line),
  });
  for (const scheduler of checkpointSchedulers) scheduler.dispose();
  checkpointSchedulers.clear();
  process.exit(unflushed.length ? 1 : 0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
