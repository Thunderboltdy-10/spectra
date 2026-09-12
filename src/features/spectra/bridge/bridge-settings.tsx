"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { useBridgeHealth } from "./use-bridge";
import { useMutation, useQuery, useConvexAuth } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { POLICY_PRESETS } from "../../../../shared/sync-policy";
import {
  discoverBridge,
  offerPairing,
  pairingFailureMessage,
  pairingStatus,
  persistBridgeSession,
  rememberedFolderDetail,
  removeBridgeFolder,
  requestBridgeUpdate,
  retryBridgeFolder,
  selectBridgeFolder,
  bridgeReachabilityCopy,
  folderChipLabel,
} from "./client";
import { StorageToggleGroup } from "./storage-toggle-group";
import { BridgeTrustPresets } from "./bridge-trust-presets";
import {
  bridgeTrustPresetForPolicy,
  type BridgeTrustPreset,
} from "../../../../shared/bridge-trust";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import { takePendingBridgeIntent } from "../commands/bridge-intents";
import {
  formatMountProgress,
  isProtectedOriginalPreset,
  mountCountTruth,
  policyPresetFromToggles,
  storageChoiceFromPreset,
  type StorageChoice,
} from "./sync-toggles";
import { humanizePublicFailure, isCloudDiscoveryFailure } from "./humanize";

function stripProviderJargon(detail: string) {
  return detail
    .replace(
      /\s*Provider-managed folder detected; conflict windows may be wider\.?/gi,
      "",
    )
    .trim();
}

