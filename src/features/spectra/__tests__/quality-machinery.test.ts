import { describe, expect, it } from "vitest";
import {
  resolveSpectraFallbackModelId,
  SPECTRA_DEFAULT_FALLBACK_MODEL_ID,
  SPECTRA_DEFAULT_MODEL_ID,
} from "../ai/model-config";
import { PRESENTATION_LAYOUTS } from "../commands/office/presentation-commands";
import { isRepairablePlanFailure } from "../operations/plan-diagnostics";
import { creationToolContentJsonSchema } from "../operations/schema";
import {
  PRESENTATION_LAYOUT_OPTIONS,
  realizeGeneratedPresentation,
} from "../presentation/layouts";
import {
  ARTIFACT_QUALITY_RUBRICS,
  ArtifactQualityError,
  assertArtifactQuality,
  classifyDocumentEditIntent,
  evaluateArtifactQuality,
} from "../quality/rubrics";

const CALM_BACKGROUND = "#f7f9fd";
const CALM_HEADING = "#183f35";
const CALM_BODY = "#2f3e39";
const LOW_CONTRAST_BACKGROUND = "#ffffff";
const LOW_CONTRAST_TEXT = "#999999";

function textObject(id: string, value: string) {
  return { id, type: "text", content: { text: value } };
}

function shapeObject(id: string, label: string) {
  return {
    id,
    type: "shape",
    content: { shape: "rounded-rectangle", text: label },
  };
}

function chartObject(id: string) {
  return {
    id,
    type: "chart",
    content: {
      chartType: "bar",
      labels: ["Before", "After"],
      values: [42, 68],
    },
    altText: "Bar chart comparing the before and after results",
  };
}

function presentationDraft() {
  return {
    theme: {
      id: "calm-green",
      name: "Calm green",
      tokens: {
        background: CALM_BACKGROUND,
        heading: CALM_HEADING,
        body: CALM_BODY,
      },
    },
    settings: { aspectRatio: "16:9" },
    slides: [
      {
        id: "slide-1",
        title: "The decision",
        layoutId: "statement",
        objects: [textObject("s1-title", "Invest in retrieval practice")],
      },
      {
        id: "slide-2",
        title: "What changed",
        layoutId: "title-visual-text",
        objects: [
          textObject("s2-title", "What changed"),
          shapeObject("s2-visual", "Two study cycles"),
          textObject("s2-body", "Students spaced retrieval across the week."),
        ],
      },
      {
        id: "slide-3",
        title: "Two constraints",
        layoutId: "two-column",
        objects: [
          textObject("s3-title", "Two constraints"),
          textObject("s3-left", "Time remained fixed."),
          textObject("s3-right", "Feedback became immediate."),
        ],
      },
      {
        id: "slide-4",
        title: "Recall improved",
        layoutId: "visual-story",
        objects: [
          textObject("s4-title", "Recall improved"),
          chartObject("s4-chart"),
          textObject("s4-body", "The largest gain appeared after one week."),
        ],
      },
      {
        id: "slide-5",
        title: "Three practical moves",
        layoutId: "three-ideas",
        objects: [
          textObject("s5-title", "Three practical moves"),
          shapeObject("s5-1", "Space"),
          shapeObject("s5-2", "Retrieve"),
          shapeObject("s5-3", "Correct"),
        ],
      },
      {
        id: "slide-6",
        title: "Start next lesson",
        layoutId: "title-content",
        objects: [
          textObject("s6-title", "Start next lesson"),
          textObject("s6-body", "Use one low-stakes retrieval prompt."),
        ],
      },
    ],
  };
}

