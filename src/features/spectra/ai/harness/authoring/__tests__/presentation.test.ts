import { describe, expect, it } from "vitest";
import { resolveArtifactWriteInput } from "../../../../operations/artifact-write-content";
import { presentationObjectText } from "../../../../presentation/model";
import {
  applyPresentationEdits,
  bodyParagraphs,
  presentationFromSpec,
  presentationOutline,
  presentationProblems,
  presentationReadback,
} from "../presentation";
import { AuthoringError, sequentialIdFactory } from "../shared";

const sixSlides = {
  slides: [
    { title: "Photosynthesis", body: "How plants turn light into food" },
    { title: "Inputs", body: "- Light\n- Water\n- Carbon dioxide" },
    { title: "Two stages", body: ["Light reactions in the thylakoids", "The Calvin cycle in the stroma"] },
    { title: "Why it matters", body: ["Food chains", "Oxygen", "Carbon storage"] },
    {
      title: "Rate and light",
      body: "Rate rises with light until another factor limits it.",
      visual: {
        type: "chart" as const,
        chartType: "line" as const,
        categories: ["0", "200", "400", "600"],
        series: [{ name: "Rate", values: [0, 8, 13, 14] }],
      },
    },
    { title: "Summary", body: "Light + water + CO₂ → glucose + oxygen", notes: "Ask for one example." },
  ],
};

describe("presentation authoring", () => {
  it("builds a deck from slide specs with layouts and no placeholder copy", () => {
    const deck = presentationFromSpec(sixSlides, sequentialIdFactory());
    expect(deck.slides).toHaveLength(6);
    expect(deck.slides.map((slide) => slide.layoutId)).toEqual([
      "title-content",
      "title-content",
      "two-column",
      "three-ideas",
      "title-visual-text",
      "title-content",
    ]);
    expect(presentationProblems(deck)).toEqual([]);
    expect(deck.slides[5]!.speakerNotes).toBe("Ask for one example.");
    const allText = deck.slides.flatMap((slide) => slide.objects.map(presentationObjectText)).join(" ");
    expect(allText).not.toMatch(/Add the supporting idea|Add a visual|Key idea/);
    // The canonical writer accepts it unchanged in substance.
    const { content } = resolveArtifactWriteInput("presentation", null, { content: deck }, "");
    expect((content as typeof deck).slides).toHaveLength(6);
  });

  it("turns bullet lines into native paragraphs", () => {
    const paragraphs = bodyParagraphs("- One\n  - Two\n1. **Three**");
    expect(paragraphs.map((paragraph) => paragraph.bullet)).toEqual(["bullet", "bullet", "numbered"]);
    expect(paragraphs[1]!.level).toBe(1);
    expect(paragraphs[2]!.runs[0]).toEqual({ text: "Three", bold: true });
  });

  it("edits, moves and deletes slides by number", () => {
    const deck = presentationFromSpec(sixSlides, sequentialIdFactory());
    const edited = applyPresentationEdits(
      deck,
      [
        { op: "update_slide", slide: 1, title: "Photosynthesis basics" },
        { op: "move_slide", slide: 6, to: 2 },
        { op: "delete_slide", slide: 4 },
        { op: "set_theme", background: "var(--bg-primary)", heading: "var(--accent-mint)", body: "var(--text-primary)" },
      ],
      sequentialIdFactory(),
    );
    expect(edited.slides.map((slide) => slide.title)).toEqual([
      "Photosynthesis basics",
      "Summary",
      "Inputs",
      "Why it matters",
      "Rate and light",
    ]);
    expect(edited.theme.tokens?.background).toBe("var(--bg-primary)");
    expect(deck.slides[0]!.title).toBe("Photosynthesis");
  });

  it("replaces text inside runs without losing formatting", () => {
    const deck = presentationFromSpec(
      { slides: [{ title: "Cells", body: "**Mitochondria** make energy" }] },
      sequentialIdFactory(),
    );
    const edited = applyPresentationEdits(deck, [{ op: "replace", find: "make energy", replace: "release energy" }]);
    const body = edited.slides[0]!.objects.find((object) => presentationObjectText(object).includes("release"))!;
    const paragraphs = (body.content as { paragraphs: Array<{ runs: Array<{ text: string; bold?: boolean }> }> }).paragraphs;
    expect(paragraphs[0]!.runs[0]).toEqual({ text: "Mitochondria", bold: true });
    expect(presentationObjectText(body)).toBe("Mitochondria release energy");
  });

  it("is atomic and names the failing operation", () => {
    const deck = presentationFromSpec(sixSlides, sequentialIdFactory());
    const before = JSON.stringify(deck);
    expect(() =>
      applyPresentationEdits(deck, [
        { op: "update_slide", slide: 1, title: "Changed" },
        { op: "move_slide", slide: 9, to: 1 },
      ]),
    ).toThrow(/Edit 2 \(move_slide\): slide must be a slide number from 1 to 6/);
    expect(JSON.stringify(deck)).toBe(before);
    expect(() =>
      applyPresentationEdits(deck, [
        { op: "add_slide", title: "Chart", visual: { type: "chart", categories: ["a", "b"], series: [{ name: "x", values: [1] }] } },
      ]),
    ).toThrow(AuthoringError);
  });

  it("flags a slide whose layout wants a visual it does not have", () => {
    const deck = presentationFromSpec(
      { slides: [{ title: "Diagram", body: "Words only", layout: "title-visual-text" }] },
      sequentialIdFactory(),
    );
    expect(presentationProblems(deck).join(" ")).toMatch(/Slide 1: Add an editable visual/);
    expect(presentationReadback(deck)).toMatch(/Problems:/);
  });

  it("reads back only changed slides after an edit", () => {
    const deck = presentationFromSpec(sixSlides, sequentialIdFactory());
    const edited = applyPresentationEdits(deck, [{ op: "update_slide", slide: 2, notes: "Mention stomata." }]);
    const readback = presentationReadback(edited, deck);
    expect(readback).toMatch(/Changed or new slides:\n2\. \[title-content\] Inputs/);
    expect(readback).not.toMatch(/Photosynthesis/);
    expect(presentationOutline(edited)).toMatch(/notes: Mention stomata\./);
  });
});
