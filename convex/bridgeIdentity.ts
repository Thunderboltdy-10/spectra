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
