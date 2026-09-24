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
export const MAX_COMPACTION_STATE_VECTOR_BYTES = 128 * 1024;
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

/**
 * Sync step 2 may contain a peer's complete Yjs state. The gateway has to
 * accept that bounded realtime frame for rich documents, but the durable log
 * stores only the state missing from the canonical room. A genuinely large
 * new edit remains large and is refused by the existing durable-update gate.
 */
export function canonicalDurableUpdate(Y, canonicalDocument, incomingUpdate) {
  // Work on the incoming update, not a clone/serialization of the entire room.
  // diffUpdate retains unresolved causal structs and the incoming delete set;
  // both must remain durable even when they have no visible effect yet.
  const delta = Y.diffUpdate(incomingUpdate, Y.encodeStateVector(canonicalDocument));
  const decoded = Y.decodeUpdate(delta);
  if (decoded.structs.length > 0) return delta;

  // A delete does not advance the state vector. Check only its referenced
  // ranges, including gaps of live structs; matching range endpoints alone
  // would incorrectly discard a partially applied clear.
  for (const [client, ranges] of decoded.ds.clients) {
    const structs = canonicalDocument.store.clients.get(client);
    const knownClock = structs?.length
      ? structs[structs.length - 1].id.clock + structs[structs.length - 1].length
      : 0;
    for (const range of ranges) {
      const end = range.clock + range.len;
      if (!structs?.length || end > knownClock) return delta;
      let index = Y.findIndexSS(structs, range.clock);
      while (index < structs.length && structs[index].id.clock < end) {
        if (!structs[index].deleted) return delta;
        index += 1;
      }
    }
  }
  return null;
}
