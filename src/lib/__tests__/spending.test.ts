import { describe, expect, it } from "vitest";
import { effectiveUsageCostCents, estimateUsageCostCents, summarizeEffectiveUsageCost } from "../../../shared/spending";

describe("summarizeEffectiveUsageCost", () => {
  it("preserves known costs and adds estimated cost for unpriced events", () => {
    const summary = summarizeEffectiveUsageCost([
      {
        inputTokens: 100_000,
        outputTokens: 50_000,
        totalTokens: 150_000,
        costCents: 12.5,
      },
      {
        inputTokens: 200_000,
        outputTokens: 100_000,
        totalTokens: 300_000,
        costCents: 0,
      },
    ]);

    expect(summary.knownCostCents).toBe(12.5);
    expect(summary.monthlyUnpricedEvents).toBe(1);
    expect(summary.estimatedUnpricedCostCents).toBeCloseTo(50, 5);
    expect(summary.effectiveCostCents).toBeCloseTo(62.5, 5);
  });

  it("uses known pricing when provided", () => {
    expect(
      estimateUsageCostCents(
        {
          inputTokens: 400_000,
          outputTokens: 100_000,
          totalTokens: 500_000,
        },
        {
          inputCostPerM: 0.5,
          outputCostPerM: 1.5,
        },
      ),
    ).toBeCloseTo(35, 5);
  });

  it("prefers recorded event cost when present", () => {
    expect(
      effectiveUsageCostCents(
        {
          inputTokens: 400_000,
          outputTokens: 100_000,
          totalTokens: 500_000,
          costCents: 12.75,
        },
        {
          inputCostPerM: 0.5,
          outputCostPerM: 1.5,
        },
      ),
    ).toBe(12.75);
  });
});
