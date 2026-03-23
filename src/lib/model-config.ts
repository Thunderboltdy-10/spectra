import type { CatalogModelEntry } from "@/lib/model-selection";
import {
  MODEL_ROLE_CRITERIA,
  averageModelCost,
  modelSupportsCapabilityLite,
  scoreModelForRole,
  type ModelRole,
} from "@/lib/model-roles";

const MODEL_ROLE_CACHE_TTL_MS = 30 * 60 * 1000;

declare global {
  var __modelRoleResolutionCache:
    | Record<string, { modelId: string; fingerprint: string; expiresAt: number }>
    | undefined;
}

export const MODEL_CONFIG = {
  utilityFree: "stepfun/step-3.5-flash:free",
  tutorFast: "stepfun/step-3.5-flash:free",
  tutorHigh: "minimax/minimax-m2.5:free",
  marker: "qwen/qwen3-next-80b-a3b-instruct:free",
  markerHard: "nvidia/nemotron-3-super-120b-a12b:free",
  multimodal: "google/gemma-3-27b-vision:free",
  verify: "openai/gpt-5.4-mini",
  autoRouter: "openrouter/auto",
  embedding: "openai/text-embedding-3-large",
  promptEnhance: "stepfun/step-3.5-flash:free",
  glmAir: "z-ai/glm-4.5-air:free",
  gptOss: "openai/gpt-oss-120b:free",

  // Paid tier for normal spending.
  smartPaid: "anthropic/claude-sonnet-4.5",
  smartCheap: "openai/gpt-5.4-nano",
  reasoningPaid: "openai/gpt-5.4-mini",

  // Search-focused routes.
  searchFast: "perplexity/sonar",
  searchDeep: "perplexity/sonar-pro",

  // Image generation.
  imageGen: "google/gemini-3.1-flash-image-preview",
} as const;

const ROLE_FALLBACK_MODEL: Record<ModelRole, string> = {
  utilityFree: MODEL_CONFIG.utilityFree,
  tutorFast: MODEL_CONFIG.tutorFast,
  tutorHigh: MODEL_CONFIG.tutorHigh,
  reasoningFree: MODEL_CONFIG.marker,
  reasoningPaid: MODEL_CONFIG.reasoningPaid,
  codeFree: MODEL_CONFIG.gptOss,
  searchFast: MODEL_CONFIG.searchFast,
  embedding: MODEL_CONFIG.embedding,
  imageGen: MODEL_CONFIG.imageGen,
};

function roleCache() {
  if (!globalThis.__modelRoleResolutionCache) {
    globalThis.__modelRoleResolutionCache = {};
  }
  return globalThis.__modelRoleResolutionCache;
}

function catalogFingerprint(catalog: CatalogModelEntry[]) {
  const head = catalog
    .slice(0, 40)
    .map((model) => `${model.modelId}:${Math.round(model.endpointUptimePercent ?? 0)}:${Math.round(averageModelCost(model) * 100)}`)
    .join("|");
  return `${catalog.length}:${head}`;
}

function embeddingCandidateScore(model: CatalogModelEntry) {
  const blob = `${model.modelId} ${model.name ?? ""} ${model.description ?? ""}`.toLowerCase();
  if (!/embedding/.test(blob)) return -Infinity;
  const cost = averageModelCost(model);
  return (cost <= 1 ? 1 : cost <= 5 ? 0.7 : 0.3) + ((model.endpointUptimePercent ?? 84) / 100) * 0.2;
}

function imageCandidateScore(model: CatalogModelEntry) {
  const blob = `${model.modelId} ${model.name ?? ""} ${(model.tags ?? []).join(" ")}`.toLowerCase();
  if (!modelSupportsCapabilityLite(model, "image_generation") && !/image/.test(blob)) return -Infinity;
  const uptime = (model.endpointUptimePercent ?? 80) / 100;
  return uptime + (model.modelId.includes("flash") ? 0.08 : 0);
}

