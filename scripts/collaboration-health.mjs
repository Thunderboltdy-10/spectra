/**
 * @param {{
 *   protocolVersion?: number,
 *   connections?: number,
 *   lastPersistenceFailure?: null | { code: string, at: number, attempt: number },
 *   startedAt?: number,
 *   now?: number,
 * }} options
 */
export function gatewayHealthPayload({
  protocolVersion,
  connections = 0,
  lastPersistenceFailure = null,
  startedAt,
  now = Date.now(),
  convex = { status: "ready" },
} = {}) {
  const convexStatus = convex?.status === "ready" ? "ready" : "not_ready";
  const persistenceDegraded = Boolean(lastPersistenceFailure);
  let status = "ready";
  if (convexStatus !== "ready") status = "not_ready";
  else if (persistenceDegraded) status = "degraded";
  return {
    service: "spectra-collaboration-gateway",
    protocolVersion,
    status,
    connections,
    persistence: lastPersistenceFailure,
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
