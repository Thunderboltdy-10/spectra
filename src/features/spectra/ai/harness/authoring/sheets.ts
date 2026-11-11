import { collectFormulaReferences } from "../../../sheets/formula-refs";
import {
  columnIndex,
  columnName,
  coordinateToAddress,
  formatCalculatedCell,
  mutateWorkbookAxis,
  normalizeSheetsContent,
  parseAddress,
  parseRange,
  renameWorkbookSheet,
  sheetsCalculation,
  type CellRange,
  type SheetCell,
  type SheetCellFormat,
  type SheetChart,
  type SheetScalar,
  type SheetsContent,
  type WorkbookSheet,
} from "../../../sheets/model";
import { AuthoringError, type IdFactory, defaultIdFactory, truncate } from "./shared";

/*
 * Workbooks are authored with A1 ranges. A value starting with "=" is a
 * formula. Every edit runs on a copy and the readback shows calculated values,
 * formula errors, and formulas that read empty cells (LV-054).
 */

export type CellInput = string | number | boolean | null;

export type FormatSpec = Pick<
  SheetCellFormat,
  | "bold"
  | "italic"
  | "align"
  | "wrap"
  | "numberFormat"
  | "decimals"
  | "currency"
  | "textColor"
  | "fillColor"
  | "customFormat"
>;

export type SheetsEditOp =
  | { op: "set_range"; sheet?: string; range: string; values: CellInput[][] | CellInput }
  | { op: "clear_range"; sheet?: string; range: string }
  | ({ op: "format_range"; sheet?: string; range: string } & FormatSpec)
  | { op: "insert_rows" | "delete_rows"; sheet?: string; at: number; count?: number }
  | { op: "insert_columns" | "delete_columns"; sheet?: string; at: string; count?: number }
  | { op: "add_sheet"; name: string }
  | { op: "rename_sheet"; sheet: string; name: string }
  | { op: "delete_sheet"; sheet: string }
  | { op: "add_chart"; sheet?: string; type: SheetChart["type"]; range: string; title: string }
  | { op: "set_column_width"; sheet?: string; column: string; width: number }
  | { op: "freeze"; sheet?: string; rows?: number; columns?: number };

export type SheetSpec = {
  name: string;
  /** Rows of values written from `start` (default A1). */
  rows?: CellInput[][];
  start?: string;
  format?: Array<{ range: string } & FormatSpec>;
  charts?: Array<{ type: SheetChart["type"]; range: string; title: string }>;
  frozenRows?: number;
  columnWidths?: Record<string, number>;
};

export type SheetsSpec = { sheets: SheetSpec[] };

const CHART_TYPES = new Set(["column", "bar", "line", "area", "pie", "scatter", "combo", "histogram"]);
const NUMBER_FORMATS = new Set([
  "general", "number", "currency", "accounting", "percent", "fraction", "scientific", "date", "time", "text", "custom",
]);
const MAX_WRITE_CELLS = 20_000;

function findSheet(content: SheetsContent, name: string | undefined, label: string) {
  if (name === undefined || name === "") {
    const active = content.sheets.find((sheet) => sheet.id === content.activeSheetId) ?? content.sheets[0];
    if (!active) throw new AuthoringError(`${label}: the workbook has no sheets.`);
    return active;
  }
  const wanted = name.trim().toLowerCase();
  const found = content.sheets.find((sheet) => sheet.name.toLowerCase() === wanted);
  if (!found)
    throw new AuthoringError(
      `${label}: no sheet is named "${name}". Sheets: ${content.sheets.map((sheet) => `"${sheet.name}"`).join(", ")}.`,
    );
  return found;
}

function range(value: string, label: string): CellRange {
  const parsed = typeof value === "string" ? parseRange(value) : null;
  if (!parsed) throw new AuthoringError(`${label}: range "${String(value)}" is not an A1 range such as "B2" or "A1:C10".`);
  return parsed;
}

function cellFor(input: CellInput, previous: SheetCell | undefined): SheetCell | undefined {
  const base: SheetCell = previous?.format ? { format: previous.format } : {};
  if (input === null || input === "") return previous?.format ? base : undefined;
  if (typeof input === "string" && input.trim().startsWith("=")) return { ...base, formula: input.trim() };
  if (typeof input === "number" && !Number.isFinite(input)) return { ...base, value: null };
  return { ...base, value: input as SheetScalar };
}

