import { fetchOpenRouterModels } from "@/lib/openrouter";
import type { CatalogModelEntry } from "@/lib/model-selection";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

declare global {
  var __openRouterCatalogCache:
    | {
        cachedAt: number;
        models: CatalogModelEntry[];
      }
    | undefined;
}

function parsePrice(value?: string) {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed * 1_000_000;
}

function toRating(value: number, thresholds: [number, number]) {
  if (value <= thresholds[0]) return "low" as const;
  if (value <= thresholds[1]) return "medium" as const;
  return "high" as const;
}

function mapLiveModel(model: {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string };
  top_provider?: { name?: string };
}): CatalogModelEntry {
  const promptCost = parsePrice(model.pricing?.prompt);
  const completionCost = parsePrice(model.pricing?.completion);
  const modality = (model.architecture?.modality ?? "").toLowerCase();
  const isVision = modality.includes("image") || modality.includes("multimodal");
  const isImageGeneration = /image[-_ ]?gen|text[-_ ]to[-_ ]image|image generation|diffusion/.test(
    `${model.id} ${model.name ?? ""}`.toLowerCase(),
  );
  const isFast = /flash|mini|haiku|lite|turbo/i.test(model.id);
  const isReasoning = /reason|o3|o4|r1|deepseek|gemini-2\.5|claude/i.test(model.id);
  const isCode = /code|coder|codestral|program/i.test(model.id);
  const isSearch = /search|sonar|perplexity|web/i.test(model.id);

  const inCost = promptCost ?? 5;
  const outCost = completionCost ?? 5;
  const blendedCost = inCost + outCost;

  return {
    modelId: model.id,
    name: model.name || model.id,
    provider: model.top_provider?.name || model.id.split("/")[0] || "Unknown",
    description: model.description || "",
    contextLength: model.context_length,
    inputCostPerM: promptCost,
    outputCostPerM: completionCost,
    isFree: model.id.includes(":free") || (inCost === 0 && outCost === 0),
    costRating: toRating(blendedCost, [0.2, 6]),
    speedRating: isFast ? "high" : "medium",
    reasoningRating: isReasoning ? "high" : "medium",
    multimodalRating: isVision ? "strong" : "none",
    tags: [
      ...(isVision ? ["vision"] : []),
      ...(isReasoning ? ["reasoning"] : []),
      ...(isCode ? ["code"] : []),
      ...(isSearch ? ["search"] : []),
      ...(isImageGeneration ? ["image_generation"] : []),
    ],
    capabilities: {
      reasoning: isReasoning ? 8 : 4,
      creative: /claude|gpt|gemini/i.test(model.id) ? 7 : 5,
      code: isCode ? 8 : 5,
      vision: isVision ? 7 : 0,
      speed: isFast ? 8 : 5,
    },
  };
}

export async function getLiveCatalogSnapshot(params?: {
  fallbackCatalog?: CatalogModelEntry[];
  forceRefresh?: boolean;
}) {
  const now = Date.now();
  if (
    !params?.forceRefresh
    && globalThis.__openRouterCatalogCache
    && now - globalThis.__openRouterCatalogCache.cachedAt < CACHE_TTL_MS
    && globalThis.__openRouterCatalogCache.models.length > 0
  ) {
    return {
      models: globalThis.__openRouterCatalogCache.models,
      source: "openrouter_cache" as const,
    };
  }

  try {
    const liveModels = await fetchOpenRouterModels();
    const mapped = liveModels
      .map((model) => mapLiveModel(model))
      .filter((model) => Boolean(model.modelId))
      .slice(0, 220);

    if (mapped.length > 0) {
      globalThis.__openRouterCatalogCache = {
        cachedAt: now,
        models: mapped,
      };
      return {
        models: mapped,
        source: "openrouter_live" as const,
      };
    }
  } catch {
    // Fall through to DB fallback.
  }

  return {
    models: params?.fallbackCatalog ?? [],
    source: "db_fallback" as const,
  };
}
