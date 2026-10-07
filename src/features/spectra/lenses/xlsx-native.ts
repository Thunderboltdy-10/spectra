import {
  Workbook,
  parseRangeRef,
  type Worksheet,
} from "@ariadng/office/xlsx";
import {
  parseXml,
  serializeXml,
  XmlElement,
  XmlText,
} from "@ariadng/office/xml";
import type {
  XlsxChartProjection,
  XlsxOperation,
  XlsxSheetProjection,
  XlsxTableProjection,
} from "./projection-contracts";
import { dateToSerial } from "../sheets/excel-serial";
import {
  columnIndex,
  columnName,
} from "../sheets/model";
import {
  quoteSheetPrefix,
  rewriteSheetNameInFormula,
  rewriteStructuralReferences,
} from "../sheets/formula-refs";
import {
  DEFAULT_CHART_COLOR_XML,
  DEFAULT_CHART_STYLE_XML,
} from "./xlsx-chart-assets";
import { excelColor, workbookPalette, type ExcelPalette } from "./xlsx-colors";

export const SML = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const DRAWING_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
export const CHART_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
export const TABLE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table";
export const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
export const CHART_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart";
/** Modern Excel statistical charts (including histograms) are ChartEx parts. */
export const CHART_EX_NS = "http://schemas.microsoft.com/office/drawing/2014/chartex";
export const CHART_EX_REL = "http://schemas.microsoft.com/office/2014/relationships/chartEx";
const CHART_STYLE_REL = "http://schemas.microsoft.com/office/2011/relationships/chartStyle";
const CHART_COLOR_REL = "http://schemas.microsoft.com/office/2011/relationships/chartColorStyle";
const CHART_EX_REQUIRES_NS = "http://schemas.microsoft.com/office/drawing/2015/9/8/chartex";
export const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const CT_DRAWING = "application/vnd.openxmlformats-officedocument.drawing+xml";
export const CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
export const CT_CHART_EX = "application/vnd.ms-office.chartex+xml";
const CT_CHART_STYLE = "application/vnd.ms-office.chartstyle+xml";
const CT_CHART_COLOR = "application/vnd.ms-office.chartcolorstyle+xml";

type NativeRule = Record<string, unknown>;

function descendants(root: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  const stack = [...root.elements()].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    result.push(node);
    for (const child of [...node.elements()].reverse()) stack.push(child);
  }
  return result;
}

function firstDescendant(root: XmlElement, namespace: string | null, localName: string) {
  return descendants(root).find(
    (node) => node.localName === localName && (namespace === null || node.namespaceUri() === namespace),
  );
}

function allDescendants(root: XmlElement, namespace: string | null, localName: string) {
  return descendants(root).filter(
    (node) => node.localName === localName && (namespace === null || node.namespaceUri() === namespace),
  );
}

function child(root: XmlElement | undefined, namespace: string | null, localName: string) {
  return root?.find(namespace, localName);
}

function textOf(node: XmlElement | undefined) {
  return node?.text() ?? "";
}

function setText(node: XmlElement, value: string) {
  for (const child of [...node.children]) node.removeChild(child);
  node.appendChild(new XmlText(value));
}

function boolAttribute(value: string | undefined) {
  return value === "1" || value === "true";
}

function numericAttribute(value: string | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sheetElement(sheet: Worksheet) {
  return sheet._internal().sheetEl;
}

function sheetPart(workbook: Workbook, sheet: Worksheet) {
  return workbook.office.package.getPart(sheet.partName);
}

function rangePart(value: string) {
  const local = value.split("!").at(-1)?.replaceAll("$", "") ?? value;
  try {
    return parseRangeRef(local);
  } catch {
    return null;
  }
}

function rangeFromDimension(ref: string | undefined) {
  const range = ref ? rangePart(ref) : null;
  return range ?? { start: { row: 1, col: 1 }, end: { row: 1, col: 1 } };
}

function fullRange(ref: string) {
  const range = rangePart(ref);
  if (!range) return ref;
  const start = `${columnName(range.start.col - 1)}${range.start.row}`;
  const end = `${columnName(range.end.col - 1)}${range.end.row}`;
  return `${start}:${end}`;
}

function absoluteRange(ref: string, defaultSheet: string) {
  const bang = ref.lastIndexOf("!");
  const rawSheet = bang >= 0 ? ref.slice(0, bang) : defaultSheet;
  const local = bang >= 0 ? ref.slice(bang + 1) : ref;
  const range = rangePart(local);
  if (!range) return ref;
  const prefix = rawSheet ? quoteSheetPrefix(rawSheet.replace(/^'|'$/g, "")) : "";
  const start = `$${columnName(range.start.col - 1)}$${range.start.row}`;
  const end = `$${columnName(range.end.col - 1)}$${range.end.row}`;
  return `${prefix}${start}:${end}`;
}

function refSheetName(ref: string, fallback: string) {
  const bang = ref.lastIndexOf("!");
  if (bang < 0) return fallback;
  return ref.slice(0, bang).replace(/^'|'$/g, "").replaceAll("''", "'");
}

function seriesHeaderReference(formula: string | undefined, defaultSheet: string) {
  if (!formula) return undefined;
  const bang = formula.lastIndexOf("!");
  const local = bang >= 0 ? formula.slice(bang + 1) : formula;
  const range = rangePart(local);
  if (!range) return undefined;
  const sheet = refSheetName(formula, defaultSheet);
  const prefix = quoteSheetPrefix(sheet);
  const headerRow = Math.max(1, range.start.row - 1);
  const headerColumn = columnName(range.start.col - 1);
  return `${prefix}$${headerColumn}$${headerRow}`;
}

function formulaElement(node: XmlElement) {
  return node.localName === "f" && (
    node.namespaceUri() === SML ||
    node.namespaceUri() === CHART_NS ||
    node.namespaceUri() === CHART_EX_NS
  );
}

function mapFormulaElements(root: XmlElement, mapper: (formula: string) => string) {
  let changed = false;
  for (const node of allDescendants(root, null, "f")) {
    if (!formulaElement(node)) continue;
    const before = node.text();
    const after = mapper(before);
    if (before !== after) {
      setText(node, after);
      changed = true;
    }
  }
  return changed;
}

function worksheetRowsAndColumns(root: XmlElement) {
  const rowData = child(root, SML, "sheetData");
  const rows = rowData?.elements().filter((node) => node.namespaceUri() === SML && node.localName === "row") ?? [];
  const hiddenRows: number[] = [];
  const rowHeights: Record<string, number> = {};
  for (const row of rows) {
    const index = Math.max(1, Math.round(numericAttribute(row.getAttribute("r"), 1)));
    if (boolAttribute(row.getAttribute("hidden"))) hiddenRows.push(index - 1);
    if (row.getAttribute("ht") !== undefined) rowHeights[String(index - 1)] = numericAttribute(row.getAttribute("ht"));
  }
  const hiddenColumns: number[] = [];
  const columnWidths: Record<string, number> = {};
  const cols = child(root, SML, "cols");
  for (const col of cols?.elements().filter((node) => node.namespaceUri() === SML && node.localName === "col") ?? []) {
    const min = Math.max(1, Math.round(numericAttribute(col.getAttribute("min"), 1)));
    const max = Math.max(min, Math.round(numericAttribute(col.getAttribute("max"), min)));
    for (let index = min; index <= max; index += 1) {
      if (boolAttribute(col.getAttribute("hidden"))) hiddenColumns.push(index - 1);
      if (col.getAttribute("width") !== undefined) columnWidths[String(index - 1)] = numericAttribute(col.getAttribute("width"));
    }
  }
  return {
    hiddenRows: [...new Set(hiddenRows)].sort((a, b) => a - b),
    hiddenColumns: [...new Set(hiddenColumns)].sort((a, b) => a - b),
    rowHeights,
    columnWidths,
  };
}

function worksheetDimension(root: XmlElement) {
  const dimension = child(root, SML, "dimension");
  const range = rangeFromDimension(dimension?.getAttribute("ref"));
  return { rows: Math.max(1, range.end.row), columns: Math.max(1, range.end.col) };
}

function worksheetView(root: XmlElement) {
  const view = child(child(root, SML, "sheetViews"), SML, "sheetView");
  return {
    showGridlines: view?.getAttribute("showGridLines") === undefined ? undefined : boolAttribute(view.getAttribute("showGridLines")),
    showHeadings: view?.getAttribute("showRowColHeaders") === undefined ? undefined : boolAttribute(view.getAttribute("showRowColHeaders")),
  };
}

function worksheetTabColor(root: XmlElement, palette: ExcelPalette) {
  return excelColor(child(root, SML, "sheetPr")?.find(SML, "tabColor"), palette);
}

function worksheetValidations(root: XmlElement, sheetId: number): NativeRule[] {
  const validations = child(root, SML, "dataValidations");
  return (validations?.elements() ?? [])
    .filter((node) => node.namespaceUri() === SML && node.localName === "dataValidation")
    .map((node, index) => ({
      id: `xlsx:validation:${sheetId}:${index + 1}`,
      ...Object.fromEntries(node.attributes.filter((attr) => !attr.prefix).map((attr) => [attr.localName, attr.value])),
      ...(child(node, SML, "formula1") ? { formula1: textOf(child(node, SML, "formula1")) } : {}),
      ...(child(node, SML, "formula2") ? { formula2: textOf(child(node, SML, "formula2")) } : {}),
    }));
}

/**
 * The differential formats conditional rules point at (`dxfId`), as the fill
 * and text colour each one paints. In a dxf a solid fill keeps its colour in
 * `bgColor`, unlike a cell style.
 */
async function workbookDxfColors(workbook: Workbook, palette: ExcelPalette) {
  const part = workbook.office.package.getPart("/xl/styles.xml");
  if (!part) return [];
  const root = (await workbook.office.xml(part.name)).root;
  return (child(root, SML, "dxfs")?.findAll(SML, "dxf") ?? []).map((dxf) => {
    const pattern = child(child(dxf, SML, "fill"), SML, "patternFill");
    const fillColor = pattern && pattern.getAttribute("patternType") !== "none"
      ? excelColor(child(pattern, SML, "bgColor"), palette) ?? excelColor(child(pattern, SML, "fgColor"), palette)
      : undefined;
    const textColor = excelColor(child(child(dxf, SML, "font"), SML, "color"), palette);
    return { ...(fillColor ? { fillColor } : {}), ...(textColor ? { textColor } : {}) };
  });
}

function scaleStops(scale: XmlElement) {
  return scale.elements().filter((item) => item.localName === "cfvo").map((item) => ({
    type: item.getAttribute("type") ?? "min",
    ...(item.getAttribute("val") !== undefined ? { value: item.getAttribute("val") } : {}),
  }));
}

async function worksheetConditionalFormats(workbook: Workbook, root: XmlElement, sheetId: number): Promise<NativeRule[]> {
  const groups = root.elements().filter((node) => node.namespaceUri() === SML && node.localName === "conditionalFormatting");
  if (!groups.length) return [];
  const palette = await workbookPalette(workbook);
  const dxfs = await workbookDxfColors(workbook, palette);
  return groups.map((node, groupIndex) => ({
    id: `xlsx:conditional-group:${sheetId}:${groupIndex + 1}`,
    sqref: node.getAttribute("sqref") ?? "",
    rules: node.elements().filter((rule) => rule.namespaceUri() === SML && rule.localName === "cfRule").map((rule, ruleIndex) => {
      const scale = child(rule, SML, "colorScale");
      const bar = child(rule, SML, "dataBar");
      // The colours a rule paints, resolved here so every reader sees Excel's
      // colours. The writer never turns these into attributes: a kept rule
      // keeps its own `dxfId`.
      const dxf = dxfs[Number(rule.getAttribute("dxfId"))];
      return {
        id: `xlsx:conditional:${sheetId}:${groupIndex + 1}:${ruleIndex + 1}`,
        ...Object.fromEntries(rule.attributes.filter((attr) => !attr.prefix).map((attr) => [attr.localName, attr.value])),
        formulas: rule.elements().filter((formula) => formula.namespaceUri() === SML && formula.localName === "formula").map((formula) => textOf(formula)),
        ...(rule.getAttribute("dxfId") !== undefined && dxf ? dxf : {}),
        ...(scale ? {
          colorScale: {
            cfvo: scaleStops(scale),
            colors: scale.elements().filter((item) => item.localName === "color").map((item) => excelColor(item, palette) ?? item.getAttribute("rgb") ?? item.getAttribute("theme") ?? ""),
          },
        } : {}),
        ...(bar ? {
          dataBar: {
            cfvo: scaleStops(bar),
            color: excelColor(child(bar, SML, "color"), palette) ?? "#638EC6",
          },
        } : {}),
      };
    }),
  }));
}

function tableFilters(tableRoot: XmlElement) {
  const autoFilter = child(tableRoot, SML, "autoFilter");
  return (autoFilter?.findAll(SML, "filterColumn") ?? []).flatMap((column) => {
    const values = child(child(column, SML, "filters"), SML, "filter")
      ? (child(column, SML, "filters")?.elements() ?? []).filter((node) => node.localName === "filter").map((node) => node.getAttribute("val") ?? "")
      : [];
    return values.length ? [{ column: numericAttribute(column.getAttribute("colId")), allowedValues: values }] : [];
  });
}

async function projectTables(workbook: Workbook, sheet: Worksheet): Promise<XlsxTableProjection[]> {
  const result: XlsxTableProjection[] = [];
  for (const table of await sheet.tables()) {
    const tablePart = workbook.office.package.getPart(table.partName);
    const tableRoot = tablePart ? (await workbook.office.xml(table.partName)).root : undefined;
    const style = tableRoot?.find(SML, "tableStyleInfo")?.getAttribute("name") ?? table.style;
    const sort = tableRoot?.find(SML, "autoFilter")?.find(SML, "sortState");
    result.push({
      id: `xlsx:table:${table.partName}`,
      name: table.name,
      range: table.range,
      columns: [...table.columns],
      headerRow: table.headerRow,
      totalsRow: table.totalsRow,
      style,
      filters: tableRoot ? tableFilters(tableRoot) : [],
      ...(sort?.getAttribute("column") !== undefined
        ? { sort: { column: numericAttribute(sort.getAttribute("column")), direction: sort.getAttribute("descending") === "1" ? "desc" as const : "asc" as const } }
        : {}),
      partName: table.partName,
    });
  }
  return result;
}

function chartText(chartRoot: XmlElement) {
  const modernTitle = firstDescendant(chartRoot, CHART_EX_NS, "title");
  if (modernTitle) return textOf(firstDescendant(modernTitle, CHART_EX_NS, "v"));
  const title = firstDescendant(child(chartRoot, CHART_NS, "title") ?? chartRoot, A_NS, "t");
  return textOf(title);
}

function definedNameReference(workbook: Workbook, value: string | undefined) {
  if (!value) return undefined;
  const name = value.trim().replace(/^=/, "");
  return workbook.definedNames().find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())?.ref;
}

