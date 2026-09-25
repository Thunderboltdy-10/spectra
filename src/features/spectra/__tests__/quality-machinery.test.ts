import { describe, expect, it } from "vitest";
import {
  resolveSpectraFallbackModelId,
  SPECTRA_DEFAULT_FALLBACK_MODEL_ID,
  SPECTRA_DEFAULT_MODEL_ID,
} from "../ai/model-config";
import { PRESENTATION_LAYOUTS } from "../commands/office/presentation-commands";
import { isRepairablePlanFailure } from "../operations/plan-diagnostics";
import { creationToolContentJsonSchema, parseSpectraPlan } from "../operations/schema";
import { hasNumericTableSource } from "../quality/source-requirements";
import { auditDeck } from "../presentation/audit";
import {
  applyBibliographySlides,
  BIBLIOGRAPHY_SLIDE_MARKER,
} from "../presentation/bibliography";
import {
  PRESENTATION_LAYOUT_OPTIONS,
  ensurePresentationReadingOrders,
  realizeGeneratedPresentation,
} from "../presentation/layouts";
import {
  ARTIFACT_QUALITY_RUBRICS,
  ArtifactQualityError,
  assertArtifactQuality,
  classifyDocumentEditIntent,
  evaluateArtifactQuality,
} from "../quality/rubrics";

const CALM_BACKGROUND = "var(--bg-secondary)";
const CALM_HEADING = "var(--accent-mint)";
const CALM_BODY = "var(--text-primary)";
const LOW_CONTRAST_BACKGROUND = "var(--bg-elevated)";
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

