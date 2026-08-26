import { z } from "zod";

export const BRIDGE_URL = "http://127.0.0.1:47615";
export const BRIDGE_PROTOCOL_VERSION = "1.0";

const healthSchema = z
  .object({
    version: z.string(),
    paired: z.boolean(),
    protocolVersion: z.string(),
    port: z.number().optional(),
    bindError: z.string().nullable().optional(),
  })
  .passthrough();
export type BridgeHealth = z.infer<typeof healthSchema>;
const mountSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    state: z.string(),
    detail: z.string(),
    synced: z.number().optional().default(0),
    total: z.number().optional().default(0),
    doubleSyncRisk: z.boolean().optional().default(false),
  })
  .passthrough();
const statusSchema = z
  .object({
    version: z.string(),
    protocolVersion: z.string(),
    paired: z.boolean(),
    cloudConnected: z.boolean(),
    deviceId: z.string().nullable().optional(),
    mounts: z.array(mountSchema).optional().default([]),
  })
  .passthrough();
export type BridgeStatus = z.infer<typeof statusSchema>;
export type BridgeConnectionState =
  | "connected"
  | "disconnected"
  | "paused"
  | "update-required";
export type BridgeDiscovery =
  | { kind: "running"; health: BridgeHealth }
  | { kind: "not-running" }
  | { kind: "port-taken" };
export const BRIDGE_SESSION_STORAGE_KEY = "spectra.bridge.session";
export const BRIDGE_STATUS_CACHE_KEY = "spectra.bridge.status";

export function protocolMajor(value: string) {
  const parsed = Number(value.split(".")[0]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseBridgeHealth(body: unknown): BridgeHealth | null {
  const parsed = healthSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/**
 * Distinguishes "Bridge is not running" from "something else owns the port"
 * (WC-1 / BR-8). A healthy JSON object with extra fields is still running
 * (WC-4): unknown keys must not look like a disconnect.
 */
export function interpretHealthPayload(input: {
  networkFailed: boolean;
  httpOk: boolean;
  body: unknown;
}): BridgeDiscovery {
  if (input.networkFailed) return { kind: "not-running" };
  const health = parseBridgeHealth(input.body);
  if (health) return { kind: "running", health };
  if (input.httpOk) return { kind: "port-taken" };
  return { kind: "not-running" };
}

export function bridgeDiscoveryMessage(discovery: BridgeDiscovery): string {
  if (discovery.kind === "not-running") {
    return "Spectra Bridge is not running on this PC. Open it, then try again.";
  }
  if (discovery.kind === "port-taken") {
    return "Something else is using the Spectra Bridge connection on this PC. Close the other app, then try again.";
  }
  return "";
}

export function pairingFailureMessage(
  error: unknown,
  discovery?: BridgeDiscovery | null,
): string {
  if (discovery && discovery.kind !== "running") {
    return bridgeDiscoveryMessage(discovery);
  }
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (/failed to fetch|networkerror|load failed|econnrefused/i.test(raw)) {
    return "Spectra Bridge is not running on this PC. Open it, then try again.";
  }
  if (/pairing offer expired|pairing expired/i.test(raw)) {
    return "This connection attempt timed out. Try again.";
  }
  if (!raw.trim() || /^[A-Z][A-Z0-9_]{4,}$/.test(raw.trim())) {
    return "Spectra Bridge could not connect. Open it on this PC, then try again.";
  }
  return raw.replace(/\b[A-Z][A-Z0-9_]{5,}\b/g, "").replace(/\s+/g, " ").trim()
    || "Spectra Bridge could not connect. Open it on this PC, then try again.";
}

export async function discoverBridge(signal?: AbortSignal): Promise<BridgeDiscovery> {
  try {
    const response = await fetch(`${BRIDGE_URL}/v1/health`, {
      signal,
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    return interpretHealthPayload({
      networkFailed: false,
      httpOk: response.ok,
      body,
    });
  } catch {
    return { kind: "not-running" };
  }
}

export async function bridgeHealth(signal?: AbortSignal): Promise<BridgeHealth | null> {
  const discovery = await discoverBridge(signal);
  return discovery.kind === "running" ? discovery.health : null;
}

export function bridgeConnectionState(
  health: BridgeHealth | null,
): BridgeConnectionState {
  if (!health) return "disconnected";
  if (
    protocolMajor(health.protocolVersion) !==
    protocolMajor(BRIDGE_PROTOCOL_VERSION)
  ) {
    return "update-required";
  }
  return health.paired ? "connected" : "disconnected";
}

export function loadBridgeSession() {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem(BRIDGE_SESSION_STORAGE_KEY) ??
    window.sessionStorage.getItem(BRIDGE_SESSION_STORAGE_KEY)
  );
}

export function persistBridgeSession(token: string) {
  window.localStorage.setItem(BRIDGE_SESSION_STORAGE_KEY, token);
  window.sessionStorage.removeItem(BRIDGE_SESSION_STORAGE_KEY);
}

export function loadBridgeStatusCache(): BridgeStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BRIDGE_STATUS_CACHE_KEY);
    if (!raw) return null;
    return statusSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function persistBridgeStatusCache(status: BridgeStatus) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BRIDGE_STATUS_CACHE_KEY, JSON.stringify(status));
}

async function authorizedBridgeRequest(path: string, init: RequestInit = {}) {
  const token = loadBridgeSession();
  if (!token) return null;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(
      (await response.text()) ||
        "Spectra Bridge could not complete the request.",
    );
  }
  return response;
}

