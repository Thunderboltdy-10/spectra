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
