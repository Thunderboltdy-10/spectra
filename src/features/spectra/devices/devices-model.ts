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
  type BridgeSyncLogEntry,
} from "../bridge/client";
import { humanizePublicFailure } from "../bridge/humanize";
import type { ContentDirection } from "../../../../shared/sync-policy";
import { permissionChoice, type StoredPermissionPreferences } from "../settings/schema/ai-permissions";

/** A computer counts as online when it reported within this window. */
/** Bridge reports in every 15 minutes, or at once when something about it changes. */
export const DEVICE_ONLINE_MS = 20 * 60_000;

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
  _id?: string;
  rootKey?: string;
  linkedToMountId?: string;
  selectedFile?: string;
  grantId: string;
  deviceId: string;
  rootLabel: string;
  rootOrgNodeId?: string;
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
  kind?: "file" | "folder";
  id: string;
  name: string;
  /** "Documents › Biology" on this computer; the folder's name elsewhere. */
  path: string;
  tone: DeviceTone;
  label: string;
  detail?: string;
  progress?: { synced: number; total: number };
  /** A sync pass is running now, so it can be cancelled. */
  syncing?: boolean;
  paused: boolean;
  /** Folder actions run only on the computer that holds the folder. */
  actionable: boolean;
  /** The folder as it stands in the Library. */
  rootNodeId?: string;
  /** Another computer syncs a folder of the same name: likely one folder kept in step by OneDrive or the like. */
  alsoOn?: string;
  /** That folder on the other computer, so the two can be linked as one. */
  alsoOnMountId?: string;
  /** Already one folder with the other computer's: found by its path, or linked by hand. */
  sameAs?: { computer: string; byHand: boolean };
  mountId?: string;
  rootKey?: string;
  linkedToMountId?: string;
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
  /** What syncing did lately, newest first; only this computer's Bridge keeps one. */
  syncLog: BridgeSyncLogEntry[];
  /** What the last update attempt said, when it needs saying. */
  updateNote?: string;
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

export function liveFolder(mount: BridgeMount, allPaused: boolean): FolderView {
  const path = mount.friendlyPath || mount.label;
  const base = { id: mount.id, name: mount.label, path, actionable: true, kind: mount.selectionKind ?? "folder" };
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
      return { ...base, tone: "busy", label: "Looking through the files", paused };
    case "syncing":
      return { ...base, tone: "busy", label: "Syncing", paused, progress, syncing: true };
    default:
      // A finished pass: files it skipped (too large, held open, online-only) are said, not shown as syncing forever.
      if (progress && progress.synced < progress.total) {
        const left = progress.total - progress.synced;
        return { ...base, tone: "ok", label: "Up to date", detail: `${left.toLocaleString()} file${left === 1 ? "" : "s"} not synced`, paused };
      }
      return { ...base, tone: "ok", label: "Up to date", paused };
  }
}

function mountKeys(mount: CloudMount | undefined) {
  return mount ? { mountId: mount._id, rootKey: mount.rootKey, linkedToMountId: mount.linkedToMountId } : {};
}

function remoteFolder(mount: CloudMount, actionable: boolean, offlineLabel: string): FolderView {
  const files = mount.fileCount > 0 ? `${mount.fileCount.toLocaleString()} file${mount.fileCount === 1 ? "" : "s"}` : undefined;
  return {
    ...mountKeys(mount),
    id: mount.grantId,
    kind: mount.selectedFile ? "file" : "folder",
    name: mount.rootLabel,
    path: mount.rootLabel,
    tone: mount.state === "active" ? "offline" : "attention",
    label: mount.state === "active" ? offlineLabel : "Disconnected",
    detail: files,
    paused: false,
    actionable,
    rootNodeId: mount.selectedFile ? undefined : mount.rootOrgNodeId,
  };
}

function isOutOfDate(protocolVersion: string | undefined) {
  return Boolean(protocolVersion) && protocolMajor(protocolVersion!) !== protocolMajor(BRIDGE_PROTOCOL_VERSION);
}

