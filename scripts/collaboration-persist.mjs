/**
 * Durable Yjs append policy for the Hocuspocus gateway.
 *
 * Apply captures `baseStateVectorHash` before Hocuspocus mutates the shared
 * document. Persist is debounced and queued, so a later writer can CAS-lose
 * against `artifact.liveStateVectorHash` even though both updates already
 * live in the room Y.Doc. Overlapping CRDT CAS is rebaseable; it is not a
 * dead socket, revoked token, or invalid envelope.
 */

export function persistenceFailureCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/COLLABORATION_[A-Z_]+/)?.[0] ?? null;
}

export function isRebaseablePersistenceFailure(error) {
  return persistenceFailureCode(error) === "COLLABORATION_BASE_STATE_STALE";
}

export function permanentPersistenceFailure(error) {
  const code = persistenceFailureCode(error);
  if (!code || code === "COLLABORATION_BASE_STATE_STALE") return false;
  return /COLLABORATION_(?:ACCESS_REVOKED|TOKEN_EXPIRED|READ_ONLY|REGION_|AI_ATTRIBUTION|NATIVE_PROJECTION|MODEL_CHANGE|GATEWAY_(?:FORBIDDEN|UPDATE_(?:SIZE|INVALID)))/.test(
    code,
  );
}

export function isTransientCollaborationFailure(error) {
  if (persistenceFailureCode(error) === "COLLABORATION_GATEWAY_UNAVAILABLE")
    return true;
  const message = error instanceof Error ? error.message : String(error);
  return /InternalServerError|Try again later|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|socket hang up|UND_ERR_/i.test(
    message,
  );
}

export const COLLABORATION_AUTHORIZE_CACHE_MS = 15_000;

export function durableHeadKey(context) {
  if (!context?.artifactId || !context?.partitionKey) return null;
  return `${context.artifactId}:${context.partitionKey}`;
}

export function appendBaseStateVectorHash({
  lastPersistedHash,
  capturedBaseHash,
}) {
  if (typeof lastPersistedHash === "string" && lastPersistedHash.length >= 16)
    return lastPersistedHash;
  return capturedBaseHash;
}

export function rebaseAppendPayload(payload, liveStateVectorHash) {
  if (
    typeof liveStateVectorHash !== "string" ||
    liveStateVectorHash.length < 16
  )
    return payload;
  if (payload.baseStateVectorHash === liveStateVectorHash) return payload;
  return {
    ...payload,
    baseStateVectorHash: liveStateVectorHash,
  };
}

export function resolveRebaseHead({ lastPersistedHash, storedLiveHash }) {
  if (typeof storedLiveHash === "string" && storedLiveHash.length >= 16)
    return storedLiveHash;
  if (typeof lastPersistedHash === "string" && lastPersistedHash.length >= 16)
    return lastPersistedHash;
  return null;
}
