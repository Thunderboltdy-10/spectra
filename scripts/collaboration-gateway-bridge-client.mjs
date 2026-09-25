import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { isTransientCollaborationFailure } from "./collaboration-persist.mjs";
import { contentDependencies } from "../shared/durable-dependencies.mjs";

const gatewayExchange = makeFunctionReference(
  "collaborationGatewayBridge:exchange",
);

/**
 * The gateway and verifier probes must sign the exact same Convex bridge
 * envelope. Keeping the signer here prevents the load harness from becoming a
 * second persistence protocol.
 *
 * @param {{
 *   convexUrl: string,
 *   bridgeKey: string,
 *   client?: ConvexHttpClient,
 *   now?: () => number,
 *   nonce?: () => string,
 *   retryAttempts?: number,
 *   retryDelayMs?: (attempt: number) => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} options
 */
export function createCollaborationGatewayBridgeClient({
  convexUrl,
  bridgeKey,
  client,
  now = () => Date.now(),
    nonce = () => randomBytes(24).toString("base64url"),
    retryAttempts = 3,
    retryDelayMs = (attempt) => Math.min(150 * 2 ** attempt, 2_000),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) {
  if (!convexUrl) throw new Error("COLLABORATION_CONVEX_URL_MISSING");
  if (!bridgeKey || bridgeKey.length < 32)
    throw new Error("COLLABORATION_BRIDGE_CONFIG_MISSING");
  const convex = client ?? new ConvexHttpClient(convexUrl, { logger: false });

  async function exchange(operation, payload, options = {}) {
    const attempts = options.retryAttempts ?? retryAttempts;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const payloadJson = JSON.stringify(payload);
      if (Buffer.byteLength(payloadJson, "utf8") > 1500 * 1024)
        throw new Error("COLLABORATION_BRIDGE_ENVELOPE_SIZE");
      const timestamp = now();
      const requestNonce = nonce();
      const digest = createHash("sha256")
        .update(payloadJson)
        .digest("base64url");
      const signature = createHmac("sha256", bridgeKey)
        .update([operation, timestamp, requestNonce, digest].join("|"))
        .digest("base64url");
      if (Buffer.byteLength(JSON.stringify({ operation, payloadJson, timestamp, nonce: requestNonce, signature }), "utf8") + 128 > 1500 * 1024)
        throw new Error("COLLABORATION_BRIDGE_ENVELOPE_SIZE");
      try {
        return await convex.action(gatewayExchange, {
          operation,
          payloadJson,
          timestamp,
          nonce: requestNonce,
          signature,
        });
      } catch (error) {
        lastError = error;
        if (
          !isTransientCollaborationFailure(error) ||
          attempt === attempts - 1
        )
          throw error;
        await sleep(retryDelayMs(attempt));
      }
    }
    throw lastError;
  }

  async function store(payload, options) {
    const { bytesBase64, ...metadata } = payload;
    const bytes = Buffer.from(bytesBase64, "base64");
    if (bytes.length === 0 || bytes.length > 256 * 1024 * 1024 ||
      createHash("sha256").update(bytes).digest("hex") !== payload.digest)
      throw new Error("COLLABORATION_DURABLE_PAYLOAD_INTEGRITY");
    const uploadUrl = await exchange("issueDurableUpload", metadata, options);
    const response = await fetch(uploadUrl, {
      method: "POST", headers: { "Content-Type": payload.mediaType }, body: bytes,
    });
    if (!response.ok) throw new Error("COLLABORATION_DURABLE_UPLOAD_FAILED");
    const { storageId } = await response.json();
    return exchange("storeDurablePayload", { ...metadata, storageId, byteLength: bytes.length }, options);
  }

  async function read(descriptor) {
    const response = await fetch(descriptor.url);
    if (!response.ok) throw new Error("COLLABORATION_DURABLE_PAYLOAD_MISSING");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== descriptor.byteLength ||
      createHash("sha256").update(bytes).digest("hex") !== descriptor.digest)
      throw new Error("COLLABORATION_DURABLE_PAYLOAD_INTEGRITY");
    return bytes;
  }

  return async function bridge(operation, payload, options = {}) {
    if (operation === "storeDurablePayload") return store(payload, options);
    // The immutable content body uses Convex's existing blob upload path. Only
    // a complete, verified handle and hot metadata enter the atomic mutation.
    for (const field of ["projectionJson", "observedProjectionJson"]) {
    if (typeof payload[field] === "string" &&
      (Buffer.byteLength(payload[field]) > 256 * 1024 ||
       Buffer.byteLength(JSON.stringify({ payloadJson: JSON.stringify(payload) })) > 1400 * 1024)) {
      const bytes = Buffer.from(payload[field]);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const projected = JSON.parse(payload[field]);
      const stored = await store({
        artifactId: payload.artifactId, accountId: payload.accountId,
        partitionKey: payload.partitionKey, policyVersion: payload.policyVersion,
        kind: "projection", digest, mediaType: "application/vnd.spectra.projection+json",
        bytesBase64: bytes.toString("base64"),
        dependencies: contentDependencies(projected.content),
      }, options);
      projected.content = { spectraContentRef: { version: 1, artifactId: payload.artifactId,
        payloadRef: stored.payloadRef, digest, byteLength: bytes.length, path: "content", dependencies: stored.dependencies } };
      payload = { ...payload, [field]: JSON.stringify(projected) };
    }
    }
    const result = await exchange(operation, payload, options);
    if (operation === "load" && result) {
      let page = result;
      for (let count = 0; page.hasMore; count += 1) {
        if (count >= 1000) throw new Error("COLLABORATION_BRIDGE_SNAPSHOT_REQUIRED");
        const next = await exchange(operation, { ...payload, afterSequence: page.afterSequence }, options);
        if (!next || next.roomId !== result.roomId || next.afterSequence <= page.afterSequence)
          throw new Error("COLLABORATION_REPLAY_GENERATION_CHANGED");
        result.updates.push(...next.updates);
        page = next;
      }
      let sequence = Math.max(payload.afterSequence ?? 0, result.snapshot?.throughSequence ?? 0);
      for (const update of result.updates) {
        if (update.sequence !== ++sequence) throw new Error("COLLABORATION_REPLAY_GENERATION_CHANGED");
      }
      if (!payload.includeInitialProjection && sequence !== page.nextSequence - 1)
        throw new Error("COLLABORATION_REPLAY_GENERATION_CHANGED");
      for (const key of ["nextSequence", "liveStateVectorHash", "lastProjectionSequence", "uncompactedBytes", "lastSnapshotAt"])
        result[key] = page[key];
      for (const item of [result.snapshot, ...(result.updates ?? [])]) {
        if (item?.payload) item.update = (await read(item.payload)).toString("base64");
      }
      if (result.initialProjection?.contentPayload) {
        const body = JSON.parse((await read(result.initialProjection.contentPayload)).toString("utf8"));
        result.initialProjection.content = result.initialProjection.contentPayload.path === "content" ? body.content : body;
        delete result.initialProjection.contentPayload;
      }
    }
    return result;
  };
}

export function serializeCollaborationBridge(bridge) {
  let tail = Promise.resolve();
  return function queuedBridge(operation, payload, options) {
    const run = tail.then(
      () => bridge(operation, payload, options),
      () => bridge(operation, payload, options),
    );
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