export function BridgeSettings() {
  const local = useBridgeHealth();
  const { isAuthenticated } = useConvexAuth();
  const cloudEnabled = local.online && isAuthenticated;
  const effectivePolicy = useQuery(
    api.syncPolicy.effective,
    cloudEnabled ? {} : "skip",
  );
  const cloudOverview = useQuery(
    api.bridge.overview,
    cloudEnabled ? {} : "skip",
  );
  const overridePolicy = useMutation(api.syncPolicy.overrideAccount);
  const requestPairing = useMutation(api.bridge.requestPairing);
  const revokeDevice = useMutation(api.bridge.revokeDevice);
  const [pairing, setPairing] = useState<{
    challenge: string;
    shortCode: string;
    expiresAt: number;
  } | null>(null);
  const [pairingExpired, setPairingExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [folderBusy, setFolderBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [updateNote, setUpdateNote] = useState<string>();
  const [trustNote, setTrustNote] = useState<string>();
  const [pendingTrustPreset, setPendingTrustPreset] =
    useState<BridgeTrustPreset | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pairingTimer = useRef<number | null>(null);
  const pairingExpiry = useRef<number | null>(null);
  const bridgeActionHandlers = useRef<{
    setup: (input: {
      action: "pair" | "select-location" | "retry-connection" | "retry-folder";
      grantId?: string;
    }) => Promise<SpectraCommandOutcome>;
    policy: (input: { preset: BridgeTrustPreset }) => Promise<SpectraCommandOutcome>;
  } | null>(null);
  const stopPairingPoll = useCallback(() => {
    if (pairingTimer.current !== null)
      window.clearInterval(pairingTimer.current);
    if (pairingExpiry.current !== null)
      window.clearTimeout(pairingExpiry.current);
    pairingTimer.current = null;
    pairingExpiry.current = null;
  }, []);
  useEffect(() => stopPairingPoll, [stopPairingPoll]);
  const storageChoice = storageChoiceFromPreset(effectivePolicy?.preset);
  const protectedOriginal = isProtectedOriginalPreset(effectivePolicy?.preset);
  const trustPreset = bridgeTrustPresetForPolicy(effectivePolicy);
  const connected = local.state === "connected";
  const reachability = local.reachability;
  const discovery = local.discovery;
  async function beginPairing(): Promise<SpectraCommandOutcome> {
    setBusy(true);
    setPairingExpired(false);
    try {
      setError(undefined);
      const found = await discoverBridge();
      if (found.kind !== "running") {
        setError(pairingFailureMessage("Failed to fetch", found, local.online));
        setPairing(null);
        return {
          status: "failed",
          message: pairingFailureMessage("Failed to fetch", found, local.online),
        };
      }
      const result = await requestPairing({
        browserOrigin: window.location.origin,
      });
      await offerPairing({ ...result, browserOrigin: window.location.origin });
      setPairing(result);
      stopPairingPoll();
      pairingTimer.current = window.setInterval(async () => {
        if (Date.now() >= result.expiresAt) {
          stopPairingPoll();
          setPairing(null);
          setPairingExpired(true);
          return;
        }
        const status = await pairingStatus(result.challenge);
        if (status?.paired && status.sessionToken) {
          persistBridgeSession(status.sessionToken);
          setPairing(null);
          setPairingExpired(false);
          stopPairingPoll();
          await local.refresh();
        }
      }, 1_000);
      pairingExpiry.current = window.setTimeout(
        () => {
          stopPairingPoll();
          setPairing(null);
          setPairingExpired(true);
        },
        Math.max(0, result.expiresAt - Date.now()),
      );
      return {
        status: "needs-human",
        message: "Pairing is ready. Finish the Bridge pairing step on this device.",
        data: { challenge: result.challenge },
      };
    } catch (reason) {
      const found = await discoverBridge().catch(() => discovery);
      setError(pairingFailureMessage(reason, found, local.online));
      setPairing(null);
      return {
        status: "failed",
        message: pairingFailureMessage(reason, found, local.online),
      };
    } finally {
      setBusy(false);
    }
  }
  async function folderAction(key: string, action: () => Promise<void>): Promise<SpectraCommandOutcome> {
    setFolderBusy(key);
    setError(undefined);
    try {
      await action();
      await local.refresh();
      return { status: "completed", message: "Bridge folder action completed." };
    } catch (reason) {
      setError(pairingFailureMessage(reason, local.discovery, local.online));
      return {
        status: "failed",
        message: pairingFailureMessage(reason, local.discovery, local.online),
      };
    } finally {
      setFolderBusy(null);
    }
  }
  const mounts = useMemo(() => {
    const localMounts = local.status?.mounts ?? [];
    const byGrant = new Map(localMounts.map((mount) => [mount.id, mount]));
    const cloudMounts = (cloudOverview?.mounts ?? []).filter(
      (mount) =>
        !local.status?.deviceId || mount.deviceId === local.status.deviceId,
    );
    const cloudByGrant = new Map(
      cloudMounts.map((mount) => [mount.grantId, mount]),
    );
    const ids = new Set([...byGrant.keys(), ...cloudByGrant.keys()]);
    return [...ids].map((id) => {
      const live = byGrant.get(id);
      const cloud = cloudByGrant.get(id);
      if (live && connected) {
        const discoveryFailed = isCloudDiscoveryFailure(live.detail);
        const cleaned = stripProviderJargon(live.detail);
        return {
          ...live,
          detail: humanizePublicFailure(cleaned || "Selected on this device"),
          state: discoveryFailed ? "waiting" : live.state,
          discoveryFailed,
        };
      }
      return {
        id,
        label: live?.label ?? cloud?.rootLabel ?? "Selected folder",
        state: connected
          ? cloud?.state === "active"
            ? "selected"
            : (cloud?.state ?? live?.state ?? "unavailable")
          : "disconnected",
        detail: connected
          ? humanizePublicFailure(
              stripProviderJargon(
                live?.detail ??
                  "This folder is remembered and will resume when its device is available.",
              ),
            )
          : rememberedFolderDetail(reachability),
        synced: live?.synced ?? 0,
        total: live?.total || cloud?.fileCount || 0,
        doubleSyncRisk: live?.doubleSyncRisk ?? cloud?.doubleSyncRisk ?? false,
        discoveryFailed: isCloudDiscoveryFailure(live?.detail ?? ""),
      };
    });
  }, [cloudOverview?.mounts, connected, local.status, reachability]);
  const thisDevice = useMemo(() => {
    const devices = cloudOverview?.devices ?? [];
    const liveId = local.status?.deviceId;
    return (
      devices.find((device) => liveId && device._id === liveId) ??
      devices.find((device) => device.state === "active") ??
      null
    );
  }, [cloudOverview?.devices, local.status?.deviceId]);
  async function disconnectThisComputer() {
    if (!thisDevice) return;
    setDisconnecting(true);
    setError(undefined);
    try {
      await revokeDevice({ deviceId: thisDevice._id });
      local.forgetSession();
      void local.refresh();
    } catch (reason) {
      setError(pairingFailureMessage(reason, local.discovery, local.online));
    } finally {
      setDisconnecting(false);
    }
  }
  async function applyPolicyPreset(
    preset: "spectra" | "device" | "both" | "linked",
  ): Promise<SpectraCommandOutcome> {
    setPolicyBusy(true);
    setError(undefined);
    try {
      await overridePolicy({
        values: POLICY_PRESETS[preset],
        idempotencyKey: `account:${preset}:${Date.now()}`,
      });
      setPendingTrustPreset(null);
      setTrustNote(
        preset === "both"
          ? "Native write & sync is enabled for the account default. Existing folders stay where they are; review each existing item before changing its storage strategy."
        : "Managed-copy protection is now the account default. Existing folders stay where they are.",
      );
      return { status: "completed", message: "Bridge trust preset applied." };
    } catch (reason) {
      setError(humanizePublicFailure(reason));
      return {
        status: "failed",
        message: humanizePublicFailure(reason),
      };
    } finally {
      setPolicyBusy(false);
    }
  }
  async function selectTrustPreset(preset: BridgeTrustPreset): Promise<SpectraCommandOutcome> {
    if (preset === "advanced") {
      setPendingTrustPreset(null);
      setTrustNote(
        "Advanced controls are visible below. Your detailed policy remains in force until you explicitly change a field.",
      );
      return { status: "completed", message: "Advanced Bridge trust controls opened." };
    }
    const target = preset === "managed-copy" ? "spectra" : "both";
    if (target === "both" && effectivePolicy?.preset !== "both") {
      setPendingTrustPreset(preset);
      setTrustNote(
        "This choice can write approved linked files on this PC. Apply it explicitly after reviewing the local and cloud preview.",
      );
      return {
        status: "needs-human",
        message: "Review the local and cloud preview, then apply the Bridge trust preset.",
      };
    }
    return applyPolicyPreset(target);
  }
  async function setStorageChoice(
    choice: StorageChoice,
    protectedFlag = protectedOriginal,
  ) {
    const preset = policyPresetFromToggles(choice, protectedFlag);
    if (preset === "both" && effectivePolicy?.preset !== "both") {
      setPendingTrustPreset("native-sync");
      setTrustNote(
        "Native write & sync needs an explicit confirmation. Review the preview above, then apply it below.",
      );
      return;
    }
    await applyPolicyPreset(preset);
  }
  const reachabilityCopy = bridgeReachabilityCopy(reachability);
  const stateLabel = reachabilityCopy.label;
  const stateDetail =
    reachability === "connected" && !local.status?.cloudConnected
      ? "The Bridge is running. Spectra Cloud has not been reached recently. Changes remain queued safely."
      : reachabilityCopy.detail;
  bridgeActionHandlers.current = {
    setup: async ({ action, grantId }) => {
      if (action === "pair") return beginPairing();
      if (action === "select-location")
        return folderAction("select", selectBridgeFolder);
      if (action === "retry-folder") {
        if (grantId)
          return folderAction(`retry:${grantId}`, () =>
            retryBridgeFolder(grantId),
          );
        return {
          status: "failed",
          message: "Bridge folder retry requires a folder grant.",
        };
      }
      await local.refresh();
      return { status: "completed", message: "Bridge connection refreshed." };
    },
    policy: ({ preset }) => selectTrustPreset(preset),
  };
  useEffect(() => {
    const removeSetup = spectraBus.handle("bridge.setup", (input) =>
      bridgeActionHandlers.current?.setup(input),
    );
    const removePolicy = spectraBus.handle("bridge.policy.change", (input) =>
      bridgeActionHandlers.current?.policy(input),
    );
    return () => {
      removeSetup();
      removePolicy();
    };
  }, []);
  useEffect(() => {
    const intent = takePendingBridgeIntent();
    if (!intent) return;
    const run = intent.kind === "setup"
      ? bridgeActionHandlers.current?.setup(intent.input)
      : bridgeActionHandlers.current?.policy(intent.input);
    void run;
  }, []);
  return (
    <div className="grid gap-8">
      <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <header className="pt-2">
          <h2 className="font-display text-subhead font-semibold text-[var(--text-primary)]">
            Spectra Bridge
          </h2>
          <p className="mt-1 text-caption leading-5 text-[var(--text-secondary)]">
            Selected folders remain yours. Paths never leave this device.
          </p>
        </header>
        <div className="rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-caption font-semibold text-[var(--text-primary)]">
                {stateLabel}
              </div>
              <p className="mt-1 text-micro leading-5 text-[var(--text-secondary)]">
                {stateDetail}
              </p>
            </div>
            {reachability === "update-required" ? (
              <Button
                size="sm"
                disabled={updating}
                onClick={() => {
                  setUpdating(true);
                  setUpdateNote(undefined);
                  void requestBridgeUpdate()
                    .then((message) => setUpdateNote(message))
                    .finally(() => setUpdating(false));
                }}
              >
                {updating ? "Updating…" : "Update Bridge"}
              </Button>
            ) : connected ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={disconnecting || !thisDevice}
                onClick={() => void disconnectThisComputer()}
              >
                {disconnecting ? "Disconnecting…" : "Disconnect this computer"}
              </Button>
            ) : !connected ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void beginPairing()}
              >
                {busy ? "Preparing…" : "Connect this device"}
              </Button>
            ) : null}
          </div>
          {pairing ? (
            <div
              className="mt-4 rounded-control bg-[var(--bg-secondary)] p-4 text-micro text-[var(--text-secondary)]"
              role="status"
            >
              Connecting this device. Keep Spectra Bridge open. This attempt
              stays active until it finishes or times out.
            </div>
          ) : null}
          {pairingExpired ? (
            <div className="mt-4 grid gap-2" role="alert">
              <p className="text-micro text-[var(--danger)]">
                This connection attempt timed out. Try again.
              </p>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void beginPairing()}
              >
                Try again
              </Button>
            </div>
          ) : null}
          {updateNote ? (
            <p
              className="mt-3 text-micro text-[var(--text-secondary)]"
              role="status"
            >
              {updateNote}
            </p>
          ) : null}
          {connected ? (
            <p className="mt-3 text-micro leading-5 text-[var(--text-secondary)]">
              Disconnecting stops queued file writes for this PC. Files on disk
              stay.
            </p>
          ) : null}
        </div>
      </section>
      <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <header className="pt-2">
          <h2 className="font-display text-subhead font-semibold text-[var(--text-primary)]">
            Trust for linked files
          </h2>
          <p className="mt-1 text-caption leading-5 text-[var(--text-secondary)]">
            Start isolated. Native write is always an explicit opt-in, and the
            account choice does not silently move existing folders.
          </p>
        </header>
        <div className="grid gap-3">
          <BridgeTrustPresets
            value={trustPreset}
            pending={pendingTrustPreset}
            disabled={!cloudEnabled || !effectivePolicy || policyBusy}
            onSelect={(preset) => void selectTrustPreset(preset)}
          />
          {pendingTrustPreset === "native-sync" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-[var(--warning)]/45 bg-[var(--bg-secondary)] p-3">
              <p className="max-w-2xl text-micro leading-5 text-[var(--text-secondary)]">
                Apply this only if you want Spectra to write approved linked
                files. Existing pending changes remain pending until each item
                completes its own verified storage transition.
              </p>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  disabled={policyBusy}
                  onClick={() => void applyPolicyPreset("both")}
                >
                  {policyBusy ? "Applying…" : "Enable native sync"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={policyBusy}
                  onClick={() => {
                    setPendingTrustPreset(null);
                    setTrustNote("No trust change was applied.");
                  }}
                >
                  Keep managed copy
                </Button>
              </div>
            </div>
          ) : null}
          {trustNote ? (
            <p
              className="text-micro leading-5 text-[var(--text-secondary)]"
              role="status"
            >
              {trustNote}
            </p>
          ) : null}
        </div>
      </section>
      <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <header className="pt-2">
          <h2 className="font-display text-subhead font-semibold text-[var(--text-primary)]">
            How files are stored
          </h2>
          <p className="mt-1 text-caption leading-5 text-[var(--text-secondary)]">
            New folders inherit this choice unless you change one.
          </p>
        </header>
        <StorageToggleGroup
          value={storageChoice}
          onChange={(choice) => void setStorageChoice(choice)}
          showProtected
          protectedOriginal={protectedOriginal}
          onProtectedChange={(next) =>
            void setStorageChoice(storageChoice, next)
          }
        />
      </section>
      <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <header className="pt-2">
          <h2 className="font-display text-subhead font-semibold text-[var(--text-primary)]">
            Selected folders
          </h2>
          <p className="mt-1 text-caption leading-5 text-[var(--text-secondary)]">
            Choose and manage folders here. Your computer uses its native folder
            picker when you add one.
          </p>
        </header>
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!connected || folderBusy !== null}
              onClick={() => void folderAction("select", selectBridgeFolder)}
            >
              {folderBusy === "select" ? "Opening…" : "Add folder"}
            </Button>
          </div>
          {mounts.map((mount) => {
            const count = mountCountTruth({
              live: connected,
              state: mount.state,
              synced: mount.synced,
              total: mount.total,
            });
            return (
              <div
                key={mount.id}
                className="flex min-h-[76px] items-center justify-between gap-4 rounded-card border border-[var(--border-default)] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-caption font-medium text-[var(--text-primary)]">
                    {mount.label}
                  </div>
                  <div className="mt-1 text-micro text-[var(--text-secondary)]">
                    {mount.detail}
                    {count.kind === "progress"
                      ? ` · ${formatMountProgress(count.synced, count.total)}`
                      : count.kind === "unavailable" && !connected
                        ? ""
                        : ""}
                  </div>
                  {count.kind === "unavailable" &&
                  !connected &&
                  reachability === "not-running" ? (
                    <div className="mt-1 text-micro text-[var(--text-tertiary)]">
                      {count.sentence}
                    </div>
                  ) : null}
                  {mount.doubleSyncRisk ? (
                    <div className="mt-1 text-micro text-[var(--warning)]">
                      This folder is also managed by another program. Conflicts
                      may take longer to notice.
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge
                    tone={
                      mount.discoveryFailed
                        ? "attention"
                        : mount.state === "error"
                          ? "failure"
                          : connected &&
                              (mount.state === "selected" ||
                                mount.state === "active")
                            ? "healthy"
                            : "attention"
                    }
                  >
                    {folderChipLabel({
                      state: mount.state,
                      discoveryFailed: Boolean(mount.discoveryFailed),
                      reachability,
                    })}
                  </StatusBadge>
                  {mount.state === "error" ||
                  mount.state === "selected" ||
                  mount.state === "unavailable" ||
                  mount.state === "waiting" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={folderBusy !== null}
                      onClick={() =>
                        void folderAction(`retry:${mount.id}`, () =>
                          retryBridgeFolder(mount.id),
                        )
                      }
                    >
                      {folderBusy === `retry:${mount.id}`
                        ? "Retrying…"
                        : "Retry"}
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={folderBusy !== null}
                    onClick={() =>
                      void folderAction(`remove:${mount.id}`, () =>
                        removeBridgeFolder(mount.id),
                      )
                    }
                  >
                    {folderBusy === `remove:${mount.id}`
                      ? "Removing…"
                      : "Stop using"}
                  </Button>
                </div>
              </div>
            );
          })}
          {local.checked && connected && mounts.length === 0 ? (
            <div className="rounded-card border border-dashed border-[var(--border-default)] p-5 text-caption text-[var(--text-secondary)]">
              No folders are selected on this device.
            </div>
          ) : null}
          {error ? (
            <p className="text-micro text-[var(--danger)]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