export async function bridgeStatus(
  signal?: AbortSignal,
): Promise<BridgeStatus | null> {
  try {
    let response = await authorizedBridgeRequest("/v1/status", { signal });
    if (!response && typeof window !== "undefined") {
      const token = loadBridgeSession();
      if (!token) return null;
      const resume = await fetch(`${BRIDGE_URL}/v1/session/resume`, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
      if (resume.ok) {
        const result = z
          .object({ paired: z.boolean(), sessionToken: z.string().optional() })
          .passthrough()
          .parse(await resume.json());
        if (result.paired && result.sessionToken) {
          persistBridgeSession(result.sessionToken);
          response = await authorizedBridgeRequest("/v1/status", { signal });
        }
      }
    }
    return response ? statusSchema.parse(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function selectBridgeFolder() {
  const response = await authorizedBridgeRequest("/v1/mount/select", {
    method: "POST",
  });
  if (!response) throw new Error("Reconnect this device before selecting a folder.");
}

export async function retryBridgeFolder(grantId: string) {
  const response = await authorizedBridgeRequest("/v1/mount/retry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grantId }),
  });
  if (!response) throw new Error("Reconnect this device before retrying the folder.");
}

export async function removeBridgeFolder(grantId: string) {
  const response = await authorizedBridgeRequest("/v1/mount/remove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grantId }),
  });
  if (!response) throw new Error("Reconnect this device before removing the folder.");
}

export async function requestBridgeUpdate(): Promise<string> {
  try {
    const response = await fetch(`${BRIDGE_URL}/v1/update`, {
      method: "POST",
      cache: "no-store",
    });
    if (response.ok) {
      const body = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      return (
        body?.message ??
        "Spectra Bridge is installing the update and will restart."
      );
    }
  } catch {
    /* Old Bridges have no update route; the tray is the remaining door. */
  }
  return "Look for Spectra Bridge near the clock and open it to install the update.";
}

export async function offerPairing(input: {
  challenge: string;
  shortCode: string;
  browserOrigin: string;
  expiresAt: number;
}) {
  let response: Response;
  try {
    response = await fetch(`${BRIDGE_URL}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (error) {
    throw new Error(pairingFailureMessage(error, { kind: "not-running" }));
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(pairingFailureMessage(text || "PAIRING_OFFER_REJECTED"));
  }
}

export async function pairingStatus(challenge: string) {
  try {
    const response = await fetch(`${BRIDGE_URL}/v1/pair/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge }),
    });
    if (!response.ok) return null;
    return z
      .object({ paired: z.boolean(), sessionToken: z.string().optional() })
      .passthrough()
      .parse(await response.json());
  } catch {
    return null;
  }
}

export const BRIDGE_SETTINGS_HREF = "/settings?section=devices";
