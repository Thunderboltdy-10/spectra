import { describe, expect, it } from "vitest";
import {
  diffCharacters,
  diffWords,
  foldForComparison,
} from "../components/flashcards/typed-answer-diff";

const render = (parts: ReturnType<typeof diffCharacters>) =>
  parts
    .map((part) =>
      part.kind === "same" ? part.text : part.kind === "extra" ? `[-${part.text}]` : `[+${part.text}]`,
    )
    .join("");

describe("typed answer diff", () => {
  it("keeps an exact answer whole", () => {
    expect(diffCharacters("osmosis", "osmosis")).toEqual([
      { kind: "same", text: "osmosis" },
    ]);
  });

  it("marks extra and missing letters where they fall", () => {
    expect(render(diffCharacters("watter acros", "water across"))).toBe(
      "wat[-t]er acros[+s]",
    );
  });

  it("ignores case and accents when matching letters", () => {
    expect(render(diffCharacters("CAFE", "café"))).toBe("café");
  });

  it("folds answers the same way for the right-or-wrong check", () => {
    expect(foldForComparison("  Café, au lait! ")).toBe(foldForComparison("cafe au   lait"));
  });

  it("marks a typed sentence word by word against the answer's own words", () => {
    expect(
      render(diffWords("condensashun forms clouds", "Water vapour cools and condensation forms droplets that gather into clouds.")),
    ).toBe("condensa[-shu]n forms clouds");
  });

  it("marks a typed word with nothing near it in the answer as a whole", () => {
    expect(render(diffWords("banana", "Water vapour cools into droplets."))).toBe("[-banana]");
  });
});
