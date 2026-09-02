import {
  dateToSerial,
  EXCEL_MAX_COL,
  EXCEL_MAX_ROW,
  isIsoDateString,
  serialToDate,
} from "./excel-serial";
import {
  rewriteSheetNameInFormula,
  rewriteStructuralReferences,
} from "./formula-refs";
import { sheetCellEntries } from "../../../../shared/sheet-cells";

export type SheetScalar = string | number | boolean | null;

export type SheetValidation =
  | {
      kind: "list";
      options: string[];
      rejectInvalid: boolean;
    }
  | {
      kind: "number";
      minimum?: number;
      maximum?: number;
      rejectInvalid: boolean;
    }
  | {
      kind: "checkbox";
      rejectInvalid: boolean;
    };

/**
 * One border edge. `style` is the ECMA-376 line style vocabulary, so a border
 * a person draws here is the border Excel draws — not an approximation chosen
 * at export time.
 */
export type SheetBorderEdge = {
  style: "thin" | "medium" | "thick" | "dashed" | "dotted" | "double" | "hair";
  color?: string;
};

export type SheetBorders = {
  top?: SheetBorderEdge | null;
  right?: SheetBorderEdge | null;
  bottom?: SheetBorderEdge | null;
  left?: SheetBorderEdge | null;
};

/**
 * The number-format kinds a cell can carry. `custom` defers to
 * `customFormat`, which holds a real Excel format code — the one honest way to
 * offer "custom" without inventing a second grammar.
 */
export type SheetNumberFormat =
  | "general"
  | "number"
  | "currency"
  | "accounting"
  | "percent"
  | "fraction"
  | "scientific"
  | "date"
  | "time"
  | "text"
  | "custom";

export type SheetCellFormat = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: "left" | "center" | "right" | "justify";
  verticalAlign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  /** Degrees, -90 to 90, as the Excel dialog states it. */
  rotation?: number;
  indent?: number;
  numberFormat?: SheetNumberFormat;
  /** An Excel format code, used when `numberFormat` is "custom". */
  customFormat?: string;
  /** ISO currency code for the currency and accounting formats. */
  currency?: string;
  decimals?: number;
  thousands?: boolean;
  /**
   * A font stack, or one of the three legacy Spectra keywords
   * (`sans`/`serif`/`mono`) that imported workbooks still carry.
   */
  fontFamily?: string;
  fontSize?: number;
  textColor?: string;
  fillColor?: string;
  borders?: SheetBorders;
};

export type SheetCell = {
  value?: SheetScalar;
  formula?: string;
  nativeFormulaSupport?: "recognized" | "cached-only";
  /**
   * Excel's last saved result is older than the workbook Spectra can see.
   * Cached-only formulas are never recalculated here; this flag is the
   * honest marker that the displayed number may no longer match Excel.
   */
  cachedValueStale?: boolean;
  format?: SheetCellFormat;
  validation?: SheetValidation;
  note?: string;
  provenance?: { source?: string; importedAt?: number };
};

export type SheetChart = {
  id: string;
  type:
    | "column"
    | "bar"
    | "line"
    | "area"
    | "pie"
    | "scatter"
    | "combo"
    | "histogram";
  sourceRange: string;
  title: string;
  /** Off hides the key; a one-series chart rarely needs one. */
  showLegend?: boolean;
  position: { x: number; y: number; width: number; height: number };
};

export type SheetTable = {
  id: string;
  name: string;
  range: string;
  /** Banding for the table body. `plain` is the default. */
  style?: "plain" | "striped" | "accent";
  /** Adds a summarising row under the table's last data row. */
  totalsRow?: boolean;
  filters?: Array<{
    column: number;
    allowedValues: SheetScalar[];
  }>;
  sort?: {
    column: number;
    direction: "asc" | "desc";
  };
  /** Multi-key sort, most significant first. Kept so a re-sort repeats it. */
  sortKeys?: Array<{ column: number; direction: "asc" | "desc" }>;
};

export type SheetConditionalFormat =
  | {
      id: string;
      range: string;
      kind: "color_scale";
      minimumColor: string;
      maximumColor: string;
    }
  | {
      id: string;
      range: string;
      kind: "cell_is";
      operator:
        | "greater_than"
        | "less_than"
        | "equal_to"
        | "not_equal_to"
        | "greater_equal"
        | "less_equal"
        | "between";
      value: number;
      /** The upper bound of a `between` rule. */
      secondValue?: number;
      fillColor: string;
      textColor?: string;
    }
  | {
      id: string;
      range: string;
      kind: "text_contains";
      text: string;
      fillColor: string;
      textColor?: string;
    };

export type WorkbookSheet = {
  id: string;
  name: string;
  cells: Record<string, SheetCell>;
  tables: SheetTable[];
  charts: SheetChart[];
  rowCount?: number;
  columnCount?: number;
  frozenRows?: number;
  frozenColumns?: number;
  hiddenRows?: number[];
  hiddenColumns?: number[];
  columnWidths?: Record<string, number>;
  rowHeights?: Record<string, number>;
  mergedRanges?: string[];
  conditionalFormats?: SheetConditionalFormat[];
  /** Tab colour, as a hex string. Excel keeps this on the sheet's view. */
  tabColor?: string;
  /** A hidden sheet stays in the workbook and keeps answering formulas. */
  hidden?: boolean;
  /** View toggles. Absent means shown, which is Excel's default. */
  showGridlines?: boolean;
  showHeadings?: boolean;
  /**
   * Sheet protection. Spectra records the intent and refuses edits locally;
   * Excel's own password-based protection in a mounted file is preserved, not
   * replaced, so the note says which one is in force.
   */
  protection?: { locked: boolean; note?: string };
  rowIdentities?: Record<string, string>;
  columnIdentities?: Record<string, string>;
};

export type SheetsContent = {
  workbook: {
    calculationMode: "automatic" | "manual";
    locale: string;
    timezone?: string;
    namedRanges?: Record<string, string>;
    calculationVersion?: number;
    /** Excel 1904 date system. Absent means the 1900 system. */
    date1904?: boolean;
  };
  sheets: WorkbookSheet[];
  activeSheetId: string;
  nativeBinding?: {
    version: 1;
    format: "xlsx" | "xlsm" | "xltx" | "xltm" | "xlam";
    profile: "strict-native" | "enhanced" | "spectra-native";
    macroEnabled: boolean;
    semanticDigest: string;
    recognizedFormulaFunctions: string[];
    date1904?: boolean;
  };
};

export type CellCoordinate = { row: number; column: number };
export type CellRange = { start: CellCoordinate; end: CellCoordinate };
export type CalculatedCell = { value: SheetScalar; error?: string };

const addressPattern = /^([A-Z]+)([1-9][0-9]*)$/;

export function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function columnIndex(name: string) {
  let result = 0;
  for (const character of name.toUpperCase()) {
    if (character < "A" || character > "Z") return -1;
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result - 1;
}

export function coordinateToAddress(coordinate: CellCoordinate) {
  return `${columnName(coordinate.column)}${coordinate.row + 1}`;
}

export function parseAddress(address: string): CellCoordinate | null {
  const match = address.trim().toUpperCase().match(addressPattern);
  if (!match) return null;
  const column = columnIndex(match[1]!);
  const row = Number(match[2]) - 1;
  return column >= 0 && row >= 0 ? { row, column } : null;
}

export function normalizeRange(range: CellRange): CellRange {
  return {
    start: {
      row: Math.min(range.start.row, range.end.row),
      column: Math.min(range.start.column, range.end.column),
    },
    end: {
      row: Math.max(range.start.row, range.end.row),
      column: Math.max(range.start.column, range.end.column),
    },
  };
}

export function parseRange(value: string): CellRange | null {
  const text = value.trim().toUpperCase();
  const colRange = /^\$?([A-Z]{1,3}):\$?([A-Z]{1,3})$/.exec(text);
  if (colRange) {
    const start = columnIndex(colRange[1]!);
    const end = columnIndex(colRange[2]!);
    if (start < 0 || end < 0) return null;
    return normalizeRange({
      start: { row: 0, column: start },
      end: { row: EXCEL_MAX_ROW - 1, column: end },
    });
  }
  const rowRange = /^\$?([1-9][0-9]*):\$?([1-9][0-9]*)$/.exec(text);
  if (rowRange) {
    const start = Number(rowRange[1]) - 1;
    const end = Number(rowRange[2]) - 1;
    if (start < 0 || end < 0 || start >= EXCEL_MAX_ROW || end >= EXCEL_MAX_ROW)
      return null;
    return normalizeRange({
      start: { row: start, column: 0 },
      end: { row: end, column: EXCEL_MAX_COL - 1 },
    });
  }
  const [startText, endText = startText] = text.split(":", 2);
  const start = parseAddress(startText ?? "");
  const end = parseAddress(endText ?? "");
  return start && end ? normalizeRange({ start, end }) : null;
}

export function rangeArea(range: CellRange) {
  const normalized = normalizeRange(range);
  return (
    (normalized.end.row - normalized.start.row + 1) *
    (normalized.end.column - normalized.start.column + 1)
  );
}

/** Walks denser than this throw rather than silently dropping cells. */
export const RANGE_WALK_LIMIT = 200_000;
const DENSE_FORMULA_RANGE = 10_000;

export class RangeTooLargeError extends Error {
  readonly area: number;
  readonly limit: number;
  constructor(area: number, limit: number) {
    super(`Range of ${area} cells exceeds the ${limit}-cell walk limit.`);
    this.name = "RangeTooLargeError";
    this.area = area;
    this.limit = limit;
  }
}

export function rangeLabel(range: CellRange) {
  const normalized = normalizeRange(range);
  const start = coordinateToAddress(normalized.start);
  const end = coordinateToAddress(normalized.end);
  return start === end ? start : `${start}:${end}`;
}

export function rangeAddresses(range: CellRange, limit = RANGE_WALK_LIMIT) {
  const normalized = normalizeRange(range);
  const area = rangeArea(normalized);
  if (area > limit) throw new RangeTooLargeError(area, limit);
  const result: string[] = [];
  for (let row = normalized.start.row; row <= normalized.end.row; row += 1) {
    for (
      let column = normalized.start.column;
      column <= normalized.end.column;
      column += 1
    ) {
      result.push(coordinateToAddress({ row, column }));
    }
  }
  return result;
}

function occupiedAddressesInRange(sheet: WorkbookSheet, range: CellRange) {
  const normalized = normalizeRange(range);
  const addresses: string[] = [];
  for (const address of Object.keys(sheet.cells)) {
    const coordinate = parseAddress(address);
    if (!coordinate) continue;
    if (
      coordinate.row >= normalized.start.row &&
      coordinate.row <= normalized.end.row &&
      coordinate.column >= normalized.start.column &&
      coordinate.column <= normalized.end.column
    )
      addresses.push(address);
  }
  addresses.sort((left, right) => {
    const a = parseAddress(left)!;
    const b = parseAddress(right)!;
    return a.row - b.row || a.column - b.column;
  });
  return addresses;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringMap(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value)).flatMap(([key, entry]) =>
      typeof key === "string" &&
      key &&
      typeof entry === "string" &&
      entry.trim()
        ? [[key, entry.trim().slice(0, 180)]]
        : [],
    ),
  );
}

