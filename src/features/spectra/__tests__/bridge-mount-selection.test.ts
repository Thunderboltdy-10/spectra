import { describe, expect, it } from "vitest";
import {
  mountsForConnectedDevice,
  resolveRequestedMount,
  type ActiveBridgeMount,
} from "../bridge/mount-selection";

const mounts: ActiveBridgeMount[] = [
  {
    _id: "mount-current",
    deviceId: "device-current",
    grantId: "grant-current",
    rootLabel: "S9 safe folder",
  },
  {
    _id: "mount-old-device",
    deviceId: "device-old",
    grantId: "grant-old",
    rootLabel: "Old folder",
  },
  {
    _id: "mount-revoked-grant",
    deviceId: "device-current",
    grantId: "grant-not-on-bridge",
    rootLabel: "Stale folder",
  },
];

const status = {
  version: "1.0.0",
  protocolVersion: "1.0",
  paired: true,
  cloudConnected: true,
  deviceId: "device-current",
  mounts: [
    {
      id: "grant-current",
      label: "S9 safe folder",
      state: "active",
      detail: "Ready",
      synced: 1,
      total: 1,
      doubleSyncRisk: false,
    },
  ],
};

describe("Spectra Bridge folder targeting", () => {
  it("offers only active grants on the connected paired device", () => {
    expect(mountsForConnectedDevice(mounts, status, true)).toEqual([
      mounts[0],
    ]);
  });

  it("offers no account-wide folders when the Bridge is disconnected", () => {
    expect(mountsForConnectedDevice(mounts, status, false)).toEqual([]);
    expect(
      mountsForConnectedDevice(mounts, { ...status, paired: false }, true),
    ).toEqual([]);
  });

  it("requires an explicit requested mount and never picks the first result", () => {
    expect(resolveRequestedMount(mounts, undefined, "device-current")).toBeNull();
    expect(resolveRequestedMount(mounts, "missing", "device-current")).toBeNull();
    expect(
      resolveRequestedMount(mounts, "mount-old-device", "device-current"),
    ).toBeNull();
    expect(
      resolveRequestedMount(mounts, "mount-current", "device-current"),
    ).toBe(mounts[0]);
  });
});