function chartExDataFormula(root: XmlElement, dataId: string) {
  const data = allDescendants(root, CHART_EX_NS, "data").find((candidate) => candidate.getAttribute("id") === dataId);
  return data ? firstDescendant(data, CHART_EX_NS, "f")?.text() : undefined;
}

function chartExSeries(workbook: Workbook, chartRoot: XmlElement) {
  const region = firstDescendant(chartRoot, CHART_EX_NS, "plotAreaRegion");
  const seriesNodes = region?.elements().filter((node) => node.namespaceUri() === CHART_EX_NS && node.localName === "series") ?? [];
  return seriesNodes.map((series) => {
    const dataId = child(series, CHART_EX_NS, "dataId")?.getAttribute("val");
    const formula = dataId === undefined ? undefined : chartExDataFormula(chartRoot, dataId);
    const values = definedNameReference(workbook, formula) ?? formula;
    const binning = firstDescendant(series, CHART_EX_NS, "binning");
    return {
      name: textOf(firstDescendant(series.find(CHART_EX_NS, "tx") ?? series, CHART_EX_NS, "v")) || undefined,
      categories: undefined,
      ...(values ? { values } : {}),
      chartType: "column" as const,
      ...(binning ? { axis: "primary" as const } : {}),
    };
  });
}

function chartReference(parent: XmlElement | undefined, localName: "cat" | "val") {
  const container = parent?.find(CHART_NS, localName);
  const ref = container ? firstDescendant(container, CHART_NS, "numRef") ?? firstDescendant(container, CHART_NS, "strRef") : undefined;
  return ref ? textOf(ref.find(CHART_NS, "f")) : undefined;
}

function chartSeries(chartType: XmlElement, secondaryAxisIds = new Set<string>()) {
  const chartTypeName = chartType.localName === "barChart"
    ? (chartType.find(CHART_NS, "barDir")?.getAttribute("val") === "bar" ? "bar" : "column")
    : chartType.localName === "lineChart"
      ? "line"
      : chartType.localName === "areaChart"
        ? "area"
        : chartType.localName === "scatterChart"
          ? "scatter"
          : undefined;
  const seriesNodes = chartType.elements().filter((node) =>
    node.namespaceUri() === CHART_NS &&
    (node.localName === "ser" || node.localName === "histogramSeries"),
  );
  return seriesNodes.map((series) => ({
    name: textOf(firstDescendant(series.find(CHART_NS, "tx") ?? series, CHART_NS, "v")) || undefined,
    categories: chartReference(series, "cat"),
    values: chartReference(series, "val"),
    ...(chartTypeName ? { chartType: chartTypeName as "column" | "bar" | "line" | "area" | "scatter" } : {}),
    ...(chartType.localName === "histogramChart" ? { chartType: "column" as const } : {}),
    ...(chartType.findAll(CHART_NS, "axId").some((axis) => secondaryAxisIds.has(axis.getAttribute("val") ?? "")) ? { axis: "secondary" as const } : {}),
  }));
}

function chartSourceRange(series: Array<{ categories?: string; values?: string }>, defaultSheet: string) {
  const references = series.flatMap((item) => [item.categories, item.values].filter((value): value is string => Boolean(value)));
  const parsed = references.map((reference) => ({ reference, range: rangePart(reference), sheet: refSheetName(reference, defaultSheet) }));
  if (!parsed.length || parsed.some((item) => !item.range || item.sheet !== parsed[0]!.sheet)) return undefined;
  const ranges = parsed.flatMap((item) => item.range ? [item.range] : []);
  if (!ranges.length) return undefined;
  const startCol = Math.min(...ranges.map((range) => range.start.col));
  const endCol = Math.max(...ranges.map((range) => range.end.col));
  const startRow = Math.max(1, Math.min(...ranges.map((range) => range.start.row)) - (series.every((item) => item.categories) ? 1 : 0));
  const endRow = Math.max(...ranges.map((range) => range.end.row));
  return absoluteRange(`${quoteSheetPrefix(parsed[0]!.sheet)}$${columnName(startCol - 1)}$${startRow}:$${columnName(endCol - 1)}$${endRow}`, defaultSheet);
}

function chartTypeAndElement(chartRoot: XmlElement) {
  if (chartRoot.namespaceUri() === CHART_EX_NS || firstDescendant(chartRoot, CHART_EX_NS, "plotArea")) {
    const region = firstDescendant(chartRoot, CHART_EX_NS, "plotAreaRegion");
    const modernSeries = region?.elements().filter((node) => node.namespaceUri() === CHART_EX_NS && node.localName === "series") ?? [];
    return {
      type: modernSeries.some((series) => firstDescendant(series, CHART_EX_NS, "binning")) ? "histogram" as const : "column" as const,
      element: region,
      chartEx: true as const,
    };
  }
  const plot = child(chartRoot, CHART_NS, "chart")?.find(CHART_NS, "plotArea") ?? firstDescendant(chartRoot, CHART_NS, "plotArea");
  const typeElements = plot?.elements().filter((node) => node.namespaceUri() === CHART_NS && /Chart$/.test(node.localName) && node.localName !== "plotArea") ?? [];
  const typeElement = typeElements[0];
  if (!typeElement) return { type: "line" as const, element: undefined };
  if (typeElements.length > 1) return { type: "combo" as const, element: typeElement, elements: typeElements };
  if (typeElement.localName === "barChart") return { type: typeElement.find(CHART_NS, "barDir")?.getAttribute("val") === "bar" ? "bar" as const : "column" as const, element: typeElement };
  if (typeElement.localName === "areaChart") return { type: "area" as const, element: typeElement };
  if (typeElement.localName === "pieChart") return { type: "pie" as const, element: typeElement };
  if (typeElement.localName === "scatterChart") return { type: "scatter" as const, element: typeElement };
  if (typeElement.localName === "histogramChart") return { type: "histogram" as const, element: typeElement };
  if (typeElement.localName === "lineChart") return { type: "line" as const, element: typeElement };
  return { type: "combo" as const, element: typeElement, elements: typeElements };
}

function anchorPosition(anchor: XmlElement | undefined) {
  if (!anchor) return { x: 0, y: 0, width: 760, height: 320 };
  const from = child(anchor, DRAWING_NS, "from");
  const to = child(anchor, DRAWING_NS, "to");
  const ext = child(anchor, DRAWING_NS, "ext");
  const col = numericAttribute(textOf(child(from, DRAWING_NS, "col")));
  const row = numericAttribute(textOf(child(from, DRAWING_NS, "row")));
  const colOff = numericAttribute(textOf(child(from, DRAWING_NS, "colOff")));
  const rowOff = numericAttribute(textOf(child(from, DRAWING_NS, "rowOff")));
  const toCol = numericAttribute(textOf(child(to, DRAWING_NS, "col")), col + 8);
  const toRow = numericAttribute(textOf(child(to, DRAWING_NS, "row")), row + 16);
  const toColOff = numericAttribute(textOf(child(to, DRAWING_NS, "colOff")));
  const toRowOff = numericAttribute(textOf(child(to, DRAWING_NS, "rowOff")));
  const width = ext ? numericAttribute(ext.getAttribute("cx"), 7_200_000) / 9525 : Math.max(240, (toCol - col) * 64 + (toColOff - colOff) / 9525);
  const height = ext ? numericAttribute(ext.getAttribute("cy"), 3_000_000) / 9525 : Math.max(180, (toRow - row) * 20 + (toRowOff - rowOff) / 9525);
  return {
    x: col * 64 + colOff / 9525,
    y: row * 20 + rowOff / 9525,
    width,
    height,
  };
}

/** One corner of a drawing anchor: a cell and a pixel offset inside it. */
function anchorPoint(point: XmlElement | undefined) {
  if (!point) return undefined;
  return {
    column: Math.max(0, Math.round(numericAttribute(textOf(child(point, DRAWING_NS, "col"))))),
    row: Math.max(0, Math.round(numericAttribute(textOf(child(point, DRAWING_NS, "row"))))),
    x: Math.max(0, numericAttribute(textOf(child(point, DRAWING_NS, "colOff"))) / 9525),
    y: Math.max(0, numericAttribute(textOf(child(point, DRAWING_NS, "rowOff"))) / 9525),
  };
}

/**
 * Where a drawing sits, by cell, the way Excel stores it. `position` flattens
 * this onto a 64×20 grid for the editor; a reader that draws real column
 * widths places the object by its cells instead, so it lands where Excel
 * puts it.
 */
function drawingAnchor(anchor: XmlElement) {
  const from = anchorPoint(child(anchor, DRAWING_NS, "from"));
  if (!from) return undefined;
  const to = anchor.localName === "twoCellAnchor" ? anchorPoint(child(anchor, DRAWING_NS, "to")) : undefined;
  const ext = child(anchor, DRAWING_NS, "ext");
  return {
    from,
    ...(to ? { to } : {}),
    ...(!to && ext ? { width: numericAttribute(ext.getAttribute("cx")) / 9525, height: numericAttribute(ext.getAttribute("cy")) / 9525 } : {}),
  };
}

type WorksheetDrawing = { part: NonNullable<ReturnType<typeof sheetPart>>; anchors: XmlElement[] };

/** The worksheet's drawing part and its cell anchors, or nothing. */
async function worksheetDrawing(workbook: Workbook, sheet: Worksheet, worksheetRoot: XmlElement): Promise<WorksheetDrawing | undefined> {
  const part = sheetPart(workbook, sheet);
  const drawingRef = child(worksheetRoot, SML, "drawing")?.getAttribute("r:id");
  if (!part || !drawingRef) return undefined;
  const drawingPart = workbook.office.package.relatedPart(part, drawingRef);
  if (!drawingPart) return undefined;
  const drawingRoot = (await workbook.office.xml(drawingPart.name)).root;
  return {
    part: drawingPart,
    anchors: drawingRoot.elements().filter((node) => node.namespaceUri() === DRAWING_NS && (node.localName === "twoCellAnchor" || node.localName === "oneCellAnchor")),
  };
}

const PICTURE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp" };

/**
 * Pictures placed on the sheet. Read for showing: the drawing part keeps them
 * in the file, untouched, whatever the editor does.
 */
async function projectPictures(workbook: Workbook, sheet: Worksheet, drawing: WorksheetDrawing) {
  const pictures: NonNullable<XlsxSheetProjection["pictures"]> = [];
  for (const anchor of drawing.anchors) {
    const picture = child(anchor, DRAWING_NS, "pic");
    const embed = picture ? firstDescendant(picture, A_NS, "blip")?.getAttribute("r:embed") : undefined;
    if (!picture || !embed) continue;
    const media = workbook.office.package.relatedPart(drawing.part, embed);
    if (!media) continue;
    const extension = media.name.split(".").at(-1)?.toLowerCase() ?? "";
    const mediaType = media.contentType.toLowerCase() || PICTURE_TYPES[extension] || "";
    const properties = firstDescendant(picture, DRAWING_NS, "cNvPr");
    const placed = drawingAnchor(anchor);
    pictures.push({
      id: `xlsx:picture:${sheet.sheetId}:${pictures.length + 1}`,
      ...(properties?.getAttribute("name") ? { name: properties.getAttribute("name") } : {}),
      ...(properties?.getAttribute("descr") ? { description: properties.getAttribute("descr") } : {}),
      mediaPart: media.name,
      mediaType,
      position: anchorPosition(anchor),
      ...(placed ? { anchor: placed } : {}),
    });
  }
  return pictures;
}

const COMMENTS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const COMMENT_LIMITS = { count: 1000, text: 4000 } as const;

/**
 * The sheet's notes (Excel's legacy comments, which threaded comments also
 * write as a fallback). Read for showing only; the comments part is kept in
 * the file untouched.
 */
async function projectComments(workbook: Workbook, sheet: Worksheet) {
  const part = sheetPart(workbook, sheet);
  const relationship = part?.relationships().byType(COMMENTS_REL)[0];
  const commentsPart = part && relationship ? workbook.office.package.relatedPart(part, relationship.id) : undefined;
  if (!commentsPart) return [];
  const root = (await workbook.office.xml(commentsPart.name)).root;
  const authors = (child(root, SML, "authors")?.findAll(SML, "author") ?? []).map((author) => textOf(author));
  const comments: NonNullable<XlsxSheetProjection["comments"]> = [];
  for (const comment of child(root, SML, "commentList")?.findAll(SML, "comment") ?? []) {
    if (comments.length >= COMMENT_LIMITS.count) break;
    const ref = (comment.getAttribute("ref") ?? "").split(":")[0]!.replaceAll("$", "").toUpperCase();
    if (!/^[A-Z]{1,3}[1-9][0-9]*$/.test(ref)) continue;
    const author = authors[Number(comment.getAttribute("authorId"))];
    // Excel opens each note with its author's name in bold; the name is shown
    // on its own, so the copy in the text goes.
    const written = allDescendants(child(comment, SML, "text") ?? comment, SML, "t").map((node) => node.text()).join("").trim();
    const text = author && written.startsWith(`${author}:`) ? written.slice(author.length + 1).trim() : written;
    if (!text) continue;
    comments.push({
      ref,
      ...(author ? { author } : {}),
      text: text.slice(0, COMMENT_LIMITS.text),
    });
  }
  return comments;
}

async function projectCharts(workbook: Workbook, sheet: Worksheet, known?: WorksheetDrawing | null): Promise<XlsxChartProjection[]> {
  const drawing = known === undefined ? await worksheetDrawing(workbook, sheet, (await workbook.office.xml(sheet.partName)).root) : known;
  if (!drawing) return [];
  const drawingPart = drawing.part;
  const result: XlsxChartProjection[] = [];
  for (const anchor of drawing.anchors) {
    const frame = firstDescendant(anchor, DRAWING_NS, "graphicFrame");
    const chartNode = firstDescendant(frame ?? anchor, CHART_NS, "chart") ?? firstDescendant(frame ?? anchor, CHART_EX_NS, "chart");
    const chartRef = chartNode?.getAttribute("r:id");
    if (!chartRef) continue;
    const chartPart = workbook.office.package.relatedPart(drawingPart, chartRef);
    if (!chartPart) continue;
    const chartRoot = (await workbook.office.xml(chartPart.name)).root;
    const chart = chartTypeAndElement(chartRoot);
    const modern = "chartEx" in chart && chart.chartEx;
    const secondaryAxisIds = new Set(
      allDescendants(chartRoot, CHART_NS, "valAx")
        .slice(1)
        .map((axis) => child(axis, CHART_NS, "axId")?.getAttribute("val") ?? ""),
    );
    const series = modern
      ? chartExSeries(workbook, chartRoot)
      : chart.elements
        ? chart.elements.flatMap((element) => chartSeries(element, secondaryAxisIds))
        : chart.element
          ? chartSeries(chart.element, secondaryAxisIds)
          : [];
    const sourceRange = chartSourceRange(series, sheet.name) ?? series[0]?.values ?? series[0]?.categories ?? `${sheet.name}!A1`;
    const modernChart = modern ? chartRoot : undefined;
    result.push({
      id: `xlsx:chart:${sheet.sheetId}:${chartPart.name}`,
      type: chart.type,
      sourceRange,
      title: chartText(chartRoot),
      ...(modern
        ? (firstDescendant(modernChart!, CHART_EX_NS, "legend") ? {} : { showLegend: false })
        : (child(child(chartRoot, CHART_NS, "chart"), CHART_NS, "legend") ? {} : { showLegend: false })),
      position: anchorPosition(anchor),
      ...(drawingAnchor(anchor) ? { anchor: drawingAnchor(anchor) } : {}),
      ...(series.length ? { series } : {}),
      partName: chartPart.name,
      drawingPartName: drawingPart.name,
      anchorId: chartRef,
    });
  }
  return result;
}

