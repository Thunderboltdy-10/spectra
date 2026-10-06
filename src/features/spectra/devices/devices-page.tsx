"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Icon } from "@/components/icons";
import type { BarCommand, CollapseStep } from "@/components/ui/adaptive-bar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-state";
import { SidePanel } from "@/components/ui/side-panel";
import { Row } from "@/components/ui/row";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { readConvexError } from "../../../../shared/convex-error.mjs";
import { POLICY_PRESETS } from "../../../../shared/sync-policy";
import { DEVICES_HREF, pairingFailureMessage, unpairBridge } from "../bridge/client";
import { useBridgeHealth } from "../bridge/use-bridge";
import { spectraBus } from "../events";
import { permissionChoicePatch } from "../settings/schema/ai-permissions";
import { useSpectraPreferences } from "../settings/preference-store";
import type { LocalDeviceRequest } from "./actions";
import { DeviceDetails, TONE_GLYPH } from "./device-details";
import { runLocalDeviceAction } from "./device-actions";
import { devicesModel, nativeWritesChoice, nativeWritesPlan, type CloudOverview, type DeviceView, type NativeWrites } from "./devices-model";
import { PairingPanel, THIS_COMPUTER_LIFE_KEY } from "./pairing-panel";
import { devicePairing } from "./pairing";

const BAR_PLAN: readonly CollapseStep[] = [{ hideLabel: "pause" }, { toMenu: "pause" }, { hideLabel: "add" }];

/** A Convex or Bridge failure as one plain sentence, without its code. */
function failureSentence(error: unknown): string {
  const message = error instanceof Error ? readConvexError(error).message || error.message : String(error ?? "");
  return message.replace(/^[A-Z][A-Z0-9_]+:\s*/, "").trim() || "That didn't work. Try again.";
}

type Confirm =
  | { kind: "remove-device"; device: DeviceView }
  | { kind: "remove-folder"; grantId: string; name: string }
  | { kind: "native-writes"; choice: NativeWrites };

/*
 * Devices: this computer and the user's other computers, connected through
 * Spectra Bridge. Connecting starts here (or from the command bar and Spectra
 * AI, which ask this page to), and every action is also an app command.
 */
