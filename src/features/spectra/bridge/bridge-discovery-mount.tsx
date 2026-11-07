"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { backUpNow, backupIsDue } from "./device-backup";
import { deviceStoreSummary, publishDeviceState } from "./device-works";
import { recheckAgentRuntime, useAgentRuntime } from "../ai/use-agent-runtime";
import { rejoinBridge } from "../devices/pairing";
import { publishBridgeAvailability } from "./availability";
import { useSpectraPreferences } from "../settings/preference-store";
import { useBridgeHealth } from "./use-bridge";
import {
  BRIDGE_DISCOVERY_STORAGE_KEY,
  BRIDGE_SESSION_STORAGE_KEY,
  bridgeDiscoveryEnabled,
  enableBridgeDiscovery,
  setBridgeAgentHub,
} from "./client";

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

/** A backup waits for the app to settle, and looks again each hour after that. */
const BACKUP_SETTLE_MS = 45_000;
const BACKUP_CHECK_MS = 60 * 60_000;

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

const WORK_HOME_ASKED_KEY = "spectra:work-home-asked";

function askedWhereWorkLives() {
  try {
    if (window.localStorage.getItem(WORK_HOME_ASKED_KEY)) return true;
    window.localStorage.setItem(WORK_HOME_ASKED_KEY, "1");
    return false;
  } catch {
    return true;
  }
}

/** A Bridge on another account says no every time, so asking again waits a while. */
const REJOIN_AFTER_REFUSAL_MS = 30 * 60_000;
let rejoinAllowedAt = 0;
let rejoinRefused = false;

/*
 * Keeps this browser and Bridge joined from the moment the app opens, on every
 * page. A Bridge already connected to this account lets a new browser in by
 * itself. Only a Bridge with no account yet takes the code on the computer, or
 * one on another account, and those are offered.
 */
export function BridgeConnection() {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useConvexAuth();
  const requestPairing = useMutation(api.bridge.requestPairing);
  const { discovery, status, checked, health } = useBridgeHealth();
  const { preferences, hydrated, update } = useSpectraPreferences();
  const hasDevice = useQuery(api.bridge.hasDevice, isAuthenticated ? {} : "skip");
  const unjoined = checked && discovery.kind === "running" && !status?.paired;
  const rejoinable = unjoined && Boolean(health?.paired) && !rejoinRefused;
  useEffect(() => {
    if (!rejoinable || !isAuthenticated || Date.now() < rejoinAllowedAt) return;
    rejoinAllowedAt = Date.now() + REJOIN_AFTER_REFUSAL_MS;
    void rejoinBridge(requestPairing).then((joined) => {
      if (joined) {
        rejoinAllowedAt = 0;
        window.dispatchEvent(new StorageEvent("storage", { key: BRIDGE_SESSION_STORAGE_KEY }));
      } else rejoinRefused = true;
    });
  }, [isAuthenticated, rejoinable, requestPairing]);
  // The choice stays with the person; Bridge hears it whenever it's here to listen.
  const joined = Boolean(status?.paired);
  const workSettings = useQuery(api.deviceWorks.settings, isAuthenticated ? {} : "skip");
  useEffect(() => {
    if (!joined || !hydrated) return;
    // Connected computers stay reachable by the person's own Spectra, so its AI
    // can see file names and offer to sync them even when the server is hosted.
    void setBridgeAgentHub(true)
      .catch(() => undefined)
      .then(() => recheckAgentRuntime());
  }, [hydrated, joined]);
  useEffect(() => {
    if (workSettings) publishDeviceState({ storage: workSettings.storage });
  }, [workSettings]);
  const [storeKnown, setStoreKnown] = useState(false);
  useEffect(() => {
    if (!joined) {
      publishDeviceState({ storeId: null });
      setStoreKnown(false);
      return;
    }
    let live = true;
    // Joining is the news here, and availability hears about it a moment later.
    void deviceStoreSummary({ evenIfAway: true })
      .then((summary) => {
        if (!live) return;
        publishDeviceState({ storeId: summary.storeId });
        setStoreKnown(true);
      })
      // An older Bridge has no store; work simply stays in the cloud until it updates.
      .catch(() => publishDeviceState({ storeId: null }));
    return () => {
      live = false;
    };
  }, [joined]);
  const backupUploadUrl = useMutation(api.deviceWorks.backupUploadUrl);
  const recordBackup = useMutation(api.deviceWorks.recordBackup);
  useEffect(() => {
    if (!storeKnown || !workSettings) return;
    const check = () => {
      if (!backupIsDue(workSettings)) return;
      void backUpNow(workSettings, {
        uploadUrl: () => backupUploadUrl({}),
        record: (input) => recordBackup({ ...input, storageId: input.storageId as Id<"_storage"> }),
      }).catch(() => undefined);
    };
    const first = window.setTimeout(check, BACKUP_SETTLE_MS);
    const later = window.setInterval(check, BACKUP_CHECK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(later);
    };
  }, [backupUploadUrl, recordBackup, storeKnown, workSettings]);
  useEffect(() => {
    if (!checked || hasDevice === undefined) return;
    if (joined) publishBridgeAvailability("ready");
    else if (discovery.kind === "running") publishBridgeAvailability("not-connected");
    else publishBridgeAvailability(hasDevice ? "not-running" : "not-installed");
  }, [checked, discovery.kind, hasDevice, joined]);
  useEffect(() => {
    if (!unjoined || rejoinable || pathname.startsWith("/devices") || offeredRecently()) return;
    toast.info("Spectra Bridge is running on this computer.", {
      id: "bridge-connect-offer",
      action: { label: "Connect", onClick: () => router.push("/devices?connect=1") },
    });
  }, [pathname, rejoinable, router, unjoined]);
  // Someone who was here before there was a choice hears about it once.
  useEffect(() => {
    if (!joined || !workSettings || workSettings.storage || pathname.startsWith("/devices")) return;
    if (askedWhereWorkLives()) return;
    toast.info("Your work can now live on this computer.", {
      id: "work-home-offer",
      action: { label: "Choose", onClick: () => router.push("/devices") },
    });
  }, [joined, pathname, router, workSettings]);
  const undecided = joined && hydrated && !preferences.ai.runtimeChosen && preferences.ai.runtime === "spectra";
  return undecided ? <OwnAgentByDefault onFound={(runtime) => update("ai", { runtime })} /> : null;
}

/** Someone with their own subscription starts on it, until they choose otherwise. */
function OwnAgentByDefault({ onFound }: { onFound: (runtime: "codex" | "claude") => void }) {
  const { status } = useAgentRuntime();
  const found = status?.claude.state === "ready" ? "claude" : status?.codex.state === "ready" ? "codex" : null;
  useEffect(() => {
    if (found) onFound(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when one is found.
  }, [found]);
  return null;
}
