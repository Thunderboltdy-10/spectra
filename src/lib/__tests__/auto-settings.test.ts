import { describe, expect, it } from "vitest";
import { classifyComplexity, classifyExplainDepth, runAutoSettingsPipeline } from "@/lib/auto-settings";

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
});