function replaceSheet(content: SheetsContent, sheet: WorkbookSheet) {
  return { ...content, sheets: content.sheets.map((entry) => (entry.id === sheet.id ? sheet : entry)) };
}

const READABLE_MIN_WIDTH = 122;
const READABLE_MAX_WIDTH = 300;
const CHAR_WIDTH = 7.2;
const CELL_PAD = 24;
const LINE_HEIGHT = 20;
const MAX_FITTED_ROW = 220;

/** Written text can be read as it stands: columns grow to fit it, and what still will not fit wraps. */
function readableWrite(sheet: WorkbookSheet, target: CellRange, values: CellInput[][] | CellInput): WorkbookSheet {
  if (!Array.isArray(values)) return sheet;
  const cells = { ...sheet.cells };
  const columnWidths = { ...sheet.columnWidths };
  const rowHeights = { ...sheet.rowHeights };
  const perLine = Math.floor((READABLE_MAX_WIDTH - CELL_PAD) / CHAR_WIDTH);
  values.forEach((row, rowOffset) => {
    if (!Array.isArray(row)) return;
    row.forEach((_, columnOffset) => {
      const rowIndex = target.start.row + rowOffset;
      const column = target.start.column + columnOffset;
      const address = coordinateToAddress({ row: rowIndex, column });
      const cell = cells[address];
      if (!cell || cell.formula || cell.value === undefined || cell.value === null) return;
      const length = String(cell.value).length;
      const wanted = Math.min(READABLE_MAX_WIDTH, Math.round(length * CHAR_WIDTH + CELL_PAD));
      const key = String(column);
      if (wanted > (columnWidths[key] ?? READABLE_MIN_WIDTH)) columnWidths[key] = wanted;
      if (length <= perLine) return;
      cells[address] = { ...cell, format: { ...cell.format, wrap: true } };
      const height = Math.min(MAX_FITTED_ROW, Math.ceil(length / perLine) * LINE_HEIGHT + 11);
      if (height > (rowHeights[String(rowIndex)] ?? 0)) rowHeights[String(rowIndex)] = height;
    });
  });
  return { ...sheet, cells, columnWidths, rowHeights };
}

function writeRange(sheet: WorkbookSheet, target: CellRange, values: CellInput[][] | CellInput, label: string) {
  const cells = { ...sheet.cells };
  const grid = Array.isArray(values) ? values : null;
  if (grid && grid.some((row) => !Array.isArray(row)))
    throw new AuthoringError(`${label}: values must be a list of rows, each a list of cells, such as [["Name", "Score"], ["Ana", 12]].`);
  const rows = grid ? grid.length : target.end.row - target.start.row + 1;
  const columns = grid ? Math.max(0, ...grid.map((row) => row.length)) : target.end.column - target.start.column + 1;
  if (rows * columns > MAX_WRITE_CELLS)
    throw new AuthoringError(`${label}: writes ${rows * columns} cells; write at most ${MAX_WRITE_CELLS} at once.`);
  const singleCellTarget = target.start.row === target.end.row && target.start.column === target.end.column;
  if (grid && !singleCellTarget) {
    const width = target.end.column - target.start.column + 1;
    const height = target.end.row - target.start.row + 1;
    if (rows !== height || columns > width)
      throw new AuthoringError(
        `${label}: values are ${rows}×${columns} but range is ${height}×${width}. Give only the top-left cell to write any size.`,
      );
  }
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      const input = grid ? (grid[row]![column] ?? null) : (values as CellInput);
      if (grid && column >= grid[row]!.length) continue;
      const address = coordinateToAddress({ row: target.start.row + row, column: target.start.column + column });
      const next = cellFor(input, cells[address]);
      if (next) cells[address] = next;
      else delete cells[address];
    }
  return { ...sheet, cells };
}

function eachAddress(target: CellRange, label: string, visit: (address: string) => void) {
  const area = (target.end.row - target.start.row + 1) * (target.end.column - target.start.column + 1);
  if (area > MAX_WRITE_CELLS) throw new AuthoringError(`${label}: the range covers ${area} cells; use at most ${MAX_WRITE_CELLS}.`);
  for (let row = target.start.row; row <= target.end.row; row += 1)
    for (let column = target.start.column; column <= target.end.column; column += 1)
      visit(coordinateToAddress({ row, column }));
}

