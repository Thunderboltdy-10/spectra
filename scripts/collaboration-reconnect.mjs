import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SYNC_RETRY_POLICY = require("../shared/sync-retry-policy.json");

export const COLLAB_RECONNECT = {
  delay: SYNC_RETRY_POLICY.collaborationMinDelayMs,
  factor: 2,
  minDelay: SYNC_RETRY_POLICY.collaborationMinDelayMs,
  maxDelay: SYNC_RETRY_POLICY.maxDelayMs,
  jitter: true,
  maxAttempts: 0,
  initialDelay: 0,
};

export function reconnectDelayMs(
  attempt,
  {
    delay = COLLAB_RECONNECT.delay,
    factor = COLLAB_RECONNECT.factor,
    minDelay = COLLAB_RECONNECT.minDelay,
    maxDelay = COLLAB_RECONNECT.maxDelay,
    jitter = COLLAB_RECONNECT.jitter,
    random = Math.random,
  } = {},
) {
  const boundedAttempt = Math.max(0, Math.floor(attempt));
  const raw = Math.min(maxDelay, delay * factor ** boundedAttempt);
  if (!jitter) return Math.max(minDelay, Math.floor(raw));
  const spread = Math.floor((raw * SYNC_RETRY_POLICY.jitterPercent) / 100);
  const offset = Math.floor(random() * (spread * 2 + 1));
  return Math.min(maxDelay, Math.max(minDelay, Math.floor(raw) - spread + offset));
}
