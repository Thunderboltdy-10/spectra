import { z } from "zod";

export const BRIDGE_URL = "http://127.0.0.1:47615";
export const BRIDGE_PROTOCOL_VERSION = "1.0";

const healthSchema = z.object({ version: z.string(), paired: z.boolean(), protocolVersion: z.string(), port: z.literal(47615), bindError: z.string().nullable().optional() }).strict();
export type BridgeHealth = z.infer<typeof healthSchema>;
const mountSchema = z.object({ id: z.string(), label: z.string(), state: z.string(), detail: z.string(), synced: z.number(), total: z.number() }).strict();
const statusSchema = z.object({ version: z.string(), protocolVersion: z.string(), paired: z.boolean(), cloudConnected: z.boolean(), deviceId: z.string().nullable().optional(), mounts: z.array(mountSchema) }).strict();
export type BridgeStatus = z.infer<typeof statusSchema>;
export type BridgeConnectionState = "connected" | "disconnected" | "paused" | "update-required";
export const BRIDGE_SESSION_STORAGE_KEY = "spectra.bridge.session";

export function protocolMajor(value: string) { const parsed = Number(value.split(".")[0]); return Number.isSafeInteger(parsed) ? parsed : null; }

export async function bridgeHealth(signal?: AbortSignal): Promise<BridgeHealth | null> {
  try {
    const response = await fetch(`${BRIDGE_URL}/v1/health`, { signal, cache: "no-store" });
    if (!response.ok) return null;
    return healthSchema.parse(await response.json());
  } catch { return null; }
}

export function bridgeConnectionState(health: BridgeHealth | null): BridgeConnectionState {
  if (!health) return "disconnected";
  if (protocolMajor(health.protocolVersion) !== protocolMajor(BRIDGE_PROTOCOL_VERSION)) return "update-required";
  return health.paired ? "connected" : "disconnected";
}

export function loadBridgeSession() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(BRIDGE_SESSION_STORAGE_KEY) ?? window.sessionStorage.getItem(BRIDGE_SESSION_STORAGE_KEY);
}

export function persistBridgeSession(token: string) {
  window.localStorage.setItem(BRIDGE_SESSION_STORAGE_KEY, token);
  window.sessionStorage.removeItem(BRIDGE_SESSION_STORAGE_KEY);
}

async function authorizedBridgeRequest(path: string, init: RequestInit = {}) {
  const token = loadBridgeSession();
  if (!token) return null;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${BRIDGE_URL}${path}`, { ...init, headers, cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error((await response.text()) || "Spectra Bridge could not complete the request.");
  return response;
}

export async function bridgeStatus(signal?: AbortSignal): Promise<BridgeStatus | null> {
  try {
    let response = await authorizedBridgeRequest("/v1/status", { signal });
    if (!response && typeof window !== "undefined") {
      const resume = await fetch(`${BRIDGE_URL}/v1/session/resume`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        cache: "no-store",
      });
      if (resume.ok) {
        const result = z.object({ paired: z.boolean(), sessionToken: z.string().optional() }).parse(await resume.json());
        if (result.paired && result.sessionToken) {
          persistBridgeSession(result.sessionToken);
          response = await authorizedBridgeRequest("/v1/status", { signal });
        }
      }
    }
    return response ? statusSchema.parse(await response.json()) : null;
  } catch { return null; }
}

export async function selectBridgeFolder() {
  const response = await authorizedBridgeRequest("/v1/mount/select", { method: "POST" });
  if (!response) throw new Error("Reconnect this device before selecting a folder.");
}

export async function retryBridgeFolder(grantId: string) {
  const response = await authorizedBridgeRequest("/v1/mount/retry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grantId }) });
  if (!response) throw new Error("Reconnect this device before retrying the folder.");
}

export async function removeBridgeFolder(grantId: string) {
  const response = await authorizedBridgeRequest("/v1/mount/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grantId }) });
  if (!response) throw new Error("Reconnect this device before removing the folder.");
}

export async function offerPairing(input: { challenge: string; shortCode: string; browserOrigin: string; expiresAt: number }) {
  const response = await fetch(`${BRIDGE_URL}/v1/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error(await response.text());
}

export async function pairingStatus(challenge: string) {
  try {
    const response = await fetch(`${BRIDGE_URL}/v1/pair/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge }) });
    if (!response.ok) return null;
    return z.object({ paired: z.boolean(), sessionToken: z.string().optional() }).parse(await response.json());
  } catch { return null; }
}