function formatRange(sheet: WorkbookSheet, target: CellRange, spec: FormatSpec, label: string) {
  if (spec.numberFormat !== undefined && !NUMBER_FORMATS.has(spec.numberFormat))
    throw new AuthoringError(`${label}: numberFormat must be one of ${[...NUMBER_FORMATS].join(", ")}.`);
  const format: SheetCellFormat = {};
  for (const key of ["bold", "italic", "align", "wrap", "numberFormat", "decimals", "currency", "textColor", "fillColor", "customFormat"] as const)
    if (spec[key] !== undefined) (format as Record<string, unknown>)[key] = spec[key];
  if (!Object.keys(format).length) throw new AuthoringError(`${label}: give at least one format field.`);
  const cells = { ...sheet.cells };
  eachAddress(target, label, (address) => {
    cells[address] = { ...cells[address], format: { ...cells[address]?.format, ...format } };
  });
  return { ...sheet, cells };
}

function axisIndex(value: unknown, axis: "row" | "column", label: string) {
  if (axis === "row") {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) throw new AuthoringError(`${label}: at must be a row number such as 3.`);
    return number - 1;
  }
  const index = typeof value === "string" ? columnIndex(value.trim()) : -1;
  if (index < 0) throw new AuthoringError(`${label}: at must be a column letter such as "C".`);
  return index;
}

function uniqueSheetId(content: SheetsContent, ids: IdFactory) {
  let id = ids("sheet");
  while (content.sheets.some((sheet) => sheet.id === id)) id = ids("sheet");
  return id;
}

function sheetName(value: unknown, content: SheetsContent, label: string, except?: string) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 31 || /[\\/?*[\]:]/.test(name))
    throw new AuthoringError(`${label}: name must be 1 to 31 characters without \\ / ? * [ ] :.`);
  if (content.sheets.some((sheet) => sheet.id !== except && sheet.name.toLowerCase() === name.toLowerCase()))
    throw new AuthoringError(`${label}: a sheet named "${name}" already exists.`);
  return name;
}

