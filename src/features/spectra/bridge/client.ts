import { z } from "zod";
import { humanizePublicFailure } from "./humanize";

export const BRIDGE_URL = "http://127.0.0.1:47615";
export const BRIDGE_PROTOCOL_VERSION = "1.0";
/** Health/status must not block revoke, pairing UI, or Saved/Queued truth. */
export const BRIDGE_REQUEST_TIMEOUT_MS = 2500;
/** Folder selection waits for the user to choose or cancel in the native picker. */
export const BRIDGE_FOLDER_PICKER_TIMEOUT_MS = 5 * 60 * 1000;

export function bridgeRequestSignal(
  signal?: AbortSignal | null,
  timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS,
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function")
    return AbortSignal.any([signal, timeout]);
  return timeout;
}

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
  | { kind: "port-taken" }
  /** This device has never connected Bridge, so Spectra does not look for it. */
  | { kind: "not-set-up" };
/** What Files and devices may say. Session pairing is not the same as process liveness. */
export type BridgeReachability =
  | "offline"
  | "not-set-up"
  | "not-running"
  | "port-taken"
  | "update-required"
  | "running"
  | "connected";
export const BRIDGE_SESSION_STORAGE_KEY = "spectra.bridge.session";
export const BRIDGE_STATUS_CACHE_KEY = "spectra.bridge.status";
/**
 * Set on this device the first time someone connects Bridge here. Until then
 * Spectra never probes the local Bridge port: an installed Bridge that is not
 * configured for this app answers without a CORS allowance, so every probe
 * would be a failed browser request on a device that never asked for Bridge.
 */
export const BRIDGE_DISCOVERY_STORAGE_KEY = "spectra.bridge.discovery";

function readStorage(storage: () => Storage, key: string) {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

/** Whether this device has connected Bridge before, so discovery may run. */
export function bridgeDiscoveryEnabled() {
  if (typeof window === "undefined") return false;
  if (readStorage(() => window.localStorage, BRIDGE_DISCOVERY_STORAGE_KEY))
    return true;
  // A device that paired before this flag existed still holds its session.
  const paired =
    readStorage(() => window.localStorage, BRIDGE_SESSION_STORAGE_KEY) ??
    readStorage(() => window.sessionStorage, BRIDGE_SESSION_STORAGE_KEY);
  if (paired) enableBridgeDiscovery();
  return Boolean(paired);
}

export function enableBridgeDiscovery() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BRIDGE_DISCOVERY_STORAGE_KEY, "enabled");
  } catch {
    /* Storage can be blocked; discovery then stays per page. */
  }
}

/** The user disconnected this device on purpose: stop looking for Bridge. */
export function disableBridgeDiscovery() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(BRIDGE_DISCOVERY_STORAGE_KEY);
  } catch {
    /* Nothing to forget when storage is blocked. */
  }
}

/** First wait between automatic checks, and the longest wait after failures. */
export const BRIDGE_DISCOVERY_INTERVAL_MS = 15_000;
export const BRIDGE_DISCOVERY_MAX_INTERVAL_MS = 5 * 60_000;

/**
 * How long to wait before the next automatic check. A running Bridge is
 * checked at the base interval; each consecutive miss doubles the wait up to
 * the cap, so an absent or misconfigured Bridge is not polled every 15 s.
 */
export function bridgeDiscoveryDelay(consecutiveMisses: number) {
  const misses = Math.max(0, Math.floor(consecutiveMisses));
  return Math.min(
    BRIDGE_DISCOVERY_MAX_INTERVAL_MS,
    BRIDGE_DISCOVERY_INTERVAL_MS * 2 ** Math.min(misses, 10),
  );
}

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

export function presentBridgeReachability(input: {
  online: boolean;
  discovery: BridgeDiscovery;
  sessionPaired: boolean;
}): BridgeReachability {
  if (!input.online) return "offline";
  if (input.discovery.kind === "not-set-up") return "not-set-up";
  if (input.discovery.kind === "not-running") return "not-running";
  if (input.discovery.kind === "port-taken") return "port-taken";
  if (
    protocolMajor(input.discovery.health.protocolVersion) !==
    protocolMajor(BRIDGE_PROTOCOL_VERSION)
  ) {
    return "update-required";
  }
  return input.sessionPaired ? "connected" : "running";
}

