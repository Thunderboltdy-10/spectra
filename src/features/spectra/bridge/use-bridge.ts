"use client";
import { useEffect, useState } from "react";
import { bridgeConnectionState, bridgeHealth, bridgeStatus, type BridgeHealth, type BridgeStatus } from "./client";

export function useBridgeHealth() {
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => Promise.all([bridgeHealth(controller.signal), bridgeStatus(controller.signal)]).then(([nextHealth, nextStatus]) => { setHealth(nextHealth); setStatus(nextStatus); setChecked(true); });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, []);
  const publicState = bridgeConnectionState(health);
  const state = publicState === "update-required" ? publicState : status?.paired ? "connected" : "disconnected";
  return { health, status, checked, state, refresh: async () => { const [nextHealth, nextStatus] = await Promise.all([bridgeHealth(), bridgeStatus()]); setHealth(nextHealth); setStatus(nextStatus); setChecked(true); } };
}
