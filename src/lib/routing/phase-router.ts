import type { ThinkingLevel } from "@/lib/contracts/studyModes";
import {
  isModelAllowedInTier,
  modelSupportsCapability,
  type CatalogModelEntry,
  type ModelCapability,
  type ModelRuntimeStat,
} from "@/lib/model-selection";
import type { RouteTraceCandidate, RouteTracePhase, SpendingTier, StudyMode } from "@/types";

export type RoutingLane = "stable" | "fresh" | "challenger";
type StakeLevel = "low" | "medium" | "high";

export type PhaseRoutingInput = {
  phaseId: string;
  phaseLabel: string;
  mode: StudyMode;
  routerMode: "auto" | "manual" | "openrouter_auto";
  manualModel?: string;
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
  recentModels?: string[];
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
  model: CatalogModelEntry;
  modelId: string;
  provider: string;
  lane: RoutingLane;
  score: number;
  reasons: string[];
  breakdown: string[];
};

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
  const input = typeof model.inputCostPerM === "number" ? Math.max(0, model.inputCostPerM) : 6;
  const output = typeof model.outputCostPerM === "number" ? Math.max(0, model.outputCostPerM) : 8;
  return (input + output) / 2;
}

function reliabilityScore(stat?: ModelRuntimeStat) {
  if (!stat) return 0.56;
  const success = Math.max(0, stat.successCount);
  const failure = Math.max(0, stat.failureCount);
  return (success + 1) / (success + failure + 2);
}

