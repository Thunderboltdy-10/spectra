import { describe, expect, it } from "vitest";
import {
  parallelCreationContract,
  provisionalCreations,
  provisionalSingleCreation,
} from "./intake";

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
});
