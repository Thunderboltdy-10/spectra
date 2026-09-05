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
    expect(storedText).not.toContain("density-4000");
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
