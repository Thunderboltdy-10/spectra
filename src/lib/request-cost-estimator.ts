import type { CatalogModelEntry } from "@/lib/model-selection";

export type RequestPlanCostEstimate = {
  totalUsd: number;
  totalCents: number;
  thresholdUsd: number;
  requiresConfirmation: boolean;
  confidence: "high" | "medium" | "low";
  items: Array<{
    label: string;
    modelId?: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    confidence: "high" | "medium" | "low";
    notes?: string[];
  }>;
  warnings: string[];
};

const DEFAULT_UNKNOWN_INPUT_PER_M = 8;
const DEFAULT_UNKNOWN_OUTPUT_PER_M = 12;

function findModel(modelId: string | undefined, catalog: CatalogModelEntry[]) {
  if (!modelId) return undefined;
  const normalized = modelId.replace(/:free$/i, "");
  return catalog.find((model) =>
    model.modelId === modelId
    || model.modelId.replace(/:free$/i, "") === normalized,
  );
}

function priceFor(modelId: string | undefined, catalog: CatalogModelEntry[]) {
  const meta = findModel(modelId, catalog);
  const free = Boolean(meta?.isFree || modelId?.includes(":free"));
  if (free) return { inputPerM: 0, outputPerM: 0, confidence: "high" as const, notes: ["free model"] };
  const knownInput = typeof meta?.inputCostPerM === "number" && Number.isFinite(meta.inputCostPerM);
  const knownOutput = typeof meta?.outputCostPerM === "number" && Number.isFinite(meta.outputCostPerM);
  return {
    inputPerM: knownInput ? Math.max(0, meta.inputCostPerM as number) : DEFAULT_UNKNOWN_INPUT_PER_M,
    outputPerM: knownOutput ? Math.max(0, meta.outputCostPerM as number) : DEFAULT_UNKNOWN_OUTPUT_PER_M,
    confidence: knownInput && knownOutput ? "high" as const : meta ? "medium" as const : "low" as const,
    notes: knownInput && knownOutput ? [] : ["catalog pricing unknown; conservative estimate used"],
  };
}

function estimateItem(params: {
  label: string;
  modelId?: string;
  inputTokens: number;
  outputTokens: number;
  catalog: CatalogModelEntry[];
}) {
  const price = priceFor(params.modelId, params.catalog);
  const costUsd =
    (Math.max(0, params.inputTokens) / 1_000_000) * price.inputPerM
    + (Math.max(0, params.outputTokens) / 1_000_000) * price.outputPerM;
  return {
    label: params.label,
    modelId: params.modelId,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    costUsd: Number(costUsd.toFixed(6)),
    confidence: price.confidence,
    notes: price.notes,
  };
}

export function estimateRequestPlanCost(params: {
  catalog: CatalogModelEntry[];
  primaryModel: string;
  inputTokens: number;
  outputTokens: number;
  helperCalls?: Array<{ label: string; modelId?: string; inputTokens: number; outputTokens: number }>;
  searchCredits?: number;
  thresholdUsd?: number;
}): RequestPlanCostEstimate {
  const thresholdUsd = params.thresholdUsd ?? 10;
  const items = [
    estimateItem({
      label: "Final synthesis",
      modelId: params.primaryModel,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      catalog: params.catalog,
    }),
    ...(params.helperCalls ?? []).map((call) =>
      estimateItem({
        label: call.label,
        modelId: call.modelId,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        catalog: params.catalog,
      }),
    ),
  ];

  if (params.searchCredits && params.searchCredits > 0) {
    items.push({
      label: "Search/tools",
      modelId: undefined,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      confidence: "medium",
      notes: [`${params.searchCredits} estimated search credit(s); provider billing may differ.`],
    });
  }

  const totalUsd = Number(items.reduce((sum, item) => sum + (item.costUsd ?? 0), 0).toFixed(6));
  const warnings = items.flatMap((item) => item.notes ?? []);
  const confidence = items.some((item) => item.confidence === "low")
    ? "low"
    : items.some((item) => item.confidence === "medium")
      ? "medium"
      : "high";

  return {
    totalUsd,
    totalCents: Number((totalUsd * 100).toFixed(4)),
    thresholdUsd,
    requiresConfirmation: totalUsd > thresholdUsd,
    confidence,
    items,
    warnings,
  };
}