export function resolveModelForRole(role: ModelRole, catalog: CatalogModelEntry[]): string {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return ROLE_FALLBACK_MODEL[role];
  }

  const fingerprint = catalogFingerprint(catalog);
  const cacheKey = role;
  const now = Date.now();
  const cached = roleCache()[cacheKey];
  if (cached && cached.fingerprint === fingerprint && cached.expiresAt > now && cached.modelId) {
    return cached.modelId;
  }

  const criteria = MODEL_ROLE_CRITERIA[role];
  const sorted = [...catalog].sort((a, b) => a.modelId.localeCompare(b.modelId));
  let selected: CatalogModelEntry | undefined;
  let bestScore = -Infinity;

  for (const model of sorted) {
    const score = role === "embedding"
      ? embeddingCandidateScore(model)
      : role === "imageGen"
        ? imageCandidateScore(model)
        : scoreModelForRole(model, criteria);

    if (!Number.isFinite(score) || score <= bestScore) continue;
    bestScore = score;
    selected = model;
  }

  const modelId = selected?.modelId ?? ROLE_FALLBACK_MODEL[role];
  roleCache()[cacheKey] = {
    modelId,
    fingerprint,
    expiresAt: now + MODEL_ROLE_CACHE_TTL_MS,
  };
  return modelId;
}

function capabilityClass(model: CatalogModelEntry) {
  return {
    reasoning: modelSupportsCapabilityLite(model, "reasoning"),
    code: modelSupportsCapabilityLite(model, "code"),
    vision: modelSupportsCapabilityLite(model, "vision"),
    search: modelSupportsCapabilityLite(model, "search"),
    image: modelSupportsCapabilityLite(model, "image_generation"),
  };
}

function compatibleCapabilityClass(primary: CatalogModelEntry, candidate: CatalogModelEntry) {
  const a = capabilityClass(primary);
  const b = capabilityClass(candidate);
  return (
    (a.reasoning && b.reasoning)
    || (a.code && b.code)
    || (a.vision && b.vision)
    || (a.search && b.search)
    || (a.image && b.image)
  );
}

export function buildRouterFallbacksFromCatalog(catalog: CatalogModelEntry[], primaryModels: string[]): Record<string, string[]> {
  const byId = new Map(catalog.map((model) => [model.modelId, model]));
  const out: Record<string, string[]> = {};

  for (const primary of primaryModels) {
    const primaryModel = byId.get(primary);
    if (!primaryModel) continue;
    const primaryCost = averageModelCost(primaryModel);

    const candidates = catalog
      .filter((model) => model.modelId !== primary)
      .filter((model) => compatibleCapabilityClass(primaryModel, model))
      .filter((model) => {
        const cost = averageModelCost(model);
        if (primaryCost <= 0.05) return cost <= 3.5;
        return cost <= Math.max(primaryCost * 1.6, 8);
      })
      .sort((a, b) => {
        const costDelta = averageModelCost(a) - averageModelCost(b);
        if (costDelta !== 0) return costDelta;
        const uptimeDelta = (b.endpointUptimePercent ?? 0) - (a.endpointUptimePercent ?? 0);
        if (uptimeDelta !== 0) return uptimeDelta;
        return a.modelId.localeCompare(b.modelId);
      })
      .map((model) => model.modelId)
      .slice(0, 4);

    out[primary] = candidates;
  }

  return out;
}

// Available image generation models
export const IMAGE_GEN_MODELS = [
  { id: "google/gemini-3.1-flash-image-preview", name: "Gemini 3.1 Flash Image", provider: "Google", recommended: true },
  { id: "google/gemini-3-pro-image-preview", name: "Gemini 3 Pro Image", provider: "Google", recommended: false },
  { id: "google/gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", provider: "Google", recommended: false },
] as const;

export const IMAGE_GEN_FALLBACKS = [
  "google/gemini-3.1-flash-image-preview",
  "google/gemini-3-pro-image-preview",
  "google/gemini-2.5-flash-image",
] as const;

export function getImageModelOptions() {
  return IMAGE_GEN_MODELS.map(m => ({ ...m, isFree: m.id.includes(":free") }));
}

export function getDefaultImageModel(): string {
  return IMAGE_GEN_MODELS[0].id;
}

export type ModelConfigKey = keyof typeof MODEL_CONFIG;
export type ModelId = (typeof MODEL_CONFIG)[ModelConfigKey];

// Deprecated: static ban lists introduce opaque routing bias.
// Keep export for backward compatibility in tests/callers, but leave empty.
export const MODEL_COST_BLOCK_LIST = new Set<string>();

