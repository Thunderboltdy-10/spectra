/**
 * The words a person sees in one part of a work (paragraph or slide text,
 * cell values, a title), read from a region value. Never ids, region markers,
 * layout numbers or JSON: those are internals, not what the student wrote.
 */
const EXCERPT_CHARS = 1_200;
const TEXT_KEYS = new Set([
  "text", "title", "subtitle", "heading", "value", "formula", "label", "name", "question", "answer",
  "prompt", "front", "back", "caption", "notes", "body", "content", "description", "summary",
  "explanation", "hint", "alt", "items", "options", "choices", "source", "tags",
]);
const IDENTIFIER = /^[a-z0-9_-]{16,}$/i;

function leaves(value: unknown, textual: boolean, out: string[], budget: { left: number }) {
  if (budget.left <= 0) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (textual && text && !IDENTIFIER.test(text)) {
      out.push(text.slice(0, budget.left));
      budget.left -= text.length;
    }
  } else if (typeof value === "number" || typeof value === "boolean") {
    if (textual) {
      out.push(String(value));
      budget.left -= String(value).length;
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) leaves(entry, textual, out, budget);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      // `$spectraRegion` markers name a child region; they are not content.
      if (key.startsWith("$") || key === "id" || key.endsWith("Id") || key.endsWith("Ids")) continue;
      leaves(entry, TEXT_KEYS.has(key), out, budget);
    }
  }
}

/** A bounded region snapshot stores an oversized value as a JSON prefix.
 * Read only the text fields' values, never keys, ids or punctuation. The last
 * value may be cut off by the prefix; its readable part is kept. */
function truncatedPreviewText(preview: string) {
  const values: string[] = [];
  for (const match of preview.matchAll(/"([^"\\]*)"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|\\?$)/g)) {
    if (!TEXT_KEYS.has(match[1]!)) continue;
    try {
      values.push(JSON.parse(`"${match[2]}"`) as string);
    } catch {
      // Malformed escapes are skipped rather than shown raw.
    }
  }
  return values;
}

export function readableRegionText(value: unknown, options: { truncated?: boolean; limit?: number } = {}) {
  const limit = options.limit ?? EXCERPT_CHARS;
  const out: string[] = [];
  const preview = options.truncated && value && typeof value === "object"
    ? (value as { preview?: unknown }).preview : undefined;
  if (typeof preview === "string") leaves(truncatedPreviewText(preview), true, out, { left: limit });
  else leaves(value, true, out, { left: limit });
  const text = out.join(" ").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

type SnapshotRegion = { regionId: string; label: string; value: unknown; truncated?: boolean };

function snapshotRegions(snapshot: unknown): SnapshotRegion[] {
  const regions = snapshot && typeof snapshot === "object"
    ? (snapshot as { regions?: unknown }).regions : undefined;
  return Array.isArray(regions)
    ? regions.filter((region): region is SnapshotRegion =>
      Boolean(region) && typeof region === "object" && typeof (region as SnapshotRegion).regionId === "string")
    : [];
}

export type ConflictRegionComparison = {
  regionId: string;
  label: string;
  before?: string;
  saved?: string;
  proposed?: string;
};

/** One row per changed part: what it was when Spectra started, what is saved
 * now, and what Spectra wants to write. A side without a snapshot is absent. */
export function compareConflictRegions(snapshots: { before?: unknown; saved?: unknown; proposed?: unknown }, limit = 6) {
  const sides = {
    before: snapshotRegions(snapshots.before),
    saved: snapshotRegions(snapshots.saved),
    proposed: snapshotRegions(snapshots.proposed),
  };
  const order = [...new Set([...sides.proposed, ...sides.saved, ...sides.before].map((region) => region.regionId))];
  return order.slice(0, limit).map((regionId): ConflictRegionComparison => {
    const row: ConflictRegionComparison = { regionId, label: "" };
    for (const side of ["before", "saved", "proposed"] as const) {
      const region = sides[side].find((candidate) => candidate.regionId === regionId);
      if (!region) continue;
      row[side] = readableRegionText(region.value, { truncated: region.truncated });
      if (!row.label && region.label && region.label !== regionId) row.label = region.label;
    }
    row.label ||= "Changed part";
    return row;
  });
}
