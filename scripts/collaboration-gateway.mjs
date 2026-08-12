import { Server } from "@hocuspocus/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { jwtVerify } from "jose";
import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import { messageYjsSyncStep2, messageYjsUpdate } from "y-protocols/sync";
import {
  initializeNativeArtifactDocument,
  isNativeArtifactDocument,
  nativeArtifactProjection,
  NATIVE_PROJECTION_REGION,
} from "./collaboration-native-projection.mjs";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
const tokenSecret = process.env.SPECTRA_COLLAB_TOKEN_SECRET;
const bridgeKey = process.env.SPECTRA_COLLAB_BRIDGE_KEY;
if (!convexUrl) throw new Error("COLLABORATION_CONVEX_URL_MISSING");
if (!tokenSecret || tokenSecret.length < 32)
  throw new Error("COLLABORATION_TOKEN_CONFIG_MISSING");
if (!bridgeKey || bridgeKey.length < 32)
  throw new Error("COLLABORATION_BRIDGE_CONFIG_MISSING");

const convex = new ConvexHttpClient(convexUrl, { logger: false });
const exchange = makeFunctionReference("collaborationGatewayBridge:exchange");
const jwtKey = new TextEncoder().encode(tokenSecret);
const META_MAP = "spectra:artifact-meta";
const REGION_MAP = "spectra:artifact-regions";
const REGION_MARKER = "$spectraRegion";
const CODE_LINES_MARKER = "$spectraCodeLines";
const GATEWAY_PROTOCOL_VERSION = 1;
const PERSISTENCE_DEBOUNCE_MS = 180;
const PERSISTENCE_RETRY_MAX_MS = 5_000;
const activeConnections = new Set();
const documentMessageTails = new WeakMap();
const pendingMessageReleases = new Map();
const acceptedDocumentMessages = new Map();
const documentPersistenceQueues = new WeakMap();
let policySweepRunning = false;

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

function persistenceQueue(document) {
  const existing = documentPersistenceQueues.get(document);
  if (existing) return existing;
  const created = {
    pending: [],
    snapshotAfterFirst: null,
    timer: null,
    tail: Promise.resolve(),
  };
  documentPersistenceQueues.set(document, created);
  return created;
}

function samePersistenceActor(left, right) {
  return (
    left.context.accountId === right.context.accountId &&
    left.context.actorKind === right.context.actorKind &&
    left.context.clientId === right.context.clientId &&
    left.context.artifactId === right.context.artifactId &&
    left.context.partitionKey === right.context.partitionKey &&
    left.context.policyVersion === right.context.policyVersion
  );
}

function permanentPersistenceFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /COLLABORATION_(?:ACCESS_REVOKED|TOKEN_EXPIRED|READ_ONLY|BASE_STATE_STALE|REGION_|AI_ATTRIBUTION|NATIVE_PROJECTION|MODEL_CHANGE|GATEWAY_(?:FORBIDDEN|UNAVAILABLE|UPDATE_(?:SIZE|INVALID)))/.test(
    message,
  );
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
      message:
        "This edit could not be accepted. Spectra is reloading the latest permitted version while keeping the local draft available for review.",
    });
    try {
      peer.webSocket.close(4409, reason);
    } catch {
      // Another policy path may already have closed the peer.
    }
  }
}

