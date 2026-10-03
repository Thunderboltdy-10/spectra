import { describe, expect, it } from "vitest";
import { resolveArtifactWriteInput } from "../../../../operations/artifact-write-content";
import { applySheetsEdits, sheetRangeText, sheetsFromSpec, sheetsProblems, sheetsReadback } from "../sheets";
import { AuthoringError, sequentialIdFactory } from "../shared";

const budget = {
  sheets: [
    {
      name: "Budget",
      rows: [
        ["Item", "Cost", "Qty", "Total"],
        ["Pens", 1.5, 10, "=B2*C2"],
        ["Paper", 4, 3, "=B3*C3"],
        ["Total", null, null, "=SUM(D2:D3)"],
      ],
      format: [{ range: "A1:D1", bold: true }, { range: "B2:B3", numberFormat: "currency" as const, currency: "EUR" }],
      charts: [{ type: "column" as const, range: "A1:B3", title: "Cost per item" }],
      frozenRows: 1,
    },
  ],
};

describe("sheets authoring", () => {
  it("builds a workbook from rows with formulas, formats and a chart", () => {
    const { content } = sheetsFromSpec(budget, sequentialIdFactory());
    const sheet = content.sheets[0]!;
    expect(sheet.name).toBe("Budget");
    expect(sheet.cells.D4).toMatchObject({ formula: "=SUM(D2:D3)" });
    expect(sheet.cells.A1!.format).toMatchObject({ bold: true });
    expect(sheet.charts[0]).toMatchObject({ type: "column", sourceRange: "A1:B3" });
    expect(sheetsProblems(content)).toEqual([]);
    const text = sheetRangeText(content);
    expect(text).toMatch(/4 \| Total \|\s+\|\s+\| 27/);
    expect(text).toMatch(/Formulas: D2 =B2\*C2/);
    expect(() => resolveArtifactWriteInput("sheets", null, { content }, "")).not.toThrow();
  });

  it("edits ranges, shifts formulas on row insert, and reads back the touched area", () => {
    const { content } = sheetsFromSpec(budget, sequentialIdFactory());
    const { content: next, touched } = applySheetsEdits(content, [
      { op: "insert_rows", at: 3 },
      { op: "set_range", range: "A3", values: [["Rulers", 2, 5, "=B3*C3"]] },
    ]);
    expect(next.sheets[0]!.cells.D5).toMatchObject({ formula: "=SUM(D2:D4)" });
    const readback = sheetsReadback(next, touched);
    expect(readback).toMatch(/3 \| Rulers/);
    expect(content.sheets[0]!.cells.A3).toMatchObject({ value: "Paper" });
  });

  it("is atomic and names the failing operation and field", () => {
    const { content } = sheetsFromSpec(budget, sequentialIdFactory());
    const before = JSON.stringify(content);
    expect(() =>
      applySheetsEdits(content, [
        { op: "set_range", range: "A1", values: [["Changed"]] },
        { op: "format_range", range: "nope", bold: true },
      ]),
    ).toThrow(/Edit 2 \(format_range\): range "nope"/);
    expect(JSON.stringify(content)).toBe(before);
    expect(() => applySheetsEdits(content, [{ op: "set_range", sheet: "Missing", range: "A1", values: 1 }])).toThrow(
      AuthoringError,
    );
    expect(() => applySheetsEdits(content, [{ op: "set_range", range: "A1:B2", values: [[1, 2, 3]] }])).toThrow(
      /values are 1×3 but range is 2×2/,
    );
  });

  it("flags formula errors, formulas reading empty cells and missing headers", () => {
    const { content } = sheetsFromSpec(
      { sheets: [{ name: "Data", rows: [["Name", null], ["Ana", 3], ["=1/0", "=B9*2"]] }] },
      sequentialIdFactory(),
    );
    const problems = sheetsProblems(content).join(" | ");
    expect(problems).toMatch(/Data!A3 =1\/0 gives #DIV\/0!/);
    expect(problems).toMatch(/Data!B3 =B9\*2 reads empty B9/);
    expect(problems).toMatch(/Data!B1 is an empty header above data/);
  });

  it("adds, renames and deletes sheets and rewrites references", () => {
    const { content } = sheetsFromSpec(budget, sequentialIdFactory());
    const { content: next } = applySheetsEdits(
      content,
      [
        { op: "add_sheet", name: "Summary" },
        { op: "set_range", sheet: "Summary", range: "A1", values: [["=Budget!D4"]] },
        { op: "rename_sheet", sheet: "Budget", name: "Costs" },
      ],
      sequentialIdFactory(),
    );
    expect(next.sheets.map((sheet) => sheet.name)).toEqual(["Costs", "Summary"]);
    expect(next.sheets[1]!.cells.A1!.formula).toBe("=Costs!D4");
  });
});
