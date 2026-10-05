/*
 * The Devices actions that run on this computer, through the local Bridge.
 * The Devices page, the command bar and Spectra AI all run them here, so each
 * says the same thing whoever asked.
 */
import {
  loadBridgeStatusCache,
  openBridgeLogs,
  pauseBridgeFolder,
  pauseBridgeSync,
  removeBridgeFolder,
  requestBridgeUpdate,
  retryBridgeFolder,
  selectBridgeFolder,
} from "../bridge/client";
import { humanizePublicFailure } from "../bridge/humanize";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import { FOLDER_ACTIONS, isLocalDeviceAction, type LocalDeviceAction, type LocalDeviceRequest } from "./actions";

export { FOLDER_ACTIONS, LOCAL_DEVICE_ACTIONS, isLocalDeviceAction, type LocalDeviceAction, type LocalDeviceRequest } from "./actions";

const DONE: Record<LocalDeviceAction, string> = {
  add_folder: "The folder picker is open on this computer.",
  retry_folder: "Retrying the folder.",
  pause_folder: "Paused the folder.",
  resume_folder: "Resumed the folder.",
  remove_folder: "Removed the folder. Its files stay on this computer.",
  pause_syncing: "Paused syncing on this computer.",
  resume_syncing: "Resumed syncing on this computer.",
  show_logs: "Opened Bridge's logs on this computer.",
  update: "Updating Spectra Bridge.",
};

/** Whether this browser can reach the paired Bridge on this computer. */
export function thisComputerId(): string | null {
  return loadBridgeStatusCache()?.deviceId ?? null;
}

/**
 * Run one action on this computer. Resolves with a plain outcome; it never
 * throws. The page and anything showing Devices refresh on `devices.changed`.
 */
export async function runLocalDeviceAction(request: LocalDeviceRequest): Promise<SpectraCommandOutcome> {
  const grantId = request.grantId?.trim() ?? "";
  if (FOLDER_ACTIONS.has(request.action) && !grantId)
    return { status: "failed", message: "Say which folder." };
  try {
    let message = DONE[request.action];
    switch (request.action) {
      case "add_folder":
        await selectBridgeFolder();
        message = "Added the folder you chose.";
        break;
      case "retry_folder":
        await retryBridgeFolder(grantId);
        break;
      case "pause_folder":
      case "resume_folder":
        await pauseBridgeFolder(grantId, request.action === "pause_folder");
        break;
      case "remove_folder":
        await removeBridgeFolder(grantId);
        break;
      case "pause_syncing":
      case "resume_syncing":
        await pauseBridgeSync(request.action === "pause_syncing");
        break;
      case "show_logs":
        await openBridgeLogs();
        break;
      case "update":
        message = await requestBridgeUpdate();
        break;
    }
    spectraBus.emit("devices.changed", {});
    return { status: "completed", message };
  } catch (error) {
    spectraBus.emit("devices.changed", {});
    return { status: "failed", message: humanizePublicFailure(error) };
  }
}

/* Spectra AI's device actions, as they reach this browser. */

const HANDLED_KEY = "spectra.devices.handledActions";

/**
 * True the first time any tab on this computer sees an action. Run events
 * replay after a reload and reach every tab watching the run; an action must
 * still run once.
 */
export function claimDeviceAction(actionId: string): boolean {
  try {
    const handled = JSON.parse(window.localStorage.getItem(HANDLED_KEY) ?? "[]") as unknown;
    const list = Array.isArray(handled) ? handled.filter((id): id is string => typeof id === "string") : [];
    if (list.includes(actionId)) return false;
    window.localStorage.setItem(HANDLED_KEY, JSON.stringify([...list, actionId].slice(-50)));
    return true;
  } catch {
    return true;
  }
}

export type AiDeviceAction = { action: string; actionId?: string; grantId?: string; deviceId?: string };

/**
 * Run an action Spectra AI asked for, when it is meant for this computer.
 * Resolves with what happened here, or null when this browser is not the
 * computer it was meant for (or already ran it).
 */
export async function runAiDeviceAction(
  request: AiDeviceAction,
  openDevices: (connect: boolean) => void,
): Promise<SpectraCommandOutcome | null> {
  if (typeof window === "undefined") return null;
  if (request.actionId && !claimDeviceAction(request.actionId)) return null;
  if (request.action === "pair") {
    openDevices(true);
    return { status: "pending", message: "Connecting this computer." };
  }
  if (!isLocalDeviceAction(request.action)) return null;
  const here = thisComputerId();
  if (!here || (request.deviceId && request.deviceId !== here)) return null;
  const outcome = await runLocalDeviceAction({ action: request.action, ...(request.grantId ? { grantId: request.grantId } : {}) });
  openDevices(false);
  return outcome;
}
