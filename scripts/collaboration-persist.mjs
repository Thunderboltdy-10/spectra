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
  // Convex reserved-field / document validation — retrying cannot legalize the row.
  if (/Field name .+ starts with a '\$'|which is reserved|ArgumentValidationError|Validator error/i.test(message))
    return true;
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
export const COLLABORATION_AUTHORIZE_TIMEOUT_MS = 5_000;

/** A last-success lease bounds quiet subscribers as well as incoming writers. */
export function createCollaborationAuthorizationGuard({
  authorize,
  closeConnection = (connection, code, reason) => connection.webSocket.close(code, reason),
  now = Date.now,
  maxAgeMs = COLLABORATION_AUTHORIZE_CACHE_MS,
  timeoutMs = COLLABORATION_AUTHORIZE_TIMEOUT_MS,
}) {
  const states = new WeakMap();
  const watched = new Map();
  const stateFor = context => {
    if (!states.has(context)) states.set(context, { closed: false, inFlight: null });
    return states.get(context);
  };
  const fresh = context => Number.isFinite(context.authorizationCheckedAt) &&
    context.authorizationCheckedAt > 0 && now() - context.authorizationCheckedAt < maxAgeMs;
  const connected = context => [...watched.keys()].some(connection => connection.context === context);
  const unavailable = () => Object.assign(new Error("COLLABORATION_AUTHORIZATION_UNAVAILABLE"), {
    code: 1013, reason: "Authorization temporarily unavailable",
  });
  function close(context, revoked = false) {
    stateFor(context).closed = true;
    context.canModify = false;
    if (revoked) context.authorizationRevoked = true;
    for (const [connection, timer] of watched) {
      if (connection.context !== context) continue;
      clearTimeout(timer);
      watched.delete(connection);
      closeConnection(connection, revoked ? 4403 : 1013,
        revoked ? "Access or permissions changed" : "Authorization temporarily unavailable");
    }
  }
  function arm(connection) {
    clearTimeout(watched.get(connection));
    const context = connection.context;
    const remaining = context.authorizationCheckedAt + maxAgeMs - now();
    if (!fresh(context) || stateFor(context).closed) { close(context); return; }
    const timer = setTimeout(() => {
      if (!fresh(context)) close(context);
      else arm(connection);
    }, remaining);
    timer.unref?.();
    watched.set(connection, timer);
  }
  function assertOpen(context) {
    if (context.authorizationRevoked) throw new Error("COLLABORATION_ACCESS_REVOKED");
    if (stateFor(context).closed) throw unavailable();
  }
  function refresh(context) {
    try { assertOpen(context); } catch (error) { return Promise.reject(error); }
    if (connected(context) && !fresh(context)) {
      close(context); return Promise.reject(unavailable());
    }
    const state = stateFor(context);
    if (state.inFlight) return state.inFlight;
    let timer;
    const request = (async () => {
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => authorize(context)),
          new Promise((_, reject) => { timer = setTimeout(() => reject(unavailable()), timeoutMs); }),
        ]);
        assertOpen(context); // A late response cannot resurrect an expired/closed subscriber.
        if (connected(context) && !fresh(context)) { close(context); throw unavailable(); }
        if (!result?.allowed) {
          close(context, true);
          throw new Error("COLLABORATION_ACCESS_REVOKED");
        }
        context.canModify = result.canModify === true;
        context.authorizationCheckedAt = now();
        for (const connection of watched.keys()) if (connection.context === context) arm(connection);
        return context;
      } catch (error) {
        if (/COLLABORATION_(?:ACCESS_REVOKED|GATEWAY_FORBIDDEN)/.test(String(error)))
          close(context, true);
        const transient = isTransientCollaborationFailure(error) ||
          String(error).includes("COLLABORATION_AUTHORIZATION_UNAVAILABLE");
        if (transient && !state.closed && fresh(context)) return context;
        if (transient) close(context);
        throw error;
      } finally { clearTimeout(timer); }
    })();
    state.inFlight = request;
    void request.finally(() => { if (state.inFlight === request) state.inFlight = null; }).catch(() => undefined);
    return request;
  }
  return {
    refresh,
    require(context) {
      try {
        assertOpen(context);
        if (fresh(context)) return Promise.resolve(context);
        // Already-connected peers must stop at the deadline even if the event
        // loop has not fired their timer yet. Initial authentication may wait.
        if (connected(context)) {
          close(context); throw unavailable();
        }
        return refresh(context);
      } catch (error) { return Promise.reject(error); }
    },
    watch(connection) {
      watched.set(connection, null);
      arm(connection);
      return () => {
        clearTimeout(watched.get(connection)); watched.delete(connection);
        stateFor(connection.context).closed = true;
      };
    },
    dispose() {
      for (const [connection, timer] of watched) {
        clearTimeout(timer); stateFor(connection.context).closed = true;
      }
      watched.clear();
    },
  };
}

export const PERSISTENCE_IDLE_MS = 180;
export const PERSISTENCE_MAX_WAIT_MS = 1_000;
export const PERSISTENCE_MAX_BATCH_ENTRIES = 128;
export const PERSISTENCE_MAX_BATCH_BYTES = 760 * 1024;

export function persistenceFlushDelay({ firstAt, entries, bytes, now = Date.now() }) {
  if (entries >= PERSISTENCE_MAX_BATCH_ENTRIES || bytes >= PERSISTENCE_MAX_BATCH_BYTES)
    return 0;
  return Math.max(0, Math.min(PERSISTENCE_IDLE_MS, PERSISTENCE_MAX_WAIT_MS - (now - firstAt)));
}

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
        });
      // Keep the failure on the durable barrier. Observe it separately so a
      // timer caller cannot create an unhandled rejection or a false clean ack.
      void persistTail.catch(() => undefined);
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
