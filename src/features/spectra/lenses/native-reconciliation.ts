export type RecentNativeOperation = {
  direction?: string;
  state?: string;
  actorKind?: string;
  revisionAfter?: string;
};

const RECONCILABLE_EXTERNAL_STATES = new Set([
  "pending",
  "applied",
  "conflicted",
]);

const PENDING_CLOUD_TO_LOCAL_STATES = new Set(["pending", "claimed"]);

export function hasUnreconciledExternalRevision(
  operations: readonly RecentNativeOperation[] | undefined,
  revision: string,
) {
  return Boolean(
    operations?.some(
      (operation) =>
        operation.direction === "external" &&
        operation.actorKind === "external-edit" &&
        operation.revisionAfter === revision &&
        RECONCILABLE_EXTERNAL_STATES.has(operation.state ?? ""),
    ),
  );
}

export function hasPendingCloudToLocalWrite(
  operations: readonly RecentNativeOperation[] | undefined,
) {
  return Boolean(
    operations?.some(
      (operation) =>
        operation.direction === "cloud-to-local" &&
        PENDING_CLOUD_TO_LOCAL_STATES.has(operation.state ?? ""),
    ),
  );
}

/**
 * Opening a linked file must not treat a stale disk as a Word save when
 * Spectra already queued a cloud-to-local write. Hash mismatch alone is
 * Spectra-ahead, not "both copies changed."
 */
export function shouldActivateExternalNativeRevision(input: {
  operations?: readonly RecentNativeOperation[];
  localHash: string;
  localState?: string;
  cloudHash: string;
}) {
  if (input.localState === "unavailable") return false;
  if (hasUnreconciledExternalRevision(input.operations, input.localHash))
    return true;
  if (input.localState === "behind") return false;
  if (hasPendingCloudToLocalWrite(input.operations)) return false;
  return input.localHash !== input.cloudHash;
}