function analysisWorkbook() {
  return {
    workbook: { calculationMode: "automatic", locale: "en-US" },
    activeSheetId: "analysis",
    sheets: [
      {
        id: "analysis",
        name: "Analysis",
        cells: {
          A1: { value: "Category" },
          B1: { value: "Responses" },
          C1: { value: "Share" },
          D1: { value: "Insight" },
          A2: { value: "A" },
          B2: { value: 24, format: { numberFormat: "number" } },
          C2: {
            formula: "=B2/B5",
            format: { numberFormat: "percent" },
          },
          A3: { value: "B" },
          B3: { value: 41, format: { numberFormat: "number" } },
          C3: {
            formula: "=B3/B5",
            format: { numberFormat: "percent" },
          },
          A4: { value: "C" },
          B4: { value: 15, format: { numberFormat: "number" } },
          C4: {
            formula: "=B4/B5",
            format: { numberFormat: "percent" },
          },
          A5: { value: "Total" },
          B5: {
            formula: "=SUM(B2:B4)",
            format: { numberFormat: "number" },
          },
          D2: { value: "Conclusion" },
          D3: { value: "Category B accounts for the largest share." },
        },
        tables: [],
        charts: [
          {
            id: "responses-chart",
            type: "column",
            sourceRange: "A1:B4",
            title: "Responses by category",
            position: { x: 620, y: 24, width: 420, height: 280 },
          },
        ],
        frozenRows: 1,
        columnWidths: { A: 18, B: 14, C: 14, D: 44 },
      },
    ],
  };
}

function structuredDocument() {
  return {
    blocks: [
      {
        id: "overview",
        type: "heading",
        text: "Overview",
        attrs: { level: 1 },
      },
      {
        id: "overview-body",
        type: "paragraph",
        text: "Retrieval practice strengthens access to learned material over time.",
      },
      {
        id: "method",
        type: "heading",
        text: "Method",
        attrs: { level: 2 },
      },
      {
        id: "method-body",
        type: "paragraph",
        text: "Students completed short, spaced prompts with immediate corrective feedback.",
      },
      {
        id: "implications",
        type: "heading",
        text: "Implications",
        attrs: { level: 2 },
      },
      {
        id: "implications-body",
        type: "paragraph",
        text: "Teachers can add one retrieval prompt without extending lesson time.",
      },
    ],
  };
}