/**
 * Live Yjs sheet regions address `rowIdentities` / `columnIdentities` slots for
 * every used cell. Sparse trees often recompose those slots as `undefined`;
 * fill stable string ids so schema validation never sees missing strings.
 */
function normalizeSheetIdentityMap(
  raw: unknown,
  sheetId: string,
  kind: "row" | "column",
  usedIndices: Iterable<number>,
): Record<string, string> {
  const result = stringMap(raw);
  for (const [key, entry] of Object.entries(record(raw))) {
    if (result[key] || !/^\d+$/.test(key)) continue;
    // Keep materialized-but-empty slots from Yjs markers instead of dropping
    // them (they would just be rematerialized as undefined on the next read).
    if (entry !== undefined && typeof entry !== "string") continue;
    const index = Number(key);
    result[key] =
      kind === "row"
        ? `${sheetId}:row:${index + 1}`
        : `${sheetId}:column:${index + 1}`;
  }
  for (const index of usedIndices) {
    if (!Number.isInteger(index) || index < 0) continue;
    const key = String(index);
    if (result[key]) continue;
    result[key] =
      kind === "row"
        ? `${sheetId}:row:${index + 1}`
        : `${sheetId}:column:${index + 1}`;
  }
  return result;
}

function usedCellAxes(cells: Record<string, SheetCell>) {
  const rows = new Set<number>();
  const columns = new Set<number>();
  for (const address of Object.keys(cells)) {
    const match = addressPattern.exec(address);
    if (!match) continue;
    rows.add(Number(match[2]) - 1);
    columns.add(columnIndex(match[1]!));
  }
  return { rows, columns };
}

