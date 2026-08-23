import {
  columnIndex,
  columnName,
  coordinateToAddress,
  normalizeRange,
  parseAddress,
  rangeAddresses,
  type CellCoordinate,
  type CellRange,
  type SheetBorderEdge,
  type SheetBorders,
  type SheetCell,
  type SheetScalar,
} from "./model";

/**
 * The workbook's semantic operations, as pure functions over a cell map.
 *
 * Every one of these used to live inside the studio component: the fill handle
 * had its own copy loop, Ctrl+V had its own paste, the border buttons wrote
 * `format` objects inline. That made each verb impossible to test without a
 * grid, and impossible for the AI to reach at all. Here they are ordinary
 * functions — cells in, cells out — so the command in the workbar, the shortcut,
 * the drag gesture and an assistant call all land on the same implementation
 * (C1).
 *
 * Two rules hold throughout:
 *
 *   A formula Spectra cannot evaluate is never turned into its own result. Any
 *   operation that would overwrite such a cell reports it instead, and the
 *   caller says so in the surface (`blocked`).
 *   Work is bounded. Every function takes an explicit range and the range
 *   helpers cap themselves, so no operation can walk a 200k-cell sheet because a
 *   person dragged too far.
 */

/** What an operation changed, plus what it honestly refused to change. */
export type CellsResult = {
  cells: Record<string, SheetCell>;
  /** Addresses skipped because they hold a formula Spectra must preserve. */
  blocked: string[];
  /** How many cells the operation actually wrote. */
  written: number;
};

const REFERENCE_HEAD = /[A-Za-z0-9_$.!]/;

/** True when this cell's formula is Excel's, not one Spectra can evaluate. */
export function isPreservedFormula(cell: SheetCell | undefined) {
  return Boolean(cell?.formula) && cell?.nativeFormulaSupport === "cached-only";
}

/**
 * Shifts the relative references in a formula by a row and column offset, the
 * way a spreadsheet does when you fill or paste. `$` pins an axis, quoted text
 * is left alone, and a reference pushed off the sheet becomes `#REF!` rather
 * than silently wrapping to the other side.
 */
