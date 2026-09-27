import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { realizeGeneratedPresentation } from "../presentation/layouts";
import { buildPresentationPptx } from "../presentation/io";
import { normalizePresentationContent, presentationObjectText } from "../presentation/model";
import { evaluateArtifactQuality } from "../quality/rubrics";

const theme = { id: "reading", tokens: { background: "var(--bg-primary)", heading: "var(--text-primary)", body: "var(--text-primary)" } };
const textObject = (id: string, text: string, x: number, y: number, width: number, height: number, fontSize = 18) => ({
  id, type: "text", x, y, width, height, content: { text }, style: { fontSize },
});

describe("task-sensitive artifact design", () => {
  it("preserves a consistent close-reading comparison deck without cycling layouts or enlarging type", () => {
    const input = { theme, slides: Array.from({ length: 8 }, (_, index) => ({
      id: `comparison-${index}`, title: `Choice ${index + 1}`, layoutId: "two-column",
      objects: [textObject(`title-${index}`, `Choice ${index + 1}`, 60, 40, 850, 70, 28),
        textObject(`left-${index}`, `Option A for scenario ${index + 1}: reuse the available material.`, 60, 150, 400, 190),
        textObject(`right-${index}`, `Option B for scenario ${index + 1}: collect a new observation.`, 520, 150, 400, 190)],
      speakerNotes: `Invite a comparison of the alternatives for scenario ${index + 1}.`,
    })) };
    const output = realizeGeneratedPresentation(input);
    output.slides.forEach((slide, index) => {
      expect(slide.layoutId).toBe("two-column");
      expect(slide.objects.map((object) => ({ id: object.id, text: presentationObjectText(object), x: object.x, y: object.y, width: object.width, height: object.height, fontSize: object.style?.fontSize })))
        .toEqual(input.slides[index]!.objects.map((object) => ({ id: object.id, text: object.content.text, x: object.x, y: object.y, width: object.width, height: object.height, fontSize: object.style.fontSize })));
      expect(slide.speakerNotes).toBe(input.slides[index]!.speakerNotes);
      expect(slide.accessibility?.readingOrder).toEqual(slide.objects.map((object) => object.id));
    });
    expect(realizeGeneratedPresentation(output)).toEqual(output);
    expect(evaluateArtifactQuality({ blueprintKey: "presentation", content: output, prompt: "Create an 8-slide close-reading comparison handout." }).passed).toBe(true);
  });

  it("preserves overflow text and notes, then accepts a deliberate correction", () => {
    const original = "Keep this exact ordered sentence visible. ".repeat(35).trim();
    const input = { theme, slides: [{ id: "quote", title: "The original account", layoutId: "statement",
      objects: [textObject("quote-text", original, 80, 60, 700, 80, 28)], speakerNotes: "Read the account in order." }] };
    const output = realizeGeneratedPresentation(input);
    expect(presentationObjectText(output.slides[0]!.objects[0]!)).toBe(original);
    expect(output.slides[0]!.speakerNotes).toBe("Read the account in order.");
    const failed = evaluateArtifactQuality({ blueprintKey: "presentation", content: output });
    expect(failed.passed).toBe(false);
    expect(failed.findings).toContainEqual(expect.objectContaining({ severity: "blocker", message: expect.stringContaining("overflows") }));
    input.slides[0]!.objects[0]!.content.text = "Keep the complete account with the source; display its central observation here.";
    input.slides[0]!.objects[0]!.height = 150;
    const corrected = realizeGeneratedPresentation(input);
    expect(evaluateArtifactQuality({ blueprintKey: "presentation", content: corrected }).passed).toBe(true);
  });

  it("retains a statement's authored caption and editable chart through native export", async () => {
    const input = { theme, slides: [{ id: "result", title: "The measured change", layoutId: "statement",
      objects: [textObject("title", "The measured change", 60, 40, 850, 80, 32),
        { id: "chart", type: "chart", x: 80, y: 180, width: 600, height: 230, style: { fontSize: 18 },
          altText: "A: 3 units; B: 5 units.", content: { chartType: "column", categories: ["A", "B"], series: [{ name: "Count", categories: ["A", "B"], values: [3, 5] }] } },
        textObject("caption", "A small descriptive comparison.", 80, 440, 750, 55)], speakerNotes: "Original cue." }] };
    const output = realizeGeneratedPresentation(input);
    expect(output.slides[0]!.objects.map((object) => object.id)).toEqual(["title", "chart", "caption"]);
    expect(output.slides[0]!.objects.map((object) => object.content)).toEqual(input.slides[0]!.objects.map((object) => object.content));
    expect(output.slides[0]!.speakerNotes).toBe("Original cue.");
    expect(output.slides[0]!.objects[1]!.style?.fontSize).toBe(18);
    const zip = unzipSync(new Uint8Array(await (await buildPresentationPptx(output, [])).arrayBuffer()));
    const slideXml = strFromU8(zip["ppt/slides/slide1.xml"]!);
    expect(slideXml).toContain("The measured change");
    expect(slideXml).toContain("A small descriptive comparison.");
    expect(slideXml).toContain("<c:chart");
    expect(strFromU8(zip["ppt/notesSlides/notesSlide1.xml"]!)).toContain("Original cue.");
    const chartPart = Object.entries(zip).find(([name]) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
    expect(chartPart).toBeDefined();
    const chartXml = strFromU8(chartPart![1]);
    expect(chartXml).toContain("<c:v>3</c:v>");
    expect(chartXml).toContain("<c:v>5</c:v>");
  });

  it("does not require section headings for a short letter", () => {
    const lines = ["Dear council members,", "Thank you for reviewing the pilot with us.", "We recommend collecting another round of measurements before extending it.", "We can meet on Friday to agree which uncertainty matters most.", "Yours sincerely, the pilot team."];
    const report = evaluateArtifactQuality({ blueprintKey: "document", prompt: "Write a short letter without section headings.", content: { blocks: lines.map((text, index) => ({ id: `p-${index}`, type: "paragraph", text })) } });
    expect(report.passed).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("keeps authored generic-looking words instead of replacing them with inferred copy", () => {
    const input = { theme, slides: [{ id: "terms", title: "Title", layoutId: "two-column",
      objects: [textObject("heading", "Title", 60, 40, 850, 70, 28),
        textObject("left", "Subtitle", 60, 150, 400, 190),
        textObject("right", "Visual", 520, 150, 400, 190)], speakerNotes: "Discuss the vocabulary of document structure." }] };
    const output = realizeGeneratedPresentation(input);
    expect(output.slides[0]!.title).toBe("Title");
    expect(output.slides[0]!.objects.map(presentationObjectText)).toEqual(["Title", "Subtitle", "Visual"]);
    expect(output.slides[0]!.speakerNotes).toBe(input.slides[0]!.speakerNotes);
  });

  it("matches authored frames by canonical identity after a group is dropped and duplicate IDs are normalized", () => {
    const input = { theme, slides: [null, { id: "comparison", title: "Two choices", layoutId: "two-column",
      objects: [{ id: "empty-group", type: "group", content: { childIds: [] } },
        textObject("duplicate", "Two choices", 55, 35, 880, 70, 28),
        null,
        textObject("duplicate", "Keep this placement.", 65, 155, 390, 185),
        { id: "inferred", type: "text", content: { text: "Place this in the other column." } }],
    }] };
    const canonical = normalizePresentationContent(input);
    const output = realizeGeneratedPresentation(input);
    expect(output.slides[0]!.objects.map((object) => object.id)).toEqual(canonical.slides[0]!.objects.map((object) => object.id));
    expect(new Set(output.slides[0]!.objects.map((object) => object.id)).size).toBe(3);
    expect(output.slides[0]!.objects.slice(0, 2).map(({ x, y, width, height }) => ({ x, y, width, height })))
      .toEqual([{ x: 55, y: 35, width: 880, height: 70 }, { x: 65, y: 155, width: 390, height: 185 }]);
    expect(output.slides[0]!.objects[2]).toMatchObject({ x: 525, y: 175, width: 405 });
    expect(realizeGeneratedPresentation(output)).toEqual(output);
  });

  it("still blocks unreadable contrast", () => {
    const content = { theme, slides: [{ id: "contrast", title: "Check the ink", layoutId: "statement",
      objects: [{ ...textObject("ink", "This must stay readable.", 60, 40, 850, 90, 28),
        style: { fontSize: 28, color: "var(--bg-primary)", fill: "var(--bg-primary)" } }],
    }] };
    const report = evaluateArtifactQuality({ blueprintKey: "presentation", content });
    expect(report.passed).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ criterionId: "accessibility", severity: "blocker" }));
  });

  it.each([0, -1, Number.POSITIVE_INFINITY])("still blocks invalid text size %s", (fontSize) => {
    const content = { theme, slides: [{ id: "size", title: "Check the type", layoutId: "statement",
      objects: [textObject("type", "Readable text requires a valid size.", 60, 40, 850, 90, fontSize)],
    }] };
    const report = evaluateArtifactQuality({ blueprintKey: "presentation", content });
    expect(report.passed).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ severity: "blocker", message: expect.stringContaining("positive finite text size") }));
  });
});
