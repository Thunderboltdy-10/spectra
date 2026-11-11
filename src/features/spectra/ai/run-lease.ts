/** A run lease is long enough to cover a stalled model/tool request. */
export const SPECTRA_RUN_LEASE_DURATION_MS = 2 * 60_000;

/** While a step waits on the user's screen, the heartbeat is how the worker hears back. */
export const SPECTRA_RUN_HEARTBEAT_INTERVAL_MS = 5_000;

/** Otherwise event writes already carry Stop and new messages, so it only keeps the lease. */
export const SPECTRA_RUN_QUIET_HEARTBEAT_MS = 20_000;

/** Renew halfway through the lease, leaving time for a transient retry. */
export const SPECTRA_RUN_LEASE_RENEWAL_BUFFER_MS = 60_000;

export function shouldRenewSpectraRunLease(
  leaseExpiresAt: number | undefined,
  now = Date.now(),
) {
  return (
    typeof leaseExpiresAt !== "number" ||
    !Number.isFinite(leaseExpiresAt) ||
    leaseExpiresAt <= now + SPECTRA_RUN_LEASE_RENEWAL_BUFFER_MS
  );
}