export const ROUTER_FALLBACKS: Record<string, string[]> = {
  [MODEL_CONFIG.tutorFast]: [MODEL_CONFIG.marker, MODEL_CONFIG.gptOss],
  [MODEL_CONFIG.tutorHigh]: [MODEL_CONFIG.marker, MODEL_CONFIG.tutorFast],
  [MODEL_CONFIG.marker]: [MODEL_CONFIG.tutorFast, MODEL_CONFIG.gptOss],
  [MODEL_CONFIG.multimodal]: [MODEL_CONFIG.tutorFast, MODEL_CONFIG.marker],
  [MODEL_CONFIG.autoRouter]: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.tutorHigh,
    MODEL_CONFIG.gptOss,
    MODEL_CONFIG.marker,
    MODEL_CONFIG.smartCheap,
  ],
  [MODEL_CONFIG.glmAir]: [MODEL_CONFIG.tutorFast, MODEL_CONFIG.marker],
  [MODEL_CONFIG.gptOss]: [MODEL_CONFIG.tutorHigh, MODEL_CONFIG.marker],

  [MODEL_CONFIG.smartPaid]: [MODEL_CONFIG.smartCheap, MODEL_CONFIG.tutorFast],
  [MODEL_CONFIG.smartCheap]: [MODEL_CONFIG.tutorFast, MODEL_CONFIG.marker],
  [MODEL_CONFIG.reasoningPaid]: [MODEL_CONFIG.smartPaid, MODEL_CONFIG.tutorHigh],
  [MODEL_CONFIG.searchFast]: [MODEL_CONFIG.searchDeep, MODEL_CONFIG.tutorFast],
  [MODEL_CONFIG.searchDeep]: [MODEL_CONFIG.searchFast, MODEL_CONFIG.reasoningPaid],
};

export function getRouterFallbacks(catalog?: CatalogModelEntry[]) {
  if (!catalog || catalog.length === 0) return ROUTER_FALLBACKS;
  const dynamic = buildRouterFallbacksFromCatalog(catalog, Object.keys(ROUTER_FALLBACKS));
  const merged: Record<string, string[]> = {};
  for (const modelId of Object.keys(ROUTER_FALLBACKS)) {
    merged[modelId] = dynamic[modelId]?.length ? dynamic[modelId] : ROUTER_FALLBACKS[modelId];
  }
  return merged;
}

export const CHEAP_MODEL_DEFAULTS = new Set<string>([
  MODEL_CONFIG.utilityFree,
  MODEL_CONFIG.tutorFast,
  MODEL_CONFIG.marker,
  MODEL_CONFIG.glmAir,
  MODEL_CONFIG.smartCheap,
  MODEL_CONFIG.searchFast,
]);

// Mode-based model recommendations (model IDs to suggest for each mode)
export const MODE_MODEL_RECOMMENDATIONS: Record<string, string[]> = {
  tutor: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.tutorHigh,
    MODEL_CONFIG.smartCheap,
  ],
  marker: [
    MODEL_CONFIG.marker,
    MODEL_CONFIG.markerHard,
    MODEL_CONFIG.tutorFast,
  ],
  quiz: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.marker,
    MODEL_CONFIG.smartCheap,
  ],
  flashcard: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.marker,
    MODEL_CONFIG.smartCheap,
  ],
  research: [
    MODEL_CONFIG.reasoningPaid,
    MODEL_CONFIG.tutorHigh,
    MODEL_CONFIG.searchDeep,
  ],
  explain: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.smartCheap,
    MODEL_CONFIG.tutorHigh,
  ],
  exam: [
    MODEL_CONFIG.smartCheap,
    MODEL_CONFIG.marker,
    MODEL_CONFIG.tutorFast,
  ],
  draft_coach: [
    MODEL_CONFIG.smartPaid,
    MODEL_CONFIG.smartCheap,
    MODEL_CONFIG.tutorFast,
  ],
  image: [
    "google/gemini-3.1-flash-image-preview",
    "google/gemini-3-pro-image-preview",
    "google/gemini-2.5-flash-image",
  ],
  general: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.smartCheap,
    MODEL_CONFIG.marker,
  ],
  auto: [
    MODEL_CONFIG.tutorFast,
    MODEL_CONFIG.tutorHigh,
    MODEL_CONFIG.smartCheap,
  ],
};

// Get recommended models for a specific mode
export function getRecommendedModelsForMode(mode: string): string[] {
  return MODE_MODEL_RECOMMENDATIONS[mode] || MODE_MODEL_RECOMMENDATIONS.general;
}
