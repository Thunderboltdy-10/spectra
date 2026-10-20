"use client";

import { useEffect } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { BRIDGE_DISCOVERY_STORAGE_KEY, bridgeDiscoveryEnabled, enableBridgeDiscovery } from "./client";

/*
 * A browser looks for Bridge once its account has connected Bridge on any
 * computer, not only once this browser paired it: a new browser, or one whose
 * storage was cleared, still finds the Bridge running beside it. An account
 * that never connected Bridge never probes the port.
 */
export function BridgeDiscoveryMount() {
  const { isAuthenticated } = useConvexAuth();
  const hasDevice = useQuery(api.bridge.hasDevice, isAuthenticated ? {} : "skip");
  useEffect(() => {
    if (!hasDevice || bridgeDiscoveryEnabled()) return;
    enableBridgeDiscovery();
    // The flag is written in this tab; the storage event only reaches the others.
    window.dispatchEvent(new StorageEvent("storage", { key: BRIDGE_DISCOVERY_STORAGE_KEY }));
  }, [hasDevice]);
  return null;
}
