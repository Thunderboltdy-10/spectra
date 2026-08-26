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
import {
  formatMountProgress,
  mountCountTruth,
  policyPresetFromToggles,
  storageChoiceFromPreset,
  type StorageChoice,
} from "./sync-toggles";
import {
  humanizePublicFailure,
  isCloudDiscoveryFailure,
} from "./humanize";

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
  const pairingTimer = useRef<number | null>(null);
  const pairingExpiry = useRef<number | null>(null);
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
  const connected = local.state === "connected";
  const reachability = local.reachability;
  const discovery = local.discovery;
  async function beginPairing() {
    setBusy(true);
    setPairingExpired(false);
    try {
      setError(undefined);
      const found = await discoverBridge();
      if (found.kind !== "running") {
        setError(pairingFailureMessage("Failed to fetch", found, local.online));
        setPairing(null);
        return;
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
      pairingExpiry.current = window.setTimeout(() => {
        stopPairingPoll();
        setPairing(null);
        setPairingExpired(true);
      }, Math.max(0, result.expiresAt - Date.now()));
    } catch (reason) {
      const found = await discoverBridge().catch(() => discovery);
      setError(pairingFailureMessage(reason, found, local.online));
      setPairing(null);
    } finally {
      setBusy(false);
    }
  }
  async function folderAction(key: string, action: () => Promise<void>) {
    setFolderBusy(key);
    setError(undefined);
    try {
      await action();
      await local.refresh();
    } catch (reason) {
      setError(pairingFailureMessage(reason, local.discovery, local.online));
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
          detail: humanizePublicFailure(
            cleaned || "Selected on this device",
          ),
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
        doubleSyncRisk:
          live?.doubleSyncRisk ?? cloud?.doubleSyncRisk ?? false,
        discoveryFailed: isCloudDiscoveryFailure(live?.detail ?? ""),
      };
    });
  }, [cloudOverview?.mounts, connected, local.status, reachability]);
  async function setStorageChoice(choice: StorageChoice) {
    const preset = policyPresetFromToggles(choice, false);
    await overridePolicy({
      values: POLICY_PRESETS[preset],
      idempotencyKey: `account:${preset}:${Date.now()}`,
    });
  }
  const reachabilityCopy = bridgeReachabilityCopy(reachability);
  const stateLabel = reachabilityCopy.label;
  const stateDetail =
    reachability === "connected" && !local.status?.cloudConnected
      ? "The Bridge is running. Spectra Cloud has not been reached recently. Changes remain queued safely."
      : reachabilityCopy.detail;
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
            <p className="mt-3 text-micro text-[var(--text-secondary)]" role="status">
              {updateNote}
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
        />
      </section>
      <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <header className="pt-2">
          <h2 className="font-display text-subhead font-semibold text-[var(--text-primary)]">
            Selected folders
          </h2>
          <p className="mt-1 text-caption leading-5 text-[var(--text-secondary)]">
            Choose and manage folders here. Windows only shows its native folder
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
