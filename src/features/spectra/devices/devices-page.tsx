"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { BarCommand, CollapseStep } from "@/components/ui/adaptive-bar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { readConvexError } from "../../../../shared/convex-error.mjs";
import { POLICY_PRESETS } from "../../../../shared/sync-policy";
import {
  bridgeDownloadUrl,
  bridgePlatform,
  bridgeReachabilityCopy,
  DEVICES_HREF,
  pairingFailureMessage,
  unpairBridge,
  type BridgeReachability,
} from "../bridge/client";
import { Icon } from "@/components/icons";
import { useBridgeHealth } from "../bridge/use-bridge";
import { spectraBus } from "../events";
import { permissionChoicePatch } from "../settings/schema/ai-permissions";
import { useSpectraPreferences } from "../settings/preference-store";
import type { LocalDeviceRequest } from "./actions";
import { DeviceCard } from "./device-card";
import { runLocalDeviceAction } from "./device-actions";
import { devicesModel, nativeWritesChoice, nativeWritesPlan, type CloudOverview, type DeviceView, type NativeWrites } from "./devices-model";
import { NativeWritesChoice } from "./native-writes-choice";
import { PairingPanel, THIS_COMPUTER_LIFE_KEY } from "./pairing-panel";
import { devicePairing } from "./pairing";
import { firstTipMoment } from "../onboarding/first-tips";

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
 * Devices: the user's computers connected through Spectra Bridge, in one
 * list led by the one they are on. Here they connect a computer and see and
 * set what is bridged; using those files happens in the Library. Connecting
 * starts here (or from the command bar and Spectra AI, which ask this page
 * to), and every action is also an app command.
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
  const here = model.thisComputer;
  // Read after mount: the server cannot tell which computer this is.
  const [platform, setPlatform] = useState<ReturnType<typeof bridgePlatform>>("other");
  useEffect(() => setPlatform(bridgePlatform()), []);
  const downloadUrl = bridgeDownloadUrl(platform);
  const stored = {
    permissionFullControl: preferences.ai.permissionFullControl,
    permissionAllow: preferences.ai.permissionAllow,
    permissionDeny: preferences.ai.permissionDeny,
  };
  const nativeWrites = nativeWritesChoice(policy?.contentDirection, stored);

  const connect = useCallback(() => {
    setNotice(undefined);
    void pairing.start(requestPairing).then((state) => {
      if (state.phase === "paired") firstTipMoment("bridge");
    });
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
    // Connecting for the first time is the page's own call to action; the bar offers it again only to reconnect.
    ...(here && !here.live && !connecting
      ? [
          {
            id: "connect",
            icon: "devices",
            label: "Reconnect this computer",
            pinned: true,
            render: () => (
              <Button variant="primary" size="sm" disabled={!isAuthenticated} onClick={connect}>
                Reconnect this computer
              </Button>
            ),
          },
        ] satisfies BarCommand[]
      : []),
  ];

  const deviceCard = (device: DeviceView) => (
    <DeviceCard
      key={device.id ?? "this-computer"}
      device={device}
      now={now}
      busy={busy}
      fresh={device.isThisComputer && justPaired}
      lifeKey={device.isThisComputer ? THIS_COMPUTER_LIFE_KEY : `device:${device.id}`}
      onAction={(request) => void act(request)}
      onRemove={() => setConfirm({ kind: "remove-device", device })}
      downloadUrl={local.reachability === "not-running" ? downloadUrl : null}
    />
  );

  return (
    <div className="spectra-wave-y relative isolate flex h-full min-h-0 flex-1" data-spectra-app-surface="true" data-devices-page>
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

          <div className="devices-columns">
            {/* One list of the user's computers: the one they are on leads, marked as such. */}
            <section aria-labelledby="devices-list" className="min-w-0 space-y-4">
              <h2 id="devices-list" className="device-section-heading">
                Your computers
              </h2>
              <PairingPanel state={pairingState} onCancel={() => pairing.cancel()} onRetry={connect} />
              {here ? (
                deviceCard(here)
              ) : !connecting && isAuthenticated && bridgeMissing(local.reachability) && downloadUrl ? (
                // No Bridge here yet: the download is the first step. Pressing it
                // also starts connecting, which carries on once Bridge opens.
                <div className="device-connect" data-step="download">
                  <p className="text-ui font-medium text-[var(--text-primary)]">Get Spectra Bridge</p>
                  <p className="max-w-xl text-ui leading-6 text-[var(--text-secondary)]">
                    Bridge keeps the folders you choose on this computer in sync with Spectra. Download and open it, and this computer connects by itself.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="primary" size="sm">
                      <a href={downloadUrl} rel="noopener" onClick={connect}>
                        <Icon name="download" size={16} />
                        Download for {platform === "macos" ? "Mac" : "Windows"}
                      </a>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={connect}>
                      I already have it
                    </Button>
                  </div>
                </div>
              ) : !connecting ? (
                <div className="device-connect">
                  <p className="max-w-xl text-ui leading-6 text-[var(--text-secondary)]">
                    {isAuthenticated
                      ? // Pairing is per browser: Bridge can be running, even paired, while this browser isn't connected to it.
                        bridgeReachabilityCopy(local.reachability).detail
                      : "Sign in to connect this computer."}
                  </p>
                  <Button variant="primary" size="sm" disabled={!isAuthenticated} onClick={connect}>
                    Connect this computer
                  </Button>
                </div>
              ) : null}
              {model.others.map(deviceCard)}
              {!here && !model.others.length && cloud === undefined && cloudEnabled ? (
                <p className="text-caption text-[var(--text-secondary)]">Loading your computers.</p>
              ) : null}
            </section>

            <aside aria-label="For every device" className="min-w-0 xl:sticky xl:top-6">
              <NativeWritesChoice value={nativeWrites} disabled={!policy} onChange={chooseNativeWrites} />
            </aside>
          </div>
        </PageBody>
      </div>

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
    </div>
  );
}

/** Bridge is not on this computer (or not started): the page leads with the download. */
function bridgeMissing(reachability: BridgeReachability) {
  return reachability === "not-running" || reachability === "not-set-up";
}