export async function projectXlsxSheet(workbook: Workbook, sheet: Worksheet): Promise<Omit<XlsxSheetProjection, "id" | "name" | "cells" | "merges" | "frozenRows" | "frozenColumns">> {
  const root = (await workbook.office.xml(sheet.partName)).root;
  const dimension = worksheetDimension(root);
  const axis = worksheetRowsAndColumns(root);
  const view = worksheetView(root);
  const freezePane = child(child(root, SML, "sheetViews"), SML, "sheetView")?.find(SML, "pane");
  const freeze = freezePane && ["frozen", "frozenSplit"].includes(freezePane.getAttribute("state") ?? "")
    ? { frozenRows: Math.max(0, Math.round(numericAttribute(freezePane.getAttribute("ySplit")))), frozenColumns: Math.max(0, Math.round(numericAttribute(freezePane.getAttribute("xSplit")))) }
    : { frozenRows: 0, frozenColumns: 0 };
  const tabColor = worksheetTabColor(root, await workbookPalette(workbook));
  const drawing = await worksheetDrawing(workbook, sheet, root);
  const pictures = drawing ? await projectPictures(workbook, sheet, drawing) : [];
  const comments = await projectComments(workbook, sheet);
  return {
    rowCount: Math.max(100, dimension.rows),
    columnCount: Math.max(26, dimension.columns),
    ...axis,
    ...(sheetElement(sheet).getAttribute("state") && sheetElement(sheet).getAttribute("state") !== "visible" ? { hidden: true } : {}),
    ...(view.showGridlines !== undefined ? { showGridlines: view.showGridlines } : {}),
    ...(view.showHeadings !== undefined ? { showHeadings: view.showHeadings } : {}),
    ...(tabColor ? { tabColor } : {}),
    ...freeze,
    tables: await projectTables(workbook, sheet),
    charts: await projectCharts(workbook, sheet, drawing ?? null),
    validations: worksheetValidations(root, sheet.sheetId),
    conditionalFormats: await worksheetConditionalFormats(workbook, root, sheet.sheetId),
    ...(pictures.length ? { pictures } : {}),
    ...(comments.length ? { comments } : {}),
    partName: sheet.partName,
  };
}

export function nativeSheetById(workbook: Workbook, sheetId: string, aliases = new Map<string, number>()) {
  const alias = aliases.get(sheetId);
  const id = alias ?? Number(sheetId.replace(/^xlsx:sheet:/, ""));
  const sheet = workbook.sheets().find((candidate) => candidate.sheetId === id);
  if (!sheet) throw new Error("The target Excel sheet no longer exists.");
  return sheet;
}

function workbookRoot(workbook: Workbook) {
  return workbook._internal().workbook.doc.root;
}

const WORKBOOK_CHILD_ORDER = [
  "fileVersion", "fileSharing", "workbookPr", "workbookProtection", "bookViews", "sheets",
  "functionGroups", "externalReferences", "definedNames", "calcPr", "oleSize",
  "customWorkbookViews", "pivotCaches", "smartTagPr", "smartTags", "webPublishing",
  "fileRecoveryPr", "extLst",
];

function insertWorkbookChild(root: XmlElement, node: XmlElement) {
  const wanted = WORKBOOK_CHILD_ORDER.indexOf(node.localName);
  const reference = root.elements().find((candidate) => {
    const index = WORKBOOK_CHILD_ORDER.indexOf(candidate.localName);
    return index >= 0 && wanted >= 0 && index > wanted;
  });
  root.insertBefore(node, reference ?? null);
}

function workbookSheetsElement(workbook: Workbook) {
  const sheets = workbookRoot(workbook).find(SML, "sheets");
  if (!sheets) throw new Error("The Excel workbook has no worksheet list.");
  return sheets;
}

function nativeSheetKey(sheet: Worksheet) {
  return `xlsx:sheet:${sheet.sheetId}`;
}

function reorderNativeSheets(workbook: Workbook, order: string[], aliases: Map<string, number>) {
  const sheetsParent = workbookSheetsElement(workbook);
  const native = workbook.sheets();
  const byId = new Map(native.map((sheet) => [nativeSheetKey(sheet), sheetElement(sheet)]));
  const resolved = order.map((id) => {
    const alias = aliases.get(id);
    return byId.get(alias === undefined ? id : `xlsx:sheet:${alias}`);
  }).filter((node): node is XmlElement => Boolean(node));
  const seen = new Set(resolved);
  for (const sheet of native) {
    const node = sheetElement(sheet);
    if (!seen.has(node)) resolved.push(node);
  }
  for (const node of sheetsParent.elements().filter((candidate) => candidate.localName === "sheet"))
    sheetsParent.removeChild(node);
  for (const node of resolved) sheetsParent.appendChild(node);
  workbook._internal().markDirty(workbook._internal().workbook);
}

