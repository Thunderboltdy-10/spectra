import { columnIndex, columnName, parseAddress, type CellCoordinate } from "./model";
import { EXCEL_MAX_COL, EXCEL_MAX_ROW } from "./excel-serial";

/**
 * One formula-reference walker. Sort, fill, paste, insert/delete, and sheet
 * rename all used to have their own rewriter; three of them were wrong.
 * Everything that moves or renames a reference goes through here.
 */

const REFERENCE_HEAD = /[A-Za-z0-9_$.!]/;

export type FormulaRefHit = {
  sheet: string | null;
  /** Whether this endpoint carried its own worksheet prefix in the source. */
  sheetExplicit?: boolean;
  /** Start column letters, empty for a whole-row ref. */
  letters: string;
  columnLock: string;
  /** Start row digits, empty for a whole-column ref. */
  digits: string;
  rowLock: string;
  endLetters: string;
  endColumnLock: string;
  endDigits: string;
  endRowLock: string;
  wholeColumn: boolean;
  wholeRow: boolean;
};

function scanQuoted(formula: string, start: number, quote: '"' | "'") {
  let index = start + 1;
  while (index < formula.length) {
    if (quote === "'" && formula[index] === "'" && formula[index + 1] === "'") {
      index += 2;
      continue;
    }
    if (formula[index] === quote) return index + 1;
    index += 1;
  }
  return formula.length;
}

function readSheetPrefix(
  formula: string,
  index: number,
): { name: string; next: number } | null {
  if (formula[index] === "'") {
    let cursor = index + 1;
    let name = "";
    while (cursor < formula.length) {
      if (formula[cursor] === "'" && formula[cursor + 1] === "'") {
        name += "'";
        cursor += 2;
        continue;
      }
      if (formula[cursor] === "'") {
        if (formula[cursor + 1] !== "!") return null;
        return { name, next: cursor + 2 };
      }
      name += formula[cursor];
      cursor += 1;
    }
    return null;
  }
  const match = /^([A-Za-z_][A-Za-z0-9_.]*)!/.exec(formula.slice(index));
  return match ? { name: match[1]!, next: index + match[0].length } : null;
}

function looksLikeRefHead(previous: string | undefined) {
  return Boolean(
    previous && REFERENCE_HEAD.test(previous) && previous !== "!" && previous !== "$",
  );
}

export function quoteSheetPrefix(name: string) {
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !parseAddress(name))
    return `${name}!`;
  return `'${name.replaceAll("'", "''")}'!`;
}

function renderHit(hit: FormulaRefHit, sheet = hit.sheet) {
  const explicit = hit.sheetExplicit ?? (hit.sheet != null);
  const prefix = explicit && sheet != null && sheet !== "" ? quoteSheetPrefix(sheet) : "";
  if (hit.wholeColumn)
    return `${prefix}${hit.columnLock}${hit.letters}:${hit.endColumnLock}${hit.endLetters}`;
  if (hit.wholeRow)
    return `${prefix}${hit.rowLock}${hit.digits}:${hit.endRowLock}${hit.endDigits}`;
  return `${prefix}${hit.columnLock}${hit.letters}${hit.rowLock}${hit.digits}`;
}

/**
 * Walks formula text, skipping quoted strings, and rewrites every A1-style
 * reference (cells, whole columns, whole rows, optional sheet prefix).
 */
