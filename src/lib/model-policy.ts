export const MAX_MODEL_COST_PER_MILLION = 5;
export const CHEAP_MODEL_COST_PER_MILLION = 3;

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
