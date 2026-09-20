export const CHECKPOINT_IDLE_MS = 2_000;
export const CHECKPOINT_MAX_MS = 15_000;

/**
 * @param {{
 *   idleMs?: number,
 *   maxMs?: number,
 *   persist?: (payload: any) => any,
 *   now?: () => number,
 * }} options
 */
export function createCheckpointScheduler({
  idleMs = CHECKPOINT_IDLE_MS,
  maxMs = CHECKPOINT_MAX_MS,
  persist,
  now = () => Date.now(),
} = {}) {
  if (typeof persist !== "function")
    throw new Error("COLLABORATION_CHECKPOINT_PERSIST_REQUIRED");
  let idleTimer = null;
  let firstAt = null;
  let pending = null;
  let tail = Promise.resolve();

  function clearIdle() {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  async function flush() {
    clearIdle();
    const payload = pending;
    pending = null;
    firstAt = null;
    if (!payload) return null;
    try { return await persist(payload); }
    catch (error) {
      // Preserve the failed candidate unless a newer durable head is waiting.
      if (!pending) pending = payload;
      throw error;
    }
  }

  function schedule() {
    clearIdle();
    if (!pending) return;
    const elapsed = now() - (firstAt ?? now());
    const wait = Math.max(0, Math.min(idleMs, maxMs - elapsed));
    idleTimer = setTimeout(() => {
      idleTimer = null;
      tail = tail.catch(() => undefined).then(flush);
      void tail.catch(() => undefined);
    }, wait);
    idleTimer.unref?.();
  }

  return {
    note(payload) {
      pending = payload;
      if (firstAt == null) firstAt = now();
      schedule();
    },
    flush() {
      tail = tail.catch(() => undefined).then(flush);
      void tail.catch(() => undefined);
      return tail;
    },
    pending() {
      return pending;
    },
    dispose() {
      clearIdle();
      pending = null;
      firstAt = null;
    },
  };
}
