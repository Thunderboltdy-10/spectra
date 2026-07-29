import { Server } from "@hocuspocus/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { jwtVerify } from "jose";
import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import { messageYjsSyncStep2, messageYjsUpdate } from "y-protocols/sync";

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
const activeConnections = new Set();
const documentMessageTails = new WeakMap();
const pendingMessageReleases = new Map();
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

function artifactProjection(document) {
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
  if (outerType !== 0 && outerType !== 4) return null;
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
      policyVersion: claims.policyVersion,
      schemaVersion: claims.schemaVersion,
      expiresAt: claims.exp,
      canModify: claims.level === "modify",
      authorizationCheckedAt: 0,
    };
    await reauthorize(context);
    connectionConfig.readOnly = !context.canModify;
    return context;
  },

  async connected({ connection }) {
    activeConnections.add(connection);
    connection.onClose(() => activeConnections.delete(connection));
  },

  async beforeHandleMessage({ context, document, update: frame, socketId }) {
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
      const baseStateVectorHash = createHash("sha256")
        .update(Y.encodeStateVector(document))
        .digest("base64url");
      const scratch = new Y.Doc();
      try {
        Y.applyUpdate(scratch, Y.encodeStateAsUpdate(document));
        Y.applyUpdate(scratch, documentUpdate);
        const after = artifactModelState(scratch);
        const regionIds = changedArtifactRegions(before, after);
        if (regionIds.length === 0) return;
        if (!context.canModify) throw new Error("COLLABORATION_READ_ONLY");
        if (regionIds.length > 128)
          throw new Error("COLLABORATION_MODEL_CHANGE_UNRECOGNIZED");
        const stateVectorHash = createHash("sha256")
          .update(Y.encodeStateVector(scratch))
          .digest("base64url");
        const updateHash = createHash("sha256")
          .update(documentUpdate)
          .digest("base64url");
        const projectionJson = artifactProjection(scratch);
        // Persist and authorize the exact semantic mutation before Hocuspocus is
        // allowed to apply or broadcast it. A rejected claim can therefore never
        // contaminate the shared in-memory document.
        await bridge("append", {
          artifactId: context.artifactId,
          partitionKey: context.partitionKey,
          accountId: context.accountId,
          clientId: context.clientId,
          policyVersion: context.policyVersion,
          idempotencyKey: `${context.clientId}:${updateHash}`,
          update: Buffer.from(documentUpdate).toString("base64"),
          baseStateVectorHash,
          stateVectorHash,
          regionIds,
          projectionJson,
          projectionHash: projectionJson
            ? createHash("sha256").update(projectionJson).digest("base64url")
            : null,
        });
      } finally {
        scratch.destroy();
      }
    } catch (error) {
      releaseDocumentMessage(socketId);
      throw error;
    }
  },

  async afterHandleMessage({ socketId }) {
    releaseDocumentMessage(socketId);
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
    return updates.length > 0 ? Y.mergeUpdates(updates) : new Y.Doc();
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
