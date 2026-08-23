import { describe, expect, it } from "vitest";
import {
  applyBorderPreset,
  compareScalars,
  duplicateRowIndices,
  fillRange,
  fillSeries,
  isPreservedFormula,
  offsetFormula,
  pasteBlock,
  replaceInCells,
  sortRows,
  splitColumn,
  type ClipboardBlock,
} from "../sheets/operations";
import {
  formatWithCode,
  normalizeSheetsContent,
  parseRange,
  sheetsCalculation,
  type SheetCell,
  type SheetsContent,
} from "../sheets/model";

/**
 * The workbook's operations, tested without a grid.
 *
 * Two things are being proved here, and only one of them is arithmetic. The first
 * is that fill, paste, sort and replace behave the way a spreadsheet behaves. The
 * second matters more: a formula Spectra cannot evaluate is never quietly turned
 * into the number Excel last saved for it. That failure would look completely
 * correct on screen and would destroy the workbook the moment it went back to
 * Excel, so every operation that could commit it is asserted against here.
 */

/** A range from its A1 label, so the tests read the way a selection does. */
function range(label: string) {
  const parsed = parseRange(label);
  if (!parsed) throw new Error(`${label} is not a range`);
  return parsed;
}

/** A cell holding a formula Spectra recognizes and can recalculate. */
function live(formula: string, value: number): SheetCell {
  return { formula, value, nativeFormulaSupport: "recognized" };
}

/** A cell holding Excel's own formula, kept as text with its cached result. */
function cached(formula: string, value: number): SheetCell {
  return { formula, value, nativeFormulaSupport: "cached-only" };
}

describe("formula reference offsetting", () => {
  it("shifts relative references and pins locked ones", () => {
    expect(offsetFormula("=A1+B1", 1, 0)).toBe("=A2+B2");
    expect(offsetFormula("=$A1+B$1", 2, 1)).toBe("=$A3+C$1");
    expect(offsetFormula("=$A$1", 5, 5)).toBe("=$A$1");
  });

  it("leaves quoted text alone", () => {
    expect(offsetFormula('=IF(A1>0,"B2 is fine","B2 is not")', 1, 0)).toBe(
      '=IF(A2>0,"B2 is fine","B2 is not")',
    );
  });

  it("does not treat a function name as a reference", () => {
    expect(offsetFormula("=LOG10(A1)", 1, 0)).toBe("=LOG10(A2)");
    expect(offsetFormula("=SUM(A1:A3)", 1, 0)).toBe("=SUM(A2:A4)");
  });

  it("says #REF! rather than wrapping off the sheet", () => {
    expect(offsetFormula("=A1", -1, 0)).toBe("=#REF!");
    expect(offsetFormula("=A1", 0, -1)).toBe("=#REF!");
  });
});

describe("fill", () => {
  it("carries a formula down with shifted references", () => {
    const result = fillRange(
      { C2: live("=A2*B2", 6) },
      range("C2:C4"),
      "down",
    );
    expect(result.cells.C3?.formula).toBe("=A3*B3");
    expect(result.cells.C4?.formula).toBe("=A4*B4");
    expect(result.written).toBe(2);
  });

  it("refuses to overwrite a formula Spectra only preserves", () => {
    const result = fillRange(
      { C2: { value: 10 }, C3: cached("=XLOOKUP(A3,D:D,E:E)", 42) },
      range("C2:C3"),
      "down",
    );
    expect(result.blocked).toEqual(["C3"]);
    expect(result.cells.C3?.formula).toBe("=XLOOKUP(A3,D:D,E:E)");
    expect(result.cells.C3?.value).toBe(42);
  });

  it("clears cells under an empty seed instead of leaving stale values", () => {
    const result = fillRange({ B3: { value: "stale" } }, range("B2:B3"), "down");
    expect(result.cells.B3).toBeUndefined();
  });

  it("fills right from the first column", () => {
    const result = fillRange({ B2: { value: 7 } }, range("B2:D2"), "right");
    expect(result.cells.C2?.value).toBe(7);
    expect(result.cells.D2?.value).toBe(7);
  });
});