export function offsetFormula(
  formula: string,
  rowDelta: number,
  columnDelta: number,
): string {
  if (!formula || (rowDelta === 0 && columnDelta === 0)) return formula;
  let out = "";
  let index = 0;
  let quote: '"' | "'" | null = null;
  while (index < formula.length) {
    const char = formula[index]!;
    if (quote) {
      out += char;
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    const previous = out.at(-1);
    const rest = formula.slice(index);
    const match = /^(\$?)([A-Z]{1,3})(\$?)([1-9][0-9]*)/.exec(rest);
    if (!match || (previous && REFERENCE_HEAD.test(previous) && previous !== "!" && previous !== "$")) {
      out += char;
      index += 1;
      continue;
    }
    const [whole, columnLock, letters, rowLock, digits] = match;
    const after = formula[index + whole.length];
    if (after && /[A-Za-z0-9_(]/.test(after)) {
      out += char;
      index += 1;
      continue;
    }
    const column = columnLock ? columnIndex(letters!) : columnIndex(letters!) + columnDelta;
    const row = rowLock ? Number(digits) - 1 : Number(digits) - 1 + rowDelta;
    out += column < 0 || row < 0
      ? "#REF!"
      : `${columnLock}${columnName(column)}${rowLock}${row + 1}`;
    index += whole.length;
  }
  return out;
}

/** The border edges a preset writes, and the edges it clears. */
function presetEdges(preset: string) {
  switch (preset) {
    case "all":
      return { outline: true, inside: true };
    case "outline":
    case "thick-outline":
      return { outline: true, inside: false };
    case "inside":
      return { outline: false, inside: true };
    default:
      return { outline: false, inside: false };
  }
}

/**
 * Applies a border preset to a range. Presets are written the way a person
 * thinks — an outline, an inside grid, one edge — and resolved here into the
 * per-cell edges OOXML actually stores, so the inspector, the command and an
 * assistant call cannot disagree about what "outline" means.
 */
export function applyBorderPreset(
  cells: Record<string, SheetCell>,
  range: CellRange,
  preset: string,
  style: SheetBorderEdge["style"] = "thin",
  color?: string | null,
): CellsResult {
  const normalized = normalizeRange(range);
  const next = { ...cells };
  const edge: SheetBorderEdge = { style, ...(color ? { color } : {}) };
  const heavy: SheetBorderEdge = {
    style: preset === "thick-outline" ? "thick" : preset === "double-bottom" ? "double" : style,
    ...(color ? { color } : {}),
  };
  const { outline, inside } = presetEdges(preset);
  let written = 0;
  for (const address of rangeAddresses(normalized)) {
    const coordinate = parseAddress(address);
    if (!coordinate) continue;
    const cell = next[address] ?? {};
    const current = cell.format?.borders ?? {};
    let borders: SheetBorders | undefined;
    if (preset === "none") {
      borders = undefined;
    } else {
      const onTop = coordinate.row === normalized.start.row;
      const onBottom = coordinate.row === normalized.end.row;
      const onLeft = coordinate.column === normalized.start.column;
      const onRight = coordinate.column === normalized.end.column;
      const patch: SheetBorders = { ...current };
      if (outline || inside) {
        if (outline || !onTop) patch.top = outline && onTop ? heavy : inside ? edge : patch.top;
        if (outline || !onBottom)
          patch.bottom = outline && onBottom ? heavy : inside ? edge : patch.bottom;
        if (outline || !onLeft) patch.left = outline && onLeft ? heavy : inside ? edge : patch.left;
        if (outline || !onRight)
          patch.right = outline && onRight ? heavy : inside ? edge : patch.right;
      }
      if (preset === "top" && onTop) patch.top = edge;
      if (preset === "bottom" && onBottom) patch.bottom = edge;
      if (preset === "left" && onLeft) patch.left = edge;
      if (preset === "right" && onRight) patch.right = edge;
      if (preset === "double-bottom" && onBottom) patch.bottom = heavy;
      borders = patch;
    }
    const format = { ...cell.format, ...(borders ? { borders } : { borders: undefined }) };
    next[address] = { ...cell, format };
    written += 1;
  }
  return { cells: next, blocked: [], written };
}

/**
 * Fill down or right: the first row (or column) of the selection is repeated
 * across the rest of it, with relative references shifting as they go. A cell
 * holding a formula Spectra only preserves is never overwritten.
 */
export function fillRange(
  cells: Record<string, SheetCell>,
  range: CellRange,
  direction: "down" | "right",
): CellsResult {
  const normalized = normalizeRange(range);
  const next = { ...cells };
  const blocked: string[] = [];
  let written = 0;
  const rows = normalized.end.row - normalized.start.row + 1;
  const columns = normalized.end.column - normalized.start.column + 1;
  if (rows * columns > 200_000) return { cells, blocked, written };
  for (let row = normalized.start.row; row <= normalized.end.row; row += 1) {
    for (let column = normalized.start.column; column <= normalized.end.column; column += 1) {
      const isSeed = direction === "down"
        ? row === normalized.start.row
        : column === normalized.start.column;
      if (isSeed) continue;
      const seed: CellCoordinate = direction === "down"
        ? { row: normalized.start.row, column }
        : { row, column: normalized.start.column };
      const source = next[coordinateToAddress(seed)];
      const address = coordinateToAddress({ row, column });
      if (isPreservedFormula(next[address])) {
        blocked.push(address);
        continue;
      }
      if (!source) {
        delete next[address];
        continue;
      }
      next[address] = source.formula
        ? {
            ...source,
            formula: offsetFormula(source.formula, row - seed.row, column - seed.column),
          }
        : { ...source };
      written += 1;
    }
  }
  return { cells: next, blocked, written };
}

/** The step between the first two numbers of a series, or 1 when unknowable. */
function seriesStep(values: number[], kind: string) {
  if (values.length < 2) return kind === "growth" ? 2 : 1;
  return kind === "growth"
    ? values[0] === 0
      ? 1
      : values[1]! / values[0]!
    : values[1]! - values[0]!;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Continues a pattern across the selection: a number series, a growth series,
 * weekdays or months. Excel infers the pattern from the first two cells; so does
 * this, and when it cannot infer one it copies rather than inventing a sequence.
 */
export function fillSeries(
  cells: Record<string, SheetCell>,
  range: CellRange,
  kind: string,
): CellsResult {
  const normalized = normalizeRange(range);
  const vertical = normalized.end.row > normalized.start.row;
  const length = vertical
    ? normalized.end.row - normalized.start.row + 1
    : normalized.end.column - normalized.start.column + 1;
  if (length < 2) return { cells, blocked: [], written: 0 };
  const at = (offset: number) =>
    coordinateToAddress(
      vertical
        ? { row: normalized.start.row + offset, column: normalized.start.column }
        : { row: normalized.start.row, column: normalized.start.column + offset },
    );
  if (kind === "copy") {
    return fillRange(cells, normalized, vertical ? "down" : "right");
  }
  const next = { ...cells };
  const blocked: string[] = [];
  let written = 0;
  const seeds = [next[at(0)], next[at(1)]];
  const numericSeeds = seeds
    .map((cell) => (typeof cell?.value === "number" ? cell.value : undefined))
    .filter((value): value is number => value !== undefined);
  const textSeed = typeof seeds[0]?.value === "string" ? seeds[0].value : undefined;
  const listFor = (value: string) => {
    const day = WEEKDAYS.findIndex((entry) => entry.toLowerCase() === value.toLowerCase());
    if (kind === "weekday" && day >= 0) return { list: WEEKDAYS, start: day };
    const month = MONTHS.findIndex((entry) => entry.toLowerCase() === value.toLowerCase());
    if (kind === "month" && month >= 0) return { list: MONTHS, start: month };
    return null;
  };
  const sequence = textSeed ? listFor(textSeed) : null;
  if (!sequence && !numericSeeds.length) {
    return fillRange(cells, normalized, vertical ? "down" : "right");
  }
  const step = seriesStep(numericSeeds, kind);
  for (let offset = 1; offset < Math.min(length, 20_000); offset += 1) {
    const address = at(offset);
    if (isPreservedFormula(next[address])) {
      blocked.push(address);
      continue;
    }
    const base = next[at(0)] ?? {};
    let value: SheetScalar;
    if (sequence) {
      value = sequence.list[(sequence.start + offset) % sequence.list.length]!;
    } else if (kind === "growth") {
      value = numericSeeds[0]! * step ** offset;
    } else {
      value = numericSeeds[0]! + step * offset;
    }
    next[address] = { ...base, value, formula: undefined };
    written += 1;
  }
  return { cells: next, blocked, written };
}

export type ClipboardBlock = {
  /** The copied range, so paste knows the block's shape. */
  range: CellRange;
  cells: Record<string, SheetCell>;
};

/**
 * Paste, in the five modes a spreadsheet actually offers. "Values only" writes
 * what a formula currently works out to — a deliberate, named choice — while a
 * plain paste keeps the formula and shifts its references. Either way a target
 * cell whose formula Spectra can only preserve is left alone and reported.
 */
export function pasteBlock(
  cells: Record<string, SheetCell>,
  block: ClipboardBlock,
  target: CellCoordinate,
  mode: string,
  resolve?: (address: string) => SheetScalar | undefined,
): CellsResult {
  const source = normalizeRange(block.range);
  const next = { ...cells };
  const blocked: string[] = [];
  let written = 0;
  const rows = source.end.row - source.start.row + 1;
  const columns = source.end.column - source.start.column + 1;
  if (rows * columns > 200_000) return { cells, blocked, written };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const from = coordinateToAddress({
        row: source.start.row + row,
        column: source.start.column + column,
      });
      const to = coordinateToAddress(
        mode === "transpose"
          ? { row: target.row + column, column: target.column + row }
          : { row: target.row + row, column: target.column + column },
      );
      const copied = block.cells[from];
      if (isPreservedFormula(next[to])) {
        blocked.push(to);
        continue;
      }
      if (!copied) {
        if (mode !== "formats") delete next[to];
        continue;
      }
      const existing = next[to] ?? {};
      if (mode === "formats") {
        next[to] = { ...existing, format: copied.format };
        written += 1;
        continue;
      }
      if (mode === "values") {
        const value = copied.formula ? resolve?.(from) ?? copied.value : copied.value;
        next[to] = {
          ...existing,
          value: value ?? null,
          formula: undefined,
          nativeFormulaSupport: undefined,
        };
        written += 1;
        continue;
      }
      const rowDelta = (mode === "transpose" ? target.row + column : target.row + row) -
        (source.start.row + row);
      const columnDelta = (mode === "transpose" ? target.column + row : target.column + column) -
        (source.start.column + column);
      const formula = copied.formula
        ? offsetFormula(copied.formula, rowDelta, columnDelta)
        : undefined;
      next[to] = mode === "formulas"
        ? { ...existing, value: copied.value, ...(formula ? { formula } : { formula: undefined }) }
        : { ...copied, ...(formula ? { formula } : {}) };
      written += 1;
    }
  }
  return { cells: next, blocked, written };
}

export type SortKey = { column: number; direction: "asc" | "desc" };

/** Compares two cell values the way a sort column does: numbers, then text. */
export function compareScalars(left: SheetScalar | undefined, right: SheetScalar | undefined) {
  const a = left ?? "";
  const b = right ?? "";
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

/**
 * Multi-column sort. The keys apply in the order given and the sort is stable,
 * so "by class, then by name" keeps its second key intact — the thing a single
 * hidden sort key could never do.
 */
export function sortRows<T>(
  rows: readonly T[],
  keys: readonly SortKey[],
  valueAt: (row: T, column: number) => SheetScalar | undefined,
): T[] {
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((left, right) => {
    for (const key of keys) {
      const comparison = compareScalars(
        valueAt(left.row, key.column),
        valueAt(right.row, key.column),
      );
      if (comparison !== 0) return key.direction === "asc" ? comparison : -comparison;
    }
    return left.index - right.index;
  });
  return indexed.map((entry) => entry.row);
}

/**
 * Rows whose values repeat an earlier row across the given columns. Returned as
 * row indices so the caller can delete them in one structural pass and say how
 * many went.
 */
export function duplicateRowIndices(
  rows: readonly number[],
  columns: readonly number[],
  valueAt: (row: number, column: number) => SheetScalar | undefined,
) {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  for (const row of rows) {
    const key = columns
      .map((column) => {
        const value = valueAt(row, column);
        return value === undefined || value === null ? "" : String(value);
      })
      .join(" ");
    if (seen.has(key)) duplicates.push(row);
    else seen.add(key);
  }
  return duplicates;
}

/** Splits one column of text into several, at the first delimiter that fits. */
export function splitColumn(
  values: readonly string[],
  delimiter?: string,
): { rows: string[][]; delimiter: string } {
  const candidates = delimiter ? [delimiter] : ["\t", ",", ";", "|"];
  const chosen =
    candidates.find((candidate) => values.some((value) => value.includes(candidate))) ??
    candidates[0]!;
  return {
    delimiter: chosen,
    rows: values.map((value) => value.split(chosen).map((part) => part.trim())),
  };
}

/**
 * Find and replace across a set of cells. Formula text is only rewritten when
 * Spectra can evaluate that formula; a cached-only formula keeps every character
 * Excel wrote and is reported back instead.
 */
export function replaceInCells(
  cells: Record<string, SheetCell>,
  addresses: readonly string[],
  query: string,
  replacement: string,
  options: { matchCase?: boolean; wholeCell?: boolean } = {},
): CellsResult {
  if (!query) return { cells, blocked: [], written: 0 };
  const next = { ...cells };
  const blocked: string[] = [];
  let written = 0;
  const needle = options.matchCase ? query : query.toLowerCase();
  const hit = (text: string) => {
    const haystack = options.matchCase ? text : text.toLowerCase();
    return options.wholeCell ? haystack === needle : haystack.includes(needle);
  };
  const swap = (text: string) => {
    if (options.wholeCell) return replacement;
    if (options.matchCase) return text.split(query).join(replacement);
    // Case-insensitive replace without a regex, so a query with `(` or `*` in it
    // is treated as the literal text a person typed.
    let out = "";
    let index = 0;
    const lower = text.toLowerCase();
    while (index < text.length) {
      const found = lower.indexOf(needle, index);
      if (found < 0) {
        out += text.slice(index);
        break;
      }
      out += text.slice(index, found) + replacement;
      index = found + needle.length;
    }
    return out;
  };
  for (const address of addresses.slice(0, 200_000)) {
    const cell = next[address];
    if (!cell) continue;
    if (cell.formula) {
      if (!hit(cell.formula)) continue;
      if (isPreservedFormula(cell)) {
        blocked.push(address);
        continue;
      }
      next[address] = { ...cell, formula: swap(cell.formula) };
      written += 1;
      continue;
    }
    if (typeof cell.value !== "string" || !hit(cell.value)) continue;
    next[address] = { ...cell, value: swap(cell.value) };
    written += 1;
  }
  return { cells: next, blocked, written };
}
