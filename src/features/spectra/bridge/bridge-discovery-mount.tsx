"use client";

import { useEffect } from "react";
import { useConvexAuth } from "convex/react";
import { BRIDGE_DISCOVERY_STORAGE_KEY, bridgeDiscoveryEnabled, enableBridgeDiscovery } from "./client";

/*
 * Signed-in accounts can discover an installed Bridge before their first
 * pairing, including in a fresh local deployment with no device rows yet.
 * Public health discovery grants no access to files or device credentials.
 */
export function BridgeDiscoveryMount() {
  const { isAuthenticated } = useConvexAuth();
  useEffect(() => {
    // A fresh account/deployment has no device row yet, but Bridge may already
    // be installed beside this browser. Discovery does not pair or grant files.
    if (!isAuthenticated || bridgeDiscoveryEnabled()) return;
    enableBridgeDiscovery();
    // The flag is written in this tab; the storage event only reaches the others.
    window.dispatchEvent(new StorageEvent("storage", { key: BRIDGE_DISCOVERY_STORAGE_KEY }));
  }, [isAuthenticated]);
  return null;
}
