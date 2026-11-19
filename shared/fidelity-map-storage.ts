/**
 * The form a lens fidelity map is stored in. A lens lists every paragraph,
 * table and slide it opened, mostly to say "Spectra writes this natively";
 * a stored map only has to remember what restricts editing, because a region
 * no entry names is editable. Dropping the plain NATIVE rows keeps every
 * refusal and every read-only paragraph while taking a long essay's map from
 * ~115 KB to a few KB, and replica rows are read on every Bridge pass.
 *
 * Kept: anything not NATIVE, anything read-only, and `docx:region:*` rows,
 * which declare a region (and so decide how `docx:feature:*` rows count).
 */

export const STORED_FIDELITY_BUDGET_BYTES = 80_000;

type Entry = Record<string, unknown>;

function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restricts(entry: Entry) {
  if (entry.class !== "NATIVE") return true;
  if (entry.readOnly === true) return true;
  return typeof entry.regionId === "string" && entry.regionId.startsWith("docx:region:");
}

const SEVERITY: Record<string, number> = { PRESERVED: 0, EQUIVALENT: 1, EXTENSION: 2, NATIVE: 3 };

/** A fidelity map as it should be stored: only the rows that restrict editing, within budget. */
export function storedFidelityMap(map: unknown): unknown {
  if (!isEntry(map) || !Array.isArray(map.entries)) return map;
  if (map.truncated === true) return map;
  const kept = map.entries.filter((entry): entry is Entry => isEntry(entry) && restricts(entry));
  const compact = { ...map, entries: kept, implicitNative: true };
  if (JSON.stringify(compact).length <= STORED_FIDELITY_BUDGET_BYTES) return compact;
  // Still too large: keep the most restrictive rows first, then stop.
  const ordered = [...kept].sort((left, right) =>
    (SEVERITY[String(left.class)] ?? 4) - (SEVERITY[String(right.class)] ?? 4));
  const entries: Entry[] = [];
  let bytes = JSON.stringify({ ...map, entries: [], implicitNative: true, truncated: true }).length;
  for (const entry of ordered) {
    const size = JSON.stringify(entry).length + 1;
    if (bytes + size > STORED_FIDELITY_BUDGET_BYTES) break;
    entries.push(entry);
    bytes += size;
  }
  return { ...map, entries, implicitNative: true, truncated: true };
}
