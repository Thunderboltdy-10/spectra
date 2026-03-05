import { CHEAP_MODEL_DEFAULTS, MODEL_CONFIG, MODEL_COST_BLOCK_LIST, ROUTER_FALLBACKS } from "@/lib/model-config";
import {
  isModelAllowedInTier,
  modelSupportsCapability,
  pickModelAndFallbacks,
  rankCatalogModels,
  type CatalogModelEntry,
} from "@/lib/model-selection";
import type { ModelRouteInput, ModelRouteResult, RouteTrace, RouteTraceCandidate } from "@/types";

const multimodalExts = ["pdf", "png", "jpg", "jpeg", "webp", "docx", "gif", "heic", "heif"];
const tabularExts = ["csv", "tsv", "xlsx", "xls"];

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function hasMultimodalAttachment(attachmentTypes: string[]) {
  const normalized = attachmentTypes.map((type) => type.toLowerCase());
  return normalized.some((type) => {
    if (type.includes("/")) {
      return (
        type.startsWith("image/") ||
        type === "application/pdf" ||
        type.includes("wordprocessingml") ||
        type === "application/msword"
      );
    }
    return multimodalExts.includes(type);
  });
}

function hasTabularAttachment(attachmentTypes: string[]) {
  const normalized = attachmentTypes.map((type) => type.toLowerCase());
  return normalized.some((type) => {
    if (type.includes("/")) {
      return (
        type.includes("spreadsheet") ||
        type.includes("excel") ||
        type.includes("csv")
      );
    }
    return tabularExts.includes(type);
  });
}

function isFreeModel(modelId: string) {
  return modelId.includes(":free");
}

function isBudgetGuardedTier(tier: ModelRouteInput["spendingTier"]) {
  return tier === "expensive_blocked" || tier === "cheap_only" || tier === "free_only";
}

function allowsPaidTier(tier: ModelRouteInput["spendingTier"]) {
  return tier === "normal" || tier === "expensive_blocked";
}

function eliminationReason(modelId: string, tier: ModelRouteInput["spendingTier"]) {
  if (isBudgetGuardedTier(tier) && modelId === MODEL_CONFIG.autoRouter) {
    return "openrouter_auto disabled under budget guard";
  }

  if (isBudgetGuardedTier(tier) && MODEL_COST_BLOCK_LIST.has(modelId)) {
    return "blocked by MODEL_COST_BLOCK_LIST";
  }

  if (tier === "free_only" && !isFreeModel(modelId)) {
    return "free_only tier requires free models";
  }

  if (tier === "cheap_only" && !isFreeModel(modelId) && !CHEAP_MODEL_DEFAULTS.has(modelId)) {
    return "cheap_only tier excludes this paid model";
  }

  return undefined;
}

export function canUseInTier(
  modelId: string,
  tier: ModelRouteInput["spendingTier"],
  catalog?: CatalogModelEntry[],
) {
  if (catalog && catalog.length > 0) {
    const model = catalog.find((item) => item.modelId === modelId);
    if (model) return isModelAllowedInTier(model, tier);
    if (modelId === "openrouter/auto") return tier === "normal";
  }
  return !eliminationReason(modelId, tier);
}

function fallbackFor(model: string, tier: ModelRouteInput["spendingTier"]) {
  const defaults = ROUTER_FALLBACKS[model] ?? [MODEL_CONFIG.tutorFast, MODEL_CONFIG.marker];
  return defaults.filter((candidate) => canUseInTier(candidate, tier));
}

function enforceTier(model: string, tier: ModelRouteInput["spendingTier"]) {
  if (canUseInTier(model, tier)) return model;
  if (tier === "free_only") return MODEL_CONFIG.tutorFast;
  if (tier === "cheap_only") return MODEL_CONFIG.smartCheap;
  if (tier === "expensive_blocked") return MODEL_CONFIG.smartCheap;
  return MODEL_CONFIG.tutorFast;
}

function pushCandidate(
  candidates: RouteTraceCandidate[],
  modelId: string,
  tier: ModelRouteInput["spendingTier"],
  score?: number,
  reason?: string,
  scoreBreakdown?: string[],
) {
  const eliminatedBecause = eliminationReason(modelId, tier);
  candidates.push({
    modelId,
    allowed: !eliminatedBecause,
    score,
    reason,
    scoreBreakdown,
    eliminatedBecause,
  });
}

