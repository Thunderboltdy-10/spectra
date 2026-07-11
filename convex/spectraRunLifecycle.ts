export type SpectraRunStatus =
  | "queued"
  | "running"
  | "awaiting_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type SpectraOperationStatus =
  | "proposed"
  | "executing"
  | "executed"
  | "failed"
  | "cancelled";

const ACTIVE_STATUSES = new Set<SpectraRunStatus>([
  "queued",
  "running",
  "awaiting_confirmation",
]);

const TERMINAL_STATUSES = new Set<SpectraRunStatus>([
  "completed",
  "failed",
  "cancelled",
]);

const TRANSITIONS: Record<SpectraRunStatus, ReadonlySet<SpectraRunStatus>> = {
  queued: new Set(["queued", "running", "cancelled", "failed"]),
  running: new Set(["running", "awaiting_confirmation", "completed", "failed", "cancelled"]),
  awaiting_confirmation: new Set(["awaiting_confirmation", "running", "cancelled", "failed"]),
  completed: new Set(["completed"]),
  failed: new Set(["failed"]),
  cancelled: new Set(["cancelled"]),
};

export function isActiveRunStatus(status: SpectraRunStatus) {
  return ACTIVE_STATUSES.has(status);
}

export function isTerminalRunStatus(status: SpectraRunStatus) {
  return TERMINAL_STATUSES.has(status);
}

export function canTransitionRunStatus(from: SpectraRunStatus, to: SpectraRunStatus) {
  return TRANSITIONS[from].has(to);
}

export function requireCurrentExecution(
  currentExecutionId: string | undefined,
  expectedExecutionId: string,
) {
  if (!currentExecutionId || currentExecutionId !== expectedExecutionId) {
    throw new Error("This run attempt is no longer active.");
  }
}

export function interruptionRecovery(
  operationStatuses: readonly SpectraOperationStatus[],
  hasPartialResponse: boolean,
) {
  const mayHaveCommitted = operationStatuses.some((status) =>
    status === "executing" || status === "executed" || status === "failed"
  );
  return {
    recoveryState: mayHaveCommitted || hasPartialResponse ? "partial" as const : "interrupted" as const,
    retryable: !mayHaveCommitted,
    preservedPartial: hasPartialResponse || mayHaveCommitted,
  };
}
