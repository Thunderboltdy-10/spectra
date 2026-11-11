"use client";

import { useEffect, useState } from "react";
import { accountStorageMatches, accountStorageRevision } from "@/lib/account-storage-scope";
import { useConvex, useConvexAuth, useMutation } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { useSession } from "@/features/spectra/data/use-session";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { backUpNow, backupIsDue, handOverEdits, mergeHandOvers, type BackupServer } from "./device-backup";
import { deviceStoreSummary, publishDeviceState, retryPendingRemovals, useDeviceState } from "./device-works";
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

// One attempt per account/foreground activation, never competing in background.
let rejoinAttempted = false;
let rejoinInFlight = false;
let rejoinRevision: string | undefined;

/*
 * Keeps this browser and Bridge joined from the moment the app opens, on every
 * page. The signed-in foreground account supplies its own authenticated web
 * challenge, including on a fresh installation or after switching accounts.
 */
export function BridgeConnection() {
  const revision = accountStorageRevision();
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useConvexAuth();
  const requestPairing = useMutation(api.bridge.requestPairing);
  const { discovery, status, checked, refresh } = useBridgeHealth();
  const { preferences, hydrated, update } = useSpectraPreferences();
  const hasDevice = useSession()?.hasDevice;
  const unjoined = checked && discovery.kind === "running" && !status?.paired;
  const [activation, setActivation] = useState(0);
  useEffect(() => {
    const activate = () => {
      if (rejoinInFlight || document.visibilityState !== "visible" || !document.hasFocus()) return;
      void refresh().then(() => {
        if (rejoinInFlight || !accountStorageMatches(revision)) return;
        rejoinAttempted = false;
        setActivation((value) => value + 1);
      });
    };
    window.addEventListener("focus", activate);
    document.addEventListener("visibilitychange", activate);
    return () => {
      window.removeEventListener("focus", activate);
      document.removeEventListener("visibilitychange", activate);
    };
  }, [refresh, revision]);
  const rejoinable = unjoined && !(rejoinRevision === revision && rejoinAttempted);
  useEffect(() => {
    if (rejoinRevision !== revision) {
      rejoinRevision = revision; rejoinAttempted = false;
    }
    if (checked && status?.paired) { rejoinAttempted = true; return; }
    if (!unjoined || rejoinAttempted || rejoinInFlight || !isAuthenticated || document.visibilityState !== "visible" || !document.hasFocus()) return;
    let live = true;
    rejoinAttempted = true;
    rejoinInFlight = true;
    void rejoinBridge(requestPairing).then((joined) => {
      if (!live || !accountStorageMatches(revision)) return;
      if (joined) {
        window.dispatchEvent(new StorageEvent("storage", { key: BRIDGE_SESSION_STORAGE_KEY }));
      }
    }).finally(() => {
      rejoinInFlight = false;
      if (!accountStorageMatches(revision)) setActivation((value) => value + 1);
    });
    return () => { live = false; };
  }, [activation, checked, isAuthenticated, requestPairing, revision, status?.paired, unjoined]);
  // The choice stays with the person; Bridge hears it whenever it's here to listen.
  const joined = Boolean(status?.paired);
  const { storeId } = useDeviceState();
  const workSettings = useQuery(api.deviceWorks.settings, isAuthenticated ? (storeId ? { storeId } : {}) : "skip");
  useEffect(() => {
    if (!joined || !hydrated) return;
    // Connected computers stay reachable by the person's own Spectra, so its AI
    // can see file names and offer to sync them even when the server is hosted.
    void setBridgeAgentHub(true)
      .catch(() => undefined)
      .then(() => { if (accountStorageMatches(revision)) recheckAgentRuntime(); });
  }, [hydrated, joined, revision]);
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
      .catch(() => { if (live) publishDeviceState({ storeId: null }); });
    return () => {
      live = false;
    };
  }, [joined]);
  const backupUploadUrl = useMutation(api.deviceWorks.backupUploadUrl);
  const recordBackup = useMutation(api.deviceWorks.recordBackup);
  const convex = useConvex();
  // A hand-over addressed to this computer is merged as soon as it is known.
  const handOvers = workSettings?.handOvers?.join(",") ?? "";
  useEffect(() => {
    if (!storeKnown || !storeId || !handOvers) return;
    void mergeHandOvers(handOvers.split(","), () => convex.query(api.deviceWorks.handOverBackups, { storeId })).catch(() => undefined);
  }, [convex, handOvers, storeId, storeKnown]);
  useEffect(() => {
    if (!storeKnown || !workSettings || !storeId || !("handOvers" in workSettings)) return;
    const server: BackupServer = {
      uploadUrl: () => backupUploadUrl({}),
      record: (input) => recordBackup({ ...input, storageId: input.storageId as Id<"_storage"> }),
    };
    const check = async () => {
      await retryPendingRemovals().catch(() => undefined);
      // Edits written here after a work moved to another computer go to it first.
      await handOverEdits(workSettings, {
        ...server,
        targets: (artifactIds) => convex.query(api.deviceWorks.handOverTargets, { storeId, artifactIds }),
      }).catch(() => undefined);
      if (!backupIsDue(workSettings)) return;
      await backUpNow(workSettings, server).catch(() => undefined);
    };
    const first = window.setTimeout(() => void check(), BACKUP_SETTLE_MS);
    const later = window.setInterval(() => void check(), BACKUP_CHECK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(later);
    };
  }, [backupUploadUrl, convex, recordBackup, storeId, storeKnown, workSettings]);
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
