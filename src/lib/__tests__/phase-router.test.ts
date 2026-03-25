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
});
