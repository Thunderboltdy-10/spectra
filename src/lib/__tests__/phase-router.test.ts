import { describe, expect, it } from "vitest";
import { selectModelForPhase } from "@/lib/routing/phase-router";
import type { CatalogModelEntry } from "@/lib/model-selection";

function baseCatalog(): CatalogModelEntry[] {
  return [
    {
      modelId: "alpha/model-a",
      provider: "alpha",
      name: "Model A",
      description: "general",
      inputCostPerM: 2,
      outputCostPerM: 2,
      promptCachingSupported: true,
      capabilities: { reasoning: 7, creative: 5, code: 6, vision: 0, speed: 7 },
      tags: ["reasoning"],
      speedRating: "high",
      reasoningRating: "high",
      costRating: "low",
      multimodalRating: "none",
    },
    {
      modelId: "beta/model-b",
      provider: "beta",
      name: "Model B",
      description: "general",
      inputCostPerM: 2,
      outputCostPerM: 2,
      capabilities: { reasoning: 7, creative: 5, code: 6, vision: 0, speed: 7 },
      tags: ["reasoning"],
      speedRating: "high",
      reasoningRating: "high",
      costRating: "low",
      multimodalRating: "none",
    },
    {
      modelId: "gamma/challenger",
      provider: "gamma",
      name: "Challenger",
      description: "new model",
      inputCostPerM: 1,
      outputCostPerM: 1,
      capabilities: { reasoning: 6, creative: 5, code: 5, vision: 0, speed: 8 },
      tags: ["reasoning"],
      speedRating: "high",
      reasoningRating: "medium",
      costRating: "low",
      multimodalRating: "none",
    },
    {
      modelId: "delta/expensive",
      provider: "delta",
      name: "Expensive",
      description: "premium",
      inputCostPerM: 45,
      outputCostPerM: 45,
      capabilities: { reasoning: 9, creative: 7, code: 7, vision: 0, speed: 6 },
      tags: ["reasoning"],
      speedRating: "medium",
      reasoningRating: "high",
      costRating: "high",
      multimodalRating: "none",
    },
  ];
}

