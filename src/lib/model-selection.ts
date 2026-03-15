import type { SpendingTier, StudyMode } from "@/types";
import { CHEAP_MODEL_COST_PER_MILLION, MAX_MODEL_COST_PER_MILLION } from "@/lib/model-policy";

export type CatalogModelEntry = {
  modelId: string;
  name?: string;
  provider?: string;
  description?: string;
  contextLength?: number;
  releaseDate?: string;
  createdAt?: number;
  inputCostPerM?: number;
  outputCostPerM?: number;
  tags?: string[];
  isFree?: boolean;
  costRating?: "low" | "medium" | "high";
  speedRating?: "low" | "medium" | "high";
  reasoningRating?: "low" | "medium" | "high";
  multimodalRating?: "none" | "basic" | "strong";
  capabilities?: {
    reasoning?: number;
    creative?: number;
    code?: number;
    vision?: number;
    speed?: number;
  };
};

export type ModelRuntimeStat = {
  modelId?: string;
  successCount: number;
  failureCount: number;
  avgLatencyMs?: number;
};

export type ModelCapability =
  | "vision"
  | "reasoning"
  | "code"
  | "search"
  | "image_generation";

type RankParams = {
  catalog: CatalogModelEntry[];
  tier: SpendingTier;
  mode?: StudyMode | string;
  messageLength?: number;
  needsSearch?: boolean;
  preferFast?: boolean;
  preferCheap?: boolean;
  requiredCapabilities?: ModelCapability[];
  preferredCapabilities?: ModelCapability[];
  avoidModels?: string[];
  preferredModelIds?: string[];
  runtimeStats?: Record<string, ModelRuntimeStat>;
};

