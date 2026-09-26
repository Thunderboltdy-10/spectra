import { presentationObjectText, type PresentationContent, type PresentationObject, type PresentationParagraph } from "../presentation/model";
import {
  parseRange,
  rangeAddresses,
  type SheetCellFormat,
  type SheetConditionalFormat,
  type SheetValidation,
  type SheetsContent,
} from "../sheets/model";
import {
  decodeSheetsContentFromStorage,
  encodeArtifactContentForStorage,
  sheetCellEntries,
} from "../../../../shared/sheet-cells";
import { dateToSerial } from "../sheets/excel-serial";
import { z } from "zod";
import {
  pptxProjectionSchema,
  presentationObjectProjectionSchema,
  xlsxProjectionSchema,
  type PptxOperation,
  type PptxProjection,
  type XlsxOperation,
  type XlsxProjection,
} from "./projection-contracts";
import { xlsxFormulaSupport } from "./xlsx-formula-support";
import { parseAddress, columnName } from "../sheets/model";
import { quoteSheetPrefix } from "../sheets/formula-refs";
import { normalizeNativeFontFamily } from "../office-fonts";

function codedOfficeContentError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedNumberFormat(value: unknown) {
  const native = record(value);
  const code =
    typeof value === "string"
      ? value
      : typeof native.code === "string"
        ? native.code
        : "General";
  if (/[%]/.test(code)) return "percent" as const;
  if (/[$€£¥]|\[\$/.test(code)) return "currency" as const;
  if (/[dmyhs]/i.test(code.replace(/\[[^\]]*]/g, ""))) return "date" as const;
  if (code.toLowerCase() === "general") return "general" as const;
  return "number" as const;
}

