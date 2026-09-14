// Convex documents have a 1 MiB ceiling. Keep the same 760 KiB envelope used
// for native bootstrap/snapshot rows so rich-document structural edits fit in
// one atomic Yjs update while leaving room for row metadata.
export const MAX_DURABLE_UPDATE_BYTES = 760 * 1024;
export const MAX_REALTIME_MESSAGE_BYTES = 1024 * 1024;
// Projection JSON is gated by both JS string length (legacy callers) and UTF-8
// bytes. Multibyte text can pass a 900k character check and still exceed the
// Convex document ceiling; fail closed on either bound.
export const MAX_PROJECTION_JSON_CHARS = 900_000;
export const MAX_PROJECTION_JSON_UTF8_BYTES = 900_000;
export const DURABLE_FAILURE_USER_MESSAGE =
  "This edit could not be accepted. Spectra is reloading the latest permitted version while keeping the local draft available for review.";
export const DURABLE_REJECT_CLOSE_CODE = 4409;

export function utf8ByteLength(value) {
  if (typeof value !== "string") return 0;
  if (typeof Buffer !== "undefined") return Buffer.byteLength(value, "utf8");
  return new TextEncoder().encode(value).byteLength;
}

export function projectionExceedsDurableBound(projectionJson) {
  if (typeof projectionJson !== "string") return true;
  if (projectionJson.length > MAX_PROJECTION_JSON_CHARS) return true;
  return utf8ByteLength(projectionJson) > MAX_PROJECTION_JSON_UTF8_BYTES;
}

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