describe("fill series", () => {
  it("continues a linear series from the first two cells", () => {
    const result = fillSeries(
      { A1: { value: 5 }, A2: { value: 10 } },
      range("A1:A5"),
      "linear",
    );
    expect([
      result.cells.A3?.value,
      result.cells.A4?.value,
      result.cells.A5?.value,
    ]).toEqual([15, 20, 25]);
  });

  it("continues a growth series by ratio", () => {
    const result = fillSeries(
      { A1: { value: 2 }, A2: { value: 4 } },
      range("A1:A4"),
      "growth",
    );
    expect([result.cells.A3?.value, result.cells.A4?.value]).toEqual([8, 16]);
  });

  it("continues weekdays and months by name", () => {
    const weekdays = fillSeries(
      { A1: { value: "Thursday" } },
      range("A1:A3"),
      "weekday",
    );
    expect(weekdays.cells.A2?.value).toBe("Friday");
    const months = fillSeries(
      { B1: { value: "November" } },
      range("B1:B3"),
      "month",
    );
    expect([months.cells.B2?.value, months.cells.B3?.value]).toEqual([
      "December",
      "January",
    ]);
  });

  it("copies rather than inventing a sequence it cannot infer", () => {
    const result = fillSeries(
      { A1: { value: "Control" } },
      range("A1:A3"),
      "linear",
    );
    expect(result.cells.A2?.value).toBe("Control");
    expect(result.cells.A3?.value).toBe("Control");
  });

  it("never writes over a preserved formula", () => {
    const result = fillSeries(
      { A1: { value: 1 }, A2: { value: 2 }, A3: cached("=SUBTOTAL(9,A1:A2)", 3) },
      range("A1:A3"),
      "linear",
    );
    expect(result.blocked).toEqual(["A3"]);
    expect(result.cells.A3?.formula).toBe("=SUBTOTAL(9,A1:A2)");
  });
});

describe("paste", () => {
  const block: ClipboardBlock = {
    range: range("A1:B2"),
    cells: {
      A1: { value: 1, format: { bold: true } },
      B1: live("=A1*2", 2),
      A2: { value: 3 },
      B2: live("=A2*2", 6),
    },
  };

  it("shifts formulas on a plain paste", () => {
    const result = pasteBlock({}, block, { row: 4, column: 0 }, "all");
    expect(result.cells.B5?.formula).toBe("=A5*2");
    expect(result.cells.B6?.formula).toBe("=A6*2");
    expect(result.cells.A5?.format?.bold).toBe(true);
  });

  it("values-only drops the formula and takes the current result", () => {
    const result = pasteBlock(
      {},
      block,
      { row: 4, column: 0 },
      "values",
      (address) => (address === "B1" ? 99 : undefined),
    );
    expect(result.cells.B5?.formula).toBeUndefined();
    expect(result.cells.B5?.value).toBe(99);
    // Literalizing is only ever allowed because the person asked for exactly
    // this, by name, in a mode called "values only".
    expect(result.cells.B5?.nativeFormulaSupport).toBeUndefined();
  });

  it("formats-only leaves the value where it was", () => {
    const result = pasteBlock(
      { A5: { value: "keep me" } },
      block,
      { row: 4, column: 0 },
      "formats",
    );
    expect(result.cells.A5?.value).toBe("keep me");
    expect(result.cells.A5?.format?.bold).toBe(true);
  });

  it("transposes rows into columns", () => {
    const result = pasteBlock({}, block, { row: 4, column: 0 }, "transpose");
    expect(result.cells.A5?.value).toBe(1);
    expect(result.cells.B5?.value).toBe(3);
  });

  it("skips a target cell that holds a preserved formula", () => {
    const result = pasteBlock(
      { A5: cached("=INDIRECT(\"A1\")", 5) },
      block,
      { row: 4, column: 0 },
      "all",
    );
    expect(result.blocked).toEqual(["A5"]);
    expect(result.cells.A5?.formula).toBe('=INDIRECT("A1")');
  });
});