function thisComputerView(local: LocalBridge, cloud: CloudDevice | undefined, mounts: CloudMount[], now: number): DeviceView {
  const status = local.status;
  const live = local.reachability === "connected" && Boolean(status?.paired);
  const updateRequired = local.reachability === "update-required";
  const liveMounts = live ? (status?.mounts ?? []) : [];
  const liveIds = new Set(liveMounts.map((mount) => mount.id));
  const allPaused = Boolean(live && status?.paused);
  const folders = [
    ...liveMounts.map((mount) => {
      const row = mounts.find((candidate) => candidate.grantId === mount.id);
      return {
        ...liveFolder(mount, allPaused),
        ...mountKeys(row),
        rootNodeId: mount.selectionKind === "file" ? undefined : row?.rootOrgNodeId,
      };
    }),
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
    syncLog: live ? (status?.syncLog ?? []) : [],
    updateNote: live ? (status?.updateNote ?? undefined) : undefined,
    paused: allPaused,
  };
  if (updateRequired)
    return { ...common, tone: "attention", label: "Out of date", detail: "Update Spectra for desktop to keep syncing." };
  if (!live) {
    // Bridge still reports to Spectra, so it runs: only this browser lost it.
    const reporting = Boolean(cloud && now - cloud.lastSeenAt < DEVICE_ONLINE_MS);
    const detail =
      local.reachability === "offline"
        ? "This browser is offline."
        : local.reachability === "port-taken"
          ? "Another app is using Bridge's connection. Close it, then try again."
          : local.reachability === "running"
            ? "Spectra for desktop is running. Try again to reconnect this browser to it."
            : reporting
              ? "Spectra for desktop is connected, but this browser can't reach it. Try again. If that doesn't work, quit Spectra from its icon near the clock and open it again."
              : "Spectra for desktop isn't running. Open it on this computer, then try again.";
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
    detail: folders.length ? "Everything is up to date." : "Add files or a folder to use them in Spectra.",
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
    syncLog: [],
    paused: Boolean(online && health?.paused),
  };
  if (!online) return { ...base, tone: "offline", label: "Offline", detail: seen };
  if (updateRequired) return { ...base, tone: "attention", label: "Out of date", detail: "Update Spectra for desktop on that computer." };
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
  // A deliberate removal is not a broken connection needing a repair.
  const mounts = (cloud?.mounts ?? []).filter((mount) => mount.state !== "detached");
  const localId = local.status?.deviceId ?? null;
  const cloudThis = localId ? devices.find((device) => device._id === localId) : undefined;
  const live = local.reachability === "connected" && Boolean(local.status?.paired);
  // Once the cloud has loaded, a cached id it no longer knows was removed.
  const known = Boolean(localId) && (live || cloud == null || Boolean(cloudThis));
  const thisComputer = known
    ? thisComputerView(local, cloudThis, mounts.filter((mount) => mount.deviceId === localId && mount.state !== "revoked"), now)
    : null;
  const others = devices
    .filter((device) => device._id !== localId)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((device) =>
      otherDeviceView(device, mounts.filter((mount) => mount.deviceId === device._id && mount.state !== "revoked"), now),
    );
  markTwins([...(thisComputer ? [thisComputer] : []), ...others]);
  return { thisComputer, others };
}

/**
 * The same folder synced from two computers (OneDrive, Dropbox or iCloud keep
 * it on both) comes into Spectra twice. Spectra only knows each folder's name
 * elsewhere, so a shared name is the sign it says something about.
 */
function markTwins(devices: DeviceView[]) {
  const key = (folder: FolderView) => (folder.kind === "file" ? null : folder.name.trim().toLocaleLowerCase());
  const linkedByHand = (a: FolderView, b: FolderView) =>
    Boolean(a.mountId && b.mountId && (a.linkedToMountId === b.mountId || b.linkedToMountId === a.mountId));
  for (const device of devices) {
    for (const folder of device.folders) {
      if (folder.kind === "file") continue;
      const others = devices.filter((other) => other !== device);
      const same = others
        .flatMap((other) => other.folders.map((theirs) => ({ other, theirs })))
        .find(({ theirs }) => linkedByHand(folder, theirs) || Boolean(folder.rootKey && theirs.rootKey === folder.rootKey));
      if (same) {
        folder.sameAs = { computer: same.other.name, byHand: linkedByHand(folder, same.theirs) };
        continue;
      }
      const name = key(folder);
      if (!name) continue;
      for (const other of others) {
        const theirs = other.folders.find((candidate) => key(candidate) === name);
        if (!theirs) continue;
        folder.alsoOn = other.name;
        folder.alsoOnMountId = theirs.mountId;
        break;
      }
    }
  }
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

/**
 * Every paired computer for Spectra AI, in plain words with the ids its
 * device actions take. The server cannot see which computer the user is on,
 * so each is described from what it last reported.
 */
export function describeDevicesForAi(cloud: CloudOverview | null | undefined, now: number): string {
  const { others } = devicesModel({ local: { reachability: "not-set-up", status: null }, cloud, now });
  if (!others.length)
    return "No computer is connected. The user can connect the one they are on from the Devices page, or ask Spectra to (devices action pair).";
  const described = others.map((device) => {
    const lines = [`${device.name} (${device.platformLabel}, deviceId ${device.id}): ${device.label}. ${device.detail}`];
    if (device.lastSyncAt) lines.push(`Last sync ${timeAgo(device.lastSyncAt, now)}.`);
    if (device.version) lines.push(`Spectra for desktop ${device.version}${device.updateRequired ? ", out of date" : ""}.`);
    for (const folder of device.folders) {
      const ids = [`grantId ${folder.id}`, ...(folder.mountId ? [`mountId ${folder.mountId}`] : [])].join(", ");
      const twin = folder.sameAs
        ? ` Already one folder with the one on ${folder.sameAs.computer}${folder.sameAs.byHand ? " (linked; unlink_folder undoes it)" : ""}.`
        : folder.alsoOn && folder.alsoOnMountId
          ? ` Probably the same folder as on ${folder.alsoOn} (mountId ${folder.alsoOnMountId}); link_folders makes them one.`
          : "";
      lines.push(`- ${folder.kind === "file" ? "File" : "Folder"} ${folder.name} (${ids})${folder.detail ? `: ${folder.detail}` : ""}.${twin}`);
    }
    return lines.join("\n");
  });
  return [
    ...described,
    "Everything synced from these computers is already in Spectra: find it with search. To see what else is on a computer, use devices list_names, and offer to sync what would help.",
    "Folder, pause, logs and update actions run on the computer where the user has Spectra open, in Spectra for desktop or a browser.",
  ].join("\n\n");
}
