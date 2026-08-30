export const SHEET_CELLS_ENCODING = "spectra-sheet-cells-v1" as const;
export const SHEET_CELLS_CHUNK_SIZE = 256;

export type SheetCellEntry = [address: string, value: unknown];

export type BoundedSheetCells = {
  encoding: typeof SHEET_CELLS_ENCODING;
  chunks: SheetCellEntry[][];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function tuple(value: unknown): SheetCellEntry | null {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string"
    ? [value[0], value[1]]
    : null;
}

/**
 * Reads both the legacy address-keyed map and the bounded representation used
 * at Convex boundaries. Direct tuple arrays are accepted as an intentionally
 * small compatibility bridge for early storage experiments.
 */
export function sheetCellEntries(
  value: unknown,
  limit = Number.POSITIVE_INFINITY,
): SheetCellEntry[] {
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.floor(limit))
    : Number.POSITIVE_INFINITY;
  const result: SheetCellEntry[] = [];
  const append = (candidate: unknown) => {
    if (result.length >= boundedLimit) return;
    const entry = tuple(candidate);
    if (entry) result.push(entry);
  };

  if (Array.isArray(value)) {
    for (const candidate of value) {
      if (result.length >= boundedLimit) break;
      append(candidate);
    }
    return result;
  }

  const source = record(value);
  if (!source) return result;
  if (
    source.encoding === SHEET_CELLS_ENCODING &&
    Array.isArray(source.chunks)
  ) {
    for (const chunk of source.chunks) {
      if (!Array.isArray(chunk)) continue;
      for (const candidate of chunk) {
        if (result.length >= boundedLimit) return result;
        append(candidate);
      }
    }
    return result;
  }

  for (const entry of Object.entries(source)) {
    if (result.length >= boundedLimit) break;
    result.push(entry);
  }
  return result;
}

export function encodeSheetCellsForStorage(value: unknown): BoundedSheetCells {
  const deduplicated = new Map<string, unknown>();
  for (const [address, cell] of sheetCellEntries(value))
    deduplicated.set(address, cell);
  const entries = [...deduplicated.entries()] as SheetCellEntry[];
  const chunks: SheetCellEntry[][] = [];
  for (let index = 0; index < entries.length; index += SHEET_CELLS_CHUNK_SIZE)
    chunks.push(entries.slice(index, index + SHEET_CELLS_CHUNK_SIZE));
  return { encoding: SHEET_CELLS_ENCODING, chunks };
}

/**
 * Produces the storage/transport shape without mutating the canonical editor
 * value. Non-workbook values pass through untouched so callers can use this at
 * mixed Office and artifact boundaries.
 */
export function encodeSheetsContentForStorage(value: unknown): unknown {
  const source = record(value);
  if (!source || !Array.isArray(source.sheets)) return value;
  return {
    ...source,
    sheets: source.sheets.map((candidate) => {
      const sheet = record(candidate);
      return sheet
        ? { ...sheet, cells: encodeSheetCellsForStorage(sheet.cells) }
        : candidate;
    }),
  };
}

/**
 * Restores only the address-keyed cell maps expected by editor and projection
 * schemas. Unlike full workbook normalization, this deliberately preserves
 * whether every other sheet field was absent so storage decoding cannot create
 * native operations such as a zero-valued freeze-pane update.
 */
export function decodeSheetsContentFromStorage(value: unknown): unknown {
  const source = record(value);
  if (!source || !Array.isArray(source.sheets)) return value;
  return {
    ...source,
    sheets: source.sheets.map((candidate) => {
      const sheet = record(candidate);
      return sheet
        ? { ...sheet, cells: Object.fromEntries(sheetCellEntries(sheet.cells)) }
        : candidate;
    }),
  };
}

export function encodeArtifactContentForStorage(
  typeKey: string,
  content: unknown,
): unknown {
  return typeKey === "sheets"
    ? encodeSheetsContentForStorage(content)
    : content;
}
