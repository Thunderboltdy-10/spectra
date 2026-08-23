import {
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowLeft,
  ArrowDownAZ,
  ArrowRight,
  ArrowUpAZ,
  ArrowUpDown,
  Ban,
  Braces,
  ChevronsLeftRight,
  Brush,
  Calculator,
  ChartColumn,
  ChartPie,
  Clipboard,
  ClipboardPaste,
  Columns3,
  Copy,
  DollarSign,
  Eraser,
  Eye,
  EyeOff,
  Grid2x2,
  Grid3x3,
  Hash,
  Highlighter,
  History,
  Indent,
  Info,
  Layers,
  Library,
  Link2,
  ListFilter,
  Lock,
  Merge,
  Minus,
  Outdent,
  PaintBucket,
  Paintbrush,
  Palette,
  Percent,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Rows3,
  Ruler,
  ScanSearch,
  Scissors,
  ShieldCheck,
  Sigma,
  Snowflake,
  Sparkles,
  Split,
  StickyNote,
  Table2,
  Tags,
  Text,
  Trash2,
} from "lucide-react";
import type { CommandBinding, CommandControlOption, CommandParam } from "../types";
import {
  commentsBinding,
  exportBindings,
  findBindings,
  historyBindings,
  importBinding,
  printBinding,
  textFormatBindings,
  zoomBindings,
  type CommentsAdapter,
  type ExportAdapter,
  type FindAdapter,
  type HistoryAdapter,
  type ImportAdapter,
  type TextFormatAdapter,
  type ToggleFacet,
  type ValueFacet,
  type ZoomAdapter,
} from "../shared";

/**
 * The Sheets command set.
 *
 * Everything a person can do to a workbook is declared here, once, as a pure
 * function of the studio's handlers. Before this module the format inspector
 * mutated cells directly, Ctrl+V had its own paste, the fill handle had its own
 * copy loop, and the workbar carried a third, smaller vocabulary — so a verb
 * could exist three times with three behaviours, none of them reachable by the
 * AI, a shortcut or the customizer (C1).
 *
 * Rules this file follows:
 *
 *   One id, one implementation. `onSelect` is the only place a verb happens;
 *   the studio's inspectors call `runCommand(id, value)` rather than reaching
 *   past the registry into their own mutation helpers.
 *   No ghosts. A binding exists only when the studio supplied a handler that
 *   can honestly perform it. Where Spectra can *see* a native feature but not
 *   author it — pivot tables, native chart parts, dynamic arrays — the command
 *   ships disabled with the region named, because a missing button teaches a
 *   person nothing and a lying button teaches them the wrong thing.
 *   Native regions are declared, never guessed. `touches` drives the shared
 *   strict-native gate, so a command that would rewrite a region the linked
 *   workbook only preserves is refused identically in the bar, on the shortcut
 *   and in an AI offer (C2).
 *   Shared families come from `commands/shared`. History, find, formatting,
 *   comments, zoom, export and import are written once for all three editors;
 *   this module supplies only the workbook's adapter and its placement.
 */

/** Number formats Spectra can render *and* write to `numFmt` truthfully. */
export const SHEETS_NUMBER_FORMATS: readonly CommandControlOption[] = [
  { value: "general", label: "Automatic", hint: "Numbers as typed, text left aligned" },
  { value: "number", label: "Number", hint: "1,234.57" },
  { value: "currency", label: "Currency", hint: "$1,234.57" },
  { value: "accounting", label: "Accounting", hint: "Aligned symbols, (1,234.57) for negatives" },
  { value: "percent", label: "Percent", hint: "12.35%" },
  { value: "fraction", label: "Fraction", hint: "1 1/4" },
  { value: "scientific", label: "Scientific", hint: "1.23E+03" },
  { value: "date", label: "Date", hint: "2026-08-23" },
  { value: "time", label: "Time", hint: "14:05" },
  { value: "text", label: "Text", hint: "Keeps leading zeros; never calculated" },
  { value: "custom", label: "Custom…", hint: "Enter an Excel format code" },
];

/** Currencies a school actually invoices in, not a full ISO dump. */
export const SHEETS_CURRENCIES: readonly CommandControlOption[] = [
  { value: "USD", label: "USD $" },
  { value: "EUR", label: "EUR €" },
  { value: "GBP", label: "GBP £" },
  { value: "JPY", label: "JPY ¥" },
  { value: "AUD", label: "AUD $" },
  { value: "CAD", label: "CAD $" },
  { value: "INR", label: "INR ₹" },
];

/**
 * Border presets, worded the way a person thinks about a range rather than the
 * way OOXML stores it: an outline, an inside grid, one edge at a time.
 */
export const SHEETS_BORDER_PRESETS: readonly CommandControlOption[] = [
  { value: "all", label: "All borders" },
  { value: "outline", label: "Outline" },
  { value: "inside", label: "Inside" },
  { value: "top", label: "Top edge" },
  { value: "bottom", label: "Bottom edge" },
  { value: "left", label: "Left edge" },
  { value: "right", label: "Right edge" },
  { value: "thick-outline", label: "Thick outline" },
  { value: "double-bottom", label: "Double underline" },
  { value: "none", label: "No borders" },
];

export const SHEETS_BORDER_STYLES: readonly CommandControlOption[] = [
  { value: "thin", label: "Thin" },
  { value: "medium", label: "Medium" },
  { value: "thick", label: "Thick" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
  { value: "double", label: "Double" },
  { value: "hair", label: "Hairline" },
];

export const SHEETS_VERTICAL_ALIGN: readonly CommandControlOption[] = [
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
];

export const SHEETS_TEXT_ROTATIONS: readonly number[] = [-90, -45, 0, 45, 90];

/** Fill colours that stay readable behind black grid text. */
export const SHEETS_FILL_COLORS: readonly string[] = [
  "#ffffff", "#f2f4f7", "#e4e7ec", "#fef0c7", "#fee4e2",
  "#ecfdf3", "#d1e9ff", "#e9d7fe", "#fdf2fa", "#fffaeb",
];

export const SHEETS_CHART_TYPES: readonly CommandControlOption[] = [
  { value: "column", label: "Column" },
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "scatter", label: "Scatter" },
  { value: "combo", label: "Combo" },
  { value: "histogram", label: "Histogram" },
];

export const SHEETS_PASTE_MODES: readonly CommandControlOption[] = [
  { value: "all", label: "Everything" },
  { value: "values", label: "Values only", hint: "Formulas land as their current result" },
  { value: "formulas", label: "Formulas only", hint: "References shift to the new position" },
  { value: "formats", label: "Formatting only" },
  { value: "transpose", label: "Transposed" },
];

export const SHEETS_FILL_SERIES: readonly CommandControlOption[] = [
  { value: "copy", label: "Copy cells" },
  { value: "linear", label: "Linear series", hint: "Continues the step between the first two cells" },
  { value: "growth", label: "Growth series", hint: "Continues the ratio between the first two cells" },
  { value: "weekday", label: "Weekdays" },
  { value: "month", label: "Months" },
];

export const SHEETS_TABLE_STYLES: readonly CommandControlOption[] = [
  { value: "plain", label: "Plain" },
  { value: "striped", label: "Banded rows" },
  { value: "accent", label: "Accent header" },
];

export const SHEETS_CALC_MODES: readonly CommandControlOption[] = [
  { value: "automatic", label: "Automatic" },
  { value: "manual", label: "Manual", hint: "Recalculate with F9" },
];

/**
 * The function library offered in the Formula tab. `native` marks the functions
 * the XLSX lens recognises, so a mounted workbook can round-trip them as live
 * formulas; the rest are evaluated by Spectra and stay cached-only in a linked
 * file. The picker says which is which instead of pretending they are equal.
 */
export type SheetsFunctionSpec = {
  name: string;
  /** The template inserted into the formula bar, `{range}` filled from selection. */
  template: string;
  summary: string;
  group: "Aggregate" | "Logic" | "Lookup" | "Text" | "Date" | "Math" | "Statistics";
  native?: boolean;
};

