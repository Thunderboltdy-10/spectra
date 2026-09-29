import { describe, expect, it } from "vitest";
import { applySheetsHistory } from "../components/sheets-studio";
import {
  mutateSheetAxis,
  normalizeSheetsContent,
  type SheetsContent,
} from "../sheets/model";

// Sheet undo replays one person's edit against the current workbook. Cells
// are matched by row and column identity, so undoing a row or column insert
// moves a collaborator's later edit back with its row, not to a stale address.

function workbook(cells: Record<string, string>): SheetsContent {
  return normalizeSheetsContent({
    workbook: { calculationMode: "automatic", locale: "en-US" },
    activeSheetId: "sheet-1",
    sheets: [
      {
        id: "sheet-1",
        name: "Sheet1",
        cells: Object.fromEntries(
          Object.entries(cells).map(([address, value]) => [address, { value }]),
        ),
        tables: [],
        rowCount: 20,
        columnCount: 10,
      },
    ],
  });
}

function withSheet(
  content: SheetsContent,
  change: (sheet: SheetsContent["sheets"][number]) => SheetsContent["sheets"][number],
) {
  return normalizeSheetsContent({ ...content, sheets: content.sheets.map(change) });
}

const values = (content: SheetsContent) =>
  Object.fromEntries(
    Object.entries(content.sheets[0]!.cells).map(([address, cell]) => [address, cell.value]),
  );

describe("sheet undo across row and column inserts", () => {
  it("undoes a row insert and keeps a peer's edit to a shifted row with its row", () => {
    const before = workbook({ A1: "top", A3: "x", A4: "y" });
    const after = withSheet(before, (sheet) => mutateSheetAxis(sheet, "row", 1, 1));
    expect(values(after)).toEqual({ A1: "top", A4: "x", A5: "y" });
    // A collaborator then edits the row that now sits at 5, and adds a cell.
    const current = withSheet(after, (sheet) => ({
      ...sheet,
      cells: { ...sheet.cells, A5: { value: "y, by a peer" }, B9: { value: "new" } },
    }));

    const undone = applySheetsHistory({ before, after }, "undo", current);
    expect(values(undone)).toEqual({ A1: "top", A3: "x", A4: "y, by a peer", B8: "new" });

    const redone = applySheetsHistory({ before, after }, "redo", undone);
    expect(values(redone)).toEqual({ A1: "top", A4: "x", A5: "y, by a peer", B9: "new" });
  });

  it("undoes a column insert and keeps a peer's edit with its column", () => {
    const before = workbook({ A1: "a", B1: "b", C1: "c" });
    const after = withSheet(before, (sheet) => mutateSheetAxis(sheet, "column", 1, 1));
    expect(values(after)).toEqual({ A1: "a", C1: "b", D1: "c" });
    const current = withSheet(after, (sheet) => ({
      ...sheet,
      cells: { ...sheet.cells, D1: { value: "c, by a peer" } },
    }));

    const undone = applySheetsHistory({ before, after }, "undo", current);
    expect(values(undone)).toEqual({ A1: "a", B1: "b", C1: "c, by a peer" });
  });

  it("still undoes a plain cell edit and keeps a peer's other cell", () => {
    const before = workbook({ A1: "one" });
    const after = workbook({ A1: "two" });
    const current = workbook({ A1: "two", B2: "peer" });
    expect(values(applySheetsHistory({ before, after }, "undo", current))).toEqual({
      A1: "one",
      B2: "peer",
    });
  });
});
