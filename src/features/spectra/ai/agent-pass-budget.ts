export type SpectraAgentPassMode =
  | "initial"
  | "repair"
  | "fallback"
  | "encouragement";

export type SpectraAgentBudget = {
  maxTurns?: number;
  maxToolCalls?: number;
  maxElapsedMs?: number;
  maxTotalTokens?: number;
};

const RECOVERY_BUDGET = {
  maxTurns: 8,
  maxToolCalls: 16,
  maxElapsedMs: 90_000,
} as const;

/**
 * Keep repair passes useful without letting a malformed plan restart a full
 * length agent run. Initial work and provider fallback keep the configured
 * budget so deeper requests retain their normal reasoning headroom.
 */
export function budgetForAgentPass(
  mode: SpectraAgentPassMode,
  configured?: SpectraAgentBudget,
): SpectraAgentBudget | undefined {
  if (mode !== "repair" && mode !== "encouragement") return configured;

  return {
    maxTurns: Math.min(configured?.maxTurns ?? 24, RECOVERY_BUDGET.maxTurns),
    maxToolCalls: Math.min(
      configured?.maxToolCalls ?? 60,
      RECOVERY_BUDGET.maxToolCalls,
    ),
    maxElapsedMs: Math.min(
      configured?.maxElapsedMs ?? 4 * 60_000,
      RECOVERY_BUDGET.maxElapsedMs,
    ),
    ...(configured?.maxTotalTokens === undefined
      ? {}
      : { maxTotalTokens: configured.maxTotalTokens }),
  };
}
