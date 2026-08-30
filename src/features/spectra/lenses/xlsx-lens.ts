import { Workbook, parseCellRef, type CellStyleUpdate } from "@ariadng/office/xlsx";
import { dateToSerial } from "../sheets/excel-serial";
import { comparePackages } from "@ariadng/office/preservation";
import { XmlElement } from "@ariadng/office/xml";
import { sha256Payload } from "./payload-hash";
import { normalizedCellFormat, xlsxOperationsBetween } from "./office-content";
import type {
  LensCapabilitySet,
  LensCompatibilityProfile,
  LensExternalDiff,
  LensFidelityEntry,
  LensFidelityMap,
  LensOpenResult,
  LensPreservedCarry,
  SpectraLens,
} from "./types";
import {
  xlsxProjectionSchema,
  type XlsxProjection,
  type XlsxSemanticDelta,
  type XlsxSheetProjection,
} from "./projection-contracts";
import { XlsxLensError } from "./xlsx-errors";

export { XlsxLensError } from "./xlsx-errors";

const SML = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

export const XLSX_RECOGNIZED_FORMULAS = new Set([
  "ABS", "AVERAGE", "COUNT", "COUNTA", "IF", "MAX", "MIN", "ROUND", "SUM",
]);

export type { XlsxCellProjection, XlsxProjection, XlsxSemanticDelta, XlsxSheetProjection } from "./projection-contracts";

function descendants(root: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  const pending = [...root.elements()].reverse();
  while (pending.length) {
    const child = pending.pop()!;
    result.push(child);
    const nested = child.elements();
    for (let index = nested.length - 1; index >= 0; index -= 1) pending.push(nested[index]!);
  }
  return result;
}

