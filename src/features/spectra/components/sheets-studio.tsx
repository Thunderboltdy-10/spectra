"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BarChart3,
  Bold,
  ChevronDown,
  Copy,
  Download,
  Filter,
  CheckCircle2,
  Circle,
  Italic,
  Loader2,
  MoreHorizontal,
  Plus,
  Redo2,
  Search,
  Sigma,
  SortAsc,
  SortDesc,
  Trash2,
  Underline,
  Undo2,
  Upload,
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
  calculateWorkbook,
  columnName,
  coordinateToAddress,
  delimitedValue,
  formatCalculatedCell,
  normalizeRange,
  normalizeSheetsContent,
  mutateSheetAxis,
  parseAddress,
  parseDelimited,
  parseRange,
  rangeAddresses,
  rangeLabel,
  type CellCoordinate,
  type CellRange,
  type SheetCell,
  type SheetChart,
  type SheetConditionalFormat,
  type SheetScalar,
  type SheetValidation,
  type SheetsContent,
  type WorkbookSheet,
} from "../sheets/model";
import { exportOds, importOds } from "../sheets/ods";
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

const ROW_HEIGHT = 31;
const COLUMN_WIDTH = 122;
const ROW_HEADER_WIDTH = 46;
const COLUMN_HEADER_HEIGHT = 30;
const CHART_COLORS = ["#169b69", "#7066ed", "#db7b27", "#2f8fd2", "#b85d7a"];

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
type MenuName = "file" | "edit" | "view" | "insert" | "format" | "data" | null;

function sameContent(left: SheetsContent, right: SheetsContent) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cellInput(cell?: SheetCell) {
  if (cell?.formula)
    return cell.formula.startsWith("=") ? cell.formula : `=${cell.formula}`;
  return cell?.value === null || cell?.value === undefined
    ? ""
    : String(cell.value);
}

function parseCellInput(value: string): SheetCell {
  if (value.startsWith("=")) return { formula: value };
  if (!value.trim()) return {};
  if (/^(?:true|false)$/i.test(value.trim()))
    return { value: value.trim().toLowerCase() === "true" };
  const numeric = Number(value.replaceAll(",", ""));
  return Number.isFinite(numeric) && value.trim() !== ""
    ? { value: numeric }
    : { value };
}