function buildTrace(params: {
  input: ModelRouteInput;
  candidates: RouteTraceCandidate[];
  selectedModel: string;
  reason: string;
  complexPrompt: boolean;
  promptCategory: string;
  multimodalNeeded: boolean;
  routingStartedAt: number;
}): RouteTrace {
  const duration = Math.max(0, Math.round(nowMs() - params.routingStartedAt));

  return {
    inputs: {
      routerMode: params.input.routerMode,
      manualModel: params.input.manualModel,
      mode: params.input.mode,
      thinkingLevel: params.input.thinkingLevel,
      complexPrompt: params.complexPrompt,
      promptCategory: params.promptCategory,
      questionType: params.input.questionType,
      isMultipart: params.input.isMultipart,
      needsSearch: params.input.needsSearch,
      needsRag: params.input.needsRag ?? false,
      needsVision: params.multimodalNeeded,
      needsTabular: params.input.hasAttachments && hasTabularAttachment(params.input.attachmentTypes),
      spendingTier: params.input.spendingTier,
      hasAttachments: params.input.hasAttachments,
      attachmentTypes: params.input.attachmentTypes,
      promptEnhanced: params.input.promptEnhanced ?? false,
      messageLength: params.input.messageLength,
      conversationLength: params.input.conversationLength,
      previousModelUsed: params.input.previousModelUsed,
      agentPreferredModel: params.input.agentPreferredModel,
    },
    candidates: params.candidates.length > 0 ? params.candidates : [{ modelId: params.selectedModel, allowed: true }],
    selected: {
      modelId: params.selectedModel,
      reason: params.reason,
    },
    toolchain: [],
    fallbacks: [],
    routingDurationMs: duration,
  };
}

function estimateComplexity(input: ModelRouteInput, complexPrompt: boolean) {
  const wordCount = Math.max(1, Math.round(input.messageLength / 5));
  const wordFactor = Math.min(1, wordCount / 320);
  const thinkingFactor = input.thinkingLevel === "high" ? 1 : input.thinkingLevel === "medium" ? 0.55 : 0.2;
  const toolFactor = (input.needsSearch ? 0.18 : 0) + (input.needsRag ? 0.12 : 0) + (input.hasAttachments ? 0.08 : 0);
  const complexBonus = complexPrompt ? 0.16 : 0;
  const multipartBonus = input.isMultipart ? 0.08 : 0;
  const questionBonus =
    input.questionType === "evaluate" || input.questionType === "compare"
      ? 0.08
      : input.questionType === "why" || input.questionType === "how"
        ? 0.04
        : 0;
  return Math.min(1, wordFactor * 0.4 + thinkingFactor * 0.3 + toolFactor + complexBonus + multipartBonus + questionBonus);
}

function isReasoningHeavyModel(modelId: string) {
  return /(reason|r1|o3|o4|opus|sonnet|gemini.*pro|sonar-pro)/i.test(modelId);
}

function isExpensiveModel(modelId: string) {
  if (MODEL_COST_BLOCK_LIST.has(modelId)) return true;
  if (modelId.includes(":free")) return false;
  if (CHEAP_MODEL_DEFAULTS.has(modelId)) return false;
  return /(opus|o3|o4|sonar-pro|gemini-2\.5-pro|gpt-5|claude-4)/i.test(modelId);
}