export function normalizeSheetsContent(value: unknown): SheetsContent {
  const source = record(value);
  const workbookSource = record(source.workbook);
  const rawSheets = Array.isArray(source.sheets) ? source.sheets : [];
  const sheets = rawSheets.map((raw, index): WorkbookSheet => {
    const sheet = record(raw);
    const cells = Object.fromEntries(
      sheetCellEntries(sheet.cells).flatMap(([address, rawCell]) => {
        if (!addressPattern.test(address.toUpperCase())) return [];
        // Models sometimes patch a bare scalar; lift it into a SheetCell so
        // column appends and imports are not silently emptied.
        const cell =
          typeof rawCell === "string" ||
          typeof rawCell === "number" ||
          typeof rawCell === "boolean" ||
          rawCell === null
            ? {
                value: rawCell as string | number | boolean | null,
              }
            : record(rawCell);
        const value = cell.value;
        const formula =
          typeof cell.formula === "string"
            ? cell.formula
            : typeof cell.input === "string" &&
                String(cell.input).trim().startsWith("=")
              ? String(cell.input).trim()
              : undefined;
        const date1904 = workbookSource.date1904 === true;
        let scalar: SheetScalar | undefined =
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          value === null
            ? value
            : undefined;
        if (typeof scalar === "string" && isIsoDateString(scalar)) {
          scalar = dateToSerial(new Date(scalar), date1904);
        } else if (
          typeof scalar === "number" &&
          Math.abs(scalar) > 1e11 &&
          (record(cell.format).numberFormat === "date" ||
            record(cell.format).numberFormat === "time")
        ) {
          scalar = dateToSerial(new Date(scalar), date1904);
        }
        if (scalar === undefined && formula === undefined) {
          // Keep format-only / note-only cells; drop truly empty shells.
          const hasExtras =
            (cell.format && typeof cell.format === "object") ||
            (cell.validation && typeof cell.validation === "object") ||
            typeof cell.note === "string";
          if (!hasExtras) return [];
        }
        return [
          [
            address.toUpperCase(),
            {
              ...(scalar !== undefined ? { value: scalar } : {}),
              ...(formula ? { formula } : {}),
              ...(cell.nativeFormulaSupport === "cached-only" ||
              cell.nativeFormulaSupport === "recognized"
                ? { nativeFormulaSupport: cell.nativeFormulaSupport }
                : {}),
              ...(cell.cachedValueStale === true
                ? { cachedValueStale: true }
                : {}),
              ...(cell.format && typeof cell.format === "object"
                ? { format: cell.format as SheetCell["format"] }
                : {}),
              ...(cell.validation && typeof cell.validation === "object"
                ? {
                    validation: cell.validation as SheetValidation,
                  }
                : {}),
              ...(typeof cell.note === "string" ? { note: cell.note } : {}),
            } satisfies SheetCell,
          ],
        ];
      }),
    );
    const sheetId =
      typeof sheet.id === "string" && sheet.id.trim()
        ? sheet.id.trim().slice(0, 180)
        : `sheet-${index + 1}`;
    const axes = usedCellAxes(cells);
    return {
      id: sheetId,
      name:
        typeof sheet.name === "string" && sheet.name.trim()
          ? sheet.name.trim().slice(0, 100)
          : `Sheet ${index + 1}`,
      cells,
      tables: Array.isArray(sheet.tables)
        ? sheet.tables.flatMap((candidate, tableIndex): SheetTable[] => {
            const table = record(candidate);
            if (typeof table.range !== "string" || !parseRange(table.range))
              return [];
            return [
              {
                id:
                  typeof table.id === "string" && table.id
                    ? table.id
                    : `table-${index + 1}-${tableIndex + 1}`,
                name:
                  typeof table.name === "string" && table.name
                    ? table.name.slice(0, 100)
                    : `Table ${tableIndex + 1}`,
                range: table.range.toUpperCase(),
                ...(table.style === "striped" || table.style === "accent"
                  ? { style: table.style }
                  : {}),
                ...(table.totalsRow === true ? { totalsRow: true } : {}),
                filters: Array.isArray(table.filters)
                  ? table.filters.flatMap((candidateFilter) => {
                      const filter = record(candidateFilter);
                      if (
                        typeof filter.column !== "number" ||
                        !Array.isArray(filter.allowedValues)
                      )
                        return [];
                      return [
                        {
                          column: Math.max(
                            0,
                            Math.min(16_383, Math.round(filter.column)),
                          ),
                          allowedValues: filter.allowedValues
                            .filter(
                              (value): value is SheetScalar =>
                                typeof value === "string" ||
                                typeof value === "number" ||
                                typeof value === "boolean" ||
                                value === null,
                            )
                            .slice(0, 10_000),
                        },
                      ];
                    })
                  : [],
                ...(record(table.sort).direction === "asc" ||
                record(table.sort).direction === "desc"
                  ? {
                      sort: {
                        column: Math.max(
                          0,
                          Math.min(
                            16_383,
                            Math.round(Number(record(table.sort).column) || 0),
                          ),
                        ),
                        direction: record(table.sort).direction as
                          "asc" | "desc",
                      },
                    }
                  : {}),
                ...(Array.isArray(table.sortKeys)
                  ? {
                      sortKeys: table.sortKeys
                        .flatMap((candidate) => {
                          const key = record(candidate);
                          if (
                            key.direction !== "asc" &&
                            key.direction !== "desc"
                          )
                            return [];
                          return [
                            {
                              column: Math.max(
                                0,
                                Math.min(
                                  16_383,
                                  Math.round(Number(key.column) || 0),
                                ),
                              ),
                              direction: key.direction as "asc" | "desc",
                            },
                          ];
                        })
                        .slice(0, 8),
                    }
                  : {}),
              },
            ];
          })
        : [],
      charts: Array.isArray(sheet.charts)
        ? sheet.charts.flatMap((candidate, chartIndex): SheetChart[] => {
            const chart = record(candidate);
            const position = record(chart.position);
            if (
              typeof chart.sourceRange !== "string" ||
              !parseRange(chart.sourceRange.split("!").at(-1) ?? "")
            )
              return [];
            const type = [
              "column",
              "bar",
              "line",
              "area",
              "pie",
              "scatter",
              "combo",
              "histogram",
            ].includes(String(chart.type))
              ? (chart.type as SheetChart["type"])
              : "line";
            return [
              {
                id:
                  typeof chart.id === "string" && chart.id
                    ? chart.id
                    : `chart-${index + 1}-${chartIndex + 1}`,
                type,
                sourceRange: chart.sourceRange,
                title:
                  typeof chart.title === "string"
                    ? chart.title.slice(0, 300)
                    : `Chart ${chartIndex + 1}`,
                ...(chart.showLegend === false ? { showLegend: false } : {}),
                position: {
                  x: Number(position.x) || 0,
                  y: Number(position.y) || 0,
                  width: Math.max(240, Number(position.width) || 760),
                  height: Math.max(180, Number(position.height) || 320),
                },
              },
            ];
          })
        : [],
      rowCount: typeof sheet.rowCount === "number" ? sheet.rowCount : 100,
      columnCount:
        typeof sheet.columnCount === "number" ? sheet.columnCount : 26,
      frozenRows: typeof sheet.frozenRows === "number" ? sheet.frozenRows : 0,
      frozenColumns:
        typeof sheet.frozenColumns === "number" ? sheet.frozenColumns : 0,
      hiddenRows: Array.isArray(sheet.hiddenRows)
        ? sheet.hiddenRows.filter(
            (item): item is number => typeof item === "number",
          )
        : [],
      hiddenColumns: Array.isArray(sheet.hiddenColumns)
        ? sheet.hiddenColumns.filter(
            (item): item is number => typeof item === "number",
          )
        : [],
      columnWidths: record(sheet.columnWidths) as Record<string, number>,
      rowHeights: record(sheet.rowHeights) as Record<string, number>,
      mergedRanges: Array.isArray(sheet.mergedRanges)
        ? sheet.mergedRanges
            .filter(
              (item): item is string =>
                typeof item === "string" && Boolean(parseRange(item)),
            )
            .map((item) => rangeLabel(parseRange(item)!))
            .slice(0, 10_000)
        : [],
      conditionalFormats: Array.isArray(sheet.conditionalFormats)
        ? sheet.conditionalFormats.flatMap(
            (candidate, ruleIndex): SheetConditionalFormat[] => {
              const rule = record(candidate);
              if (typeof rule.range !== "string" || !parseRange(rule.range))
                return [];
              const id =
                typeof rule.id === "string" && rule.id
                  ? rule.id
                  : `conditional-${index + 1}-${ruleIndex + 1}`;
              if (rule.kind === "color_scale")
                return [
                  {
                    id,
                    range: rangeLabel(parseRange(rule.range)!),
                    kind: "color_scale",
                    minimumColor:
                      typeof rule.minimumColor === "string"
                        ? rule.minimumColor
                        : "#f1f8f4",
                    maximumColor:
                      typeof rule.maximumColor === "string"
                        ? rule.maximumColor
                        : "#78d2ad",
                  },
                ];
              if (
                rule.kind === "cell_is" &&
                [
                  "greater_than",
                  "less_than",
                  "equal_to",
                  "not_equal_to",
                  "greater_equal",
                  "less_equal",
                  "between",
                ].includes(String(rule.operator)) &&
                typeof rule.value === "number" &&
                Number.isFinite(rule.value)
              )
                return [
                  {
                    id,
                    range: rangeLabel(parseRange(rule.range)!),
                    kind: "cell_is",
                    operator: rule.operator as NonNullable<
                      Extract<SheetConditionalFormat, { kind: "cell_is" }>
                    >["operator"],
                    value: rule.value,
                    ...(typeof rule.secondValue === "number" &&
                    Number.isFinite(rule.secondValue)
                      ? { secondValue: rule.secondValue }
                      : {}),
                    fillColor:
                      typeof rule.fillColor === "string"
                        ? rule.fillColor
                        : "color-mix(in oklab, var(--success) 16%, var(--bg-elevated))",
                    textColor:
                      typeof rule.textColor === "string"
                        ? rule.textColor
                        : undefined,
                  },
                ];
              if (
                rule.kind === "text_contains" &&
                typeof rule.text === "string" &&
                rule.text.trim()
              )
                return [
                  {
                    id,
                    range: rangeLabel(parseRange(rule.range)!),
                    kind: "text_contains",
                    text: rule.text.slice(0, 200),
                    fillColor:
                      typeof rule.fillColor === "string"
                        ? rule.fillColor
                        : "color-mix(in oklab, var(--success) 16%, var(--bg-elevated))",
                    textColor:
                      typeof rule.textColor === "string"
                        ? rule.textColor
                        : undefined,
                  },
                ];
              return [];
            },
          )
        : [],
      ...(typeof sheet.tabColor === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(sheet.tabColor)
        ? { tabColor: sheet.tabColor }
        : {}),
      ...(sheet.hidden === true ? { hidden: true } : {}),
      ...(sheet.showGridlines === false ? { showGridlines: false } : {}),
      ...(sheet.showHeadings === false ? { showHeadings: false } : {}),
      ...(record(sheet.protection).locked === true
        ? {
            protection: {
              locked: true,
              ...(typeof record(sheet.protection).note === "string"
                ? { note: String(record(sheet.protection).note).slice(0, 300) }
                : {}),
            },
          }
        : {}),
      rowIdentities: normalizeSheetIdentityMap(
        sheet.rowIdentities,
        sheetId,
        "row",
        axes.rows,
      ),
      columnIdentities: normalizeSheetIdentityMap(
        sheet.columnIdentities,
        sheetId,
        "column",
        axes.columns,
      ),
    };
  });
  if (sheets.length === 0)
    sheets.push({
      id: "sheet-1",
      name: "Sheet 1",
      cells: {},
      tables: [],
      charts: [],
      rowCount: 100,
      columnCount: 26,
      hiddenRows: [],
      hiddenColumns: [],
      columnWidths: {},
      rowHeights: {},
      mergedRanges: [],
      conditionalFormats: [],
      rowIdentities: {},
      columnIdentities: {},
    });
  const activeSheetId =
    typeof source.activeSheetId === "string" &&
    sheets.some((sheet) => sheet.id === source.activeSheetId)
      ? source.activeSheetId
      : sheets[0]!.id;
  const nativeBindingSource = record(source.nativeBinding);
  const nativeFormat = ["xlsx", "xlsm", "xltx", "xltm", "xlam"].includes(
    String(nativeBindingSource.format),
  )
    ? (nativeBindingSource.format as NonNullable<
        SheetsContent["nativeBinding"]
      >["format"])
    : undefined;
  const nativeProfile = [
    "strict-native",
    "enhanced",
    "spectra-native",
  ].includes(String(nativeBindingSource.profile))
    ? (nativeBindingSource.profile as NonNullable<
        SheetsContent["nativeBinding"]
      >["profile"])
    : undefined;
  const nativeBinding =
    nativeBindingSource.version === 1 &&
    nativeFormat &&
    nativeProfile &&
    typeof nativeBindingSource.macroEnabled === "boolean" &&
    typeof nativeBindingSource.semanticDigest === "string" &&
    /^[a-f0-9]{64}$/.test(nativeBindingSource.semanticDigest) &&
    Array.isArray(nativeBindingSource.recognizedFormulaFunctions)
      ? {
          version: 1 as const,
          format: nativeFormat,
          profile: nativeProfile,
          macroEnabled: nativeBindingSource.macroEnabled,
          semanticDigest: nativeBindingSource.semanticDigest,
          recognizedFormulaFunctions:
            nativeBindingSource.recognizedFormulaFunctions.flatMap((entry) =>
              typeof entry === "string" && entry.trim()
                ? [entry.trim().slice(0, 120)]
                : [],
            ),
          ...(nativeBindingSource.date1904 === true ? { date1904: true } : {}),
        }
      : undefined;
  return {
    workbook: {
      calculationMode:
        workbookSource.calculationMode === "manual" ? "manual" : "automatic",
      locale:
        typeof workbookSource.locale === "string" &&
        workbookSource.locale.trim().length >= 2
          ? workbookSource.locale.trim().slice(0, 40)
          : "en-US",
      ...(typeof workbookSource.timezone === "string" &&
      workbookSource.timezone.trim()
        ? { timezone: workbookSource.timezone.trim().slice(0, 100) }
        : {}),
      namedRanges: stringMap(workbookSource.namedRanges),
      calculationVersion:
        typeof workbookSource.calculationVersion === "number"
          ? workbookSource.calculationVersion
          : 1,
      ...(workbookSource.date1904 === true ? { date1904: true } : {}),
    },
    sheets,
    activeSheetId,
    ...(nativeBinding ? { nativeBinding } : {}),
  };
}

type Token = {
  type:
    | "number"
    | "string"
    | "identifier"
    | "operator"
    | "paren"
    | "comma"
    | "colon";
  value: string;
};

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const remaining = expression.slice(index);
    const whitespace = remaining.match(/^\s+/);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const number = remaining.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      tokens.push({ type: "number", value: number[0] });
      index += number[0].length;
      continue;
    }
    if (remaining[0] === '"') {
      let result = "";
      index += 1;
      while (index < expression.length) {
        if (expression[index] === '"' && expression[index + 1] === '"') {
          result += '"';
          index += 2;
          continue;
        }
        if (expression[index] === '"') {
          index += 1;
          break;
        }
        result += expression[index];
        index += 1;
      }
      tokens.push({ type: "string", value: result });
      continue;
    }
    const cellReference = remaining.match(
      /^(?:(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(?:\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?[1-9][0-9]*:\$?[1-9][0-9]*|\$?[A-Za-z]{1,3}\$?[1-9][0-9]*)/,
    );
    if (cellReference) {
      tokens.push({
        type: "identifier",
        value: cellReference[0].replaceAll("$", ""),
      });
      index += cellReference[0].length;
      continue;
    }
    const identifier = remaining.match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    const twoCharacter = remaining.slice(0, 2);
    if (["<=", ">=", "<>", "=="].includes(twoCharacter)) {
      tokens.push({ type: "operator", value: twoCharacter });
      index += 2;
      continue;
    }
    const character = remaining[0]!;
    if ("+-*/^&=<>%".includes(character))
      tokens.push({ type: "operator", value: character });
    else if (character === "(" || character === ")")
      tokens.push({ type: "paren", value: character });
    else if (character === "," || character === ";")
      tokens.push({ type: "comma", value: character });
    else if (character === ":")
      tokens.push({ type: "colon", value: character });
    else throw new Error("#VALUE!");
    index += 1;
  }
  return tokens;
}

type FormulaValue = SheetScalar | FormulaValue[];

/**
 * An error produced while evaluating one argument.
 *
 * Excel does not abandon a whole formula because one branch failed:
 * `IFERROR(A1/B1, 0)` is the standard way to say "and if that fails, use this".
 * Arguments are therefore evaluated defensively and a failure is carried as
 * this sentinel, so the handful of functions whose entire job is to inspect a
 * failure can see it, while every other function still propagates it.
 */
