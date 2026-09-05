"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Italic,
  Text as TextIcon,
  Trash2,
  TriangleAlert,
  Underline,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell as ChartCell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  columnName,
  coordinateToAddress,
  formatCalculatedCell,
  mutateWorkbookAxis,
  normalizeRange,
  normalizeSheetsContent,
  parseAddress,
  parseDelimited,
  parseRange,
  rangeAddresses,
  rangeArea,
  rangeLabel,
  RANGE_WALK_LIMIT,
  renameWorkbookSheet,
  sheetsCalculation,
  type CellCoordinate,
  type SheetBorderEdge,
  type SheetCellFormat,
  type SheetNumberFormat,
  type SheetTable,
  type CellRange,
  type SheetCell,
  type SheetChart,
  type SheetConditionalFormat,
  type SheetScalar,
  type SheetValidation,
  type SheetsCalculation,
  type SheetsContent,
  type WorkbookSheet,
} from "../sheets/model";
import { exportOds, importOds } from "../sheets/ods";
import {
  downloadDocumentBlob,
  downloadDocumentText,
} from "./artifact-studio-file-utils";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  uploadArtifactImportOriginal,
} from "../data/api";
import {
  aiRegionAttr,
  pathTouches,
  sheetsAiTouchesCell,
  sheetsAiTouchesColumn,
} from "./ai-region-path";
import { partAttrs, targetAttrs } from "../collaboration/target-attributes";
import { SelectField } from "@/components/ui/select";
import {
  ArtifactWorkbar,
  WorkbarItemSelector,
  type CommandBinding,
} from "./artifact-workbar";
import { getWorkDefinition } from "../work/registry";
import { commandContext, dispatchStudioCommand } from "../commands";
import type { CommandParam } from "../commands/types";
import { SHEETS_EXPORT_COPIES } from "../capabilities";
import {
  SHEETS_BORDER_PRESETS,
  SHEETS_BORDER_STYLES,
  SHEETS_CURRENCIES,
  SHEETS_FUNCTION_LIBRARY,
  SHEETS_NUMBER_FORMATS,
  sheetsCommandBindings,
  type SheetsCommandHandlers,
} from "../commands/office/sheets-commands";
import {
  applyBorderPreset,
  applyCachedStaleness,
  applyCellFormat,
  clearCells,
  duplicateRowIndices,
  fillRange,
  fillSeries,
  formulaLiteralizationAddresses,
  isFormulaLiteralization,
  isPreservedFormula,
  offsetCellToRow,
  offsetFormula,
  parseCellInput,
  pasteBlock,
  replaceInCells,
  sortRows,
  splitColumn,
  FORMULA_LITERALIZATION_MESSAGE,
  type CellsResult,
  type ClipboardBlock,
  type SortKey,
} from "../sheets/operations";
import {
  useStudioContract,
  type StudioContract,
} from "./artifact-studio-shell";
import {
  changedSheetCellAddresses,
  patchSheetCellRecord,
  readSheetCellsOverlay,
} from "../sheets/cell-overlay";

const ROW_HEIGHT = 31;
const COLUMN_WIDTH = 122;
const ROW_HEADER_WIDTH = 46;
const COLUMN_HEADER_HEIGHT = 30;
const MIN_COLUMN_WIDTH = 34;
const MIN_ROW_HEIGHT = 20;
const MAX_COLUMN_WIDTH = 480;
const MAX_ROW_HEIGHT = 220;
const CELL_INLINE_PAD = 20;
const CELL_BLOCK_PAD = 10;
const CHART_COLORS = ["#169b69", "#7066ed", "#db7b27", "#2f8fd2", "#b85d7a"];

let sheetMeasureContext: CanvasRenderingContext2D | null | undefined;

function measureSheetText(text: string, font: string) {
  if (!text) return 0;
  if (typeof document === "undefined") {
    return text.length * 7;
  }
  if (sheetMeasureContext === undefined) {
    sheetMeasureContext = document.createElement("canvas").getContext("2d");
  }
  if (!sheetMeasureContext) return text.length * 7;
  sheetMeasureContext.font = font;
  return sheetMeasureContext.measureText(text).width;
}

function fittedColumnWidth(contentWidth: number, hasContent: boolean) {
  if (!hasContent) return COLUMN_WIDTH;
  return Math.round(
    Math.min(
      MAX_COLUMN_WIDTH,
      Math.max(MIN_COLUMN_WIDTH, contentWidth + CELL_INLINE_PAD),
    ),
  );
}

function fittedRowHeight(
  lineCount: number,
  fontSize: number,
  hasContent: boolean,
) {
  if (!hasContent) return ROW_HEIGHT;
  return Math.round(
    Math.min(
      MAX_ROW_HEIGHT,
      Math.max(
        MIN_ROW_HEIGHT,
        Math.ceil(lineCount * fontSize * 1.35 + CELL_BLOCK_PAD),
      ),
    ),
  );
}

/** The registry owns the empty-state words, so every surface says the same one. */
const emptyState = getWorkDefinition("sheets").emptyState;

/**
 * One shape rule for the inspector: the rail itself is flush with the frame it
 * overlays, every control inside it is `rounded-control`, and the only filled
 * button is the one that commits. Kept as constants so a new panel cannot
 * quietly introduce a fourth button treatment.
 */
const PANEL_BUTTON =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-control border border-[var(--border-default)] px-2.5 text-caption font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] active:translate-y-px disabled:pointer-events-none disabled:opacity-45";
const PANEL_PRIMARY =
  "inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-control bg-[var(--text-primary)] px-2.5 text-caption font-semibold text-[var(--bg-primary)] transition-opacity hover:opacity-90 active:translate-y-px disabled:pointer-events-none disabled:opacity-45";
const PANEL_INPUT =
  "h-8 w-full min-w-0 rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-ui text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]";
const PANEL_LABEL =
  "mb-1.5 block text-caption font-medium text-[var(--text-secondary)]";

/**
 * Cumulative pixel offsets for a run of tracks, so a column the user has
 * widened moves every column after it instead of overlapping its neighbour.
 * `offsets[i]` is the start of track `i` and `offsets[count]` is the total.
 */
function trackOffsets(
  count: number,
  size: (index: number) => number,
): number[] {
  const offsets = new Array<number>(count + 1);
  offsets[0] = 0;
  for (let index = 0; index < count; index += 1)
    offsets[index + 1] = offsets[index]! + size(index);
  return offsets;
}

/** The track containing a scroll offset. Binary search: 26 columns or 100,000. */
function trackAtOffset(offsets: number[], value: number) {
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle]! <= value) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
}

/**
 * The studio contract, or `null` when there is no shell above us.
 *
 * `useStudioContract` throws by design, and the landing page renders this exact
 * studio outside the provider so the marketing surface is the product rather
 * than a replica (D19). Catching here keeps one implementation (D21) instead of
 * forking a landing-only sheet; the hook itself still runs on every render, so
 * hook order never changes.
 */
function useShellContract(): StudioContract | null {
  try {
    return useStudioContract();
  } catch {
    return null;
  }
}

async function sheetsBlobSha256(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type Viewport = {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
  scrollLeft: number;
  scrollTop: number;
};

function cellSame(left?: SheetCell, right?: SheetCell) {
  if (left === right) return true;
  if (!left || !right) return !left && !right;
  return (
    left.value === right.value &&
    left.formula === right.formula &&
    left.format === right.format &&
    left.nativeFormulaSupport === right.nativeFormulaSupport
  );
}

function sheetHasCells(cells: Record<string, SheetCell>) {
  for (const key in cells) return true;
  return false;
}

function sameContent(left: SheetsContent, right: SheetsContent) {
  if (left === right) return true;
  if (left.activeSheetId !== right.activeSheetId) return false;
  if (left.sheets.length !== right.sheets.length) return false;
  return left.sheets.every((sheet, index) => {
    const other = right.sheets[index];
    if (!other) return false;
    if (sheet === other) return true;
    if (sheet.id !== other.id || sheet.name !== other.name) return false;
    if (sheet.cells === other.cells) return true;
    const hinted = changedSheetCellAddresses(sheet.cells, other.cells);
    if (hinted) {
      return hinted.every((address) =>
        cellSame(sheet.cells[address], other.cells[address]),
      );
    }
    const leftKeys = Object.keys(sheet.cells);
    const rightKeys = Object.keys(other.cells);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (address) =>
        Object.prototype.hasOwnProperty.call(other.cells, address) &&
        cellSame(sheet.cells[address], other.cells[address]),
    );
  });
}

function workbookIdentityKey(content: SheetsContent) {
  let hash = 2166136261;
  const mix = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };
  mix(content.activeSheetId);
  mix(String(content.sheets.length));
  for (const sheet of content.sheets) {
    mix(sheet.id);
    mix(sheet.name);
    const overlay = readSheetCellsOverlay(sheet.cells);
    if (overlay) {
      mix("overlay");
      mix(String(Object.keys(overlay.patch).length));
      for (const address of Object.keys(overlay.patch).sort()) {
        const cell = overlay.patch[address];
        mix(address);
        mix(String(cell?.value ?? ""));
        mix(cell?.formula ?? "");
      }
      continue;
    }
    const addresses = Object.keys(sheet.cells);
    mix(String(addresses.length));
    for (const address of addresses) {
      const cell = sheet.cells[address];
      mix(address);
      mix(String(cell?.value ?? ""));
      mix(cell?.formula ?? "");
      mix(cell?.format ? JSON.stringify(cell.format) : "");
    }
  }
  return (hash >>> 0).toString(36);
}

function cellInput(cell?: SheetCell) {
  if (cell?.formula)
    return cell.formula.startsWith("=") ? cell.formula : `=${cell.formula}`;
  return cell?.value === null || cell?.value === undefined
    ? ""
    : String(cell.value);
}

function selected(range: CellRange, row: number, column: number) {
  const normalized = normalizeRange(range);
  return (
    row >= normalized.start.row &&
    row <= normalized.end.row &&
    column >= normalized.start.column &&
    column <= normalized.end.column
  );
}

function aiTouches(paths: string[], sheetIndex: number, address: string) {
  return sheetsAiTouchesCell(paths, sheetIndex, address);
}

function replaceSheet(
  content: SheetsContent,
  sheet: WorkbookSheet,
): SheetsContent {
  return {
    ...content,
    sheets: content.sheets.map((candidate) =>
      candidate.id === sheet.id ? sheet : candidate,
    ),
  };
}

function usedBounds(sheet: WorkbookSheet) {
  const declaredRows = Number(sheet.rowCount) || 0;
  const declaredColumns = Number(sheet.columnCount) || 0;
  if (declaredRows >= 64 && declaredColumns >= 8) {
    return {
      rows: Math.max(20, declaredRows),
      columns: Math.max(9, declaredColumns),
    };
  }
  let maxRow = 20;
  let maxColumn = 9;
  for (const address of Object.keys(sheet.cells)) {
    const coordinate = parseAddress(address);
    if (!coordinate) continue;
    maxRow = Math.max(maxRow, coordinate.row + 12);
    maxColumn = Math.max(maxColumn, coordinate.column + 5);
  }
  return {
    rows: Math.max(sheet.rowCount ?? 100, maxRow),
    columns: Math.max(sheet.columnCount ?? 26, maxColumn),
  };
}

function csvEscape(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function occupiedBounds(sheet: WorkbookSheet) {
  let rows = 1;
  let columns = 1;
  for (const address of Object.keys(sheet.cells)) {
    const coordinate = parseAddress(address);
    if (!coordinate) continue;
    rows = Math.max(rows, coordinate.row + 1);
    columns = Math.max(columns, coordinate.column + 1);
  }
  return { rows, columns };
}

function cellIsOccupied(cell?: SheetCell) {
  return Boolean(
    cell?.formula ||
    (cell?.value !== undefined && cell?.value !== null && cell?.value !== ""),
  );
}

function currentRegion(
  sheet: WorkbookSheet,
  origin: CellCoordinate,
): CellRange {
  const occupied = new Set<string>();
  for (const [address, cell] of Object.entries(sheet.cells)) {
    if (cellIsOccupied(cell)) occupied.add(address);
  }
  const originAddress = coordinateToAddress(origin);
  if (!occupied.has(originAddress)) {
    return { start: origin, end: origin };
  }
  const seen = new Set<string>();
  const queue: CellCoordinate[] = [origin];
  let minRow = origin.row;
  let maxRow = origin.row;
  let minColumn = origin.column;
  let maxColumn = origin.column;
  while (queue.length) {
    const current = queue.pop()!;
    const key = coordinateToAddress(current);
    if (seen.has(key)) continue;
    seen.add(key);
    minRow = Math.min(minRow, current.row);
    maxRow = Math.max(maxRow, current.row);
    minColumn = Math.min(minColumn, current.column);
    maxColumn = Math.max(maxColumn, current.column);
    for (const rowDelta of [-1, 0, 1]) {
      for (const columnDelta of [-1, 0, 1]) {
        if (rowDelta === 0 && columnDelta === 0) continue;
        const next = {
          row: current.row + rowDelta,
          column: current.column + columnDelta,
        };
        if (next.row < 0 || next.column < 0) continue;
        const nextKey = coordinateToAddress(next);
        if (occupied.has(nextKey) && !seen.has(nextKey)) queue.push(next);
      }
    }
  }
  return {
    start: { row: minRow, column: minColumn },
    end: { row: maxRow, column: maxColumn },
  };
}

function rangesOverlap(left: CellRange, right: CellRange) {
  const a = normalizeRange(left);
  const b = normalizeRange(right);
  return !(
    a.end.row < b.start.row ||
    a.start.row > b.end.row ||
    a.end.column < b.start.column ||
    a.start.column > b.end.column
  );
}

function interpolateHexColor(start: string, end: string, amount: number) {
  const parse = (value: string) => {
    const normalized = value.trim().replace(/^#/, "");
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return [255, 255, 255];
    return [0, 2, 4].map((offset) =>
      Number.parseInt(normalized.slice(offset, offset + 2), 16),
    );
  };
  const from = parse(start);
  const to = parse(end);
  const ratio = Math.max(0, Math.min(1, amount));
  return `#${from
    .map((channel, index) =>
      Math.round(channel + (to[index]! - channel) * ratio)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function chartCellValue(
  sheet: WorkbookSheet,
  calculated: SheetsCalculation,
  row: number,
  column: number,
) {
  const address = coordinateToAddress({ row, column });
  return (
    calculated.get(`${sheet.id}:${address}`)?.value ??
    sheet.cells[address]?.value ??
    null
  );
}

function chartFirstRowIsHeader(
  sheet: WorkbookSheet,
  range: CellRange,
  calculated: SheetsCalculation,
) {
  for (
    let column = range.start.column;
    column <= range.end.column;
    column += 1
  ) {
    const value = chartCellValue(sheet, calculated, range.start.row, column);
    if (typeof value === "number") continue;
    if (value !== null && value !== undefined && String(value).trim() !== "")
      return true;
  }
  return false;
}

export function chartDataset(
  sheet: WorkbookSheet,
  chart: SheetChart,
  calculated: SheetsCalculation,
) {
  const range = parseRange(chart.sourceRange.split("!").at(-1) ?? "");
  if (!range) return { data: [], keys: [] as string[], category: "Category" };
  const normalized = normalizeRange(range);
  const hasHeader = chartFirstRowIsHeader(sheet, normalized, calculated);
  const headers: string[] = [];
  for (
    let column = normalized.start.column;
    column <= normalized.end.column;
    column += 1
  ) {
    if (hasHeader) {
      const address = coordinateToAddress({
        row: normalized.start.row,
        column,
      });
      headers.push(
        formatCalculatedCell(
          sheet.cells[address],
          calculated.get(`${sheet.id}:${address}`),
          "en-US",
        ) || columnName(column),
      );
    } else {
      headers.push(
        normalized.end.column === normalized.start.column
          ? "Value"
          : columnName(column),
      );
    }
  }
  const singleSeries = headers.length === 1;
  const data = [];
  const dataStart = hasHeader ? normalized.start.row + 1 : normalized.start.row;
  const rowCount = Math.max(0, normalized.end.row - dataStart + 1);
  let labelColumn = -1;
  if ((singleSeries || !hasHeader) && rowCount) {
    for (let column = normalized.start.column - 1; column >= 0; column -= 1) {
      let textCount = 0;
      for (let row = dataStart; row <= normalized.end.row; row += 1) {
        const value = chartCellValue(sheet, calculated, row, column);
        if (typeof value === "string" && value.trim() !== "") textCount += 1;
      }
      if (textCount >= Math.ceil(rowCount / 2)) {
        labelColumn = column;
        break;
      }
    }
  }
  for (let row = dataStart; row <= normalized.end.row; row += 1) {
    const side =
      labelColumn >= 0
        ? chartCellValue(sheet, calculated, row, labelColumn)
        : null;
    const categoryLabel =
      typeof side === "string" && side.trim()
        ? side
        : String(row - dataStart + 1);
    const entry: Record<string, string | number> =
      singleSeries || !hasHeader ? { Category: categoryLabel } : {};
    for (
      let column = normalized.start.column;
      column <= normalized.end.column;
      column += 1
    ) {
      const value = chartCellValue(sheet, calculated, row, column);
      entry[headers[column - normalized.start.column]!] =
        typeof value === "number" ? value : String(value ?? "");
    }
    data.push(entry);
  }
  if (singleSeries) return { data, category: "Category", keys: headers };
  if (hasHeader)
    return {
      data,
      category: headers[0] ?? "Category",
      keys: headers.slice(1),
    };
  return { data, category: "Category", keys: headers };
}

function chartSummary(
  sheet: WorkbookSheet,
  chart: SheetChart,
  calculated: SheetsCalculation,
) {
  const dataset = chartDataset(sheet, chart, calculated);
  const values =
    chart.type === "histogram"
      ? numericValuesForRange(sheet, chart, calculated)
      : dataset.data.flatMap((entry) =>
          dataset.keys.flatMap((key) =>
            typeof entry[key] === "number" ? [entry[key] as number] : [],
          ),
        );
  if (!values.length)
    return {
      count: dataset.data.length,
      mean: null,
      min: null,
      max: null,
      standardDeviation: null,
    };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: dataset.data.length,
    mean,
    min: Math.min(...values),
    max: Math.max(...values),
    standardDeviation: Math.sqrt(
      values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
        values.length,
    ),
  };
}

function numericValuesForRange(
  sheet: WorkbookSheet,
  chart: SheetChart,
  calculated: SheetsCalculation,
) {
  const range = parseRange(chart.sourceRange.split("!").at(-1) ?? "");
  if (!range) return [];
  const normalized = normalizeRange(range);
  const hasHeader = chartFirstRowIsHeader(sheet, normalized, calculated);
  const values: number[] = [];
  for (
    let row = hasHeader ? normalized.start.row + 1 : normalized.start.row;
    row <= normalized.end.row;
    row += 1
  ) {
    for (
      let column = normalized.start.column;
      column <= normalized.end.column;
      column += 1
    ) {
      const address = coordinateToAddress({ row, column });
      const value =
        calculated.get(`${sheet.id}:${address}`)?.value ??
        sheet.cells[address]?.value;
      if (typeof value === "number" && Number.isFinite(value))
        values.push(value);
    }
  }
  return values;
}

function histogramDataset(
  sheet: WorkbookSheet,
  chart: SheetChart,
  calculated: SheetsCalculation,
) {
  const values = numericValuesForRange(sheet, chart, calculated);
  if (!values.length) return [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum)
    return [{ bucket: String(minimum), count: values.length }];
  const binCount = Math.max(
    3,
    Math.min(30, Math.ceil(Math.sqrt(values.length))),
  );
  const width = (maximum - minimum) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    lower: minimum + index * width,
    upper: index === binCount - 1 ? maximum : minimum + (index + 1) * width,
    count: 0,
  }));
  values.forEach((value) => {
    const index = Math.min(binCount - 1, Math.floor((value - minimum) / width));
    bins[index]!.count += 1;
  });
  const precision = Math.max(
    0,
    Math.min(6, Math.ceil(-Math.log10(Math.abs(width))) + 1),
  );
  return bins.map((bin) => ({
    bucket: `${bin.lower.toFixed(precision)} to ${bin.upper.toFixed(precision)}`,
    count: bin.count,
  }));
}

function formatChartTick(value: string | number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  const text = String(value ?? "");
  return text.length > 10 ? `${text.slice(0, 9)}…` : text;
}

function SheetsChartView({
  sheet,
  chart,
  calculated,
}: {
  sheet: WorkbookSheet;
  chart: SheetChart;
  calculated: SheetsCalculation;
}) {
  const dataset = chartDataset(sheet, chart, calculated);
  const tick = {
    fontSize: 10,
    fill: "var(--text-secondary)",
    fontFamily: "inherit",
  };
  const axisStroke = { stroke: "var(--border-default)" };
  const common = {
    data: dataset.data,
    margin: { top: 8, right: 10, left: 2, bottom: 4 },
  };
  const chartAxes = [
    <CartesianGrid
      key="grid"
      stroke="color-mix(in oklab, var(--text-primary) 14%, transparent)"
      vertical={false}
    />,
    <XAxis
      key="x"
      dataKey={dataset.category}
      tick={tick}
      tickFormatter={formatChartTick}
      tickLine={axisStroke}
      axisLine={axisStroke}
      interval="preserveStartEnd"
      angle={dataset.data.length > 5 ? -36 : 0}
      textAnchor={dataset.data.length > 5 ? "end" : "middle"}
      height={dataset.data.length > 5 ? 48 : 28}
      minTickGap={12}
    />,
    <YAxis
      key="y"
      width={44}
      tick={tick}
      tickFormatter={formatChartTick}
      tickLine={axisStroke}
      axisLine={axisStroke}
      allowDecimals
      domain={["auto", "auto"]}
    />,
    <ChartTooltip
      key="tip"
      formatter={(value) =>
        typeof value === "number" ? formatChartTick(value) : value
      }
    />,
    dataset.keys.length > 1 ? (
      <Legend key="legend" wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
    ) : null,
  ];
  if (chart.type === "histogram") {
    const histogram = histogramDataset(sheet, chart, calculated);
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={histogram}
          margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
          barCategoryGap={1}
        >
          <CartesianGrid
            stroke="var(--border-subtle)"
            vertical={false}
            strokeDasharray="3 4"
          />
          <XAxis
            dataKey="bucket"
            tick={tick}
            tickLine={axisStroke}
            axisLine={axisStroke}
            interval={0}
            angle={dataset.data.length > 6 ? -24 : 0}
            textAnchor={dataset.data.length > 6 ? "end" : "middle"}
            height={dataset.data.length > 6 ? 40 : 28}
          />
          <YAxis
            width={36}
            allowDecimals={false}
            tick={tick}
            tickLine={axisStroke}
            axisLine={axisStroke}
          />
          <ChartTooltip />
          <Bar dataKey="count" name="Frequency" fill={CHART_COLORS[0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "scatter") {
    const xKey = dataset.category;
    const yKey = dataset.keys[0];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart {...common}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 4" />
          <XAxis
            type="number"
            dataKey={xKey}
            name={xKey}
            tick={tick}
            tickFormatter={formatChartTick}
            tickLine={axisStroke}
            axisLine={axisStroke}
            height={28}
          />
          <YAxis
            type="number"
            dataKey={yKey}
            name={yKey}
            width={44}
            tick={tick}
            tickFormatter={formatChartTick}
            tickLine={axisStroke}
            axisLine={axisStroke}
          />
          <ChartTooltip
            cursor={{ strokeDasharray: "3 3" }}
            formatter={(value) =>
              typeof value === "number" ? formatChartTick(value) : value
            }
          />
          <Scatter
            name={yKey || chart.title}
            data={dataset.data}
            fill={CHART_COLORS[0]}
          />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "combo") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart {...common}>
          {chartAxes}
          {dataset.keys[0] ? (
            <Bar
              dataKey={dataset.keys[0]}
              fill={CHART_COLORS[0]}
              fillOpacity={0.3}
              radius={[3, 3, 0, 0]}
            />
          ) : null}
          {dataset.keys.slice(1).map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={CHART_COLORS[(index + 1) % CHART_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "pie") {
    const key = dataset.keys[0];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={dataset.data}
            dataKey={key}
            nameKey={dataset.category}
            innerRadius="36%"
            outerRadius="72%"
            paddingAngle={2}
          >
            {dataset.data.map((_, index) => (
              <ChartCell
                key={index}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
              />
            ))}
          </Pie>
          <ChartTooltip />
          <Legend wrapperStyle={{ fontSize: 10 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "bar" || chart.type === "column")
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          {...common}
          layout={chart.type === "bar" ? "vertical" : "horizontal"}
        >
          {chartAxes}
          {dataset.keys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              fill={CHART_COLORS[index % CHART_COLORS.length]}
              radius={[3, 3, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  if (chart.type === "area")
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart {...common}>
          {chartAxes}
          {dataset.keys.map((key, index) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stroke={CHART_COLORS[index % CHART_COLORS.length]}
              fill={CHART_COLORS[index % CHART_COLORS.length]}
              fillOpacity={0.12}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart {...common}>
        {chartAxes}
        {dataset.keys.map((key, index) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={CHART_COLORS[index % CHART_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
  disabled = false,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`sheets-toolbar-button ${active ? "is-active" : ""}`}
    >
      {children}
    </button>
  );
}

/**
 * The grip a column or row is resized by. It is a descendant of the header it
 * belongs to and carries `data-spectra-part`, which is what
 * `control-descriptors` already declares for `/sheets/*\/columns/*` (`handle:e`)
 * and `/sheets/*\/rows/*` (`handle:s`) — the attribute used to sit on the header
 * button itself, where `resolvePart` could never find it.
 */
function SheetsTrackGrip({
  axis,
  label,
  onBegin,
  onFit,
}: {
  axis: "column" | "row";
  label: string;
  onBegin: (event: ReactPointerEvent) => void;
  onFit: () => void;
}) {
  return (
    <span
      {...partAttrs(axis === "column" ? "handle:e" : "handle:s")}
      role="separator"
      aria-orientation={axis === "column" ? "vertical" : "horizontal"}
      aria-label={label}
      title={`${label}. Double-click to fit.`}
      data-axis={axis}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.detail > 1) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        onBegin(event);
      }}
      onClick={(event) => {
        if (event.detail !== 2) return;
        event.preventDefault();
        event.stopPropagation();
        onFit();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onFit();
      }}
      className={
        axis === "column"
          ? "sheets-track-grip absolute inset-y-0 right-0 z-chrome w-2"
          : "sheets-track-grip absolute inset-x-0 bottom-0 z-chrome h-2"
      }
    />
  );
}

