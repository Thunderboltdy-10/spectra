export const COMPACTION_UNCOMPACTED_BYTES = 256 * 1024;
export const COMPACTION_UPDATE_COUNT = 200;
export const COMPACTION_IDLE_MS = 60_000;

/**
 * @param {{
 *   uncompactedBytes?: number,
 *   updateCount?: number,
 *   lastSnapshotAt?: number | null,
 *   now?: number,
 * }} options
 */
export function shouldCompactRoom({
  uncompactedBytes = 0,
  updateCount = 0,
  lastSnapshotAt = null,
  now = Date.now(),
} = {}) {
  if (uncompactedBytes >= COMPACTION_UNCOMPACTED_BYTES) return true;
  if (updateCount >= COMPACTION_UPDATE_COUNT) return true;
  if (lastSnapshotAt == null && updateCount > 0) return true;
  if (
    lastSnapshotAt != null &&
    now - lastSnapshotAt >= COMPACTION_IDLE_MS &&
    uncompactedBytes > 0
  )
    return true;
  return false;
}

const ROOM_LOAD_CACHE_ROOMS = 32;
const ROOM_LOAD_MAX_BYTES = 8 * 1024 * 1024;
const ROOM_LOAD_TTL_MS = 30 * 60_000;

function roomLoadBytes(stored) {
  const size = (entry) => entry?.update?.byteLength ?? entry?.update?.length ?? 0;
  return size(stored?.snapshot) + (stored?.updates ?? []).reduce((total, entry) => total + size(entry), 0);
}

/** Recently read rooms, so reopening one costs the updates since, not the whole document. */
export function createRoomLoadCache({ now = Date.now } = {}) {
  const rooms = new Map();
  const keyOf = (artifactId, partitionKey) => `${artifactId}\u0000${partitionKey}`;
  return {
    get(artifactId, partitionKey, policyVersion) {
      const key = keyOf(artifactId, partitionKey);
      const entry = rooms.get(key);
      if (!entry) return null;
      if (entry.policyVersion !== policyVersion) {
        rooms.delete(key);
        return null;
      }
      if (now() - entry.at > ROOM_LOAD_TTL_MS) {
        rooms.delete(key);
        return null;
      }
      return entry.stored;
    },
    put(artifactId, partitionKey, policyVersion, stored) {
      const key = keyOf(artifactId, partitionKey);
      rooms.delete(key);
      // A room with more to page through is read whole each time, as it always was.
      if (!stored?.roomId || stored.nextSequence <= 1 || stored.hasMore || stored.initialProjection || roomLoadBytes(stored) > ROOM_LOAD_MAX_BYTES) return stored;
      rooms.set(key, { stored, policyVersion, at: now() });
      while (rooms.size > ROOM_LOAD_CACHE_ROOMS) rooms.delete(rooms.keys().next().value);
      return stored;
    },
    forget(artifactId, partitionKey) {
      rooms.delete(keyOf(artifactId, partitionKey));
    },
  };
}

/** The earlier read plus what came after it, or null when they aren't the same room any more. */
export function mergeRoomLoad(known, delta) {
  if (!delta?.roomId || delta.roomId !== known.roomId || delta.schemaVersion !== known.schemaVersion) return null;
  if (delta.hasMore || delta.initialProjection || delta.nextSequence < known.nextSequence) return null;
  // A reset room restarts its sequence and drops its snapshot time.
  if ((known.lastSnapshotAt ?? 0) > (delta.lastSnapshotAt ?? 0)) return null;
  const expected = known.nextSequence - 1;
  const first = delta.updates?.[0]?.sequence;
  if (first !== undefined && first !== expected + 1) return null;
  return { ...delta, snapshot: known.snapshot, updates: [...(known.updates ?? []), ...(delta.updates ?? [])] };
}

export function storedRoomUpdates(stored) {
  const updates = [];
  if (stored?.snapshot?.update)
    updates.push({ source: "snapshot", update: stored.snapshot.update });
  for (const entry of stored?.updates ?? [])
    updates.push({ source: "log", update: entry.update });
  return updates;
}

export function applyStoredRoomUpdates(Y, stored) {
  const encoded = storedRoomUpdates(stored).map((entry) =>
    typeof entry.update === "string"
      ? Uint8Array.from(Buffer.from(entry.update, "base64"))
      : entry.update,
  );
  const document = new Y.Doc();
  if (encoded.length > 0) Y.applyUpdate(document, Y.mergeUpdates(encoded));
  return document;
}

export function encodeStoredRoomSnapshot(Y, stored) {
  const document = applyStoredRoomUpdates(Y, stored);
  try {
    return {
      update: Y.encodeStateAsUpdate(document),
      stateVector: Y.encodeStateVector(document),
    };
  } finally {
    document.destroy();
  }
}

/**
 * Native recover resets a bootstrap-only room whose Yjs clocks diverged.
 * Unprojected human/AI updates (nextSequence advanced, no checkpoint yet)
 * are the durable log and the restart source. Calling recover there throws
 * COLLABORATION_DURABLE_RECOVERY_STALE because the live Y.Doc no longer
 * matches artifact.content.
 *
 * @param {{
 *   liveStateVectorHash?: string | null,
 *   observedStateVectorHash?: string | null,
 * }} options
 */
export function shouldRecoverNativeRoom({
  liveStateVectorHash = null,
  observedStateVectorHash = null,
} = {}) {
  if (!liveStateVectorHash) return false;
  return observedStateVectorHash !== liveStateVectorHash;
}

/**
 * A native room can have a replayed Y.Doc whose state vector already equals
 * the durable append head while its artifact projection checkpoint still
 * points at an earlier sequence. State-vector equality alone is therefore
 * not a proof that native projections are current.
 *
 * @param {{
 *   durableHeadSequence?: number,
 *   lastProjectionSequence?: number | null,
 * }} options
 */
export function shouldRepairNativeProjection({
  durableHeadSequence = 0,
  lastProjectionSequence = null,
} = {}) {
  if (!Number.isSafeInteger(durableHeadSequence) || durableHeadSequence <= 0)
    return false;
  const projectedSequence = lastProjectionSequence ?? 0;
  if (!Number.isSafeInteger(projectedSequence) || projectedSequence < 0)
    return false;
  return projectedSequence < durableHeadSequence;
}

