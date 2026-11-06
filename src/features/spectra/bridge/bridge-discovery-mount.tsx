"use client";

import { useEffect } from "react";
import { useConvexAuth } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { useBridgeHealth } from "./use-bridge";
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

const OFFER_KEY = "spectra:bridge-connect-offered";
const OFFER_EVERY_MS = 7 * 24 * 60 * 60_000;

function offeredRecently() {
  try {
    const at = Number(window.localStorage.getItem(OFFER_KEY));
    if (at && Date.now() - at < OFFER_EVERY_MS) return true;
    window.localStorage.setItem(OFFER_KEY, String(Date.now()));
    return false;
  } catch {
    return true;
  }
}

/*
 * Keeps this browser and Bridge joined from the moment the app opens, on every
 * page. Connecting a new browser still takes the code on the computer, so a
 * running Bridge with no session is offered rather than connected behind the
 * user's back.
 */
export function BridgeConnection() {
  const router = useRouter();
  const pathname = usePathname();
  const { discovery, status, checked } = useBridgeHealth();
  const unjoined = checked && discovery.kind === "running" && !status?.paired;
  useEffect(() => {
    if (!unjoined || pathname.startsWith("/devices") || offeredRecently()) return;
    toast.info("Spectra Bridge is running on this computer.", {
      id: "bridge-connect-offer",
      action: { label: "Connect", onClick: () => router.push("/devices?connect=1") },
    });
  }, [pathname, router, unjoined]);
  return null;
}
