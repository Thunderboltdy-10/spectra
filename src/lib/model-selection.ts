import type { SpendingTier, StudyMode } from "@/types";
import {
  CHEAP_MODEL_COST_PER_MILLION,
  DEFAULT_MANUAL_MODEL_COST_CAP_PER_MILLION,
  MAX_MODEL_COST_PER_MILLION,
  ROUTING_LANE_COST_CAPS,
  type RoutingLane,
} from "@/lib/model-policy";

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
  supportedParameters?: string[];
  promptCachingSupported?: boolean;
  cachePricingReadPerM?: number;
  cachePricingWritePerM?: number;
  endpointLatencyP50Ms?: number;
  endpointUptimePercent?: number;
  inputModalities?: string[];
  outputModalities?: string[];
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
  consecutiveFailureCount?: number;
  lastFailureAt?: number;
  lengthFinishCount?: number;
  totalResponseChars?: number;
  positiveFeedbackCount?: number;
  negativeFeedbackCount?: number;
  qualityScore?: number;
  challengerState?: "challenger" | "normal" | "deprioritized";
  lastEvaluatedAt?: number;
};

export type ModelCapability =
  | "vision"
  | "reasoning"
  | "code"
  | "search"
  | "image_generation";

export const AUTO_ROUTER_FRESHNESS_MAX_DAYS = 90;

export function inferRoutingLane(params: {
  mode?: StudyMode | string;
  requiredCapabilities?: ModelCapability[];
  needsSearch?: boolean;
  preferFast?: boolean;
}): RoutingLane {
  const mode = (params.mode ?? "").toLowerCase();
  const required = new Set(params.requiredCapabilities ?? []);
  if (required.has("image_generation") || mode === "image") return "image_gen";
  if (required.has("vision")) return "vision";
  if (params.needsSearch || required.has("search") || mode === "research") return "search_reasoning";
  if (required.has("reasoning") || mode === "marker" || mode === "exam") return "deep_reasoning";
  if (params.preferFast || mode === "tutor" || mode === "general" || mode === "flashcard" || mode === "quiz") {
    return "fast_chat";
  }
  return "utility";
}

