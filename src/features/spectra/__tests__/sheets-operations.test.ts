import { describe, expect, it } from "vitest";
import {
  applyBorderPreset,
  applyCachedStaleness,
  applyCellFormat,
  clearCells,
  compareScalars,
  duplicateRowIndices,
  fillRange,
  fillSeries,
  formulaLiteralizationAddresses,
  isFormulaLiteralization,
  isPreservedFormula,
  offsetCellToRow,
  offsetFormula,
  parseCellInput,
  pasteBlock,
  replaceInCells,
  sortRows,
  splitColumn,
  type ClipboardBlock,
} from "../sheets/operations";
import {
  formatCalculatedCell,
  formatWithCode,
  mutateWorkbookAxis,
  normalizeSheetsContent,
  parseRange,
  rangeAddresses,
  rangeArea,
  RangeTooLargeError,
  renameWorkbookSheet,
  sheetsCalculation,
  type SheetCell,
  type SheetsContent,
} from "../sheets/model";
import { dateToSerial } from "../sheets/excel-serial";
import { patchSheetCellRecord } from "../sheets/cell-overlay";
import { cachedFormulaCells, formulaCellTexts } from "../sheets/cached-formulas";

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

describe("formula literalization detection", () => {
  it("treats a value write onto a formula cell as literalization", () => {
    expect(
      isFormulaLiteralization(live("=ABS(C4-B4)", 1), { value: 999 }),
    ).toBe(true);
    expect(
      formulaLiteralizationAddresses(
        { D4: live("=ABS(C4-B4)", 1) },
        { D4: { value: 999 } },
      ),
    ).toEqual(["D4"]);
  });

  it("does not treat a formula rewrite or a format-only cell as literalization", () => {
    expect(
      isFormulaLiteralization(live("=ABS(C4-B4)", 1), { formula: "=ABS(C4-B4)*1" }),
    ).toBe(false);
    expect(
      formulaLiteralizationAddresses(
        { D4: live("=ABS(C4-B4)", 1) },
        { D4: live("=ABS(C4-B4)", 1) },
      ),
    ).toEqual([]);
  });
});

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
    const result = fillRange({ C2: live("=A2*B2", 6) }, range("C2:C4"), "down");
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
    const result = fillRange(
      { B3: { value: "stale" } },
      range("B2:B3"),
      "down",
    );
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
      {
        A1: { value: 1 },
        A2: { value: 2 },
        A3: cached("=SUBTOTAL(9,A1:A2)", 3),
      },
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
      { A5: cached('=INDIRECT("A1")', 5) },
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
    A3: live('=A1&" control"', 0),
    A4: cached('=TEXTBEFORE(A1," control")', 0),
  };

  it("replaces values and leaves quoted formula literals alone", () => {
    const result = replaceInCells(
      cells,
      ["A1", "A2", "A3"],
      "control",
      "trial",
    );
    expect(result.cells.A1?.value).toBe("trial group");
    expect(result.cells.A2?.value).toBe("trial");
    expect(result.cells.A3?.formula).toBe('=A1&" control"');
    expect(result.written).toBe(2);
  });

  it("still rewrites unquoted formula text", () => {
    const result = replaceInCells(
      { B1: live("=A1&control", 0) },
      ["B1"],
      "control",
      "trial",
    );
    expect(result.cells.B1?.formula).toBe("=A1&trial");
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
    const navy = "#123456";
    const result = applyBorderPreset(
      {},
      range("B2:B2"),
      "bottom",
      "dashed",
      navy,
    );
    expect(result.cells.B2?.format?.borders?.bottom).toEqual({
      style: "dashed",
      color: navy,
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

  it("normalizes a versioned bounded cell store beyond Convex's object-field limit", () => {
    const entries = Array.from(
      { length: 1_322 },
      (_, index) => [`A${index + 1}`, { value: index + 1 }] as const,
    );
    const workbook = normalizeSheetsContent({
      activeSheetId: "sheet-1",
      sheets: [
        {
          id: "sheet-1",
          name: "Bounded",
          cells: {
            encoding: "spectra-sheet-cells-v1",
            chunks: Array.from(
              { length: Math.ceil(entries.length / 256) },
              (_, index) => entries.slice(index * 256, (index + 1) * 256),
            ),
          },
        },
      ],
    });

    expect(Object.keys(workbook.sheets[0]!.cells)).toHaveLength(entries.length);
    expect(workbook.sheets[0]!.cells.A1?.value).toBe(1);
    expect(workbook.sheets[0]!.cells.A1322?.value).toBe(1_322);
  });

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

function sheetOf(
  cells: Record<string, SheetCell>,
  extras: Record<string, unknown> = {},
) {
  return normalizeSheetsContent({
    activeSheetId: "s1",
    sheets: [{ id: "s1", name: "Sheet1", cells, ...extras }],
  });
}

function evaluated(
  cells: Record<string, SheetCell>,
  address = "A1",
  extras: Record<string, unknown> = {},
) {
  return sheetsCalculation(sheetOf(cells, extras)).get(`s1:${address}`);
}

describe("sheets engine correctness", () => {
  it("uses Excel serials for DATE and arithmetic on dates", () => {
    const start = dateToSerial(new Date(Date.UTC(2024, 0, 1)));
    expect(evaluated({ A1: { formula: "=DATE(2024,1,1)" } })?.value).toBe(
      start,
    );
    expect(evaluated({ A1: { formula: "=DATE(2024,1,1)+1" } })?.value).toBe(
      start + 1,
    );
    expect(
      evaluated({ A1: { formula: "=DAYS(DATE(2024,1,2),DATE(2024,1,1))" } })
        ?.value,
    ).toBe(1);
    expect(
      evaluated({ A1: { formula: "=YEAR(DATE(2024,1,15))" } })?.value,
    ).toBe(2024);
    expect(
      formatCalculatedCell(
        { value: start, format: { numberFormat: "date" } },
        { value: start },
        "en-US",
      ),
    ).toMatch(/2024/);
  });

  it("treats ^ as left-associative, matching Excel", () => {
    expect(evaluated({ A1: { formula: "=2^3^2" } })?.value).toBe(64);
  });

  it("evaluates whole-column references", () => {
    expect(
      evaluated(
        {
          A1: { value: 2 },
          A2: { value: 3 },
          A5: { value: 4 },
          B1: { formula: "=SUM(A:A)" },
        },
        "B1",
      )?.value,
    ).toBe(9);
  });

  it("uses both row and column arguments for a two-dimensional INDEX", () => {
    expect(
      evaluated(
        {
          A1: { value: "a" },
          B1: { value: 10 },
          A2: { value: "b" },
          B2: { value: 20 },
          C1: { formula: "=INDEX(A1:B2,2,2)" },
        },
        "C1",
      )?.value,
    ).toBe(20);
  });

  it("honors exact and sorted approximate MATCH modes", () => {
    expect(
      evaluated(
        {
          A1: { value: 10 },
          A2: { value: 50 },
          A3: { value: 90 },
          B1: { formula: "=MATCH(55,A1:A3,1)" },
        },
        "B1",
      )?.value,
    ).toBe(2);
    expect(
      evaluated(
        {
          A1: { value: 90 },
          A2: { value: 50 },
          A3: { value: 10 },
          B1: { formula: "=MATCH(55,A1:A3,-1)" },
        },
        "B1",
      )?.value,
    ).toBe(1);
    expect(
      evaluated(
        {
          A1: { value: 10 },
          A2: { value: 90 },
          B1: { formula: "=MATCH(5,A1:A2,1)" },
        },
        "B1",
      )?.error,
    ).toBe("#N/A");
  });

  it("honors approximate VLOOKUP and HLOOKUP modes", () => {
    expect(
      evaluated(
        {
          A1: { value: 10 },
          B1: { value: 100 },
          A2: { value: 50 },
          B2: { value: 500 },
          A3: { value: 90 },
          B3: { value: 900 },
          D1: { formula: "=VLOOKUP(55,A1:B3,2,1)" },
        },
        "D1",
      )?.value,
    ).toBe(500);
    expect(
      evaluated(
        {
          A1: { value: 10 },
          B1: { value: 50 },
          C1: { value: 90 },
          A2: { value: 100 },
          B2: { value: 500 },
          C2: { value: 900 },
          D1: { formula: "=HLOOKUP(55,A1:C2,2,1)" },
        },
        "D1",
      )?.value,
    ).toBe(500);
    expect(
      evaluated(
        {
          A1: { value: 10 },
          B1: { value: 100 },
          A2: { value: 50 },
          B2: { value: 500 },
          D1: { formula: "=VLOOKUP(55,A1:B2,2,0)" },
        },
        "D1",
      )?.error,
    ).toBe("#N/A");
  });

  it("honors reverse XLOOKUP search and refuses unsupported modes", () => {
    expect(
      evaluated(
        {
          A1: { value: 1 },
          A2: { value: 1 },
          B1: { value: 10 },
          B2: { value: 20 },
          C1: { formula: '=XLOOKUP(1,A1:A2,B1:B2,"missing",0,-1)' },
        },
        "C1",
      )?.value,
    ).toBe(20);
    expect(
      evaluated(
        {
          A1: { value: 10 },
          A2: { value: 50 },
          A3: { value: 90 },
          B1: { value: 100 },
          B2: { value: 500 },
          B3: { value: 900 },
          C1: { formula: '=XLOOKUP(55,A1:A3,B1:B3,"missing",1,1)' },
        },
        "C1",
      )?.value,
    ).toBe(900);
    expect(
      evaluated(
        {
          A1: { value: 1 },
          B1: { value: 10 },
          C1: { formula: '=XLOOKUP(1,A1:A1,B1:B1,"missing",2,1)' },
        },
        "C1",
      )?.error,
    ).toBe("#N/A");
  });

  it("does not silently drop cells past 10,000 in a formula range", () => {
    const cells: Record<string, SheetCell> = {
      A1: { value: 10 },
      A10001: { value: 7 },
      B1: { formula: "=SUM(A1:A10002)" },
    };
    expect(evaluated(cells, "B1")?.value).toBe(17);
  });

  it("refuses to walk a huge range as a dense address list", () => {
    const parsed = parseRange("A:A");
    expect(parsed).not.toBeNull();
    expect(rangeArea(parsed!)).toBeGreaterThan(200_000);
    expect(() => rangeAddresses(parsed!)).toThrow(RangeTooLargeError);
  });

  it("shifts whole-column references with the one shifter", () => {
    expect(offsetFormula("=SUM(A:A)", 0, 1)).toBe("=SUM(B:B)");
    expect(offsetFormula('=SUM(A:A)&"B2"', 0, 1)).toBe('=SUM(B:B)&"B2"');
  });

  it("offsets a formula when a sort moves its row", () => {
    expect(offsetCellToRow(live("=A2*2", 4), 1, 4).formula).toBe("=A5*2");
  });

  it("parses locale decimals and does not strip grouping as a second decimal", () => {
    expect(parseCellInput("1,5", "de-DE").value).toBe(1.5);
    expect(parseCellInput("1.234,56", "de-DE").value).toBe(1234.56);
    expect(parseCellInput("1,234.56", "en-US").value).toBe(1234.56);
    expect(parseCellInput("12%", "en-US")).toEqual({
      value: 0.12,
      format: { numberFormat: "percent" },
    });
    const iso = parseCellInput("2024-01-15", "en-US");
    expect(iso.value).toBe(dateToSerial(new Date("2024-01-15")));
    expect(iso.format?.numberFormat).toBe("date");
  });

  it("applies percent as a format, not a rewrite of the number", () => {
    const result = applyCellFormat({ A1: { value: 50 } }, ["A1"], {
      numberFormat: "percent",
    });
    expect(result.cells.A1?.value).toBe(50);
    expect(result.cells.A1?.format?.numberFormat).toBe("percent");
  });

  it("refuses to destroy cached-only formula text on clear all and clear values", () => {
    const cells = { A1: cached("=XLOOKUP(1,A:A,B:B)", 1), B1: { value: 2 } };
    const all = clearCells(cells, ["A1", "B1"], "all");
    expect(all.blocked).toEqual(["A1"]);
    expect(all.cells.A1?.formula).toBe("=XLOOKUP(1,A:A,B:B)");
    expect(all.cells.B1).toBeUndefined();
    const values = clearCells(cells, ["A1"], "values");
    expect(values.blocked).toEqual(["A1"]);
    expect(values.cells.A1?.formula).toBe("=XLOOKUP(1,A:A,B:B)");
  });

  it("rewrites cross-sheet refs on insert and on rename", () => {
    const workbook = normalizeSheetsContent({
      activeSheetId: "s1",
      sheets: [
        { id: "s1", name: "Sheet1", cells: { A5: { value: 1 } } },
        {
          id: "s2",
          name: "Sheet2",
          cells: {
            B1: { formula: "=Sheet1!A5" },
            B2: { formula: "='Sheet1'!A1" },
          },
        },
      ],
      workbook: {
        namedRanges: { Source: "Sheet1!$A$5" },
      },
    });
    const inserted = mutateWorkbookAxis(workbook, "s1", "row", 0, 1);
    expect(inserted.sheets[1]!.cells.B1?.formula).toBe("='Sheet1'!A6");
    expect(inserted.workbook.namedRanges?.Source).toBe("'Sheet1'!$A$6");
    const renamed = renameWorkbookSheet(inserted, "s1", "Input");
    expect(renamed.sheets[1]!.cells.B1?.formula).toBe("=Input!A6");
    expect(renamed.sheets[0]!.name).toBe("Input");
    expect(renamed.workbook.namedRanges?.Source).toBe("Input!$A$6");
  });

  it("marks cached-only results stale when a precedent changes, without recalculating", () => {
    const previous = sheetOf({
      A1: { value: 1 },
      B1: cached("=A1*10", 10),
    });
    const next = sheetOf({
      A1: { value: 2 },
      B1: cached("=A1*10", 10),
    });
    const marked = applyCachedStaleness(previous, next);
    expect(marked.sheets[0]!.cells.B1?.value).toBe(10);
    expect(marked.sheets[0]!.cells.B1?.cachedValueStale).toBe(true);
    expect(sheetsCalculation(marked).get("s1:B1")?.value).toBe(10);
  });

  it("marks a cached native lookup stale after a small precedent overlay and preserves its cached value", () => {
    const previous = sheetOf({ A2: { value: 2 }, B2: { value: 3 }, C2: cached("=XLOOKUP(A2,A2:A2,B2:B2)", 3) });
    const original = previous.sheets[0]!;
    const next = { ...previous, sheets: [{ ...original, cells: patchSheetCellRecord(original.cells, { B2: { value: 9 } }) }] };
    expect(cachedFormulaCells(next.sheets[0]!.cells).size).toBe(1);
    const marked = applyCachedStaleness(previous, next);
    expect(marked.sheets[0]!.cells.C2).toMatchObject({ value: 3, cachedValueStale: true, formula: "=XLOOKUP(A2,A2:A2,B2:B2)" });
    expect(marked.sheets[0]!.cells.A2).toBe(original.cells.A2);
    expect([...cachedFormulaCells(marked.sheets[0]!.cells).values()]).toEqual([marked.sheets[0]!.cells.C2]);
    const removed = patchSheetCellRecord(marked.sheets[0]!.cells, { C2: undefined });
    expect(cachedFormulaCells(removed).size).toBe(0);
    expect(cachedFormulaCells(original.cells).size).toBe(1);
  });

  it("propagates cached invalidation through cached and recalculable links without rewriting numbers", () => {
    const previous = sheetOf({
      D1: cached("=XLOOKUP(C1,C1:C1,C1:C1)", 10),
      C1: live("=B1*10", 10),
      B1: cached("=XLOOKUP(A1,A1:A1,A1:A1)", 1),
      A1: { value: 1 }, E1: live("=A1+1", 2), F1: cached("=XLOOKUP(A9,A9:A9,A9:A9)", 9),
    });
    const sheet = previous.sheets[0]!;
    const next = { ...previous, sheets: [{ ...sheet, cells: patchSheetCellRecord(sheet.cells, { A1: { value: 2 } }) }] };
    const marked = applyCachedStaleness(previous, next);
    expect(marked.sheets[0]!.cells.B1).toMatchObject({ value: 1, cachedValueStale: true });
    expect(marked.sheets[0]!.cells.D1).toMatchObject({ value: 10, cachedValueStale: true });
    for (const address of ["C1", "E1", "F1"]) expect(marked.sheets[0]!.cells[address]).toBe(sheet.cells[address]);
    expect(sheetsCalculation(marked).get("s1:E1")?.value).toBe(3);
    expect(sheetsCalculation(marked).get("s1:D1")?.value).toBe(10);
  });

  it("terminates seeded dependency cycles and leaves disconnected cycles clean", () => {
    const previous = sheetOf({
      A1: { value: 1 }, B1: cached("=A1+C1", 2), C1: cached("=B1", 2),
      D1: cached("=E1", 3), E1: cached("=D1", 3), F1: cached("=F1", 4),
    });
    const sheet = previous.sheets[0]!;
    const marked = applyCachedStaleness(previous, { ...previous, sheets: [{ ...sheet, cells: patchSheetCellRecord(sheet.cells, { A1: { value: 9 } }) }] });
    expect(marked.sheets[0]!.cells.B1?.cachedValueStale).toBe(true);
    expect(marked.sheets[0]!.cells.C1?.cachedValueStale).toBe(true);
    for (const address of ["D1", "E1", "F1"]) expect(marked.sheets[0]!.cells[address]).toBe(sheet.cells[address]);
  });

  it("follows range interiors across quoted worksheets without invalidating adjacent ranges", () => {
    const previous = normalizeSheetsContent({ activeSheetId: "input", sheets: [
      { id: "input", name: "Input's data", cells: { B3: { value: 1 } } },
      { id: "output", name: "Output", cells: {
        A1: live("=SUM('Input''s data'!a1:c5)", 1),
        B1: cached("=XLOOKUP(A1,A1:A1,A1:A1)", 1),
        C1: cached("=SUM('Input''s data'!D1:F5)", 5),
      } },
    ] });
    const [input, output] = previous.sheets;
    const marked = applyCachedStaleness(previous, { ...previous, sheets: [{ ...input!, cells: patchSheetCellRecord(input!.cells, { B3: { value: 9 } }) }, output!] });
    expect(marked.sheets[1]!.cells.B1).toMatchObject({ value: 1, cachedValueStale: true });
    expect(marked.sheets[1]!.cells.A1).toBe(output!.cells.A1);
    expect(marked.sheets[1]!.cells.C1).toBe(output!.cells.C1);
    expect(sheetsCalculation(marked).get("output:A1")?.value).toBe(9);
  });

  it("resolves supported named ranges while ignoring quoted names and function names", () => {
    const previous = normalizeSheetsContent({ workbook: { namedRanges: { Source: "Sheet1!$A$1:$A$5", AbsoluteSource: "Sheet1!$A$1:$A$5", SUM: "Sheet1!A1" } }, sheets: [
      { id: "s1", name: "Sheet1", cells: {
        A3: { value: 1 }, B1: live("=SUM(source)", 1), C1: cached("=B1*10", 10),
        D1: cached('=IF(A9="Source",1,0)', 0), E1: cached("=SUM(F1:F2)", 0), G1: cached("=SUM(AbsoluteSource)", 1),
      } },
    ] });
    const sheet = previous.sheets[0]!;
    const marked = applyCachedStaleness(previous, { ...previous, sheets: [{ ...sheet, cells: patchSheetCellRecord(sheet.cells, { A3: { value: 2 }, A1: { value: 3 } }) }] });
    expect(marked.sheets[0]!.cells.C1).toMatchObject({ value: 10, cachedValueStale: true });
    expect(marked.sheets[0]!.cells.G1).toMatchObject({ value: 1, cachedValueStale: true });
    expect(marked.sheets[0]!.cells.D1).toBe(sheet.cells.D1);
    expect(marked.sheets[0]!.cells.E1).toBe(sheet.cells.E1);
    expect(sheetsCalculation(marked).get("s1:B1")?.value).toBe(5);
  });

  it.each(["$A$1:$A$3", "$A1:A$3", "$A$3:$A$1", "$A:$A", "$1:$3", "$A$1"])("evaluates valid locked named range %s without recalculating cached formulas", (reference) => {
    const workbook = normalizeSheetsContent({ workbook: { namedRanges: { Source: `'Input''s data'!${reference}` } }, sheets: [
      { id: "input", name: "Input's data", cells: { A1: { value: 1 }, A2: { value: 2 }, A3: { value: 3 } } },
      { id: "output", name: "Output", cells: { A1: live("=SUM(Source)", 0), B1: cached("=SUM(Source)", 99) } },
    ] });
    const calculation = sheetsCalculation(workbook);
    expect(calculation.get("output:A1")).toEqual({ value: reference === "$A$1" ? 1 : 6 });
    expect(calculation.get("output:B1")).toEqual({ value: 99 });
  });

  it.each(["Sheet1!$A$$1:$A$3", "Sheet1!$$A$1", "Missing!$A$1:$A$3", "Sheet1!#REF!"])("keeps invalid named reference %s as an error", (reference) => {
    const workbook = normalizeSheetsContent({ workbook: { namedRanges: { Source: reference } }, sheets: [
      { id: "s1", name: "Sheet1", cells: { A1: { value: 1 }, B1: live("=SUM(Source)", 0) } },
    ] });
    expect(sheetsCalculation(workbook).get("s1:B1")).toEqual({ value: null, error: "#REF!" });
  });

  it("keeps whole-column and whole-row dependencies sparse and respects their boundaries", () => {
    const previous = sheetOf({
      B900000: { value: 1 }, D1: live("=SUM(B:B)", 1), E1: cached("=D1", 1),
      F1: cached("=SUM(900000:900000)", 1), G1: cached("=SUM(C:C)", 0), H1: cached("=SUM(899999:899999)", 0),
    });
    const sheet = previous.sheets[0]!;
    const marked = applyCachedStaleness(previous, { ...previous, sheets: [{ ...sheet, cells: patchSheetCellRecord(sheet.cells, { B900000: { value: 2 } }) }] });
    expect(marked.sheets[0]!.cells.E1?.cachedValueStale).toBe(true);
    expect(marked.sheets[0]!.cells.F1?.cachedValueStale).toBe(true);
    expect(marked.sheets[0]!.cells.G1).toBe(sheet.cells.G1);
    expect(marked.sheets[0]!.cells.H1).toBe(sheet.cells.H1);
  });

  it("reuses formula definitions through value and format overlays and updates them for formula changes", () => {
    const original = sheetOf({ A1: { value: 1 }, B1: live("=A1+1", 2), C1: cached("=B1", 2) }).sheets[0]!.cells;
    const formulas = formulaCellTexts(original);
    const valueEdit = patchSheetCellRecord(original, { A1: { value: 2 } });
    const formatEdit = patchSheetCellRecord(valueEdit, { B1: { ...original.B1!, format: { bold: true } } });
    expect(formulaCellTexts(valueEdit)).toBe(formulas);
    expect(formulaCellTexts(formatEdit)).toBe(formulas);
    const formulaEdit = patchSheetCellRecord(formatEdit, { B1: live("=D1+1", 2) });
    expect(formulaCellTexts(formulaEdit).get("B1")).toBe("=D1+1");
    const removed = patchSheetCellRecord(formulaEdit, { B1: undefined });
    expect(formulaCellTexts(removed).has("B1")).toBe(false);
    expect(formulaCellTexts(original).get("B1")).toBe("=A1+1");
  });

  it("finds the affected branch among many disjoint range dependencies", () => {
    const cells: Record<string, SheetCell> = { A33: { value: 1 }, C1: cached("=SUM(B1:B32)", 1) };
    for (let row = 1; row <= 32; row++) cells[`B${row}`] = cached(`=SUM(A${row * 2 - 1}:A${row * 2})`, row === 17 ? 1 : 0);
    const previous = sheetOf(cells);
    const sheet = previous.sheets[0]!;
    const marked = applyCachedStaleness(previous, { ...previous, sheets: [{ ...sheet, cells: patchSheetCellRecord(sheet.cells, { A33: { value: 2 } }) }] });
    const stale = [...cachedFormulaCells(marked.sheets[0]!.cells)].filter(([, cell]) => cell.cachedValueStale).map(([address]) => address).sort();
    expect(stale).toEqual(["B17", "C1"]);
    expect(marked.sheets[0]!.cells.B16).toBe(sheet.cells.B16);
    expect(marked.sheets[0]!.cells.B18).toBe(sheet.cells.B18);
  });

  it("walks a long reversed chain without recursion or repeated full-sheet scans", () => {
    const cells: Record<string, SheetCell> = {};
    for (let row = 5000; row > 1; row--) cells[`A${row}`] = row === 5000 ? cached(`=A${row - 1}`, 1) : live(`=A${row - 1}`, 1);
    cells.A1 = { value: 1 };
    const previous = sheetOf(cells);
    const sheet = previous.sheets[0]!;
    const started = performance.now();
    const marked = applyCachedStaleness(previous, { ...previous, sheets: [{ ...sheet, cells: patchSheetCellRecord(sheet.cells, { A1: { value: 2 } }) }] });
    expect(marked.sheets[0]!.cells.A5000).toMatchObject({ value: 1, cachedValueStale: true });
    expect(marked.sheets[0]!.cells.A4999).toBe(sheet.cells.A4999);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("refreshes cached dependencies when formula text changes and does not mark format-only edits", () => {
    const original = sheetOf({ A1: { value: 1 }, B1: live("=A1", 1), C1: cached("=B1", 1), D1: { value: 1 } });
    const sheet = original.sheets[0]!;
    const edit = (content: SheetsContent, patch: Record<string, SheetCell | undefined>) => ({ ...content, sheets: [{ ...content.sheets[0]!, cells: patchSheetCellRecord(content.sheets[0]!.cells, patch) }] });
    const formatted = edit(original, { A1: { ...sheet.cells.A1!, format: { bold: true } } });
    expect(applyCachedStaleness(original, formatted)).toBe(formatted);
    // Build the first dependency graph, then use a refreshed workbook with a different formula.
    expect(applyCachedStaleness(original, edit(original, { A1: { value: 2 } })).sheets[0]!.cells.C1?.cachedValueStale).toBe(true);
    const refreshed = edit(original, { B1: live("=D1", 1) });
    expect(applyCachedStaleness(refreshed, edit(refreshed, { A1: { value: 2 } })).sheets[0]!.cells.C1?.cachedValueStale).toBeUndefined();
    expect(applyCachedStaleness(refreshed, edit(refreshed, { D1: { value: 2 } })).sheets[0]!.cells.C1?.cachedValueStale).toBe(true);
    expect(applyCachedStaleness(refreshed, edit(refreshed, { B1: undefined })).sheets[0]!.cells.C1?.cachedValueStale).toBe(true);
  });

  it("patches one dense-sheet cell without cloning the workbook", () => {
    const rows = 4_000;
    const columns = 10;
    const cells = Object.fromEntries(
      Array.from({ length: rows * columns }, (_, index) => {
        const row = Math.floor(index / columns) + 1;
        const column = String.fromCharCode(65 + (index % columns));
        return [`${column}${row}`, { value: index + 1 }];
      }),
    );
    const previous = sheetOf(cells, { rowCount: rows, columnCount: columns });
    const started = performance.now();
    const nextCells = patchSheetCellRecord(previous.sheets[0]!.cells, {
      A1: { value: "P8V1-F2-A1" },
    });
    const next = {
      ...previous,
      sheets: [{ ...previous.sheets[0]!, cells: nextCells }],
    };
    const marked = applyCachedStaleness(previous, next);
    const elapsed = performance.now() - started;
    expect(marked.sheets[0]!.cells.A1?.value).toBe("P8V1-F2-A1");
    expect(marked.sheets[0]!.cells.J4000?.value).toBe(rows * columns);
    expect(elapsed).toBeLessThan(40);
  });

  it("migrates ISO date strings to serials on normalize", () => {
    const workbook = normalizeSheetsContent({
      activeSheetId: "s1",
      sheets: [
        {
          id: "s1",
          name: "Sheet1",
          cells: {
            A1: {
              value: "2024-01-15T00:00:00.000Z",
              format: { numberFormat: "date" },
            },
          },
        },
      ],
    });
    expect(workbook.sheets[0]!.cells.A1?.value).toBe(
      dateToSerial(new Date("2024-01-15T00:00:00.000Z")),
    );
  });
});
