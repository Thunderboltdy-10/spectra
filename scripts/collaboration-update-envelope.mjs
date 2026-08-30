// Convex documents have a 1 MiB ceiling. Keep the same 760 KiB envelope used
// for native bootstrap/snapshot rows so rich-document structural edits fit in
// one atomic Yjs update while leaving room for row metadata.
export const MAX_DURABLE_UPDATE_BYTES = 760 * 1024;
export const MAX_REALTIME_MESSAGE_BYTES = 1024 * 1024;

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1)
    if (left[index] !== right[index]) return false;
  return true;
}

/**
 * Sync step 2 may contain a peer's complete Yjs state. The gateway has to
 * accept that bounded realtime frame for rich documents, but the durable log
 * stores only the state missing from the canonical room. A genuinely large
 * new edit remains large and is refused by the existing durable-update gate.
 */
export function canonicalDurableUpdate(Y, canonicalDocument, incomingUpdate) {
  const beforeVector = Y.encodeStateVector(canonicalDocument);
  const beforeUpdate = Y.encodeStateAsUpdate(canonicalDocument);
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, beforeUpdate);
    Y.applyUpdate(probe, incomingUpdate);
    // A Yjs deletion advances the delete set without advancing the state
    // vector. Comparing vectors alone therefore classified a real deletion as
    // a no-op and let it disappear on restart. The full update encoding is
    // deterministic for the cloned state and includes both structs and deletes.
    if (bytesEqual(beforeUpdate, Y.encodeStateAsUpdate(probe))) return null;
    const canonicalDelta = Y.encodeStateAsUpdate(probe, beforeVector);
    // Re-encoding against a state vector can expand a compact, fragmented
    // native edit dramatically (especially a rich-tree replacement with many
    // deletes). The original frame is already a valid idempotent Yjs update
    // that produces this exact probe state, so keep the smaller equivalent
    // envelope. Full sync frames still collapse to the much smaller canonical
    // delta, while compact delete-heavy edits no longer fail a size gate only
    // because re-encoding inflated them.
    return incomingUpdate.byteLength <= canonicalDelta.byteLength
      ? incomingUpdate.slice()
      : canonicalDelta;
  } finally {
    probe.destroy();
  }
}
