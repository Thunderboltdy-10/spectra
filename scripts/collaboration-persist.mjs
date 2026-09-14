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
  const message = collaborationFailureMessage(error);
  return message.match(/COLLABORATION_[A-Z_]+/)?.[0] ?? null;
}

export function isRebaseablePersistenceFailure(error) {
  return persistenceFailureCode(error) === "COLLABORATION_BASE_STATE_STALE";
}

export function permanentPersistenceFailure(error) {
  const message = collaborationFailureMessage(error);
  // Convex document ceiling — retrying cannot shrink the row. Fail closed so
  // Saving does not hang in an endless durable-append loop (1.48 MiB > 1 MiB).
  if (/Value is too large|maximum size\s+1\s*MiB/i.test(message)) return true;
  const code = persistenceFailureCode(error);
  if (!code || code === "COLLABORATION_BASE_STATE_STALE") return false;
  // PROJECTION_SIZE / PROJECTION_INVALID / CHANGE_GROUP_SIZE are fail-closed:
  // retrying cannot shrink an oversize native projection or change-group row,
  // and must not leave peers without durable_failed.
  return /COLLABORATION_(?:ACCESS_REVOKED|TOKEN_EXPIRED|READ_ONLY|REGION_|AI_ATTRIBUTION|NATIVE_PROJECTION|PROJECTION_(?:SIZE|INVALID)|CHANGE_GROUP_SIZE|MODEL_CHANGE|GATEWAY_(?:FORBIDDEN|UPDATE_(?:SIZE|INVALID)))/.test(
    code,
  );
}

export function isTransientCollaborationFailure(error) {
  if (persistenceFailureCode(error) === "COLLABORATION_GATEWAY_UNAVAILABLE")
    return true;
  const message = collaborationFailureMessage(error);
  return /InternalServerError|Try again later|TooManyWrites|Too many writes|TooManyReads|OptimisticConcurrency|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|socket hang up|UND_ERR_|timed out|maximum duration|Function execution timed out/i.test(
    message,
  );
}

export function collaborationRetryDelayMs(
  error,
  attempt,
  { baseMs = 150, maxMs = 5_000 } = {},
) {
  const writeLimited = /TooManyWrites|Too many writes/i.test(
    collaborationFailureMessage(error),
  );
  const start = writeLimited ? 1_000 : baseMs;
  return Math.min(maxMs, start * 2 ** Math.min(Math.max(attempt, 0), 6));
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

export function samePersistenceBatch(left, right) {
  const leftContext = left?.context ?? {};
  const rightContext = right?.context ?? {};
  if (
    leftContext.artifactId !== rightContext.artifactId ||
    leftContext.partitionKey !== rightContext.partitionKey ||
    leftContext.policyVersion !== rightContext.policyVersion ||
    leftContext.actorKind !== rightContext.actorKind
  )
    return false;
  if (
    Boolean(left?.nativeInitialization) !==
    Boolean(right?.nativeInitialization)
  )
    return false;
  if (leftContext.actorKind === "ai") {
    return (
      leftContext.accountId === rightContext.accountId &&
      leftContext.clientId === rightContext.clientId
    );
  }
  return leftContext.accountId === rightContext.accountId;
}

export function chainPersistThenCompact({
  persist,
  compact,
  onCompactError = () => undefined,
}) {
  let persistTail = Promise.resolve();
  let compactTail = Promise.resolve();
  return {
    enqueue(work) {
      persistTail = persistTail
        .then(() => persist(work))
        .then((result) => {
          compactTail = compactTail
            .then(() => compact(work, result))
            .catch(onCompactError);
          return result;
        })
        .catch(() => undefined);
      return persistTail;
    },
    get persistTail() {
      return persistTail;
    },
    get compactTail() {
      return compactTail;
    },
  };
}

function nestedConvexDetail(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const jsonMatch = raw.match(/Uncaught Error:\s*(\{[\s\S]*\})/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (typeof parsed?.message === "string" && parsed.message.trim())
        return parsed.message.trim();
      if (typeof parsed?.code === "string" && parsed.code.trim())
        return parsed.code.trim();
    } catch {
      // Fall through to the collaboration-code extractor.
    }
  }
  return raw.match(/COLLABORATION_[A-Z_]+/)?.[0] ?? raw.trim();
}

export function collaborationFailureMessage(error) {
  if (typeof error === "string" && error.trim())
    return nestedConvexDetail(error).slice(0, 500);
  const message =
    error instanceof Error
      ? error.message
      : typeof error?.message === "string"
        ? error.message
        : "";
  const dataMessage =
    typeof error?.data === "string"
      ? error.data
      : typeof error?.data?.message === "string"
        ? error.data.message
        : "";
  const useful = [dataMessage, message]
    .map((value) =>
      typeof value === "string" ? nestedConvexDetail(value) : "",
    )
    .find((value) => value && value !== "Error");
  if (useful) return useful.slice(0, 500);
  return "CLASSROOM_LOAD_CONVEX_OBSERVE_FAILED";
}
