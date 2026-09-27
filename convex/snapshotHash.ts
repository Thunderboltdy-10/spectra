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

export function canonicalSnapshotJson(value: unknown) {
  return JSON.stringify(canonical(value));
}

export async function snapshotHash(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalSnapshotJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return { hash: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""), byteLength: bytes.byteLength };
}
