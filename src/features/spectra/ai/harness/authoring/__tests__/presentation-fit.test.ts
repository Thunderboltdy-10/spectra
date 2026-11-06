import { describe, expect, it } from "vitest";
import { estimateTextHeight } from "../../../../presentation/audit";
import { presentationObjectText } from "../../../../presentation/model";
import { presentationFromSpec, presentationProblems } from "../presentation";
import { sequentialIdFactory } from "../shared";

function slideOf(spec: Parameters<typeof presentationFromSpec>[0]) {
  return presentationFromSpec({ design: "none", ...spec }, sequentialIdFactory()).slides[0]!;
}

describe("how written copy sits on a slide", () => {
  it("sets body words at a body size, not the size of a new text box", () => {
    const slide = slideOf({ slides: [{ title: "Standing waves", layout: "title-content", body: "Nodes stay still." }] });
    const body = slide.objects.find((object) => presentationObjectText(object) === "Nodes stay still.");
    expect(body?.style?.fontSize).toBeLessThanOrEqual(26);
  });

  it("gives a long title a size whose lines stand inside its box", () => {
    const slide = slideOf({ slides: [{ title: "Standing waves: a still pattern made by moving waves", layout: "title-content", body: "One line" }] });
    const title = slide.objects.find((object) => presentationObjectText(object).startsWith("Standing waves"))!;
    expect(estimateTextHeight(title)).toBeLessThanOrEqual(title.height + 1);
  });

  it("keeps a table on the slide and its words readable", () => {
    const rows = Array.from({ length: 9 }, (_, index) => [`Row ${index}`, "A short cell", "Another"]);
    const slide = slideOf({ slides: [{ title: "Harmonics", layout: "title-content", body: "One line", visual: { type: "table", rows } }] });
    const table = slide.objects.find((object) => object.type === "table")!;
    expect(table.y + table.height).toBeLessThanOrEqual(562.5);
    expect(table.style?.fontSize).toBeGreaterThanOrEqual(12);
  });

  it("sets a designed table for the frame Designer gave it", () => {
    const rows = [["", "Step-up", "Step-down"], ["Secondary turns", "More", "Fewer"], ["Secondary voltage", "Higher", "Lower"]];
    const deck = presentationFromSpec(
      { design: "panel", slides: [{ title: "How a transformer works", body: "- One\n- Two\n- Three", visual: { type: "table", rows } }] },
      sequentialIdFactory(),
    );
    const table = deck.slides[0]!.objects.find((object) => object.type === "table")!;
    expect(table.style?.fontSize).toBeGreaterThanOrEqual(18);
  });

  it("wraps whole words when it decides what fits", () => {
    const narrow = slideOf({ slides: [{ title: "Short", layout: "title-content", body: "One" }] }).objects[0]!;
    const words = { ...narrow, width: 320, content: { text: "Standing waves: still pattern, moving energy?" }, style: { fontSize: 48, lineHeight: 1 } };
    expect(estimateTextHeight(words)).toBe(5 * 48);
  });

  it("tells the author a diagram typed in characters doesn't read", () => {
    const deck = presentationFromSpec(
      { design: "none", slides: [{ title: "Modes", layout: "visual-story", visual: { type: "shape", text: "N ●────────∩────────● N" } }] },
      sequentialIdFactory(),
    );
    expect(presentationProblems(deck).join(" ")).toMatch(/typed in characters/);
  });
});
