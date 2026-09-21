import { formulaCellTexts } from "./cached-formulas";
import { collectFormulaReferences } from "./formula-refs";
import { coordinateToAddress, parseAddress, type CellCoordinate, type SheetsContent } from "./model";

type FormulaCell = { sheetId: string; address: string };
type DependencyRange = { start: CellCoordinate; end: CellCoordinate; formula: FormulaCell };
type RangeTree = {
  start: CellCoordinate;
  end: CellCoordinate;
  entries?: DependencyRange[];
  left?: RangeTree;
  right?: RangeTree;
};

function rangeTree(entries: DependencyRange[]): RangeTree | undefined {
  if (!entries.length) return undefined;
  const start = { row: Infinity, column: Infinity };
  const end = { row: -Infinity, column: -Infinity };
  const centerStart = { row: Infinity, column: Infinity };
  const centerEnd = { row: -Infinity, column: -Infinity };
  for (const entry of entries) {
    for (const axis of ["row", "column"] as const) {
      start[axis] = Math.min(start[axis], entry.start[axis]);
      end[axis] = Math.max(end[axis], entry.end[axis]);
      const center = entry.start[axis] + entry.end[axis];
      centerStart[axis] = Math.min(centerStart[axis], center);
      centerEnd[axis] = Math.max(centerEnd[axis], center);
    }
  }
  if (entries.length <= 8) return { start, end, entries };
  const axis = centerEnd.row - centerStart.row > centerEnd.column - centerStart.column ? "row" : "column";
  entries.sort((a, b) => a.start[axis] + a.end[axis] - b.start[axis] - b.end[axis]);
  const middle = Math.floor(entries.length / 2);
  return { start, end, left: rangeTree(entries.slice(0, middle)), right: rangeTree(entries.slice(middle)) };
}

function contains(range: Pick<RangeTree, "start" | "end">, point: CellCoordinate) {
  return point.row >= range.start.row && point.row <= range.end.row &&
    point.column >= range.start.column && point.column <= range.end.column;
}

function visitRanges(tree: RangeTree | undefined, point: CellCoordinate, visit: (cell: FormulaCell) => void) {
  if (!tree || !contains(tree, point)) return;
  if (tree.entries) {
    for (const entry of tree.entries) if (contains(entry, point)) visit(entry.formula);
  } else {
    visitRanges(tree.left, point, visit);
    visitRanges(tree.right, point, visit);
  }
}

type FormulaGraph = {
  sheets: Array<{ id: string; name: string; formulas: ReadonlyMap<string, string> }>;
  names: SheetsContent["workbook"]["namedRanges"];
  targets: Map<string, { cells: Map<string, FormulaCell[]>; ranges?: RangeTree }>;
};
const graphs = new WeakMap<SheetsContent["workbook"], FormulaGraph>();

function dependencyGraph(content: SheetsContent): FormulaGraph {
  const sheets = content.sheets.map(sheet => ({ id: sheet.id, name: sheet.name, formulas: formulaCellTexts(sheet.cells) }));
  const cached = graphs.get(content.workbook);
  if (cached && cached.names === content.workbook.namedRanges && cached.sheets.length === sheets.length &&
    sheets.every((sheet, i) => sheet.id === cached.sheets[i]!.id && sheet.name === cached.sheets[i]!.name && sheet.formulas === cached.sheets[i]!.formulas)) return cached;
  const targets: FormulaGraph["targets"] = new Map();
  const ranges = new Map<string, DependencyRange[]>();
  const byName = new Map(sheets.map(sheet => [sheet.name.toUpperCase(), sheet.id]));
  const names = new Map(Object.entries(content.workbook.namedRanges ?? {}).map(([name, value]) => [name.toUpperCase(), value]));
  for (const sheet of sheets) {
    for (const [address, formula] of sheet.formulas) {
      const cell = { sheetId: sheet.id, address };
      for (const ref of collectFormulaReferences(formula, names)) {
        const targetId = ref.sheet === null ? sheet.id : byName.get(ref.sheet.toUpperCase());
        if (!targetId) continue;
        let target = targets.get(targetId);
        if (!target) { target = { cells: new Map() }; targets.set(targetId, target); }
        if (ref.start.row === ref.end.row && ref.start.column === ref.end.column) {
          const key = coordinateToAddress(ref.start);
          const dependents = target.cells.get(key) ?? [];
          dependents.push(cell);
          target.cells.set(key, dependents);
        } else {
          const entries = ranges.get(targetId) ?? [];
          entries.push({
            start: { row: Math.min(ref.start.row, ref.end.row), column: Math.min(ref.start.column, ref.end.column) },
            end: { row: Math.max(ref.start.row, ref.end.row), column: Math.max(ref.start.column, ref.end.column) },
            formula: cell,
          });
          ranges.set(targetId, entries);
        }
      }
    }
  }
  for (const [id, entries] of ranges) targets.get(id)!.ranges = rangeTree(entries);
  const result = { sheets, names: content.workbook.namedRanges, targets };
  graphs.set(content.workbook, result);
  return result;
}

/** Visit each affected formula once, including recalculable links and cycles.
 * Ranges stay rectangles; whole-column dependencies never enumerate empty cells. */
export function affectedFormulaCells(content: SheetsContent, changed: ReadonlyMap<string, ReadonlySet<string>>) {
  const graph = dependencyGraph(content);
  const affected = new Map<string, Set<string>>();
  const queue: FormulaCell[] = [];
  const enqueue = (cell: FormulaCell) => {
    const addresses = affected.get(cell.sheetId) ?? new Set<string>();
    if (addresses.has(cell.address)) return;
    addresses.add(cell.address);
    affected.set(cell.sheetId, addresses);
    queue.push(cell);
  };
  for (const [sheetId, addresses] of changed) for (const address of addresses) enqueue({ sheetId, address });
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i]!;
    const target = graph.targets.get(cell.sheetId);
    if (!target) continue;
    for (const dependent of target.cells.get(cell.address) ?? []) enqueue(dependent);
    const point = parseAddress(cell.address);
    if (point) visitRanges(target.ranges, point, enqueue);
  }
  return affected;
}
