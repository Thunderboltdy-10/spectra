import { describe, expect, it } from "vitest";
import {
  SHEET_CELLS_CHUNK_SIZE,
  decodeSheetsContentFromStorage,
  encodeArtifactContentForStorage,
  encodeSheetCellsForStorage,
  sheetCellEntries,
} from "../../../../shared/sheet-cells";
import { normalizeSheetsContent } from "../sheets/model";

function largestObjectFieldCount(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value))
    return value.reduce(
      (largest, candidate) =>
        Math.max(largest, largestObjectFieldCount(candidate)),
      0,
    );
  const fields = Object.values(value as Record<string, unknown>);
  return fields.reduce<number>(
    (largest, candidate) =>
      Math.max(largest, largestObjectFieldCount(candidate)),
    fields.length,
  );
}

describe("bounded sheet-cell storage", () => {
  it("chunks address maps without dropping order or values", () => {
    const cells = Object.fromEntries(
      Array.from({ length: 1_322 }, (_, index) => [
        `A${index + 1}`,
        { value: index + 1 },
      ]),
    );
    const encoded = encodeSheetCellsForStorage(cells);

    expect(encoded.chunks).toHaveLength(6);
    expect(
      encoded.chunks.every((chunk) => chunk.length <= SHEET_CELLS_CHUNK_SIZE),
    ).toBe(true);
    expect(sheetCellEntries(encoded)).toEqual(Object.entries(cells));
  });

  it("keeps every object below Convex's field ceiling and decodes canonically", () => {
    const canonical = {
      workbook: { calculationMode: "automatic", locale: "en-US" },
      sheets: [
        {
          id: "sheet-1",
          name: "Data",
          cells: Object.fromEntries(
            Array.from({ length: 1_322 }, (_, index) => [
              `B${index + 1}`,
              { value: index + 1 },
            ]),
          ),
          tables: [],
          charts: [],
        },
      ],
      activeSheetId: "sheet-1",
    };
    const stored = encodeArtifactContentForStorage("sheets", canonical);
    const normalized = normalizeSheetsContent(stored);

    expect(largestObjectFieldCount(stored)).toBeLessThanOrEqual(
      SHEET_CELLS_CHUNK_SIZE,
    );
    expect(Object.keys(normalized.sheets[0]!.cells)).toHaveLength(1_322);
    expect(normalized.sheets[0]!.cells.B1322?.value).toBe(1_322);
  });

  it("is idempotent across an already bounded store", () => {
    const encoded = encodeSheetCellsForStorage({ A1: { value: "one" } });
    expect(encodeSheetCellsForStorage(encoded)).toEqual(encoded);
  });

  it("decodes cells without supplying unrelated sheet defaults", () => {
    const decoded = decodeSheetsContentFromStorage({
      sheets: [
        {
          id: "sheet-1",
          cells: encodeSheetCellsForStorage({ A1: { value: "one" } }),
        },
      ],
    }) as { sheets: Array<Record<string, unknown>> };

    expect(decoded.sheets[0]).toEqual({
      id: "sheet-1",
      cells: { A1: { value: "one" } },
    });
    expect(decoded.sheets[0]).not.toHaveProperty("frozenRows");
    expect(decoded.sheets[0]).not.toHaveProperty("frozenColumns");
  });
});
