import { describe, expect, it } from "vitest";
import { seededRandom } from "../collaboration/hand/random";
import { planStroke, strokeDuration } from "../collaboration/hand/stroke";
import { typingRhythm } from "../collaboration/hand/keystrokes";
import { planTextHand, textHunks } from "../collaboration/hand/text";

describe("the hand", () => {
  it("edits only the words that differ", () => {
    const before = "The mitochondria is the powerhouse of the cell, and it makes energy.";
    const after = "The mitochondrion is the powerhouse of the cell, and it makes ATP.";
    const hunks = textHunks(before, after);
    expect(hunks.map((hunk) => [hunk.removed, hunk.inserted])).toEqual([
      ["mitochondria", "mitochondrion"],
      ["energy", "ATP"],
    ]);
    const steps = planTextHand(before, after, seededRandom(1));
    expect(steps.at(-1)!.value).toBe(after);
    // Untouched text never moves while the hand works.
    for (const step of steps) expect(step.value.startsWith("The ")).toBe(true);
    // A single word is selected at once (double-click), then typed over.
    expect(steps.some((step) => step.selection?.start === 4 && step.selection.end === 16)).toBe(true);
  });

  it("types with an uneven, human rhythm that ends on the exact value", () => {
    const text = "Photosynthesis turns light into chemical energy. It happens in the chloroplast.";
    const chunks = typingRhythm(text, seededRandom(7));
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
    const delays = chunks.map((chunk) => chunk.delayMs);
    expect(new Set(delays).size).toBeGreaterThan(delays.length / 2);
    const total = delays.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeGreaterThan(1_500);
    expect(total).toBeLessThan(7_000);
  });

  it("is the same performance for the same seed", () => {
    const a = planTextHand("alpha beta", "alpha gamma delta", seededRandom("s"));
    const b = planTextHand("alpha beta", "alpha gamma delta", seededRandom("s"));
    expect(a).toEqual(b);
  });

  it("moves along a bowed path that lands exactly", () => {
    const stroke = planStroke({ x: 0, y: 0 }, { x: 400, y: 0 }, seededRandom(3));
    expect(stroke.durationMs).toBeGreaterThan(100);
    expect(stroke.at(stroke.durationMs)).toEqual({ x: 400, y: 0 });
    const mid = stroke.at(stroke.durationMs / 2);
    expect(Math.abs(mid.y)).toBeGreaterThan(2);
    expect(strokeDuration(40)).toBeLessThan(strokeDuration(800));
  });

  it("rewrites a sentence by selecting it, deleting it and typing anew", () => {
    const before = "Carefully edited in Spectra.";
    const after = "Spectra helps students organize class materials and deadlines in one workspace.";
    expect(textHunks(before, after, { wholeRewrites: true })).toHaveLength(1);
    const steps = planTextHand(before, after, seededRandom(4));
    const erased = steps.findIndex((step) => step.gesture === "erasing");
    expect(steps.slice(0, erased).some((step) => step.selection?.end === before.length - 1)).toBe(true);
    expect(steps[erased]!.value).toBe(".");
    expect(steps.slice(erased + 1).every((step) => step.value.endsWith("."))).toBe(true);
    expect(steps.at(-1)!.value).toBe(after);
  });

  it("backspaces a short tail and appends", () => {
    const steps = planTextHand("Due Friday", "Due Monday", seededRandom(2));
    expect(steps.at(-1)!.value).toBe("Due Monday");
    expect(steps.every((step) => step.value.startsWith("Due "))).toBe(true);
  });
});
