/*
 * The one place an agent-hub ticket is made: the server's (Next) for its own
 * calls, Convex's for a device, the hub's tests. A ticket names the account the
 * hub may route for, lasts a short while, and is signed with the key of the
 * side that presents it. Web Crypto, so it runs in Node and in Convex alike.
 */
export const AGENT_HUB_AUDIENCE = "spectra-agent-hub";

const base64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function signAgentHubTicket(claims, key) {
  const encoder = new TextEncoder();
  const body = base64url(encoder.encode(JSON.stringify({ ...claims, aud: AGENT_HUB_AUDIENCE })));
  const hmac = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", hmac, encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

/** A ticket for `accountId` that lasts `lifetimeMs`. */
export function agentHubTicket(accountId, key, lifetimeMs) {
  return signAgentHubTicket({ sub: accountId, exp: Date.now() + lifetimeMs }, key);
}
