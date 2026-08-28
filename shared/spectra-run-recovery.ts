export type SpectraOperationRecoveryStatus =
  | "proposed"
  | "executing"
  | "waiting"
  | "executed"
  | "failed"
  | "cancelled";

/**
 * Retry safety is about whether an operation may have crossed its commit
 * boundary. Partial response text is preserved, but it does not by itself
 * make replaying the request unsafe.
 */
export function interruptionRecovery(
  operationStatuses: readonly SpectraOperationRecoveryStatus[],
  hasPartialResponse: boolean,
) {
  const mayHaveCommitted = operationStatuses.some(
    (status) =>
      status === "executing" ||
      status === "waiting" ||
      status === "executed" ||
      status === "failed",
  );
  return {
    recoveryState:
      mayHaveCommitted || hasPartialResponse
        ? ("partial" as const)
        : ("interrupted" as const),
    retryable: !mayHaveCommitted,
    preservedPartial: hasPartialResponse || mayHaveCommitted,
  };
}