class FormulaErrorValue {
  constructor(readonly code: string) {}
}

type FormulaArgument = FormulaValue | FormulaErrorValue;

/** Functions that are allowed to look at a failed argument. */
const ERROR_TOLERANT_FUNCTIONS = new Set([
  "IFERROR",
  "IFNA",
  "IF",
  "IFS",
  "SWITCH",
  "ISERROR",
  "ISERR",
  "ISNA",
  "ISBLANK",
]);

function isFormulaError(value: FormulaArgument): value is FormulaErrorValue {
  return value instanceof FormulaErrorValue;
}

/** Rows and columns of an A1 range reference, sheet prefixes ignored. */
function referenceShape(reference: string) {
  const [left, right] = reference.split(":", 2);
  const start = parseAddress((left ?? "").split("!").at(-1) ?? "");
  const end = parseAddress((right ?? "").split("!").at(-1) ?? "");
  if (!start || !end) return null;
  return {
    rows: Math.abs(end.row - start.row) + 1,
    columns: Math.abs(end.column - start.column) + 1,
  };
}

/** An evaluation error code, or null when the failure is not one of ours. */
function formulaErrorCode(error: unknown) {
  return error instanceof Error && /^#[A-Z0-9/?!.]+$/.test(error.message)
    ? error.message
    : null;
}

function scalar(value: FormulaValue): SheetScalar {
  return Array.isArray(value) ? scalar(value[0] ?? null) : value;
}

function numeric(value: FormulaValue) {
  const item = scalar(value);
  if (typeof item === "number") return item;
  if (typeof item === "boolean") return item ? 1 : 0;
  if (item === null || item === "") return 0;
  const parsed = Number(item);
  if (!Number.isFinite(parsed)) throw new Error("#VALUE!");
  return parsed;
}

function flattened(values: FormulaValue[]) {
  return values.flatMap((value): SheetScalar[] =>
    Array.isArray(value) ? flattened(value) : [value],
  );
}

function formulaCriteriaMatches(value: SheetScalar, criterion: SheetScalar) {
  if (typeof criterion !== "string") return value === criterion;
  const match = /^(<=|>=|<>|=|<|>)([\s\S]*)$/.exec(criterion);
  const operator = match?.[1] ?? "=";
  const rawExpected = match?.[2] ?? criterion;
  const numericExpected = Number(rawExpected);
  const bothNumeric =
    typeof value === "number" &&
    rawExpected.trim() !== "" &&
    Number.isFinite(numericExpected);
  const left = bothNumeric ? value : String(value ?? "");
  const right = bothNumeric ? numericExpected : rawExpected;
  const comparison =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right), undefined, {
          sensitivity: "base",
        });
  if (operator === "<>") return comparison !== 0;
  if (operator === "<") return comparison < 0;
  if (operator === ">") return comparison > 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === ">=") return comparison >= 0;
  if (rawExpected.includes("*") || rawExpected.includes("?")) {
    const expression = rawExpected
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*")
      .replaceAll("?", ".");
    return new RegExp(`^${expression}$`, "i").test(String(value ?? ""));
  }
  return comparison === 0;
}

class FormulaParser {
  private index = 0;
  /**
   * The shape of the most recent range literal, and the shapes of the current
   * call's arguments. A range arrives at a function flattened, so a lookup that
   * needs to know "how wide was that table" has no other honest source: without
   * it VLOOKUP would read some other column and look like it worked.
   */
  private rangeShape: { rows: number; columns: number } | null = null;
  private argumentShapes: Array<{ rows: number; columns: number } | null> = [];
  constructor(
    private readonly tokens: Token[],
    private readonly resolveCell: (reference: string) => SheetScalar,
    private readonly resolveRange: (reference: string) => SheetScalar[],
    private readonly resolveName: (name: string) => FormulaValue,
    private readonly date1904 = false,
  ) {}

  parse() {
    const value = this.comparison();
    if (this.index < this.tokens.length) throw new Error("#VALUE!");
    return scalar(value);
  }

