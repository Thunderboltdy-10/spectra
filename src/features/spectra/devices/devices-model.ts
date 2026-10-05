/*
 * The Devices page's model: what Spectra knows about this computer (from the
 * local Bridge) and the user's other computers (from the cloud), combined into
 * plain states and sentences. Pure, so the page, the AI and tests read the same
 * truth.
 */
import {
  BRIDGE_PROTOCOL_VERSION,
  protocolMajor,
  type BridgeMount,
  type BridgeOfficeFile,
  type BridgeReachability,
  type BridgeStatus,
} from "../bridge/client";
import { humanizePublicFailure } from "../bridge/humanize";
import type { ContentDirection } from "../../../../shared/sync-policy";
import { permissionChoice, type StoredPermissionPreferences } from "../settings/schema/ai-permissions";

/** A computer counts as online when it reported within this window. */
export const DEVICE_ONLINE_MS = 5 * 60_000;

export type CloudDeviceHealth = {
  paused: boolean;
  folders: number;
  problem?: string;
  problemFolder?: string;
  lastSyncAt?: number;
  reportedAt: number;
};

export type CloudDevice = {
  _id: string;
  name: string;
  platform: string;
  appVersion: string;
  protocolVersion?: string;
  lastSeenAt: number;
  state: string;
  health?: CloudDeviceHealth;
};

export type CloudMount = {
  grantId: string;
  deviceId: string;
  rootLabel: string;
  state: string;
  fileCount: number;
};

export type CloudOverview = { devices: CloudDevice[]; mounts: CloudMount[] };

export type LocalBridge = {
  reachability: BridgeReachability;
  status: BridgeStatus | null;
};

/** One word of tone for the state dot: it never carries meaning on its own. */
export type DeviceTone = "ok" | "busy" | "paused" | "attention" | "offline";

export type FolderView = {
  id: string;
  name: string;
  /** "Documents › Biology" on this computer; the folder's name elsewhere. */
  path: string;
  tone: DeviceTone;
  label: string;
  detail?: string;
  progress?: { synced: number; total: number };
  paused: boolean;
  /** Folder actions run only on the computer that holds the folder. */
  actionable: boolean;
};

export type DeviceView = {
  /** The cloud device id; null before this computer is known to Spectra. */
  id: string | null;
  name: string;
  platformLabel: string;
  isThisComputer: boolean;
  online: boolean;
  /** Bridge answers on this computer and this browser holds its session. */
  live: boolean;
  tone: DeviceTone;
  label: string;
  detail: string;
  problem?: string;
  paused: boolean;
  updateRequired: boolean;
  version?: string;
  lastSyncAt?: number;
  lastSeenAt?: number;
  folders: FolderView[];
  officeFiles: BridgeOfficeFile[];
};

export type DevicesModel = {
  thisComputer: DeviceView | null;
  others: DeviceView[];
};