function modelScoreBreakdown(params: {
  input: ModelRouteInput;
  modelId: string;
  baseModel: string;
  complexity: number;
}) {
  const breakdown: string[] = [];
  let score = 0.6;

  if (params.modelId === params.baseModel) {
    score += 0.2;
    breakdown.push("base route prior +0.20");
  }

  if (params.input.agentPreferredModel && params.input.agentPreferredModel === params.modelId) {
    score += 0.12;
    breakdown.push("agent preferred model +0.12");
  }

  if (params.input.previousModelUsed && params.input.previousModelUsed === params.modelId) {
    score += 0.05;
    breakdown.push("conversation continuity +0.05");
  }

  const agentBoost = params.input.agentTopModels?.find((item) => item.modelId === params.modelId);
  if (agentBoost) {
    const normalized = Math.max(0, Math.min(1, agentBoost.score));
    const boost = 0.1 * normalized;
    score += boost;
    breakdown.push(`agent_model_boost +${boost.toFixed(2)}`);
  }

  const expensive = isExpensiveModel(params.modelId);
  if (params.complexity < 0.3) {
    if (expensive) {
      score -= 0.15;
      breakdown.push("costEfficiency -0.15 (simple prompt)");
    } else {
      score += 0.04;
      breakdown.push("costEfficiency +0.04 (simple prompt)");
    }
  } else if (params.complexity > 0.72) {
    if (expensive) {
      score += 0.08;
      breakdown.push("costEfficiency +0.08 (complex prompt)");
    }
    if (isReasoningHeavyModel(params.modelId)) {
      score += 0.05;
      breakdown.push("reasoning capability +0.05");
    }
  } else {
    breakdown.push("costEfficiency +0.00 (medium prompt)");
  }

  if (params.input.needsSearch && /(sonar|perplexity|search|web)/i.test(params.modelId)) {
    score += 0.05;
    breakdown.push("search affinity +0.05");
  }
  if (params.input.needsRag && /(claude|gpt|gemini|deepseek|qwen|mistral|llama)/i.test(params.modelId)) {
    score += 0.02;
    breakdown.push("retrieval synthesis +0.02");
  }
  if (
    (params.input.promptCategory === "debate" ||
      params.input.promptCategory === "comparison" ||
      params.input.promptCategory === "synthesis") &&
    isReasoningHeavyModel(params.modelId)
  ) {
    score += 0.04;
    breakdown.push("argument/synthesis reasoning +0.04");
  }
  if (
    params.input.promptCategory === "practical_application" &&
    /(gpt|claude|gemini|qwen|mistral|llama|deepseek|openai)/i.test(params.modelId)
  ) {
    score += 0.03;
    breakdown.push("practical planning fluency +0.03");
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    breakdown,
  };
}

function rankCandidates(params: {
  input: ModelRouteInput;
  candidates: RouteTraceCandidate[];
  proposed: string[];
  baseModel: string;
  tier: ModelRouteInput["spendingTier"];
  complexPrompt: boolean;
}): { selectedModel: string; rankedFallbacks: string[] } {
  const complexity = estimateComplexity(params.input, params.complexPrompt);
  const seen = new Set<string>();
  const rows: Array<{ modelId: string; score: number; breakdown: string[] }> = [];

  for (const modelId of params.proposed) {
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);

    const eliminatedBecause = eliminationReason(modelId, params.tier);
    if (eliminatedBecause) {
      params.candidates.push({
        modelId,
        allowed: false,
        score: 0,
        reason: "Excluded before scoring",
        eliminatedBecause,
      });
      continue;
    }

    const scored = modelScoreBreakdown({
      input: params.input,
      modelId,
      baseModel: params.baseModel,
      complexity,
    });
    rows.push({ modelId, score: scored.score, breakdown: scored.breakdown });
  }

  rows.sort((a, b) => b.score - a.score || a.modelId.localeCompare(b.modelId));
  for (const row of rows) {
    params.candidates.push({
      modelId: row.modelId,
      allowed: true,
      score: row.score,
      reason: "Candidate scored by route heuristics",
      scoreBreakdown: row.breakdown,
    });
  }

  const selectedModel = rows[0]?.modelId ?? enforceTier(params.baseModel, params.tier);
  const rankedFallbacks = rows
    .map((row) => row.modelId)
    .filter((modelId) => modelId !== selectedModel);
  return { selectedModel, rankedFallbacks };
}

