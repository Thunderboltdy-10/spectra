"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useBridgeHealth } from "./use-bridge";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  POLICY_PRESETS,
  type SyncPolicyPreset,
} from "../../../../shared/sync-policy";
import {
  offerPairing,
  pairingStatus,
  persistBridgeSession,
  removeBridgeFolder,
  retryBridgeFolder,
  selectBridgeFolder,
} from "./client";

export function BridgeSettings() {
  const local = useBridgeHealth();
  const effectivePolicy = useQuery(api.syncPolicy.effective, {});
  const overridePolicy = useMutation(api.syncPolicy.overrideAccount);
  const requestPairing = useMutation(api.bridge.requestPairing);
  const [pairing, setPairing] = useState<{
    challenge: string;
    shortCode: string;
    expiresAt: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [folderBusy, setFolderBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
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
  const stateLabel =
    local.state === "update-required"
      ? "Update required"
      : local.state === "connected"
        ? "Connected"
        : local.state === "paused"
          ? "Paused"
          : "Disconnected";
  async function beginPairing() {
    setBusy(true);
    try {
      setError(undefined);
      const result = await requestPairing({
        browserOrigin: window.location.origin,
      });
      await offerPairing({ ...result, browserOrigin: window.location.origin });
      setPairing(result);
      stopPairingPoll();
      pairingTimer.current = window.setInterval(async () => {
        const status = await pairingStatus(result.challenge);
        if (status?.paired && status.sessionToken) {
          persistBridgeSession(status.sessionToken);
          setPairing(null);
          stopPairingPoll();
          await local.refresh();
        }
      }, 1_000);
      pairingExpiry.current = window.setTimeout(stopPairingPoll, 10 * 60_000);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Spectra Bridge could not connect.",
      );
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
      setError(
        reason instanceof Error
          ? reason.message
          : "Spectra Bridge could not complete that folder action.",
      );
    } finally {
      setFolderBusy(null);
    }
  }
  const mounts = local.status?.mounts ?? [];
  async function setStoragePreset(preset: SyncPolicyPreset) {
    await overridePolicy({
      values: POLICY_PRESETS[preset],
      idempotencyKey: crypto.randomUUID(),
    });
  }
  return (
    <div className="grid gap-8">
      <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <header className="pt-2">
          <h2 className="font-display text-[18px] font-semibold text-[var(--text-primary)]">
            Spectra Bridge
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
            Selected folders remain yours. Raw device paths never leave this
            device.
          </p>
        </header>
        <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                {stateLabel}
              </div>
              <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                {local.state === "update-required"
                  ? `Bridge ${local.health?.version ?? ""} uses protocol ${local.health?.protocolVersion}. Update Spectra Bridge to continue.`
                  : local.state === "connected"
                    ? local.status?.cloudConnected
                      ? "Runs quietly in the system tray. This device and Spectra Cloud are in contact."
                      : "The Bridge is running, but Spectra Cloud has not been reached recently. Changes remain queued safely."
                    : "Spectra works normally without the Bridge. Connect it once to use files on this device."}
              </p>
            </div>
            {local.state === "update-required" ? (
              <Button size="sm">Update Spectra Bridge</Button>
            ) : local.state !== "connected" ? (
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
            <div className="mt-4 rounded-[8px] bg-[var(--bg-secondary)] p-4">
              <div className="text-[11px] text-[var(--text-secondary)]">
                Confirm this code in the Spectra Bridge window
              </div>
              <div className="mt-2 font-mono text-[26px] font-semibold tracking-[0.16em] text-[var(--text-primary)]">
                {pairing.shortCode}
              </div>
              <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                Expires {new Date(pairing.expiresAt).toLocaleTimeString()}
              </div>
            </div>
          ) : null}
        </div>
      </section>
      <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <header className="pt-2">
          <h2 className="font-display text-[18px] font-semibold text-[var(--text-primary)]">
            Storage policy
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
            New folders inherit this choice unless you override them.
          </p>
        </header>
        <div className="space-y-3">
          <div className="text-[11px] text-[var(--text-secondary)]">
            Current:{" "}
            <span className="font-medium text-[var(--text-primary)]">
              {effectivePolicy?.preset ?? "spectra"}
            </span>{" "}
            ·{" "}
            {effectivePolicy?.source.kind === "default"
              ? "Account default"
              : `Set at ${effectivePolicy?.source.kind}`}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["spectra", "device", "both", "linked"] as const).map(
              (preset) => (
                <Button
                  key={preset}
                  variant={
                    effectivePolicy?.preset === preset ? "primary" : "secondary"
                  }
                  size="sm"
                  onClick={() => void setStoragePreset(preset)}
                >
                  {preset === "spectra"
                    ? "Keep in Spectra"
                    : preset === "device"
                      ? "Keep on this device"
                      : preset === "both"
                        ? "Keep on device + Spectra"
                        : "Link without changing original"}
                </Button>
              ),
            )}
          </div>
        </div>
      </section>
      <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <header className="pt-2">
          <h2 className="font-display text-[18px] font-semibold text-[var(--text-primary)]">
            Selected folders
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
            Choose and manage folders here. Windows only shows its native folder
            picker when you add one.
          </p>
        </header>
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={local.state !== "connected" || folderBusy !== null}
              onClick={() => void folderAction("select", selectBridgeFolder)}
            >
              {folderBusy === "select" ? "Opening…" : "Add folder"}
            </Button>
          </div>
          {mounts.map((mount) => (
            <div
              key={mount.id}
              className="flex min-h-[76px] items-center justify-between gap-4 rounded-[10px] border border-[var(--border-default)] px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                  {mount.label}
                </div>
                <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  {mount.detail}
                  {mount.total > 0
                    ? ` · ${mount.synced.toLocaleString()} of ${mount.total.toLocaleString()}`
                    : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[10px] capitalize text-[var(--text-tertiary)]">
                  {mount.state.replace("-", " ")}
                </span>
                {mount.state === "error" || mount.state === "selected" ? (
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
                    {folderBusy === `retry:${mount.id}` ? "Retrying…" : "Retry"}
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
          ))}
          {local.checked &&
          local.state === "connected" &&
          mounts.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-[var(--border-default)] p-5 text-[12px] text-[var(--text-secondary)]">
              No folders are selected on this device.
            </div>
          ) : null}
          {error ? (
            <p className="text-[11px] text-[var(--danger)]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
