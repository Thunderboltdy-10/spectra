export const COLLAB_RECONNECT = {
  delay: 400,
  factor: 2,
  minDelay: 200,
  maxDelay: 12_000,
  jitter: true,
  maxAttempts: 0,
  initialDelay: 0,
} as const;