function translateFormula(
  formula: string,
  rowDelta: number,
  columnDelta: number,
) {
  return formula.replace(
    /(^|[^A-Za-z0-9_])(?:(('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?)(\$?)([A-Za-z]+)(\$?)([1-9][0-9]*)/g,
    (
      match,
      prefix,
      sheetPrefix,
      _sheetName,
      absoluteColumn,
      column,
      absoluteRow,
      row,
    ) => {
      const coordinate = parseAddress(`${column}${row}`);
      if (!coordinate) return match;
      const nextColumn = absoluteColumn
        ? coordinate.column
        : coordinate.column + columnDelta;
      const nextRow = absoluteRow ? coordinate.row : coordinate.row + rowDelta;
      if (nextColumn < 0 || nextRow < 0)
        return `${prefix}${sheetPrefix || ""}#REF!`;
      return `${prefix}${sheetPrefix || ""}${absoluteColumn || ""}${columnName(nextColumn)}${absoluteRow || ""}${nextRow + 1}`;
    },
  );
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

export function chartDataset(
  sheet: WorkbookSheet,
  chart: SheetChart,
  calculated: ReturnType<typeof calculateWorkbook>,
) {
  const range = parseRange(chart.sourceRange.split("!").at(-1) ?? "");
  if (!range) return { data: [], keys: [] as string[], category: "Category" };
  const normalized = normalizeRange(range);
  const headers: string[] = [];
  for (
    let column = normalized.start.column;
    column <= normalized.end.column;
    column += 1
  ) {
    const address = coordinateToAddress({ row: normalized.start.row, column });
    headers.push(
      formatCalculatedCell(
        sheet.cells[address],
        calculated.get(`${sheet.id}:${address}`),
        "en-US",
      ) || columnName(column),
    );
  }
  const singleSeries = headers.length === 1;
  const data = [];
  for (
    let row = normalized.start.row + 1;
    row <= normalized.end.row;
    row += 1
  ) {
    const entry: Record<string, string | number> = singleSeries
      ? { Category: String(row - normalized.start.row) }
      : {};
    for (
      let column = normalized.start.column;
      column <= normalized.end.column;
      column += 1
    ) {
      const address = coordinateToAddress({ row, column });
      const value =
        calculated.get(`${sheet.id}:${address}`)?.value ??
        sheet.cells[address]?.value ??
        null;
      entry[headers[column - normalized.start.column]!] =
        typeof value === "number" ? value : String(value ?? "");
    }
    data.push(entry);
  }
  return singleSeries
    ? { data, category: "Category", keys: headers }
    : { data, category: headers[0] ?? "Category", keys: headers.slice(1) };
}

function chartSummary(
  sheet: WorkbookSheet,
  chart: SheetChart,
  calculated: ReturnType<typeof calculateWorkbook>,
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
  calculated: ReturnType<typeof calculateWorkbook>,
) {
  const range = parseRange(chart.sourceRange.split("!").at(-1) ?? "");
  if (!range) return [];
  const normalized = normalizeRange(range);
  const values: number[] = [];
  for (
    let row = normalized.start.row + 1;
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
  calculated: ReturnType<typeof calculateWorkbook>,
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
    bucket: `${bin.lower.toFixed(precision)}–${bin.upper.toFixed(precision)}`,
    count: bin.count,
  }));
}

function SheetsChartView({
  sheet,
  chart,
  calculated,
}: {
  sheet: WorkbookSheet;
  chart: SheetChart;
  calculated: ReturnType<typeof calculateWorkbook>;
}) {
  const dataset = chartDataset(sheet, chart, calculated);
  const common = {
    data: dataset.data,
    margin: { top: 8, right: 16, left: 0, bottom: 4 },
  };
  const axes = (
    <>
      <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
      <XAxis
        dataKey={dataset.category}
        tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
        tickLine={false}
        axisLine={{ stroke: "var(--border-default)" }}
      />
      <YAxis
        tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
        tickLine={false}
        axisLine={false}
      />
      <ChartTooltip />
      <Legend wrapperStyle={{ fontSize: 10 }} />
    </>
  );
  if (chart.type === "histogram") {
    const histogram = histogramDataset(sheet, chart, calculated);
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={histogram}
          margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
          barCategoryGap={1}
        >
          <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            dataKey="bucket"
            tick={{ fontSize: 9, fill: "var(--text-tertiary)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border-default)" }}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
            tickLine={false}
            axisLine={false}
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
          <CartesianGrid stroke="var(--border-subtle)" />
          <XAxis
            type="number"
            dataKey={xKey}
            name={xKey}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
            tickLine={false}
          />
          <YAxis
            type="number"
            dataKey={yKey}
            name={yKey}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
            tickLine={false}
          />
          <ChartTooltip cursor={{ strokeDasharray: "3 3" }} />
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
          {axes}
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
          {axes}
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
          {axes}
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
        {axes}
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

function SheetsCellPointerTarget({
  handlersRef,
  coordinate,
  merged,
  className,
  style,
  children,
  onDoubleClick,
  ...rest
}: {
  handlersRef: MutableRefObject<SheetsCellHandlers>;
  coordinate: CellCoordinate;
  merged?: { range: CellRange };
  className?: string;
  style?: CSSProperties;
  children: React.ReactNode;
  onDoubleClick?: () => void;
} & Record<string, unknown>) {
  return (
    <div
      {...rest}
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
}: {
  handlersRef: MutableRefObject<SheetsCellHandlers>;
  selection: CellRange;
  cells: Record<string, SheetCell>;
  selectionLabel: string;
}) {
  return (
    <button
      type="button"
      className="sheets-fill-handle"
      aria-label={`Fill from ${selectionLabel}`}
      title="Drag to fill values and formulas"
      onPointerDown={(event) =>
        handlersRef.current.onFillHandlePointerDown(event, selection, cells)
      }
    />
  );
}

export function SheetsStudio({
  artifactId,
  content,
  onChange,
  aiChangedPaths = [],
  readOnly = false,
  synchronizationReady: _synchronizationReady = true,
  syncMessage = "Auto-saved",
  onActiveRegionChange,
}: {
  artifactId: string;
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly?: boolean;
  synchronizationReady?: boolean;
  syncMessage?: string;
  onActiveRegionChange?: (regionId: string) => void;
}) {
  const incoming = useMemo(() => normalizeSheetsContent(content), [content]);
  const [workbook, setWorkbook] = useState(incoming);
  const [range, setRange] = useState<CellRange>({
    start: { row: 0, column: 0 },
    end: { row: 0, column: 0 },
  });
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [formulaDraft, setFormulaDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("A1");
  const [zoom, setZoom] = useState(1);
  const [menu, setMenu] = useState<MenuName>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [namedRangeOpen, setNamedRangeOpen] = useState(false);
  const [namedRangeDraft, setNamedRangeDraft] = useState("");
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationKind, setValidationKind] = useState<
    "list" | "number" | "checkbox"
  >("list");
  const [validationDraft, setValidationDraft] = useState("");
  const [conditionalOpen, setConditionalOpen] = useState(false);
  const [conditionalKind, setConditionalKind] = useState<
    "color_scale" | "greater_than" | "less_than" | "equal_to"
  >("color_scale");
  const [conditionalThreshold, setConditionalThreshold] = useState("0");
  const [filterEditor, setFilterEditor] = useState<{
    tableId: string;
    column: number;
  } | null>(null);
  const [filterValues, setFilterValues] = useState<SheetScalar[]>([]);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [renamingSheetId, setRenamingSheetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
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
    const key = JSON.stringify(next);
    lastEmittedKeyRef.current = key;
    const recent = recentEmittedKeysRef.current;
    recent.add(key);
    while (recent.size > 80) {
      const oldest = recent.values().next().value;
      if (typeof oldest !== "string") break;
      recent.delete(oldest);
    }
  }, []);

  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  useEffect(() => {
    if (!readOnly) return;
    setNamedRangeOpen(false);
    setValidationOpen(false);
    setConditionalOpen(false);
    setFilterEditor(null);
    setEditingAddress(null);
  }, [readOnly]);

  useEffect(() => {
    const incomingKey = JSON.stringify(incoming);
    if (incomingKey === JSON.stringify(workbook)) {
      recentEmittedKeysRef.current.delete(incomingKey);
      return;
    }
    // React can deliver several local `onChange` echoes after a newer edit has
    // already rendered. Treat every recently emitted workbook as an
    // acknowledgement, not just the latest one; otherwise an older echo rolls
    // the grid back and rapid data entry appears to retain only the final cell.
    if (
      incomingKey === lastEmittedKeyRef.current ||
      recentEmittedKeysRef.current.delete(incomingKey)
    )
      return;
    setWorkbook(incoming);
  }, [incoming]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSheet =
    workbook.sheets.find((sheet) => sheet.id === workbook.activeSheetId) ??
    workbook.sheets[0]!;
  const activeSheetIndex = workbook.sheets.findIndex(
    (sheet) => sheet.id === activeSheet.id,
  );
  const bounds = useMemo(() => usedBounds(activeSheet), [activeSheet]);
  const calculated = useMemo(() => calculateWorkbook(workbook), [workbook]);
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
    const populated = Object.keys(activeSheet.cells);
    for (const rule of activeSheet.conditionalFormats ?? []) {
      const parsed = parseRange(rule.range);
      if (!parsed) continue;
      const addresses = populated.filter((address) => {
        const coordinate = parseAddress(address);
        return coordinate
          ? selected(parsed, coordinate.row, coordinate.column)
          : false;
      });
      const numeric = addresses.flatMap((address) => {
        const value =
          calculated.get(`${activeSheet.id}:${address}`)?.value ??
          activeSheet.cells[address]?.value;
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
      } else {
        for (const entry of numeric) {
          const matches =
            rule.operator === "greater_than"
              ? entry.value > rule.value
              : rule.operator === "less_than"
                ? entry.value < rule.value
                : entry.value === rule.value;
          if (matches)
            styles.set(entry.address, {
              ...styles.get(entry.address),
              backgroundColor: rule.fillColor,
              color: rule.textColor,
            });
        }
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
  const selectedAddresses = useMemo(
    () => rangeAddresses(normalizedSelection),
    [normalizedSelection],
  );
  const rowHeight = ROW_HEIGHT * zoom;
  const columnWidth = COLUMN_WIDTH * zoom;

  useEffect(() => {
    setFormulaDraft(cellInput(activeCell));
    setNameDraft(selectionLabel);
  }, [activeAddress, activeCell, selectionLabel]);
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
    (next: SheetsContent, remember = true) => {
      if (readOnly) return;
      setWorkbook((current) => {
        if (sameContent(current, next)) return current;
        if (remember) {
          undoRef.current = [...undoRef.current.slice(-79), current];
          redoRef.current = [];
          setCanUndo(true);
          setCanRedo(false);
        }
        rememberEmitted(next);
        onChange(next);
        return next;
      });
    },
    [onChange, readOnly, rememberEmitted],
  );

  const updateActiveSheet = useCallback(
    (updater: (sheet: WorkbookSheet) => WorkbookSheet, remember = true) => {
      commit(replaceSheet(workbook, updater(activeSheet)), remember);
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
                    formula: translateFormula(
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
    updateActiveSheet((sheet) => {
      const cells = { ...sheet.cells };
      const existing = cells[address];
      const merged = {
        ...existing,
        ...cell,
        format: cell.format ?? existing?.format,
      };
      if (
        !merged.formula &&
        (merged.value === undefined ||
          merged.value === null ||
          merged.value === "") &&
        !merged.note &&
        !merged.format
      )
        delete cells[address];
      else cells[address] = merged;
      return { ...sheet, cells };
    }, remember);
  }

  function commitInput(address: string, value: string) {
    const parsed = parseCellInput(value);
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
    updateActiveSheet((sheet) => ({
      ...sheet,
      cells: Object.fromEntries(
        Object.entries({
          ...sheet.cells,
          ...Object.fromEntries(
            selectedAddresses.map((address) => [
              address,
              sheet.cells[address] ?? {},
            ]),
          ),
        }).map(([address, cell]) =>
          selectedAddresses.includes(address)
            ? [address, { ...cell, format: { ...cell.format, ...patch } }]
            : [address, cell],
        ),
      ),
    }));
  }

  function mergeSelection() {
    const area =
      (normalizedSelection.end.row - normalizedSelection.start.row + 1) *
      (normalizedSelection.end.column - normalizedSelection.start.column + 1);
    if (area < 2) {
      setImportNotice("Select at least two cells to merge.");
      return;
    }
    if (area > 10_000) {
      setImportNotice("Merge a smaller region of up to 10,000 cells.");
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
      setImportNotice("The selected region does not contain merged cells.");
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
        minimumColor: "#eff8f3",
        maximumColor: "#72d0a8",
      };
    else {
      const value = Number(conditionalThreshold);
      if (!Number.isFinite(value)) {
        setImportNotice("Conditional formatting needs a valid numeric value.");
        return;
      }
      rule = {
        id,
        range: selectionLabel,
        kind: "cell_is",
        operator: conditionalKind,
        value,
        fillColor: "#d9f4e8",
        textColor: "#126a4a",
      };
    }
    updateActiveSheet((sheet) => ({
      ...sheet,
      conditionalFormats: [...(sheet.conditionalFormats ?? []), rule],
    }));
    setConditionalOpen(false);
    setImportNotice(`Conditional formatting applied to ${selectionLabel}.`);
  }

  function undo() {
    if (readOnly) return;
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(workbook);
    setCanUndo(undoRef.current.length > 0);
    setCanRedo(true);
    setWorkbook(previous);
    rememberEmitted(previous);
    onChange(previous);
  }

  function redo() {
    if (readOnly) return;
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(workbook);
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
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
    if (readOnly) return;
    const rows = parseDelimited(await navigator.clipboard.readText(), "\t");
    updateActiveSheet((sheet) => {
      const cells = { ...sheet.cells };
      rows.forEach((values, rowOffset) =>
        values.forEach((value, columnOffset) => {
          const address = coordinateToAddress({
            row: range.end.row + rowOffset,
            column: range.end.column + columnOffset,
          });
          cells[address] = {
            ...cells[address],
            ...parseCellInput(value),
            provenance: { source: "clipboard", importedAt: Date.now() },
          };
        }),
      );
      return { ...sheet, cells };
    });
  }

  function clearSelection() {
    if (readOnly) return;
    updateActiveSheet((sheet) => {
      const cells = { ...sheet.cells };
      selectedAddresses.forEach((address) => delete cells[address]);
      return { ...sheet, cells };
    });
  }

  function onGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (editingAddress) return;
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (command && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (command && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copySelection();
      return;
    }
    if (command && event.key.toLowerCase() === "v") {
      event.preventDefault();
      void pasteSelection();
      return;
    }
    if (command && event.key.toLowerCase() === "b") {
      event.preventDefault();
      formatSelection({ bold: !activeCell?.format?.bold });
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
      clearSelection();
    } else if (!command && event.key.length === 1) {
      setEditingAddress(activeAddress);
      setEditingValue(event.key);
    }
  }

  function updateViewport() {
    const element = gridRef.current;
    if (!element) return;
    const rowStart = Math.max(0, Math.floor(element.scrollTop / rowHeight) - 3);
    const columnStart = Math.max(
      0,
      Math.floor(element.scrollLeft / columnWidth) - 2,
    );
    setViewport({
      rowStart,
      rowEnd: Math.min(
        visibleRowIndices.length - 1,
        rowStart + Math.ceil(element.clientHeight / rowHeight) + 7,
      ),
      columnStart,
      columnEnd: Math.min(
        bounds.columns - 1,
        columnStart + Math.ceil(element.clientWidth / columnWidth) + 5,
      ),
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
    });
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
    if (readOnly) return;
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
    if (readOnly) return;
    if (workbook.sheets.length <= 1) return;
    const sheets = workbook.sheets.filter(
      (sheet) => sheet.id !== activeSheet.id,
    );
    commit({ ...workbook, sheets, activeSheetId: sheets[0]!.id });
  }

  function createChart() {
    if (readOnly) return;
    const chart: SheetChart = {
      id: `chart-${crypto.randomUUID()}`,
      type: "line",
      sourceRange: rangeLabel(normalizedSelection),
      title: `${activeSheet.name} chart`,
      position: { x: 0, y: 0, width: 760, height: 320 },
    };
    updateActiveSheet((sheet) => ({
      ...sheet,
      charts: [...sheet.charts, chart],
    }));
  }

  function toggleTable() {
    const label = selectionLabel;
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
    if (readOnly) return;
    const selectedRange = normalizeRange(range);
    const matchingTable = activeSheet.tables.find(
      (table) => table.range === rangeLabel(selectedRange),
    );
    const dataStartRow = matchingTable
      ? selectedRange.start.row + 1
      : selectedRange.start.row;
    const rows = [] as Array<Record<number, SheetCell | undefined>>;
    for (let row = dataStartRow; row <= selectedRange.end.row; row += 1) {
      const values: Record<number, SheetCell | undefined> = {};
      for (
        let column = selectedRange.start.column;
        column <= selectedRange.end.column;
        column += 1
      )
        values[column] =
          activeSheet.cells[coordinateToAddress({ row, column })];
      rows.push(values);
    }
    const firstColumn = selectedRange.start.column;
    rows.sort((left, right) => {
      const a = left[firstColumn]?.value ?? "";
      const b = right[firstColumn]?.value ?? "";
      const comparison =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b));
      return direction === "asc" ? comparison : -comparison;
    });
    updateActiveSheet((sheet) => {
      const cells = { ...sheet.cells };
      rows.forEach((values, rowOffset) =>
        Object.entries(values).forEach(([column, value]) => {
          const address = coordinateToAddress({
            row: dataStartRow + rowOffset,
            column: Number(column),
          });
          if (value) cells[address] = value;
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
                      column: firstColumn,
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
    if (readOnly) throw new Error("This workbook is read-only.");
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
            ...parseCellInput(value),
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
    if (readOnly) throw new Error("This workbook is read-only.");
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
      );
      throw error;
    }
  }

  async function importWorkbookFile(file: File) {
    if (file.size < 1 || file.size > 100 * 1024 * 1024) {
      setImportNotice(
        "Import quarantined: the file is empty or exceeds the 100 MB parsing safety ceiling.",
      );
      return;
    }
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
                if (readOnly) throw new Error("This workbook is read-only.");
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
      );
    }
  }

  function exportCsv() {
    const used = usedBounds(activeSheet);
    const rows: string[] = [];
    for (let row = 0; row < Math.min(used.rows, 100_000); row += 1) {
      const values: string[] = [];
      for (let column = 0; column < used.columns; column += 1) {
        const address = coordinateToAddress({ row, column });
        values.push(delimitedValue(cellInput(activeSheet.cells[address])));
      }
      rows.push(values.join(",").replace(/,+$/, ""));
    }
    while (rows.at(-1) === "") rows.pop();
    const url = URL.createObjectURL(
      new Blob([rows.join("\r\n")], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activeSheet.name.replace(/[^a-z0-9_-]+/gi, "-") || "sheet"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function exportExcel() {
    const ExcelJS = await import("exceljs");
    const exported = new ExcelJS.Workbook();
    for (const sheet of workbook.sheets) {
      const worksheet = exported.addWorksheet(
        sheet.name.slice(0, 31) || "Sheet",
      );
      for (const [address, cell] of Object.entries(sheet.cells)) {
        const target = worksheet.getCell(address);
        target.value = cell.formula
          ? { formula: cell.formula.replace(/^=/, "") }
          : (cell.value ?? null);
        target.font = {
          bold: cell.format?.bold,
          italic: cell.format?.italic,
          underline: cell.format?.underline,
        };
        target.alignment = { horizontal: cell.format?.align };
        if (cell.format?.numberFormat === "percent")
          target.numFmt = `0.${"0".repeat(cell.format.decimals ?? 2)}%`;
        else if (cell.format?.numberFormat === "currency")
          target.numFmt = `$#,##0.${"0".repeat(cell.format.decimals ?? 2)}`;
        else if (cell.format?.numberFormat === "date")
          target.numFmt = "yyyy-mm-dd";
        if (cell.note) target.note = cell.note;
      }
      for (const mergedRange of sheet.mergedRanges ?? [])
        if (parseRange(mergedRange)) worksheet.mergeCells(mergedRange);
      (sheet.conditionalFormats ?? []).forEach((rule, index) => {
        const argb = (color: string) =>
          `FF${color.replace(/^#/, "").slice(-6).toUpperCase()}`;
        if (rule.kind === "color_scale")
          worksheet.addConditionalFormatting({
            ref: rule.range,
            rules: [
              {
                type: "colorScale",
                priority: index + 1,
                cfvo: [{ type: "min" }, { type: "max" }],
                color: [
                  { argb: argb(rule.minimumColor) },
                  { argb: argb(rule.maximumColor) },
                ],
              },
            ],
          });
        else
          worksheet.addConditionalFormatting({
            ref: rule.range,
            rules: [
              {
                type: "cellIs",
                priority: index + 1,
                operator:
                  rule.operator === "greater_than"
                    ? "greaterThan"
                    : rule.operator === "less_than"
                      ? "lessThan"
                      : "equal",
                formulae: [rule.value],
                style: {
                  fill: {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: argb(rule.fillColor) },
                  },
                  ...(rule.textColor
                    ? { font: { color: { argb: argb(rule.textColor) } } }
                    : {}),
                },
              },
            ],
          });
      });
      if ((sheet.frozenRows ?? 0) > 0 || (sheet.frozenColumns ?? 0) > 0)
        worksheet.views = [
          {
            state: "frozen",
            xSplit: sheet.frozenColumns ?? 0,
            ySplit: sheet.frozenRows ?? 0,
          },
        ];
    }
    const buffer = await exported.xlsx.writeBuffer();
    const url = URL.createObjectURL(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Spectra-workbook.xlsx";
    anchor.click();
    URL.revokeObjectURL(url);
    setImportNotice(
      "Exported values, formulas, common formatting, notes, merged cells, conditional formatting, and frozen panes to Excel. Spectra-native charts and permission links remain in Spectra and are reported as non-round-trippable.",
    );
  }

  function exportOpenDocument() {
    const bytes = exportOds(workbook);
    const url = URL.createObjectURL(
      new Blob([bytes], {
        type: "application/vnd.oasis.opendocument.spreadsheet",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Spectra-workbook.ods";
    anchor.click();
    URL.revokeObjectURL(url);
    setImportNotice(
      "Exported cell values and formulas as OpenDocument. Spectra-native charts, validations, conditional formats, comments, links, permissions, and advanced styling remain in Spectra and are reported as non-round-trippable.",
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

  return (
    <div className="spectra-sheets-studio min-w-0 overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
      <div className="sheets-menu-bar">
        {(["file", "edit", "view", "insert", "format", "data"] as const).map(
          (name) => (
            <div key={name} className="relative">
              <button
                type="button"
                className="sheets-menu-trigger"
                onClick={() =>
                  setMenu((current) => (current === name ? null : name))
                }
              >
                {name[0]!.toUpperCase() + name.slice(1)}
              </button>
              {menu === name ? (
                <div className="sheets-menu-popover">
                  {name === "file" ? (
                    <>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => importRef.current?.click()}
                      >
                        <Upload />
                        Import spreadsheet
                      </button>
                      <button type="button" onClick={exportCsv}>
                        <Download />
                        Export active sheet as CSV
                      </button>
                      <button type="button" onClick={() => void exportExcel()}>
                        <Download />
                        Export workbook as Excel
                      </button>
                      <button type="button" onClick={exportOpenDocument}>
                        <Download />
                        Export workbook as OpenDocument
                      </button>
                    </>
                  ) : null}
                  {name === "edit" ? (
                    <>
                      <button
                        type="button"
                        disabled={!canUndo}
                        onClick={undo}
                      >
                        <Undo2 />
                        Undo
                      </button>
                      <button
                        type="button"
                        disabled={!canRedo}
                        onClick={redo}
                      >
                        <Redo2 />
                        Redo
                      </button>
                      <button
                        type="button"
                        onClick={() => void copySelection()}
                      >
                        <Copy />
                        Copy selection
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={clearSelection}
                      >
                        <Trash2 />
                        Clear selection
                      </button>
                    </>
                  ) : null}
                  {name === "view" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setSearchOpen((value) => !value)}
                      >
                        <Search />
                        Find cells
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() =>
                          updateActiveSheet((sheet) => ({
                            ...sheet,
                            frozenRows: Math.min(
                              100,
                              normalizedSelection.start.row + 1,
                            ),
                          }))
                        }
                      >
                        Freeze rows through {normalizedSelection.start.row + 1}
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() =>
                          updateActiveSheet((sheet) => ({
                            ...sheet,
                            frozenColumns: Math.min(
                              50,
                              normalizedSelection.start.column + 1,
                            ),
                          }))
                        }
                      >
                        Freeze columns through{" "}
                        {columnName(normalizedSelection.start.column)}
                      </button>
                      {(activeSheet.frozenRows ?? 0) > 0 ||
                      (activeSheet.frozenColumns ?? 0) > 0 ? (
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() =>
                            updateActiveSheet((sheet) => ({
                              ...sheet,
                              frozenRows: 0,
                              frozenColumns: 0,
                            }))
                          }
                        >
                          Unfreeze panes
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  {name === "insert" ? (
                    <>
                      <button type="button" onClick={addSheet}>
                        <Plus />
                        New sheet
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() =>
                          updateActiveSheet((sheet) =>
                            mutateSheetAxis(
                              sheet,
                              "row",
                              normalizedSelection.start.row,
                              1,
                            ),
                          )
                        }
                      >
                        Insert row above
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() =>
                          updateActiveSheet((sheet) =>
                            mutateSheetAxis(
                              sheet,
                              "column",
                              normalizedSelection.start.column,
                              1,
                            ),
                          )
                        }
                      >
                        Insert column left
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() =>
                          updateActiveSheet((sheet) =>
                            mutateSheetAxis(
                              sheet,
                              "row",
                              normalizedSelection.start.row,
                              -1,
                            ),
                          )
                        }
                      >
                        Delete selected row
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() =>
                          updateActiveSheet((sheet) =>
                            mutateSheetAxis(
                              sheet,
                              "column",
                              normalizedSelection.start.column,
                              -1,
                            ),
                          )
                        }
                      >
                        Delete selected column
                      </button>
                      <button type="button" onClick={createChart}>
                        <BarChart3 />
                        Chart from selection
                      </button>
                    </>
                  ) : null}
                  {name === "format" ? (
                    <>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() =>
                          formatSelection({ numberFormat: "currency" })
                        }
                      >
                        Currency
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() =>
                          formatSelection({ numberFormat: "percent" })
                        }
                      >
                        Percent
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() =>
                          formatSelection({ numberFormat: "date" })
                        }
                      >
                        Date
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={mergeSelection}
                      >
                        Merge selected cells
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={unmergeSelection}
                      >
                        Unmerge selected cells
                      </button>
                    </>
                  ) : null}
                  {name === "data" ? (
                    <>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => sortSelection("asc")}
                      >
                        <SortAsc />
                        Sort ascending
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => sortSelection("desc")}
                      >
                        <SortDesc />
                        Sort descending
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={toggleTable}
                      >
                        <Filter />
                        Toggle filterable table
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => {
                          setNamedRangeOpen(true);
                          setNamedRangeDraft("");
                          setMenu(null);
                        }}
                      >
                        <Sigma />
                        Name selected range
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => {
                          const existing = activeCell?.validation;
                          setValidationKind(existing?.kind ?? "list");
                          setValidationDraft(
                            existing?.kind === "list"
                              ? existing.options.join(", ")
                              : existing?.kind === "number"
                                ? `${existing.minimum ?? ""}, ${existing.maximum ?? ""}`
                                : "",
                          );
                          setValidationOpen(true);
                          setMenu(null);
                        }}
                      >
                        <Filter />
                        Data validation
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => {
                          setConditionalOpen(true);
                          setMenu(null);
                        }}
                      >
                        <BarChart3 />
                        Conditional formatting
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ),
        )}
        <span
          className="ml-auto hidden items-center gap-1.5 text-[10px] text-[var(--text-secondary)] md:inline-flex"
          role="status"
          aria-live="polite"
        >
          {syncMessage === "Auto-saved" ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
          ) : syncMessage === "Synchronizing" || syncMessage === "Reconnecting" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" />
          ) : (
            <Circle className="h-3 w-3 fill-[#d88922] text-[#d88922]" />
          )}
          {syncMessage}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)] md:ml-2">
          {filteredOutRows.size
            ? `${visibleRowIndices.length.toLocaleString()} of ${bounds.rows.toLocaleString()}`
            : bounds.rows.toLocaleString()}{" "}
          rows · {bounds.columns.toLocaleString()} columns
        </span>
      </div>
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
      <div className="sheets-format-bar">
        <ToolbarButton
          label="Undo"
          onClick={undo}
          disabled={readOnly || !canUndo}
        >
          <Undo2 />
        </ToolbarButton>
        <ToolbarButton
          label="Redo"
          onClick={redo}
          disabled={readOnly || !canRedo}
        >
          <Redo2 />
        </ToolbarButton>
        <span className="sheets-toolbar-divider" />
        <select
          aria-label="Zoom"
          value={String(Math.round(zoom * 100))}
          onChange={(event) => {
            setZoom(Number(event.target.value) / 100);
            requestAnimationFrame(updateViewport);
          }}
          className="sheets-toolbar-select"
        >
          <option value="75">75%</option>
          <option value="100">100%</option>
          <option value="125">125%</option>
          <option value="150">150%</option>
        </select>
        <span className="sheets-toolbar-divider" />
        <ToolbarButton
          label="Currency"
          active={activeCell?.format?.numberFormat === "currency"}
          onClick={() => formatSelection({ numberFormat: "currency" })}
          disabled={readOnly}
        >
          $
        </ToolbarButton>
        <ToolbarButton
          label="Percent"
          active={activeCell?.format?.numberFormat === "percent"}
          onClick={() => formatSelection({ numberFormat: "percent" })}
          disabled={readOnly}
        >
          %
        </ToolbarButton>
        <ToolbarButton
          label="Decrease decimal places"
          onClick={() =>
            formatSelection({
              decimals: Math.max(0, (activeCell?.format?.decimals ?? 2) - 1),
            })
          }
          disabled={readOnly}
        >
          .0←
        </ToolbarButton>
        <ToolbarButton
          label="Increase decimal places"
          onClick={() =>
            formatSelection({
              decimals: Math.min(12, (activeCell?.format?.decimals ?? 2) + 1),
            })
          }
          disabled={readOnly}
        >
          .0→
        </ToolbarButton>
        <select
          aria-label="Number format"
          value={activeCell?.format?.numberFormat ?? "general"}
          onChange={(event) =>
            formatSelection({
              numberFormat: event.target.value as NonNullable<
                SheetCell["format"]
              >["numberFormat"],
            })
          }
          className="sheets-toolbar-select"
          disabled={readOnly}
        >
          <option value="general">123</option>
          <option value="number">Number</option>
          <option value="currency">Currency</option>
          <option value="percent">Percent</option>
          <option value="date">Date</option>
        </select>
        <span className="sheets-toolbar-divider" />
        <select
          aria-label="Font"
          value={activeCell?.format?.fontFamily ?? "sans"}
          onChange={(event) =>
            formatSelection({
              fontFamily: event.target.value as NonNullable<
                SheetCell["format"]
              >["fontFamily"],
            })
          }
          className="sheets-toolbar-select"
          disabled={readOnly}
        >
          <option value="sans">Spectra Sans</option>
          <option value="serif">Spectra Serif</option>
          <option value="mono">Monospace</option>
        </select>
        <select
          aria-label="Font size"
          value={String(activeCell?.format?.fontSize ?? 11)}
          onChange={(event) =>
            formatSelection({ fontSize: Number(event.target.value) })
          }
          className="sheets-toolbar-select sheets-toolbar-size"
          disabled={readOnly}
        >
          <option>9</option>
          <option>10</option>
          <option>11</option>
          <option>12</option>
          <option>14</option>
          <option>16</option>
        </select>
        <ToolbarButton
          label="Bold"
          active={activeCell?.format?.bold}
          onClick={() => formatSelection({ bold: !activeCell?.format?.bold })}
          disabled={readOnly}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={activeCell?.format?.italic}
          onClick={() =>
            formatSelection({ italic: !activeCell?.format?.italic })
          }
          disabled={readOnly}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={activeCell?.format?.underline}
          onClick={() =>
            formatSelection({ underline: !activeCell?.format?.underline })
          }
          disabled={readOnly}
        >
          <Underline />
        </ToolbarButton>
        <label className="sheets-color-control" title="Text color">
          <span>A</span>
          <input
            type="color"
            value={activeCell?.format?.textColor ?? "#222522"}
            disabled={readOnly}
            onChange={(event) =>
              formatSelection({ textColor: event.target.value })
            }
            aria-label="Text color"
          />
        </label>
        <label className="sheets-color-control" title="Cell fill color">
          <span>◆</span>
          <input
            type="color"
            value={activeCell?.format?.fillColor ?? "#ffffff"}
            disabled={readOnly}
            onChange={(event) =>
              formatSelection({ fillColor: event.target.value })
            }
            aria-label="Cell fill color"
          />
        </label>
        <span className="sheets-toolbar-divider" />
        <ToolbarButton
          label="Align left"
          active={activeCell?.format?.align === "left"}
          onClick={() => formatSelection({ align: "left" })}
          disabled={readOnly}
        >
          <AlignLeft />
        </ToolbarButton>
        <ToolbarButton
          label="Align center"
          active={activeCell?.format?.align === "center"}
          onClick={() => formatSelection({ align: "center" })}
          disabled={readOnly}
        >
          <AlignCenter />
        </ToolbarButton>
        <ToolbarButton
          label="Align right"
          active={activeCell?.format?.align === "right"}
          onClick={() => formatSelection({ align: "right" })}
          disabled={readOnly}
        >
          <AlignRight />
        </ToolbarButton>
        <ToolbarButton
          label="Functions"
          onClick={() => {
            setEditingAddress(activeAddress);
            setEditingValue("=SUM(");
          }}
          disabled={readOnly}
        >
          <Sigma />
        </ToolbarButton>
        <ToolbarButton
          label="Filter"
          active={activeSheet.tables.some(
            (table) => table.range === selectionLabel,
          )}
          onClick={toggleTable}
          disabled={readOnly}
        >
          <Filter />
        </ToolbarButton>
        <ToolbarButton
          label="More formatting"
          onClick={() => setMenu("format")}
        >
          <MoreHorizontal />
        </ToolbarButton>
      </div>
      <div className="sheets-formula-bar">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = parseRange(formulaDraft);
            if (parsed && !formulaDraft.startsWith("=")) {
              setRange(parsed);
              return;
            }
            commitInput(activeAddress, formulaDraft);
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
                  commit({ ...workbook, activeSheetId: targetSheet.id }, false);
                setRange(namedParsed);
              } else setNameDraft(selectionLabel);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="sheets-name-box"
          />
          <span aria-hidden="true" className="sheets-formula-icon">
            ƒx
          </span>
          <input
            aria-label={`Formula for ${activeAddress}`}
            value={formulaDraft}
            readOnly={readOnly}
            onChange={(event) => setFormulaDraft(event.target.value)}
            className="sheets-formula-input"
          />
        </form>
      </div>
      {namedRangeOpen ? (
        <div className="sheets-named-range-bar">
          <Sigma />
          <div className="min-w-0 flex-1">
            <strong>Name {selectionLabel}</strong>
            <span>
              Use the name in formulas and links instead of a fragile address.
            </span>
          </div>
          <input
            autoFocus
            value={namedRangeDraft}
            onChange={(event) => setNamedRangeDraft(event.target.value)}
            placeholder="experiment_rates"
            aria-label="Named range name"
          />
          <button
            type="button"
            onClick={() => {
              const name = namedRangeDraft.trim();
              if (
                !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ||
                parseAddress(name)
              ) {
                setImportNotice(
                  "Named ranges must begin with a letter or underscore and cannot look like a cell address.",
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
              setNamedRangeOpen(false);
              setNamedRangeDraft("");
              setImportNotice(`Named ${selectionLabel} as ${name}.`);
            }}
          >
            Save name
          </button>
          <button type="button" onClick={() => setNamedRangeOpen(false)}>
            Cancel
          </button>
        </div>
      ) : null}
      {validationOpen ? (
        <div className="sheets-validation-bar">
          <Filter />
          <div className="min-w-0 flex-1">
            <strong>Validate {selectionLabel}</strong>
            <span>
              Invalid entries are rejected before they reach live state.
            </span>
          </div>
          <select
            value={validationKind}
            onChange={(event) =>
              setValidationKind(
                event.target.value as "list" | "number" | "checkbox",
              )
            }
          >
            <option value="list">List</option>
            <option value="number">Number range</option>
            <option value="checkbox">Checkbox</option>
          </select>
          {validationKind !== "checkbox" ? (
            <input
              value={validationDraft}
              onChange={(event) => setValidationDraft(event.target.value)}
              placeholder={
                validationKind === "list"
                  ? "Draft, Ready, Complete"
                  : "minimum, maximum"
              }
              aria-label="Validation values"
            />
          ) : null}
          <button
            type="button"
            onClick={() => {
              let validation: SheetValidation;
              if (validationKind === "list") {
                const options = validationDraft
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean);
                if (!options.length) {
                  setImportNotice("List validation needs at least one value.");
                  return;
                }
                validation = { kind: "list", options, rejectInvalid: true };
              } else if (validationKind === "number") {
                const [minimumText, maximumText] = validationDraft.split(
                  ",",
                  2,
                );
                const minimum = minimumText?.trim()
                  ? Number(minimumText)
                  : undefined;
                const maximum = maximumText?.trim()
                  ? Number(maximumText)
                  : undefined;
                if (
                  (minimum !== undefined && !Number.isFinite(minimum)) ||
                  (maximum !== undefined && !Number.isFinite(maximum)) ||
                  (minimum !== undefined &&
                    maximum !== undefined &&
                    minimum > maximum)
                ) {
                  setImportNotice(
                    "Enter a valid minimum and maximum separated by a comma.",
                  );
                  return;
                }
                validation = {
                  kind: "number",
                  ...(minimum !== undefined ? { minimum } : {}),
                  ...(maximum !== undefined ? { maximum } : {}),
                  rejectInvalid: true,
                };
              } else validation = { kind: "checkbox", rejectInvalid: true };
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
              setValidationOpen(false);
              setImportNotice(`Validation applied to ${selectionLabel}.`);
            }}
          >
            Apply
          </button>
          <button
            type="button"
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
              setValidationOpen(false);
            }}
          >
            Remove
          </button>
          <button type="button" onClick={() => setValidationOpen(false)}>
            Cancel
          </button>
        </div>
      ) : null}
      {conditionalOpen ? (
        <div className="sheets-validation-bar">
          <BarChart3 />
          <div className="min-w-0 flex-1">
            <strong>Format {selectionLabel}</strong>
            <span>
              Rules follow the range as values and formulas recalculate.
            </span>
          </div>
          <select
            value={conditionalKind}
            onChange={(event) =>
              setConditionalKind(
                event.target.value as
                  "color_scale" | "greater_than" | "less_than" | "equal_to",
              )
            }
            aria-label="Conditional formatting rule"
          >
            <option value="color_scale">Green colour scale</option>
            <option value="greater_than">Greater than</option>
            <option value="less_than">Less than</option>
            <option value="equal_to">Equal to</option>
          </select>
          {conditionalKind !== "color_scale" ? (
            <input
              type="number"
              value={conditionalThreshold}
              onChange={(event) => setConditionalThreshold(event.target.value)}
              placeholder="Value"
              aria-label="Conditional formatting comparison value"
            />
          ) : null}
          <button type="button" onClick={applyConditionalFormat}>
            Apply
          </button>
          <button
            type="button"
            onClick={() => {
              updateActiveSheet((sheet) => ({
                ...sheet,
                conditionalFormats: (sheet.conditionalFormats ?? []).filter(
                  (rule) => {
                    const parsed = parseRange(rule.range);
                    return parsed
                      ? !rangesOverlap(parsed, normalizedSelection)
                      : false;
                  },
                ),
              }));
              setConditionalOpen(false);
              setImportNotice(
                `Conditional formatting removed from ${selectionLabel}.`,
              );
            }}
          >
            Remove in selection
          </button>
          <button type="button" onClick={() => setConditionalOpen(false)}>
            Cancel
          </button>
        </div>
      ) : null}
      {searchOpen ? (
        <div className="sheets-find-bar">
          <Search />
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find values or formulas"
          />
          <button
            type="button"
            onClick={() => {
              const match = Object.entries(activeSheet.cells).find(([, cell]) =>
                cellInput(cell).toLowerCase().includes(search.toLowerCase()),
              );
              const coordinate = match ? parseAddress(match[0]) : null;
              if (coordinate) setRange({ start: coordinate, end: coordinate });
            }}
          >
            Find next
          </button>
          <button type="button" onClick={() => setSearchOpen(false)}>
            Close
          </button>
        </div>
      ) : null}
      {importNotice ? (
        <div className="sheets-import-notice" role="status">
          <span>{importNotice}</span>
          <button type="button" onClick={() => setImportNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      <div
        className="sheets-grid-frame"
        style={
          {
            "--sheet-row-header": `${ROW_HEADER_WIDTH}px`,
            "--sheet-column-header": `${COLUMN_HEADER_HEIGHT}px`,
          } as CSSProperties
        }
      >
        <div className="sheets-grid-corner" />
        <div className="sheets-column-headers">
          <div
            style={{
              width: bounds.columns * columnWidth,
              transform: `translateX(${-viewport.scrollLeft}px)`,
            }}
          >
            {columns.map((column) => (
              <button
                type="button"
                key={column}
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
                  left: column * columnWidth,
                  width: columnWidth,
                  transform:
                    column < (activeSheet.frozenColumns ?? 0)
                      ? `translateX(${viewport.scrollLeft}px)`
                      : undefined,
                }}
              >
                {columnName(column)}
              </button>
            ))}
          </div>
        </div>
        <div className="sheets-row-headers">
          <div
            style={{
              height: visibleRowIndices.length * rowHeight,
              transform: `translateY(${-viewport.scrollTop}px)`,
            }}
          >
            {rows.map(({ row, position }) => (
              <button
                type="button"
                key={row}
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
                  top: position * rowHeight,
                  height: rowHeight,
                  transform:
                    row < (activeSheet.frozenRows ?? 0)
                      ? `translateY(${viewport.scrollTop}px)`
                      : undefined,
                }}
              >
                {row + 1}
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
              width: bounds.columns * columnWidth,
              height: visibleRowIndices.length * rowHeight,
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
                    merged={merged}
                    role="gridcell"
                    aria-rowindex={row + 1}
                    aria-colindex={column + 1}
                    aria-selected={isSelected}
                    data-address={address}
                    data-selected={isSelected || undefined}
                    data-active={isActive || undefined}
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
                        column * columnWidth +
                        (isFrozenColumn ? viewport.scrollLeft : 0),
                      top:
                        position * rowHeight +
                        (isFrozenRow ? viewport.scrollTop : 0),
                      width: merged
                        ? (merged.range.end.column -
                            merged.range.start.column +
                            1) *
                          columnWidth
                        : columnWidth,
                      height: merged
                        ? (merged.range.end.row - merged.range.start.row + 1) *
                          rowHeight
                        : rowHeight,
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
                      fontWeight: style?.bold ? 700 : undefined,
                      fontStyle: style?.italic ? "italic" : undefined,
                      textDecoration: style?.underline
                        ? "underline"
                        : undefined,
                      textAlign: style?.align,
                      fontFamily:
                        style?.fontFamily === "serif"
                          ? "var(--font-serif), ui-sans-serif, system-ui, sans-serif"
                          : style?.fontFamily === "mono"
                            ? "ui-monospace, SFMono-Regular, Consolas, monospace"
                            : undefined,
                      fontSize: style?.fontSize
                        ? style.fontSize * zoom
                        : undefined,
                      color: conditionalStyle?.color ?? style?.textColor,
                      backgroundColor:
                        conditionalStyle?.backgroundColor ?? style?.fillColor,
                    }}
                    onDoubleClick={() => {
                      if (!readOnly) {
                        setEditingAddress(address);
                        setEditingValue(cellInput(cell));
                      }
                    }}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editingValue}
                        onChange={(event) =>
                          setEditingValue(event.target.value)
                        }
                        onBlur={() => commitInput(address, editingValue)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitInput(address, editingValue);
                            moveSelection(1, 0);
                          }
                          if (event.key === "Escape") setEditingAddress(null);
                        }}
                        className="sheets-cell-editor"
                      />
                    ) : (
                      <span
                        className={
                          calculatedCell?.error ? "text-[var(--danger)]" : ""
                        }
                      >
                        {formatCalculatedCell(
                          cell,
                          calculatedCell,
                          workbook.workbook.locale,
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
                        disabled={readOnly}
                        aria-label={`Filter ${formatCalculatedCell(cell, calculatedCell, workbook.workbook.locale) || columnName(column)}`}
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
                        }}
                      >
                        <ChevronDown />
                      </button>
                    ) : null}
                    {isFillAnchor && !isEditing && !readOnly ? (
                      <SheetsFillHandle
                        handlersRef={cellHandlersRef}
                        selection={normalizedSelection}
                        cells={activeSheet.cells}
                        selectionLabel={selectionLabel}
                      />
                    ) : null}
                  </SheetsCellPointerTarget>
                );
              }),
            )}
          </div>
        </div>
      </div>
      {filterEditor && activeFilterTable ? (
        <div className="sheets-filter-panel">
          <div>
            <strong>
              Filter {columnName(filterEditor.column)} in{" "}
              {activeFilterTable.name}
            </strong>
            <span>{activeFilterOptions.length} distinct values</span>
          </div>
          <div className="sheets-filter-values">
            {activeFilterOptions.map((value) => {
              const key = JSON.stringify(value);
              const checked = filterValues.some(
                (candidate) => JSON.stringify(candidate) === key,
              );
              return (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setFilterValues((current) =>
                        checked
                          ? current.filter(
                              (candidate) => JSON.stringify(candidate) !== key,
                            )
                          : [...current, value],
                      )
                    }
                  />
                  {value === null ? "(blank)" : String(value)}
                </label>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setFilterValues(activeFilterOptions)}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => {
              updateActiveSheet((sheet) => ({
                ...sheet,
                tables: sheet.tables.map((table) =>
                  table.id === filterEditor.tableId
                    ? {
                        ...table,
                        filters: (table.filters ?? []).filter(
                          (filter) => filter.column !== filterEditor.column,
                        ),
                      }
                    : table,
                ),
              }));
              setFilterEditor(null);
            }}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => {
              updateActiveSheet((sheet) => ({
                ...sheet,
                tables: sheet.tables.map((table) =>
                  table.id === filterEditor.tableId
                    ? {
                        ...table,
                        filters: [
                          ...(table.filters ?? []).filter(
                            (filter) => filter.column !== filterEditor.column,
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
            }}
          >
            Apply
          </button>
          <button type="button" onClick={() => setFilterEditor(null)}>
            Cancel
          </button>
        </div>
      ) : null}
      <div className="sheets-status-bar">
        <span>{rangeLabel(normalizedSelection)}</span>
        {summary ? (
          <>
            <span>Count {summary.count}</span>
            <span>
              Sum{" "}
              {summary.sum.toLocaleString(workbook.workbook.locale, {
                maximumFractionDigits: 4,
              })}
            </span>
            <span>
              Average{" "}
              {summary.average.toLocaleString(workbook.workbook.locale, {
                maximumFractionDigits: 4,
              })}
            </span>
          </>
        ) : (
          <span>{selectedAddresses.length} selected</span>
        )}
      </div>
      <section className="sheets-chart-region">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
              Charts and analysis
            </h3>
            <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
              Charts remain linked to their source range.
            </p>
          </div>
          <button
            type="button"
            onClick={createChart}
            disabled={readOnly}
            className="sheets-secondary-button"
          >
            <BarChart3 />
            Create chart from {rangeLabel(normalizedSelection)}
          </button>
        </div>
        {activeSheet.charts.length ? (
          <div className="mt-4 grid gap-4">
            {activeSheet.charts.map((chart) => {
              const statistics = chartSummary(activeSheet, chart, calculated);
              const number = (value: number | null) =>
                value === null
                  ? "—"
                  : value.toLocaleString(workbook.workbook.locale, {
                      maximumFractionDigits: 5,
                    });
              return (
                <article
                  key={chart.id}
                  data-ai-region={aiRegionAttr(
                    pathTouches(
                      aiChangedPaths,
                      `/sheets/${activeSheetIndex}/charts/${activeSheet.charts.indexOf(chart)}`,
                    ),
                  )}
                  className="sheets-chart-card"
                >
                  <header>
                    <div>
                      <input
                        value={chart.title}
                        readOnly={readOnly}
                        onChange={(event) =>
                          updateActiveSheet((sheet) => ({
                            ...sheet,
                            charts: sheet.charts.map((candidate) =>
                              candidate.id === chart.id
                                ? { ...candidate, title: event.target.value }
                                : candidate,
                            ),
                          }))
                        }
                      />
                      <span>{chart.sourceRange} · linked source</span>
                    </div>
                    <select
                      value={chart.type}
                      disabled={readOnly}
                      onChange={(event) =>
                        updateActiveSheet((sheet) => ({
                          ...sheet,
                          charts: sheet.charts.map((candidate) =>
                            candidate.id === chart.id
                              ? {
                                  ...candidate,
                                  type: event.target
                                    .value as SheetChart["type"],
                                }
                              : candidate,
                          ),
                        }))
                      }
                      aria-label={`Chart type for ${chart.title}`}
                    >
                      <option value="line">Line</option>
                      <option value="column">Column</option>
                      <option value="bar">Bar</option>
                      <option value="area">Area</option>
                      <option value="pie">Pie / donut</option>
                      <option value="scatter">Scatter</option>
                      <option value="combo">Combination</option>
                      <option value="histogram">Histogram</option>
                    </select>
                    <button
                      type="button"
                      aria-label={`Delete ${chart.title}`}
                      disabled={readOnly}
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
                  <div className="sheets-chart-body">
                    <div className="h-[280px] min-w-0">
                      <SheetsChartView
                        sheet={activeSheet}
                        chart={chart}
                        calculated={calculated}
                      />
                    </div>
                    <aside
                      className="sheets-chart-summary"
                      aria-label={`${chart.title} summary statistics`}
                    >
                      <h4>Summary statistics</h4>
                      <dl>
                        <div>
                          <dt>Mean</dt>
                          <dd>{number(statistics.mean)}</dd>
                        </div>
                        <div>
                          <dt>Maximum</dt>
                          <dd>{number(statistics.max)}</dd>
                        </div>
                        <div>
                          <dt>Minimum</dt>
                          <dd>{number(statistics.min)}</dd>
                        </div>
                        <div>
                          <dt>Std deviation</dt>
                          <dd>{number(statistics.standardDeviation)}</dd>
                        </div>
                        <div>
                          <dt>Observations</dt>
                          <dd>{statistics.count.toLocaleString()}</dd>
                        </div>
                      </dl>
                    </aside>
                    <p className="sr-only">
                      {chart.title} uses {chart.sourceRange}. It contains{" "}
                      {statistics.count} observations, with mean{" "}
                      {number(statistics.mean)}, minimum{" "}
                      {number(statistics.min)}, maximum {number(statistics.max)}
                      , and standard deviation{" "}
                      {number(statistics.standardDeviation)}.
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="sheets-empty-chart">
            <BarChart3 />
            <span>Select a labelled range, then create a chart.</span>
          </div>
        )}
      </section>
      <footer className="sheets-tabs-bar">
        <button
          type="button"
          onClick={addSheet}
          disabled={readOnly}
          className="sheets-add-tab"
          aria-label="Add sheet"
        >
          <Plus />
        </button>
        {workbook.sheets.map((sheet, sheetIndex) => (
          <div
            key={sheet.id}
            className={`sheets-tab ${sheet.id === activeSheet.id ? "is-active" : ""}`}
            data-ai-region={aiRegionAttr(
              pathTouches(aiChangedPaths, `/sheets/${sheetIndex}`),
            )}
          >
            <button
              type="button"
              onDoubleClick={() => {
                if (readOnly) return;
                setRenamingSheetId(sheet.id);
                setRenameDraft(sheet.name);
              }}
              onClick={() => {
                commit({ ...workbook, activeSheetId: sheet.id }, false);
                setRange({
                  start: { row: 0, column: 0 },
                  end: { row: 0, column: 0 },
                });
              }}
            >
              {renamingSheetId === sheet.id ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => {
                    const name = renameDraft.trim();
                    if (name)
                      commit({
                        ...workbook,
                        sheets: workbook.sheets.map((candidate) =>
                          candidate.id === sheet.id
                            ? { ...candidate, name }
                            : candidate,
                        ),
                      });
                    setRenamingSheetId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              ) : (
                <>
                  <span className="sheets-tab-icon">▦</span>
                  {sheet.name}
                  <ChevronDown />
                </>
              )}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={removeActiveSheet}
          disabled={workbook.sheets.length <= 1 || readOnly}
          className="sheets-remove-tab"
          aria-label="Delete active sheet"
        >
          <Trash2 />
        </button>
      </footer>
    </div>
  );
}
