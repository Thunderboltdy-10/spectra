import { describe, expect, it } from "vitest";
import { foldUnchanged, wordDiff } from "../collaboration/word-diff";

describe("word diff", () => {
  it("marks the words that changed and keeps the rest in order", () => {
    const segments = wordDiff("The mitochondria makes energy.", "The mitochondrion makes ATP.");
    expect(segments.filter((segment) => segment.kind === "removed").map((segment) => segment.text)).toEqual(["mitochondria", "energy"]);
    expect(segments.filter((segment) => segment.kind === "added").map((segment) => segment.text)).toEqual(["mitochondrion", "ATP"]);
    const rebuilt = (kind: "removed" | "added") =>
      segments.filter((segment) => segment.kind !== kind).map((segment) => segment.text).join("");
    expect(rebuilt("added")).toBe("The mitochondria makes energy.");
    expect(rebuilt("removed")).toBe("The mitochondrion makes ATP.");
  });

  it("folds long untouched text", () => {
    const long = "word ".repeat(200);
    const folded = foldUnchanged(wordDiff(`${long}old`, `${long}new`));
    expect(folded[0]!.text.length).toBeLessThan(100);
    expect(folded.some((segment) => segment.kind === "added" && segment.text === "new")).toBe(true);
  });
});