export function bridgeReachabilityCopy(kind: BridgeReachability): {
  label: string;
  detail: string;
} {
  if (kind === "offline") {
    return {
      label: "Offline",
      detail:
        "This browser is offline. Spectra cannot check Spectra Bridge until you reconnect.",
    };
  }
  if (kind === "not-set-up") {
    return {
      label: "Not connected",
      detail:
        "Connect Bridge to use files that live on this PC. Spectra looks for Bridge only on devices you have connected.",
    };
  }
  if (kind === "not-running") {
    return {
      label: "Not running",
      detail:
        "The Spectra Bridge background helper is not running on this PC. Pairing and folder selection are managed here in Spectra.",
    };
  }
  if (kind === "port-taken") {
    return {
      label: "Connection blocked",
      detail:
        "Something else is using the Spectra Bridge connection on this PC. Close the other app, then try again.",
    };
  }
  if (kind === "update-required") {
    return {
      label: "Update required",
      detail:
        "This copy of Spectra Bridge is too old for this Spectra. Update it to keep using files on this PC.",
    };
  }
  if (kind === "running") {
    return {
      label: "Not connected",
      detail:
        "Spectra Bridge is running on this PC. Connect this device to use files that live here.",
    };
  }
  return {
    label: "Connected",
    detail:
      "Runs quietly in the system tray. Files on this PC stay ordinary files.",
  };
}

export function rememberedFolderDetail(kind: BridgeReachability): string {
  if (kind === "offline") {
    return "This folder is remembered. Spectra cannot check it while this browser is offline.";
  }
  if (kind === "running") {
    return "This folder is remembered. Connect this device to use it.";
  }
  if (kind === "not-set-up") {
    return "This folder is remembered. Connect Bridge on this device to use it.";
  }
  if (kind === "port-taken") {
    return "This folder is remembered. Spectra Bridge cannot use it until the connection is free.";
  }
  return "This folder is remembered. The background file connection must be running to use it.";
}

/** Folder chips must not contradict the Bridge header. */
export function folderChipLabel(input: {
  state: string;
  discoveryFailed: boolean;
  reachability: BridgeReachability;
}): string {
  if (input.reachability === "offline") return "Offline";
  if (input.reachability === "running" || input.reachability === "not-set-up")
    return "Not connected";
  if (input.reachability === "port-taken") return "Connection blocked";
  if (input.reachability === "update-required") return "Update required";
  if (input.discoveryFailed) return "Waiting for Spectra";
  if (input.state === "selected" || input.state === "active") return "Ready";
  if (input.state === "scanning") return "Reading folder";
  if (input.state === "waiting") {
    return input.reachability === "connected"
      ? "Waiting to retry"
      : "Waiting for Bridge";
  }
  if (input.state === "disconnected") return "Waiting for Bridge";
  if (input.state === "unavailable") return "Not available";
  if (input.state === "error") return "Needs attention";
  return "Needs attention";
}

export function bridgeDiscoveryMessage(discovery: BridgeDiscovery): string {
  if (discovery.kind === "not-running") {
    return bridgeReachabilityCopy("not-running").detail;
  }
  if (discovery.kind === "port-taken") {
    return bridgeReachabilityCopy("port-taken").detail;
  }
  if (discovery.kind === "not-set-up") {
    return bridgeReachabilityCopy("not-set-up").detail;
  }
  return "";
}

export function pairingFailureMessage(
  error: unknown,
  discovery?: BridgeDiscovery | null,
  online = true,
): string {
  if (!online) return bridgeReachabilityCopy("offline").detail;
  if (discovery && discovery.kind !== "running") {
    return bridgeDiscoveryMessage(discovery);
  }
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (/pairing offer expired|pairing expired/i.test(raw)) {
    return "This connection attempt timed out. Try again.";
  }
  return humanizePublicFailure(error);
}

export async function discoverBridge(signal?: AbortSignal): Promise<BridgeDiscovery> {
  try {
    const response = await fetch(`${BRIDGE_URL}/v1/health`, {
      signal: bridgeRequestSignal(signal),
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
  enableBridgeDiscovery();
  window.localStorage.setItem(BRIDGE_SESSION_STORAGE_KEY, token);
  window.sessionStorage.removeItem(BRIDGE_SESSION_STORAGE_KEY);
}

export function clearBridgeSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(BRIDGE_SESSION_STORAGE_KEY);
  window.sessionStorage.removeItem(BRIDGE_SESSION_STORAGE_KEY);
}

export function clearBridgeStatusCache() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(BRIDGE_STATUS_CACHE_KEY);
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

async function authorizedBridgeRequest(
  path: string,
  init: RequestInit = {},
  timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS,
) {
  const token = loadBridgeSession();
  if (!token) return null;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    ...init,
    headers,
    signal: bridgeRequestSignal(init.signal ?? undefined, timeoutMs),
    cache: "no-store",
  });
  if (response.status === 401) {
    // A stale browser token otherwise causes every 15-second health refresh to
    // emit another unauthorized network error while Bridge is unavailable.
    clearBridgeSession();
    clearBridgeStatusCache();
    return null;
  }
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
        signal: bridgeRequestSignal(signal),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
      if (resume.status === 401) {
        clearBridgeSession();
        clearBridgeStatusCache();
        return null;
      }
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
  }, BRIDGE_FOLDER_PICKER_TIMEOUT_MS);
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
      signal: bridgeRequestSignal(),
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
      signal: bridgeRequestSignal(),
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
      signal: bridgeRequestSignal(),
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