describe("phase-router", () => {
  it("applies manual expensive override when confirmed", () => {
    const decision = selectModelForPhase({
      phaseId: "analysis",
      phaseLabel: "Primary response",
      mode: "general",
      routerMode: "manual",
      manualModel: "delta/expensive",
      manualModelConfirmedExpensive: true,
      spendingTier: "normal",
      thinkingLevel: "medium",
      stakes: "medium",
      messageLength: 120,
      modelCatalog: baseCatalog(),
      seedKey: "manual-expensive",
    });

    expect(decision.selectedModel).toBe("delta/expensive");
    expect(decision.reason.toLowerCase()).toContain("manual");
  });

  it("penalizes repeated recent models under auto routing", () => {
    const decision = selectModelForPhase({
      phaseId: "analysis",
      phaseLabel: "Primary response",
      mode: "general",
      routerMode: "auto",
      spendingTier: "normal",
      thinkingLevel: "low",
      stakes: "low",
      messageLength: 80,
      recentModels: ["alpha/model-a", "alpha/model-a", "alpha/model-a"],
      modelCatalog: baseCatalog().filter((model) => model.modelId !== "delta/expensive"),
      modelRuntimeStats: {
        "alpha/model-a": { successCount: 40, failureCount: 2, avgLatencyMs: 2200 },
        "beta/model-b": { successCount: 35, failureCount: 2, avgLatencyMs: 2300 },
      },
      seedKey: "recent-penalty",
    });

    expect(decision.selectedModel).toBe("beta/model-b");
  });

  it("skips diversity penalties when cache is warm", () => {
    const now = Date.now();
    const decision = selectModelForPhase({
      phaseId: "analysis",
      phaseLabel: "Primary response",
      mode: "general",
      routerMode: "auto",
      spendingTier: "normal",
      thinkingLevel: "low",
      stakes: "low",
      messageLength: 100,
      recentModels: ["alpha/model-a", "alpha/model-a", "alpha/model-a"],
      cacheWindow: {
        lastModel: "alpha/model-a",
        lastUsedAt: now - 30_000,
      },
      modelCatalog: baseCatalog().filter((model) => model.modelId !== "delta/expensive"),
      modelRuntimeStats: {
        "alpha/model-a": { successCount: 20, failureCount: 1, avgLatencyMs: 2000 },
        "beta/model-b": { successCount: 20, failureCount: 1, avgLatencyMs: 2000 },
      },
      seedKey: "warm-cache",
    });

    expect(decision.selectedModel).toBe("alpha/model-a");
    const alpha = decision.candidates.find((row) => row.modelId === "alpha/model-a");
    expect(alpha?.scoreBreakdown?.join(" ")).toContain("cache_warm_boost");
  });

  it("keeps challengers deprioritized on high-stakes routes", () => {
    const decision = selectModelForPhase({
      phaseId: "analysis",
      phaseLabel: "Primary response",
      mode: "research",
      routerMode: "auto",
      spendingTier: "normal",
      thinkingLevel: "high",
      stakes: "high",
      messageLength: 600,
      requestClass: "T2",
      modelCatalog: baseCatalog().filter((model) => model.modelId !== "delta/expensive"),
      modelRuntimeStats: {
        "alpha/model-a": { successCount: 50, failureCount: 2, avgLatencyMs: 2600 },
        "beta/model-b": { successCount: 40, failureCount: 3, avgLatencyMs: 2700 },
        "gamma/challenger": { successCount: 0, failureCount: 0, avgLatencyMs: 2400 },
      },
      seedKey: "challenger-high-stakes",
    });

    expect(decision.selectedModel).not.toBe("gamma/challenger");
    const challenger = decision.candidates.find((row) => row.modelId === "gamma/challenger");
    expect(challenger?.reason?.toLowerCase()).toContain("challenger");
  });

  it("applies recent-failure circuit breaker penalties", () => {
    const now = Date.now();
    const decision = selectModelForPhase({
      phaseId: "analysis",
      phaseLabel: "Primary response",
      mode: "general",
      routerMode: "auto",
      spendingTier: "normal",
      thinkingLevel: "medium",
      stakes: "medium",
      messageLength: 120,
      modelCatalog: baseCatalog().filter((model) => model.modelId !== "delta/expensive"),
      modelRuntimeStats: {
        "alpha/model-a": {
          successCount: 35,
          failureCount: 5,
          avgLatencyMs: 2200,
          consecutiveFailureCount: 3,
          lastFailureAt: now - 60_000,
        },
        "beta/model-b": { successCount: 35, failureCount: 2, avgLatencyMs: 2300 },
      },
      seedKey: "failure-circuit",
    });

    expect(decision.selectedModel).toBe("beta/model-b");
    const alpha = decision.candidates.find((row) => row.modelId === "alpha/model-a");
    expect(alpha?.scoreBreakdown?.join(" ")).toContain("recent_failure_circuit");
  });

  it("filters out stale and :online models from automatic routing", () => {
    const veryOld = new Date();
    veryOld.setDate(veryOld.getDate() - 220);
    const recent = new Date();
    recent.setDate(recent.getDate() - 20);
    const decision = selectModelForPhase({
      phaseId: "analysis",
      phaseLabel: "Primary response",
      mode: "general",
      routerMode: "auto",
      spendingTier: "normal",
      thinkingLevel: "medium",
      stakes: "medium",
      messageLength: 140,
      modelCatalog: [
        ...baseCatalog().filter((model) => model.modelId !== "delta/expensive"),
        {
          modelId: "omega/search-model:online",
          provider: "omega",
          name: "Search Model Online",
          inputCostPerM: 1,
          outputCostPerM: 1,
          releaseDate: recent.toISOString(),
          capabilities: { reasoning: 8, creative: 5, code: 4, vision: 0, speed: 6 },
        },
        {
          modelId: "zeta/old-model",
          provider: "zeta",
          name: "Old Model",
          inputCostPerM: 1,
          outputCostPerM: 1,
          releaseDate: veryOld.toISOString(),
          capabilities: { reasoning: 10, creative: 7, code: 7, vision: 0, speed: 7 },
        },
      ],
      seedKey: "freshness-filter",
    });

    expect(decision.selectedModel).not.toContain(":online");
    expect(decision.candidates.some((candidate) => candidate.modelId === "zeta/old-model")).toBe(false);
  });

  it("strongly prefers 1-3 week old models over older but otherwise similar choices", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 12);
    const older = new Date();
    older.setDate(older.getDate() - 82);
    const decision = selectModelForPhase({
      phaseId: "analysis",
      phaseLabel: "Primary response",
      mode: "general",
      routerMode: "auto",
      spendingTier: "normal",
      thinkingLevel: "medium",
      stakes: "medium",
      messageLength: 180,
      modelCatalog: [
        {
          ...baseCatalog()[0],
          modelId: "recent/model",
          releaseDate: recent.toISOString(),
        },
        {
          ...baseCatalog()[1],
          modelId: "older/model",
          releaseDate: older.toISOString(),
        },
      ],
      modelRuntimeStats: {
        "recent/model": { successCount: 20, failureCount: 1, avgLatencyMs: 2200 },
        "older/model": { successCount: 21, failureCount: 1, avgLatencyMs: 2200 },
      },
      seedKey: "recent-preference",
    });

    expect(decision.selectedModel).toBe("recent/model");
  });

  it("honors persisted challenger state from runtime evaluation", () => {
    const decision = selectModelForPhase({
      phaseId: "analysis",
      phaseLabel: "Primary response",
      mode: "general",
      routerMode: "auto",
      spendingTier: "normal",
      thinkingLevel: "medium",
      stakes: "medium",
      messageLength: 120,
      modelCatalog: baseCatalog().filter((model) => model.modelId !== "delta/expensive"),
      modelRuntimeStats: {
        "alpha/model-a": {
          successCount: 40,
          failureCount: 2,
          avgLatencyMs: 2200,
          challengerState: "normal",
        },
        "beta/model-b": {
          successCount: 45,
          failureCount: 3,
          avgLatencyMs: 2300,
          challengerState: "normal",
        },
        "gamma/challenger": {
          successCount: 20,
          failureCount: 16,
          avgLatencyMs: 2600,
          challengerState: "deprioritized",
          qualityScore: 0.21,
        },
      },
      seedKey: "persisted-challenger-state",
    });

    const challenger = decision.candidates.find((row) => row.modelId === "gamma/challenger");
    expect(challenger?.scoreBreakdown?.join(" ")).toContain("challenger_state deprioritized");
  });

  it("excludes speech-only models from text routing", () => {
    const decision = selectModelForPhase({
      phaseId: "analysis",
      phaseLabel: "Primary response",
      mode: "general",
      routerMode: "auto",
      spendingTier: "normal",
      thinkingLevel: "medium",
      stakes: "medium",
      messageLength: 120,
      modelCatalog: [
        ...baseCatalog().filter((model) => model.modelId !== "delta/expensive"),
        {
          modelId: "google/lyra-voice",
          provider: "google",
          name: "Google Lyra Voice",
          inputCostPerM: 1,
          outputCostPerM: 1,
          inputModalities: ["audio"],
          outputModalities: ["audio"],
          capabilities: { reasoning: 9, creative: 4, code: 1, vision: 0, speed: 9 },
        },
      ],
      seedKey: "exclude-speech",
    });

    expect(decision.selectedModel).not.toBe("google/lyra-voice");
    expect(decision.candidates.some((candidate) => candidate.modelId === "google/lyra-voice")).toBe(false);
  });

  it("prefers models that fit the desired context window on L4 routes", () => {
    const decision = selectModelForPhase({
      phaseId: "analysis",
      phaseLabel: "Primary response",
      mode: "research",
      routerMode: "auto",
      spendingTier: "normal",
      thinkingLevel: "high",
      stakes: "high",
      messageLength: 500,
      requestClass: "T3",
      assignmentLevel: "L4",
      estimatedInputTokens: 52_000,
      estimatedOutputTokens: 2_200,
      desiredContextTokens: 72_000,
      preferLargeContext: true,
      modelCatalog: [
        {
          ...baseCatalog()[0],
          modelId: "alpha/short-context",
          contextLength: 32_000,
        },
        {
          ...baseCatalog()[1],
          modelId: "beta/long-context",
          contextLength: 128_000,
        },
      ],
      modelRuntimeStats: {
        "alpha/short-context": { successCount: 30, failureCount: 1, avgLatencyMs: 2200 },
        "beta/long-context": { successCount: 28, failureCount: 1, avgLatencyMs: 2400 },
      },
      seedKey: "l4-context-fit",
    });

    expect(decision.selectedModel).toBe("beta/long-context");
    expect(decision.candidates.some((row) => row.modelId === "alpha/short-context")).toBe(false);
  });
});
