import {
  applicationOperationScope,
  applicationWriteReceipt,
} from "../../../../../../convex/spectraApplicationWriteScope";
import { queuedLocalWrite } from "../../../../../../convex/bridgeWriteOperations";
import type { ResultAction, StoredOperation } from "./contract";

type Affected = { type: string; id: string };
const persistedOperationTypes = new Set([
  "artifact.create", "artifact.update", "artifact.archive", "artifact.link",
  "workspace.create", "workspace.update", "workspaceItem.add", "workspaceItem.hide", "workspaceItem.setPinned",
]);
export type AcknowledgedOutcome = {
  operationId?: string;
  /** A matching live read is not proof that this operation performed the write. */
  acknowledged?: boolean;
  operation: { type: string; input?: unknown };
  affected: Affected[];
};

/** Verification may reject saved content; it cannot erase the save receipt. */
export async function retainOutcomeThenVerify<T extends AcknowledgedOutcome>(
  outcomes: T[], outcome: T, verify: () => Promise<void>,
) {
  const existing = outcome.operationId
    ? outcomes.findIndex((entry) => entry.operationId === outcome.operationId) : -1;
  if (existing < 0) outcomes.push(outcome);
  else outcomes[existing] = outcome;
  await verify();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Only authoritative receipts and acknowledged effects influence save truth.
 * Executing alone is ambiguous, and an error string is not a write receipt.
 * This projection does not change, reapply or authorize any operation. */
export function reconcileInterruptedEffects(input: {
  executionId: string;
  acknowledged: readonly AcknowledgedOutcome[];
  operations?: readonly StoredOperation[] | null;
  run?: unknown;
  attemptedEffect?: boolean;
  unacknowledgedOperationId?: string;
}) {
  const effects = new Map<string, AcknowledgedOutcome>();
  for (const [index, outcome] of input.acknowledged.entries()) {
    if (outcome.acknowledged === false) continue;
    if (persistedOperationTypes.has(outcome.operation.type) || outcome.operation.type === "app.command")
      effects.set(outcome.operationId ?? `local:${index}`, outcome);
  }
  const applicationReceipts: Array<{ operationId: string; receipt: { scope: string; result: unknown } }> = [];
  let ambiguous = false;
  let lastAttemptConfirmed = false;
  for (const operation of input.operations ?? []) {
    if (operation.executionId !== input.executionId) continue;
    if (!persistedOperationTypes.has(operation.type) && operation.type !== "app.command") continue;
    if (operation.status === "proposed" || operation.status === "waiting") continue;
    const receipt = applicationWriteReceipt(operation.output);
    const validApplicationReceipt = operation.type === "app.command" && receipt
      && receipt.scope === applicationOperationScope({ type: operation.type, input: operation.input });
    // markFailed historically retained affected/output after an executed save.
    // affected is populated at markExecuted, never by initial recordPlan.
    const retainedEffect = operation.status === "failed" && (operation.affected?.length ?? 0) > 0;
    if (operation.status === "executed" || retainedEffect || validApplicationReceipt) {
      effects.set(operation._id, {
        operationId: operation._id,
        operation: { type: operation.type, input: operation.input },
        affected: operation.affected?.length ? operation.affected : effects.get(operation._id)?.affected ?? [],
      });
      if (validApplicationReceipt && receipt)
        applicationReceipts.push({ operationId: operation._id, receipt });
      if (operation._id === input.unacknowledgedOperationId &&
        (operation.status === "executed" || validApplicationReceipt)) lastAttemptConfirmed = true;
    } else if (operation.status === "executing" || (operation.status === "failed" && input.attemptedEffect)) ambiguous = true;
  }
  const outcomes = [...effects.values()];
  const affected = [...new Map<string, Affected>(outcomes.flatMap((entry) => entry.affected)
    .filter((item) => item.id)
    .map((item) => [`${item.type}:${item.id}`, item] as const)).values()];
  const artifactWrites = outcomes.filter(({ operation }) =>
    operation.type === "artifact.create" || operation.type === "artifact.update");
  const undoAvailable = artifactWrites.some(({ affected: items }) =>
    items.some((item) => item.type === "artifact" && item.id));
  const saved = outcomes.some(({ operation, affected: items }) => persistedOperationTypes.has(operation.type) && items.length > 0)
    || applicationReceipts.length > 0;
  // The run row carries Bridge read-back once it completes. Before that, the
  // admission receipts say which local-file writes were queued; only a write
  // the Bridge had already verified counts as verified.
  const runNative = record(input.run).outcome;
  const queuedWrites = (input.operations ?? []).filter((operation) => effects.has(operation._id))
    .flatMap((operation) => queuedLocalWrite(operation.output) ?? []);
  const native = runNative === "native_pending" || runNative === "native_verified" ? runNative
    : !queuedWrites.length ? undefined
      : queuedWrites.every((write) => write.state === "verified") ? "native_verified" : "native_pending";
  const outcome: "canonical_saved" | "native_pending" | "native_verified" | undefined = saved
    ? native ?? "canonical_saved"
    : undefined;
  return {
    outcomes, affected, applicationReceipts, undoAvailable, saved,
    committedCount: outcomes.length,
    ambiguous: ambiguous || (Boolean(input.unacknowledgedOperationId) && !lastAttemptConfirmed)
      || (input.attemptedEffect === true && !outcomes.length),
    outcome,
  };
}

export type InterruptedEffects = ReturnType<typeof reconcileInterruptedEffects>;

export function canUndoRunWithEffects(status: string, effects: InterruptedEffects) {
  return status === "completed" || status === "cancelled" || (status === "failed" && effects.undoAvailable);
}

export function interruptedEffectActions(effects: InterruptedEffects, runId: string): ResultAction[] {
  return [
    ...effects.affected.filter((item) => item.type === "artifact")
      .map((item) => ({ key: "open", label: "Open saved work", targetType: "artifact" as const, targetId: item.id })),
    ...(effects.undoAvailable ? [{ key: "revert", label: "Undo this run", targetType: "run" as const, targetId: runId }] : []),
  ];
}

const nativeSyncSentence = {
  canonical_saved: "",
  native_pending: " The file on your computer hasn't confirmed this change yet.",
  native_verified: " The file on your computer was checked and has this change.",
} as const;

/** The model writes its closing reply before the Bridge reads a local file back,
 * so a saved run's reply carries the receipt's file state instead of letting
 * "I updated your document" stand for the file on the student's computer. */
export function replyWithNativeReceipt(reply: string, nativeOutcome: unknown) {
  if (nativeOutcome !== "native_pending" && nativeOutcome !== "native_verified") return reply;
  return `${reply.trimEnd()}\n\n${nativeSyncSentence[nativeOutcome].trim()}`;
}

export function interruptedEffectSummary(
  effects: InterruptedEffects, message: string, options: { stopped?: boolean; verificationFailed?: boolean } = {},
) {
  const facts = effects.saved
    ? options.verificationFailed
      ? "Changes were saved, but their verification did not finish successfully."
      : "Earlier changes were saved and their receipts are preserved."
    : effects.committedCount
      ? "Completed action receipts are preserved."
      : effects.ambiguous
        ? "The last action's save could not be confirmed; review it before continuing."
        : "";
  const native = effects.outcome ? nativeSyncSentence[effects.outcome] : "";
  const unknownRemainder = effects.ambiguous && effects.committedCount
    ? " The last action's outcome remains unconfirmed." : "";
  return `${options.stopped ? "Stopped by you. " : ""}${facts}${native}${unknownRemainder} ${message}`.trim();
}
