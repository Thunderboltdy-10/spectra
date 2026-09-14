/**
 * @param {{
 *   protocolVersion?: number,
 *   connections?: number,
 *   lastPersistenceFailure?: null | { code: string, at: number, attempt: number },
 *   lastCompactionDeferred?: null | {
 *     code: string,
 *     reason?: string,
 *     artifactId?: string | null,
 *     partitionKey?: string | null,
 *     updateBytes?: number | null,
 *     stateVectorBytes?: number | null,
 *     at: number,
 *   },
 *   startedAt?: number,
 *   now?: number,
 *   convex?: { status?: string, detail?: string },
 * }} options
 */
export function gatewayHealthPayload({
  protocolVersion,
  connections = 0,
  lastPersistenceFailure = null,
  lastCompactionDeferred = null,
  startedAt,
  now = Date.now(),
  convex = { status: "ready" },
} = {}) {
  const convexStatus = convex?.status === "ready" ? "ready" : "not_ready";
  const persistenceDegraded = Boolean(lastPersistenceFailure);
  const compactionDegraded = Boolean(lastCompactionDeferred);
  let status = "ready";
  if (convexStatus !== "ready") status = "not_ready";
  else if (persistenceDegraded || compactionDegraded) status = "degraded";
  return {
    service: "spectra-collaboration-gateway",
    protocolVersion,
    status,
    connections,
    persistence: lastPersistenceFailure,
    compaction: lastCompactionDeferred,
    uptimeMs: Math.max(0, now - (startedAt ?? now)),
    dependencies: {
      convex: {
        status: convexStatus,
        ...(convex?.detail ? { detail: convex.detail } : {}),
      },
    },
  };
}

export function isGatewayHealthBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    value.service === "spectra-collaboration-gateway" &&
    (value.status === "ready" ||
      value.status === "degraded" ||
      value.status === "not_ready") &&
    typeof value.protocolVersion === "number"
  );
}