  private current() {
    return this.tokens[this.index];
  }
  private consume() {
    return this.tokens[this.index++];
  }
  private comparison(): FormulaValue {
    let left = this.concatenate();
    while (
      this.current()?.type === "operator" &&
      ["=", "==", "<>", "<", ">", "<=", ">="].includes(this.current()!.value)
    ) {
      const operator = this.consume()!.value;
      const right = this.concatenate();
      const a = scalar(left);
      const b = scalar(right);
      const compare =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a ?? "").localeCompare(String(b ?? ""));
      left =
        operator === "=" || operator === "=="
          ? a === b
          : operator === "<>"
            ? a !== b
            : operator === "<"
              ? compare < 0
              : operator === ">"
                ? compare > 0
                : operator === "<="
                  ? compare <= 0
                  : compare >= 0;
    }
    return left;
  }
  private concatenate(): FormulaValue {
    let left = this.additive();
    while (this.current()?.value === "&") {
      this.consume();
      left = `${scalar(left) ?? ""}${scalar(this.additive()) ?? ""}`;
    }
    return left;
  }
  private additive(): FormulaValue {
    let left = this.multiplicative();
    while (this.current()?.value === "+" || this.current()?.value === "-") {
      const operator = this.consume()!.value;
      const right = this.multiplicative();
      left =
        operator === "+"
          ? numeric(left) + numeric(right)
          : numeric(left) - numeric(right);
    }
    return left;
  }
  private multiplicative(): FormulaValue {
    let left = this.power();
    while (this.current()?.value === "*" || this.current()?.value === "/") {
      const operator = this.consume()!.value;
      const right = numeric(this.power());
      if (operator === "/" && right === 0) throw new Error("#DIV/0!");
      left = operator === "*" ? numeric(left) * right : numeric(left) / right;
    }
    return left;
  }
  private power(): FormulaValue {
    let left = this.unary();
    while (this.current()?.value === "^") {
      this.consume();
      left = Math.pow(numeric(left), numeric(this.unary()));
    }
    return left;
  }
  private unary(): FormulaValue {
    if (this.current()?.value === "+") {
      this.consume();
      return numeric(this.unary());
    }
    if (this.current()?.value === "-") {
      this.consume();
      return -numeric(this.unary());
    }
    let value = this.primary();
    while (this.current()?.value === "%") {
      this.consume();
      value = numeric(value) / 100;
    }
    return value;
  }
  private primary(): FormulaValue {
    const token = this.consume();
    if (!token) throw new Error("#VALUE!");
    if (token.type === "number") return Number(token.value);
    if (token.type === "string") return token.value;
    if (token.type === "paren" && token.value === "(") {
      const value = this.comparison();
      if (this.consume()?.value !== ")") throw new Error("#VALUE!");
      return value;
    }
    if (token.type !== "identifier") throw new Error("#VALUE!");
    const upper = token.value.toUpperCase();
    if (upper === "TRUE") return true;
    if (upper === "FALSE") return false;
    if (upper === "NULL") return null;
    if (this.current()?.value === "(") {
      this.consume();
      const args: FormulaArgument[] = [];
      const shapes: Array<{ rows: number; columns: number } | null> = [];
      while (this.current() && this.current()!.value !== ")") {
        const start = this.index;
        this.rangeShape = null;
        try {
          args.push(this.comparison());
        } catch (error) {
          const code = formulaErrorCode(error);
          if (code === null) throw error;
          // The argument failed part-way through, so the token cursor is
          // wherever it stopped. Rewind and step over the whole argument, or
          // the rest of the call would be parsed as if it were shifted along.
          this.index = start;
          this.skipArgument();
          args.push(new FormulaErrorValue(code));
        }
        shapes.push(this.rangeShape);
        if (this.current()?.type === "comma") this.consume();
        else break;
      }
      if (this.consume()?.value !== ")") throw new Error("#VALUE!");
      // Every nested call has finished by now, so these shapes belong to this
      // call and cannot be clobbered by a deeper one.
      this.argumentShapes = shapes;
      return this.call(upper, args);
    }
    const local = upper.split("!").at(-1) ?? "";
    if (local.includes(":")) {
      this.rangeShape = referenceShape(upper);
      return this.resolveRange(upper);
    }
    if (!addressPattern.test(local)) return this.resolveName(upper);
    if (this.current()?.type === "colon") {
      this.consume();
      const end = this.consume();
      if (!end || end.type !== "identifier") throw new Error("#REF!");
      const reference = `${upper}:${end.value.toUpperCase()}`;
      this.rangeShape = referenceShape(reference);
      return this.resolveRange(reference);
    }
    return this.resolveCell(upper);
  }
  /** Advance past one argument, honouring nested calls, to its delimiter. */
  private skipArgument() {
    let depth = 0;
    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index]!;
      if (token.type === "paren" && token.value === "(") depth += 1;
      else if (token.type === "paren" && token.value === ")") {
        if (depth === 0) return;
        depth -= 1;
      } else if (token.type === "comma" && depth === 0) return;
      this.index += 1;
    }
  }

  private call(name: string, args: readonly FormulaArgument[]): FormulaValue {
    if (!ERROR_TOLERANT_FUNCTIONS.has(name)) {
      const failed = args.find(isFormulaError);
      if (failed) throw new Error(failed.code);
    }
    if (name === "ISERROR" || name === "ISERR")
      return isFormulaError(args[0] ?? null);
    if (name === "ISNA")
      return (
        isFormulaError(args[0] ?? null) &&
        (args[0] as FormulaErrorValue).code === "#N/A"
      );
    if (name === "ISBLANK") {
      const first = args[0];
      if (first === undefined || isFormulaError(first)) return false;
      const item = scalar(first);
      return item === null || item === "";
    }
    if (name === "IFERROR" || name === "IFNA") {
      const first = args[0] ?? null;
      const matches =
        name === "IFERROR"
          ? isFormulaError(first)
          : isFormulaError(first) && first.code === "#N/A";
      if (!matches) return isFormulaError(first) ? null : first;
      const fallback = args[1];
      if (fallback === undefined) return null;
      if (isFormulaError(fallback)) throw new Error(fallback.code);
      return fallback;
    }
    if (name === "IF") {
      const condition = args[0] ?? false;
      if (isFormulaError(condition)) throw new Error(condition.code);
      const branch = Boolean(scalar(condition)) ? args[1] : args[2];
      if (branch === undefined)
        return Boolean(scalar(condition)) ? true : false;
      if (isFormulaError(branch)) throw new Error(branch.code);
      return branch;
    }
    if (name === "IFS") {
      for (let index = 0; index + 1 < args.length; index += 2) {
        const condition = args[index]!;
        if (isFormulaError(condition)) throw new Error(condition.code);
        if (!Boolean(scalar(condition))) continue;
        const result = args[index + 1]!;
        if (isFormulaError(result)) throw new Error(result.code);
        return result;
      }
      throw new Error("#N/A");
    }
    if (name === "SWITCH") {
      const subject = args[0] ?? null;
      if (isFormulaError(subject)) throw new Error(subject.code);
      const needle = scalar(subject);
      let index = 1;
      for (; index + 1 < args.length; index += 2) {
        const candidate = args[index]!;
        const result = args[index + 1]!;
        if (isFormulaError(candidate)) throw new Error(candidate.code);
        if (scalar(candidate) !== needle) continue;
        if (isFormulaError(result)) throw new Error(result.code);
        return result;
      }
      // An odd trailing argument is SWITCH's default.
      const fallback = args[index];
      if (fallback === undefined) throw new Error("#N/A");
      if (isFormulaError(fallback)) throw new Error(fallback.code);
      return fallback;
    }
    return this.apply(name, args as readonly FormulaValue[]);
  }

  private apply(name: string, args: readonly FormulaValue[]): FormulaValue {
    const values = flattened(args as FormulaValue[]);
    const numbers = values.filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    );
    if (name === "SUM")
      return numbers.reduce((total, value) => total + value, 0);
    if (name === "AVERAGE" || name === "AVG")
      return numbers.length
        ? numbers.reduce((total, value) => total + value, 0) / numbers.length
        : 0;
    if (name === "MIN") return numbers.length ? Math.min(...numbers) : 0;
    if (name === "MAX") return numbers.length ? Math.max(...numbers) : 0;
    if (name === "COUNT") return numbers.length;
    if (name === "COUNTA")
      return values.filter((value) => value !== null && value !== "").length;
    if (name === "COUNTIF") {
      const source = Array.isArray(args[0])
        ? flattened([args[0]])
        : [scalar(args[0] ?? null)];
      const criterion = scalar(args[1] ?? null);
      return source.filter((value) => formulaCriteriaMatches(value, criterion))
        .length;
    }
    if (name === "SUMIF" || name === "AVERAGEIF") {
      const criteriaRange = Array.isArray(args[0])
        ? flattened([args[0]])
        : [scalar(args[0] ?? null)];
      const criterion = scalar(args[1] ?? null);
      const sumRange = Array.isArray(args[2])
        ? flattened([args[2]])
        : args[2] === undefined
          ? criteriaRange
          : [scalar(args[2])];
      const matchingNumbers = criteriaRange.flatMap((value, index) => {
        if (!formulaCriteriaMatches(value, criterion)) return [];
        const candidate = sumRange[index] ?? null;
        return typeof candidate === "number" && Number.isFinite(candidate)
          ? [candidate]
          : [];
      });
      if (name === "AVERAGEIF")
        return matchingNumbers.length
          ? matchingNumbers.reduce((sum, value) => sum + value, 0) /
              matchingNumbers.length
          : 0;
      return matchingNumbers.reduce((sum, value) => sum + value, 0);
    }
    if (name === "COUNTIFS" || name === "SUMIFS") {
      const sumRange =
        name === "SUMIFS"
          ? Array.isArray(args[0])
            ? flattened([args[0]])
            : [scalar(args[0] ?? null)]
          : null;
      const offset = name === "SUMIFS" ? 1 : 0;
      const pairs: Array<{ range: SheetScalar[]; criterion: SheetScalar }> = [];
      for (let index = offset; index + 1 < args.length; index += 2)
        pairs.push({
          range: Array.isArray(args[index])
            ? flattened([args[index]!])
            : [scalar(args[index] ?? null)],
          criterion: scalar(args[index + 1] ?? null),
        });
      if (!pairs.length) throw new Error("#VALUE!");
      const length = Math.max(...pairs.map((pair) => pair.range.length));
      const matched = Array.from({ length }, (_, index) =>
        pairs.every((pair) =>
          formulaCriteriaMatches(pair.range[index] ?? null, pair.criterion),
        ),
      );
      if (name === "COUNTIFS") return matched.filter(Boolean).length;
      return matched.reduce(
        (sum, matches, index) =>
          sum +
          (matches && typeof sumRange?.[index] === "number"
            ? (sumRange[index] as number)
            : 0),
        0,
      );
    }
    if (name === "AND") return values.every(Boolean);
    if (name === "OR") return values.some(Boolean);
    if (name === "NOT") return !Boolean(scalar(args[0] ?? false));
    if (name === "ROUND")
      return Number(
        numeric(args[0] ?? 0).toFixed(
          Math.max(0, Math.min(12, numeric(args[1] ?? 0))),
        ),
      );
    if (name === "ROUNDUP" || name === "ROUNDDOWN") {
      const digits = Math.max(-12, Math.min(12, numeric(args[1] ?? 0)));
      const factor = Math.pow(10, digits);
      const value = numeric(args[0] ?? 0) * factor;
      return (
        (name === "ROUNDUP"
          ? value < 0
            ? Math.floor(value)
            : Math.ceil(value)
          : value < 0
            ? Math.ceil(value)
            : Math.floor(value)) / factor
      );
    }
    if (name === "ABS") return Math.abs(numeric(args[0] ?? 0));
    if (name === "SQRT") {
      const value = numeric(args[0] ?? 0);
      if (value < 0) throw new Error("#NUM!");
      return Math.sqrt(value);
    }
    if (name === "POWER" || name === "POW")
      return Math.pow(numeric(args[0] ?? 0), numeric(args[1] ?? 0));
    if (name === "LEN") return String(scalar(args[0] ?? "") ?? "").length;
    if (name === "LOWER")
      return String(scalar(args[0] ?? "") ?? "").toLowerCase();
    if (name === "UPPER")
      return String(scalar(args[0] ?? "") ?? "").toUpperCase();
    if (name === "TEXT") {
      const raw = scalar(args[0] ?? null);
      const code = String(scalar(args[1] ?? "") ?? "");
      if (typeof raw !== "number") return raw === null ? "" : String(raw);
      return formatWithCode(raw, code, undefined, this.date1904);
    }
    if (name === "TRIM")
      return String(scalar(args[0] ?? "") ?? "")
        .trim()
        .replace(/\s+/g, " ");
    if (name === "LEFT" || name === "RIGHT") {
      const text = String(scalar(args[0] ?? "") ?? "");
      const count = Math.max(0, Math.round(numeric(args[1] ?? 1)));
      return name === "LEFT" ? text.slice(0, count) : text.slice(-count);
    }
    if (name === "MID") {
      const text = String(scalar(args[0] ?? "") ?? "");
      const start = Math.max(0, Math.round(numeric(args[1] ?? 1)) - 1);
      const count = Math.max(0, Math.round(numeric(args[2] ?? 0)));
      return text.slice(start, start + count);
    }
    if (name === "SUBSTITUTE") {
      const text = String(scalar(args[0] ?? "") ?? "");
      const before = String(scalar(args[1] ?? "") ?? "");
      const after = String(scalar(args[2] ?? "") ?? "");
      if (!before) return text;
      const occurrence = Math.round(numeric(args[3] ?? 0));
      if (occurrence <= 0) return text.split(before).join(after);
      let seen = 0;
      return text.replaceAll(before, (match) => {
        seen += 1;
        return seen === occurrence ? after : match;
      });
    }
    if (name === "FIND" || name === "SEARCH") {
      const needle = String(scalar(args[0] ?? "") ?? "");
      const haystack = String(scalar(args[1] ?? "") ?? "");
      const start = Math.max(0, Math.round(numeric(args[2] ?? 1)) - 1);
      const index =
        name === "SEARCH"
          ? haystack.toLowerCase().indexOf(needle.toLowerCase(), start)
          : haystack.indexOf(needle, start);
      if (index < 0) throw new Error("#VALUE!");
      return index + 1;
    }
    if (name === "CONCAT" || name === "CONCATENATE")
      return values.map((value) => value ?? "").join("");
    if (name === "TEXTJOIN") {
      const delimiter = String(scalar(args[0] ?? "") ?? "");
      const ignoreEmpty = Boolean(scalar(args[1] ?? false));
      return flattened(args.slice(2))
        .filter((value) => !ignoreEmpty || (value !== null && value !== ""))
        .map((value) => value ?? "")
        .join(delimiter);
    }
    if (name === "PRODUCT")
      return numbers.reduce((product, value) => product * value, 1);
    if (name === "MEDIAN") {
      if (!numbers.length) return 0;
      const sorted = [...numbers].sort((left, right) => left - right);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2
        ? sorted[middle]!
        : (sorted[middle - 1]! + sorted[middle]!) / 2;
    }
    if (
      ["STDEV", "STDEV.S", "STDEV.P", "VAR", "VAR.S", "VAR.P"].includes(name)
    ) {
      const population = name.endsWith(".P");
      const varianceName = name.startsWith("VAR");
      if (!numbers.length || (!population && numbers.length < 2))
        throw new Error("#DIV/0!");
      const mean =
        numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
      const denominator = population ? numbers.length : numbers.length - 1;
      const variance =
        numbers.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
        denominator;
      return varianceName ? variance : Math.sqrt(variance);
    }
    if (name === "MOD") {
      const divisor = numeric(args[1] ?? 0);
      if (divisor === 0) throw new Error("#DIV/0!");
      return ((numeric(args[0] ?? 0) % divisor) + divisor) % divisor;
    }
    if (name === "CEILING" || name === "FLOOR") {
      const value = numeric(args[0] ?? 0);
      const significance = Math.abs(numeric(args[1] ?? 1));
      if (!significance) throw new Error("#DIV/0!");
      return (
        (name === "CEILING" ? Math.ceil : Math.floor)(value / significance) *
        significance
      );
    }
    if (name === "EXP") return Math.exp(numeric(args[0] ?? 0));
    if (name === "LN") {
      const value = numeric(args[0] ?? 0);
      if (value <= 0) throw new Error("#NUM!");
      return Math.log(value);
    }
    if (name === "LOG") {
      const value = numeric(args[0] ?? 0);
      const base = numeric(args[1] ?? 10);
      if (value <= 0 || base <= 0 || base === 1) throw new Error("#NUM!");
      return Math.log(value) / Math.log(base);
    }
    if (name === "SIN") return Math.sin(numeric(args[0] ?? 0));
    if (name === "COS") return Math.cos(numeric(args[0] ?? 0));
    if (name === "TAN") return Math.tan(numeric(args[0] ?? 0));
    if (name === "PI") return Math.PI;
    if (name === "DATE") {
      const year = Math.round(numeric(args[0] ?? 1900));
      const month = Math.round(numeric(args[1] ?? 1));
      const day = Math.round(numeric(args[2] ?? 1));
      return dateToSerial(
        new Date(Date.UTC(year, month - 1, day)),
        this.date1904,
      );
    }
    if (name === "YEAR" || name === "MONTH" || name === "DAY") {
      const date = serialToDate(numeric(args[0] ?? 0), this.date1904);
      if (Number.isNaN(date.getTime())) throw new Error("#VALUE!");
      if (name === "YEAR") return date.getUTCFullYear();
      if (name === "MONTH") return date.getUTCMonth() + 1;
      return date.getUTCDate();
    }
    if (name === "INDEX") {
      const source = Array.isArray(args[0])
        ? flattened([args[0]])
        : [scalar(args[0] ?? null)];
      const position = Math.round(numeric(args[1] ?? 1));
      if (position < 1 || position > source.length) throw new Error("#REF!");
      return source[position - 1] ?? null;
    }
    if (name === "MATCH") {
      const needle = scalar(args[0] ?? null);
      const source = Array.isArray(args[1])
        ? flattened([args[1]])
        : [scalar(args[1] ?? null)];
      const position = source.findIndex((value) => value === needle);
      if (position < 0) throw new Error("#N/A");
      return position + 1;
    }
    if (name === "XLOOKUP") {
      const needle = scalar(args[0] ?? null);
      const lookup = Array.isArray(args[1])
        ? flattened([args[1]])
        : [scalar(args[1] ?? null)];
      const returned = Array.isArray(args[2])
        ? flattened([args[2]])
        : [scalar(args[2] ?? null)];
      const position = lookup.findIndex((value) => value === needle);
      if (position < 0) {
        if (args[3] !== undefined) return scalar(args[3]);
        throw new Error("#N/A");
      }
      return returned[position] ?? null;
    }
    if (name === "COUNTBLANK")
      return values.filter((value) => value === null || value === "").length;
    if (name === "SUMPRODUCT") {
      const ranges = args.map((argument) =>
        Array.isArray(argument)
          ? flattened([argument])
          : [scalar(argument ?? null)],
      );
      if (!ranges.length) throw new Error("#VALUE!");
      const length = Math.max(...ranges.map((range) => range.length));
      let total = 0;
      for (let index = 0; index < length; index += 1) {
        let product = 1;
        for (const range of ranges) {
          const item = range[index] ?? null;
          product *=
            typeof item === "number" && Number.isFinite(item) ? item : 0;
        }
        total += product;
      }
      return total;
    }
    if (name === "LARGE" || name === "SMALL") {
      const position = Math.round(numeric(args[1] ?? 1));
      if (position < 1 || position > numbers.length) throw new Error("#NUM!");
      const sorted = [...numbers].sort((left, right) =>
        name === "LARGE" ? right - left : left - right,
      );
      return sorted[position - 1]!;
    }
    if (name === "RANK" || name === "RANK.EQ") {
      const target = numeric(args[0] ?? 0);
      const pool = Array.isArray(args[1]) ? flattened([args[1]]) : [];
      const scores = pool.filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value),
      );
      const ascending = Boolean(scalar(args[2] ?? false));
      const better = scores.filter((value) =>
        ascending ? value < target : value > target,
      ).length;
      if (!scores.includes(target)) throw new Error("#N/A");
      return better + 1;
    }
    if (name === "VLOOKUP" || name === "HLOOKUP") {
      // The table argument arrives flattened, so the shape has to come from the
      // range itself. Without it a lookup would silently read the wrong column,
      // which is worse than refusing.
      const shape = this.argumentShapes[1] ?? null;
      const needle = scalar(args[0] ?? null);
      const table = Array.isArray(args[1]) ? flattened([args[1]]) : [];
      const index = Math.round(numeric(args[2] ?? 1));
      if (!shape || !table.length || index < 1) throw new Error("#REF!");
      const width = shape.columns;
      const height = shape.rows;
      if (name === "VLOOKUP") {
        if (index > width) throw new Error("#REF!");
        for (let row = 0; row < height; row += 1) {
          if (table[row * width] === needle)
            return table[row * width + index - 1] ?? null;
        }
      } else {
        if (index > height) throw new Error("#REF!");
        for (let column = 0; column < width; column += 1) {
          if (table[column] === needle)
            return table[(index - 1) * width + column] ?? null;
        }
      }
      const approximate = args[3] === undefined || Boolean(scalar(args[3]));
      if (!approximate) throw new Error("#N/A");
      throw new Error("#N/A");
    }
    if (name === "PROPER")
      return String(scalar(args[0] ?? "") ?? "").replace(
        /\p{L}+/gu,
        (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase(),
      );
    if (name === "REPT") {
      const count = Math.max(
        0,
        Math.min(4096, Math.round(numeric(args[1] ?? 0))),
      );
      return String(scalar(args[0] ?? "") ?? "").repeat(count);
    }
    if (name === "VALUE") {
      const parsed = Number(
        String(scalar(args[0] ?? "") ?? "").replace(/[,\s]/g, ""),
      );
      if (!Number.isFinite(parsed)) throw new Error("#VALUE!");
      return parsed;
    }
    if (name === "TODAY") {
      const now = new Date();
      return dateToSerial(
        new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
        this.date1904,
      );
    }
    if (name === "NOW") return dateToSerial(new Date(), this.date1904);
    if (name === "WEEKDAY") {
      const date = serialToDate(numeric(args[0] ?? 0), this.date1904);
      if (Number.isNaN(date.getTime())) throw new Error("#VALUE!");
      const type = Math.round(numeric(args[1] ?? 1));
      const day = date.getUTCDay();
      if (type === 2) return day === 0 ? 7 : day;
      if (type === 3) return day === 0 ? 6 : day - 1;
      return day + 1;
    }
    if (name === "DAYS") {
      return numeric(args[0] ?? 0) - numeric(args[1] ?? 0);
    }
    if (name === "HOUR" || name === "MINUTE" || name === "SECOND") {
      const date = serialToDate(numeric(args[0] ?? 0), this.date1904);
      if (Number.isNaN(date.getTime())) throw new Error("#VALUE!");
      if (name === "HOUR") return date.getUTCHours();
      if (name === "MINUTE") return date.getUTCMinutes();
      return date.getUTCSeconds();
    }
    if (name === "SIGN") {
      const value = numeric(args[0] ?? 0);
      return value > 0 ? 1 : value < 0 ? -1 : 0;
    }
    if (name === "INT") return Math.floor(numeric(args[0] ?? 0));
    if (name === "TRUNC") {
      const digits = Math.max(0, Math.min(12, numeric(args[1] ?? 0)));
      const factor = Math.pow(10, digits);
      return Math.trunc(numeric(args[0] ?? 0) * factor) / factor;
    }
    throw new Error("#NAME?");
  }
}

