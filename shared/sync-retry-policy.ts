import policy from "./sync-retry-policy.json";

export const SYNC_RETRY_POLICY = policy;

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * One deterministic exponential schedule shared by durable writes and
 * collaboration recovery. Stable jitter spreads devices without making a
 * single work item retry at a different rate after refresh.
 */
export function syncRetryDelayMs(
  attempt: number,
  key: string,
  maxDelayMs = SYNC_RETRY_POLICY.maxDelayMs,
  initialDelayMs = SYNC_RETRY_POLICY.initialDelayMs,
) {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const exponent = Math.min(30, normalizedAttempt - 1);
  const nominal = Math.min(
    maxDelayMs,
    initialDelayMs * 2 ** exponent,
  );
  const spread = Math.floor(
    (nominal * SYNC_RETRY_POLICY.jitterPercent) / 100,
  );
  if (!spread) return nominal;
  const offset =
    stableHash(`${key}:${normalizedAttempt}`) % (spread * 2 + 1);
  return Math.min(
    maxDelayMs,
    Math.max(initialDelayMs, nominal - spread + offset),
  );
}

export function bridgeMountRepairRetryDelayMs(attempt: number, key: string) {
  return syncRetryDelayMs(
    attempt,
    key,
    SYNC_RETRY_POLICY.bridgeMountRepairMaxDelayMs,
    SYNC_RETRY_POLICY.bridgeMountRepairInitialDelayMs,
  );
}

export function syncRetryAt(now: number, attempt: number, key: string) {
  return now + syncRetryDelayMs(attempt, key);
}

