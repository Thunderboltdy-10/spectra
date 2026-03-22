import { describe, expect, it } from "vitest";
import { PipelineController } from "@/lib/orchestrator/pipeline-controller";

describe("PipelineController", () => {
  it("enforces T0 cost gates for search, RAG, and multi-agent", () => {
    const controller = new PipelineController({
      requestClass: "T0",
      classificationReason: "short follow-up",
    });

    const gated = controller.applyCostGates({
      allowSearch: true,
      allowRag: true,
      allowMultiAgent: true,
      spendingTier: "normal",
      forceMultiAgentRequested: false,
      orchestratorEnabled: true,
      budgetSoftLimited: false,
    });

    expect(gated.searchEnabled).toBe(false);
    expect(gated.ragEnabled).toBe(false);
    expect(gated.multiAgentEnabled).toBe(false);
    expect(gated.skippedStages.some((row) => row.step === "webSearch")).toBe(true);
    expect(gated.skippedStages.some((row) => row.step === "ragRetrieval")).toBe(true);
    expect(gated.skippedStages.some((row) => row.step === "multiAgent")).toBe(true);
  });

  it("denies forced multi-agent in cheap_only tier", () => {
    const controller = new PipelineController({
      requestClass: "T2",
      classificationReason: "research request",
    });

    const gated = controller.applyCostGates({
      allowSearch: true,
      allowRag: true,
      allowMultiAgent: true,
      spendingTier: "cheap_only",
      forceMultiAgentRequested: true,
      orchestratorEnabled: true,
      budgetSoftLimited: false,
    });

    expect(gated.forceMultiAgentAllowed).toBe(false);
    expect(gated.forceDeniedReasons.some((reason) => reason.includes("cheap_only"))).toBe(true);
  });

  it("allows forced multi-agent in normal tier when request class is T2+", () => {
    const controller = new PipelineController({
      requestClass: "T3",
      classificationReason: "complex orchestrated request",
    });

    const gated = controller.applyCostGates({
      allowSearch: true,
      allowRag: true,
      allowMultiAgent: true,
      spendingTier: "normal",
      forceMultiAgentRequested: true,
      orchestratorEnabled: true,
      budgetSoftLimited: false,
    });

    expect(gated.forceMultiAgentAllowed).toBe(true);
    expect(gated.forceDeniedReasons).toHaveLength(0);
  });

  it("disables RAG retrieval in free_only tier to avoid embedding spend", () => {
    const controller = new PipelineController({
      requestClass: "T2",
      classificationReason: "resource-grounded request",
    });

    const gated = controller.applyCostGates({
      allowSearch: true,
      allowRag: true,
      allowMultiAgent: false,
      spendingTier: "free_only",
      forceMultiAgentRequested: false,
      orchestratorEnabled: true,
      budgetSoftLimited: false,
    });

    expect(gated.ragEnabled).toBe(false);
    expect(gated.skippedStages.some((row) => row.step === "ragRetrieval")).toBe(true);
  });
});
