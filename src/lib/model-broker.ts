import type { RoutingLane } from "@/lib/model-policy";
import {
  AUTO_ROUTER_FRESHNESS_MAX_DAYS,
  isModelAllowedInTier,
  isTextChatCapableModel,
  modelSupportsCapability,
  type CatalogModelEntry,
  type ModelCapability,
  type ModelRuntimeStat,
} from "@/lib/model-selection";
import {
  failsTextQualityFloor,
  isFrontierOpenSourceModel,
  isFreshForAutoRouting,
  isNonTextOnlyModel,
  modelAgeDays,
  supportsDocumentReasoningModel,
} from "@/lib/runtime/model-guardrails";

export type BrokerCapability = ModelCapability | "file_understanding" | "document_reasoning";
export type BrokerCostBand = "free" | "low" | "medium" | "high" | "unknown";

export type BrokerIntent = {
  mode?: string;
  lane?: RoutingLane;
  messageLength?: number;
  requiredCapabilities?: BrokerCapability[];
  preferredCapabilities?: BrokerCapability[];
  preferredModelIds?: string[];
  avoidModelIds?: string[];
  anchorModelId?: string;
  preserveAnchor?: boolean;
  needsSearch?: boolean;
  preferFast?: boolean;
  preferLongContext?: boolean;
  stakeLevel?: "low" | "medium" | "high";
  spendingTier?: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
  allowManualSelection?: boolean;
  enforceFreshAutoCutoff?: boolean;
  qualityFloor?: "off" | "standard" | "strict";
};

export type BrokerCandidate = {
  model: CatalogModelEntry;
  totalScore: number;
  eligibilityNotes: string[];
  scoreBreakdown: string[];
  costBand: BrokerCostBand;
};

export type BrokerDecision = {
  primary: CatalogModelEntry | undefined;
  fallbacks: CatalogModelEntry[];
  ranked: BrokerCandidate[];
};

