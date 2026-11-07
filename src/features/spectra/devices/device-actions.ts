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
  syncBridgeNamedPath,
  selectBridgeFiles,
  type BridgeFile,
  type BridgeFilesSelected,
} from "../bridge/client";
import { humanizePublicFailure } from "../bridge/humanize";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import { FOLDER_ACTIONS, isLocalDeviceAction, type LocalDeviceAction, type LocalDeviceRequest } from "./actions";

export { FOLDER_ACTIONS, LOCAL_DEVICE_ACTIONS, isLocalDeviceAction, type LocalDeviceAction, type LocalDeviceRequest } from "./actions";

const DONE: Record<LocalDeviceAction, string> = {
  add_folder: "The folder picker is open on this computer.",
  add_files: "The file picker is open on this computer.",
  sync_path: "Syncing it from this computer.",
  retry_folder: "Retrying the folder.",
  pause_folder: "Paused the folder.",
  resume_folder: "Resumed the folder.",
  remove_folder: "Stopped syncing the folder. Files stay on this computer.",
  pause_syncing: "Paused syncing on this computer.",
  resume_syncing: "Resumed syncing on this computer.",
  show_logs: "Opened Bridge's logs on this computer.",
  update: "Updating Spectra Bridge.",
};

function filesChosenMessage(files: BridgeFilesSelected) {
  const name = (file: BridgeFile) => file.relativePath.split("/").pop() ?? file.relativePath;
  const added = files.selected === 1 ? "The selected file is syncing." : `${files.selected} selected files are syncing.`;
  if (!files.existing.length) return added;
  const here =
    files.existing.length === 1
      ? `${name(files.existing[0]!)} was already synced.`
      : `${files.existing.length} of them were already synced.`;
  return files.selected ? `${added} ${here}` : here;
}

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
    const noun = loadBridgeStatusCache()?.mounts?.find((mount) => mount.id === grantId)?.selectionKind === "file" ? "file" : "folder";
    let message = DONE[request.action].replaceAll("folder", noun);
    switch (request.action) {
      case "add_files": {
        const files = await selectBridgeFiles();
        const chosen = files.selected + files.existing.length;
        if (!chosen) return { status: "pending", message: "No files were selected." };
        message = filesChosenMessage(files);
        spectraBus.emit("devices.changed", {});
        return { status: "completed", message, data: files };
      }
      case "sync_path": {
        const path = request.path?.trim();
        if (!path) return { status: "failed", message: "Say which file or folder." };
        const grantId = await syncBridgeNamedPath(path);
        if (!grantId) return { status: "pending", message: "It wasn't synced: not now was chosen on the computer." };
        spectraBus.emit("devices.changed", {});
        return { status: "completed", message, data: { grantId } };
      }
      case "add_folder": {
        const grantId = await selectBridgeFolder();
        if (grantId === null) return { status: "pending", message: "No folder was selected." };
        message = "Added the folder you chose.";
        spectraBus.emit("devices.changed", {});
        return { status: "completed", message, data: { grantId } };
      }
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

export type AiDeviceAction = { action: string; actionId?: string; grantId?: string; deviceId?: string; path?: string };

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
  const outcome = await runLocalDeviceAction({ action: request.action, ...(request.grantId ? { grantId: request.grantId } : {}), ...(request.path ? { path: request.path } : {}) });
  openDevices(false);
  return outcome;
}
