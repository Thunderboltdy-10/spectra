"use client";
import { useEffect, useRef, useState } from "react";
import {
  BRIDGE_DISCOVERY_STORAGE_KEY,
  BRIDGE_SESSION_STORAGE_KEY,
  BRIDGE_STATUS_CACHE_KEY,
  bridgeConnectionState,
  bridgeDiscoveryDelay,
  bridgeDiscoveryEnabled,
  bridgeStatus,
  clearBridgeSession,
  clearBridgeStatusCache,
  disableBridgeDiscovery,
  discoverBridge,
  loadBridgeStatusCache,
  persistBridgeStatusCache,
  presentBridgeReachability,
  type BridgeDiscovery,
  type BridgeHealth,
  type BridgeReachability,
  type BridgeStatus,
} from "./client";

type BridgeProbe = { discovery: BridgeDiscovery; status: BridgeStatus | null };

/** Several surfaces read Bridge at once; they share one probe at a time. */
const PROBE_REUSE_MS = 2_000;
let sharedProbe: { promise: Promise<BridgeProbe>; settledAt: number | null } | null =
  null;

/**
 * One health check (and, when Bridge answers, one status read) for every
 * mounted surface. Returns "not-set-up" without any request on a device that
 * has never connected Bridge.
 */
export function probeBridge(options: { fresh?: boolean } = {}): Promise<BridgeProbe> {
  if (!bridgeDiscoveryEnabled())
    return Promise.resolve({ discovery: { kind: "not-set-up" }, status: null });
  const reusable =
    sharedProbe &&
    (sharedProbe.settledAt === null ||
      (!options.fresh && Date.now() - sharedProbe.settledAt < PROBE_REUSE_MS));
  if (reusable && sharedProbe) return sharedProbe.promise;
  const entry: { promise: Promise<BridgeProbe>; settledAt: number | null } = {
    settledAt: null,
    promise: (async () => {
      const discovery = await discoverBridge();
      // Do not probe the authenticated status endpoint when the local
      // process is absent (the common local --no-bridge mode). Besides
      // avoiding needless work, this prevents stale sessions from turning a
      // healthy Spectra page into a stream of 401 console errors.
      const status = discovery.kind === "running" ? await bridgeStatus() : null;
      return { discovery, status };
    })().finally(() => {
      entry.settledAt = Date.now();
    }),
  };
  sharedProbe = entry;
  return entry.promise;
}

export function resetBridgeProbeForTests() {
  sharedProbe = null;
}

export function useBridgeHealth() {
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [discovery, setDiscovery] = useState<BridgeDiscovery>({
    kind: "not-set-up",
  });
  // Do not read localStorage during render. A cached mount exists only in the
  // browser and would make the server/client trees disagree during hydration.
  // The effect restores it immediately before the first network refresh.
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [online, setOnline] = useState(true);
  const checkRef = useRef<(fresh: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    const syncOnline = () => setOnline(navigator.onLine);
    syncOnline();
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    let misses = 0;
    let timer: number | null = null;
    let nextDueAt = 0;
    const cached = loadBridgeStatusCache();
    if (cached) setStatus({ ...cached, paired: false, cloudConnected: false });
    const unpair = () =>
      setStatus((previous) =>
        previous ? { ...previous, paired: false, cloudConnected: false } : null,
      );
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      // A device that never connected Bridge is not polled at all; the
      // storage listener below wakes it when Bridge is connected in any tab.
      if (disposed || !bridgeDiscoveryEnabled()) return;
      const delay = bridgeDiscoveryDelay(misses);
      nextDueAt = Date.now() + delay;
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") void check(false);
        else schedule();
      }, delay);
    };
    const check = async (fresh: boolean) => {
      if (fresh) misses = 0;
      const next = await probeBridge({ fresh });
      if (disposed) return;
      misses = next.discovery.kind === "running" ? 0 : misses + 1;
      if (next.discovery.kind === "not-set-up") misses = 0;
      setDiscovery(next.discovery);
      setHealth(next.discovery.kind === "running" ? next.discovery.health : null);
      if (next.status) {
        persistBridgeStatusCache(next.status);
        setStatus(next.status);
      } else unpair();
      setChecked(true);
      schedule();
    };
    checkRef.current = check;
    void check(false);
    const onFocus = () => {
      // Returning to the page checks only once the backoff allows it, so an
      // absent Bridge is not probed on every focus.
      if (document.visibilityState === "visible" && Date.now() >= nextDueAt)
        void check(false);
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    const onStorage = (event: StorageEvent) => {
      if (
        event.key &&
        event.key !== BRIDGE_SESSION_STORAGE_KEY &&
        event.key !== BRIDGE_STATUS_CACHE_KEY &&
        event.key !== BRIDGE_DISCOVERY_STORAGE_KEY
      ) {
        return;
      }
      if (!window.localStorage.getItem(BRIDGE_SESSION_STORAGE_KEY)) unpair();
      void check(true);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const publicState = bridgeConnectionState(health);
  const reachability: BridgeReachability = presentBridgeReachability({
    online,
    discovery,
    sessionPaired: Boolean(status?.paired),
  });
  const state =
    publicState === "update-required" || reachability === "update-required"
      ? "update-required"
      : status?.paired
        ? "connected"
        : "disconnected";
  return {
    health,
    status,
    checked,
    state,
    discovery,
    online,
    reachability,
    forgetSession: () => {
      clearBridgeSession();
      clearBridgeStatusCache();
      disableBridgeDiscovery();
      setStatus((previous) =>
        previous
          ? { ...previous, paired: false, cloudConnected: false }
          : null,
      );
    },
    /** An explicit check now, which also resets the backoff. */
    refresh: () => checkRef.current(true),
  };
}
