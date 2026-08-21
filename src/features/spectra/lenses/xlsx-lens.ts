import { Workbook, parseCellRef, type CellValue } from "@ariadng/office/xlsx";
import { comparePackages } from "@ariadng/office/preservation";
import type { XmlElement } from "@ariadng/office/xml";
import { sha256Payload } from "./docx-lens";
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

const SML = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

export const XLSX_RECOGNIZED_FORMULAS = new Set([
  "ABS", "AVERAGE", "COUNT", "COUNTA", "IF", "MAX", "MIN", "ROUND", "SUM",
]);

export type XlsxCellProjection = {
  id: string;
  ref: string;
  value: CellValue;
  formula?: string;
  formulaSupport?: "recognized" | "cached-only";
  style?: Record<string, unknown>;
};

export type XlsxSheetProjection = {
  id: string;
  name: string;
  cells: XlsxCellProjection[];
  merges: readonly string[];
};

export type XlsxProjection = {
  sheets: XlsxSheetProjection[];
  definedNames: Array<{ name: string; ref: string; sheet?: string }>;
  nativeBinding: {
    version: 1;
    format: "xlsx" | "xlsm" | "xltx" | "xltm" | "xlam";
    profile: LensCompatibilityProfile;
    macroEnabled: boolean;
    semanticDigest: string;
    recognizedFormulaFunctions: string[];
  };
};

export type XlsxSemanticDelta =
  | { kind: "set-cell"; sheetId: string; ref: string; value: CellValue }
  | { kind: "set-formula"; sheetId: string; ref: string; formula: string }
  | { kind: "ai-edit"; operations: Exclude<XlsxSemanticDelta, { kind: "ai-edit" }>[] };

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

async function projectWorkbook(workbook: Workbook, profile: LensCompatibilityProfile) {
  const entries: LensFidelityEntry[] = [];
  const sheets: XlsxSheetProjection[] = [];
  for (const sheet of workbook.sheets()) {
    const doc = await workbook.office.xml(sheet.partName);
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
        class: formula && support === "cached-only" ? "PRESERVED" : "NATIVE",
        partName: sheet.partName,
        ...(formula && support === "cached-only"
          ? { reason: "Spectra shows Excel's cached value and preserves the native formula text. Formula text remains editable." }
          : {}),
      });
      return {
        id,
        ref: ref.toUpperCase(),
        value: info.value,
        ...(formula ? { formula, formulaSupport: support } : {}),
        style: sheet.getCellStyle(ref) as unknown as Record<string, unknown>,
      };
    });
    sheets.push({ id: `xlsx:sheet:${sheet.sheetId}`, name: sheet.name, cells, merges: sheet.merges() });
  }
  const partNames = workbook.office.package.parts().map((part) => part.name);
  const preserved: Array<[string, RegExp]> = [
    ["pivot", /\/pivot/i], ["chart", /\/charts\//i], ["conditional-formatting", /\/worksheets\//i],
    ["external-link", /\/externalLinks\//i], ["comment", /\/comments/i], ["sparkline", /sparkline/i],
    ["unknown-extension", /unknown|future|extension/i],
  ];
  for (const [feature, pattern] of preserved) {
    const partName = partNames.find((name) => pattern.test(name));
    if (partName) entries.push({ regionId: `xlsx:feature:${feature}`, feature, class: "PRESERVED", partName, readOnly: true });
  }
  if (workbook.office.format.macroEnabled) {
    const partName = partNames.find((name) => /\/xl\/vbaProject\.bin$/i.test(name));
    entries.push({ regionId: "xlsx:feature:macro", feature: "macro", class: "PRESERVED", partName, readOnly: true, reason: "Macros remain byte-identical and are never executed by Spectra." });
  }
  const fidelityMap: LensFidelityMap = { version: 1, profile, entries };
  const definedNames = workbook.definedNames().map((item) => ({ name: item.name, ref: item.ref, ...(item.sheet ? { sheet: item.sheet } : {}) }));
  const semanticDigest = await sha256Payload(new TextEncoder().encode(JSON.stringify({ sheets: sheets.map((s) => ({ name: s.name, cells: s.cells.map(({ ref, value, formula }) => ({ ref, value, formula })) })), definedNames })));
  const projection: XlsxProjection = {
    sheets,
    definedNames,
    nativeBinding: {
      version: 1,
      format: workbook.office.format.extension as XlsxProjection["nativeBinding"]["format"],
      profile,
      macroEnabled: workbook.office.format.macroEnabled,
      semanticDigest,
      recognizedFormulaFunctions: [...XLSX_RECOGNIZED_FORMULAS].sort(),
    },
  };
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
    parseCellRef(operation.ref);
    if (operation.kind === "set-formula") sheet.setFormula(operation.ref, operation.formula);
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
    const beforeSheets = new Map(carry.projection.sheets.map((sheet) => [sheet.id, sheet]));
    const operations: Exclude<XlsxSemanticDelta, { kind: "ai-edit" }>[] = [];
    for (const sheet of projection.sheets) {
      const previous = beforeSheets.get(sheet.id);
      if (!previous) throw new XlsxLensError("XLSX_TOPOLOGY_UNSUPPORTED", "Adding worksheets to a mounted Excel file is not available in strict native mode yet.");
      const oldCells = new Map(previous.cells.map((cell) => [cell.ref, cell]));
      for (const cell of sheet.cells) {
        const old = oldCells.get(cell.ref);
        if (!old) {
          if (cell.formula) operations.push({ kind: "set-formula", sheetId: sheet.id, ref: cell.ref, formula: cell.formula });
          else operations.push({ kind: "set-cell", sheetId: sheet.id, ref: cell.ref, value: cell.value });
          continue;
        }
        if (cell.formula !== old.formula) {
          if (!cell.formula) throw new XlsxLensError("XLSX_FORMULA_LITERALIZATION_BLOCKED", `Formula ${sheet.name}!${cell.ref} cannot be silently rewritten as a literal.`);
          operations.push({ kind: "set-formula", sheetId: sheet.id, ref: cell.ref, formula: cell.formula });
        } else if (!cell.formula && JSON.stringify(cell.value) !== JSON.stringify(old.value)) {
          operations.push({ kind: "set-cell", sheetId: sheet.id, ref: cell.ref, value: cell.value });
        }
      }
    }
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
    const changedParts = comparison.parts.filter((part) => part.verdict !== "identical").map((part) => `/${part.name}`);
    const modeled = new Set(after.projection.sheets.map((sheet) => workbookPart(sheet, after.projection)));
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