type SheetsCellHandlers = {
  onPointerDown: (
    coordinate: CellCoordinate,
    event: ReactPointerEvent,
    merged: { range: CellRange } | undefined,
  ) => void;
  onPointerEnter: (coordinate: CellCoordinate) => void;
  onFillHandlePointerDown: (
    event: ReactPointerEvent,
    selection: CellRange,
    cells: Record<string, SheetCell>,
  ) => void;
};

/** CSS for one border edge, or nothing when the edge is unset. */
function borderCss(edge: SheetBorderEdge | null | undefined) {
  if (!edge) return undefined;
  const width =
    edge.style === "thick"
      ? "3px"
      : edge.style === "medium" || edge.style === "double"
        ? "2px"
        : "1px";
  const line =
    edge.style === "dashed"
      ? "dashed"
      : edge.style === "dotted" || edge.style === "hair"
        ? "dotted"
        : edge.style === "double"
          ? "double"
          : "solid";
  return `${width} ${line} ${edge.color ?? "var(--text-primary)"}`;
}

/**
 * Everything a cell's stored format asks the grid to paint.
 *
 * This used to be an inline object that honoured eight of the sixteen fields the
 * model can hold, so a border, a rotation, a wrap or a real font stack was
 * stored, exported and never drawn — the format commands wrote state nothing
 * could see. One helper now covers every field, which also means a fixture can
 * assert what a format command does without mounting the grid.
 */
function cellVisualStyle(
  format: SheetCell["format"],
  zoom: number,
): CSSProperties {
  if (!format) return {};
  const borders = format.borders;
  const decoration = [
    format.underline ? "underline" : null,
    format.strike ? "line-through" : null,
  ].filter(Boolean);
  return {
    fontWeight: format.bold ? 700 : undefined,
    fontStyle: format.italic ? "italic" : undefined,
    textDecoration: decoration.length ? decoration.join(" ") : undefined,
    textAlign: format.align,
    alignItems:
      format.verticalAlign === "top"
        ? "flex-start"
        : format.verticalAlign === "bottom"
          ? "flex-end"
          : undefined,
    justifyContent:
      format.align === "center"
        ? "center"
        : format.align === "right"
          ? "flex-end"
          : undefined,
    whiteSpace: format.wrap ? "pre-wrap" : undefined,
    // Wrapped text needs a line box narrower than the cell to break inside it.
    lineHeight: format.wrap ? 1.25 : undefined,
    paddingLeft: format.indent ? 8 + format.indent * 8 : undefined,
    // Rotation is stated the way the Excel dialog states it: positive is
    // counter-clockwise, which is the opposite sign to CSS.
    transform: format.rotation ? `rotate(${-format.rotation}deg)` : undefined,
    fontFamily:
      format.fontFamily === "serif"
        ? "var(--font-serif), ui-sans-serif, system-ui, sans-serif"
        : format.fontFamily === "mono"
          ? "ui-monospace, SFMono-Regular, Consolas, monospace"
          : format.fontFamily === "sans"
            ? "var(--font-sans), ui-sans-serif, system-ui, sans-serif"
            : format.fontFamily,
    fontSize: format.fontSize ? format.fontSize * zoom : undefined,
    borderTop: borderCss(borders?.top),
    borderRight: borderCss(borders?.right),
    borderBottom: borderCss(borders?.bottom),
    borderLeft: borderCss(borders?.left),
  };
}

function SheetsCellPointerTarget({
  handlersRef,
  coordinate,
  targetPath,
  merged,
  className,
  style,
  children,
  onDoubleClick,
  ...rest
}: {
  handlersRef: MutableRefObject<SheetsCellHandlers>;
  coordinate: CellCoordinate;
  targetPath: string;
  merged?: { range: CellRange };
  className?: string;
  style?: CSSProperties;
  children: React.ReactNode;
  onDoubleClick?: () => void;
} & Record<string, unknown>) {
  return (
    <div
      {...rest}
      {...targetAttrs(targetPath)}
      className={className}
      style={style}
      onPointerDown={(event) =>
        handlersRef.current.onPointerDown(coordinate, event, merged)
      }
      onPointerEnter={() => handlersRef.current.onPointerEnter(coordinate)}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </div>
  );
}

function SheetsFillHandle({
  handlersRef,
  selection,
  cells,
  selectionLabel,
  targetPath,
}: {
  handlersRef: MutableRefObject<SheetsCellHandlers>;
  selection: CellRange;
  cells: Record<string, SheetCell>;
  selectionLabel: string;
  targetPath: string;
}) {
  return (
    <button
      type="button"
      className="sheets-fill-handle"
      aria-label={`Fill from ${selectionLabel}`}
      title="Drag to fill values and formulas"
      {...targetAttrs(targetPath, "fill")}
      onPointerDown={(event) =>
        handlersRef.current.onFillHandlePointerDown(event, selection, cells)
      }
    />
  );
}

