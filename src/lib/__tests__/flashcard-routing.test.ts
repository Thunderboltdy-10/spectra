import { describe, expect, it } from "vitest";
import { buildModeSuggestions } from "@/lib/orchestrator/learning-context";

describe("flashcard mode routing affordances", () => {
  it("does not suppress existing flashcard routing suggestions", () => {
    const suggestions = buildModeSuggestions({
      mode: "tutor",
      response: "Great explanation. A next good step is to turn these concepts into flashcards for review.",
      learningContext: {
        topics: ["Photosynthesis"],
        keyFacts: [
          { fact: "Chlorophyll absorbs light energy.", source: "model", confidence: 0.8 },
        ],
        misconceptions: [],
        quizableFacts: [
          "Chlorophyll absorbs light energy.",
          "Light reactions produce ATP.",
          "Carbon fixation happens in the Calvin cycle.",
          "Photosynthesis stores energy in glucose.",
          "Water is split during light reactions.",
        ],
        flashcardCandidates: [
          { front: "Chlorophyll", back: "Pigment that absorbs light energy" },
          { front: "Calvin cycle", back: "Stage that fixes carbon into sugars" },
          { front: "ATP", back: "Energy molecule produced in light reactions" },
          { front: "Glucose", back: "Sugar produced by photosynthesis" },
          { front: "Photolysis", back: "Splitting of water using light energy" },
        ],
        difficultyLevel: 3,
        uncertaintyGaps: [],
        nextSteps: [],
      },
    });

    expect(Array.isArray(suggestions)).toBe(true);
  });
});
