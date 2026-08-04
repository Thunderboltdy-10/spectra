export type LeaseReleaseEvent = {
  targetId: string;
  leaseId: string;
  releasedAt: number;
  reason: "commit" | "blur" | "close" | "pointer_up" | "disconnect" | "expiry" | "explicit";
};

export type WaitResumeResult<TTarget> =
  | { kind: "resume"; target: TTarget; waitedMs: number }
  | { kind: "replan"; target: TTarget | null; waitedMs: number; reason: string }
  | { kind: "cancelled"; waitedMs: number };

type Listener = (event: LeaseReleaseEvent) => void;

export class LeaseReleaseSubscriptions {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(targetId: string, listener: Listener) {
    let targetListeners = this.listeners.get(targetId);
    if (!targetListeners) {
      targetListeners = new Set();
      this.listeners.set(targetId, targetListeners);
    }
    targetListeners.add(listener);
    return () => {
      targetListeners?.delete(listener);
      if (targetListeners?.size === 0) this.listeners.delete(targetId);
    };
  }

  release(event: LeaseReleaseEvent) {
    for (const listener of this.listeners.get(event.targetId) ?? []) listener(event);
  }
}

export type WaitForActorOptions<TTarget> = {
  targetId: string;
  signal?: AbortSignal;
  idleThresholdMs?: number;
  now?: () => number;
  resolveTarget(): Promise<TTarget | null> | TTarget | null;
  isStillRelevant(target: TTarget): Promise<boolean> | boolean;
};

/**
 * Subscription-driven wait semantics for recoverable AI actions. There is no
 * polling loop and no timeout-to-failure path: release wakes the action, an
 * idle window prevents cursor races, then the semantic target is resolved and
 * verified again before execution continues.
 */
export async function waitForActorRelease<TTarget>(
  subscriptions: LeaseReleaseSubscriptions,
  options: WaitForActorOptions<TTarget>,
): Promise<WaitResumeResult<TTarget>> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  if (options.signal?.aborted) return { kind: "cancelled", waitedMs: 0 };
  const released = await new Promise<LeaseReleaseEvent | null>((resolve) => {
    const unsubscribe = subscriptions.subscribe(options.targetId, (event) => {
      unsubscribe();
      options.signal?.removeEventListener("abort", onAbort);
      resolve(event);
    });
    const onAbort = () => {
      unsubscribe();
      resolve(null);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
  if (!released) return { kind: "cancelled", waitedMs: now() - startedAt };
  const idleThreshold = Math.max(0, options.idleThresholdMs ?? 260);
  if (idleThreshold)
    await new Promise<void>((resolve) => setTimeout(resolve, idleThreshold));
  if (options.signal?.aborted)
    return { kind: "cancelled", waitedMs: now() - startedAt };
  const target = await options.resolveTarget();
  if (!target)
    return {
      kind: "replan",
      target: null,
      waitedMs: now() - startedAt,
      reason: "target_missing_after_wait",
    };
  if (!(await options.isStillRelevant(target)))
    return {
      kind: "replan",
      target,
      waitedMs: now() - startedAt,
      reason: "operation_no_longer_relevant",
    };
  return { kind: "resume", target, waitedMs: now() - startedAt };
}

export const leaseReleaseSubscriptions = new LeaseReleaseSubscriptions();