export const SheetsStudio = memo(function SheetsStudio({
  artifactId,
  content,
  onChange,
  aiChangedPaths = [],
  readOnly = false,
  mode = "tab",
  synchronizationReady = true,
  // Save state belongs to the shared rail above this studio, not to a status bar
  // of our own. The prop stays in the signature because the shell passes it to
  // every type; the sheet deliberately does not print it a second time.
  syncMessage: _syncMessage = "Auto-saved",
  onActiveRegionChange,
}: {
  artifactId: string;
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly?: boolean;
  /** A side panel gets the data and the selection, not the whole rig (§11F). */
  mode?: "split" | "tab";
  synchronizationReady?: boolean;
  syncMessage?: string;
  onActiveRegionChange?: (regionId: string) => void;
}) {
  /**
   * Permissions come from the shell contract and nowhere else: not from `mode`,
   * not from the pane width, not from this file's own opinion. A side panel and
   * a fullscreen tab have identical capabilities (D4).
   */
  const contract = useShellContract();
  const protectNativeFormulas =
    contract?.compatibilityProfile === "strict-native";
  const rootRef = useRef<HTMLDivElement>(null);
  const canEditCells = contract ? contract.can("edit") : !readOnly;
  const grantLocked = readOnly || !canEditCells;
  const density = contract?.density ?? "comfortable";
  /** Registry-declared peer views. Both edit; neither is a reading mode (D2). */
  const [sheetMode, setSheetMode] = useState("grid");
  const analysing = sheetMode === "analysis";
  const incoming = useMemo(() => normalizeSheetsContent(content), [content]);
  const [workbook, setWorkbook] = useState(incoming);
  // Keep the last committed workbook available to event handlers without
  // relying on a React state-updater callback. Parent notifications from an
  // updater run during React's render work and can be dropped or warn when
  // ArtifactStudioEditor updates in response.
  const workbookRef = useRef(workbook);
  workbookRef.current = workbook;
  const [range, setRange] = useState<CellRange>({
    start: { row: 0, column: 0 },
    end: { row: 0, column: 0 },
  });
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [formulaDraft, setFormulaDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("A1");
  const [zoom, setZoom] = useState(1);
  /**
   * One inspector, seven jobs. Formatting, naming a range, validating entries,
   * writing a conditional rule, finding a value, renaming the sheet and choosing
   * filter values used to be six separate bars plus a panel, each of which
   * pushed the grid down as it opened. They are the same shape of task, so they
   * are one overlay that never moves a cell (M4 §5.3).
   */
  const [inspector, setInspector] = useState<
    | "format"
    | "borders"
    | "name"
    | "validate"
    | "conditional"
    | "find"
    | "replace"
    | "sheet"
    | "filter"
    | "sort"
    | "note"
    | "library"
    | "chart"
    | null
  >(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [search, setSearch] = useState("");
  const [searchCursor, setSearchCursor] = useState(0);
  const [namedRangeDraft, setNamedRangeDraft] = useState("");
  const [validationKind, setValidationKind] = useState<
    "list" | "number" | "checkbox"
  >("list");
  const [validationDraft, setValidationDraft] = useState("");
  const [conditionalKind, setConditionalKind] = useState<
    "color_scale" | "greater_than" | "less_than" | "equal_to"
  >("color_scale");
  const [conditionalThreshold, setConditionalThreshold] = useState("0");
  // Charts live in the sheet, so one can be selected the way a cell is, and a
  // gesture in progress renders from local state until it commits (§11F).
  const [selectedChartId, setSelectedChartId] = useState<string>();
  const [chartGesture, setChartGesture] = useState<{
    id: string;
    position: SheetChart["position"];
  }>();
  /** A resize in flight, in zoomed pixels, so the grid tracks the pointer. */
  const [trackGesture, setTrackGesture] = useState<{
    axis: "column" | "row";
    index: number;
    size: number;
  } | null>(null);
  const trackGestureRef = useRef(trackGesture);
  trackGestureRef.current = trackGesture;
  const [filterEditor, setFilterEditor] = useState<{
    tableId: string;
    column: number;
  } | null>(null);
  const [filterValues, setFilterValues] = useState<SheetScalar[]>([]);
  /**
   * Spectra's own clipboard block. The system clipboard carries text, which is
   * all another application can read; paste-special needs the cells themselves —
   * their formulas, their formats — so the block is kept here as well.
   */
  const [clipboardBlock, setClipboardBlock] = useState<
    (ClipboardBlock & { cut?: boolean }) | null
  >(null);
  const [copiedFormat, setCopiedFormat] = useState<SheetCellFormat | null>(
    null,
  );
  const [borderStyle, setBorderStyle] =
    useState<SheetBorderEdge["style"]>("thin");
  const [borderColor, setBorderColor] = useState<string | null>(null);
  const [showFormulas, setShowFormulas] = useState(false);
  const [traceReferences, setTraceReferences] = useState(false);
  const [replaceDraft, setReplaceDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [sortKeys, setSortKeys] = useState<SortKey[]>([]);
  const [libraryFilter, setLibraryFilter] = useState("");
  const [chartTitleDraft, setChartTitleDraft] = useState("");
  const [chartRangeDraft, setChartRangeDraft] = useState("");
  const [customFormatDraft, setCustomFormatDraft] = useState("");
  /** The formula bar, so the Formula command focuses the field a person types in. */
  const formulaInputRef = useRef<HTMLInputElement>(null);
  // Focus is an editing state, not a DOM query. Collaboration refreshes can run
  // effects while the browser briefly reports a different active element; a ref
  // stays true until the input's own blur event and keeps those refreshes from
  // replacing characters that have not been committed yet.
  const formulaEditingRef = useRef(false);
  const cancelFormulaCommitRef = useRef(false);
  /**
   * The live command set, read by `runCommand`. Every inspector control and grid
   * gesture dispatches through that one function, so a verb cannot exist twice.
   */
  const actionsRef = useRef<CommandBinding[]>([]);
  /**
   * Notices are not `role="status"`: the shared rail owns save state and
   * `spectra-app.css` hides `[role="status"]` inside this studio to stop the
   * duplicate, which silently hid every import result and validation error too.
   * `aria-live` announces without matching that selector.
   */
  const [notice, setNotice] = useState<{
    tone: "info" | "warning";
    message: string;
  } | null>(null);
  const setImportNotice = useCallback(
    (message: string | null, tone: "info" | "warning" = "info") =>
      setNotice(message ? { tone, message } : null),
    [setNotice],
  );
  const refuseFormulaLiteralization = useCallback(
    (speculative: SheetsContent) => {
      setNotice({ tone: "warning", message: FORMULA_LITERALIZATION_MESSAGE });
      void fetch("/api/spectra/lenses/office", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "materialize",
          artifactId,
          content: speculative,
        }),
      });
    },
    [artifactId, setNotice],
  );
  const [importing, setImporting] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({
    rowStart: 0,
    rowEnd: 32,
    columnStart: 0,
    columnEnd: 10,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const undoRef = useRef<SheetsContent[]>([]);
  const redoRef = useRef<SheetsContent[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const draggingRef = useRef(false);
  const fillSourceRef = useRef<{
    range: CellRange;
    cells: Record<string, SheetCell>;
  } | null>(null);
  const rangeRef = useRef(range);
  const finishFillRef = useRef<() => void>(() => undefined);
  const cellHandlersRef = useRef<SheetsCellHandlers>({
    onPointerDown: () => {},
    onPointerEnter: () => {},
    onFillHandlePointerDown: () => {},
  });
  const gridRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const lastEmittedKeyRef = useRef<string | null>(null);
  const recentEmittedKeysRef = useRef(new Set<string>());

  const rememberEmitted = useCallback((next: SheetsContent) => {
    const key = workbookIdentityKey(next);
    lastEmittedKeyRef.current = key;
    const recent = recentEmittedKeysRef.current;
    recent.add(key);
    while (recent.size > 80) {
      const oldest = recent.values().next().value;
      if (typeof oldest !== "string") break;
      recent.delete(oldest);
    }
  }, []);

  /**
   * Which sheet you are looking at is navigation, not authorship. It persists
   * to content when you may write (so a reload and the AI land on the same
   * sheet) and stays local until that write is acknowledged. Clearing the local
   * override on every `activeSheetId` echo let a stale snapshot yank the view
   * back to the previous sheet the moment you pressed Next.
   */
  const [localSheetId, setLocalSheetId] = useState<string | null>(null);
  const localSheetIdRef = useRef<string | null>(null);
  localSheetIdRef.current = localSheetId;

  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  // Losing the grant closes every editing surface rather than leaving a panel
  // open over cells it can no longer change.
  useEffect(() => {
    if (!grantLocked) return;
    setInspector(null);
    setFilterEditor(null);
    setEditingAddress(null);
  }, [grantLocked]);

  useEffect(() => {
    if (incoming === workbookRef.current) return;
    const incomingKey = workbookIdentityKey(incoming);
    if (sameContent(incoming, workbook)) {
      recentEmittedKeysRef.current.delete(incomingKey);
      return;
    }
    if (
      incomingKey === lastEmittedKeyRef.current ||
      recentEmittedKeysRef.current.delete(incomingKey)
    )
      return;
    const viewed = localSheetIdRef.current;
    const next =
      viewed &&
      viewed !== incoming.activeSheetId &&
      incoming.sheets.some((sheet) => sheet.id === viewed)
        ? { ...incoming, activeSheetId: viewed }
        : incoming;
    workbookRef.current = next;
    setWorkbook(next);
  }, [incoming]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSheet =
    workbook.sheets.find(
      (sheet) => sheet.id === (localSheetId ?? workbook.activeSheetId),
    ) ??
    workbook.sheets.find((sheet) => sheet.id === workbook.activeSheetId) ??
    workbook.sheets[0]!;
  const activeSheetIndex = workbook.sheets.findIndex(
    (sheet) => sheet.id === activeSheet.id,
  );
  /**
   * Excel's sheet protection is honoured, not ignored: a protected sheet reads
   * as locked everywhere the grant does, so no command promises an edit the
   * sheet refuses. Protect itself stays reachable so the state can be lifted.
   */
  const sheetProtected = Boolean(activeSheet.protection?.locked);
  const locked = grantLocked || sheetProtected;
  const bounds = useMemo(() => usedBounds(activeSheet), [activeSheet]);
  /**
   * Calculation is lazy and per cell (D20). The grid asks for the cells it is
   * about to paint, so a keystroke costs one dependency walk rather than a pass
   * over every formula in a 200k-cell workbook. In manual mode the source is a
   * snapshot instead of the live workbook, so typing does not recalculate at all
   * until someone asks for it.
   */
  const [manualSnapshot, setManualSnapshot] = useState<SheetsContent | null>(
    null,
  );
  const manual = workbook.workbook.calculationMode === "manual";
  const calculationSource = manual ? (manualSnapshot ?? workbook) : workbook;
  const calculated = useMemo(
    () => sheetsCalculation(calculationSource),
    [calculationSource],
  );
  const cachedOnlyFormulaCount = useMemo(
    () =>
      !workbook.nativeBinding
        ? 0
        : workbook.sheets.reduce((count, sheet) => {
            const overlay = readSheetCellsOverlay(sheet.cells);
            const cells = overlay ? Object.values(overlay.patch) : null;
            if (cells) {
              return (
                count +
                cells.filter(
                  (cell) => cell?.nativeFormulaSupport === "cached-only",
                ).length
              );
            }
            for (const address in sheet.cells) {
              if (sheet.cells[address]?.nativeFormulaSupport === "cached-only")
                count += 1;
            }
            return count;
          }, 0),
    [workbook.nativeBinding, workbook.sheets],
  );
  const staleCachedFormulaCount = useMemo(
    () =>
      workbook.sheets.reduce((count, sheet) => {
        const overlay = readSheetCellsOverlay(sheet.cells);
        if (overlay) {
          return (
            count +
            Object.values(overlay.patch).filter(
              (cell) =>
                cell?.nativeFormulaSupport === "cached-only" &&
                cell.cachedValueStale,
            ).length
          );
        }
        for (const address in sheet.cells) {
          const cell = sheet.cells[address];
          if (
            cell?.nativeFormulaSupport === "cached-only" &&
            cell.cachedValueStale
          )
            count += 1;
        }
        return count;
      }, 0),
    [workbook.sheets],
  );
  const activeSheetRef = useRef(activeSheet);
  activeSheetRef.current = activeSheet;
  const calculatedRef = useRef(calculated);
  calculatedRef.current = calculated;
  const localeRef = useRef(workbook.workbook.locale);
  localeRef.current = workbook.workbook.locale;
  const date1904Ref = useRef(workbook.workbook.date1904 === true);
  date1904Ref.current = workbook.workbook.date1904 === true;
  const mergedCellMap = useMemo(() => {
    const map = new Map<
      string,
      { anchor: string; range: CellRange; label: string }
    >();
    for (const label of activeSheet.mergedRanges ?? []) {
      const parsed = parseRange(label);
      if (!parsed) continue;
      const normalized = normalizeRange(parsed);
      const area =
        (normalized.end.row - normalized.start.row + 1) *
        (normalized.end.column - normalized.start.column + 1);
      if (area > 10_000) continue;
      const anchor = coordinateToAddress(normalized.start);
      for (const address of rangeAddresses(normalized))
        map.set(address, { anchor, range: normalized, label });
    }
    return map;
  }, [activeSheet.mergedRanges]);
  const conditionalStyles = useMemo(() => {
    const styles = new Map<
      string,
      { backgroundColor?: string; color?: string }
    >();
    /**
     * Each rule reads its own range, capped, rather than every populated cell in
     * the sheet. A workbook with three rules over `A1:D50` used to walk 200,000
     * addresses per rule on every keystroke; now it walks 200 (D20).
     */
    for (const rule of activeSheet.conditionalFormats ?? []) {
      const parsed = parseRange(rule.range);
      if (!parsed) continue;
      const normalized = normalizeRange(parsed);
      const area =
        (normalized.end.row - normalized.start.row + 1) *
        (normalized.end.column - normalized.start.column + 1);
      if (area > 20_000) continue;
      const addresses = rangeAddresses(normalized).filter(
        (address) => activeSheet.cells[address] !== undefined,
      );
      const resolve = (address: string) =>
        calculated.get(`${activeSheet.id}:${address}`)?.value ??
        activeSheet.cells[address]?.value;
      if (rule.kind === "text_contains") {
        const needle = rule.text.toLowerCase();
        if (!needle) continue;
        for (const address of addresses) {
          const value = resolve(address);
          if (value === undefined || value === null) continue;
          if (!String(value).toLowerCase().includes(needle)) continue;
          styles.set(address, {
            ...styles.get(address),
            backgroundColor: rule.fillColor,
            color: rule.textColor,
          });
        }
        continue;
      }
      const numeric = addresses.flatMap((address) => {
        const value = resolve(address);
        return typeof value === "number" && Number.isFinite(value)
          ? [{ address, value }]
          : [];
      });
      if (rule.kind === "color_scale") {
        if (!numeric.length) continue;
        const minimum = Math.min(...numeric.map((entry) => entry.value));
        const maximum = Math.max(...numeric.map((entry) => entry.value));
        for (const entry of numeric)
          styles.set(entry.address, {
            ...styles.get(entry.address),
            backgroundColor: interpolateHexColor(
              rule.minimumColor,
              rule.maximumColor,
              maximum === minimum
                ? 1
                : (entry.value - minimum) / (maximum - minimum),
            ),
          });
        continue;
      }
      for (const entry of numeric) {
        const second = rule.secondValue ?? rule.value;
        const matches =
          rule.operator === "greater_than"
            ? entry.value > rule.value
            : rule.operator === "less_than"
              ? entry.value < rule.value
              : rule.operator === "greater_equal"
                ? entry.value >= rule.value
                : rule.operator === "less_equal"
                  ? entry.value <= rule.value
                  : rule.operator === "not_equal_to"
                    ? entry.value !== rule.value
                    : rule.operator === "between"
                      ? entry.value >= Math.min(rule.value, second) &&
                        entry.value <= Math.max(rule.value, second)
                      : entry.value === rule.value;
        if (matches)
          styles.set(entry.address, {
            ...styles.get(entry.address),
            backgroundColor: rule.fillColor,
            color: rule.textColor,
          });
      }
    }
    return styles;
  }, [activeSheet, calculated]);
  const filteredOutRows = useMemo(() => {
    const filtered = new Set(activeSheet.hiddenRows ?? []);
    activeSheet.tables.forEach((table) => {
      const tableRange = parseRange(table.range);
      if (!tableRange || !table.filters?.length) return;
      const normalized = normalizeRange(tableRange);
      for (
        let row = normalized.start.row + 1;
        row <= normalized.end.row;
        row += 1
      ) {
        const visible = table.filters.every((filter) => {
          const address = coordinateToAddress({ row, column: filter.column });
          const value =
            calculated.get(`${activeSheet.id}:${address}`)?.value ??
            activeSheet.cells[address]?.value ??
            null;
          return filter.allowedValues.some((allowed) => allowed === value);
        });
        if (!visible) filtered.add(row);
      }
    });
    return filtered;
  }, [activeSheet, calculated]);
  const visibleRowIndices = useMemo(
    () =>
      Array.from({ length: bounds.rows }, (_, row) => row).filter(
        (row) => !filteredOutRows.has(row),
      ),
    [bounds.rows, filteredOutRows],
  );
  const normalizedSelection = normalizeRange(range);
  const selectionLabel = rangeLabel(normalizedSelection);
  const activeAddress = coordinateToAddress(range.end);
  const activeCell = activeSheet.cells[activeAddress];
  /**
   * A copy of the current selection, for handing to an operation.
   *
   * The operations take a plain `CellRange`, so nothing stops one from writing
   * into the object it was given. None of them does, but a caller cannot know
   * that from the signature — and neither can the compiler, which stops
   * memoizing everything downstream of a value it thinks might be mutated. A
   * fresh copy per call settles it.
   */
  function selectionCopy(): CellRange {
    return {
      start: { ...normalizedSelection.start },
      end: { ...normalizedSelection.end },
    };
  }
  const selectedAddresses = useMemo(
    // Keyed on the selection state rather than on the normalized copy: the
    // normalized object is handed to helpers that take a mutable `CellRange`, and
    // a memo keyed on it is not a memo at all.
    () => {
      const normalized = normalizeRange(range);
      if (rangeArea(normalized) > RANGE_WALK_LIMIT)
        return [coordinateToAddress(normalized.start)];
      return rangeAddresses(normalized);
    },
    [range],
  );
  /**
   * Stored widths and heights are honoured, not just persisted. The xlsx
   * importer has always written `columnWidths`, and the grid has always drawn
   * every column at 122px anyway, so an imported sheet lost its layout the
   * moment it opened.
   */
  const activeCalculated = calculated.get(`${activeSheet.id}:${activeAddress}`);
  /**
   * The functions inside the active formula, each with the library's one-line
   * account of what it does. This is what "Explain this formula" actually owes a
   * person: not a restatement of the text they can already see, but what each
   * piece does and who evaluates it.
   */
  const explainedFunctions = useMemo(() => {
    const formula = activeCell?.formula;
    if (!formula) return [];
    const names = new Set(
      [
        ...formula
          .toUpperCase()
          .matchAll(/(?:_XLFN\.)?([A-Z][A-Z0-9_.]*)\s*\(/g),
      ].map((match) => match[1]!),
    );
    return [...names].slice(0, 12).map((name) => {
      const spec = SHEETS_FUNCTION_LIBRARY.find((entry) => entry.name === name);
      return {
        name,
        summary: spec
          ? `${spec.summary}${spec.native ? " Excel recalculates it." : " Spectra calculates it."}`
          : "Spectra does not recognize this function, so it keeps Excel's text and Excel's value.",
      };
    });
  }, [activeCell?.formula]);

  /**
   * The cells the active formula reads from, when tracing is on.
   *
   * "Which cells feed this one" is the question every spreadsheet mistake starts
   * with, and until now the only way to answer it here was to read the formula
   * text by eye. The references are pulled straight from the formula and capped,
   * so tracing a formula that sums a whole column costs a bounded amount of work
   * rather than 200k Set entries (D20).
   */
  const tracedAddresses = useMemo(() => {
    const traced = new Set<string>();
    if (!traceReferences) return traced;
    const formula = activeCell?.formula;
    if (!formula) return traced;
    const pattern =
      /\$?([A-Z]{1,3})\$?([1-9][0-9]*)(?::\$?([A-Z]{1,3})\$?([1-9][0-9]*))?/g;
    for (const match of formula.toUpperCase().matchAll(pattern)) {
      if (traced.size > 4_000) break;
      const start = `${match[1]}${match[2]}`;
      const label = match[3] ? `${start}:${match[3]}${match[4]}` : start;
      const parsed = parseRange(label);
      if (!parsed) continue;
      const normalized = normalizeRange(parsed);
      const area =
        (normalized.end.row - normalized.start.row + 1) *
        (normalized.end.column - normalized.start.column + 1);
      // A whole-column reference is a real thing to write and a pointless thing
      // to outline cell by cell, so it is skipped rather than expanded.
      if (area > 4_000) continue;
      for (const address of rangeAddresses(normalized)) traced.add(address);
    }
    return traced;
  }, [activeCell?.formula, traceReferences]);

  const columnOffsets = useMemo(
    () =>
      trackOffsets(bounds.columns, (column) =>
        trackGesture?.axis === "column" && trackGesture.index === column
          ? trackGesture.size
          : (activeSheet.columnWidths?.[String(column)] ?? COLUMN_WIDTH) * zoom,
      ),
    [activeSheet.columnWidths, bounds.columns, trackGesture, zoom],
  );
  const rowOffsets = useMemo(
    () =>
      trackOffsets(visibleRowIndices.length, (position) => {
        const row = visibleRowIndices[position]!;
        return trackGesture?.axis === "row" && trackGesture.index === row
          ? trackGesture.size
          : (activeSheet.rowHeights?.[String(row)] ?? ROW_HEIGHT) * zoom;
      }),
    [activeSheet.rowHeights, trackGesture, visibleRowIndices, zoom],
  );
  const gridWidth = columnOffsets[bounds.columns] ?? 0;
  const gridHeight = rowOffsets[visibleRowIndices.length] ?? 0;
  const columnSpan = useCallback(
    (column: number) =>
      (columnOffsets[column + 1] ?? 0) - (columnOffsets[column] ?? 0),
    [columnOffsets],
  );
  const rowSpan = useCallback(
    (position: number) =>
      (rowOffsets[position + 1] ?? 0) - (rowOffsets[position] ?? 0),
    [rowOffsets],
  );

  const syncedFormulaAddressRef = useRef(activeAddress);
  useEffect(() => {
    const nextFormula = cellInput(activeCell);
    const nextName = selectionLabel;
    const addressChanged = syncedFormulaAddressRef.current !== activeAddress;
    syncedFormulaAddressRef.current = activeAddress;
    const formulaFocused = formulaEditingRef.current;
    const nameFocused =
      document.activeElement?.getAttribute("aria-label") === "Name box";
    // Native/Yjs identity refreshes reconstruct `activeCell`. Re-copying the
    // committed value while the formula bar is focused is how A1 keystrokes
    // disappear before Enter can commit them.
    if (addressChanged || (!formulaFocused && editingAddress === null)) {
      setFormulaDraft((current) =>
        current === nextFormula ? current : nextFormula,
      );
      if (
        formulaInputRef.current &&
        formulaInputRef.current.value !== nextFormula
      ) {
        formulaInputRef.current.value = nextFormula;
      }
    }
    if (!nameFocused) {
      setNameDraft((current) => (current === nextName ? current : nextName));
    }
  }, [activeAddress, activeCell, editingAddress, selectionLabel]);
  useEffect(() => {
    const rowId =
      activeSheet.rowIdentities?.[String(range.end.row)] ??
      `row-${range.end.row + 1}`;
    const columnId =
      activeSheet.columnIdentities?.[String(range.end.column)] ??
      `column-${columnName(range.end.column)}`;
    onActiveRegionChange?.(`${activeSheet.id}:${rowId}:${columnId}`);
  }, [
    activeAddress,
    activeSheet.columnIdentities,
    activeSheet.id,
    activeSheet.rowIdentities,
    onActiveRegionChange,
    range.end.column,
    range.end.row,
  ]);
  useEffect(() => {
    const stop = () => {
      finishFillRef.current();
      draggingRef.current = false;
    };
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  const commit = useCallback(
    (
      next: SheetsContent,
      remember = true,
      scope: "cells" | "state" = "cells",
    ) => {
      // One gate for every write in this file. A capability that is not granted
      // stops the change here rather than at each of forty call sites. Sheet
      // protection blocks cell writes but not view state, and not the toggle
      // that lifts the protection itself — a lock you cannot unlock is a trap.
      if (scope === "cells" ? locked : grantLocked) return;
      const current = workbookRef.current;
      if (sameContent(current, next)) return;
      const committed =
        scope === "cells" ? applyCachedStaleness(current, next) : next;
      if (remember) {
        undoRef.current = [...undoRef.current.slice(-79), current];
        redoRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
      }
      rememberEmitted(committed);
      workbookRef.current = committed;
      setWorkbook(committed);
      // Notify the parent after the local state transition has been scheduled,
      // never from inside a React state updater.
      onChange(committed);
    },
    [grantLocked, locked, onChange, rememberEmitted],
  );

  const showSheet = useCallback(
    (sheetId: string) => {
      setLocalSheetId(sheetId);
      setRange({ start: { row: 0, column: 0 }, end: { row: 0, column: 0 } });
      if (grantLocked) return;
      const current = workbookRef.current;
      if (current.activeSheetId === sheetId) return;
      const next = { ...current, activeSheetId: sheetId };
      rememberEmitted(next);
      workbookRef.current = next;
      setWorkbook(next);
      onChange(next);
    },
    [grantLocked, onChange, rememberEmitted],
  );

  const updateActiveSheet = useCallback(
    (
      updater: (sheet: WorkbookSheet) => WorkbookSheet,
      remember = true,
      scope: "cells" | "state" = "cells",
    ) => {
      commit(replaceSheet(workbook, updater(activeSheet)), remember, scope);
    },
    [activeSheet, commit, workbook],
  );

  useEffect(() => {
    finishFillRef.current = () => {
      const source = fillSourceRef.current;
      if (!source) return;
      fillSourceRef.current = null;
      const from = normalizeRange(source.range);
      const target = normalizeRange(rangeRef.current);
      if (
        from.start.row === target.start.row &&
        from.start.column === target.start.column &&
        from.end.row === target.end.row &&
        from.end.column === target.end.column
      )
        return;
      const height = from.end.row - from.start.row + 1;
      const width = from.end.column - from.start.column + 1;
      const modulo = (value: number, size: number) =>
        ((value % size) + size) % size;
      updateActiveSheet((sheet) => {
        const cells = { ...sheet.cells };
        for (let row = target.start.row; row <= target.end.row; row += 1) {
          for (
            let column = target.start.column;
            column <= target.end.column;
            column += 1
          ) {
            if (
              row >= from.start.row &&
              row <= from.end.row &&
              column >= from.start.column &&
              column <= from.end.column
            )
              continue;
            const sourceCoordinate = {
              row: from.start.row + modulo(row - from.start.row, height),
              column:
                from.start.column + modulo(column - from.start.column, width),
            };
            const sourceAddress = coordinateToAddress(sourceCoordinate);
            const targetAddress = coordinateToAddress({ row, column });
            const sourceCell = source.cells[sourceAddress];
            if (!sourceCell) {
              delete cells[targetAddress];
              continue;
            }
            cells[targetAddress] = {
              ...sourceCell,
              ...(sourceCell.formula
                ? {
                    formula: offsetFormula(
                      sourceCell.formula,
                      row - sourceCoordinate.row,
                      column - sourceCoordinate.column,
                    ),
                  }
                : {}),
              provenance: { source: "fill", importedAt: Date.now() },
            };
          }
        }
        return { ...sheet, cells };
      });
    };
  }, [updateActiveSheet]);

  function setCell(address: string, cell: SheetCell, remember = true) {
    const existing = activeSheet.cells[address];
    if (
      protectNativeFormulas &&
      isFormulaLiteralization(existing, cell)
    ) {
      refuseFormulaLiteralization({
        ...workbook,
        sheets: workbook.sheets.map((sheet) =>
          sheet.id !== activeSheet.id
            ? sheet
            : {
                ...sheet,
                cells: {
                  ...sheet.cells,
                  [address]: { value: cell.value ?? null },
                },
              },
        ),
      });
      return;
    }
    updateActiveSheet((sheet) => {
      const current = sheet.cells[address];
      const merged = {
        ...current,
        ...cell,
        format: cell.format ?? current?.format,
      };
      const empty =
        !merged.formula &&
        (merged.value === undefined ||
          merged.value === null ||
          merged.value === "") &&
        !merged.note &&
        !merged.format;
      return {
        ...sheet,
        cells: patchSheetCellRecord(sheet.cells, {
          [address]: empty ? undefined : merged,
        }),
      };
    }, remember);
  }

  function commitInput(address: string, value: string) {
    if (cellInput(activeSheet.cells[address]) === value) {
      setEditingAddress(null);
      return;
    }
    const parsed = parseCellInput(
      value,
      workbook.workbook.locale,
      workbook.workbook.date1904,
    );
    const validation = activeSheet.cells[address]?.validation;
    if (validation && !parsed.formula) {
      const scalar = parsed.value ?? null;
      const invalid =
        validation.kind === "list"
          ? !validation.options.includes(String(scalar ?? ""))
          : validation.kind === "checkbox"
            ? typeof scalar !== "boolean"
            : typeof scalar !== "number" ||
              (typeof validation.minimum === "number" &&
                scalar < validation.minimum) ||
              (typeof validation.maximum === "number" &&
                scalar > validation.maximum);
      if (invalid && validation.rejectInvalid) {
        setImportNotice(
          validation.kind === "list"
            ? `${address} accepts only: ${validation.options.join(", ")}.`
            : validation.kind === "checkbox"
              ? `${address} accepts TRUE or FALSE.`
              : `${address} is outside its allowed numeric range.`,
        );
        setEditingAddress(null);
        return;
      }
    }
    setCell(address, { ...parsed, format: activeSheet.cells[address]?.format });
    setEditingAddress(null);
    setFormulaDraft(value);
  }

  function formatSelection(patch: Partial<NonNullable<SheetCell["format"]>>) {
    applyCells(
      applyCellFormat(activeSheet.cells, selectedAddresses, patch),
      "Format",
    );
  }

  function mergeSelection() {
    const area =
      (normalizedSelection.end.row - normalizedSelection.start.row + 1) *
      (normalizedSelection.end.column - normalizedSelection.start.column + 1);
    if (area < 2) {
      setImportNotice("Select at least two cells to merge.", "warning");
      return;
    }
    if (area > 10_000) {
      setImportNotice(
        "Merge a smaller region of up to 10,000 cells.",
        "warning",
      );
      return;
    }
    const anchor = coordinateToAddress(normalizedSelection.start);
    const occupied = selectedAddresses.filter(
      (address) =>
        address !== anchor &&
        Boolean(
          activeSheet.cells[address]?.formula ||
          activeSheet.cells[address]?.value !== undefined ||
          activeSheet.cells[address]?.note,
        ),
    );
    if (occupied.length) {
      setImportNotice(
        `Merge stopped: ${occupied.length} non-anchor cell${occupied.length === 1 ? " contains" : "s contain"} content. Clear or move it first so no data is discarded.`,
        "warning",
      );
      return;
    }
    updateActiveSheet((sheet) => ({
      ...sheet,
      mergedRanges: [
        ...(sheet.mergedRanges ?? []).filter((candidate) => {
          const parsed = parseRange(candidate);
          return parsed ? !rangesOverlap(parsed, normalizedSelection) : false;
        }),
        selectionLabel,
      ],
    }));
    setImportNotice(
      `Merged ${selectionLabel} without discarding cell content.`,
    );
  }

  function unmergeSelection() {
    const affected = (activeSheet.mergedRanges ?? []).filter((candidate) => {
      const parsed = parseRange(candidate);
      return parsed ? rangesOverlap(parsed, normalizedSelection) : false;
    });
    if (!affected.length) {
      setImportNotice(
        "The selected region does not contain merged cells.",
        "warning",
      );
      return;
    }
    updateActiveSheet((sheet) => ({
      ...sheet,
      mergedRanges: (sheet.mergedRanges ?? []).filter(
        (candidate) => !affected.includes(candidate),
      ),
    }));
    setImportNotice(
      `Unmerged ${affected.length} region${affected.length === 1 ? "" : "s"}.`,
    );
  }

  function applyConditionalFormat() {
    const id = `conditional-${crypto.randomUUID()}`;
    let rule: SheetConditionalFormat;
    if (conditionalKind === "color_scale")
      rule = {
        id,
        range: selectionLabel,
        kind: "color_scale",
        minimumColor: "color-mix(in oklab, var(--success) 8%, var(--bg-primary))",
        maximumColor: "var(--accent-mint)",
      };
    else {
      const value = Number(conditionalThreshold);
      if (!Number.isFinite(value)) {
        setImportNotice(
          "Conditional formatting needs a valid numeric value.",
          "warning",
        );
        return;
      }
      rule = {
        id,
        range: selectionLabel,
        kind: "cell_is",
        operator: conditionalKind,
        value,
        fillColor: "color-mix(in oklab, var(--success) 16%, var(--bg-elevated))",
        textColor: "var(--success)",
      };
    }
    updateActiveSheet((sheet) => ({
      ...sheet,
      conditionalFormats: [...(sheet.conditionalFormats ?? []), rule],
    }));
    setInspector(null);
    setImportNotice(`Conditional formatting applied to ${selectionLabel}.`);
  }

  function undo() {
    if (locked) return;
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(workbook);
    setCanUndo(undoRef.current.length > 0);
    setCanRedo(true);
    workbookRef.current = previous;
    setWorkbook(previous);
    rememberEmitted(previous);
    onChange(previous);
  }

  function redo() {
    if (locked) return;
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(workbook);
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
    workbookRef.current = next;
    setWorkbook(next);
    rememberEmitted(next);
    onChange(next);
  }

  function moveSelection(
    rowDelta: number,
    columnDelta: number,
    extend = false,
  ) {
    const currentVisibleRow = visibleRowIndices.indexOf(range.end.row);
    const nextVisibleRow = Math.max(
      0,
      Math.min(
        visibleRowIndices.length - 1,
        (currentVisibleRow >= 0 ? currentVisibleRow : 0) + rowDelta,
      ),
    );
    const next = {
      row:
        rowDelta === 0
          ? range.end.row
          : (visibleRowIndices[nextVisibleRow] ?? range.end.row),
      column: Math.max(
        0,
        Math.min(bounds.columns - 1, range.end.column + columnDelta),
      ),
    };
    setRange((current) => ({
      start: extend ? current.start : next,
      end: next,
    }));
  }

  async function copySelection() {
    const values: string[] = [];
    for (
      let row = normalizedSelection.start.row;
      row <= normalizedSelection.end.row;
      row += 1
    ) {
      const columns: string[] = [];
      for (
        let column = normalizedSelection.start.column;
        column <= normalizedSelection.end.column;
        column += 1
      ) {
        const address = coordinateToAddress({ row, column });
        columns.push(cellInput(activeSheet.cells[address]));
      }
      values.push(columns.join("\t"));
    }
    await navigator.clipboard.writeText(values.join("\n"));
  }

  async function pasteSelection() {
    if (locked) return;
    const rows = parseDelimited(await navigator.clipboard.readText(), "\t");
    const origin = normalizedSelection.start;
    const blocked: string[] = [];
    const parsedByAddress: Record<string, SheetCell> = {};
    const writes: Array<{ address: string; cell: SheetCell }> = [];
    rows.forEach((values, rowOffset) =>
      values.forEach((value, columnOffset) => {
        const address = coordinateToAddress({
          row: origin.row + rowOffset,
          column: origin.column + columnOffset,
        });
        const parsed = parseCellInput(
          value,
          workbook.workbook.locale,
          workbook.workbook.date1904,
        );
        parsedByAddress[address] = parsed;
        const existing = activeSheet.cells[address];
        if (protectNativeFormulas && isFormulaLiteralization(existing, parsed)) {
          blocked.push(address);
          return;
        }
        writes.push({
          address,
          cell: {
            ...parsed,
            format: existing?.format,
            provenance: { source: "clipboard", importedAt: Date.now() },
          },
        });
      }),
    );
    if (blocked.length) {
      refuseFormulaLiteralization({
        ...workbook,
        sheets: workbook.sheets.map((sheet) =>
          sheet.id !== activeSheet.id
            ? sheet
            : {
                ...sheet,
                cells: {
                  ...sheet.cells,
                  ...Object.fromEntries(
                    blocked.map((address) => [
                      address,
                      { value: parsedByAddress[address]?.value ?? null },
                    ]),
                  ),
                },
              },
        ),
      });
    }
    if (!writes.length) return;
    updateActiveSheet((sheet) => {
      const cells = { ...sheet.cells };
      for (const write of writes) cells[write.address] = write.cell;
      return { ...sheet, cells };
    });
  }

  /**
   * The grid keyboard. Every shortcut that performs an operation dispatches the
   * registered command by id rather than reaching for a local mutation, so a key,
   * a button and an assistant call cannot drift apart (C1). Only movement and
   * cell entry — which are selection, not operations — stay local.
   */
  function onGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (editingAddress) return;
    const command = event.metaKey || event.ctrlKey;
    const shortcuts: Record<string, string> = {
      c: "clipboard.copy",
      x: "clipboard.cut",
      v: "clipboard.paste",
      b: "format.bold",
      i: "format.italic",
      u: "format.underline",
      d: "fill.down",
      r: "fill.right",
    };
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      runCommand(event.shiftKey ? "history.redo" : "history.undo");
      return;
    }
    if (command && event.key.toLowerCase() === "y") {
      event.preventDefault();
      runCommand("history.redo");
      return;
    }
    if (command && event.key.toLowerCase() === "f") {
      event.preventDefault();
      runCommand("navigate.find");
      return;
    }
    if (command && event.key.toLowerCase() === "h") {
      event.preventDefault();
      runCommand("navigate.replace");
      return;
    }
    const shortcut = command ? shortcuts[event.key.toLowerCase()] : undefined;
    if (shortcut) {
      event.preventDefault();
      runCommand(shortcut);
      return;
    }
    if (event.key === "F9") {
      event.preventDefault();
      runCommand("formula.calculate");
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1, 0, event.shiftKey);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1, 0, event.shiftKey);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelection(0, -1, event.shiftKey);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelection(0, 1, event.shiftKey);
    } else if (event.key === "Tab") {
      event.preventDefault();
      moveSelection(0, event.shiftKey ? -1 : 1);
    } else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      setEditingAddress(activeAddress);
      setEditingValue(cellInput(activeCell));
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      runCommand("clear.values");
    } else if (!command && event.key.length === 1) {
      setEditingAddress(activeAddress);
      setEditingValue(event.key);
    }
  }

  const updateViewport = useCallback(() => {
    const element = gridRef.current;
    if (!element) return;
    // Offsets, not division: a column the user widened makes the window past it
    // narrower, and dividing by a nominal 122px would render the wrong range.
    const rowStart = Math.max(
      0,
      trackAtOffset(rowOffsets, element.scrollTop) - 3,
    );
    const columnStart = Math.max(
      0,
      trackAtOffset(columnOffsets, element.scrollLeft) - 2,
    );
    const next = {
      rowStart,
      rowEnd: Math.min(
        visibleRowIndices.length - 1,
        trackAtOffset(rowOffsets, element.scrollTop + element.clientHeight) + 6,
      ),
      columnStart,
      columnEnd: Math.min(
        bounds.columns - 1,
        trackAtOffset(columnOffsets, element.scrollLeft + element.clientWidth) +
          4,
      ),
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
    };
    setViewport((current) => {
      if (
        current.rowStart === next.rowStart &&
        current.rowEnd === next.rowEnd &&
        current.columnStart === next.columnStart &&
        current.columnEnd === next.columnEnd &&
        current.scrollLeft === next.scrollLeft &&
        current.scrollTop === next.scrollTop
      ) {
        return current;
      }
      // A one-cell window flicker (scrollbar appearing, toast landing) must
      // not re-render the grid. In tab mode that loop hit React's update cap.
      if (
        current.scrollLeft === next.scrollLeft &&
        current.scrollTop === next.scrollTop &&
        current.rowStart === next.rowStart &&
        current.columnStart === next.columnStart &&
        Math.abs(current.rowEnd - next.rowEnd) <= 1 &&
        Math.abs(current.columnEnd - next.columnEnd) <= 1
      ) {
        return current;
      }
      return next;
    });
  }, [bounds.columns, columnOffsets, rowOffsets, visibleRowIndices.length]);

  /**
   * The window was only ever recomputed on scroll, so the first paint always
   * used the hard-coded 32 rows by 10 columns and columns past K stayed blank
   * at 1440px until someone happened to scroll. Mount and every resize of the
   * grid itself now recompute it.
   */
  useEffect(() => {
    updateViewport();
    const element = gridRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateViewport());
    observer.observe(element);
    return () => observer.disconnect();
  }, [updateViewport]);

  /**
   * Column and row resizing, persisted. The drag paints from local state so the
   * pointer never waits on a commit, and writes the final size once on release
   * (D20) — the same shape as the chart gesture.
   */
  function beginTrackResize(
    axis: "column" | "row",
    index: number,
    event: ReactPointerEvent,
  ) {
    if (locked) return;
    const startPointer = axis === "column" ? event.clientX : event.clientY;
    const startSize =
      axis === "column"
        ? (activeSheet.columnWidths?.[String(index)] ?? COLUMN_WIDTH) * zoom
        : (activeSheet.rowHeights?.[String(index)] ?? ROW_HEIGHT) * zoom;
    const minimum =
      (axis === "column" ? MIN_COLUMN_WIDTH : MIN_ROW_HEIGHT) * zoom;
    setTrackGesture({ axis, index, size: startSize });
    const move = (pointer: PointerEvent) => {
      const delta =
        (axis === "column" ? pointer.clientX : pointer.clientY) - startPointer;
      setTrackGesture({
        axis,
        index,
        size: Math.max(minimum, Math.round(startSize + delta)),
      });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      const gesture = trackGestureRef.current;
      setTrackGesture(null);
      if (!gesture) return;
      const stored = Math.round(gesture.size / zoom);
      const original =
        axis === "column"
          ? (activeSheet.columnWidths?.[String(index)] ?? COLUMN_WIDTH)
          : (activeSheet.rowHeights?.[String(index)] ?? ROW_HEIGHT);
      if (stored === original) return;
      updateActiveSheet((sheet) =>
        axis === "column"
          ? {
              ...sheet,
              columnWidths: { ...sheet.columnWidths, [String(index)]: stored },
            }
          : {
              ...sheet,
              rowHeights: { ...sheet.rowHeights, [String(index)]: stored },
            },
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  function fitTrackSize(axis: "column" | "row", index: number) {
    const sheet = activeSheetRef.current;
    const calculatedCells = calculatedRef.current;
    const locale = localeRef.current;
    const date1904 = date1904Ref.current;
    const sample =
      gridRef.current?.querySelector(".sheets-cell") ?? gridRef.current;
    const family = sample
      ? getComputedStyle(sample).fontFamily
      : "Manrope, ui-sans-serif, system-ui, sans-serif";
    const displayedText = (address: string, cell: SheetCell | undefined) =>
      formatCalculatedCell(
        cell,
        calculatedCells.get(`${sheet.id}:${address}`),
        locale,
        date1904,
      );
    if (axis === "column") {
      let widest = 0;
      let hasContent = false;
      const limit = Math.max(bounds.rows, occupiedBounds(sheet).rows);
      for (let row = 0; row < limit; row += 1) {
        const address = coordinateToAddress({ row, column: index });
        const cell = sheet.cells[address];
        const text = displayedText(address, cell);
        if (!text) continue;
        hasContent = true;
        const size = cell?.format?.fontSize ?? 11;
        const weight = cell?.format?.bold ? 600 : 400;
        widest = Math.max(
          widest,
          measureSheetText(text, `${weight} ${size}px ${family}`),
        );
      }
      const width = fittedColumnWidth(widest, hasContent);
      const current = sheet.columnWidths?.[String(index)] ?? COLUMN_WIDTH;
      if (width === current) return;
      updateActiveSheet((next) => ({
        ...next,
        columnWidths: { ...next.columnWidths, [String(index)]: width },
      }));
      return;
    }
    let tallest = ROW_HEIGHT;
    let hasContent = false;
    const limit = Math.max(bounds.columns, occupiedBounds(sheet).columns);
    for (let column = 0; column < limit; column += 1) {
      const address = coordinateToAddress({ row: index, column });
      const cell = sheet.cells[address];
      const text = displayedText(address, cell);
      if (!text && !cell?.format?.fontSize) continue;
      hasContent = true;
      const size = cell?.format?.fontSize ?? 11;
      const lines = Math.max(1, text.split(/\r?\n/).length);
      tallest = Math.max(tallest, fittedRowHeight(lines, size, true));
    }
    const height = hasContent ? tallest : ROW_HEIGHT;
    const current = sheet.rowHeights?.[String(index)] ?? ROW_HEIGHT;
    if (height === current) return;
    updateActiveSheet((next) => ({
      ...next,
      rowHeights: { ...next.rowHeights, [String(index)]: height },
    }));
  }

  function selectCell(coordinate: CellCoordinate, event: ReactPointerEvent) {
    draggingRef.current = true;
    setRange((current) => ({
      start: event.shiftKey ? current.start : coordinate,
      end: coordinate,
    }));
    gridRef.current?.focus();
  }

  useEffect(() => {
    cellHandlersRef.current = {
      onPointerDown(coordinate, event, merged) {
        if (merged && !event.shiftKey) {
          event.preventDefault();
          setRange(merged.range);
          rangeRef.current = merged.range;
          draggingRef.current = false;
          return;
        }
        selectCell(coordinate, event);
      },
      onPointerEnter(coordinate) {
        const fill = fillSourceRef.current;
        if (fill) {
          const source = normalizeRange(fill.range);
          setRange({
            start: {
              row: Math.min(source.start.row, coordinate.row),
              column: Math.min(source.start.column, coordinate.column),
            },
            end: {
              row: Math.max(source.end.row, coordinate.row),
              column: Math.max(source.end.column, coordinate.column),
            },
          });
        } else if (draggingRef.current)
          setRange((current) => ({
            ...current,
            end: coordinate,
          }));
      },
      onFillHandlePointerDown(event, selection, cells) {
        event.preventDefault();
        event.stopPropagation();
        draggingRef.current = false;
        fillSourceRef.current = { range: selection, cells: { ...cells } };
        rangeRef.current = selection;
      },
    };
  });

  function addSheet() {
    if (locked) return;
    const id = `sheet-${crypto.randomUUID()}`;
    const sheet: WorkbookSheet = {
      id,
      name: `Sheet ${workbook.sheets.length + 1}`,
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
    };
    commit({
      ...workbook,
      sheets: [...workbook.sheets, sheet],
      activeSheetId: id,
    });
    setRange({ start: { row: 0, column: 0 }, end: { row: 0, column: 0 } });
  }

  function removeActiveSheet() {
    if (locked) return;
    if (workbook.sheets.length <= 1) return;
    const sheets = workbook.sheets.filter(
      (sheet) => sheet.id !== activeSheet.id,
    );
    commit({ ...workbook, sheets, activeSheetId: sheets[0]!.id });
  }

  function createChart() {
    if (locked) return;
    // A new chart lands just past the selection it was made from, so the
    // relationship between the numbers and the picture is visible without
    // scrolling anywhere (§11F).
    const view = gridRef.current;
    const viewWidth = view?.clientWidth ?? 480;
    const viewHeight = view?.clientHeight ?? 320;
    const width = Math.min(440, Math.max(280, viewWidth - 36));
    const height = Math.min(320, Math.max(220, viewHeight - 24));
    const preferredX = (normalizedSelection.end.column + 1) * COLUMN_WIDTH + 16;
    const preferredY = normalizedSelection.start.row * ROW_HEIGHT;
    const minX = viewport.scrollLeft + 12;
    const minY = viewport.scrollTop + 12;
    const maxX = viewport.scrollLeft + Math.max(12, viewWidth - width - 12);
    const maxY = viewport.scrollTop + Math.max(12, viewHeight - height - 12);
    const chart: SheetChart = {
      id: `chart-${crypto.randomUUID()}`,
      type: "line",
      sourceRange: rangeLabel(normalizedSelection),
      title: `${activeSheet.name} chart`,
      position: {
        x: Math.min(Math.max(preferredX, minX), maxX),
        y: Math.min(Math.max(preferredY, minY), maxY),
        width,
        height,
      },
    };
    updateActiveSheet((sheet) => ({
      ...sheet,
      charts: [...sheet.charts, chart],
    }));
    setSelectedChartId(chart.id);
    setSheetMode("grid");
  }

  function patchChart(chartId: string, patch: Partial<SheetChart>) {
    updateActiveSheet((sheet) => ({
      ...sheet,
      charts: sheet.charts.map((candidate) =>
        candidate.id === chartId ? { ...candidate, ...patch } : candidate,
      ),
    }));
  }

  /**
   * Moving or resizing a chart is one complete gesture, so it holds the pointer
   * until release and writes the new geometry once — a half-finished drag never
   * reaches the other people in the sheet.
   */
  function beginChartGesture(
    event: ReactPointerEvent<HTMLElement>,
    chart: SheetChart,
    kind: "move" | "resize",
  ) {
    if (locked) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedChartId(chart.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = chart.position;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    let next = origin;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaX = (moveEvent.clientX - startX) / zoom;
      const deltaY = (moveEvent.clientY - startY) / zoom;
      next =
        kind === "move"
          ? {
              ...origin,
              x: Math.max(0, Math.round(origin.x + deltaX)),
              y: Math.max(0, Math.round(origin.y + deltaY)),
            }
          : {
              ...origin,
              width: Math.max(220, Math.round(origin.width + deltaX)),
              height: Math.max(160, Math.round(origin.height + deltaY)),
            };
      setChartGesture({ id: chart.id, position: next });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setChartGesture(undefined);
      if (next !== origin) patchChart(chart.id, { position: next });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function toggleTable() {
    const isPoint =
      normalizedSelection.start.row === normalizedSelection.end.row &&
      normalizedSelection.start.column === normalizedSelection.end.column;
    const isSingleColumn =
      normalizedSelection.start.column === normalizedSelection.end.column;
    const region =
      isPoint || isSingleColumn
        ? currentRegion(activeSheet, normalizedSelection.start)
        : normalizedSelection;
    const label = rangeLabel(region);
    if (label !== selectionLabel) setRange(region);
    updateActiveSheet((sheet) => {
      const existing = sheet.tables.find((table) => table.range === label);
      return {
        ...sheet,
        tables: existing
          ? sheet.tables.filter((table) => table.id !== existing.id)
          : [
              ...sheet.tables,
              {
                id: `table-${crypto.randomUUID()}`,
                name: `Table ${sheet.tables.length + 1}`,
                range: label,
                filters: [],
              },
            ],
      };
    });
  }

  function sortSelection(direction: "asc" | "desc") {
    if (locked) return;
    let selectedRange = normalizeRange(range);
    const sortColumn = selectedRange.start.column;
    const isPoint =
      selectedRange.start.row === selectedRange.end.row &&
      selectedRange.start.column === selectedRange.end.column;
    const isSingleColumn =
      selectedRange.start.column === selectedRange.end.column;
    if (isPoint || isSingleColumn) {
      selectedRange = currentRegion(activeSheet, selectedRange.start);
      setRange(selectedRange);
    }
    const matchingTable = activeSheet.tables.find(
      (table) => table.range === rangeLabel(selectedRange),
    );
    const headerRow = chartFirstRowIsHeader(
      activeSheet,
      selectedRange,
      calculated,
    );
    const dataStartRow =
      matchingTable || headerRow
        ? selectedRange.start.row + 1
        : selectedRange.start.row;
    const rows = [] as Array<{
      row: number;
      values: Record<number, SheetCell | undefined>;
      key: SheetScalar | "";
    }>;
    for (let row = dataStartRow; row <= selectedRange.end.row; row += 1) {
      const values: Record<number, SheetCell | undefined> = {};
      for (
        let column = selectedRange.start.column;
        column <= selectedRange.end.column;
        column += 1
      )
        values[column] =
          activeSheet.cells[coordinateToAddress({ row, column })];
      const address = coordinateToAddress({ row, column: sortColumn });
      rows.push({
        row,
        values,
        key:
          calculated.get(`${activeSheet.id}:${address}`)?.value ??
          values[sortColumn]?.value ??
          "",
      });
    }
    rows.sort((left, right) => {
      const a = left.key;
      const b = right.key;
      const comparison =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b));
      return direction === "asc" ? comparison : -comparison;
    });
    updateActiveSheet((sheet) => {
      const cells = { ...sheet.cells };
      rows.forEach((entry, rowOffset) =>
        Object.entries(entry.values).forEach(([column, value]) => {
          const newRow = dataStartRow + rowOffset;
          const address = coordinateToAddress({
            row: newRow,
            column: Number(column),
          });
          if (value) cells[address] = offsetCellToRow(value, entry.row, newRow);
          else delete cells[address];
        }),
      );
      return {
        ...sheet,
        cells,
        tables: matchingTable
          ? sheet.tables.map((table) =>
              table.id === matchingTable.id
                ? {
                    ...table,
                    sort: {
                      column: sortColumn,
                      direction,
                    },
                  }
                : table,
            )
          : sheet.tables,
      };
    });
  }

  async function importDelimited(file: File) {
    if (locked) throw new Error("This workbook is read-only.");
    const rows = parseDelimited(
      await file.text(),
      file.name.toLowerCase().endsWith(".tsv") ? "\t" : ",",
    );
    if (!rows.length) {
      throw new Error("No tabular rows were found in that file.");
    }
    const nextSheet = (() => {
      const sheet = activeSheet;
      const cells = { ...sheet.cells };
      rows.slice(0, 100_000).forEach((values, row) =>
        values.slice(0, 16_384).forEach((value, column) => {
          const address = coordinateToAddress({ row, column });
          cells[address] = {
            ...parseCellInput(
              value,
              workbook.workbook.locale,
              workbook.workbook.date1904,
            ),
            provenance: { source: file.name, importedAt: Date.now() },
          };
        }),
      );
      return {
        ...sheet,
        cells,
        rowCount: Math.max(sheet.rowCount ?? 100, rows.length + 20),
        columnCount: Math.max(
          sheet.columnCount ?? 26,
          Math.max(...rows.map((item) => item.length), 1),
        ),
      };
    })();
    const next = replaceSheet(workbook, nextSheet);
    commit(next);
    const notice = `Imported ${rows.length.toLocaleString()} rows from ${file.name}. Formulas and quoted values were preserved where supported.`;
    setImportNotice(notice);
    return {
      next,
      notice,
      unsupported: [
        "CSV/TSV does not carry formatting, charts, validations, comments, or multiple worksheets",
      ],
    };
  }

  async function importExcel(file: File) {
    if (locked) throw new Error("This workbook is read-only.");
    if (/\.(?:xlsm|xlsb|xls)$/i.test(file.name)) {
      throw new Error(
        "Macro-enabled, binary, and legacy Excel files are quarantined and never executed. Export a clean .xlsx copy to import its supported content.",
      );
    }
    try {
      const ExcelJS = await import("exceljs");
      const imported = new ExcelJS.Workbook();
      await imported.xlsx.load(await file.arrayBuffer());
      let externalLinks = 0;
      let hyperlinks = 0;
      let unsupportedValues = 0;
      const sheets: WorkbookSheet[] = [];
      imported.eachSheet((worksheet, worksheetIndex) => {
        const cells: Record<string, SheetCell> = {};
        worksheet.eachRow({ includeEmpty: false }, (row) => {
          row.eachCell({ includeEmpty: false }, (sourceCell) => {
            const raw = sourceCell.value as unknown;
            const valueRecord =
              raw && typeof raw === "object" && !Array.isArray(raw)
                ? (raw as Record<string, unknown>)
                : null;
            const formula =
              typeof valueRecord?.formula === "string"
                ? valueRecord.formula
                : undefined;
            const externalFormula = formula?.includes("[") === true;
            if (externalFormula) externalLinks += 1;
            let value: string | number | boolean | null | undefined;
            if (formula && !externalFormula) value = undefined;
            else if (externalFormula) value = `=${formula}`;
            else if (raw instanceof Date) value = raw.getTime();
            else if (
              typeof raw === "string" ||
              typeof raw === "number" ||
              typeof raw === "boolean" ||
              raw === null
            )
              value = raw;
            else if (typeof valueRecord?.text === "string") {
              value = valueRecord.text;
              if (typeof valueRecord.hyperlink === "string") hyperlinks += 1;
            } else if (Array.isArray(valueRecord?.richText))
              value = (valueRecord.richText as Array<Record<string, unknown>>)
                .map((part) => (typeof part.text === "string" ? part.text : ""))
                .join("");
            else if (valueRecord?.error) value = String(valueRecord.error);
            else {
              value = sourceCell.text || undefined;
              unsupportedValues += 1;
            }
            const underline = sourceCell.font?.underline;
            const fillColor =
              "fgColor" in sourceCell.fill
                ? (sourceCell.fill.fgColor as { argb?: string } | undefined)
                    ?.argb
                : undefined;
            const fontColor = (
              sourceCell.font?.color as { argb?: string } | undefined
            )?.argb;
            const note = sourceCell.note;
            cells[sourceCell.address] = {
              ...(value !== undefined ? { value } : {}),
              ...(formula && !externalFormula
                ? { formula: `=${formula}` }
                : {}),
              format: {
                bold: sourceCell.font?.bold || undefined,
                italic: sourceCell.font?.italic || undefined,
                underline: Boolean(underline) || undefined,
                align:
                  sourceCell.alignment?.horizontal === "center" ||
                  sourceCell.alignment?.horizontal === "right"
                    ? sourceCell.alignment.horizontal
                    : "left",
                numberFormat:
                  raw instanceof Date
                    ? "date"
                    : sourceCell.numFmt?.includes("%")
                      ? "percent"
                      : /[$€£¥]/.test(sourceCell.numFmt ?? "")
                        ? "currency"
                        : "general",
                fillColor: fillColor ? `#${fillColor.slice(-6)}` : undefined,
                textColor: fontColor ? `#${fontColor.slice(-6)}` : undefined,
              },
              ...(note
                ? {
                    note:
                      typeof note === "string"
                        ? note
                        : (note.texts ?? []).map((part) => part.text).join(""),
                  }
                : {}),
              provenance: { source: file.name, importedAt: Date.now() },
            };
          });
        });
        sheets.push({
          id: `sheet-${crypto.randomUUID()}`,
          name: worksheet.name || `Sheet ${worksheetIndex}`,
          cells,
          tables: [],
          charts: [],
          rowCount: Math.max(100, worksheet.actualRowCount + 20),
          columnCount: Math.max(26, worksheet.actualColumnCount + 5),
          frozenRows:
            worksheet.views[0]?.state === "frozen"
              ? worksheet.views[0].ySplit
              : 0,
          frozenColumns:
            worksheet.views[0]?.state === "frozen"
              ? worksheet.views[0].xSplit
              : 0,
          hiddenRows: [],
          hiddenColumns: [],
          columnWidths: Object.fromEntries(
            worksheet.columns.flatMap((column, index) =>
              column.width ? [[String(index), column.width * 8]] : [],
            ),
          ),
          rowHeights: {},
          mergedRanges: Array.isArray(
            (worksheet.model as { merges?: unknown }).merges,
          )
            ? (worksheet.model as { merges: unknown[] }).merges
                .filter(
                  (value): value is string =>
                    typeof value === "string" && Boolean(parseRange(value)),
                )
                .slice(0, 10_000)
            : [],
          conditionalFormats: [],
          rowIdentities: {},
          columnIdentities: {},
        });
      });
      if (!sheets.length)
        throw new Error("The workbook did not contain a readable worksheet.");
      const next: SheetsContent = {
        ...workbook,
        sheets,
        activeSheetId: sheets[0]!.id,
      };
      commit(next);
      setRange({ start: { row: 0, column: 0 }, end: { row: 0, column: 0 } });
      const caveats = [
        externalLinks
          ? `${externalLinks} external formula${externalLinks === 1 ? " was" : "s were"} quarantined as text`
          : "",
        hyperlinks
          ? `${hyperlinks} hyperlink${hyperlinks === 1 ? " was" : "s were"} imported as visible text`
          : "",
        unsupportedValues
          ? `${unsupportedValues} uncommon value${unsupportedValues === 1 ? " used" : "s used"} displayed text`
          : "",
        "Macros and executable content were not loaded",
        "Excel charts are not imported by this reader and can be rebuilt from their source range",
        "Excel conditional-format rules are reported but not imported; create a native rule after reviewing the values",
      ].filter(Boolean);
      setImportNotice(
        `Imported ${sheets.length} worksheet${sheets.length === 1 ? "" : "s"} from ${file.name}. Fidelity report: ${caveats.join("; ")}.`,
      );
      return {
        next,
        notice: `Imported ${sheets.length} worksheet${sheets.length === 1 ? "" : "s"} from ${file.name}.`,
        unsupported: caveats,
      };
    } catch (error) {
      setImportNotice(
        `Could not import ${file.name}. The original remains untouched. ${error instanceof Error ? error.message : "Try exporting a clean .xlsx copy."}`,
        "warning",
      );
      throw error;
    }
  }

  async function importWorkbookFile(file: File) {
    if (!synchronizationReady) {
      setImportNotice(
        "Finish synchronizing the current sheet before replacing it with an import. You can keep editing cells while Spectra reconnects.",
        "warning",
      );
      return;
    }
    if (file.size < 1 || file.size > 100 * 1024 * 1024) {
      setImportNotice(
        "Import quarantined: the file is empty or exceeds the 100 MB parsing safety ceiling.",
        "warning",
      );
      return;
    }
    setImporting(true);
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "unknown";
    let jobId: string | undefined;
    try {
      const beginning = await beginArtifactImportOriginal({
        artifactId,
        typeKey: "sheets",
        format: extension,
        name: file.name,
        mimeType:
          file.type ||
          (extension === "csv"
            ? "text/csv"
            : extension === "tsv"
              ? "text/tab-separated-values"
              : extension === "ods"
                ? "application/vnd.oasis.opendocument.spreadsheet"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        bytes: file.size,
        sha256: await sheetsBlobSha256(file),
      });
      jobId = beginning.jobId;
      await uploadArtifactImportOriginal(jobId, file);
      const result =
        extension === "xlsx"
          ? await importExcel(file)
          : extension === "ods"
            ? await (async () => {
                if (locked) throw new Error("This workbook is read-only.");
                const imported = importOds(await file.arrayBuffer(), workbook);
                commit(imported.next);
                setRange({
                  start: { row: 0, column: 0 },
                  end: { row: 0, column: 0 },
                });
                const notice = `Imported ${imported.next.sheets.length} worksheet${imported.next.sheets.length === 1 ? "" : "s"} from ${file.name}.`;
                setImportNotice(
                  `${notice} Fidelity report: ${imported.unsupported.join("; ")}.`,
                );
                return {
                  next: imported.next,
                  notice,
                  unsupported: imported.unsupported,
                };
              })()
            : extension === "csv" || extension === "tsv"
              ? await importDelimited(file)
              : await importExcel(file);
      if (!result) throw new Error("The importer produced no workbook state.");
      await completeArtifactImport({
        jobId,
        typeKey: "sheets",
        status: "imported",
        fidelityReport: [
          {
            scope: "workbook data",
            level: "exact",
            message: result.notice,
          },
          ...(result.unsupported.length
            ? [
                {
                  scope: "format fidelity",
                  level: "adapted" as const,
                  message: result.unsupported.join("; "),
                },
              ]
            : []),
        ],
        unsupportedFeatures: result.unsupported,
        importedContent: result.next,
      });
      setImportNotice(
        `${result.notice} The immutable original and itemized fidelity report are retained for recovery.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Spreadsheet import failed.";
      if (jobId)
        await completeArtifactImport({
          jobId,
          typeKey: "sheets",
          status: "quarantined",
          fidelityReport: [{ scope: "import", level: "unsupported", message }],
          unsupportedFeatures: [],
          quarantineReason: message,
        }).catch(async () => {
          await abortArtifactImportUpload(jobId!, message).catch(
            () => undefined,
          );
        });
      setImportNotice(
        `Import quarantined: ${message} The original remains retained for recovery.`,
        "warning",
      );
    } finally {
      setImporting(false);
    }
  }

  async function exportWorkbook(format: "xlsx" | "csv" | "ods") {
    const safeTitle = (activeSheet.name || "Sheet").replace(
      /[<>:"/\\|?*]/g,
      "-",
    );
    if (format === "csv") {
      const extent = occupiedBounds(activeSheet);
      const lines: string[] = [];
      for (let row = 0; row < extent.rows; row += 1) {
        const columns: string[] = [];
        for (let column = 0; column < extent.columns; column += 1) {
          const address = coordinateToAddress({ row, column });
          const cell = activeSheet.cells[address];
          columns.push(
            csvEscape(
              formatCalculatedCell(
                cell,
                calculated.get(`${activeSheet.id}:${address}`),
                workbook.workbook.locale,
                workbook.workbook.date1904,
              ),
            ),
          );
        }
        lines.push(columns.join(","));
      }
      downloadDocumentText(
        `${safeTitle}.csv`,
        "text/csv;charset=utf-8",
        lines.join("\n"),
      );
      setImportNotice(`Exported ${activeSheet.name} as CSV.`);
      return;
    }
    if (format === "ods") {
      downloadDocumentBlob(
        `${safeTitle}.ods`,
        new Blob([exportOds(workbook)], {
          type: "application/vnd.oasis.opendocument.spreadsheet",
        }),
      );
      setImportNotice(
        `Exported ${workbook.sheets.length} sheet${workbook.sheets.length === 1 ? "" : "s"} as OpenDocument.`,
      );
      return;
    }
    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.Workbook();
    for (const sheet of workbook.sheets) {
      const worksheet = book.addWorksheet(sheet.name);
      for (const [address, cell] of Object.entries(sheet.cells)) {
        const excelCell = worksheet.getCell(address);
        const calculatedCell = calculated.get(`${sheet.id}:${address}`);
        if (cell.formula) {
          excelCell.value = {
            formula: cell.formula.replace(/^=/, ""),
            result: calculatedCell?.value ?? undefined,
          };
        } else if (cell.value !== undefined) excelCell.value = cell.value;
        if (cell.format?.bold)
          excelCell.font = { ...excelCell.font, bold: true };
        if (cell.format?.italic)
          excelCell.font = { ...excelCell.font, italic: true };
        if (cell.format?.numberFormat === "percent") excelCell.numFmt = "0.00%";
        else if (cell.format?.numberFormat === "currency")
          excelCell.numFmt = '"$"#,##0.00';
      }
      if ((sheet.frozenRows ?? 0) > 0 || (sheet.frozenColumns ?? 0) > 0) {
        worksheet.views = [
          {
            state: "frozen",
            xSplit: sheet.frozenColumns ?? 0,
            ySplit: sheet.frozenRows ?? 0,
          },
        ];
      }
    }
    const buffer = await book.xlsx.writeBuffer();
    downloadDocumentBlob(
      `${safeTitle}.xlsx`,
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    setImportNotice(
      `Exported ${workbook.sheets.length} sheet${workbook.sheets.length === 1 ? "" : "s"} as Excel.`,
    );
  }

  const scrollingRows = visibleRowIndices
    .slice(viewport.rowStart, viewport.rowEnd + 1)
    .map((row, index) => ({ row, position: viewport.rowStart + index }));
  const frozenRows = visibleRowIndices
    .filter((row) => row < (activeSheet.frozenRows ?? 0))
    .map((row) => ({ row, position: visibleRowIndices.indexOf(row) }));
  const rows = Array.from(
    new Map(
      [...frozenRows, ...scrollingRows].map((entry) => [entry.row, entry]),
    ).values(),
  );
  const scrollingColumns = Array.from(
    { length: Math.max(0, viewport.columnEnd - viewport.columnStart + 1) },
    (_, index) => viewport.columnStart + index,
  );
  const columns = Array.from(
    new Set([
      ...Array.from(
        { length: Math.min(bounds.columns, activeSheet.frozenColumns ?? 0) },
        (_, index) => index,
      ),
      ...scrollingColumns,
    ]),
  );
  const selectedNumbers = selectedAddresses.flatMap((address) => {
    const value =
      calculated.get(`${activeSheet.id}:${address}`)?.value ??
      activeSheet.cells[address]?.value;
    return typeof value === "number" ? [value] : [];
  });
  const summary = selectedNumbers.length
    ? {
        count: selectedNumbers.length,
        sum: selectedNumbers.reduce((total, value) => total + value, 0),
        average:
          selectedNumbers.reduce((total, value) => total + value, 0) /
          selectedNumbers.length,
      }
    : null;
  const activeFilterTable = filterEditor
    ? activeSheet.tables.find((table) => table.id === filterEditor.tableId)
    : undefined;
  const activeFilterRange = activeFilterTable
    ? parseRange(activeFilterTable.range)
    : null;
  const activeFilterOptions =
    filterEditor && activeFilterRange
      ? Array.from(
          new Map(
            Array.from(
              {
                length: activeFilterRange.end.row - activeFilterRange.start.row,
              },
              (_, index) => activeFilterRange.start.row + 1 + index,
            ).map((row) => {
              const address = coordinateToAddress({
                row,
                column: filterEditor.column,
              });
              const value =
                calculated.get(`${activeSheet.id}:${address}`)?.value ??
                activeSheet.cells[address]?.value ??
                null;
              return [JSON.stringify(value), value] as const;
            }),
          ).values(),
        )
      : [];

  const numberText = (value: number) =>
    value.toLocaleString(workbook.workbook.locale, {
      maximumFractionDigits: 4,
    });
  /**
   * Analysis is a second view of the same cells, not a reading mode: descriptive
   * statistics measured from the calculated workbook, so every figure here is a
   * real result of the sheet's own formulas.
   */
  const analysis = (() => {
    if (!selectedNumbers.length) return null;
    const count = selectedNumbers.length;
    const sum = selectedNumbers.reduce((total, value) => total + value, 0);
    const mean = sum / count;
    return {
      count,
      sum,
      mean,
      minimum: selectedNumbers.reduce((low, value) => Math.min(low, value)),
      maximum: selectedNumbers.reduce((high, value) => Math.max(high, value)),
      deviation: Math.sqrt(
        count > 1
          ? selectedNumbers.reduce(
              (total, value) => total + (value - mean) ** 2,
              0,
            ) /
              (count - 1)
          : 0,
      ),
      blanks: selectedAddresses.filter(
        (address) => cellInput(activeSheet.cells[address]) === "",
      ).length,
    };
  })();
  /**
   * Find reads calculated results as well as entered text, so searching for a
   * number finds the cells that compute it and not only the ones that hold it.
   * Matches come back in reading order so "Find next" walks the sheet the way a
   * person does.
   */
  const searchMatches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return Object.entries(activeSheet.cells)
      .filter(
        ([address, cell]) =>
          cellInput(cell).toLowerCase().includes(needle) ||
          formatCalculatedCell(
            cell,
            calculated.get(`${activeSheet.id}:${address}`),
            workbook.workbook.locale,
            workbook.workbook.date1904,
          )
            .toLowerCase()
            .includes(needle),
      )
      .map(([address]) => address)
      .sort((left, right) => {
        const a = parseAddress(left);
        const b = parseAddress(right);
        if (!a || !b) return 0;
        return a.row - b.row || a.column - b.column;
      });
  }, [
    activeSheet.cells,
    activeSheet.id,
    calculated,
    search,
    workbook.workbook.locale,
    workbook.workbook.date1904,
  ]);
  const sheetIsEmpty =
    !sheetHasCells(activeSheet.cells) && !activeSheet.charts.length;
  /**
   * The selection readout. It used to sit in a 28px bar of its own that also
   * repeated the address already shown in the name box; it is one readout in the
   * bar now, and the address is stated once.
   */
  const summaryLabel = summary
    ? `Sum ${numberText(summary.sum)} · Mean ${numberText(summary.average)}`
    : selectedAddresses.length > 1
      ? `${selectedAddresses.length} cells selected`
      : undefined;
  const dimensionLabel = filteredOutRows.size
    ? `${visibleRowIndices.length.toLocaleString()} of ${bounds.rows.toLocaleString()} rows · ${bounds.columns.toLocaleString()} columns`
    : `${bounds.rows.toLocaleString()} rows · ${bounds.columns.toLocaleString()} columns`;
  const frozenRowCount = activeSheet.frozenRows ?? 0;
  const frozenColumnCount = activeSheet.frozenColumns ?? 0;
  const freezeRowTarget = normalizedSelection.start.row + 1;
  const freezeColumnTarget = normalizedSelection.start.column + 1;
  const filterableHere = activeSheet.tables.some(
    (table) => table.range === selectionLabel,
  );
  const toggleInspector = (panel: NonNullable<typeof inspector>) =>
    setInspector((current) => (current === panel ? null : panel));
  /**
   * Inspectors overlay the grid. Analysis is a peer view of the same cells, so
   * it occupies the frame instead of covering it — Grid and Analysis are modes,
   * not a rail stacked on the numbers they describe.
   */
  const panelMode = inspector;
  const panelTitle = {
    format: `Format ${selectionLabel}`,
    name: `Name ${selectionLabel}`,
    validate: `Validate ${selectionLabel}`,
    conditional: `Conditional format ${selectionLabel}`,
    borders: `Borders for ${selectionLabel}`,
    find: `Find in ${activeSheet.name}`,
    replace: `Replace in ${activeSheet.name}`,
    sheet: "Rename sheet",
    sort: `Sort ${selectionLabel}`,
    note: `Note on ${activeAddress}`,
    library: "Function library",
    chart: "Chart",
    filter: filterEditor
      ? `Filter ${columnName(filterEditor.column)}`
      : "Filter",
  }[panelMode ?? "find"];
  /**
   * Character emphasis and cell alignment, declared once so the row cannot grow
   * a seventh toggle with a seventh button treatment. Every entry writes a real
   * cell format.
   */
  /**
   * Character emphasis and cell alignment. Each button dispatches the registered
   * command rather than calling `formatSelection` itself, so the inspector, the
   * workbar, Ctrl+B and an assistant call are literally the same code path (C1).
   */
  const emphasisControls: Array<{
    label: string;
    icon: typeof Bold;
    active?: boolean;
    onClick: () => void;
  }> = [
    {
      label: "Bold",
      icon: Bold,
      active: activeCell?.format?.bold,
      onClick: () => runCommand("format.bold"),
    },
    {
      label: "Italic",
      icon: Italic,
      active: activeCell?.format?.italic,
      onClick: () => runCommand("format.italic"),
    },
    {
      label: "Underline",
      icon: Underline,
      active: activeCell?.format?.underline,
      onClick: () => runCommand("format.underline"),
    },
    {
      label: "Wrap text",
      icon: TextIcon,
      active: activeCell?.format?.wrap,
      onClick: () => runCommand("format.wrap"),
    },
    ...(
      [
        ["Align left", "left", AlignLeft],
        ["Align centre", "center", AlignCenter],
        ["Align right", "right", AlignRight],
      ] as const
    ).map(([label, align, icon]) => ({
      label,
      icon,
      active: activeCell?.format?.align === align,
      onClick: () => runCommand("format.align", align),
    })),
  ];
  const changeZoom = (next: number) => {
    setZoom(next);
    requestAnimationFrame(updateViewport);
  };

  /**
   * Every verb this workbook can perform, declared once.
   *
   * The bar, the inspector, a keyboard shortcut, a header drag and an assistant
   * call all arrive at the same function here. Before this, the format panel
   * mutated cells directly, Ctrl+V had its own paste and the fill handle had its
   * own copy loop, so "merge these cells" existed three times and none of the
   * three could be reached by anything but a mouse (C1).
   */
  function moveActiveSheet(delta: -1 | 1) {
    const target = activeSheetIndex + delta;
    if (target < 0 || target >= workbook.sheets.length) return;
    const sheets = [...workbook.sheets];
    const [moved] = sheets.splice(activeSheetIndex, 1);
    if (!moved) return;
    sheets.splice(target, 0, moved);
    commit({ ...workbook, sheets });
  }

  /**
   * The one dispatcher. An inspector toggle, a context menu item, a grid gesture
   * and a keyboard shortcut all call this with a command id, so the registry is
   * the only place an operation is implemented and a disabled command is refused
   * the same way everywhere (C1/C2).
   */
  function runCommand(id: string, value?: CommandParam) {
    if (!contract) {
      const binding = actionsRef.current.find(
        (candidate) => candidate.id === id,
      );
      if (!binding || binding.disabled) return false;
      binding.onSelect(value);
      return true;
    }
    return dispatchStudioCommand({
      type: "sheets",
      id,
      bindings: actionsRef.current,
      ctx: commandContext(
        "sheets",
        contract.can,
        contract.role,
        selectedChartId ? "Chart" : undefined,
        {
          compatibilityProfile: contract.compatibilityProfile,
          fidelity: contract.fidelity,
        },
        contract.executeApplicationCommand,
      ),
      params: value,
    });
  }

  function applyCells(result: CellsResult, verb: string) {
    if (protectNativeFormulas) {
      const lost = formulaLiteralizationAddresses(
        activeSheet.cells,
        result.cells,
      );
      if (lost.length) {
        refuseFormulaLiteralization({
          ...workbook,
          sheets: workbook.sheets.map((sheet) =>
            sheet.id !== activeSheet.id
              ? sheet
              : { ...sheet, cells: result.cells },
          ),
        });
        return;
      }
    }
    if (result.blocked.length) {
      const shown = result.blocked.slice(0, 3).join(", ");
      setImportNotice(
        `${verb} left ${result.blocked.length === 1 ? "one cell" : `${result.blocked.length} cells`} as ${result.blocked.length === 1 ? "it was" : "they were"} — ${shown} hold formulas Spectra shows but cannot rewrite, so Excel's own text is kept.`,
        "warning",
      );
    }
    if (!result.written) return;
    updateActiveSheet((sheet) => ({ ...sheet, cells: result.cells }));
  }

  function captureBlock(cut: boolean) {
    const cells: Record<string, SheetCell> = {};
    for (const address of selectedAddresses) {
      const cell = activeSheet.cells[address];
      if (cell) cells[address] = cell;
    }
    // A copy, not the live selection: the clipboard has to keep the shape that
    // was copied even after the selection moves.
    setClipboardBlock({ range: selectionCopy(), cells, cut });
    void copySelection();
  }

  function pasteHere(mode: string) {
    if (!clipboardBlock) {
      void pasteSelection();
      return;
    }
    const result = pasteBlock(
      activeSheet.cells,
      clipboardBlock,
      normalizedSelection.start,
      mode,
      (address) => calculated.get(`${activeSheet.id}:${address}`)?.value,
    );
    let cells = result.cells;
    if (clipboardBlock.cut && mode !== "formats") {
      cells = { ...cells };
      for (const address of Object.keys(clipboardBlock.cells))
        delete cells[address];
    }
    applyCells({ ...result, cells }, "Paste");
    if (clipboardBlock.cut) setClipboardBlock(null);
  }

  function clearSelectionScope(scope: "all" | "values" | "formats") {
    applyCells(
      clearCells(activeSheet.cells, selectedAddresses, scope),
      scope === "all"
        ? "Clear"
        : scope === "values"
          ? "Clear contents"
          : "Clear formatting",
    );
  }

  function applyBorders(preset: string) {
    applyCells(
      applyBorderPreset(
        activeSheet.cells,
        selectionCopy(),
        preset,
        borderStyle,
        borderColor,
      ),
      "Borders",
    );
  }

  function resizeSelectedColumns(width: number) {
    updateActiveSheet((sheet) => {
      const columnWidths = { ...(sheet.columnWidths ?? {}) };
      for (
        let column = normalizedSelection.start.column;
        column <= normalizedSelection.end.column;
        column += 1
      )
        columnWidths[String(column)] = width;
      return { ...sheet, columnWidths };
    });
  }

  function resizeSelectedRows(height: number) {
    updateActiveSheet((sheet) => {
      const rowHeights = { ...(sheet.rowHeights ?? {}) };
      for (
        let row = normalizedSelection.start.row;
        row <= normalizedSelection.end.row;
        row += 1
      )
        rowHeights[String(row)] = height;
      return { ...sheet, rowHeights };
    });
  }

  function hideSelected(axis: "row" | "column") {
    updateActiveSheet((sheet) => {
      const key = axis === "row" ? "hiddenRows" : "hiddenColumns";
      const start =
        axis === "row"
          ? normalizedSelection.start.row
          : normalizedSelection.start.column;
      const end =
        axis === "row"
          ? normalizedSelection.end.row
          : normalizedSelection.end.column;
      const hidden = new Set(sheet[key] ?? []);
      for (let index = start; index <= end; index += 1) hidden.add(index);
      return {
        ...sheet,
        [key]: [...hidden].sort((left, right) => left - right),
      };
    });
  }

  function runCustomSort() {
    if (!sortKeys.length) {
      setInspector("sort");
      return;
    }
    const selection = selectionCopy();
    const header = chartFirstRowIsHeader(activeSheet, selection, calculated);
    const first = header ? selection.start.row + 1 : selection.start.row;
    const rows: Array<{
      row: number;
      values: Record<number, SheetCell | undefined>;
    }> = [];
    for (let row = first; row <= selection.end.row; row += 1) {
      const values: Record<number, SheetCell | undefined> = {};
      for (
        let column = selection.start.column;
        column <= selection.end.column;
        column += 1
      )
        values[column] =
          activeSheet.cells[coordinateToAddress({ row, column })];
      rows.push({ row, values });
    }
    const valueAt = (entry: (typeof rows)[number], column: number) =>
      calculated.get(
        `${activeSheet.id}:${coordinateToAddress({ row: entry.row, column })}`,
      )?.value ?? entry.values[column]?.value;
    const sorted = sortRows(rows, sortKeys, valueAt);
    updateActiveSheet((sheet) => {
      const cells = { ...sheet.cells };
      sorted.forEach((entry, offset) => {
        for (
          let column = selection.start.column;
          column <= selection.end.column;
          column += 1
        ) {
          const address = coordinateToAddress({ row: first + offset, column });
          const cell = entry.values[column];
          if (cell)
            cells[address] = offsetCellToRow(cell, entry.row, first + offset);
          else delete cells[address];
        }
      });
      return { ...sheet, cells };
    });
  }

  function removeDuplicateRows() {
    const selection = selectionCopy();
    const header = chartFirstRowIsHeader(activeSheet, selection, calculated);
    const first = header ? selection.start.row + 1 : selection.start.row;
    const rows: number[] = [];
    for (let row = first; row <= selection.end.row; row += 1) rows.push(row);
    const columns: number[] = [];
    for (
      let column = selection.start.column;
      column <= selection.end.column;
      column += 1
    )
      columns.push(column);
    const duplicates = duplicateRowIndices(rows, columns, (row, column) => {
      const address = coordinateToAddress({ row, column });
      return (
        calculated.get(`${activeSheet.id}:${address}`)?.value ??
        activeSheet.cells[address]?.value
      );
    });
    if (!duplicates.length) {
      setImportNotice("No repeated rows in that selection.");
      return;
    }
    let next = workbook;
    for (const row of [...duplicates].sort((left, right) => right - left))
      next = mutateWorkbookAxis(next, activeSheet.id, "row", row, -1);
    commit(next);
    setImportNotice(
      `Removed ${duplicates.length === 1 ? "one repeated row" : `${duplicates.length} repeated rows`}.`,
    );
  }

  function splitTextToColumns() {
    const selection = selectionCopy();
    const column = selection.start.column;
    const values: string[] = [];
    for (let row = selection.start.row; row <= selection.end.row; row += 1) {
      const cell = activeSheet.cells[coordinateToAddress({ row, column })];
      values.push(typeof cell?.value === "string" ? cell.value : "");
    }
    const { rows, delimiter } = splitColumn(values);
    const widest = Math.max(...rows.map((parts) => parts.length), 1);
    if (widest < 2) {
      setImportNotice(
        "Nothing in that column has a comma or a tab to split on.",
      );
      return;
    }
    updateActiveSheet((sheet) => {
      const cells = { ...sheet.cells };
      rows.forEach((parts, offset) => {
        parts.forEach((part, index) => {
          const address = coordinateToAddress({
            row: selection.start.row + offset,
            column: column + index,
          });
          if (index === 0 && isPreservedFormula(cells[address])) return;
          cells[address] = {
            ...cells[address],
            value: part,
            formula: undefined,
          };
        });
      });
      return { ...sheet, cells };
    });
    setImportNotice(
      `Split ${rows.length === 1 ? "one row" : `${rows.length} rows`} at "${delimiter === "\t" ? "tab" : delimiter}" into ${widest} columns.`,
    );
  }

  function insertFunctionTemplate(name: string) {
    const spec = SHEETS_FUNCTION_LIBRARY.find((entry) => entry.name === name);
    if (!spec) return;
    const rangeText =
      selectedAddresses.length > 1 ? selectionLabel : `${activeAddress}`;
    const template = spec.template
      .replaceAll("{range}", rangeText)
      .replaceAll("{cell}", activeAddress);
    setFormulaDraft(template);
    if (formulaInputRef.current) formulaInputRef.current.value = template;
    setInspector(null);
    requestAnimationFrame(() => formulaInputRef.current?.focus());
  }

  function autoSumSelection() {
    const selection = selectionCopy();
    const column = selection.start.column;
    let top = selection.start.row - 1;
    while (
      top >= 0 &&
      activeSheet.cells[coordinateToAddress({ row: top, column })] !== undefined
    )
      top -= 1;
    const first = top + 1;
    if (first >= selection.start.row) {
      const source = `${coordinateToAddress({ row: first, column })}:${coordinateToAddress({ row: selection.start.row - 1, column })}`;
      commitInput(coordinateToAddress(selection.start), `=SUM(${source})`);
      return;
    }
    setImportNotice("Put the cursor below the numbers you want totalled.");
  }

  function replaceInSelection(scope: "sheet" | "selection") {
    const query = search.trim();
    if (!query) {
      setInspector("replace");
      return;
    }
    const addresses =
      scope === "selection"
        ? selectedAddresses
        : Object.keys(activeSheet.cells);
    const result = replaceInCells(
      activeSheet.cells,
      addresses,
      query,
      replaceDraft,
    );
    applyCells(result, "Replace");
    if (result.written)
      setImportNotice(
        `Replaced ${result.written === 1 ? "one value" : `${result.written} values`} in ${scope === "selection" ? selectionLabel : activeSheet.name}.`,
      );
  }

  function setNoteOnActiveCell(text: string) {
    const note = text.trim();
    setCell(activeAddress, {
      ...activeCell,
      ...(note ? { note } : { note: undefined }),
    });
  }

  function patchActiveTable(patch: Partial<SheetTable>) {
    const table = activeSheet.tables.find(
      (candidate) =>
        candidate.range === selectionLabel ||
        (Boolean(parseRange(candidate.range)) &&
          selected(
            normalizeRange(parseRange(candidate.range)!),
            range.end.row,
            range.end.column,
          )),
    );
    if (!table) return;
    updateActiveSheet((sheet) => ({
      ...sheet,
      tables: sheet.tables.map((candidate) =>
        candidate.id === table.id ? { ...candidate, ...patch } : candidate,
      ),
    }));
  }

  const activeTable = activeSheet.tables.find((candidate) => {
    const parsed = parseRange(candidate.range);
    return parsed
      ? selected(normalizeRange(parsed), range.end.row, range.end.column)
      : false;
  });
  const selectedChart = activeSheet.charts.find(
    (chart) => chart.id === selectedChartId,
  );
  const mergedHere = (activeSheet.mergedRanges ?? []).some((label) => {
    const parsed = parseRange(label);
    return parsed
      ? selected(normalizeRange(parsed), range.end.row, range.end.column)
      : false;
  });
  const hiddenTrackCount =
    (activeSheet.hiddenRows?.length ?? 0) +
    (activeSheet.hiddenColumns?.length ?? 0);
  const hiddenSheetCount = workbook.sheets.filter(
    (sheet) => sheet.hidden,
  ).length;
  const mountedNative = Boolean(workbook.nativeBinding);
  const sheetAddBlockedReason = mountedNative
    ? "This workbook is linked to an Excel file, and Spectra keeps its sheet list exactly as Excel wrote it. Import a copy to restructure it."
    : undefined;

  const commandHandlers: SheetsCommandHandlers = {
    readOnly: grantLocked,
    protectedSheet: sheetProtected,
    history: {
      undo,
      redo,
      canUndo,
      canRedo,
    },
    find: {
      toggle: () => toggleInspector("find"),
      open: inspector === "find",
      toggleReplace: () => toggleInspector("replace"),
      replaceOpen: inspector === "replace",
      matchCount: search.trim() ? searchMatches.length : undefined,
      matchNoun: "cell",
    },
    textFormat: {
      fontFamily: {
        value: activeCell?.format?.fontFamily,
        set: (value) => formatSelection({ fontFamily: value }),
      },
      fontSize: {
        value: activeCell?.format?.fontSize ?? 11,
        set: (value) => formatSelection({ fontSize: value }),
      },
      bold: {
        active: activeCell?.format?.bold,
        toggle: () => formatSelection({ bold: !activeCell?.format?.bold }),
      },
      italic: {
        active: activeCell?.format?.italic,
        toggle: () => formatSelection({ italic: !activeCell?.format?.italic }),
      },
      underline: {
        active: activeCell?.format?.underline,
        toggle: () =>
          formatSelection({ underline: !activeCell?.format?.underline }),
      },
      strike: {
        active: activeCell?.format?.strike,
        toggle: () => formatSelection({ strike: !activeCell?.format?.strike }),
      },
      color: {
        value: activeCell?.format?.textColor ?? null,
        set: (value) => formatSelection({ textColor: value ?? undefined }),
      },
      alignment: {
        value: activeCell?.format?.align ?? "left",
        set: (value) =>
          formatSelection({
            align: value as NonNullable<SheetCellFormat["align"]>,
          }),
      },
      clear: () => clearSelectionScope("formats"),
    },
    openFormatPanel: () => toggleInspector("format"),
    formatPanelOpen: inspector === "format",
    clipboard: {
      copy: () => captureBlock(false),
      cut: () => captureBlock(true),
      paste: () => pasteHere("all"),
      pasteSpecial: (mode) => pasteHere(mode),
      canPaste: Boolean(clipboardBlock) || undefined,
      clear: clearSelectionScope,
      fill: (direction) =>
        applyCells(
          fillRange(activeSheet.cells, selectionCopy(), direction),
          direction === "down" ? "Fill down" : "Fill right",
        ),
      fillSeries: (kind) =>
        applyCells(
          fillSeries(activeSheet.cells, selectionCopy(), kind),
          "Fill series",
        ),
      canFill: selectedAddresses.length > 1,
    },
    numberFormat: {
      format: activeCell?.format?.numberFormat ?? "general",
      set: (format) => {
        if (format === "custom") {
          toggleInspector("format");
          return;
        }
        formatSelection({ numberFormat: format as SheetNumberFormat });
      },
      customCode: activeCell?.format?.customFormat,
      setCustom: (code) => {
        if (!code.trim()) {
          setInspector("format");
          return;
        }
        formatSelection({ numberFormat: "custom", customFormat: code.trim() });
      },
      currency: activeCell?.format?.currency ?? "USD",
      setCurrency: (code) =>
        formatSelection({ numberFormat: "currency", currency: code }),
      decimals: activeCell?.format?.decimals ?? 2,
      setDecimals: (decimals) => formatSelection({ decimals }),
      thousands: activeCell?.format?.thousands,
      toggleThousands: () =>
        formatSelection({ thousands: !activeCell?.format?.thousands }),
    },
    cellFormat: {
      fillColor: {
        value: activeCell?.format?.fillColor ?? null,
        set: (value) => formatSelection({ fillColor: value ?? undefined }),
      },
      borders: applyBorders,
      borderStyle: {
        value: borderStyle,
        set: (value) => setBorderStyle(value as SheetBorderEdge["style"]),
      },
      borderColor: { value: borderColor, set: setBorderColor },
      wrap: {
        active: activeCell?.format?.wrap,
        toggle: () => formatSelection({ wrap: !activeCell?.format?.wrap }),
      },
      verticalAlign: {
        value: activeCell?.format?.verticalAlign ?? "bottom",
        set: (value) =>
          formatSelection({
            verticalAlign: value as NonNullable<
              SheetCellFormat["verticalAlign"]
            >,
          }),
      },
      rotation: {
        value: activeCell?.format?.rotation ?? 0,
        set: (rotation) => formatSelection({ rotation }),
      },
      indent: {
        increase: () =>
          formatSelection({
            indent: Math.min(8, (activeCell?.format?.indent ?? 0) + 1),
          }),
        decrease: () =>
          formatSelection({
            indent: Math.max(0, (activeCell?.format?.indent ?? 0) - 1),
          }),
        canDecrease: (activeCell?.format?.indent ?? 0) > 0,
      },
      merge: mergeSelection,
      unmerge: unmergeSelection,
      canMerge: selectedAddresses.length > 1,
      canUnmerge: mergedHere,
      mergeBlockedReason:
        selectedAddresses.length > 1
          ? undefined
          : "Select more than one cell to merge.",
      copyFormat: () => setCopiedFormat(activeCell?.format ?? null),
      pasteFormat: () => {
        if (!copiedFormat) return;
        updateActiveSheet((sheet) => {
          const cells = { ...sheet.cells };
          for (const address of selectedAddresses)
            cells[address] = { ...cells[address], format: { ...copiedFormat } };
          return { ...sheet, cells };
        });
      },
      hasCopiedFormat: Boolean(copiedFormat),
    },
    structure: {
      insertRow: () =>
        commit(
          mutateWorkbookAxis(
            workbook,
            activeSheet.id,
            "row",
            normalizedSelection.start.row,
            1,
          ),
        ),
      insertColumn: () =>
        commit(
          mutateWorkbookAxis(
            workbook,
            activeSheet.id,
            "column",
            normalizedSelection.start.column,
            1,
          ),
        ),
      deleteRow: () =>
        commit(
          mutateWorkbookAxis(
            workbook,
            activeSheet.id,
            "row",
            normalizedSelection.start.row,
            -1,
          ),
        ),
      deleteColumn: () =>
        commit(
          mutateWorkbookAxis(
            workbook,
            activeSheet.id,
            "column",
            normalizedSelection.start.column,
            -1,
          ),
        ),
      columnWidth: Math.round(
        activeSheet.columnWidths?.[String(normalizedSelection.start.column)] ??
          COLUMN_WIDTH,
      ),
      setColumnWidth: resizeSelectedColumns,
      rowHeight: Math.round(
        activeSheet.rowHeights?.[String(normalizedSelection.start.row)] ??
          ROW_HEIGHT,
      ),
      setRowHeight: resizeSelectedRows,
      autofitColumn: () =>
        fitTrackSize("column", normalizedSelection.start.column),
      hideRow: () => hideSelected("row"),
      hideColumn: () => hideSelected("column"),
      unhideAll: () =>
        updateActiveSheet((sheet) => ({
          ...sheet,
          hiddenRows: [],
          hiddenColumns: [],
        })),
      hiddenCount: hiddenTrackCount,
    },
    view: {
      freezeRows: () =>
        updateActiveSheet((sheet) => ({
          ...sheet,
          frozenRows:
            (sheet.frozenRows ?? 0) > 0 ? 0 : Math.min(100, freezeRowTarget),
        })),
      freezeColumns: () =>
        updateActiveSheet((sheet) => ({
          ...sheet,
          frozenColumns:
            (sheet.frozenColumns ?? 0) > 0
              ? 0
              : Math.min(50, freezeColumnTarget),
        })),
      clearFreeze: () =>
        updateActiveSheet((sheet) => ({
          ...sheet,
          frozenRows: 0,
          frozenColumns: 0,
        })),
      frozenRows: frozenRowCount,
      frozenColumns: frozenColumnCount,
      showFormulas: {
        active: showFormulas,
        toggle: () => setShowFormulas((on) => !on),
      },
      gridlines: {
        active: activeSheet.showGridlines !== false,
        toggle: () =>
          updateActiveSheet(
            (sheet) => ({
              ...sheet,
              showGridlines: sheet.showGridlines === false,
            }),
            false,
            "state",
          ),
      },
      headings: {
        active: activeSheet.showHeadings !== false,
        toggle: () =>
          updateActiveSheet(
            (sheet) => ({
              ...sheet,
              showHeadings: sheet.showHeadings === false,
            }),
            false,
            "state",
          ),
      },
    },
    data: {
      sortAscending: () => sortSelection("asc"),
      sortDescending: () => sortSelection("desc"),
      openSort: () => toggleInspector("sort"),
      sortOpen: inspector === "sort",
      sortKeyCount: sortKeys.length,
      toggleFilter: toggleTable,
      filterActive: filterableHere,
      openFilter: () => {
        if (!activeTable) return;
        setFilterEditor({ tableId: activeTable.id, column: range.end.column });
        setInspector("filter");
      },
      createTable: toggleTable,
      hasTable: Boolean(activeTable),
      tableStyle: {
        value: activeTable?.style ?? "striped",
        set: (style) =>
          patchActiveTable({ style: style as SheetTable["style"] }),
      },
      toggleTotals: {
        active: activeTable?.totalsRow ?? false,
        toggle: () => patchActiveTable({ totalsRow: !activeTable?.totalsRow }),
      },
      openValidation: () => {
        const existing = activeCell?.validation;
        setValidationKind(existing?.kind ?? "list");
        setValidationDraft(
          existing?.kind === "list"
            ? existing.options.join(", ")
            : existing?.kind === "number"
              ? `${existing.minimum ?? ""}, ${existing.maximum ?? ""}`
              : "",
        );
        toggleInspector("validate");
      },
      validationOpen: inspector === "validate",
      openConditional: () => toggleInspector("conditional"),
      conditionalOpen: inspector === "conditional",
      removeDuplicates: removeDuplicateRows,
      splitText: splitTextToColumns,
      analyze: () => setSheetMode("analysis"),
      // True of every linked workbook, said without claiming to know whether this
      // one has a pivot table: the Spectra content model carries no pivot list,
      // so the note answers "can I build one here?" and nothing more.
      ...(mountedNative
        ? {
            pivotPreservedNote:
              "Spectra cannot build or change a pivot table. Any pivot table in this Excel file is kept exactly as Excel wrote it.",
          }
        : {}),
    },
    formula: {
      openBar: () => formulaInputRef.current?.focus(),
      insertFunction: insertFunctionTemplate,
      autoSum: autoSumSelection,
      openLibrary: () => toggleInspector("library"),
      libraryOpen: inspector === "library",
      explain: () => toggleInspector("library"),
      recalculate: () => setManualSnapshot(workbook),
      calculationMode: workbook.workbook.calculationMode,
      setCalculationMode: (mode) => {
        setManualSnapshot(mode === "manual" ? workbook : null);
        commit({
          ...workbook,
          workbook: {
            ...workbook.workbook,
            calculationMode: mode === "manual" ? "manual" : "automatic",
          },
        });
      },
      traceReferences: {
        active: traceReferences,
        toggle: () => setTraceReferences((on) => !on),
      },
      cachedOnlyCount: cachedOnlyFormulaCount,
      ...(cachedOnlyFormulaCount
        ? {
            cachedOnlyNote: staleCachedFormulaCount
              ? `${cachedOnlyFormulaCount} formulas here show the value Excel saved; ${staleCachedFormulaCount === 1 ? "one of those results may be out of date" : `${staleCachedFormulaCount} of those results may be out of date`} until Excel recalculates.`
              : `${cachedOnlyFormulaCount} formulas here show the value Excel saved; Spectra keeps their text exactly as written.`,
          }
        : {}),
      createNamedRange: () => {
        setNamedRangeDraft("");
        toggleInspector("name");
      },
      manageNames: () => toggleInspector("name"),
      namedRangeCount: Object.keys(workbook.workbook.namedRanges ?? {}).length,
    },
    chart: {
      insert: createChart,
      hasSelection: Boolean(selectedChart),
      type: {
        value: selectedChart?.type ?? "column",
        set: (type) => {
          if (selectedChart)
            patchChart(selectedChart.id, { type: type as SheetChart["type"] });
        },
      },
      setTitle: () => toggleInspector("chart"),
      setRange: () => toggleInspector("chart"),
      toggleLegend: {
        active: selectedChart?.showLegend !== false,
        toggle: () => {
          if (selectedChart)
            patchChart(selectedChart.id, {
              showLegend: selectedChart.showLegend === false,
            });
        },
      },
      remove: () => {
        if (!selectedChart) return;
        const id = selectedChart.id;
        setSelectedChartId(undefined);
        updateActiveSheet((sheet) => ({
          ...sheet,
          charts: sheet.charts.filter((chart) => chart.id !== id),
        }));
      },
    },
    sheet: {
      add: addSheet,
      canAdd: !mountedNative,
      ...(sheetAddBlockedReason
        ? { addBlockedReason: sheetAddBlockedReason }
        : {}),
      rename: () => {
        setRenameDraft(activeSheet.name);
        toggleInspector("sheet");
      },
      duplicate: () => {
        const copy: WorkbookSheet = {
          ...activeSheet,
          id: `sheet-${Date.now().toString(36)}`,
          name: `${activeSheet.name} copy`,
        };
        commit({
          ...workbook,
          sheets: [
            ...workbook.sheets.slice(0, activeSheetIndex + 1),
            copy,
            ...workbook.sheets.slice(activeSheetIndex + 1),
          ],
          activeSheetId: copy.id,
        });
      },
      remove: removeActiveSheet,
      canRemove: workbook.sheets.length > 1,
      moveLeft: () => moveActiveSheet(-1),
      moveRight: () => moveActiveSheet(1),
      canMoveLeft: activeSheetIndex > 0,
      canMoveRight: activeSheetIndex < workbook.sheets.length - 1,
      tabColor: {
        value: activeSheet.tabColor ?? null,
        set: (color) =>
          updateActiveSheet((sheet) => ({
            ...sheet,
            tabColor: color ?? undefined,
          })),
      },
      hide: () => updateActiveSheet((sheet) => ({ ...sheet, hidden: true })),
      canHide: workbook.sheets.filter((sheet) => !sheet.hidden).length > 1,
      showHidden: () =>
        commit({
          ...workbook,
          sheets: workbook.sheets.map((sheet) => ({
            ...sheet,
            hidden: undefined,
          })),
        }),
      hiddenSheetCount,
    },
    review: {
      setNote: () => {
        setNoteDraft(activeCell?.note ?? "");
        toggleInspector("note");
      },
      noteOpen: inspector === "note",
      hasNote: Boolean(activeCell?.note),
      protectSheet: () =>
        updateActiveSheet(
          (sheet) => ({
            ...sheet,
            protection: { locked: !sheet.protection?.locked },
          }),
          true,
          "state",
        ),
      ...(sheetProtected
        ? {
            protectionNote:
              "This sheet is protected, so cells cannot be changed. Turn it off to edit again.",
          }
        : {}),
      openHistory: () => contract?.inspector.show("history"),
    },
    comments: {
      toggle: () =>
        contract?.inspector.open === "comments"
          ? contract.inspector.hide()
          : contract?.inspector.show("comments"),
      open: contract?.inspector.open === "comments",
      ...(mountedNative
        ? {
            preservedNote: "Comments",
          }
        : {}),
    },
    zoom: {
      zoom,
      setZoom: changeZoom,
      min: 0.75,
      max: 1.5,
      step: 0.25,
    },
    export: {
      noun: "workbook",
      formats: [...SHEETS_EXPORT_COPIES],
      run: (format) => void exportWorkbook(format as "xlsx" | "csv" | "ods"),
    },
    import: {
      open: () => importRef.current?.click(),
      busy: importing || !synchronizationReady,
      noun: "workbook",
      ...(synchronizationReady
        ? {}
        : { strictReason: "Finish synchronizing before importing." }),
    },
    print: () => window.print(),
  };

  const actions: CommandBinding[] = sheetsCommandBindings(commandHandlers);
  actionsRef.current = actions;

  return (
    <div
      ref={rootRef}
      className="spectra-sheets-studio flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-compact={mode === "split" || undefined}
      data-sheets-density={density}
    >
      {/* One bar. Modes, the sheet selector, the selection readout and every
          action come from the shared contract, so this type no longer owns a
          menu row, a format rail or a responsive rule of its own. */}
      {contract ? (
        <ArtifactWorkbar
          label="Sheet tools"
          selectionContext={selectedChartId ? "Chart" : undefined}
          modes={{
            registry: true,
            value: sheetMode,
            onChange: (next) => {
              setSheetMode(next);
              if (next === "analysis") setInspector(null);
            },
          }}
          selector={
            /* Two hooks, nested, both in the DOM: `/sheets` is the collection a
               per-sheet path falls back to, and `/activeSheetId` is the control
               that changes it. The old tab rail carried `/sheets/{i}` per tab and
               nothing for `/activeSheetId`, so that declared control could never
               resolve. Neither may move inside the portaled list. */
            <div
              className="flex min-w-0 items-center"
              {...targetAttrs("/sheets")}
            >
              <div
                className="flex min-w-0 items-center"
                {...targetAttrs("/activeSheetId")}
              >
                {/* The tab colour has somewhere to land. Without this dot the
                    colour command would write a field nothing paints, which is a
                    switch that does nothing — the one thing worse than a missing
                    feature. */}
                {activeSheet.tabColor ? (
                  <span
                    className="sheets-tab-color"
                    style={{ backgroundColor: activeSheet.tabColor }}
                    aria-hidden
                  />
                ) : null}
                <WorkbarItemSelector
                  ariaLabel="Sheet"
                  itemNoun="sheet"
                  className="max-w-[22ch]"
                  /* A hidden sheet is hidden. It stays out of the selector
                     until "Show hidden sheets" brings it back, except when it is
                     somehow the active one, which would otherwise leave the
                     control showing a value it does not list. */
                  items={workbook.sheets
                    .filter(
                      (sheet) => !sheet.hidden || sheet.id === activeSheet.id,
                    )
                    .map((sheet) => ({
                      value: sheet.id,
                      label: sheet.hidden
                        ? `${sheet.name} (hidden)`
                        : sheet.name,
                    }))}
                  value={activeSheet.id}
                  onChange={showSheet}
                />
              </div>
            </div>
          }
          context={
            mode === "split" || analysing || summaryLabel
              ? undefined
              : dimensionLabel
          }
          trailing={
            analysing || !summaryLabel ? undefined : (
              <span className="spectra-workbar-count max-w-[24ch]">
                {summaryLabel}
              </span>
            )
          }
          actions={actions}
        />
      ) : null}
      <input
        ref={importRef}
        type="file"
        accept=".csv,.tsv,.xlsx,.xls,.xlsm,.xlsb,.ods,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void importWorkbookFile(file);
          event.currentTarget.value = "";
        }}
      />
      {/* The formula bar is the working surface, not chrome: it is where a cell
          is actually written, and it carries the cell's AI target hook. */}
      <div className="sheets-formula-bar">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!locked)
              commitInput(
                activeAddress,
                formulaInputRef.current?.value ?? formulaDraft,
              );
          }}
          className="contents"
        >
          <input
            aria-label="Name box"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value.toUpperCase())}
            onBlur={() => {
              const parsed = parseRange(nameDraft);
              const named = Object.entries(
                workbook.workbook.namedRanges ?? {},
              ).find(
                ([name]) =>
                  name.toUpperCase() === nameDraft.trim().toUpperCase(),
              )?.[1];
              const namedAddress = named?.split("!").at(-1);
              const namedSheet = named?.includes("!")
                ? named.slice(0, named.lastIndexOf("!")).replace(/^'|'$/g, "")
                : activeSheet.name;
              const namedParsed = namedAddress
                ? parseRange(namedAddress)
                : null;
              if (parsed) setRange(parsed);
              else if (namedParsed) {
                const targetSheet = workbook.sheets.find(
                  (sheet) =>
                    sheet.name.toUpperCase() === namedSheet?.toUpperCase(),
                );
                if (targetSheet && targetSheet.id !== activeSheet.id)
                  showSheet(targetSheet.id);
                setRange(namedParsed);
              } else setNameDraft(selectionLabel);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="sheets-name-box"
          />
          <span aria-hidden="true" className="sheets-formula-icon">
            fx
          </span>
          <input
            ref={formulaInputRef}
            aria-label={`Formula for ${activeAddress}`}
            // Uncontrolled while focused: lifting each keystroke into studio
            // state rebuilt the grid and missed the 8ms keystroke budget.
            defaultValue={formulaDraft}
            readOnly={locked}
            aria-readonly={locked}
            {...targetAttrs(
              `/sheets/${activeSheetIndex}/cells/${activeAddress}/${
                formulaDraft.startsWith("=") || activeCell?.formula
                  ? "formula"
                  : "value"
              }`,
            )}
            onFocus={() => {
              formulaEditingRef.current = true;
              cancelFormulaCommitRef.current = false;
            }}
            onBlur={(event) => {
              formulaEditingRef.current = false;
              if (cancelFormulaCommitRef.current) {
                cancelFormulaCommitRef.current = false;
                return;
              }
              if (!locked)
                commitInput(activeAddress, event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!locked)
                  commitInput(activeAddress, event.currentTarget.value);
              }
              if (event.key === "Escape") {
                cancelFormulaCommitRef.current = true;
                const restored = cellInput(activeCell);
                setFormulaDraft(restored);
                event.currentTarget.value = restored;
                event.currentTarget.blur();
              }
            }}
            className="sheets-formula-input"
          />
        </form>
        {locked ? (
          <span
            title="Read-only. Copy and charts are available; cells cannot change."
            className="min-w-0 shrink truncate px-2.5 text-micro text-[var(--text-secondary)]"
          >
            Read-only. Copy and charts are available; cells cannot change.
          </span>
        ) : null}
        {cachedOnlyFormulaCount ? (
          <span
            className="min-w-0 shrink truncate px-2.5 text-micro text-[var(--text-secondary)]"
            title={
              staleCachedFormulaCount
                ? "These formulas are kept as native Excel text. Some cached results may be out of date until Excel recalculates them."
                : "These formulas are kept as native Excel text and show their cached values until Excel recalculates them."
            }
          >
            {staleCachedFormulaCount
              ? `${cachedOnlyFormulaCount} native formula${cachedOnlyFormulaCount === 1 ? "" : "s"} from Excel cache · ${staleCachedFormulaCount} may be out of date`
              : `${cachedOnlyFormulaCount} native formula${cachedOnlyFormulaCount === 1 ? "" : "s"} shown from Excel cache`}
          </span>
        ) : null}
      </div>
      {/* The frame grows to fill a pane that has a height of its own, and it is
          the positioning context for the inspector, so opening a panel overlays
          the grid instead of pushing it below the fold (CANON D8). The floor
          stays for a tab whose parent has no definite height; a split pane keeps
          none, so a short pane shrinks the grid rather than overflowing it. */}
      <div
        className="sheets-grid-frame"
        data-analysis={analysing || undefined}
        /* The two view toggles are honest states, not decoration: hiding the
           gridlines or the A/B/C headers changes what this frame paints, and CSS
           reads these attributes so the toggle is never a dead switch. */
        data-gridlines={activeSheet.showGridlines === false ? "off" : undefined}
        data-headings={activeSheet.showHeadings === false ? "off" : undefined}
        data-formulas={showFormulas ? "on" : undefined}
        style={
          {
            // Hiding the headers gives their space back to the grid rather
            // than leaving two empty gutters, which is what "hide" means.
            "--sheet-row-header":
              activeSheet.showHeadings === false
                ? "0px"
                : `${ROW_HEADER_WIDTH}px`,
            "--sheet-column-header":
              activeSheet.showHeadings === false
                ? "0px"
                : `${COLUMN_HEADER_HEIGHT}px`,
            position: "relative",
            flex: "1 1 auto",
            height: "auto",
            minHeight: mode === "split" ? 0 : "max(420px, 52dvh)",
          } as CSSProperties
        }
      >
        {analysing ? (
          <div
            className="sheets-analysis-canvas"
            aria-label={`Analysis of ${selectionLabel}`}
          >
            <p className="text-caption text-[var(--text-secondary)]">
              {selectionLabel}
              <span aria-hidden="true"> · </span>
              {activeSheet.name}
            </p>
            {analysis ? (
              <>
                <dl className="mt-4 max-w-[28rem]">
                  {(
                    [
                      ["Numbers", String(analysis.count)],
                      ["Blank cells", String(analysis.blanks)],
                      ["Sum", numberText(analysis.sum)],
                      ["Mean", numberText(analysis.mean)],
                      ["Minimum", numberText(analysis.minimum)],
                      ["Maximum", numberText(analysis.maximum)],
                      [
                        "Range",
                        numberText(analysis.maximum - analysis.minimum),
                      ],
                      [
                        "Standard deviation",
                        analysis.count > 1
                          ? numberText(analysis.deviation)
                          : "Needs two or more values",
                      ],
                    ] as const
                  ).map(([term, value]) => (
                    <div key={term} className="sheets-analysis-stat">
                      <dt className="min-w-0 truncate text-caption text-[var(--text-secondary)]">
                        {term}
                      </dt>
                      <dd className="shrink-0 text-ui tabular-nums font-semibold text-[var(--text-primary)]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 max-w-[36rem] text-caption text-[var(--text-secondary)]">
                  Measured from the current selection after the workbook
                  recalculated. Return to Grid to change the range.
                </p>
                {activeSheet.charts.length ? (
                  <div className="mt-5">
                    <span className={PANEL_LABEL}>Charts on this sheet</span>
                    <ul className="flex flex-col gap-1">
                      {activeSheet.charts.map((chart) => (
                        <li key={chart.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedChartId(chart.id);
                              const parsed = parseRange(
                                chart.sourceRange.split("!").at(-1) ?? "",
                              );
                              if (parsed) setRange(parsed);
                              setSheetMode("grid");
                            }}
                            className="flex w-full max-w-[28rem] items-baseline justify-between gap-2 rounded-chip px-1 py-1 text-left text-caption hover:bg-[var(--bg-hover)]"
                          >
                            <span className="min-w-0 truncate text-[var(--text-primary)]">
                              {chart.title}
                            </span>
                            <span className="shrink-0 tabular-nums text-[var(--text-secondary)]">
                              {chart.sourceRange}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {locked ? null : (
                  <button
                    type="button"
                    className={`${PANEL_BUTTON} mt-5`}
                    onClick={createChart}
                  >
                    Chart this range
                  </button>
                )}
              </>
            ) : (
              <p className="mt-4 max-w-[36rem] text-caption text-[var(--text-secondary)]">
                {selectionLabel} holds no numbers, so there is nothing to
                measure yet. Return to Grid, select cells with values, then open
                Analysis again.
              </p>
            )}
          </div>
        ) : null}
        <div className="sheets-grid-corner" />
        <div className="sheets-column-headers">
          <div
            style={{
              width: gridWidth,
              transform: `translateX(${-viewport.scrollLeft}px)`,
            }}
          >
            {columns.map((column) => (
              <button
                type="button"
                key={column}
                {...targetAttrs(
                  `/sheets/${activeSheetIndex}/columns/${column}`,
                )}
                onClick={() =>
                  setRange({
                    start: { row: 0, column },
                    end: { row: bounds.rows - 1, column },
                  })
                }
                className="sheets-column-header"
                data-ai-region={aiRegionAttr(
                  sheetsAiTouchesColumn(
                    aiChangedPaths,
                    activeSheetIndex,
                    column,
                  ),
                )}
                data-frozen={
                  column < (activeSheet.frozenColumns ?? 0) || undefined
                }
                data-freeze-edge={
                  column === (activeSheet.frozenColumns ?? 0) - 1 || undefined
                }
                style={{
                  left: columnOffsets[column],
                  width: columnSpan(column),
                  transform:
                    column < (activeSheet.frozenColumns ?? 0)
                      ? `translateX(${viewport.scrollLeft}px)`
                      : undefined,
                }}
              >
                {columnName(column)}
                {locked ? null : (
                  <SheetsTrackGrip
                    axis="column"
                    label={`Resize column ${columnName(column)}`}
                    onBegin={(event) =>
                      beginTrackResize("column", column, event)
                    }
                    onFit={() => fitTrackSize("column", column)}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="sheets-row-headers">
          <div
            style={{
              height: gridHeight,
              transform: `translateY(${-viewport.scrollTop}px)`,
            }}
          >
            {rows.map(({ row, position }) => (
              <button
                type="button"
                key={row}
                {...targetAttrs(`/sheets/${activeSheetIndex}/rows/${row}`)}
                onClick={() =>
                  setRange({
                    start: { row, column: 0 },
                    end: { row, column: bounds.columns - 1 },
                  })
                }
                className="sheets-row-header"
                data-frozen={row < (activeSheet.frozenRows ?? 0) || undefined}
                data-freeze-edge={
                  row === (activeSheet.frozenRows ?? 0) - 1 || undefined
                }
                style={{
                  top: rowOffsets[position],
                  height: rowSpan(position),
                  transform:
                    row < (activeSheet.frozenRows ?? 0)
                      ? `translateY(${viewport.scrollTop}px)`
                      : undefined,
                }}
              >
                {row + 1}
                {locked ? null : (
                  <SheetsTrackGrip
                    axis="row"
                    label={`Resize row ${row + 1}`}
                    onBegin={(event) => beginTrackResize("row", row, event)}
                    onFit={() => fitTrackSize("row", row)}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
        <div
          ref={gridRef}
          role="grid"
          aria-label={`${activeSheet.name} spreadsheet`}
          aria-rowcount={bounds.rows}
          aria-colcount={bounds.columns}
          tabIndex={0}
          className="sheets-grid-viewport"
          onScroll={updateViewport}
          onKeyDown={onGridKeyDown}
        >
          <div
            className="relative"
            style={{
              width: gridWidth,
              height: gridHeight,
            }}
          >
            {rows.flatMap(({ row, position }) =>
              columns.map((column) => {
                const coordinate = { row, column };
                const address = coordinateToAddress(coordinate);
                const merged = mergedCellMap.get(address);
                if (merged && merged.anchor !== address) return null;
                const cell = activeSheet.cells[address];
                const calculatedCell = calculated.get(
                  `${activeSheet.id}:${address}`,
                );
                const isActive = address === activeAddress;
                const isSelected = selected(normalizedSelection, row, column);
                const isFillAnchor =
                  row === normalizedSelection.end.row &&
                  column === normalizedSelection.end.column;
                const isEditing = editingAddress === address;
                const isFrozenRow = row < (activeSheet.frozenRows ?? 0);
                const isFrozenColumn =
                  column < (activeSheet.frozenColumns ?? 0);
                const matchesSearch =
                  search &&
                  (cellInput(cell)
                    .toLowerCase()
                    .includes(search.toLowerCase()) ||
                    formatCalculatedCell(
                      cell,
                      calculatedCell,
                      workbook.workbook.locale,
                      workbook.workbook.date1904,
                    )
                      .toLowerCase()
                      .includes(search.toLowerCase()));
                const table = activeSheet.tables.find((candidate) => {
                  const tableRange = parseRange(candidate.range);
                  return tableRange ? selected(tableRange, row, column) : false;
                });
                const tableRange = table ? parseRange(table.range) : null;
                const isTableHeader =
                  Boolean(tableRange) && row === tableRange!.start.row;
                const tableFilter = table?.filters?.find(
                  (candidate) => candidate.column === column,
                );
                const style = cell?.format;
                const conditionalStyle = conditionalStyles.get(address);
                return (
                  <SheetsCellPointerTarget
                    key={address}
                    handlersRef={cellHandlersRef}
                    coordinate={coordinate}
                    targetPath={`/sheets/${activeSheetIndex}/cells/${address}`}
                    merged={merged}
                    role="gridcell"
                    aria-rowindex={row + 1}
                    aria-colindex={column + 1}
                    aria-selected={isSelected}
                    data-address={address}
                    data-cache-stale={
                      cell?.cachedValueStale ? "true" : undefined
                    }
                    data-selected={isSelected || undefined}
                    data-active={isActive || undefined}
                    data-traced={
                      (tracedAddresses.has(address) && !isActive) || undefined
                    }
                    data-selection-top={
                      (isSelected && row === normalizedSelection.start.row) ||
                      undefined
                    }
                    data-selection-right={
                      (isSelected &&
                        column === normalizedSelection.end.column) ||
                      undefined
                    }
                    data-selection-bottom={
                      (isSelected && row === normalizedSelection.end.row) ||
                      undefined
                    }
                    data-selection-left={
                      (isSelected &&
                        column === normalizedSelection.start.column) ||
                      undefined
                    }
                    data-search-match={matchesSearch || undefined}
                    data-table={Boolean(table) || undefined}
                    data-table-header={isTableHeader || undefined}
                    data-filter-active={Boolean(tableFilter) || undefined}
                    data-frozen-row={isFrozenRow || undefined}
                    data-frozen-column={isFrozenColumn || undefined}
                    data-freeze-row-edge={
                      row === (activeSheet.frozenRows ?? 0) - 1 || undefined
                    }
                    data-freeze-column-edge={
                      column === (activeSheet.frozenColumns ?? 0) - 1 ||
                      undefined
                    }
                    data-ai-region={aiRegionAttr(
                      aiTouches(aiChangedPaths, activeSheetIndex, address),
                    )}
                    className="sheets-cell"
                    style={{
                      left:
                        columnOffsets[column]! +
                        (isFrozenColumn ? viewport.scrollLeft : 0),
                      top:
                        rowOffsets[position]! +
                        (isFrozenRow ? viewport.scrollTop : 0),
                      width: merged
                        ? columnOffsets[merged.range.end.column + 1]! -
                          columnOffsets[merged.range.start.column]!
                        : columnSpan(column),
                      height: merged
                        ? rowOffsets[
                            position +
                              merged.range.end.row -
                              merged.range.start.row +
                              1
                          ]! - rowOffsets[position]!
                        : rowSpan(position),
                      zIndex:
                        isFrozenRow && isFrozenColumn
                          ? 9
                          : isFrozenRow
                            ? 8
                            : isFrozenColumn
                              ? 7
                              : merged
                                ? 3
                                : undefined,
                      ...cellVisualStyle(style, zoom),
                      color: conditionalStyle?.color ?? style?.textColor,
                      backgroundColor:
                        conditionalStyle?.backgroundColor ?? style?.fillColor,
                    }}
                    onDoubleClick={() => {
                      if (!locked) {
                        setEditingAddress(address);
                        setEditingValue(cellInput(cell));
                      }
                    }}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editingValue}
                        onFocus={(event) => event.currentTarget.select()}
                        {...targetAttrs(
                          `/sheets/${activeSheetIndex}/cells/${address}/${
                            editingValue.startsWith("=") || cell?.formula
                              ? "formula"
                              : "value"
                          }`,
                        )}
                        onChange={(event) =>
                          setEditingValue(event.target.value)
                        }
                        onBlur={(event) =>
                          commitInput(address, event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitInput(address, event.currentTarget.value);
                            moveSelection(1, 0);
                          }
                          if (event.key === "Escape") setEditingAddress(null);
                        }}
                        className="sheets-cell-editor"
                      />
                    ) : (
                      <span
                        className={
                          showFormulas && cell?.formula
                            ? "sheets-cell-formula-text"
                            : calculatedCell?.error
                              ? "text-[var(--danger)]"
                              : ""
                        }
                      >
                        {/* Show formulas is the audit view: the text a cell
                            holds, not the number it works out to. Cells without
                            a formula still show their value, because a sheet of
                            blanks would tell you nothing. */}
                        {showFormulas && cell?.formula
                          ? cell.formula
                          : formatCalculatedCell(
                              cell,
                              calculatedCell,
                              workbook.workbook.locale,
                              workbook.workbook.date1904,
                            )}
                      </span>
                    )}
                    {cell?.note ? (
                      <span className="sheets-note-corner" title={cell.note} />
                    ) : null}
                    {isTableHeader && table ? (
                      <button
                        type="button"
                        className="sheets-table-filter"
                        disabled={locked}
                        aria-label={`Filter ${formatCalculatedCell(cell, calculatedCell, workbook.workbook.locale, workbook.workbook.date1904) || columnName(column)}`}
                        aria-pressed={Boolean(tableFilter)}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          const targetRange = parseRange(table.range)!;
                          const options = Array.from(
                            new Map(
                              Array.from(
                                {
                                  length:
                                    targetRange.end.row - targetRange.start.row,
                                },
                                (_, index) => targetRange.start.row + 1 + index,
                              ).map((dataRow) => {
                                const targetAddress = coordinateToAddress({
                                  row: dataRow,
                                  column,
                                });
                                const value =
                                  calculated.get(
                                    `${activeSheet.id}:${targetAddress}`,
                                  )?.value ??
                                  activeSheet.cells[targetAddress]?.value ??
                                  null;
                                return [JSON.stringify(value), value] as const;
                              }),
                            ).values(),
                          );
                          setFilterEditor({ tableId: table.id, column });
                          setFilterValues(
                            tableFilter?.allowedValues ?? options,
                          );
                          setInspector("filter");
                        }}
                      >
                        <ChevronDown />
                      </button>
                    ) : null}
                    {isFillAnchor && !isEditing && !locked ? (
                      <SheetsFillHandle
                        handlersRef={cellHandlersRef}
                        selection={normalizedSelection}
                        cells={activeSheet.cells}
                        selectionLabel={selectionLabel}
                        targetPath={`/sheets/${activeSheetIndex}/cells/${address}`}
                      />
                    ) : null}
                  </SheetsCellPointerTarget>
                );
              }),
            )}
            {/* Charts sit on the sheet itself, over the cells they read from,
                rather than in a separate section underneath the data (§11F). */}
            {activeSheet.charts.map((chart) => {
              const position =
                chartGesture?.id === chart.id
                  ? chartGesture.position
                  : chart.position;
              const selectedChart = selectedChartId === chart.id;
              const statistics = chartSummary(activeSheet, chart, calculated);
              return (
                <div
                  key={chart.id}
                  {...targetAttrs(
                    `/sheets/${activeSheetIndex}/charts/${activeSheet.charts.indexOf(chart)}`,
                  )}
                  data-ai-region={aiRegionAttr(
                    pathTouches(
                      aiChangedPaths,
                      `/sheets/${activeSheetIndex}/charts/${activeSheet.charts.indexOf(chart)}`,
                    ),
                  )}
                  className="sheets-chart-object"
                  data-selected={selectedChart || undefined}
                  data-dragging={chartGesture?.id === chart.id || undefined}
                  style={{
                    left: position.x * zoom,
                    top: position.y * zoom,
                    width: position.width * zoom,
                    height: position.height * zoom,
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedChartId(chart.id);
                  }}
                >
                  <header
                    onPointerDown={(event) =>
                      beginChartGesture(event, chart, "move")
                    }
                  >
                    <input
                      value={chart.title}
                      readOnly={locked}
                      aria-label="Chart title"
                      onPointerDown={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        patchChart(chart.id, { title: event.target.value })
                      }
                    />
                    {/* Spectra's own select, so the list is portaled and the
                        chart object cannot clip it. `onPointerDown` still stops
                        here or opening it would start a move gesture. */}
                    <span onPointerDown={(event) => event.stopPropagation()}>
                      <SelectField
                        ariaLabel={`Chart type for ${chart.title}`}
                        size="sm"
                        disabled={locked}
                        value={chart.type}
                        onChange={(next) =>
                          patchChart(chart.id, {
                            type: next as SheetChart["type"],
                          })
                        }
                        options={[
                          { value: "line", label: "Line" },
                          { value: "column", label: "Column" },
                          { value: "bar", label: "Bar" },
                          { value: "area", label: "Area" },
                          { value: "pie", label: "Pie or donut" },
                          { value: "scatter", label: "Scatter" },
                          { value: "combo", label: "Combination" },
                          { value: "histogram", label: "Histogram" },
                        ]}
                      />
                    </span>
                    <button
                      type="button"
                      aria-label={`Delete ${chart.title}`}
                      disabled={locked}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() =>
                        updateActiveSheet((sheet) => ({
                          ...sheet,
                          charts: sheet.charts.filter(
                            (candidate) => candidate.id !== chart.id,
                          ),
                        }))
                      }
                    >
                      <Trash2 />
                    </button>
                  </header>
                  <div className="sheets-chart-plot">
                    <SheetsChartView
                      sheet={activeSheet}
                      chart={chart}
                      calculated={calculated}
                    />
                  </div>
                  {/* Provenance stays on the object: the range it reads is part
                      of the chart, not a caption someone has to remember. */}
                  <footer>
                    <button
                      type="button"
                      title="Select the range this chart reads"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => {
                        const range = parseRange(
                          chart.sourceRange.split("!").at(-1) ?? "",
                        );
                        if (range) setRange(range);
                      }}
                    >
                      {chart.sourceRange}
                    </button>
                    {/* An unknown mean says why it is unknown instead of
                        printing a dash the reader has to interpret. */}
                    <span>
                      {statistics.mean === null
                        ? `n ${statistics.count} · no numeric values`
                        : `n ${statistics.count} · mean ${statistics.mean.toLocaleString(
                            workbook.workbook.locale,
                            { maximumFractionDigits: 3 },
                          )}`}
                    </span>
                  </footer>
                  <p className="sr-only">
                    {chart.title} uses {chart.sourceRange}. It contains{" "}
                    {statistics.count}{" "}
                    {statistics.count === 1 ? "observation" : "observations"}
                    {statistics.mean === null
                      ? "."
                      : `, with mean ${numberText(statistics.mean)}, minimum ${numberText(statistics.min ?? 0)}, maximum ${numberText(statistics.max ?? 0)}, and standard deviation ${numberText(statistics.standardDeviation ?? 0)}.`}
                  </p>

                  {locked ? null : (
                    <span
                      className="sheets-chart-resize"
                      role="presentation"
                      onPointerDown={(event) =>
                        beginChartGesture(event, chart, "resize")
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* One inspector rail. It overlays the grid instead of pushing it down,
            which is what the four bars it replaces used to do, and it stays in
            the DOM (never portaled) so its AI target hooks keep resolving. */}
        {panelMode ? (
          <aside
            aria-label={panelTitle}
            className={
              mode === "split"
                ? "absolute inset-x-0 bottom-0 z-chrome flex max-h-[min(46%,380px)] flex-col gap-3 overflow-y-auto border-t border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-lg)] motion-safe:animate-surface-in"
                : "absolute inset-y-0 right-0 z-chrome flex w-[min(312px,calc(100%-44px))] flex-col gap-3 overflow-y-auto border-l border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-lg)] motion-safe:animate-surface-in"
            }
          >
            <header className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-caption font-semibold text-[var(--text-primary)]">
                {panelTitle}
              </h2>
              {inspector ? (
                <button
                  type="button"
                  aria-label="Close panel"
                  onClick={() => {
                    if (inspector === "find") setSearch("");
                    if (inspector === "filter") setFilterEditor(null);
                    setInspector(null);
                  }}
                  className="grid size-7 shrink-0 place-items-center rounded-control text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </header>

            {panelMode === "format" ? (
              <>
                <SelectField
                  label="Number format"
                  size="sm"
                  value={activeCell?.format?.numberFormat ?? "general"}
                  onChange={(next) => runCommand("format.number", next)}
                  options={SHEETS_NUMBER_FORMATS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                />
                {activeCell?.format?.numberFormat === "currency" ? (
                  <SelectField
                    label="Currency"
                    size="sm"
                    value={activeCell?.format?.currency ?? "USD"}
                    onChange={(next) => runCommand("format.currency", next)}
                    options={SHEETS_CURRENCIES.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                  />
                ) : null}
                {activeCell?.format?.numberFormat === "custom" ? (
                  <label className="block">
                    <span className={PANEL_LABEL}>Format code</span>
                    <input
                      value={
                        customFormatDraft ||
                        (activeCell?.format?.customFormat ?? "")
                      }
                      onChange={(event) =>
                        setCustomFormatDraft(event.target.value)
                      }
                      onBlur={() =>
                        runCommand("format.number.custom", customFormatDraft)
                      }
                      placeholder="#,##0.00"
                      className={PANEL_INPUT}
                    />
                    <span className="mt-1 block text-caption text-[var(--text-secondary)]">
                      An Excel format code. The stored number never changes.
                    </span>
                  </label>
                ) : null}
                <div>
                  <span className={PANEL_LABEL}>Decimal places</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className={PANEL_BUTTON}
                      onClick={() =>
                        runCommand(
                          "format.decimals",
                          Math.max(0, (activeCell?.format?.decimals ?? 2) - 1),
                        )
                      }
                    >
                      Fewer
                    </button>
                    <span className="w-8 text-center text-ui tabular-nums text-[var(--text-primary)]">
                      {activeCell?.format?.decimals ?? 2}
                    </span>
                    <button
                      type="button"
                      className={PANEL_BUTTON}
                      onClick={() =>
                        runCommand(
                          "format.decimals",
                          Math.min(10, (activeCell?.format?.decimals ?? 2) + 1),
                        )
                      }
                    >
                      More
                    </button>
                  </div>
                </div>
                <div>
                  <span className={PANEL_LABEL}>Emphasis and alignment</span>
                  <div className="flex items-center gap-1">
                    {emphasisControls.map(
                      ({ label, icon: Icon, ...control }) => (
                        <ToolbarButton key={label} label={label} {...control}>
                          <Icon />
                        </ToolbarButton>
                      ),
                    )}
                  </div>
                </div>
                <SelectField
                  label="Typeface"
                  size="sm"
                  value={activeCell?.format?.fontFamily ?? "sans"}
                  onChange={(next) => runCommand("format.fontFamily", next)}
                  options={[
                    { value: "sans", label: "Spectra Sans" },
                    { value: "serif", label: "Spectra Serif" },
                    { value: "mono", label: "Monospace" },
                  ]}
                />
                <SelectField
                  label="Size"
                  size="sm"
                  value={String(activeCell?.format?.fontSize ?? 11)}
                  onChange={(next) =>
                    runCommand("format.fontSize", Number(next))
                  }
                  options={["9", "10", "11", "12", "14", "16"].map((size) => ({
                    value: size,
                    label: `${size} px`,
                  }))}
                />
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["Text", "textColor", "#222522"],
                      ["Fill", "fillColor", "var(--bg-elevated)"],
                    ] as const
                  ).map(([label, key, fallback]) => (
                    <label key={key} className="block">
                      <span className={PANEL_LABEL}>{label}</span>
                      <input
                        type="color"
                        value={activeCell?.format?.[key] ?? fallback}
                        onChange={(event) =>
                          runCommand(
                            key === "textColor"
                              ? "format.color"
                              : "format.fill",
                            event.target.value,
                          )
                        }
                        className="h-8 w-full cursor-pointer rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] p-1"
                      />
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={PANEL_BUTTON}
                    disabled={selectedAddresses.length < 2}
                    onClick={() => runCommand("format.merge")}
                  >
                    Merge cells
                  </button>
                  <button
                    type="button"
                    className={PANEL_BUTTON}
                    disabled={!mergedHere}
                    onClick={() => runCommand("format.unmerge")}
                  >
                    Unmerge
                  </button>
                  <button
                    type="button"
                    className={PANEL_BUTTON}
                    onClick={() => setInspector("borders")}
                  >
                    Borders
                  </button>
                </div>
              </>
            ) : null}

            {panelMode === "name" ? (
              <>
                <p className="text-caption text-[var(--text-secondary)]">
                  Use the name in formulas and links instead of an address that
                  moves when rows are inserted.
                </p>
                <label className="block">
                  <span className={PANEL_LABEL}>Name</span>
                  <input
                    autoFocus
                    value={namedRangeDraft}
                    onChange={(event) => setNamedRangeDraft(event.target.value)}
                    placeholder="class_means"
                    className={PANEL_INPUT}
                  />
                </label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className={PANEL_PRIMARY}
                    onClick={() => {
                      const name = namedRangeDraft.trim();
                      if (
                        !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ||
                        parseAddress(name)
                      ) {
                        setImportNotice(
                          "Named ranges must begin with a letter or underscore and cannot look like a cell address.",
                          "warning",
                        );
                        return;
                      }
                      const sheetName = `'${activeSheet.name.replaceAll("'", "''")}'`;
                      commit({
                        ...workbook,
                        workbook: {
                          ...workbook.workbook,
                          namedRanges: {
                            ...workbook.workbook.namedRanges,
                            [name]: `${sheetName}!${selectionLabel}`,
                          },
                        },
                      });
                      setNameDraft(name.toUpperCase());
                      setInspector(null);
                      setNamedRangeDraft("");
                      setImportNotice(`Named ${selectionLabel} as ${name}.`);
                    }}
                  >
                    Save name
                  </button>
                </div>
                {Object.keys(workbook.workbook.namedRanges ?? {}).length ? (
                  <div>
                    <span className={PANEL_LABEL}>Names in this workbook</span>
                    <ul className="flex flex-col gap-1">
                      {Object.entries(workbook.workbook.namedRanges ?? {}).map(
                        ([name, target]) => (
                          <li
                            key={name}
                            className="flex items-baseline justify-between gap-2 text-caption"
                          >
                            <span className="min-w-0 truncate font-semibold text-[var(--text-primary)]">
                              {name}
                            </span>
                            <span className="shrink-0 tabular-nums text-[var(--text-secondary)]">
                              {target}
                            </span>
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : null}

            {panelMode === "validate" ? (
              <>
                <p className="text-caption text-[var(--text-secondary)]">
                  Invalid entries are rejected before they reach live state.
                </p>
                <SelectField
                  label="Rule"
                  size="sm"
                  value={validationKind}
                  onChange={(next) =>
                    setValidationKind(next as "list" | "number" | "checkbox")
                  }
                  options={[
                    { value: "list", label: "List of values" },
                    { value: "number", label: "Number range" },
                    { value: "checkbox", label: "Checkbox" },
                  ]}
                />
                {validationKind !== "checkbox" ? (
                  <label className="block">
                    <span className={PANEL_LABEL}>
                      {validationKind === "list"
                        ? "Allowed values, comma separated"
                        : "Minimum and maximum, comma separated"}
                    </span>
                    <input
                      value={validationDraft}
                      onChange={(event) =>
                        setValidationDraft(event.target.value)
                      }
                      placeholder={
                        validationKind === "list"
                          ? "Draft, Ready, Complete"
                          : "0, 50"
                      }
                      className={PANEL_INPUT}
                    />
                  </label>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={PANEL_PRIMARY}
                    onClick={() => {
                      let validation: SheetValidation;
                      if (validationKind === "list") {
                        const options = validationDraft
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean);
                        if (!options.length) {
                          setImportNotice(
                            "List validation needs at least one value.",
                            "warning",
                          );
                          return;
                        }
                        validation = {
                          kind: "list",
                          options,
                          rejectInvalid: true,
                        };
                      } else if (validationKind === "number") {
                        const [minimumText, maximumText] =
                          validationDraft.split(",", 2);
                        const minimum = minimumText?.trim()
                          ? Number(minimumText)
                          : undefined;
                        const maximum = maximumText?.trim()
                          ? Number(maximumText)
                          : undefined;
                        if (
                          (minimum !== undefined &&
                            !Number.isFinite(minimum)) ||
                          (maximum !== undefined &&
                            !Number.isFinite(maximum)) ||
                          (minimum !== undefined &&
                            maximum !== undefined &&
                            minimum > maximum)
                        ) {
                          setImportNotice(
                            "Enter a valid minimum and maximum separated by a comma.",
                            "warning",
                          );
                          return;
                        }
                        validation = {
                          kind: "number",
                          ...(minimum !== undefined ? { minimum } : {}),
                          ...(maximum !== undefined ? { maximum } : {}),
                          rejectInvalid: true,
                        };
                      } else
                        validation = { kind: "checkbox", rejectInvalid: true };
                      updateActiveSheet((sheet) => ({
                        ...sheet,
                        cells: {
                          ...sheet.cells,
                          ...Object.fromEntries(
                            selectedAddresses.map((address) => [
                              address,
                              { ...sheet.cells[address], validation },
                            ]),
                          ),
                        },
                      }));
                      setInspector(null);
                      setImportNotice(
                        `Validation applied to ${selectionLabel}.`,
                      );
                    }}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className={PANEL_BUTTON}
                    onClick={() => {
                      updateActiveSheet((sheet) => ({
                        ...sheet,
                        cells: Object.fromEntries(
                          Object.entries(sheet.cells).map(([address, cell]) => [
                            address,
                            selectedAddresses.includes(address)
                              ? { ...cell, validation: undefined }
                              : cell,
                          ]),
                        ),
                      }));
                      setInspector(null);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </>
            ) : null}

            {panelMode === "conditional" ? (
              <>
                <p className="text-caption text-[var(--text-secondary)]">
                  Rules follow the range as values and formulas recalculate.
                </p>
                <SelectField
                  label="Rule"
                  size="sm"
                  value={conditionalKind}
                  onChange={(next) =>
                    setConditionalKind(
                      next as
                        | "color_scale"
                        | "greater_than"
                        | "less_than"
                        | "equal_to",
                    )
                  }
                  options={[
                    { value: "color_scale", label: "Green colour scale" },
                    { value: "greater_than", label: "Greater than" },
                    { value: "less_than", label: "Less than" },
                    { value: "equal_to", label: "Equal to" },
                  ]}
                />
                {conditionalKind !== "color_scale" ? (
                  <label className="block">
                    <span className={PANEL_LABEL}>Compare with</span>
                    <input
                      type="number"
                      value={conditionalThreshold}
                      onChange={(event) =>
                        setConditionalThreshold(event.target.value)
                      }
                      className={PANEL_INPUT}
                    />
                  </label>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={PANEL_PRIMARY}
                    onClick={applyConditionalFormat}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className={PANEL_BUTTON}
                    onClick={() => {
                      updateActiveSheet((sheet) => ({
                        ...sheet,
                        conditionalFormats: (
                          sheet.conditionalFormats ?? []
                        ).filter((rule) => {
                          const parsed = parseRange(rule.range);
                          return parsed
                            ? !rangesOverlap(parsed, normalizedSelection)
                            : false;
                        }),
                      }));
                      setInspector(null);
                      setImportNotice(
                        `Conditional formatting removed from ${selectionLabel}.`,
                      );
                    }}
                  >
                    Remove here
                  </button>
                </div>
              </>
            ) : null}

            {panelMode === "find" ? (
              <>
                <label className="block">
                  <span className={PANEL_LABEL}>Value or formula</span>
                  <input
                    autoFocus
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="24.09 or AVERAGE"
                    className={PANEL_INPUT}
                  />
                </label>
                <p className="text-caption text-[var(--text-secondary)]">
                  {search
                    ? `${searchMatches.length} ${searchMatches.length === 1 ? "cell matches" : "cells match"} in ${activeSheet.name}.`
                    : "Matches highlight in the grid as you type."}
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className={PANEL_PRIMARY}
                    disabled={!searchMatches.length}
                    onClick={() => {
                      const next =
                        searchMatches[searchCursor % searchMatches.length];
                      const coordinate = next ? parseAddress(next) : null;
                      if (coordinate)
                        setRange({ start: coordinate, end: coordinate });
                      setSearchCursor((current) => current + 1);
                    }}
                  >
                    Find next
                  </button>
                </div>
              </>
            ) : null}

            {panelMode === "sheet" ? (
              <>
                <label className="block">
                  <span className={PANEL_LABEL}>Sheet name</span>
                  <input
                    autoFocus
                    value={renameDraft}
                    {...targetAttrs(`/sheets/${activeSheetIndex}/name`)}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    className={PANEL_INPUT}
                  />
                </label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className={PANEL_PRIMARY}
                    onClick={() => {
                      const name = renameDraft.trim();
                      if (!name) {
                        setImportNotice("A sheet needs a name.", "warning");
                        return;
                      }
                      commit(
                        renameWorkbookSheet(workbook, activeSheet.id, name),
                      );
                      setInspector(null);
                    }}
                  >
                    Rename
                  </button>
                </div>
              </>
            ) : null}

            {panelMode === "borders" ? (
              <>
                <p className="text-caption text-[var(--text-secondary)]">
                  Applied to {selectionLabel}. Choose the line first, then the
                  edges you want it on.
                </p>
                <SelectField
                  label="Line"
                  size="sm"
                  value={borderStyle}
                  onChange={(next) => runCommand("format.borders.style", next)}
                  options={SHEETS_BORDER_STYLES.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                />
                <label className="block">
                  <span className={PANEL_LABEL}>Colour</span>
                  <input
                    type="color"
                    value={borderColor ?? "#667085"}
                    onChange={(event) =>
                      runCommand("format.borders.color", event.target.value)
                    }
                    className="h-8 w-full cursor-pointer rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] p-1"
                  />
                </label>
                <div className="sheets-border-presets">
                  {SHEETS_BORDER_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className={PANEL_BUTTON}
                      onClick={() => runCommand("format.borders", preset.value)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {panelMode === "replace" ? (
              <>
                <label className="block">
                  <span className={PANEL_LABEL}>Find</span>
                  <input
                    autoFocus
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Term 1"
                    className={PANEL_INPUT}
                  />
                </label>
                <label className="block">
                  <span className={PANEL_LABEL}>Replace with</span>
                  <input
                    value={replaceDraft}
                    onChange={(event) => setReplaceDraft(event.target.value)}
                    placeholder="Term 2"
                    className={PANEL_INPUT}
                  />
                </label>
                <p className="text-caption text-[var(--text-secondary)]">
                  {search.trim()
                    ? `${searchMatches.length} ${searchMatches.length === 1 ? "cell matches" : "cells match"}. Formulas Spectra cannot evaluate keep the text Excel wrote.`
                    : "Values and formula text are both searched."}
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className={PANEL_PRIMARY}
                    disabled={!search.trim()}
                    onClick={() => replaceInSelection("sheet")}
                  >
                    Replace in sheet
                  </button>
                  <button
                    type="button"
                    className={PANEL_BUTTON}
                    disabled={!search.trim() || selectedAddresses.length < 2}
                    onClick={() => replaceInSelection("selection")}
                  >
                    In selection
                  </button>
                </div>
              </>
            ) : null}

            {panelMode === "sort" ? (
              <>
                <p className="text-caption text-[var(--text-secondary)]">
                  Keys apply in order. A second key only decides rows the first
                  key ties on, which is what a single sort could never do.
                </p>
                {sortKeys.map((key, index) => (
                  <div
                    key={`${key.column}-${index}`}
                    className="flex items-end gap-1.5"
                  >
                    <SelectField
                      label={index === 0 ? "Then by" : ""}
                      size="sm"
                      value={String(key.column)}
                      onChange={(next) =>
                        setSortKeys((current) =>
                          current.map((entry, position) =>
                            position === index
                              ? { ...entry, column: Number(next) }
                              : entry,
                          ),
                        )
                      }
                      options={Array.from(
                        { length: Math.max(1, bounds.columns) },
                        (_, column) => ({
                          value: String(column),
                          label: columnName(column),
                        }),
                      )}
                    />
                    <button
                      type="button"
                      className={PANEL_BUTTON}
                      onClick={() =>
                        setSortKeys((current) =>
                          current.map((entry, position) =>
                            position === index
                              ? {
                                  ...entry,
                                  direction:
                                    entry.direction === "asc" ? "desc" : "asc",
                                }
                              : entry,
                          ),
                        )
                      }
                    >
                      {key.direction === "asc" ? "A to Z" : "Z to A"}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove sort key ${index + 1}`}
                      className={PANEL_BUTTON}
                      onClick={() =>
                        setSortKeys((current) =>
                          current.filter((_, position) => position !== index),
                        )
                      }
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className={PANEL_BUTTON}
                    onClick={() =>
                      setSortKeys((current) => [
                        ...current,
                        {
                          column:
                            normalizedSelection.start.column + current.length,
                          direction: "asc",
                        },
                      ])
                    }
                  >
                    Add a key
                  </button>
                  <button
                    type="button"
                    className={PANEL_PRIMARY}
                    disabled={!sortKeys.length}
                    onClick={() => {
                      runCustomSort();
                      setInspector(null);
                    }}
                  >
                    Sort
                  </button>
                </div>
              </>
            ) : null}

            {panelMode === "note" ? (
              <>
                <label className="block">
                  <span className={PANEL_LABEL}>Note</span>
                  <textarea
                    autoFocus
                    rows={4}
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    placeholder="Why this number is what it is"
                    className={`${PANEL_INPUT} resize-none`}
                  />
                </label>
                <p className="text-caption text-[var(--text-secondary)]">
                  A note shows on hover and travels with the cell inside
                  Spectra.
                  {mountedNative
                    ? " This workbook keeps its Excel comments exactly as they were saved; a Spectra note is not written into that file."
                    : ""}
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className={PANEL_PRIMARY}
                    onClick={() => {
                      setNoteOnActiveCell(noteDraft);
                      setInspector(null);
                    }}
                  >
                    Save note
                  </button>
                  {activeCell?.note ? (
                    <button
                      type="button"
                      className={PANEL_BUTTON}
                      onClick={() => {
                        setNoteOnActiveCell("");
                        setNoteDraft("");
                        setInspector(null);
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}

            {panelMode === "library" ? (
              <>
                <label className="block">
                  <span className={PANEL_LABEL}>Function</span>
                  <input
                    autoFocus
                    value={libraryFilter}
                    onChange={(event) => setLibraryFilter(event.target.value)}
                    placeholder="sum, lookup, date"
                    className={PANEL_INPUT}
                  />
                </label>
                {activeCell?.formula ? (
                  <div className="sheets-formula-explanation">
                    <p className="text-caption text-[var(--text-secondary)]">
                      {activeAddress} holds <code>{activeCell.formula}</code>
                      {activeCell.nativeFormulaSupport === "cached-only"
                        ? ", which Excel evaluates. Spectra shows the value Excel saved and keeps the text exactly as written."
                        : activeCalculated?.error
                          ? `, and it currently reports ${activeCalculated.error}.`
                          : `, and it currently works out to ${formatCalculatedCell(activeCell, activeCalculated, workbook.workbook.locale, workbook.workbook.date1904)}.`}
                    </p>
                    {/* Naming the functions is the explanation. A person reading
                        an inherited sheet needs to know what each piece does, and
                        whether Spectra or Excel is the one doing it. */}
                    {explainedFunctions.length ? (
                      <ul className="sheets-function-list">
                        {explainedFunctions.map((entry) => (
                          <li key={entry.name}>
                            <span className="sheets-function-entry">
                              <span className="sheets-function-name">
                                {entry.name}
                              </span>
                              <span className="sheets-function-summary">
                                {entry.summary}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                <ul className="sheets-function-list">
                  {SHEETS_FUNCTION_LIBRARY.filter((spec) => {
                    const needle = libraryFilter.trim().toLowerCase();
                    return (
                      !needle ||
                      spec.name.toLowerCase().includes(needle) ||
                      spec.summary.toLowerCase().includes(needle) ||
                      spec.group.toLowerCase().includes(needle)
                    );
                  }).map((spec) => (
                    <li key={spec.name}>
                      <button
                        type="button"
                        className="sheets-function-entry"
                        onClick={() => runCommand("formula.insert", spec.name)}
                      >
                        <span className="sheets-function-name">
                          {spec.name}
                        </span>
                        <span className="sheets-function-summary">
                          {spec.summary}
                        </span>
                        <span className="sheets-function-native">
                          {spec.native
                            ? "Live formula in Excel"
                            : "Spectra calculates this"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {panelMode === "chart" && selectedChart ? (
              <>
                <label className="block">
                  <span className={PANEL_LABEL}>Title</span>
                  <input
                    value={chartTitleDraft || selectedChart.title}
                    onChange={(event) => setChartTitleDraft(event.target.value)}
                    onBlur={() =>
                      chartTitleDraft.trim() &&
                      patchChart(selectedChart.id, {
                        title: chartTitleDraft.trim(),
                      })
                    }
                    className={PANEL_INPUT}
                  />
                </label>
                <label className="block">
                  <span className={PANEL_LABEL}>Data range</span>
                  <input
                    value={chartRangeDraft || selectedChart.sourceRange}
                    onChange={(event) => setChartRangeDraft(event.target.value)}
                    onBlur={() => {
                      const next = chartRangeDraft.trim().toUpperCase();
                      if (!next) return;
                      if (!parseRange(next)) {
                        setImportNotice(
                          `${next} is not a range Spectra can read. Use a form like A1:C12.`,
                          "warning",
                        );
                        return;
                      }
                      patchChart(selectedChart.id, { sourceRange: next });
                    }}
                    className={PANEL_INPUT}
                  />
                </label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={PANEL_BUTTON}
                    onClick={() => runCommand("chart.legend")}
                  >
                    {selectedChart.showLegend === false
                      ? "Show legend"
                      : "Hide legend"}
                  </button>
                  <button
                    type="button"
                    className={PANEL_BUTTON}
                    onClick={() => {
                      runCommand("chart.remove");
                      setInspector(null);
                    }}
                  >
                    Delete chart
                  </button>
                </div>
              </>
            ) : null}

            {panelMode === "filter" && filterEditor && activeFilterTable ? (
              <>
                <p className="text-caption text-[var(--text-secondary)]">
                  {activeFilterOptions.length} distinct values in{" "}
                  {activeFilterTable.name}.
                </p>
                <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                  {activeFilterOptions.map((value) => {
                    const key = JSON.stringify(value);
                    const checked = filterValues.some(
                      (candidate) => JSON.stringify(candidate) === key,
                    );
                    return (
                      <label
                        key={key}
                        className="flex items-center gap-2 rounded-chip px-1 py-1 text-ui text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setFilterValues((current) =>
                              checked
                                ? current.filter(
                                    (candidate) =>
                                      JSON.stringify(candidate) !== key,
                                  )
                                : [...current, value],
                            )
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {value === null ? "Blank" : String(value)}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={PANEL_PRIMARY}
                    onClick={() => {
                      updateActiveSheet((sheet) => ({
                        ...sheet,
                        tables: sheet.tables.map((table) =>
                          table.id === filterEditor.tableId
                            ? {
                                ...table,
                                filters: [
                                  ...(table.filters ?? []).filter(
                                    (filter) =>
                                      filter.column !== filterEditor.column,
                                  ),
                                  {
                                    column: filterEditor.column,
                                    allowedValues: filterValues,
                                  },
                                ],
                              }
                            : table,
                        ),
                      }));
                      setFilterEditor(null);
                      setInspector(null);
                    }}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className={PANEL_BUTTON}
                    onClick={() => setFilterValues(activeFilterOptions)}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className={PANEL_BUTTON}
                    onClick={() => {
                      updateActiveSheet((sheet) => ({
                        ...sheet,
                        tables: sheet.tables.map((table) =>
                          table.id === filterEditor.tableId
                            ? {
                                ...table,
                                filters: (table.filters ?? []).filter(
                                  (filter) =>
                                    filter.column !== filterEditor.column,
                                ),
                              }
                            : table,
                        ),
                      }));
                      setFilterEditor(null);
                      setInspector(null);
                    }}
                  >
                    Clear
                  </button>
                </div>
              </>
            ) : null}
          </aside>
        ) : null}

        {/* The empty state invites rather than blocks: the grid underneath is
            live, so the first keystroke lands in A1. */}
        {sheetIsEmpty && !importing && !analysing ? (
          <div className="pointer-events-none absolute inset-x-0 top-[34%] z-chrome flex justify-center px-6">
            <div className="pointer-events-auto max-w-[302px] text-center">
              <p className="text-subhead font-semibold text-[var(--text-primary)]">
                {emptyState.headline}
              </p>
              <p className="mt-1 text-caption text-[var(--text-secondary)]">
                {emptyState.body}
              </p>
              {locked ? null : (
                <button
                  type="button"
                  disabled={!synchronizationReady}
                  onClick={() => importRef.current?.click()}
                  className="mt-2.5 inline-flex h-8 items-center rounded-control bg-[var(--text-primary)] px-3 text-caption font-semibold text-[var(--bg-primary)] transition-opacity hover:opacity-90 disabled:opacity-45"
                >
                  {emptyState.action}
                </button>
              )}
            </div>
          </div>
        ) : null}

        {/* Importing replaces the whole workbook, so the wait is stated over the
            grid it is about to change rather than in a corner. */}
        {importing ? (
          <div
            aria-live="polite"
            className="absolute inset-0 z-chrome grid place-items-center bg-[color-mix(in_oklab,var(--bg-primary)_76%,transparent)] px-6"
          >
            <div className="flex flex-col items-center gap-2.5 text-center">
              <span className="block h-1 w-40 overflow-hidden rounded-pill bg-[var(--bg-secondary)]">
                <span className="block h-full w-1/2 rounded-pill bg-[var(--brand-primary)] motion-safe:animate-pulse" />
              </span>
              <span className="text-caption text-[var(--text-secondary)]">
                Reading the file and checking every sheet before it replaces
                this one.
              </span>
            </div>
          </div>
        ) : null}

        {/* Not `role="status"`: the shared rail owns save state, and the rule
            that hides `[role="status"]` in this studio was hiding every import
            result and validation error with it. */}
        {notice ? (
          <div
            aria-live="polite"
            className="absolute left-1/2 z-chrome flex max-w-[min(430px,calc(100%-28px))] -translate-x-1/2 items-start gap-2 rounded-card border bg-[var(--bg-elevated)] px-3 py-2 text-caption shadow-[var(--shadow-lg)] motion-safe:animate-surface-in"
            style={{
              bottom: "calc(12px + var(--spectra-composer-safe-area, 0px))",
              borderColor:
                notice.tone === "warning"
                  ? "color-mix(in oklab, var(--warning) 46%, var(--border-default))"
                  : "var(--border-default)",
            }}
          >
            {notice.tone === "warning" ? (
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-[var(--warning)]"
              />
            ) : null}
            <span className="min-w-0 flex-1 text-[var(--text-primary)]">
              {notice.message}
            </span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setNotice(null)}
              className="grid size-6 shrink-0 place-items-center rounded-chip text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});
