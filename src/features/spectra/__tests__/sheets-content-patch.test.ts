import { describe, expect, it } from "vitest";
import { contentPatchChangeMatchesSaved } from "../ai/content-patch-verify";
import { applyResolvedContentPatch } from "../ai/document-content-patch";
import {
  canonicalizeSheetsPatchChange,
  canonicalizeSheetsPatchPath,
  coerceSheetCellPatchValue,
} from "../ai/sheets-content-patch";
import { normalizeArtifactContent } from "../ai/content-normalization";
import {
  assertCreateContentNotHollow,
  isHollowCreateContent,
} from "../operations/hollow-content";
import { isQuietRetryableApplyFailure } from "../operations/plan-diagnostics";

function enzymeKmSheet() {
  return normalizeArtifactContent("sheets", {
    workbook: { calculationMode: "automatic", locale: "en-US" },
    activeSheetId: "sheet-1",
    sheets: [
      {
        id: "sheet-1",
        name: "Km vs Vmax",
        rowCount: 12,
        columnCount: 6,
        cells: {
          A1: { value: "Enzyme" },
          B1: { value: "Km" },
          C1: { value: "Vmax" },
          A2: { value: "Control" },
          B2: { value: 1.2 },
          C2: { value: 100 },
          A3: { value: "Mutant" },
          B3: { value: 8.4 },
          C3: { value: 90 },
        },
      },
    ],
  });
}