function decimalPlaces(value: unknown) {
  const native = record(value);
  const code =
    typeof value === "string"
      ? value
      : typeof native.code === "string"
        ? native.code
        : "";
  const match = code.match(/\.(0+|#+)/);
  return match ? Math.min(match[1]!.length, 12) : undefined;
}

/**
 * The Office reader returns a rich native style object. The Sheets editor has
 * a deliberately smaller semantic style contract, so only equivalent fields
 * cross this boundary. The complete native style remains in preserved carry
 * and is reused by materialization; copying it into the Sheets model would
 * make the collaborative Yjs document fail its own schema validation.
 */
function normalizedColor(value: unknown) {
  if (typeof value !== "string") return undefined;
  const hex = value.replace(/^#/, "");
  return `#${hex.length === 8 ? hex.slice(2) : hex}`;
}

function normalizedFontFamily(value: unknown) {
  if (typeof value !== "string") return undefined;
  if (/consolas|courier|mono/i.test(value)) return "mono" as const;
  if (/cambria|times|georgia|serif/i.test(value)) return "serif" as const;
  return "sans" as const;
}

export function normalizedCellFormat(
  format: Record<string, unknown> | undefined,
): SheetCellFormat | undefined {
  if (!format) return undefined;
  const font = record(format.font);
  const alignment = record(format.alignment);
  const fill = record(format.fill);
  const nativeBorders = record(format.border);
  const horizontal = alignment.horizontal;
  const vertical = alignment.vertical;
  const decimals = decimalPlaces(format.numberFormat);
  const underline = font.underline;
  const numberFormatRecord = record(format.numberFormat);
  const nativeCode =
    typeof numberFormatRecord.code === "string"
      ? numberFormatRecord.code
      : undefined;
  const borders = Object.fromEntries(
    (["top", "right", "bottom", "left"] as const).flatMap((edge) => {
      const native = record(nativeBorders[edge]);
      if (typeof native.style !== "string") return [];
      return [
        [
          edge,
          {
            style: native.style,
            ...(normalizedColor(native.color)
              ? { color: normalizedColor(native.color) }
              : {}),
          },
        ],
      ];
    }),
  );
  const rotation =
    typeof alignment.textRotation === "number"
      ? alignment.textRotation > 90
        ? 90 - alignment.textRotation
        : alignment.textRotation
      : undefined;
  return {
    ...(typeof font.bold === "boolean" ? { bold: font.bold } : {}),
    ...(typeof font.italic === "boolean" ? { italic: font.italic } : {}),
    ...(underline !== undefined
      ? { underline: underline !== false && underline !== "none" }
      : {}),
    ...(typeof font.strike === "boolean" ? { strike: font.strike } : {}),
    ...(normalizedFontFamily(font.name)
      ? { fontFamily: normalizedFontFamily(font.name) }
      : {}),
    ...(normalizedColor(font.color)
      ? { textColor: normalizedColor(font.color) }
      : {}),
    ...(fill.pattern === "solid" && normalizedColor(fill.color)
      ? { fillColor: normalizedColor(fill.color) }
      : {}),
    ...(horizontal === "left" ||
    horizontal === "center" ||
    horizontal === "right" ||
    horizontal === "justify"
      ? { align: horizontal as "left" | "center" | "right" | "justify" }
      : {}),
    ...(vertical === "top" || vertical === "bottom"
      ? { verticalAlign: vertical }
      : vertical === "center"
        ? { verticalAlign: "middle" as const }
        : {}),
    ...(typeof alignment.wrapText === "boolean"
      ? { wrap: alignment.wrapText }
      : {}),
    ...(rotation !== undefined ? { rotation } : {}),
    ...(typeof alignment.indent === "number"
      ? { indent: alignment.indent }
      : {}),
    numberFormat: normalizedNumberFormat(format.numberFormat),
    ...(nativeCode && nativeCode !== "General"
      ? { customFormat: nativeCode }
      : {}),
    ...(decimals !== undefined ? { decimals } : {}),
    ...(typeof font.size === "number" && font.size >= 6 && font.size <= 72
      ? { fontSize: font.size }
      : {}),
    ...(Object.keys(borders).length ? { borders } : {}),
  };
}

function canonicalColor(value: unknown) {
  if (typeof value !== "string") return null;
  const hex = value.replace(/^#/, "").toUpperCase();
  if (hex.length === 8) return `#${hex.slice(2)}`;
  if (hex.length === 6) return `#${hex}`;
  return value;
}

/**
 * The Sheets editor stores every default (false bold, 11pt, bottom align).
 * The native projection omits those defaults. Stringifying the two objects
 * makes every visible cell look like a format write, then the Bridge
 * region-id cap refuses a one-cell edit on a real workbook.
 */
function canonicalSheetFormat(value: unknown) {
  const format = record(value);
  const align =
    format.align === "left" ||
    format.align === "center" ||
    format.align === "right" ||
    format.align === "justify"
      ? format.align
      : "general";
  const verticalAlign =
    format.verticalAlign === "top" ||
    format.verticalAlign === "middle" ||
    format.verticalAlign === "bottom"
      ? format.verticalAlign
      : "bottom";
  return {
    bold: format.bold === true,
    italic: format.italic === true,
    underline: format.underline === true,
    strike: format.strike === true,
    wrap: format.wrap === true,
    rotation: typeof format.rotation === "number" ? format.rotation : 0,
    indent: typeof format.indent === "number" ? format.indent : 0,
    fontSize: typeof format.fontSize === "number" ? format.fontSize : 11,
    fontFamily: typeof format.fontFamily === "string" ? format.fontFamily : "sans",
    numberFormat:
      typeof format.numberFormat === "string" ? format.numberFormat : "general",
    align,
    verticalAlign,
    textColor: canonicalColor(format.textColor),
    fillColor: canonicalColor(format.fillColor),
    customFormat:
      typeof format.customFormat === "string" ? format.customFormat : null,
    currency: typeof format.currency === "string" ? format.currency : null,
    decimals: typeof format.decimals === "number" ? format.decimals : null,
    thousands: format.thousands !== false,
    borders: format.borders ?? null,
  };
}

export function sheetFormatsEquivalent(left: unknown, right: unknown) {
  return (
    JSON.stringify(canonicalSheetFormat(left)) ===
    JSON.stringify(canonicalSheetFormat(right))
  );
}

type NativeRule = Record<string, unknown>;

function nativeBool(value: unknown) {
  return value === true || value === "1" || value === "true";
}

function nativeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function nativeRanges(value: unknown) {
  if (typeof value !== "string") return [];
  return value.split(/\s+/).flatMap((candidate) => {
    const range = parseRange(candidate.replace(/^.*!/, ""));
    return range ? [range] : [];
  });
}

function nativeFormulaNumber(value: unknown) {
  if (typeof value !== "string") return undefined;
  const number = Number(value.replace(/^=/, "").trim());
  return Number.isFinite(number) ? number : undefined;
}

function nativeRuleMetadata(rule: NativeRule) {
  const errorStyle = rule.errorStyle === "warning" || rule.errorStyle === "information"
    ? rule.errorStyle
    : rule.errorStyle === "stop"
      ? "stop"
      : undefined;
  return {
    ...(nativeBool(rule.allowBlank) ? { allowBlank: true } : {}),
    ...(rule.showDropDown !== undefined ? { showDropDown: nativeBool(rule.showDropDown) } : {}),
    ...(rule.showInputMessage !== undefined ? { showInputMessage: nativeBool(rule.showInputMessage) } : {}),
    ...(rule.showErrorMessage !== undefined ? { showErrorMessage: nativeBool(rule.showErrorMessage) } : {}),
    ...(errorStyle ? { errorStyle } : {}),
    ...(typeof rule.errorTitle === "string" ? { errorTitle: rule.errorTitle } : {}),
    ...(typeof rule.error === "string" ? { errorMessage: rule.error } : {}),
    ...(typeof rule.promptTitle === "string" ? { promptTitle: rule.promptTitle } : {}),
    ...(typeof rule.prompt === "string" ? { promptMessage: rule.prompt } : {}),
  };
}

function listOptionsFromNative(
  formula: string | undefined,
  projection: XlsxProjection,
  defaultSheet: string,
) {
  if (!formula) return [];
  const value = formula.replace(/^=/, "").trim();
  if (value.startsWith('"') && value.endsWith('"'))
    return value.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean);
  const bang = value.lastIndexOf("!");
  const sheetName = bang >= 0 ? value.slice(0, bang).replace(/^'|'$/g, "").replaceAll("''", "'") : defaultSheet;
  const range = parseRange((bang >= 0 ? value.slice(bang + 1) : value).replaceAll("$", ""));
  const source = projection.sheets.find((candidate) => candidate.name === sheetName || candidate.name.toLowerCase() === sheetName.toLowerCase());
  if (!range || !source) return [];
  try {
    const cells = new Map(source.cells.map((cell) => [cell.ref, cell]));
    return rangeAddresses(range).flatMap((address) => {
      const cell = cells.get(address);
      return cell && cell.value !== null && cell.value !== undefined ? [String(cell.value)] : [];
    });
  } catch {
    return [];
  }
}

function nativeValidationToEditor(rule: NativeRule, projection: XlsxProjection, defaultSheet: string): SheetValidation | undefined {
  const type = typeof rule.type === "string" ? rule.type : "";
  const formula1 = typeof rule.formula1 === "string" ? rule.formula1 : undefined;
  const formula2 = typeof rule.formula2 === "string" ? rule.formula2 : undefined;
  const metadata = nativeRuleMetadata(rule);
  const rejectInvalid = rule.errorStyle !== "warning" && rule.errorStyle !== "information" && rule.showErrorMessage !== "0" && rule.showErrorMessage !== false;
  if (type === "list") {
    return {
      kind: "list",
      options: listOptionsFromNative(formula1, projection, defaultSheet),
      ...(formula1 ? { source: formula1 } : {}),
      rejectInvalid,
      ...metadata,
    } as SheetValidation;
  }
  if (type !== "whole" && type !== "decimal" && type !== "date" && type !== "time") return undefined;
  const kind = type === "date" ? "date" : "number";
  const operator = typeof rule.operator === "string" && [
    "between", "notBetween", "equal", "notEqual", "greaterThan", "lessThan",
    "greaterThanOrEqual", "lessThanOrEqual",
  ].includes(rule.operator)
    ? rule.operator as "between" | "notBetween" | "equal" | "notEqual" | "greaterThan" | "lessThan" | "greaterThanOrEqual" | "lessThanOrEqual"
    : undefined;
  return {
    kind,
    ...(nativeFormulaNumber(formula1) !== undefined ? { minimum: nativeFormulaNumber(formula1) } : {}),
    ...(nativeFormulaNumber(formula2) !== undefined ? { maximum: nativeFormulaNumber(formula2) } : {}),
    ...(formula1 ? { formula1 } : {}),
    ...(formula2 ? { formula2 } : {}),
    ...(operator ? { operator } : {}),
    rejectInvalid,
    ...metadata,
  } as SheetValidation;
}

function validationMapFromProjection(projection: XlsxProjection, sheet: XlsxProjection["sheets"][number]) {
  const result = new Map<string, SheetValidation>();
  for (const rule of sheet.validations ?? []) {
    const validation = nativeValidationToEditor(rule, projection, sheet.name);
    if (!validation) continue;
    for (const range of nativeRanges(rule.sqref)) {
      try {
        for (const address of rangeAddresses(range)) result.set(address, validation);
      } catch {
        // Whole-column/whole-row rules remain in the native carry when they are
        // too large to materialize into the sparse editor cell model.
      }
    }
  }
  return result;
}

function editorConditionalFormatsFromProjection(sheet: XlsxProjection["sheets"][number]) {
  const result: Array<SheetConditionalFormat & { nativeRuleId?: string }> = [];
  for (const group of sheet.conditionalFormats ?? []) {
    const range = typeof group.sqref === "string" ? group.sqref.split(/\s+/)[0] : undefined;
    if (!range || !Array.isArray(group.rules)) continue;
    for (const raw of group.rules) {
      const rule = raw as NativeRule;
      const priority = nativeNumber(rule.priority);
      const stopIfTrue = rule.stopIfTrue !== undefined ? nativeBool(rule.stopIfTrue) : undefined;
      const type = rule.type;
      const formulas = Array.isArray(rule.formulas) ? rule.formulas.filter((value): value is string => typeof value === "string") : [];
      const colorScale = rule.colorScale as NativeRule | undefined;
      const colors = Array.isArray(colorScale?.colors) ? colorScale.colors.filter((value): value is string => typeof value === "string") : [];
      if (type === "colorScale" && colors.length === 2) {
        result.push({
          id: typeof rule.id === "string" ? rule.id : `conditional-${result.length + 1}`,
          range,
          kind: "color_scale",
          minimumColor: colors[0]!,
          maximumColor: colors[1]!,
          ...(priority !== undefined ? { priority } : {}),
          ...(stopIfTrue !== undefined ? { stopIfTrue } : {}),
        });
        continue;
      }
      if (type === "cellIs" && typeof rule.operator === "string") {
        const mapped = {
          greaterThan: "greater_than",
          lessThan: "less_than",
          equal: "equal_to",
          notEqual: "not_equal_to",
          greaterThanOrEqual: "greater_equal",
          lessThanOrEqual: "less_equal",
          between: "between",
        }[rule.operator] as
          | "greater_than"
          | "less_than"
          | "equal_to"
          | "not_equal_to"
          | "greater_equal"
          | "less_equal"
          | "between"
          | undefined;
        const value = nativeFormulaNumber(formulas[0]);
        const secondValue = nativeFormulaNumber(formulas[1]);
        if (mapped && value !== undefined) {
          result.push({
            id: typeof rule.id === "string" ? rule.id : `conditional-${result.length + 1}`,
            range,
            kind: "cell_is",
            operator: mapped,
            value,
            ...(secondValue !== undefined ? { secondValue } : {}),
            fillColor: typeof rule.fillColor === "string" ? rule.fillColor : "#DDF4EA",
            ...(typeof rule.textColor === "string" ? { textColor: rule.textColor } : {}),
            ...(priority !== undefined ? { priority } : {}),
            ...(stopIfTrue !== undefined ? { stopIfTrue } : {}),
          });
        }
        continue;
      }
      if (type === "containsText" && typeof rule.text === "string" && rule.text) {
        result.push({
          id: typeof rule.id === "string" ? rule.id : `conditional-${result.length + 1}`,
          range,
          kind: "text_contains",
          text: rule.text,
          fillColor: typeof rule.fillColor === "string" ? rule.fillColor : "#DDF4EA",
          ...(typeof rule.textColor === "string" ? { textColor: rule.textColor } : {}),
          ...(priority !== undefined ? { priority } : {}),
          ...(stopIfTrue !== undefined ? { stopIfTrue } : {}),
        });
      }
    }
  }
  return result;
}

function editorValidationRules(contentSheet: Record<string, unknown>) {
  const grouped = new Map<string, { validation: SheetValidation; addresses: string[] }>();
  const cells = record(contentSheet.cells);
  for (const [address, rawCell] of Object.entries(cells)) {
    const validation = record(rawCell).validation as SheetValidation | undefined;
    if (!validation || typeof validation.kind !== "string") continue;
    const key = JSON.stringify(validation);
    const existing = grouped.get(key);
    if (existing) existing.addresses.push(address.toUpperCase());
    else grouped.set(key, { validation, addresses: [address.toUpperCase()] });
  }
  return [...grouped.values()].map(({ validation, addresses }, index) => ({
    id: `xlsx:validation:editor:${index + 1}`,
    sqref: addresses.join(" "),
    type: validation.kind === "list" ? "list" : validation.kind === "date" ? "date" : validation.kind === "checkbox" ? "list" : "decimal",
    ...(validation.kind === "list"
      ? { formula1: validation.source ?? `"${validation.options.join(",")}"` }
      : validation.kind === "checkbox"
        ? { formula1: '"TRUE,FALSE"' }
        : {
            ...(validation.operator ? { operator: validation.operator } : { operator: "between" }),
            ...(validation.formula1 ?? validation.minimum !== undefined ? { formula1: validation.formula1 ?? String(validation.minimum) } : {}),
            ...(validation.formula2 ?? validation.maximum !== undefined ? { formula2: validation.formula2 ?? String(validation.maximum) } : {}),
          }),
    ...(validation.allowBlank ? { allowBlank: "1" } : {}),
    ...(validation.showDropDown !== undefined ? { showDropDown: validation.showDropDown ? "1" : "0" } : {}),
    ...(validation.showInputMessage !== undefined ? { showInputMessage: validation.showInputMessage ? "1" : "0" } : {}),
    ...(validation.showErrorMessage !== undefined ? { showErrorMessage: validation.showErrorMessage ? "1" : "0" } : {}),
    ...(validation.errorStyle ? { errorStyle: validation.errorStyle } : {}),
    ...(validation.errorTitle ? { errorTitle: validation.errorTitle } : {}),
    ...(validation.errorMessage ? { error: validation.errorMessage } : {}),
    ...(validation.promptTitle ? { promptTitle: validation.promptTitle } : {}),
    ...(validation.promptMessage ? { prompt: validation.promptMessage } : {}),
  }));
}

function editorConditionalRules(contentSheet: Record<string, unknown>) {
  const rules = Array.isArray(contentSheet.conditionalFormats) ? contentSheet.conditionalFormats : [];
  return rules.flatMap((candidate, index) => {
    const rule = candidate as Record<string, unknown>;
    if (typeof rule.range !== "string" || typeof rule.kind !== "string") return [];
    const native: NativeRule = {
      id: typeof rule.id === "string" ? rule.id : `conditional:editor:${index + 1}`,
      type: rule.kind === "color_scale" ? "colorScale" : rule.kind === "text_contains" ? "containsText" : "cellIs",
      ...(typeof rule.priority === "number" ? { priority: String(rule.priority) } : {}),
      ...(typeof rule.stopIfTrue === "boolean" ? { stopIfTrue: rule.stopIfTrue ? "1" : "0" } : {}),
      ...(rule.kind === "color_scale" ? {
        colorScale: { cfvo: [{ type: "min" }, { type: "max" }], colors: [String(rule.minimumColor), String(rule.maximumColor)] },
      } : rule.kind === "text_contains" ? {
        text: String(rule.text),
        formulas: [`NOT(ISERROR(SEARCH("${String(rule.text).replaceAll('"', '""')}",A1)))`],
      } : {
        operator: ({ greater_than: "greaterThan", less_than: "lessThan", equal_to: "equal", not_equal_to: "notEqual", greater_equal: "greaterThanOrEqual", less_equal: "lessThanOrEqual", between: "between" } as Record<string, string>)[String(rule.operator)] ?? "equal",
        formulas: [String(rule.value), ...(typeof rule.secondValue === "number" ? [String(rule.secondValue)] : [])],
        fillColor: typeof rule.fillColor === "string" ? rule.fillColor : undefined,
        textColor: typeof rule.textColor === "string" ? rule.textColor : undefined,
      }),
    };
    return [{ id: typeof rule.id === "string" ? rule.id : native.id, sqref: rule.range, rules: [native] }];
  });
}

export function xlsxArtifactContent(projection: XlsxProjection): SheetsContent {
  const date1904 = projection.nativeBinding.date1904 === true;
  return {
    workbook: {
      calculationMode: projection.calculationMode ?? "automatic",
      locale: "en-US",
      namedRanges: Object.fromEntries(
        projection.definedNames.map((item) => [item.name, item.ref]),
      ),
      calculationVersion: 1,
      ...(date1904 ? { date1904: true } : {}),
    },
    sheets: projection.sheets.map((sheet) => {
      const validationByCell = validationMapFromProjection(projection, sheet);
      const cells = Object.fromEntries(
        sheet.cells.map((cell) => {
          const value =
            cell.value instanceof Date
              ? dateToSerial(cell.value, date1904)
              : cell.value;
          return [
            cell.ref,
            {
              ...(value !== undefined ? { value } : {}),
              ...(cell.formula
                ? {
                    formula: `=${cell.formula}`,
                    nativeFormulaSupport: cell.formulaSupport,
                  }
                : {}),
              ...((cell.format ??
              (cell.style ? normalizedCellFormat(cell.style) : undefined))
                ? { format: cell.format ?? normalizedCellFormat(cell.style) }
                : {}),
              ...(validationByCell.has(cell.ref)
                ? { validation: validationByCell.get(cell.ref) }
                : {}),
            },
          ];
        }),
      );
      for (const [address, validation] of validationByCell) {
        if (cells[address]) continue;
        cells[address] = { value: null, validation };
      }
      const conditionalFormats = editorConditionalFormatsFromProjection(sheet);
      return {
      id: sheet.id,
      name: sheet.name,
      cells,
      tables: (sheet.tables ?? []).map((table) => ({
        id: table.id,
        name: table.name,
        range: table.range,
        ...(table.style && /^TableStyle/i.test(table.style)
          ? { style: /Medium|Light|Dark/i.test(table.style) ? "striped" as const : "plain" as const }
          : {}),
        ...(table.totalsRow ? { totalsRow: true } : {}),
        filters: (table.filters ?? []).map((filter) => ({
          column: filter.column,
          allowedValues: filter.allowedValues.filter(
            (value): value is string | number | boolean | null =>
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean" ||
              value === null,
          ),
        })),
        ...(table.sort ? { sort: table.sort } : {}),
      })),
      charts: (sheet.charts ?? []).map((chart) => ({
        id: chart.id,
        type: chart.type,
        sourceRange: canonicalChartRange(chart.sourceRange, sheet.name),
        title: chart.title,
        ...(chart.showLegend === false ? { showLegend: false } : {}),
        position: chart.position,
        ...(chart.series?.length
          ? {
              series: chart.series.map((series) => ({
                ...(series.name !== undefined ? { name: series.name } : {}),
                ...(series.categories !== undefined ? { categories: series.categories } : {}),
                ...(series.values !== undefined ? { values: series.values } : {}),
                ...(series.chartType !== undefined ? { chartType: series.chartType } : {}),
                ...(series.axis !== undefined ? { axis: series.axis } : {}),
              })),
            }
          : {}),
      })),
      mergedRanges: [...sheet.merges],
      frozenRows: sheet.frozenRows,
      frozenColumns: sheet.frozenColumns,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      hiddenRows: sheet.hiddenRows ?? [],
      hiddenColumns: sheet.hiddenColumns ?? [],
      columnWidths: sheet.columnWidths ?? {},
      rowHeights: sheet.rowHeights ?? {},
      ...(sheet.hidden ? { hidden: true } : {}),
      ...(sheet.showGridlines !== undefined ? { showGridlines: sheet.showGridlines } : {}),
      ...(sheet.showHeadings !== undefined ? { showHeadings: sheet.showHeadings } : {}),
      ...(sheet.tabColor ? { tabColor: sheet.tabColor } : {}),
      conditionalFormats: conditionalFormats as unknown as SheetsContent["sheets"][number]["conditionalFormats"],
      };
    }),
    activeSheetId: projection.activeSheetId ?? projection.sheets[0]?.id ?? "",
    nativeBinding: projection.nativeBinding,
  };
}

/** Convex documents and mutation arguments cap near 1 MiB. A 200k-cell
 * workbook's full projection cannot live on `spectraArtifacts.content`; the
 * native payload in storage is the durable source, and open returns the live
 * projection to the editor over HTTP. */
export const CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES = 700_000;

function jsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function sheetActivationShell(content: unknown) {
  const source = record(content);
  const workbook = record(source.workbook);
  const sheets = Array.isArray(source.sheets) ? source.sheets : [];
  const namedRanges = Object.fromEntries(
    Object.entries(record(workbook.namedRanges)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return {
    source,
    workbook: {
      calculationMode:
        workbook.calculationMode === "manual" ? "manual" : "automatic",
      locale: typeof workbook.locale === "string" ? workbook.locale : "en-US",
      namedRanges,
      calculationVersion:
        typeof workbook.calculationVersion === "number"
          ? workbook.calculationVersion
          : 1,
      ...(workbook.date1904 === true ? { date1904: true } : {}),
    },
    sheets,
    activeSheetId:
      typeof source.activeSheetId === "string"
        ? source.activeSheetId
        : typeof record(sheets[0]).id === "string"
          ? String(record(sheets[0]).id)
          : "",
  };
}

function stripSheetCellsForActivation(content: unknown) {
  const shell = sheetActivationShell(content);
  return {
    ...shell.source,
    workbook: shell.workbook,
    sheets: shell.sheets.map((sheet, index) => {
      const row = record(sheet);
      return {
        id: typeof row.id === "string" ? row.id : `sheet-${index + 1}`,
        name: typeof row.name === "string" ? row.name : `Sheet ${index + 1}`,
        cells: {},
        tables: Array.isArray(row.tables) ? row.tables : [],
        charts: Array.isArray(row.charts) ? row.charts : [],
        mergedRanges: Array.isArray(row.mergedRanges)
          ? row.mergedRanges.filter(
              (range): range is string => typeof range === "string",
            )
          : [],
        frozenRows:
          typeof row.frozenRows === "number" ? row.frozenRows : undefined,
        frozenColumns:
          typeof row.frozenColumns === "number" ? row.frozenColumns : undefined,
      };
    }),
    activeSheetId: shell.activeSheetId,
    nativeBinding: shell.source.nativeBinding,
  };
}

/**
 * Keep as many occupied cells as fit under the Convex hot-row budget.
 * Wiping every cell made Library 200k imports look like an Empty sheet and
 * failed hollow-content guards on complete — the native package remains the
 * lossless source; the hot row only needs a durable nonempty head.
 */
function boundSheetCellsForActivation(content: unknown, budgetBytes: number) {
  const shell = sheetActivationShell(content);
  const sheetEntries = shell.sheets.map((sheet, index) => {
    const row = record(sheet);
    return {
      id: typeof row.id === "string" ? row.id : `sheet-${index + 1}`,
      name: typeof row.name === "string" ? row.name : `Sheet ${index + 1}`,
      // Prefer sheetCellEntries so Convex chunked storage still yields a
      // nonempty activation head (Object.entries on {encoding,chunks} is hollow).
      entries: sheetCellEntries(row.cells),
      tables: Array.isArray(row.tables) ? row.tables : [],
      charts: Array.isArray(row.charts) ? row.charts : [],
      mergedRanges: Array.isArray(row.mergedRanges)
        ? row.mergedRanges.filter(
            (range): range is string => typeof range === "string",
          )
        : [],
      frozenRows: typeof row.frozenRows === "number" ? row.frozenRows : undefined,
      frozenColumns:
        typeof row.frozenColumns === "number" ? row.frozenColumns : undefined,
    };
  });
  let keep = sheetEntries.map((sheet) => sheet.entries.length);
  const build = (counts: number[]) => {
    const next = {
      ...shell.source,
      workbook: shell.workbook,
      sheets: sheetEntries.map((sheet, index) => ({
        id: sheet.id,
        name: sheet.name,
        cells: Object.fromEntries(sheet.entries.slice(0, counts[index] ?? 0)),
        tables: sheet.tables,
        charts: sheet.charts,
        mergedRanges: sheet.mergedRanges,
        frozenRows: sheet.frozenRows,
        frozenColumns: sheet.frozenColumns,
      })),
      activeSheetId: shell.activeSheetId,
      nativeBinding: shell.source.nativeBinding,
    };
    return encodeArtifactContentForStorage("sheets", next);
  };
  let candidate = build(keep);
  if (jsonBytes(candidate) <= budgetBytes) return candidate;
  while (jsonBytes(candidate) > budgetBytes && keep.some((count) => count > 0)) {
    keep = keep.map((count) => Math.floor(count / 2));
    candidate = build(keep);
  }
  return candidate;
}

function stripPresentationObjectsForActivation(content: unknown) {
  const source = record(content);
  const slides = Array.isArray(source.slides) ? source.slides : [];
  return {
    ...source,
    slides: slides.map((slide, index) => {
      const row = record(slide);
      const objects = Array.isArray(row.objects) ? row.objects : [];
      const title =
        typeof row.title === "string" && row.title.trim()
          ? row.title
          : `Slide ${index + 1}`;
      return {
        ...row,
        title,
        objects: objects.slice(0, 1).map((object) => {
          const item = record(object);
          return {
            ...item,
            content:
              typeof item.content === "string"
                ? item.content.slice(0, 240)
                : item.content,
          };
        }),
        speakerNotes:
          typeof row.speakerNotes === "string"
            ? row.speakerNotes.slice(0, 240)
            : "",
      };
    }),
  };
}

/**
 * Activation writes identity and sheet/slide lists into Convex. Occupied cells
 * and dense slide objects stay in the native payload and the HTTP open
 * response so a 200k-cell book or 120-slide deck cannot blow the document cap.
 */
export function convexSafeFidelityMap(map: unknown) {
  if (jsonBytes(map) <= 80_000) return map;
  return {
    truncated: true,
    message:
      "Native features Spectra cannot edit remain in the original package.",
  };
}

export function convexSafeOfficeActivationContent(
  typeKey: "sheets" | "presentation",
  content: unknown,
): unknown {
  const encoded = encodeArtifactContentForStorage(typeKey, content);
  if (jsonBytes(encoded) <= CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES)
    return encoded;
  if (typeKey === "sheets") {
    const bounded = boundSheetCellsForActivation(
      content,
      CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES,
    );
    if (jsonBytes(bounded) <= CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES)
      return bounded;
  }
  const compact =
    typeKey === "sheets"
      ? stripSheetCellsForActivation(content)
      : stripPresentationObjectsForActivation(content);
  const next = encodeArtifactContentForStorage(typeKey, compact);
  if (jsonBytes(next) <= CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES) return next;
  return encodeArtifactContentForStorage(
    typeKey,
    typeKey === "sheets"
      ? {
          ...stripSheetCellsForActivation(content),
          workbook: {
            calculationMode: "automatic" as const,
            locale: "en-US",
            namedRanges: {},
            calculationVersion: 1,
          },
        }
      : {
          ...record(content),
          slides: [],
        },
  );
}

export function bindPptxProjectionSource(
  projection: PptxProjection,
  artifactId: string,
  payloadHash: string,
): PptxProjection {
  return pptxProjectionSchema.parse({
    ...projection,
    nativeBinding: {
      ...projection.nativeBinding,
      sourceArtifactId: artifactId,
      sourcePayloadHash: payloadHash,
    },
  });
}

export function pptxNativeMediaUrl(
  binding: unknown,
  partName: string,
) {
  const source = record(binding);
  const artifactId =
    typeof source.sourceArtifactId === "string" ? source.sourceArtifactId : "";
  const payloadHash =
    typeof source.sourcePayloadHash === "string"
      ? source.sourcePayloadHash
      : "";
  if (
    !artifactId ||
    !/^[a-f0-9]{64}$/.test(payloadHash) ||
    !/^\/ppt\/media\/[^/\\\u0000-\u001f]{1,400}$/u.test(partName)
  )
    return "";
  const query = new URLSearchParams({
    artifactId,
    payloadHash,
    partName,
  });
  return `/api/spectra/lenses/office/media?${query.toString()}`;
}

export function pptxArtifactContent(
  projection: PptxProjection,
): PresentationContent {
  return {
    theme: {
      id: "native-pptx",
      name: "PowerPoint theme",
      ...(projection.nativeBinding.themeFonts
        ? { fonts: projection.nativeBinding.themeFonts }
        : {}),
    },
    settings: {
      aspectRatio:
        projection.nativeBinding.canvasWidthEmu &&
        projection.nativeBinding.canvasHeightEmu &&
        projection.nativeBinding.canvasWidthEmu /
          projection.nativeBinding.canvasHeightEmu <
          1.55
          ? "4:3"
          : "16:9",
      showSlideNumbers: true,
    },
    slides: projection.slides.map((slide) => {
      return {
        id: slide.id,
        title: slide.title,
        ...(slide.layoutPartName ? { layoutId: slide.layoutPartName } : {}),
        ...(slide.hidden ? { hidden: true } : {}),
        // The lens reads the file's notes pages, so the studio has to receive
        // them. Dropping them here made an opened deck look as though it had no
        // speaker notes at all, and then saving could only ever write them back
        // as empty.
        ...(slide.speakerNotes ? { speakerNotes: slide.speakerNotes } : {}),
        objects: slide.objects,
        ...(slide.hasTransition || slide.hasTiming
          ? {
              nativeCompatibility: {
                ...(slide.hasTransition
                  ? { transition: "preserved" as const }
                  : {}),
                ...(slide.hasTiming
                  ? { animations: "preserved" as const }
                  : {}),
              },
            }
          : {}),
      };
    }),
    nativeBinding: projection.nativeBinding,
  };
}

const xlsxEditorContentSchema = z
  .object({
    sheets: z.array(
      z
        .object({
          id: z.string(),
          cells: z.record(
            z.string(),
            z
              .object({
                value: z.unknown().optional(),
                formula: z.string().optional(),
                format: z.record(z.string(), z.unknown()).optional(),
              })
              .passthrough(),
          ),
          mergedRanges: z.array(z.string()).optional(),
          frozenRows: z.number().int().nonnegative().optional(),
          frozenColumns: z.number().int().nonnegative().optional(),
          rowCount: z.number().int().positive().optional(),
          columnCount: z.number().int().positive().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function isEditableNativeValidation(rule: NativeRule) {
  return ["list", "whole", "decimal", "date", "time"].includes(String(rule.type));
}

function isEditableNativeConditional(rule: NativeRule) {
  if (rule.type === "cellIs") return rule.operator !== "notBetween";
  if (rule.type === "containsText") return true;
  if (rule.type !== "colorScale") return false;
  const scale = record(rule.colorScale);
  return Array.isArray(scale.colors) && scale.colors.length === 2;
}

function validationMapSignature(map: Map<string, SheetValidation>) {
  return JSON.stringify([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function conditionalModelSignature(value: unknown) {
  return JSON.stringify(
    (Array.isArray(value) ? value : [])
      .map((candidate) => candidate as Record<string, unknown>)
      .sort((left, right) => String(left.id ?? "").localeCompare(String(right.id ?? ""))),
  );
}

function nativeValidationsForContent(
  contentSheet: Record<string, unknown>,
  baseProjection: XlsxProjection,
  baseSheet: XlsxProjection["sheets"][number],
) {
  const incoming = editorValidationRules(contentSheet);
  const baseMap = validationMapFromProjection(baseProjection, baseSheet);
  const nextMap = new Map<string, SheetValidation>();
  for (const rule of incoming) {
    const validation = nativeValidationToEditor(rule, baseProjection, baseSheet.name);
    if (!validation) continue;
    for (const range of nativeRanges(rule.sqref)) {
      try {
        for (const address of rangeAddresses(range)) nextMap.set(address, validation);
      } catch {
        // Retain the native rule below when a whole-column range is too large
        // for the collaborative sparse-cell model.
      }
    }
  }
  if (validationMapSignature(baseMap) === validationMapSignature(nextMap)) return baseSheet.validations ?? [];
  return [
    ...(baseSheet.validations ?? []).filter((rule) => !isEditableNativeValidation(rule)),
    ...incoming,
  ];
}

function nativeConditionalFormatsForContent(
  contentSheet: Record<string, unknown>,
  baseSheet: XlsxProjection["sheets"][number],
) {
  const incoming = Array.isArray(contentSheet.conditionalFormats) ? contentSheet.conditionalFormats : [];
  const baseModel = editorConditionalFormatsFromProjection(baseSheet);
  if (conditionalModelSignature(baseModel) === conditionalModelSignature(incoming)) return baseSheet.conditionalFormats ?? [];
  return [
    ...(baseSheet.conditionalFormats ?? []).map((group) => ({
      ...group,
      rules: Array.isArray(group.rules) ? group.rules.filter((rule) => !isEditableNativeConditional(rule as NativeRule)) : [],
    })).filter((group) => Array.isArray(group.rules) && group.rules.length),
    ...editorConditionalRules(contentSheet),
  ];
}

/** The one Sheets editor-model -> XLSX projection transform. */
export function xlsxProjectionFromContent(
  content: unknown,
  base: XlsxProjection,
): XlsxProjection {
  if (content == null) return base;
  const raw = xlsxEditorContentSchema.parse(
    decodeSheetsContentFromStorage(content),
  );
  const byId = new Map(raw.sheets.map((sheet) => [sheet.id, sheet]));
  const projection = xlsxProjectionSchema.parse({
    ...base,
    sheets: base.sheets.map((sheet) => {
      const next = byId.get(sheet.id);
      if (!next) return sheet;
      const nextRecord = next as Record<string, unknown>;
      const previousByRef = new Map(
        sheet.cells.map((cell) => [cell.ref, cell]),
      );
      let rowCount = next.rowCount ?? sheet.rowCount;
      let columnCount = next.columnCount ?? sheet.columnCount;
      const cellCoordinates = new Map<string, { row: number; column: number }>();
      const cells = Object.entries(next.cells).map(([rawRef, value]) => {
        const ref = rawRef.toUpperCase();
        const coordinate = parseAddress(ref);
        if (coordinate) {
          cellCoordinates.set(ref, coordinate);
          if (rowCount !== undefined) rowCount = Math.max(rowCount, coordinate.row + 1);
          if (columnCount !== undefined) columnCount = Math.max(columnCount, coordinate.column + 1);
        }
        const previous = previousByRef.get(ref);
        const nextValue =
          value.value === undefined ? (previous?.value ?? null) : value.value;
        const nextFormula =
          typeof value.formula === "string" && value.formula
            ? value.formula.replace(/^=/, "")
            : previous?.formula;
        const format =
          "format" in value
            ? Object.keys(record(value.format)).length
              ? value.format
              : sheet.defaultCellFormat
            : previous?.format ?? sheet.defaultCellFormat;
        if (
          previous?.formula &&
          !value.formula &&
          Object.prototype.hasOwnProperty.call(value, "value")
        )
          throw codedOfficeContentError(
            "XLSX_FORMULA_LITERALIZATION_BLOCKED",
            `Formula ${sheet.name}!${ref} cannot be replaced by a literal through a value edit. Edit its formula text instead.`,
          );
        return {
          ...(previous ?? {
            id: `xlsx:${sheet.id.replace(/^xlsx:sheet:/, "")}:${ref}`,
            ref,
            value: null,
          }),
          value: nextValue,
          ...(format ? { format } : {}),
          ...(nextFormula
            ? {
                formula: nextFormula,
                formulaSupport: xlsxFormulaSupport(nextFormula),
                formulaCache:
                  nextFormula === previous?.formula
                    ? previous?.formulaCache
                    : "absent" as const,
              }
            : {}),
        };
      });
      // Yjs preserves insertion order, while native XLSX readback is ordered by
      // worksheet coordinate. Canonicalize the projection so semantic digests
      // do not depend on when a distant cell was inserted into the editor map.
      cells.sort((left, right) => {
        const leftCoordinate = cellCoordinates.get(left.ref);
        const rightCoordinate = cellCoordinates.get(right.ref);
        if (!leftCoordinate || !rightCoordinate) return left.ref.localeCompare(right.ref);
        return leftCoordinate.row - rightCoordinate.row || leftCoordinate.column - rightCoordinate.column;
      });
      const tables = Array.isArray(nextRecord.tables)
        ? nextRecord.tables.flatMap((candidate) => {
            const table = record(candidate);
            if (typeof table.name !== "string" || typeof table.range !== "string") return [];
            const previous = (sheet.tables ?? []).find((item) => item.id === table.id || item.name === table.name);
            return [{
              id: typeof table.id === "string" ? table.id : previous?.id ?? `xlsx:table:${sheet.id}:${table.name}`,
              name: table.name,
              range: table.range,
              columns: Array.isArray(table.columns)
                ? table.columns.filter((entry): entry is string => typeof entry === "string")
                : previous?.columns ?? [],
              headerRow: table.headerRow !== false,
              totalsRow: table.totalsRow === true,
              ...(Object.prototype.hasOwnProperty.call(table, "style")
                ? { style: table.style === null || table.style === "plain" ? null : typeof table.style === "string" && table.style.startsWith("TableStyle") ? table.style : table.style === "striped" ? "TableStyleMedium2" : table.style === "accent" ? "TableStyleMedium4" : previous?.style ?? null }
                : previous?.style ? { style: previous.style } : {}),
              filters: Array.isArray(table.filters) ? table.filters : previous?.filters ?? [],
              ...(previous?.partName ? { partName: previous.partName } : {}),
            }];
          })
        : sheet.tables ?? [];
      const charts = Array.isArray(nextRecord.charts)
        ? nextRecord.charts.flatMap((candidate, chartIndex) => {
            const chart = record(candidate);
            if (typeof chart.sourceRange !== "string") return [];
            const previous = (sheet.charts ?? []).find((item) => item.id === chart.id)
              ?? (sheet.charts ?? [])[chartIndex];
            const position = record(chart.position);
            return [{
              ...(previous ?? { id: typeof chart.id === "string" ? chart.id : `xlsx:chart:${sheet.id}:new`, type: "line" as const, sourceRange: canonicalChartRange(chart.sourceRange, sheet.name), title: "Chart", position: { x: 0, y: 0, width: 760, height: 320 } }),
              ...(!previous && typeof chart.id === "string" ? { id: chart.id } : {}),
              ...(typeof chart.type === "string" ? { type: chart.type } : {}),
              sourceRange: canonicalChartRange(chart.sourceRange, sheet.name),
              ...(typeof chart.title === "string" ? { title: chart.title } : {}),
              ...(typeof chart.showLegend === "boolean" ? { showLegend: chart.showLegend } : {}),
              ...(Object.keys(position).length ? { position: { x: Number(position.x) || 0, y: Number(position.y) || 0, width: Number(position.width) || 760, height: Number(position.height) || 320 } } : {}),
              ...(Array.isArray(chart.series)
                ? {
                    series: chart.series.flatMap((candidate) => {
                      const series = record(candidate);
                      return [{
                        ...(typeof series.name === "string" ? { name: series.name } : {}),
                        ...(typeof series.categories === "string" ? { categories: series.categories } : {}),
                        ...(typeof series.values === "string" ? { values: series.values } : {}),
                        ...(typeof series.chartType === "string" ? { chartType: series.chartType } : {}),
                        ...(typeof series.axis === "string" ? { axis: series.axis } : {}),
                      }];
                    }),
                  }
                : {}),
            }];
          })
        : sheet.charts ?? [];
      const validations = nativeValidationsForContent(nextRecord, base, sheet);
      const conditionalFormats = Object.prototype.hasOwnProperty.call(nextRecord, "conditionalFormats")
        ? nativeConditionalFormatsForContent(nextRecord, sheet)
        : sheet.conditionalFormats ?? [];
      return {
        ...sheet,
        name: typeof nextRecord.name === "string" ? nextRecord.name : sheet.name,
        cells,
        // Editors can add a valid cell beyond the imported worksheet's <dimension>.
        // Keep the semantic extent in step with those cells so native readback
        // verifies the same range that the user's edit created.
        // An omitted extent is not an authored dimension change. Native cell
        // writes maintain their own bounds; never invent zero for an empty sheet.
        ...(rowCount !== undefined ? { rowCount } : {}),
        ...(columnCount !== undefined ? { columnCount } : {}),
        merges: next.mergedRanges ?? sheet.merges,
        frozenRows: next.frozenRows ?? sheet.frozenRows,
        frozenColumns: next.frozenColumns ?? sheet.frozenColumns,
        ...(Array.isArray(nextRecord.hiddenRows) ? { hiddenRows: nextRecord.hiddenRows.filter((entry): entry is number => typeof entry === "number") } : {}),
        ...(Array.isArray(nextRecord.hiddenColumns) ? { hiddenColumns: nextRecord.hiddenColumns.filter((entry): entry is number => typeof entry === "number") } : {}),
        ...(nextRecord.columnWidths && typeof nextRecord.columnWidths === "object" ? { columnWidths: record(nextRecord.columnWidths) as Record<string, number> } : {}),
        ...(nextRecord.rowHeights && typeof nextRecord.rowHeights === "object" ? { rowHeights: record(nextRecord.rowHeights) as Record<string, number> } : {}),
        ...(Object.prototype.hasOwnProperty.call(nextRecord, "hidden")
          ? (typeof nextRecord.hidden === "boolean" ? { hidden: nextRecord.hidden } : { hidden: undefined })
          : {}),
        ...(typeof nextRecord.showGridlines === "boolean" ? { showGridlines: nextRecord.showGridlines } : {}),
        ...(typeof nextRecord.showHeadings === "boolean" ? { showHeadings: nextRecord.showHeadings } : {}),
        ...(Object.prototype.hasOwnProperty.call(nextRecord, "tabColor")
          ? (typeof nextRecord.tabColor === "string" ? { tabColor: nextRecord.tabColor } : { tabColor: undefined })
          : {}),
        tables,
        charts,
        validations,
        conditionalFormats,
      };
    }),
  });
  const projectedById = new Map(projection.sheets.map((sheet) => [sheet.id, sheet]));
  const orderedSheets = raw.sheets.map((next, index) => {
    const existing = projectedById.get(next.id);
    if (existing) return existing;
    const nextRecord = next as Record<string, unknown>;
    const cells = Object.entries(next.cells).map(([rawRef, value]) => {
      const ref = rawRef.toUpperCase();
      const formula = typeof value.formula === "string" && value.formula ? value.formula.replace(/^=/, "") : undefined;
      return {
        id: `xlsx:new:${next.id}:${ref}`,
        ref,
        value: value.value === undefined ? null : value.value,
        ...(formula ? { formula, formulaSupport: xlsxFormulaSupport(formula), formulaCache: "absent" as const } : {}),
        ...(value.format ? { format: value.format } : {}),
      };
    });
    return {
      id: next.id,
      name: typeof nextRecord.name === "string" ? nextRecord.name : `Sheet ${index + 1}`,
      cells,
      merges: next.mergedRanges ?? [],
      frozenRows: next.frozenRows ?? 0,
      frozenColumns: next.frozenColumns ?? 0,
      ...(typeof nextRecord.rowCount === "number" ? { rowCount: nextRecord.rowCount } : {}),
      ...(typeof nextRecord.columnCount === "number" ? { columnCount: nextRecord.columnCount } : {}),
      tables: Array.isArray(nextRecord.tables) ? nextRecord.tables.flatMap((candidate) => {
        const table = record(candidate);
        if (typeof table.name !== "string" || typeof table.range !== "string") return [];
        return [{ id: typeof table.id === "string" ? table.id : `xlsx:table:${next.id}:${table.name}`, name: table.name, range: table.range, columns: Array.isArray(table.columns) ? table.columns.filter((entry): entry is string => typeof entry === "string") : [], headerRow: table.headerRow !== false, totalsRow: table.totalsRow === true, ...(table.style === "striped" ? { style: "TableStyleMedium2" } : table.style === "accent" ? { style: "TableStyleMedium4" } : {}), filters: Array.isArray(table.filters) ? table.filters : [] }];
      }) : [],
      charts: Array.isArray(nextRecord.charts) ? nextRecord.charts.flatMap((candidate) => {
        const chart = record(candidate);
        if (typeof chart.sourceRange !== "string") return [];
        const position = record(chart.position);
        return [{ id: typeof chart.id === "string" ? chart.id : `xlsx:chart:${next.id}:new`, type: typeof chart.type === "string" ? chart.type : "line", sourceRange: canonicalChartRange(chart.sourceRange, typeof nextRecord.name === "string" ? nextRecord.name : `Sheet ${index + 1}`), title: typeof chart.title === "string" ? chart.title : "Chart", ...(typeof chart.showLegend === "boolean" ? { showLegend: chart.showLegend } : {}), position: { x: Number(position.x) || 0, y: Number(position.y) || 0, width: Number(position.width) || 760, height: Number(position.height) || 320 }, ...(Array.isArray(chart.series) ? { series: chart.series.flatMap((candidate) => { const series = record(candidate); return [{ ...(typeof series.name === "string" ? { name: series.name } : {}), ...(typeof series.categories === "string" ? { categories: series.categories } : {}), ...(typeof series.values === "string" ? { values: series.values } : {}), ...(typeof series.chartType === "string" ? { chartType: series.chartType } : {}), ...(typeof series.axis === "string" ? { axis: series.axis } : {}) }]; }) } : {}) }];
      }) : [],
      validations: editorValidationRules(nextRecord),
      conditionalFormats: editorConditionalRules(nextRecord),
    };
  });
  const rawRecord = raw as unknown as Record<string, unknown>;
  const rawWorkbook = record(rawRecord.workbook);
  return xlsxProjectionSchema.parse({
    ...projection,
    sheets: orderedSheets,
    ...(rawWorkbook.calculationMode === "manual" ? { calculationMode: "manual" as const } : {}),
    ...(typeof rawRecord.activeSheetId === "string" ? { activeSheetId: rawRecord.activeSheetId } : {}),
  });
}

function canonicalChartRange(value: string, defaultSheet: string) {
  const bang = value.lastIndexOf("!");
  const rawSheet = bang >= 0
    ? value.slice(0, bang).replace(/^'|'$/g, "").replaceAll("''", "'")
    : defaultSheet;
  const local = bang >= 0 ? value.slice(bang + 1) : value;
  const absoluteLocal = local.split(":").map((part) => part.replace(/^\$?([A-Z]{1,3})\$?([1-9][0-9]*)$/i, (_match, column: string, row: string) => `$${column.toUpperCase()}$${row}`)).join(":");
  return `${quoteSheetPrefix(rawSheet)}${absoluteLocal}`;
}

function axisEditPoint(
  before: XlsxProjection["sheets"][number],
  after: XlsxProjection["sheets"][number],
  axis: "row" | "column",
  delta: 1 | -1,
) {
  const nextCells = new Map(after.cells.map((cell) => [cell.ref, cell]));
  const candidates: number[] = [];
  for (const cell of before.cells) {
    const coordinate = parseAddress(cell.ref);
    if (!coordinate) continue;
    const next = {
      row: coordinate.row + (axis === "row" ? delta : 0),
      column: coordinate.column + (axis === "column" ? delta : 0),
    };
    if (next.row < 0 || next.column < 0) continue;
    const ref = `${columnName(next.column)}${next.row + 1}`;
    const moved = nextCells.get(ref);
    const unchanged = nextCells.get(cell.ref);
    const sameValue = (candidate: typeof cell | undefined) =>
      candidate &&
      JSON.stringify({ value: candidate.value, formula: candidate.formula }) ===
        JSON.stringify({ value: cell.value, formula: cell.formula });
    // A larger used range can come from adding one new cell. Treat it as an
    // axis edit only when an existing cell actually moved off its old address.
    if (sameValue(moved) && !sameValue(unchanged))
      candidates.push(axis === "row" ? coordinate.row : coordinate.column);
  }
  return candidates.length ? Math.min(...candidates) : undefined;
}

export function xlsxOperationsBetween(
  before: XlsxProjection,
  after: XlsxProjection,
): XlsxOperation[] {
  const beforeSheets = new Map(before.sheets.map((sheet) => [sheet.id, sheet]));
  const operations: XlsxOperation[] = [];
  const afterIds = new Set(after.sheets.map((sheet) => sheet.id));
  for (const sheet of before.sheets)
    if (!afterIds.has(sheet.id)) operations.push({ kind: "remove-sheet", sheetId: sheet.id });
  for (const [index, sheet] of after.sheets.entries())
    if (!beforeSheets.has(sheet.id)) operations.push({ kind: "add-sheet", sheetId: sheet.id, name: sheet.name, index });
  for (const sheet of after.sheets) {
    const previous = beforeSheets.get(sheet.id);
    if (previous && previous.name !== sheet.name)
      operations.push({ kind: "rename-sheet", sheetId: sheet.id, name: sheet.name });
  }
  const beforeOrder = before.sheets.map((sheet) => sheet.id).filter((id) => afterIds.has(id));
  const afterOrder = after.sheets.map((sheet) => sheet.id);
  if (JSON.stringify(beforeOrder) !== JSON.stringify(afterOrder))
    operations.push({ kind: "reorder-sheets", order: afterOrder });
  if (before.calculationMode !== after.calculationMode || before.activeSheetId !== after.activeSheetId)
    operations.push({ kind: "set-workbook-properties", ...(after.calculationMode ? { calculationMode: after.calculationMode } : {}), ...(after.activeSheetId ? { activeSheetId: after.activeSheetId } : {}) });
  for (const sheet of after.sheets) {
    const previous = beforeSheets.get(sheet.id);
    if (!previous) {
      for (const cell of sheet.cells) {
        operations.push(cell.formula ? { kind: "set-formula", sheetId: sheet.id, ref: cell.ref, formula: cell.formula } : { kind: "set-cell", sheetId: sheet.id, ref: cell.ref, value: cell.value });
        if (cell.format) operations.push({ kind: "set-cell-format", sheetId: sheet.id, ref: cell.ref, format: { ...cell.format, __full: cell.format } });
      }
      for (const range of sheet.merges) operations.push({ kind: "merge-cells", sheetId: sheet.id, range });
      if ((sheet.frozenRows ?? 0) || (sheet.frozenColumns ?? 0)) operations.push({ kind: "set-freeze-panes", sheetId: sheet.id, rows: sheet.frozenRows ?? 0, columns: sheet.frozenColumns ?? 0 });
      const newProperties: Record<string, unknown> = {};
      for (const key of ["rowCount", "columnCount", "hiddenRows", "hiddenColumns", "columnWidths", "rowHeights", "hidden", "showGridlines", "showHeadings", "tabColor"] as const) {
        if (sheet[key] !== undefined) newProperties[key] = sheet[key];
      }
      if (Object.keys(newProperties).length) operations.push({ kind: "set-sheet-properties", sheetId: sheet.id, properties: newProperties });
      for (const table of sheet.tables ?? []) operations.push({ kind: "upsert-table", sheetId: sheet.id, table });
      for (const chart of sheet.charts ?? []) operations.push({ kind: "upsert-chart", sheetId: sheet.id, chart });
      continue;
    }
    const rowDelta = (sheet.rowCount ?? previous.rowCount ?? 100) - (previous.rowCount ?? 100);
    const columnDelta = (sheet.columnCount ?? previous.columnCount ?? 26) - (previous.columnCount ?? 26);
    if (Math.abs(rowDelta) === 1) {
      const at = axisEditPoint(previous, sheet, "row", rowDelta as 1 | -1);
      if (at !== undefined)
        operations.push({ kind: "mutate-sheet-axis", sheetId: sheet.id, axis: "row", at, delta: rowDelta as 1 | -1 });
    }
    if (Math.abs(columnDelta) === 1) {
      const at = axisEditPoint(previous, sheet, "column", columnDelta as 1 | -1);
      if (at !== undefined)
        operations.push({ kind: "mutate-sheet-axis", sheetId: sheet.id, axis: "column", at, delta: columnDelta as 1 | -1 });
    }
    const propertyKeys = ["rowCount", "columnCount", "hiddenRows", "hiddenColumns", "columnWidths", "rowHeights", "hidden", "showGridlines", "showHeadings", "tabColor"] as const;
    const properties: Record<string, unknown> = {};
    for (const key of propertyKeys) {
      if (JSON.stringify(previous[key]) === JSON.stringify(sheet[key])) continue;
      properties[key] = sheet[key] ?? (Array.isArray(previous[key]) ? [] : key === "columnWidths" || key === "rowHeights" ? {} : key === "hidden" || key === "showGridlines" || key === "showHeadings" ? false : key === "tabColor" ? null : 0);
    }
    if (Object.keys(properties).length) operations.push({ kind: "set-sheet-properties", sheetId: sheet.id, properties });
    const oldCells = new Map(previous.cells.map((cell) => [cell.ref, cell]));
    for (const cell of sheet.cells) {
      const old = oldCells.get(cell.ref);
      oldCells.delete(cell.ref);
      if (!old) {
        operations.push(
          cell.formula
            ? {
                kind: "set-formula",
                sheetId: sheet.id,
                ref: cell.ref,
                formula: cell.formula,
              }
            : {
                kind: "set-cell",
                sheetId: sheet.id,
                ref: cell.ref,
                value: cell.value,
              },
        );
        if (cell.format)
          operations.push({
            kind: "set-cell-format",
            sheetId: sheet.id,
            ref: cell.ref,
            format: { ...cell.format, __full: cell.format },
          });
        continue;
      }
      if (cell.formula !== old.formula) {
          if (!cell.formula)
            throw codedOfficeContentError(
              "XLSX_FORMULA_LITERALIZATION_BLOCKED",
              `Formula ${sheet.name}!${cell.ref} cannot be silently rewritten as a literal.`,
            );
        operations.push({
          kind: "set-formula",
          sheetId: sheet.id,
          ref: cell.ref,
          formula: cell.formula,
        });
      } else if (
        !cell.formula &&
        JSON.stringify(cell.value) !== JSON.stringify(old.value)
      ) {
        operations.push({
          kind: "set-cell",
          sheetId: sheet.id,
          ref: cell.ref,
          value: cell.value,
        });
      }
      if (!sheetFormatsEquivalent(cell.format, old.format)) {
        const oldFormat = old.format ?? {};
        const nextFormat = cell.format ?? {};
        const patch = Object.fromEntries(
          [...new Set([...Object.keys(oldFormat), ...Object.keys(nextFormat)])]
            .map((key) => [
              key,
              JSON.stringify(oldFormat[key]) === JSON.stringify(nextFormat[key])
                ? undefined
                : (nextFormat[key] ?? null),
            ])
            .filter((entry) => entry[1] !== undefined),
        );
        operations.push({
          kind: "set-cell-format",
          sheetId: sheet.id,
          ref: cell.ref,
          format: Object.keys(nextFormat).length
            ? { ...patch, __full: nextFormat }
            : {},
        });
      }
    }
    for (const ref of oldCells.keys())
      operations.push({ kind: "clear-cell", sheetId: sheet.id, ref });
    const oldMerges = new Set(previous.merges);
    const newMerges = new Set(sheet.merges);
    for (const range of oldMerges) {
      if (!newMerges.has(range))
        operations.push({ kind: "unmerge-cells", sheetId: sheet.id, range });
    }
    for (const range of newMerges) {
      if (!oldMerges.has(range))
        operations.push({ kind: "merge-cells", sheetId: sheet.id, range });
    }
    const previousFrozenRows = previous.frozenRows ?? 0;
    const previousFrozenColumns = previous.frozenColumns ?? 0;
    const nextFrozenRows = sheet.frozenRows ?? 0;
    const nextFrozenColumns = sheet.frozenColumns ?? 0;
    if (
      nextFrozenRows !== previousFrozenRows ||
      nextFrozenColumns !== previousFrozenColumns
    )
      operations.push({
        kind: "set-freeze-panes",
        sheetId: sheet.id,
        rows: nextFrozenRows,
        columns: nextFrozenColumns,
      });
    const oldTables = new Map((previous.tables ?? []).map((table) => [table.id, table]));
    const newTables = new Map((sheet.tables ?? []).map((table) => [table.id, table]));
    for (const table of previous.tables ?? [])
      if (!newTables.has(table.id)) operations.push({ kind: "remove-table", sheetId: sheet.id, tableId: table.id });
    for (const table of sheet.tables ?? [])
      if (!oldTables.has(table.id) || JSON.stringify(oldTables.get(table.id)) !== JSON.stringify(table))
        operations.push({ kind: "upsert-table", sheetId: sheet.id, table });
    const oldCharts = new Map((previous.charts ?? []).map((chart) => [chart.id, chart]));
    const newCharts = new Map((sheet.charts ?? []).map((chart) => [chart.id, chart]));
    for (const chart of previous.charts ?? [])
      if (!newCharts.has(chart.id)) operations.push({ kind: "remove-chart", sheetId: sheet.id, chartId: chart.id });
    for (const chart of sheet.charts ?? [])
      if (!oldCharts.has(chart.id) || JSON.stringify(oldCharts.get(chart.id)) !== JSON.stringify(chart))
        operations.push({ kind: "upsert-chart", sheetId: sheet.id, chart });
    if (JSON.stringify(previous.validations ?? []) !== JSON.stringify(sheet.validations ?? []))
      operations.push({ kind: "set-validations", sheetId: sheet.id, validations: sheet.validations ?? [] });
    if (JSON.stringify(previous.conditionalFormats ?? []) !== JSON.stringify(sheet.conditionalFormats ?? []))
      operations.push({ kind: "set-conditional-formats", sheetId: sheet.id, conditionalFormats: sheet.conditionalFormats ?? [] });
  }
  if (JSON.stringify(before.definedNames) !== JSON.stringify(after.definedNames))
    operations.push({ kind: "set-defined-names", names: after.definedNames });
  return operations;
}

export function xlsxProjectionUpdateFromContent(
  content: unknown,
  base: XlsxProjection,
) {
  const projection = xlsxProjectionFromContent(content, base);
  return { projection, operations: xlsxOperationsBetween(base, projection) };
}

const pptxEditorContentSchema = z
  .object({
    slides: z.array(
      z
        .object({
          id: z.string(),
          title: z.string().optional(),
          speakerNotes: z.string().optional(),
          hidden: z.boolean().optional(),
          objects: z
            .array(
              z
                .object({
                  id: z.string().optional(),
                  type: z.string(),
                  content: z.unknown().optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function editorObject(value: Record<string, unknown>, fallbackId: string) {
  return {
    id: typeof value.id === "string" && value.id ? value.id : fallbackId,
    type: value.type as PptxProjection["slides"][number]["objects"][number]["type"],
    x: typeof value.x === "number" ? value.x : 80,
    y: typeof value.y === "number" ? value.y : 300,
    width: typeof value.width === "number" ? value.width : 600,
    height: typeof value.height === "number" ? value.height : 80,
    rotation: typeof value.rotation === "number" ? value.rotation : 0,
    content: value.content ?? { text: "" },
    ...value,
  };
}

export type PptxContentProjectionOptions = {
  /** Only callers holding a complete hydrated editor model may authorize removal. */
  objectLists?: "complete";
};

/** The one Presentation editor-model -> PPTX projection transform. */
export function pptxProjectionFromContent(
  content: unknown,
  base: PptxProjection,
  options?: PptxContentProjectionOptions,
): PptxProjection {
  if (content == null) return base;
  const raw = pptxEditorContentSchema.parse(content);
  const baseById = new Map(base.slides.map((slide) => [slide.id, slide]));
  if (!raw.slides.length) return base;
  return pptxProjectionSchema.parse({
    ...base,
    slides: raw.slides.map((next, index) => {
      const slide = baseById.get(next.id);
      const incomingRawObjects = (next.objects ?? []).map(
        (object) => object as Record<string, unknown>,
      );
      const incomingObjects = (
        slide
          ? incomingRawObjects
          : incomingRawObjects.map((object, objectIndex) =>
              editorObject(object, `${next.id}:spectra:${objectIndex + 1}`),
            )
      ) as Array<PptxProjection["slides"][number]["objects"][number]>;
      const text = incomingObjects
        .filter((object) => object.type === "text")
        .map((object) => {
          const value = object.content as { text?: unknown } | string;
          return typeof value === "string"
            ? value
            : typeof value?.text === "string"
              ? value.text
              : "";
        });
      if (!slide)
        return {
          id: next.id,
          index,
          title: next.title ?? "",
          text,
          objects: incomingObjects,
          hasTransition: false,
          hasTiming: false,
          ...(next.hidden ? { hidden: true } : {}),
          speakerNotes: next.speakerNotes ?? "",
        };
      // Completeness is caller authority, never inferred from binding metadata.
      // Even an authorized whole-model caller may omit this property to carry it.
      const completeObjects = options?.objectLists === "complete" && next.objects !== undefined;
      if (completeObjects) z.array(presentationObjectProjectionSchema).parse(next.objects);
      const previousById = new Map(slide.objects.map((object) => [object.id, object]));
      const incomingIds = new Set<string>();
      const occupiedIds = new Set([...previousById.keys(), ...incomingObjects.flatMap((object) => object.id ? [object.id] : [])]);
      const resolvedObjects = incomingObjects.map((incoming, objectIndex) => {
        if (incoming.id && incomingIds.has(incoming.id))
          throw codedOfficeContentError("PPTX_DUPLICATE_OBJECT_ID", "A slide contains duplicate object identities.");
        if (incoming.id) incomingIds.add(incoming.id);
        const previous = previousById.get(incoming.id);
        if (previous) {
          // A sparse content patch must not erase native shape/media locators.
          const content = !completeObjects && incoming.content && typeof incoming.content === "object" && !Array.isArray(incoming.content)
            ? { ...record(previous.content), ...record(incoming.content) }
            : incoming.content ?? previous.content;
          return { ...previous, ...incoming, content };
        }
        let suffix = objectIndex + 1;
        while (occupiedIds.has(`${next.id}:spectra:${suffix}`)) suffix += 1;
        const fallbackId = `${next.id}:spectra:${suffix}`;
        occupiedIds.add(fallbackId);
        return editorObject(incoming, fallbackId);
      });
      const resolvedById = new Map(resolvedObjects.map((object) => [object.id, object]));
      const objects = completeObjects
        ? resolvedObjects
        : [
            ...slide.objects.map((object) => resolvedById.get(object.id) ?? object),
            ...resolvedObjects.filter((object) => !previousById.has(object.id)),
          ];
      return {
        ...slide,
        index,
        title: next.title ?? slide.title,
        hidden: Object.prototype.hasOwnProperty.call(next, "hidden") || completeObjects
          ? next.hidden === true || undefined
          : slide.hidden,
        speakerNotes: next.speakerNotes ?? slide.speakerNotes,
        text: completeObjects ? objects.filter((object) => object.type === "text").map((object) => presentationObjectText(object as PresentationObject)) : text.length ? text : slide.text,
        objects,
      };
    }),
  });
}

export function pptxOperationsBetween(
  before: PptxProjection,
  after: PptxProjection,
): PptxOperation[] {
  const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  const textOf = (object: PptxProjection["slides"][number]["objects"][number]) => presentationObjectText(object as PresentationObject);
  const paragraphsOf = (object: PptxProjection["slides"][number]["objects"][number]) => {
    const content = object.content && typeof object.content === "object" ? object.content as Record<string, unknown> : {};
    return Array.isArray(content.paragraphs) ? content.paragraphs as PresentationParagraph[] : undefined;
  };
  const objectData = (object: PptxProjection["slides"][number]["objects"][number]) =>
    object.content && typeof object.content === "object"
      ? object.content as Record<string, unknown>
      : {};
  const nativeId = (object: PptxProjection["slides"][number]["objects"][number]) => {
    const value = objectData(object).nativeShapeId;
    return typeof value === "string" ? value : undefined;
  };
  const chartData = (object: PptxProjection["slides"][number]["objects"][number]) => {
    const value = objectData(object);
    const chartType = ["bar", "column", "line", "pie", "area"].includes(String(value.chartType))
      ? value.chartType as "bar" | "column" | "line" | "pie" | "area"
      : undefined;
    const categories = Array.isArray(value.categories)
      ? value.categories.map(String)
      : Array.isArray(value.labels)
        ? value.labels.map(String)
        : [];
    const series = Array.isArray(value.series)
      ? value.series.flatMap((candidate, index) => {
          if (!candidate || typeof candidate !== "object") return [];
          const row = candidate as Record<string, unknown>;
          return [{
            ...(typeof row.id === "string" ? { id: row.id } : {}),
            name: typeof row.name === "string" ? row.name : `Series ${index + 1}`,
            categories: Array.isArray(row.categories) ? row.categories.map(String) : categories,
            values: Array.isArray(row.values) ? row.values.map(Number).filter(Number.isFinite) : [],
          }];
        })
      : [{
          name: "Series 1",
          categories,
          values: Array.isArray(value.values) ? value.values.map(Number).filter(Number.isFinite) : [],
        }];
    return {
      ...(chartType ? { chartType } : {}),
      ...(typeof value.title === "string" ? { title: value.title } : {}),
      categories,
      series,
      ...(typeof value.showLegend === "boolean" ? { showLegend: value.showLegend } : {}),
      ...(typeof value.axisTitle === "string" ? { axisTitle: value.axisTitle } : {}),
      ...(typeof value.valueAxisTitle === "string" ? { valueAxisTitle: value.valueAxisTitle } : {}),
    };
  };
  const duplicateSource = (slide: PptxProjection["slides"][number]) => {
    const signature = (candidate: PptxProjection["slides"][number]) => JSON.stringify({
      title: candidate.title,
      speakerNotes: candidate.speakerNotes,
      objects: candidate.objects.map((object) => ({
        type: object.type,
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rotation: object.rotation,
        content: object.content,
        style: object.style,
      })),
    });
    return before.slides.find((candidate) => signature(candidate) === signature(slide));
  };
  const previous = new Map(before.slides.map((slide) => [slide.id, slide]));
  const operations: PptxOperation[] = [];
  const kept = new Set(after.slides.map((slide) => slide.id));
  for (const old of before.slides)
    if (!kept.has(old.id))
      operations.push({ kind: "remove-slide", slideId: old.id });
  const layoutForNewSlideAt = (index: number) => {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = previous.get(after.slides[cursor]!.id);
      if (candidate?.layoutPartName) return candidate.layoutPartName;
    }
    return before.slides.find((slide) => slide.layoutPartName)?.layoutPartName;
  };
  after.slides.forEach((slide, slideIndex) => {
    const old = previous.get(slide.id);
    if (!old) {
      const duplicate = duplicateSource(slide);
      if (duplicate) {
        operations.push({ kind: "duplicate-slide", slideId: duplicate.id, newSlideId: slide.id, ...(slide.title !== duplicate.title ? { title: slide.title } : {}) });
        return;
      }
      const text = slide.objects
        .filter((object) => object.type === "text")
        .map((object) => {
          return textOf(object);
        })
        .filter((line) => line.trim() && line.trim() !== slide.title.trim());
      const layoutPartName = layoutForNewSlideAt(slideIndex);
      operations.push({
        kind: "add-slide",
        slideId: slide.id,
        ...(layoutPartName ? { layoutPartName } : {}),
        ...(slide.title ? { title: slide.title } : {}),
        ...(text.length ? { text } : {}),
        objects: slide.objects,
      });
      if (slide.speakerNotes)
        operations.push({
          kind: "set-notes",
          slideId: slide.id,
          text: slide.speakerNotes,
        });
      if (slide.hidden)
        operations.push({
          kind: "set-slide-hidden",
          slideId: slide.id,
          hidden: true,
        });
      return;
    }
    if (slide.title !== old.title)
      operations.push({
        kind: "set-title",
        slideId: slide.id,
        text: slide.title,
      });
    if (slide.speakerNotes !== old.speakerNotes)
      operations.push({
        kind: "set-notes",
        slideId: slide.id,
        text: slide.speakerNotes,
      });
    if (Boolean(slide.hidden) !== Boolean(old.hidden))
      operations.push({
        kind: "set-slide-hidden",
        slideId: slide.id,
        hidden: Boolean(slide.hidden),
      });
    const oldObjects = new Map(
      old.objects.map((object) => [object.id, object]),
    );
    const keptObjects = new Set(slide.objects.map((object) => object.id));
    for (const oldObject of old.objects) {
      if (!keptObjects.has(oldObject.id)) {
        const id = nativeId(oldObject);
        if (id) operations.push({ kind: "remove-object", slideId: slide.id, shapeId: id });
      }
    }
    for (const object of slide.objects) {
      const previousObject = oldObjects.get(object.id);
      const value = objectData(object);
      const nextText = textOf(object);
      if (!previousObject) {
        if (object.type === "group") {
          const childShapeIds = slide.objects
            .filter((candidate) => candidate.parentId === object.id)
            .map(nativeId)
            .filter((id): id is string => Boolean(id));
          if (childShapeIds.length >= 2)
            operations.push({ kind: "group-objects", slideId: slide.id, groupId: object.id, childShapeIds, x: object.x, y: object.y, width: object.width, height: object.height, rotation: object.rotation, ...(object.readingOrder !== undefined ? { readingOrder: object.readingOrder } : {}) });
        }
        if (object.type === "text" && nextText)
          operations.push({
            kind: "add-text-box",
            slideId: slide.id,
            text: nextText,
            ...(object.hyperlink ? { hyperlink: object.hyperlink } : {}),
          });
        continue;
      }
      const previousText = textOf(previousObject);
      const nativeShapeId = nativeId(object);
      if (nativeShapeId && object.type === "text" && nextText !== previousText)
        operations.push({
          kind: "set-text",
          slideId: slide.id,
          paragraphIndex: 0,
          shapeId: nativeShapeId,
          text: nextText,
        });
      if (!nativeShapeId) continue;
      if (equal(object.hyperlink, previousObject.hyperlink) === false)
        operations.push({
          kind: "set-object-link",
          slideId: slide.id,
          shapeId: nativeShapeId,
          hyperlink: object.hyperlink ?? null,
        });
      if ((object.altText ?? "") !== (previousObject.altText ?? ""))
        operations.push({
          kind: "set-alt-text",
          slideId: slide.id,
          shapeId: nativeShapeId,
          text: object.altText ?? "",
        });
      const moved = (["x", "y", "width", "height", "rotation"] as const).some(
        (key) => Math.abs(object[key] - previousObject[key]) > 0.5,
      );
      if (moved && !object.locked)
        operations.push({
          kind: "set-geometry",
          slideId: slide.id,
          shapeId: nativeShapeId,
          x: object.x,
          y: object.y,
          width: object.width,
          height: object.height,
          rotation: object.rotation,
        });
      const nextParagraphs = paragraphsOf(object);
      const previousParagraphs = paragraphsOf(previousObject);
      if (object.type === "text" && nextParagraphs && !equal(nextParagraphs, previousParagraphs)) {
        operations.push({ kind: "format-rich-text", slideId: slide.id, shapeId: nativeShapeId, paragraphs: nextParagraphs });
      } else if (object.type === "text" && !equal(object.style, previousObject.style)) {
        const style = object.style ?? {};
        const oldStyle = previousObject.style ?? {};
        operations.push({
          kind: "format-text",
          slideId: slide.id,
          shapeId: nativeShapeId,
          format: {
            ...(style.fontFamily !== undefined || oldStyle.fontFamily !== undefined ? { fontFamily: typeof style.fontFamily === "string" ? normalizeNativeFontFamily(style.fontFamily, "Arial") : null } : {}),
            ...(style.fontSize !== undefined || oldStyle.fontSize !== undefined ? { fontSizePt: typeof style.fontSize === "number" ? style.fontSize : null } : {}),
            ...(style.fontWeight !== undefined || oldStyle.fontWeight !== undefined ? { bold: typeof style.fontWeight === "number" ? style.fontWeight >= 600 : null } : {}),
            ...(style.italic !== undefined || oldStyle.italic !== undefined ? { italic: typeof style.italic === "boolean" ? style.italic : null } : {}),
            ...(style.underline !== undefined || oldStyle.underline !== undefined ? { underline: typeof style.underline === "boolean" ? style.underline : null } : {}),
            ...(style.textDecoration !== undefined || oldStyle.textDecoration !== undefined ? { strike: typeof style.textDecoration === "string" ? style.textDecoration === "line-through" : null } : {}),
            ...(style.color !== undefined || oldStyle.color !== undefined ? { color: typeof style.color === "string" ? style.color : null } : {}),
            ...(style.align !== undefined || oldStyle.align !== undefined ? { align: style.align === "left" || style.align === "center" || style.align === "right" || style.align === "justify" ? style.align : null } : {}),
          },
        });
      } else if (object.type === "chart" && (!equal(chartData(object), chartData(previousObject)) || !equal(object.sourceBinding, previousObject.sourceBinding))) {
        const data = chartData(object);
        operations.push({
          kind: "set-chart",
          slideId: slide.id,
          shapeId: nativeShapeId,
          ...data,
          ...(typeof objectData(previousObject).title === "string" && value.title === undefined ? { title: null } : {}),
          ...(typeof objectData(previousObject).axisTitle === "string" && value.axisTitle === undefined ? { axisTitle: null } : {}),
          ...(typeof objectData(previousObject).valueAxisTitle === "string" && value.valueAxisTitle === undefined ? { valueAxisTitle: null } : {}),
          ...(object.sourceBinding?.artifactId ? { sourceArtifactId: object.sourceBinding.artifactId } : {}),
          ...(object.sourceBinding ? { sourceChartId: typeof value.sourceChartId === "string" ? value.sourceChartId : typeof value.nativeChartPart === "string" ? value.nativeChartPart : undefined } : {}),
          ...(object.sourceBinding?.versionId ? { sourceRevision: object.sourceBinding.versionId } : {}),
          ...(object.sourceBinding?.kind ? { sourceKind: object.sourceBinding.kind } : {}),
          ...(object.sourceBinding?.range ? { sourceRange: object.sourceBinding.range } : {}),
          ...(object.sourceBinding?.live !== undefined ? { sourceLive: object.sourceBinding.live } : {}),
        });
      } else if (object.type === "table") {
        const nextRows = (value.rows ?? []) as unknown[];
        const oldRows = (objectData(previousObject).rows ?? []) as unknown[];
        nextRows.forEach((row, rowIndex) => {
          if (!Array.isArray(row)) return;
          row.forEach((cell, columnIndex) => {
            const nextCell = cell && typeof cell === "object" ? cell as Record<string, unknown> : {};
            const priorRow = Array.isArray(oldRows[rowIndex]) ? oldRows[rowIndex] as unknown[] : [];
            const priorCell = priorRow[columnIndex] && typeof priorRow[columnIndex] === "object" ? priorRow[columnIndex] as Record<string, unknown> : {};
            const nextCellText = typeof nextCell.text === "string" ? nextCell.text : String(nextCell.value ?? "");
            const priorCellText = typeof priorCell.text === "string" ? priorCell.text : String(priorCell.value ?? "");
            if (nextCellText !== priorCellText) operations.push({ kind: "set-table-cell-text", slideId: slide.id, shapeId: nativeShapeId, row: rowIndex, column: columnIndex, text: nextCellText });
            if (!equal(nextCell.style, priorCell.style) && nextCell.style && typeof nextCell.style === "object") operations.push({ kind: "set-table-cell-format", slideId: slide.id, shapeId: nativeShapeId, row: rowIndex, column: columnIndex, format: nextCell.style as Record<string, unknown> });
          });
        });
      } else if (!equal(object.style, previousObject.style) && object.style) {
        operations.push({ kind: "set-shape-style", slideId: slide.id, shapeId: nativeShapeId, style: object.style });
      }
      if (object.type === "image") {
        const cropFromStyle = (style: Record<string, unknown> | undefined) => {
          if (!style || (style.fit !== "cover" && style.focalX === undefined && style.focalY === undefined)) return undefined;
          const focalX = typeof style.focalX === "number" ? Math.max(0, Math.min(100, style.focalX)) : 50;
          const focalY = typeof style.focalY === "number" ? Math.max(0, Math.min(100, style.focalY)) : 50;
          return { left: Math.max(0, focalX - 50), top: Math.max(0, focalY - 50), right: Math.max(0, 50 - focalX), bottom: Math.max(0, 50 - focalY) };
        };
        const crop = value.crop && typeof value.crop === "object" ? value.crop as Record<string, unknown> : cropFromStyle(object.style);
        const previousData = objectData(previousObject);
        const previousCrop = previousData.crop && typeof previousData.crop === "object" ? previousData.crop as Record<string, unknown> : cropFromStyle(previousObject.style);
        if (!equal(crop, previousCrop) && crop)
          operations.push({ kind: "set-image-crop", slideId: slide.id, shapeId: nativeShapeId, crop: { left: Number(crop.left ?? 0), top: Number(crop.top ?? 0), right: Number(crop.right ?? 0), bottom: Number(crop.bottom ?? 0) } });
      }
      if (object.hidden !== previousObject.hidden || object.readingOrder !== previousObject.readingOrder || object.parentId !== previousObject.parentId) {
        operations.push({ kind: "set-object-state", slideId: slide.id, shapeId: nativeShapeId, ...(object.hidden !== undefined ? { hidden: object.hidden } : {}), ...(object.readingOrder !== undefined ? { readingOrder: object.readingOrder } : {}), ...(object.parentId !== undefined ? { parentId: object.parentId ?? null } : {}) });
      }
    }
  });
  const orderNow = before.slides
    .filter((slide) => kept.has(slide.id))
    .map((slide) => slide.id);
  const orderNext = after.slides.map((slide) => slide.id);
  if (
    orderNext.length !== orderNow.length ||
    orderNext.some((id, index) => id !== orderNow[index])
  )
    operations.push({ kind: "reorder-slides", order: orderNext });
  if (!equal(before.nativeBinding.themeFonts, after.nativeBinding.themeFonts) && after.nativeBinding.themeFonts)
    operations.push({ kind: "set-theme-fonts", ...after.nativeBinding.themeFonts });
  return operations;
}

export function pptxProjectionUpdateFromContent(
  content: unknown,
  base: PptxProjection,
  options?: PptxContentProjectionOptions,
) {
  const projection = pptxProjectionFromContent(content, base, options);
  return { projection, operations: pptxOperationsBetween(base, projection) };
}
