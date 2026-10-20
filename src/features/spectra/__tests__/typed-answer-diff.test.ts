import { describe, expect, it } from "vitest";
import {
  diffCharacters,
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
});