describe("sheets contentPatch column append", () => {
  it("canonicalizes lowercase A1 cell paths and scalar/formula values", () => {
    expect(canonicalizeSheetsPatchPath("/sheets/0/cells/d1")).toBe(
      "/sheets/0/cells/D1",
    );
    expect(coerceSheetCellPatchValue("Km below 5?")).toEqual({
      value: "Km below 5?",
    });
    expect(coerceSheetCellPatchValue("=IF(B2<5,TRUE,FALSE)")).toEqual({
      formula: "=IF(B2<5,TRUE,FALSE)",
    });
    expect(
      canonicalizeSheetsPatchChange({
        path: "/sheets/0/cells/d2",
        value: "=B2<5",
      }),
    ).toEqual({
      path: "/sheets/0/cells/D2",
      value: { formula: "=B2<5" },
    });
  });

  it("applies per-cell validation column patches without wiping existing cells", () => {
    const next = normalizeArtifactContent(
      "sheets",
      applyResolvedContentPatch(enzymeKmSheet(), {
        changes: [
          { path: "/sheets/0/cells/d1", value: "Km below 5?" },
          {
            path: "/sheets/0/cells/D2",
            value: { formula: '=IF(B2<5,"Yes","No")' },
          },
          {
            path: "/sheets/0/cells/D3",
            value: { formula: '=IF(B3<5,"Yes","No")' },
          },
        ],
      }),
    ) as {
      sheets: Array<{
        cells: Record<string, { value?: unknown; formula?: string }>;
      }>;
    };

    const cells = next.sheets[0]!.cells;
    expect(cells.A1?.value).toBe("Enzyme");
    expect(cells.B2?.value).toBe(1.2);
    expect(cells.C3?.value).toBe(90);
    expect(cells.D1?.value).toBe("Km below 5?");
    expect(cells.D2?.formula).toBe('=IF(B2<5,"Yes","No")');
    expect(cells.D3?.formula).toBe('=IF(B3<5,"Yes","No")');
  });

  it("keeps nested cell-field writes scalar instead of nesting a cell object", () => {
    expect(
      canonicalizeSheetsPatchChange({
        path: "/sheets/0/cells/b2/value",
        value: "How tightly the enzyme binds its substrate",
      }),
    ).toEqual({
      path: "/sheets/0/cells/B2/value",
      value: "How tightly the enzyme binds its substrate",
    });

    const next = normalizeArtifactContent(
      "sheets",
      applyResolvedContentPatch(enzymeKmSheet(), {
        changes: [
          {
            path: "/sheets/0/cells/B2/value",
            value: "How tightly the enzyme binds its substrate",
          },
        ],
      }),
    ) as {
      sheets: Array<{ cells: Record<string, { value?: unknown }> }>;
    };
    expect(next.sheets[0]!.cells.B2?.value).toBe(
      "How tightly the enzyme binds its substrate",
    );
  });

  it("merges a partial /sheets/0/cells map so column appends are surgical", () => {
    const next = normalizeArtifactContent(
      "sheets",
      applyResolvedContentPatch(enzymeKmSheet(), {
        changes: [
          {
            path: "/sheets/0/cells",
            value: {
              d1: "Km below 5?",
              D2: { formula: "=IF(B2<5,TRUE,FALSE)" },
              D3: { formula: "=IF(B3<5,TRUE,FALSE)" },
            },
          },
        ],
      }),
    ) as {
      sheets: Array<{
        cells: Record<string, { value?: unknown; formula?: string }>;
      }>;
    };

    const cells = next.sheets[0]!.cells;
    expect(Object.keys(cells).sort()).toEqual(
      [
        "A1",
        "A2",
        "A3",
        "B1",
        "B2",
        "B3",
        "C1",
        "C2",
        "C3",
        "D1",
        "D2",
        "D3",
      ].sort(),
    );
    expect(cells.A1?.value).toBe("Enzyme");
    expect(cells.D1?.value).toBe("Km below 5?");
    expect(cells.D2?.formula).toBe("=IF(B2<5,TRUE,FALSE)");
  });

  it("verify accepts normalized cell and cells-map appends like deck /-", () => {
    const authoredHeader = canonicalizeSheetsPatchChange({
      path: "/sheets/0/cells/d1",
      value: "Km below 5?",
    });
    expect(
      contentPatchChangeMatchesSaved(
        authoredHeader.path,
        authoredHeader.value,
        { value: "Km below 5?" },
      ),
    ).toBe(true);

    const authoredFormula = canonicalizeSheetsPatchChange({
      path: "/sheets/0/cells/D2",
      value: '=IF(B2<5,"Yes","No")',
    });
    expect(
      contentPatchChangeMatchesSaved(
        authoredFormula.path,
        authoredFormula.value,
        { formula: '=IF(B2<5,"Yes","No")', value: null },
      ),
    ).toBe(true);

    expect(
      contentPatchChangeMatchesSaved(
        "/sheets/0/cells",
        {
          D1: { value: "Km below 5?" },
          D2: { formula: "=IF(B2<5,TRUE,FALSE)" },
        },
        {
          A1: { value: "Enzyme" },
          B1: { value: "Km" },
          D1: { value: "Km below 5?" },
          D2: { formula: "=IF(B2<5,TRUE,FALSE)" },
        },
      ),
    ).toBe(true);

    // No-op / wrong column must still fail verify.
    expect(
      contentPatchChangeMatchesSaved(
        "/sheets/0/cells/D1",
        { value: "Km below 5?" },
        { value: "Something else" },
      ),
    ).toBe(false);
    expect(
      contentPatchChangeMatchesSaved(
        "/sheets/0/cells",
        { D1: { value: "Km below 5?" } },
        { A1: { value: "Enzyme" } },
      ),
    ).toBe(false);

    // Deck-style append soft match still works.
    expect(
      contentPatchChangeMatchesSaved(
        "/cards/-",
        { front: "IC50 vs Ki?", back: "IC50 is assay-dependent." },
        {
          id: "card-12",
          front: "IC50 vs Ki?",
          back: "IC50 is assay-dependent.",
          hint: "",
        },
      ),
    ).toBe(true);
  });

  it("still rejects hollow empty workbooks on create", () => {
    expect(isHollowCreateContent("sheets", {}, "create")).toBe(true);
    expect(
      isHollowCreateContent(
        "sheets",
        {
          sheets: [{ id: "sheet-1", name: "Empty", cells: {} }],
        },
        "create",
      ),
    ).toBe(true);
    expect(isHollowCreateContent("sheets", enzymeKmSheet(), "create")).toBe(
      false,
    );
    expect(() =>
      assertCreateContentNotHollow(
        "sheets",
        { sheets: [{ cells: {} }] },
        "create",
      ),
    ).toThrow(/hollow\/incomplete/i);
    expect(
      isQuietRetryableApplyFailure(
        new Error(
          "The generated workbook is hollow/incomplete — sheets have no cell values.",
        ),
      ),
    ).toBe(true);
    expect(
      isQuietRetryableApplyFailure(
        new Error(
          "Invalid input at sheets.0.columnIdentities.0: Invalid input: expected string, received undefined",
        ),
      ),
    ).toBe(true);
  });
});
