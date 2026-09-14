import { describe, expect, it } from "vitest";
import {
  CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES,
  convexSafeOfficeActivationContent,
} from "../lenses/office-content";
import { humanizePublicFailure } from "../bridge/humanize";

describe("Office activation Convex budget", () => {
  it("keeps a 200k-scale sheet activation document under the Convex cap while preserving sheet identity", () => {
    const cells = Object.fromEntries(
      Array.from({ length: 8_000 }, (_, index) => [
        `A${index + 1}`,
        { value: `density-${index}-${"n".repeat(80)}` },
      ]),
    );
    const content = {
      workbook: {
        calculationMode: "automatic" as const,
        locale: "en-US",
        namedRanges: { Title: "Density!A1" },
        calculationVersion: 1,
      },
      sheets: [
        {
          id: "xlsx:sheet:1",
          name: "Density",
          cells,
          tables: [],
          charts: [],
          mergedRanges: ["A1:B1"],
          frozenRows: 1,
          frozenColumns: 0,
        },
      ],
      activeSheetId: "xlsx:sheet:1",
      nativeBinding: {
        version: 1 as const,
        format: "xlsx" as const,
        profile: "strict-native" as const,
        macroEnabled: false,
        semanticDigest: "a".repeat(64),
        recognizedFormulaFunctions: [],
      },
    };

    const raw = JSON.stringify(content).length;
    expect(raw).toBeGreaterThan(CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES);

    const stored = convexSafeOfficeActivationContent("sheets", content);
    const storedText = JSON.stringify(stored);
    expect(storedText.length).toBeLessThanOrEqual(
      CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES,
    );
    expect(storedText).toContain("Density");
    expect(storedText).toContain("xlsx:sheet:1");
    // Budgeted head must stay nonempty (Empty sheet / hollow import guard).
    expect(storedText).toContain("density-0");
    // Must still drop the oversized tail so the hot row fits Convex.
    expect(storedText).not.toContain("density-7999");
  });


  it("keeps a nonempty head when activation content is already chunk-encoded", async () => {
    const { encodeArtifactContentForStorage, decodeSheetsContentFromStorage } =
      await import("../../../../shared/sheet-cells");
    const cells = Object.fromEntries(
      Array.from({ length: 12_000 }, (_, index) => [
        `A${index + 1}`,
        { value: `row-${index}-${"x".repeat(100)}` },
      ]),
    );
    const content = {
      workbook: {
        calculationMode: "automatic" as const,
        locale: "en-US",
        namedRanges: {},
        calculationVersion: 1,
      },
      sheets: [
        {
          id: "xlsx:sheet:1",
          name: "Density",
          cells,
          tables: [],
          charts: [],
          mergedRanges: [],
        },
      ],
      activeSheetId: "xlsx:sheet:1",
    };
    const encoded = encodeArtifactContentForStorage("sheets", content);
    expect(JSON.stringify(encoded)).toContain("spectra-sheet-cells-v1");
    expect(JSON.stringify(encoded).length).toBeGreaterThan(
      CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES,
    );
    // Pass already-encoded content the way a Convex reload would.
    const stored = convexSafeOfficeActivationContent("sheets", encoded);
    const storedText = JSON.stringify(stored);
    expect(storedText.length).toBeLessThanOrEqual(
      CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES,
    );
    const decoded = decodeSheetsContentFromStorage(stored) as {
      sheets: Array<{ cells: Record<string, { value?: string }> }>;
    };
    expect(decoded.sheets[0]?.cells.A1?.value).toContain("row-0");
  });

  it("does not show Convex body-limit JSON to a person", () => {
    const leaked = `{"code": "BadJsonBody", "message": "Failed to buffer the request body: length limit exceeded"}`;
    expect(humanizePublicFailure(leaked, "Excel")).toContain("too large");
    expect(humanizePublicFailure(leaked)).not.toMatch(/BadJsonBody|length limit/i);
  });

  it("truncates a fidelity map that would overflow a Convex mutation", async () => {
    const { convexSafeFidelityMap } = await import("../lenses/office-content");
    const huge = Array.from({ length: 20_000 }, (_, index) => ({
      scope: `cell-${index}`,
      level: "adapted",
      message: "n".repeat(20),
    }));
    const stored = convexSafeFidelityMap(huge);
    expect(JSON.stringify(stored).length).toBeLessThan(500);
    expect(stored).toMatchObject({ truncated: true });
  });
});

describe("Library office import activation path", () => {
  it("uses convexSafeOfficeActivationContent instead of full xlsxArtifactContent in the import route", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("src/app/api/spectra/imports/office/route.ts", "utf8");
    expect(route).toContain("convexSafeOfficeActivationContent");
    expect(route).toContain("IMPORT_SNAPSHOT_TOO_LARGE");
    expect(route).toContain("durableFailed");
    // Full cell maps must not be returned to the browser on Library import.
    expect(route).toContain('convexSafeOfficeActivationContent(');
    expect(route).toContain('xlsxArtifactContent(opened.projection)');
    expect(route.indexOf('convexSafeOfficeActivationContent')).toBeLessThan(
      route.indexOf('xlsxArtifactContent(opened.projection)'),
    );
    // Must not assign raw full workbook content to the JSON body.
    expect(route).not.toMatch(/content:\s*xlsxArtifactContent\(/);
  });
});
