/*
 * Connecting this computer, as one store the Devices page and Spectra AI
 * share: check for Bridge, offer the download when it is missing and wait for
 * it, then pair through the local control (`auto_pair`) while the same code
 * shows on the page and in Bridge's native dialog.
 */
import {
  BRIDGE_PROTOCOL_VERSION,
  bridgeDownloadUrl,
  bridgePlatform,
  discoverBridge,
  enableBridgeDiscovery,
  offerPairing,
  pairingFailureMessage,
  pairingStatus,
  persistBridgeSession,
  protocolMajor,
  type BridgeDiscovery,
  type BridgePlatform,
} from "../bridge/client";

export type PairingRequest = (input: { browserOrigin: string }) => Promise<{
  challenge: string;
  shortCode: string;
  expiresAt: number;
}>;

export type PairingState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "download"; platform: BridgePlatform; url: string | null }
  | { phase: "requesting" }
  | { phase: "confirming"; shortCode: string; expiresAt: number }
  | { phase: "paired"; at: number }
  | { phase: "failed"; message: string };

export const PAIRING_DOWNLOAD_POLL_MS = 2_500;
export const PAIRING_STATUS_POLL_MS = 1_000;
/** How long the page waits for Bridge to be installed and started. */
export const PAIRING_DOWNLOAD_WAIT_MS = 20 * 60_000;

export type PairingDeps = {
  discover: () => Promise<BridgeDiscovery>;
  offer: typeof offerPairing;
  status: typeof pairingStatus;
  persist: (token: string) => void;
  enableDiscovery: () => void;
  platform: () => BridgePlatform;
  origin: () => string;
  now: () => number;
  wait: (ms: number) => Promise<void>;
};

const browserDeps: PairingDeps = {
  discover: () => discoverBridge(),
  offer: offerPairing,
  status: pairingStatus,
  persist: persistBridgeSession,
  enableDiscovery: enableBridgeDiscovery,
  platform: () => bridgePlatform(),
  origin: () => window.location.origin,
  now: () => Date.now(),
  wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
};

export const PAIRING_COPY = {
  portTaken: "Another app is using Bridge's connection. Close it, then try again.",
  outOfDate: "This Spectra Bridge is out of date. Update it, then connect again.",
  noBridgeHere: "Spectra Bridge runs on Windows and Mac. Open Spectra on your computer to connect it.",
  waitedTooLong: "Spectra Bridge didn't start. Open it once it's installed, then try again.",
  expired: "The code expired before it was confirmed. Try again.",
} as const;

export function createPairing(deps: PairingDeps) {
  let state: PairingState = { phase: "idle" };
  let run = 0;
  let wanted = false;
  const listeners = new Set<() => void>();
  const set = (next: PairingState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const busy = () => ["checking", "download", "requesting", "confirming"].includes(state.phase);

  async function pair(token: number, request: PairingRequest): Promise<PairingState> {
    set({ phase: "requesting" });
    const origin = deps.origin();
    const offer = await request({ browserOrigin: origin });
    if (token !== run) return state;
    await deps.offer({ ...offer, browserOrigin: origin });
    if (token !== run) return state;
    set({ phase: "confirming", shortCode: offer.shortCode, expiresAt: offer.expiresAt });
    while (token === run) {
      if (deps.now() >= offer.expiresAt) {
        set({ phase: "failed", message: PAIRING_COPY.expired });
        return state;
      }
      const result = await deps.status(offer.challenge);
      if (token !== run) return state;
      if (result?.paired && result.sessionToken) {
        deps.persist(result.sessionToken);
        set({ phase: "paired", at: deps.now() });
        return state;
      }
      if (result?.failure) {
        set({ phase: "failed", message: result.failure });
        return state;
      }
      await deps.wait(PAIRING_STATUS_POLL_MS);
    }
    return state;
  }

  async function begin(token: number, request: PairingRequest): Promise<PairingState> {
    set({ phase: "checking" });
    let found = await deps.discover();
    if (token !== run) return state;
    if (found.kind === "port-taken") {
      set({ phase: "failed", message: PAIRING_COPY.portTaken });
      return state;
    }
    if (found.kind !== "running") {
      const platform = deps.platform();
      const url = bridgeDownloadUrl(platform);
      if (!url) {
        set({ phase: "failed", message: PAIRING_COPY.noBridgeHere });
        return state;
      }
      set({ phase: "download", platform, url });
      const until = deps.now() + PAIRING_DOWNLOAD_WAIT_MS;
      while (found.kind !== "running") {
        if (token !== run) return state;
        if (deps.now() >= until) {
          set({ phase: "failed", message: PAIRING_COPY.waitedTooLong });
          return state;
        }
        await deps.wait(PAIRING_DOWNLOAD_POLL_MS);
        if (token !== run) return state;
        found = await deps.discover();
      }
    }
    if (protocolMajor(found.health.protocolVersion) !== protocolMajor(BRIDGE_PROTOCOL_VERSION)) {
      set({ phase: "failed", message: PAIRING_COPY.outOfDate });
      return state;
    }
    return pair(token, request);
  }

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /**
     * Connect this computer. A second call while connecting joins the first.
     * Resolves with where the flow stopped: paired, failed, or cancelled.
     */
    async start(request: PairingRequest): Promise<PairingState> {
      if (busy()) return state;
      const token = ++run;
      // The user asked for Bridge on this computer, so Spectra may look for it.
      deps.enableDiscovery();
      try {
        return await begin(token, request);
      } catch (error) {
        if (token === run) set({ phase: "failed", message: pairingFailureMessage(error) });
        return state;
      }
    },
    /** Stop waiting; the flow goes back to the start. */
    cancel() {
      run += 1;
      set({ phase: "idle" });
    },
    /** Clear a finished flow (paired or failed). */
    reset() {
      if (!busy()) set({ phase: "idle" });
    },
    /**
     * Ask the Devices page to connect this computer: the command bar and
     * Spectra AI hold no Convex client, so the page starts it when it shows.
     */
    want() {
      wanted = true;
      for (const listener of listeners) listener();
    },
    /** True once per want(): the page that starts the flow takes it. */
    takeWanted() {
      const value = wanted;
      wanted = false;
      return value;
    },
  };
}

export type Pairing = ReturnType<typeof createPairing>;

const REJOIN_WAIT_MS = 20_000;

/**
 * Lets this browser in without a code, when Bridge already belongs to this
 * account: the computer's saved key answers for it, so nothing asks on screen.
 * Runs apart from the Devices page's flow, which never sees it.
 */
export async function rejoinBridge(request: PairingRequest): Promise<boolean> {
  const pairing = createPairing(browserDeps);
  const timer = setTimeout(() => pairing.cancel(), REJOIN_WAIT_MS);
  try {
    return (await pairing.start(request)).phase === "paired";
  } finally {
    clearTimeout(timer);
  }
}

let shared: Pairing | null = null;

/** The one pairing flow for this browser tab. */
export function devicePairing(): Pairing {
  shared ??= createPairing(browserDeps);
  return shared;
}
