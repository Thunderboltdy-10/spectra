import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { isTransientCollaborationFailure } from "./collaboration-persist.mjs";

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

  return async function bridge(operation, payload, options = {}) {
    const attempts = options.retryAttempts ?? retryAttempts;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const payloadJson = JSON.stringify(payload);
      const timestamp = now();
      const requestNonce = nonce();
      const digest = createHash("sha256")
        .update(payloadJson)
        .digest("base64url");
      const signature = createHmac("sha256", bridgeKey)
        .update([operation, timestamp, requestNonce, digest].join("|"))
        .digest("base64url");
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