export function mapFormulaReferences(
  formula: string,
  mapper: (hit: FormulaRefHit) => string,
): string {
  if (!formula) return formula;
  let out = "";
  let index = 0;
  // An A1 range writes its worksheet prefix only once (`Sheet1!A1:B5`).
  // Carry that prefix across the second endpoint so structural rewrites do
  // not shift the first endpoint and silently leave the other one stale.
  let rangeSheet: string | null = null;
  while (index < formula.length) {
    const char = formula[index]!;
    if (char === '"') {
      const end = scanQuoted(formula, index, '"');
      out += formula.slice(index, end);
      index = end;
      continue;
    }
    const previous = out.at(-1);
    if (looksLikeRefHead(previous)) {
      out += char;
      index += 1;
      continue;
    }
    const sheet = readSheetPrefix(formula, index);
    const effectiveSheet: string | null = sheet?.name ?? (rangeSheet && formula[index - 1] === ":" ? rangeSheet : null);
    const refAt = sheet ? sheet.next : index;
    const rest = formula.slice(refAt);

    const colRange = /^(\$?)([A-Z]{1,3}):(\$?)([A-Z]{1,3})(?![A-Z0-9_(])/.exec(rest);
    if (colRange) {
      out += mapper({
        sheet: effectiveSheet,
        sheetExplicit: Boolean(sheet),
        letters: colRange[2]!,
        columnLock: colRange[1]!,
        digits: "",
        rowLock: "",
        endLetters: colRange[4]!,
        endColumnLock: colRange[3]!,
        endDigits: "",
        endRowLock: "",
        wholeColumn: true,
        wholeRow: false,
      });
      index = refAt + colRange[0].length;
      rangeSheet = null;
      continue;
    }

    const rowRange = /^(\$?)([1-9][0-9]*):(\$?)([1-9][0-9]*)(?![0-9A-Z_(])/.exec(rest);
    if (rowRange) {
      out += mapper({
        sheet: effectiveSheet,
        sheetExplicit: Boolean(sheet),
        letters: "",
        columnLock: "",
        digits: rowRange[2]!,
        rowLock: rowRange[1]!,
        endLetters: "",
        endColumnLock: "",
        endDigits: rowRange[4]!,
        endRowLock: rowRange[3]!,
        wholeColumn: false,
        wholeRow: true,
      });
      index = refAt + rowRange[0].length;
      rangeSheet = null;
      continue;
    }

    const cell = /^(\$?)([A-Z]{1,3})(\$?)([1-9][0-9]*)/.exec(rest);
    if (cell) {
      const after = formula[refAt + cell[0].length];
      if (after && /[A-Za-z0-9_(]/.test(after)) {
        out += char;
        index += 1;
        continue;
      }
      out += mapper({
        sheet: effectiveSheet,
        sheetExplicit: Boolean(sheet),
        letters: cell[2]!,
        columnLock: cell[1]!,
        digits: cell[4]!,
        rowLock: cell[3]!,
        endLetters: cell[2]!,
        endColumnLock: cell[1]!,
        endDigits: cell[4]!,
        endRowLock: cell[3]!,
        wholeColumn: false,
        wholeRow: false,
      });
      index = refAt + cell[0].length;
      rangeSheet = formula[index] === ":" ? (effectiveSheet ?? null) : null;
      continue;
    }

    out += char;
    index += 1;
  }
  return out;
}

function shiftColumn(letters: string, lock: string, delta: number) {
  if (lock) return { letters, ok: true };
  const next = columnIndex(letters) + delta;
  if (next < 0 || next >= EXCEL_MAX_COL) return { letters: "", ok: false };
  return { letters: columnName(next), ok: true };
}

function shiftRow(digits: string, lock: string, delta: number) {
  if (lock) return { digits, ok: true };
  const next = Number(digits) - 1 + delta;
  if (next < 0 || next >= EXCEL_MAX_ROW) return { digits: "", ok: false };
  return { digits: String(next + 1), ok: true };
}

/**
 * Shifts relative references by a row/column delta (fill, paste, sort).
 * `$` pins an axis; quoted text is left alone; off-sheet becomes `#REF!`.
 */
export function offsetFormula(
  formula: string,
  rowDelta: number,
  columnDelta: number,
): string {
  if (!formula || (rowDelta === 0 && columnDelta === 0)) return formula;
  return mapFormulaReferences(formula, (hit) => {
    if (hit.wholeColumn) {
      const start = shiftColumn(hit.letters, hit.columnLock, columnDelta);
      const end = shiftColumn(hit.endLetters, hit.endColumnLock, columnDelta);
      if (!start.ok || !end.ok) return "#REF!";
      return renderHit({ ...hit, letters: start.letters, endLetters: end.letters });
    }
    if (hit.wholeRow) {
      const start = shiftRow(hit.digits, hit.rowLock, rowDelta);
      const end = shiftRow(hit.endDigits, hit.endRowLock, rowDelta);
      if (!start.ok || !end.ok) return "#REF!";
      return renderHit({ ...hit, digits: start.digits, endDigits: end.digits });
    }
    const column = shiftColumn(hit.letters, hit.columnLock, columnDelta);
    const row = shiftRow(hit.digits, hit.rowLock, rowDelta);
    if (!column.ok || !row.ok) return "#REF!";
    return renderHit({ ...hit, letters: column.letters, digits: row.digits });
  });
}

export function sheetNamesEqual(left: string, right: string) {
  return (
    left.replace(/^'|'$/g, "").toUpperCase() ===
    right.replace(/^'|'$/g, "").toUpperCase()
  );
}

function axisIndex(hit: FormulaRefHit, axis: "row" | "column", which: "start" | "end") {
  if (axis === "column") {
    if (hit.wholeRow) return which === "start" ? 0 : EXCEL_MAX_COL - 1;
    const letters = which === "start" ? hit.letters : hit.endLetters;
    return columnIndex(letters);
  }
  if (hit.wholeColumn) return which === "start" ? 0 : EXCEL_MAX_ROW - 1;
  const digits = which === "start" ? hit.digits : hit.endDigits;
  return Number(digits) - 1;
}

function shiftAxisValue(value: number, at: number, delta: 1 | -1): number | "ref" {
  if (delta === -1 && value === at) return "ref";
  if (value < at) return value;
  return value + delta;
}

/**
 * Insert or delete a row/column: references at or after `at` shift by `delta`.
 * A reference that pointed at the deleted line becomes `#REF!`.
 * When `sheetName` is set, only refs that name that sheet (or unqualified
 * refs when `unqualified` is true) move.
 */
export function rewriteStructuralReferences(
  formula: string,
  axis: "row" | "column",
  at: number,
  delta: 1 | -1,
  options: { sheetName?: string; unqualified?: boolean } = {},
) {
  const { sheetName, unqualified = true } = options;
  return mapFormulaReferences(formula, (hit) => {
    const applies =
      hit.sheet == null
        ? unqualified
        : sheetName
          ? sheetNamesEqual(hit.sheet, sheetName)
          : true;
    if (!applies) return renderHit(hit);
    if (hit.wholeColumn && axis === "row") return renderHit(hit);
    if (hit.wholeRow && axis === "column") return renderHit(hit);
    const start = shiftAxisValue(axisIndex(hit, axis, "start"), at, delta);
    const end = shiftAxisValue(axisIndex(hit, axis, "end"), at, delta);
    if (start === "ref" && end === "ref") return "#REF!";
    const nextStart = start === "ref" ? at : start;
    const nextEnd = end === "ref" ? at : end;
    if (hit.wholeColumn) {
      return renderHit({
        ...hit,
        letters: columnName(nextStart),
        endLetters: columnName(nextEnd),
      });
    }
    if (hit.wholeRow) {
      return renderHit({
        ...hit,
        digits: String(nextStart + 1),
        endDigits: String(nextEnd + 1),
      });
    }
    if (axis === "column") {
      return renderHit({
        ...hit,
        letters: columnName(nextStart),
        endLetters: columnName(nextStart),
      });
    }
    return renderHit({
      ...hit,
      digits: String(nextStart + 1),
      endDigits: String(nextStart + 1),
    });
  });
}

export function rewriteSheetNameInFormula(
  formula: string,
  oldName: string,
  newName: string,
) {
  if (!formula || sheetNamesEqual(oldName, newName)) return formula;
  return mapFormulaReferences(formula, (hit) => {
    if (hit.sheet == null || !sheetNamesEqual(hit.sheet, oldName))
      return renderHit(hit);
    return renderHit(hit, newName);
  });
}

export type CollectedRef = {
  sheet: string | null;
  start: CellCoordinate;
  end: CellCoordinate;
};

export function collectFormulaReferences(formula: string): CollectedRef[] {
  const refs: CollectedRef[] = [];
  mapFormulaReferences(formula, (hit) => {
    if (hit.wholeColumn) {
      const start = columnIndex(hit.letters);
      const end = columnIndex(hit.endLetters);
      refs.push({
        sheet: hit.sheet,
        start: { row: 0, column: Math.min(start, end) },
        end: { row: EXCEL_MAX_ROW - 1, column: Math.max(start, end) },
      });
    } else if (hit.wholeRow) {
      const start = Number(hit.digits) - 1;
      const end = Number(hit.endDigits) - 1;
      refs.push({
        sheet: hit.sheet,
        start: { row: Math.min(start, end), column: 0 },
        end: { row: Math.max(start, end), column: EXCEL_MAX_COL - 1 },
      });
    } else {
      const coord = parseAddress(`${hit.letters}${hit.digits}`);
      if (coord) refs.push({ sheet: hit.sheet, start: coord, end: coord });
    }
    return renderHit(hit);
  });
  return refs;
}

export function refTouchesAddress(
  ref: CollectedRef,
  address: string,
  formulaSheet: string,
  addressSheet: string,
) {
  const refSheet = ref.sheet ?? formulaSheet;
  if (!sheetNamesEqual(refSheet, addressSheet)) return false;
  const coord = parseAddress(address);
  if (!coord) return false;
  return (
    coord.row >= Math.min(ref.start.row, ref.end.row) &&
    coord.row <= Math.max(ref.start.row, ref.end.row) &&
    coord.column >= Math.min(ref.start.column, ref.end.column) &&
    coord.column <= Math.max(ref.start.column, ref.end.column)
  );
}
