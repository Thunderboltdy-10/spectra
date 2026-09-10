import { describe, expect, it } from "vitest";
import { patchSheetCellRecord } from "../sheets/cell-overlay";
import { normalizeSheetsContent } from "../sheets/model";
import { sheetsContentEqual } from "../sheets/semantic-equality";

function workbook(overrides: Record<string, unknown> = {}) {
  return normalizeSheetsContent({
    workbook: { calculationMode: "automatic", locale: "en-US" },
    activeSheetId: "sheet-1",
    sheets: [
      {
        id: "sheet-1",
        name: "Sheet1",
        cells: {
          A1: { value: 1 },
          B1: { formula: "=A1+1", value: 2 },
          C1: { value: 45300, format: { numberFormat: "date" } },
        },
        tables: [],
        charts: [],
        rowCount: 100,
        columnCount: 12,
        frozenRows: 1,
        hiddenRows: [3],
        mergedRanges: ["D1:E1"],
        ...overrides,
      },
    ],
  });
}

describe("Sheets semantic equality", () => {
  it("keeps the chart save/reopen/title/no-op/remove sequence semantic", () => {
    const chart = {
      id: "chart-1",
      type: "column" as const,
      sourceRange: "A1:B2",
      title: "Revenue",
      position: { x: 0, y: 0, width: 400, height: 240 },
    };
    const saved = workbook({ charts: [chart] });
    const reopened = normalizeSheetsContent(JSON.parse(JSON.stringify(saved)));
    expect(sheetsContentEqual(saved, reopened)).toBe(true);
    const renamed = normalizeSheetsContent({
      ...reopened,
      sheets: [
        { ...reopened.sheets[0]!, charts: [{ ...chart, title: "Costs" }] },
      ],
    });
    expect(sheetsContentEqual(reopened, renamed)).toBe(false);
    const sameTitle = normalizeSheetsContent(JSON.parse(JSON.stringify(renamed)));
    expect(sheetsContentEqual(renamed, sameTitle)).toBe(true);
    const removed = normalizeSheetsContent({
      ...sameTitle,
      sheets: [{ ...sameTitle.sheets[0]!, charts: [] }],
    });
    expect(sheetsContentEqual(sameTitle, removed)).toBe(false);
  });

  it("covers non-cell state even when the cell map is shared", () => {
    const source = workbook();
    const sheet = source.sheets[0]!;
    expect(
      sheetsContentEqual(source, {
        ...source,
        sheets: [
          {
            ...sheet,
            charts: [
              {
                id: "chart-1",
                type: "column",
                sourceRange: "A1:B2",
                title: "Revenue",
                position: { x: 0, y: 0, width: 400, height: 240 },
              },
            ],
          },
        ],
      }),
    ).toBe(false);
    expect(
      sheetsContentEqual(source, {
        ...source,
        workbook: { ...source.workbook, namedRanges: { Input: "Sheet1!A1" } },
      }),
    ).toBe(false);
  });

  it("uses cell overlays for an edit without scanning or sorting the base map", () => {
    const source = workbook();
    const sheet = source.sheets[0]!;
    const edited = {
      ...source,
      sheets: [
        {
          ...sheet,
          cells: patchSheetCellRecord(sheet.cells, { A1: { value: 11 } }),
        },
      ],
    };
    expect(sheetsContentEqual(source, edited)).toBe(false);
    expect(
      sheetsContentEqual(source, {
        ...edited,
        sheets: [
          {
            ...edited.sheets[0]!,
            cells: patchSheetCellRecord(sheet.cells, { A1: { value: 1 } }),
          },
        ],
      }),
    ).toBe(true);
  });

  it("does not treat equivalent replacement objects as a write", () => {
    const source = workbook();
    const replacement = normalizeSheetsContent(JSON.parse(JSON.stringify(source)));
    expect(sheetsContentEqual(source, replacement)).toBe(true);
    expect(
      sheetsContentEqual(source, {
        ...replacement,
        sheets: [
          {
            ...replacement.sheets[0]!,
            cells: {
              ...replacement.sheets[0]!.cells,
              B1: { formula: "=A1+1", value: 2, cachedValueStale: true },
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it("keeps dense comparison bounded to one changed overlay address", () => {
    const cells = Object.fromEntries(
      Array.from({ length: 20_000 }, (_, index) => [
        `A${index + 1}`,
        { value: index },
      ]),
    );
    const source = normalizeSheetsContent({
      workbook: { calculationMode: "automatic", locale: "en-US" },
      activeSheetId: "sheet-1",
      sheets: [{ ...workbook().sheets[0], cells }],
    });
    const changed = {
      ...source,
      sheets: [
        {
          ...source.sheets[0]!,
          cells: patchSheetCellRecord(source.sheets[0]!.cells, {
            A1: { value: 99 },
          }),
        },
      ],
    };
    const started = performance.now();
    expect(sheetsContentEqual(source, changed)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
