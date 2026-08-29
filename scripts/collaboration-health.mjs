export function gatewayHealthPayload({
  protocolVersion,
  connections = 0,
  lastPersistenceFailure = null,
  startedAt,
  now = Date.now(),
} = {}) {
  const degraded = Boolean(lastPersistenceFailure);
  return {
    service: "spectra-collaboration-gateway",
    protocolVersion,
    status: degraded ? "degraded" : "ready",
    connections,
    persistence: lastPersistenceFailure,
    uptimeMs: Math.max(0, now - (startedAt ?? now)),
  };
}

export function isGatewayHealthBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    value.service === "spectra-collaboration-gateway" &&
    (value.status === "ready" || value.status === "degraded") &&
    typeof value.protocolVersion === "number"
  );
}
