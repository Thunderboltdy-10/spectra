export const MAX_MODEL_COST_PER_MILLION = 8;
export const CHEAP_MODEL_COST_PER_MILLION = 3;

export type RoutingLane =
  | "utility"
  | "fast_chat"
  | "deep_reasoning"
  | "vision"
  | "image_gen"
  | "search_reasoning"
  | "agent_subtask"
  | "verification";

export const DEFAULT_MANUAL_MODEL_COST_CAP_PER_MILLION = 10;

export const ROUTING_LANE_COST_CAPS: Record<RoutingLane, number> = {
  utility: 6,
  fast_chat: 10,
  deep_reasoning: 10,
  vision: 25,
  image_gen: 40,
  search_reasoning: 10,
  agent_subtask: 10,
  verification: 10,
};

export type CostModel = {
  inputCostPerM?: number;
  outputCostPerM?: number;
};

function safeCost(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

export function maxKnownCostPerMillion(model: CostModel) {
  const input = safeCost(model.inputCostPerM);
  const output = safeCost(model.outputCostPerM);
  if (typeof input !== 'number' && typeof output !== 'number') return undefined;
  return Math.max(input ?? 0, output ?? 0);
}

export function isWithinCostCap(model: CostModel, cap: number) {
  const maxCost = maxKnownCostPerMillion(model);
  if (typeof maxCost !== 'number') return false;
  return maxCost <= cap;
}