function finalizeRoute(params: {
  input: ModelRouteInput;
  primaryModel: string;
  fallbackModels: string[];
  verificationModel?: string;
  reason: string;
  autoEnhanced: boolean;
  searchEnabled: boolean;
  candidates: RouteTraceCandidate[];
  complexPrompt: boolean;
  promptCategory: string;
  multimodalNeeded: boolean;
  routingStartedAt: number;
}): ModelRouteResult {
  const fallbackModels = params.fallbackModels.filter((candidate) => candidate !== params.primaryModel);
  for (const fallback of fallbackModels) {
    pushCandidate(
      params.candidates,
      fallback,
      params.input.spendingTier,
      undefined,
      "Fallback candidate if primary model is unavailable",
    );
  }

  const trace = buildTrace({
    input: params.input,
    candidates: params.candidates,
    selectedModel: params.primaryModel,
    reason: params.reason,
    complexPrompt: params.complexPrompt,
    promptCategory: params.promptCategory,
    multimodalNeeded: params.multimodalNeeded,
    routingStartedAt: params.routingStartedAt,
  });

  if (params.verificationModel) trace.toolchain.push("marker_verification");
  if (params.searchEnabled) trace.toolchain.push("web_search");
  if (params.input.needsRag) trace.toolchain.push("rag_retrieval");
  if (params.multimodalNeeded) trace.toolchain.push("vision_gate");
  if (params.input.hasAttachments && hasTabularAttachment(params.input.attachmentTypes)) {
    trace.toolchain.push("tabular_analysis");
  }

  return {
    primaryModel: params.primaryModel,
    fallbackModels,
    verificationModel: params.verificationModel,
    reason: params.reason,
    autoEnhanced: params.autoEnhanced,
    searchEnabled: params.searchEnabled,
    trace,
  };
}

function preferredCapabilitiesForRoute(input: ModelRouteInput) {
  const preferred = new Set<"vision" | "reasoning" | "code" | "search" | "image_generation">();
  if (input.mode === "research" || input.mode === "marker" || input.mode === "exam") {
    preferred.add("reasoning");
  }
  if (input.mode === "draft_coach" || input.promptCategory === "code") {
    preferred.add("code");
  }
  if (input.needsSearch || input.mode === "research") {
    preferred.add("search");
  }
  if (input.mode === "image") {
    preferred.add("image_generation");
  }
  return [...preferred];
}

function requiredCapabilitiesForRoute(params: {
  input: ModelRouteInput;
  multimodalNeeded: boolean;
}) {
  const required = new Set<"vision" | "reasoning" | "code" | "search" | "image_generation">();
  if (params.multimodalNeeded) {
    required.add("vision");
  }
  if (params.input.mode === "image") {
    required.add("image_generation");
  }
  return [...required];
}

