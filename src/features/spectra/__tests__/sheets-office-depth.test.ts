/* eslint-disable spectra/no-raw-hex-in-styles -- Native workbook fixture colours, not UI styles. */
import { describe, expect, it } from "vitest";

import { chartPlotData } from "../sheets/chart-dataset";
import { blendColors, conditionalCellCss, conditionalFormatStyles, CONDITIONAL_FORMAT_CELL_LIMIT } from "../sheets/conditional-format";
import {
  convertSizes,
  excelWidthToPixels,
  pixelsToExcelWidth,
  pixelsToPoints,
  pointsToPixels,
  sizesToExcel,
} from "../sheets/excel-units";
import { calculateWorkbook, normalizeSheetsContent, type SheetConditionalFormat, type SheetScalar } from "../sheets/model";

const values = (cells: Record<string, SheetScalar>) => (address: string) => cells[address];

describe("Excel units", () => {
  it("converts widths and heights the way Excel rounds them", () => {
    expect(excelWidthToPixels(9.140625)).toBe(64);
    expect(excelWidthToPixels(21.140625)).toBe(148);
    expect(pixelsToExcelWidth(148)).toBe(21.140625);
    expect(excelWidthToPixels(pixelsToExcelWidth(200))).toBe(200);
    expect(pointsToPixels(15)).toBe(20);
    expect(pixelsToPoints(20)).toBe(15);
    expect(excelWidthToPixels(0)).toBe(0);
    expect(convertSizes({ "0": 21.140625, "1": 0 }, excelWidthToPixels)).toEqual({ "0": 148 });
  });

  it("keeps the file's own value while it draws the same pixels", () => {
    const base = { "0": 21.2, "1": 0, "2": 10 };
    expect(sizesToExcel({ "0": 148, "2": 100 }, base, excelWidthToPixels, pixelsToExcelWidth)).toEqual({
      "0": 21.2,
      "1": 0,
      "2": pixelsToExcelWidth(100),
    });
  });
});

describe("Conditional formats", () => {
  it("applies rules by priority, first property wins, and stops when asked", () => {
    const rules: SheetConditionalFormat[] = [
      { id: "late", range: "A1:A3", kind: "cell_is", operator: "greater_than", value: 0, fillColor: "#0000FF", priority: 3 },
      { id: "first", range: "A1:A3", kind: "cell_is", operator: "greater_equal", value: 2, fillColor: "#FF0000", textColor: "#FFFFFF", priority: 1, stopIfTrue: true },
      { id: "text", range: "B1", kind: "text_contains", text: "due", fillColor: "var(--warning)" },
    ];
    const styles = conditionalFormatStyles(rules, values({ A1: 1, A2: 2, A3: 3, B1: "Overdue" }));
    expect(styles.get("A1")).toEqual({ backgroundColor: "#0000FF" });
    expect(styles.get("A2")).toEqual({ backgroundColor: "#FF0000", color: "#FFFFFF" });
    expect(styles.get("B1")).toEqual({ backgroundColor: "var(--warning)" });
  });

  it("blends a three-colour scale through its midpoint", () => {
    const rule: SheetConditionalFormat = {
      id: "scale",
      range: "A1:A5",
      kind: "color_scale",
      minimumColor: "var(--danger)",
      midpointColor: "var(--warning)",
      maximumColor: "var(--success)",
    };
    const styles = conditionalFormatStyles([rule], values({ A1: 0, A2: 25, A3: 50, A4: 75, A5: 100 }));
    expect(styles.get("A1")!.backgroundColor).toBe("var(--danger)");
    expect(styles.get("A2")!.backgroundColor).toBe(blendColors("var(--danger)", "var(--warning)", 0.5));
    expect(styles.get("A3")!.backgroundColor).toBe("var(--warning)");
    expect(styles.get("A5")!.backgroundColor).toBe("var(--success)");
  });

  it("draws data bars from zero and clamps rules to the sheet in use", () => {
    const bar: SheetConditionalFormat = { id: "bar", range: "A1:A1048576", kind: "data_bar", color: "#638EC6" };
    expect(conditionalFormatStyles([bar], values({ A1: 5, A2: 10 })).size).toBe(0);
    const styles = conditionalFormatStyles([bar], values({ A1: 5, A2: 10 }), { rows: 100, columns: 10 });
    expect(styles.get("A1")!.bar).toEqual({ color: "#638EC6", ratio: 0.55 });
    expect(styles.get("A2")!.bar).toEqual({ color: "#638EC6", ratio: 1 });
    expect(conditionalCellCss(styles.get("A1"))).toMatchObject({ backgroundSize: "55% 72%", backgroundRepeat: "no-repeat" });
    expect(CONDITIONAL_FORMAT_CELL_LIMIT).toBe(20_000);
  });
});

describe("Chart plot data", () => {
  it("reads each series from the sheet it names", () => {
    const workbook = normalizeSheetsContent({
      activeSheetId: "chart",
      sheets: [
        { id: "chart", name: "Summary", cells: {} },
        {
          id: "data",
          name: "Sales 2024",
          cells: { A2: { value: "North" }, A3: { value: "South" }, B2: { value: 4 }, B3: { value: 6 }, C2: { value: 1 }, C3: { value: 2 } },
        },
      ],
    });
    const [owner] = workbook.sheets;
    const plot = chartPlotData(
      workbook.sheets,
      owner!,
      {
        id: "chart-1",
        title: "Sales",
        type: "column",
        sourceRange: "'Sales 2024'!A1:C3",
        position: { x: 0, y: 0, width: 400, height: 300 },
        series: [
          { name: "Units", categories: "'Sales 2024'!$A$2:$A$3", values: "'Sales 2024'!$B$2:$B$3" },
          { name: "Units", values: "'Sales 2024'!$C$2:$C$3" },
        ],
      },
      calculateWorkbook(workbook),
    );
    expect(plot).toEqual({
      category: "Category",
      keys: ["Units", "Units (2)"],
      data: [
        { Category: "North", Units: 4, "Units (2)": 1 },
        { Category: "South", Units: 6, "Units (2)": 2 },
      ],
    });
  });
});
