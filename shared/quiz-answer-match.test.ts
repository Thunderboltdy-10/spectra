import { describe, expect, it } from "vitest";
import { shortAnswerMatches } from "./quiz-answer-match";

describe("short answer marking", () => {
  it("accepts the same answer written differently", () => {
    expect(shortAnswerMatches("36cm", "36 cm")).toBe(true);
    expect(shortAnswerMatches("  Mitochondria. ", "mitochondria")).toBe(true);
    expect(shortAnswerMatches("0.50", "0.5")).toBe(true);
  });

  it("accepts the heart of an answer that goes on to explain itself", () => {
    expect(shortAnswerMatches("36cm", "36 cm; adjacent nodes are half a wavelength apart")).toBe(true);
    expect(shortAnswerMatches("Diffraction", "Diffraction, because the gap is close to the wavelength")).toBe(true);
    expect(shortAnswerMatches("36", "36 cm")).toBe(true);
  });

  it("does not accept a different answer", () => {
    expect(shortAnswerMatches("35 cm", "36 cm")).toBe(false);
    expect(shortAnswerMatches("36 m", "36 cm")).toBe(false);
    expect(shortAnswerMatches("half", "36 cm; adjacent nodes are half a wavelength apart")).toBe(false);
    expect(shortAnswerMatches("", "36 cm")).toBe(false);
    expect(shortAnswerMatches("anything", "")).toBe(false);
  });
});