function dynamicRouteFromCatalog(params: {
  input: ModelRouteInput;
  multimodalNeeded: boolean;
  complexPrompt: boolean;
  promptCategory: string;
  candidates: RouteTraceCandidate[];
  routingStartedAt: number;
}): ModelRouteResult | null {
  const catalog = (params.input.modelCatalog ?? []).filter((model) => model?.modelId);
  if (catalog.length === 0) return null;

  const catalogWithoutAuto = catalog.filter((model) => model.modelId !== "openrouter/auto");
  const requiredCapabilities = requiredCapabilitiesForRoute({
    input: params.input,
    multimodalNeeded: params.multimodalNeeded,
  });
  const preferredCapabilities = preferredCapabilitiesForRoute(params.input);
  const preferredModelIds = [
    params.input.agentPreferredModel,
    params.input.previousModelUsed,
    ...(params.input.agentTopModels ?? []).map((item) => item.modelId),
  ].filter((value): value is string => Boolean(value));

  const pickParams = {
    catalog: catalogWithoutAuto,
    tier: params.input.spendingTier,
    mode: params.input.mode,
    messageLength: params.input.messageLength,
    needsSearch: params.input.needsSearch,
    preferCheap: params.input.mode === "quiz" || params.input.mode === "flashcard",
    preferFast: params.input.mode === "tutor" || params.input.mode === "general",
    requiredCapabilities,
    preferredCapabilities,
    preferredModelIds,
    runtimeStats: params.input.modelRuntimeStats,
  } as const;

  let reason = "Catalog-driven adaptive routing";
  let primaryModel = "";
  let fallbackModels: string[] = [];

  const ranked = rankCatalogModels(pickParams);
  for (const row of ranked.slice(0, 10)) {
    params.candidates.push({
      modelId: row.model.modelId,
      allowed: true,
      score: Number(row.score.toFixed(3)),
      reason: row.reasons.length > 0 ? row.reasons.join(" · ") : "Catalog-driven score",
    });
  }

  if (params.input.routerMode === "manual" && params.input.manualModel) {
    const manualModelId = params.input.manualModel;
    const manualMeta = catalog.find((item) => item.modelId === manualModelId);
    const allowed = manualMeta ? isModelAllowedInTier(manualMeta, params.input.spendingTier) : false;
    params.candidates.unshift({
      modelId: manualModelId,
      allowed,
      score: allowed ? 1 : 0,
      reason: allowed ? "Manual selection" : "Manual model restricted by current budget tier",
      eliminatedBecause: allowed ? undefined : `restricted by ${params.input.spendingTier}`,
    });

    if (allowed) {
      primaryModel = manualModelId;
      fallbackModels = ranked
        .map((row) => row.model.modelId)
        .filter((modelId) => modelId !== manualModelId)
        .slice(0, 4);
      reason = "Manual model lock";
    } else {
      const picked = pickModelAndFallbacks({ ...pickParams, maxFallbacks: 4 });
      primaryModel = picked.selected?.modelId ?? ranked[0]?.model.modelId ?? manualModelId;
      fallbackModels = picked.fallbacks;
      reason = `Manual model restricted by ${params.input.spendingTier}; selected best allowed model`;
    }
  } else if (params.input.routerMode === "openrouter_auto") {
    const autoModel = catalog.find((item) => item.modelId === "openrouter/auto");
    if (autoModel && isModelAllowedInTier(autoModel, params.input.spendingTier)) {
      primaryModel = autoModel.modelId;
      fallbackModels = ranked.map((row) => row.model.modelId).slice(0, 4);
      params.candidates.unshift({
        modelId: "openrouter/auto",
        allowed: true,
        score: 1,
        reason: "OpenRouter auto delegation",
      });
      reason = "OpenRouter auto-router mode";
    } else {
      const picked = pickModelAndFallbacks({ ...pickParams, maxFallbacks: 4 });
      primaryModel = picked.selected?.modelId ?? ranked[0]?.model.modelId ?? catalogWithoutAuto[0]?.modelId ?? "openrouter/auto";
      fallbackModels = picked.fallbacks;
      reason = "Auto-router unavailable under current tier; using catalog-ranked model";
    }
  } else {
    const picked = pickModelAndFallbacks({ ...pickParams, maxFallbacks: 4 });
    primaryModel = picked.selected?.modelId ?? ranked[0]?.model.modelId ?? catalogWithoutAuto[0]?.modelId ?? "";
    fallbackModels = picked.fallbacks;
    reason = "Adaptive catalog route";
  }

  if (!primaryModel) {
    return null;
  }

  if (params.multimodalNeeded) {
    const model = catalog.find((item) => item.modelId === primaryModel);
    if (model && !modelSupportsCapability(model, "vision")) {
      const visionRequirements = [
        ...new Set([...(pickParams.requiredCapabilities ?? []), "vision"]),
      ] as Array<"vision" | "reasoning" | "code" | "search" | "image_generation">;
      const visionPick = pickModelAndFallbacks({
        ...pickParams,
        requiredCapabilities: visionRequirements,
        preferredModelIds: [primaryModel, ...preferredModelIds],
        maxFallbacks: 3,
      });
      if (visionPick.selected) {
        fallbackModels = [
          primaryModel,
          ...fallbackModels.filter((candidate) => candidate !== visionPick.selected?.modelId),
          ...visionPick.fallbacks,
        ];
        primaryModel = visionPick.selected.modelId;
        reason = `${reason}; vision-capable model selected`;
      }
    }
  }

  const verificationCandidates = rankCatalogModels({
    catalog: catalogWithoutAuto.filter((model) => model.modelId !== primaryModel),
    tier: params.input.spendingTier,
    mode: params.input.mode,
    messageLength: params.input.messageLength,
    requiredCapabilities: ["reasoning"],
    preferredCapabilities: ["reasoning"],
    runtimeStats: params.input.modelRuntimeStats,
  });
  const verificationModel =
    params.input.mode === "marker"
      ? verificationCandidates[0]?.model.modelId
      : undefined;

  return finalizeRoute({
    input: params.input,
    primaryModel,
    fallbackModels: fallbackModels.filter((candidate) => candidate !== primaryModel),
    verificationModel,
    reason,
    autoEnhanced: params.input.routerMode !== "manual",
    searchEnabled: params.input.needsSearch,
    candidates: params.candidates,
    complexPrompt: params.complexPrompt,
    promptCategory: params.promptCategory,
    multimodalNeeded: params.multimodalNeeded,
    routingStartedAt: params.routingStartedAt,
  });
}

