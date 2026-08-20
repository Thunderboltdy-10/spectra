"use client";
import { useEffect, useState } from "react";
import { bridgeConnectionState, bridgeHealth, type BridgeHealth } from "./client";

export function useBridgeHealth() {
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void bridgeHealth(controller.signal).then((value) => { setHealth(value); setChecked(true); });
    const onFocus = () => void bridgeHealth(controller.signal).then(setHealth);
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.removeEventListener("focus", onFocus); };
  }, []);
  return { health, checked, state: bridgeConnectionState(health) };
}
