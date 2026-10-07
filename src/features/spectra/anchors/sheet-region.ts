/*
 * The sheet and cells a region names. The semantic layer indexes a sheet in
 * row ranges: the first range is named by the sheet id, later ones by the
 * row identity or "sheetId:row:N", and each is labelled "Sheet name A1:F40".
 * A citation may name a range on its own ("A1:C9", "Sheet1!B4"). The passage
 * that matched narrows a range to the row it is in.
 */
import { bestByExcerpt, cellRangeIn, foldText, regionTexts, type CellRangeLocator, type WorkRegion } from "./locate";

type RegionSheet = {
  id: string;
  name: string;
  cells: Record<string, unknown>;
  rowIdentities?: Record<string, string>;
  hidden?: boolean;
};

export type SheetLanding = { sheetId: string; range: { start: { row: number; column: number }; end: { row: number; column: number } } };

const ADDRESS = /^([A-Z]+)([1-9][0-9]*)$/;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  const cell = value as { value?: unknown; displayValue?: unknown; formula?: unknown };
  const shown = cell.value ?? cell.displayValue;
  if (shown === undefined || shown === null) return typeof cell.formula === "string" ? cell.formula : "";
  return typeof shown === "object" ? "" : String(shown);
}

function columnOf(letters: string) {
  return letters.split("").reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) - 1;
}

/** The text of each non-empty row between `from` and `to`, cells joined as the semantic layer joins them. */
function rowTexts(sheet: RegionSheet, from: number, to: number) {
  const rows = new Map<number, Array<[number, string]>>();
  for (const [address, value] of Object.entries(sheet.cells ?? {})) {
    const match = ADDRESS.exec(address);
    if (!match) continue;
    const row = Number(match[2]) - 1;
    if (row < from || row > to) continue;
    const text = cellText(value).trim();
    if (!text) continue;
    const list = rows.get(row) ?? [];
    list.push([columnOf(match[1]!), text]);
    rows.set(row, list);
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, cells]) => ({ row, text: cells.sort((a, b) => a[0] - b[0]).map(([, text]) => text).join(" · ") }));
}

function rowRegion(sheets: readonly RegionSheet[], id: string): { sheet: RegionSheet; row: number } | null {
  for (const sheet of sheets) {
    const prefix = `${sheet.id}:row:`;
    if (id.startsWith(prefix)) {
      const row = Number(id.slice(prefix.length)) - 1;
      if (Number.isInteger(row) && row >= 0) return { sheet, row };
    }
    for (const [row, identity] of Object.entries(sheet.rowIdentities ?? {}))
      if (identity === id && Number.isInteger(Number(row))) return { sheet, row: Number(row) };
  }
  return null;
}

function sheetNamed(sheets: readonly RegionSheet[], name: string | undefined) {
  if (!name) return undefined;
  const folded = foldText(name);
  return sheets.find((sheet) => sheet.id === name || foldText(sheet.name) === folded);
}

/**
 * Where a region lands in a workbook, or null when it names nothing there
 * (another workbook's sheet, a hidden sheet, a deleted row).
 */
export function sheetLandingFor(sheets: readonly RegionSheet[], activeSheetId: string, region: WorkRegion): SheetLanding | null {
  const texts = regionTexts(region);
  const byId = sheets.find((candidate) => candidate.id === region.id);
  const byRow = byId ? null : rowRegion(sheets, region.id);
  // The label's range first; an id is read as a range only when it names no sheet or row ("s2" is a sheet, not cell S2).
  const parsed = [region.label, byId || byRow ? undefined : region.id]
    .map(cellRangeIn)
    .find((range): range is CellRangeLocator => Boolean(range));
  const sheet =
    byId ??
    byRow?.sheet ??
    texts.map((text) => sheetNamed(sheets, text)).find(Boolean) ??
    (parsed?.sheet ? sheetNamed(sheets, parsed.sheet) : parsed ? sheets.find((candidate) => candidate.id === activeSheetId) : undefined);
  if (!sheet || sheet.hidden) return null;
  const range =
    parsed && (!parsed.sheet || sheetNamed(sheets, parsed.sheet) === sheet)
      ? { start: parsed.start, end: parsed.end }
      : byRow
        ? { start: { row: byRow.row, column: 0 }, end: { row: byRow.row, column: 0 } }
        : { start: { row: 0, column: 0 }, end: { row: 0, column: 0 } };
  if (range.end.row > range.start.row && region.excerpt) {
    const row = bestByExcerpt(rowTexts(sheet, range.start.row, range.end.row), (entry) => entry.text, region.excerpt)?.row;
    if (row !== undefined) return { sheetId: sheet.id, range: { start: { row, column: range.start.column }, end: { row, column: range.end.column } } };
  }
  return { sheetId: sheet.id, range };
}
