import { Server } from "@hocuspocus/server";
import { createHash } from "node:crypto";
import { MAX_ASSEMBLED_BYTES, installServerFraming, selectFrameProtocol } from "../shared/collaboration-framing.mjs";
import { jwtVerify } from "jose";
import * as Y from "yjs";
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
import {
  appendBaseStateVectorHash,
  durableHeadKey,
  isRebaseablePersistenceFailure,
  isTransientCollaborationFailure,
  permanentPersistenceFailure,
  rebaseAppendPayload,
  resolveRebaseHead,
  samePersistenceBatch,
  chainPersistThenCompact,
  collaborationFailureMessage,
  collaborationRetryDelayMs,
  COLLABORATION_AUTHORIZE_CACHE_MS,
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
const REGION_MARKER = "$spectraRegion";
const CODE_LINES_MARKER = "$spectraCodeLines";
const GATEWAY_PROTOCOL_VERSION = 1;
// Must match shared/collaboration-bridge.ts — recover/repair projections that
// exceed this cannot ride the signed exchange envelope.
const PERSISTENCE_DEBOUNCE_MS = 180;
const PERSISTENCE_RETRY_MAX_MS = 5_000;
const PERSISTENCE_REBASE_MAX_ATTEMPTS = 8;
const GATEWAY_STARTED_AT = Date.now();
const activeConnections = new Set();
const authenticatedRequests = new WeakSet();
const documentMessageTails = new WeakMap();
const pendingMessageReleases = new Map();
const acceptedDocumentMessages = new Map();
const documentPersistenceQueues = new WeakMap();
const documentCheckpointSchedulers = new WeakMap();
const durableHeads = new Map();
const checkpointSchedulers = new Set();
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
    snapshotAfterFirst: null,
    timer: null,
    chain: chainPersistThenCompact({
      persist: (batch) =>
        persistAcceptedMessages(
          document,
          batch.entries,
          batch.snapshotAfterFirst,
        ),
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

function rememberDurableHead(context, hash) {
  const key = durableHeadKey(context);
  if (!key || typeof hash !== "string" || hash.length < 16) return;
  durableHeads.set(key, hash);
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
    sendGatewayState(peer, {
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

async function appendWithRetry(payload, entries) {
  let attempt = 0;
  let rebaseAttempts = 0;
  let nextPayload = payload;
  for (;;) {
    try {
      const result = await bridge("append", nextPayload);
      lastPersistenceFailure = null;
      rememberDurableHead(entries[0].context, nextPayload.stateVectorHash);
      for (const entry of entries)
        sendGatewayState(entry.connection, {
          type: "spectra.durable_ack",
          updateIds: [entry.messageId],
        });
      return result;
    } catch (error) {
      if (
        isRebaseablePersistenceFailure(error) &&
        rebaseAttempts < PERSISTENCE_REBASE_MAX_ATTEMPTS
      ) {
        const context = entries[0].context;
        let liveHash = resolveRebaseHead({
          lastPersistedHash: durableHeads.get(durableHeadKey(context)),
          storedLiveHash: null,
        });
        let rebased = rebaseAppendPayload(nextPayload, liveHash);
        if (rebased.baseStateVectorHash === nextPayload.baseStateVectorHash) {
          try {
            const stored = await bridge("load", {
              artifactId: context.artifactId,
              partitionKey: context.partitionKey,
      accountId: context.accountId,
      policyVersion: context.policyVersion,
            });
            liveHash = resolveRebaseHead({
              lastPersistedHash: liveHash,
              storedLiveHash: stored?.liveStateVectorHash,
            });
            rememberDurableHead(context, liveHash);
            rebased = rebaseAppendPayload(nextPayload, liveHash);
          } catch {
            rebased = nextPayload;
          }
        }
        if (rebased.baseStateVectorHash !== nextPayload.baseStateVectorHash) {
          nextPayload = rebased;
          rebaseAttempts += 1;
          attempt += 1;
          process.stderr.write(
            `[durable append] rebasing overlapping Yjs CAS onto ${rebased.baseStateVectorHash}\n`,
          );
          continue;
        }
      }
      const persistenceMessage = collaborationFailureMessage(error);
      const persistenceRecord = {
        code:
          persistenceMessage.match(/COLLABORATION_[A-Z_]+/)?.[0] ??
          "COLLABORATION_APPEND_FAILED",
        at: Date.now(),
        attempt: attempt + 1,
      };
      if (permanentPersistenceFailure(error)) {
        lastPersistenceFailure = persistenceRecord;
        process.stderr.write(`[durable append] ${persistenceMessage}\n`);
        forceCanonicalReconnect(entries[0].context, persistenceMessage);
        throw error;
      }
      attempt += 1;
      if (attempt >= 12) {
        lastPersistenceFailure = persistenceRecord;
        // Exhausted transient retries still leave the shared room ahead of Convex.
        // Surface unsynchronized/reconnect honesty instead of dropping the ack.
        forceCanonicalReconnect(entries[0].context, persistenceMessage);
        throw error;
      }
      const retryMs = Math.min(
        PERSISTENCE_RETRY_MAX_MS,
        collaborationRetryDelayMs(error, attempt - 1),
      );
      process.stderr.write(
        `[durable append] retrying in ${retryMs}ms (${persistenceMessage})\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
}

async function persistAcceptedMessages(document, entries, snapshotAfterFirst) {
  if (!entries.length || !snapshotAfterFirst) return;
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, snapshotAfterFirst);
    let index = 0;
    let lastCheckpoint = null;
    while (index < entries.length) {
      const group = [entries[index]];
      if (index > 0) Y.applyUpdate(scratch, entries[index].documentUpdate);
      index += 1;
      while (
        index < entries.length &&
        samePersistenceBatch(group[0], entries[index])
      ) {
        Y.applyUpdate(scratch, entries[index].documentUpdate);
        group.push(entries[index]);
        index += 1;
      }
      const first = group[0];
      const last = group[group.length - 1];
      const nativeAfter = isNativeArtifactDocument(scratch);
      const afterProjection = nativeAfter
        ? nativeArtifactProjection(scratch, first.context.schemaVersion)
        : null;
      const regionIds = nativeAfter
        ? nativeChangedRegionIds(first.nativeProjectionBefore, afterProjection)
        : [...new Set(group.flatMap((entry) => entry.regionIds))];
      if (!regionIds.length) {
        for (const entry of group)
          sendGatewayState(entry.connection, {
            type: "spectra.durable_ack",
            updateIds: [entry.messageId],
          });
        continue;
      }
      const immediateProjection =
        first.context.actorKind === "ai" ||
        group.some((entry) => entry.nativeInitialization);
      const projectionJson = immediateProjection
        ? artifactProjection(scratch, first.context.schemaVersion)
        : null;
      const projectionPayloadRef = null;
      const projectionPayloadDigest = null;
      const projectionHotStub = null;
      const mergePlan = planMergedUpdatePersist(
        Y,
        group.map((entry) => entry.documentUpdate),
        MAX_DURABLE_UPDATE_BYTES,
      );
      let appendResult = null;
      let baseHash = appendBaseStateVectorHash({
        lastPersistedHash: durableHeads.get(durableHeadKey(first.context)),
        capturedBaseHash: first.baseStateVectorHash,
      });
      const nativeInitialization = group.some(
        (entry) => entry.nativeInitialization,
      );
      if (mergePlan.mode === "spill") {
        const storedPayload = await bridge("storeDurablePayload", {
          artifactId: first.context.artifactId,
          partitionKey: first.context.partitionKey,
          accountId: first.context.accountId,
          kind: "yjs-update",
          digest: mergePlan.manifest.digest,
          mediaType: mergePlan.manifest.mediaType,
          bytesBase64: Buffer.from(mergePlan.update).toString("base64"),
      policyVersion: first.context.policyVersion,
        });
        const manifest = {
          ...mergePlan.manifest,
          payloadRef: storedPayload.payloadRef,
        };
        const updateHash = createHash("sha256")
          .update(mergePlan.update)
          .digest("base64url");
        appendResult = await appendWithRetry(
          {
            artifactId: first.context.artifactId,
            partitionKey: first.context.partitionKey,
            accountId: first.context.accountId,
            actorKind: first.context.actorKind,
            clientId: first.context.clientId,
            policyVersion: first.context.policyVersion,
            idempotencyKey: `${first.context.clientId}:${updateHash}`,
            update: "",
            baseStateVectorHash: baseHash,
            stateVectorHash: last.stateVectorHash,
            regionIds,
            nativeInitialization,
            projectionJson,
            projectionHash: projectionJson
              ? createHash("sha256").update(projectionJson).digest("base64url")
              : projectionPayloadDigest,
            payloadManifest: manifest,
            payloadRef: storedPayload.payloadRef,
            payloadDigest: manifest.digest,
            byteLength: mergePlan.update.byteLength,
            projectionPayloadRef,
            projectionPayloadDigest,
            projectionHotStub,
          },
          group,
        );
      } else {
        const batches = mergePlan.batches;
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          const batch = batches[batchIndex];
          const updateHash = createHash("sha256")
            .update(batch.merged)
            .digest("base64url");
          const isLast = batchIndex === batches.length - 1;
          appendResult = await appendWithRetry(
            {
              artifactId: first.context.artifactId,
              partitionKey: first.context.partitionKey,
              accountId: first.context.accountId,
              actorKind: first.context.actorKind,
              clientId: first.context.clientId,
              policyVersion: first.context.policyVersion,
              idempotencyKey: `${first.context.clientId}:${updateHash}`,
              update: Buffer.from(batch.merged).toString("base64"),
              baseStateVectorHash: baseHash,
              stateVectorHash: last.stateVectorHash,
              regionIds,
              nativeInitialization: nativeInitialization && batchIndex === 0,
              // Projection rides the final sub-batch so split merges do not
              // rewrite the hot artifact row multiple times.
              projectionJson: isLast ? projectionJson : null,
              projectionHash:
                isLast && projectionJson
                  ? createHash("sha256")
                      .update(projectionJson)
                      .digest("base64url")
                  : isLast
                    ? projectionPayloadDigest
                    : null,
              projectionPayloadRef: isLast ? projectionPayloadRef : null,
              projectionPayloadDigest: isLast
                ? projectionPayloadDigest
                : null,
              projectionHotStub: isLast ? projectionHotStub : null,
            },
            group,
          );
          baseHash = last.stateVectorHash;
        }
      }
      lastCheckpoint = {
        artifactId: first.context.artifactId,
        partitionKey: first.context.partitionKey,
        accountId: first.context.accountId,
        clientId: first.context.clientId,
        policyVersion: first.context.policyVersion,
        schemaVersion: first.context.schemaVersion,
        roomId: first.context.roomId,
        stateVectorHash: last.stateVectorHash,
        throughSequence: appendResult?.sequence ?? null,
      };
    }
    if (lastCheckpoint) checkpointScheduler(document).note(lastCheckpoint);
  } finally {
    scratch.destroy();
  }
}

function schedulePersistence(document, entry) {
  const queue = persistenceQueue(document);
  if (queue.pending.length === 0)
    queue.snapshotAfterFirst = Y.encodeStateAsUpdate(document);
  queue.pending.push(entry);
  sendGatewayState(entry.connection, {
    type: "spectra.durable_pending",
    updateIds: [entry.messageId],
  });
  if (queue.timer) clearTimeout(queue.timer);
  queue.timer = setTimeout(() => {
    queue.timer = null;
    void flushPersistence(document).catch(() => undefined);
  }, PERSISTENCE_DEBOUNCE_MS);
  queue.timer.unref?.();
}

async function flushPersistence(document) {
  const queue = documentPersistenceQueues.get(document);
  if (!queue) return;
  clearTimeout(queue.timer);
  queue.timer = null;
  const entries = queue.pending.splice(0);
  if (!entries.length) return queue.chain.persistTail;
  const snapshotAfterFirst = queue.snapshotAfterFirst;
  queue.snapshotAfterFirst = null;
  try { return await queue.chain.enqueue({ entries, snapshotAfterFirst }); }
  catch (error) {
    lastPersistenceFailure = { code: "COLLABORATION_APPEND_FAILED", at: Date.now(), attempt: 1 };
    forceCanonicalReconnect(entries[0].context, collaborationFailureMessage(error));
    throw error;
  }
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

function expandProjection(value, regions, active = new Set()) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof value[REGION_MARKER] === "string"
  ) {
    const regionId = value[REGION_MARKER];
    if (active.has(regionId)) throw new Error("COLLABORATION_PROJECTION_CYCLE");
    const encoded = regions.get(regionId);
    if (typeof encoded !== "string")
      throw new Error("COLLABORATION_PROJECTION_REGION_MISSING");
    const nextActive = new Set(active);
    nextActive.add(regionId);
    return expandProjection(JSON.parse(encoded).value, regions, nextActive);
  }
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Array.isArray(value[CODE_LINES_MARKER]) &&
    value[CODE_LINES_MARKER].every((regionId) => typeof regionId === "string")
  ) {
    return value[CODE_LINES_MARKER].map((regionId) => {
      if (active.has(regionId))
        throw new Error("COLLABORATION_PROJECTION_CYCLE");
      const encoded = regions.get(regionId);
      if (typeof encoded !== "string")
        throw new Error("COLLABORATION_PROJECTION_REGION_MISSING");
      const nextActive = new Set(active);
      nextActive.add(regionId);
      const line = expandProjection(
        JSON.parse(encoded).value,
        regions,
        nextActive,
      );
      return typeof line === "string" ? line : String(line ?? "");
    }).join("\n");
  }
  if (Array.isArray(value))
    return value.map((entry) => expandProjection(entry, regions, active));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        expandProjection(entry, regions, active),
      ]),
    );
  return value;
}

function assertSharedTimetableProjection(content) {
  if (!content || typeof content !== "object" || Array.isArray(content))
    throw new Error("COLLABORATION_TIMETABLE_PROJECTION_INVALID");
  for (const forbidden of ["view", "availability", "preferences"])
    if (Object.prototype.hasOwnProperty.call(content, forbidden))
      throw new Error("COLLABORATION_TIMETABLE_PERSONAL_STATE_FORBIDDEN");
  const layers = Array.isArray(content.layers) ? content.layers : [];
  for (const layer of layers) {
    if (!layer || typeof layer !== "object" || Array.isArray(layer))
      throw new Error("COLLABORATION_TIMETABLE_PROJECTION_INVALID");
    const authority =
      typeof layer.authority === "string" ? layer.authority : undefined;
    if (
      layer.private === true ||
      authority === "user" ||
      ((layer.kind === "personal" || layer.kind === "study") &&
        authority !== "workspace" &&
        authority !== "school" &&
        authority !== "external")
    )
      throw new Error("COLLABORATION_TIMETABLE_PERSONAL_LAYER_FORBIDDEN");
  }
  const sharedLayerIds = new Set(
    layers.flatMap((layer) => (typeof layer.id === "string" ? [layer.id] : [])),
  );
  const events = Array.isArray(content.events) ? content.events : [];
  for (const event of events) {
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      Object.prototype.hasOwnProperty.call(event, "overlay") ||
      typeof event.layerId !== "string" ||
      !sharedLayerIds.has(event.layerId)
    )
      throw new Error("COLLABORATION_TIMETABLE_PERSONAL_EVENT_FORBIDDEN");
  }
}

function artifactProjection(document, fallbackSchemaVersion) {
  const nativeProjection = nativeArtifactProjection(
    document,
    fallbackSchemaVersion,
  );
  if (nativeProjection) {
    if (nativeProjection.typeKey === "timetable")
      assertSharedTimetableProjection(nativeProjection.content);
    // Size gates live in planProjectionStorage (spill) or Convex parse
    // (fail-closed). Returning the string here keeps spill reachable.
    return JSON.stringify(nativeProjection);
  }
  const metadata = document.getMap(META_MAP);
  if (metadata.get("initialized") !== true) return null;
  const rootTemplate = metadata.get("rootTemplate");
  const title = metadata.get("title");
  const summary = metadata.get("summary");
  const tags = metadata.get("tags");
  const typeKey = metadata.get("typeKey");
  const schemaVersion = metadata.get("schemaVersion");
  if (
    typeof rootTemplate !== "string" ||
    typeof title !== "string" ||
    typeof typeKey !== "string" ||
    typeof schemaVersion !== "number" ||
    !Array.isArray(tags) ||
    !tags.every((tag) => typeof tag === "string")
  )
    throw new Error("COLLABORATION_PROJECTION_INVALID");
  const content = expandProjection(
    JSON.parse(rootTemplate),
    document.getMap(REGION_MAP),
  );
  if (typeKey === "timetable") assertSharedTimetableProjection(content);
  const projection = JSON.stringify({
    title,
    summary: typeof summary === "string" && summary ? summary : undefined,
    tags,
    typeKey,
    schemaVersion,
    content,
  });
  // Do not null oversize here — callers spill via planProjectionStorage or
  // Convex rejects inline writes fail-closed.
  return projection;
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
  // Handshake JWT expiry is enforced by jwtVerify on connect. Closing an
  // already-authenticated socket at `exp` turns every 10-minute classroom into
  // a reconnect storm (4205 / unauthenticated queue overflow). Revocation is
  // Convex authorize + ACCESS_REVOKED, not wall-clock token expiry.
  try {
    const result = await bridge(
      "authorize",
      {
        accountId: context.accountId,
        artifactId: context.artifactId,
        partitionKey: context.partitionKey,
        policyVersion: context.policyVersion,
      },
      { retryAttempts: 1 },
    );
    if (!result?.allowed) {
      if (result?.reason === "unavailable")
        throw new Error("COLLABORATION_GATEWAY_UNAVAILABLE");
      throw new Error("COLLABORATION_ACCESS_REVOKED");
    }
    context.canModify = result.canModify === true;
    context.authorizationCheckedAt = Date.now();
    return context;
  } catch (error) {
    if (
      isTransientCollaborationFailure(error) &&
      context.authorizationCheckedAt
    ) {
      process.stderr.write(
        `[reauthorize] transient Convex failure; keeping last authorization\n`,
      );
      return context;
    }
    throw error;
  }
}

async function reauthorize(context, { allowStale = false } = {}) {
  const now = Date.now();
  if (
    context.authorizationCheckedAt &&
    now - context.authorizationCheckedAt < COLLABORATION_AUTHORIZE_CACHE_MS
  )
    return context;
  // Sync beforeHandleMessage must not await Convex. A 1s authorize timeout on a
  // large sheet previously closed the socket (Aw Snap / reconnect). Keep the
  // last good grant and refresh in the background; connect/load still block.
  if (allowStale && context.authorizationCheckedAt) {
    if (!context.authorizationRefreshInFlight) {
      context.authorizationRefreshInFlight = refreshAuthorization(context)
        .catch((error) => {
          const reason =
            error instanceof Error ? error.message : String(error);
          if (
            reason.includes("COLLABORATION_ACCESS_REVOKED") ||
            reason.includes("COLLABORATION_READ_ONLY")
          ) {
            forceCanonicalReconnect(context, reason);
          } else {
            process.stderr.write(`[reauthorize:bg] ${reason}\n`);
          }
        })
        .finally(() => {
          context.authorizationRefreshInFlight = null;
        });
    }
    return context;
  }
  return refreshAuthorization(context);
}

const server = new Server({
  name: "spectra-collaboration",
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
    activeConnections.add(connection);
    connection.onClose(() => activeConnections.delete(connection));
  },

  async beforeHandleMessage({
    context,
    document,
    update: frame,
    socketId,
    connection,
  }) {
    await reauthorize(context, { allowStale: true });
    const incomingUpdate = extractYjsUpdate(frame);
    if (!incomingUpdate || incomingUpdate.byteLength === 0) return;
    // Hocuspocus can run hooks from different sockets concurrently. Hold a
    // per-document gate through `afterHandleMessage`, when the accepted update
    // has actually been applied to the shared Y.Doc. Without this, two valid
    // edits can both derive the same base vector and one is rejected as stale
    // even when the collaborators changed independent regions.
    await acquireDocumentMessage(document, socketId);
    try {
      const before = artifactModelState(document);
      const nativeBefore = isNativeArtifactDocument(document);
      if (!context.canModify) throw new Error("COLLABORATION_READ_ONLY");
      const baseStateVectorHash = documentStateVectorHash(document);
      const nativeProjectionBefore = nativeBefore
        ? nativeArtifactProjection(document, context.schemaVersion)
        : null;
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
        return;
      }
      if (documentUpdate.byteLength > MAX_ASSEMBLED_BYTES) {
        process.stderr.write(
          `[beforeHandleMessage] oversized canonical delta incoming=${incomingUpdate.byteLength} durable=${documentUpdate.byteLength} canonical=${Y.encodeStateAsUpdate(document).byteLength} native=${nativeBefore}\n`,
        );
        throw new Error("COLLABORATION_GATEWAY_UPDATE_SIZE");
      }
      const updateHash = createHash("sha256")
        .update(documentUpdate)
        .digest("base64url");
      // Keep the pre-apply hook deliberately cheap. Hocuspocus applies and
      // broadcasts as soon as this returns; projection and Convex persistence
      // are batched only after peers have received the keystroke.
      messageQueue(socketId).push({
        context: { ...context },
        connection,
        documentUpdate,
        before,
        nativeBefore,
        nativeProjectionBefore,
        baseStateVectorHash,
        messageId: `${context.clientId}:${updateHash}`,
      });
    } catch (error) {
      releaseDocumentMessage(socketId);
      const reason =
        error instanceof Error
          ? error.message
          : "COLLABORATION_UPDATE_REJECTED";
      process.stderr.write(`[beforeHandleMessage] ${reason}\n`);
      // A rejected update leaves this peer's local Y.Doc ahead of the canonical
      // room. Emit durable_failed before the close so the client marks
      // unsynchronized with a truthful message instead of a silent reconnect.
      rejectPeerUpdate(connection, reason);
      throw error;
    }
  },

  async afterHandleMessage({ socketId, document }) {
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
      schedulePersistence(document, {
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
      // The per-document gate protects only apply ordering. Durable I/O happens
      // behind the queue and must never hold the next collaborator's message.
      releaseDocumentMessage(socketId);
    }
  },

  async beforeHandleAwareness({ context, states }) {
    if (!context) {
      states.clear();
      return;
    }
    await reauthorize(context, { allowStale: true });
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

  async onLoadDocument({ context }) {
    await reauthorize(context);
    let stored = await bridge("load", {
      artifactId: context.artifactId,
      partitionKey: context.partitionKey,
      accountId: context.accountId,
      policyVersion: context.policyVersion,
    });
    let storedDocument = applyStoredRoomUpdates(Y, stored);
    rememberDurableHead(context, stored?.liveStateVectorHash);
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
              rememberDurableHead(context, stored?.liveStateVectorHash);
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
              rememberDurableHead(context, stored?.liveStateVectorHash);
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
      rememberDurableHead(context, stateVectorHash);
    }
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
          for (const connection of group.connections) {
            const context = connection.context;
            const stale =
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
        } catch {
          // A transient Convex failure must not evict authorized collaborators.
          // Message authorization remains fail-closed and the next sweep retries.
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
  clearInterval(policySweep);
  await Promise.all(
    [...checkpointSchedulers].map((scheduler) => scheduler.flush()),
  );
  for (const scheduler of checkpointSchedulers) scheduler.dispose();
  checkpointSchedulers.clear();
  await server.destroy();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