function presentationDraft(): {
  theme: { id: string; name: string; tokens: Record<string, string> };
  settings: { aspectRatio: "16:9" };
  slides: Array<{
    id: string;
    title: string;
    layoutId: string;
    objects: Array<Record<string, unknown>>;
    accessibility?: { label?: string; readingOrder?: string[] };
  }>;
} {
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
  it("requires real numeric output from inspected sources even for vague wording", () => {
    const numericSourceRequired = hasNumericTableSource([{ name: "observations.csv", mimeType: "text/csv", extractedText: "Site,Temperature (C)\nNorth,31.8\nSouth,33.1" }]);
    expect(numericSourceRequired).toBe(true);
    expect(hasNumericTableSource([{ name: "empty.csv", mimeType: "text/csv", extractedText: "Site,Value\nNorth,\nSouth, " }])).toBe(false);
    const draft = presentationDraft();
    const withoutData = { ...draft, slides: draft.slides.map((slide) => ({ ...slide, objects: slide.objects.filter((object) => object.type !== "chart") })) };
    const report = evaluateArtifactQuality({ blueprintKey: "presentation", content: withoutData, prompt: "Help me study and present this", numericSourceRequired });
    expect(report.findings.some((finding) => /editable chart or table with numeric series/i.test(finding.message))).toBe(true);
  });

  it.each([
    { type: "chart", content: { labels: ["A", "B"], values: [null, ""] } },
    { type: "chart", content: { labels: ["A"], values: [1, 2] } },
    { type: "table", content: { rows: [["Site", "Value"], ["North", ""], ["South", " "]] } },
  ])("does not turn missing data into numeric evidence ($type)", (visual) => {
    const draft = presentationDraft();
    const content = { ...draft, slides: draft.slides.map((slide) => ({ ...slide, objects: slide.objects.map((object) => object.type === "chart" ? { ...object, ...visual } : object) })) };
    const report = evaluateArtifactQuality({ blueprintKey: "presentation", content, numericSourceRequired: true });
    expect(report.findings.some((finding) => /editable chart or table with numeric series/i.test(finding.message))).toBe(true);
  });

  it("rejects a shape labelled chart when numeric presentation data is required", () => {
    const placeholderDeck = {
      ...presentationDraft(),
      slides: presentationDraft().slides.map((slide, index) =>
        index === 3
          ? {
              ...slide,
              objects: [
                textObject("s4-title", "Neighborhood heat"),
                shapeObject("s4-fake-chart", "Chart"),
                textObject("s4-body", "Greenery tracks cooler surfaces."),
              ],
            }
          : slide,
      ),
    };
    const report = evaluateArtifactQuality({
      blueprintKey: "presentation",
      content: placeholderDeck,
      prompt:
        "Turn this CSV into a study deck and present the numeric comparison with a chart.",
    });
    expect(report.passed).toBe(false);
    expect(
      report.findings.some((finding) =>
        /editable chart or table with numeric series/i.test(finding.message),
      ),
    ).toBe(true);
  });


  it("rejects an empty chart object without numeric series", () => {
    const emptyChartDeck = {
      ...presentationDraft(),
      slides: presentationDraft().slides.map((slide, index) =>
        index === 3
          ? {
              ...slide,
              objects: [
                textObject("s4-title", "Neighborhood heat"),
                {
                  id: "s4-empty-chart",
                  type: "chart",
                  content: { chartType: "bar", labels: [], values: [] },
                  altText: "Empty chart placeholder",
                },
                textObject("s4-body", "Greenery tracks cooler surfaces."),
              ],
            }
          : slide,
      ),
    };
    const report = evaluateArtifactQuality({
      blueprintKey: "presentation",
      content: emptyChartDeck,
      prompt:
        "Turn this CSV into a study deck and present the numeric comparison with a chart.",
    });
    expect(report.passed).toBe(false);
    expect(
      report.findings.some((finding) =>
        /editable chart or table with numeric series/i.test(finding.message),
      ),
    ).toBe(true);
  });

  it("accepts a real editable numeric chart series for data presentations", () => {
    const report = evaluateArtifactQuality({
      blueprintKey: "presentation",
      content: presentationDraft(),
      prompt:
        "Turn this CSV into a study deck and present the numeric comparison with a chart.",
    });
    expect(
      report.findings.some((finding) =>
        /editable chart or table with numeric series/i.test(finding.message),
      ),
    ).toBe(false);
  });


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

  it("raises chart labels to the readable floor and derives missing reading order", () => {
    const draft = presentationDraft();
    const chartSlide = draft.slides[3];
    const orderSlide = draft.slides[4];
    expect(chartSlide).toBeDefined();
    expect(orderSlide).toBeDefined();
    if (!chartSlide || !orderSlide) return;
    chartSlide.objects = chartSlide.objects.map((object) =>
      object.type === "chart"
        ? { ...object, style: { fontSize: 18 } }
        : object,
    );
    orderSlide.accessibility = undefined;

    const content = realizeGeneratedPresentation(draft);
    const chart = content.slides[3]?.objects.find(
      (object) => object.type === "chart",
    );
    const visibleOrderSlide = content.slides[4]?.objects.filter(
      (object) => !object.hidden,
    ) ?? [];
    const report = evaluateArtifactQuality({
      blueprintKey: "presentation",
      content,
      prompt: "Create a 6-slide presentation for teachers.",
    });

    expect(chart?.style?.fontSize).toBeGreaterThanOrEqual(20);
    expect(content.slides[4]?.accessibility?.readingOrder).toEqual(
      visibleOrderSlide.map((object) => object.id),
    );
    expect(report.passed).toBe(true);
  });

  it("counts only actual slides, including an explicitly generated bibliography", () => {
    const content = realizeGeneratedPresentation(presentationDraft());
    content.slides.forEach((slide) => {
      slide.citations = [
        {
          id: `citation-${slide.id}`,
          label: "Urban heat reading, p. 1",
          sourceRefs: ["evidence:urban-heat-reading-p1"],
        },
      ];
    });
    const beforeReferences = evaluateArtifactQuality({
      blueprintKey: "presentation",
      content,
      prompt: "Create a 6-slide presentation for teachers.",
    });
    expect(beforeReferences.findings).not.toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("total slides"),
      }),
    );
    applyBibliographySlides(content);

    const report = evaluateArtifactQuality({
      blueprintKey: "presentation",
      content,
      prompt: "Create a 7-slide presentation for teachers.",
    });

    expect(content.slides.at(-1)?.accessibility?.label).toBe(
      BIBLIOGRAPHY_SLIDE_MARKER,
    );
    expect(content.slides).toHaveLength(7);
    expect(report.findings).not.toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("total slides"),
      }),
    );
    const overfullReport = evaluateArtifactQuality({
      blueprintKey: "presentation",
      content,
      prompt: "Create a 6-slide presentation for teachers.",
    });
    expect(overfullReport.findings).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("exactly 6 total slides"),
      }),
    );

    content.slides.splice(content.slides.length - 2, 1);
    content.slides.pop();
    const narrativeOnlyReport = evaluateArtifactQuality({
      blueprintKey: "presentation",
      content,
      prompt: "Create a 6-slide presentation for teachers.",
    });
    expect(narrativeOnlyReport.findings).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("exactly 6 total slides"),
      }),
    );
    applyBibliographySlides(content);
    const exactTotalReport = evaluateArtifactQuality({
      blueprintKey: "presentation",
      content,
      prompt: "Create a 6-slide presentation for teachers.",
    });
    expect(content.slides).toHaveLength(6);
    expect(exactTotalReport.findings).not.toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("exactly 6 total slides"),
      }),
    );
  });

  it("realizes generated reading order before the quality audit", () => {
    const content = presentationDraft();
    content.slides[3]!.accessibility = undefined;
    const report = evaluateArtifactQuality({
      blueprintKey: "presentation",
      content,
      prompt: "Create a presentation for teachers.",
    });
    expect(report.findings).not.toContainEqual(
      expect.objectContaining({
        message: expect.stringMatching(/reading order/i),
      }),
    );
  });

  it("repairs missing reading order for AI-generated and cited slides", () => {
    const deck = realizeGeneratedPresentation(presentationDraft());
    const slide = deck.slides[4];
    expect(slide).toBeDefined();
    if (!slide) return;
    slide.accessibility = undefined;
    expect(auditDeck(deck).counts.readingOrder).toBeGreaterThan(0);

    ensurePresentationReadingOrders(deck);

    const repairedSlide = deck.slides[4]!;
    expect(repairedSlide.accessibility?.readingOrder).toEqual(
      repairedSlide.objects
        .filter((object) => !object.hidden)
        .slice()
        .sort((left, right) => left.y - right.y || left.x - right.x)
        .map((object) => object.id),
    );
    expect(auditDeck(deck).counts.readingOrder).toBe(0);
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
    const content = {
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
    };
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

  it("realizes a 12-slide experimental-design brief into a presentable deck", () => {
    const outline = [
      ["Experimental design", "A fair test for pendulum period."],
      ["Research question", "How does string length change the period of a pendulum?"],
      ["Hypothesis", "Longer strings increase period because the restoring path is longer."],
      ["Independent variable", "String length measured from pivot to bob centre."],
      ["Dependent variable", "Period averaged from ten complete swings."],
      ["Control variables", "Mass, amplitude, and release height stay fixed."],
      ["Materials", "Stand, string, bob, metre rule, and stopwatch."],
      ["Method", "Measure length, release at a small angle, and time ten oscillations."],
      ["Data", "Record length, ten-swing time, and calculated period."],
      ["Analysis", "Plot period against length and look for a clear trend."],
      ["Uncertainty", "Repeat timings and quote the range on each period."],
      ["Conclusion", "State whether the hypothesis holds and what to try next."],
    ];
    const content = realizeGeneratedPresentation({
      theme: presentationDraft().theme,
      settings: { aspectRatio: "16:9" },
      slides: outline.map(([title, body], index) => ({
        id: `slide-${index + 1}`,
        title,
        layoutId: "title-content",
        objects: [
          textObject(`title-${index + 1}`, title),
          textObject(
            `body-${index + 1}`,
            `${body} Additional classroom detail that would overflow a narrow frame if the template did not fit display copy and park the rest in speaker notes.`,
          ),
        ],
      })),
    });
    const report = evaluateArtifactQuality({
      blueprintKey: "presentation",
      content,
      prompt:
        "Create a 12-slide presentation on experimental design from this outline.",
    });

    expect(content.slides).toHaveLength(12);
    expect(new Set(content.slides.map((slide) => slide.layoutId)).size).toBeGreaterThanOrEqual(4);
    for (const slide of content.slides) {
      const objectIds = new Set(slide.objects.map((object) => object.id));
      expect(slide.accessibility?.readingOrder?.length).toBeGreaterThan(0);
      for (const objectId of slide.accessibility?.readingOrder ?? []) {
        expect(objectIds.has(objectId)).toBe(true);
      }
    }
    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(
      ARTIFACT_QUALITY_RUBRICS.presentation.passScore,
    );
  });

  it("rewrites reading order after parking extras and accepts stale authored ids in a plan", () => {
    const realized = realizeGeneratedPresentation({
      theme: presentationDraft().theme,
      settings: { aspectRatio: "16:9" },
      slides: [
        {
          id: "slide-1",
          title: "Experimental design",
          layoutId: "statement",
          objects: [
            textObject("title-1", "Experimental design"),
            textObject("body-1", "A fair test for pendulum period."),
          ],
          accessibility: { readingOrder: ["missing-object", "title-1", "body-1"] },
        },
      ],
    });
    const remaining = new Set(
      realized.slides[0]?.objects.map((object) => object.id),
    );
    expect(realized.slides[0]?.objects).toHaveLength(1);
    for (const objectId of realized.slides[0]?.accessibility?.readingOrder ?? []) {
      expect(remaining.has(objectId)).toBe(true);
    }

    const plan = parseSpectraPlan({
      decision: "operate",
      intent: {
        mode: "create",
        requestedArtifactTypes: ["presentation"],
        requestedVisibleArtifactCount: 1,
        targetArtifactId: null,
        targetWorkspaceId: null,
      },
      conversationTitle: "Experimental design deck",
      conversationSummary: "A twelve-slide pendulum investigation.",
      choices: null,
      operations: [
        {
          type: "artifact.create",
          input: {
            blueprintKey: "presentation",
            title: "P4V1 Experimental Design Deck",
            summary: null,
            content: {
              theme: presentationDraft().theme,
              settings: { aspectRatio: "16:9" },
              slides: [
                {
                  id: "slide-1",
                  title: "Experimental design",
                  objects: [
                    textObject("title-1", "Experimental design"),
                    textObject("body-1", "A fair test for pendulum period."),
                  ],
                  accessibility: {
                    readingOrder: ["from-another-slide", "title-1"],
                  },
                },
              ],
            },
            tags: [],
            workspaceId: null,
            placement: "context",
            pinned: false,
            exclusivePin: false,
          },
        },
      ],
      finalResponse: "Created the deck.",
    });
    expect(plan.operations[0]?.type).toBe("artifact.create");
  });

  it("treats visible reading order and generated contrast as template-owned", () => {
    const deck = realizeGeneratedPresentation({
      theme: presentationDraft().theme,
      settings: { aspectRatio: "16:9" },
      slides: [
        {
          id: "slide-1",
          title: "Three practical moves",
          layoutId: "three-ideas",
          objects: [
            {
              ...textObject("title-1", "Three practical moves"),
              style: { color: "var(--bg-secondary)", fill: "var(--bg-secondary)", fontSize: 36 },
            },
            shapeObject("idea-1", "Space"),
            shapeObject("idea-2", "Retrieve"),
            shapeObject("idea-3", "Correct"),
            { ...textObject("parked", "Hidden extra"), hidden: true },
          ],
        },
      ],
    });
    const slide = deck.slides[0];
    const visible = slide?.objects.filter((object) => !object.hidden) ?? [];
    expect(visible.length).toBeGreaterThanOrEqual(3);
    expect(slide?.accessibility?.readingOrder).toHaveLength(visible.length);
    const audit = auditDeck(deck);
    expect(audit.findings.filter((entry) => entry.kind === "readingOrder")).toEqual([]);
    expect(audit.findings.filter((entry) => entry.kind === "contrast")).toEqual([]);
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

    const methodGuide = {
      blocks: [
        {
          id: "title",
          type: "heading",
          text: "Pendulum period method guide",
          attrs: { level: 1 },
        },
        {
          id: "aim",
          type: "heading",
          text: "Aim",
          attrs: { level: 2 },
        },
        {
          id: "aim-body",
          type: "paragraph",
          text: "Students change string length and measure period while keeping mass and amplitude fixed.",
        },
      ],
    };
    const withoutForcedCitations = evaluateArtifactQuality({
      blueprintKey: "document",
      content: methodGuide,
      prompt:
        "Create a structured document named Method Guide for teachers. Do not cite outside sources.",
    });
    expect(withoutForcedCitations.passed).toBe(true);
    expect(
      withoutForcedCitations.findings.some((finding) =>
        /verified source metadata/i.test(finding.message),
      ),
    ).toBe(false);

    expect(
      evaluateArtifactQuality({
        blueprintKey: "document",
        content: structuredDocument(),
        prompt: "Write a research briefing with citations for this lab.",
      }).passed,
    ).toBe(false);
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