export const SHEETS_FUNCTION_LIBRARY: readonly SheetsFunctionSpec[] = [
  { name: "SUM", template: "=SUM({range})", summary: "Adds the numbers in a range", group: "Aggregate", native: true },
  { name: "AVERAGE", template: "=AVERAGE({range})", summary: "Mean of the numbers in a range", group: "Aggregate", native: true },
  { name: "COUNT", template: "=COUNT({range})", summary: "How many numeric cells", group: "Aggregate", native: true },
  { name: "COUNTA", template: "=COUNTA({range})", summary: "How many non-empty cells", group: "Aggregate", native: true },
  { name: "MIN", template: "=MIN({range})", summary: "Smallest number in a range", group: "Aggregate", native: true },
  { name: "MAX", template: "=MAX({range})", summary: "Largest number in a range", group: "Aggregate", native: true },
  { name: "ROUND", template: "=ROUND({range}, 2)", summary: "Rounds to a number of decimals", group: "Math", native: true },
  { name: "ABS", template: "=ABS({range})", summary: "Absolute value", group: "Math", native: true },
  { name: "IF", template: "=IF({range} > 0, \"yes\", \"no\")", summary: "Chooses between two results", group: "Logic", native: true },
  { name: "IFERROR", template: "=IFERROR({range}, \"\")", summary: "Replaces an error with your own value", group: "Logic" },
  { name: "SUMIF", template: "=SUMIF({range}, \">0\")", summary: "Adds the cells that match one test", group: "Aggregate" },
  { name: "SUMIFS", template: "=SUMIFS({range}, {range}, \">0\")", summary: "Adds the cells that match every test", group: "Aggregate" },
  { name: "COUNTIF", template: "=COUNTIF({range}, \">0\")", summary: "Counts the cells that match one test", group: "Aggregate" },
  { name: "COUNTIFS", template: "=COUNTIFS({range}, \">0\")", summary: "Counts the cells that match every test", group: "Aggregate" },
  { name: "AVERAGEIF", template: "=AVERAGEIF({range}, \">0\")", summary: "Mean of the cells that match a test", group: "Aggregate" },
  { name: "COUNTBLANK", template: "=COUNTBLANK({range})", summary: "How many cells are empty", group: "Aggregate" },
  { name: "MEDIAN", template: "=MEDIAN({range})", summary: "Middle value of a range", group: "Statistics" },
  { name: "STDEV", template: "=STDEV({range})", summary: "Sample standard deviation", group: "Statistics" },
  { name: "LARGE", template: "=LARGE({range}, 1)", summary: "Nth largest value", group: "Statistics" },
  { name: "SMALL", template: "=SMALL({range}, 1)", summary: "Nth smallest value", group: "Statistics" },
  { name: "RANK", template: "=RANK({cell}, {range})", summary: "Position of a value within a range", group: "Statistics" },
  { name: "SUMPRODUCT", template: "=SUMPRODUCT({range}, {range})", summary: "Multiplies ranges then adds the products", group: "Math" },
  { name: "VLOOKUP", template: "=VLOOKUP({cell}, {range}, 2, FALSE)", summary: "Finds a row by its first column", group: "Lookup" },
  { name: "HLOOKUP", template: "=HLOOKUP({cell}, {range}, 2, FALSE)", summary: "Finds a column by its first row", group: "Lookup" },
  { name: "INDEX", template: "=INDEX({range}, 1, 1)", summary: "Value at a position in a range", group: "Lookup" },
  { name: "MATCH", template: "=MATCH({cell}, {range}, 0)", summary: "Position of a value in a range", group: "Lookup" },
  { name: "XLOOKUP", template: "=XLOOKUP({cell}, {range}, {range})", summary: "Finds a value in any direction", group: "Lookup" },
  { name: "CONCAT", template: "=CONCAT({range})", summary: "Joins text together", group: "Text" },
  { name: "TEXTJOIN", template: "=TEXTJOIN(\", \", TRUE, {range})", summary: "Joins text with a separator", group: "Text" },
  { name: "LEFT", template: "=LEFT({cell}, 3)", summary: "First characters of some text", group: "Text" },
  { name: "RIGHT", template: "=RIGHT({cell}, 3)", summary: "Last characters of some text", group: "Text" },
  { name: "MID", template: "=MID({cell}, 2, 3)", summary: "Characters from the middle", group: "Text" },
  { name: "LEN", template: "=LEN({cell})", summary: "How many characters", group: "Text" },
  { name: "TRIM", template: "=TRIM({cell})", summary: "Removes extra spaces", group: "Text" },
  { name: "UPPER", template: "=UPPER({cell})", summary: "Uppercase text", group: "Text" },
  { name: "LOWER", template: "=LOWER({cell})", summary: "Lowercase text", group: "Text" },
  { name: "PROPER", template: "=PROPER({cell})", summary: "Capitalises each word", group: "Text" },
  { name: "TEXT", template: "=TEXT({cell}, \"0.00\")", summary: "Formats a number as text", group: "Text" },
  { name: "TODAY", template: "=TODAY()", summary: "Today's date", group: "Date" },
  { name: "NOW", template: "=NOW()", summary: "The current date and time", group: "Date" },
  { name: "DATE", template: "=DATE(2026, 1, 1)", summary: "Builds a date from parts", group: "Date" },
  { name: "YEAR", template: "=YEAR({cell})", summary: "Year of a date", group: "Date" },
  { name: "MONTH", template: "=MONTH({cell})", summary: "Month of a date", group: "Date" },
  { name: "DAY", template: "=DAY({cell})", summary: "Day of a date", group: "Date" },
  { name: "WEEKDAY", template: "=WEEKDAY({cell})", summary: "Day of the week as a number", group: "Date" },
  { name: "DAYS", template: "=DAYS({cell}, {cell})", summary: "Days between two dates", group: "Date" },
];

/**
 * The contract's General favourites for Sheets (§2): Undo, Redo, Find, Format,
 * Formula, Freeze, Chart. The matrix test asserts these are pinned, so the list
 * lives beside the bindings that satisfy it.
 */
export const SHEETS_GENERAL_DEFAULTS: readonly string[] = [
  "sheets.history.undo",
  "sheets.history.redo",
  "sheets.navigate.find",
  "sheets.format",
  "sheets.formula.bar",
  "sheets.freeze.rows",
  "sheets.chart.insert",
];

/**
 * Operations the workbook deliberately leaves to the assistant's own reading of
 * the artifact, each with the sentence a person would be told. The capability
 * audit refuses a deferral without a reason and refuses one that has outlived its
 * command, so this list can only shrink.
 */
export const SHEETS_CAPABILITY_DEFERRALS: ReadonlyArray<{
  operation: string;
  reason: string;
}> = [];

export type SheetsToggle = ToggleFacet;

/** Clipboard and fill — the verbs that used to live only on key handlers. */
export type SheetsClipboardHandlers = {
  copy: () => void;
  cut: () => void;
  paste: () => void;
  pasteSpecial: (mode: string) => void;
  canPaste?: boolean;
  clear: (scope: "all" | "values" | "formats") => void;
  fill: (direction: "down" | "right") => void;
  fillSeries: (kind: string) => void;
  /** False when the selection is a single cell, so filling would do nothing. */
  canFill?: boolean;
};

export type SheetsNumberFormatHandlers = {
  format?: string;
  set: (format: string) => void;
  customCode?: string;
  setCustom: (code: string) => void;
  currency?: string;
  setCurrency: (code: string) => void;
  decimals?: number;
  setDecimals: (decimals: number) => void;
  toggleThousands: () => void;
  thousands?: boolean;
};

export type SheetsCellFormatHandlers = {
  fillColor?: ValueFacet<string | null>;
  borders: (preset: string) => void;
  borderStyle?: ValueFacet<string>;
  borderColor?: ValueFacet<string | null>;
  wrap?: SheetsToggle;
  verticalAlign?: ValueFacet<string>;
  rotation?: ValueFacet<number>;
  indent?: { increase: () => void; decrease: () => void; canDecrease?: boolean };
  merge: () => void;
  unmerge: () => void;
  canMerge?: boolean;
  canUnmerge?: boolean;
  /** Why a merge is refused right now, e.g. data loss in the second cell. */
  mergeBlockedReason?: string;
  copyFormat: () => void;
  pasteFormat: () => void;
  hasCopiedFormat?: boolean;
};

export type SheetsStructureHandlers = {
  insertRow: () => void;
  insertColumn: () => void;
  deleteRow: () => void;
  deleteColumn: () => void;
  columnWidth?: number;
  setColumnWidth: (width: number) => void;
  rowHeight?: number;
  setRowHeight: (height: number) => void;
  autofitColumn: () => void;
  hideRow: () => void;
  hideColumn: () => void;
  unhideAll: () => void;
  hiddenCount?: number;
};

export type SheetsViewHandlers = {
  freezeRows: () => void;
  freezeColumns: () => void;
  clearFreeze: () => void;
  frozenRows?: number;
  frozenColumns?: number;
  showFormulas?: SheetsToggle;
  gridlines?: SheetsToggle;
  headings?: SheetsToggle;
};

