"use client";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useBridgeHealth } from "./use-bridge";
import { offerPairing, pairingStatus } from "./client";

export function BridgeSettings() {
  const local = useBridgeHealth();
  const overview = useQuery(api.bridge.overview, {});
  const requestPairing = useMutation(api.bridge.requestPairing);
  const [pairing, setPairing] = useState<{ challenge: string; shortCode: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const pairingTimer = useRef<number | null>(null);
  const pairingExpiry = useRef<number | null>(null);
  const stopPairingPoll = useCallback(() => {
    if (pairingTimer.current !== null) window.clearInterval(pairingTimer.current);
    if (pairingExpiry.current !== null) window.clearTimeout(pairingExpiry.current);
    pairingTimer.current = null; pairingExpiry.current = null;
  }, []);
  useEffect(() => stopPairingPoll, [stopPairingPoll]);
  const stateLabel = local.state === "update-required" ? "Update required" : local.state === "connected" ? "Connected" : local.state === "paused" ? "Paused" : "Disconnected";
  async function beginPairing() {
    setBusy(true);
    try { const result = await requestPairing({ browserOrigin: window.location.origin }); await offerPairing({ ...result, browserOrigin: window.location.origin }); setPairing(result); stopPairingPoll(); pairingTimer.current = window.setInterval(async () => { const status = await pairingStatus(result.challenge); if (status?.paired && status.sessionToken) { window.sessionStorage.setItem("spectra.bridge.session", status.sessionToken); setPairing(null); stopPairingPoll(); } }, 1_000); pairingExpiry.current = window.setTimeout(stopPairingPoll, 10 * 60_000); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid gap-8">
      <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <header className="pt-2"><h2 className="font-display text-[18px] font-semibold text-[var(--text-primary)]">Spectra Bridge</h2><p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">Selected folders remain yours. Raw device paths never leave this device.</p></header>
        <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <div className="flex items-center justify-between gap-4"><div><div className="text-[13px] font-semibold text-[var(--text-primary)]">{stateLabel}</div><p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">{local.state === "update-required" ? `Bridge ${local.health?.version ?? ""} uses protocol ${local.health?.protocolVersion}. Update Spectra Bridge to continue.` : local.state === "connected" ? "Runs quietly on this device. Selected folders are available to Spectra." : "Spectra works normally without the Bridge. Connect it when you want to use files on this device."}</p></div>{local.state === "update-required" ? <Button size="sm">Update Spectra Bridge</Button> : local.state !== "connected" ? <Button size="sm" disabled={busy} onClick={() => void beginPairing()}>{busy ? "Preparing…" : "Connect this device"}</Button> : null}</div>
          {pairing ? <div className="mt-4 rounded-[8px] bg-[var(--bg-secondary)] p-4"><div className="text-[11px] text-[var(--text-secondary)]">Confirm this code in the Spectra Bridge window</div><div className="mt-2 font-mono text-[26px] font-semibold tracking-[0.16em] text-[var(--text-primary)]">{pairing.shortCode}</div><div className="mt-1 text-[10px] text-[var(--text-tertiary)]">Expires {new Date(pairing.expiresAt).toLocaleTimeString()}</div></div> : null}
        </div>
      </section>
      <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10"><header className="pt-2"><h2 className="font-display text-[18px] font-semibold text-[var(--text-primary)]">Selected folders</h2><p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">Folder access is granted only through the native Bridge dialog.</p></header><div className="space-y-2">{overview?.mounts.map((mount) => <div key={mount._id} className="flex min-h-[68px] items-center justify-between rounded-[10px] border border-[var(--border-default)] px-4 py-3"><div><div className="text-[13px] font-medium text-[var(--text-primary)]">{mount.rootLabel}</div><div className="mt-1 text-[11px] text-[var(--text-secondary)]">{mount.fileCount.toLocaleString()} files · {mount.state}{mount.doubleSyncRisk ? " · Another sync provider was detected" : ""}</div></div><div className="text-right text-[10px] text-[var(--text-tertiary)]">{mount.lastScanAt ? `Scanned ${new Date(mount.lastScanAt).toLocaleString()}` : "Waiting for first scan"}</div></div>)}{overview && overview.mounts.length === 0 ? <div className="rounded-[10px] border border-dashed border-[var(--border-default)] p-5 text-[12px] text-[var(--text-secondary)]">No folders selected. Add one from the Spectra Bridge tray.</div> : null}</div></section>
    </div>
  );
}