/** Applies range operations to a copy of the workbook. Throws naming the failing op. */
export function applySheetsEdits(content: unknown, ops: SheetsEditOp[], ids: IdFactory = defaultIdFactory()) {
  let book = normalizeSheetsContent(structuredClone(content ?? {}));
  if (!Array.isArray(ops) || !ops.length) throw new AuthoringError("No operations were given.");
  const touched = new Map<string, CellRange[]>();
  const touch = (sheet: WorkbookSheet, target?: CellRange) => {
    const list = touched.get(sheet.id) ?? [];
    if (target) list.push(target);
    touched.set(sheet.id, list);
  };
  ops.forEach((op, index) => {
    const label = `Edit ${index + 1} (${String(op?.op)})`;
    switch (op?.op) {
      case "set_range": {
        const sheet = findSheet(book, op.sheet, label);
        if (op.values === undefined) throw new AuthoringError(`${label}: values is missing.`);
        const target = range(op.range, label);
        book = replaceSheet(book, readableWrite(writeRange(sheet, target, op.values, label), target, op.values));
        const rows = Array.isArray(op.values) ? op.values.length : 0;
        const columns = Array.isArray(op.values) ? Math.max(1, ...op.values.map((row) => (Array.isArray(row) ? row.length : 1))) : 0;
        touch(sheet, rows ? {
          start: target.start,
          end: { row: target.start.row + rows - 1, column: target.start.column + columns - 1 },
        } : target);
        break;
      }
      case "clear_range": {
        const sheet = findSheet(book, op.sheet, label);
        const target = range(op.range, label);
        const cells = { ...sheet.cells };
        eachAddress(target, label, (address) => delete cells[address]);
        book = replaceSheet(book, { ...sheet, cells });
        touch(sheet, target);
        break;
      }
      case "format_range": {
        const sheet = findSheet(book, op.sheet, label);
        const target = range(op.range, label);
        book = replaceSheet(book, formatRange(sheet, target, op, label));
        touch(sheet, target);
        break;
      }
      case "insert_rows":
      case "delete_rows":
      case "insert_columns":
      case "delete_columns": {
        const sheet = findSheet(book, op.sheet, label);
        const axis = op.op.endsWith("rows") ? "row" : "column";
        const at = axisIndex(op.at, axis, label);
        const count = op.count === undefined ? 1 : Number(op.count);
        if (!Number.isInteger(count) || count < 1 || count > 500)
          throw new AuthoringError(`${label}: count must be from 1 to 500.`);
        const delta = op.op.startsWith("insert") ? 1 : -1;
        for (let step = 0; step < count; step += 1) book = mutateWorkbookAxis(book, sheet.id, axis, at, delta);
        touch(sheet);
        break;
      }
      case "add_sheet": {
        const name = sheetName(op.name, book, label);
        const sheet: WorkbookSheet = { id: uniqueSheetId(book, ids), name, cells: {}, tables: [], charts: [] };
        book = { ...book, sheets: [...book.sheets, sheet] };
        touch(sheet);
        break;
      }
      case "rename_sheet": {
        const sheet = findSheet(book, op.sheet, label);
        book = renameWorkbookSheet(book, sheet.id, sheetName(op.name, book, label, sheet.id));
        break;
      }
      case "delete_sheet": {
        const sheet = findSheet(book, op.sheet, label);
        if (book.sheets.length === 1) throw new AuthoringError(`${label}: a workbook keeps at least one sheet.`);
        book = {
          ...book,
          sheets: book.sheets.filter((entry) => entry.id !== sheet.id),
          activeSheetId: book.activeSheetId === sheet.id ? book.sheets.find((entry) => entry.id !== sheet.id)!.id : book.activeSheetId,
        };
        touched.delete(sheet.id);
        break;
      }
      case "add_chart": {
        const sheet = findSheet(book, op.sheet, label);
        if (!CHART_TYPES.has(op.type)) throw new AuthoringError(`${label}: type must be one of ${[...CHART_TYPES].join(", ")}.`);
        range(op.range, label);
        if (!op.title?.trim()) throw new AuthoringError(`${label}: title is empty.`);
        const chart: SheetChart = {
          id: ids("chart"),
          type: op.type,
          sourceRange: op.range.toUpperCase(),
          title: op.title.trim(),
          position: { x: 40 + sheet.charts.length * 24, y: 40 + sheet.charts.length * 24, width: 480, height: 300 },
        };
        book = replaceSheet(book, { ...sheet, charts: [...sheet.charts, chart] });
        touch(sheet);
        break;
      }
      case "set_column_width": {
        const sheet = findSheet(book, op.sheet, label);
        const column = axisIndex(op.column, "column", label);
        const width = Number(op.width);
        if (!Number.isFinite(width) || width < 20 || width > 800)
          throw new AuthoringError(`${label}: width must be from 20 to 800 pixels.`);
        book = replaceSheet(book, { ...sheet, columnWidths: { ...sheet.columnWidths, [String(column)]: width } });
        break;
      }
      case "freeze": {
        const sheet = findSheet(book, op.sheet, label);
        const rows = op.rows === undefined ? sheet.frozenRows : Number(op.rows);
        const columns = op.columns === undefined ? sheet.frozenColumns : Number(op.columns);
        for (const [field, value] of [["rows", rows], ["columns", columns]] as const)
          if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 50))
            throw new AuthoringError(`${label}: ${field} must be from 0 to 50.`);
        book = replaceSheet(book, { ...sheet, frozenRows: rows, frozenColumns: columns });
        break;
      }
      default:
        throw new AuthoringError(
          `${label}: unknown operation. Use set_range, clear_range, format_range, insert_rows, delete_rows, insert_columns, delete_columns, add_sheet, rename_sheet, delete_sheet, add_chart, set_column_width or freeze.`,
        );
    }
  });
  return { content: normalizeSheetsContent(book), touched };
}

