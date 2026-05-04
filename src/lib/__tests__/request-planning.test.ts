import { describe, expect, it } from "vitest";
import { estimateRequestPlanCost } from "@/lib/request-cost-estimator";
import { buildProviderRequestCapabilityPlan, filterOpenRouterRequestParams } from "@/lib/provider-request-plan";
import type { CatalogModelEntry } from "@/lib/model-selection";

const catalog: CatalogModelEntry[] = [
  {
    modelId: "strong/fresh",
    inputCostPerM: 2,
    outputCostPerM: 4,
    supportedParameters: ["temperature", "tools", "tool_choice", "reasoning"],
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
  },
  {
    modelId: "text/no-tools",
    inputCostPerM: 1,
    outputCostPerM: 1,
    supportedParameters: ["temperature"],
    inputModalities: ["text"],
    outputModalities: ["text"],
  },
  {
    modelId: "premium/manual",
    inputCostPerM: 100,
    outputCostPerM: 100,
    supportedParameters: ["temperature"],
    inputModalities: ["text"],
    outputModalities: ["text"],
  },
];

describe("request cost estimator", () => {
  it("lets request plans at or below $10 proceed", () => {
    const estimate = estimateRequestPlanCost({
      catalog,
      primaryModel: "strong/fresh",
      inputTokens: 1_000,
      outputTokens: 1_000,
    });

    expect(estimate.totalUsd).toBeLessThanOrEqual(10);
    expect(estimate.requiresConfirmation).toBe(false);
  });

  it("requires confirmation for plans above $10", () => {
    const estimate = estimateRequestPlanCost({
      catalog,
      primaryModel: "premium/manual",
      inputTokens: 60_000,
      outputTokens: 60_000,
    });

    expect(estimate.totalUsd).toBeGreaterThan(10);
    expect(estimate.requiresConfirmation).toBe(true);
  });
});

describe("provider request capability plan", () => {
  it("omits unsupported tools, tool_choice, and reasoning params", () => {
    const plan = buildProviderRequestCapabilityPlan({
      modelId: "text/no-tools",
      modelCatalog: catalog,
      messages: [{ role: "user", content: "search for this" }],
      tools: [{ type: "function", function: { name: "search_web" } }],
      toolChoice: "auto",
      reasoningEffort: "high",
    });
    const filtered = filterOpenRouterRequestParams({
      tools: [{ type: "function" as const, function: { name: "search_web" } }],
      toolChoice: "auto" as const,
      reasoningEffort: "high" as const,
    }, plan);

    expect(plan.nativeTools).toBe(false);
    expect(plan.omittedParameters).toContain("tools");
    expect(filtered.tools).toBeUndefined();
    expect(filtered.toolChoice).toBeUndefined();
    expect(filtered.reasoningEffort).toBeUndefined();
  });

  it("detects text-only image mismatch for prepass injection", () => {
    const plan = buildProviderRequestCapabilityPlan({
      modelId: "text/no-tools",
      modelCatalog: catalog,
      messages: [{
        role: "user",
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } }],
      }],
    });

    expect(plan.nativeVision).toBe(false);
    expect(plan.omittedParameters).toContain("image_input");
  });
});
