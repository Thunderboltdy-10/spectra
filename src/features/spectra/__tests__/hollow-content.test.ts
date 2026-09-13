import { describe, expect, it } from "vitest";
import {
  assertCreateContentNotHollow,
  deriveCreateArtifactSummary,
  isGeneratedArtifactSummary,
  isHollowCreateContent,
  isPlaceholderArtifactSummary,
  refreshGeneratedArtifactSummary,
  resolveFocusCandidatesByTitle,
  artifactPopulationScore,
} from "../operations/hollow-content";
import { isQuietRetryableApplyFailure } from "../operations/plan-diagnostics";
import { creationToolContentJsonSchema } from "../operations/schema";
import { normalizeCodeContent } from "../code/model";
import { normalizeTimetableContent } from "../timetable/model";

describe("hollow create content detection", () => {
  it("treats default/empty code shells as hollow", () => {
    expect(isHollowCreateContent("code", {}, "create")).toBe(true);
    expect(
      isHollowCreateContent(
        "code",
        normalizeCodeContent({ files: [] }),
        "create",
      ),
    ).toBe(true);
    expect(
      isHollowCreateContent(
        "code",
        {
          files: [
            {
              id: "f1",
              path: "index.html",
              language: "html",
              source: "<main></main>",
            },
          ],
        },
        "create",
      ),
    ).toBe(true);
    expect(
      isHollowCreateContent(
        "code",
        {
          files: [
            {
              id: "f1",
              path: "index.html",
              language: "html",
              source:
                "<html><head></head><body><main></main></body></html>",
            },
          ],
        },
        "create",
      ),
    ).toBe(true);
  });

  it("accepts code with meaningful SVG or script", () => {
    expect(
      isHollowCreateContent(
        "code",
        {
          files: [
            {
              id: "f1",
              path: "index.html",
              language: "html",
              source: `<svg viewBox="0 0 200 120"><circle cx="40" cy="40" r="18" fill="#2a7"/><text x="70" y="45">Carbon</text></svg>`,
            },
          ],
        },
        "create",
      ),
    ).toBe(false);
    expect(
      isHollowCreateContent(
        "code",
        {
          files: [
            {
              id: "f1",
              path: "sketch.js",
              language: "javascript",
              source:
                "const canvas = document.querySelector('canvas');\nconst ctx = canvas.getContext('2d');\nctx.fillRect(10, 10, 40, 40);",
            },
          ],
        },
        "create",
      ),
    ).toBe(false);
  });

  it("treats empty timetable events as hollow on create only", () => {
    const empty = normalizeTimetableContent({ events: [], layers: [] });
    expect(isHollowCreateContent("timetable", empty, "create")).toBe(true);
    expect(isHollowCreateContent("timetable", empty, "update")).toBe(false);
    expect(
      isHollowCreateContent(
        "timetable",
        {
          timezone: "America/Chicago",
          layers: [
            {
              id: "study",
              name: "Study",
              kind: "study",
              visible: true,
              color: "var(--brand-primary)",
            },
          ],
          events: [
            {
              id: "e1",
              layerId: "study",
              title: "Enzyme revision",
              start: "2026-07-27T15:00:00.000Z",
              end: "2026-07-27T16:00:00.000Z",
              allDay: false,
            },
          ],
        },
        "create",
      ),
    ).toBe(false);
  });

  it("throws a quiet-retryable hollow failure", () => {
    expect(() =>
      assertCreateContentNotHollow(
        "code",
        { files: [{ id: "f1", path: "index.html", source: "<main></main>" }] },
        "create",
      ),
    ).toThrow(/hollow\/incomplete/i);
    expect(
      isQuietRetryableApplyFailure(
        new Error(
          "The generated timetable is hollow/incomplete — content.events must include at least one scheduled event.",
        ),
      ),
    ).toBe(true);
    expect(
      isQuietRetryableApplyFailure(
        new Error(
          "The generated code artifact is hollow/incomplete — files are missing or only contain an empty <main></main> shell with no meaningful SVG or script.",
        ),
      ),
    ).toBe(true);
  });

  it("requires minItems for timetable create tool schema", () => {
    const schema = creationToolContentJsonSchema("timetable") as {
      properties?: { events?: { minItems?: number } };
    };
    expect(schema.properties?.events?.minItems).toBe(1);
    const codeSchema = creationToolContentJsonSchema("code") as {
      properties?: { files?: { minItems?: number; description?: string } };
    };
    expect(codeSchema.properties?.files?.minItems).toBe(1);
    expect(codeSchema.properties?.files?.description).toMatch(/main><\/main>/i);
  });

  it("rejects Spectra is building placeholders as final summaries", () => {
    expect(isPlaceholderArtifactSummary("Spectra is building New sheets.")).toBe(
      true,
    );
    expect(
      isPlaceholderArtifactSummary("Spectra is building this artifact now."),
    ).toBe(true);
    expect(
      isPlaceholderArtifactSummary("Workbook with 12 filled cells about Km."),
    ).toBe(false);
    expect(
      deriveCreateArtifactSummary({
        blueprintKey: "sheets",
        title: "Enzyme Km & Vmax Comparison",
        summary: "Spectra is building New sheets.",
        content: {
          sheets: [
            {
              id: "sheet-1",
              name: "Data",
              cells: { A1: { value: "Enzyme" }, B1: { value: "Km" } },
            },
          ],
        },
        prompt: "Create a sheet about enzyme kinetics",
      }),
    ).toMatch(/Workbook with 2 filled cells/i);
  });

  it("refreshes generated summaries after content cardinality changes", () => {
    expect(
      isGeneratedArtifactSummary(
        "8-block document about Water Cycle Revision Guide.",
        "document",
      ),
    ).toBe(true);
    expect(
      refreshGeneratedArtifactSummary({
        blueprintKey: "document",
        title: "Water Cycle Revision Guide",
        currentSummary: "8-block document about Water Cycle Revision Guide.",
        nextSummary: "8-block document about Water Cycle Revision Guide.",
        content: {
          blocks: Array.from({ length: 11 }, (_, index) => ({
            id: `block-${index}`,
            type: "paragraph",
            text: `Block ${index}`,
          })),
        },
      }),
    ).toBe("11-block document about Water Cycle Revision Guide.");
  });

  it("preserves an explicit summary when a generated summary was replaced", () => {
    expect(
      refreshGeneratedArtifactSummary({
        blueprintKey: "document",
        title: "Water Cycle Revision Guide",
        currentSummary: "8-block document about Water Cycle Revision Guide.",
        nextSummary: "A concise guide for exam-week review.",
        content: { blocks: [{ id: "p1", type: "paragraph", text: "Water" }] },
      }),
    ).toBe("A concise guide for exam-week review.");
  });

  it("prefers populated same-title sheets when resolving focus", () => {
    const hollow = {
      id: "hollow",
      title: "Enzyme Km & Vmax Comparison",
      blueprintKey: "sheets" as const,
      summary: "Spectra is building New sheets.",
      content: {
        sheets: [
          {
            id: "sheet-1",
            name: "Sheet 1",
            cells: {},
            rowCount: 100,
            columnCount: 26,
          },
        ],
      },
      updatedAt: 200,
    };
    const populated = {
      id: "populated",
      title: "Enzyme Km & Vmax Comparison",
      blueprintKey: "sheets" as const,
      summary: "Km and Vmax comparison workbook.",
      content: {
        sheets: [
          {
            id: "sheet-1",
            name: "Kinetics",
            cells: {
              A1: { value: "Enzyme" },
              B1: { value: "Km" },
              A2: { value: "A" },
              B2: { value: 3.2 },
            },
            charts: [{ id: "chart-1" }],
          },
        ],
      },
      updatedAt: 100,
    };
    expect(artifactPopulationScore("sheets", hollow.content)).toBe(0);
    expect(artifactPopulationScore("sheets", populated.content)).toBeGreaterThan(
      0,
    );
    expect(
      resolveFocusCandidatesByTitle([hollow, populated], hollow.title).map(
        (item) => item.id,
      ),
    ).toEqual(["populated"]);
    expect(
      resolveFocusCandidatesByTitle(
        [hollow, { ...populated, id: "twin", updatedAt: 300 }],
        hollow.title,
      ).map((item) => item.id),
    ).toEqual(["twin"]);
  });
});