/** A new workbook from sheet specs. */
export function sheetsFromSpec(spec: SheetsSpec, ids: IdFactory = defaultIdFactory()) {
  if (!Array.isArray(spec?.sheets) || !spec.sheets.length) throw new AuthoringError("sheets: give at least one sheet.");
  const first: WorkbookSheet = { id: ids("sheet"), name: "Sheet1", cells: {}, tables: [], charts: [] };
  const base: SheetsContent = {
    workbook: { calculationMode: "automatic", locale: "en-US" },
    sheets: [first],
    activeSheetId: first.id,
  };
  const ops: SheetsEditOp[] = [];
  spec.sheets.forEach((sheet, index) => {
    if (index === 0) ops.push({ op: "rename_sheet", sheet: "Sheet1", name: sheet.name });
    else ops.push({ op: "add_sheet", name: sheet.name });
    if (sheet.rows?.length) ops.push({ op: "set_range", sheet: sheet.name, range: sheet.start ?? "A1", values: sheet.rows });
    for (const format of sheet.format ?? []) ops.push({ op: "format_range", sheet: sheet.name, ...format });
    for (const chart of sheet.charts ?? []) ops.push({ op: "add_chart", sheet: sheet.name, ...chart });
    if (sheet.frozenRows) ops.push({ op: "freeze", sheet: sheet.name, rows: sheet.frozenRows });
    for (const [column, width] of Object.entries(sheet.columnWidths ?? {}))
      ops.push({ op: "set_column_width", sheet: sheet.name, column, width });
  });
  return applySheetsEdits(base, ops, ids);
}

// ---------------------------------------------------------------- reading

function usedRange(sheet: WorkbookSheet): CellRange | null {
  let bounds: CellRange | null = null;
  for (const address of Object.keys(sheet.cells)) {
    const cell = sheet.cells[address];
    if (cell?.value === undefined && !cell?.formula) continue;
    const at = parseAddress(address);
    if (!at) continue;
    bounds = bounds
      ? {
          start: { row: Math.min(bounds.start.row, at.row), column: Math.min(bounds.start.column, at.column) },
          end: { row: Math.max(bounds.end.row, at.row), column: Math.max(bounds.end.column, at.column) },
        }
      : { start: at, end: at };
  }
  return bounds;
}

function rangeText(target: CellRange) {
  const start = coordinateToAddress(target.start);
  const end = coordinateToAddress(target.end);
  return start === end ? start : `${start}:${end}`;
}

/** A grid of displayed values, with the formulas that produced them. */
export function sheetRangeText(content: unknown, options: { sheet?: string; range?: string; maxRows?: number; maxColumns?: number } = {}) {
  const book = normalizeSheetsContent(content);
  // A guessed name ("Sheet1") on a one-sheet workbook means that sheet.
  const guessed = options.sheet && book.sheets.length === 1 && book.sheets[0]!.name.toLowerCase() !== options.sheet.trim().toLowerCase();
  const sheet = findSheet(book, guessed ? undefined : options.sheet, "read");
  const used = usedRange(sheet);
  if (!used && !options.range) return `Sheet "${sheet.name}" is empty.`;
  const target = options.range ? range(options.range, "read") : used!;
  const maxRows = options.maxRows ?? 40;
  const maxColumns = options.maxColumns ?? 12;
  const calc = sheetsCalculation(book);
  // Past the used range, one empty row and column show where the data ends.
  const shownEnd = used
    ? { row: Math.min(target.end.row, Math.max(target.start.row, used.end.row + 1)), column: Math.min(target.end.column, Math.max(target.start.column, used.end.column + 1)) }
    : target.end;
  const endRow = Math.min(shownEnd.row, target.start.row + maxRows - 1);
  const endColumn = Math.min(shownEnd.column, target.start.column + maxColumns - 1);
  const header = ["", ...Array.from({ length: endColumn - target.start.column + 1 }, (_, index) => columnName(target.start.column + index))];
  const lines = [header.join(" | ")];
  const formulas: string[] = [];
  for (let row = target.start.row; row <= endRow; row += 1) {
    const cells: string[] = [String(row + 1)];
    for (let column = target.start.column; column <= endColumn; column += 1) {
      const address = coordinateToAddress({ row, column });
      const cell = sheet.cells[address];
      const shown = formatCalculatedCell(cell, calc.get(`${sheet.id}:${address}`), book.workbook.locale, book.workbook.date1904);
      cells.push(truncate(shown.replace(/\|/g, "/"), 28));
      if (cell?.formula) formulas.push(`${address} ${cell.formula}`);
    }
    lines.push(cells.join(" | "));
  }
  const clipped = endRow < shownEnd.row || endColumn < shownEnd.column;
  return [
    ...(guessed ? [`The only sheet is "${sheet.name}"; read that instead of "${options.sheet}".`] : []),
    `Sheet "${sheet.name}", ${rangeText(target)}${used ? ` (used range ${rangeText(used)})` : ""}:`,
    ...lines,
    ...(clipped ? [`… more rows or columns; read a narrower range to see them.`] : []),
    ...(formulas.length ? [`Formulas: ${truncate(formulas.join("; "), 1_500)}`] : []),
  ].join("\n");
}

