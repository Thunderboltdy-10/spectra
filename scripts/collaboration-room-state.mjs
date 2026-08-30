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