function referenceParts(
  reference: string,
  fallbackSheet: WorkbookSheet,
  sheets: WorkbookSheet[],
) {
  const separator = reference.lastIndexOf("!");
  if (separator < 0) return { sheet: fallbackSheet, address: reference };
  const name = reference
    .slice(0, separator)
    .replace(/^'|'$/g, "")
    .replaceAll("''", "'");
  const sheet = sheets.find(
    (candidate) => candidate.name.toUpperCase() === name.toUpperCase(),
  );
  return { sheet, address: reference.slice(separator + 1) };
}

/**
 * A calculation that evaluates on demand.
 *
 * The grid reads a few hundred cells at a time — the viewport, the selection,
 * a conditional rule's own range. Recalculating a 200,000-cell workbook to
 * answer that would put the whole sheet on the keystroke path, which is exactly
 * what CANON D20 forbids. So the dependency walk is kept, the memo table is
 * kept, and only the trigger changes: a cell is evaluated the first time
 * something asks for it, and its precedents come along because the walk is
 * recursive.
 *
 * The accessor is `get(key)` so every existing caller — which held a `Map` —
 * works unchanged.
 */
export type SheetsCalculation = {
  get(key: string): CalculatedCell | undefined;
  /** How many cells have actually been evaluated. Asserted by the density test. */
  readonly size: number;
};