/** Formula errors, formulas reading empty cells, and data columns missing a header. */
export function sheetsProblems(content: unknown) {
  const book = normalizeSheetsContent(content);
  const calc = sheetsCalculation(book);
  const problems: string[] = [];
  const named = new Map(Object.entries(book.workbook.namedRanges ?? {}).map(([name, ref]) => [name.toUpperCase(), ref]));
  for (const sheet of book.sheets) {
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (!cell.formula) continue;
      const result = calc.get(`${sheet.id}:${address}`);
      if (result?.error) {
        problems.push(`${sheet.name}!${address} ${cell.formula} gives ${result.error}`);
        continue;
      }
      const empties: string[] = [];
      for (const ref of collectFormulaReferences(cell.formula, named)) {
        if (ref.sheet) continue;
        const area = (ref.end.row - ref.start.row + 1) * (ref.end.column - ref.start.column + 1);
        if (area !== 1) continue;
        const target = coordinateToAddress(ref.start);
        const referenced = sheet.cells[target];
        if (referenced?.value === undefined && !referenced?.formula) empties.push(target);
      }
      if (empties.length) problems.push(`${sheet.name}!${address} ${cell.formula} reads empty ${empties.join(", ")}`);
    }
    const used = usedRange(sheet);
    if (used && used.end.row > used.start.row) {
      for (let column = used.start.column; column <= used.end.column; column += 1) {
        const head = sheet.cells[coordinateToAddress({ row: used.start.row, column })];
        if (head?.value !== undefined || head?.formula) continue;
        let hasData = false;
        for (let row = used.start.row + 1; row <= used.end.row && !hasData; row += 1) {
          const cell = sheet.cells[coordinateToAddress({ row, column })];
          hasData = cell?.value !== undefined || Boolean(cell?.formula);
        }
        if (hasData) problems.push(`${sheet.name}!${coordinateToAddress({ row: used.start.row, column })} is an empty header above data`);
      }
    }
  }
  return problems.slice(0, 20);
}

export function sheetsReadback(content: unknown, touched?: Map<string, CellRange[]>) {
  const book = normalizeSheetsContent(content);
  const lines = [
    `${book.sheets.length} sheet${book.sheets.length === 1 ? "" : "s"}: ${book.sheets
      .map((sheet) => {
        const used = usedRange(sheet);
        return `"${sheet.name}" (${used ? rangeText(used) : "empty"}${sheet.charts.length ? `, ${sheet.charts.length} chart${sheet.charts.length === 1 ? "" : "s"}` : ""})`;
      })
      .join(", ")}.`,
  ];
  const problems = sheetsProblems(book);
  if (problems.length) lines.push(`Problems: ${problems.join("; ")}.`);
  const sheets = touched?.size ? book.sheets.filter((sheet) => touched.has(sheet.id)) : book.sheets;
  for (const sheet of sheets.slice(0, 3)) {
    const ranges = touched?.get(sheet.id) ?? [];
    const bounds = ranges.length
      ? ranges.reduce((all, next) => ({
          start: { row: Math.min(all.start.row, next.start.row), column: Math.min(all.start.column, next.start.column) },
          end: { row: Math.max(all.end.row, next.end.row), column: Math.max(all.end.column, next.end.column) },
        }))
      : usedRange(sheet);
    if (bounds) lines.push(sheetRangeText(book, { sheet: sheet.name, range: rangeText(bounds), maxRows: 15, maxColumns: 10 }));
  }
  return truncate(lines.join("\n"), 3_500);
}
