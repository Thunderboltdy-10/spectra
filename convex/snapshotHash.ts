import { fitsConvexNesting } from "../shared/convex-nesting.mjs";

/** Pure canonical snapshot hashing. Kept free of Convex function wrappers so
 * authority and placement helpers can hash without joining the snapshot
 * module's mutation import graph (which previously formed a load-time cycle). */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

/** A snapshot too deep to be a Convex value is stored as its JSON text. */
type StoredSnapshotPayload = { spectraSnapshotJson: string };

function isStoredSnapshotJson(value: unknown): value is StoredSnapshotPayload {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 1 && typeof (value as StoredSnapshotPayload).spectraSnapshotJson === "string");
}

/** The stored form of a snapshot payload: inline unless it would exceed Convex's nesting limit. */
export function encodeSnapshotPayload(payload: unknown): unknown {
  return fitsConvexNesting({ payload }) ? payload : { spectraSnapshotJson: JSON.stringify(payload) };
}

/** The snapshot a stored payload holds. Hashes always cover this decoded value. */
export function decodeSnapshotPayload(stored: unknown): unknown {
  return isStoredSnapshotJson(stored) ? JSON.parse(stored.spectraSnapshotJson) : stored;
}

export function canonicalSnapshotJson(value: unknown) {
  return JSON.stringify(canonical(value));
}

export async function snapshotHash(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalSnapshotJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return { hash: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""), byteLength: bytes.byteLength };
}
