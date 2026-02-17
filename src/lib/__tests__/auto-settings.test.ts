import { describe, expect, it } from "vitest";
import {
  classifyComplexity,
  classifyExplainDepth,
  detectSearchIntent,
  detectSuggestedMode,
  runAutoSettingsPipeline,
} from "@/lib/auto-settings";

describe("auto-settings prompt analysis", () => {
  it("classifies multipart analytical prompts as complex", () => {
    const value = classifyComplexity(
      "First compare Keynes and Friedman in terms of monetary policy assumptions, then evaluate which framework better explains the 2008 crisis with evidence, and finally synthesize policy implications for inflation and unemployment trade-offs.",
    );
    expect(value).toBe("complex");
  });

  it("detects comparison category and multipart signal", async () => {
    const result = await runAutoSettingsPipeline({
      message: "Compare mitosis and meiosis, then explain how each affects genetic variation.",
      currentThinkingLevel: "low",
      spendingTier: "normal",
      autoEnhancePrompt: false,
      autoThinking: true,
      autoSearch: false,
      skipModelCalls: true,
    });
    expect(result.promptCategory).toBe("comparison");
    expect(result.isMultipart).toBe(true);
    expect(["how", "compare"]).toContain(result.questionType);
  });

  it("detects practical application prompts", async () => {
    const result = await runAutoSettingsPipeline({
      message: "Create a practical implementation plan for reducing food waste in a school cafeteria.",
      currentThinkingLevel: "low",
      spendingTier: "normal",
      autoEnhancePrompt: false,
      autoThinking: true,
      autoSearch: false,
      skipModelCalls: true,
    });
    expect(result.promptCategory).toBe("practical_application");
  });

  it("classifies explain depth using prompt and memory cues", () => {
    expect(classifyExplainDepth("Explain photosynthesis in simple terms for beginners.")).toBe("introductory");
    expect(classifyExplainDepth("Derive the asymptotic behavior and discuss edge cases.")).toBe("advanced");
    expect(classifyExplainDepth("Explain Newton's laws with examples.")).toBe("intermediate");
  });

  it("detects suggested mode from quiz intent", () => {
    expect(detectSuggestedMode("quiz me on biology")).toBe("quiz");
    expect(detectSuggestedMode("test my knowledge of WW2")).toBe("quiz");
  });

  it("detects suggested mode from flashcard intent", () => {
    expect(detectSuggestedMode("make flashcards about chemistry")).toBe("flashcard");
    expect(detectSuggestedMode("create study cards for vocab")).toBe("flashcard");
  });

  it("detects suggested mode from research intent", () => {
    expect(detectSuggestedMode("research the effects of climate change")).toBe("research");
    expect(detectSuggestedMode("find sources about the French Revolution")).toBe("research");
  });

  it("detects suggested mode from image intent", () => {
    expect(detectSuggestedMode("generate an image of a sunset")).toBe("image");
    expect(detectSuggestedMode("draw a cat")).toBe("image");
  });

  it("does not misclassify abstract outputs as image mode", () => {
    expect(detectSuggestedMode("make a plan for revising chemistry")).toBe(null);
    expect(detectSuggestedMode("draw a conclusion from this data")).toBe(null);
  });

  it("detects time-sensitive search intent and opt-out hints", () => {
    expect(detectSearchIntent("What is the latest 2026 inflation update?")).toBe(true);
    expect(detectSearchIntent("Do not search the web, answer from memory")).toBe(false);
  });

  it("returns null for general messages", () => {
    expect(detectSuggestedMode("What is the capital of France?")).toBe(null);
    expect(detectSuggestedMode("Help me with this homework")).toBe(null);
  });

  it("includes suggestedMode in auto-settings result", async () => {
    const result = await runAutoSettingsPipeline({
      message: "quiz me on photosynthesis",
      currentThinkingLevel: "low",
      spendingTier: "normal",
      autoEnhancePrompt: false,
      autoThinking: false,
      autoSearch: false,
      skipModelCalls: true,
    });
    expect(result.suggestedMode).toBe("quiz");
  });
});
