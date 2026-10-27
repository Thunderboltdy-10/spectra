import type { BridgeStatus } from "./client";

export type ActiveBridgeMount = {
  _id: string;
  deviceId: string;
  grantId: string;
  rootLabel: string;
  selectedFile?: string;
};

/** Limit folder choices to grants that this paired local Bridge actually has. */
export function mountsForConnectedDevice<T extends ActiveBridgeMount>(
  mounts: readonly T[] | undefined,
  status: (Pick<BridgeStatus, "paired" | "deviceId"> & { mounts?: ReadonlyArray<{ id: string; selectionKind?: "file" | "folder" }> }) | null,
  connected: boolean,
): T[] {
  if (!mounts || !connected || !status?.paired || !status.deviceId) return [];
  const localGrantIds = new Set((status.mounts ?? []).filter((mount) => mount.selectionKind !== "file").map((mount) => mount.id));
  return mounts.filter(
    (mount) =>
      !mount.selectedFile && mount.deviceId === status.deviceId && localGrantIds.has(mount.grantId),
  );
}

/** Never fall back to an arbitrary account-wide mount. */
export function resolveRequestedMount<T extends { _id: string; deviceId: string; selectedFile?: string }>(
  mounts: readonly T[],
  requestedMountId: string | undefined,
  requestedDeviceId: string | undefined,
): T | null {
  if (!requestedMountId || !requestedDeviceId) return null;
  return (
    mounts.find(
      (mount) =>
        !mount.selectedFile && mount._id === requestedMountId &&
        mount.deviceId === requestedDeviceId,
    ) ?? null
  );
}
