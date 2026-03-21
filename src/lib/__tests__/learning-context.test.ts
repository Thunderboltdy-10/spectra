import { describe, expect, it } from "vitest";
import {
  buildModeSuggestions,
  buildModeTransformGuidance,
  coerceLearningContext,
  isFlashcardAppendIntent,
  mergeLearningContexts,
} from "@/lib/orchestrator/learning-context";

describe("learning context helpers", () => {
  it("coerces and sanitizes context payloads", () => {
    const context = coerceLearningContext({
      topics: ["Photosynthesis", "photosynthesis", "  Cell Respiration "],
      keyFacts: [
        { fact: "Chlorophyll absorbs light.", source: "model", confidence: 0.8 },
        { fact: "Chlorophyll absorbs light.", source: "model", confidence: 0.6 },
      ],
      quizableFacts: ["ATP is produced in mitochondria."],
      flashcardCandidates: [{ front: "ATP", back: "Energy molecule" }],
      difficultyLevel: 6,
    });

    expect(context).not.toBeNull();
    expect(context?.topics).toEqual(["Photosynthesis", "Cell Respiration"]);
    expect(context?.keyFacts).toHaveLength(1);
    expect(context?.difficultyLevel).toBe(5);
  });

  it("merges contexts without duplicating facts", () => {
    const merged = mergeLearningContexts(
      coerceLearningContext({
        topics: ["Biology"],
        keyFacts: [{ fact: "Plants make glucose.", source: "model", confidence: 0.7 }],
        quizableFacts: ["Plants make glucose."],
        flashcardCandidates: [{ front: "Glucose", back: "Sugar used by cells" }],
        difficultyLevel: 2,
      }),
      coerceLearningContext({
        topics: ["Biology", "Photosynthesis"],
        keyFacts: [{ fact: "Plants make glucose.", source: "model", confidence: 0.9 }],
        quizableFacts: ["Light reactions occur in thylakoids."],
        flashcardCandidates: [{ front: "Thylakoids", back: "Membrane sacs in chloroplasts" }],
        difficultyLevel: 4,
      }),
    );

    expect(merged?.topics).toEqual(["Biology", "Photosynthesis"]);
    expect(merged?.keyFacts[0]?.confidence).toBe(0.9);
    expect(merged?.flashcardCandidates).toHaveLength(2);
    expect(merged?.difficultyLevel).toBe(3);
  });

  it("detects add-more flashcard intent", () => {
    expect(isFlashcardAppendIntent("Add 5 more flashcards on osmosis")).toBe(true);
    expect(isFlashcardAppendIntent("continue this deck with extra cards")).toBe(true);
    expect(isFlashcardAppendIntent("Explain osmosis in one paragraph")).toBe(false);
  });

  it("builds tutor/explain mode suggestions from rich learning context", () => {
    const context = coerceLearningContext({
      quizableFacts: [
        "Fact 1",
        "Fact 2",
        "Fact 3",
        "Fact 4",
        "Fact 5",
      ],
      flashcardCandidates: [
        { front: "A", back: "1" },
        { front: "B", back: "2" },
        { front: "C", back: "3" },
        { front: "D", back: "4" },
        { front: "E", back: "5" },
      ],
      uncertaintyGaps: ["Gap A"],
    });

    const suggestions = buildModeSuggestions({
      mode: "tutor",
      response: "This is a sufficiently long explanation that should qualify as substantive. ".repeat(5),
      learningContext: context,
    });

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]?.mode).toBe("quiz");
    expect(suggestions[1]?.mode).toBe("flashcard");
    expect(suggestions[2]?.mode).toBe("research");
  });

  it("builds flashcard transform guidance for append requests", () => {
    const context = coerceLearningContext({
      flashcardCandidates: [{ front: "Diffusion", back: "Net movement from high to low concentration" }],
    });

    const guidance = buildModeTransformGuidance({
      mode: "flashcard",
      message: "Add more cards on osmosis",
      learningContext: context,
      existingFlashcardFronts: ["Diffusion", "Osmosis"],
    });

    expect(guidance).toContain("ADD-MORE request");
    expect(guidance).toContain("Existing card fronts to avoid");
    expect(guidance).toContain("Diffusion");
  });
});
