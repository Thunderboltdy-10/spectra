import { Workbook, parseCellRef, type CellStyleUpdate } from "@ariadng/office/xlsx";
import { dateToSerial } from "../sheets/excel-serial";
import { comparePackages } from "@ariadng/office/preservation";
import { XmlElement } from "@ariadng/office/xml";
import { OFFICE_ARCHIVE_LIMITS, prepareBoundedArchiveBytes } from "../../../../shared/parser-limits";
import { sha256Payload } from "./docx-lens";
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
import {
  XLSX_RECOGNIZED_FORMULAS,
  xlsxFormulaSupport,
} from "./xlsx-formula-support";
import { invalidateXlsxFormulaCaches } from "./xlsx-cache-policy";
import {
  applyXlsxNativeOperation,
  nativeSheetById,
  projectXlsxSheet,
  updateNativeChartCaches,
  SML as NATIVE_SML,
} from "./xlsx-native";

const SML = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

export { XLSX_RECOGNIZED_FORMULAS } from "./xlsx-formula-support";

export type { XlsxCellProjection, XlsxProjection, XlsxSemanticDelta, XlsxSheetProjection } from "./projection-contracts";

export class XlsxLensError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "XlsxLensError";
  }
}

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

function formulaSupport(formula: string) {
  return xlsxFormulaSupport(formula);
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
    const nativeExtras = await projectXlsxSheet(workbook, sheet);
    const cellNodes = new Map(
      descendants(doc.root)
        .filter((node) => node.namespaceUri() === SML && node.localName === "c")
        .flatMap((node) => {
          const ref = node.getAttribute("r");
          return ref ? [[ref.toUpperCase(), node] as const] : [];
        }),
    );
    const refs = descendants(doc.root)
      .filter((node) => node.namespaceUri() === SML && node.localName === "c")
      .map((node) => node.getAttribute("r"))
      .filter((ref): ref is string => Boolean(ref));
    const cells = refs.map((ref) => {
      const info = sheet.getCellInfo(ref);
      const formula = sheet.getFormula(ref) ?? undefined;
      const support = formula ? formulaSupport(formula) : undefined;
      const cellNode = cellNodes.get(ref.toUpperCase());
      const formulaNode = cellNode?.find(SML, "f");
      const formulaCache: "present" | "absent" | undefined = formulaNode
        ? (cellNode?.find(SML, "v") || cellNode?.find(SML, "is") ? "present" : "absent")
        : undefined;
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
        ...(formula && formulaCache ? { formulaCache } : {}),
        style: sheet.getCellStyle(ref) as unknown as Record<string, unknown>,
        format: normalizedCellFormat(sheet.getCellStyle(ref) as unknown as Record<string, unknown>),
      };
    });
    sheets.push({
      id: `xlsx:sheet:${sheet.sheetId}`,
      name: sheet.name,
      cells,
      defaultCellFormat: normalizedCellFormat(
        sheet.getCellStyle("XFD1048576") as unknown as Record<string, unknown>,
      ),
      merges: sheet.merges(),
      frozenRows: freeze.rows,
      frozenColumns: freeze.columns,
      ...nativeExtras,
    });
  }
  const workbookRoot = workbook._internal().workbook.doc.root;
  const calculationMode = workbookRoot.find(NATIVE_SML, "calcPr")?.getAttribute("calcMode") === "manual"
    ? "manual" as const
    : "automatic" as const;
  const activeTab = Number(workbookRoot.find(NATIVE_SML, "bookViews")?.find(NATIVE_SML, "workbookView")?.getAttribute("activeTab") ?? 0);
  const activeSheetId = sheets[activeTab]?.id ?? sheets[0]?.id;
  const hasValidations = sheets.some((sheet) => Boolean(sheet.validations?.length));
  const hasConditionalFormats = sheets.some((sheet) => Boolean(sheet.conditionalFormats?.length));
  const hasEditableValidations = sheets.some((sheet) => (sheet.validations ?? []).some((rule) => ["list", "whole", "decimal", "date", "time"].includes(String(rule.type))));
  const hasEditableConditionalFormats = sheets.some((sheet) => (sheet.conditionalFormats ?? []).some((group) => Array.isArray(group.rules) && group.rules.some((rule) => (rule.type === "cellIs" && rule.operator !== "notBetween") || rule.type === "containsText" || (rule.type === "colorScale" && Array.isArray((rule.colorScale as Record<string, unknown> | undefined)?.colors) && ((rule.colorScale as Record<string, unknown>).colors as unknown[]).length === 2))));
  const definedNames = workbook.definedNames().map((item) => ({ name: item.name, ref: item.ref, ...(item.sheet ? { sheet: item.sheet } : {}) }));
  const regionEntries: ReadonlyArray<[string, LensFidelityEntry["class"], string?]> = [
    ["cells", "NATIVE"], ["formulas", "NATIVE"], ["styles", "NATIVE"],
    ["numberFormats", "NATIVE"], ["merges", "NATIVE"], ["freezePanes", "NATIVE"],
    // Authoring support does not depend on a feature already being present.
    // Detected unsupported structures retain their separate preservation rows.
    ["charts", "NATIVE"], ["tables", "NATIVE"],
    ["validation", !hasValidations || hasEditableValidations ? "NATIVE" : "PRESERVED", !hasValidations || hasEditableValidations ? undefined : "Unsupported Excel validation types remain preserved for Excel."],
    ["conditionalFormat", !hasConditionalFormats || hasEditableConditionalFormats ? "NATIVE" : "PRESERVED", !hasConditionalFormats || hasEditableConditionalFormats ? undefined : "Unsupported Excel conditional-format types remain preserved for Excel."],
    ["namedRanges", "NATIVE"],
    ["pivotTables", "PRESERVED", "Pivot tables remain owned by Excel."],
    ["comments", "PRESERVED", "Cell comments and notes remain owned by Excel."],
    ["sheetStructure", "NATIVE"], ["dimensions", "NATIVE"],
    ["sheetViews", "NATIVE"], ["sheetMetadata", "NATIVE"],
    ["calculationSettings", "NATIVE"], ["sortFilter", "NATIVE"],
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
    ["pivot", /\/pivot/i],
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
        class: hasEditableConditionalFormats ? "NATIVE" : "PRESERVED",
        partName: sheet.partName,
        pathPattern: "conditionalFormatting",
        ...(hasEditableConditionalFormats ? {} : { readOnly: true }),
      });
    }
  }
  if (workbook.office.format.macroEnabled) {
    const partName = partNames.find((name) => /\/xl\/vbaProject\.bin$/i.test(name));
    entries.push({ regionId: "xlsx:feature:macro", feature: "macro", class: "PRESERVED", partName, readOnly: true, reason: "Macros remain byte-identical and are never executed by Spectra." });
  }
  const fidelityMap: LensFidelityMap = { version: 1, profile, entries };
  const semanticDigest = await xlsxSemanticDigest({ calculationMode, activeSheetId, sheets, definedNames });
  const projection = xlsxProjectionSchema.parse({
    sheets,
    definedNames,
    calculationMode,
    ...(activeSheetId ? { activeSheetId } : {}),
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
  try { return nativeSheetById(workbook, sheetId); }
  catch { throw new XlsxLensError("XLSX_SHEET_MISSING", "The target Excel sheet no longer exists."); }
}

/** Hash the intended semantic state, not the binding retained from import. */
export async function xlsxSemanticDigest(
  { calculationMode, activeSheetId, sheets, definedNames }: Pick<XlsxProjection, "calculationMode" | "activeSheetId" | "sheets" | "definedNames">,
) {
  return sha256Payload(new TextEncoder().encode(JSON.stringify({
    calculationMode,
    activeSheetId,
    sheets: sheets.map((sheet) => ({
      name: sheet.name,
      cells: sheet.cells.map(({ ref, value, formula, format }) => ({ ref, value, formula, format })),
      merges: sheet.merges,
      frozenRows: sheet.frozenRows,
      frozenColumns: sheet.frozenColumns,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      hiddenRows: sheet.hiddenRows,
      hiddenColumns: sheet.hiddenColumns,
      columnWidths: sheet.columnWidths,
      rowHeights: sheet.rowHeights,
      hidden: sheet.hidden,
      showGridlines: sheet.showGridlines,
      showHeadings: sheet.showHeadings,
      tables: sheet.tables,
      charts: sheet.charts,
      validations: sheet.validations,
      conditionalFormats: sheet.conditionalFormats,
    })),
    definedNames,
  })));
}

async function applyDelta(carry: LensPreservedCarry<XlsxProjection>, delta: XlsxSemanticDelta) {
  const workbook = await Workbook.open(carry.safePayload ?? carry.payload);
  const operations = delta.kind === "ai-edit" ? delta.operations : [delta];
  let formulaCachesNeedInvalidation = false;
  const aliases = new Map<string, number>();
  for (const operation of operations) {
    if ([
      "add-sheet", "remove-sheet", "rename-sheet", "reorder-sheets",
      "set-defined-names", "set-workbook-properties", "set-sheet-properties",
      "mutate-sheet-axis", "upsert-table", "remove-table", "upsert-chart", "remove-chart",
      "set-validations", "set-conditional-formats",
    ].includes(operation.kind)) {
      try { await applyXlsxNativeOperation(workbook, operation, aliases); }
      catch (error) { throw new XlsxLensError("XLSX_NATIVE_WRITE_REFUSED", error instanceof Error ? error.message : "The native Excel edit is not safe to apply."); }
      if (["rename-sheet", "reorder-sheets", "set-defined-names", "mutate-sheet-axis"].includes(operation.kind)) formulaCachesNeedInvalidation = true;
      continue;
    }
    if (!("sheetId" in operation))
      throw new XlsxLensError("XLSX_NATIVE_WRITE_REFUSED", "The Excel operation does not target an editable cell.");
    const sheet = (() => {
      try { return aliases.has(operation.sheetId) ? nativeSheetById(workbook, operation.sheetId, aliases) : findSheet(workbook, operation.sheetId); }
      catch { throw new XlsxLensError("XLSX_SHEET_MISSING", "The target Excel sheet no longer exists."); }
    })();
    if (!("ref" in operation)) {
      if (operation.kind === "merge-cells") sheet.merge(operation.range);
      else if (operation.kind === "unmerge-cells") sheet.unmerge(operation.range);
      else if (operation.kind === "set-freeze-panes") await setWorksheetFreeze(workbook, sheet.partName, operation.rows, operation.columns);
      else throw new XlsxLensError("XLSX_NATIVE_WRITE_REFUSED", "The Excel operation does not target an editable cell.");
      continue;
    }
    parseCellRef(operation.ref);
    if (operation.kind === "set-formula") {
      sheet.setFormula(operation.ref, operation.formula);
      formulaCachesNeedInvalidation = true;
    }
    else if (operation.kind === "clear-cell") {
      sheet.setCell(operation.ref, null);
      formulaCachesNeedInvalidation = true;
    }
    else if (operation.kind === "set-cell-format") {
      if (Object.keys(operation.format).length) sheet.setCellStyle(operation.ref, styleUpdate(operation.format));
      else await clearCellStyle(workbook, sheet.partName, operation.ref);
    }
    else {
      if (sheet.getFormula(operation.ref)) throw new XlsxLensError("XLSX_FORMULA_LITERALIZATION_BLOCKED", "A formula cell cannot be replaced by a literal through a value edit. Edit its formula text instead.");
      sheet.setCell(operation.ref, operation.value);
      formulaCachesNeedInvalidation = true;
    }
  }
  if (formulaCachesNeedInvalidation)
    await invalidateXlsxFormulaCaches(workbook);
  if (formulaCachesNeedInvalidation || operations.some((operation) => operation.kind === "upsert-chart" || operation.kind === "upsert-table"))
    await updateNativeChartCaches(workbook);
  return workbook.save();
}

export const xlsxLens: SpectraLens<XlsxProjection, XlsxSemanticDelta> = {
  format: "xlsx",
  async open(payload, profile = "strict-native"): Promise<LensOpenResult<XlsxProjection>> {
    let workbook: Workbook;
    let safePayload: Uint8Array;
    try { safePayload = await prepareBoundedArchiveBytes(payload, OFFICE_ARCHIVE_LIMITS); workbook = await Workbook.open(safePayload); }
    catch (error) { throw new XlsxLensError("XLSX_CORRUPT", `This Excel package could not be opened safely.${error instanceof Error ? ` (${error.message})` : ""}`); }
    const { projection, fidelityMap } = await projectWorkbook(workbook, profile);
    return { projection, fidelityMap, preservedCarry: { version: 1, format: projection.nativeBinding.format, profile, basePayloadHash: await sha256Payload(payload), payload, safePayload, projection }, capabilities: this.capabilities(profile, fidelityMap) };
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
      if (!old) {
        changes.push({ regionId: sheet.id, kind: "insert", after: sheet });
        continue;
      }
      beforeSheets.delete(sheet.id);
      if (old.name !== sheet.name || old.partName !== sheet.partName)
        changes.push({ regionId: `${sheet.id}:structure`, kind: "update", before: { name: old.name, partName: old.partName }, after: { name: sheet.name, partName: sheet.partName } });
      if (JSON.stringify(old.merges) !== JSON.stringify(sheet.merges))
        changes.push({ regionId: `${sheet.id}:merges`, kind: "update", before: old.merges, after: sheet.merges });
      if (old.frozenRows !== sheet.frozenRows || old.frozenColumns !== sheet.frozenColumns)
        changes.push({
          regionId: `${sheet.id}:freezePanes`,
          kind: "update",
          before: { rows: old.frozenRows, columns: old.frozenColumns },
          after: { rows: sheet.frozenRows, columns: sheet.frozenColumns },
        });
      for (const [region, beforeValue, afterValue] of [
        ["tables", old.tables, sheet.tables],
        ["charts", old.charts, sheet.charts],
        ["dimensions", {
          rowCount: old.rowCount, columnCount: old.columnCount, hiddenRows: old.hiddenRows, hiddenColumns: old.hiddenColumns,
          columnWidths: old.columnWidths, rowHeights: old.rowHeights,
        }, {
          rowCount: sheet.rowCount, columnCount: sheet.columnCount, hiddenRows: sheet.hiddenRows, hiddenColumns: sheet.hiddenColumns,
          columnWidths: sheet.columnWidths, rowHeights: sheet.rowHeights,
        }],
        ["views", { hidden: old.hidden, showGridlines: old.showGridlines, showHeadings: old.showHeadings, tabColor: old.tabColor }, { hidden: sheet.hidden, showGridlines: sheet.showGridlines, showHeadings: sheet.showHeadings, tabColor: sheet.tabColor }],
      ] as const) {
        if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue))
          changes.push({ regionId: `${sheet.id}:${region}`, kind: "update", before: beforeValue, after: afterValue });
      }
    }
    for (const sheet of beforeSheets.values()) changes.push({ regionId: sheet.id, kind: "delete", before: sheet });
    if (JSON.stringify(before.projection.definedNames) !== JSON.stringify(after.projection.definedNames))
      changes.push({ regionId: "xlsx:defined-names", kind: "update", before: before.projection.definedNames, after: after.projection.definedNames });
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
      { id: "edit-native-chart", available: true, reason: "Supported Excel chart families remain native and editable; unsupported families are refused safely." },
      { id: "edit-native-table", available: true, reason: "Table range, headers, totals, style, filter values, and sort state use native table parts." },
      { id: "edit-sheet-structure", available: true, reason: "Worksheet lifecycle, order, visibility, names, dimensions, and views use stable native worksheet parts." },
      { id: "edit-pivot", available: false, reason: "Pivot tables are preserved for Excel and are not editable in Spectra yet." },
    ], aiOperations: ["set_cell", "set_formula"] };
  },
};

function workbookPart(sheet: XlsxSheetProjection, projection: XlsxProjection) {
  if (sheet.partName) return sheet.partName;
  const index = projection.sheets.findIndex((candidate) => candidate.id === sheet.id);
  return `/xl/worksheets/sheet${index + 1}.xml`;
}