export function platformLabel(platform: string | undefined): string {
  const value = (platform ?? "").toLowerCase();
  if (value.startsWith("win")) return "Windows";
  if (value.startsWith("mac") || value === "darwin") return "Mac";
  if (value.startsWith("linux")) return "Linux";
  return "Computer";
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function timeAgo(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** A health problem as one plain sentence with its fix. */
export function problemSentence(code: string | undefined, folder?: string): string | undefined {
  if (!code) return undefined;
  const name = folder?.trim();
  if (code === "folder-unavailable")
    return name
      ? `Couldn't reach ${name}. Check the folder still exists.`
      : "Couldn't reach a folder. Check it still exists.";
  if (code === "folder-error")
    return name ? `${name} stopped syncing. Retry it to try again.` : "A folder stopped syncing. Retry it to try again.";
  return "Something on this computer needs attention. Show logs to see what happened.";
}

function liveFolder(mount: BridgeMount, allPaused: boolean): FolderView {
  const path = mount.friendlyPath || mount.label;
  const base = { id: mount.id, name: mount.label, path, actionable: true };
  const paused = allPaused || mount.paused;
  if (paused) return { ...base, tone: "paused", label: "Paused", paused: true };
  const progress = mount.total > 0 ? { synced: Math.min(mount.synced, mount.total), total: mount.total } : undefined;
  switch (mount.state) {
    case "unavailable":
      return { ...base, tone: "attention", label: "Couldn't reach it", detail: problemSentence("folder-unavailable", path), paused };
    case "error":
      return { ...base, tone: "attention", label: "Needs attention", detail: humanizePublicFailure(mount.detail || "Retry it to try again."), paused };
    case "waiting":
      return { ...base, tone: "busy", label: "Waiting to retry", detail: humanizePublicFailure(mount.detail || "Spectra retries it by itself."), paused, progress };
    case "scanning":
    case "syncing":
      return { ...base, tone: "busy", label: "Syncing", paused, progress };
    default:
      if (progress && progress.synced < progress.total) return { ...base, tone: "busy", label: "Syncing", paused, progress };
      return { ...base, tone: "ok", label: "Up to date", paused };
  }
}

function remoteFolder(mount: CloudMount, actionable: boolean, offlineLabel: string): FolderView {
  const files = mount.fileCount > 0 ? `${mount.fileCount.toLocaleString()} file${mount.fileCount === 1 ? "" : "s"}` : undefined;
  return {
    id: mount.grantId,
    name: mount.rootLabel,
    path: mount.rootLabel,
    tone: mount.state === "active" ? "offline" : "attention",
    label: mount.state === "active" ? offlineLabel : "Disconnected",
    detail: files,
    paused: false,
    actionable,
  };
}

function isOutOfDate(protocolVersion: string | undefined) {
  return Boolean(protocolVersion) && protocolMajor(protocolVersion!) !== protocolMajor(BRIDGE_PROTOCOL_VERSION);
}

function thisComputerView(local: LocalBridge, cloud: CloudDevice | undefined, mounts: CloudMount[]): DeviceView {
  const status = local.status;
  const live = local.reachability === "connected" && Boolean(status?.paired);
  const updateRequired = local.reachability === "update-required";
  const liveMounts = live ? (status?.mounts ?? []) : [];
  const liveIds = new Set(liveMounts.map((mount) => mount.id));
  const allPaused = Boolean(live && status?.paused);
  const folders = [
    ...liveMounts.map((mount) => liveFolder(mount, allPaused)),
    ...mounts.filter((mount) => !liveIds.has(mount.grantId)).map((mount) => remoteFolder(mount, false, "Not connected")),
  ];
  const problemFolder = folders.find((folder) => folder.tone === "attention" && !folder.paused);
  const common = {
    id: status?.deviceId ?? cloud?._id ?? null,
    name: status?.deviceName || cloud?.name || "This computer",
    platformLabel: platformLabel(cloud?.platform),
    isThisComputer: true,
    online: live,
    live,
    updateRequired,
    version: status?.version || cloud?.appVersion,
    lastSyncAt: status?.lastSyncAt ?? cloud?.health?.lastSyncAt ?? undefined,
    lastSeenAt: cloud?.lastSeenAt,
    folders,
    officeFiles: live ? (status?.officeFiles ?? []) : [],
    paused: allPaused,
  };
  if (updateRequired)
    return { ...common, tone: "attention", label: "Out of date", detail: "Update Spectra Bridge to keep syncing." };
  if (!live) {
    const detail =
      local.reachability === "offline"
        ? "This browser is offline."
        : local.reachability === "port-taken"
          ? "Another app is using Bridge's connection. Close it, then try again."
          : local.reachability === "running"
            ? "Bridge is running. Reconnect this computer to use its folders."
            : "Bridge isn't running. Start Spectra Bridge on this computer.";
    return { ...common, tone: "offline", label: "Not connected", detail };
  }
  if (allPaused) return { ...common, tone: "paused", label: "Paused", detail: "Syncing is paused on this computer." };
  if (problemFolder)
    return { ...common, tone: "attention", label: "Needs attention", detail: problemFolder.detail ?? "A folder needs attention.", problem: problemFolder.detail };
  if (folders.some((folder) => folder.tone === "busy"))
    return { ...common, tone: "busy", label: "Syncing", detail: "Making files available in Spectra." };
  return {
    ...common,
    tone: "ok",
    label: "Connected",
    detail: folders.length ? "Everything is up to date." : "Add a folder to use its files in Spectra.",
  };
}

function otherDeviceView(device: CloudDevice, mounts: CloudMount[], now: number): DeviceView {
  const online = now - device.lastSeenAt < DEVICE_ONLINE_MS;
  const health = device.health;
  const seen = `Last seen ${timeAgo(device.lastSeenAt, now)}.`;
  const problem = online ? problemSentence(health?.problem, health?.problemFolder) : undefined;
  const updateRequired = isOutOfDate(device.protocolVersion);
  const base = {
    id: device._id,
    name: device.name,
    platformLabel: platformLabel(device.platform),
    isThisComputer: false,
    online,
    live: false,
    updateRequired,
    version: device.appVersion,
    lastSyncAt: health?.lastSyncAt,
    lastSeenAt: device.lastSeenAt,
    folders: mounts.map((mount) => remoteFolder(mount, false, online ? "On that computer" : "Offline")),
    officeFiles: [],
    paused: Boolean(online && health?.paused),
  };
  if (!online) return { ...base, tone: "offline", label: "Offline", detail: seen };
  if (updateRequired) return { ...base, tone: "attention", label: "Out of date", detail: "Update Spectra Bridge on that computer." };
  if (health?.paused) return { ...base, tone: "paused", label: "Paused", detail: "Syncing is paused on that computer." };
  if (problem) return { ...base, tone: "attention", label: "Needs attention", detail: problem, problem };
  return { ...base, tone: "ok", label: "Connected", detail: seen };
}

/**
 * This computer is the one whose Bridge answers here, or the one this browser
 * paired before (its id is cached). A computer Spectra has forgotten, or one
 * never paired, has no row: the page offers Connect this computer instead.
 */
export function devicesModel(input: {
  local: LocalBridge;
  cloud: CloudOverview | null | undefined;
  now: number;
}): DevicesModel {
  const { local, cloud, now } = input;
  const devices = (cloud?.devices ?? []).filter((device) => device.state === "active");
  const mounts = cloud?.mounts ?? [];
  const localId = local.status?.deviceId ?? null;
  const cloudThis = localId ? devices.find((device) => device._id === localId) : undefined;
  const live = local.reachability === "connected" && Boolean(local.status?.paired);
  // Once the cloud has loaded, a cached id it no longer knows was removed.
  const known = Boolean(localId) && (live || cloud == null || Boolean(cloudThis));
  const thisComputer = known
    ? thisComputerView(local, cloudThis, mounts.filter((mount) => mount.deviceId === localId && mount.state !== "revoked"))
    : null;
  const others = devices
    .filter((device) => device._id !== localId)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((device) =>
      otherDeviceView(device, mounts.filter((mount) => mount.deviceId === device._id && mount.state !== "revoked"), now),
    );
  return { thisComputer, others };
}

/* Native writes: when Spectra may write back to files on the computer. */

export type NativeWrites = "always" | "ask" | "never";

export const NATIVE_WRITES_OPTIONS: ReadonlyArray<{ value: NativeWrites; label: string; description: string }> = [
  { value: "always", label: "Always", description: "Spectra saves changes to your desktop files." },
  { value: "ask", label: "Ask first", description: "Spectra AI asks before it changes a desktop file." },
  { value: "never", label: "Never", description: "Desktop files stay as they are. Changes stay in Spectra." },
];

export function writesBack(direction: ContentDirection | undefined): boolean {
  return direction === "bidirectional" || direction === "spectra-to-local";
}

export function nativeWritesChoice(
  direction: ContentDirection | undefined,
  permissions: StoredPermissionPreferences,
): NativeWrites {
  if (!writesBack(direction)) return "never";
  return permissionChoice(permissions, "bridge_files") === "allow" ? "always" : "ask";
}

/**
 * What changing native writes does: the account's sync preset (whether files
 * write back at all) and the AI's permission for desktop file changes.
 */
export function nativeWritesPlan(
  choice: NativeWrites,
  direction: ContentDirection | undefined,
): { preset: "spectra" | "both" | null; permission: "ask" | "allow" | null } {
  if (choice === "never") return { preset: writesBack(direction) ? "spectra" : null, permission: null };
  return { preset: writesBack(direction) ? null : "both", permission: choice === "always" ? "allow" : "ask" };
}
