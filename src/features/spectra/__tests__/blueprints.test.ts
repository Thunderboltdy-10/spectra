import { describe, expect, it } from "vitest";
import { WORK_TYPE_KEYS } from "@/features/spectra/artifacts/types";
import {
  listBlueprints,
  requireBlueprint,
  validateBlueprintContent,
} from "@/features/spectra/artifacts/blueprint-catalog";
import { blueprintChoices } from "@/features/spectra/components/artifact-blueprint-sheet";

describe("Spectra blueprint registry", () => {
  it("registers only creatable first-class work blueprints", () => {
    expect(listBlueprints().map((blueprint) => blueprint.key)).toEqual([
      ...WORK_TYPE_KEYS,
    ]);
  });

  it("offers every creatable type from Library New and empty-board New work here", () => {
    expect(blueprintChoices.map((choice) => choice.key)).toEqual([
      ...WORK_TYPE_KEYS,
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