function formulaFunctions(formula: string) {
  return [...formula.matchAll(/(?:^|[^A-Z0-9_.])(?:_xlfn\.)?([A-Z][A-Z0-9_.]*)\s*\(/gi)]
    .map((match) => match[1]!.toUpperCase());
}

function formulaSupport(formula: string) {
  const functions = formulaFunctions(formula);
  return functions.every((name) => XLSX_RECOGNIZED_FORMULAS.has(name))
    ? "recognized" as const
    : "cached-only" as const;
}

function worksheetFreeze(root: XmlElement) {
  const pane = root.find(SML, "sheetViews")?.find(SML, "sheetView")?.find(SML, "pane");
  const state = pane?.getAttribute("state");
  if (state !== "frozen" && state !== "frozenSplit") return { rows: 0, columns: 0 };
  return {
    rows: Math.max(0, Number(pane?.getAttribute("ySplit") ?? 0) || 0),
    columns: Math.max(0, Number(pane?.getAttribute("xSplit") ?? 0) || 0),
  };
}

function columnName(index: number) {
  let value = index;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result || "A";
}

const WORKSHEET_CHILD_ORDER = [
  "sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData",
  "sheetCalcPr", "sheetProtection", "protectedRanges", "scenarios", "autoFilter",
  "sortState", "dataConsolidate", "customSheetViews", "mergeCells", "phoneticPr",
  "conditionalFormatting", "dataValidations", "hyperlinks", "printOptions", "pageMargins",
  "pageSetup", "headerFooter", "rowBreaks", "colBreaks", "customProperties", "cellWatches",
  "ignoredErrors", "smartTags", "drawing", "legacyDrawing", "legacyDrawingHF", "picture",
  "oleObjects", "controls", "webPublishItems", "tableParts", "extLst",
];

function insertWorksheetChild(root: XmlElement, child: XmlElement) {
  const wanted = WORKSHEET_CHILD_ORDER.indexOf(child.localName);
  const reference = root.elements().find((candidate) => {
    const index = WORKSHEET_CHILD_ORDER.indexOf(candidate.localName);
    return index >= 0 && index > wanted;
  });
  root.insertBefore(child, reference ?? null);
}

async function setWorksheetFreeze(workbook: Workbook, partName: string, rows: number, columns: number) {
  const doc = await workbook.office.xml(partName);
  let views = doc.root.find(SML, "sheetViews");
  const prefix = doc.root.lookupPrefix(SML) ?? null;
  if (!views) {
    views = new XmlElement("sheetViews", prefix);
    insertWorksheetChild(doc.root, views);
  }
  let view = views.find(SML, "sheetView");
  if (!view) {
    view = new XmlElement("sheetView", prefix);
    view.setAttribute("workbookViewId", "0");
    views.appendChild(view);
  }
  const existingPane = view.find(SML, "pane");
  if (existingPane && ["frozen", "frozenSplit"].includes(existingPane.getAttribute("state") ?? ""))
    view.removeChild(existingPane);
  if (rows || columns) {
    const pane = new XmlElement("pane", prefix);
    if (columns) pane.setAttribute("xSplit", String(columns));
    if (rows) pane.setAttribute("ySplit", String(rows));
    pane.setAttribute("topLeftCell", `${columnName(columns + 1)}${rows + 1}`);
    pane.setAttribute("activePane", rows && columns ? "bottomRight" : rows ? "bottomLeft" : "topRight");
    pane.setAttribute("state", "frozen");
    view.insertBefore(pane, view.elements()[0] ?? null);
  }
  workbook.office.markDirty(partName);
}

function numberFormatCode(format: Record<string, unknown>) {
  const kind = format.numberFormat;
  const decimals = Math.max(0, Math.min(12, Number(format.decimals ?? 0) || 0));
  const zeroes = decimals ? `.${"0".repeat(decimals)}` : "";
  const grouping = format.thousands === false ? "0" : "#,##0";
  if (kind === "custom" && typeof format.customFormat === "string") return format.customFormat;
  if (kind === "text") return "@";
  if (kind === "percent") return `0${zeroes}%`;
  if (kind === "fraction") return "# ?/?";
  if (kind === "scientific") return `0${zeroes || ".00"}E+00`;
  if (kind === "date") return "yyyy-mm-dd";
  if (kind === "time") return decimals ? "h:mm:ss.000" : "h:mm:ss";
  if (kind === "currency" || kind === "accounting") {
    const currency = typeof format.currency === "string" ? format.currency : "USD";
    return `[$${currency}] ${grouping}${zeroes}`;
  }
  if (kind === "number") return `${grouping}${zeroes}`;
  return null;
}

function styleUpdate(format: Record<string, unknown>): CellStyleUpdate {
  type MutableUpdate = { -readonly [Key in keyof CellStyleUpdate]?: CellStyleUpdate[Key] };
  const update: MutableUpdate = {};
  const full = format.__full && typeof format.__full === "object"
    ? format.__full as Record<string, unknown>
    : format;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(format, key);
  if (has("bold")) update.bold = format.bold === true;
  if (has("italic")) update.italic = format.italic === true;
  if (has("underline")) update.underline = format.underline === true;
  if (has("strike")) update.strike = format.strike === true;
  if (has("fontFamily")) {
    const family = format.fontFamily;
    update.fontName = family === "mono"
      ? "Consolas"
      : family === "serif"
        ? "Cambria"
        : family === "sans" || typeof family !== "string"
          ? "Calibri"
          : family;
  }
  if (has("fontSize")) update.fontSize = typeof format.fontSize === "number" ? format.fontSize : 11;
  if (has("textColor")) update.color = typeof format.textColor === "string" ? format.textColor : null;
  if (has("fillColor")) update.fill = typeof format.fillColor === "string" ? format.fillColor : null;
  if (["numberFormat", "customFormat", "currency", "decimals", "thousands"].some(has))
    update.numberFormat = numberFormatCode(full);
  if (has("borders")) {
    const borders = format.borders && typeof format.borders === "object"
      ? format.borders as Record<string, unknown>
      : undefined;
    update.border = borders
      ? Object.fromEntries(
          (["top", "right", "bottom", "left"] as const).map((edge) => {
            const value = borders[edge];
            if (!value || typeof value !== "object") return [edge, null];
            const record = value as Record<string, unknown>;
            return [edge, {
              style: record.style,
              ...(typeof record.color === "string" ? { color: record.color } : {}),
            }];
          }),
        ) as NonNullable<CellStyleUpdate["border"]>
      : null;
  }
  if (has("align"))
    update.align = format.align === "left" || format.align === "center" || format.align === "right" || format.align === "justify"
      ? format.align
      : "general";
  if (has("verticalAlign"))
    update.valign = format.verticalAlign === "middle"
      ? "center"
      : format.verticalAlign === "top" || format.verticalAlign === "bottom"
        ? format.verticalAlign
        : "bottom";
  if (has("wrap")) update.wrapText = format.wrap === true;
  if (has("indent")) update.indent = typeof format.indent === "number" ? format.indent : 0;
  if (has("rotation")) {
    const rotation = typeof format.rotation === "number" ? format.rotation : 0;
    update.textRotation = rotation < 0 ? 90 - rotation : rotation;
  }
  return update;
}

async function clearCellStyle(workbook: Workbook, partName: string, ref: string) {
  const doc = await workbook.office.xml(partName);
  const cell = descendants(doc.root).find(
    (element) => element.namespaceUri() === SML && element.localName === "c" && element.getAttribute("r")?.toUpperCase() === ref.toUpperCase(),
  );
  if (cell?.removeAttribute("s")) workbook.office.markDirty(partName);
}

async function projectWorkbook(workbook: Workbook, profile: LensCompatibilityProfile) {
  const date1904 = workbook._date1904();
  const entries: LensFidelityEntry[] = [];
  const sheets: XlsxSheetProjection[] = [];
  for (const sheet of workbook.sheets()) {
    const doc = await workbook.office.xml(sheet.partName);
    const freeze = worksheetFreeze(doc.root);
    const refs = descendants(doc.root)
      .filter((node) => node.namespaceUri() === SML && node.localName === "c")
      .map((node) => node.getAttribute("r"))
      .filter((ref): ref is string => Boolean(ref));
    const cells = refs.map((ref) => {
      const info = sheet.getCellInfo(ref);
      const formula = sheet.getFormula(ref) ?? undefined;
      const support = formula ? formulaSupport(formula) : undefined;
      const id = `xlsx:${sheet.sheetId}:${ref.toUpperCase()}`;
      entries.push({
        regionId: id,
        feature: formula ? (support === "recognized" ? "recognized-formula" : "unrecognized-formula") : "cell",
        class: "NATIVE",
        partName: sheet.partName,
        ...(formula && support === "cached-only"
          ? { class: "EXTENSION" as const, reason: "Spectra shows Excel's cached value and preserves the native formula text. Formula text remains editable." }
          : {}),
      });
      return {
        id,
        ref: ref.toUpperCase(),
        value:
          info.value instanceof Date
            ? dateToSerial(info.value, date1904)
            : info.value,
        ...(formula ? { formula, formulaSupport: support } : {}),
        style: sheet.getCellStyle(ref) as unknown as Record<string, unknown>,
        format: normalizedCellFormat(sheet.getCellStyle(ref) as unknown as Record<string, unknown>),
      };
    });
    sheets.push({
      id: `xlsx:sheet:${sheet.sheetId}`,
      name: sheet.name,
      cells,
      merges: sheet.merges(),
      frozenRows: freeze.rows,
      frozenColumns: freeze.columns,
    });
  }
  const regionEntries: ReadonlyArray<[string, LensFidelityEntry["class"], string?]> = [
    ["cells", "NATIVE"], ["formulas", "NATIVE"], ["styles", "NATIVE"],
    ["numberFormats", "NATIVE"], ["merges", "NATIVE"], ["freezePanes", "NATIVE"],
    ["charts", "PRESERVED", "Excel chart parts are preserved, but Spectra does not author or rewrite them."],
    ["tables", "PRESERVED", "Excel table definitions are preserved until their structure has a native writer."],
    ["validation", "PRESERVED", "Excel data validation is preserved until its rules have a native writer."],
    ["conditionalFormat", "PRESERVED", "Excel conditional formatting is preserved until its rules have a native writer."],
    ["namedRanges", "PRESERVED", "Workbook names are preserved until their scope and references have a complete native writer."],
    ["pivotTables", "PRESERVED", "Pivot tables remain owned by Excel."],
    ["comments", "PRESERVED", "Cell comments and notes remain owned by Excel."],
    ["sheetStructure", "PRESERVED", "Worksheet lifecycle and row or column topology changes are unavailable for mounted workbooks."],
    ["dimensions", "PRESERVED", "Row and column size or visibility changes are unavailable for mounted workbooks."],
    ["sheetViews", "PRESERVED", "Gridline and heading view settings are preserved as Excel wrote them."],
    ["sheetMetadata", "PRESERVED", "Worksheet tab and visibility metadata are preserved as Excel wrote them."],
    ["calculationSettings", "PRESERVED", "Workbook calculation settings remain owned by Excel."],
    ["sortFilter", "PRESERVED", "Excel filter state is preserved until its native references and criteria have a complete writer."],
  ];
  for (const [feature, fidelityClass, reason] of regionEntries)
    entries.push({
      regionId: `xlsx:region:${feature}`,
      feature,
      class: fidelityClass,
      ...(fidelityClass === "PRESERVED" ? { readOnly: true } : {}),
      ...(reason ? { reason } : {}),
    });
  const partNames = workbook.office.package.parts().map((part) => part.name);
  const preserved: Array<[string, RegExp]> = [
    ["pivot", /\/pivot/i], ["chart", /\/charts\//i],
    ["external-link", /\/externalLinks\//i], ["comment", /\/comments/i], ["sparkline", /sparkline/i],
    ["unknown-extension", /unknown|future|extension/i],
  ];
  for (const [feature, pattern] of preserved) {
    const partName = partNames.find((name) => pattern.test(name));
    if (partName) entries.push({ regionId: `xlsx:feature:${feature}`, feature, class: "PRESERVED", partName, readOnly: true });
  }
  for (const sheet of workbook.sheets()) {
    const doc = await workbook.office.xml(sheet.partName);
    if (
      descendants(doc.root).some(
        (node) => node.namespaceUri() === SML && node.localName === "conditionalFormatting",
      )
    ) {
      entries.push({
        regionId: `xlsx:feature:conditional-formatting:${sheet.sheetId}`,
        feature: "conditional-formatting",
        class: "PRESERVED",
        partName: sheet.partName,
        pathPattern: "conditionalFormatting",
        readOnly: true,
      });
    }
  }
  if (workbook.office.format.macroEnabled) {
    const partName = partNames.find((name) => /\/xl\/vbaProject\.bin$/i.test(name));
    entries.push({ regionId: "xlsx:feature:macro", feature: "macro", class: "PRESERVED", partName, readOnly: true, reason: "Macros remain byte-identical and are never executed by Spectra." });
  }
  const fidelityMap: LensFidelityMap = { version: 1, profile, entries };
  const definedNames = workbook.definedNames().map((item) => ({ name: item.name, ref: item.ref, ...(item.sheet ? { sheet: item.sheet } : {}) }));
  const semanticDigest = await sha256Payload(new TextEncoder().encode(JSON.stringify({
    sheets: sheets.map((sheet) => ({
      name: sheet.name,
      cells: sheet.cells.map(({ ref, value, formula, format }) => ({ ref, value, formula, format })),
      merges: sheet.merges,
      frozenRows: sheet.frozenRows,
      frozenColumns: sheet.frozenColumns,
    })),
    definedNames,
  })));
  const projection = xlsxProjectionSchema.parse({
    sheets,
    definedNames,
    nativeBinding: {
      version: 1,
      format: workbook.office.format.extension as XlsxProjection["nativeBinding"]["format"],
      profile,
      macroEnabled: workbook.office.format.macroEnabled,
      semanticDigest,
      recognizedFormulaFunctions: [...XLSX_RECOGNIZED_FORMULAS].sort(),
      ...(workbook._date1904() ? { date1904: true } : {}),
    },
  });
  return { projection, fidelityMap };
}

function findSheet(workbook: Workbook, sheetId: string) {
  const id = Number(sheetId.replace(/^xlsx:sheet:/, ""));
  const sheet = workbook.sheets().find((candidate) => candidate.sheetId === id);
  if (!sheet) throw new XlsxLensError("XLSX_SHEET_MISSING", "The target Excel sheet no longer exists.");
  return sheet;
}

async function applyDelta(carry: LensPreservedCarry<XlsxProjection>, delta: XlsxSemanticDelta) {
  const workbook = await Workbook.open(carry.payload);
  const operations = delta.kind === "ai-edit" ? delta.operations : [delta];
  for (const operation of operations) {
    const sheet = findSheet(workbook, operation.sheetId);
    if ("ref" in operation) parseCellRef(operation.ref);
    if (operation.kind === "set-formula") sheet.setFormula(operation.ref, operation.formula);
    else if (operation.kind === "clear-cell") sheet.setCell(operation.ref, null);
    else if (operation.kind === "set-cell-format") {
      if (Object.keys(operation.format).length) sheet.setCellStyle(operation.ref, styleUpdate(operation.format));
      else await clearCellStyle(workbook, sheet.partName, operation.ref);
    }
    else if (operation.kind === "merge-cells") sheet.merge(operation.range);
    else if (operation.kind === "unmerge-cells") sheet.unmerge(operation.range);
    else if (operation.kind === "set-freeze-panes")
      await setWorksheetFreeze(workbook, sheet.partName, operation.rows, operation.columns);
    else {
      if (sheet.getFormula(operation.ref)) throw new XlsxLensError("XLSX_FORMULA_LITERALIZATION_BLOCKED", "A formula cell cannot be replaced by a literal through a value edit. Edit its formula text instead.");
      sheet.setCell(operation.ref, operation.value);
    }
  }
  return workbook.save();
}

export const xlsxLens: SpectraLens<XlsxProjection, XlsxSemanticDelta> = {
  format: "xlsx",
  async open(payload, profile = "strict-native"): Promise<LensOpenResult<XlsxProjection>> {
    let workbook: Workbook;
    try { workbook = await Workbook.open(payload); }
    catch (error) { throw new XlsxLensError("XLSX_CORRUPT", `This Excel package could not be opened safely.${error instanceof Error ? ` (${error.message})` : ""}`); }
    const { projection, fidelityMap } = await projectWorkbook(workbook, profile);
    return { projection, fidelityMap, preservedCarry: { version: 1, format: projection.nativeBinding.format, profile, basePayloadHash: await sha256Payload(payload), payload, projection }, capabilities: this.capabilities(profile, fidelityMap) };
  },
  mutate: applyDelta,
  async materialize({ projection, carry }) {
    const operations = xlsxOperationsBetween(carry.projection, projection);
    return operations.length ? applyDelta(carry, { kind: "ai-edit", operations }) : carry.payload;
  },
  async diffExternal(payloadA, payloadB): Promise<LensExternalDiff> {
    const [before, after, comparison] = await Promise.all([this.open(payloadA), this.open(payloadB), comparePackages(payloadA, payloadB)]);
    const previous = new Map(before.projection.sheets.flatMap((sheet) => sheet.cells.map((cell) => [cell.id, cell] as const)));
    const changes: LensExternalDiff["changes"] = [];
    for (const cell of after.projection.sheets.flatMap((sheet) => sheet.cells)) {
      const old = previous.get(cell.id); previous.delete(cell.id);
      if (!old) changes.push({ regionId: cell.id, kind: "insert", after: cell });
      else if (JSON.stringify(old) !== JSON.stringify(cell)) changes.push({ regionId: cell.id, kind: "update", before: old, after: cell });
    }
    for (const cell of previous.values()) changes.push({ regionId: cell.id, kind: "delete", before: cell });
    const beforeSheets = new Map(before.projection.sheets.map((sheet) => [sheet.id, sheet]));
    for (const sheet of after.projection.sheets) {
      const old = beforeSheets.get(sheet.id);
      if (!old) continue;
      if (JSON.stringify(old.merges) !== JSON.stringify(sheet.merges))
        changes.push({ regionId: `${sheet.id}:merges`, kind: "update", before: old.merges, after: sheet.merges });
      if (old.frozenRows !== sheet.frozenRows || old.frozenColumns !== sheet.frozenColumns)
        changes.push({
          regionId: `${sheet.id}:freezePanes`,
          kind: "update",
          before: { rows: old.frozenRows, columns: old.frozenColumns },
          after: { rows: sheet.frozenRows, columns: sheet.frozenColumns },
        });
    }
    const changedParts = comparison.parts.filter((part) => part.verdict !== "identical").map((part) => `/${part.name}`);
    const modeled = new Set([
      "/xl/workbook.xml",
      "/xl/styles.xml",
      "/xl/sharedStrings.xml",
      ...after.projection.sheets.map((sheet) => workbookPart(sheet, after.projection)),
    ]);
    const preservedPartChanges = changedParts.filter((part) => !modeled.has(part));
    return { changes, changedParts, preservedPartChanges };
  },
  capabilities(profile, fidelityMap): LensCapabilitySet {
    const cachedOnly = fidelityMap.entries.some((entry) => entry.feature === "unrecognized-formula");
    return { profile, human: [
      { id: "edit-cell", available: true },
      { id: "edit-formula-text", available: true },
      { id: "recalculate-recognized-formula", available: true },
      { id: "recalculate-unrecognized-formula", available: false, reason: cachedOnly ? "Excel owns recalculation for formulas outside Spectra's recognized set; the cached value remains visible." : "No cached-only formulas are present." },
      { id: "edit-pivot", available: false, reason: "Pivot tables are preserved for Excel and are not editable in Spectra yet." },
    ], aiOperations: ["set_cell", "set_formula"] };
  },
};

function workbookPart(sheet: XlsxSheetProjection, projection: XlsxProjection) {
  const index = projection.sheets.findIndex((candidate) => candidate.id === sheet.id);
  return `/xl/worksheets/sheet${index + 1}.xml`;
}