function calculationCore(content: SheetsContent) {
  const result = new Map<string, CalculatedCell>();
  const resolving = new Set<string>();
  const sheetById = new Map(content.sheets.map((sheet) => [sheet.id, sheet]));
  const date1904 = content.workbook.date1904 === true;
  const calculate = (sheet: WorkbookSheet, address: string): CalculatedCell => {
    const key = `${sheet.id}:${address.toUpperCase()}`;
    const cached = result.get(key);
    if (cached) return cached;
    if (resolving.has(key)) return { value: null, error: "#CYCLE!" };
    resolving.add(key);
    const cell = sheet.cells[address.toUpperCase()];
    if (!cell?.formula) {
      const plain = { value: cell?.value ?? null };
      result.set(key, plain);
      resolving.delete(key);
      return plain;
    }
    if (cell.nativeFormulaSupport === "cached-only") {
      const cached = { value: cell.value ?? null };
      result.set(key, cached);
      resolving.delete(key);
      return cached;
    }
    try {
      if (cell.formula.includes("#REF!")) throw new Error("#REF!");
      const parser = new FormulaParser(
        tokenize(cell.formula.replace(/^=/, "")),
        (reference) => {
          const parts = referenceParts(reference, sheet, content.sheets);
          if (!parts.sheet || !parseAddress(parts.address))
            throw new Error("#REF!");
          const calculated = calculate(parts.sheet, parts.address);
          if (calculated.error) throw new Error(calculated.error);
          return calculated.value;
        },
        (reference) => {
          const [startRef, endRef] = reference.split(":", 2);
          const startParts = referenceParts(
            startRef ?? "",
            sheet,
            content.sheets,
          );
          const endParts = referenceParts(
            endRef ?? "",
            startParts.sheet ?? sheet,
            content.sheets,
          );
          if (
            !startParts.sheet ||
            !endParts.sheet ||
            startParts.sheet.id !== endParts.sheet.id
          )
            throw new Error("#REF!");
          const range = parseRange(`${startParts.address}:${endParts.address}`);
          if (!range) throw new Error("#REF!");
          const addresses =
            rangeArea(range) <= DENSE_FORMULA_RANGE
              ? rangeAddresses(range)
              : occupiedAddressesInRange(startParts.sheet, range);
          return addresses.map((item) => {
            const calculated = calculate(startParts.sheet!, item);
            if (calculated.error) throw new Error(calculated.error);
            return calculated.value;
          });
        },
        (name) => {
          const named = Object.entries(content.workbook.namedRanges ?? {}).find(
            ([candidate]) => candidate.toUpperCase() === name.toUpperCase(),
          )?.[1];
          if (!named) throw new Error("#NAME?");
          const separator = named.lastIndexOf("!");
          const sheetName =
            separator >= 0
              ? named
                  .slice(0, separator)
                  .replace(/^'|'$/g, "")
                  .replaceAll("''", "'")
              : sheet.name;
          const targetSheet = content.sheets.find(
            (candidate) =>
              candidate.name.toUpperCase() === sheetName.toUpperCase(),
          );
          const targetRange = parseRange(
            separator >= 0 ? named.slice(separator + 1) : named,
          );
          if (!targetSheet || !targetRange) throw new Error("#REF!");
          const values = (
            rangeArea(targetRange) <= DENSE_FORMULA_RANGE
              ? rangeAddresses(targetRange)
              : occupiedAddressesInRange(targetSheet, targetRange)
          ).map((address) => {
            const target = calculate(targetSheet, address);
            if (target.error) throw new Error(target.error);
            return target.value;
          });
          return values.length === 1 ? values[0]! : values;
        },
        date1904,
      );
      const calculated = { value: parser.parse() };
      result.set(key, calculated);
      resolving.delete(key);
      return calculated;
    } catch (error) {
      const message =
        error instanceof Error && /^#[A-Z0-9/?!]+$/.test(error.message)
          ? error.message
          : "#VALUE!";
      const calculated = { value: null, error: message };
      result.set(key, calculated);
      resolving.delete(key);
      return calculated;
    }
  };
  return { result, calculate, sheetById };
}

/**
 * The on-demand calculation used by the grid. Nothing is evaluated until a
 * surface asks for a cell, so opening a large workbook and typing in it costs
 * the cells on screen rather than the whole sheet.
 */
export function sheetsCalculation(content: SheetsContent): SheetsCalculation {
  const { result, calculate, sheetById } = calculationCore(content);
  return {
    get(key: string) {
      const cached = result.get(key);
      if (cached) return cached;
      const separator = key.lastIndexOf(":");
      if (separator < 0) return undefined;
      // Sheet ids contain colons themselves (`xlsx:sheet:3`), so the address is
      // whatever follows the last one.
      const sheet = sheetById.get(key.slice(0, separator));
      const address = key.slice(separator + 1).toUpperCase();
      if (!sheet || !addressPattern.test(address)) return undefined;
      return calculate(sheet, address);
    },
    get size() {
      return result.size;
    },
  };
}

/**
 * The whole workbook, evaluated eagerly. Export, the ODS writer and the tests
 * want every cell at once; the grid deliberately does not.
 */
export function calculateWorkbook(content: SheetsContent) {
  const { result, calculate } = calculationCore(content);
  for (const sheet of content.sheets)
    for (const address of Object.keys(sheet.cells)) calculate(sheet, address);
  return result;
}
/**
 * A fraction close to `value`, with a denominator no larger than `limit`.
 * Excel's fraction formats are approximations too; stating the denominator
 * ceiling keeps ours honest rather than pretending at arbitrary precision.
 */
function fractionText(value: number, limit = 99) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute);
  const remainder = absolute - whole;
  if (remainder < 1 / (2 * limit))
    return `${sign}${whole.toLocaleString("en-US")}`;
  let bestNumerator = 1;
  let bestDenominator = 1;
  let bestError = Number.POSITIVE_INFINITY;
  for (let denominator = 1; denominator <= limit; denominator += 1) {
    const numerator = Math.round(remainder * denominator);
    if (numerator === 0) continue;
    const error = Math.abs(remainder - numerator / denominator);
    if (error < bestError - 1e-12) {
      bestError = error;
      bestNumerator = numerator;
      bestDenominator = denominator;
    }
  }
  if (bestNumerator === bestDenominator)
    return `${sign}${(whole + 1).toLocaleString("en-US")}`;
  return whole
    ? `${sign}${whole.toLocaleString("en-US")} ${bestNumerator}/${bestDenominator}`
    : `${sign}${bestNumerator}/${bestDenominator}`;
}

/**
 * Renders a cell the way its number format says. Every branch is a real Excel
 * format family; nothing here invents a presentation the workbook cannot round
 * trip. A custom code is applied for the parts Spectra understands and
 * otherwise falls back to the plain number rather than printing a guess.
 */
/**
 * Renders a number through an Excel format code.
 *
 * This is the one reader of a format code in the workbook, which is the point:
 * the `custom` number format and the `TEXT` function have to agree, and they can
 * only agree by being the same code. Codes Spectra cannot fully model degrade to
 * the closest honest reading rather than being dropped, and the stored number is
 * never touched — a format is a view of a value, never a rewrite of it.
 */
function dateFromSerial(value: number, date1904 = false) {
  if (Math.abs(value) < 3_000_000) return serialToDate(value, date1904);
  return new Date(value);
}

export function formatWithCode(
  value: number,
  code: string,
  locale?: string,
  date1904 = false,
) {
  const codeDecimals = /\.(0+)/.exec(code)?.[1]?.length;
  if (/[dmy]/i.test(code.replace(/\[[^\]]*]/g, "")) && /[dy]/i.test(code))
    return new Intl.DateTimeFormat(locale).format(
      dateFromSerial(value, date1904),
    );
  if (code.includes("%"))
    return new Intl.NumberFormat(locale, {
      style: "percent",
      minimumFractionDigits: codeDecimals ?? 0,
      maximumFractionDigits: codeDecimals ?? 0,
    }).format(value);
  if (/E\+/i.test(code))
    return new Intl.NumberFormat(locale, {
      notation: "scientific",
      maximumFractionDigits: codeDecimals ?? 2,
    }).format(value);
  return new Intl.NumberFormat(locale, {
    useGrouping: code.includes(","),
    minimumFractionDigits: codeDecimals ?? 0,
    maximumFractionDigits: codeDecimals ?? 12,
  }).format(value);
}

export function formatCalculatedCell(
  cell: SheetCell | undefined,
  calculated: CalculatedCell | undefined,
  locale: string,
  date1904 = false,
) {
  if (calculated?.error) return calculated.error;
  const value = calculated?.value ?? cell?.value ?? null;
  if (value === null) return "";
  const format = cell?.format;
  if (format?.numberFormat === "text") return String(value);
  if (typeof value !== "number") return String(value);
  const decimals = Math.max(
    0,
    Math.min(12, format?.decimals ?? (Number.isInteger(value) ? 0 : 2)),
  );
  const grouping = format?.thousands ?? true;
  try {
    switch (format?.numberFormat) {
      case "currency":
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency: format.currency ?? "USD",
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(value);
      case "accounting": {
        // Accounting aligns the sign outside the figure and prints zero as a
        // dash, which is what a ledger reader expects to see.
        const body = new Intl.NumberFormat(locale, {
          style: "currency",
          currency: format.currency ?? "USD",
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          currencySign: "accounting",
        }).format(Math.abs(value));
        if (value === 0) return body.replace(/[\d.,]+/, "-");
        return value < 0 ? `(${body})` : body;
      }
      case "percent":
        return new Intl.NumberFormat(locale, {
          style: "percent",
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(value);
      case "fraction":
        return fractionText(value);
      case "scientific":
        return new Intl.NumberFormat(locale, {
          notation: "scientific",
          minimumFractionDigits: Math.min(12, format.decimals ?? 2),
          maximumFractionDigits: Math.min(12, format.decimals ?? 2),
        }).format(value);
      case "date":
        return new Intl.DateTimeFormat(locale).format(
          dateFromSerial(value, date1904),
        );
      case "time":
        return new Intl.DateTimeFormat(locale, {
          hour: "2-digit",
          minute: "2-digit",
          ...(decimals > 0 ? { second: "2-digit" as const } : {}),
        }).format(dateFromSerial(value, date1904));
      case "custom":
        return formatWithCode(
          value,
          format.customFormat ?? "",
          locale,
          date1904,
        );
      default:
        return new Intl.NumberFormat(locale, {
          useGrouping: grouping,
          minimumFractionDigits:
            format?.numberFormat === "number" ? decimals : 0,
          maximumFractionDigits: decimals,
        }).format(value);
    }
  } catch {
    return String(value);
  }
}

export function parseDelimited(
  text: string,
  delimiter = text.includes("\t") ? "\t" : ",",
) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index <= text.length; index += 1) {
    const character = text[index] ?? "\n";
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else cell += character;
  }
  return rows;
}

