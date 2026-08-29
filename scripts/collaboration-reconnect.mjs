export const COLLAB_RECONNECT = {
  delay: 400,
  factor: 2,
  minDelay: 200,
  maxDelay: 12_000,
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
  const span = Math.max(0, raw - minDelay);
  return Math.floor(minDelay + random() * span);
}
