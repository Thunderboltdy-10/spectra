import { describe, expect, it, vi } from "vitest";
import * as openRouter from "@/lib/openrouter";
import {
  classifyRequest,
  classifyComplexity,
  classifyExplainDepth,
  detectSearchIntent,
  detectSuggestedMode,
  parseUserDirectives,
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
    expect(detectSuggestedMode("render a comparison table for this topic")).toBe(null);
  });

  it("keeps image mode for explicit render requests with visual subjects", () => {
    expect(detectSuggestedMode("render a poster of the solar system")).toBe("image");
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

  it("classifies short follow-ups as T0 when eligible", () => {
    const classified = classifyRequest({
      message: "thanks",
      complexity: "simple",
      mode: "general",
      hasAttachments: false,
      isFirstMessage: false,
      spendingTier: "normal",
    });
    expect(classified.requestClass).toBe("T0");
  });

  it("classifies research and attachment-heavy prompts as T2", () => {
    const researchClass = classifyRequest({
      message: "Research climate policy updates and cite sources.",
      mode: "research",
      hasAttachments: false,
      isFirstMessage: true,
      spendingTier: "normal",
    });
    expect(researchClass.requestClass).toBe("T2");

    const attachmentClass = classifyRequest({
      message: "Summarize this file.",
      mode: "general",
      hasAttachments: true,
      isFirstMessage: false,
      spendingTier: "normal",
    });
    expect(attachmentClass.requestClass).toBe("T2");
  });

  it("classifies multi-agent intents as T3 when tier allows", () => {
    const t3 = classifyRequest({
      message: "Research and compare three strategies deeply.",
      complexity: "complex",
      mode: "research",
      hasAttachments: false,
      isFirstMessage: false,
      multiAgentRequested: true,
      spendingTier: "normal",
    });
    expect(t3.requestClass).toBe("T3");

    const capped = classifyRequest({
      message: "Research and compare three strategies deeply.",
      complexity: "complex",
      mode: "research",
      hasAttachments: false,
      isFirstMessage: false,
      multiAgentRequested: true,
      spendingTier: "cheap_only",
    });
    expect(capped.requestClass).toBe("T2");
  });

  it("elevates active workspace-continuity prompts to L4/T3", () => {
    const workstreamDeep = classifyRequest({
      message: "Continue this project, check what's left in the planner, and use the latest notes.",
      complexity: "medium",
      mode: "general",
      hasAttachments: false,
      isFirstMessage: false,
      spendingTier: "normal",
      workstreamContext: {
        activeWorkstreamId: "ws_bio",
        focusSurface: "panel",
        artifactCount: 3,
        noteCount: 2,
        plannerItemCount: 2,
        threadCount: 5,
        linkedAgent: true,
      },
    });

    expect(workstreamDeep.requestClass).toBe("T3");
    expect(workstreamDeep.assignmentLevel).toBe("L4");
  });

  it("skips paid prompt-enhancement model calls in free_only tier", async () => {
    const completionSpy = vi.spyOn(openRouter, "openRouterChatCompletion").mockResolvedValue({
      id: "mock",
      model: "openai/gpt-5.4-nano",
      choices: [{ message: { content: "{\"prompt\":\"enhanced\"}" } }],
      usage: undefined,
    } as any);

    const result = await runAutoSettingsPipeline({
      message: "Help me summarize this chapter.",
      currentThinkingLevel: "low",
      spendingTier: "free_only",
      autoEnhancePrompt: true,
      autoThinking: true,
      autoSearch: false,
      enhanceMode: "on",
      skipModelCalls: false,
    });

    expect(result.promptEnhanced).toBe(true);
    expect(result.message).toContain("Clarified objective:");
    expect(completionSpy).not.toHaveBeenCalled();
    completionSpy.mockRestore();
  });

  it("parses memory correction directives", () => {
    const directives = parseUserDirectives("Forget about WWII. Don't bring this up for French vocabulary.");
    const forgetWithSuffix = parseUserDirectives("Forget about WWII in my memory.");
    expect(directives.memoryActions).toEqual([
      { type: "forget", target: "wwii" },
      { type: "negative_topic", topic: "french vocabulary" },
    ]);
    expect(forgetWithSuffix.memoryActions).toEqual([
      { type: "forget", target: "wwii" },
    ]);
  });

  it("parses explicit remember/profile directives", () => {
    const remember = parseUserDirectives("Remember that I study IB HL.");
    const rememberGeneric = parseUserDirectives("Remember that World War II is my strongest history topic.");
    const update = parseUserDirectives("Update my profile: I prefer concise explanations.");
    expect(remember.memoryActions).toEqual([
      { type: "remember", statement: "I study IB HL" },
    ]);
    expect(rememberGeneric.memoryActions).toEqual([
      { type: "remember", statement: "World War II is my strongest history topic" },
    ]);
    expect(update.memoryActions).toEqual([
      { type: "update_profile", statement: "I prefer concise explanations" },
    ]);
  });

  it("detects model requests with fuzzy catalog matching", () => {
    const directives = parseUserDirectives("Please use GPT-4 for this response.", {
      modelCatalog: [
        {
          modelId: "openai/gpt-4o",
          name: "GPT-4o",
          provider: "openai",
          description: "general",
        },
        {
          modelId: "anthropic/claude-sonnet-4.5",
          name: "Claude Sonnet 4.5",
          provider: "anthropic",
          description: "general",
        },
      ],
    });

    expect(directives.forcedModel).toBe("openai/gpt-4o");
    expect(directives.detectedModelPhrase?.toLowerCase()).toContain("gpt-4");
  });
});
