"use client";
import { useEffect, useState } from "react";
import {
  bridgeConnectionState,
  bridgeStatus,
  discoverBridge,
  loadBridgeStatusCache,
  persistBridgeStatusCache,
  presentBridgeReachability,
  type BridgeDiscovery,
  type BridgeHealth,
  type BridgeReachability,
  type BridgeStatus,
} from "./client";

export function useBridgeHealth() {
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [discovery, setDiscovery] = useState<BridgeDiscovery>({
    kind: "not-running",
  });
  // Do not read localStorage during render. A cached mount exists only in the
  // browser and would make the server/client trees disagree during hydration.
  // The effect restores it immediately before the first network refresh.
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [online, setOnline] = useState(true);
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
    const controller = new AbortController();
    const cached = loadBridgeStatusCache();
    if (cached) setStatus({ ...cached, paired: false, cloudConnected: false });
    const refresh = () =>
      Promise.all([
        discoverBridge(controller.signal),
        bridgeStatus(controller.signal),
      ]).then(([nextDiscovery, nextStatus]) => {
        setDiscovery(nextDiscovery);
        setHealth(
          nextDiscovery.kind === "running" ? nextDiscovery.health : null,
        );
        if (nextStatus) {
          persistBridgeStatusCache(nextStatus);
          setStatus(nextStatus);
        } else {
          setStatus((previous) =>
            previous
              ? { ...previous, paired: false, cloudConnected: false }
              : null,
          );
        }
        setChecked(true);
      });
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
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
    refresh: async () => {
      const [nextDiscovery, nextStatus] = await Promise.all([
        discoverBridge(),
        bridgeStatus(),
      ]);
      setDiscovery(nextDiscovery);
      setHealth(
        nextDiscovery.kind === "running" ? nextDiscovery.health : null,
      );
      if (nextStatus) {
        persistBridgeStatusCache(nextStatus);
        setStatus(nextStatus);
      } else {
        setStatus((previous) =>
          previous ? { ...previous, paired: false, cloudConnected: false } : null,
        );
      }
      setChecked(true);
    },
  };
}