describe("sort, duplicates and split", () => {
  const rows = [
    { name: "Ada", team: "B" },
    { name: "Bo", team: "A" },
    { name: "Cy", team: "B" },
    { name: "Dee", team: "A" },
  ];
  const valueAt = (row: (typeof rows)[number], column: number) =>
    column === 0 ? row.team : row.name;

  it("keeps the second key intact under the first", () => {
    const sorted = sortRows(
      rows,
      [
        { column: 0, direction: "asc" },
        { column: 1, direction: "desc" },
      ],
      valueAt,
    );
    expect(sorted.map((row) => row.name)).toEqual(["Dee", "Bo", "Cy", "Ada"]);
  });

  it("is stable when every key ties", () => {
    const sorted = sortRows(rows, [{ column: 0, direction: "asc" }], valueAt);
    expect(sorted.map((row) => row.name)).toEqual(["Bo", "Dee", "Ada", "Cy"]);
  });

  it("compares numbers as numbers, not as text", () => {
    expect(compareScalars(9, 10)).toBeLessThan(0);
    expect(compareScalars("9", "10")).toBeGreaterThan(0);
  });

  it("finds repeat rows across the columns given", () => {
    const grid: Record<string, string> = {
      "0:0": "Ada",
      "0:1": "B",
      "1:0": "Bo",
      "1:1": "A",
      "2:0": "Ada",
      "2:1": "B",
      "3:0": "Ada",
      "3:1": "A",
    };
    const duplicates = duplicateRowIndices(
      [0, 1, 2, 3],
      [0, 1],
      (row, column) => grid[`${row}:${column}`],
    );
    expect(duplicates).toEqual([2]);
  });

  it("picks the delimiter the data actually uses", () => {
    const result = splitColumn(["Ada, Lovelace", "Bo, Peep"]);
    expect(result.delimiter).toBe(",");
    expect(result.rows[0]).toEqual(["Ada", "Lovelace"]);
  });
});

describe("find and replace", () => {
  const cells: Record<string, SheetCell> = {
    A1: { value: "Control group" },
    A2: { value: "control" },
    A3: live("=A1&\" control\"", 0),
    A4: cached("=TEXTBEFORE(A1,\" control\")", 0),
  };

  it("replaces values and evaluable formula text", () => {
    const result = replaceInCells(cells, ["A1", "A2", "A3"], "control", "trial");
    // Case-insensitive by default, the way every spreadsheet's replace works.
    expect(result.cells.A1?.value).toBe("trial group");
    expect(result.cells.A2?.value).toBe("trial");
    expect(result.cells.A3?.formula).toBe('=A1&" trial"');
  });

  it("matches case-insensitively without treating the query as a pattern", () => {
    const result = replaceInCells(
      { A1: { value: "rate (per s)" } },
      ["A1"],
      "(per s)",
      "[1/s]",
    );
    expect(result.cells.A1?.value).toBe("rate [1/s]");
  });

  it("keeps every character of a formula Spectra cannot evaluate", () => {
    const result = replaceInCells(cells, ["A4"], "control", "trial");
    expect(result.blocked).toEqual(["A4"]);
    expect(result.cells.A4?.formula).toBe('=TEXTBEFORE(A1," control")');
    expect(result.written).toBe(0);
  });

  it("whole-cell matching replaces only an exact cell", () => {
    const result = replaceInCells(cells, ["A1", "A2"], "control", "trial", {
      wholeCell: true,
    });
    // "Control group" is not the whole cell "control", so it stays as it is.
    expect(result.cells.A1?.value).toBe("Control group");
    expect(result.cells.A2?.value).toBe("trial");
  });
});

describe("borders", () => {
  it("puts an outline on the edges of the range and nowhere else", () => {
    const result = applyBorderPreset({}, range("B2:C3"), "outline");
    expect(result.cells.B2?.format?.borders?.top?.style).toBe("thin");
    expect(result.cells.B2?.format?.borders?.left?.style).toBe("thin");
    expect(result.cells.B2?.format?.borders?.right).toBeUndefined();
    expect(result.cells.C3?.format?.borders?.bottom?.style).toBe("thin");
  });

  it("gives every cell an edge for an all-borders preset", () => {
    const result = applyBorderPreset({}, range("B2:C3"), "all");
    for (const address of ["B2", "B3", "C2", "C3"]) {
      const borders = result.cells[address]?.format?.borders;
      expect(borders?.top?.style, address).toBeTruthy();
      expect(borders?.bottom?.style, address).toBeTruthy();
    }
  });

  it("clears borders without touching the rest of the format", () => {
    const seeded = applyBorderPreset(
      { B2: { value: 1, format: { bold: true } } },
      range("B2:B2"),
      "all",
    );
    const cleared = applyBorderPreset(seeded.cells, range("B2:B2"), "none");
    expect(cleared.cells.B2?.format?.borders).toBeUndefined();
    expect(cleared.cells.B2?.format?.bold).toBe(true);
    expect(cleared.cells.B2?.value).toBe(1);
  });

  it("carries the chosen line and colour onto the edge", () => {
    const result = applyBorderPreset(
      {},
      range("B2:B2"),
      "bottom",
      "dashed",
      "#123456",
    );
    expect(result.cells.B2?.format?.borders?.bottom).toEqual({
      style: "dashed",
      color: "#123456",
    });
  });
});