function normalizeModalities(values?: string[]) {
  return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function modalityBlob(model: CatalogModelEntry) {
  return `${(model.inputModalities ?? []).join(" ")} ${(model.outputModalities ?? []).join(" ")}`.toLowerCase();
}

function hasExplicitTextChatModalities(model: CatalogModelEntry) {
  const input = normalizeModalities(model.inputModalities);
  const output = normalizeModalities(model.outputModalities);
  if (input.size === 0 && output.size === 0) return null;
  const inputSupportsText = input.has("text");
  const outputSupportsText = output.has("text");
  return inputSupportsText && outputSupportsText;
}

export function isTextChatCapableModel(model: CatalogModelEntry) {
  const explicit = hasExplicitTextChatModalities(model);
  if (explicit !== null) {
    return explicit;
  }

  const blob = `${textBlob(model)} ${modalityBlob(model)}`;
  if (/\b(whisper|transcrib|transcript|tts|text-to-speech|speech-to-text|speech|audio-only|lyra|text-to-video|video[-_ ]gen|veo|sora)\b/.test(blob)) {
    return false;
  }
  return true;
}

type RankParams = {
  catalog: CatalogModelEntry[];
  tier: SpendingTier;
  lane?: RoutingLane;
  mode?: StudyMode | string;
  messageLength?: number;
  needsSearch?: boolean;
  preferFast?: boolean;
  preferCheap?: boolean;
  preferFree?: boolean;
  requiredCapabilities?: ModelCapability[];
  preferredCapabilities?: ModelCapability[];
  avoidModels?: string[];
  preferredModelIds?: string[];
  runtimeStats?: Record<string, ModelRuntimeStat>;
  allowStaleModels?: boolean;
  anchorModelId?: string;
  anchorModelBias?: number;
  preserveAnchor?: boolean;
  allowManualOverride?: boolean;
  manualCostCap?: number;
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

function recencyScore(model: CatalogModelEntry) {
  const timestamp = model.createdAt
    ?? (model.releaseDate ? Date.parse(model.releaseDate) : Number.NaN);
  if (!Number.isFinite(timestamp)) return 0.45;
  const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
  if (ageDays <= 7) return 1;
  if (ageDays <= 21) return 0.98;
  if (ageDays <= 45) return 0.82;
  if (ageDays <= 75) return 0.58;
  if (ageDays <= AUTO_ROUTER_FRESHNESS_MAX_DAYS) return 0.24;
  return 0.02;
}

function modelAgeDays(model: CatalogModelEntry) {
  const timestamp = model.createdAt
    ?? (model.releaseDate ? Date.parse(model.releaseDate) : Number.NaN);
  if (!Number.isFinite(timestamp)) return undefined;
  return (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
}

function parameterSizeBillions(model: CatalogModelEntry) {
  const blob = `${model.modelId} ${model.name ?? ""}`.toLowerCase();
  const match = blob.match(/(\d+(?:\.\d+)?)\s*b\b/);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function providerQualityPreferenceScore(model: CatalogModelEntry) {
  const provider = (model.provider ?? model.modelId.split("/")[0] ?? "").toLowerCase();
  const blob = `${textBlob(model)} ${modalityBlob(model)}`.toLowerCase();

  if (/\b(audio|speech|tts|stt|transcrib|whisper|voice|music|video)\b/.test(blob) && !isTextChatCapableModel(model)) {
    return -0.35;
  }

  if (/^(minimax|z-ai|thudm|moonshotai|deepseek|qwen|mistralai|mistral|arcee-ai|arcee|stepfun|stepup|inception|01-ai|baai)$/.test(provider)) {
    return 0.16;
  }
  if (/^(google|anthropic|openai|meta-llama|meta|nousresearch)$/.test(provider)) {
    return 0.08;
  }
  if (/^(cohere|nvidia|x-ai|amazon|microsoft|perplexity)$/.test(provider)) {
    return 0.03;
  }
  return -0.02;
}

function lowEndOpenSourcePenalty(model: CatalogModelEntry) {
  const sizeB = parameterSizeBillions(model);
  if (typeof sizeB === "number" && sizeB < 24) return 0.18;
  if (typeof sizeB === "number" && sizeB < 40) return 0.08;

  const blob = `${model.modelId} ${model.name ?? ""}`.toLowerCase();
  if (/\b(3b|4b|7b|8b|9b|12b|14b)\b/.test(blob)) return 0.14;
  if (/\b(16b|20b|22b)\b/.test(blob)) return 0.08;
  return 0;
}

function isVideoGenerationModel(model: CatalogModelEntry) {
  const blob = `${textBlob(model)} ${modalityBlob(model)}`;
  return /\b(video|text-to-video|video[-_ ]gen|veo|sora|wan[-_ ]video)\b/.test(blob);
}

export function isModelTooExpensivePerMillion(
  model: CatalogModelEntry,
  options?: {
    lane?: RoutingLane;
    allowManualOverride?: boolean;
    manualCostCap?: number;
  },
) {
  if (isImageGenerationModel(model)) return false;
  const freeLike = Boolean(model.isFree || model.modelId.includes(":free"));
  if (freeLike) return false;
  const hasKnownInput = typeof model.inputCostPerM === "number" && Number.isFinite(model.inputCostPerM);
  const hasKnownOutput = typeof model.outputCostPerM === "number" && Number.isFinite(model.outputCostPerM);
  // Keep policy explicit: unknown-priced paid models are not eligible for runtime routing.
  if (!hasKnownInput || !hasKnownOutput) return true;
  const cap = options?.allowManualOverride
    ? (options.manualCostCap ?? DEFAULT_MANUAL_MODEL_COST_CAP_PER_MILLION)
    : options?.lane
      ? ROUTING_LANE_COST_CAPS[options.lane]
      : MAX_MODEL_COST_PER_MILLION;
  return (
    Math.max(0, model.inputCostPerM as number) > cap
    || Math.max(0, model.outputCostPerM as number) > cap
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

export function isModelAllowedInTier(
  model: CatalogModelEntry,
  tier: SpendingTier,
  options?: {
    lane?: RoutingLane;
    allowManualOverride?: boolean;
    manualCostCap?: number;
  },
) {
  if (isModelTooExpensivePerMillion(model, options)) {
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
  const imageTurn = (params.mode ?? "").toLowerCase() === "image" || required.includes("image_generation");
  const complexTurn =
    (params.messageLength ?? 0) >= 650
    || (params.mode === "research" || params.mode === "marker" || params.mode === "exam" || params.mode === "draft_coach")
    || required.includes("reasoning")
    || required.includes("code");

  const rows: RankedModel[] = [];
  for (const model of params.catalog) {
    if (!model?.modelId || avoid.has(model.modelId)) continue;
    if (!isModelAllowedInTier(model, params.tier, {
      lane: params.lane,
      allowManualOverride: params.allowManualOverride,
      manualCostCap: params.manualCostCap,
    })) continue;
    const imageGenerationModel = isImageGenerationModel(model);
    const textChatCapable = isTextChatCapableModel(model);
    const modelAge = modelAgeDays(model);
    const staleModel = typeof modelAge === "number" && modelAge > AUTO_ROUTER_FRESHNESS_MAX_DAYS;
    if (!params.allowStaleModels && staleModel) continue;
    if (isVideoGenerationModel(model)) continue;
    if (!imageTurn && imageGenerationModel && !textChatCapable) continue;
    if (!imageGenerationModel && !textChatCapable) continue;

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
    const recency = recencyScore(model);
    const freeLike = Boolean(model.isFree || model.modelId.includes(":free") || effectiveInputCost(model) === 0);

    score += reliability * 0.22;
    score += latency * 0.08;
    score += cost * 0.13;
    score += speed * 0.1;
    score += reasoning * 0.12;
    score += mode * 0.2;
    score += context * 0.1;
    score += recency * 0.18;

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
    if (params.preferFree) {
      if (freeLike) score += 0.12;
    }
    if (params.anchorModelId && params.anchorModelId === model.modelId) {
      score += params.preserveAnchor === false ? 0.03 : (params.anchorModelBias ?? 0.2);
      reasons.push("anchor-model");
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

    if (params.tier === "normal" && !freeLike) {
      score += 0.05;
      reasons.push("paid-option-allowed");
    }

    const providerQuality = providerQualityPreferenceScore(model);
    if (providerQuality !== 0) {
      score += providerQuality;
      reasons.push(providerQuality > 0 ? "provider-quality-bias" : "provider-mismatch-penalty");
    }

    const lowEndPenalty = lowEndOpenSourcePenalty(model);
    if (lowEndPenalty > 0 && params.tier === "normal" && complexTurn) {
      score -= lowEndPenalty;
      reasons.push("small-open-model-penalty");
    }

    if (complexTurn && params.tier === "normal") {
      if (freeLike) {
        score -= 0.08;
        reasons.push("complexity-penalizes-free");
      }
      const sizeB = parameterSizeBillions(model);
      if (typeof sizeB === "number" && sizeB < 40) {
        score -= 0.14;
        reasons.push("small-parameter-penalty");
      }
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
  let ranked = rankCatalogModels(params);
  if (ranked.length === 0 && !params.allowStaleModels) {
    ranked = rankCatalogModels({
      ...params,
      allowStaleModels: true,
    });
  }
  const selected = ranked[0]?.model;
  const fallbackCount = Math.max(1, params.maxFallbacks ?? 4);
  const fallbacks = ranked.slice(1, fallbackCount + 1).map((row) => row.model.modelId);
  return {
    selected,
    ranked,
    fallbacks,
  };
}
