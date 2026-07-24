import { describe, expect, it } from "vitest";

import { chartDataset } from "../components/sheets-studio";
import {
  calculateWorkbook,
  normalizeSheetsContent,
  type SheetChart,
} from "../sheets/model";

describe("Sheets chart datasets", () => {
  it("treats a single selected column as a chartable series", () => {
    const workbook = normalizeSheetsContent({
      activeSheetId: "sheet-1",
      sheets: [
        {
          id: "sheet-1",
          name: "Rates",
          cells: {
            D1: { value: "Rate" },
            D2: { value: 0.0018 },
            D3: { value: 0.0022 },
          },
        },
      ],
    });
    const sheet = workbook.sheets[0]!;
    const chart = {
      id: "chart-1",
      title: "Rate",
      type: "line",
      sourceRange: "D1:D3",
      position: { x: 0, y: 0, width: 640, height: 360 },
    } satisfies SheetChart;

    expect(chartDataset(sheet, chart, calculateWorkbook(workbook))).toEqual({
      category: "Category",
      keys: ["Rate"],
      data: [
        { Category: "1", Rate: 0.0018 },
        { Category: "2", Rate: 0.0022 },
      ],
    });
  });
});
