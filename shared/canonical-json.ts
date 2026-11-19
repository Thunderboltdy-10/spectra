/** Locale-independent object key order for semantic comparisons and hashes.
 * Array order and every field value remain authoritative. */
export function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
  );
}

/** Canonical form for "does this mean the same thing" checks: key order is
 * ignored and so are absent-valued fields (`undefined` or `null`), which
 * stores, Yjs and native readers write inconsistently. Arrays keep order. */
export function canonicalSemanticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSemanticValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined && entry !== null)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonicalSemanticValue(entry)]),
  );
}

export function semanticallyEqual(left: unknown, right: unknown) {
  return left === right ||
    JSON.stringify(canonicalSemanticValue(left)) === JSON.stringify(canonicalSemanticValue(right));
}
