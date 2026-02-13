import { CHEAP_MODEL_DEFAULTS, MODEL_CONFIG, MODEL_COST_BLOCK_LIST, ROUTER_FALLBACKS } from "@/lib/model-config";
import type { ModelRouteInput, ModelRouteResult, RouteTrace, RouteTraceCandidate } from "@/types";

const multimodalExts = ["pdf", "png", "jpg", "jpeg", "webp", "docx", "gif"];

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function hasMultimodalAttachment(attachmentTypes: string[]) {
  const normalized = attachmentTypes.map((type) => type.toLowerCase());
  return normalized.some((type) => multimodalExts.includes(type));
}

function isFreeModel(modelId: string) {
  return modelId.includes(":free");
}

function eliminationReason(modelId: string, tier: ModelRouteInput["spendingTier"]) {
  if (tier !== "normal" && MODEL_COST_BLOCK_LIST.has(modelId)) {
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

function canUseInTier(modelId: string, tier: ModelRouteInput["spendingTier"]) {
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
      needsSearch: params.input.needsSearch,
      needsRag: params.input.needsRag ?? false,
      needsVision: params.multimodalNeeded,
      spendingTier: params.input.spendingTier,
      hasAttachments: params.input.hasAttachments,
      attachmentTypes: params.input.attachmentTypes,
      promptEnhanced: params.input.promptEnhanced ?? false,
      messageLength: params.input.messageLength,
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

  return {
    primaryModel: params.primaryModel,
    fallbackModels,
    verificationModel: params.verificationModel,
    reason: params.reason,
    autoEnhanced: params.autoEnhanced,
    searchEnabled: params.searchEnabled,
    trace: buildTrace({
      input: params.input,
      candidates: params.candidates,
      selectedModel: params.primaryModel,
      reason: params.reason,
      complexPrompt: params.complexPrompt,
      promptCategory: params.promptCategory,
      multimodalNeeded: params.multimodalNeeded,
      routingStartedAt: params.routingStartedAt,
    }),
  };
}

export function chooseModelRoute(input: ModelRouteInput): ModelRouteResult {
  const routingStartedAt = nowMs();
  const candidates: RouteTraceCandidate[] = [];
  const multimodalNeeded = input.hasAttachments && hasMultimodalAttachment(input.attachmentTypes);
  const longMessage = input.messageLength > 1200;
  const complexPrompt = longMessage || input.thinkingLevel === "high" || input.studentSeemsStuck;
  const promptCategory = input.promptCategory ?? "general";

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
    } else if (promptCategory === "code") {
      freeModel = MODEL_CONFIG.gptOss;
      reason = "Free-tier code route";
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

  if (input.needsSearch) {
    const searchModel = input.thinkingLevel === "high" ? MODEL_CONFIG.searchDeep : MODEL_CONFIG.searchFast;
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

    return finalizeRoute({
      input,
      primaryModel,
      fallbackModels: fallbackFor(primaryModel, input.spendingTier),
      reason: "Search intent detected; routed to web-aware model",
      autoEnhanced: true,
      searchEnabled: true,
      candidates,
      complexPrompt,
      promptCategory,
      multimodalNeeded,
      routingStartedAt,
    });
  }

  let baseModel: string = MODEL_CONFIG.tutorFast;
  let reason = "General tutoring route";

  if (input.mode === "marker") {
    baseModel = complexPrompt || input.teacherStrictness === "hard" ? MODEL_CONFIG.markerHard : MODEL_CONFIG.marker;
    reason = "Marker mode high-accuracy route";
  } else if (input.mode === "research") {
    baseModel = input.spendingTier === "normal" && complexPrompt ? MODEL_CONFIG.reasoningPaid : MODEL_CONFIG.tutorHigh;
    reason = "Research mode deep reasoning route";
  } else if (input.mode === "tutor") {
    if (promptCategory === "code") {
      baseModel = input.spendingTier === "normal" ? MODEL_CONFIG.smartCheap : MODEL_CONFIG.tutorFast;
      reason = "Tutor route optimized for code-oriented prompts";
    } else if (promptCategory === "math_science") {
      baseModel = input.spendingTier === "normal" ? MODEL_CONFIG.reasoningPaid : MODEL_CONFIG.tutorHigh;
      reason = "Tutor route optimized for math/science reasoning depth";
    } else if (promptCategory === "creative") {
      baseModel = input.spendingTier === "normal" ? MODEL_CONFIG.smartPaid : MODEL_CONFIG.smartCheap;
      reason = "Tutor route optimized for creative generation quality";
    } else if (complexPrompt && input.spendingTier === "normal") {
      baseModel = MODEL_CONFIG.smartPaid;
      reason = "Tutor route for complex prompts";
    } else if (complexPrompt && input.spendingTier === "cheap_only") {
      baseModel = MODEL_CONFIG.smartCheap;
      reason = "Tutor route for complex prompts within cheap tier";
    } else {
      baseModel = input.spendingTier === "normal" ? MODEL_CONFIG.smartCheap : MODEL_CONFIG.tutorFast;
      reason = "Tutor mode adaptive route";
    }
  } else if (input.mode === "exam") {
    baseModel = input.spendingTier === "normal" ? MODEL_CONFIG.smartCheap : MODEL_CONFIG.marker;
    reason = "Exam scaffold route with concise evaluation bias";
  } else if (input.mode === "draft_coach") {
    baseModel = input.spendingTier === "normal" ? MODEL_CONFIG.smartPaid : MODEL_CONFIG.smartCheap;
    reason = "Draft coach route with stronger editorial fluency";
  } else if (input.mode === "quiz" || input.mode === "flashcard") {
    baseModel = MODEL_CONFIG.tutorFast;
    reason = `${input.mode === "quiz" ? "Quiz" : "Flashcard"} generation route`;
  } else if (input.mode === "explain") {
    baseModel = input.spendingTier === "normal" ? MODEL_CONFIG.smartCheap : MODEL_CONFIG.tutorFast;
    reason = "Explain mode with simplified pedagogy emphasis";
  }

  if (multimodalNeeded) {
    baseModel = MODEL_CONFIG.multimodal;
    reason = `${reason} with multimodal attachments`;
  }

  pushCandidate(candidates, baseModel, input.spendingTier, 0.9, reason);
  const primaryModel = enforceTier(baseModel, input.spendingTier);
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
    fallbackModels: fallbackFor(primaryModel, input.spendingTier),
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
