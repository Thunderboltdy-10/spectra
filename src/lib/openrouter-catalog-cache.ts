import { fetchOpenRouterModels } from "@/lib/openrouter";
import type { CatalogModelEntry } from "@/lib/model-selection";

const CACHE_TTL_MS = 30 * 60 * 1000;

declare global {
  var __openRouterCatalogCache:
    | {
        cachedAt: number;
        models: CatalogModelEntry[];
      }
    | undefined;
}

function parsePrice(value?: string | number) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "");
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
  created?: number;
  context_length?: number;
  supported_parameters?: unknown;
  pricing?: Record<string, string | number | undefined>;
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
  top_provider?: { name?: string };
}): CatalogModelEntry {
  const promptCost = parsePrice(model.pricing?.prompt);
  const completionCost = parsePrice(model.pricing?.completion);
  const cacheReadCost =
    parsePrice(model.pricing?.cache_read)
    ?? parsePrice(model.pricing?.prompt_cache_read)
    ?? parsePrice(model.pricing?.input_cache_read);
  const cacheWriteCost =
    parsePrice(model.pricing?.cache_write)
    ?? parsePrice(model.pricing?.prompt_cache_write)
    ?? parsePrice(model.pricing?.input_cache_write);
  const inputModalities = Array.isArray(model.architecture?.input_modalities)
    ? model.architecture?.input_modalities.map((item) => item.toLowerCase())
    : [];
  const outputModalities = Array.isArray(model.architecture?.output_modalities)
    ? model.architecture?.output_modalities.map((item) => item.toLowerCase())
    : [];
  const modality = (model.architecture?.modality ?? "").toLowerCase();
  const modalityBlob = `${modality} ${inputModalities.join(" ")} ${outputModalities.join(" ")}`;
  const isVision = modalityBlob.includes("image") || modalityBlob.includes("multimodal") || modalityBlob.includes("vision");
  const isImageGeneration = /image[-_ ]?gen|text[-_ ]to[-_ ]image|image generation|diffusion/.test(
    `${model.id} ${model.name ?? ""}`.toLowerCase(),
  );
  const isFast = /flash|mini|haiku|lite|turbo/i.test(model.id);
  const isReasoning = /reason|o3|o4|r1|deepseek|gemini-2\.5|claude/i.test(model.id);
  const isCode = /code|coder|codestral|program/i.test(model.id);
  const supportedParameters = Array.isArray(model.supported_parameters)
    ? model.supported_parameters
        .map((item) => {
          if (typeof item === "string") return item.trim().toLowerCase().replace(/\s+/g, "_");
          if (item && typeof item === "object") {
            const row = item as { name?: string; key?: string };
            return (row.name ?? row.key ?? "").trim().toLowerCase().replace(/\s+/g, "_");
          }
          return "";
        })
        .filter(Boolean)
    : [];
  const isSearch =
    supportedParameters.includes("web_search_options")
    || supportedParameters.some((item) => item.includes("search"))
    || /search|sonar|perplexity|web/i.test(model.id);

  const inCost = promptCost ?? 5;
  const outCost = completionCost ?? 5;
  const blendedCost = inCost + outCost;

  return {
    modelId: model.id,
    name: model.name || model.id,
    provider: model.id.split("/")[0] || model.top_provider?.name || "Unknown",
    description: model.description || "",
    contextLength: model.context_length,
    releaseDate: typeof model.created === "number" ? new Date(model.created * 1000).toISOString() : undefined,
    createdAt: typeof model.created === "number" ? model.created * 1000 : undefined,
    inputCostPerM: promptCost,
    outputCostPerM: completionCost,
    supportedParameters,
    promptCachingSupported:
      model.id.toLowerCase().startsWith("anthropic/")
      || supportedParameters.some((item) => item.includes("cache"))
      || typeof cacheReadCost === "number"
      || typeof cacheWriteCost === "number",
    cachePricingReadPerM: cacheReadCost,
    cachePricingWritePerM: cacheWriteCost,
    inputModalities,
    outputModalities,
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
      .filter((model) => Boolean(model.modelId));

    const dedupedById = new Map<string, CatalogModelEntry>();
    for (const model of mapped) {
      const existing = dedupedById.get(model.modelId);
      if (!existing) {
        dedupedById.set(model.modelId, model);
        continue;
      }
      const existingCreated = existing.createdAt ?? 0;
      const nextCreated = model.createdAt ?? 0;
      if (nextCreated >= existingCreated) {
        dedupedById.set(model.modelId, {
          ...existing,
          ...model,
          tags: [...new Set([...(existing.tags ?? []), ...(model.tags ?? [])])],
        });
      }
    }

    const ranked = [...dedupedById.values()].sort((a, b) => {
      const createdDelta = (b.createdAt ?? 0) - (a.createdAt ?? 0);
      if (createdDelta !== 0) return createdDelta;
      const aCost = (a.inputCostPerM ?? 999) + (a.outputCostPerM ?? 999);
      const bCost = (b.inputCostPerM ?? 999) + (b.outputCostPerM ?? 999);
      if (aCost !== bCost) return aCost - bCost;
      return a.modelId.localeCompare(b.modelId);
    });
    const selected = ranked.slice(0, 260);

    if (selected.length > 0) {
      globalThis.__openRouterCatalogCache = {
        cachedAt: now,
        models: selected,
      };
      return {
        models: selected,
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
