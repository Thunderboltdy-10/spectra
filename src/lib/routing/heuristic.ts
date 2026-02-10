import { CHEAP_MODEL_DEFAULTS, MODEL_CONFIG, MODEL_COST_BLOCK_LIST, ROUTER_FALLBACKS } from "@/lib/model-config";
import type { ModelRouteInput, ModelRouteOutput } from "@/types";

const multimodalExts = ["pdf", "png", "jpg", "jpeg", "webp", "docx"];

function hasMultimodalAttachment(attachmentTypes: string[]) {
  const normalized = attachmentTypes.map((type) => type.toLowerCase());
  return normalized.some((type) => multimodalExts.includes(type));
}

function isFreeModel(modelId: string) {
  return modelId.includes(":free");
}

function canUseInTier(modelId: string, tier: ModelRouteInput["spendingTier"]) {
  if (MODEL_COST_BLOCK_LIST.has(modelId)) return false;

  if (tier === "free_only") {
    return isFreeModel(modelId) || modelId === MODEL_CONFIG.autoRouter;
  }

  if (tier === "cheap_only") {
    return isFreeModel(modelId) || CHEAP_MODEL_DEFAULTS.has(modelId);
  }

  return true;
}

function fallbackFor(model: string, tier: ModelRouteInput["spendingTier"]) {
  const defaults = ROUTER_FALLBACKS[model] ?? [MODEL_CONFIG.tutorFast, MODEL_CONFIG.marker];
  return defaults.filter((candidate) => canUseInTier(candidate, tier));
}

function enforceTier(model: string, tier: ModelRouteInput["spendingTier"]) {
  if (canUseInTier(model, tier)) return model;
  if (tier === "free_only") return MODEL_CONFIG.autoRouter;
  if (tier === "cheap_only") return MODEL_CONFIG.smartCheap;
  return MODEL_CONFIG.tutorFast;
}

export function chooseModelRoute(input: ModelRouteInput): ModelRouteOutput {
  const multimodalNeeded = input.hasAttachments && hasMultimodalAttachment(input.attachmentTypes);
  const longMessage = input.messageLength > 1200;
  const complexPrompt = longMessage || input.thinkingLevel === "high" || input.studentSeemsStuck;
  const promptCategory = input.promptCategory ?? "general";

  if (input.routerMode === "manual" && input.manualModel) {
    const primaryModel = enforceTier(input.manualModel, input.spendingTier);
    return {
      primaryModel,
      fallbackModels: fallbackFor(primaryModel, input.spendingTier),
      verificationModel: input.mode === "marker" ? MODEL_CONFIG.verify : undefined,
      reason:
        primaryModel === input.manualModel
          ? "Manual selection"
          : `Manual model restricted by ${input.spendingTier} tier`,
      autoEnhanced: false,
      searchEnabled: input.needsSearch && input.spendingTier !== "free_only",
    };
  }

  if (input.routerMode === "openrouter_auto" && input.spendingTier === "normal") {
    return {
      primaryModel: MODEL_CONFIG.autoRouter,
      fallbackModels: fallbackFor(MODEL_CONFIG.autoRouter, input.spendingTier),
      verificationModel: input.mode === "marker" ? MODEL_CONFIG.verify : undefined,
      reason: "OpenRouter auto-router mode",
      autoEnhanced: true,
      searchEnabled: input.needsSearch,
    };
  }

  if (
    input.routerMode === "auto" &&
    input.spendingTier === "normal" &&
    !multimodalNeeded &&
    !complexPrompt &&
    (input.mode === "general" || input.mode === "tutor") &&
    (promptCategory === "general" || promptCategory === "creative")
  ) {
    return {
      primaryModel: MODEL_CONFIG.autoRouter,
      fallbackModels: fallbackFor(MODEL_CONFIG.autoRouter, input.spendingTier),
      reason: "OpenRouter auto used for broad prompt optimization",
      autoEnhanced: true,
      searchEnabled: false,
    };
  }

  if (input.spendingTier === "free_only") {
    const primaryModel = enforceTier(MODEL_CONFIG.autoRouter, input.spendingTier);
    return {
      primaryModel,
      fallbackModels: [
        MODEL_CONFIG.tutorFast,
        MODEL_CONFIG.marker,
        MODEL_CONFIG.gptOss,
      ].filter((candidate) => canUseInTier(candidate, input.spendingTier)),
      reason: "Free-tier routing via OpenRouter auto with free-model fallbacks",
      autoEnhanced: true,
      searchEnabled: false,
    };
  }

  if (input.needsSearch) {
    const searchModel = input.thinkingLevel === "high" ? MODEL_CONFIG.searchDeep : MODEL_CONFIG.searchFast;
    const primaryModel = enforceTier(searchModel, input.spendingTier);
    return {
      primaryModel,
      fallbackModels: fallbackFor(primaryModel, input.spendingTier),
      reason: "Search intent detected; routed to web-aware model",
      autoEnhanced: true,
      searchEnabled: true,
    };
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

  const primaryModel = enforceTier(baseModel, input.spendingTier);

  return {
    primaryModel,
    fallbackModels: fallbackFor(primaryModel, input.spendingTier),
    verificationModel: input.mode === "marker" ? MODEL_CONFIG.verify : undefined,
    reason,
    autoEnhanced: true,
    searchEnabled: false,
  };
}
