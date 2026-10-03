import { mutate } from "./io";
import { throwIfAborted } from "./abort";
import { uiObservationSnapshotSchema, type UiObservationSnapshot, type UiObservationFence } from "@/features/spectra/actions/protocol/semantic-action";

type Identity = { runId: string; executionId: string; operationId: string };
type Waiter = { identity: Identity; preparing: boolean; cancel: () => void; accept: (value: UiObservationSnapshot) => void };
const waiting = new Map<string, Waiter>();
const key = (identity: Pick<Identity, "runId" | "executionId">) => JSON.stringify([identity.runId, identity.executionId]);

/** Optional same-process wake. Durable observation plus the existing worker
 * heartbeat and expiry remain sufficient across instances and restarts. */
export function notifyUiObservation(identity: Identity, value: unknown): void {
  const waiter = waiting.get(key(identity));
  if (waiter?.identity.operationId !== identity.operationId) return;
  const parsed = uiObservationSnapshotSchema.safeParse(value);
  if (parsed.success && !(waiter.preparing && parsed.data.phase === "headless" && !parsed.data.action)) waiter.accept(parsed.data);
}

export function cancelUiObservation(runId: string, executionId: string): void {
  waiting.get(key({ runId, executionId }))?.cancel();
}

export function awaitedUiOperation(runId: string, executionId: string): string | undefined {
  return waiting.get(key({ runId, executionId }))?.identity.operationId;
}

export async function waitForSettingsAction(identity: Identity, signal?: AbortSignal): Promise<{ fence?: UiObservationFence; committed?: { result: unknown } }> {
  throwIfAborted(signal);
  const waiterKey = key(identity);
  if (waiting.has(waiterKey)) throw new Error("UI_OBSERVATION_ALREADY_WAITING");
  let resolve!: (snapshot: UiObservationSnapshot) => void;
  let reject!: (error: unknown) => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: UiObservationSnapshot | undefined;
  let settled = false;
  const done = new Promise<UiObservationSnapshot>((yes, no) => { resolve = yes; reject = no; });
  // Attach a rejection handler before preparation I/O, so an early Stop is not
  // an unhandled rejection while the initial mutation is still in flight.
  void done.catch(() => undefined);
  const onAbort = () => reject(new Error("AI_EXECUTION_ABORTED"));
  const waiter: Waiter = {
    identity,
    preparing: true,
    cancel: onAbort,
    accept(snapshot) {
      if (settled) return;
      if (snapshot.action && (snapshot.action.runId !== identity.runId || snapshot.action.executionId !== identity.executionId || snapshot.action.operationId !== identity.operationId)) return;
      if (last?.action && snapshot.action && snapshot.action.epoch < last.action.epoch) return;
      last = snapshot;
      if (snapshot.phase !== "waiting") { settled = true; resolve(snapshot); return; }
      if (!snapshot.action) { reject(new Error("UI_OBSERVATION_INVALID")); return; }
      if (timer) clearTimeout(timer);
      const epoch = snapshot.action.epoch;
      timer = setTimeout(() => {
        void mutate("spectraOperations:expireUiAction", { ...identity, epoch })
          .then((value) => waiter.accept(uiObservationSnapshotSchema.parse(value)), reject);
      }, Math.max(1, snapshot.action.expiresAt - Date.now() + 1));
    },
  };
  waiting.set(waiterKey, waiter);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const prepared = uiObservationSnapshotSchema.parse(await mutate("spectraOperations:prepareUiAction", identity));
    waiter.preparing = false;
    waiter.accept(prepared);
    throwIfAborted(signal);
    const snapshot = await done;
    throwIfAborted(signal);
    if (snapshot.phase === "committed") return { committed: { result: snapshot.result } };
    return snapshot.action ? { fence: {
      epoch: snapshot.action.epoch, sequence: snapshot.action.sequence, operationDigest: snapshot.action.operationDigest,
    } } : {};
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    if (waiting.get(waiterKey) === waiter) waiting.delete(waiterKey);
  }
}
