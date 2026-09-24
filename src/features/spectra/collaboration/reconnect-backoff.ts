import { SYNC_RETRY_POLICY } from "../../../../shared/sync-retry-policy";

export const COLLAB_RECONNECT = {
  delay: SYNC_RETRY_POLICY.collaborationMinDelayMs,
  factor: 2,
  minDelay: SYNC_RETRY_POLICY.collaborationMinDelayMs,
  maxDelay: SYNC_RETRY_POLICY.maxDelayMs,
  jitter: true,
  maxAttempts: 0,
  initialDelay: 0,
} as const;
