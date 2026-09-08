export const XLSX_RECOGNIZED_FORMULAS = new Set([
  "ABS",
  "AVERAGE",
  "COUNT",
  "COUNTA",
  "IF",
  "INDEX",
  "MAX",
  "MIN",
  "ROUND",
  "SUM",
]);

export function xlsxFormulaSupport(formula: string) {
  const functions = [
    ...formula.matchAll(
      /(?:^|[^A-Z0-9_.])(?:_xlfn\.)?([A-Z][A-Z0-9_.]*)\s*\(/gi,
    ),
  ].map((match) => match[1]!.toUpperCase());
  return functions.every((name) => XLSX_RECOGNIZED_FORMULAS.has(name))
    ? ("recognized" as const)
    : ("cached-only" as const);
}