function formulaReferencesSheet(formula: string, sheetName: string) {
  const escaped = sheetName.replaceAll("'", "''").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_])(?:'${escaped}'|${escaped})!`, "i").test(formula);
}

async function hasNativeReferencesToSheet(workbook: Workbook, sheetName: string) {
  const roots: XmlElement[] = workbook.sheets().map((sheet) => sheet._internal().pd.doc.root);
  roots.push(workbookRoot(workbook));
  for (const part of workbook.office.package.parts().filter((candidate) => /\/(?:charts|tables)\/.*\.xml$/i.test(candidate.name)))
    roots.push((await workbook.office.xml(part.name)).root);
  const definedNames = workbookRoot(workbook).find(SML, "definedNames")?.elements() ?? [];
  return roots.some((root) => allDescendants(root, null, "f").some((node) => formulaReferencesSheet(textOf(node), sheetName)))
    || definedNames.some((node) => node.localName === "definedName" && formulaReferencesSheet(textOf(node), sheetName))
    || roots.some((root) => allDescendants(root, null, "formula1").some((node) => formulaReferencesSheet(textOf(node), sheetName)));
}

async function rewriteWorkbookFormulas(workbook: Workbook, mapper: (formula: string, containingSheetName?: string) => string) {
  let changed = false;
  for (const sheet of workbook.sheets()) {
    const root = sheet._internal().pd.doc.root;
    if (mapFormulaElements(root, (formula) => mapper(formula, sheet.name))) {
      workbook.office.markDirty(sheet.partName);
      changed = true;
    }
  }
  const root = workbookRoot(workbook);
  const names = root.find(SML, "definedNames");
  if (names) {
    for (const name of names.elements().filter((node) => node.namespaceUri() === SML && node.localName === "definedName")) {
      const before = name.text();
      const after = mapper(before);
      if (before !== after) {
        setText(name, after);
        changed = true;
      }
    }
    if (changed) workbook.office.markDirty(workbook.office.mainPart.name);
  }
  for (const part of workbook.office.package.parts().filter((candidate) => /\/charts\/.*\.xml$/i.test(candidate.name))) {
    const document = await workbook.office.xml(part.name);
    if (mapFormulaElements(document.root, (formula) => mapper(formula))) {
      workbook.office.markDirty(part.name);
      changed = true;
    }
  }
  return changed;
}

async function rewriteNativeRanges(workbook: Workbook, sheet: Worksheet, axis: "row" | "column", at: number, delta: 1 | -1) {
  const rewrite = (value: string) => rewriteStructuralReferences(`=${value}`, axis, at, delta, { sheetName: sheet.name, unqualified: true }).replace(/^=/, "");
  const document = await workbook.office.xml(sheet.partName);
  const root = document.root;
  let changed = false;
  for (const merge of allDescendants(root, SML, "mergeCell")) {
    const ref = merge.getAttribute("ref");
    if (ref) { const next = rewrite(ref); if (next !== ref) { merge.setAttribute("ref", next); changed = true; } }
  }
  for (const node of allDescendants(root, SML, "conditionalFormatting")) {
    const ref = node.getAttribute("sqref");
    if (ref) { const next = ref.split(/\s+/).map(rewrite).join(" "); if (next !== ref) { node.setAttribute("sqref", next); changed = true; } }
  }
  for (const node of allDescendants(root, SML, "dataValidation")) {
    const ref = node.getAttribute("sqref");
    if (ref) { const next = ref.split(/\s+/).map(rewrite).join(" "); if (next !== ref) { node.setAttribute("sqref", next); changed = true; } }
  }
  if (changed) workbook.office.markDirty(sheet.partName);
  for (const table of await projectTables(workbook, sheet)) {
    if (!table.partName) continue;
    const tableDocument = await workbook.office.xml(table.partName);
    const tableRoot = tableDocument.root;
    let tableChanged = false;
    for (const node of [tableRoot, child(tableRoot, SML, "autoFilter")].filter((node): node is XmlElement => Boolean(node))) {
      const ref = node.getAttribute("ref");
      if (!ref) continue;
      const next = rewrite(ref);
      if (next !== ref) { node.setAttribute("ref", next); tableChanged = true; }
    }
    if (tableChanged) workbook.office.markDirty(table.partName);
  }
}

function directRows(root: XmlElement) {
  return child(root, SML, "sheetData")?.elements().filter((node) => node.namespaceUri() === SML && node.localName === "row") ?? [];
}

function directCells(row: XmlElement) {
  return row.elements().filter((node) => node.namespaceUri() === SML && node.localName === "c");
}

function rowNumber(row: XmlElement) { return Math.max(1, Math.round(numericAttribute(row.getAttribute("r"), 1))); }

function cellRefParts(ref: string) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]*)$/i.exec(ref);
  if (!match) return null;
  return { col: columnIndex(match[1]!.toUpperCase()) + 1, row: Number(match[2]) };
}

function shiftNativeSheetCells(workbook: Workbook, sheet: Worksheet, axis: "row" | "column", at: number, delta: 1 | -1) {
  const root = sheet._internal().pd.doc.root;
  const data = child(root, SML, "sheetData");
  if (!data) return;
  const target = at + 1;
  for (const row of [...directRows(root)]) {
    const currentRow = rowNumber(row);
    if (axis === "row") {
      if (delta === -1 && currentRow === target) { data.removeChild(row); continue; }
      if (currentRow >= target) row.setAttribute("r", String(currentRow + delta));
    }
    for (const cell of [...directCells(row)]) {
      const ref = cellRefParts(cell.getAttribute("r") ?? "");
      if (!ref) continue;
      if (axis === "column") {
        if (delta === -1 && ref.col === target) { row.removeChild(cell); continue; }
        if (ref.col >= target) ref.col += delta;
      }
      if (axis === "row") {
        const effectiveRow = currentRow >= target ? currentRow + delta : currentRow;
        ref.row = effectiveRow;
      }
      cell.setAttribute("r", `${columnName(ref.col - 1)}${ref.row}`);
    }
  }
  if (axis === "column") {
    const cols = child(root, SML, "cols");
    for (const col of [...(cols?.elements().filter((node) => node.localName === "col") ?? [])]) {
      let min = Math.max(1, Math.round(numericAttribute(col.getAttribute("min"), 1)));
      let max = Math.max(min, Math.round(numericAttribute(col.getAttribute("max"), min)));
      const target = at + 1;
      if (delta === 1) {
        if (min >= target) { min += 1; max += 1; }
        else if (max >= target) max += 1;
      } else if (max < target) {
        // The span is entirely before the removed column.
      } else if (min > target) { min -= 1; max -= 1; }
      else if (min === max) { cols?.removeChild(col); continue; }
      else if (min === target) min += 1;
      else max -= 1;
      col.setAttribute("min", String(min)); col.setAttribute("max", String(max));
    }
    if (cols && !cols.elements().length) root.removeChild(cols);
  }
  workbook.office.markDirty(sheet.partName);
}

function setWorksheetRange(root: XmlElement, ref: string) {
  let dimension = child(root, SML, "dimension");
  if (!dimension) {
    dimension = new XmlElement("dimension", root.lookupPrefix(SML) ?? null);
    root.insertBefore(dimension, root.elements()[0] ?? null);
  }
  dimension.setAttribute("ref", fullRange(ref));
}

function setHiddenRows(root: XmlElement, hiddenRows: number[]) {
  const wanted = new Set(hiddenRows.map((row) => Math.max(0, Math.round(row)) + 1));
  const data = child(root, SML, "sheetData");
  if (!data) return;
  const existing = new Set<number>();
  for (const row of directRows(root)) {
    const index = rowNumber(row);
    existing.add(index);
    if (wanted.has(index)) row.setAttribute("hidden", "1"); else row.removeAttribute("hidden");
  }
  for (const index of wanted) {
    if (existing.has(index)) continue;
    const row = new XmlElement("row", data.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null);
    row.setAttribute("r", String(index)); row.setAttribute("hidden", "1"); data.appendChild(row);
  }
  const rows = directRows(root).sort((left, right) => rowNumber(left) - rowNumber(right));
  for (const row of rows) { data.removeChild(row); data.appendChild(row); }
}

function setHiddenColumns(root: XmlElement, hiddenColumns: number[], widths: Record<string, number>) {
  const wanted = new Set(hiddenColumns.map((column) => Math.max(0, Math.round(column)) + 1));
  const values = new Map<number, { width?: number; hidden: boolean; template?: XmlElement }>();
  const existingCols = child(root, SML, "cols")?.elements().filter((node) => node.localName === "col") ?? [];
  for (const old of existingCols) {
    const min = Math.max(1, Math.round(numericAttribute(old.getAttribute("min"), 1)));
    const max = Math.max(min, Math.round(numericAttribute(old.getAttribute("max"), min)));
    for (let index = min; index <= max; index += 1)
      values.set(index, {
        ...(old.getAttribute("width") !== undefined ? { width: numericAttribute(old.getAttribute("width")) } : {}),
        hidden: boolAttribute(old.getAttribute("hidden")),
        template: old,
      });
  }
  for (const [key, width] of Object.entries(widths)) {
    const index = Number(key) + 1;
    if (Number.isInteger(index) && index > 0) values.set(index, { ...values.get(index), width, hidden: wanted.has(index) || values.get(index)?.hidden === true });
  }
  for (const index of wanted) values.set(index, { ...values.get(index), hidden: true });
  let cols = child(root, SML, "cols");
  if (!cols && values.size) {
    cols = new XmlElement("cols", root.lookupPrefix(SML) ?? null);
    const reference = root.elements().find((node) => ["sheetData", "sheetCalcPr", "sheetProtection"].includes(node.localName));
    root.insertBefore(cols, reference ?? null);
  }
  if (!cols) return;
  for (const old of [...cols.elements()].filter((node) => node.localName === "col")) cols.removeChild(old);
  for (const [index, value] of [...values.entries()].sort((a, b) => a[0] - b[0])) {
    const col = value.template?.clone() ?? new XmlElement("col", cols.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null);
    for (const attribute of [...col.attributes]) {
      if (["min", "max", "width", "hidden", "customWidth"].includes(attribute.localName)) col.removeAttribute(attribute.localName);
    }
    col.setAttribute("min", String(index)); col.setAttribute("max", String(index));
    if (value.width !== undefined) col.setAttribute("width", String(value.width));
    if (value.hidden) col.setAttribute("hidden", "1");
    if (value.width !== undefined) col.setAttribute("customWidth", "1");
    cols.appendChild(col);
  }
  if (!cols.elements().length) root.removeChild(cols);
}

export async function setXlsxSheetProperties(workbook: Workbook, sheet: Worksheet, properties: Record<string, unknown>) {
  const root = (await workbook.office.xml(sheet.partName)).root;
  const sheetMeta = sheetElement(sheet);
  if (typeof properties.hidden === "boolean") {
    if (properties.hidden) sheetMeta.setAttribute("state", "hidden"); else sheetMeta.removeAttribute("state");
  }
  const view = child(child(root, SML, "sheetViews"), SML, "sheetView");
  if (typeof properties.showGridlines === "boolean" || typeof properties.showHeadings === "boolean") {
    const views = child(root, SML, "sheetViews") ?? (() => {
      const created = new XmlElement("sheetViews", root.lookupPrefix(SML) ?? null);
      root.insertBefore(created, root.elements().find((node) => node.localName === "sheetFormatPr") ?? null);
      return created;
    })();
    const current = view ?? (() => { const created = new XmlElement("sheetView", views.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null); created.setAttribute("workbookViewId", "0"); views.appendChild(created); return created; })();
    if (typeof properties.showGridlines === "boolean") current.setAttribute("showGridLines", properties.showGridlines ? "1" : "0");
    if (typeof properties.showHeadings === "boolean") current.setAttribute("showRowColHeaders", properties.showHeadings ? "1" : "0");
  }
  if (typeof properties.tabColor === "string" || properties.tabColor === null) {
    let sheetPr = child(root, SML, "sheetPr");
    if (!sheetPr) { sheetPr = new XmlElement("sheetPr", root.lookupPrefix(SML) ?? null); root.insertBefore(sheetPr, root.elements()[0] ?? null); }
    const current = child(sheetPr, SML, "tabColor");
    if (properties.tabColor === null || properties.tabColor === "") { if (current) sheetPr.removeChild(current); }
    else { const color = current ?? new XmlElement("tabColor", sheetPr.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null); color.setAttribute("rgb", String(properties.tabColor).replace(/^#/, "FF")); if (!current) sheetPr.appendChild(color); }
  }
  if (Array.isArray(properties.hiddenRows)) setHiddenRows(root, properties.hiddenRows.filter((value): value is number => typeof value === "number"));
  if (Array.isArray(properties.hiddenColumns)) setHiddenColumns(root, properties.hiddenColumns.filter((value): value is number => typeof value === "number"), typeof properties.columnWidths === "object" && properties.columnWidths ? properties.columnWidths as Record<string, number> : {});
  if (properties.columnWidths && typeof properties.columnWidths === "object") setHiddenColumns(root, Array.isArray(properties.hiddenColumns) ? properties.hiddenColumns.filter((value): value is number => typeof value === "number") : [], properties.columnWidths as Record<string, number>);
  if (properties.rowHeights && typeof properties.rowHeights === "object") {
    const heights = properties.rowHeights as Record<string, unknown>;
    for (const row of directRows(root)) {
      const key = String(rowNumber(row) - 1);
      const height = heights[key];
      if (typeof height === "number") { row.setAttribute("ht", String(height)); row.setAttribute("customHeight", "1"); }
      else if (!Object.prototype.hasOwnProperty.call(heights, key)) { row.removeAttribute("ht"); row.removeAttribute("customHeight"); }
    }
    for (const [key, height] of Object.entries(heights)) {
      const row = sheet._internal().findRow(Number(key) + 1);
      if (row && typeof height === "number") { row.setAttribute("ht", String(height)); row.setAttribute("customHeight", "1"); }
    }
  }
  if (typeof properties.rowCount === "number" || typeof properties.columnCount === "number") {
    const current = worksheetDimension(root);
    const rows = typeof properties.rowCount === "number" ? Math.max(1, Math.round(properties.rowCount)) : current.rows;
    const columns = typeof properties.columnCount === "number" ? Math.max(1, Math.round(properties.columnCount)) : current.columns;
    setWorksheetRange(root, `A1:${columnName(columns - 1)}${rows}`);
  }
  workbook.office.markDirty(sheet.partName);
}

function chartTitleXml(title: string) {
  const document = parseXml(`<c:title xmlns:c="${CHART_NS}" xmlns:a="${A_NS}"><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t/></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>`);
  const text = firstDescendant(document.root, A_NS, "t");
  if (text) setText(text, title);
  return document.root;
}

function chartCacheXml(kind: "numCache" | "strCache", values: Array<string | number>) {
  const cache = new XmlElement(kind, "c");
  if (kind === "numCache") { const formatCode = new XmlElement("formatCode", "c"); formatCode.appendChild(new XmlText("General")); cache.appendChild(formatCode); }
  const count = new XmlElement("ptCount", "c"); count.setAttribute("val", String(values.length)); cache.appendChild(count);
  values.forEach((value, index) => {
    const point = new XmlElement("pt", "c"); point.setAttribute("idx", String(index));
    const valueElement = new XmlElement("v", "c"); valueElement.appendChild(new XmlText(String(value))); point.appendChild(valueElement); cache.appendChild(point);
  });
  return cache;
}

function cacheValues(workbook: Workbook, formula: string, defaultSheet: string) {
  const sheetName = refSheetName(formula, defaultSheet);
  const sheet = workbook.sheet(sheetName);
  if (!sheet) return null;
  const local = formula.slice(formula.lastIndexOf("!") + 1);
  const range = rangePart(local);
  if (!range) return null;
  const result: Array<string | number> = [];
  let kind: "numCache" | "strCache" = "numCache";
  for (let row = range.start.row; row <= range.end.row; row += 1) for (let col = range.start.col; col <= range.end.col; col += 1) {
    const value = sheet.getCell({ row, col });
    if (value instanceof Date) result.push(dateToSerial(value, workbook._date1904()));
    else if (typeof value === "number") result.push(value);
    else if (typeof value === "boolean") result.push(value ? 1 : 0);
    else { result.push(value ?? ""); kind = "strCache"; }
  }
  return { values: result, kind };
}

function removeCache(ref: XmlElement) {
  for (const node of [...ref.elements()].filter((candidate) => candidate.localName === "numCache" || candidate.localName === "strCache")) ref.removeChild(node);
}

function setChartRef(workbook: Workbook, container: XmlElement, formula: string | undefined, defaultSheet: string, preferStrings = false) {
  if (!formula) return;
  const existing = firstDescendant(container, CHART_NS, "numRef") ?? firstDescendant(container, CHART_NS, "strRef");
  let ref = existing;
  if (!ref) { ref = new XmlElement(preferStrings ? "strRef" : "numRef", "c"); container.appendChild(ref); }
  const f = child(ref, CHART_NS, "f") ?? (() => { const created = new XmlElement("f", "c"); ref!.insertBefore(created, ref!.elements()[0] ?? null); return created; })();
  // A cache refresh must preserve the existing source reference. Rewriting
  // an unchanged formula can alter its spelling and fail native readback.
  if (f.text() !== formula) setText(f, absoluteRange(formula, defaultSheet));
  removeCache(ref);
  const cache = cacheValues(workbook, formula, defaultSheet);
  if (cache) ref.appendChild(chartCacheXml(cache.kind, cache.values));
}

const PRIMARY_CATEGORY_AXIS_ID = "100000001";
const PRIMARY_VALUE_AXIS_ID = "100000002";
const SECONDARY_VALUE_AXIS_ID = "100000004";

function chartAxisId(value: string) {
  const node = new XmlElement("axId", "c");
  node.setAttribute("val", value);
  return node;
}

function standardCategoryAxis(axisId: string, crossAxisId: string) {
  const axis = new XmlElement("catAx", "c");
  axis.appendChild(chartAxisId(axisId));
  const scaling = new XmlElement("scaling", "c");
  const orientation = new XmlElement("orientation", "c");
  orientation.setAttribute("val", "minMax");
  scaling.appendChild(orientation);
  axis.appendChild(scaling);
  const deleted = new XmlElement("delete", "c");
  deleted.setAttribute("val", "0");
  axis.appendChild(deleted);
  const position = new XmlElement("axPos", "c");
  position.setAttribute("val", "b");
  axis.appendChild(position);
  const tickLabels = new XmlElement("tickLblPos", "c");
  tickLabels.setAttribute("val", "nextTo");
  axis.appendChild(tickLabels);
  const cross = new XmlElement("crossAx", "c");
  cross.setAttribute("val", crossAxisId);
  axis.appendChild(cross);
  const crosses = new XmlElement("crosses", "c");
  crosses.setAttribute("val", "autoZero");
  axis.appendChild(crosses);
  return axis;
}

function standardValueAxis(axisId: string, crossAxisId: string, position = "l") {
  const axis = new XmlElement("valAx", "c");
  axis.appendChild(chartAxisId(axisId));
  const scaling = new XmlElement("scaling", "c");
  const orientation = new XmlElement("orientation", "c");
  orientation.setAttribute("val", "minMax");
  scaling.appendChild(orientation);
  axis.appendChild(scaling);
  const deleted = new XmlElement("delete", "c");
  deleted.setAttribute("val", "0");
  axis.appendChild(deleted);
  const positionNode = new XmlElement("axPos", "c");
  positionNode.setAttribute("val", position);
  axis.appendChild(positionNode);
  const tickLabels = new XmlElement("tickLblPos", "c");
  tickLabels.setAttribute("val", "nextTo");
  axis.appendChild(tickLabels);
  const cross = new XmlElement("crossAx", "c");
  cross.setAttribute("val", crossAxisId);
  axis.appendChild(cross);
  const crosses = new XmlElement("crosses", "c");
  crosses.setAttribute("val", "autoZero");
  axis.appendChild(crosses);
  const crossBetween = new XmlElement("crossBetween", "c");
  crossBetween.setAttribute("val", "midCat");
  axis.appendChild(crossBetween);
  return axis;
}

type StandardChartPlotOptions = {
  categoryAxisId?: string;
  valueAxisId?: string;
  includeAxes?: boolean;
  includeCategoryAxis?: boolean;
  includeValueAxis?: boolean;
};

function makeChartPlot(
  type: Exclude<XlsxChartProjection["type"], "histogram">,
  seriesXml: XmlElement[],
  options: StandardChartPlotOptions = {},
) {
  const document = parseXml(`<c:plot xmlns:c="${CHART_NS}" xmlns:a="${A_NS}"/>`);
  const plot = document.root;
  const elementName = type === "column" || type === "bar" ? "barChart" : type === "area" ? "areaChart" : type === "pie" ? "pieChart" : type === "scatter" ? "scatterChart" : "lineChart";
  const chart = new XmlElement(elementName, "c");
  const categoryAxisId = options.categoryAxisId ?? PRIMARY_CATEGORY_AXIS_ID;
  const valueAxisId = options.valueAxisId ?? PRIMARY_VALUE_AXIS_ID;
  if (elementName === "barChart") {
    const barDir = new XmlElement("barDir", "c");
    barDir.setAttribute("val", type === "bar" ? "bar" : "col");
    chart.appendChild(barDir);
    const grouping = new XmlElement("grouping", "c");
    grouping.setAttribute("val", "clustered");
    chart.appendChild(grouping);
  }
  if (elementName === "areaChart" || elementName === "lineChart") {
    const grouping = new XmlElement("grouping", "c");
    grouping.setAttribute("val", "standard");
    chart.appendChild(grouping);
  }
  for (const series of seriesXml) chart.appendChild(series);
  if (elementName === "barChart") {
    const gapWidth = new XmlElement("gapWidth", "c");
    gapWidth.setAttribute("val", "150");
    chart.appendChild(gapWidth);
  }
  if (elementName === "barChart" || elementName === "areaChart" || elementName === "lineChart") {
    chart.appendChild(chartAxisId(categoryAxisId));
    chart.appendChild(chartAxisId(valueAxisId));
  }
  plot.appendChild(chart);
  if ((elementName === "barChart" || elementName === "areaChart" || elementName === "lineChart") && options.includeAxes !== false) {
    if (options.includeCategoryAxis !== false) plot.appendChild(standardCategoryAxis(categoryAxisId, valueAxisId));
    if (options.includeValueAxis !== false) plot.appendChild(standardValueAxis(valueAxisId, categoryAxisId));
  }
  return plot;
}

function chartSeriesForSource(workbook: Workbook, chart: XlsxChartProjection, defaultSheet: string): NonNullable<XlsxChartProjection["series"]> {
  if (chart.series?.length) return chart.series;
  const bang = chart.sourceRange.lastIndexOf("!");
  const sourceSheet = refSheetName(chart.sourceRange, defaultSheet);
  const local = bang >= 0 ? chart.sourceRange.slice(bang + 1) : chart.sourceRange;
  const range = rangePart(local);
  if (!range || range.start.col >= range.end.col || range.start.row >= range.end.row)
    return [{ values: chart.sourceRange }];
  const prefix = quoteSheetPrefix(sourceSheet);
  const categoryStart = range.start.row + 1;
  const categoryRange = `${prefix}$${columnName(range.start.col - 1)}$${categoryStart}:$${columnName(range.start.col - 1)}$${range.end.row}`;
  const source = workbook.sheet(sourceSheet);
  return Array.from({ length: range.end.col - range.start.col }, (_, index) => {
    const column = range.start.col + index + 1;
    const header = source?.getCell({ row: range.start.row, col: column });
    return {
      ...(typeof header === "string" && header ? { name: header } : {}),
      categories: categoryRange,
      values: `${prefix}$${columnName(column - 1)}$${categoryStart}:$${columnName(column - 1)}$${range.end.row}`,
    };
  });
}

type IndexedChartSeries = NonNullable<XlsxChartProjection["series"]>[number] & { nativeIndex?: number };

function newChartSeries(
  workbook: Workbook,
  chart: XlsxChartProjection,
  defaultSheet: string,
  sourceOverride?: IndexedChartSeries[],
) {
  const source = sourceOverride ?? chartSeriesForSource(workbook, chart, defaultSheet);
  return source.map((series, index) => {
    const document = parseXml(`<c:ser xmlns:c="${CHART_NS}" xmlns:a="${A_NS}"/>`);
    const ser = document.root;
    const nativeIndex = (series as IndexedChartSeries).nativeIndex ?? index;
    const idx = new XmlElement("idx", "c"); idx.setAttribute("val", String(nativeIndex)); ser.appendChild(idx);
    const order = new XmlElement("order", "c"); order.setAttribute("val", String(nativeIndex)); ser.appendChild(order);
    const tx = new XmlElement("tx", "c");
    const headerReference = seriesHeaderReference(series.values ?? chart.sourceRange, defaultSheet);
    const headerCache = headerReference ? cacheValues(workbook, headerReference, defaultSheet) : null;
    const canUseHeaderReference = Boolean(
      headerReference &&
      headerCache?.values.length &&
      (!series.name || String(headerCache.values[0]) === series.name),
    );
    if (canUseHeaderReference) setChartRef(workbook, tx, headerReference, defaultSheet, true);
    else {
      const v = new XmlElement("v", "c");
      v.appendChild(new XmlText(series.name ?? `Series ${nativeIndex + 1}`));
      tx.appendChild(v);
    }
    ser.appendChild(tx);
    if (series.categories) { const cat = new XmlElement("cat", "c"); setChartRef(workbook, cat, series.categories, defaultSheet, true); ser.appendChild(cat); }
    if (series.values || chart.sourceRange) { const val = new XmlElement("val", "c"); setChartRef(workbook, val, series.values ?? chart.sourceRange, defaultSheet); ser.appendChild(val); }
    return ser;
  });
}

function nextChartExNamePair(workbook: Workbook) {
  const used = new Set(workbook.definedNames().map((candidate) => candidate.name.toLowerCase()));
  for (let index = 0; ; index += 2) {
    const header = `_xlchart.v1.${index}`;
    const values = `_xlchart.v1.${index + 1}`;
    if (!used.has(header.toLowerCase()) && !used.has(values.toLowerCase())) return { header, values };
  }
}

function ensureHiddenDefinedName(workbook: Workbook, name: string, reference: string) {
  const root = workbookRoot(workbook);
  let names = root.find(SML, "definedNames");
  if (!names) {
    names = new XmlElement("definedNames", root.lookupPrefix(SML) ?? null);
    insertWorkbookChild(root, names);
  }
  let node = names.elements().find((candidate) => candidate.localName === "definedName" && candidate.getAttribute("name")?.toLowerCase() === name.toLowerCase());
  if (!node) {
    node = new XmlElement("definedName", names.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null);
    node.setAttribute("name", name);
    names.appendChild(node);
  }
  node.setAttribute("hidden", "1");
  setText(node, reference.replace(/^=/, ""));
  workbook._internal().markDirty(workbook._internal().workbook);
}

function firstCellReference(formula: string, defaultSheet: string) {
  const sourceSheet = refSheetName(formula, defaultSheet);
  const local = formula.slice(formula.lastIndexOf("!") + 1);
  const range = rangePart(local);
  if (!range) return formula;
  return `${quoteSheetPrefix(sourceSheet)}$${columnName(range.start.col - 1)}$${range.start.row}`;
}

function chartExTitleXml(title: string) {
  const document = parseXml(`<cx:title xmlns:cx="${CHART_EX_NS}" pos="t" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v/></cx:txData></cx:tx></cx:title>`);
  const text = firstDescendant(document.root, CHART_EX_NS, "v");
  if (text) setText(text, title);
  return document.root;
}

function xmlText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function chartExUniqueId(chart: XlsxChartProjection, index: number) {
  let hash = 2166136261;
  for (const character of `${chart.id}:${chart.sourceRange}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const seed = ((hash >>> 0) || 1).toString(16).padStart(8, "0").toUpperCase().repeat(3);
  return `{${index.toString(16).padStart(8, "0")}-${seed.slice(0, 4)}-4${seed.slice(4, 7)}-8${seed.slice(7, 10)}-${seed.slice(10, 22)}}`;
}