export function chooseModelRoute(input: ModelRouteInput): ModelRouteResult {
  const routingStartedAt = nowMs();
  const candidates: RouteTraceCandidate[] = [];
  const multimodalNeeded = input.hasAttachments && hasMultimodalAttachment(input.attachmentTypes);
  const tabularNeeded = input.hasAttachments && hasTabularAttachment(input.attachmentTypes);
  const longMessage = input.messageLength > 1200;
  const complexPrompt = longMessage || input.thinkingLevel === "high" || input.studentSeemsStuck || tabularNeeded;
  const promptCategory = input.promptCategory ?? "general";
  const searchAuxModel = input.thinkingLevel === "high" ? MODEL_CONFIG.searchDeep : MODEL_CONFIG.searchFast;
  const paidTier = allowsPaidTier(input.spendingTier);

  const catalogRoute = dynamicRouteFromCatalog({
    input,
    multimodalNeeded,
    complexPrompt,
    promptCategory,
    candidates,
    routingStartedAt,
  });
  if (catalogRoute) {
    return catalogRoute;
  }

  if (input.routerMode === "manual" && input.manualModel) {
    pushCandidate(candidates, input.manualModel, input.spendingTier, 1, "User manually selected this model");
    const primaryModel = enforceTier(input.manualModel, input.spendingTier);
    if (primaryModel !== input.manualModel) {
      pushCandidate(
        candidates,
        primaryModel,
        input.spendingTier,
        0.9,
        `Tier policy override (${input.spendingTier})`,
      );
    }

    return finalizeRoute({
      input,
      primaryModel,
      fallbackModels: fallbackFor(primaryModel, input.spendingTier),
      verificationModel: input.mode === "marker" ? MODEL_CONFIG.verify : undefined,
      reason:
        primaryModel === input.manualModel
          ? "Manual selection"
          : `Manual model restricted by ${input.spendingTier} tier`,
      autoEnhanced: false,
      searchEnabled: input.needsSearch && input.spendingTier !== "free_only",
      candidates,
      complexPrompt,
      promptCategory,
      multimodalNeeded,
      routingStartedAt,
    });
  }

  if (input.routerMode === "openrouter_auto") {
    pushCandidate(candidates, MODEL_CONFIG.autoRouter, input.spendingTier, 1, "Delegated to OpenRouter auto-router");
    const primaryModel = enforceTier(MODEL_CONFIG.autoRouter, input.spendingTier);
    if (primaryModel !== MODEL_CONFIG.autoRouter) {
      pushCandidate(
        candidates,
        primaryModel,
        input.spendingTier,
        0.9,
        `Tier policy override (${input.spendingTier})`,
      );
    }

    return finalizeRoute({
      input,
      primaryModel,
      fallbackModels: fallbackFor(primaryModel, input.spendingTier),
      verificationModel: input.mode === "marker" ? MODEL_CONFIG.verify : undefined,
      reason:
        primaryModel === MODEL_CONFIG.autoRouter
          ? "OpenRouter auto-router mode"
          : `OpenRouter auto restricted by ${input.spendingTier} tier`,
      autoEnhanced: true,
      searchEnabled: input.needsSearch,
      candidates,
      complexPrompt,
      promptCategory,
      multimodalNeeded,
      routingStartedAt,
    });
  }

  if (input.spendingTier === "free_only") {
    let freeModel: string = MODEL_CONFIG.tutorFast;
    let reason = "Free-tier routing";

    if (input.mode === "marker") {
      freeModel = MODEL_CONFIG.marker;
      reason = "Free-tier marker route";
    } else if (input.mode === "research" || (input.mode === "tutor" && promptCategory === "math_science")) {
      freeModel = MODEL_CONFIG.tutorHigh;
      reason = "Free-tier deep reasoning route";
    } else if (input.mode === "exam" || input.mode === "draft_coach") {
      freeModel = MODEL_CONFIG.gptOss;
      reason = "Free-tier structured output route";
    } else if (multimodalNeeded) {
      freeModel = MODEL_CONFIG.multimodal;
      reason = "Free-tier multimodal route";
    } else if (promptCategory === "comparison" || promptCategory === "synthesis" || promptCategory === "debate") {
      freeModel = MODEL_CONFIG.tutorHigh;
      reason = "Free-tier comparative reasoning route";
    } else if (promptCategory === "code") {
      freeModel = MODEL_CONFIG.gptOss;
      reason = "Free-tier code route";
    } else if (tabularNeeded) {
      freeModel = MODEL_CONFIG.gptOss;
      reason = "Free-tier tabular analysis route";
    }

    pushCandidate(candidates, MODEL_CONFIG.tutorFast, input.spendingTier, 0.85, "Free-tier fast tutoring baseline");
    pushCandidate(candidates, MODEL_CONFIG.marker, input.spendingTier, 0.82, "Free-tier grading/review fallback");
    pushCandidate(candidates, MODEL_CONFIG.gptOss, input.spendingTier, 0.81, "Free-tier broad reasoning option");
    pushCandidate(candidates, MODEL_CONFIG.tutorHigh, input.spendingTier, 0.8, "Free-tier deep reasoning option");
    if (multimodalNeeded) {
      pushCandidate(candidates, MODEL_CONFIG.multimodal, input.spendingTier, 0.88, "Free-tier vision-capable choice");
    }

    return finalizeRoute({
      input,
      primaryModel: freeModel,
      fallbackModels: [MODEL_CONFIG.tutorFast, MODEL_CONFIG.marker, MODEL_CONFIG.gptOss].filter(
        (candidate) => candidate !== freeModel && canUseInTier(candidate, "free_only"),
      ),
      verificationModel: input.mode === "marker" ? MODEL_CONFIG.verify : undefined,
      reason,
      autoEnhanced: true,
      searchEnabled: false,
      candidates,
      complexPrompt,
      promptCategory,
      multimodalNeeded,
      routingStartedAt,
    });
  }

  const searchDominantRoute =
    input.needsSearch &&
    input.mode !== "research" &&
    promptCategory !== "research" &&
    !complexPrompt &&
    input.thinkingLevel === "low";

  if (searchDominantRoute) {
    const searchModel = searchAuxModel;
    pushCandidate(
      candidates,
      searchModel,
      input.spendingTier,
      0.92,
      "Prompt looks time-sensitive and benefits from web-enabled routing",
    );
    const primaryModel = enforceTier(searchModel, input.spendingTier);
    if (primaryModel !== searchModel) {
      pushCandidate(
        candidates,
        primaryModel,
        input.spendingTier,
        0.87,
        `Tier policy override (${input.spendingTier})`,
      );
    }

    const ranked = rankCandidates({
      input,
      candidates,
      proposed: [
        searchModel,
        input.agentPreferredModel ?? "",
        input.previousModelUsed ?? "",
        ...(input.agentTopModels ?? []).map((item) => item.modelId),
        ...fallbackFor(searchModel, input.spendingTier),
      ],
      baseModel: searchModel,
      tier: input.spendingTier,
      complexPrompt,
    });
    return finalizeRoute({
      input,
      primaryModel: enforceTier(ranked.selectedModel, input.spendingTier),
      fallbackModels: [...ranked.rankedFallbacks, ...fallbackFor(primaryModel, input.spendingTier)],
      reason: "Research/search-heavy intent detected; routed to web-aware model",
      autoEnhanced: true,
      searchEnabled: true,
      candidates,
      complexPrompt,
      promptCategory,
      multimodalNeeded,
      routingStartedAt,
    });
  }

  if (input.needsSearch) {
    pushCandidate(
      candidates,
      searchAuxModel,
      input.spendingTier,
      0.72,
      "Search augmentation model will run in parallel while preserving a mode-optimized primary model",
    );
  }

  let baseModel: string = MODEL_CONFIG.tutorFast;
  let reason = "General tutoring route";

  if (input.mode === "marker") {
    baseModel = complexPrompt || input.teacherStrictness === "hard" ? MODEL_CONFIG.markerHard : MODEL_CONFIG.marker;
    reason = "Marker mode high-accuracy route";
  } else if (input.mode === "research") {
    baseModel = paidTier && complexPrompt ? MODEL_CONFIG.reasoningPaid : MODEL_CONFIG.tutorHigh;
    reason = "Research mode deep reasoning route";
  } else if (input.mode === "tutor") {
    if (promptCategory === "code") {
      baseModel = paidTier ? MODEL_CONFIG.smartCheap : MODEL_CONFIG.tutorFast;
      reason = "Tutor route optimized for code-oriented prompts";
    } else if (promptCategory === "comparison" || promptCategory === "synthesis" || promptCategory === "debate") {
      baseModel = paidTier ? MODEL_CONFIG.reasoningPaid : MODEL_CONFIG.tutorHigh;
      reason = "Tutor route optimized for comparative and synthesis reasoning";
    } else if (promptCategory === "practical_application") {
      baseModel = paidTier ? MODEL_CONFIG.smartPaid : MODEL_CONFIG.smartCheap;
      reason = "Tutor route optimized for applied planning and implementation";
    } else if (promptCategory === "math_science") {
      baseModel = paidTier ? MODEL_CONFIG.reasoningPaid : MODEL_CONFIG.tutorHigh;
      reason = "Tutor route optimized for math/science reasoning depth";
    } else if (promptCategory === "creative") {
      baseModel = paidTier ? MODEL_CONFIG.smartPaid : MODEL_CONFIG.smartCheap;
      reason = "Tutor route optimized for creative generation quality";
    } else if (complexPrompt && paidTier) {
      baseModel = MODEL_CONFIG.smartPaid;
      reason = "Tutor route for complex prompts";
    } else if (complexPrompt && input.spendingTier === "cheap_only") {
      baseModel = MODEL_CONFIG.smartCheap;
      reason = "Tutor route for complex prompts within cheap tier";
    } else {
      baseModel = paidTier ? MODEL_CONFIG.smartCheap : MODEL_CONFIG.tutorFast;
      reason = "Tutor mode adaptive route";
    }
  } else if (input.mode === "exam") {
    baseModel = paidTier ? MODEL_CONFIG.smartCheap : MODEL_CONFIG.marker;
    reason = "Exam scaffold route with concise evaluation bias";
  } else if (input.mode === "draft_coach") {
    baseModel = paidTier ? MODEL_CONFIG.smartPaid : MODEL_CONFIG.smartCheap;
    reason = "Draft coach route with stronger editorial fluency";
  } else if (input.mode === "quiz" || input.mode === "flashcard") {
    baseModel = MODEL_CONFIG.tutorFast;
    reason = `${input.mode === "quiz" ? "Quiz" : "Flashcard"} generation route`;
  } else if (input.mode === "explain") {
    baseModel = paidTier ? MODEL_CONFIG.smartCheap : MODEL_CONFIG.tutorFast;
    reason = "Explain mode with simplified pedagogy emphasis";
  } else if (input.mode === "image") {
    baseModel = MODEL_CONFIG.tutorFast;
    reason = "Image mode prompt refinement route";
  }

  if (multimodalNeeded) {
    baseModel = MODEL_CONFIG.multimodal;
    reason = `${reason} with multimodal attachments`;
  } else if (tabularNeeded) {
    baseModel = paidTier ? MODEL_CONFIG.reasoningPaid : MODEL_CONFIG.smartCheap;
    reason = `${reason} with tabular attachment analysis`;
  }

  pushCandidate(candidates, baseModel, input.spendingTier, 0.9, reason);
  const ranked = rankCandidates({
    input,
    candidates,
    proposed: [
      baseModel,
      input.needsSearch ? searchAuxModel : "",
      input.agentPreferredModel ?? "",
      input.previousModelUsed ?? "",
      ...(input.agentTopModels ?? []).map((item) => item.modelId),
      ...fallbackFor(baseModel, input.spendingTier),
    ],
    baseModel,
    tier: input.spendingTier,
    complexPrompt,
  });
  const primaryModel = enforceTier(ranked.selectedModel, input.spendingTier);
  if (primaryModel !== baseModel) {
    pushCandidate(
      candidates,
      primaryModel,
      input.spendingTier,
      0.86,
      `Tier policy override (${input.spendingTier})`,
    );
  }

  return finalizeRoute({
    input,
    primaryModel,
    fallbackModels: [...ranked.rankedFallbacks, ...fallbackFor(primaryModel, input.spendingTier)],
    verificationModel: input.mode === "marker" ? MODEL_CONFIG.verify : undefined,
    reason,
    autoEnhanced: true,
    searchEnabled: input.needsSearch,
    candidates,
    complexPrompt,
    promptCategory,
    multimodalNeeded,
    routingStartedAt,
  });
}
