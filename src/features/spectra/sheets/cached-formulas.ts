import type { SheetCell } from "./model";
import { readSheetCellsOverlay } from "./cell-overlay";

const indexes = new WeakMap<Record<string, SheetCell>, ReadonlyMap<string, SheetCell>>();

/** Index the immutable base once; a cell overlay only changes its own entries. */
export function cachedFormulaCells(cells: Record<string, SheetCell>): ReadonlyMap<string, SheetCell> {
  const cached = indexes.get(cells);
  if (cached) return cached;
  const overlay = readSheetCellsOverlay(cells);
  const entries = new Map(overlay ? cachedFormulaCells(overlay.base) : []);
  for (const [address, cell] of Object.entries(overlay?.patch ?? cells)) {
    if (cell?.formula && cell.nativeFormulaSupport === "cached-only") entries.set(address, cell);
    else entries.delete(address);
  }
  indexes.set(cells, entries);
  return entries;
}
