export type NativeWriteStatusOperation = {
  direction?: string;
  state?: string;
  replicaId?: string;
  createdAt?: number;
  updatedAt?: number;
};

/**
 * Older failed writes are history once a newer revision has replaced them.
 * Verification must evaluate the newest cloud-to-local operation per visible
 * local replica, so an intentionally superseded Office-locked request cannot
 * make its replacement look failed.
 */
export function latestNativeWritePerReplica<T extends NativeWriteStatusOperation>(
  operations: readonly T[],
  replicaIds: readonly string[],
) {
  const visibleReplicaIds = new Set(replicaIds);
  const newest = new Map<string, T>();
  for (const operation of operations) {
    const replicaId = operation.replicaId;
    if (
      operation.direction !== "cloud-to-local" ||
      !replicaId ||
      !visibleReplicaIds.has(replicaId)
    )
      continue;
    const previous = newest.get(replicaId);
    if (
      !previous ||
      (operation.createdAt ?? 0) > (previous.createdAt ?? 0) ||
      ((operation.createdAt ?? 0) === (previous.createdAt ?? 0) &&
        (operation.updatedAt ?? 0) > (previous.updatedAt ?? 0))
    )
      newest.set(replicaId, operation);
  }
  return [...newest.values()];
}
