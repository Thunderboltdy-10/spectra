import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createHash, createHmac, randomBytes } from "node:crypto";

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
 * }} options
 */
export function createCollaborationGatewayBridgeClient({
  convexUrl,
  bridgeKey,
  client,
  now = () => Date.now(),
  nonce = () => randomBytes(24).toString("base64url"),
}) {
  if (!convexUrl) throw new Error("COLLABORATION_CONVEX_URL_MISSING");
  if (!bridgeKey || bridgeKey.length < 32)
    throw new Error("COLLABORATION_BRIDGE_CONFIG_MISSING");
  const convex = client ?? new ConvexHttpClient(convexUrl, { logger: false });

  return async function bridge(operation, payload) {
    const payloadJson = JSON.stringify(payload);
    const timestamp = now();
    const requestNonce = nonce();
    const digest = createHash("sha256").update(payloadJson).digest("base64url");
    const signature = createHmac("sha256", bridgeKey)
      .update([operation, timestamp, requestNonce, digest].join("|"))
      .digest("base64url");
    return convex.action(gatewayExchange, {
      operation,
      payloadJson,
      timestamp,
      nonce: requestNonce,
      signature,
    });
  };
}
