export const MODEL_MEMORY_PROPOSAL_MAX_COUNT = 3;
export const MODEL_MEMORY_PROPOSITION_MAX_CHARACTERS = 600;
export const MODEL_MEMORY_REASON_MAX_CHARACTERS = 240;

export const MODEL_MEMORY_CLAIM_TYPES = [
  "correction",
  "recurring_workflow",
  "mistake_avoidance",
] as const;

export type ModelMemoryClaimType = (typeof MODEL_MEMORY_CLAIM_TYPES)[number];

export type ModelMemoryProposal = {
  claimType: ModelMemoryClaimType;
  proposition: string;
  reason: string;
};

export function isModelMemoryClaimType(
  value: string,
): value is ModelMemoryClaimType {
  return MODEL_MEMORY_CLAIM_TYPES.includes(value as ModelMemoryClaimType);
}

export function normalizeModelMemoryProposal(
  value: ModelMemoryProposal,
): ModelMemoryProposal {
  return {
    claimType: value.claimType,
    proposition: value.proposition.replace(/\s+/g, " ").trim(),
    reason: value.reason.replace(/\s+/g, " ").trim(),
  };
}
