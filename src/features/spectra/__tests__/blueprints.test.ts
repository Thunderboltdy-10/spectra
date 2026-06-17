import { describe, expect, it } from "vitest";
import {
  listBlueprints,
  requireBlueprint,
  validateBlueprintContent,
} from "@/features/spectra/blueprints";

describe("Spectra blueprint registry", () => {
  it("registers the first five built-in blueprints", () => {
    expect(listBlueprints().map((blueprint) => blueprint.key)).toEqual([
      "document",
      "thread_reference",
      "flashcard_deck",
      "quiz",
      "planner_task",
    ]);
  });

  it("rejects unknown blueprint keys", () => {
    expect(() => requireBlueprint("diagram")).toThrow("Unknown artifact blueprint");
  });

  it("validates flashcard decks as one artifact payload", () => {
    const result = validateBlueprintContent("flashcard_deck", {
      cards: Array.from({ length: 30 }, (_, index) => ({
        id: `card-${index}`,
        front: `Front ${index}`,
        back: `Back ${index}`,
      })),
      settings: { shuffle: true, revealMode: "click" },
    });

    expect(result.success).toBe(true);
  });
});