export function DevicesPage() {
  const local = useBridgeHealth();
  const { isAuthenticated } = useConvexAuth();
  const cloudEnabled = local.online && isAuthenticated;
  const cloud = useQuery(api.bridge.overview, cloudEnabled ? {} : "skip") as CloudOverview | null | undefined;
  const policy = useQuery(api.syncPolicy.effective, cloudEnabled ? {} : "skip");
  const requestPairing = useMutation(api.bridge.requestPairing);
  const revokeDevice = useMutation(api.bridge.revokeDevice);
  const overridePolicy = useMutation(api.syncPolicy.overrideAccount);
  const { preferences, update } = useSpectraPreferences();
  const pairing = devicePairing();
  const pairingState = useSyncExternalStore(pairing.subscribe, pairing.get, pairing.get);

  const [now, setNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Choosing a device opens Details, even after the user folded it.
  const [reveal, setReveal] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [justPaired, setJustPaired] = useState(false);
  const [wantTick, setWantTick] = useState(0);
  const connectParam = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const model = useMemo(
    () => devicesModel({ local: { reachability: local.reachability, status: local.status }, cloud, now }),
    [cloud, local.reachability, local.status, now],
  );
  const all = useMemo(() => [...(model.thisComputer ? [model.thisComputer] : []), ...model.others], [model]);
  const selected = all.find((device) => device.id === selectedId) ?? model.thisComputer ?? model.others[0] ?? null;
  const here = model.thisComputer;
  const stored = {
    permissionFullControl: preferences.ai.permissionFullControl,
    permissionAllow: preferences.ai.permissionAllow,
    permissionDeny: preferences.ai.permissionDeny,
  };
  const nativeWrites = nativeWritesChoice(policy?.contentDirection, stored);

  const connect = useCallback(() => {
    setNotice(undefined);
    void pairing.start(requestPairing);
  }, [pairing, requestPairing]);

  // The command bar, Spectra AI and ?connect=1 ask this page to connect.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("connect") === "1") {
      connectParam.current = true;
      window.history.replaceState(window.history.state, "", DEVICES_HREF);
    }
    return pairing.subscribe(() => setWantTick((tick) => tick + 1));
  }, [pairing]);
  useEffect(() => {
    if (!isAuthenticated) return;
    const wanted = pairing.takeWanted() || connectParam.current;
    connectParam.current = false;
    if (wanted) connect();
  }, [connect, isAuthenticated, pairing, wantTick]);

  // Once paired, this computer's row forms where the code was.
  useEffect(() => {
    if (pairingState.phase !== "paired") return;
    setJustPaired(true);
    void local.refresh();
    const settle = window.setTimeout(() => pairing.reset(), 600);
    const fade = window.setTimeout(() => setJustPaired(false), 4_000);
    return () => {
      window.clearTimeout(settle);
      window.clearTimeout(fade);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per pairing
  }, [pairingState.phase]);

  const refresh = local.refresh;
  useEffect(() => spectraBus.on("devices.changed", () => void refresh()), [refresh]);

  function showDetails(id: string | null) {
    setSelectedId(id);
    setReveal((value) => value + 1);
  }

  async function act(request: LocalDeviceRequest) {
    if (request.action === "remove_folder" && request.grantId) {
      const folder = here?.folders.find((entry) => entry.id === request.grantId);
      setConfirm({ kind: "remove-folder", grantId: request.grantId, name: folder?.path ?? "this folder" });
      return;
    }
    setBusy(request.grantId ? `${request.action}:${request.grantId}` : request.action);
    const outcome = await runLocalDeviceAction(request);
    setBusy(null);
    setNotice(outcome.message);
  }

  function chooseNativeWrites(choice: NativeWrites) {
    if (choice === nativeWrites) return;
    if (nativeWrites === "never") setConfirm({ kind: "native-writes", choice });
    else void applyNativeWrites(choice);
  }

  async function applyNativeWrites(choice: NativeWrites) {
    const plan = nativeWritesPlan(choice, policy?.contentDirection);
    try {
      if (plan.preset)
        await overridePolicy({ values: POLICY_PRESETS[plan.preset], idempotencyKey: `devices:native-writes:${choice}:${Date.now()}` });
      if (plan.permission) update("ai", permissionChoicePatch(stored, "bridge_files", plan.permission));
      setNotice(choice === "never" ? "Desktop files stay as they are." : choice === "ask" ? "Spectra AI asks before it changes a desktop file." : "Spectra saves changes to your desktop files.");
    } catch (error) {
      setNotice(failureSentence(error));
    }
  }

  async function confirmAction() {
    if (!confirm) return;
    setConfirming(true);
    try {
      if (confirm.kind === "native-writes") await applyNativeWrites(confirm.choice);
      else if (confirm.kind === "remove-folder") {
        setBusy(`remove_folder:${confirm.grantId}`);
        const outcome = await runLocalDeviceAction({ action: "remove_folder", grantId: confirm.grantId });
        setNotice(outcome.message);
      } else if (confirm.device.id) {
        await revokeDevice({ deviceId: confirm.device.id as Id<"bridgeDevices"> });
        if (confirm.device.isThisComputer) {
          await unpairBridge();
          local.forgetSession();
          void local.refresh();
        }
        setSelectedId(null);
        setNotice(`Removed ${confirm.device.name}. Its files stay on the computer.`);
      }
    } catch (error) {
      setNotice(confirm.kind === "remove-device" ? pairingFailureMessage(error, local.discovery, local.online) : failureSentence(error));
    } finally {
      setBusy(null);
      setConfirming(false);
      setConfirm(null);
    }
  }

  const connecting = pairingState.phase !== "idle" && pairingState.phase !== "paired";
  const commands: BarCommand[] = [
    ...(here?.live
      ? [
          { id: "add", icon: "add", label: "Add folder", disabled: busy === "add_folder", onSelect: () => void act({ action: "add_folder" }) },
          {
            id: "pause",
            icon: here.paused ? "play" : "pause",
            label: here.paused ? "Resume syncing" : "Pause syncing",
            active: here.paused,
            onSelect: () => void act({ action: here.paused ? "resume_syncing" : "pause_syncing" }),
          },
        ] satisfies BarCommand[]
      : []),
    ...(!here?.live && !connecting
      ? [
          {
            id: "connect",
            icon: "devices",
            label: here ? "Reconnect this computer" : "Connect this computer",
            pinned: true,
            render: () => (
              <Button variant="primary" size="sm" disabled={!isAuthenticated} onClick={connect}>
                {here ? "Reconnect this computer" : "Connect this computer"}
              </Button>
            ),
          },
        ] satisfies BarCommand[]
      : []),
  ];

  const deviceRow = (device: DeviceView) => (
    <Row
      key={device.id ?? "this-computer"}
      data-device-row={device.isThisComputer ? "this" : "other"}
      glyph="devices"
      title={device.name}
      meta={`${device.label} · ${device.detail}`}
      selected={selected?.id === device.id}
      fresh={device.isThisComputer && justPaired}
      lifeKey={device.isThisComputer ? THIS_COMPUTER_LIFE_KEY : `device:${device.id}`}
      actionsVisible
      onClick={() => showDetails(device.id)}
      actions={
        <>
          <span className={cn("grid size-7 place-items-center", device.tone === "attention" ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]")} aria-hidden>
            <Icon name={TONE_GLYPH[device.tone]} size={14} />
          </span>
          <IconButton
            icon="openSide"
            label={`Details for ${device.name}`}
            size="compact"
            onClick={(event) => {
              event.stopPropagation();
              showDetails(device.id);
            }}
          />
        </>
      }
    />
  );

  return (
    <main className="spectra-wave-y relative isolate flex h-full min-h-0 flex-1" data-spectra-app-surface="true" data-devices-page>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <PageBody>
          <PageHeader
            title="Devices"
            commands={commands}
            plan={BAR_PLAN}
            barLabel="Devices commands"
            description="Use files from your computers in Spectra. Bridge keeps the folders you choose in sync."
          />
          <p role="status" aria-live="polite" className="mb-4 mt-3 min-h-5 text-caption text-[var(--text-secondary)]">
            {notice}
          </p>

          <div className="min-w-0 space-y-8">
            <section aria-labelledby="devices-this" className="space-y-3">
              <h2 id="devices-this" className="text-caption font-medium text-[var(--text-secondary)]">
                This computer
              </h2>
              <PairingPanel state={pairingState} onCancel={() => pairing.cancel()} onRetry={connect} />
              {here ? (
                <div className="-mx-2.5">{deviceRow(here)}</div>
              ) : !connecting ? (
                <p className="max-w-xl text-caption text-[var(--text-secondary)]">
                  {isAuthenticated
                    ? "This computer isn't connected. Connect it to use its folders in Spectra."
                    : "Sign in to connect this computer."}
                </p>
              ) : null}
            </section>

            <section aria-labelledby="devices-others" className="space-y-3">
              <h2 id="devices-others" className="text-caption font-medium text-[var(--text-secondary)]">
                Other devices
              </h2>
              {model.others.length ? (
                <div className="-mx-2.5">{model.others.map(deviceRow)}</div>
              ) : (
                <p className="max-w-xl text-caption text-[var(--text-secondary)]">
                  {cloud === undefined && cloudEnabled ? "Loading your devices." : "No other computers yet. Open Spectra on another computer to connect it."}
                </p>
              )}
            </section>
          </div>
        </PageBody>
      </div>

      <SidePanel id="devices.details" title="Details" label="Device details" icon="info" stageMin={520} defaultWidth={360} revealKey={reveal || null}>
        {selected ? (
          <div className="px-1 pb-6 pt-2">
            <DeviceDetails
              device={selected}
              now={now}
              busy={busy}
              nativeWrites={nativeWrites}
              nativeWritesDisabled={!policy}
              onAction={(request) => void act(request)}
              onNativeWrites={chooseNativeWrites}
              onRemove={() => setConfirm({ kind: "remove-device", device: selected })}
            />
          </div>
        ) : (
          <EmptyState compact icon="devices" title="No devices yet" detail="Connect this computer to see its folders and choices here." />
        )}
      </SidePanel>

      <ConfirmDialog
        open={confirm !== null}
        pending={confirming}
        destructive={confirm?.kind !== "native-writes"}
        title={
          confirm?.kind === "native-writes"
            ? "Let Spectra write to desktop files?"
            : confirm?.kind === "remove-folder"
              ? "Stop using this folder in Spectra?"
              : confirm?.device.isThisComputer
                ? "Remove this device?"
                : `Remove ${confirm?.device.name ?? "this device"}?`
        }
        detail={
          confirm?.kind === "native-writes"
            ? confirm.choice === "always"
              ? "Spectra saves your changes back to the files on your computers. This applies to every device."
              : "Spectra may save changes back to the files on your computers, and Spectra AI asks first. This applies to every device."
            : confirm?.kind === "remove-folder"
              ? `${confirm.name} stops syncing. Its files stay on this computer.`
              : "It stops syncing and Spectra forgets it. Its files stay on the computer; you can connect it again later."
        }
        confirmLabel={confirm?.kind === "native-writes" ? "Allow writes" : confirm?.kind === "remove-folder" ? "Stop using it" : "Remove"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void confirmAction()}
      />
    </main>
  );
}

