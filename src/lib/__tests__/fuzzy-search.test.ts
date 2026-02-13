import { describe, expect, it } from "vitest";
import { fuzzyScore, normalizeQuery } from "@/lib/fuzzy-model-search";

describe("fuzzy model search", () => {
  it("normalizes punctuation in model query", () => {
    expect(normalizeQuery("GPT-5.2")).toBe("gpt 5 2");
  });

  it("scores GPT token aliases correctly", () => {
    const score = fuzzyScore("gpt 5", {
      name: "GPT-5",
      modelId: "openai/gpt-5",
      provider: "OpenAI",
      description: "High-end reasoning",
    });

    expect(score).toBeGreaterThan(0.5);
  });
});
