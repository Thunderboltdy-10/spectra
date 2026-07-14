import { describe, expect, it } from "vitest";
import { normalizeArtifactContent } from "../ai/content-normalization";
import { validateBlueprintContent } from "../blueprints/registry";

describe("model artifact content normalization", () => {
  it("adds storage ids and canonicalizes rich document block aliases", () => {
    const content = normalizeArtifactContent("document", { blocks: [
      { type: "h1", content: "Cellular respiration" },
      { type: "collapsible", title: "Detailed steps", body: "Ten reactions" },
      { type: "table", rows: [["Stage", "ATP"], ["Glycolysis", "2"]] },
    ] });
    expect(validateBlueprintContent("document", content).success).toBe(true);
    expect(content.blocks).toMatchObject([
      { id: "block-1", type: "heading", text: "Cellular respiration", attrs: { level: 1 } },
      { id: "block-2", type: "callout", text: "Detailed steps: Ten reactions" },
      { id: "block-3", type: "table", text: "Stage | ATP\nGlycolysis | 2" },
    ]);
  });

  it("normalizes ids and common aliases for every artifact family", () => {
    const deck = normalizeArtifactContent("flashcard_deck", { cards: [{ term: "ATP", definition: "Energy carrier" }] });
    const quiz = normalizeArtifactContent("quiz", { questions: [{ question: "ATP?", type: "mcq", choices: ["A", "B"], answer: 1 }] });
    const task = normalizeArtifactContent("planner_task", { status: "in progress", subtasks: [{ text: "Read chapter" }] });
    expect(validateBlueprintContent("flashcard_deck", deck).success).toBe(true);
    expect(validateBlueprintContent("quiz", quiz).success).toBe(true);
    expect(validateBlueprintContent("planner_task", task).success).toBe(true);
  });
});
