import type { SheetCell } from "./model";
import { readSheetCellsOverlay } from "./cell-overlay";

type FormulaIndex = {
  cached: ReadonlyMap<string, SheetCell>;
  formulas: ReadonlyMap<string, string>;
};
const indexes = new WeakMap<Record<string, SheetCell>, FormulaIndex>();

/** Index the immutable base once; a cell overlay only changes its own entries. */
function indexFormulaCells(cells: Record<string, SheetCell>): FormulaIndex {
  const cached = indexes.get(cells);
  if (cached) return cached;
  const overlay = readSheetCellsOverlay(cells);
  const base = overlay ? indexFormulaCells(overlay.base) : undefined;
  let entries: Map<string, SheetCell> | undefined;
  let formulas: Map<string, string> | undefined;
  for (const [address, cell] of Object.entries(overlay?.patch ?? cells)) {
    const cachedCell = cell?.formula && cell.nativeFormulaSupport === "cached-only" ? cell : undefined;
    if (cachedCell !== base?.cached.get(address)) {
      entries ??= new Map(base?.cached);
      if (cachedCell) entries.set(address, cachedCell);
      else entries.delete(address);
    }
    if ((cell?.formula || undefined) !== base?.formulas.get(address)) {
      formulas ??= new Map(base?.formulas);
      if (cell?.formula) formulas.set(address, cell.formula);
      else formulas.delete(address);
    }
  }
  const result = { cached: entries ?? base?.cached ?? new Map(), formulas: formulas ?? base?.formulas ?? new Map() };
  indexes.set(cells, result);
  return result;
}

export function cachedFormulaCells(cells: Record<string, SheetCell>): ReadonlyMap<string, SheetCell> {
  return indexFormulaCells(cells).cached;
}

/** Stable across value/format/staleness overlays, so dependency graphs survive edits. */
export function formulaCellTexts(cells: Record<string, SheetCell>): ReadonlyMap<string, string> {
  return indexFormulaCells(cells).formulas;
}
