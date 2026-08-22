"use client";
import { useEffect, useState } from "react";
import { bridgeConnectionState, bridgeHealth, bridgeStatus, loadBridgeStatusCache, persistBridgeStatusCache, type BridgeHealth, type BridgeStatus } from "./client";

export function useBridgeHealth() {
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  // Do not read localStorage during render. A cached mount exists only in the
  // browser and would make the server/client trees disagree during hydration.
  // The effect restores it immediately before the first network refresh.
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const cached = loadBridgeStatusCache();
    if (cached) setStatus({ ...cached, paired: false, cloudConnected: false });
    const refresh = () => Promise.all([bridgeHealth(controller.signal), bridgeStatus(controller.signal)]).then(([nextHealth, nextStatus]) => {
      setHealth(nextHealth);
      if (nextStatus) {
        persistBridgeStatusCache(nextStatus);
        setStatus(nextStatus);
      } else {
        setStatus((previous) => previous ? { ...previous, paired: false, cloudConnected: false } : null);
      }
      setChecked(true);
    });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, []);
  const publicState = bridgeConnectionState(health);
  const state = publicState === "update-required" ? publicState : status?.paired ? "connected" : "disconnected";
  return { health, status, checked, state, refresh: async () => { const [nextHealth, nextStatus] = await Promise.all([bridgeHealth(), bridgeStatus()]); setHealth(nextHealth); if (nextStatus) { persistBridgeStatusCache(nextStatus); setStatus(nextStatus); } else setStatus((previous) => previous ? { ...previous, paired: false, cloudConnected: false } : null); setChecked(true); } };
}