function chartExLegendXml() {
  return parseXml(`<cx:legend xmlns:cx="${CHART_EX_NS}" pos="r" align="ctr" overlay="0"/>`).root;
}

function chartExHistogramDocument(
  workbook: Workbook,
  chart: XlsxChartProjection,
  defaultSheet: string,
) {
  const source = chartSeriesForSource(workbook, chart, defaultSheet)[0] ?? { values: chart.sourceRange };
  const valuesReference = source.values ?? chart.sourceRange;
  const names = nextChartExNamePair(workbook);
  const headerReference = seriesHeaderReference(valuesReference, defaultSheet) ?? firstCellReference(valuesReference, defaultSheet);
  ensureHiddenDefinedName(workbook, names.header, headerReference);
  ensureHiddenDefinedName(workbook, names.values, absoluteRange(valuesReference, defaultSheet));
  const seriesName = source.name ?? "Values";
  const document = parseXml(`<cx:chartSpace xmlns:cx="${CHART_EX_NS}" xmlns:a="${A_NS}" xmlns:r="${REL}"><cx:chartData><cx:data id="0"><cx:numDim type="val"><cx:f>${xmlText(names.values)}</cx:f></cx:numDim></cx:data><cx:data id="1"><cx:numDim type="val"><cx:f>${xmlText(names.values)}</cx:f></cx:numDim></cx:data></cx:chartData><cx:chart><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="clusteredColumn" uniqueId="${chartExUniqueId(chart, 0)}" formatIdx="0"><cx:tx><cx:txData><cx:f>${xmlText(names.header)}</cx:f><cx:v>${xmlText(seriesName)}</cx:v></cx:txData></cx:tx><cx:dataId val="0"/><cx:layoutPr><cx:binning intervalClosed="r"/></cx:layoutPr></cx:series><cx:series layoutId="clusteredColumn" hidden="1" uniqueId="${chartExUniqueId(chart, 1)}" formatIdx="1"><cx:tx><cx:txData><cx:v>${xmlText(seriesName)}</cx:v></cx:txData></cx:tx><cx:dataId val="1"/><cx:layoutPr><cx:binning intervalClosed="r"/></cx:layoutPr></cx:series></cx:plotAreaRegion><cx:axis id="0"><cx:catScaling gapWidth="0"/><cx:tickLabels/></cx:axis><cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis></cx:plotArea></cx:chart></cx:chartSpace>`);
  if (chart.title) {
    const chartNode = child(document.root, CHART_EX_NS, "chart");
    if (chartNode) chartNode.insertBefore(chartExTitleXml(chart.title), chartNode.elements()[0] ?? null);
  }
  return document;
}

function ensureChartExDataFormula(chartRoot: XmlElement, dataId: string, formula: string) {
  const dataContainer = child(chartRoot, CHART_EX_NS, "chartData");
  if (!dataContainer) return;
  let data = dataContainer.elements().find((candidate) => candidate.namespaceUri() === CHART_EX_NS && candidate.localName === "data" && candidate.getAttribute("id") === dataId);
  if (!data) {
    data = parseXml(`<cx:data xmlns:cx="${CHART_EX_NS}" id="${xmlText(dataId)}"><cx:numDim type="val"><cx:f>${xmlText(formula)}</cx:f></cx:numDim></cx:data>`).root;
    dataContainer.appendChild(data);
    return;
  }
  let dimension = child(data, CHART_EX_NS, "numDim");
  if (!dimension) {
    dimension = new XmlElement("numDim", "cx");
    dimension.setAttribute("type", "val");
    data.appendChild(dimension);
  }
  const formulaNode = child(dimension, CHART_EX_NS, "f") ?? (() => {
    const created = new XmlElement("f", "cx");
    dimension!.appendChild(created);
    return created;
  })();
  setText(formulaNode, formula);
}

function chartExSeriesText(series: XmlElement, formula: string | undefined, label: string) {
  let tx = child(series, CHART_EX_NS, "tx");
  if (!tx) {
    tx = new XmlElement("tx", "cx");
    series.appendChild(tx);
  }
  let txData = child(tx, CHART_EX_NS, "txData");
  if (!txData) {
    txData = new XmlElement("txData", "cx");
    tx.appendChild(txData);
  }
  const existingFormula = child(txData, CHART_EX_NS, "f");
  if (formula) {
    const formulaNode = existingFormula ?? (() => {
      const created = new XmlElement("f", "cx");
      txData!.insertBefore(created, txData!.elements()[0] ?? null);
      return created;
    })();
    setText(formulaNode, formula);
  } else if (existingFormula) txData.removeChild(existingFormula);
  const value = child(txData, CHART_EX_NS, "v") ?? (() => {
    const created = new XmlElement("v", "cx");
    txData!.appendChild(created);
    return created;
  })();
  setText(value, label);
}

function ensureChartExBinning(series: XmlElement) {
  let layout = child(series, CHART_EX_NS, "layoutPr");
  if (!layout) {
    layout = new XmlElement("layoutPr", "cx");
    series.appendChild(layout);
  }
  let binning = child(layout, CHART_EX_NS, "binning");
  if (!binning) {
    binning = new XmlElement("binning", "cx");
    binning.setAttribute("intervalClosed", "r");
    layout.appendChild(binning);
  }
  if (!binning.getAttribute("intervalClosed")) binning.setAttribute("intervalClosed", "r");
  for (const node of [...binning.elements()].filter((candidate) => candidate.localName === "binSize" || candidate.localName === "binCount")) binning.removeChild(node);
}

function newChartExSeries(chart: XlsxChartProjection, index: number, hidden: boolean) {
  const hiddenAttribute = hidden ? ' hidden="1"' : "";
  return parseXml(`<cx:series xmlns:cx="${CHART_EX_NS}" layoutId="clusteredColumn"${hiddenAttribute} uniqueId="${chartExUniqueId(chart, index)}" formatIdx="${index}"><cx:tx><cx:txData><cx:v/></cx:txData></cx:tx><cx:dataId val="${index}"/><cx:layoutPr><cx:binning intervalClosed="r"/></cx:layoutPr></cx:series>`).root;
}

function updateChartExHistogram(workbook: Workbook, chartRoot: XmlElement, chart: XlsxChartProjection, defaultSheet: string) {
  const modernChart = child(chartRoot, CHART_EX_NS, "chart") ?? firstDescendant(chartRoot, CHART_EX_NS, "chart");
  const region = firstDescendant(chartRoot, CHART_EX_NS, "plotAreaRegion");
  const seriesNodes = region?.elements().filter((node) => node.namespaceUri() === CHART_EX_NS && node.localName === "series") ?? [];
  const series = seriesNodes.find((candidate) => !boolAttribute(candidate.getAttribute("hidden"))) ?? seriesNodes[0];
  if (!modernChart || !region || !series) return;
  let companion = seriesNodes.find((candidate) => candidate !== series && boolAttribute(candidate.getAttribute("hidden")));
  if (!companion) {
    companion = newChartExSeries(chart, 1, true);
    region.appendChild(companion);
  }
  const source = chartSeriesForSource(workbook, chart, defaultSheet)[0] ?? { values: chart.sourceRange };
  const valueReference = source.values ?? chart.sourceRange;
  const existingValueDataId = child(series, CHART_EX_NS, "dataId")?.getAttribute("val") ?? "0";
  const existingValueName = chartExDataFormula(chartRoot, existingValueDataId) ?? chartExDataFormula(chartRoot, "0") ?? chartExDataFormula(chartRoot, "1");
  const existingHeaderName = firstDescendant(child(series, CHART_EX_NS, "tx") ?? series, CHART_EX_NS, "f")?.text();
  const names = !existingValueName || !/^_xlchart\.v1\./i.test(existingValueName) || !existingHeaderName || !/^_xlchart\.v1\./i.test(existingHeaderName) ? nextChartExNamePair(workbook) : undefined;
  const valueName = existingValueName && /^_xlchart\.v1\./i.test(existingValueName) ? existingValueName : names!.values;
  const headerName = existingHeaderName && /^_xlchart\.v1\./i.test(existingHeaderName) ? existingHeaderName : names!.header;
  ensureChartExDataFormula(chartRoot, "0", valueName);
  ensureChartExDataFormula(chartRoot, "1", valueName);
  child(series, CHART_EX_NS, "dataId")?.setAttribute("val", "0");
  child(companion, CHART_EX_NS, "dataId")?.setAttribute("val", "1");
  const headerReference = seriesHeaderReference(valueReference, defaultSheet) ?? firstCellReference(valueReference, defaultSheet);
  ensureHiddenDefinedName(workbook, headerName, headerReference);
  ensureHiddenDefinedName(workbook, valueName, absoluteRange(valueReference, defaultSheet));
  const label = source.name ?? "Values";
  series.removeAttribute("hidden");
  companion.setAttribute("hidden", "1");
  if (!series.getAttribute("uniqueId") || /^\{0{8}-0{4}-0{4}-0{4}-0{12}\}$/.test(series.getAttribute("uniqueId") ?? "")) series.setAttribute("uniqueId", chartExUniqueId(chart, 0));
  if (!companion.getAttribute("uniqueId") || /^\{0{8}-0{4}-0{4}-0{4}-0{12}\}$/.test(companion.getAttribute("uniqueId") ?? "")) companion.setAttribute("uniqueId", chartExUniqueId(chart, 1));
  series.setAttribute("formatIdx", series.getAttribute("formatIdx") ?? "0");
  companion.setAttribute("formatIdx", companion.getAttribute("formatIdx") ?? "1");
  chartExSeriesText(series, headerName, label);
  chartExSeriesText(companion, undefined, label);
  const existingTitle = child(modernChart, CHART_EX_NS, "title");
  if (existingTitle) modernChart.removeChild(existingTitle);
  if (chart.title) modernChart.insertBefore(chartExTitleXml(chart.title), modernChart.elements()[0] ?? null);
  ensureChartExBinning(series);
  ensureChartExBinning(companion);
}

function comboChartPlots(workbook: Workbook, chart: XlsxChartProjection, defaultSheet: string) {
  const source = chartSeriesForSource(workbook, chart, defaultSheet);
  const primary: IndexedChartSeries[] = source.map((series, index) => ({ ...series, nativeIndex: index, chartType: series.chartType ?? (index === 0 ? "column" : "line") }));
  const barSource = primary.filter((series) => series.chartType === "column" || series.chartType === "bar");
  const lineSource = primary.filter((series) => series.chartType === "line");
  const secondaryLines = lineSource.some((series) => series.axis === "secondary");
  const barSeries = newChartSeries(workbook, { ...chart, type: "column" }, defaultSheet, barSource);
  const lineSeries = newChartSeries(workbook, { ...chart, type: "line" }, defaultSheet, lineSource);
  const valueAxisId = secondaryLines && !barSeries.length ? SECONDARY_VALUE_AXIS_ID : PRIMARY_VALUE_AXIS_ID;
  const plots: XmlElement[] = [];
  if (barSeries.length) plots.push(...makeChartPlot("column", barSeries, { includeAxes: false }).elements());
  if (lineSeries.length) {
    plots.push(...makeChartPlot("line", lineSeries, {
      includeAxes: false,
      valueAxisId: secondaryLines ? SECONDARY_VALUE_AXIS_ID : PRIMARY_VALUE_AXIS_ID,
    }).elements());
  }
  if (barSeries.length || lineSeries.length) {
    plots.push(standardCategoryAxis(PRIMARY_CATEGORY_AXIS_ID, valueAxisId));
    plots.push(standardValueAxis(valueAxisId, PRIMARY_CATEGORY_AXIS_ID, valueAxisId === SECONDARY_VALUE_AXIS_ID ? "r" : "l"));
    if (secondaryLines && barSeries.length) plots.push(standardValueAxis(SECONDARY_VALUE_AXIS_ID, PRIMARY_CATEGORY_AXIS_ID, "r"));
  }
  return plots;
}