type RankedModel = {
  model: CatalogModelEntry;
  score: number;
  reasons: string[];
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function ratingScore(value: "low" | "medium" | "high" | undefined) {
  if (value === "high") return 1;
  if (value === "medium") return 0.55;
  if (value === "low") return 0.2;
  return 0.5;
}

function tagsLower(model: CatalogModelEntry) {
  return new Set((model.tags ?? []).map((tag) => tag.toLowerCase()));
}

function textBlob(model: CatalogModelEntry) {
  return `${model.modelId} ${model.name ?? ""} ${model.description ?? ""} ${(model.tags ?? []).join(" ")}`.toLowerCase();
}

function numericCapability(model: CatalogModelEntry, key: keyof NonNullable<CatalogModelEntry["capabilities"]>) {
  const raw = model.capabilities?.[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return clamp01(raw / 10);
  return undefined;
}

export function isOpenRouterAutoModel(modelId: string) {
  return modelId === "openrouter/auto";
}

export function modelSupportsCapability(model: CatalogModelEntry, capability: ModelCapability) {
  const tags = tagsLower(model);
  const blob = textBlob(model);

  if (capability === "vision") {
    const vision = numericCapability(model, "vision");
    if (typeof vision === "number") return vision >= 0.35;
    if (model.multimodalRating === "strong" || model.multimodalRating === "basic") return true;
    return tags.has("vision") || tags.has("multimodal") || /\b(vision|image|multimodal)\b/.test(blob);
  }

  if (capability === "reasoning") {
    const reasoning = numericCapability(model, "reasoning");
    if (typeof reasoning === "number") return reasoning >= 0.45;
    return model.reasoningRating === "high" || tags.has("reasoning") || /\b(reason|reasoning|math|logic)\b/.test(blob);
  }

  if (capability === "code") {
    const code = numericCapability(model, "code");
    if (typeof code === "number") return code >= 0.45;
    return /\b(code|coder|coding|programming|dev)\b/.test(blob);
  }

  if (capability === "search") {
    return /\b(search|web|retrieval|sonar)\b/.test(blob) || tags.has("search") || tags.has("web");
  }

  return /\b(image generation|image-gen|text-to-image|diffusion)\b/.test(blob) || tags.has("image_generation") || tags.has("image-gen");
}

function effectiveInputCost(model: CatalogModelEntry) {
  if (typeof model.inputCostPerM === "number" && Number.isFinite(model.inputCostPerM)) {
    return Math.max(0, model.inputCostPerM);
  }
  if (model.isFree || model.modelId.includes(":free")) return 0;
  if (model.costRating === "low") return 1.2;
  if (model.costRating === "high") return 16;
  return 5;
}

function effectiveOutputCost(model: CatalogModelEntry) {
  if (typeof model.outputCostPerM === "number" && Number.isFinite(model.outputCostPerM)) {
    return Math.max(0, model.outputCostPerM);
  }
  if (model.isFree || model.modelId.includes(":free")) return 0;
  if (model.costRating === "low") return 1.8;
  if (model.costRating === "high") return 20;
  return 7;
}

function isImageGenerationModel(model: CatalogModelEntry) {
  return modelSupportsCapability(model, "image_generation");
}

export function isModelTooExpensivePerMillion(model: CatalogModelEntry) {
  if (isImageGenerationModel(model)) return false;
  const freeLike = Boolean(model.isFree || model.modelId.includes(":free"));
  if (freeLike) return false;
  const hasKnownInput = typeof model.inputCostPerM === "number" && Number.isFinite(model.inputCostPerM);
  const hasKnownOutput = typeof model.outputCostPerM === "number" && Number.isFinite(model.outputCostPerM);
  // Keep policy explicit: unknown-priced paid models are not eligible for runtime routing.
  if (!hasKnownInput || !hasKnownOutput) return true;
  return (
    Math.max(0, model.inputCostPerM as number) > MAX_MODEL_COST_PER_MILLION
    || Math.max(0, model.outputCostPerM as number) > MAX_MODEL_COST_PER_MILLION
  );
}

function costScore(model: CatalogModelEntry) {
  const inCost = effectiveInputCost(model);
  const outCost = effectiveOutputCost(model);
  const blended = Math.max(inCost, outCost);
  if (blended <= 0.05) return 1;
  if (blended <= CHEAP_MODEL_COST_PER_MILLION) return 0.78;
  if (blended <= 8) return 0.48;
  return 0.2;
}

export function isModelAllowedInTier(model: CatalogModelEntry, tier: SpendingTier) {
  if (isModelTooExpensivePerMillion(model)) {
    return false;
  }

  if (isOpenRouterAutoModel(model.modelId)) {
    return tier === "normal";
  }

  if (tier === "normal") return true;

  const freeLike = Boolean(model.isFree || model.modelId.includes(":free") || effectiveInputCost(model) === 0);
  if (tier === "free_only") {
    return freeLike;
  }

  const cheapLike =
    freeLike
    || (effectiveInputCost(model) <= CHEAP_MODEL_COST_PER_MILLION && effectiveOutputCost(model) <= CHEAP_MODEL_COST_PER_MILLION);
  if (tier === "cheap_only") {
    return cheapLike;
  }

  // expensive_blocked: enforce only the global 30/M cap and budget heuristics,
  // do not silently apply a stricter hidden threshold.
  return true;
}

export function buildRuntimeStatMap(rows: Array<{
  modelId: string;
  successCount: number;
  failureCount: number;
  avgLatencyMs?: number;
}>) {
  const map: Record<string, ModelRuntimeStat> = {};
  for (const row of rows) {
    map[row.modelId] = row;
  }
  return map;
}

function runtimeReliabilityScore(stats?: ModelRuntimeStat) {
  if (!stats) return 0.56;
  const success = Math.max(0, stats.successCount);
  const failure = Math.max(0, stats.failureCount);
  return (success + 1) / (success + failure + 2);
}

function runtimeLatencyScore(stats?: ModelRuntimeStat) {
  if (!stats || typeof stats.avgLatencyMs !== "number" || !Number.isFinite(stats.avgLatencyMs)) {
    return 0.55;
  }
  const ms = Math.max(1, stats.avgLatencyMs);
  if (ms <= 2500) return 1;
  if (ms <= 5000) return 0.72;
  if (ms <= 9000) return 0.42;
  return 0.2;
}

function speedScore(model: CatalogModelEntry) {
  const speed = numericCapability(model, "speed");
  if (typeof speed === "number") return speed;
  return ratingScore(model.speedRating);
}

function reasoningScore(model: CatalogModelEntry) {
  const reasoning = numericCapability(model, "reasoning");
  if (typeof reasoning === "number") return reasoning;
  return ratingScore(model.reasoningRating);
}

function modeScore(mode: string | undefined, model: CatalogModelEntry) {
  const safeMode = (mode ?? "general").toLowerCase();
  const wantsReasoning = safeMode === "research" || safeMode === "exam" || safeMode === "marker";
  const wantsFast = safeMode === "tutor" || safeMode === "flashcard" || safeMode === "quiz";
  const wantsCode = safeMode === "draft_coach";
  const wantsImage = safeMode === "image";

  if (wantsImage) {
    return modelSupportsCapability(model, "image_generation") ? 1 : 0;
  }

  let score = 0.4;
  if (wantsReasoning) score += reasoningScore(model) * 0.45;
  if (wantsFast) score += speedScore(model) * 0.35;
  if (wantsCode) score += (modelSupportsCapability(model, "code") ? 0.35 : 0);
  return clamp01(score);
}

function contextScore(model: CatalogModelEntry, messageLength?: number) {
  if (!messageLength || !model.contextLength || model.contextLength <= 0) return 0.6;
  const ratio = messageLength / model.contextLength;
  if (ratio <= 0.3) return 1;
  if (ratio <= 0.55) return 0.75;
  if (ratio <= 0.8) return 0.4;
  return 0.08;
}

export function rankCatalogModels(params: RankParams): RankedModel[] {
  const avoid = new Set(params.avoidModels ?? []);
  const preferred = new Set(params.preferredModelIds ?? []);

  const required = params.requiredCapabilities ?? [];
  const preferredCapabilities = params.preferredCapabilities ?? [];

  const rows: RankedModel[] = [];
  for (const model of params.catalog) {
    if (!model?.modelId || avoid.has(model.modelId)) continue;
    if (!isModelAllowedInTier(model, params.tier)) continue;

    let missingRequired = false;
    for (const capability of required) {
      if (!modelSupportsCapability(model, capability)) {
        missingRequired = true;
        break;
      }
    }
    if (missingRequired) continue;

    const reasons: string[] = [];
    let score = 0.25;

    const runtimeStats = params.runtimeStats?.[model.modelId];
    const reliability = runtimeReliabilityScore(runtimeStats);
    const latency = runtimeLatencyScore(runtimeStats);
    const totalRuns = Math.max(0, (runtimeStats?.successCount ?? 0) + (runtimeStats?.failureCount ?? 0));
    const cost = costScore(model);
    const speed = speedScore(model);
    const reasoning = reasoningScore(model);
    const mode = modeScore(params.mode, model);
    const context = contextScore(model, params.messageLength);

    score += reliability * 0.22;
    score += latency * 0.08;
    score += cost * 0.13;
    score += speed * 0.1;
    score += reasoning * 0.12;
    score += mode * 0.2;
    score += context * 0.1;

    // Encourage diversity over very frequently used models so routing does not collapse
    // into one repeated option when similarly strong alternatives exist.
    if (totalRuns > 80) {
      const reusePenalty = Math.min(0.08, Math.log10(totalRuns) * 0.02);
      score -= reusePenalty;
      reasons.push("diversity-balance");
    }

    if (params.needsSearch && modelSupportsCapability(model, "search")) {
      score += 0.08;
      reasons.push("search-capable");
    }

    if (params.preferFast) {
      score += speed * 0.06;
    }
    if (params.preferCheap) {
      score += cost * 0.06;
    }

    for (const capability of preferredCapabilities) {
      if (modelSupportsCapability(model, capability)) {
        score += 0.04;
        reasons.push(`prefers-${capability}`);
      }
    }

    if (preferred.has(model.modelId)) {
      score += 0.08;
      reasons.push("preferred-model");
    }

    if (model.modelId.includes(":free")) {
      score += 0.03;
      reasons.push("free-tier-friendly");
    }

    rows.push({
      model,
      score: clamp01(score),
      reasons,
    });
  }

  rows.sort((a, b) => b.score - a.score || a.model.modelId.localeCompare(b.model.modelId));
  return rows;
}

export function pickModelAndFallbacks(params: RankParams & { maxFallbacks?: number }) {
  const ranked = rankCatalogModels(params);
  const selected = ranked[0]?.model;
  const fallbackCount = Math.max(1, params.maxFallbacks ?? 4);
  const fallbacks = ranked.slice(1, fallbackCount + 1).map((row) => row.model.modelId);
  return {
    selected,
    ranked,
    fallbacks,
  };
}
