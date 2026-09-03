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
