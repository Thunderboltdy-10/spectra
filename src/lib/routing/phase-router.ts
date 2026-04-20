import type { ThinkingLevel } from "@/lib/contracts/studyModes";
import {
  AUTO_ROUTER_FRESHNESS_MAX_DAYS,
  inferRoutingLane,
  isTextChatCapableModel,
  isModelAllowedInTier,
  isModelTooExpensivePerMillion,
  modelSupportsCapability,
  type CatalogModelEntry,
  type ModelCapability,
  type ModelRuntimeStat,
} from "@/lib/model-selection";
import type { AssignmentLevel, RouteTraceCandidate, RouteTracePhase, SpendingTier, StudyMode } from "@/types";

export type RoutingLane = "scored" | "challenger";
type StakeLevel = "low" | "medium" | "high";
type RequestClass = "T0" | "T1" | "T2" | "T3";
type DynamicTier = "budget" | "balanced" | "premium" | "heavy";

export type PhaseRoutingInput = {
  phaseId: string;
  phaseLabel: string;
  mode: StudyMode;
  routerMode: "auto" | "manual" | "openrouter_auto";
  manualModel?: string;
  manualModelConfirmedExpensive?: boolean;
  spendingTier: SpendingTier;
  thinkingLevel: ThinkingLevel;
  stakes: StakeLevel;
  messageLength: number;
  needsSearch?: boolean;
  hasAttachments?: boolean;
  requiredCapabilities?: ModelCapability[];
  preferredCapabilities?: ModelCapability[];
  preferredModelIds?: string[];
  previousModelUsed?: string;
  conversationTurnCount?: number;
  recentModels?: string[];
  requestClass?: RequestClass;
  assignmentLevel?: AssignmentLevel;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  desiredContextTokens?: number;
  preferLargeContext?: boolean;
  cacheWindow?: {
    lastModel?: string;
    lastUsedAt?: number;
    compactedAt?: number;
    ttlMs?: number;
  };
  modelCatalog: CatalogModelEntry[];
  modelRuntimeStats?: Record<string, ModelRuntimeStat>;
  seedKey: string;
};

export type PhaseRoutingDecision = {
  selectedModel: string;
  fallbackModels: string[];
  lane: RoutingLane;
  reason: string;
  candidates: RouteTraceCandidate[];
  phase: RouteTracePhase;
  routingDurationMs: number;
};

type ScoredCandidate = {
  modelId: string;
  provider: string;
  dynamicTier: DynamicTier;
  rawScore: number;
  normalizedScore: number;
  breakdown: string[];
  reasonTags: string[];
  isChallenger: boolean;
  cacheWarm: boolean;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const FAILURE_CIRCUIT_WINDOW_MS = 10 * 60 * 1000;
const FRESHNESS_PENALTY_DAYS = 60;
const FRESHNESS_BLOCK_DAYS = AUTO_ROUTER_FRESHNESS_MAX_DAYS;
const CLOSE_SCORE_NOISE_RANGE = 0.03;
const WEIGHTED_RANDOM_WINDOW = 0.85;

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  return Date.now();
}

