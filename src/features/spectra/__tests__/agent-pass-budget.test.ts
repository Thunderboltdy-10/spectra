import { describe, expect, it } from "vitest";
import { budgetForAgentPass } from "../ai/agent-pass-budget";

describe("budgetForAgentPass", () => {
  it("leaves initial and provider-fallback budgets unchanged", () => {
    const configured = {
      maxTurns: 30,
      maxToolCalls: 80,
      maxElapsedMs: 300_000,
      maxTotalTokens: 180_000,
    };

    expect(budgetForAgentPass("initial", configured)).toBe(configured);
    expect(budgetForAgentPass("fallback", configured)).toBe(configured);
    expect(budgetForAgentPass("initial")).toBeUndefined();
  });

  it("bounds recovery passes while preserving the configured token budget", () => {
    expect(
      budgetForAgentPass("repair", { maxTotalTokens: 180_000 }),
    ).toEqual({
      maxTurns: 8,
      maxToolCalls: 16,
      maxElapsedMs: 90_000,
      maxTotalTokens: 180_000,
    });
    expect(budgetForAgentPass("encouragement")).toEqual({
      maxTurns: 8,
      maxToolCalls: 16,
      maxElapsedMs: 90_000,
    });
  });

  it("never raises a stricter budget chosen for the agent", () => {
    expect(
      budgetForAgentPass("repair", {
        maxTurns: 5,
        maxToolCalls: 7,
        maxElapsedMs: 45_000,
        maxTotalTokens: 90_000,
      }),
    ).toEqual({
      maxTurns: 5,
      maxToolCalls: 7,
      maxElapsedMs: 45_000,
      maxTotalTokens: 90_000,
    });
  });
});