export type SheetsDataHandlers = {
  sortAscending: () => void;
  sortDescending: () => void;
  openSort: () => void;
  sortOpen?: boolean;
  sortKeyCount?: number;
  toggleFilter: () => void;
  filterActive?: boolean;
  openFilter: () => void;
  createTable: () => void;
  tableStyle?: ValueFacet<string>;
  toggleTotals?: SheetsToggle;
  hasTable?: boolean;
  openValidation: () => void;
  validationOpen?: boolean;
  openConditional: () => void;
  conditionalOpen?: boolean;
  removeDuplicates: () => void;
  splitText: () => void;
  analyze: () => void;
  /** Present when the workbook carries native pivot parts Spectra preserves. */
  pivotPreservedNote?: string;
};

export type SheetsFormulaHandlers = {
  openBar: () => void;
  barOpen?: boolean;
  insertFunction: (name: string) => void;
  autoSum: () => void;
  openLibrary: () => void;
  libraryOpen?: boolean;
  explain: () => void;
  recalculate: () => void;
  calculationMode?: string;
  setCalculationMode: (mode: string) => void;
  traceReferences?: SheetsToggle;
  /** Live count of cells whose formula Spectra can only show, not evaluate. */
  cachedOnlyCount?: number;
  /** Set when the linked file's formulas are read-only in this profile. */
  cachedOnlyNote?: string;
  createNamedRange: () => void;
  manageNames: () => void;
  namedRangeCount?: number;
};

export type SheetsChartHandlers = {
  insert: () => void;
  hasSelection?: boolean;
  type?: ValueFacet<string>;
  setTitle: () => void;
  setRange: () => void;
  toggleLegend?: SheetsToggle;
  remove: () => void;
  linkToDeck?: () => void;
  /** Set when the selected chart is a preserved native Excel chart part. */
  nativeChartNote?: string;
};

export type SheetsSheetHandlers = {
  add: () => void;
  canAdd?: boolean;
  addBlockedReason?: string;
  rename: () => void;
  duplicate: () => void;
  remove: () => void;
  canRemove?: boolean;
  moveLeft: () => void;
  moveRight: () => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  tabColor?: ValueFacet<string | null>;
  hide: () => void;
  canHide?: boolean;
  showHidden: () => void;
  hiddenSheetCount?: number;
};

export type SheetsReviewHandlers = {
  setNote: () => void;
  noteOpen?: boolean;
  hasNote?: boolean;
  protectSheet: () => void;
  protectionNote?: string;
  openHistory: () => void;
};

export type SheetsCommandHandlers = {
  /** Whether editing is possible at all right now. */
  readOnly?: boolean;
  /**
   * Whether the active sheet carries Excel's protection flag. Kept apart from
   * `readOnly` because the one command that lifts protection has to stay
   * reachable while it is on — a lock you cannot unlock is a trap, not a state.
   */
  protectedSheet?: boolean;
  history: HistoryAdapter;
  find: FindAdapter;
  textFormat: TextFormatAdapter;
  openFormatPanel: () => void;
  formatPanelOpen?: boolean;
  clipboard: SheetsClipboardHandlers;
  numberFormat: SheetsNumberFormatHandlers;
  cellFormat: SheetsCellFormatHandlers;
  structure: SheetsStructureHandlers;
  view: SheetsViewHandlers;
  data: SheetsDataHandlers;
  formula: SheetsFormulaHandlers;
  chart: SheetsChartHandlers;
  sheet: SheetsSheetHandlers;
  review: SheetsReviewHandlers;
  comments: CommentsAdapter;
  zoom: ZoomAdapter;
  export: ExportAdapter;
  import: ImportAdapter;
  print: () => void;
};

const noop = () => {};

/**
 * A complete handler set that does nothing, for the capability matrix and for
 * tests that audit the surface without a live grid. It is exhaustive on purpose:
 * if a new handler is added above and forgotten here, this stops compiling, so
 * the audit can never silently skip a family.
 */
export function sheetsStubHandlers(): SheetsCommandHandlers {
  const toggle = (): SheetsToggle => ({ active: false, toggle: noop });
  return {
    history: { undo: noop, redo: noop, canUndo: true, canRedo: true },
    find: { toggle: noop, toggleReplace: noop, matchNoun: "match" },
    textFormat: {
      fontFamily: { set: noop },
      fontSize: { value: 11, set: noop },
      bold: toggle(),
      italic: toggle(),
      underline: toggle(),
      strike: toggle(),
      color: { set: noop },
      alignment: { value: "left", set: noop },
      clear: noop,
      touches: ["styles", "numberFormats"],
    },
    openFormatPanel: noop,
    clipboard: {
      copy: noop,
      cut: noop,
      paste: noop,
      pasteSpecial: noop,
      canPaste: true,
      clear: noop,
      fill: noop,
      fillSeries: noop,
      canFill: true,
    },
    numberFormat: {
      format: "general",
      set: noop,
      setCustom: noop,
      currency: "USD",
      setCurrency: noop,
      decimals: 2,
      setDecimals: noop,
      toggleThousands: noop,
    },
    cellFormat: {
      fillColor: { set: noop },
      borders: noop,
      borderStyle: { value: "thin", set: noop },
      borderColor: { set: noop },
      wrap: toggle(),
      verticalAlign: { value: "bottom", set: noop },
      rotation: { value: 0, set: noop },
      indent: { increase: noop, decrease: noop, canDecrease: true },
      merge: noop,
      unmerge: noop,
      canMerge: true,
      canUnmerge: true,
      copyFormat: noop,
      pasteFormat: noop,
    },
    structure: {
      insertRow: noop,
      insertColumn: noop,
      deleteRow: noop,
      deleteColumn: noop,
      columnWidth: 96,
      setColumnWidth: noop,
      rowHeight: 24,
      setRowHeight: noop,
      autofitColumn: noop,
      hideRow: noop,
      hideColumn: noop,
      unhideAll: noop,
      hiddenCount: 0,
    },
    view: {
      freezeRows: noop,
      freezeColumns: noop,
      clearFreeze: noop,
      frozenRows: 0,
      frozenColumns: 0,
      showFormulas: toggle(),
      gridlines: { active: true, toggle: noop },
      headings: { active: true, toggle: noop },
    },
    data: {
      sortAscending: noop,
      sortDescending: noop,
      openSort: noop,
      toggleFilter: noop,
      openFilter: noop,
      createTable: noop,
      tableStyle: { value: "striped", set: noop },
      toggleTotals: toggle(),
      openValidation: noop,
      openConditional: noop,
      removeDuplicates: noop,
      splitText: noop,
      analyze: noop,
    },
    formula: {
      openBar: noop,
      insertFunction: noop,
      autoSum: noop,
      openLibrary: noop,
      explain: noop,
      recalculate: noop,
      calculationMode: "automatic",
      setCalculationMode: noop,
      traceReferences: toggle(),
      createNamedRange: noop,
      manageNames: noop,
      namedRangeCount: 0,
    },
    chart: {
      insert: noop,
      hasSelection: true,
      type: { value: "column", set: noop },
      setTitle: noop,
      setRange: noop,
      toggleLegend: { active: true, toggle: noop },
      remove: noop,
      linkToDeck: noop,
    },
    sheet: {
      add: noop,
      canAdd: true,
      rename: noop,
      duplicate: noop,
      remove: noop,
      canRemove: true,
      moveLeft: noop,
      moveRight: noop,
      canMoveLeft: true,
      canMoveRight: true,
      tabColor: { set: noop },
      hide: noop,
      canHide: true,
      showHidden: noop,
      hiddenSheetCount: 0,
    },
    review: {
      setNote: noop,
      protectSheet: noop,
      openHistory: noop,
    },
    comments: { toggle: noop },
    zoom: { zoom: 1, setZoom: noop, min: 0.5, max: 2 },
    export: {
      noun: "workbook",
      formats: [
        { format: "xlsx", label: "Excel", lossy: true },
        { format: "csv", label: "CSV", lossy: true },
        { format: "ods", label: "OpenDocument", lossy: true },
        { format: "pdf", label: "PDF", lossy: true },
      ],
      run: noop,
    },
    import: { open: noop, noun: "workbook" },
    print: noop,
  };
}

/** Narrows a control value that must be a string before it reaches a handler. */
function asString(value: CommandParam): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Narrows a numeric control value, tolerating the string a text field sends. */
function asNumber(value: CommandParam): number | undefined {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : undefined;
}

