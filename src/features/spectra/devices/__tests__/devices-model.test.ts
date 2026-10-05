import { describe, expect, it } from "vitest";
import {
  DEVICE_ONLINE_MS,
  devicesModel,
  nativeWritesChoice,
  nativeWritesPlan,
  problemSentence,
  timeAgo,
  type CloudOverview,
  type LocalBridge,
} from "../devices-model";
import { bridgeDownloadUrl, bridgePlatform, type BridgeStatus } from "../../bridge/client";

const NOW = 1_800_000_000_000;

function status(overrides: Partial<BridgeStatus> = {}): BridgeStatus {
  return {
    version: "1.4.0",
    protocolVersion: "1.0",
    paired: true,
    cloudConnected: true,
    deviceId: "device-here",
    deviceName: "Pablo's laptop",
    paused: false,
    lastSyncAt: NOW - 60_000,
    mounts: [],
    officeFiles: [],
    ...overrides,
  } as BridgeStatus;
}

function mount(overrides: Partial<BridgeStatus["mounts"][number]> = {}) {
  return {
    id: "grant_a",
    label: "Biology",
    state: "active",
    detail: "Up to date",
    synced: 4,
    total: 4,
    doubleSyncRisk: false,
    friendlyPath: "Documents › Biology",
    paused: false,
    lastSyncAt: NOW - 60_000,
    ...overrides,
  };
}

const cloud: CloudOverview = {
  devices: [
    { _id: "device-here", name: "Pablo's laptop", platform: "windows", appVersion: "1.4.0", protocolVersion: "1.0", lastSeenAt: NOW - 30_000, state: "active" },
    {
      _id: "device-desk",
      name: "Desk PC",
      platform: "windows",
      appVersion: "1.4.0",
      protocolVersion: "1.0",
      lastSeenAt: NOW - 2 * 60_000,
      state: "active",
      health: { paused: false, folders: 1, problem: "folder-unavailable", problemFolder: "Physics", reportedAt: NOW - 2 * 60_000 },
    },
    { _id: "device-old", name: "Old Mac", platform: "macos", appVersion: "1.2.0", protocolVersion: "1.0", lastSeenAt: NOW - 3 * 86_400_000, state: "active" },
  ],
  mounts: [
    { grantId: "grant_a", deviceId: "device-here", rootLabel: "Biology", state: "active", fileCount: 4 },
    { grantId: "grant_gone", deviceId: "device-here", rootLabel: "History", state: "active", fileCount: 12 },
    { grantId: "grant_p", deviceId: "device-desk", rootLabel: "Physics", state: "active", fileCount: 9 },
  ],
};

const connected = (s: BridgeStatus): LocalBridge => ({ reachability: "connected", status: s });

