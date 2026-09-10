import type { SheetCell } from "./model";

type ExcelJsFormulaResult = Exclude<SheetCell["value"], null | undefined>;

/**
 * Build the value ExcelJS should write for a formula cell. Cached-only
 * formulas intentionally have no result: the editor cannot prove a new
 * value, so an old number must not be serialized as though it were current.
 */
export function xlsxFormulaExportValue(
  cell: SheetCell,
  calculatedValue: SheetCell["value"] | undefined,
) {
  const formula = (cell.formula ?? "").replace(/^=/, "");
  const value: { formula: string; result?: ExcelJsFormulaResult } = { formula };
  if (
    cell.nativeFormulaSupport !== "cached-only" &&
    !cell.cachedValueStale &&
    calculatedValue !== undefined &&
    calculatedValue !== null
  )
    value.result = calculatedValue as ExcelJsFormulaResult;
  return value;
}

export function xlsxExportCalculationProperties(
  calculationMode: "automatic" | "manual",
) {
  return {
    calcMode: calculationMode === "manual" ? "manual" : "auto",
    fullCalcOnLoad: calculationMode !== "manual",
    forceFullCalc: calculationMode !== "manual",
  } as const;
}