describe("preserved formula detection", () => {
  it("separates Excel's formulas from Spectra's own", () => {
    expect(isPreservedFormula(cached("=SUBTOTAL(9,A1:A2)", 1))).toBe(true);
    expect(isPreservedFormula(live("=SUM(A1:A2)", 1))).toBe(false);
    expect(isPreservedFormula({ value: 1 })).toBe(false);
    expect(isPreservedFormula(undefined)).toBe(false);
  });
});

describe("format codes", () => {
  it("reads a code the same way for TEXT and the custom number format", () => {
    expect(formatWithCode(1234.5, "#,##0.00", "en-US")).toBe("1,234.50");
    expect(formatWithCode(0.257, "0.0%", "en-US")).toBe("25.7%");
    const workbook = normalizeSheetsContent({
      activeSheetId: "sheet-1",
      sheets: [
        {
          id: "sheet-1",
          name: "Sheet 1",
          cells: {
            A1: { value: 1234.5 },
            A2: { formula: '=TEXT(A1,"#,##0.00")' },
          },
        },
      ],
    });
    const calculation = sheetsCalculation(workbook);
    expect(calculation.get(`${workbook.sheets[0]!.id}:A2`)?.value).toBe(
      "1,234.50",
    );
  });
});

describe("calculation at workbook scale", () => {
  /** A sheet of `columns * rows` cells, every other column a formula. */
  function bigWorkbook(rows: number, columns: number): SheetsContent {
    const cells: Record<string, SheetCell> = {};
    for (let row = 1; row <= rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const letter = String.fromCharCode(65 + column);
        cells[`${letter}${row}`] =
          column % 2 === 0
            ? { value: row + column }
            : { formula: `=${String.fromCharCode(64 + column)}${row}*2` };
      }
    }
    return normalizeSheetsContent({
      activeSheetId: "sheet-1",
      sheets: [
        {
          id: "sheet-1",
          name: "Load",
          rowCount: rows,
          columnCount: columns,
          cells,
        },
      ],
    });
  }

  it("costs a viewport, not a workbook, to read cells from a 200k-cell sheet", () => {
    const rows = 10_000;
    const columns = 20;
    const workbook = bigWorkbook(rows, columns);
    expect(Object.keys(workbook.sheets[0]!.cells).length).toBe(rows * columns);

    // Building the calculation must not evaluate anything: this is the object a
    // keystroke rebuilds, so it has to be cheap no matter how large the sheet is.
    const builtAt = performance.now();
    const calculation = sheetsCalculation(workbook);
    const buildMs = performance.now() - builtAt;
    expect(buildMs).toBeLessThan(250);
    // Nothing has been evaluated yet, which is the whole claim: the lazy
    // calculation is a plan, and an eager one would have run 100k formulas here.
    expect(calculation.size).toBe(0);
    const sheetId = workbook.sheets[0]!.id;

    // Painting a screenful is the only work a render should do. Forty rows by
    // twenty columns is a generous viewport.
    const paintedAt = performance.now();
    for (let row = 1; row <= 40; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        calculation.get(`${sheetId}:${String.fromCharCode(65 + column)}${row}`);
      }
    }
    const paintMs = performance.now() - paintedAt;
    expect(paintMs).toBeLessThan(250);

    // Only the viewport was evaluated. A full pass would be 200k entries.
    expect(calculation.size).toBeLessThan(2_000);
    expect(calculation.get(`${sheetId}:B1`)?.value).toBe(2);
    expect(calculation.get(`${sheetId}:B40`)?.value).toBe(80);
  });

  it("keeps repeat reads of the same cell free", () => {
    const workbook = bigWorkbook(2_000, 10);
    const calculation = sheetsCalculation(workbook);
    const sheetId = workbook.sheets[0]!.id;
    const first = performance.now();
    calculation.get(`${sheetId}:J1500`);
    const firstMs = performance.now() - first;
    const again = performance.now();
    for (let pass = 0; pass < 500; pass += 1)
      calculation.get(`${sheetId}:J1500`);
    const cachedMs = performance.now() - again;
    expect(cachedMs).toBeLessThan(Math.max(50, firstMs * 50));
  });
});
