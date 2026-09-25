import { describe, expect, it } from "vitest";
import {
  parallelCreationContract,
  provisionalCreations,
  provisionalSingleCreation,
} from "./intake";
import {
  explicitMutationArtifactIdsFromPrompt,
  explicitlyExcludedArtifactIdsFromPrompt,
  isExplicitExistingArtifactUpdateOnly,
} from "./target-scope";

describe("creation intent intake", () => {
  it("keeps separate guide and flashcard outputs in the general planner", () => {
    const creations = provisionalCreations(
      "Build a compact revision pack for the water cycle: a guide and flashcards",
    );

    expect(creations.map((creation) => creation.blueprintKey)).toEqual([
      "document",
      "flashcard_deck",
    ]);
    expect(parallelCreationContract("Could you make two things: a brief water-cycle guide and a separate set of flashcards?")).toHaveLength(2);
    expect(
      provisionalSingleCreation(
        "Could you make two things: a brief water-cycle guide and a separate set of flashcards?",
      ),
    ).toBeNull();
  });

  it("still uses the focused fast path for one clear output", () => {
    expect(provisionalSingleCreation("Create a document about enzymes")).toMatchObject({
      blueprintKey: "document",
    });
  });

  it("does not count artifact sections and internal slide objects as extra outputs", () => {
    const prompt = [
      "Create exactly two new artifacts in the current workspace: one document and one native presentation.",
      "Document title: S10 Urban Heat: Revision Guide. Make a useful guide for a 15-year-old with an editable five-row table and three retrieval questions with answers.",
      "Presentation title: S10 Urban Heat: Six-Slide Presentation. Create exactly six slides and exactly one editable native clustered-column chart object.",
      "For each evidence-supported guide block and slide, use exact evidence handles. No placeholders.",
    ].join(" ");

    const creations = provisionalCreations(prompt);

    expect(creations.map((creation) => creation.blueprintKey)).toEqual([
      "document",
      "presentation",
    ]);
    expect(creations.map((creation) => creation.requestedTitle)).toEqual([
      "S10 Urban Heat: Revision Guide",
      "S10 Urban Heat: Six-Slide Presentation",
    ]);
    expect(creations[0]?.clause).toContain("editable five-row table");
    expect(creations[0]?.clause).toContain("exact evidence handles");
    expect(creations[1]?.clause).toContain("exactly six slides");
  });

  it("keeps an update-only deck request out of creation workers even when it says make the deck", () => {
    const prompt = [
      "Continue in this same conversation. Do not create a new chat.",
      "Update only guide wx76vwa1ttg0p5vccm7m3h8ry98f1718 and deck wx71ayyqjky5hqv5sr200mp9s58f1fj7 in place.",
      "Preserve the saved guide and make the deck exactly six narrative slides.",
      "Do not touch wx720bv08ajerqem8dtgkqxqsd8f0jat.",
    ].join(" ");

    expect(isExplicitExistingArtifactUpdateOnly(prompt)).toBe(true);
    expect(explicitMutationArtifactIdsFromPrompt(prompt)).toEqual([
      "wx76vwa1ttg0p5vccm7m3h8ry98f1718",
      "wx71ayyqjky5hqv5sr200mp9s58f1fj7",
    ]);
    expect(explicitlyExcludedArtifactIdsFromPrompt(prompt)).toEqual([
      "wx720bv08ajerqem8dtgkqxqsd8f0jat",
    ]);
    expect(provisionalCreations(prompt)).toEqual([]);
    expect(parallelCreationContract(prompt, true)).toEqual([]);
    expect(provisionalSingleCreation(prompt)).toBeNull();
  });

  it("preserves a separately requested new artifact beside an existing-object edit", () => {
    const prompt =
      "Update only wx76vwa1ttg0p5vccm7m3h8ry98f1718 in place, then create a new presentation about climate patterns.";

    expect(isExplicitExistingArtifactUpdateOnly(prompt)).toBe(false);
  });
});