function updateChartSeries(workbook: Workbook, chartRoot: XmlElement, chart: XlsxChartProjection, defaultSheet: string) {
  if (chartRoot.namespaceUri() === CHART_EX_NS || firstDescendant(chartRoot, CHART_EX_NS, "plotArea")) {
    if (chart.type === "histogram") updateChartExHistogram(workbook, chartRoot, chart, defaultSheet);
    return;
  }
  const plot = child(child(chartRoot, CHART_NS, "chart"), CHART_NS, "plotArea") ?? firstDescendant(chartRoot, CHART_NS, "plotArea");
  const plotTypes = plot?.elements().filter((node) => node.namespaceUri() === CHART_NS && /Chart$/.test(node.localName)) ?? [];
  if (plotTypes.some((candidate) => candidate.localName === "histogramChart")) {
    const histogram = plotTypes.find((candidate) => candidate.localName === "histogramChart");
    if (histogram) {
      const existing = histogram.elements().find((node) => node.namespaceUri() === CHART_NS && node.localName === "histogramSeries");
      if (existing) histogram.removeChild(existing);
      for (const series of newChartSeries(workbook, { ...chart, type: "column" }, defaultSheet)) histogram.insertBefore(series, histogram.elements()[0] ?? null);
    }
    return;
  }
  if (chart.type === "combo" || plotTypes.length > 1) {
    const requested: IndexedChartSeries[] = chartSeriesForSource(workbook, chart, defaultSheet).map((series, index) => ({ ...series, nativeIndex: index, chartType: series.chartType ?? (index === 0 ? "column" : "line") }));
    const plots = plotTypes.filter((candidate) => candidate.localName === "barChart" || candidate.localName === "lineChart");
    if (!plots.length) return;
    plots.forEach((plotType) => {
      const desiredType = plotType.localName === "barChart" ? "column" : "line";
      const desired = requested.filter((series) => series.chartType === desiredType || (desiredType === "column" && series.chartType === "bar"));
      const current = plotType.elements().filter((node) => node.namespaceUri() === CHART_NS && node.localName === "ser");
      for (let index = current.length - 1; index >= desired.length; index -= 1) plotType.removeChild(current[index]!);
      const next = plotType.elements().filter((node) => node.namespaceUri() === CHART_NS && node.localName === "ser");
      for (let index = next.length; index < desired.length; index += 1) plotType.appendChild(newChartSeries(workbook, { ...chart, type: desiredType }, defaultSheet, [desired[index]!])[0]!);
      const lineUsesSecondary = desiredType === "line" && desired.some((series) => series.axis === "secondary");
      const valueAxisId = lineUsesSecondary ? SECONDARY_VALUE_AXIS_ID : PRIMARY_VALUE_AXIS_ID;
      for (const axisId of plotType.elements().filter((node) => node.namespaceUri() === CHART_NS && node.localName === "axId")) {
        const value = axisId.getAttribute("val");
        if (value === PRIMARY_VALUE_AXIS_ID || value === SECONDARY_VALUE_AXIS_ID) axisId.setAttribute("val", value === PRIMARY_VALUE_AXIS_ID || value === SECONDARY_VALUE_AXIS_ID ? valueAxisId : value);
      }
      plotType.elements().filter((node) => node.namespaceUri() === CHART_NS && node.localName === "ser").forEach((ser, index) => {
        const requestedSeries = desired[index]!;
        const nativeIndex = requestedSeries.nativeIndex ?? index;
        child(ser, CHART_NS, "idx")?.setAttribute("val", String(nativeIndex));
        child(ser, CHART_NS, "order")?.setAttribute("val", String(nativeIndex));
        const tx = child(ser, CHART_NS, "tx");
        if (tx && requestedSeries.name) { const value = firstDescendant(tx, CHART_NS, "v"); if (value) setText(value, requestedSeries.name); }
        const categories = child(ser, CHART_NS, "cat") ?? (() => { const created = new XmlElement("cat", "c"); ser.appendChild(created); return created; })();
        setChartRef(workbook, categories, requestedSeries.categories, defaultSheet, true);
        const values = child(ser, CHART_NS, "val") ?? (() => { const created = new XmlElement("val", "c"); ser.appendChild(created); return created; })();
        setChartRef(workbook, values, requestedSeries.values ?? chart.sourceRange, defaultSheet);
      });
    });
    return;
  }
  const requested = chartSeriesForSource(workbook, chart, defaultSheet);
  for (const [index, plotType] of plotTypes.entries()) {
    const series = plotType.elements().filter((node) => node.namespaceUri() === CHART_NS && node.localName === "ser");
    for (let index = series.length - 1; index >= requested.length; index -= 1) plotType.removeChild(series[index]!);
    for (let index = series.length; index < requested.length; index += 1) plotType.appendChild(newChartSeries(workbook, { ...chart, series: [requested[index]!] }, defaultSheet)[0]!);
    const current = plotType.elements().filter((node) => node.namespaceUri() === CHART_NS && node.localName === "ser");
    current.forEach((ser, seriesIndex) => {
      const requestedSeries = requested[seriesIndex] ?? requested[0]!;
      const tx = child(ser, CHART_NS, "tx");
      if (tx && requestedSeries.name) { const value = firstDescendant(tx, CHART_NS, "v"); if (value) setText(value, requestedSeries.name); }
      const categories = child(ser, CHART_NS, "cat");
      if (requestedSeries.categories) { const target = categories ?? (() => { const created = new XmlElement("cat", "c"); ser.appendChild(created); return created; })(); setChartRef(workbook, target, requestedSeries.categories, defaultSheet, true); }
      const values = child(ser, CHART_NS, "val") ?? (() => { const created = new XmlElement("val", "c"); ser.appendChild(created); return created; })();
      setChartRef(workbook, values, requestedSeries.values ?? chart.sourceRange, defaultSheet);
    });
    if (index > 0) break;
  }
}

function setChartLegend(chartRoot: XmlElement, visible: boolean) {
  if (chartRoot.namespaceUri() === CHART_EX_NS || firstDescendant(chartRoot, CHART_EX_NS, "plotArea")) {
    const chart = child(chartRoot, CHART_EX_NS, "chart");
    if (!chart) return;
    const existing = child(chart, CHART_EX_NS, "legend");
    if (!visible) {
      if (existing) chart.removeChild(existing);
      return;
    }
    if (!existing) chart.appendChild(chartExLegendXml());
    return;
  }
  const chart = child(chartRoot, CHART_NS, "chart");
  if (!chart) return;
  const existing = child(chart, CHART_NS, "legend");
  if (!visible) { if (existing) chart.removeChild(existing); return; }
  if (existing) return;
  const document = parseXml(`<c:legend xmlns:c="${CHART_NS}"><c:legendPos val="r"/><c:layout/><c:overlay val="0"/></c:legend>`);
  // CT_Chart places the legend after plotArea and before the display
  // switches. Appending it after c:dispBlanksAs is accepted by some readers
  // but is a schema defect that Excel repairs on open.
  const before = chart.elements().find((node) => ["plotVisOnly", "dispBlanksAs", "showDLbls", "showDataLabelsOverMaximum", "extLst"].includes(node.localName));
  chart.insertBefore(document.root, before ?? null);
}

function setChartType(chartRoot: XmlElement, type: XlsxChartProjection["type"]) {
  const info = chartTypeAndElement(chartRoot);
  const current = info.element;
  if (!current || !current.parent) return;
  const oldElements = info.elements ?? [current];
  const series = oldElements.flatMap((element) => element.elements()
    .filter((node) => node.namespaceUri() === CHART_NS && (node.localName === "ser" || node.localName === "histogramSeries"))
    .map((node) => node.localName === "ser" ? node.clone() : standardSeriesFromHistogram(node)));
  const parent = current.parent;
  for (const element of oldElements) if (element.parent === parent) parent.removeChild(element);
  if (type === "combo") {
    const combo = comboChartPlotsFromExisting(series);
    for (const plot of combo) parent.appendChild(plot);
    return;
  }
  if (type === "histogram") {
    // Histogram is a ChartEx feature. Callers migrate a legacy chart to a
    // ChartEx part instead of emitting the non-standard c:histogramChart.
    for (const plot of makeChartPlot("column", series).elements()) parent.appendChild(plot);
    return;
  }
  for (const replacement of makeChartPlot(type, series).elements()) parent.appendChild(replacement);
}

function standardSeriesFromHistogram(node: XmlElement) {
  const document = parseXml(`<c:ser xmlns:c="${CHART_NS}" xmlns:a="${A_NS}"/>`);
  const result = document.root;
  for (const childName of ["idx", "order", "tx", "cat", "val"]) {
    const childNode = child(node, CHART_NS, childName);
    if (childNode) result.appendChild(childNode.clone());
  }
  return result;
}

function comboChartPlotsFromExisting(series: XmlElement[]) {
  const first = series.slice(0, 1);
  const rest = series.slice(1);
  const plots: XmlElement[] = [];
  if (first.length) plots.push(...makeChartPlot("column", first, { includeAxes: false }).elements());
  if (rest.length) plots.push(...makeChartPlot("line", rest, { includeAxes: false }).elements());
  if (first.length || rest.length) {
    plots.push(standardCategoryAxis(PRIMARY_CATEGORY_AXIS_ID, PRIMARY_VALUE_AXIS_ID));
    plots.push(standardValueAxis(PRIMARY_VALUE_AXIS_ID, PRIMARY_CATEGORY_AXIS_ID));
  }
  return plots;
}

async function writeExistingChart(workbook: Workbook, sheet: Worksheet, chart: XlsxChartProjection) {
  if (!chart.partName) return false;
  const document = await workbook.office.xml(chart.partName);
  const root = document.root;
  const modern = workbook.office.package.contentTypeOf(chart.partName) === CT_CHART_EX || root.namespaceUri() === CHART_EX_NS || Boolean(firstDescendant(root, CHART_EX_NS, "plotArea"));
  if (modern) {
    ensureChartExAssets(workbook, chart.partName);
    if (chart.type !== "histogram") {
      await removeNativeChart(workbook, sheet, chart.id);
      await createNativeChart(workbook, sheet, { ...chart, partName: undefined, drawingPartName: undefined, anchorId: undefined });
      return true;
    }
    if (chart.showLegend !== undefined) setChartLegend(root, chart.showLegend);
    updateChartExHistogram(workbook, root, chart, sheet.name);
    await updateChartAnchor(workbook, chart);
    workbook.office.markDirty(chart.partName);
    return true;
  }
  if (chart.type === "histogram" || Boolean(firstDescendant(root, CHART_NS, "histogramChart"))) {
    // Legacy c:histogramChart/c:histogramSeries is not part of the standard
    // chart plot model. Replace it with a real ChartEx part and keep the
    // worksheet anchor/relationship managed by the same writer path.
    await removeNativeChart(workbook, sheet, chart.id);
    await createNativeChart(workbook, sheet, { ...chart, partName: undefined, drawingPartName: undefined, anchorId: undefined });
    return true;
  }
  const title = firstDescendant(root, CHART_NS, "title");
  if (title?.parent) title.parent.removeChild(title);
  if (chart.title) {
    const chartNode = child(root, CHART_NS, "chart");
    if (chartNode) chartNode.insertBefore(chartTitleXml(chart.title), chartNode.elements()[0] ?? null);
  }
  if (chart.showLegend !== undefined) setChartLegend(root, chart.showLegend);
  if (chart.type !== chartTypeAndElement(root).type) setChartType(root, chart.type);
  updateChartSeries(workbook, root, chart, sheet.name);
  await updateChartAnchor(workbook, chart);
  workbook.office.markDirty(chart.partName);
  return true;
}