type BrokerWeights = {
  capabilityFit: number;
  reasoningStrength: number;
  instructionReliability: number;
  contextLength: number;
  freshness: number;
  providerReliability: number;
  runtimeSuccess: number;
  latency: number;
  costBand: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizeCapability(capability: BrokerCapability): ModelCapability | "file_understanding" | "document_reasoning" {
  return capability;
}

function averageKnownCost(model: CatalogModelEntry) {
  const vals = [model.inputCostPerM, model.outputCostPerM].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (vals.length === 0) {
    if (model.isFree || model.modelId.includes(':free')) return 0;
    return undefined;
  }
  return vals.reduce((a,b)=>a+b,0) / vals.length;
}

export function brokerCostBand(model: CatalogModelEntry): BrokerCostBand {
  const cost = averageKnownCost(model);
  if (cost === 0) return 'free';
  if (typeof cost !== 'number') return 'unknown';
  if (cost <= 3) return 'low';
  if (cost <= 12) return 'medium';
  return 'high';
}


function supportsBrokerCapability(model: CatalogModelEntry, capability: BrokerCapability) {
  if (capability === 'file_understanding' || capability === 'document_reasoning') {
    return supportsDocumentReasoningModel(model);
  }
  return modelSupportsCapability(model, capability);
}

function brokerLane(intent: BrokerIntent): RoutingLane {
  if (intent.lane) return intent.lane;
  const mode = (intent.mode ?? "").toLowerCase();
  if (mode === "image" || (intent.requiredCapabilities ?? []).includes("image_generation")) {
    return "image_gen";
  }
  if ((intent.requiredCapabilities ?? []).includes("vision")) return "vision";
  if (intent.needsSearch || (intent.requiredCapabilities ?? []).includes("search") || mode === "research") {
    return "search_reasoning";
  }
  if (
    mode === "marker"
    || mode === "exam"
    || (intent.requiredCapabilities ?? []).includes("reasoning")
    || (intent.requiredCapabilities ?? []).includes("document_reasoning")
  ) {
    return "deep_reasoning";
  }
  if (intent.preferFast || mode === "tutor" || mode === "general" || mode === "quiz" || mode === "flashcard") {
    return "fast_chat";
  }
  return "utility";
}

export function getBrokerEligibilityIssues(model: CatalogModelEntry, intent: BrokerIntent) {
  const issues: string[] = [];
  const mode = (intent.mode ?? "").toLowerCase();
  const imageTurn = mode === "image" || (intent.requiredCapabilities ?? []).includes("image_generation");
  if (!model?.modelId || model.modelId === 'openrouter/auto') issues.push('unsupported-router-model');
  if (!imageTurn && isNonTextOnlyModel(model)) issues.push("excluded_non_text_model");
  if (!isTextChatCapableModel(model) && !supportsBrokerCapability(model, 'image_generation')) issues.push('not-text-chat-capable');
  for (const capability of intent.requiredCapabilities ?? []) {
    if (!supportsBrokerCapability(model, normalizeCapability(capability))) {
      issues.push(`missing:${capability}`);
    }
  }
  if (!imageTurn && supportsBrokerCapability(model, 'image_generation') && !isTextChatCapableModel(model)) {
    issues.push('image-only-model');
  }
  if (
    !imageTurn
    && (intent.qualityFloor ?? "standard") !== "off"
    && failsTextQualityFloor(model, {
      mode,
      stakes: intent.stakeLevel,
      messageLength: intent.messageLength,
    })
  ) {
    issues.push("quality_floor");
  }
  if (intent.enforceFreshAutoCutoff && !isFreshForAutoRouting(model, AUTO_ROUTER_FRESHNESS_MAX_DAYS)) {
    issues.push("stale_auto_cutoff");
  }
  if (!isModelAllowedInTier(model, intent.spendingTier ?? "normal", {
    lane: brokerLane(intent),
    allowManualOverride: Boolean(intent.allowManualSelection),
  })) issues.push(`tier:${intent.spendingTier ?? "normal"}`);
  return issues;
}

function brokerWeights(intent: BrokerIntent): BrokerWeights {
  const stake = intent.stakeLevel ?? "medium";
  const mode = (intent.mode ?? "").toLowerCase();
  const reasoningHeavy =
    stake === "high"
    || mode === "research"
    || mode === "marker"
    || mode === "exam"
    || (intent.requiredCapabilities ?? []).includes("reasoning")
    || (intent.requiredCapabilities ?? []).includes("document_reasoning");
  const contextHeavy = Boolean(intent.preferLongContext || (intent.requiredCapabilities ?? []).includes("file_understanding"));
  const speedHeavy = Boolean(intent.preferFast && !reasoningHeavy);

  if (reasoningHeavy) {
    return {
      capabilityFit: 0.24,
      reasoningStrength: 0.18,
      instructionReliability: 0.14,
      contextLength: contextHeavy ? 0.12 : 0.1,
      freshness: 0.08,
      providerReliability: 0.1,
      runtimeSuccess: 0.08,
      latency: 0.02,
      costBand: 0.04,
    };
  }

  if (speedHeavy) {
    return {
      capabilityFit: 0.24,
      reasoningStrength: 0.12,
      instructionReliability: 0.14,
      contextLength: 0.1,
      freshness: 0.08,
      providerReliability: 0.1,
      runtimeSuccess: 0.1,
      latency: 0.08,
      costBand: 0.04,
    };
  }

  return {
    capabilityFit: 0.24,
    reasoningStrength: 0.16,
    instructionReliability: 0.14,
    contextLength: 0.11,
    freshness: 0.08,
    providerReliability: 0.1,
    runtimeSuccess: 0.09,
    latency: 0.04,
    costBand: 0.04,
  };
}

function capabilityFit(model: CatalogModelEntry, intent: BrokerIntent) {
  const required = intent.requiredCapabilities ?? [];
  const preferred = intent.preferredCapabilities ?? [];
  if (required.length === 0 && preferred.length === 0) return 0.72;
  const requiredScore = required.length === 0 ? 1 : required.filter((cap) => supportsBrokerCapability(model, cap)).length / required.length;
  const preferredScore = preferred.length === 0 ? 0.7 : preferred.filter((cap) => supportsBrokerCapability(model, cap)).length / preferred.length;
  return clamp01(requiredScore * 0.7 + preferredScore * 0.3);
}

function reasoningStrength(model: CatalogModelEntry, mode?: string) {
  const numeric = typeof model.capabilities?.reasoning === 'number' ? clamp01(model.capabilities.reasoning / 10) : undefined;
  let score = numeric ?? (model.reasoningRating === 'high' ? 0.95 : model.reasoningRating === 'medium' ? 0.62 : 0.34);
  if (['research','marker','exam'].includes((mode ?? '').toLowerCase())) score = clamp01(score + 0.08);
  return score;
}

function instructionReliability(model: CatalogModelEntry) {
  const provider = (model.provider ?? model.modelId.split('/')[0] ?? '').toLowerCase();
  let score = 0.58;
  if (/^(openai|anthropic|google|moonshotai|minimax|z-ai|qwen|deepseek|mistralai|mistral|thudm|glm|stepfun|inception|arcee|arcee-ai)$/.test(provider)) score += 0.2;
  if (/^(perplexity|meta|meta-llama|nousresearch|cohere)$/.test(provider)) score += 0.08;
  if (isFrontierOpenSourceModel(model)) score += 0.06;
  if (/(mini|flash|air)/i.test(model.modelId)) score -= 0.04;
  return clamp01(score);
}

function contextScore(model: CatalogModelEntry, intent: BrokerIntent) {
  const ctx = model.contextLength ?? 0;
  const need = Math.max(intent.messageLength ?? 0, intent.preferLongContext ? 64000 : 16000);
  if (!ctx) return 0.45;
  if (ctx >= need * 6) return 1;
  if (ctx >= need * 3) return 0.88;
  if (ctx >= need * 1.5) return 0.72;
  if (ctx >= need) return 0.58;
  return 0.18;
}

function freshness(model: CatalogModelEntry) {
  const age = modelAgeDays(model);
  if (typeof age !== "number") return 0.08;
  if (age <= 14) return 1;
  if (age <= 45) return 0.88;
  if (age <= 90) return 0.72;
  if (age <= 140) return 0.22;
  return 0.04;
}

function providerReliability(model: CatalogModelEntry) {
  return clamp01((model.endpointUptimePercent ?? 91) / 100);
}

function runtimeSuccess(model: CatalogModelEntry, runtimeStats?: Record<string, ModelRuntimeStat>) {
  const stats = runtimeStats?.[model.modelId];
  if (!stats) return 0.58;
  const success = Math.max(0, stats.successCount);
  const failure = Math.max(0, stats.failureCount);
  return clamp01((success + 1) / (success + failure + 2));
}

function latency(model: CatalogModelEntry, runtimeStats?: Record<string, ModelRuntimeStat>) {
  const ms = runtimeStats?.[model.modelId]?.avgLatencyMs ?? model.endpointLatencyP50Ms;
  if (!ms || !Number.isFinite(ms)) return 0.6;
  if (ms <= 2500) return 1;
  if (ms <= 5000) return 0.75;
  if (ms <= 9000) return 0.48;
  return 0.24;
}

function costGuidance(model: CatalogModelEntry, intent: BrokerIntent) {
  const band = brokerCostBand(model);
  const stake = intent.stakeLevel ?? 'medium';
  if (stake === 'high') return band === 'high' ? 0.92 : band === 'medium' ? 0.88 : 0.72;
  if (intent.spendingTier === 'free_only') return band === 'free' ? 1 : 0;
  if (intent.spendingTier === 'cheap_only') return band === 'free' ? 1 : band === 'low' ? 0.86 : 0.35;
  if ((intent.mode ?? '').toLowerCase() === 'image' || (intent.requiredCapabilities ?? []).includes('vision')) {
    return band === 'high' ? 0.86 : band === 'medium' ? 0.9 : band === 'low' ? 0.84 : 0.72;
  }
  if (stake === 'low') return band === 'free' ? 0.7 : band === 'low' ? 0.84 : band === 'medium' ? 0.76 : 0.62;
  return band === 'free' ? 0.72 : band === 'low' ? 0.9 : band === 'medium' ? 0.84 : 0.72;
}

export function scoreBrokerCandidate(model: CatalogModelEntry, intent: BrokerIntent, runtimeStats?: Record<string, ModelRuntimeStat>) {
  const weights = brokerWeights(intent);
  const frontierOpenSource = isFrontierOpenSourceModel(model);
  const reasoningHeavy =
    (intent.stakeLevel ?? "medium") === "high"
    || ["research", "marker", "exam"].includes((intent.mode ?? "").toLowerCase())
    || (intent.requiredCapabilities ?? []).includes("reasoning")
    || (intent.requiredCapabilities ?? []).includes("document_reasoning");
  const components = {
    capabilityFit: capabilityFit(model, intent),
    reasoningStrength: reasoningStrength(model, intent.mode),
    instructionReliability: instructionReliability(model),
    contextLength: contextScore(model, intent),
    freshness: freshness(model),
    providerReliability: providerReliability(model),
    runtimeSuccess: runtimeSuccess(model, runtimeStats),
    latency: latency(model, runtimeStats),
    costBand: costGuidance(model, intent),
  };

  let total =
    components.capabilityFit * weights.capabilityFit +
    components.reasoningStrength * weights.reasoningStrength +
    components.instructionReliability * weights.instructionReliability +
    components.contextLength * weights.contextLength +
    components.freshness * weights.freshness +
    components.providerReliability * weights.providerReliability +
    components.runtimeSuccess * weights.runtimeSuccess +
    components.latency * weights.latency +
    components.costBand * weights.costBand;

  if ((intent.preferredModelIds ?? []).includes(model.modelId)) total += 0.04;
  if (intent.anchorModelId && intent.anchorModelId === model.modelId) total += intent.preserveAnchor === false ? 0.01 : 0.05;
  if ((intent.avoidModelIds ?? []).includes(model.modelId)) total -= 0.3;
  if (frontierOpenSource) {
    total += reasoningHeavy ? 0.05 : 0.02;
  }

  return {
    totalScore: clamp01(total),
    scoreBreakdown: [
      ...Object.entries(components).map(([k, v]) => `${k}:${v.toFixed(2)}`),
      frontierOpenSource ? `frontier_open_source:${(reasoningHeavy ? 0.05 : 0.02).toFixed(2)}` : undefined,
    ].filter((entry): entry is string => Boolean(entry)),
    costBand: brokerCostBand(model),
  };
}

export function runCapabilityFirstBroker(params: {
  catalog: CatalogModelEntry[];
  intent: BrokerIntent;
  runtimeStats?: Record<string, ModelRuntimeStat>;
  maxFallbacks?: number;
}) : BrokerDecision {
  const candidates: BrokerCandidate[] = [];
  for (const model of params.catalog) {
    const eligibilityNotes = getBrokerEligibilityIssues(model, params.intent);
    if (eligibilityNotes.length > 0) continue;
    const scored = scoreBrokerCandidate(model, params.intent, params.runtimeStats);
    candidates.push({
      model,
      totalScore: scored.totalScore,
      scoreBreakdown: scored.scoreBreakdown,
      costBand: scored.costBand,
      eligibilityNotes,
    });
  }
  candidates.sort((a,b) => b.totalScore - a.totalScore || a.model.modelId.localeCompare(b.model.modelId));
  return {
    primary: candidates[0]?.model,
    fallbacks: candidates.slice(1, 1 + Math.max(1, params.maxFallbacks ?? 4)).map((c) => c.model),
    ranked: candidates,
  };
}
