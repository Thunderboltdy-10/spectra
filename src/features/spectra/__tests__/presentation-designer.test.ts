import { describe, expect, it } from "vitest";
import { auditDeck } from "../presentation/audit";
import { DESIGNER_ACCENT, designDeck, designIdeas, designerRefusal } from "../presentation/designer";
import { normalizePresentationContent, presentationObjectText, type PresentationContent } from "../presentation/model";

function deck(slides: unknown[], tokens?: Record<string, string>): PresentationContent {
  return normalizePresentationContent({ theme: { id: "test", tokens }, slides, settings: { aspectRatio: "16:9" } });
}

const text = (id: string, value: string, readingOrder: number) => ({
  id,
  type: "text",
  x: 100,
  y: 100 + readingOrder * 100,
  width: 400,
  height: 80,
  rotation: 0,
  readingOrder,
  content: { text: value },
});

const image = (id: string) => ({ id, type: "image", x: 600, y: 100, width: 300, height: 200, rotation: 0, altText: "A cell", content: {} });

describe("presentation designer", () => {
  it("offers text looks for a title slide and keeps every word", () => {
    const source = deck([{ id: "s1", title: "Cells", objects: [text("t", "Cells", 0), text("b", "How life is built", 1)] }]);
    const ideas = designIdeas(source, 0);
    expect(ideas.map((idea) => idea.id)).toEqual(["rule", "band", "panel", "centred", "night"]);
    for (const idea of ideas) {
      const words = idea.slide.objects.filter((object) => object.type === "text").map(presentationObjectText);
      expect(words).toEqual(["Cells", "How life is built"]);
      for (const object of idea.slide.objects) {
        expect(object.x).toBeGreaterThanOrEqual(0);
        expect(object.x + object.width).toBeLessThanOrEqual(1_000);
        expect(object.y + object.height).toBeLessThanOrEqual(562.5);
      }
    }
  });

  it("puts pictures beside their words and reads contrast correctly on every look", () => {
    const source = deck([
      { id: "s1", title: "Intro", objects: [text("t", "Intro", 0)] },
      { id: "s2", title: "Mitochondria", objects: [text("t2", "Mitochondria", 0), text("b2", "They make the cell's energy.", 1), image("i2")] },
    ]);
    const ideas = designIdeas(source, 1);
    expect(ideas.map((idea) => idea.id)).toEqual(["half", "half-right", "framed", "stage"]);
    for (const idea of ideas) {
      const slides = source.slides.slice();
      slides[1] = idea.slide;
      const contrast = auditDeck({ ...source, slides }).findings.filter((finding) => finding.kind === "contrast");
      expect(contrast).toEqual([]);
    }
  });

  it("replaces its own accents instead of piling them up", () => {
    const source = deck([{ id: "s1", title: "A", objects: [text("t", "A", 0), text("b", "B", 1)] }]);
    const once = designIdeas(source, 0)[1]!.slide;
    const twice = designIdeas({ ...source, slides: [once] }, 0)[1]!.slide;
    const accents = (objects: typeof once.objects) => objects.filter((object) => object.componentId === DESIGNER_ACCENT).length;
    expect(accents(twice.objects)).toBe(accents(once.objects));
  });

  it("designs a whole deck in one family and leaves grouped slides alone", () => {
    const source = deck([
      { id: "s1", title: "A", objects: [text("t", "A", 0)] },
      {
        id: "s2",
        title: "Grouped",
        objects: [
          { id: "g", type: "group", x: 0, y: 0, width: 200, height: 200, rotation: 0, content: { childIds: ["c", "d"] } },
          { ...text("c", "Child", 0), parentId: "g" },
          { ...text("d", "Sibling", 1), parentId: "g" },
        ],
      },
    ]);
    expect(designerRefusal(source, 1)).toMatch(/grouped/);
    const slides = designDeck(source, "band");
    expect(slides[0]!.objects.some((object) => object.componentId === DESIGNER_ACCENT)).toBe(true);
    expect(slides[1]).toBe(source.slides[1]);
  });
});