async function appendWithRetry(payload, entries) {
  let attempt = 0;
  for (;;) {
    try {
      const result = await bridge("append", payload);
      for (const entry of entries)
        sendGatewayState(entry.connection, {
          type: "spectra.durable_ack",
          updateIds: [entry.messageId],
        });
      return result;
    } catch (error) {
      if (permanentPersistenceFailure(error)) {
        const reason =
          error instanceof Error ? error.message : "COLLABORATION_UPDATE_REJECTED";
        process.stderr.write(`[durable append] ${reason}\n`);
        forceCanonicalReconnect(entries[0].context, reason);
        throw error;
      }
      attempt += 1;
      const retryMs = Math.min(
        PERSISTENCE_RETRY_MAX_MS,
        150 * 2 ** Math.min(attempt - 1, 6),
      );
      process.stderr.write(
        `[durable append] retrying in ${retryMs}ms (${error instanceof Error ? error.message : String(error)})\n`,
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
    while (index < entries.length) {
      const group = [entries[index]];
      if (index > 0) Y.applyUpdate(scratch, entries[index].documentUpdate);
      index += 1;
      while (
        index < entries.length &&
        samePersistenceActor(group[0], entries[index])
      ) {
        Y.applyUpdate(scratch, entries[index].documentUpdate);
        group.push(entries[index]);
        index += 1;
      }
      const first = group[0];
      const last = group[group.length - 1];
      const nativeAfter = isNativeArtifactDocument(scratch);
      const regionIds = nativeAfter
        ? [NATIVE_PROJECTION_REGION]
        : [...new Set(group.flatMap((entry) => entry.regionIds))];
      if (!regionIds.length) {
        for (const entry of group)
          sendGatewayState(entry.connection, {
            type: "spectra.durable_ack",
            updateIds: [entry.messageId],
          });
        continue;
      }
      const projectionJson = artifactProjection(
        scratch,
        first.context.schemaVersion,
      );
      const mergedUpdate = Y.mergeUpdates(
        group.map((entry) => entry.documentUpdate),
      );
      const updateHash = createHash("sha256")
        .update(mergedUpdate)
        .digest("base64url");
      await appendWithRetry(
        {
          artifactId: first.context.artifactId,
          partitionKey: first.context.partitionKey,
          accountId: first.context.accountId,
          actorKind: first.context.actorKind,
          clientId: first.context.clientId,
          policyVersion: first.context.policyVersion,
          idempotencyKey: `${first.context.clientId}:${updateHash}`,
          update: Buffer.from(mergedUpdate).toString("base64"),
          baseStateVectorHash: first.baseStateVectorHash,
          stateVectorHash: last.stateVectorHash,
          regionIds,
          nativeInitialization: group.some(
            (entry) => entry.nativeInitialization,
          ),
          projectionJson,
          projectionHash: projectionJson
            ? createHash("sha256").update(projectionJson).digest("base64url")
            : null,
        },
        group,
      );
    }
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
    const entries = queue.pending.splice(0);
    const snapshotAfterFirst = queue.snapshotAfterFirst;
    queue.snapshotAfterFirst = null;
    queue.tail = queue.tail
      .then(() => persistAcceptedMessages(document, entries, snapshotAfterFirst))
      .catch(() => undefined);
  }, PERSISTENCE_DEBOUNCE_MS);
  queue.timer.unref?.();
}

function bridge(operation, payload) {
  const payloadJson = JSON.stringify(payload);
  const timestamp = Date.now();
  const nonce = randomBytes(24).toString("base64url");
  const digest = createHash("sha256").update(payloadJson).digest("base64url");
  const signature = createHmac("sha256", bridgeKey)
    .update([operation, timestamp, nonce, digest].join("|"))
    .digest("base64url");
  return convex.action(exchange, {
    operation,
    payloadJson,
    timestamp,
    nonce,
    signature,
  });
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
  const state =
    boundedWhole ??
    {
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
        ? source.heldRegionIds
            .filter((id) => typeof id === "string")
            .slice(0, 64)
        : undefined,
      at: source.at,
    };
  if (state.v !== 2) return undefined;
  const actor =
    state.actor && typeof state.actor === "object" && !Array.isArray(state.actor)
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
    const projection = JSON.stringify(nativeProjection);
    if (projection.length > 900_000)
      throw new Error("COLLABORATION_PROJECTION_SIZE");
    return projection;
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
  return projection.length <= 900_000 ? projection : null;
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

async function reauthorize(context) {
  const now = Date.now();
  if (
    context.authorizationCheckedAt &&
    now - context.authorizationCheckedAt < 1_500
  )
    return context;
  if (context.expiresAt <= Math.floor(now / 1000))
    throw new Error("COLLABORATION_TOKEN_EXPIRED");
  const result = await bridge("authorize", {
    accountId: context.accountId,
    artifactId: context.artifactId,
    partitionKey: context.partitionKey,
    policyVersion: context.policyVersion,
  });
  if (!result?.allowed) throw new Error("COLLABORATION_ACCESS_REVOKED");
  context.canModify = result.canModify === true;
  context.authorizationCheckedAt = now;
  return context;
}

const server = new Server({
  name: "spectra-collaboration",
  port: Number(process.env.SPECTRA_COLLAB_PORT || 1234),
  timeout: 30_000,
  debounce: 2_000,
  maxDebounce: 10_000,
  quiet: true,
  websocketOptions: { maxPayload: 256 * 1024 },
  maxUnauthenticatedQueueSize: 256 * 1024,
  maxUnauthenticatedQueueMessages: 64,
  maxPendingDocuments: 4,

  async onRequest({ request, response }) {
    if (request.url !== "/_spectra/health") return;
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify({
        service: "spectra-collaboration-gateway",
        protocolVersion: GATEWAY_PROTOCOL_VERSION,
        status: "ready",
      }),
    );
    // Hocuspocus uses an empty rejection to signal that a request hook has
    // fully handled the response and its default welcome body should not run.
    throw null;
  },

  async onAuthenticate({ token, documentName, connectionConfig }) {
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
      connectionConfig.readOnly = !context.canModify;
      return context;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown authentication failure";
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
    await reauthorize(context);
    const documentUpdate = extractYjsUpdate(frame);
    if (!documentUpdate || documentUpdate.byteLength === 0) return;
    // Hocuspocus can run hooks from different sockets concurrently. Hold a
    // per-document gate through `afterHandleMessage`, when the accepted update
    // has actually been applied to the shared Y.Doc. Without this, two valid
    // edits can both derive the same base vector and one is rejected as stale
    // even when the collaborators changed independent regions.
    await acquireDocumentMessage(document, socketId);
    try {
      if (documentUpdate.byteLength > 256 * 1024)
        throw new Error("COLLABORATION_GATEWAY_UPDATE_SIZE");
      const before = artifactModelState(document);
      const nativeBefore = isNativeArtifactDocument(document);
      if (!context.canModify) throw new Error("COLLABORATION_READ_ONLY");
      const baseStateVectorHash = documentStateVectorHash(document);
      const probe = new Y.Doc();
      try {
        Y.applyUpdate(probe, Y.encodeStateAsUpdate(document));
        Y.applyUpdate(probe, documentUpdate);
        // Sync step 2 often contains the complete client state on room join.
        // It must still be accepted, but if it adds nothing to the canonical
        // room it does not enter the durable queue. Keeping a queued record for
        // that no-op made `afterHandleMessage` consume the next real update,
        // so the provider never received its SyncStatus acknowledgement and
        // authoring surfaces stayed on “Waiting to sync”.
        if (documentStateVectorHash(probe) === baseStateVectorHash) {
          releaseDocumentMessage(socketId);
          return;
        }
      } finally {
        probe.destroy();
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
        baseStateVectorHash,
        messageId: `${context.clientId}:${updateHash}`,
      });
    } catch (error) {
      releaseDocumentMessage(socketId);
      const reason =
        error instanceof Error ? error.message : "COLLABORATION_UPDATE_REJECTED";
      process.stderr.write(`[beforeHandleMessage] ${reason}\n`);
      // A rejected update leaves this peer's local Y.Doc ahead of the canonical
      // room. Force a canonical reconnect instead of letting it advertise a
      // false synchronized state until a generic client timeout expires.
      try {
        connection.webSocket.close(4409, "COLLABORATION_UPDATE_REJECTED");
      } catch {
        // The peer may already have disconnected while authorization ran.
      }
      throw error;
    }
  },

  async afterHandleMessage({ socketId, document }) {
    const queue = acceptedDocumentMessages.get(socketId);
    const accepted = queue?.shift();
    if (!queue?.length) acceptedDocumentMessages.delete(socketId);
    try {
      if (!accepted) return;
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
        error instanceof Error ? error.message : "COLLABORATION_UPDATE_REJECTED";
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
          ...(interactionState
            ? { interactionState }
            : {}),
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
    const stored = await bridge("load", {
      artifactId: context.artifactId,
      partitionKey: context.partitionKey,
    });
    const updates = [];
    if (stored?.snapshot?.update)
      updates.push(
        new Uint8Array(Buffer.from(stored.snapshot.update, "base64")),
      );
    for (const entry of stored?.updates ?? [])
      updates.push(new Uint8Array(Buffer.from(entry.update, "base64")));
    if (updates.length > 0) {
      const storedDocument = new Y.Doc();
      Y.applyUpdate(storedDocument, Y.mergeUpdates(updates));
      if (isNativeArtifactDocument(storedDocument))
        return Y.encodeStateAsUpdate(storedDocument);
    }
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
      await bridge("bootstrap", {
        artifactId: context.artifactId,
        partitionKey: context.partitionKey,
        accountId: context.accountId,
        clientId: context.clientId,
        policyVersion: context.policyVersion,
        artifactUpdatedAt: stored.initialProjection.artifactUpdatedAt,
        expectedNextSequence: stored.nextSequence,
        update: Buffer.from(update).toString("base64"),
        stateVectorHash,
        projectionJson,
        projectionHash: createHash("sha256")
          .update(projectionJson)
          .digest("base64url"),
      });
    }
    return document;
  },

  async onStoreDocument({ document, lastContext }) {
    if (!lastContext) return;
    await reauthorize(lastContext);
    const stored = await bridge("load", {
      artifactId: lastContext.artifactId,
      partitionKey: lastContext.partitionKey,
    });
    const throughSequence = (stored?.nextSequence ?? 1) - 1;
    const currentSnapshotSequence = stored?.snapshot?.throughSequence ?? 0;
    if (
      !stored?.roomId ||
      throughSequence <= currentSnapshotSequence ||
      throughSequence <= 0
    )
      return;
    const update = Y.encodeStateAsUpdate(document);
    const stateVector = Y.encodeStateVector(document);
    if (update.byteLength > 760 * 1024 || stateVector.byteLength > 128 * 1024)
      return;
    await bridge("snapshot", {
      artifactId: lastContext.artifactId,
      partitionKey: lastContext.partitionKey,
      roomId: stored.roomId,
      throughSequence,
      update: Buffer.from(update).toString("base64"),
      stateVector: Buffer.from(stateVector).toString("base64"),
      contentHash: createHash("sha256").update(update).digest("base64url"),
      schemaVersion: stored.schemaVersion,
    });
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
}, 1_000);
policySweep.unref?.();

await server.listen();
process.stdout.write(
  `Spectra collaboration gateway listening on ${process.env.SPECTRA_COLLAB_PORT || 1234}\n`,
);

async function shutdown() {
  clearInterval(policySweep);
  await server.destroy();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