function drawingAnchorXml(chartRelId: string, chart: XlsxChartProjection, modern = false, shapeId = 2) {
  const right = chart.position.x + chart.position.width;
  const bottom = chart.position.y + chart.position.height;
  const x = Math.max(0, Math.floor(chart.position.x / 64));
  const y = Math.max(0, Math.floor(chart.position.y / 20));
  const toX = Math.max(x + 1, Math.floor(right / 64));
  const toY = Math.max(y + 1, Math.floor(bottom / 20));
  const graphic = modern
    ? `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:cx1="${CHART_EX_REQUIRES_NS}" Requires="cx1"><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${shapeId}" name="Chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="${CHART_EX_NS}"><cx:chart xmlns:cx="${CHART_EX_NS}" xmlns:r="${REL}" r:id="${chartRelId}"/></a:graphicData></a:graphic></xdr:graphicFrame></mc:Choice><mc:Fallback><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill><a:ln w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></xdr:spPr><xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="900"/><a:t>This chart is not available in this Office version.</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent>`
    : `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${shapeId}" name="Chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="${CHART_NS}"><c:chart r:id="${chartRelId}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
  const document = parseXml(`<xdr:twoCellAnchor xmlns:xdr="${DRAWING_NS}" xmlns:a="${A_NS}" xmlns:c="${CHART_NS}" xmlns:cx="${CHART_EX_NS}" xmlns:r="${REL}"><xdr:from><xdr:col>${x}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${y}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${toX}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toY}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>${graphic.replace("<xdr:xfrm/>", "<xdr:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/></xdr:xfrm>")}<xdr:clientData/></xdr:twoCellAnchor>`);
  const anchor = document.root;
  const from = child(anchor, DRAWING_NS, "from");
  const to = child(anchor, DRAWING_NS, "to");
  setDrawingChildText(from, "colOff", (chart.position.x - x * 64) * 9525);
  setDrawingChildText(from, "rowOff", (chart.position.y - y * 20) * 9525);
  setDrawingChildText(to, "colOff", (right - toX * 64) * 9525);
  setDrawingChildText(to, "rowOff", (bottom - toY * 20) * 9525);
  return document.root;
}

function setDrawingChildText(parent: XmlElement | undefined, name: string, value: number) {
  const node = child(parent, DRAWING_NS, name);
  if (!node) return false;
  setText(node, String(Math.max(0, Math.round(value))));
  return true;
}

async function updateChartAnchor(workbook: Workbook, chart: XlsxChartProjection) {
  if (!chart.drawingPartName || !chart.anchorId) return;
  const document = await workbook.office.xml(chart.drawingPartName);
  const anchor = document.root.elements().find((candidate) =>
    (candidate.localName === "twoCellAnchor" || candidate.localName === "oneCellAnchor")
      && (firstDescendant(candidate, CHART_NS, "chart")?.getAttribute("r:id") === chart.anchorId || firstDescendant(candidate, CHART_EX_NS, "chart")?.getAttribute("r:id") === chart.anchorId),
  );
  if (!anchor) return;
  const right = chart.position.x + chart.position.width;
  const bottom = chart.position.y + chart.position.height;
  const x = Math.max(0, Math.floor(chart.position.x / 64));
  const y = Math.max(0, Math.floor(chart.position.y / 20));
  const toX = Math.max(x + 1, Math.floor(right / 64));
  const toY = Math.max(y + 1, Math.floor(bottom / 20));
  const from = child(anchor, DRAWING_NS, "from");
  let changed = false;
  changed = setDrawingChildText(from, "col", x) || changed;
  changed = setDrawingChildText(from, "row", y) || changed;
  changed = setDrawingChildText(from, "colOff", (chart.position.x - x * 64) * 9525) || changed;
  changed = setDrawingChildText(from, "rowOff", (chart.position.y - y * 20) * 9525) || changed;
  if (anchor.localName === "twoCellAnchor") {
    const to = child(anchor, DRAWING_NS, "to");
    changed = setDrawingChildText(to, "col", toX) || changed;
    changed = setDrawingChildText(to, "row", toY) || changed;
    changed = setDrawingChildText(to, "colOff", (right - toX * 64) * 9525) || changed;
    changed = setDrawingChildText(to, "rowOff", (bottom - toY * 20) * 9525) || changed;
  } else {
    const ext = child(anchor, DRAWING_NS, "ext");
    if (ext) {
      ext.setAttribute("cx", String(Math.max(1, Math.round(chart.position.width * 9525))));
      ext.setAttribute("cy", String(Math.max(1, Math.round(chart.position.height * 9525))));
      changed = true;
    }
  }
  if (changed) workbook.office.markDirty(chart.drawingPartName);
}

function nextChartAssetPartName(workbook: Workbook, prefix: string) {
  let index = 1;
  while (workbook.office.package.getPart(`/xl/charts/${prefix}${index}.xml`)) index += 1;
  return `/xl/charts/${prefix}${index}.xml`;
}

function ensureChartExAssets(workbook: Workbook, chartPartName: string) {
  const packageModel = workbook.office.package;
  const chartPart = packageModel.getPart(chartPartName);
  if (!chartPart) return;
  const ensure = (relationshipType: string, contentType: string, prefix: string, xml: string) => {
    const relationships = chartPart.relationships();
    const existing = relationships.byType(relationshipType).find((candidate) => packageModel.relatedPart(chartPart, candidate.id));
    if (existing) return;
    for (const broken of relationships.byType(relationshipType)) relationships.remove(broken.id);
    const partName = nextChartAssetPartName(workbook, prefix);
    packageModel.addPart(partName, contentType, new TextEncoder().encode(xml));
    relationships.add({ type: relationshipType, target: relativeTarget(chartPartName, partName) });
  };
  ensure(CHART_STYLE_REL, CT_CHART_STYLE, "style", DEFAULT_CHART_STYLE_XML);
  ensure(CHART_COLOR_REL, CT_CHART_COLOR, "colors", DEFAULT_CHART_COLOR_XML);
}

async function createNativeChart(workbook: Workbook, sheet: Worksheet, chart: XlsxChartProjection) {
  const packageModel = workbook.office.package;
  const nextPart = (prefix: string, suffix: string) => {
    let index = 1; while (packageModel.getPart(`/xl/${prefix}/${suffix}${index}.xml`)) index += 1; return `/xl/${prefix}/${suffix}${index}.xml`;
  };
  const modern = chart.type === "histogram";
  const chartPartName = nextPart("charts", modern ? "chartEx" : "chart");
  if (modern) {
    packageModel.addPart(chartPartName, CT_CHART_EX, serializeXml(chartExHistogramDocument(workbook, chart, sheet.name)));
    ensureChartExAssets(workbook, chartPartName);
  } else {
    const chartDocument = parseXml(`<c:chartSpace xmlns:c="${CHART_NS}" xmlns:a="${A_NS}" xmlns:r="${REL}"><c:chart><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`);
    const chartRoot = chartDocument.root;
    const chartNode = child(chartRoot, CHART_NS, "chart")!;
    const plotArea = child(chartNode, CHART_NS, "plotArea")!;
    for (const node of [...plotArea.children]) plotArea.removeChild(node);
    plotArea.appendChild(new XmlElement("layout", "c"));
    if (chart.title) chartNode.insertBefore(chartTitleXml(chart.title), chartNode.elements()[0] ?? null);
    if (chart.type === "combo") {
      for (const plot of comboChartPlots(workbook, chart, sheet.name)) plotArea.appendChild(plot);
    } else {
      const standardType = chart.type === "histogram" ? "line" : chart.type;
      for (const plot of makeChartPlot(standardType, newChartSeries(workbook, chart, sheet.name).map((node) => node.clone())).elements()) plotArea.appendChild(plot);
    }
    if (chart.showLegend !== false) setChartLegend(chartRoot, true);
    packageModel.addPart(chartPartName, CT_CHART, serializeXml(chartDocument));
  }

  let drawingPartName: string;
  let drawingPart: ReturnType<typeof packageModel.getPart>;
  let drawingRoot: XmlElement;
  const worksheetDocument = await workbook.office.xml(sheet.partName);
  const worksheetRoot = worksheetDocument.root;
  const drawingElement = child(worksheetRoot, SML, "drawing");
  if (drawingElement?.getAttribute("r:id")) {
    const existing = packageModel.relatedPart(sheetPart(workbook, sheet)!, drawingElement.getAttribute("r:id")!);
    if (!existing) throw new Error("The worksheet drawing relationship is broken.");
    drawingPart = existing; drawingPartName = existing.name; drawingRoot = (await workbook.office.xml(existing.name)).root;
  } else {
    drawingPartName = nextPart("drawings", "drawing");
    const drawingDocument = parseXml(`<xdr:wsDr xmlns:xdr="${DRAWING_NS}" xmlns:a="${A_NS}" xmlns:c="${CHART_NS}" xmlns:cx="${CHART_EX_NS}" xmlns:r="${REL}"/>`);
    drawingPart = packageModel.addPart(drawingPartName, CT_DRAWING, serializeXml(drawingDocument));
    drawingRoot = (await workbook.office.xml(drawingPartName)).root;
    const rel = sheetPart(workbook, sheet)!.relationships().add({ type: DRAWING_REL, target: relativeTarget(sheet.partName, drawingPartName) });
    const element = new XmlElement("drawing", worksheetRoot.lookupPrefix(SML) ?? null); element.setAttribute("r:id", rel.id); worksheetRoot.appendChild(element); workbook.office.markDirty(sheet.partName);
  }
  const relation = drawingPart!.relationships().add({ type: modern ? CHART_EX_REL : CHART_REL, target: relativeTarget(drawingPartName, chartPartName) });
  const shapeIds = allDescendants(drawingRoot, DRAWING_NS, "cNvPr")
    .map((node) => Number(node.getAttribute("id")))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  const nextShapeId = Math.max(1, ...shapeIds) + 1;
  drawingRoot.appendChild(drawingAnchorXml(relation.id, chart, modern, nextShapeId));
  workbook.office.markDirty(drawingPartName);
  return { chartPartName, drawingPartName };
}

function relativeTarget(source: string, target: string) {
  const sourceParts = source.slice(1).split("/"); sourceParts.pop();
  const targetParts = target.slice(1).split("/");
  while (sourceParts.length && targetParts.length && sourceParts[0] === targetParts[0]) { sourceParts.shift(); targetParts.shift(); }
  return `${"../".repeat(sourceParts.length)}${targetParts.join("/")}`;
}

async function removeNativeChart(workbook: Workbook, sheet: Worksheet, chartId: string) {
  const charts = await projectCharts(workbook, sheet);
  const chart = charts.find((candidate) => candidate.id === chartId || candidate.partName === chartId);
  if (!chart?.partName || !chart.drawingPartName) return;
  const drawingDocument = await workbook.office.xml(chart.drawingPartName);
  const drawingRoot = drawingDocument.root;
  const drawingPart = workbook.office.package.getPart(chart.drawingPartName);
  const relation = drawingPart?.relationships().all().find((candidate) => (candidate.type === CHART_REL || candidate.type === CHART_EX_REL) && workbook.office.package.relatedPart(drawingPart, candidate.id)?.name === chart.partName);
  const anchor = drawingRoot.elements().find((candidate) =>
    firstDescendant(candidate, CHART_NS, "chart")?.getAttribute("r:id") === relation?.id ||
    firstDescendant(candidate, CHART_EX_NS, "chart")?.getAttribute("r:id") === relation?.id,
  );
  if (anchor) drawingRoot.removeChild(anchor);
  if (relation) drawingPart?.relationships().remove(relation.id);
  if (drawingPart) workbook.office.markDirty(drawingPart.name);
  workbook.office.package.removePart(chart.partName);
}

async function upsertNativeTable(workbook: Workbook, sheet: Worksheet, table: XlsxTableProjection) {
  const current = (await projectTables(workbook, sheet)).find((candidate) => candidate.id === table.id || candidate.partName === table.partName || candidate.name === table.name);
  if (!current) {
    const style = table.style?.startsWith("TableStyle") ? table.style : table.style === "accent" ? "TableStyleMedium4" : table.style === "striped" ? "TableStyleMedium2" : null;
    const created = await sheet.addTable(table.range, {
      name: table.name,
      ...(table.columns.length ? { headers: table.columns } : {}),
      style,
    });
    await upsertNativeTable(workbook, sheet, {
      ...table,
      id: `xlsx:table:${created.partName}`,
      partName: created.partName,
    });
    return;
  }
  if (!current.partName) throw new Error("The Excel table has no stable native part identity.");
  const document = await workbook.office.xml(current.partName);
  const root = document.root;
  root.setAttribute("ref", fullRange(table.range));
  root.setAttribute("name", table.name); root.setAttribute("displayName", table.name);
  root.setAttribute("totalsRowCount", table.totalsRow ? "1" : "0"); root.setAttribute("headerRowCount", table.headerRow ? "1" : "0");
  if (table.columns.length) {
    let columns = child(root, SML, "tableColumns");
    if (!columns) { columns = new XmlElement("tableColumns", root.lookupPrefix(SML) ?? null); root.appendChild(columns); }
    for (const old of [...columns.elements()].filter((node) => node.localName === "tableColumn")) columns.removeChild(old);
    columns.setAttribute("count", String(table.columns.length));
    table.columns.forEach((column, index) => {
      const item = new XmlElement("tableColumn", columns!.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null);
      item.setAttribute("id", String(index + 1)); item.setAttribute("name", column); columns!.appendChild(item);
    });
  }
  const styleName = table.style === "plain" ? null : table.style === "striped" ? "TableStyleMedium2" : table.style === "accent" ? "TableStyleMedium4" : table.style ?? null;
  const style = child(root, SML, "tableStyleInfo");
  if (!styleName && style) root.removeChild(style);
  else if (styleName) { const currentStyle = style ?? new XmlElement("tableStyleInfo", root.lookupPrefix(SML) ?? null); currentStyle.setAttribute("name", styleName); currentStyle.setAttribute("showFirstColumn", "0"); currentStyle.setAttribute("showLastColumn", "0"); currentStyle.setAttribute("showRowStripes", "1"); currentStyle.setAttribute("showColumnStripes", "0"); if (!style) root.appendChild(currentStyle); }
  let autoFilter = child(root, SML, "autoFilter");
  if (!autoFilter && (table.filters?.length || table.sort)) {
    autoFilter = new XmlElement("autoFilter", root.lookupPrefix(SML) ?? null);
    root.appendChild(autoFilter);
  }
  if (autoFilter) {
    autoFilter.setAttribute("ref", fullRange(table.range));
    for (const old of autoFilter.elements().filter((node) => node.localName === "filterColumn" || node.localName === "sortState")) autoFilter.removeChild(old);
    for (const filter of table.filters ?? []) {
      const filterColumn = new XmlElement("filterColumn", autoFilter.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null);
      filterColumn.setAttribute("colId", String(filter.column));
      const filters = new XmlElement("filters", filterColumn.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null);
      for (const value of filter.allowedValues) {
        const item = new XmlElement("filter", filters.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null);
        item.setAttribute("val", value instanceof Date ? value.toISOString() : value === null ? "" : String(value));
        filters.appendChild(item);
      }
      filterColumn.appendChild(filters); autoFilter.appendChild(filterColumn);
    }
    if (table.sort) {
      const sortState = new XmlElement("sortState", autoFilter.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null);
      sortState.setAttribute("column", String(table.sort.column));
      sortState.setAttribute("descending", table.sort.direction === "desc" ? "1" : "0");
      autoFilter.appendChild(sortState);
    }
  }
  workbook.office.markDirty(current.partName);
}

async function removeNativeTable(workbook: Workbook, sheet: Worksheet, tableId: string) {
  const table = (await projectTables(workbook, sheet)).find((candidate) => candidate.id === tableId || candidate.partName === tableId || candidate.name === tableId);
  if (!table?.partName) return;
  const sheetPartValue = sheetPart(workbook, sheet); if (!sheetPartValue) return;
  const root = (await workbook.office.xml(sheet.partName)).root;
  const tableParts = child(root, SML, "tableParts");
  const rel = sheetPartValue.relationships().all().find((candidate) => candidate.type === TABLE_REL && workbook.office.package.relatedPart(sheetPartValue, candidate.id)?.name === table.partName);
  const entry = tableParts?.elements().find((candidate) => candidate.getAttribute("r:id") === rel?.id);
  if (entry && tableParts) tableParts.removeChild(entry);
  if (rel) sheetPartValue.relationships().remove(rel.id);
  if (tableParts && !tableParts.elements().length) root.removeChild(tableParts);
  workbook.office.markDirty(sheet.partName);
  workbook.office.package.removePart(table.partName);
}

function knownValidationType(type: string | undefined) {
  return type === "list" || type === "whole" || type === "decimal" || type === "date" || type === "time";
}

function knownConditionalType(type: string | undefined) {
  return type === "cellIs" || type === "containsText" || type === "colorScale";
}

function insertWorksheetChild(root: XmlElement, node: XmlElement) {
  const order = ["conditionalFormatting", "dataValidations", "hyperlinks", "printOptions", "pageMargins", "pageSetup", "drawing", "legacyDrawing", "tableParts", "extLst"];
  const wanted = order.indexOf(node.localName);
  const reference = root.elements().find((candidate) => {
    const index = order.indexOf(candidate.localName);
    return index >= 0 && index > wanted;
  });
  root.insertBefore(node, reference ?? null);
}

function appendXmlText(parent: XmlElement, localName: string, value: string) {
  const node = new XmlElement(localName, parent.lookupPrefix(SML) ?? null);
  node.appendChild(new XmlText(value));
  parent.appendChild(node);
  return node;
}

function ruleAttributes(rule: NativeRule, excluded: Set<string>) {
  return Object.entries(rule).flatMap(([key, value]) => {
    if (excluded.has(key) || value === undefined || value === null || typeof value === "object") return [];
    if (typeof value === "boolean") return [[key, value ? "1" : "0"] as const];
    return [[key, String(value)] as const];
  });
}

function colorRgb(value: unknown) {
  if (typeof value !== "string") return undefined;
  const hex = value.replace(/^#/, "").trim();
  if (/^[0-9a-f]{6}$/i.test(hex)) return `FF${hex.toUpperCase()}`;
  if (/^[0-9a-f]{8}$/i.test(hex)) return hex.toUpperCase();
  return undefined;
}

async function ensureDxf(workbook: Workbook, fillColor: unknown, textColor: unknown, existing: unknown) {
  const existingId = Number(existing);
  if (Number.isInteger(existingId) && existingId >= 0) return existingId;
  const stylesPart = workbook.office.package.getPart("/xl/styles.xml");
  if (!stylesPart) return undefined;
  const document = await workbook.office.xml(stylesPart.name);
  const root = document.root;
  let dxfs = child(root, SML, "dxfs");
  if (!dxfs) {
    dxfs = new XmlElement("dxfs", root.lookupPrefix(SML) ?? null);
    dxfs.setAttribute("count", "0");
    const reference = root.elements().find((node) => node.localName === "cellStyles");
    root.insertBefore(dxfs, reference ?? null);
  }
  const fill = colorRgb(fillColor);
  const text = colorRgb(textColor);
  if (!fill && !text) return undefined;
  const dxf = new XmlElement("dxf", dxfs.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null);
  if (text) {
    const font = new XmlElement("font", dxf.lookupPrefix(SML) ?? null);
    const color = new XmlElement("color", font.lookupPrefix(SML) ?? null); color.setAttribute("rgb", text); font.appendChild(color); dxf.appendChild(font);
  }
  if (fill) {
    const fillNode = new XmlElement("fill", dxf.lookupPrefix(SML) ?? null);
    const pattern = new XmlElement("patternFill", fillNode.lookupPrefix(SML) ?? null); pattern.setAttribute("patternType", "solid");
    const foreground = new XmlElement("fgColor", pattern.lookupPrefix(SML) ?? null); foreground.setAttribute("rgb", fill); pattern.appendChild(foreground);
    const background = new XmlElement("bgColor", pattern.lookupPrefix(SML) ?? null); background.setAttribute("indexed", "64"); pattern.appendChild(background);
    fillNode.appendChild(pattern); dxf.appendChild(fillNode);
  }
  const index = dxfs.elements().filter((node) => node.localName === "dxf").length;
  dxfs.appendChild(dxf); dxfs.setAttribute("count", String(index + 1)); workbook.office.markDirty(stylesPart.name);
  return index;
}

function addRuleFormulas(parent: XmlElement, rule: NativeRule) {
  const formulas = Array.isArray(rule.formulas)
    ? rule.formulas.filter((value): value is string => typeof value === "string")
    : [];
  if (typeof rule.formula1 === "string") formulas.push(rule.formula1);
  if (typeof rule.formula2 === "string") formulas.push(rule.formula2);
  for (const formula of formulas) appendXmlText(parent, "formula", formula);
}

async function conditionalRuleXml(workbook: Workbook, rule: NativeRule, priority: number, prefix: string | null) {
  const node = new XmlElement("cfRule", prefix);
  const excluded = new Set(["id", "formulas", "colorScale", "fillColor", "textColor", "formula1", "formula2"]);
  for (const [key, value] of ruleAttributes({ ...rule, priority: rule.priority ?? String(priority) }, excluded)) node.setAttribute(key, value);
  if (rule.priority === undefined) node.setAttribute("priority", String(priority));
  if (rule.type === "colorScale" && rule.colorScale && typeof rule.colorScale === "object") {
    const scale = rule.colorScale as NativeRule;
    const scaleNode = new XmlElement("colorScale", prefix);
    for (const candidate of Array.isArray(scale.cfvo) ? scale.cfvo : []) {
      const value = candidate as NativeRule;
      const cfvo = new XmlElement("cfvo", prefix);
      if (typeof value.type === "string") cfvo.setAttribute("type", value.type);
      if (value.value !== undefined) cfvo.setAttribute("val", String(value.value));
      scaleNode.appendChild(cfvo);
    }
    for (const color of Array.isArray(scale.colors) ? scale.colors : []) {
      const colorNode = new XmlElement("color", prefix);
      const rgb = colorRgb(color); if (rgb) colorNode.setAttribute("rgb", rgb); else if (typeof color === "string") colorNode.setAttribute("theme", color);
      scaleNode.appendChild(colorNode);
    }
    node.appendChild(scaleNode);
  } else if (rule.type === "containsText" && typeof rule.text === "string") {
    node.setAttribute("operator", "containsText"); node.setAttribute("text", rule.text);
  }
  addRuleFormulas(node, rule);
  const dxfId = await ensureDxf(workbook, rule.fillColor, rule.textColor, rule.dxfId);
  if (dxfId !== undefined) node.setAttribute("dxfId", String(dxfId));
  return node;
}

async function dataValidationXml(rule: NativeRule, prefix: string | null) {
  const node = new XmlElement("dataValidation", prefix);
  const excluded = new Set(["id", "formula1", "formula2", "formulas", "source", "kind"]);
  for (const [key, value] of ruleAttributes(rule, excluded)) node.setAttribute(key, value);
  if (typeof rule.sqref === "string") node.setAttribute("sqref", rule.sqref);
  if (typeof rule.formula1 === "string") appendXmlText(node, "formula1", rule.formula1);
  if (typeof rule.formula2 === "string") appendXmlText(node, "formula2", rule.formula2);
  return node;
}

async function writeNativeValidations(workbook: Workbook, sheet: Worksheet, rules: NativeRule[]) {
  const document = await workbook.office.xml(sheet.partName);
  const root = document.root;
  let container = child(root, SML, "dataValidations");
  const unknown = container?.elements().filter((node) => !knownValidationType(node.getAttribute("type"))) ?? [];
  const desired = rules.filter((rule) => knownValidationType(typeof rule.type === "string" ? rule.type : undefined));
  if (!unknown.length && !desired.length) { if (container) root.removeChild(container); workbook.office.markDirty(sheet.partName); return; }
  if (!container) { container = new XmlElement("dataValidations", root.lookupPrefix(SML) ?? null); insertWorksheetChild(root, container); }
  for (const node of [...container.elements()]) if (knownValidationType(node.getAttribute("type"))) container.removeChild(node);
  for (const rule of desired) container.appendChild(await dataValidationXml(rule, container.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null));
  container.setAttribute("count", String(container.elements().length));
  workbook.office.markDirty(sheet.partName);
}

async function writeNativeConditionalFormats(workbook: Workbook, sheet: Worksheet, groups: NativeRule[]) {
  const document = await workbook.office.xml(sheet.partName);
  const root = document.root;
  const existing = root.elements().filter((node) => node.namespaceUri() === SML && node.localName === "conditionalFormatting");
  for (const group of existing) {
    for (const rule of [...group.elements()].filter((node) => node.localName === "cfRule" && knownConditionalType(node.getAttribute("type")))) group.removeChild(rule);
    if (!group.elements().length) root.removeChild(group);
  }
  let priority = Math.max(0, ...existing.flatMap((group) => group.elements().flatMap((node) => {
    const value = Number(node.getAttribute("priority")); return Number.isFinite(value) ? [value] : [];
  })));
  for (const group of groups) {
    const desired = Array.isArray(group.rules) ? group.rules.filter((rule): rule is NativeRule => knownConditionalType(typeof (rule as NativeRule).type === "string" ? String((rule as NativeRule).type) : undefined)) : [];
    if (!desired.length || typeof group.sqref !== "string") continue;
    const node = new XmlElement("conditionalFormatting", root.lookupPrefix(SML) ?? null); node.setAttribute("sqref", group.sqref);
    for (const rule of desired) { priority += 1; node.appendChild(await conditionalRuleXml(workbook, rule, priority, node.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null)); }
    insertWorksheetChild(root, node);
  }
  if (groups.length || existing.length) workbook.office.markDirty(sheet.partName);
}

export async function updateNativeChartCaches(workbook: Workbook) {
  for (const sheet of workbook.sheets()) {
    for (const chart of await projectCharts(workbook, sheet)) {
      if (!chart.partName) continue;
      const document = await workbook.office.xml(chart.partName);
      updateChartSeries(workbook, document.root, chart, sheet.name);
      workbook.office.markDirty(chart.partName);
    }
  }
}

export async function applyXlsxNativeOperation(workbook: Workbook, operation: XlsxOperation, aliases = new Map<string, number>()) {
  if (operation.kind === "add-sheet") {
    const sheet = workbook.addSheet(operation.name);
    aliases.set(operation.sheetId, sheet.sheetId);
    const order = workbook.sheets().map(nativeSheetKey).filter((id) => id !== nativeSheetKey(sheet));
    order.splice(Math.max(0, Math.min(operation.index, order.length)), 0, operation.sheetId);
    reorderNativeSheets(workbook, order, aliases);
    return;
  }
  if (operation.kind === "remove-sheet") {
    const sheet = nativeSheetById(workbook, operation.sheetId, aliases);
    if (workbook.sheets().length <= 1) throw new Error("An Excel workbook must keep at least one worksheet.");
    if (await hasNativeReferencesToSheet(workbook, sheet.name))
      throw new Error(`The worksheet ${sheet.name} is referenced by a formula or chart and cannot be removed safely.`);
    const tables = await projectTables(workbook, sheet);
    const charts = await projectCharts(workbook, sheet);
    const drawingParts = new Set(charts.flatMap((chart) => chart.drawingPartName ? [chart.drawingPartName] : []));
    for (const table of tables) if (table.partName) workbook.office.package.removePart(table.partName);
    for (const chart of charts) if (chart.partName) workbook.office.package.removePart(chart.partName);
    for (const drawing of drawingParts) workbook.office.package.removePart(drawing);
    const sheetEntry = sheetElement(sheet); const sheets = workbookSheetsElement(workbook);
    sheets.removeChild(sheetEntry); workbook._internal().markDirty(workbook._internal().workbook);
    const part = sheetPart(workbook, sheet); if (part) { const rel = workbook._internal().workbook.part.relationships().byId(sheet.rId); if (rel) workbook._internal().workbook.part.relationships().remove(rel.id); workbook.office.package.removePart(part.name); }
    return;
  }
  if (operation.kind === "reorder-sheets") {
    reorderNativeSheets(workbook, operation.order, aliases);
    return;
  }
  if (operation.kind === "set-defined-names") {
    const root = workbookRoot(workbook); let names = root.find(SML, "definedNames");
    if (!names) { names = new XmlElement("definedNames", root.lookupPrefix(SML) ?? null); root.appendChild(names); }
    const existing = names.elements().filter((node) => node.localName === "definedName");
    const desired = new Map<string, (typeof operation.names)[number]>(operation.names.map((item) => {
      const sheet = item.sheet ? workbook.sheet(item.sheet) : undefined;
      return [`${item.name}\u0000${sheet ? nativeSheetIndex(workbook, sheet) : ""}`, item] as const;
    }));
    for (const old of [...existing]) {
      const oldName = old.getAttribute("name") ?? "";
      if (oldName.startsWith("_xlnm.") || oldName.startsWith("_FilterDatabase")) continue;
      const key = `${oldName}\u0000${old.getAttribute("localSheetId") ?? ""}`;
      const item = desired.get(key);
      if (!item) { names.removeChild(old); continue; }
      setText(old, item.ref.replace(/^=/, ""));
      desired.delete(key);
    }
    for (const item of desired.values()) {
      const name = new XmlElement("definedName", names.lookupPrefix(SML) ?? root.lookupPrefix(SML) ?? null);
      name.setAttribute("name", item.name);
      if (item.sheet) { const sheet = workbook.sheet(item.sheet); if (sheet) name.setAttribute("localSheetId", String(nativeSheetIndex(workbook, sheet))); }
      name.appendChild(new XmlText(item.ref.replace(/^=/, ""))); names.appendChild(name);
    }
    workbook._internal().markDirty(workbook._internal().workbook); return;
  }
  if (operation.kind === "set-workbook-properties") {
    const root = workbookRoot(workbook); let calc = root.find(SML, "calcPr");
    if (operation.calculationMode) { calc ??= new XmlElement("calcPr", root.lookupPrefix(SML) ?? null); if (!calc.parent) root.appendChild(calc); calc.setAttribute("calcMode", operation.calculationMode === "manual" ? "manual" : "auto"); }
    if (operation.activeSheetId) { const sheet = nativeSheetById(workbook, operation.activeSheetId, aliases); const index = nativeSheetIndex(workbook, sheet); for (const view of root.find(SML, "bookViews")?.elements().filter((node) => node.localName === "workbookView") ?? []) view.setAttribute("activeTab", String(index)); }
    workbook._internal().markDirty(workbook._internal().workbook); return;
  }
  const sheet = nativeSheetById(workbook, "sheetId" in operation ? operation.sheetId : "", aliases);
  if (operation.kind === "rename-sheet") {
    const oldName = sheet.name; sheetElement(sheet).setAttribute("name", operation.name);
    await rewriteWorkbookFormulas(workbook, (formula) => rewriteSheetNameInFormula(formula, oldName, operation.name));
    workbook._internal().markDirty(workbook._internal().workbook); return;
  }
  if (operation.kind === "mutate-sheet-axis") {
    if (operation.delta !== 1 && operation.delta !== -1) throw new Error("Excel row and column changes must be one line at a time.");
    const structuralDelta = operation.delta as 1 | -1;
    shiftNativeSheetCells(workbook, sheet, operation.axis, operation.at, structuralDelta);
    const dimensionDocument = await workbook.office.xml(sheet.partName);
    const dimension = worksheetDimension(dimensionDocument.root);
    setWorksheetRange(dimensionDocument.root, `A1:${columnName(Math.max(1, dimension.columns + (operation.axis === "column" ? structuralDelta : 0)) - 1)}${Math.max(1, dimension.rows + (operation.axis === "row" ? structuralDelta : 0))}`);
    workbook.office.markDirty(sheet.partName);
    await rewriteNativeRanges(workbook, sheet, operation.axis, operation.at, structuralDelta);
    await rewriteWorkbookFormulas(workbook, (formula, containingSheetName) => rewriteStructuralReferences(formula, operation.axis, operation.at, structuralDelta, { sheetName: sheet.name, unqualified: containingSheetName === sheet.name }));
    return;
  }
  if (operation.kind === "set-sheet-properties") { await setXlsxSheetProperties(workbook, sheet, operation.properties); return; }
  if (operation.kind === "upsert-table") { await upsertNativeTable(workbook, sheet, operation.table); return; }
  if (operation.kind === "remove-table") { await removeNativeTable(workbook, sheet, operation.tableId); return; }
  if (operation.kind === "set-validations") { await writeNativeValidations(workbook, sheet, operation.validations); return; }
  if (operation.kind === "set-conditional-formats") { await writeNativeConditionalFormats(workbook, sheet, operation.conditionalFormats); return; }
  if (operation.kind === "upsert-chart") {
    if (operation.chart.partName && await writeExistingChart(workbook, sheet, operation.chart)) return;
    await createNativeChart(workbook, sheet, operation.chart); return;
  }
  if (operation.kind === "remove-chart") { await removeNativeChart(workbook, sheet, operation.chartId); return; }
}

function nativeSheetIndex(workbook: Workbook, sheet: Worksheet) {
  return workbook._internal().sheetNames().findIndex((name) => name === sheet.name);
}
