import { z } from "zod";
import { humanizePublicFailure } from "./humanize";
import { accountStorageMatches, accountStorageRevision, assertAccountStorageRevision } from "@/lib/account-storage-scope";

export const BRIDGE_URL = "http://127.0.0.1:47615";
export const BRIDGE_PROTOCOL_VERSION = "1.0";
/** Health/status must not block revoke, pairing UI, or Saved/Queued truth. */
export const BRIDGE_REQUEST_TIMEOUT_MS = 2500;
/** A status read waits for the journal, which a long sync can hold for a moment. */
export const BRIDGE_STATUS_TIMEOUT_MS = 8000;
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
    selectionKind: z.enum(["file", "folder"]).optional(),
    state: z.string(),
    detail: z.string(),
    synced: z.number().optional().default(0),
    total: z.number().optional().default(0),
    doubleSyncRisk: z.boolean().optional().default(false),
    /** "Documents › Biology": built on the computer, never sent to the cloud. */
    friendlyPath: z.string().optional().default(""),
    paused: z.boolean().optional().default(false),
    lastSyncAt: z.number().nullable().optional(),
  })
  .passthrough();
export type BridgeMount = z.infer<typeof mountSchema>;
const officeFileSchema = z.object({ folder: z.string(), name: z.string() }).passthrough();
export type BridgeOfficeFile = z.infer<typeof officeFileSchema>;
const statusSchema = z
  .object({
    version: z.string(),
    protocolVersion: z.string(),
    paired: z.boolean(),
    cloudConnected: z.boolean(),
    deviceId: z.string().nullable().optional(),
    deviceName: z.string().optional().default(""),
    /** Syncing is paused for every folder, from the tray or the Devices page. */
    paused: z.boolean().optional().default(false),
    lastSyncAt: z.number().nullable().optional(),
    mounts: z.array(mountSchema).optional().default([]),
    /** Files Office holds open in a selected folder right now. */
    officeFiles: z.array(officeFileSchema).optional().default([]),
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
export const BRIDGE_DISCOVERY_MAX_INTERVAL_MS = 60_000;

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
      label: "Not recognised",
      detail:
        "Something on this PC answered in Bridge's place, but not as Spectra Bridge. Restart Spectra Bridge from the system tray; if this stays, another app may be using its connection.",
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
  if (input.reachability === "port-taken") return "Not recognised";
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
  if (/PAIRING_CHALLENGE_INVALID/.test(raw)) {
    return "Spectra could not confirm this computer. Start connecting again from Bridge.";
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
  if (!accountStorageMatches(accountStorageRevision())) return null;
  return (
    window.localStorage.getItem(BRIDGE_SESSION_STORAGE_KEY) ??
    window.sessionStorage.getItem(BRIDGE_SESSION_STORAGE_KEY)
  );
}

export function persistBridgeSession(token: string) {
  enableBridgeDiscovery();
  window.localStorage.setItem(BRIDGE_SESSION_STORAGE_KEY, token);
  window.sessionStorage.removeItem(BRIDGE_SESSION_STORAGE_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: BRIDGE_SESSION_STORAGE_KEY }));
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
  if (!accountStorageMatches(accountStorageRevision())) return null;
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

/** Bridge answers its own refusals with a sentence; a route it does not know means it is older than this app. */
export const BRIDGE_OUTDATED = "This computer's Spectra Bridge is too old for this. Update it from Devices, then try again.";

/**
 * The session Bridge holds for this browser, or null once it has plainly said
 * there is none. A failed request throws and leaves the session alone: Bridge
 * being slow for a moment must never cost this browser its place.
 */
async function resumeBridgeSession(token: string, revision: string, signal?: AbortSignal) {
  const resume = await fetch(`${BRIDGE_URL}/v1/session/resume`, {
    method: "POST",
    signal: bridgeRequestSignal(signal),
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!accountStorageMatches(revision)) return null;
  if (!resume.ok) throw new Error("Spectra Bridge could not check this browser's session.");
  const result = z
    .object({ paired: z.boolean(), sessionToken: z.string().optional() })
    .passthrough()
    .parse(await resume.json());
  if (!accountStorageMatches(revision)) return null;
  if (result.paired && result.sessionToken) {
    persistBridgeSession(result.sessionToken);
    return result.sessionToken;
  }
  clearBridgeSession();
  return null;
}

export async function authorizedBridgeRequest(
  path: string,
  init: RequestInit = {},
  timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS,
) {
  const revision = accountStorageRevision();
  if (!accountStorageMatches(revision)) return null;
  const token = loadBridgeSession();
  if (!token) return null;
  const send = (session: string) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${session}`);
    return fetch(`${BRIDGE_URL}${path}`, {
      ...init,
      headers,
      signal: bridgeRequestSignal(init.signal ?? undefined, timeoutMs),
      cache: "no-store",
    });
  };
  let response = await send(token);
  if (!accountStorageMatches(revision)) return null;
  if (response.status === 401) {
    // Ask once for the current session. With none, BridgeConnection joins again.
    const current = await resumeBridgeSession(token, revision, init.signal ?? undefined);
    if (!current) return null;
    response = await send(current);
    if (!accountStorageMatches(revision)) return null;
    if (response.status === 401) {
      clearBridgeSession();
      return null;
    }
  }
  if (response.status === 404) throw new Error(BRIDGE_OUTDATED);
  if (!response.ok) {
    const error = await response.text();
    if (!accountStorageMatches(revision)) return null;
    throw new Error(error || "Spectra Bridge could not complete the request.");
  }
  return response;
}

export async function bridgeStatus(
  signal?: AbortSignal,
): Promise<BridgeStatus | null> {
  try {
    const revision = accountStorageRevision();
    const response = await authorizedBridgeRequest("/v1/status", { signal }, BRIDGE_STATUS_TIMEOUT_MS);
    const status = response ? statusSchema.parse(await response.json()) : null;
    return accountStorageMatches(revision) ? status : null;
  } catch {
    return null;
  }
}

async function bridgeControl(path: string, body: unknown, missing: string) {
  const response = await authorizedBridgeRequest(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!response) throw new Error(missing);
}

/** Lets Spectra's server start this computer's own Codex or Claude Code, or stops it. */
export function setBridgeAgentHub(enabled: boolean) {
  return bridgeControl("/v1/agent/hub", { enabled }, "Connect this computer first.");
}

/** Pause or resume syncing for every folder on this computer. */
export function pauseBridgeSync(paused: boolean) {
  return bridgeControl("/v1/sync/pause", { paused }, "Connect this computer before pausing syncing.");
}

/** Pause or resume one folder on this computer. */
export function pauseBridgeFolder(grantId: string, paused: boolean) {
  return bridgeControl("/v1/mount/pause", { grantId, paused }, "Connect this computer before pausing a folder.");
}

/** Open Bridge's log file on this computer, in the system's own viewer. */
export function openBridgeLogs() {
  return bridgeControl("/v1/logs/open", {}, "Connect this computer before opening its logs.");
}

/** A file in one of this computer's selected folders. */
export type BridgeFile = { grantId: string; relativePath: string };

/** Open a work's Office file on this computer, in its desktop app. */
export function openBridgeFile(file: BridgeFile) {
  return bridgeControl("/v1/file/open", file, "Connect this computer before opening its files.");
}

/** Show a work's file selected in its folder on this computer. */
export function revealBridgeFile(file: BridgeFile) {
  return bridgeControl("/v1/file/reveal", file, "Connect this computer before showing its files.");
}

/**
 * Tell the local Bridge to forget this pairing: its credential, folders and
 * session. Files on the computer stay. A Bridge that is not running learns
 * from Spectra the next time it starts, so this is best effort.
 */
export async function unpairBridge() {
  try {
    await bridgeControl("/v1/unpair", {}, "This computer is not connected.");
  } catch {
    /* Revoking in Spectra is what counts; the local Bridge catches up. */
  }
}

/**
 * Which folder was chosen: its grant, null when the picker was closed, and
 * undefined from a Bridge too old to say.
 */
export async function selectBridgeFolder(): Promise<string | null | undefined> {
  const revision = accountStorageRevision();
  const response = await authorizedBridgeRequest("/v1/mount/select", {
    method: "POST",
  }, BRIDGE_FOLDER_PICKER_TIMEOUT_MS);
  if (!response) throw new Error("Reconnect this device before selecting a folder.");
  const body = z.object({ grantId: z.string().nullable() }).safeParse(await response.json().catch(() => null));
  assertAccountStorageRevision(revision);
  return body.success ? body.data.grantId : undefined;
}

export type BridgeFilesSelected = {
  /** How many were newly brought in. */
  selected: number;
  added: BridgeFile[];
  /** Files already here, chosen alone before or through a folder. */
  existing: BridgeFile[];
};

const syncedFile = z.object({ grantId: z.string(), relativePath: z.string() });

/** Native multi-select grants just the chosen files, without their folder. */
export async function selectBridgeFiles(): Promise<BridgeFilesSelected> {
  const revision = accountStorageRevision();
  const response = await authorizedBridgeRequest("/v1/files/select", {
    method: "POST",
  }, BRIDGE_FOLDER_PICKER_TIMEOUT_MS);
  if (!response) throw new Error("Reconnect this device before selecting files.");
  const selected = z
    .object({
      selected: z.number().int().min(0).max(100),
      added: z.array(syncedFile).default([]),
      existing: z.array(syncedFile).default([]),
    })
    .parse(await response.json());
  assertAccountStorageRevision(revision);
  return selected;
}

/** Something Spectra AI named on this computer. Bridge asks the person there; null means they said no. */
export async function syncBridgeNamedPath(path: string): Promise<string | null> {
  const revision = accountStorageRevision();
  const response = await authorizedBridgeRequest(
    "/v1/files/sync-named",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) },
    BRIDGE_FOLDER_PICKER_TIMEOUT_MS,
  );
  if (!response) throw new Error("Reconnect this device before syncing a file.");
  const selected = z.object({ grantId: z.string().nullable().optional() }).parse(await response.json()).grantId ?? null;
  assertAccountStorageRevision(revision);
  return selected;
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
      // The Bridge learns which deployment to sync with from the page it pairs with.
      body: JSON.stringify({ ...input, deploymentUrl: process.env.NEXT_PUBLIC_CONVEX_URL }),
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
      .object({
        paired: z.boolean(),
        sessionToken: z.string().optional(),
        /** Why pairing stopped on the computer, as a sentence (it was declined, or failed). */
        failure: z.string().optional(),
      })
      .passthrough()
      .parse(await response.json());
  } catch {
    return null;
  }
}

/** The Devices page, where everything about Bridge happens. */
export const DEVICES_HREF = "/devices";

export type BridgePlatform = "windows" | "macos" | "other";

/** Which Bridge this computer needs, from what the browser says it runs on. */
export function bridgePlatform(nav: { userAgent?: string; platform?: string; userAgentData?: { platform?: string } } | undefined =
  typeof navigator === "undefined" ? undefined : (navigator as Navigator & { userAgentData?: { platform?: string } })): BridgePlatform {
  const hint = `${nav?.userAgentData?.platform ?? ""} ${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`.toLowerCase();
  if (/iphone|ipad|android/.test(hint)) return "other";
  if (/win/.test(hint)) return "windows";
  if (/mac/.test(hint)) return "macos";
  return "other";
}

const BRIDGE_DOWNLOAD_BASE =
  process.env.NEXT_PUBLIC_SPECTRA_BRIDGE_DOWNLOAD_URL || "/bridge/download";

/** Where this computer downloads Bridge, or null when Bridge does not run on it. */
export function bridgeDownloadUrl(platform: BridgePlatform): string | null {
  if (platform === "other") return null;
  return `${BRIDGE_DOWNLOAD_BASE.replace(/\/+$/, "")}/${platform}`;
}
