export type UsageCostRow = {
  model?: string;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  costCents?: number;
};

export type UsagePricing = {
  inputCostPerM?: number;
  outputCostPerM?: number;
  isFree?: boolean;
};

export const UNPRICED_CENTS_PER_M_IN = 100;
export const UNPRICED_CENTS_PER_M_OUT = 300;

function normalizedTokenSplit(row: UsageCostRow) {
  const totalTokens = Math.max(0, row.totalTokens ?? 0);
  const inputTokens = Math.max(0, row.inputTokens ?? Math.round(totalTokens * 0.4));
  const outputTokens = Math.max(0, row.outputTokens ?? Math.max(0, totalTokens - inputTokens));
  return {
    totalTokens,
    inputTokens,
    outputTokens,
  };
}

export function estimateUsageCostCents(row: UsageCostRow, pricing?: UsagePricing) {
  const { totalTokens, inputTokens, outputTokens } = normalizedTokenSplit(row);
  if (totalTokens <= 0) return 0;
  if (pricing?.isFree) return 0;

  const hasKnownPricing =
    (typeof pricing?.inputCostPerM === "number" && Number.isFinite(pricing.inputCostPerM))
    || (typeof pricing?.outputCostPerM === "number" && Number.isFinite(pricing.outputCostPerM));

  const inputCostPerM = hasKnownPricing
    ? Math.max(0, pricing?.inputCostPerM ?? 0)
    : UNPRICED_CENTS_PER_M_IN / 100;
  const outputCostPerM = hasKnownPricing
    ? Math.max(0, pricing?.outputCostPerM ?? 0)
    : UNPRICED_CENTS_PER_M_OUT / 100;

  return Number(
    (
      ((inputTokens / 1_000_000) * inputCostPerM * 100) +
      ((outputTokens / 1_000_000) * outputCostPerM * 100)
    ).toFixed(6),
  );
}

export function effectiveUsageCostCents(row: UsageCostRow, pricing?: UsagePricing) {
  const knownCostCents = Math.max(0, row.costCents ?? 0);
  if (knownCostCents > 0) return knownCostCents;
  return estimateUsageCostCents(row, pricing);
}

export function summarizeEffectiveUsageCost(rows: UsageCostRow[]) {
  const knownCostCents = Number(
    rows
      .reduce((sum, row) => sum + Math.max(0, row.costCents ?? 0), 0)
      .toFixed(6),
  );

  const monthlyUnpricedEvents = rows.reduce(
    (sum, row) => sum + (Math.max(0, row.totalTokens ?? 0) > 0 && Math.max(0, row.costCents ?? 0) <= 0 ? 1 : 0),
    0,
  );

  const estimatedUnpricedCostCents = rows
    .filter((row) => Math.max(0, row.costCents ?? 0) <= 0 && Math.max(0, row.totalTokens ?? 0) > 0)
    .reduce((sum, row) => sum + estimateUsageCostCents(row), 0);

  return {
    knownCostCents,
    monthlyUnpricedEvents,
    estimatedUnpricedCostCents,
    effectiveCostCents: knownCostCents + estimatedUnpricedCostCents,
  };
}