function hashToUnit(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

function providerFromModelId(modelId: string) {
  return modelId.split("/")[0]?.toLowerCase() || "unknown";
}

function normalizeCost(model: CatalogModelEntry) {
  if (model.isFree || model.modelId.includes(":free")) return 0;
  const input = typeof model.inputCostPerM === "number" ? Math.max(0, model.inputCostPerM) : 8;
  const output = typeof model.outputCostPerM === "number" ? Math.max(0, model.outputCostPerM) : 10;
  return (input + output) / 2;
}

function reliabilityScore(stat?: ModelRuntimeStat) {
  if (!stat) return 0.56;
  const success = Math.max(0, stat.successCount);
  const failure = Math.max(0, stat.failureCount);
  return Math.max(0, Math.min(1, (success + 1) / (success + failure + 2)));
}

function latencyFit(stat?: ModelRuntimeStat) {
  const ms = stat?.avgLatencyMs;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return 0.58;
  if (ms <= 2500) return 1;
  if (ms <= 4500) return 0.82;
  if (ms <= 7500) return 0.6;
  if (ms <= 11_000) return 0.36;
  return 0.2;
}

function parseReleaseTime(model: CatalogModelEntry) {
  const maybeWithRelease = model as CatalogModelEntry & { releaseDate?: string; createdAt?: number };
  if (typeof maybeWithRelease.releaseDate === "string" && maybeWithRelease.releaseDate.trim()) {
    const parsed = Date.parse(maybeWithRelease.releaseDate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (typeof maybeWithRelease.createdAt === "number" && Number.isFinite(maybeWithRelease.createdAt)) {
    return maybeWithRelease.createdAt;
  }
  return undefined;
}

function modelAgeDays(model: CatalogModelEntry) {
  const releaseTs = parseReleaseTime(model);
  if (!releaseTs) return undefined;
  return Math.max(0, (Date.now() - releaseTs) / (24 * 60 * 60 * 1000));
}

function freshnessScore(model: CatalogModelEntry) {
  const ageDays = modelAgeDays(model);
  if (typeof ageDays !== "number") return 0.45;
  if (ageDays <= 7) return 1;
  if (ageDays <= 21) return 0.99;
  if (ageDays <= 45) return 0.9;
  if (ageDays <= FRESHNESS_PENALTY_DAYS) return 0.74;
  if (ageDays <= FRESHNESS_BLOCK_DAYS) return 0.08;
  return 0;
}

function freshnessMultiplier(model: CatalogModelEntry) {
  const ageDays = modelAgeDays(model);
  if (typeof ageDays !== "number") return 1;
  if (ageDays > FRESHNESS_BLOCK_DAYS) return 0;
  if (ageDays > FRESHNESS_PENALTY_DAYS) return 0.15;
  return 1;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function dynamicTierForModel(model: CatalogModelEntry): DynamicTier {
  const cost = normalizeCost(model);
  const capability = (
    (typeof model.capabilities?.reasoning === "number" ? model.capabilities.reasoning : 4)
    + (typeof model.capabilities?.code === "number" ? model.capabilities.code : 4)
    + (typeof model.capabilities?.vision === "number" ? model.capabilities.vision : 0)
  ) / 30;

  if (cost <= 2.5 || model.isFree || model.modelId.includes(":free")) return "budget";
  if (cost <= 9) return capability >= 0.75 ? "premium" : "balanced";
  if (cost <= 20) return capability >= 0.8 ? "heavy" : "premium";
  return "heavy";
}

function tierProviderCoverage(catalog: CatalogModelEntry[]) {
  const map: Record<DynamicTier, Set<string>> = {
    budget: new Set<string>(),
    balanced: new Set<string>(),
    premium: new Set<string>(),
    heavy: new Set<string>(),
  };
  for (const model of catalog) {
    const tier = dynamicTierForModel(model);
    map[tier].add(providerFromModelId(model.modelId));
  }
  return map;
}

function capabilityMatch(params: {
  model: CatalogModelEntry;
  required: ModelCapability[];
  preferred: ModelCapability[];
  mode: StudyMode;
  needsSearch?: boolean;
}) {
  for (const requiredCapability of params.required) {
    if (!modelSupportsCapability(params.model, requiredCapability)) return 0;
  }

  const preferredHits = params.preferred.reduce((hits, capability) => {
    return hits + (modelSupportsCapability(params.model, capability) ? 1 : 0);
  }, 0);
  const preferredScore = params.preferred.length > 0 ? preferredHits / params.preferred.length : 1;

  let modeBias = 0.55;
  if (params.mode === "research" || params.mode === "exam" || params.mode === "marker") {
    modeBias += modelSupportsCapability(params.model, "reasoning") ? 0.2 : -0.12;
  }
  if (params.mode === "draft_coach") {
    modeBias += modelSupportsCapability(params.model, "code") ? 0.14 : 0;
  }
  if (params.needsSearch) {
    modeBias += modelSupportsCapability(params.model, "search") ? 0.14 : -0.08;
  }

  return clamp01(modeBias * 0.55 + preferredScore * 0.45);
}

function costFit(costPerM: number, stakes: StakeLevel, isFree: boolean) {
  if (isFree) return stakes === "high" ? 0.66 : 0.88;
  const target = stakes === "low" ? 2.2 : stakes === "medium" ? 8.5 : 18;
  if (costPerM <= 0.02) return 0.95;
  if (costPerM <= target) return 0.9;
  if (costPerM <= target * 1.6) return 0.66;
  if (costPerM <= target * 2.4) return 0.42;
  return 0.2;
}

function contextFit(params: {
  model: CatalogModelEntry;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  desiredContextTokens?: number;
  preferLargeContext?: boolean;
}) {
  const contextLength = params.model.contextLength;
  if (typeof contextLength !== "number" || !Number.isFinite(contextLength) || contextLength <= 0) {
    return params.preferLargeContext ? 0.5 : 0.62;
  }

  const required = Math.max(
    8_192,
    (params.estimatedInputTokens ?? 0) + (params.estimatedOutputTokens ?? 0) + 2_048,
    params.desiredContextTokens ?? 0,
  );
  const ratio = contextLength / required;
  if (ratio >= 1.45) return 1;
  if (ratio >= 1.2) return 0.9;
  if (ratio >= 1.05) return 0.78;
  if (ratio >= 0.92) return 0.52;
  if (ratio >= 0.8) return 0.25;
  return 0.04;
}

function quickReplyModelBias(model: CatalogModelEntry) {
  const token = `${model.modelId} ${model.name ?? ""}`.toLowerCase();
  let bias = 0;
  if (/\b(flash|mini|nano|haiku|small|8b|4b|3b)\b/.test(token)) bias += 0.06;
  if (/\b(deep[-_ ]?research|reasoning|70b|90b|120b|235b|max|ultra|pro)\b/.test(token)) bias -= 0.04;
  if (model.isFree || model.modelId.includes(":free")) bias += 0.02;
  return Math.max(-0.06, Math.min(0.1, bias));
}

function looksImageTunedModel(model: CatalogModelEntry) {
  const token = `${model.modelId} ${model.name ?? ""}`.toLowerCase();
  return /\bimage\b/.test(token) || token.includes("nano banana");
}

function hasWarmCache(params: {
  modelId: string;
  model: CatalogModelEntry;
  cacheWindow?: PhaseRoutingInput["cacheWindow"];
}) {
  const window = params.cacheWindow;
  if (!window?.lastModel || !window.lastUsedAt) return false;
  if (!params.model.promptCachingSupported) return false;
  if (window.lastModel !== params.modelId) return false;

  const ttlMs = window.ttlMs ?? CACHE_TTL_MS;
  if (Date.now() - window.lastUsedAt > ttlMs) return false;
  if (typeof window.compactedAt === "number" && window.compactedAt > window.lastUsedAt) {
    return false;
  }
  return true;
}

function recentModelMultiplier(modelId: string, recentModels: string[]) {
  const tail3 = recentModels.slice(-3);
  if (tail3.includes(modelId)) return 0.7;
  const tail5 = recentModels.slice(-5);
  if (tail5.includes(modelId)) return 0.85;
  const tail10 = recentModels.slice(-10);
  if (tail10.includes(modelId)) return 0.92;
  return 1;
}

function providerRepeatMultiplier(provider: string, recentProviders: string[]) {
  const tailFive = recentProviders.slice(-5);
  const repeats = tailFive.filter((item) => item === provider).length;
  if (repeats >= 4) return 0.62;
  if (repeats >= 3) return 0.76;
  const lastTwo = recentProviders.slice(-2);
  if (lastTwo.length >= 2 && lastTwo.every((item) => item === provider)) return 0.85;
  return 1;
}

function scoreWeights(input: PhaseRoutingInput) {
  if (input.requestClass === "T0") {
    return {
      capability: 0.18,
      cost: 0.26,
      reliability: 0.10,
      latency: 0.24,
      diversity: 0.14,
      cache: 0.05,
      freshness: 0.03,
      context: 0,
    };
  }
  if (input.stakes === "high" || input.requestClass === "T3" || input.mode === "research") {
    return {
      capability: 0.33,
      cost: 0.14,
      reliability: 0.18,
      latency: 0.08,
      diversity: 0.12,
      cache: 0.06,
      freshness: 0.09,
      context: 0.10,
    };
  }
  if (input.stakes === "medium" || input.requestClass === "T2") {
    return {
      capability: 0.30,
      cost: 0.18,
      reliability: 0.17,
      latency: 0.10,
      diversity: 0.13,
      cache: 0.07,
      freshness: 0.08,
      context: 0.07,
    };
  }
  return {
    capability: 0.27,
    cost: 0.23,
    reliability: 0.15,
    latency: 0.10,
    diversity: 0.15,
    cache: 0.07,
    freshness: 0.08,
    context: 0.05,
  };
}

function normalizeScores(rows: ScoredCandidate[]) {
  if (rows.length === 0) return;
  const raw = rows.map((row) => row.rawScore);
  const min = Math.min(...raw);
  const max = Math.max(...raw);
  const spread = Math.max(1e-6, max - min);

  for (const row of rows) {
    row.normalizedScore = clamp01((row.rawScore - min) / spread);
  }
}

function deterministicSignedNoise(seed: string, magnitude: number) {
  return (hashToUnit(seed) - 0.5) * 2 * magnitude;
}

function chooseWeightedCandidate(rows: ScoredCandidate[], seedKey: string) {
  if (rows.length === 0) return undefined;
  const totalWeight = rows.reduce((sum, row) => sum + Math.max(0.0001, row.rawScore), 0);
  if (totalWeight <= 0) return rows[0];
  let remaining = hashToUnit(seedKey) * totalWeight;
  for (const row of rows) {
    remaining -= Math.max(0.0001, row.rawScore);
    if (remaining <= 0) return row;
  }
  return rows[rows.length - 1];
}

function modeAllowsChallengers(input: PhaseRoutingInput) {
  const requestClass = input.requestClass;
  if (requestClass && requestClass !== "T0" && requestClass !== "T1") return false;
  if (input.stakes !== "low") return false;
  if (input.messageLength > 260) return false;
  if (input.mode === "research" || input.mode === "exam" || input.mode === "marker") return false;
  return true;
}

export function buildPhasePlan(params: {
  routeNeedsRetrieval: boolean;
  routeNeedsSearch: boolean;
  routeNeedsWorkstreamMemory?: boolean;
  routeNeedsWorkstreamArtifacts?: boolean;
  multiAgentEnabled: boolean;
  shouldVerify: boolean;
  shouldRepair: boolean;
  shouldWriteMemory: boolean;
  shouldGenerateTitle: boolean;
}): RouteTracePhase[] {
  const phases: RouteTracePhase[] = [
    { id: "routing", label: "Planning the route", status: "completed" },
  ];
  if (params.routeNeedsWorkstreamMemory) {
    phases.push({ id: "ws_memory", label: "Loading workstream memory", status: "planned" });
  }
  if (params.routeNeedsWorkstreamArtifacts) {
    phases.push({ id: "ws_artifacts", label: "Loading workstream artifacts", status: "planned" });
  }
  if (params.routeNeedsRetrieval) phases.push({ id: "retrieval", label: "Checking your uploaded materials", status: "planned" });
  if (params.routeNeedsSearch) phases.push({ id: "search", label: "Checking live sources", status: "planned" });
  if (params.multiAgentEnabled) {
    phases.push({ id: "planning", label: "Breaking work into specialists", status: "planned" });
    phases.push({ id: "analysis", label: "Running specialist analysis", status: "planned" });
    phases.push({ id: "synthesis", label: "Merging specialist output", status: "planned" });
  } else {
    phases.push({ id: "analysis", label: "Analyzing your request", status: "planned" });
    phases.push({ id: "authoring", label: "Writing the response", status: "planned" });
  }
  if (params.shouldVerify) phases.push({ id: "verification", label: "Verifying critical claims", status: "planned" });
  if (params.shouldRepair) phases.push({ id: "repair", label: "Repairing response format", status: "planned" });
  if (params.shouldWriteMemory) phases.push({ id: "memory", label: "Updating long-term memory", status: "planned" });
  // Title generation is a background op — omit from user-facing phase plan to avoid "Naming this chat planned" noise
  // The pipeline still executes it; it just won't appear in the trace overlay.
  return phases;
}

export function selectModelForPhase(input: PhaseRoutingInput): PhaseRoutingDecision {
  const startedAt = nowMs();
  const recentModels = (input.recentModels ?? []).slice(-20);
  const recentProviders = recentModels.map(providerFromModelId);
  const weights = scoreWeights(input);
  const required = input.requiredCapabilities ?? [];
  const preferred = input.preferredCapabilities ?? [];
  const catalog = input.modelCatalog.filter((model) =>
    model.modelId
    && model.modelId !== "openrouter/auto"
    && !model.modelId.includes(":online"),
  );
  const preferredIds = new Set((input.preferredModelIds ?? []).filter(Boolean));

  const manualEntry = input.manualModel
    ? input.modelCatalog.find((model) => model.modelId === input.manualModel)
    : undefined;
  const lane = inferRoutingLane({
    mode: input.mode,
    requiredCapabilities: input.requiredCapabilities,
    needsSearch: input.needsSearch,
    preferFast: input.stakes === "low",
  });
  const manualBlockedByCap = Boolean(manualEntry && isModelTooExpensivePerMillion(manualEntry, { lane }));
  const manualAllowedByTier = Boolean(manualEntry && isModelAllowedInTier(manualEntry, input.spendingTier, {
    lane,
    allowManualOverride: input.routerMode === "manual",
  }));
  const manualAllowedWithOverride =
    input.routerMode === "manual"
    && Boolean(input.manualModel)
    && (
      manualAllowedByTier
      || (
        manualBlockedByCap
        && input.manualModelConfirmedExpensive
        && input.spendingTier === "normal"
      )
    );

  if (manualAllowedWithOverride && input.manualModel) {
    const candidates: RouteTraceCandidate[] = [
      {
        modelId: input.manualModel,
        allowed: true,
        score: 1,
        reason: manualBlockedByCap
          ? "Manual model lock (cost-cap override confirmed by user)"
          : "Manual model lock",
        scoreBreakdown: [
          manualBlockedByCap
            ? "manual override confirmed"
            : "manual selection",
        ],
      },
    ];
    const fallbackModels: string[] = [];
    const routingDurationMs = Math.max(0, Math.round(nowMs() - startedAt));
    return {
      selectedModel: input.manualModel,
      fallbackModels,
      lane: "scored",
      reason: manualBlockedByCap
        ? `Manual override kept ${input.manualModel} for ${input.phaseLabel.toLowerCase()} despite cost cap.`
        : `Manual model lock for ${input.phaseLabel.toLowerCase()}`,
      candidates,
      phase: {
        id: input.phaseId,
        label: input.phaseLabel,
        status: "planned",
        thinkingLevel: input.thinkingLevel,
        model: input.manualModel,
      },
      routingDurationMs,
    };
  }

  if (input.routerMode === "openrouter_auto" && input.spendingTier === "normal") {
    const rankedFallbacks = catalog
      .filter((model) => isModelAllowedInTier(model, input.spendingTier, { lane }))
      .slice(0, 5)
      .map((model) => model.modelId);
    const routingDurationMs = Math.max(0, Math.round(nowMs() - startedAt));
    return {
      selectedModel: "openrouter/auto",
      fallbackModels: rankedFallbacks,
      lane: "scored",
      reason: `Delegated ${input.phaseLabel.toLowerCase()} to OpenRouter auto`,
      candidates: [
        {
          modelId: "openrouter/auto",
          allowed: true,
          score: 1,
          reason: "OpenRouter auto delegation",
          scoreBreakdown: ["Provider-routed automatic selection"],
        },
      ],
      phase: {
        id: input.phaseId,
        label: input.phaseLabel,
        status: "planned",
        thinkingLevel: input.thinkingLevel,
        model: "openrouter/auto",
      },
      routingDurationMs,
    };
  }

  const coverageByTier = tierProviderCoverage(catalog);
  const hasWarmCacheCandidate = catalog.some((model) =>
    hasWarmCache({
      modelId: model.modelId,
      model,
      cacheWindow: input.cacheWindow,
    }),
  );

  const explorationRoll = hashToUnit(`${input.seedKey}:${input.phaseId}:explore`);
  const shouldExplore = explorationRoll < 0.1;
  const challengerAllowed = modeAllowsChallengers(input) && shouldExplore && !hasWarmCacheCandidate;

  const scored: ScoredCandidate[] = [];
  for (const model of catalog) {
    if (!isModelAllowedInTier(model, input.spendingTier, { lane })) continue;
    if (input.mode !== "image" && !modelSupportsCapability(model, "image_generation") && !isTextChatCapableModel(model)) {
      continue;
    }
    const freshnessMultiplierValue = freshnessMultiplier(model);
    if (freshnessMultiplierValue <= 0) continue;

    const capMatch = capabilityMatch({
      model,
      required,
      preferred,
      mode: input.mode,
      needsSearch: input.needsSearch,
    });
    if (capMatch <= 0) continue;
    const context = contextFit({
      model,
      estimatedInputTokens: input.estimatedInputTokens,
      estimatedOutputTokens: input.estimatedOutputTokens,
      desiredContextTokens: input.desiredContextTokens,
      preferLargeContext: input.preferLargeContext,
    });
    if ((input.preferLargeContext || input.assignmentLevel === "L4") && context <= 0.08) continue;

    const stat = input.modelRuntimeStats?.[model.modelId];
    const reliability = reliabilityScore(stat);
    const latency = latencyFit(stat);
    const fresh = freshnessScore(model);
    const ageDays = modelAgeDays(model);
    const provider = providerFromModelId(model.modelId);
    const cost = costFit(normalizeCost(model), input.stakes, Boolean(model.isFree || model.modelId.includes(":free")));
    const cacheWarm = hasWarmCache({ modelId: model.modelId, model, cacheWindow: input.cacheWindow });
    const cacheBonus = cacheWarm ? 1 : model.promptCachingSupported ? 0.58 : 0.22;

    const tier = dynamicTierForModel(model);
    const providerCoverage = clamp01((coverageByTier[tier]?.size ?? 1) / 4);
    const providerRotationBonus = recentProviders.slice(-2).includes(provider) ? 0 : 0.08;
    const diversityScore = clamp01(providerCoverage + providerRotationBonus);

    const weightedScore =
      (weights.capability * capMatch)
      + (weights.cost * cost)
      + (weights.reliability * reliability)
      + (weights.latency * latency)
      + (weights.diversity * diversityScore)
      + (weights.cache * cacheBonus)
      + (weights.freshness * fresh)
      + (weights.context * context);
    const quickReplyBonus =
      input.requestClass === "T0" && !input.needsSearch && !input.hasAttachments
        ? (latency * 0.08) + (cost * 0.06) + quickReplyModelBias(model)
        : 0;

    let multiplier = 1;
    const reasonTags: string[] = [];
    const breakdown: string[] = [
      `capability_match ${capMatch.toFixed(2)} x${weights.capability.toFixed(2)}`,
      `cost_fit ${cost.toFixed(2)} x${weights.cost.toFixed(2)}`,
      `reliability ${reliability.toFixed(2)} x${weights.reliability.toFixed(2)}`,
      `latency_fit ${latency.toFixed(2)} x${weights.latency.toFixed(2)}`,
      `diversity ${diversityScore.toFixed(2)} x${weights.diversity.toFixed(2)}`,
      `cache_bonus ${cacheBonus.toFixed(2)} x${weights.cache.toFixed(2)}`,
      `freshness ${fresh.toFixed(2)} x${weights.freshness.toFixed(2)}`,
      `context_fit ${context.toFixed(2)} x${weights.context.toFixed(2)}`,
    ];
    if (typeof ageDays === "number") {
      breakdown.push(`age_days ${ageDays.toFixed(0)}`);
    }
    if (quickReplyBonus > 0) {
      breakdown.push(`quick_reply_bonus +${quickReplyBonus.toFixed(3)}`);
      reasonTags.push("quick reply lane");
    }

    const recentModelPenalty = recentModelMultiplier(model.modelId, recentModels);
    const providerPenalty = providerRepeatMultiplier(provider, recentProviders);

    const cacheWarmEligible =
      cacheWarm
      && input.requestClass !== "T3"
      && input.stakes !== "high"
      && !input.needsSearch
      && input.mode !== "research"
      && input.mode !== "exam"
      && input.mode !== "marker";

    if (input.routerMode !== "manual" && (!cacheWarm || !cacheWarmEligible)) {
      if (recentModelPenalty < 1) {
        multiplier *= recentModelPenalty;
        breakdown.push(`recent_model_multiplier x${recentModelPenalty.toFixed(2)}`);
        reasonTags.push("recent-model diversity");
      }
      if (providerPenalty < 1) {
        multiplier *= providerPenalty;
        breakdown.push(`provider_repeat_multiplier x${providerPenalty.toFixed(2)}`);
        reasonTags.push("provider diversity");
      }
    } else if (cacheWarmEligible) {
      breakdown.push("diversity penalties skipped (warm cache)");
      reasonTags.push("warm cache exception");
    } else if (cacheWarm) {
      breakdown.push("warm cache ignored for high-complexity route");
    }

    if (freshnessMultiplierValue < 1) {
      multiplier *= freshnessMultiplierValue;
      breakdown.push(`freshness_multiplier x${freshnessMultiplierValue.toFixed(2)}`);
      reasonTags.push("freshness penalty");
    }

    if (cacheWarmEligible) {
      multiplier *= 1.22;
      breakdown.push("cache_warm_boost x1.22");
      reasonTags.push("cache-aware priority");
    } else if (cacheWarm) {
      multiplier *= 1.04;
      breakdown.push("cache_hint_boost x1.04");
    }

    if (preferredIds.has(model.modelId)) {
      multiplier *= 1.08;
      breakdown.push("preferred_model_multiplier x1.08");
      reasonTags.push("preferred");
    }

    if ((input.assignmentLevel === "L4" || input.preferLargeContext) && context >= 0.85) {
      multiplier *= 1.04;
      breakdown.push("large_context_bonus x1.04");
      reasonTags.push("large-context fit");
    }

    if (input.mode !== "image" && !input.hasAttachments && looksImageTunedModel(model)) {
      multiplier *= 0.72;
      breakdown.push("image_tuned_penalty x0.72");
      reasonTags.push("text-first routing");
    }

    const recentFailureCircuitTriggered =
      (stat?.consecutiveFailureCount ?? 0) >= 2
      && typeof stat?.lastFailureAt === "number"
      && Date.now() - stat.lastFailureAt <= FAILURE_CIRCUIT_WINDOW_MS
      && !cacheWarm;
    if (recentFailureCircuitTriggered && input.routerMode !== "manual") {
      multiplier *= 0.15;
      reasonTags.push("circuit breaker");
      breakdown.push(
        `recent_failure_circuit x0.15 (${Math.max(0, stat?.consecutiveFailureCount ?? 0)} consecutive failures)`,
      );
    }

    const totalRuns = Math.max(0, (stat?.successCount ?? 0) + (stat?.failureCount ?? 0));
    const challengerState: "challenger" | "normal" | "deprioritized" =
      stat?.challengerState === "challenger" || stat?.challengerState === "normal" || stat?.challengerState === "deprioritized"
        ? stat.challengerState
        : totalRuns < 5
          ? "challenger"
          : totalRuns >= 12 && reliability < 0.3
            ? "deprioritized"
            : "normal";
    const isChallenger = challengerState === "challenger";
    if (challengerState === "challenger") {
      if (challengerAllowed) {
        reasonTags.push("challenger eligible");
        breakdown.push("challenger_lane eligible (exploration + low stakes)");
      } else {
        multiplier *= 0.5;
        reasonTags.push("challenger gated");
        breakdown.push("challenger_gate_multiplier x0.50");
      }
    } else if (challengerState === "deprioritized") {
      multiplier *= 0.5;
      reasonTags.push("challenger demoted");
      breakdown.push("deprioritized_multiplier x0.50");
    } else if (totalRuns >= 12 && (stat?.qualityScore ?? reliability) > 0.6) {
      reasonTags.push("challenger promoted");
      breakdown.push("promotion_signal reliability>0.60 after 12 runs");
    }

    const rawScore = Math.max(0, (weightedScore + quickReplyBonus) * multiplier);

    scored.push({
      modelId: model.modelId,
      provider,
      dynamicTier: tier,
      rawScore,
      normalizedScore: 0,
      breakdown: [
        ...breakdown,
        `weighted_score ${weightedScore.toFixed(3)}`,
        `final_multiplier ${multiplier.toFixed(3)}`,
        `challenger_state ${challengerState}`,
      ],
      reasonTags,
      isChallenger,
      cacheWarm,
    });
  }

  if (scored.length === 0) {
    const fallbackModel = input.manualModel || "openrouter/auto";
    const routingDurationMs = Math.max(0, Math.round(nowMs() - startedAt));
    return {
      selectedModel: fallbackModel,
      fallbackModels: [],
      lane: "scored",
      reason: `No eligible catalog model for ${input.phaseLabel.toLowerCase()}`,
      candidates: [{ modelId: fallbackModel, allowed: true, score: 0.01, reason: "Emergency fallback" }],
      phase: {
        id: input.phaseId,
        label: input.phaseLabel,
        status: "planned",
        thinkingLevel: input.thinkingLevel,
        model: fallbackModel,
      },
      routingDurationMs,
    };
  }

  if (shouldExplore && scored.length > 1) {
    const candidates = scored.slice(1);
    const pickSeed = hashToUnit(`${input.seedKey}:${input.phaseId}:explore-pick`);
    const picked = candidates[Math.min(candidates.length - 1, Math.floor(pickSeed * candidates.length))];
    if (picked) {
      picked.rawScore *= 1.5;
      picked.breakdown.push("exploration_boost x1.50");
      picked.reasonTags.push("exploration");
      scored.sort((a, b) => b.rawScore - a.rawScore || a.modelId.localeCompare(b.modelId));
    }
  }

  scored.sort((a, b) => b.rawScore - a.rawScore || a.modelId.localeCompare(b.modelId));

  if (input.routerMode !== "manual" && scored.length >= 3) {
    const topThree = scored.slice(0, 3);
    const spread = topThree[0]!.rawScore - topThree[2]!.rawScore;
    if (spread <= 0.05) {
      for (const row of topThree) {
        const noise = deterministicSignedNoise(
          `${input.seedKey}:${input.phaseId}:noise:${row.modelId}`,
          CLOSE_SCORE_NOISE_RANGE,
        );
        row.rawScore = Math.max(0, row.rawScore + noise);
        row.breakdown.push(`close_score_noise ${noise >= 0 ? "+" : ""}${noise.toFixed(3)}`);
      }
      scored.sort((a, b) => b.rawScore - a.rawScore || a.modelId.localeCompare(b.modelId));
    }
  }

  normalizeScores(scored);
  scored.sort((a, b) => b.rawScore - a.rawScore || a.modelId.localeCompare(b.modelId));

  const topScore = scored[0]!.rawScore;
  const weightedWindow = scored.filter((row) => row.rawScore >= topScore * WEIGHTED_RANDOM_WINDOW);
  const weightedPick =
    input.routerMode !== "manual" && weightedWindow.length > 1
      ? chooseWeightedCandidate(weightedWindow, `${input.seedKey}:${input.phaseId}:weighted-pick`)
      : undefined;
  const selected = weightedPick ?? scored[0]!;
  const selectionMethod =
    weightedPick && weightedWindow.length > 1
      ? `Weighted random from ${weightedWindow.length} close candidates`
      : "Top pick";
  const fallbackModels: string[] = [];
  const usedProviders = new Set<string>([selected.provider]);
  for (const row of scored) {
    if (row.modelId === selected.modelId) continue;
    if (fallbackModels.length >= 5) break;
    if (!usedProviders.has(row.provider) || fallbackModels.length < 2) {
      fallbackModels.push(row.modelId);
      usedProviders.add(row.provider);
    }
  }

  const candidates: RouteTraceCandidate[] = scored.slice(0, 12).map((row) => ({
    modelId: row.modelId,
    allowed: true,
    score: Number(row.normalizedScore.toFixed(3)),
    reason:
      row.reasonTags.length > 0
        ? row.reasonTags.join(" · ")
        : `Unified weighted routing for ${input.phaseLabel.toLowerCase()}`,
    scoreBreakdown: [
      ...row.breakdown,
      row.modelId === selected.modelId ? `selection_method ${selectionMethod}` : undefined,
      `provider ${row.provider}`,
      `tier ${row.dynamicTier}`,
      row.cacheWarm ? "cache_state warm" : "cache_state cold",
      row.isChallenger ? "pool challenger" : "pool standard",
    ].filter((value): value is string => Boolean(value)),
  }));

  const routingDurationMs = Math.max(0, Math.round(nowMs() - startedAt));
  const reasonParts = [
    `Unified weighted score selected ${selected.modelId} for ${input.phaseLabel.toLowerCase()}.`,
    `${selectionMethod}.`,
    shouldExplore ? "Exploration mode was active." : "Exploration mode was inactive.",
  ];
  if (selected.cacheWarm) reasonParts.push("Prompt cache was warm for this conversation.");
  if (selected.isChallenger) reasonParts.push("Selected model is currently in challenger onboarding.");

  return {
    selectedModel: selected.modelId,
    fallbackModels,
    lane: selected.isChallenger ? "challenger" : "scored",
    reason: reasonParts.join(" "),
    candidates,
    phase: {
      id: input.phaseId,
      label: input.phaseLabel,
      status: "planned",
      thinkingLevel: input.thinkingLevel,
      model: selected.modelId,
    },
    routingDurationMs,
  };
}
