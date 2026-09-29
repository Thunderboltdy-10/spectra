import { describe, expect, it, vi } from "vitest";

vi.mock("../sheets/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sheets/model")>();
  return {
    ...actual,
    normalizeSheetsContent: vi.fn(actual.normalizeSheetsContent),
  };
});

import { normalizeSheetsContent, type SheetsContent } from "../sheets/model";
import { patchSheetCellRecord } from "../sheets/cell-overlay";
import { changedArtifactRegionIds } from "../collaboration/artifact-yjs-model";
import {
  planSheetsCellProjection,
  sheetsYjsAdapter,
} from "../work/models/yjs/structured-adapters";

/**
 * A cell commit in a dense workbook runs the studio's region lookup and then
 * the live write's cell plan. Both used to normalize every cell of both sides
 * and compare every cell pair, so a 25,000-cell sheet paid ~110 ms at commit
 * and ~90 ms again at save for a one-cell change.
 */
function gradebook(rows: number) {
  const cells: Record<string, unknown> = {};
  for (let row = 1; row <= rows; row += 1) {
    cells[`A${row}`] = { value: `Student ${row}` };
    cells[`B${row}`] = { value: row % 100 };
    cells[`C${row}`] = { formula: `=B${row}*2`, value: (row % 100) * 2 };
  }
  const adapter = sheetsYjsAdapter;
  const doc = adapter.createDocument(
    normalizeSheetsContent({
      activeSheetId: "s1",
      sheets: [{ id: "s1", name: "Grades", cells }],
    }),
  );
  return adapter.project(doc) as SheetsContent;
}

function commit(
  content: SheetsContent,
  changes: Record<string, unknown>,
): SheetsContent {
  const sheet = content.sheets[0]!;
  return {
    ...content,
    sheets: [
      {
        ...sheet,
        cells: patchSheetCellRecord(
          sheet.cells as Record<string, unknown>,
          changes,
        ) as SheetsContent["sheets"][number]["cells"],
      },
    ],
  };
}

describe("sheet cell plans on a dense workbook", () => {
  it("normalizes each artifact value once across the commit and save paths", () => {
    const snapshot = gradebook(200);
    const normalize = vi.mocked(normalizeSheetsContent);
    normalize.mockClear();

    const first = commit(snapshot, { B10: { value: 55 } });
    expect(changedArtifactRegionIds("sheets", snapshot, first)).toHaveLength(1);
    expect(planSheetsCellProjection(snapshot, first)?.changes).toHaveLength(1);
    const second = commit(first, { B11: { value: 56 } });
    expect(changedArtifactRegionIds("sheets", first, second)).toHaveLength(1);
    expect(planSheetsCellProjection(snapshot, second)?.changes).toHaveLength(2);

    // snapshot, first and second: once each (was 8 calls).
    expect(normalize).toHaveBeenCalledTimes(3);
  });

  it("reads the overlay hint through normalization and still normalizes the changed cells", () => {
    const snapshot = gradebook(50);
    const edited = commit(snapshot, {
      b7: { value: 70 },
      C8: undefined,
      A9: "Renamed",
      B10: { value: 10 },
    });
    const plan = planSheetsCellProjection(snapshot, edited);
    expect(plan).not.toBeNull();
    const byAddress = new Map(
      plan!.changes.map((change) => [change.address, change]),
    );
    // B10 already held 10; an overlay entry that normalizes to the same cell
    // is not a change.
    expect([...byAddress.keys()].sort()).toEqual(["A9", "B7", "C8"]);
    expect(byAddress.get("B7")?.cell).toEqual({ value: 70 });
    expect(byAddress.get("C8")?.cell).toBeUndefined();
    expect(byAddress.get("A9")?.cell).toEqual({ value: "Renamed" });
    expect(plan!.content.sheets[0]!.cells.B7).toEqual({ value: 70 });
    expect(plan!.content.sheets[0]!.cells.C8).toBeUndefined();
  });

  it("falls back to comparing every cell when the draft is not an overlay", () => {
    const snapshot = gradebook(20);
    const sheet = snapshot.sheets[0]!;
    const rewritten: SheetsContent = {
      ...snapshot,
      sheets: [{ ...sheet, cells: { ...sheet.cells, B3: { value: 99 } } }],
    };
    expect(
      planSheetsCellProjection(snapshot, rewritten)?.changes.map(
        (change) => change.address,
      ),
    ).toEqual(["B3"]);
  });

  it("plans a one-cell save on a 15,000-cell sheet without rescanning it", () => {
    const snapshot = gradebook(5_000);
    let content = snapshot;
    let worst = 0;
    for (let index = 0; index < 5; index += 1) {
      const next = commit(content, { [`B${100 + index}`]: { value: 1_000 + index } });
      changedArtifactRegionIds("sheets", content, next);
      content = next;
      const start = performance.now();
      const plan = planSheetsCellProjection(snapshot, content);
      worst = Math.max(worst, performance.now() - start);
      expect(plan?.changes).toHaveLength(index + 1);
    }
    // Measured ~1 ms after, ~60 ms before; the bound only catches a return
    // to a full normalize-and-compare on every save.
    expect(worst).toBeLessThan(25);
  });
});