function latencyScore(stat?: ModelRuntimeStat) {
  const ms = stat?.avgLatencyMs;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return 0.58;
  if (ms <= 2500) return 1;
  if (ms <= 4500) return 0.8;
  if (ms <= 7500) return 0.55;
  if (ms <= 11_000) return 0.32;
  return 0.18;
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

function freshnessScore(model: CatalogModelEntry) {
  const releaseTs = parseReleaseTime(model);
  if (!releaseTs) return 0.55;
  const ageDays = Math.max(0, (Date.now() - releaseTs) / (24 * 60 * 60 * 1000));
  if (ageDays <= 30) return 1;
  if (ageDays <= 90) return 0.85;
  if (ageDays <= 180) return 0.7;
  if (ageDays <= 365) return 0.5;
  return 0.32;
}

function contextFit(model: CatalogModelEntry, messageLength: number) {
  if (!model.contextLength || model.contextLength <= 0) return 0.62;
  const ratio = messageLength / model.contextLength;
  if (ratio <= 0.22) return 1;
  if (ratio <= 0.42) return 0.85;
  if (ratio <= 0.68) return 0.6;
  if (ratio <= 0.9) return 0.35;
  return 0.08;
}

function phaseFit(params: {
  model: CatalogModelEntry;
  required: ModelCapability[];
  preferred: ModelCapability[];
  mode: StudyMode;
  needsSearch?: boolean;
}) {
  for (const requiredCapability of params.required) {
    if (!modelSupportsCapability(params.model, requiredCapability)) return 0;
  }
  let score = 0.55;
  for (const preferredCapability of params.preferred) {
    if (modelSupportsCapability(params.model, preferredCapability)) score += 0.12;
  }
  if (params.mode === "research" || params.mode === "marker" || params.mode === "exam") {
    if (modelSupportsCapability(params.model, "reasoning")) score += 0.1;
  }
  if (params.needsSearch && modelSupportsCapability(params.model, "search")) {
    score += 0.1;
  }
  return Math.min(1, score);
}

function costFit(costPerM: number, stakes: StakeLevel) {
  const target = stakes === "low" ? 2.2 : stakes === "medium" ? 8.5 : 18;
  if (costPerM <= 0.02) return 1;
  if (costPerM <= target) return 0.92;
  if (costPerM <= target * 1.6) return 0.65;
  if (costPerM <= target * 2.8) return 0.4;
  return 0.2;
}

function laneForCandidate(params: {
  reliability: number;
  freshness: number;
  totalRuns: number;
}) {
  if (params.reliability >= 0.72 && params.totalRuns >= 12) return "stable" as const;
  if (params.freshness >= 0.72 || params.totalRuns <= 5) return "fresh" as const;
  return "challenger" as const;
}

function laneWeights(stakes: StakeLevel, needsSearch?: boolean) {
  const base =
    stakes === "high"
      ? { stable: 0.68, fresh: 0.22, challenger: 0.1 }
      : stakes === "low"
        ? { stable: 0.44, fresh: 0.35, challenger: 0.21 }
        : { stable: 0.56, fresh: 0.3, challenger: 0.14 };
  if (!needsSearch) return base;
  return {
    stable: Math.max(0.3, base.stable - 0.04),
    fresh: Math.min(0.46, base.fresh + 0.04),
    challenger: base.challenger,
  };
}

function selectLane(weights: ReturnType<typeof laneWeights>, seed: number): RoutingLane {
  const stableEnd = weights.stable;
  const freshEnd = stableEnd + weights.fresh;
  if (seed <= stableEnd) return "stable";
  if (seed <= freshEnd) return "fresh";
  return "challenger";
}

function repetitionPenalty(modelId: string, recentModels: string[]) {
  const hits = recentModels.filter((item) => item === modelId).length;
  if (hits <= 0) return 0;
  return Math.min(0.18, hits * 0.06);
}

function providerStreakPenalty(provider: string, recentProviders: string[]) {
  let streak = 0;
  for (let i = recentProviders.length - 1; i >= 0; i -= 1) {
    if (recentProviders[i] !== provider) break;
    streak += 1;
  }
  if (streak <= 1) return 0;
  return Math.min(0.12, (streak - 1) * 0.04);
}

export function buildPhasePlan(params: {
  routeNeedsRetrieval: boolean;
  routeNeedsSearch: boolean;
  multiAgentEnabled: boolean;
  shouldVerify: boolean;
  shouldRepair: boolean;
  shouldWriteMemory: boolean;
  shouldGenerateTitle: boolean;
}): RouteTracePhase[] {
  const phases: RouteTracePhase[] = [
    { id: "routing", label: "Planning the route", status: "completed" },
  ];
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
  if (params.shouldGenerateTitle) phases.push({ id: "title", label: "Naming this chat", status: "planned" });
  return phases;
}

export function selectModelForPhase(input: PhaseRoutingInput): PhaseRoutingDecision {
  const startedAt = nowMs();
  const recentModels = (input.recentModels ?? []).slice(-10);
  const recentProviders = recentModels.map(providerFromModelId);
  const required = input.requiredCapabilities ?? [];
  const preferred = input.preferredCapabilities ?? [];
  const catalog = input.modelCatalog.filter((model) => model.modelId && model.modelId !== "openrouter/auto");
  const preferredIds = new Set((input.preferredModelIds ?? []).filter(Boolean));
  const seed = hashToUnit(`${input.seedKey}:${input.phaseId}:${input.mode}:${input.messageLength}`);
  const weights = laneWeights(input.stakes, input.needsSearch);

  const allowedManual =
    input.routerMode === "manual" &&
    input.manualModel &&
    input.modelCatalog.some((model) => model.modelId === input.manualModel && isModelAllowedInTier(model, input.spendingTier));

  if (allowedManual && input.manualModel) {
    const manualProvider = providerFromModelId(input.manualModel);
    const candidates: RouteTraceCandidate[] = [
      {
        modelId: input.manualModel,
        allowed: true,
        score: 1,
        reason: "Manual model lock",
        scoreBreakdown: ["Manual selection"],
      },
    ];
    const fallbackModels: string[] = [];
    return {
      selectedModel: input.manualModel,
      fallbackModels,
      lane: "stable",
      reason: `Manual model lock for ${input.phaseLabel.toLowerCase()}`,
      candidates,
      phase: {
        id: input.phaseId,
        label: input.phaseLabel,
        status: "planned",
        thinkingLevel: input.thinkingLevel,
        model: input.manualModel,
      },
      routingDurationMs: Math.max(0, Math.round(nowMs() - startedAt)),
    };
  }

  if (input.routerMode === "openrouter_auto" && input.spendingTier === "normal") {
    const rankedFallbacks = catalog
      .filter((model) => isModelAllowedInTier(model, input.spendingTier))
      .slice(0, 5)
      .map((model) => model.modelId);
    return {
      selectedModel: "openrouter/auto",
      fallbackModels: rankedFallbacks,
      lane: "stable",
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
      routingDurationMs: Math.max(0, Math.round(nowMs() - startedAt)),
    };
  }

  const scored: ScoredCandidate[] = [];
  for (const model of catalog) {
    if (!isModelAllowedInTier(model, input.spendingTier)) continue;
    const fit = phaseFit({
      model,
      required,
      preferred,
      mode: input.mode,
      needsSearch: input.needsSearch,
    });
    if (fit <= 0) continue;

    const stat = input.modelRuntimeStats?.[model.modelId];
    const reliability = reliabilityScore(stat);
    const latency = latencyScore(stat);
    const freshness = freshnessScore(model);
    const context = contextFit(model, input.messageLength);
    const cost = costFit(normalizeCost(model), input.stakes);
    const totalRuns = Math.max(0, (stat?.successCount ?? 0) + (stat?.failureCount ?? 0));
    const lane = laneForCandidate({ reliability, freshness, totalRuns });
    const provider = providerFromModelId(model.modelId);

    const repeatPenalty = repetitionPenalty(model.modelId, recentModels);
    const providerPenalty = providerStreakPenalty(provider, recentProviders);
    const previousPenalty = input.previousModelUsed && input.previousModelUsed === model.modelId ? 0.08 : 0;
    const antiLockIn = Math.max(0, 1 - repeatPenalty - providerPenalty - previousPenalty);
    const laneBoost = lane === selectLane(weights, seed) ? 0.08 : lane === "fresh" ? 0.03 : 0;
    const preferredBoost = preferredIds.has(model.modelId) ? 0.05 : 0;

    const score =
      fit * 0.24 +
      reliability * 0.17 +
      freshness * 0.13 +
      cost * 0.16 +
      latency * 0.1 +
      context * 0.1 +
      antiLockIn * 0.1 +
      laneBoost +
      preferredBoost;

    scored.push({
      model,
      modelId: model.modelId,
      provider,
      lane,
      score,
      reasons: [
        lane === "stable" ? "stable lane" : lane === "fresh" ? "fresh lane" : "challenger lane",
        preferredIds.has(model.modelId) ? "preferred" : "",
      ].filter(Boolean),
      breakdown: [
        `phaseFit ${fit.toFixed(2)}`,
        `liveReward ${reliability.toFixed(2)}`,
        `freshness ${freshness.toFixed(2)}`,
        `costFit ${cost.toFixed(2)}`,
        `latencyFit ${latency.toFixed(2)}`,
        `contextFit ${context.toFixed(2)}`,
        `antiLockIn ${antiLockIn.toFixed(2)}`,
      ],
    });
  }

  scored.sort((a, b) => b.score - a.score || a.modelId.localeCompare(b.modelId));
  const preferredLane = selectLane(weights, seed);
  const laneRows = scored.filter((row) => row.lane === preferredLane);
  const selected = laneRows[0] ?? scored[0];

  if (!selected) {
    const fallbackModel = input.manualModel || "openrouter/auto";
    return {
      selectedModel: fallbackModel,
      fallbackModels: [],
      lane: preferredLane,
      reason: `No eligible catalog model for ${input.phaseLabel.toLowerCase()}`,
      candidates: [{ modelId: fallbackModel, allowed: true, score: 0.01, reason: "Emergency fallback" }],
      phase: {
        id: input.phaseId,
        label: input.phaseLabel,
        status: "planned",
        thinkingLevel: input.thinkingLevel,
        model: fallbackModel,
      },
      routingDurationMs: Math.max(0, Math.round(nowMs() - startedAt)),
    };
  }

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
    score: Number(Math.max(0, Math.min(1, row.score)).toFixed(3)),
    reason: row.reasons.length > 0 ? row.reasons.join(" · ") : `Scored for ${input.phaseLabel.toLowerCase()}`,
    scoreBreakdown: row.breakdown,
  }));

  const reason = `Phase router selected ${selected.modelId} in ${preferredLane} lane for ${input.phaseLabel.toLowerCase()}`;
  return {
    selectedModel: selected.modelId,
    fallbackModels,
    lane: preferredLane,
    reason,
    candidates,
    phase: {
      id: input.phaseId,
      label: input.phaseLabel,
      status: "planned",
      thinkingLevel: input.thinkingLevel,
      model: selected.modelId,
    },
    routingDurationMs: Math.max(0, Math.round(nowMs() - startedAt)),
  };
}