describe("devices model", () => {
  it("shows no row for this computer until it is paired, so the page offers to connect it", () => {
    const model = devicesModel({ local: { reachability: "not-set-up", status: null }, cloud, now: NOW });
    expect(model.thisComputer).toBeNull();
    expect(model.others.map((device) => device.name)).toEqual(["Pablo's laptop", "Desk PC", "Old Mac"]);
  });

  it("names this computer, its state and version, and keeps it out of other devices", () => {
    const model = devicesModel({ local: connected(status({ mounts: [mount()] })), cloud, now: NOW });
    expect(model.thisComputer).toMatchObject({ name: "Pablo's laptop", label: "Connected", tone: "ok", version: "1.4.0", live: true });
    expect(model.others.map((device) => device.id)).toEqual(["device-desk", "device-old"]);
  });

  it("lists live folders by friendly path and remembered ones as not connected", () => {
    const model = devicesModel({ local: connected(status({ mounts: [mount()] })), cloud, now: NOW });
    expect(model.thisComputer?.folders).toMatchObject([
      { id: "grant_a", path: "Documents › Biology", label: "Up to date", actionable: true },
      { id: "grant_gone", path: "History", label: "Not connected", actionable: false },
    ]);
  });

  it("shows a progress line while a folder syncs", () => {
    const model = devicesModel({ local: connected(status({ mounts: [mount({ state: "syncing", synced: 2, total: 9 })] })), cloud: null, now: NOW });
    expect(model.thisComputer).toMatchObject({ label: "Syncing", tone: "busy" });
    expect(model.thisComputer?.folders[0]).toMatchObject({ label: "Syncing", progress: { synced: 2, total: 9 } });
  });

  it("says a problem in plain words with its fix", () => {
    const model = devicesModel({ local: connected(status({ mounts: [mount({ state: "unavailable" })] })), cloud: null, now: NOW });
    expect(model.thisComputer).toMatchObject({
      label: "Needs attention",
      problem: "Couldn't reach Documents › Biology. Check the folder still exists.",
    });
  });

  it("a paused folder is never a problem, and pausing everything pauses the computer", () => {
    const pausedFolder = devicesModel({ local: connected(status({ mounts: [mount({ state: "unavailable", paused: true })] })), cloud: null, now: NOW });
    expect(pausedFolder.thisComputer).toMatchObject({ label: "Connected" });
    expect(pausedFolder.thisComputer?.folders[0]).toMatchObject({ label: "Paused", paused: true });
    const pausedAll = devicesModel({ local: connected(status({ paused: true, mounts: [mount()] })), cloud: null, now: NOW });
    expect(pausedAll.thisComputer).toMatchObject({ label: "Paused", paused: true });
    expect(pausedAll.thisComputer?.folders[0]).toMatchObject({ label: "Paused" });
  });

  it("keeps a paired computer whose Bridge is not running, as not connected", () => {
    const model = devicesModel({ local: { reachability: "not-running", status: status({ paired: false }) }, cloud, now: NOW });
    expect(model.thisComputer).toMatchObject({ label: "Not connected", live: false, tone: "offline" });
    expect(model.thisComputer?.folders.every((folder) => !folder.actionable)).toBe(true);
  });

  it("says out of date when this Bridge is too old", () => {
    const model = devicesModel({ local: { reachability: "update-required", status: status() }, cloud, now: NOW });
    expect(model.thisComputer).toMatchObject({ label: "Out of date", updateRequired: true });
  });

  it("forgets this computer once Spectra no longer knows it", () => {
    const removed = { ...cloud, devices: cloud.devices.filter((device) => device._id !== "device-here") };
    const model = devicesModel({ local: { reachability: "not-running", status: status({ paired: false }) }, cloud: removed, now: NOW });
    expect(model.thisComputer).toBeNull();
  });

  it("shows other devices with when each was last seen and their reported health", () => {
    const model = devicesModel({ local: connected(status()), cloud, now: NOW });
    const [desk, old] = model.others;
    expect(desk).toMatchObject({ online: true, label: "Needs attention", problem: "Couldn't reach Physics. Check the folder still exists." });
    expect(desk.folders).toMatchObject([{ path: "Physics", label: "On that computer", actionable: false }]);
    expect(old).toMatchObject({ online: false, label: "Offline", detail: "Last seen 3 days ago." });
  });

  it("counts a device online for five minutes after it reports", () => {
    const edge = { ...cloud, devices: [{ ...cloud.devices[1], lastSeenAt: NOW - DEVICE_ONLINE_MS + 1 }] };
    expect(devicesModel({ local: connected(status()), cloud: edge, now: NOW }).others[0].online).toBe(true);
    edge.devices[0].lastSeenAt = NOW - DEVICE_ONLINE_MS;
    expect(devicesModel({ local: connected(status()), cloud: edge, now: NOW }).others[0].online).toBe(false);
  });

  it("writes problems and times as people say them", () => {
    expect(problemSentence("folder-error", "Biology")).toBe("Biology stopped syncing. Retry it to try again.");
    expect(problemSentence(undefined)).toBeUndefined();
    expect(timeAgo(NOW - 20_000, NOW)).toBe("just now");
    expect(timeAgo(NOW - 60_000, NOW)).toBe("1 minute ago");
    expect(timeAgo(NOW - 2 * 3_600_000, NOW)).toBe("2 hours ago");
  });
});

describe("native writes", () => {
  const prefs = { permissionFullControl: false, permissionAllow: [], permissionDeny: [] } as const;
  it("reads never unless files write back, then ask or always from the Bridge files permission", () => {
    expect(nativeWritesChoice("manual", { ...prefs, permissionAllow: [] })).toBe("never");
    expect(nativeWritesChoice("bidirectional", { ...prefs, permissionAllow: [] })).toBe("ask");
    expect(nativeWritesChoice("bidirectional", { ...prefs, permissionAllow: ["bridge_files"] })).toBe("always");
    expect(nativeWritesChoice("bidirectional", { ...prefs, permissionFullControl: true, permissionAllow: [] })).toBe("always");
  });

  it("plans the smallest change: the sync preset and the permission", () => {
    expect(nativeWritesPlan("never", "bidirectional")).toEqual({ preset: "spectra", permission: null });
    expect(nativeWritesPlan("never", "manual")).toEqual({ preset: null, permission: null });
    expect(nativeWritesPlan("ask", "manual")).toEqual({ preset: "both", permission: "ask" });
    expect(nativeWritesPlan("always", "bidirectional")).toEqual({ preset: null, permission: "allow" });
  });
});

describe("Bridge download", () => {
  it("picks the system from what the browser reports", () => {
    expect(bridgePlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe("windows");
    expect(bridgePlatform({ userAgentData: { platform: "macOS" } })).toBe("macos");
    expect(bridgePlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe("other");
  });

  it("offers a download only where Bridge runs", () => {
    expect(bridgeDownloadUrl("windows")).toMatch(/\/windows$/);
    expect(bridgeDownloadUrl("macos")).toMatch(/\/macos$/);
    expect(bridgeDownloadUrl("other")).toBeNull();
  });
});
