export type ReplicaContinuityCandidate<T> = {
  value: T;
  creationTime: number;
  hasCloudReplica: boolean;
};

/** Keep one logical work identity across Office temp-file replacements. */
export function chooseReplicaContinuity<T>(
  candidates: readonly ReplicaContinuityCandidate<T>[],
) {
  return [...candidates].sort(
    (left, right) =>
      Number(right.hasCloudReplica) - Number(left.hasCloudReplica) ||
      left.creationTime - right.creationTime,
  )[0]?.value;
}

export type ReplicaWriteCandidate = {
  replicaId: unknown;
  state: string;
  createdAt: number;
};

/** Pending writes are ordered and chained per physical replica, never per work. */
export function latestActiveWriteForReplica<T extends ReplicaWriteCandidate>(
  requests: readonly T[],
  replicaId: unknown,
) {
  return requests
    .filter(
      (request) =>
        request.replicaId === replicaId &&
        (request.state === "pending" || request.state === "claimed"),
    )
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}

export type ReplicaWriteTarget = {
  accountId: unknown;
  deviceId?: unknown;
  mountId?: unknown;
  state: string;
};

export type BridgeMountTarget = {
  _id: unknown;
  accountId: unknown;
  deviceId: unknown;
  state: string;
};

export type BridgeDeviceTarget = {
  accountId: unknown;
  state: string;
};

/** One shared authority check for every native/package cloud-to-local write. */
export function activeReplicaWriteTarget(
  replica: ReplicaWriteTarget | null | undefined,
  mount: BridgeMountTarget | null | undefined,
  device: BridgeDeviceTarget | null | undefined,
) {
  return Boolean(
    replica &&
      mount &&
      device &&
      replica.state !== "unavailable" &&
      mount.state === "active" &&
      device.state === "active" &&
      replica.accountId === mount.accountId &&
      mount.accountId === device.accountId &&
      replica.deviceId === mount.deviceId &&
      replica.mountId === mount._id,
  );
}

/** A Bridge that has not heartbeated inside this window is not "this computer". */
export const LIVE_BRIDGE_DEVICE_WINDOW_MS = 10 * 60_000;

export type SeenBridgeDevice = {
  _id: unknown;
  state: string;
  lastSeenAt?: number;
};

export type LocalReplicaWriteCandidate = {
  _id: unknown;
  deviceId?: unknown;
  state: string;
  relativePath?: string;
  updatedAt?: number;
};

/** The paired Bridge that is actually running, not a leftover active row. */
export function chooseLiveBridgeDeviceId(
  devices: readonly SeenBridgeDevice[],
  now: number,
  windowMs = LIVE_BRIDGE_DEVICE_WINDOW_MS,
) {
  const active = devices.filter((device) => device.state === "active");
  if (!active.length) return undefined;
  const newest = [...active].sort(
    (left, right) => (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0),
  )[0];
  if (!newest) return undefined;
  const recent = active.filter(
    (device) =>
      (newest.lastSeenAt ?? 0) - (device.lastSeenAt ?? 0) <= windowMs,
  );
  return (recent.length ? recent : [newest]).sort(
    (left, right) => (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0),
  )[0]?._id;
}

/**
 * Cloud-to-local writes follow the live Bridge. A requested replica on a silent
 * device may retarget onto the live replica of the same relative path, never
 * onto a different file, and never onto a device that is not heartbeating.
 */
export function chooseLiveLocalReplica<T extends LocalReplicaWriteCandidate>(
  replicas: readonly T[],
  liveDeviceId: unknown,
  requestedReplicaId?: unknown,
) {
  if (!liveDeviceId) return undefined;
  const onLive = replicas.filter(
    (replica) =>
      replica.deviceId === liveDeviceId && replica.state !== "unavailable",
  );
  if (!onLive.length) return undefined;
  if (requestedReplicaId) {
    const requestedLive = onLive.find(
      (replica) => replica._id === requestedReplicaId,
    );
    if (requestedLive) return requestedLive;
    const requested = replicas.find(
      (replica) => replica._id === requestedReplicaId,
    );
    if (requested?.relativePath) {
      const samePath = onLive.find(
        (replica) => replica.relativePath === requested.relativePath,
      );
      if (samePath) return samePath;
    }
    return undefined;
  }
  return [...onLive].sort(
    (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
  )[0];
}