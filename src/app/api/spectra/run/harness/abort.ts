/** Shared Stop fence for mutation boundaries. Do not continue a stale
 * execution after the run abort signal fires. */
export function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException("Aborted", "AbortError");
}
