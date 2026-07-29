/**
 * Sheets contentPatch helpers: canonicalize A1 cell paths, coerce scalar cell
 * writes, and merge `/sheets/N/cells` maps so column appends do not wipe the
 * rest of the workbook.
 */

type ContentPatchChange = { path: string; value: unknown };

const CELL_ADDRESS = /^[A-Za-z]+[1-9][0-9]*$/;
const SHEETS_CELL_PATH =
  /^(\/(?:content\/)?sheets\/\d+\/cells\/)([A-Za-z]+[1-9][0-9]*)(.*)$/;
const SHEETS_CELLS_MAP_PATH = /^\/(?:content\/)?sheets\/\d+\/cells$/;

export function isSheetsCellsMapPath(path: string) {
  return SHEETS_CELLS_MAP_PATH.test(path);
}

export function isSheetsCellPath(path: string) {
  return SHEETS_CELL_PATH.test(path);
}

export function isDirectSheetsCellPath(path: string) {
  const match = path.match(SHEETS_CELL_PATH);
  return Boolean(match && match[3] === "");
}

/** Uppercase the A1 address segment in `/sheets/N/cells/d2` → `.../D2`. */
export function canonicalizeSheetsPatchPath(path: string): string {
  const match = path.match(SHEETS_CELL_PATH);
  if (!match) return path;
  const [, prefix = "", address = "", rest = ""] = match;
  return `${prefix}${address.toUpperCase()}${rest}`;
}

/**
 * Coerce a model cell write into a SheetCell-shaped object.
 * Strings starting with `=` become formulas; other scalars become values.
 */
export function coerceSheetCellPatchValue(value: unknown): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean")
    return { value };
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("=")) return { formula: trimmed };
    return { value };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = { ...(value as Record<string, unknown>) };
  // Nested legacy shapes: { input: "x" } / { text: "x" } / bare formula string.
  if (
    row.value === undefined &&
    row.formula === undefined &&
    typeof row.input === "string"
  ) {
    const input = row.input.trim();
    if (input.startsWith("=")) row.formula = input;
    else row.value = row.input;
    delete row.input;
  }
  if (
    row.value === undefined &&
    row.formula === undefined &&
    typeof row.text === "string"
  ) {
    row.value = row.text;
    delete row.text;
  }
  return row;
}

function canonicalizeCellsMapValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([address, cell]) => [
      CELL_ADDRESS.test(address) ? address.toUpperCase() : address,
      coerceSheetCellPatchValue(cell),
    ]),
  );
}

/** Normalize a single change so apply + verify share the same authored shape. */
export function canonicalizeSheetsPatchChange(
  change: ContentPatchChange,
): ContentPatchChange {
  const path = canonicalizeSheetsPatchPath(change.path);
  if (isDirectSheetsCellPath(path))
    return { path, value: coerceSheetCellPatchValue(change.value) };
  if (isSheetsCellsMapPath(path))
    return { path, value: canonicalizeCellsMapValue(change.value) };
  return { ...change, path };
}

export function mergeSheetCellsMaps(
  existing: unknown,
  patch: unknown,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const incoming =
    patch && typeof patch === "object" && !Array.isArray(patch)
      ? (patch as Record<string, unknown>)
      : {};
  for (const [address, cell] of Object.entries(incoming)) {
    const key = CELL_ADDRESS.test(address) ? address.toUpperCase() : address;
    base[key] = structuredClone(coerceSheetCellPatchValue(cell));
  }
  return base;
}
