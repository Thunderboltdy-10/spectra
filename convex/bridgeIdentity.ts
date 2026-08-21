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