export function delimitedValue(value: string) {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function shiftIdentityMap(
  source: Record<string, string> | undefined,
  at: number,
  delta: 1 | -1,
  newId: string,
  materializedCount = 0,
  identityPrefix = "region",
) {
  const result: Record<string, string> = {};
  const materialized = {
    ...Object.fromEntries(
      Array.from({ length: materializedCount }, (_, index) => [
        String(index),
        `${identityPrefix}-${index + 1}`,
      ]),
    ),
    ...(source ?? {}),
  };
  for (const [rawIndex, id] of Object.entries(materialized)) {
    const index = Number(rawIndex);
    if (!Number.isInteger(index)) continue;
    if (delta === -1 && index === at) continue;
    result[String(index >= at ? index + delta : index)] = id;
  }
  if (delta === 1) result[String(at)] = newId;
  return result;
}

function shiftIndexList(
  source: number[] | undefined,
  at: number,
  delta: 1 | -1,
) {
  return (source ?? []).flatMap((index) => {
    if (delta === -1 && index === at) return [];
    return [index >= at ? index + delta : index];
  });
}

function shiftNumericKeyMap(
  source: Record<string, number> | undefined,
  at: number,
  delta: 1 | -1,
) {
  return Object.fromEntries(
    Object.entries(source ?? {}).flatMap(([rawIndex, value]) => {
      const index = Number(rawIndex);
      if (!Number.isInteger(index) || (delta === -1 && index === at)) return [];
      return [[String(index >= at ? index + delta : index), value]];
    }),
  );
}

function shiftStructuralRange(
  value: string,
  axis: "row" | "column",
  at: number,
  delta: 1 | -1,
) {
  const separator = value.lastIndexOf("!");
  const prefix = separator >= 0 ? value.slice(0, separator + 1) : "";
  const parsed = parseRange(
    separator >= 0 ? value.slice(separator + 1) : value,
  );
  if (!parsed) return null;
  const range = normalizeRange(parsed);
  const start = axis === "row" ? range.start.row : range.start.column;
  const end = axis === "row" ? range.end.row : range.end.column;
  if (delta === 1) {
    if (at <= start) {
      if (axis === "row") {
        range.start.row += 1;
        range.end.row += 1;
      } else {
        range.start.column += 1;
        range.end.column += 1;
      }
    } else if (at <= end) {
      if (axis === "row") range.end.row += 1;
      else range.end.column += 1;
    }
  } else if (at < start) {
    if (axis === "row") {
      range.start.row -= 1;
      range.end.row -= 1;
    } else {
      range.start.column -= 1;
      range.end.column -= 1;
    }
  } else if (at <= end) {
    if (start === end) return null;
    if (axis === "row") range.end.row -= 1;
    else range.end.column -= 1;
  }
  return `${prefix}${rangeLabel(range)}`;
}

export function mutateSheetAxis(
  sheet: WorkbookSheet,
  axis: "row" | "column",
  at: number,
  delta: 1 | -1,
) {
  const cells: Record<string, SheetCell> = {};
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const coordinate = parseAddress(address);
    if (!coordinate) continue;
    const current = axis === "row" ? coordinate.row : coordinate.column;
    if (delta === -1 && current === at) continue;
    if (current >= at) {
      if (axis === "row") coordinate.row += delta;
      else coordinate.column += delta;
    }
    if (coordinate.row < 0 || coordinate.column < 0) continue;
    cells[coordinateToAddress(coordinate)] = {
      ...cell,
      ...(cell.formula
        ? {
            formula: rewriteStructuralReferences(
              cell.formula,
              axis,
              at,
              delta,
              {
                sheetName: sheet.name,
                unqualified: true,
              },
            ),
          }
        : {}),
    };
  }
  const rewriteRange = (range: string) =>
    shiftStructuralRange(range, axis, at, delta);
  const shiftColumnIndex = (column: number) => {
    if (axis !== "column") return column;
    if (delta === -1 && column === at) return null;
    return column >= at ? column + delta : column;
  };
  return {
    ...sheet,
    cells,
    tables: sheet.tables.flatMap((table) => {
      const range = rewriteRange(table.range);
      if (!range) return [];
      const filters = table.filters?.flatMap((filter) => {
        const column = shiftColumnIndex(filter.column);
        return column === null ? [] : [{ ...filter, column }];
      });
      const sortColumn = table.sort
        ? shiftColumnIndex(table.sort.column)
        : undefined;
      return [
        {
          ...table,
          range,
          filters,
          ...(table.sort && sortColumn !== null && sortColumn !== undefined
            ? { sort: { ...table.sort, column: sortColumn } }
            : { sort: undefined }),
        },
      ];
    }),
    charts: sheet.charts.flatMap((chart) => {
      const sourceRange = rewriteRange(chart.sourceRange);
      return sourceRange ? [{ ...chart, sourceRange }] : [];
    }),
    mergedRanges: (sheet.mergedRanges ?? []).flatMap((range) => {
      const shifted = rewriteRange(range);
      return shifted ? [shifted] : [];
    }),
    conditionalFormats: (sheet.conditionalFormats ?? []).flatMap((rule) => {
      const range = rewriteRange(rule.range);
      return range ? [{ ...rule, range }] : [];
    }),
    rowCount:
      axis === "row"
        ? Math.max(1, (sheet.rowCount ?? 100) + delta)
        : sheet.rowCount,
    columnCount:
      axis === "column"
        ? Math.max(1, (sheet.columnCount ?? 26) + delta)
        : sheet.columnCount,
    hiddenRows:
      axis === "row"
        ? shiftIndexList(sheet.hiddenRows, at, delta)
        : sheet.hiddenRows,
    hiddenColumns:
      axis === "column"
        ? shiftIndexList(sheet.hiddenColumns, at, delta)
        : sheet.hiddenColumns,
    rowHeights:
      axis === "row"
        ? shiftNumericKeyMap(sheet.rowHeights, at, delta)
        : sheet.rowHeights,
    columnWidths:
      axis === "column"
        ? shiftNumericKeyMap(sheet.columnWidths, at, delta)
        : sheet.columnWidths,
    rowIdentities:
      axis === "row"
        ? shiftIdentityMap(
            sheet.rowIdentities,
            at,
            delta,
            `row-${crypto.randomUUID()}`,
            sheet.rowCount ?? 100,
            `${sheet.id}:row`,
          )
        : sheet.rowIdentities,
    columnIdentities:
      axis === "column"
        ? shiftIdentityMap(
            sheet.columnIdentities,
            at,
            delta,
            `column-${crypto.randomUUID()}`,
            sheet.columnCount ?? 26,
            `${sheet.id}:column`,
          )
        : sheet.columnIdentities,
  };
}

function rewriteNamedRangeRef(
  ref: string,
  rewrite: (formula: string) => string,
) {
  const prefixed = ref.trimStart().startsWith("=") ? ref : `=${ref}`;
  const next = rewrite(prefixed);
  return ref.trimStart().startsWith("=") ? next : next.replace(/^=/, "");
}

/**
 * Insert or delete a row/column on one sheet, then rewrite every formula and
 * named range in the workbook that names that sheet. Unqualified refs on other
 * sheets stay put — they belong to those sheets.
 */
export function mutateWorkbookAxis(
  content: SheetsContent,
  sheetId: string,
  axis: "row" | "column",
  at: number,
  delta: 1 | -1,
): SheetsContent {
  const target = content.sheets.find((sheet) => sheet.id === sheetId);
  if (!target) return content;
  const sheetName = target.name;
  return {
    ...content,
    sheets: content.sheets.map((sheet) => {
      if (sheet.id === sheetId) return mutateSheetAxis(sheet, axis, at, delta);
      const cells: Record<string, SheetCell> = {};
      for (const [address, cell] of Object.entries(sheet.cells)) {
        cells[address] = cell.formula
          ? {
              ...cell,
              formula: rewriteStructuralReferences(
                cell.formula,
                axis,
                at,
                delta,
                { sheetName, unqualified: false },
              ),
            }
          : cell;
      }
      return { ...sheet, cells };
    }),
    workbook: {
      ...content.workbook,
      namedRanges: Object.fromEntries(
        Object.entries(content.workbook.namedRanges ?? {}).map(
          ([name, ref]) => [
            name,
            rewriteNamedRangeRef(ref, (formula) =>
              rewriteStructuralReferences(formula, axis, at, delta, {
                sheetName,
                unqualified: false,
              }),
            ),
          ],
        ),
      ),
    },
  };
}

/** Renames a sheet and rewrites every formula and named range that pointed at it. */
export function renameWorkbookSheet(
  content: SheetsContent,
  sheetId: string,
  newName: string,
): SheetsContent {
  const target = content.sheets.find((sheet) => sheet.id === sheetId);
  if (!target || target.name === newName) return content;
  const oldName = target.name;
  return {
    ...content,
    sheets: content.sheets.map((sheet) => {
      const renamed =
        sheet.id === sheetId ? { ...sheet, name: newName } : sheet;
      const cells: Record<string, SheetCell> = {};
      for (const [address, cell] of Object.entries(renamed.cells)) {
        cells[address] = cell.formula
          ? {
              ...cell,
              formula: rewriteSheetNameInFormula(
                cell.formula,
                oldName,
                newName,
              ),
            }
          : cell;
      }
      return { ...renamed, cells };
    }),
    workbook: {
      ...content.workbook,
      namedRanges: Object.fromEntries(
        Object.entries(content.workbook.namedRanges ?? {}).map(
          ([name, ref]) => [
            name,
            rewriteNamedRangeRef(ref, (formula) =>
              rewriteSheetNameInFormula(formula, oldName, newName),
            ),
          ],
        ),
      ),
    },
  };
}
