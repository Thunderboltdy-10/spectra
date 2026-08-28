/**
 * Stable Follow-AI identity.
 *
 * Collaboration transport client ids are per-operation
 * (`ai:${runId}:${operationId}:…`) so a human browser never treats the worker
 * as its own presence. Follow, dock chips, and presence rows must key the run,
 * or following dies on the next operation while the chip stays lit.
 */
export function stableAiActorId(
  input:
    | string
    | null
    | undefined
    | {
        clientId?: string | null;
        runId?: string | null;
      },
): string | null {
  if (!input) return null;
  if (typeof input === "string") return parseAiClientId(input);
  const runId = input.runId?.trim();
  if (runId) return runId;
  return parseAiClientId(input.clientId);
}

export function parseAiClientId(clientId?: string | null): string | null {
  const raw = clientId?.trim();
  if (!raw) return null;
  if (raw.startsWith("ai:")) {
    const runId = raw.slice(3).split(":")[0]?.trim();
    return runId || null;
  }
  return raw;
}