describe("P4.I4 quality machinery", () => {
  it("keeps one presentation layout vocabulary for Studio, commands, and AI", () => {
    expect(PRESENTATION_LAYOUTS).toBe(PRESENTATION_LAYOUT_OPTIONS);

    const deck = realizeGeneratedPresentation(presentationDraft());
    expect(deck.slides[1]?.objects[0]).toMatchObject({
      x: 70,
      y: 45,
      width: 860,
      height: 90,
    });
    expect(deck.slides[1]?.accessibility?.readingOrder).toHaveLength(3);
    expect(
      deck.slides[3]?.objects.find((object) => object.type === "chart"),
    ).toMatchObject({ x: 0, y: 0, width: 570, height: 562.5 });
  });

  it("grades presentable decks against the shared verifier rubric", () => {
    const content = realizeGeneratedPresentation(presentationDraft());
    const report = evaluateArtifactQuality({
      blueprintKey: "presentation",
      content,
      prompt: "Create a 6-slide presentation for teachers.",
    });

    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(
      ARTIFACT_QUALITY_RUBRICS.presentation.passScore,
    );
    expect(report.criteria.map((entry) => entry.id)).toEqual([
      "structure",
      "layout",
      "density",
      "pacing",
      "accessibility",
    ]);
  });

  it("rejects deck-shaped documents and makes the failure repairable", () => {
    const content = {
      theme: {
        id: "plain",
        tokens: {
          background: LOW_CONTRAST_BACKGROUND,
          heading: LOW_CONTRAST_TEXT,
          body: LOW_CONTRAST_TEXT,
        },
      },
      slides: Array.from({ length: 6 }, (_, index) => ({
        id: `slide-${index + 1}`,
        title: `Slide ${index + 1}`,
        layoutId: "title-content",
        objects: [
          {
            id: `text-${index + 1}`,
            type: "text",
            x: 20,
            y: 20,
            width: 220,
            height: 30,
            rotation: 0,
            content: { text: "A long paragraph pasted onto a slide canvas" },
            style: { fontSize: 12, color: LOW_CONTRAST_TEXT },
          },
        ],
      })),
    };

    let thrown: unknown;
    try {
      assertArtifactQuality({
        blueprintKey: "presentation",
        content,
        prompt: "Create a 6-slide presentation.",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ArtifactQualityError);
    expect(isRepairablePlanFailure(thrown)).toBe(true);
  });

  it("rejects long repetitive text-only decks that merely scrape the score", () => {
    const content = realizeGeneratedPresentation({
      theme: presentationDraft().theme,
      settings: { aspectRatio: "16:9" },
      slides: Array.from({ length: 10 }, (_, index) => ({
        id: `slide-${index + 1}`,
        title: `Study finding ${index + 1}`,
        layoutId: "title-content",
        objects: [
          textObject(`title-${index + 1}`, `Study finding ${index + 1}`),
          shapeObject(
            `body-${index + 1}`,
            "Students completed a deliberately long explanatory paragraph that repeats the same prose-first rhythm instead of presenting one scannable idea with a useful visual, chart, diagram, or comparison.",
          ),
        ],
      })),
    });
    const report = evaluateArtifactQuality({
      blueprintKey: "presentation",
      content,
      prompt: "Create a 10-slide presentation for teachers.",
    });

    expect(report.passed).toBe(false);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterionId: "pacing",
          severity: "blocker",
        }),
      ]),
    );
  });

  it("requires formula-backed, chart-bound, stated analysis", () => {
    const report = evaluateArtifactQuality({
      blueprintKey: "sheets",
      content: analysisWorkbook(),
      prompt: "Analyze these values and create a chart.",
    });
    expect(report.passed).toBe(true);

    expect(() =>
      assertArtifactQuality({
        blueprintKey: "sheets",
        content: {
          workbook: { calculationMode: "manual", locale: "en-US" },
          activeSheetId: "sheet-1",
          sheets: [
            {
              id: "sheet-1",
              name: "Sheet 1",
              cells: { A1: { value: "Result" }, A2: { value: 42 } },
              tables: [],
              charts: [],
            },
          ],
        },
        prompt: "Analyze these values and create a chart.",
      }),
    ).toThrow(/formulas over input cells/i);
  });

  it("classifies document intent and grades structured writing", () => {
    expect(classifyDocumentEditIntent("Add a conclusion paragraph")).toBe(
      "append",
    );
    expect(classifyDocumentEditIntent("Rewrite the method section")).toBe(
      "rewrite",
    );
    expect(
      classifyDocumentEditIntent("Reorder the sections into a new outline"),
    ).toBe("restructure");

    const report = evaluateArtifactQuality({
      blueprintKey: "document",
      content: structuredDocument(),
      prompt: "Create a structured report for teachers.",
    });
    expect(report.passed).toBe(true);
  });

  it("derives a design-intent create schema instead of requiring raw geometry", () => {
    const schema = creationToolContentJsonSchema("presentation") as {
      properties: {
        slides: {
          items: {
            properties: {
              layoutId: { description?: string };
              objects: { items: { required?: string[] } };
            };
          };
        };
      };
    };
    const slide = schema.properties.slides.items;
    expect(slide.properties.layoutId.description).toMatch(/design intent/i);
    expect(slide.properties.objects.items.required).not.toEqual(
      expect.arrayContaining(["x", "y", "width", "height", "rotation"]),
    );
  });

  it("keeps the fallback model distinct from the active primary route", () => {
    expect(SPECTRA_DEFAULT_FALLBACK_MODEL_ID).not.toBe(
      SPECTRA_DEFAULT_MODEL_ID,
    );
    expect(
      resolveSpectraFallbackModelId(
        SPECTRA_DEFAULT_FALLBACK_MODEL_ID,
        SPECTRA_DEFAULT_FALLBACK_MODEL_ID,
      ),
    ).toBe(SPECTRA_DEFAULT_MODEL_ID);
  });
});
