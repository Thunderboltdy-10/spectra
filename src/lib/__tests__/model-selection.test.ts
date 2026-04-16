import { describe, expect, it } from "vitest";
import {
  inferRoutingLane,
  isModelAllowedInTier,
  isModelTooExpensivePerMillion,
  pickModelAndFallbacks,
} from "@/lib/model-selection";

describe("model selection guardrails", () => {
  it("excludes image-generation models for non-image turns", () => {
    const picked = pickModelAndFallbacks({
      catalog: [
        {
          modelId: "google/gemini-image-preview",
          name: "Gemini Image Preview",
          inputCostPerM: 0,
          outputCostPerM: 0,
          tags: ["image_generation"],
          isFree: true,
        },
        {
          modelId: "z-ai/glm-4.5-air",
          name: "GLM 4.5 Air",
          inputCostPerM: 2.5,
          outputCostPerM: 4,
          reasoningRating: "high",
          speedRating: "medium",
          createdAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
        },
      ],
      tier: "normal",
      lane: "fast_chat",
      mode: "general",
      messageLength: 300,
      requiredCapabilities: [],
    });

    expect(picked.selected?.modelId).toBe("z-ai/glm-4.5-air");
  });

  it("penalizes small free models on complex normal-tier turns", () => {
    const picked = pickModelAndFallbacks({
      catalog: [
        {
          modelId: "provider/reasoner-27b:free",
          name: "Reasoner 27B Free",
          inputCostPerM: 0,
          outputCostPerM: 0,
          isFree: true,
          reasoningRating: "high",
          createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
        },
        {
          modelId: "z-ai/glm-4.6",
          name: "GLM 4.6",
          inputCostPerM: 4,
          outputCostPerM: 7,
          reasoningRating: "high",
          speedRating: "medium",
          createdAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
        },
      ],
      tier: "normal",
      lane: "deep_reasoning",
      mode: "research",
      messageLength: 1800,
      requiredCapabilities: ["reasoning"],
      preferredCapabilities: ["reasoning"],
    });

    expect(picked.selected?.modelId).toBe("z-ai/glm-4.6");
  });

  it("does not recommend video-generation models for regular chat requests", () => {
    const picked = pickModelAndFallbacks({
      catalog: [
        {
          modelId: "google/veo-3-fast",
          name: "Veo 3 Fast",
          inputCostPerM: 1,
          outputCostPerM: 2,
          createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
        },
        {
          modelId: "z-ai/glm-4.6",
          name: "GLM 4.6",
          inputCostPerM: 4,
          outputCostPerM: 7,
          reasoningRating: "high",
          speedRating: "medium",
          createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
        },
      ],
      tier: "normal",
      lane: "fast_chat",
      mode: "general",
      messageLength: 200,
    });

    expect(picked.selected?.modelId).toBe("z-ai/glm-4.6");
  });

  it("prefers fresh models and only falls back to stale ones if needed", () => {
    const picked = pickModelAndFallbacks({
      catalog: [
        {
          modelId: "provider/stale-model",
          name: "Stale Model",
          inputCostPerM: 2,
          outputCostPerM: 3,
          createdAt: Date.now() - 130 * 24 * 60 * 60 * 1000,
        },
        {
          modelId: "provider/fresh-model",
          name: "Fresh Model",
          inputCostPerM: 3,
          outputCostPerM: 4,
          createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
        },
      ],
      tier: "normal",
      lane: "fast_chat",
      mode: "general",
      messageLength: 220,
    });

    expect(picked.selected?.modelId).toBe("provider/fresh-model");
  });

  it("falls back to stale models when no fresh options exist", () => {
    const picked = pickModelAndFallbacks({
      catalog: [
        {
          modelId: "provider/only-stale",
          name: "Only Stale",
          inputCostPerM: 2,
          outputCostPerM: 3,
          createdAt: Date.now() - 150 * 24 * 60 * 60 * 1000,
        },
      ],
      tier: "normal",
      lane: "fast_chat",
      mode: "general",
      messageLength: 80,
    });

    expect(picked.selected?.modelId).toBe("provider/only-stale");
  });

  it("preserves a valid anchor model when scores are close", () => {
    const picked = pickModelAndFallbacks({
      catalog: [
        {
          modelId: "provider/anchor",
          inputCostPerM: 4,
          outputCostPerM: 5,
          reasoningRating: "high",
          createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
        },
        {
          modelId: "provider/challenger",
          inputCostPerM: 4,
          outputCostPerM: 5,
          reasoningRating: "high",
          createdAt: Date.now() - 18 * 24 * 60 * 60 * 1000,
        },
      ],
      tier: "normal",
      lane: "deep_reasoning",
      mode: "research",
      messageLength: 1200,
      requiredCapabilities: ["reasoning"],
      anchorModelId: "provider/anchor",
    });

    expect(picked.selected?.modelId).toBe("provider/anchor");
  });

  it("allows manual visibility above router lane caps while keeping routing bounded", () => {
    const model = {
      modelId: "provider/premium",
      inputCostPerM: 55,
      outputCostPerM: 70,
    };

    expect(isModelTooExpensivePerMillion(model, { lane: "deep_reasoning" })).toBe(true);
    expect(isModelAllowedInTier(model, "normal", { allowManualOverride: true })).toBe(true);
  });

  it("infers routing lanes from modality and search needs", () => {
    expect(inferRoutingLane({ mode: "research", needsSearch: true })).toBe("search_reasoning");
    expect(inferRoutingLane({ requiredCapabilities: ["vision"] })).toBe("vision");
    expect(inferRoutingLane({ mode: "general", preferFast: true })).toBe("fast_chat");
  });
});