export function sheetsCommandBindings(handlers: SheetsCommandHandlers): CommandBinding[] {
  const bindings: CommandBinding[] = [];
  const readOnly = handlers.readOnly === true;
  const protectedSheet = handlers.protectedSheet === true;
  /** Everything that writes cells is off while either state holds. */
  const blocked = readOnly || protectedSheet;
  const disabled = blocked || undefined;

  // General — history and find come from the shared families so the three
  // editors cannot drift on the most-reached-for pair in any application.
  bindings.push(...historyBindings(handlers.history));
  bindings.push(...findBindings(handlers.find));

  // The four remaining contract favourites. Each one is the *entry* to a depth
  // surface rather than a shallow copy of it: Format opens the inspector the
  // Format tab also drives, Formula opens the same bar the grid types into.
  bindings.push({
    id: "format",
    label: "Format",
    icon: Palette,
    tab: "Format",
    group: "Inspector",
    priority: "essential",
    general: true,
    requires: "edit",
    disabled,
    active: handlers.formatPanelOpen,
    hint: "Number format, font, borders and fill for the selection",
    touches: ["styles", "numberFormats"],
    manifestOps: ["format_range"],
    onSelect: () => handlers.openFormatPanel(),
  });

  bindings.push({
    id: "formula.bar",
    label: "Formula",
    icon: Sigma,
    tab: "Formula",
    group: "Formula bar",
    priority: "essential",
    general: true,
    requires: "edit",
    disabled,
    active: handlers.formula.barOpen,
    hint:
      handlers.formula.cachedOnlyNote ??
      (handlers.formula.cachedOnlyCount
        ? `${handlers.formula.cachedOnlyCount} formulas here show Excel's saved result`
        : "Edit the active cell's formula"),
    touches: ["formulas"],
    manifestOps: ["set_formula"],
    onSelect: () => handlers.formula.openBar(),
  });

  bindings.push({
    id: "freeze.rows",
    label: "Freeze rows",
    icon: Snowflake,
    tab: "Data",
    group: "Freeze",
    priority: "essential",
    general: true,
    requires: "edit",
    disabled,
    active: (handlers.view.frozenRows ?? 0) > 0,
    hint: (handlers.view.frozenRows ?? 0) > 0
      ? `Rows 1–${handlers.view.frozenRows} stay in view`
      : "Keep the rows above the selection in view while scrolling",
    onSelect: () => handlers.view.freezeRows(),
  });

  bindings.push({
    id: "chart.insert",
    label: "Insert chart",
    icon: ChartColumn,
    tab: "Insert",
    group: "Chart",
    priority: "essential",
    general: true,
    requires: "edit",
    disabled,
    hint: "Chart the selected range",
    touches: ["charts"],
    manifestOps: ["create_chart"],
    onSelect: () => handlers.chart.insert(),
  });

  // §2.1 Clipboard and fill. These were keyboard-only: Ctrl+V had its own paste
  // and the fill handle had its own copy loop, so neither could be reached by
  // the AI or the customizer. The grid now dispatches these same ids.
  const clipboard = handlers.clipboard;
  bindings.push(
    {
      id: "clipboard.copy",
      label: "Copy",
      icon: Copy,
      tab: "General",
      group: "Clipboard",
      priority: "secondary",
      hint: "Copies the selected cells with their formulas and formatting",
      undo: "none(explain)",
      onSelect: () => clipboard.copy(),
    },
    {
      id: "clipboard.cut",
      label: "Cut",
      icon: Scissors,
      tab: "General",
      group: "Clipboard",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Copies the selection, then clears it when you paste",
      touches: ["cells"],
      manifestOps: ["clear_range"],
      onSelect: () => clipboard.cut(),
    },
    {
      id: "clipboard.paste",
      label: "Paste",
      icon: ClipboardPaste,
      tab: "General",
      group: "Clipboard",
      priority: "secondary",
      requires: "edit",
      disabled: disabled || clipboard.canPaste === false || undefined,
      hint: clipboard.canPaste === false
        ? "Nothing copied in Spectra yet"
        : "Pastes at the selection; formula references shift to the new position",
      touches: ["cells", "formulas"],
      manifestOps: ["set_cells"],
      onSelect: () => clipboard.paste(),
    },
    {
      id: "clipboard.pasteSpecial",
      label: "Paste special",
      icon: Clipboard,
      tab: "General",
      group: "Clipboard",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || clipboard.canPaste === false || undefined,
      hint: "Choose whether values, formulas or formatting come across",
      touches: ["cells", "formulas", "numberFormats"],
      control: { kind: "menu", options: SHEETS_PASTE_MODES },
      manifestOps: ["set_cells"],
      onSelect: (value) => {
        const mode = asString(value);
        if (mode) clipboard.pasteSpecial(mode);
      },
    },
    {
      id: "clear.all",
      label: "Clear",
      icon: Eraser,
      tab: "General",
      group: "Clipboard",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Removes the values and the formatting in the selection",
      touches: ["cells", "formulas", "numberFormats"],
      manifestOps: ["clear_range"],
      risk: "confirm",
      onSelect: () => clipboard.clear("all"),
    },
    {
      id: "clear.values",
      label: "Clear contents",
      icon: Eraser,
      tab: "General",
      group: "Clipboard",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Empties the cells but keeps their formatting",
      touches: ["cells", "formulas"],
      manifestOps: ["clear_range"],
      onSelect: () => clipboard.clear("values"),
    },
    {
      id: "clear.formats",
      label: "Clear formatting",
      icon: Brush,
      tab: "General",
      group: "Clipboard",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Keeps the values and returns the cells to the sheet default",
      touches: ["styles", "numberFormats"],
      manifestOps: ["format_range"],
      onSelect: () => clipboard.clear("formats"),
    },
    {
      id: "fill.down",
      label: "Fill down",
      icon: ArrowDown,
      tab: "General",
      group: "Fill",
      priority: "secondary",
      requires: "edit",
      disabled: disabled || clipboard.canFill === false || undefined,
      shortcut: "Mod+D",
      hint: clipboard.canFill === false
        ? "Select more than one row to fill down"
        : "Copies the top row of the selection down, shifting references",
      touches: ["cells", "formulas"],
      manifestOps: ["fill_range"],
      onSelect: () => clipboard.fill("down"),
    },
    {
      id: "fill.right",
      label: "Fill right",
      icon: ArrowRight,
      tab: "General",
      group: "Fill",
      priority: "secondary",
      requires: "edit",
      disabled: disabled || clipboard.canFill === false || undefined,
      shortcut: "Mod+R",
      hint: clipboard.canFill === false
        ? "Select more than one column to fill right"
        : "Copies the left column of the selection right, shifting references",
      touches: ["cells", "formulas"],
      manifestOps: ["fill_range"],
      onSelect: () => clipboard.fill("right"),
    },
    {
      id: "fill.series",
      label: "Fill series",
      icon: ArrowUpDown,
      tab: "General",
      group: "Fill",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || clipboard.canFill === false || undefined,
      hint: "Continue a number, weekday or month pattern across the selection",
      touches: ["cells"],
      control: { kind: "menu", options: SHEETS_FILL_SERIES },
      manifestOps: ["fill_range"],
      onSelect: (value) => {
        const kind = asString(value);
        if (kind) clipboard.fillSeries(kind);
      },
    },
  );

  // §2.4 Formatting. Font marks, colour and alignment come from the shared
  // family; everything below is the spreadsheet's own vocabulary — number
  // formats, borders, wrap, rotation, merge — which no other type has.
  bindings.push(
    ...textFormatBindings({
      ...handlers.textFormat,
      disabled: blocked || handlers.textFormat.disabled,
      generalPins: [],
    }),
  );

  const number = handlers.numberFormat;
  bindings.push(
    {
      id: "format.number",
      label: "Number format",
      icon: Hash,
      tab: "Format",
      group: "Number",
      priority: "essential",
      requires: "edit",
      disabled,
      hint: "How the value is displayed; the stored number does not change",
      touches: ["numberFormats"],
      control: {
        kind: "select",
        options: SHEETS_NUMBER_FORMATS,
        value: number.format,
        width: "10rem",
      },
      manifestOps: ["format_range"],
      onSelect: (value) => {
        const format = asString(value);
        if (format) number.set(format);
      },
    },
    {
      id: "format.number.custom",
      label: "Custom format code",
      icon: Braces,
      tab: "Format",
      group: "Number",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Enter an Excel format code such as #,##0.00 or yyyy-mm-dd",
      touches: ["numberFormats"],
      manifestOps: ["format_range"],
      onSelect: (value) => {
        const code = asString(value);
        number.setCustom(code ?? number.customCode ?? "");
      },
    },
    {
      id: "format.currency",
      label: "Currency",
      icon: DollarSign,
      tab: "Format",
      group: "Number",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Currency shown beside the amount",
      touches: ["numberFormats"],
      control: {
        kind: "select",
        options: SHEETS_CURRENCIES,
        value: number.currency,
        width: "7rem",
      },
      manifestOps: ["format_range"],
      onSelect: (value) => {
        const code = asString(value);
        if (code) number.setCurrency(code);
      },
    },
    {
      id: "format.decimals",
      label: "Decimals",
      icon: Percent,
      tab: "Format",
      group: "Number",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Digits shown after the decimal point",
      touches: ["numberFormats"],
      control: {
        kind: "numeric",
        value: number.decimals,
        min: 0,
        max: 10,
        step: 1,
        presets: [0, 1, 2, 3, 4],
      },
      manifestOps: ["format_range"],
      onSelect: (value) => {
        const next = asNumber(value);
        if (next !== undefined) number.setDecimals(Math.min(10, Math.max(0, Math.round(next))));
      },
    },
    {
      id: "format.thousands",
      label: "Thousands separator",
      icon: Hash,
      tab: "Format",
      group: "Number",
      priority: "advanced",
      requires: "edit",
      disabled,
      active: number.thousands ?? false,
      hint: "Groups digits as 1,234,567",
      touches: ["numberFormats"],
      manifestOps: ["format_range"],
      onSelect: () => number.toggleThousands(),
    },
  );

  const cell = handlers.cellFormat;
  bindings.push({
    id: "format.borders",
    label: "Borders",
    icon: Grid3x3,
    tab: "Format",
    group: "Borders",
    priority: "essential",
    requires: "edit",
    disabled,
    hint: "Rule lines around or inside the selection",
    touches: ["styles"],
    control: { kind: "menu", options: SHEETS_BORDER_PRESETS },
    manifestOps: ["format_range"],
    onSelect: (value) => {
      const preset = asString(value);
      if (preset) cell.borders(preset);
    },
  });

  if (cell.borderStyle) {
    const style = cell.borderStyle;
    bindings.push({
      id: "format.borders.style",
      label: "Border line",
      icon: Minus,
      tab: "Format",
      group: "Borders",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Line weight used by the next border you apply",
      touches: ["styles"],
      control: { kind: "select", options: SHEETS_BORDER_STYLES, value: style.value, width: "7rem" },
      manifestOps: ["format_range"],
      onSelect: (value) => {
        const next = asString(value);
        if (next) style.set(next);
      },
    });
  }

  if (cell.borderColor) {
    const color = cell.borderColor;
    bindings.push({
      id: "format.borders.color",
      label: "Border colour",
      icon: PaintBucket,
      tab: "Format",
      group: "Borders",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Colour used by the next border you apply",
      touches: ["styles"],
      control: { kind: "color", value: color.value ?? undefined, clearLabel: "Automatic" },
      manifestOps: ["format_range"],
      onSelect: (value) => color.set(asString(value) ?? null),
    });
  }

  if (cell.fillColor) {
    const fill = cell.fillColor;
    bindings.push({
      id: "format.fill",
      label: "Fill colour",
      icon: Highlighter,
      tab: "Format",
      group: "Fill",
      priority: "essential",
      requires: "edit",
      disabled,
      hint: "Background of the selected cells",
      touches: ["styles"],
      control: {
        kind: "color",
        value: fill.value ?? undefined,
        swatches: SHEETS_FILL_COLORS,
        clearLabel: "No fill",
      },
      manifestOps: ["format_range"],
      onSelect: (value) => fill.set(asString(value) ?? null),
    });
  }

  if (cell.wrap) {
    const wrap = cell.wrap;
    bindings.push({
      id: "format.wrap",
      label: "Wrap text",
      icon: Text,
      tab: "Format",
      group: "Alignment",
      priority: "essential",
      requires: "edit",
      disabled,
      active: wrap.active ?? false,
      hint: "Long text wraps inside the cell instead of spilling over",
      touches: ["styles"],
      manifestOps: ["format_range"],
      onSelect: () => wrap.toggle(),
    });
  }

  if (cell.verticalAlign) {
    const valign = cell.verticalAlign;
    bindings.push({
      id: "format.valign",
      label: "Vertical alignment",
      icon: AlignVerticalJustifyCenter,
      tab: "Format",
      group: "Alignment",
      priority: "secondary",
      requires: "edit",
      disabled,
      touches: ["styles"],
      control: {
        kind: "segmented",
        value: valign.value ?? "bottom",
        options: [
          { value: "top", label: "Top", icon: AlignVerticalJustifyStart },
          { value: "middle", label: "Middle", icon: AlignVerticalJustifyCenter },
          { value: "bottom", label: "Bottom", icon: AlignVerticalJustifyEnd },
        ],
      },
      manifestOps: ["format_range"],
      onSelect: (value) => {
        const next = asString(value);
        if (next) valign.set(next);
      },
    });
  }

  if (cell.rotation) {
    const rotation = cell.rotation;
    bindings.push({
      id: "format.rotation",
      label: "Text angle",
      icon: RotateCcw,
      tab: "Format",
      group: "Alignment",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Rotate the text in the selected cells, in degrees",
      touches: ["styles"],
      control: {
        kind: "numeric",
        value: rotation.value ?? 0,
        min: -90,
        max: 90,
        step: 15,
        suffix: "°",
        presets: SHEETS_TEXT_ROTATIONS,
      },
      manifestOps: ["format_range"],
      onSelect: (value) => {
        const next = asNumber(value);
        if (next !== undefined) rotation.set(Math.min(90, Math.max(-90, Math.round(next))));
      },
    });
  }

  if (cell.indent) {
    const indent = cell.indent;
    bindings.push(
      {
        id: "format.indent.increase",
        label: "Increase indent",
        icon: Indent,
        tab: "Format",
        group: "Alignment",
        priority: "advanced",
        requires: "edit",
        disabled,
        hint: "Moves the cell text further from its left edge",
        touches: ["styles"],
        manifestOps: ["format_range"],
        onSelect: () => indent.increase(),
      },
      {
        id: "format.indent.decrease",
        label: "Decrease indent",
        icon: Outdent,
        tab: "Format",
        group: "Alignment",
        priority: "advanced",
        requires: "edit",
        disabled: disabled || indent.canDecrease === false || undefined,
        hint: "Moves the cell text back towards its left edge",
        touches: ["styles"],
        manifestOps: ["format_range"],
        onSelect: () => indent.decrease(),
      },
    );
  }

  bindings.push(
    {
      id: "format.merge",
      label: "Merge cells",
      icon: Merge,
      tab: "Format",
      group: "Merge",
      priority: "essential",
      requires: "edit",
      disabled: disabled || cell.canMerge === false || undefined,
      hint: cell.mergeBlockedReason ?? "Joins the selection into one cell, keeping the first value",
      touches: ["cells"],
      risk: "confirm",
      manifestOps: ["format_range"],
      onSelect: () => cell.merge(),
    },
    {
      id: "format.unmerge",
      label: "Unmerge cells",
      icon: Split,
      tab: "Format",
      group: "Merge",
      priority: "secondary",
      requires: "edit",
      disabled: disabled || cell.canUnmerge === false || undefined,
      hint: cell.canUnmerge === false
        ? "The selection has no merged cells"
        : "Splits the merged cells back apart",
      touches: ["cells"],
      manifestOps: ["format_range"],
      onSelect: () => cell.unmerge(),
    },
    {
      id: "format.copyStyle",
      label: "Copy formatting",
      icon: Paintbrush,
      tab: "Format",
      group: "Inspector",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Picks up the format of the active cell so you can apply it elsewhere",
      undo: "none(explain)",
      onSelect: () => cell.copyFormat(),
    },
    {
      id: "format.pasteStyle",
      label: "Apply formatting",
      icon: Brush,
      tab: "Format",
      group: "Inspector",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || cell.hasCopiedFormat === false || undefined,
      hint: cell.hasCopiedFormat === false
        ? "Copy a cell's formatting first"
        : "Applies the formatting you picked up to the selection",
      touches: ["styles", "numberFormats"],
      manifestOps: ["format_range"],
      onSelect: () => cell.pasteFormat(),
    },
  );

  // §2.5 Rows, columns and size. Insert and delete already existed as commands;
  // resize, autofit and hide lived on header drags and a context menu, so they
  // are registered here and the drag now dispatches the same id.
  const structure = handlers.structure;
  bindings.push(
    {
      id: "insert.row",
      label: "Insert row",
      icon: Rows3,
      tab: "Insert",
      group: "Rows and columns",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Adds a row above the selection and shifts formula references",
      touches: ["cells", "formulas"],
      manifestOps: ["insert_structure"],
      onSelect: () => structure.insertRow(),
    },
    {
      id: "insert.column",
      label: "Insert column",
      icon: Columns3,
      tab: "Insert",
      group: "Rows and columns",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Adds a column left of the selection and shifts formula references",
      touches: ["cells", "formulas"],
      manifestOps: ["insert_structure"],
      onSelect: () => structure.insertColumn(),
    },
    {
      id: "delete.row",
      label: "Delete row",
      icon: Trash2,
      tab: "Insert",
      group: "Rows and columns",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Removes the selected rows; formulas that pointed at them shift up",
      touches: ["cells", "formulas"],
      risk: "destructive",
      manifestOps: ["insert_structure"],
      onSelect: () => structure.deleteRow(),
    },
    {
      id: "delete.column",
      label: "Delete column",
      icon: Trash2,
      tab: "Insert",
      group: "Rows and columns",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Removes the selected columns; formulas that pointed at them shift left",
      touches: ["cells", "formulas"],
      risk: "destructive",
      manifestOps: ["insert_structure"],
      onSelect: () => structure.deleteColumn(),
    },
    {
      id: "format.column.width",
      label: "Column width",
      icon: Ruler,
      tab: "Format",
      group: "Size",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Width of the selected columns, in pixels",
      touches: ["cells"],
      control: {
        kind: "numeric",
        value: structure.columnWidth,
        min: 24,
        max: 640,
        step: 8,
        suffix: "px",
        presets: [64, 96, 128, 180, 240],
      },
      manifestOps: ["format_range"],
      onSelect: (value) => {
        const next = asNumber(value);
        if (next !== undefined) structure.setColumnWidth(Math.min(640, Math.max(24, Math.round(next))));
      },
    },
    {
      id: "format.row.height",
      label: "Row height",
      icon: Ruler,
      tab: "Format",
      group: "Size",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Height of the selected rows, in pixels",
      touches: ["cells"],
      control: {
        kind: "numeric",
        value: structure.rowHeight,
        min: 16,
        max: 400,
        step: 4,
        suffix: "px",
        presets: [24, 32, 40, 56, 80],
      },
      manifestOps: ["format_range"],
      onSelect: (value) => {
        const next = asNumber(value);
        if (next !== undefined) structure.setRowHeight(Math.min(400, Math.max(16, Math.round(next))));
      },
    },
    {
      id: "format.column.autofit",
      label: "Fit column to text",
      icon: ChevronsLeftRight,
      tab: "Format",
      group: "Size",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Widens the column to the longest value it holds",
      touches: ["cells"],
      manifestOps: ["format_range"],
      onSelect: () => structure.autofitColumn(),
    },
    {
      id: "hide.row",
      label: "Hide rows",
      icon: EyeOff,
      tab: "Data",
      group: "Hide",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Hides the selected rows; their values still count in formulas",
      touches: ["cells"],
      manifestOps: ["format_range"],
      onSelect: () => structure.hideRow(),
    },
    {
      id: "hide.column",
      label: "Hide columns",
      icon: EyeOff,
      tab: "Data",
      group: "Hide",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Hides the selected columns; their values still count in formulas",
      touches: ["cells"],
      manifestOps: ["format_range"],
      onSelect: () => structure.hideColumn(),
    },
    {
      id: "unhide.all",
      label: "Show hidden",
      icon: Eye,
      tab: "Data",
      group: "Hide",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || structure.hiddenCount === 0 || undefined,
      hint: structure.hiddenCount
        ? `Brings back ${structure.hiddenCount} hidden rows and columns`
        : "Nothing on this sheet is hidden",
      touches: ["cells"],
      manifestOps: ["format_range"],
      onSelect: () => structure.unhideAll(),
    },
  );

  // §2.2 Freeze and the view toggles. Freeze rows is pinned above as a contract
  // favourite; the rest of the family lives beside it in Data / Freeze.
  const view = handlers.view;
  bindings.push(
    {
      id: "freeze.columns",
      label: "Freeze columns",
      icon: Snowflake,
      tab: "Data",
      group: "Freeze",
      priority: "secondary",
      requires: "edit",
      disabled,
      active: (view.frozenColumns ?? 0) > 0,
      hint: (view.frozenColumns ?? 0) > 0
        ? `The first ${view.frozenColumns} columns stay in view`
        : "Keep the columns left of the selection in view while scrolling",
      onSelect: () => view.freezeColumns(),
    },
    {
      id: "freeze.clear",
      label: "Unfreeze panes",
      icon: Grid2x2,
      tab: "Data",
      group: "Freeze",
      priority: "advanced",
      requires: "edit",
      disabled:
        disabled ||
        ((view.frozenRows ?? 0) === 0 && (view.frozenColumns ?? 0) === 0) ||
        undefined,
      hint: "Lets every row and column scroll again",
      onSelect: () => view.clearFreeze(),
    },
  );

  if (view.showFormulas) {
    const showFormulas = view.showFormulas;
    bindings.push({
      id: "view.formulas",
      label: "Show formulas",
      icon: ScanSearch,
      tab: "General",
      group: "View",
      priority: "advanced",
      active: showFormulas.active ?? false,
      hint: "Shows formula text in every cell instead of its result",
      undo: "none(explain)",
      onSelect: () => showFormulas.toggle(),
    });
  }

  if (view.gridlines) {
    const gridlines = view.gridlines;
    bindings.push({
      id: "view.gridlines",
      label: "Gridlines",
      icon: Grid3x3,
      tab: "General",
      group: "View",
      priority: "advanced",
      active: gridlines.active ?? true,
      hint: "Show or hide the faint lines between cells",
      undo: "none(explain)",
      onSelect: () => gridlines.toggle(),
    });
  }

  if (view.headings) {
    const headings = view.headings;
    bindings.push({
      id: "view.headings",
      label: "Row and column headers",
      icon: Layers,
      tab: "General",
      group: "View",
      priority: "advanced",
      active: headings.active ?? true,
      hint: "Show or hide the A, B, C and 1, 2, 3 headers",
      undo: "none(explain)",
      onSelect: () => headings.toggle(),
    });
  }

  // Zoom comes from the shared family. `view.zoom.reset` ships without a hint
  // there, and an overflow entry with no explanation is exactly what the matrix
  // audit refuses, so the workbook supplies the missing sentence rather than
  // forking the family.
  for (const binding of zoomBindings(handlers.zoom)) {
    bindings.push(
      binding.hint
        ? binding
        : { ...binding, hint: `Back to 100%, from ${Math.round(handlers.zoom.zoom * 100)}%` },
    );
  }

  // §2.6 Data tools.
  const data = handlers.data;
  bindings.push(
    {
      id: "sort.asc",
      label: "Sort A to Z",
      icon: ArrowUpAZ,
      tab: "Data",
      group: "Sort and filter",
      priority: "essential",
      requires: "edit",
      disabled,
      hint: "Sorts the rows by the selected column, smallest first",
      touches: ["cells"],
      manifestOps: ["sort_filter"],
      onSelect: () => data.sortAscending(),
    },
    {
      id: "sort.desc",
      label: "Sort Z to A",
      icon: ArrowDownAZ,
      tab: "Data",
      group: "Sort and filter",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Sorts the rows by the selected column, largest first",
      touches: ["cells"],
      manifestOps: ["sort_filter"],
      onSelect: () => data.sortDescending(),
    },
    {
      id: "sort.custom",
      label: "Custom sort",
      icon: ArrowUpDown,
      tab: "Data",
      group: "Sort and filter",
      priority: "secondary",
      requires: "edit",
      disabled,
      active: data.sortOpen,
      hint: data.sortKeyCount
        ? `Sorting by ${data.sortKeyCount} columns`
        : "Sort by more than one column, in the order you choose",
      touches: ["cells"],
      manifestOps: ["sort_filter"],
      onSelect: () => data.openSort(),
    },
    {
      id: "filter.toggle",
      label: "Filter",
      icon: ListFilter,
      tab: "Data",
      group: "Sort and filter",
      priority: "essential",
      requires: "edit",
      disabled,
      active: data.filterActive,
      hint: "Turns the selection into a filterable range",
      touches: ["cells"],
      manifestOps: ["sort_filter"],
      onSelect: () => data.toggleFilter(),
    },
    {
      id: "filter.edit",
      label: "Filter values",
      icon: ListFilter,
      tab: "Data",
      group: "Sort and filter",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || data.hasTable === false || undefined,
      hint: data.hasTable === false
        ? "Turn on Filter first"
        : "Choose which values stay visible in each column",
      touches: ["cells"],
      manifestOps: ["sort_filter"],
      onSelect: () => data.openFilter(),
    },
    {
      id: "table.create",
      label: "Format as table",
      icon: Table2,
      tab: "Insert",
      group: "Tables",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Gives the range a header row, banding and filters",
      touches: ["tables"],
      manifestOps: ["create_table"],
      onSelect: () => data.createTable(),
    },
  );

  if (data.tableStyle) {
    const style = data.tableStyle;
    bindings.push({
      id: "table.style",
      label: "Table style",
      icon: Table2,
      tab: "Data",
      group: "Tables",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || data.hasTable === false || undefined,
      hint: data.hasTable === false ? "Select a table first" : "Banding and header emphasis",
      touches: ["tables"],
      control: { kind: "select", options: SHEETS_TABLE_STYLES, value: style.value, width: "8rem" },
      manifestOps: ["create_table"],
      onSelect: (value) => {
        const next = asString(value);
        if (next) style.set(next);
      },
    });
  }

  if (data.toggleTotals) {
    const totals = data.toggleTotals;
    bindings.push({
      id: "table.totals",
      label: "Totals row",
      icon: Sigma,
      tab: "Data",
      group: "Tables",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || data.hasTable === false || undefined,
      active: totals.active ?? false,
      hint: data.hasTable === false
        ? "Select a table first"
        : "Adds a row that sums each numeric column",
      touches: ["tables", "formulas"],
      manifestOps: ["create_table"],
      onSelect: () => totals.toggle(),
    });
  }

  bindings.push(
    {
      id: "validation.set",
      label: "Data validation",
      icon: ShieldCheck,
      tab: "Data",
      group: "Validation",
      priority: "secondary",
      requires: "edit",
      disabled,
      active: data.validationOpen,
      hint: "Restrict what can be typed: a list, a number range, or a checkbox",
      touches: ["validation"],
      manifestOps: ["validate_range"],
      onSelect: () => data.openValidation(),
    },
    {
      id: "conditional.apply",
      label: "Conditional formatting",
      icon: Sparkles,
      tab: "Format",
      group: "Conditional",
      priority: "secondary",
      requires: "edit",
      disabled,
      active: data.conditionalOpen,
      hint: "Colour cells by what they contain",
      touches: ["conditionalFormat"],
      manifestOps: ["format_range"],
      onSelect: () => data.openConditional(),
    },
    {
      id: "data.duplicates",
      label: "Remove duplicates",
      icon: Ban,
      tab: "Data",
      group: "Tools",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Deletes rows whose selected columns repeat an earlier row",
      touches: ["cells"],
      risk: "destructive",
      manifestOps: ["sort_filter"],
      onSelect: () => data.removeDuplicates(),
    },
    {
      id: "data.splitText",
      label: "Split text to columns",
      icon: Split,
      tab: "Data",
      group: "Tools",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Divides the selected column at commas or tabs",
      touches: ["cells"],
      manifestOps: ["set_cells"],
      onSelect: () => data.splitText(),
    },
    {
      id: "analyze.summary",
      label: "Summarise selection",
      icon: Calculator,
      tab: "Data",
      group: "Analysis",
      priority: "advanced",
      disabled,
      hint: "Count, sum, mean and range of the selected cells",
      manifestOps: ["analyze"],
      undo: "none(explain)",
      onSelect: () => data.analyze(),
    },
  );

  // §2.7 Formulas. The bar itself is pinned in General as the contract's
  // Formula favourite; the library, the auditing toggle and the calculation
  // controls live here. Every entry says whether Excel will see a live formula
  // or the value Spectra worked out, because that is the one thing a person
  // cannot discover by looking at the cell.
  const formula = handlers.formula;
  const functionOptions: CommandControlOption[] = SHEETS_FUNCTION_LIBRARY.map((spec) => ({
    value: spec.name,
    label: spec.name,
    hint: spec.native
      ? `${spec.summary} · stays a live formula in Excel`
      : `${spec.summary} · Spectra calculates this one`,
  }));

  bindings.push(
    {
      id: "formula.insert",
      label: "Insert function",
      icon: Library,
      tab: "Formula",
      group: "Library",
      priority: "essential",
      requires: "edit",
      disabled,
      hint: "Puts a function template in the formula bar, over the selected range",
      touches: ["formulas"],
      control: { kind: "menu", options: functionOptions },
      manifestOps: ["set_formula"],
      onSelect: (value) => {
        const name = asString(value);
        if (name) formula.insertFunction(name);
      },
    },
    {
      id: "formula.autosum",
      label: "AutoSum",
      icon: Sigma,
      tab: "Formula",
      group: "Library",
      priority: "essential",
      requires: "edit",
      disabled,
      hint: "Totals the numbers above or left of the selection",
      touches: ["formulas"],
      manifestOps: ["set_formula"],
      onSelect: () => formula.autoSum(),
    },
    {
      id: "formula.library",
      label: "Function library",
      icon: Braces,
      tab: "Formula",
      group: "Library",
      priority: "secondary",
      disabled,
      active: formula.libraryOpen,
      hint: "Browse every function Spectra can calculate, with what it does",
      undo: "none(explain)",
      onSelect: () => formula.openLibrary(),
    },
    {
      id: "formula.explain",
      label: "Explain this formula",
      icon: Info,
      tab: "Formula",
      group: "Library",
      priority: "advanced",
      hint: "Reads the active formula back in plain sentences",
      manifestOps: ["explain_formula"],
      undo: "none(explain)",
      onSelect: () => formula.explain(),
    },
    {
      id: "formula.calculate",
      label: "Recalculate now",
      icon: RefreshCw,
      tab: "Formula",
      group: "Calculate",
      priority: "secondary",
      disabled,
      hint: formula.calculationMode === "manual"
        ? "Runs every formula on this workbook now"
        : "Formulas already recalculate as you type; this forces a full pass",
      undo: "none(explain)",
      onSelect: () => formula.recalculate(),
    },
    {
      id: "formula.calcMode",
      label: "Calculation",
      icon: Calculator,
      tab: "Formula",
      group: "Calculate",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Whether formulas recalculate as you type or only when you ask",
      control: {
        kind: "select",
        options: SHEETS_CALC_MODES,
        value: formula.calculationMode,
        width: "8rem",
      },
      onSelect: (value) => {
        const mode = asString(value);
        if (mode) formula.setCalculationMode(mode);
      },
    },
  );

  if (formula.traceReferences) {
    const trace = formula.traceReferences;
    bindings.push({
      id: "formula.trace",
      label: "Highlight references",
      icon: ScanSearch,
      tab: "Formula",
      group: "Auditing",
      priority: "secondary",
      active: trace.active ?? false,
      hint: "Outlines the ranges the active formula reads from",
      undo: "none(explain)",
      onSelect: () => trace.toggle(),
    });
  }

  bindings.push(
    {
      id: "namedRange.create",
      label: "Name this range",
      icon: Tags,
      tab: "Formula",
      group: "Names",
      priority: "secondary",
      requires: "edit",
      disabled,
      hint: "Gives the selection a name you can use in formulas",
      touches: ["namedRanges"],
      manifestOps: ["create_named_range"],
      onSelect: () => formula.createNamedRange(),
    },
    {
      id: "namedRange.manage",
      label: "Named ranges",
      icon: Layers,
      tab: "Formula",
      group: "Names",
      priority: "advanced",
      disabled,
      hint: formula.namedRangeCount
        ? `${formula.namedRangeCount} names in this workbook`
        : "This workbook has no named ranges yet",
      undo: "none(explain)",
      onSelect: () => formula.manageNames(),
    },
  );

  // §2.8 Charts. Insert is pinned in General; everything that edits the chart
  // you already have lives on the contextual Chart tab, which the studio raises
  // only while a chart is selected.
  const chart = handlers.chart;
  const noChart = chart.hasSelection === false;
  if (chart.type) {
    const type = chart.type;
    bindings.push({
      id: "chart.type",
      label: "Chart type",
      icon: ChartPie,
      contextualTab: "Chart",
      group: "Type",
      priority: "essential",
      requires: "edit",
      disabled: disabled || noChart || undefined,
      hint: noChart ? "Select a chart first" : "How the selected chart plots its data",
      touches: ["charts"],
      control: { kind: "select", options: SHEETS_CHART_TYPES, value: type.value, width: "9rem" },
      manifestOps: ["edit_chart"],
      onSelect: (value) => {
        const next = asString(value);
        if (next) type.set(next);
      },
    });
  }

  bindings.push(
    {
      id: "chart.title",
      label: "Chart title",
      icon: PencilLine,
      contextualTab: "Chart",
      group: "Data",
      priority: "secondary",
      requires: "edit",
      disabled: disabled || noChart || undefined,
      hint: noChart ? "Select a chart first" : "Rename the selected chart",
      touches: ["charts"],
      manifestOps: ["edit_chart"],
      onSelect: () => chart.setTitle(),
    },
    {
      id: "chart.range",
      label: "Chart data range",
      icon: Grid2x2,
      contextualTab: "Chart",
      group: "Data",
      priority: "secondary",
      requires: "edit",
      disabled: disabled || noChart || undefined,
      hint: noChart
        ? "Select a chart first"
        : "Point the chart at a different range; it replots immediately",
      touches: ["charts"],
      manifestOps: ["edit_chart"],
      onSelect: () => chart.setRange(),
    },
  );

  if (chart.toggleLegend) {
    const legend = chart.toggleLegend;
    bindings.push({
      id: "chart.legend",
      label: "Legend",
      icon: Layers,
      contextualTab: "Chart",
      group: "Layout",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || noChart || undefined,
      active: legend.active ?? false,
      hint: noChart ? "Select a chart first" : "Show or hide the series key",
      touches: ["charts"],
      manifestOps: ["edit_chart"],
      onSelect: () => legend.toggle(),
    });
  }

  bindings.push({
    id: "chart.remove",
    label: "Delete chart",
    icon: Trash2,
    contextualTab: "Chart",
    group: "Layout",
    priority: "advanced",
    requires: "edit",
    disabled: disabled || noChart || undefined,
    hint: noChart
      ? "Select a chart first"
      : "Removes the chart from the sheet; the data it read stays",
    touches: ["charts"],
    risk: "destructive",
    manifestOps: ["edit_chart"],
    onSelect: () => chart.remove(),
  });

  if (chart.linkToDeck) {
    const link = chart.linkToDeck;
    bindings.push({
      id: "chart.linkToDeck",
      label: "Send chart to a deck",
      icon: Link2,
      tab: "Insert",
      group: "Chart",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || noChart || undefined,
      hint: noChart
        ? "Select a chart first"
        : "Places a live copy on a slide that follows this range",
      touches: ["charts"],
      manifestOps: ["link_output"],
      onSelect: () => link(),
    });
  }

  if (chart.nativeChartNote) {
    // A native Excel chart part. Spectra shows it and keeps its bytes; saying so
    // in a disabled command is more use than a button that would flatten it.
    bindings.push({
      id: "chart.native",
      label: "Excel chart",
      icon: ChartColumn,
      contextualTab: "Chart",
      group: "Type",
      priority: "secondary",
      disabled: true,
      hint: chart.nativeChartNote,
      undo: "none(explain)",
      onSelect: () => {},
    });
  }

  // §2.5 Sheet lifecycle.
  const sheet = handlers.sheet;
  bindings.push(
    {
      id: "sheet.new",
      label: "New sheet",
      icon: Plus,
      tab: "Insert",
      group: "Sheets",
      priority: "secondary",
      requires: "edit",
      disabled: disabled || sheet.canAdd === false || undefined,
      hint: sheet.addBlockedReason ?? "Adds an empty sheet after this one",
      touches: ["cells"],
      manifestOps: ["create_sheet"],
      ...(sheet.addBlockedReason
        ? { strictNative: { available: false, reason: sheet.addBlockedReason } }
        : {}),
      onSelect: () => sheet.add(),
    },
    {
      id: "sheet.rename",
      label: "Rename sheet",
      icon: PencilLine,
      tab: "Insert",
      group: "Sheets",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Renames the active sheet; formulas that name it follow",
      touches: ["cells"],
      manifestOps: ["rename_sheet"],
      onSelect: () => sheet.rename(),
    },
    {
      id: "sheet.duplicate",
      label: "Duplicate sheet",
      icon: Copy,
      tab: "Insert",
      group: "Sheets",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || sheet.canAdd === false || undefined,
      hint: sheet.addBlockedReason ?? "Copies this sheet, its formats and its formulas",
      touches: ["cells", "formulas"],
      ...(sheet.addBlockedReason
        ? { strictNative: { available: false, reason: sheet.addBlockedReason } }
        : {}),
      manifestOps: ["create_sheet"],
      onSelect: () => sheet.duplicate(),
    },
    {
      id: "sheet.moveLeft",
      label: "Move sheet left",
      icon: ArrowLeft,
      tab: "Insert",
      group: "Sheets",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || sheet.canMoveLeft === false || undefined,
      hint: "Moves this sheet one place earlier in the tab strip",
      touches: ["cells"],
      onSelect: () => sheet.moveLeft(),
    },
    {
      id: "sheet.moveRight",
      label: "Move sheet right",
      icon: ArrowRight,
      tab: "Insert",
      group: "Sheets",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || sheet.canMoveRight === false || undefined,
      hint: "Moves this sheet one place later in the tab strip",
      touches: ["cells"],
      onSelect: () => sheet.moveRight(),
    },
    {
      id: "sheet.hide",
      label: "Hide sheet",
      icon: EyeOff,
      tab: "Insert",
      group: "Sheets",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || sheet.canHide === false || undefined,
      hint: sheet.canHide === false
        ? "A workbook needs one visible sheet"
        : "Hides the tab; formulas that read this sheet keep working",
      touches: ["cells"],
      onSelect: () => sheet.hide(),
    },
    {
      id: "sheet.showHidden",
      label: "Show hidden sheets",
      icon: Eye,
      tab: "Insert",
      group: "Sheets",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || !sheet.hiddenSheetCount || undefined,
      hint: sheet.hiddenSheetCount
        ? `Brings back ${sheet.hiddenSheetCount} hidden sheets`
        : "No sheets are hidden",
      touches: ["cells"],
      onSelect: () => sheet.showHidden(),
    },
    {
      id: "sheet.delete",
      label: "Delete sheet",
      icon: Trash2,
      tab: "Insert",
      group: "Sheets",
      priority: "advanced",
      requires: "edit",
      disabled: disabled || sheet.canRemove === false || undefined,
      hint: sheet.canRemove === false
        ? "A workbook needs at least one sheet"
        : "Deletes this sheet and everything on it",
      touches: ["cells", "formulas"],
      risk: "destructive",
      onSelect: () => sheet.remove(),
    },
  );

  if (sheet.tabColor) {
    const tabColor = sheet.tabColor;
    bindings.push({
      id: "sheet.tabColor",
      label: "Tab colour",
      icon: Palette,
      tab: "Insert",
      group: "Sheets",
      priority: "advanced",
      requires: "edit",
      disabled,
      hint: "Marks this sheet with a colour beside its name",
      control: { kind: "color", value: tabColor.value ?? undefined, clearLabel: "No colour" },
      onSelect: (value) => tabColor.set(asString(value) ?? null),
    });
  }

  // §2.9 Review. Notes are Spectra's own; a linked workbook's comment parts are
  // preserved rather than edited, which is why the note command declares the
  // comments region and lets the shared gate refuse it in a strict-native file.
  const review = handlers.review;
  bindings.push(
    commentsBinding(handlers.comments),
    {
      id: "note.set",
      label: review.hasNote ? "Edit note" : "Add note",
      icon: StickyNote,
      tab: "Review",
      group: "Notes",
      priority: "secondary",
      requires: "edit",
      disabled,
      active: review.noteOpen,
      hint: "A note on the active cell, shown on hover",
      touches: ["comments"],
      onSelect: () => review.setNote(),
    },
    {
      id: "protect.sheet",
      // The label says what the click does, and the toggle stays live while the
      // sheet is protected so the state is reversible from the same control.
      label: protectedSheet ? "Unprotect sheet" : "Protect sheet",
      icon: Lock,
      tab: "Review",
      group: "Protect",
      priority: "advanced",
      requires: "edit",
      disabled: readOnly || undefined,
      active: protectedSheet,
      hint:
        review.protectionNote ??
        "Stops edits to this sheet in Spectra. Excel's own protection settings are kept as they are.",
      strictNative: {
        available: false,
        reason:
          "Spectra keeps this workbook's protection exactly as Excel wrote it, so a Spectra-side lock is not written back into the linked file.",
      },
      onSelect: () => review.protectSheet(),
    },
    {
      id: "review.history",
      label: "Change history",
      icon: History,
      tab: "Review",
      group: "History",
      priority: "advanced",
      hint: "Who changed what, including edits that arrived from Excel",
      undo: "none(explain)",
      onSelect: () => review.openHistory(),
    },
  );

  // §2.6 Pivot tables stay preserved (P4). The command only appears in a
  // workbook that actually has pivot parts, and it appears disabled, because a
  // person who can see a pivot on screen deserves to know why it is read-only.
  if (handlers.data.pivotPreservedNote) {
    bindings.push({
      id: "data.pivot",
      label: "Pivot table",
      icon: Table2,
      tab: "Data",
      group: "Analysis",
      priority: "advanced",
      disabled: true,
      hint: handlers.data.pivotPreservedNote,
      undo: "none(explain)",
      onSelect: () => {},
    });
  }

  // §2.10 Import and export. Both are copies, and the shared family says so in
  // one sentence for all three editors (D25). Import carries the workbook's
  // manifest operation so the assistant and a person reach the same flow.
  bindings.push(...exportBindings(handlers.export));
  bindings.push({ ...importBinding(handlers.import), manifestOps: ["import_data"] });
  bindings.push(printBinding(handlers.print, "workbook"));

  return bindings;
}
