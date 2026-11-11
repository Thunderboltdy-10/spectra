import { v } from "convex/values";
import { internalAction } from "./functions";

/** The gateway's address as Convex can reach it, when the gateway is deployed. */
export function collaborationGatewayOrigin() {
  const url = process.env.SPECTRA_AGENT_HUB_URL?.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol === "wss:" ? "https:" : "http:"}//${parsed.host}`;
  } catch {
    return null;
  }
}

/** Tell the gateway which rooms to check now. Its sweep still catches a missed one. */
export const notify = internalAction({
  args: { artifactIds: v.array(v.string()) },
  handler: async (_ctx, args) => {
    const origin = collaborationGatewayOrigin();
    const secret = process.env.SPECTRA_COLLAB_BRIDGE_KEY;
    if (!origin || !secret) return;
    const body = JSON.stringify({ artifactIds: args.artifactIds, at: Date.now() });
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const hex = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
    await fetch(`${origin}/_spectra/policy-changed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Spectra-Signature": hex },
      body,
    }).catch(() => undefined);
  },
});
