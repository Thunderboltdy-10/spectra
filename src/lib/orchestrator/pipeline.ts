import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";
import { openRouterChatCompletion, openRouterGenerateImage } from "@/lib/openrouter";
import { canUseInTier } from "@/lib/routing/heuristic";
import { buildPhasePlan, selectModelForPhase } from "@/lib/routing/phase-router";
import {
  buildSystemPrompt,
  checkPromptPolicyResponse,
  tutorGate,
} from "@/lib/prompts/policy";
import {
  summarizeWhyResponse,
  toOpenRouterMessages,
} from "@/lib/orchestrator/compose";
import {
  classifyComplexity,
  classifyExplainDepth,
  classifyRequest,
  parseUserDirectives,
  runAutoSettingsPipeline,
  suggestMode,
} from "@/lib/auto-settings";
import { matchAgentToMessage } from "@/lib/agent-matching";
import { countFlashcardPairs, isFlashcardDeckStructured, normalizeFlashcardDeck } from "@/lib/flashcard-format";
import { safeStudyMode } from "@/lib/contracts/studyModes";
import { createRequestLogger } from "@/lib/logging";
import { isModeAvailable } from "@/lib/modes";
import { modelSupportsCapability, pickModelAndFallbacks } from "@/lib/model-selection";
import { getLiveCatalogSnapshot } from "@/lib/openrouter-catalog-cache";
import { normalizeAttachments } from "@/lib/attachments/normalizer";
import { gateCapabilities } from "@/lib/attachments/capability-gate";
import { runVisionPrepass } from "@/lib/attachments/vision-prepass";
import { generateArtifactResources } from "@/lib/artifacts";
import {
  extractAttemptStats,
  maybeCompactHistory,
  shouldScheduleCompaction,
  toChatMessageShape,
  type MemoryEntry,
} from "@/lib/orchestrator/history";
import {
  buildDirectiveMemoryEntries,
  inferCitations,
  maybeExtractMemory,
  maybeGenerateTitle,
  maybeGenerateTitleFromUserPrompt,
  planMemoryRead,
  routeMemoryWrite,
  rewriteCitationMarkers,
  stripOrphanCitations,
} from "@/lib/orchestrator/post-process";
import { buildResearchEvidenceBlock, maybeSearchWeb, runRagRetrieval } from "@/lib/orchestrator/retrieval";
import { buildRoutePlan } from "@/lib/orchestrator/route-plan";
import { PipelineController } from "@/lib/orchestrator/pipeline-controller";
import { formatRuntimeSkillBlock, selectRuntimeSkills } from "@/lib/orchestrator/skills";
import { runAssistantStreaming, runCollaborativeStreaming } from "@/lib/orchestrator/streaming";
import { buildTaskGraph, shouldUseMultiAgent } from "@/lib/orchestrator/task-graph";
import {
  buildModeSuggestions,
  buildModeTransformGuidance,
  formatLearningContextForPrompt,
  isFlashcardAppendIntent,
  mergeLearningContexts,
  parseLearningContext,
  serializeLearningContext,
  type LearningContext,
} from "@/lib/orchestrator/learning-context";
import { formatSchoolNow } from "@/lib/timezone";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";
import type { StudyMode } from "@/types";

type ChatRequestBody = {
  chatId?: string;
  packId?: string;
  agentId?: string;
  clientMessageId?: string;
  mode: StudyMode;
  message: string;
  thinkingLevel: "low" | "medium" | "high";
  routerMode: "auto" | "manual" | "openrouter_auto";
  manualModel?: string;
  forcedModel?: string;
  imageModel?: string;
  usePersonalResources: boolean;
  regenerate?: boolean;
  retryAttempt?: number;
  skipUserMessagePersist?: boolean;
  attachmentTypes?: string[];
  attachmentResourceIds?: string[];
  autoSettings?: {
    enhancePrompt: boolean;
    autoModel: boolean;
    autoThinking: boolean;
    autoSearch: boolean;
    enhanceMode?: "auto" | "on" | "off";
    thinkingMode?: "auto" | "on" | "off";
    searchMode?: "auto" | "on" | "off";
  };
  toolPreferences?: {
    memoryEnabled?: boolean;
    searxngEnabled?: boolean;
  };
  forceMultiAgent?: boolean;
};

type AgentSnapshot = {
  _id: string;
  name: string;
  category: string;
  description: string;
  systemPrompt: string;
  avatarEmoji: string;
  avatarIcon?: string;
  preferredModel?: string;
  preferredMode?: StudyMode;
  guidelinesSummary?: string;
  guidelinesTopicMap?: string[];
};

type StructuredError = {
  code: string;
  message: string;
  retryable?: boolean;
};

const MODE_MAX_TOKENS: Record<StudyMode, number> = {
  auto: 3072,
  research: 4096,
  exam: 4096,
  marker: 3072,
  explain: 3072,
  tutor: 2048,
  general: 2048,
  draft_coach: 2048,
  quiz: 1500,
  flashcard: 1500,
  document: 3072,
  image: 1024,
};
const MIN_QUIZ_QUESTIONS = 2;
const MIN_FLASHCARD_PAIRS = 4;
type QuizDifficultyLabel = "easy" | "medium" | "hard";

type UnlockedAchievement = {
  type: string;
  name: string;
  description: string;
  xpEarned: number;
  earnedAt: number;
};

function gamificationActivityType(mode: StudyMode) {
  if (mode === "quiz" || mode === "exam") return "quiz";
  if (mode === "flashcard") return "flashcard";
  if (mode === "research") return "research";
  return "chat";
}

function mergeUnlockedAchievements(
  ...groups: Array<UnlockedAchievement[] | null | undefined>
) {
  const byKey = new Map<string, UnlockedAchievement>();
  for (const group of groups) {
    if (!group) continue;
    for (const achievement of group) {
      const key = `${achievement.type}:${achievement.earnedAt}`;
      if (!byKey.has(key)) {
        byKey.set(key, achievement);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.earnedAt - b.earnedAt);
}

function clampQuizDifficultyLevel(value: number) {
  return Math.min(3, Math.max(1, Math.round(value)));
}

function toQuizDifficultyLabel(level: number): QuizDifficultyLabel {
  if (level <= 1) return "easy";
  if (level >= 3) return "hard";
  return "medium";
}

function featureEnabled(flag: boolean | undefined, defaultValue = true) {
  if (flag === undefined) return defaultValue;
  return flag;
}

function featureAllowed(orgFlag: boolean | undefined, userFlag: boolean | undefined, defaultValue = true) {
  return featureEnabled(orgFlag, defaultValue) && featureEnabled(userFlag, defaultValue);
}

function isQuizStructured(value: string) {
  return countQuizQuestions(value) >= 2;
}

function countQuizQuestions(value: string) {
  const questionLineRegex = /(?:^|\n)\s*(?:Q(?:uestion)?\s*)?(\d+)[.):-]\s+.+/gi;
  const optionRegex = /(?:^|\n)\s*[-*]?\s*[A-D][.)]\s+.+/gim;
  const ids = new Set<string>();
  for (const match of value.matchAll(questionLineRegex)) {
    const id = (match[1] ?? "").trim();
    if (id) ids.add(id);
  }
  const options = value.match(optionRegex) ?? [];
  const byCount = ids.size;
  if (byCount === 0) return 0;
  if (options.length < byCount * 2) return 0;
  return byCount;
}

function extractImageReferences(value: string) {
  const refs = [...value.matchAll(/\[image\s*#\s*(\d+)\]/gi)]
    .map((match) => Number.parseInt(match[1] ?? "", 10))
    .filter((index) => Number.isFinite(index) && index > 0);
  return Array.from(new Set(refs)).slice(0, 4);
}

function extractMarkdownImageUrls(value: string) {
  const urls = [...value.matchAll(/!\[[^\]]*]\(([^)\s]+)\)/g)]
    .map((match) => (match[1] ?? "").trim())
    .filter((url) => /^(https?:\/\/|data:image\/)/i.test(url));
  return urls;
}

function fallbackTitleFromUserMessage(message: string) {
  const words = message
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) return "New chat";
  if (words.length === 1) return `${words[0]} session`.slice(0, 80);
  return words.slice(0, 5).join(" ").slice(0, 80);
}

async function resolveFirstTurnTitle(params: {
  assistantCount: number;
  chatId: string;
  actorClerkId: string;
  userMessage: string;
  assistantMessage: string;
  onModelCall?: (call: {
    model: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
    durationMs?: number;
  }) => void;
  logger?: {
    warn: (message: string, context?: Record<string, unknown>) => void;
  };
}) {
  if (params.assistantCount !== 0) return undefined;

  try {
    const generated = await maybeGenerateTitle({
      chatId: params.chatId,
      actorClerkId: params.actorClerkId,
      userMessage: params.userMessage,
      assistantMessage: params.assistantMessage,
      onModelCall: params.onModelCall,
    });
    if (generated?.trim()) return generated.trim();
  } catch (error) {
    params.logger?.warn("chat title generation failed", {
      chatId: params.chatId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const fallbackTitle = fallbackTitleFromUserMessage(params.userMessage);
  try {
    await convexMutation("chats:setChatTitle", {
      actorClerkId: params.actorClerkId,
      chatId: params.chatId,
      title: fallbackTitle,
    });
  } catch (error) {
    params.logger?.warn("chat title fallback persist failed", {
      chatId: params.chatId,
      fallbackTitle,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return fallbackTitle;
}

function getReferencedHistoryImageBlocks(params: {
  message: string;
  history: Array<{ role: string; content: string }>;
}) {
  const refs = extractImageReferences(params.message);
  if (refs.length === 0) return [];

  const images = params.history
    .filter((item) => item.role === "assistant")
    .flatMap((item) => extractMarkdownImageUrls(item.content));

  return refs
    .map((refIndex) => images[refIndex - 1])
    .filter((url): url is string => Boolean(url))
    .map((url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "auto" as const },
    }));
}

function buildSpecialistConversationContext(history: Array<{ role: string; content: string }>) {
  return history
    .slice(-10)
    .map((entry) => `${entry.role.toUpperCase()}:\n${entry.content.slice(0, 420).trim()}`)
    .join("\n\n")
    .slice(0, 3200);
}

function jsonError(status: number, error: StructuredError, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    {
      error,
      ...extra,
    },
    { status },
  );
}

function isLegacyCitationValidatorError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return lower.includes("argumentvalidationerror") && lower.includes("citations");
}

async function appendAssistantMessageWithCitationFallback(params: {
  actorClerkId: string;
  chatId: string;
  content: string;
  mode: StudyMode;
  attachments?: string[];
  attachmentResourceIds?: string[];
  citations: Array<{
    filename: string;
    page?: number;
    sourceType: "pack" | "personal" | "general" | "search";
    url?: string;
    title?: string;
    domain?: string;
    resourceId?: string;
    snippet?: string;
  }>;
  modelRequested?: string;
  modelUsed?: string;
  whyThisResponse?: string;
  usageIn?: number;
  usageOut?: number;
  verificationPassed?: boolean;
  thinkingContent?: string;
  routeTrace: unknown;
}) {
  const baseArgs = {
    actorClerkId: params.actorClerkId,
    chatId: params.chatId,
    role: "assistant" as const,
    content: params.content,
    attachments: params.attachments,
    attachmentResourceIds: params.attachmentResourceIds,
    mode: params.mode,
    citations: params.citations,
    modelRequested: params.modelRequested,
    modelUsed: params.modelUsed,
    whyThisResponse: params.whyThisResponse,
    usageIn: params.usageIn,
    usageOut: params.usageOut,
    verificationPassed: params.verificationPassed,
    thinkingContent: params.thinkingContent,
    routeTrace: params.routeTrace,
  };

  try {
    return await convexMutation("chats:appendMessage", baseArgs) as { messageId: string };
  } catch (error) {
    if (!isLegacyCitationValidatorError(error)) {
      throw error;
    }

    return await convexMutation("chats:appendMessage", {
      ...baseArgs,
      citations: params.citations.map((citation) => ({
        filename: citation.filename,
        page: citation.page,
        sourceType: citation.sourceType,
        url: citation.url,
        resourceId: citation.resourceId,
        snippet: citation.snippet,
      })),
    }) as { messageId: string };
  }
}

function buildPersonalSoulExcerpt(params: {
  preferences?: {
    learningStyle?: string;
    preferredDifficulty?: string;
    interests?: string[];
    weakAreas?: string[];
    preferredModes?: string[];
    communicationStyle?: string;
    customGuidance?: string;
  } | null;
  memoryProfile?: string;
}) {
  const lines: string[] = [];
  const prefs = params.preferences;
  if (prefs?.learningStyle) lines.push(`Learning style: ${prefs.learningStyle}`);
  if (prefs?.communicationStyle) lines.push(`Communication preference: ${prefs.communicationStyle}`);
  if (prefs?.preferredDifficulty) lines.push(`Preferred difficulty: ${prefs.preferredDifficulty}`);
  if (prefs?.interests?.length) lines.push(`Subject interests: ${prefs.interests.join(", ")}`);
  if (prefs?.weakAreas?.length) lines.push(`Recurring weak areas: ${prefs.weakAreas.join(", ")}`);
  if (prefs?.preferredModes?.length) lines.push(`Preferred study modes: ${prefs.preferredModes.join(", ")}`);
  if (prefs?.customGuidance) lines.push(`Custom guidance: ${prefs.customGuidance}`);
  if (params.memoryProfile?.trim()) lines.push(params.memoryProfile.trim());
  return lines.join("\n").trim();
}

export async function runChatPipeline(request: NextRequest) {
  const requestStartedAt = Date.now();
  const actor = await requireActor();
  const logger = createRequestLogger(request).child({ userId: actor.clerkId });
  type PendingSubcall = {
    id: string;
    phaseId: string;
    label: string;
    endpoint: "chat.completions" | "embeddings";
    status: "ok" | "error";
    modelRequested?: string;
    modelUsed?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    costCents?: number;
    durationMs?: number;
    reason?: string;
  };
  const deferredSubcalls: PendingSubcall[] = [];
  const costCentsFromUsage = (usage?: { cost?: number }) =>
    typeof usage?.cost === "number" && Number.isFinite(usage.cost)
      ? Number((Math.max(0, usage.cost) * 100).toFixed(4))
      : undefined;
  const deferSubcall = (entry: Omit<PendingSubcall, "id" | "provider">) => {
    deferredSubcalls.push({
      ...entry,
      id: `${entry.phaseId}-${deferredSubcalls.length + 1}`,
      provider: entry.modelUsed ? entry.modelUsed.split("/")[0]?.toLowerCase() : undefined,
    });
  };

  const body = (await request.json().catch(() => null)) as ChatRequestBody | null;
  if (!body) {
    return jsonError(400, {
      code: "INVALID_JSON",
      message: "Request body must be valid JSON.",
    });
  }

  if (!body.mode || !body.message || !body.thinkingLevel || !body.routerMode) {
    return jsonError(400, {
      code: "MISSING_FIELDS",
      message: "mode, message, thinkingLevel, and routerMode are required.",
    });
  }

  const requestedMode = safeStudyMode(body.mode, "POST /api/chat");
  const safeMode: StudyMode = isModeAvailable(requestedMode) ? requestedMode : "general";
  if (safeMode !== requestedMode) {
    logger.info("unavailable mode requested; falling back to general", {
      requestedMode,
      fallbackMode: safeMode,
    });
  }

  const normalizedMessage = body.message.trim();
  if (!normalizedMessage) {
    return jsonError(400, {
      code: "EMPTY_MESSAGE",
      message: "Message cannot be empty.",
    });
  }
  logger.info("chat request started", {
    mode: body.mode,
    routerMode: body.routerMode,
    hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
  });

  let selectedAgent: AgentSnapshot | undefined;
  if (body.agentId) {
    selectedAgent = (await convexQuery("agents:getAgent", {
      actorClerkId: actor.clerkId,
      agentId: body.agentId,
    })) as AgentSnapshot;
  }

  const budget = (await convexQuery("usage:checkUserBudget", {
    actorClerkId: actor.clerkId,
  })) as {
    totalSpentEur: number;
    tier: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
    softLimitReached: boolean;
    hardLimitReached: boolean;
  };

  const dbCatalog = (await convexQuery("models:listModels", {
    actorClerkId: actor.clerkId,
  })) as Array<{
    modelId: string;
    name?: string;
    provider?: string;
    description?: string;
    contextLength?: number;
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
  }>;
  const runtimeStats = (await convexQuery("models:listRuntimeStats", {
    actorClerkId: actor.clerkId,
  })) as Array<{
    modelId: string;
    successCount: number;
    failureCount: number;
    avgLatencyMs?: number;
  }>;
  const runtimeStatMap = Object.fromEntries(
    runtimeStats.map((row) => [row.modelId, row]),
  ) as Record<string, { successCount: number; failureCount: number; avgLatencyMs?: number }>;
  const liveCatalog = await getLiveCatalogSnapshot({ fallbackCatalog: dbCatalog });
  const mergedCatalogById = new Map(
    dbCatalog.map((model) => [model.modelId, { ...model }]),
  );
  for (const model of liveCatalog.models) {
    const existing = mergedCatalogById.get(model.modelId);
    mergedCatalogById.set(model.modelId, {
      ...existing,
      ...model,
      tags: [...new Set([...(existing?.tags ?? []), ...(model.tags ?? [])])],
    });
  }
  const catalog = [...mergedCatalogById.values()];
  const catalogPricingById = new Map(
    catalog.map((model) => [
      model.modelId,
      {
        inputCostPerM: model.inputCostPerM,
        outputCostPerM: model.outputCostPerM,
      },
    ]),
  );
  const normalizeModelForPricing = (value: string) =>
    value.trim().toLowerCase().replace(/:free$/i, "");
  const pricingLeaf = (value: string) => normalizeModelForPricing(value).split("/").pop() ?? normalizeModelForPricing(value);
  const resolveCatalogPricing = (modelId: string) => {
    const direct = catalogPricingById.get(modelId);
    if (typeof direct?.inputCostPerM === "number" || typeof direct?.outputCostPerM === "number") {
      return direct;
    }

    const stripped = modelId.replace(/:free$/i, "");
    const strippedMatch = catalogPricingById.get(stripped);
    if (typeof strippedMatch?.inputCostPerM === "number" || typeof strippedMatch?.outputCostPerM === "number") {
      return strippedMatch;
    }

    const normalized = normalizeModelForPricing(modelId);
    for (const [candidateId, pricing] of catalogPricingById.entries()) {
      const normalizedCandidate = normalizeModelForPricing(candidateId);
      if (normalizedCandidate === normalized || pricingLeaf(normalizedCandidate) === pricingLeaf(normalized)) {
        return pricing;
      }
    }
    return undefined;
  };
  logger.info("catalog snapshot ready", {
    source: liveCatalog.source,
    modelCount: catalog.length,
  });

  if (budget.tier === "free_only") {
    const hasFreeModel = catalog.some((model) => model.isFree || model.modelId.includes(":free"));
    if (!hasFreeModel) {
      return jsonError(402, {
        code: "NO_FREE_MODEL_AVAILABLE",
        message: "Usage cap reached and no budget-safe models are available right now.",
        retryable: false,
      });
    }
  }

  const autoSettings = {
    enhancePrompt: body.autoSettings?.enhancePrompt ?? true,
    autoModel: body.autoSettings?.autoModel ?? true,
    autoThinking: body.autoSettings?.autoThinking ?? true,
    autoSearch: body.autoSettings?.autoSearch ?? true,
    enhanceMode: body.autoSettings?.enhanceMode ?? "auto",
    thinkingMode: body.autoSettings?.thinkingMode ?? "auto",
    searchMode: body.autoSettings?.searchMode ?? "auto",
  };

  const earlyComplexity = classifyComplexity(normalizedMessage);
  const earlyClassification = classifyRequest({
    message: normalizedMessage,
    complexity: earlyComplexity,
    mode: safeMode,
    hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
    isFirstMessage: !body.chatId,
    multiAgentRequested: Boolean(body.forceMultiAgent),
    spendingTier: budget.tier,
  });
  const skipAutoSettingsForT0 = earlyClassification.requestClass === "T0";
  const auto: Awaited<ReturnType<typeof runAutoSettingsPipeline>> = skipAutoSettingsForT0
    ? {
        message: normalizedMessage,
        promptEnhanced: false,
        searchEnabled: false,
        thinkingLevel: "low",
        complexity: earlyComplexity,
        requestClass: earlyClassification.requestClass,
        classificationReason: earlyClassification.reason,
        promptCategory: "general",
        questionType: "other",
        isMultipart: false,
        suggestedMode: null,
      }
    : await runAutoSettingsPipeline({
        actorClerkId: actor.clerkId,
        message: normalizedMessage,
        mode: safeMode,
        hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
        isFirstMessage: !body.chatId,
        multiAgentRequested: Boolean(body.forceMultiAgent),
        currentThinkingLevel: body.thinkingLevel,
        spendingTier: budget.tier,
        autoEnhancePrompt: autoSettings.enhancePrompt,
        autoThinking: autoSettings.autoThinking,
        autoSearch: autoSettings.autoSearch,
        enhanceMode: autoSettings.enhanceMode,
        thinkingMode: autoSettings.thinkingMode,
        searchMode: autoSettings.searchMode,
      });
  const userDirectives = parseUserDirectives(normalizedMessage);
  if (userDirectives.forcedModel) {
    logger.info("user directive: forced model", { model: userDirectives.forcedModel });
  }
  if (userDirectives.forceMultiAgent) {
    logger.info("user directive: force multi-agent");
    (body as Record<string, unknown>).forceMultiAgent = true;
  }
  if (userDirectives.forcedModel && !body.forcedModel) {
    (body as Record<string, unknown>).forcedModel = userDirectives.forcedModel;
  }

  logger.info("auto-settings complete", {
    skippedForT0: skipAutoSettingsForT0,
    promptEnhanced: auto.promptEnhanced,
    searchEnabled: auto.searchEnabled,
    promptCategory: auto.promptCategory,
    complexity: auto.complexity,
  });
  if (auto.promptEnhancementCall) {
    deferSubcall({
      phaseId: "planning",
      label: "Prompt enhancement",
      endpoint: "chat.completions",
      status: "ok",
      modelUsed: auto.promptEnhancementCall.model,
      inputTokens: auto.promptEnhancementCall.usage?.prompt_tokens,
      outputTokens: auto.promptEnhancementCall.usage?.completion_tokens,
      costCents: costCentsFromUsage(auto.promptEnhancementCall.usage),
      durationMs: auto.promptEnhancementCall.durationMs,
      reason: auto.promptEnhancementCall.improved ? "Prompt rewritten for clarity." : "No rewrite applied.",
    });
  }

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  const send = async (payload: Record<string, unknown>) => {
    await writer.write(encoder.encode(`${JSON.stringify(payload)}\n`));
  };

  // Buffer events that fire before the Response is returned (no reader attached yet).
  // Flushed at the very start of the async IIFE producer.
  const earlyEventBuffer: Record<string, unknown>[] = [];
  earlyEventBuffer.push({ type: "phase", phase: "routing" });

  // Auto mode selection: if user selected "auto", always use suggested mode;
  // also auto-detect from default modes.
  // NOTE: effectiveMode is a `let` so that conversation-aware mode refinement
  // (applied after history is fetched) can override it when necessary.
  let effectiveMode: StudyMode = (() => {
    if (safeMode === "auto") {
      return (auto.suggestedMode ?? "general") as StudyMode;
    }
    // Even in manual modes, detect severe conflicts
    if (auto.suggestedMode && safeMode !== auto.suggestedMode) {
      const isSevereConflict = (
        (auto.suggestedMode === "image" && safeMode !== "image") ||
        (auto.suggestedMode === "quiz" && !["quiz", "exam"].includes(safeMode)) ||
        (auto.suggestedMode === "flashcard" && safeMode !== "flashcard") ||
        (auto.suggestedMode === "exam" && safeMode !== "exam") ||
        (safeMode === "quiz" && auto.suggestedMode === "image")
      );
      if (isSevereConflict) {
        return auto.suggestedMode as StudyMode;
      }
      // Soft suggestion for default modes
      if (safeMode === "tutor" || safeMode === "general") {
        return auto.suggestedMode as StudyMode;
      }
    }
    return safeMode;
  })();
  if (!isModeAvailable(effectiveMode)) {
    effectiveMode = "general";
  }
  if (effectiveMode !== safeMode) {
    earlyEventBuffer.push({
      type: "mode_update",
      suggestedMode: effectiveMode,
    });
  }

  // Research mode always enables search
  if (effectiveMode === "research") {
    auto.searchEnabled = true;
  }
  const attachmentResourceIds = (body.attachmentResourceIds ?? []).filter((id) => typeof id === "string" && id.trim().length > 0);
  const uploadedAttachmentMeta = attachmentResourceIds.length > 0
    ? ((await convexQuery("resources:getResourceNamesByIds", {
        actorClerkId: actor.clerkId,
        resourceIds: attachmentResourceIds,
      })) as Array<{ _id: string; filename: string; status: "uploaded" | "processing" | "processed" | "failed" }>)
    : [];
  const uploadedAttachmentNames = uploadedAttachmentMeta.map((item) => item.filename);

  const chatId = body.chatId
    ? body.chatId
    : (
        (await convexMutation("chats:createChat", {
          actorClerkId: actor.clerkId,
          packId: body.packId,
          agentId: body.agentId,
          mode: effectiveMode,
          thinkingLevel: auto.thinkingLevel,
          routerMode: body.routerMode,
          manualModel: body.manualModel,
          usePersonalResources: body.usePersonalResources,
          title: "New chat",
        })) as { chatId: string }
      ).chatId;

  const isRegenerate = Boolean(body.regenerate && body.chatId);
  const shouldPersistUserMessage = !isRegenerate && !body.skipUserMessagePersist;
  const normalizedClientMessageId =
    typeof body.clientMessageId === "string" && body.clientMessageId.trim().length > 0
      ? body.clientMessageId.trim()
      : undefined;
  let persistedUserMessageId: string | undefined;
  const rollbackPersistedUserMessage = async () => {
    if (!shouldPersistUserMessage) return;
    await convexMutation("chats:deleteLastUserMessage", {
      actorClerkId: actor.clerkId,
      chatId,
      expectedContent: normalizedMessage,
      expectedClientMessageId: normalizedClientMessageId,
    }).catch(() => {});
  };

  if (isRegenerate) {
    await convexMutation("chats:deleteLastAssistantMessage", {
      actorClerkId: actor.clerkId,
      chatId,
    });
  } else if (shouldPersistUserMessage) {
    const appendedUser = (await convexMutation("chats:appendMessage", {
      actorClerkId: actor.clerkId,
      chatId,
      clientMessageId: normalizedClientMessageId,
      role: "user",
      content: normalizedMessage,
      attachments: uploadedAttachmentNames,
      attachmentResourceIds,
      enhancedContent: auto.promptEnhanced ? auto.message : undefined,
      mode: effectiveMode,
      packId: body.packId,
      citations: [],
      modelRequested: undefined,
      modelUsed: undefined,
      whyThisResponse: undefined,
      usageIn: undefined,
      usageOut: undefined,
      verificationPassed: undefined,
      thinkingContent: undefined,
      routeTrace: undefined,
    })) as { messageId: string };
    persistedUserMessageId = appendedUser.messageId;
  }

  const [chatData, orgSettings, userMemory, personalSoulPrefs, schoolSoulCapsule] = await Promise.all([
    convexQuery("chats:getChat", {
      actorClerkId: actor.clerkId,
      chatId,
    }) as Promise<{ chat: Record<string, unknown>; messages: Array<Record<string, unknown>> }>,
    convexQuery("admin:getOrgSettings", { actorClerkId: actor.clerkId }) as Promise<{
      org: {
        name?: string;
        schoolType?: string;
        country?: string;
        curriculum?: string;
        examBoard?: string;
        gradeLevels?: string[];
        timezone?: string;
        verifyMarkerPassEnabled: boolean;
        orchestratorV2Enabled?: boolean;
        searxngEnabled?: boolean;
        soulEnabled?: boolean;
        agentModelBoostEnabled?: boolean;
        adaptiveQuizEnabled?: boolean;
        spacedRepetitionEnabled?: boolean;
      };
    }>,
    convexQuery("memory:getUserMemory", {
      actorClerkId: actor.clerkId,
    }) as Promise<{ rawMemoryText: string; entries: MemoryEntry[] }>,
    convexQuery("personalSoul:getPreferences", {
      actorClerkId: actor.clerkId,
    }).catch(() => null) as Promise<{
      learningStyle?: string;
      preferredDifficulty?: string;
      interests?: string[];
      weakAreas?: string[];
      preferredModes?: string[];
      communicationStyle?: string;
      customGuidance?: string;
    } | null>,
    convexQuery("soul:getSoulCapsule", {
      actorClerkId: actor.clerkId,
    }).catch(() => ({ version: "soul-unavailable", capsule: "" })) as Promise<{
      version: string;
      capsule: string;
    }>,
  ]);

  const storedAgentId =
    typeof chatData.chat.agentId === "string" && chatData.chat.agentId.trim().length > 0
      ? chatData.chat.agentId
      : undefined;

  if (!selectedAgent && storedAgentId) {
    selectedAgent = (await convexQuery("agents:getAgent", {
      actorClerkId: actor.clerkId,
      agentId: storedAgentId,
    })) as AgentSnapshot;
  }

  const history = toChatMessageShape(chatData.messages);
  const storedLearningContext = parseLearningContext((chatData.chat as { learningContext?: unknown }).learningContext);
  const isFirstAssistantTurn = history.every((message) => message.role !== "assistant");
  const attemptStats = extractAttemptStats(history);
  const directiveMemorySummary = {
    forgotten: 0,
    negativeLinks: 0,
    written: 0,
  };

  if (userDirectives.memoryActions?.length) {
    for (const action of userDirectives.memoryActions) {
      if (action.type === "forget") {
        const result = await convexMutation<
          { actorClerkId: string; target?: string; sourceChatId?: string },
          { deleted?: number }
        >("memory:forgetMemoryEntriesByQuery", {
          actorClerkId: actor.clerkId,
          target: action.target,
          sourceChatId: action.target ? undefined : chatId,
        }).catch(() => ({ deleted: 0 }));
        directiveMemorySummary.forgotten += result.deleted ?? 0;
        continue;
      }

      if (action.type === "negative_topic") {
        const result = await convexMutation<
          { actorClerkId: string; topic: string; target?: string; sourceChatId?: string },
          { updated?: number }
        >("memory:addNegativeTopicLink", {
          actorClerkId: actor.clerkId,
          topic: action.topic,
          target: action.target,
          sourceChatId: action.target ? undefined : chatId,
        }).catch(() => ({ updated: 0 }));
        directiveMemorySummary.negativeLinks += result.updated ?? 0;
        continue;
      }

      if (action.type === "remember" || action.type === "update_profile") {
        const explicitEntries = buildDirectiveMemoryEntries({
          statement: action.statement,
          directiveType: action.type,
        });
        const routed = await routeMemoryWrite({
          actorClerkId: actor.clerkId,
          chatId,
          entries: explicitEntries,
          sourceType: "user_explicit",
          onModelCall: (call) => {
            deferSubcall({
              phaseId: "memory",
              label: "Directive memory embedding",
              endpoint: "embeddings",
              status: "ok",
              modelUsed: call.model,
              inputTokens: call.usage?.prompt_tokens,
              outputTokens: call.usage?.completion_tokens,
              costCents: costCentsFromUsage(call.usage),
              durationMs: call.durationMs,
            });
          },
        }).catch(() => ({ written: 0, promoted: 0 }));
        directiveMemorySummary.written += routed.written;
      }
    }
  }

  // Conversation-aware mode refinement: now that we have history, run suggestMode
  // again with full context and optionally override the initial effectiveMode.
  // Only applies when in auto mode or soft-switchable modes (tutor/general).
  if (safeMode === "auto" || safeMode === "tutor" || safeMode === "general") {
    const modeBeforeConversationRefine = effectiveMode;
    const conversationHistory = history.map((msg) => ({
      role: msg.role,
      content: msg.content,
      mode: msg.mode as string | undefined,
    }));
    const conversationSuggestedMode = suggestMode(normalizedMessage, conversationHistory);
    if (conversationSuggestedMode && conversationSuggestedMode !== effectiveMode) {
      const refined = (
        isModeAvailable(conversationSuggestedMode as StudyMode)
          ? (conversationSuggestedMode as StudyMode)
          : "general"
      );
      logger.info("conversation-aware mode refinement", {
        from: effectiveMode,
        to: refined,
        safeMode,
      });
      effectiveMode = refined;
      // Keep auto.suggestedMode updated so done-event metadata is consistent
      auto.suggestedMode = conversationSuggestedMode;
      // Research mode always enables search
      if (effectiveMode === "research") {
        auto.searchEnabled = true;
      }
      if (effectiveMode !== modeBeforeConversationRefine) {
        earlyEventBuffer.push({
          type: "mode_update",
          suggestedMode: effectiveMode,
        });
      }
    }
  }

  // Vague request detection for quiz/flashcard modes.
  // When a request is ambiguous (no topic specified), skip format-repair so the
  // model can ask a clarifying question instead of generating empty/wrong content.
  const isVagueRequest =
    (effectiveMode === "quiz" || effectiveMode === "flashcard") &&
    normalizedMessage.split(/\s+/).length < 4 &&
    !/\b(about|on|for|regarding|the|topic)\b/i.test(normalizedMessage);

  const requestClassification = classifyRequest({
    message: auto.message,
    complexity: auto.complexity,
    mode: effectiveMode,
    hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
    isFirstMessage: isFirstAssistantTurn,
    multiAgentRequested: Boolean(body.forceMultiAgent),
    spendingTier: budget.tier,
  });
  auto.requestClass = requestClassification.requestClass;
  auto.classificationReason = requestClassification.reason;
  const pipelineController = new PipelineController({
    requestClass: requestClassification.requestClass,
    classificationReason: requestClassification.reason,
  });
  if (skipAutoSettingsForT0) {
    pipelineController.markStageSkipped("autoSettings", "Skipped for T0 request class.");
  } else {
    pipelineController.markStageCompleted("autoSettings");
  }
  if (pipelineController.shouldRun("clarificationCheck")) {
    pipelineController.markStageCompleted("clarificationCheck");
  }

  let agentSuggestion:
    | {
        id: string;
        name: string;
        score: number;
        reason: string;
      }
    | undefined;
  if (!selectedAgent && (safeMode === "auto" || body.routerMode === "auto")) {
    const availableAgents = (await convexQuery("agents:listAgents", {
      actorClerkId: actor.clerkId,
    })) as AgentSnapshot[];
    const matched = matchAgentToMessage(auto.message, availableAgents);
    if (matched) {
      agentSuggestion = {
        id: matched.agentId,
        name: matched.agentName,
        score: Number(matched.score.toFixed(2)),
        reason: matched.reason,
      };
      logger.info("agent suggestion generated", {
        agentId: matched.agentId,
        score: matched.score,
      });
    }
  }

  const existingSummary =
    typeof chatData.chat.contextSummary === "string" && chatData.chat.contextSummary.trim().length > 0
      ? String(chatData.chat.contextSummary)
      : undefined;

  const scheduledCompaction = shouldScheduleCompaction({
    history,
    mode: effectiveMode,
    hasExistingSummary: Boolean(existingSummary),
  });
  if (scheduledCompaction) {
    earlyEventBuffer.push({ type: "phase", phase: "compacting" });
    void maybeCompactHistory({
      actorClerkId: actor.clerkId,
      chatId,
      history,
      onModelCall: (call) => {
        deferSubcall({
          phaseId: "planning",
          label: "History compaction",
          endpoint: "chat.completions",
          status: "ok",
          modelUsed: call.model,
          inputTokens: call.usage?.prompt_tokens,
          outputTokens: call.usage?.completion_tokens,
          costCents: costCentsFromUsage(call.usage),
          durationMs: call.durationMs,
        });
      },
    }).catch(() => {});
  }

  const compactedWindow =
    effectiveMode === "quiz" || effectiveMode === "exam" || effectiveMode === "flashcard"
      ? 14
      : 8;
  const recentHistory = existingSummary ? history.slice(-compactedWindow) : history;
  const historyForModel = recentHistory.map((message, index) => {
    const isLast = index === recentHistory.length - 1;
    if (isLast && message.role === "user" && auto.promptEnhanced) {
      return {
        ...message,
        content: auto.message,
      };
    }
    return message;
  });

  const referencedHistoryImageBlocks = getReferencedHistoryImageBlocks({
    message: normalizedMessage,
    history,
  });

  const activePackId =
    body.packId
    ?? (typeof chatData.chat.packId === "string" && chatData.chat.packId.trim().length > 0
      ? chatData.chat.packId
      : undefined);
  const memoryEnabled = featureEnabled(body.toolPreferences?.memoryEnabled, true);
  const searxngEnabled = featureAllowed(
    orgSettings.org?.searxngEnabled,
    body.toolPreferences?.searxngEnabled,
    true,
  );
  const routePlan = buildRoutePlan({
    message: auto.message,
    mode: effectiveMode,
    selectedMode: safeMode,
    hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
    hasAgent: Boolean(selectedAgent?._id),
    hasPack: Boolean(activePackId),
    hasPersonalResources: body.usePersonalResources,
    hasAgentResources: Boolean(selectedAgent?._id),
    autoSearchEnabled: auto.searchEnabled,
    thinkingLevel: auto.thinkingLevel,
    complexity: auto.complexity,
    selectedAgent: selectedAgent
      ? {
          _id: selectedAgent._id,
          name: selectedAgent.name,
          preferredModel: selectedAgent.preferredModel,
          preferredMode: selectedAgent.preferredMode,
        }
      : undefined,
    schoolSoulVersion: schoolSoulCapsule.version,
  });
  if (!memoryEnabled) {
    routePlan.shouldConsultMemory = false;
    routePlan.shouldWriteMemory = false;
    routePlan.allowedToolBundles = routePlan.allowedToolBundles.filter((bundle) => bundle !== "memory");
  }
  pipelineController.markStageCompleted("buildRoutePlan");
  const costGates = pipelineController.applyCostGates({
    allowSearch: routePlan.shouldUseWebSearch,
    allowRag: routePlan.allowedToolBundles.includes("retrieval") && routePlan.retrievalScopes.length > 0,
    allowMultiAgent: routePlan.allowSubAgents,
    spendingTier: budget.tier,
    forceMultiAgentRequested: Boolean(body.forceMultiAgent),
    orchestratorEnabled: featureEnabled(orgSettings.org?.orchestratorV2Enabled),
    budgetSoftLimited: Boolean(budget.softLimitReached || budget.hardLimitReached),
  });
  if (!costGates.searchEnabled) {
    routePlan.shouldUseWebSearch = false;
    routePlan.allowedToolBundles = routePlan.allowedToolBundles.filter((bundle) => bundle !== "search");
  }
  if (!costGates.ragEnabled) {
    routePlan.retrievalScopes = [];
    routePlan.allowedToolBundles = routePlan.allowedToolBundles.filter((bundle) => bundle !== "retrieval");
  }
  if (!costGates.multiAgentEnabled) {
    routePlan.shouldUseMultiStep = false;
    routePlan.allowSubAgents = false;
    routePlan.allowedToolBundles = routePlan.allowedToolBundles.filter((bundle) => bundle !== "multi_agent");
  }
  const forceMultiAgentAllowed = costGates.forceMultiAgentAllowed;
  const forceMultiAgentDeniedReason =
    costGates.forceDeniedReasons.length > 0
      ? costGates.forceDeniedReasons.join("; ")
      : undefined;

  const runtimeSkills = routePlan.allowedToolBundles.includes("skills")
    ? selectRuntimeSkills({
        message: auto.message,
        mode: effectiveMode,
        maxSkills: routePlan.responseBudget === "deep" ? 6 : 4,
      })
    : [];
  const flashcardAppendIntent = effectiveMode === "flashcard" && isFlashcardAppendIntent(normalizedMessage);
  const latestDeckPromise: Promise<{
    title: string;
    cards: Array<{ front: string; back: string; cardHash: string }>;
  } | null> = flashcardAppendIntent
    ? convexQuery<
      { actorClerkId: string; chatId: string },
      {
        title: string;
        cards: Array<{ front: string; back: string; cardHash: string }>;
      } | null
    >("flashcards:getLatestDeckForChat", {
        actorClerkId: actor.clerkId,
        chatId,
      }).catch(() => null)
    : Promise.resolve(null);

  const retrievalPromise = routePlan.allowedToolBundles.includes("retrieval") && routePlan.retrievalScopes.length > 0
    ? runRagRetrieval({
        actorClerkId: actor.clerkId,
        chatId,
        packId: routePlan.retrievalScopes.includes("pack") ? activePackId : undefined,
        usePersonalResources: routePlan.retrievalScopes.includes("personal") && body.usePersonalResources,
        selectedAgentId: routePlan.retrievalScopes.includes("agent") ? selectedAgent?._id : undefined,
        message: auto.message,
        logger,
      })
    : Promise.resolve({
        citations: [],
        sourceBlock: "No retrieved sources.",
        queryEmbedding: undefined,
        diagnostics: {
          scopesAttempted: [],
          status: "not_requested" as const,
          reason: "Retrieval not enabled by the route plan.",
        },
      });

  const searchPromise = routePlan.shouldUseWebSearch
    ? maybeSearchWeb(auto.message, auto.thinkingLevel, {
        actorClerkId: actor.clerkId,
        chatId,
        modelCatalog: catalog,
        spendingTier: budget.tier,
        modelRuntimeStats: runtimeStatMap,
        searxngEnabled,
      }).catch(() => ({
        text: "",
        urls: [] as string[],
        sources: [] as Array<{ url: string; title: string; domain: string }>,
        provider: "error" as const,
      }))
    : Promise.resolve({
      text: "",
      urls: [] as string[],
      sources: [] as Array<{ url: string; title: string; domain: string }>,
      provider: "disabled" as const,
    });
  if (routePlan.shouldUseWebSearch) {
    earlyEventBuffer.push({ type: "phase", phase: "searching" });
  }

  const adaptiveQuizPromise: Promise<{
    currentLevel: number;
    level: number;
    label: QuizDifficultyLabel;
  }> =
    effectiveMode === "quiz" && featureEnabled(orgSettings.org?.adaptiveQuizEnabled)
      ? Promise.all([
          convexQuery("analytics:getQuizDifficultySignal", {
            actorClerkId: actor.clerkId,
          }).catch(() => ({ difficultyLevel: 2 })),
          convexQuery("quizzes:getQuizHistory", {
            actorClerkId: actor.clerkId,
            limit: 1,
          }).catch(() => [] as Array<{ score: number; total: number }>),
          convexQuery("analytics:getRecentQuizPerformance", {
            actorClerkId: actor.clerkId,
            days: 30,
          }).catch(() => ({ recommendedDifficulty: 3 })),
        ])
          .then(([signal, history, performance]) => {
            const signalLevel = Number((signal as { difficultyLevel?: number } | null)?.difficultyLevel);
            const recommendedDifficulty = Number(
              (performance as { recommendedDifficulty?: number } | null)?.recommendedDifficulty ?? 3,
            );
            const fallbackLevel =
              recommendedDifficulty >= 4
                ? 3
                : recommendedDifficulty <= 2
                  ? 1
                  : 2;
            const currentLevel = clampQuizDifficultyLevel(
              Number.isFinite(signalLevel) ? signalLevel : fallbackLevel,
            );

            let nextLevel = currentLevel;
            const latestResult = (history as Array<{ score: number; total: number }>)[0];
            if (
              latestResult &&
              Number.isFinite(latestResult.score) &&
              Number.isFinite(latestResult.total) &&
              latestResult.total > 0
            ) {
              const scoreRatio = latestResult.score / latestResult.total;
              if (scoreRatio >= 0.8 && currentLevel < 3) {
                nextLevel = currentLevel + 1;
              } else if (scoreRatio <= 0.4 && currentLevel > 1) {
                nextLevel = currentLevel - 1;
              }
            }

            return {
              currentLevel,
              level: nextLevel,
              label: toQuizDifficultyLabel(nextLevel),
            };
          })
          .catch(() => ({
            currentLevel: 2,
            level: 2,
            label: "medium" as QuizDifficultyLabel,
          }))
      : Promise.resolve({ currentLevel: 2, level: 2, label: "medium" as QuizDifficultyLabel });

  const explainDepth = effectiveMode === "explain"
    ? classifyExplainDepth(auto.message, userMemory.rawMemoryText)
    : undefined;

  const [retrieval, webResult, quizAdaptive, latestDeck] = await Promise.all([
    retrievalPromise,
    searchPromise,
    adaptiveQuizPromise,
    latestDeckPromise,
  ]);

  const searchBlock = webResult.text ?? "";
  const searchUrls = webResult.urls ?? [];
  let searchSources = webResult.sources ?? [];
  const searchProvider = webResult.provider;
  const routeTraceSearchStatus =
    !routePlan.shouldUseWebSearch
      ? "skipped"
      : searchProvider === "searxng"
        ? "real_search"
        : searchProvider === "model_fallback"
          ? "model_knowledge"
          : "error";
  if (routePlan.retrievalScopes.length > 0) {
    pipelineController.markStageCompleted("ragRetrieval");
  } else {
    pipelineController.markStageSkipped("ragRetrieval", "No retrieval scope enabled after cost and route gating.");
  }
  if (routePlan.shouldUseWebSearch) {
    pipelineController.markStageCompleted("webSearch");
  } else {
    pipelineController.markStageSkipped("webSearch", "Web search disabled after request-class and route gating.");
  }
  const diag = retrieval.diagnostics as any;
  if (diag?.embeddingModel || diag?.embeddingUsage) {
    deferSubcall({
      phaseId: "retrieval",
      label: "Retrieval embedding",
      endpoint: "embeddings",
      status: "ok",
      modelUsed: diag.embeddingModel,
      inputTokens: diag.embeddingUsage?.prompt_tokens,
      outputTokens: diag.embeddingUsage?.completion_tokens,
      costCents: costCentsFromUsage(diag.embeddingUsage),
      durationMs: diag.embeddingDurationMs,
    });
  }
  if (searchProvider === "model_fallback" && (webResult.modelUsed || webResult.usage)) {
    deferSubcall({
      phaseId: "search",
      label: "Web search fallback briefing",
      endpoint: "chat.completions",
      status: "ok",
      modelUsed: webResult.modelUsed,
      inputTokens: webResult.usage?.prompt_tokens,
      outputTokens: webResult.usage?.completion_tokens,
      costCents: costCentsFromUsage(webResult.usage),
      durationMs: webResult.durationMs,
    });
  }
  if (routePlan.shouldUseWebSearch) {
    logger.info("web search complete", { urlCount: searchUrls.length });
    if (searchProvider === "model_fallback") {
      earlyEventBuffer.push({ type: "search_status", status: "model_fallback" });
    } else if (searchProvider === "searxng") {
      earlyEventBuffer.push({ type: "search_status", status: "real_search" });
    } else if (searchProvider === "error") {
      earlyEventBuffer.push({ type: "search_status", status: "error" });
    }
  }

  const contextQuizDifficulty =
    storedLearningContext && Number.isFinite(storedLearningContext.difficultyLevel)
      ? Math.max(1, Math.min(3, Math.round(storedLearningContext.difficultyLevel / 2)))
      : undefined;
  const quizDifficultyLevel = clampQuizDifficultyLevel(
    effectiveMode === "quiz" && typeof contextQuizDifficulty === "number"
      ? contextQuizDifficulty
      : quizAdaptive.level,
  );
  const quizDifficultyLabel = toQuizDifficultyLabel(quizDifficultyLevel);
  const quizDifficultyAdjusted = quizAdaptive.level !== quizAdaptive.currentLevel;
  if (effectiveMode === "quiz" && featureEnabled(orgSettings.org?.adaptiveQuizEnabled)) {
    void convexMutation("analytics:setQuizDifficultySignal", {
      actorClerkId: actor.clerkId,
      difficulty: quizDifficultyLevel,
    }).catch(() => {});
  }

  const researchEvidenceBlock =
    effectiveMode === "research"
      ? buildResearchEvidenceBlock({
          citations: retrieval.citations,
          searchSources,
        })
      : "";

  const previousAssistantModel = [...history]
    .reverse()
    .find((message) => message.role === "assistant" && message.modelUsed)?.modelUsed;

  const fallbackManualModel =
    body.manualModel
    ?? catalog.find((model) => model.modelId !== "openrouter/auto")?.modelId
    ?? "openrouter/auto";
  const routingMode = autoSettings.autoModel ? body.routerMode : "manual";
  const routingManualModel = autoSettings.autoModel ? body.manualModel : fallbackManualModel;
  const phaseThinkingLevel =
    routePlan.responseBudget === "simple"
      ? "low"
      : auto.thinkingLevel === "high"
        ? "high"
        : "medium";
  const phaseStake =
    routePlan.responseBudget === "deep"
      ? "high"
      : routePlan.responseBudget === "simple"
        ? "low"
        : "medium";
  const routeDecision = selectModelForPhase({
    phaseId: "analysis",
    phaseLabel: "Primary response",
    mode: effectiveMode,
    routerMode: routingMode,
    manualModel: routingManualModel,
    spendingTier: budget.tier,
    thinkingLevel: phaseThinkingLevel,
    stakes: phaseStake,
    messageLength: auto.message.length,
    needsSearch: routePlan.shouldUseWebSearch,
    hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
    requiredCapabilities: routePlan.candidateModelRequirements.required,
    preferredCapabilities: routePlan.candidateModelRequirements.preferred,
    preferredModelIds: [
      selectedAgent?.preferredModel,
    ].filter((value): value is string => Boolean(value)),
    previousModelUsed: previousAssistantModel,
    recentModels: history
      .filter((message) => message.role === "assistant")
      .map((message) => message.modelUsed)
      .filter((model): model is string => Boolean(model)),
    modelCatalog: catalog,
    modelRuntimeStats: runtimeStatMap,
    seedKey: `${chatId}:${normalizedMessage}`,
  });
  pipelineController.markStageCompleted("modelSelection");
  const pipelineSnapshot = pipelineController.getState();
  const route = {
    primaryModel: routeDecision.selectedModel,
    fallbackModels: routeDecision.fallbackModels,
    verificationModel: undefined as string | undefined,
    reason: routeDecision.reason,
    autoEnhanced: routingMode !== "manual",
    searchEnabled: routePlan.shouldUseWebSearch,
    trace: {
      inputs: {
        routerMode: routingMode,
        manualModel: routingManualModel,
        mode: effectiveMode,
        thinkingLevel: auto.thinkingLevel,
        complexPrompt: auto.complexity === "complex",
        promptCategory: auto.promptCategory,
        questionType: auto.questionType,
        isMultipart: auto.isMultipart,
        needsSearch: routePlan.shouldUseWebSearch,
        needsRag: retrieval.citations.length > 0,
        needsVision: (body.attachmentTypes?.length ?? 0) > 0,
        needsTabular: false,
        spendingTier: budget.tier,
        hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
        attachmentTypes: body.attachmentTypes ?? [],
        promptEnhanced: auto.promptEnhanced,
        messageLength: auto.message.length,
        conversationLength: history.length,
        requestClass: auto.requestClass,
        classificationReason: auto.classificationReason,
        previousModelUsed: previousAssistantModel,
        agentPreferredModel: selectedAgent?.preferredModel,
      },
      candidates: routeDecision.candidates,
      selected: {
        modelId: routeDecision.selectedModel,
        reason: routeDecision.reason,
      },
      toolchain: ["phase_router"],
      routePlan,
      fallbacks: [],
      routingDurationMs: routeDecision.routingDurationMs,
      phasePlan: [routeDecision.phase],
      subcalls: deferredSubcalls,
      requestClass: auto.requestClass,
      classificationReason: auto.classificationReason,
      stepsExecuted: pipelineSnapshot.completedStages,
      stepsSkipped: pipelineSnapshot.skippedStages.map((row) => ({
        step: row.step,
        reason: row.reason,
      })),
      searchStatus: routeTraceSearchStatus,
      costBudgetUsd: pipelineSnapshot.costBudgetUsd,
    },
  };
  const appendSubcall = (entry: {
    phaseId: string;
    label: string;
    endpoint: "chat.completions" | "embeddings";
    status: "ok" | "error";
    modelRequested?: string;
    modelUsed?: string;
    inputTokens?: number;
    outputTokens?: number;
    costCents?: number;
    durationMs?: number;
    reason?: string;
  }) => {
    const existing = route.trace.subcalls ?? [];
    const provider = entry.modelUsed ? entry.modelUsed.split("/")[0]?.toLowerCase() : undefined;
    existing.push({
      id: `${entry.phaseId}-${existing.length + 1}`,
      phaseId: entry.phaseId,
      label: entry.label,
      endpoint: entry.endpoint,
      status: entry.status,
      modelRequested: entry.modelRequested,
      modelUsed: entry.modelUsed,
      provider,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      costCents: entry.costCents,
      durationMs: entry.durationMs,
      reason: entry.reason,
    });
    route.trace.subcalls = existing;
  };
  const finalizePhasePlan = (params?: {
    memoryUpdated?: boolean;
    titleUpdated?: boolean;
    repaired?: boolean;
  }) => {
    if (!route.trace.phasePlan || route.trace.phasePlan.length === 0) return;
    const repaired = Boolean(params?.repaired)
      || route.trace.toolchain.some((tool) => tool.includes("repair"));
    route.trace.phasePlan = route.trace.phasePlan.map((phase) => {
      if (phase.id === "retrieval") {
        if (!routePlan.retrievalScopes.length) return { ...phase, status: "skipped", detail: "No retrieval scope enabled." };
        if (retrieval.citations.length > 0) {
          return { ...phase, status: "completed", detail: `Used ${retrieval.citations.length} source(s).` };
        }
        return { ...phase, status: "completed", detail: retrieval.diagnostics?.reason ?? "No high-confidence retrieval match." };
      }
      if (phase.id === "search") {
        if (!routePlan.shouldUseWebSearch) return { ...phase, status: "skipped", detail: "Web search not required." };
        return {
          ...phase,
          status: "completed",
          detail: searchBlock.trim() ? `Captured ${searchSources.length || searchUrls.length} web source(s).` : "No usable web results.",
        };
      }
      if (phase.id === "planning") {
        return multiAgentEnabled
          ? { ...phase, status: "completed", detail: "Specialist plan executed." }
          : { ...phase, status: "skipped", detail: "Single-pass route selected." };
      }
      if (phase.id === "analysis") {
        return { ...phase, status: "completed" };
      }
      if (phase.id === "authoring" || phase.id === "synthesis") {
        return { ...phase, status: "completed" };
      }
      if (phase.id === "verification") {
        return shouldVerify
          ? { ...phase, status: "completed" }
          : { ...phase, status: "skipped", detail: "Verification not required." };
      }
      if (phase.id === "repair") {
        return repaired
          ? { ...phase, status: "completed", detail: "Output formatting repaired." }
          : { ...phase, status: "skipped", detail: "No format repair needed." };
      }
      if (phase.id === "memory") {
        return params?.memoryUpdated
          ? { ...phase, status: "completed", detail: "User memory updated." }
          : { ...phase, status: "skipped", detail: "No durable memory update extracted." };
      }
      if (phase.id === "title") {
        return params?.titleUpdated
          ? { ...phase, status: "completed", detail: "Chat title updated." }
          : { ...phase, status: "skipped", detail: "Title unchanged." };
      }
      return { ...phase, status: "completed" };
    });
  };
  const manualLockRequested = body.routerMode === "manual" && Boolean(body.manualModel) && !body.forcedModel;
  if (manualLockRequested && body.manualModel && route.primaryModel !== body.manualModel) {
    const allowedAlternatives = route.trace.candidates
      .filter((candidate) => candidate.allowed)
      .map((candidate) => candidate.modelId)
      .filter((modelId, index, source) => source.indexOf(modelId) === index)
      .slice(0, 3);
    await rollbackPersistedUserMessage();
    return jsonError(409, {
      code: "MANUAL_MODEL_RESTRICTED",
      message:
        allowedAlternatives.length > 0
          ? `Selected model cannot be used under current tier limits. Try: ${allowedAlternatives.join(", ")}.`
          : "Selected model cannot be used under current tier limits. Choose a budget-safe model.",
      retryable: false,
    });
  }
  logger.info("routing complete", {
    primaryModel: route.primaryModel,
    fallbackCount: route.fallbackModels.length,
    reason: route.reason,
  });

  if (body.forcedModel && body.forcedModel !== route.primaryModel) {
    if (!canUseInTier(body.forcedModel, budget.tier, catalog)) {
      logger.warn("forcedModel rejected by tier policy", {
        forcedModel: body.forcedModel,
        tier: budget.tier,
      });
    } else {
      const originalPrimary = route.primaryModel;
      route.primaryModel = body.forcedModel;
      route.fallbackModels = [
        originalPrimary,
        ...route.fallbackModels.filter(
          (candidate) => candidate !== body.forcedModel && candidate !== originalPrimary,
        ),
      ];
      route.reason = `${route.reason}; retry override after temporary model saturation`;
      route.trace.selected = {
        modelId: route.primaryModel,
        reason: route.reason,
      };
      route.trace.candidates.unshift({
        modelId: body.forcedModel,
        allowed: true,
        score: 0.95,
        reason: "Retry override selected to avoid repeating a saturated model",
      });
      route.trace.toolchain.push("retry_model_override");
    }
  }

  if (retrieval.citations.length > 0) route.trace.toolchain.push("rag_retrieval");
  if (retrieval.diagnostics?.status) {
    route.trace.toolchain.push(`retrieval_${retrieval.diagnostics.status}`);
  }
  if (routePlan.shouldUseWebSearch) route.trace.toolchain.push("web_search");
  if (routePlan.shouldUseWebSearch) {
    if (searchProvider === "searxng") {
      route.trace.toolchain.push("search_provider_searxng");
    } else if (searchProvider === "model_fallback") {
      route.trace.toolchain.push("search_provider_model_fallback");
    } else if (searchProvider === "error") {
      route.trace.toolchain.push("search_provider_error");
    }
  }
  if (agentSuggestion) route.trace.toolchain.push("agent_suggestion");
  if (explainDepth) route.trace.toolchain.push("explain_depth_detection");
  if (effectiveMode === "quiz" && featureEnabled(orgSettings.org?.adaptiveQuizEnabled)) {
    route.trace.toolchain.push("adaptive_quiz");
    route.trace.toolchain.push(`quiz_difficulty_${quizDifficultyLabel}`);
    if (quizDifficultyAdjusted) {
      route.trace.toolchain.push(
        quizDifficultyLevel > quizAdaptive.currentLevel
          ? "quiz_difficulty_increased"
          : "quiz_difficulty_decreased",
      );
    }
  }
  if (researchEvidenceBlock) {
    route.trace.toolchain.push("source_reliability");
    route.trace.toolchain.push("cross_reference");
  }
  if (auto.promptEnhanced) route.trace.toolchain.push("prompt_enhancement");
  if (existingSummary || scheduledCompaction) route.trace.toolchain.push("context_compaction");
  route.trace.toolchain.push("route_plan");
  route.trace.routePlan = routePlan;
  if (runtimeSkills.length > 0) {
    route.trace.toolchain.push("skill_fetch");
  }

  const attachments = await normalizeAttachments({
    actorClerkId: actor.clerkId,
    resourceIds: body.attachmentResourceIds ?? [],
    convexQuery,
  });
  const attachmentCitations = attachments.prepared.map((attachment) => ({
    resourceId: attachment.resourceId,
    filename: attachment.filename,
    sourceType: "personal" as const,
  }));
  const allImageBlocks = [
    ...attachments.imageContentBlocks,
    ...referencedHistoryImageBlocks,
  ];
  const requiresVision = allImageBlocks.length > 0;

  if (requiresVision) {
    route.trace.toolchain.push("vision_gate");
  }
  if (referencedHistoryImageBlocks.length > 0) {
    route.trace.toolchain.push("history_image_reference");
  }

  let capability = gateCapabilities({
    selectedModel: route.primaryModel,
    requiresVision,
    fallbackModels: route.fallbackModels,
    modelCatalog: catalog,
    spendingTier: budget.tier,
  });

  if (capability.modelSwitched) {
    if (manualLockRequested) {
      const manualVisionPrepassModel = capability.prepassModel
        ?? route.fallbackModels.find((candidate) => {
          const fallbackMeta = catalog.find((model) => model.modelId === candidate);
          return fallbackMeta ? modelSupportsCapability(fallbackMeta, "vision") : false;
        });
      capability = {
        finalModel: route.primaryModel,
        modelSwitched: false,
        requiresPrepass: Boolean(manualVisionPrepassModel),
        prepassModel: manualVisionPrepassModel,
        userNotice: manualVisionPrepassModel
          ? "Manual model kept; using vision prepass for attached images."
          : "Manual model kept. No vision-capable prepass model available in your current tier.",
      };
      route.reason = `${route.reason}; manual model retained with vision prepass`;
      route.trace.toolchain.push("vision_prepass_manual_lock");
    } else {
      const originalPrimary = route.primaryModel;
      route.primaryModel = capability.finalModel;
      route.fallbackModels = [
        originalPrimary,
        ...route.fallbackModels.filter(
          (candidate) => candidate !== capability.finalModel && candidate !== originalPrimary,
        ),
      ];
      route.reason = `${route.reason}; switched to vision-capable model`;
      route.trace.selected = {
        modelId: route.primaryModel,
        reason: route.reason,
      };
      route.trace.toolchain.push("vision_gate");
    }
  }

  earlyEventBuffer.push({
    type: "route_model",
    modelUsed: route.primaryModel,
  });

  let imageDescriptionBlock = "";
  if (capability.requiresPrepass && capability.prepassModel && allImageBlocks.length > 0) {
    const visionPrepassStartedAt = Date.now();
    imageDescriptionBlock = await runVisionPrepass({
      actorClerkId: actor.clerkId,
      chatId,
      imageContentBlocks: allImageBlocks,
      userMessage: auto.message,
      model: capability.prepassModel,
      fallbackModels: route.fallbackModels,
    });
    appendSubcall({
      phaseId: "analysis",
      label: "Vision prepass",
      endpoint: "chat.completions",
      status: "ok",
      modelRequested: capability.prepassModel,
      modelUsed: capability.prepassModel,
      durationMs: Date.now() - visionPrepassStartedAt,
    });
    route.trace.toolchain.push("vision_prepass");
  }

  const primaryModel = route.primaryModel;
  const primaryModelMeta = catalog.find((model) => model.modelId === primaryModel);
  const modelSupportsExtendedThinking = primaryModelMeta
    ? modelSupportsCapability(primaryModelMeta, "reasoning")
    : auto.thinkingLevel !== "high";
  const effectiveThinkingLevel = modelSupportsExtendedThinking
    ? auto.thinkingLevel
    : auto.thinkingLevel === "high"
      ? "medium"
      : auto.thinkingLevel;

  const gate = tutorGate(attemptStats.attemptCount, attemptStats.hasReflection);
  const schoolNow = formatSchoolNow(orgSettings.org?.timezone, (warning) => {
    logger.warn(warning, {
      requestedTimeZone: orgSettings.org?.timezone,
    });
  });
  const retrievalStatus =
    retrieval.citations.length > 0
      ? `scoped retrieval available (${retrieval.citations.length} source${retrieval.citations.length === 1 ? "" : "s"})`
      : retrieval.diagnostics?.reason ?? "not used";
  const searchStatus = routePlan.shouldUseWebSearch
    ? (searchBlock.trim()
        ? "web search already run; use the provided web context and do not claim browsing is unavailable"
        : "web search allowed for this route but returned no usable results")
    : "web search not enabled for this route";
  const shouldPlanMemoryRead = memoryEnabled && pipelineController.shouldRun("memoryRead");
  const memoryPlan = shouldPlanMemoryRead
    ? await planMemoryRead({
        actorClerkId: actor.clerkId,
        chatId,
        message: auto.message,
        includeTopicMemory: routePlan.shouldConsultMemory,
        personalSoulPreferences: personalSoulPrefs,
        rawMemoryText: userMemory.rawMemoryText,
        existingEmbedding: retrieval.queryEmbedding
          ? {
              embedding: retrieval.queryEmbedding,
              model: (retrieval.diagnostics as { embeddingModel?: string } | undefined)?.embeddingModel,
            }
          : undefined,
        onEmbeddingCall: (call) => {
          appendSubcall({
            phaseId: "memory",
            label: "Memory retrieval embedding",
            endpoint: "embeddings",
            status: "ok",
            modelUsed: call.model,
            inputTokens: call.usage?.prompt_tokens,
            outputTokens: call.usage?.completion_tokens,
            costCents: costCentsFromUsage(call.usage),
            durationMs: call.durationMs,
          });
        },
      })
    : {
        profileText: "",
        layer2Text: "",
        layer3Text: "",
        layer2Count: 0,
        layer3Count: 0,
        retrievedTopicEntries: [],
      };
  if (shouldPlanMemoryRead) {
    pipelineController.markStageCompleted("memoryRead");
  } else if (!memoryEnabled) {
    pipelineController.markStageSkipped("memoryRead", "Memory disabled by user preference.");
  }

  const memoryStatus = memoryPlan.profileText
    ? `global ${memoryPlan.layer2Count} fact(s), topic ${memoryPlan.layer3Count} match(es)`
    : "no relevant memory entries";
  const directiveStatus = directiveMemorySummary.forgotten > 0
    || directiveMemorySummary.negativeLinks > 0
    || directiveMemorySummary.written > 0
    ? `forget=${directiveMemorySummary.forgotten}, blockedLinks=${directiveMemorySummary.negativeLinks}, explicitWrites=${directiveMemorySummary.written}`
    : "none";
  const learningContextPrompt = formatLearningContextForPrompt(storedLearningContext);
  const modeTransformGuidance = buildModeTransformGuidance({
    mode: effectiveMode,
    message: normalizedMessage,
    learningContext: storedLearningContext,
    existingFlashcardFronts: latestDeck?.cards.map((card) => card.front) ?? [],
  });
  const learningContextStatus = storedLearningContext
    ? `topics=${storedLearningContext.topics.length}, facts=${storedLearningContext.keyFacts.length}, cards=${storedLearningContext.flashcardCandidates.length}`
    : "none";
  const runtimeContextBlock = [
    `School: ${orgSettings.org?.name ?? "Spectra"}`,
    `School type: ${orgSettings.org?.schoolType ?? "unspecified"}`,
    `Country: ${orgSettings.org?.country ?? "unspecified"}`,
    `Curriculum: ${orgSettings.org?.curriculum ?? "unspecified"}`,
    `Exam board: ${orgSettings.org?.examBoard ?? "unspecified"}`,
    `Grade levels: ${orgSettings.org?.gradeLevels?.join(", ") || "unspecified"}`,
    `Timezone: ${schoolNow.timeZone}`,
    `Current date: ${schoolNow.label}`,
    `Allowed tool bundles: ${routePlan.allowedToolBundles.join(", ") || "none"}`,
    `Retrieval: ${retrievalStatus}`,
    `Web search: ${searchStatus}`,
    `Memory profile: ${memoryStatus}`,
    `Memory directives applied: ${directiveStatus}`,
    `Learning context: ${learningContextStatus}`,
  ].join("\n");
  const personalSoulExcerpt = buildPersonalSoulExcerpt({
    preferences: null,
    memoryProfile: memoryEnabled ? memoryPlan.profileText : "",
  });
  const useMemoryProfile = memoryEnabled && Boolean(personalSoulExcerpt);
  if (useMemoryProfile) {
    route.trace.toolchain.push("memory_injection");
  }
  if (directiveStatus !== "none") {
    route.trace.toolchain.push("memory_directives");
  }
  if (schoolSoulCapsule.capsule.trim()) {
    route.trace.toolchain.push("school_soul_capsule");
  }
  if (learningContextPrompt) {
    route.trace.toolchain.push("learning_context_injection");
  }
  if (modeTransformGuidance) {
    route.trace.toolchain.push("mode_transform_guidance");
  }

  const systemPromptParts = [buildSystemPrompt({
    mode: effectiveMode,
    strictness: "medium",
    guidelines: {
      summary:
        selectedAgent?.guidelinesSummary ??
        "General school guidance. Upload resources to strengthen topic alignment.",
      topicMap: selectedAgent?.guidelinesTopicMap ?? [],
      rubricHints: [],
      misconceptions: [],
    },
    sourceBlock: retrieval.sourceBlock,
    gate,
    agent: selectedAgent
      ? {
          name: selectedAgent.name,
          description: selectedAgent.description,
          systemPrompt: selectedAgent.systemPrompt.replace(/\s+/g, " ").trim().slice(0, 420),
          guidelinesSummary: selectedAgent.guidelinesSummary,
          guidelinesTopicMap: selectedAgent.guidelinesTopicMap,
        }
      : undefined,
    memoryProfile: useMemoryProfile ? personalSoulExcerpt : undefined,
    contextSummary: existingSummary,
    searchBlock,
    explainDepth,
    quizDifficultyLevel,
    quizDifficultyLabel,
  })];

  systemPromptParts.push(`=== RUNTIME CONTEXT ===\n${runtimeContextBlock}\n=== END RUNTIME CONTEXT ===`);
  if (learningContextPrompt) {
    systemPromptParts.push(`=== LEARNING CONTEXT ===\n${learningContextPrompt}\n=== END LEARNING CONTEXT ===`);
  }
  if (modeTransformGuidance) {
    systemPromptParts.push(`=== MODE TRANSFORM GUIDANCE ===\n${modeTransformGuidance}\n=== END MODE TRANSFORM GUIDANCE ===`);
  }
  systemPromptParts.push(
    `=== MODE CONTRACT ===
Pedagogy: ${routePlan.modeContract.pedagogy}
Output format: ${routePlan.modeContract.outputFormat}
Response depth: ${routePlan.modeContract.responseDepth}
Escalation: ${routePlan.modeContract.escalationPolicy}
Allowed bundles: ${routePlan.modeContract.toolBundles.join(", ") || "none"}
Validator: ${routePlan.modeContract.validator}
=== END MODE CONTRACT ===`,
  );
  systemPromptParts.push(
    `=== ROUTE PRIMITIVES ===
Web search bundle: ${routePlan.shouldUseWebSearch ? "enabled" : "disabled"}.
Retrieved school resources: ${retrieval.citations.length > 0 ? `${retrieval.citations.length} source(s) available` : routePlan.retrievalScopes.length > 0 ? "enabled but no high-confidence sources found" : "disabled"}.
Memory bundle: ${useMemoryProfile ? "layered memory injected (global + topic-aware)" : memoryEnabled ? "enabled but no relevant memory injected" : "disabled"}.
Multi-agent collaboration: ${routePlan.allowSubAgents ? "allowed only if the route earns it" : "disabled"}.
If web search is enabled, use the provided search briefing and sources instead of claiming you lack web access.
If retrieval is enabled, ground claims in the provided classroom sources instead of saying files are unavailable.
If sources exist, cite them inline where useful and finish with a compact sources section.
Do not invent tool calls that were not actually run.
=== END ROUTE PRIMITIVES ===`,
  );
  const runtimeSkillBlock = formatRuntimeSkillBlock(runtimeSkills);
  if (runtimeSkillBlock) {
    systemPromptParts.push(runtimeSkillBlock);
    route.trace.toolchain.push("skill_guidance_applied");
  }
  if (routePlan.agentContract) {
    systemPromptParts.push(
      `=== AGENT CONTRACT ===
Agent: ${routePlan.agentContract.name ?? "Focused agent"}
Scope: ${routePlan.agentContract.scope}
Resource scopes: ${routePlan.agentContract.resourceScopes.join(", ") || "none"}
Allowed bundles: ${routePlan.agentContract.toolBundles.join(", ") || "none"}
=== END AGENT CONTRACT ===`,
    );
  }
  systemPromptParts.push(
    `=== TOOL EXECUTION CONTEXT ===
Route-approved bundles: ${routePlan.allowedToolBundles.join(", ") || "none"}
Search route enabled: ${routePlan.shouldUseWebSearch ? "yes" : "no"}
Retrieval scopes enabled: ${routePlan.retrievalScopes.join(", ") || "none"}
Memory route enabled: ${memoryEnabled ? "yes" : "no"}
Web results provided below: ${searchSources.length > 0 ? "yes" : "no"}
Retrieved classroom/personal sources provided below: ${retrieval.citations.length > 0 ? "yes" : "no"}
If a route-approved capability returned no results, say that no usable results were found.
Do not claim you lack a supported tool when search, retrieval, or memory context is already provided in this prompt.
=== END TOOL EXECUTION CONTEXT ===`,
  );
  if (featureEnabled(orgSettings.org?.soulEnabled) && schoolSoulCapsule.capsule.trim()) {
    systemPromptParts.push(
      `=== SCHOOL SOUL ${schoolSoulCapsule.version} ===\n${schoolSoulCapsule.capsule}\n=== END SCHOOL SOUL ===`,
    );
  }

  if (attachments.quickExtractBlock) {
    systemPromptParts.push(attachments.quickExtractBlock);
  }
  if (researchEvidenceBlock) {
    systemPromptParts.push(researchEvidenceBlock);
  }
  if (imageDescriptionBlock) {
    systemPromptParts.push(`IMAGE DESCRIPTION:\n${imageDescriptionBlock}`);
  }

  const multiAgentGateDebug = {
    budgetTier: budget.tier,
    allowSubAgents: routePlan.allowSubAgents,
    orchestratorV2Enabled: orgSettings.org?.orchestratorV2Enabled,
    shouldUseWebSearch: routePlan.shouldUseWebSearch,
    citationCount: retrieval.citations.length,
    shouldUseMultiAgentResult: shouldUseMultiAgent(auto.message, effectiveMode, auto.complexity),
    complexity: auto.complexity,
    effectiveMode,
    requestClass: auto.requestClass,
    forceMultiAgent: body.forceMultiAgent,
    forceMultiAgentAllowed,
    forceMultiAgentDeniedReason,
  };
  logger.info("multi-agent gate evaluation", multiAgentGateDebug);

  const tierAllowsMultiAgent = budget.tier !== "free_only" && budget.tier !== "cheap_only";
  const requestClassAllowsMultiAgent = auto.requestClass === "T2" || auto.requestClass === "T3";
  const autoMultiAgentEligible =
    tierAllowsMultiAgent
    && routePlan.allowSubAgents
    && featureEnabled(orgSettings.org?.orchestratorV2Enabled)
    && requestClassAllowsMultiAgent
    && !budget.softLimitReached
    && !budget.hardLimitReached
    && (
      routePlan.shouldUseWebSearch
      || retrieval.citations.length > 0
      || shouldUseMultiAgent(auto.message, effectiveMode, auto.complexity)
    );
  const multiAgentEnabled = forceMultiAgentAllowed || autoMultiAgentEligible;
  if (body.forceMultiAgent && !forceMultiAgentAllowed && forceMultiAgentDeniedReason) {
    route.trace.toolchain.push("force_multi_agent_denied");
  }
  if (multiAgentEnabled) {
    route.trace.toolchain.push("multi_agent_collaboration");
    pipelineController.markStageCompleted("multiAgent");
  } else {
    pipelineController.markStageSkipped(
      "multiAgent",
      forceMultiAgentDeniedReason
        ? `forceMultiAgent denied: ${forceMultiAgentDeniedReason}.`
        : "Multi-agent not eligible for this request.",
    );
  }
  const gatedPipelineSnapshot = pipelineController.getState();
  route.trace.stepsExecuted = gatedPipelineSnapshot.completedStages;
  route.trace.stepsSkipped = gatedPipelineSnapshot.skippedStages.map((row) => ({
    step: row.step,
    reason: row.reason,
  }));

  const collabWallTimeMs =
    routePlan.responseBudget === "deep"
      ? (effectiveMode === "research" ? 210_000 : 170_000)
      : effectiveMode === "research"
        ? 170_000
        : 120_000;
  const collabLimits =
    budget.tier === "free_only"
      ? {
          maxSpecialists: routePlan.responseBudget === "deep" ? 2 : 1,
          maxSubcalls: routePlan.responseBudget === "deep" ? 3 : 2,
          maxTokensPerSpecialist: routePlan.responseBudget === "deep" ? 750 : 600,
          includeCritic: false,
          maxWallTimeMs: collabWallTimeMs,
        }
      : budget.tier === "cheap_only"
        ? {
            maxSpecialists: effectiveMode === "research" ? (routePlan.responseBudget === "deep" ? 5 : 4) : 3,
            maxSubcalls: effectiveMode === "research" ? (routePlan.responseBudget === "deep" ? 5 : 4) : 3,
            maxTokensPerSpecialist: effectiveMode === "research" ? (routePlan.responseBudget === "deep" ? 1300 : 1100) : 900,
            includeCritic: false,
            maxWallTimeMs: collabWallTimeMs,
          }
        : {
            maxSpecialists: effectiveMode === "research" ? (routePlan.responseBudget === "deep" ? 8 : 7) : 5,
            maxSubcalls: effectiveMode === "research" ? (routePlan.responseBudget === "deep" ? 9 : 8) : 6,
            maxTokensPerSpecialist: effectiveMode === "research" ? (routePlan.responseBudget === "deep" ? 1850 : 1600) : 1200,
            includeCritic: true,
            maxWallTimeMs: collabWallTimeMs,
          };
  if (!collabLimits.includeCritic) {
    route.trace.toolchain.push("critic_skipped_budget_guard");
  }

  const taskGraph = multiAgentEnabled
    ? buildTaskGraph(auto.message, effectiveMode, {
        hasVision: attachments.requiresVision,
        searchEnabled: routePlan.shouldUseWebSearch,
        sourceBlock: retrieval.sourceBlock,
        searchBlock,
        includeCritic: collabLimits.includeCritic,
        maxSpecialists: collabLimits.maxSpecialists,
      })
    : [];

  const supportDecision = selectModelForPhase({
    phaseId: "repair",
    phaseLabel: "Format repair",
    mode: effectiveMode,
    routerMode: routingMode,
    manualModel: routingManualModel,
    spendingTier: budget.tier,
    thinkingLevel: "low",
    stakes: "low",
    messageLength: auto.message.length,
    requiredCapabilities: [],
    preferredCapabilities: ["reasoning"],
    preferredModelIds: [route.primaryModel],
    previousModelUsed: route.primaryModel,
    recentModels: history
      .filter((message) => message.role === "assistant")
      .map((message) => message.modelUsed)
      .filter((model): model is string => Boolean(model)),
    modelCatalog: catalog,
    modelRuntimeStats: runtimeStatMap,
    seedKey: `${chatId}:${normalizedMessage}:support`,
  });
  const supportModel = supportDecision.selectedModel;
  const supportFallbackModels = Array.from(
    new Set(
      [route.primaryModel, ...route.fallbackModels, ...supportDecision.fallbackModels]
        .filter((modelId) => modelId && modelId !== supportModel),
    ),
  ).slice(0, 4);
  const synthesisDecision = selectModelForPhase({
    phaseId: "synthesis",
    phaseLabel: "Final synthesis",
    mode: effectiveMode,
    routerMode: routingMode,
    manualModel: routingManualModel,
    spendingTier: budget.tier,
    thinkingLevel: routePlan.responseBudget === "deep" ? "high" : "medium",
    stakes: routePlan.responseBudget === "deep" ? "high" : "medium",
    messageLength: auto.message.length,
    needsSearch: routePlan.shouldUseWebSearch,
    requiredCapabilities: ["reasoning"],
    preferredCapabilities:
      routePlan.shouldUseWebSearch
        ? ["reasoning", "search"]
        : ["reasoning"],
    preferredModelIds: [selectedAgent?.preferredModel, route.primaryModel].filter((value): value is string => Boolean(value)),
    previousModelUsed: route.primaryModel,
    recentModels: history
      .filter((message) => message.role === "assistant")
      .map((message) => message.modelUsed)
      .filter((model): model is string => Boolean(model)),
    modelCatalog: catalog,
    modelRuntimeStats: runtimeStatMap,
    seedKey: `${chatId}:${normalizedMessage}:synthesis`,
  });
  const synthesisModel = synthesisDecision.selectedModel ?? supportModel;
  const synthesisFallbackModels = Array.from(
    new Set(
      [
        ...synthesisDecision.fallbackModels,
        ...supportFallbackModels,
        route.primaryModel,
        ...route.fallbackModels,
      ].filter((candidate) => candidate && candidate !== synthesisModel),
    ),
  ).slice(0, 5);
  if (multiAgentEnabled && synthesisModel !== route.primaryModel) {
    route.trace.toolchain.push("synthesis_model_reselect");
  }

  const messages = [
    { role: "system", content: systemPromptParts.join("\n\n") },
    ...toOpenRouterMessages(
      historyForModel,
      capability.requiresPrepass ? undefined : allImageBlocks,
    ),
  ];
  const specialistConversationContext = buildSpecialistConversationContext(historyForModel);

  const shouldVerify = effectiveMode === "marker" && Boolean(orgSettings.org?.verifyMarkerPassEnabled);
  if (shouldVerify) {
    const verificationDecision = selectModelForPhase({
      phaseId: "verification",
      phaseLabel: "Verification",
      mode: effectiveMode,
      routerMode: routingMode,
      manualModel: routingManualModel,
      spendingTier: budget.tier,
      thinkingLevel: "medium",
      stakes: "high",
      messageLength: auto.message.length,
      requiredCapabilities: ["reasoning"],
      preferredCapabilities: ["reasoning"],
      preferredModelIds: [supportModel, route.primaryModel],
      previousModelUsed: route.primaryModel,
      recentModels: history
        .filter((message) => message.role === "assistant")
        .map((message) => message.modelUsed)
        .filter((model): model is string => Boolean(model)),
      modelCatalog: catalog,
      modelRuntimeStats: runtimeStatMap,
      seedKey: `${chatId}:${normalizedMessage}:verification`,
    });
    route.verificationModel = verificationDecision.selectedModel;
  }
  route.trace.phasePlan = buildPhasePlan({
    routeNeedsRetrieval: retrieval.citations.length > 0 || routePlan.retrievalScopes.length > 0,
    routeNeedsSearch: routePlan.shouldUseWebSearch,
    multiAgentEnabled,
    shouldVerify,
    shouldRepair: effectiveMode === "quiz" || effectiveMode === "flashcard",
    shouldWriteMemory: routePlan.shouldWriteMemory,
    shouldGenerateTitle: isFirstAssistantTurn,
  });
  route.trace.phasePlan = route.trace.phasePlan.map((phase) => {
    if (phase.id === "analysis") return { ...phase, model: route.primaryModel, thinkingLevel: phaseThinkingLevel };
    if (phase.id === "authoring") return { ...phase, model: route.primaryModel, thinkingLevel: phaseThinkingLevel };
    if (phase.id === "synthesis") {
      return {
        ...phase,
        model: synthesisModel,
        thinkingLevel: routePlan.responseBudget === "deep" ? "high" : "medium",
      };
    }
    if (phase.id === "verification") return { ...phase, model: route.verificationModel ?? route.primaryModel, thinkingLevel: "medium" };
    if (phase.id === "repair") return { ...phase, model: supportModel, thinkingLevel: "low" };
    if (phase.id === "retrieval") return { ...phase, model: (retrieval.diagnostics as any)?.embeddingModel };
    if (phase.id === "search") return { ...phase, model: (webResult as any).modelUsed };
    return phase;
  });
  type PhaseUpdateStatus = "planned" | "in_progress" | "completed" | "skipped" | "failed";
  const toPhaseTraceStatus = (status: PhaseUpdateStatus) => (status === "in_progress" ? "running" : status);
  const applyPhaseUpdate = (phaseId: string, status: PhaseUpdateStatus, detail?: string) => {
    const now = Date.now();
    route.trace.phasePlan = (route.trace.phasePlan ?? []).map((phase) => {
      if (phase.id !== phaseId) return phase;
      return {
        ...phase,
        status: toPhaseTraceStatus(status),
        detail: detail ?? phase.detail,
        startedAt: status === "in_progress" ? phase.startedAt ?? now : phase.startedAt,
        finishedAt: status === "completed" || status === "skipped" || status === "failed" ? now : phase.finishedAt,
      };
    });
    return route.trace.phasePlan;
  };
  const queuePhaseUpdate = (phaseId: string, status: PhaseUpdateStatus, detail?: string) => {
    const phasePlan = applyPhaseUpdate(phaseId, status, detail);
    earlyEventBuffer.push({
      type: "phase_update",
      phaseId,
      status,
      detail,
      phasePlan,
    });
  };
  const emitPhaseUpdate = async (phaseId: string, status: PhaseUpdateStatus, detail?: string) => {
    const phasePlan = applyPhaseUpdate(phaseId, status, detail);
    await send({
      type: "phase_update",
      phaseId,
      status,
      detail,
      phasePlan,
    });
  };
  const subcallTokenTotals = () => {
    const subcalls = route.trace.subcalls ?? [];
    return subcalls.reduce(
      (sum, call) => ({
        input: sum.input + (call.inputTokens ?? 0),
        output: sum.output + (call.outputTokens ?? 0),
      }),
      { input: 0, output: 0 },
    );
  };
  if (route.trace.phasePlan?.some((phase) => phase.id === "retrieval")) {
    if (!routePlan.retrievalScopes.length) {
      queuePhaseUpdate("retrieval", "skipped", "No retrieval scope enabled.");
    } else if (retrieval.citations.length > 0) {
      queuePhaseUpdate("retrieval", "completed", `Used ${retrieval.citations.length} source(s).`);
    } else {
      queuePhaseUpdate("retrieval", "completed", retrieval.diagnostics?.reason ?? "No high-confidence retrieval match.");
    }
  }
  if (route.trace.phasePlan?.some((phase) => phase.id === "search")) {
    if (!routePlan.shouldUseWebSearch) {
      queuePhaseUpdate("search", "skipped", "Web search not required.");
    } else {
      const sourceCount = searchSources.length || searchUrls.length;
      queuePhaseUpdate(
        "search",
        "completed",
        searchBlock.trim() ? `Captured ${sourceCount} web source(s).` : "No usable web results.",
      );
    }
  }
  earlyEventBuffer.push({
    type: "phase_update",
    phasePlan: route.trace.phasePlan,
  });
  if (shouldVerify) {
    route.trace.toolchain.push("marker_verification");
  }
  if (manualLockRequested) {
    route.fallbackModels = [];
  }
  logger.info("streaming start", {
    model: route.primaryModel,
    shouldVerify,
    multiAgentEnabled,
  });

  // Lower token budget for vague quiz/flashcard requests - the model only needs
  // a short clarifying question, not a full quiz or flashcard deck.
  const modeMaxTokens = MODE_MAX_TOKENS[effectiveMode] ?? 2048;
  const budgetAwareMaxTokens =
    routePlan.responseBudget === "simple"
      ? Math.min(modeMaxTokens, 900)
      : routePlan.responseBudget === "normal"
        ? Math.min(modeMaxTokens, effectiveMode === "research" || effectiveMode === "document" ? 2400 : 1800)
        : modeMaxTokens;
  const maxTokens = isVagueRequest
    ? Math.min(512, budgetAwareMaxTokens)
    : budgetAwareMaxTokens;
  const earlyTitlePromise = isFirstAssistantTurn
    ? maybeGenerateTitleFromUserPrompt({
        chatId,
        actorClerkId: actor.clerkId,
        userMessage: normalizedMessage,
        onModelCall: (call) => {
          appendSubcall({
            phaseId: "title",
            label: "Early title generation",
            endpoint: "chat.completions",
            status: "ok",
            modelUsed: call.model,
            inputTokens: call.usage?.prompt_tokens,
            outputTokens: call.usage?.completion_tokens,
            costCents: costCentsFromUsage(call.usage),
            durationMs: call.durationMs,
          });
        },
      }).catch((error) => {
        logger.warn("early chat title generation failed", {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      })
    : Promise.resolve(undefined);

  void (async () => {
    let assistantPersisted = false;
    const recordModelRuntime = async (modelId: string | undefined, success: boolean, latencyMs?: number) => {
      if (!modelId || !modelId.trim()) return;
      await convexMutation("models:recordModelRun", {
        actorClerkId: actor.clerkId,
        modelId,
        success,
        latencyMs,
      }).catch(() => {});
    };

    try {
      // Flush events buffered before the Response (and its reader) were created
      for (const event of earlyEventBuffer) {
        await send(event);
      }

      // Surface vision capability notice to the user
      if (capability.userNotice) {
        await send({ type: "notice", message: capability.userNotice });
      }
      if (retrieval.citations.length > 0) {
        await send({
          type: "rag_used",
          sources: retrieval.citations.map((citation) => ({
            filename: citation.filename,
            page: citation.page,
            sourceType: citation.sourceType,
          })),
        });
      }

      void earlyTitlePromise.then((title) => {
        if (!title) return;
        void send({
          type: "chat_title",
          chatTitle: title,
          chatId,
        });
      });

      if (effectiveMode === "image") {
        if (route.trace.phasePlan?.some((phase) => phase.id === "analysis")) {
          await emitPhaseUpdate("analysis", "in_progress");
          await emitPhaseUpdate("analysis", "completed", "Prepared image generation context.");
        }
        route.trace.toolchain.push("image_prompt_refinement");
        if (route.trace.phasePlan?.some((phase) => phase.id === "planning")) {
          await emitPhaseUpdate("planning", "in_progress");
        }
        const promptRefinementStartedAt = Date.now();
        const promptRefinement = await openRouterChatCompletion({
          model: primaryModel,
          fallbackModels: route.fallbackModels,
          messages: [
            {
              role: "system",
              content:
                "Rewrite the user request into one concise image-generation prompt. Keep style, subject, framing, and lighting details. Return only the prompt text.",
            },
            { role: "user", content: auto.message },
          ],
          maxTokens: 220,
          temperature: 0.3,
        }).catch(() => null);
        if (promptRefinement) {
          appendSubcall({
            phaseId: "planning",
            label: "Image prompt refinement",
            endpoint: "chat.completions",
            status: "ok",
            modelRequested: primaryModel,
            modelUsed: promptRefinement.model ?? primaryModel,
            inputTokens: promptRefinement.usage?.prompt_tokens,
            outputTokens: promptRefinement.usage?.completion_tokens,
            costCents: costCentsFromUsage(promptRefinement.usage),
            durationMs: Date.now() - promptRefinementStartedAt,
          });
          await recordOpenRouterUsage({
            actorClerkId: actor.clerkId,
            chatId,
            model: promptRefinement.model ?? primaryModel,
            usage: promptRefinement.usage,
            pricing: resolveCatalogPricing(promptRefinement.model ?? primaryModel),
          }).catch(() => {});
        }
        if (route.trace.phasePlan?.some((phase) => phase.id === "planning")) {
          await emitPhaseUpdate("planning", "completed", "Image prompt refined.");
        }

        const refinedPrompt =
          promptRefinement?.choices?.[0]?.message?.content?.trim() || auto.message;

        route.trace.toolchain.push("image_generation");
        if (route.trace.phasePlan?.some((phase) => phase.id === "authoring")) {
          await emitPhaseUpdate("authoring", "in_progress");
        }
        const imageModelSelection = pickModelAndFallbacks({
          catalog: catalog.filter((model) => model.modelId !== "openrouter/auto"),
          tier: budget.tier,
          requiredCapabilities: ["image_generation"],
          preferredCapabilities: ["image_generation"],
          runtimeStats: runtimeStatMap,
          maxFallbacks: 3,
        });
        const selectedImageModel =
          body.imageModel
          || imageModelSelection.selected?.modelId
          || primaryModel;
        const imageFallbackModels = Array.from(
          new Set([
            ...imageModelSelection.fallbacks,
            ...route.fallbackModels,
          ]),
        ).filter((candidate) => candidate !== selectedImageModel);
        const imageGenerationStartedAt = Date.now();
        const imageResult = await openRouterGenerateImage({
          model: selectedImageModel,
          fallbackModels: imageFallbackModels,
          prompt: refinedPrompt,
          size: "1024x1024",
          onFallback: (event) => {
            (route.trace.fallbacks as any).push(event);
          },
        });
        appendSubcall({
          phaseId: "authoring",
          label: "Image generation",
          endpoint: "chat.completions",
          status: "ok",
          modelRequested: selectedImageModel,
          modelUsed: imageResult.modelUsed,
          inputTokens: imageResult.usage?.prompt_tokens,
          outputTokens: imageResult.usage?.completion_tokens,
          costCents: costCentsFromUsage(imageResult.usage),
          durationMs: Date.now() - imageGenerationStartedAt,
        });
        const imageUrl = imageResult.imageUrl;
        const imageModel = imageResult.modelUsed;

        // Store image in Convex storage to avoid 1MB document limit.
        // CRITICAL: never fall back to embedding raw base64 in message content
        // because that would exceed Convex's 1MB per-document limit.
        let servingUrl: string;
        if (imageUrl.startsWith("data:")) {
          // Must go through Convex _storage - no base64 fallback allowed
          const storeResult = await convexAction("images:storeImageBlob", {
            actorClerkId: actor.clerkId,
            chatId,
            base64Data: imageUrl,
            mimeType: "image/png",
            prompt: refinedPrompt,
            model: imageModel,
            size: "1024x1024",
          }) as { servingUrl: string };
          servingUrl = storeResult.servingUrl;
        } else {
          // Already an external URL (not base64), safe to use directly
          servingUrl = imageUrl;
        }

        const finalizedResponse = `![Generated image](${servingUrl})\n\n**Prompt:** ${refinedPrompt}`;
        const whyThisResponse = summarizeWhyResponse(effectiveMode, route.reason);
        const modelRequested = primaryModel;
        const modelUsed = imageModel;
        const usageIn = imageResult.usage?.prompt_tokens ?? 0;
        const usageOut = imageResult.usage?.completion_tokens ?? 0;
        const imageSubcallTotals = subcallTokenTotals();
        const finalUsageIn = imageSubcallTotals.input > 0 ? imageSubcallTotals.input : usageIn;
        const finalUsageOut = imageSubcallTotals.output > 0 ? imageSubcallTotals.output : usageOut;
        const citations: Array<{
          filename: string;
          url?: string;
          page?: number;
          sourceType: "pack" | "personal" | "general" | "search";
          resourceId?: string;
        }> = [];

        route.trace.toolchain = [...new Set(route.trace.toolchain)];
        if (route.trace.phasePlan?.some((phase) => phase.id === "authoring")) {
          await emitPhaseUpdate("authoring", "completed", "Image generated successfully.");
        }
        pipelineController.markStageCompleted("generation");
        (route.trace as any).totalCostCents = Number(
          ((route.trace.subcalls ?? []).reduce((sum, call) => sum + (call.costCents ?? 0), 0)).toFixed(4),
        );
        (route.trace as any).totalDurationMs = Date.now() - requestStartedAt;

        const appended = await appendAssistantMessageWithCitationFallback({
          actorClerkId: actor.clerkId,
          chatId,
          content: finalizedResponse,
          mode: effectiveMode,
          citations,
          modelRequested,
          modelUsed,
          whyThisResponse,
          usageIn: finalUsageIn,
          usageOut: finalUsageOut,
          verificationPassed: undefined,
          thinkingContent: undefined,
          routeTrace: route.trace,
        });
        assistantPersisted = true;

        const catalogPricing = resolveCatalogPricing(modelUsed);
        const pricing =
          (typeof catalogPricing?.inputCostPerM === "number" || typeof catalogPricing?.outputCostPerM === "number")
            ? {
                inputCostPerM: catalogPricing?.inputCostPerM,
                outputCostPerM: catalogPricing?.outputCostPerM,
              }
            : ((await convexQuery("models:getModelPricing", {
                actorClerkId: actor.clerkId,
                modelId: modelUsed,
              })) as { inputCostPerM?: number; outputCostPerM?: number; isFree?: boolean });

        await recordOpenRouterUsage({
          actorClerkId: actor.clerkId,
          chatId,
          messageId: appended.messageId,
          model: modelUsed,
          usage: imageResult.usage,
          inputTokens: finalUsageIn,
          outputTokens: finalUsageOut,
          pricing,
          skipIfZeroTokens: false,
        });
        await recordModelRuntime(modelUsed, true, Date.now() - requestStartedAt);

        const spendingUpdate = (await convexQuery("usage:checkUserBudget", {
          actorClerkId: actor.clerkId,
        })) as {
          totalSpentEur: number;
          totalCostCents: number;
          tier: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
          softLimitReached: boolean;
          hardLimitReached: boolean;
        };

        void convexMutation("analytics:recordSession", {
          actorClerkId: actor.clerkId,
          mode: effectiveMode,
          model: modelUsed,
          tokensUsed: finalUsageIn + finalUsageOut,
          topic: normalizedMessage.slice(0, 60),
        }).catch(() => {});

        const streakUpdate = await convexMutation<
          { actorClerkId: string },
          {
            currentStreak: number;
            longestStreak: number;
            lastActiveDate: string;
            unlockedAchievements?: UnlockedAchievement[];
          }
        >("gamification:checkAndUpdateStreak", {
          actorClerkId: actor.clerkId,
        }).catch(() => null);

        const xpUpdate = await convexMutation<
          {
            actorClerkId: string;
            activityType: string;
            modeUsed: StudyMode;
            currentStreak?: number;
          },
          {
            xpAwarded: number;
            totalXp: number;
            unlockedAchievements?: UnlockedAchievement[];
          }
        >("gamification:awardXp", {
          actorClerkId: actor.clerkId,
          activityType: gamificationActivityType(effectiveMode),
          modeUsed: effectiveMode,
          currentStreak: streakUpdate?.currentStreak,
        }).catch(() => null);

        const unlockedAchievements = mergeUnlockedAchievements(
          streakUpdate?.unlockedAchievements,
          xpUpdate?.unlockedAchievements,
        );

        if (selectedAgent) {
          await convexMutation("agents:incrementUsageCount", {
            actorClerkId: actor.clerkId,
            agentId: selectedAgent._id,
          }).catch(() => {});

          await convexMutation("agents:recordAgentModelUse", {
            actorClerkId: actor.clerkId,
            agentId: selectedAgent._id,
            modelId: modelUsed,
          }).catch(() => {});
        }

        const assistantCount = history.filter((message) => message.role === "assistant").length;
        if (route.trace.phasePlan?.some((phase) => phase.id === "title")) {
          await emitPhaseUpdate("title", "in_progress");
        }
        const generatedTitle = await resolveFirstTurnTitle({
          assistantCount,
          chatId,
          actorClerkId: actor.clerkId,
          userMessage: normalizedMessage,
          assistantMessage: finalizedResponse,
          onModelCall: (call) => {
            appendSubcall({
              phaseId: "title",
              label: "Title generation",
              endpoint: "chat.completions",
              status: "ok",
              modelUsed: call.model,
              inputTokens: call.usage?.prompt_tokens,
              outputTokens: call.usage?.completion_tokens,
              costCents: costCentsFromUsage(call.usage),
              durationMs: call.durationMs,
            });
          },
          logger,
        });
        if (route.trace.phasePlan?.some((phase) => phase.id === "title")) {
          await emitPhaseUpdate(
            "title",
            generatedTitle ? "completed" : "skipped",
            generatedTitle ? "Chat title updated." : "Title unchanged.",
          );
        }
        finalizePhasePlan({
          memoryUpdated: false,
          titleUpdated: Boolean(generatedTitle),
          repaired: false,
        });
        pipelineController.markStageCompleted("postProcess");
        const imagePipelineSnapshot = pipelineController.getState();
        route.trace.stepsExecuted = imagePipelineSnapshot.completedStages;
        route.trace.stepsSkipped = imagePipelineSnapshot.skippedStages.map((row) => ({
          step: row.step,
          reason: row.reason,
        }));
        (route.trace as any).totalCostCents = Number(
          ((route.trace.subcalls ?? []).reduce((sum, call) => sum + (call.costCents ?? 0), 0)).toFixed(4),
        );
        (route.trace as any).totalDurationMs = Date.now() - requestStartedAt;

        await send({
          type: "done",
          content: finalizedResponse,
          chatId,
          userMessageId: persistedUserMessageId,
          messageId: appended.messageId,
          modelUsed,
          modelRequested,
          usageIn: finalUsageIn,
          usageOut: finalUsageOut,
          whyThisResponse,
          citations,
          verificationPassed: undefined,
          thinkingContent: undefined,
          routeTrace: route.trace,
          spendingUpdate,
          autoResult: {
            modelUsed,
            searchEnabled: false,
            thinkingLevel: effectiveThinkingLevel,
            promptEnhanced: auto.promptEnhanced,
          },
          enhancedPrompt: auto.promptEnhanced ? auto.message : undefined,
          chatTitle: generatedTitle,
          // Mode metadata: always include effective/suggested/userSelected for client tracking
          effectiveMode,
          suggestedMode: safeMode !== effectiveMode ? effectiveMode : undefined,
          userSelectedMode: safeMode,
          unlockedAchievements,
          agentSuggestion,
          agent:
            selectedAgent && selectedAgent._id
              ? {
                  id: selectedAgent._id,
                  name: selectedAgent.name,
                  emoji: selectedAgent.avatarEmoji,
                }
              : undefined,
        });
        return;
      }

      const fallbackModels = manualLockRequested ? [] : route.fallbackModels;
      const onFallback = (event: { fromModel: string; toModel: string; error: string; attemptIndex: number }) => {
        (route.trace.fallbacks as any).push(event);
      };

      if (route.trace.phasePlan?.some((phase) => phase.id === "analysis")) {
        await emitPhaseUpdate("analysis", "in_progress");
      }
      if (route.trace.phasePlan?.some((phase) => phase.id === "planning")) {
        await emitPhaseUpdate("planning", "in_progress");
      }
      if (route.trace.phasePlan?.some((phase) => phase.id === "synthesis") && multiAgentEnabled) {
        await emitPhaseUpdate("synthesis", "in_progress");
      }
      if (route.trace.phasePlan?.some((phase) => phase.id === "authoring") && !multiAgentEnabled) {
        await emitPhaseUpdate("authoring", "in_progress");
      }
      if (route.trace.phasePlan?.some((phase) => phase.id === "verification") && shouldVerify) {
        await emitPhaseUpdate("verification", "in_progress");
      }

      const streamed = multiAgentEnabled
        ? await runCollaborativeStreaming({
            actorClerkId: actor.clerkId,
            chatId,
            graph: taskGraph,
            originalPrompt: auto.message,
            conversationContext: specialistConversationContext,
            baseSystemPrompt: systemPromptParts.join("\n\n"),
            primaryModel,
            fallbackModels,
            synthesisModel,
            synthesisFallbackModels,
            catalog,
            modelRuntimeStats: runtimeStatMap,
            spendingTier: budget.tier,
            maxTokens,
            maxSubcalls: collabLimits.maxSubcalls,
            maxTokensPerSpecialist: collabLimits.maxTokensPerSpecialist,
            maxWallTimeMs: collabLimits.maxWallTimeMs,
            send,
            onFallback,
            logger,
          })
        : await runAssistantStreaming({
            actorClerkId: actor.clerkId,
            chatId,
            shouldVerify,
            primaryModel,
            fallbackModels,
            verificationModel: route.verificationModel,
            messages,
            maxTokens,
            send,
            onFallback,
            logger,
          });
      if (route.trace.phasePlan?.some((phase) => phase.id === "planning")) {
        await emitPhaseUpdate(
          "planning",
          multiAgentEnabled ? "completed" : "skipped",
          multiAgentEnabled ? "Specialist plan executed." : "Single-pass route selected.",
        );
      }
      if (route.trace.phasePlan?.some((phase) => phase.id === "analysis")) {
        await emitPhaseUpdate("analysis", "completed");
      }
      if (route.trace.phasePlan?.some((phase) => phase.id === "authoring") && !multiAgentEnabled) {
        await emitPhaseUpdate("authoring", "completed");
      }
      if (route.trace.phasePlan?.some((phase) => phase.id === "synthesis") && multiAgentEnabled) {
        await emitPhaseUpdate("synthesis", "completed", "Specialist outputs synthesized.");
      }
      if (route.trace.phasePlan?.some((phase) => phase.id === "verification") && shouldVerify) {
        await emitPhaseUpdate("verification", "completed");
      }

      if (streamed.sourceHints?.length) {
        const deduped = new Map<string, { url: string; title: string; domain: string }>();
        for (const source of searchSources) {
          if (!source?.url) continue;
          deduped.set(source.url, source);
        }
        for (const hint of streamed.sourceHints) {
          if (!hint?.url) continue;
          deduped.set(hint.url, {
            url: hint.url,
            title: hint.title || hint.domain || hint.url,
            domain: hint.domain || "",
          });
        }
        searchSources = [...deduped.values()];
      }

      const responseText = streamed.responseText;
      const modelUsed = streamed.modelUsed;
      const usageIn = streamed.usageIn;
      const usageOut = streamed.usageOut;
      const usage = streamed.usage;
      const verificationPassed = streamed.verificationPassed;
      const thinkingContent = streamed.thinkingContent;
      const modelRequested = primaryModel;
      if (streamed.verificationSubcalls && streamed.verificationSubcalls.length > 0) {
        for (const verificationSubcall of streamed.verificationSubcalls) {
          appendSubcall({
            phaseId: "verification",
            label: verificationSubcall.label,
            endpoint: "chat.completions",
            status: "ok",
            modelRequested: verificationSubcall.modelUsed,
            modelUsed: verificationSubcall.modelUsed,
            inputTokens: verificationSubcall.usage?.prompt_tokens,
            outputTokens: verificationSubcall.usage?.completion_tokens,
            costCents: costCentsFromUsage(verificationSubcall.usage),
          });
        }
      } else {
        appendSubcall({
          phaseId: multiAgentEnabled ? "synthesis" : "authoring",
          label: multiAgentEnabled ? "Synthesis response stream" : "Primary response stream",
          endpoint: "chat.completions",
          status: "ok",
          modelRequested: primaryModel,
          modelUsed,
          inputTokens: usage?.prompt_tokens ?? usageIn,
          outputTokens: usage?.completion_tokens ?? usageOut,
          costCents: costCentsFromUsage(usage),
        });
      }
      if (streamed.collaborators && streamed.collaborators.length > 0) {
        (route.trace as any).collaborators = streamed.collaborators;
        for (const collaborator of streamed.collaborators) {
          appendSubcall({
            phaseId: collaborator.role === "synthesizer" ? "synthesis" : "analysis",
            label: collaborator.role.replace(/_/g, " "),
            endpoint: "chat.completions",
            status: "ok",
            modelUsed: collaborator.model,
            inputTokens: undefined,
            outputTokens: collaborator.tokensUsed,
            durationMs: collaborator.durationMs,
          });
        }
      }

      const policyPass = checkPromptPolicyResponse({ mode: effectiveMode, response: responseText });
      let correctedResponse = responseText;
      if (!policyPass) {
        if (effectiveMode === "quiz" || effectiveMode === "flashcard") {
          route.trace.toolchain.push("structure_policy_guard");
        } else {
          correctedResponse = `${responseText}\n\nPolicy correction: citation and study-mode structure tightened to match requirements.`;
        }
      }

      // isVagueRequest is computed in the outer scope before streaming begins.
      // When true, skip format-repair so the model's clarification question is preserved.

      if (!isVagueRequest && effectiveMode === "flashcard") {
        const normalizedFlashcardResponse = normalizeFlashcardDeck(correctedResponse);
        if (normalizedFlashcardResponse && normalizedFlashcardResponse !== correctedResponse.trim()) {
          correctedResponse = normalizedFlashcardResponse;
          route.trace.toolchain.push("flashcard_structure_normalized");
        }
      }

      const quizCount = countQuizQuestions(correctedResponse);
      const flashcardCount = countFlashcardPairs(correctedResponse);
      const needsQuizRepair =
        !isVagueRequest &&
        effectiveMode === "quiz" &&
        (!isQuizStructured(correctedResponse) || quizCount < MIN_QUIZ_QUESTIONS);
      const needsFlashcardRepair =
        !isVagueRequest &&
        effectiveMode === "flashcard" &&
        (!isFlashcardDeckStructured(correctedResponse) || flashcardCount < MIN_FLASHCARD_PAIRS);
      if (needsQuizRepair || needsFlashcardRepair) {
        if (route.trace.phasePlan?.some((phase) => phase.id === "repair")) {
          await emitPhaseUpdate("repair", "in_progress");
        }
        const repairStartedAt = Date.now();
        const repaired = await openRouterChatCompletion({
          model: supportModel,
          fallbackModels: supportFallbackModels,
          messages: [
            {
              role: "system",
              content:
                needsQuizRepair
                  ? `The student asked: "${normalizedMessage}". Reformat the following response into strict quiz syntax about EXACTLY this topic. Do NOT change the subject.
STRICT RULES:
- Output only:
<<QUIZ_START>>
[quiz body]
<<QUIZ_END>>
- At least ${MIN_QUIZ_QUESTIONS} questions, each with A-D options and a "Correct: [letter]" line.
- Include "## Answers & Explanations" after the questions.
- No JSON, no tables, no extra prose outside delimiters.`
                  : `The student asked: "${normalizedMessage}". Reformat into strict flashcard syntax about EXACTLY this topic. Do NOT change the subject.
STRICT RULES:
- Output only:
<<FLASHCARDS_START>>
[FRONT/BACK cards]
<<FLASHCARDS_END>>
- At least ${MIN_FLASHCARD_PAIRS} cards.
- No intro text.
- No markdown table.
- No JSON.
- Output only repeated FRONT/BACK blocks:
FRONT: ...
BACK: ...`,
            },
            { role: "user", content: correctedResponse },
          ],
          maxTokens: MODE_MAX_TOKENS[effectiveMode],
          temperature: 0.1,
        });
        await recordOpenRouterUsage({
          actorClerkId: actor.clerkId,
          chatId,
          model: repaired.model ?? supportModel,
          usage: repaired.usage,
          pricing: resolveCatalogPricing(repaired.model ?? supportModel),
        }).catch(() => {});
        appendSubcall({
          phaseId: "repair",
          label: needsQuizRepair ? "Quiz format repair" : "Flashcard format repair",
          endpoint: "chat.completions",
          status: "ok",
          modelRequested: supportModel,
          modelUsed: repaired.model ?? supportModel,
          inputTokens: repaired.usage?.prompt_tokens,
          outputTokens: repaired.usage?.completion_tokens,
          costCents: costCentsFromUsage(repaired.usage),
          durationMs: Date.now() - repairStartedAt,
        });
        const candidate = repaired.choices?.[0]?.message?.content?.trim() ?? "";
        if (candidate) {
          if (needsQuizRepair && isQuizStructured(candidate) && countQuizQuestions(candidate) >= MIN_QUIZ_QUESTIONS) {
            correctedResponse = candidate;
            route.trace.toolchain.push("quiz_format_repair");
          }
          const normalizedFlashcardCandidate = normalizeFlashcardDeck(candidate);
          if (needsFlashcardRepair && normalizedFlashcardCandidate) {
            const candidateCount = countFlashcardPairs(normalizedFlashcardCandidate);
            if (candidateCount >= MIN_FLASHCARD_PAIRS) {
              correctedResponse = normalizedFlashcardCandidate;
              route.trace.toolchain.push("flashcard_format_repair");
            }
          }
        }
        if (route.trace.phasePlan?.some((phase) => phase.id === "repair")) {
          await emitPhaseUpdate("repair", "completed", "Output formatting repaired.");
        }
      }

      if (!isVagueRequest && effectiveMode === "flashcard") {
        const normalizedFlashcardResponse = normalizeFlashcardDeck(correctedResponse);
        if (normalizedFlashcardResponse && normalizedFlashcardResponse !== correctedResponse.trim()) {
          correctedResponse = normalizedFlashcardResponse;
          route.trace.toolchain.push("flashcard_structure_normalized");
        }
      }

      const stillNeedsQuizRepair =
        !isVagueRequest &&
        effectiveMode === "quiz" &&
        (!isQuizStructured(correctedResponse) || countQuizQuestions(correctedResponse) < MIN_QUIZ_QUESTIONS);
      const stillNeedsFlashcardRepair =
        !isVagueRequest &&
        effectiveMode === "flashcard" &&
        (!isFlashcardDeckStructured(correctedResponse) || countFlashcardPairs(correctedResponse) < MIN_FLASHCARD_PAIRS);

      if (stillNeedsQuizRepair || stillNeedsFlashcardRepair) {
        if (route.trace.phasePlan?.some((phase) => phase.id === "repair")) {
          await emitPhaseUpdate("repair", "in_progress");
        }
        const regenerateRepairStartedAt = Date.now();
        const regenerated = await openRouterChatCompletion({
          model: supportModel,
          fallbackModels: supportFallbackModels,
          messages: [
            {
              role: "system",
              content: stillNeedsQuizRepair
                ? `The student wants a quiz about: "${normalizedMessage}". Generate a complete quiz about EXACTLY this topic.
STRICT RULES:
- Output only:
<<QUIZ_START>>
[quiz body]
<<QUIZ_END>>
- At least ${MIN_QUIZ_QUESTIONS} questions.
- A-D options and one Correct line per question.
- Include final section "## Answers & Explanations".
- No extra prose outside delimiters.`
                : `The student wants flashcards about: "${normalizedMessage}". Generate a complete deck about EXACTLY this topic.
STRICT RULES:
- Output only:
<<FLASHCARDS_START>>
[FRONT/BACK cards]
<<FLASHCARDS_END>>
- Output only FRONT/BACK blocks.
- At least ${MIN_FLASHCARD_PAIRS} cards.
- No intro text.
- No markdown table.
- No JSON.
- Format:
FRONT: ...
BACK: ...`,
            },
            { role: "user", content: auto.message },
          ],
          maxTokens: MODE_MAX_TOKENS[effectiveMode],
          temperature: 0.15,
        });
        await recordOpenRouterUsage({
          actorClerkId: actor.clerkId,
          chatId,
          model: regenerated.model ?? supportModel,
          usage: regenerated.usage,
          pricing: resolveCatalogPricing(regenerated.model ?? supportModel),
        }).catch(() => {});
        appendSubcall({
          phaseId: "repair",
          label: stillNeedsQuizRepair ? "Quiz regeneration repair" : "Flashcard regeneration repair",
          endpoint: "chat.completions",
          status: "ok",
          modelRequested: supportModel,
          modelUsed: regenerated.model ?? supportModel,
          inputTokens: regenerated.usage?.prompt_tokens,
          outputTokens: regenerated.usage?.completion_tokens,
          costCents: costCentsFromUsage(regenerated.usage),
          durationMs: Date.now() - regenerateRepairStartedAt,
        });
        const regeneratedCandidate = regenerated.choices?.[0]?.message?.content?.trim() ?? "";
        if (regeneratedCandidate) {
          if (
            stillNeedsQuizRepair &&
            isQuizStructured(regeneratedCandidate) &&
            countQuizQuestions(regeneratedCandidate) >= MIN_QUIZ_QUESTIONS
          ) {
            correctedResponse = regeneratedCandidate;
            route.trace.toolchain.push("quiz_regenerate_repair");
          }
          const normalizedRegeneratedFlashcards = normalizeFlashcardDeck(regeneratedCandidate);
          if (stillNeedsFlashcardRepair && normalizedRegeneratedFlashcards) {
            const regeneratedCount = countFlashcardPairs(normalizedRegeneratedFlashcards);
            if (regeneratedCount >= MIN_FLASHCARD_PAIRS) {
              correctedResponse = normalizedRegeneratedFlashcards;
              route.trace.toolchain.push("flashcard_regenerate_repair");
            }
          }
        }
        if (route.trace.phasePlan?.some((phase) => phase.id === "repair")) {
          await emitPhaseUpdate("repair", "completed", "Regenerated response with strict format.");
        }
      }

      const finalQuizRepairNeeded =
        !isVagueRequest &&
        effectiveMode === "quiz" &&
        (!isQuizStructured(correctedResponse) || countQuizQuestions(correctedResponse) < MIN_QUIZ_QUESTIONS);
      if (finalQuizRepairNeeded) {
        if (route.trace.phasePlan?.some((phase) => phase.id === "repair")) {
          await emitPhaseUpdate("repair", "in_progress");
        }
        const finalQuizRepairStartedAt = Date.now();
        const finalRepair = await openRouterChatCompletion({
          model: supportModel,
          fallbackModels: supportFallbackModels,
          messages: [
            {
              role: "system",
              content: `Output a plain-text quiz about: "${normalizedMessage}".
STRICT RULES:
- No intro text outside delimiters.
- No markdown table.
- No JSON.
- At least ${MIN_QUIZ_QUESTIONS} questions.
- Wrap final output exactly as:
<<QUIZ_START>>
[quiz body]
<<QUIZ_END>>
- Exactly this structure per question:
Q1. ...
A) ...
B) ...
C) ...
D) ...
Correct: [A|B|C|D]
- End with:
## Answers & Explanations
1) [letter] - [one sentence]
2) [letter] - [one sentence]`,
            },
            { role: "user", content: auto.message },
          ],
          maxTokens: MODE_MAX_TOKENS[effectiveMode],
          temperature: 0,
        });
        await recordOpenRouterUsage({
          actorClerkId: actor.clerkId,
          chatId,
          model: finalRepair.model ?? supportModel,
          usage: finalRepair.usage,
          pricing: resolveCatalogPricing(finalRepair.model ?? supportModel),
        }).catch(() => {});
        appendSubcall({
          phaseId: "repair",
          label: "Final quiz repair",
          endpoint: "chat.completions",
          status: "ok",
          modelRequested: supportModel,
          modelUsed: finalRepair.model ?? supportModel,
          inputTokens: finalRepair.usage?.prompt_tokens,
          outputTokens: finalRepair.usage?.completion_tokens,
          costCents: costCentsFromUsage(finalRepair.usage),
          durationMs: Date.now() - finalQuizRepairStartedAt,
        });
        const finalCandidate = finalRepair.choices?.[0]?.message?.content?.trim() ?? "";
        if (finalCandidate && isQuizStructured(finalCandidate) && countQuizQuestions(finalCandidate) >= MIN_QUIZ_QUESTIONS) {
          correctedResponse = finalCandidate;
          route.trace.toolchain.push("quiz_final_repair");
        }
        if (route.trace.phasePlan?.some((phase) => phase.id === "repair")) {
          await emitPhaseUpdate("repair", "completed", "Final quiz format pass completed.");
        }
      }

      const finalFlashcardRepairNeeded =
        !isVagueRequest &&
        effectiveMode === "flashcard" &&
        (!isFlashcardDeckStructured(correctedResponse) || countFlashcardPairs(correctedResponse) < MIN_FLASHCARD_PAIRS);
      if (finalFlashcardRepairNeeded) {
        if (route.trace.phasePlan?.some((phase) => phase.id === "repair")) {
          await emitPhaseUpdate("repair", "in_progress");
        }
        const finalFlashcardRepairStartedAt = Date.now();
        const finalFlashcardRepair = await openRouterChatCompletion({
          model: supportModel,
          fallbackModels: supportFallbackModels,
          messages: [
            {
              role: "system",
              content: `Output a plain-text flashcard deck about: "${normalizedMessage}".
STRICT RULES:
- No intro text outside delimiters.
- No markdown table.
- No JSON.
- At least ${MIN_FLASHCARD_PAIRS} cards.
- Wrap final output exactly as:
<<FLASHCARDS_START>>
[cards]
<<FLASHCARDS_END>>
- Output exactly this repeated structure:
FRONT: [term or question]
BACK: [answer or definition]`,
            },
            { role: "user", content: auto.message },
          ],
          maxTokens: MODE_MAX_TOKENS[effectiveMode],
          temperature: 0,
        });
        await recordOpenRouterUsage({
          actorClerkId: actor.clerkId,
          chatId,
          model: finalFlashcardRepair.model ?? supportModel,
          usage: finalFlashcardRepair.usage,
          pricing: resolveCatalogPricing(finalFlashcardRepair.model ?? supportModel),
        }).catch(() => {});
        appendSubcall({
          phaseId: "repair",
          label: "Final flashcard repair",
          endpoint: "chat.completions",
          status: "ok",
          modelRequested: supportModel,
          modelUsed: finalFlashcardRepair.model ?? supportModel,
          inputTokens: finalFlashcardRepair.usage?.prompt_tokens,
          outputTokens: finalFlashcardRepair.usage?.completion_tokens,
          costCents: costCentsFromUsage(finalFlashcardRepair.usage),
          durationMs: Date.now() - finalFlashcardRepairStartedAt,
        });
        const finalFlashcardCandidate = finalFlashcardRepair.choices?.[0]?.message?.content?.trim() ?? "";
        const normalizedFinalFlashcards = normalizeFlashcardDeck(finalFlashcardCandidate);
        if (normalizedFinalFlashcards && countFlashcardPairs(normalizedFinalFlashcards) >= MIN_FLASHCARD_PAIRS) {
          correctedResponse = normalizedFinalFlashcards;
          route.trace.toolchain.push("flashcard_final_repair");
        }
        if (route.trace.phasePlan?.some((phase) => phase.id === "repair")) {
          await emitPhaseUpdate("repair", "completed", "Final flashcard format pass completed.");
        }
      }

      if (!isVagueRequest && effectiveMode === "quiz" && isQuizStructured(correctedResponse) && !/<<\s*quiz_start\s*>>/i.test(correctedResponse)) {
        correctedResponse = `<<QUIZ_START>>\n${correctedResponse.trim()}\n<<QUIZ_END>>`;
        route.trace.toolchain.push("quiz_delimiter_enforced");
      }

      if (!isVagueRequest && effectiveMode === "flashcard" && isFlashcardDeckStructured(correctedResponse, MIN_FLASHCARD_PAIRS)) {
        const normalizedDeck = normalizeFlashcardDeck(correctedResponse);
        if (normalizedDeck) {
          correctedResponse = /<<\s*flashcards_start\s*>>/i.test(correctedResponse)
            ? correctedResponse
            : `<<FLASHCARDS_START>>\n${normalizedDeck}\n<<FLASHCARDS_END>>`;
          route.trace.toolchain.push("flashcard_delimiter_enforced");
        }
      }

      route.trace.toolchain = [...new Set(route.trace.toolchain)];

      const citations = inferCitations(
        correctedResponse,
        retrieval.citations,
        searchSources,
        attachmentCitations,
      );
      const rewrittenResponse = rewriteCitationMarkers(correctedResponse, citations);
      // Strip orphan citation markers [N] that have no matching citation
      let finalizedResponse = stripOrphanCitations(rewrittenResponse, citations);
      let generatedArtifactAttachments: string[] | undefined;
      let generatedArtifactResourceIds: string[] | undefined;
      if (effectiveMode === "document" || /<<DOCUMENT_START>>/i.test(finalizedResponse)) {
        const artifactResult = await generateArtifactResources({
          actorClerkId: actor.clerkId,
          content: finalizedResponse,
          requestedFormats: routePlan.requestedArtifactFormats,
        }).catch((error: unknown) => {
          logger.warn("artifact generation failed", {
            chatId,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
        if (artifactResult && artifactResult.attachmentResourceIds.length > 0) {
          generatedArtifactAttachments = artifactResult.attachments;
          generatedArtifactResourceIds = artifactResult.attachmentResourceIds;
          finalizedResponse = artifactResult.markdownBlock
            ? `${finalizedResponse}\n\n${artifactResult.markdownBlock}`
            : finalizedResponse;
          route.trace.toolchain.push("artifact_generation");
        }
      }
      const whyThisResponse = summarizeWhyResponse(effectiveMode, route.reason);
      const finalSubcallTotals = subcallTokenTotals();
      const finalUsageIn = finalSubcallTotals.input > 0 ? finalSubcallTotals.input : usageIn;
      const finalUsageOut = finalSubcallTotals.output > 0 ? finalSubcallTotals.output : usageOut;
      (route.trace as any).totalCostCents = Number(
        ((route.trace.subcalls ?? []).reduce((sum, call) => sum + (call.costCents ?? 0), 0)).toFixed(4),
      );
      (route.trace as any).totalDurationMs = Date.now() - requestStartedAt;
      logger.info("streaming complete", {
        modelUsed,
        usageIn: finalUsageIn,
        usageOut: finalUsageOut,
        fallbackCount: route.trace.fallbacks.length,
      });
      pipelineController.markStageCompleted("generation");

      const appended = await appendAssistantMessageWithCitationFallback({
        actorClerkId: actor.clerkId,
        chatId,
        content: finalizedResponse,
        mode: effectiveMode,
        attachments: generatedArtifactAttachments,
        attachmentResourceIds: generatedArtifactResourceIds,
        citations,
        modelRequested,
        modelUsed,
        whyThisResponse,
        usageIn: finalUsageIn,
        usageOut: finalUsageOut,
        verificationPassed,
        thinkingContent: thinkingContent || undefined,
        routeTrace: route.trace,
      });
      assistantPersisted = true;

      const catalogPricing = resolveCatalogPricing(modelUsed);
      const pricing =
        (typeof catalogPricing?.inputCostPerM === "number" || typeof catalogPricing?.outputCostPerM === "number")
          ? {
              inputCostPerM: catalogPricing?.inputCostPerM,
              outputCostPerM: catalogPricing?.outputCostPerM,
            }
          : ((await convexQuery("models:getModelPricing", {
              actorClerkId: actor.clerkId,
              modelId: modelUsed,
            })) as { inputCostPerM?: number; outputCostPerM?: number; isFree?: boolean });

      if (!shouldVerify) {
        await recordOpenRouterUsage({
          actorClerkId: actor.clerkId,
          chatId,
          messageId: appended.messageId,
          model: modelUsed,
          usage,
          inputTokens: finalUsageIn,
          outputTokens: finalUsageOut,
          pricing,
        });
      }
      await recordModelRuntime(modelUsed, true, Date.now() - requestStartedAt);
      if ((route.trace as any).collaborators?.length) {
        for (const collaborator of (route.trace as any).collaborators) {
          await recordModelRuntime(
            collaborator.model,
            (collaborator.tokensUsed ?? 0) > 0,
            collaborator.durationMs,
          );
        }
      }

      const spendingUpdate = (await convexQuery("usage:checkUserBudget", {
        actorClerkId: actor.clerkId,
      })) as {
        totalSpentEur: number;
        totalCostCents: number;
        tier: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
        softLimitReached: boolean;
        hardLimitReached: boolean;
      };

      void convexMutation("analytics:recordSession", {
        actorClerkId: actor.clerkId,
        mode: effectiveMode,
        model: modelUsed,
        tokensUsed: finalUsageIn + finalUsageOut,
        topic: normalizedMessage.slice(0, 60),
      }).catch(() => {});

      const streakUpdate = await convexMutation<
        { actorClerkId: string },
        {
          currentStreak: number;
          longestStreak: number;
          lastActiveDate: string;
          unlockedAchievements?: UnlockedAchievement[];
        }
      >("gamification:checkAndUpdateStreak", {
        actorClerkId: actor.clerkId,
      }).catch(() => null);

      const xpUpdate = await convexMutation<
        {
          actorClerkId: string;
          activityType: string;
          modeUsed: StudyMode;
          currentStreak?: number;
        },
        {
          xpAwarded: number;
          totalXp: number;
          unlockedAchievements?: UnlockedAchievement[];
        }
      >("gamification:awardXp", {
        actorClerkId: actor.clerkId,
        activityType: gamificationActivityType(effectiveMode),
        modeUsed: effectiveMode,
        currentStreak: streakUpdate?.currentStreak,
      }).catch(() => null);

      const unlockedAchievements = mergeUnlockedAchievements(
        streakUpdate?.unlockedAchievements,
        xpUpdate?.unlockedAchievements,
      );

      if (selectedAgent) {
        await convexMutation("agents:incrementUsageCount", {
          actorClerkId: actor.clerkId,
          agentId: selectedAgent._id,
        });

        await convexMutation("agents:recordAgentModelUse", {
          actorClerkId: actor.clerkId,
          agentId: selectedAgent._id,
          modelId: modelUsed,
        }).catch(() => {});
      }

      if (route.trace.phasePlan?.some((phase) => phase.id === "memory") && routePlan.shouldWriteMemory) {
        await emitPhaseUpdate("memory", "in_progress");
      }
      const shouldExtractLearningContext =
        [
          "tutor",
          "explain",
          "quiz",
          "flashcard",
          "exam",
          "research",
          "general",
        ].includes(effectiveMode)
        && finalizedResponse.trim().length >= 120;
      let extractedLearningContext: LearningContext | null = null;
      const extractedMemory = (routePlan.shouldWriteMemory || shouldExtractLearningContext)
        ? await maybeExtractMemory({
            actorClerkId: actor.clerkId,
            chatId,
            existingEntries: userMemory.entries,
            userMessage: normalizedMessage,
            assistantResponse: finalizedResponse,
            persistMemory: routePlan.shouldWriteMemory,
            onLearningContextExtracted: (context) => {
              extractedLearningContext = context;
            },
            onModelCall: (call) => {
              appendSubcall({
                phaseId: "memory",
                label: "Memory extraction",
                endpoint: "chat.completions",
                status: "ok",
                modelUsed: call.model,
                inputTokens: call.usage?.prompt_tokens,
                outputTokens: call.usage?.completion_tokens,
                costCents: costCentsFromUsage(call.usage),
                durationMs: call.durationMs,
              });
            },
          }).catch(() => [] as Array<{ key: string; value: string; confidence: number; extractedAt: number }>)
        : [];
      const routedMemoryWrite = routePlan.shouldWriteMemory
        ? await routeMemoryWrite({
            actorClerkId: actor.clerkId,
            chatId,
            entries: extractedMemory,
            sourceType: "extraction",
            onModelCall: (call) => {
              appendSubcall({
                phaseId: "memory",
                label: "Memory entry embedding",
                endpoint: "embeddings",
                status: "ok",
                modelUsed: call.model,
                inputTokens: call.usage?.prompt_tokens,
                outputTokens: call.usage?.completion_tokens,
                costCents: costCentsFromUsage(call.usage),
                durationMs: call.durationMs,
              });
            },
          }).catch(() => ({ written: 0, promoted: 0 }))
        : { written: 0, promoted: 0 };
      if (route.trace.phasePlan?.some((phase) => phase.id === "memory") && routePlan.shouldWriteMemory) {
        await emitPhaseUpdate(
          "memory",
          routedMemoryWrite.written > 0 || extractedMemory.length > 0 ? "completed" : "skipped",
          routedMemoryWrite.written > 0
            ? `Layered memory updated (${routedMemoryWrite.written} write(s), ${routedMemoryWrite.promoted} promoted).`
            : extractedMemory.length > 0
              ? "Legacy memory updated; layered memory write skipped."
              : "No durable memory update extracted.",
        );
      }
      if (extractedMemory.length > 0) {
        await send({
          type: "soul_update",
          entries: extractedMemory.slice(0, 6).map((entry) => ({
            key: entry.key,
            value: entry.value,
            confidence: entry.confidence,
          })),
        });
      }
      const mergedLearningContext = mergeLearningContexts(storedLearningContext, extractedLearningContext);
      const nextLearningContext = serializeLearningContext(mergedLearningContext);
      const previousLearningContext = typeof (chatData.chat as { learningContext?: unknown }).learningContext === "string"
        ? String((chatData.chat as { learningContext?: unknown }).learningContext)
        : undefined;
      if (nextLearningContext && nextLearningContext !== previousLearningContext) {
        await convexMutation("chats:setLearningContext", {
          actorClerkId: actor.clerkId,
          chatId,
          learningContext: nextLearningContext,
        }).catch(() => {});
        route.trace.toolchain.push("learning_context_updated");
      }
      const modeSuggestions = buildModeSuggestions({
        mode: effectiveMode,
        response: finalizedResponse,
        learningContext: mergedLearningContext,
      });
      if (modeSuggestions.length > 0) {
        (route.trace as { modeSuggestions?: Array<{ mode: StudyMode; label: string; prompt: string }> }).modeSuggestions = modeSuggestions;
        route.trace.toolchain.push("mode_switch_chips");
      }

      const assistantCount = history.filter((message) => message.role === "assistant").length;
      if (route.trace.phasePlan?.some((phase) => phase.id === "title")) {
        await emitPhaseUpdate("title", "in_progress");
      }
      const generatedTitle = await resolveFirstTurnTitle({
        assistantCount,
        chatId,
        actorClerkId: actor.clerkId,
        userMessage: normalizedMessage,
        assistantMessage: finalizedResponse,
        onModelCall: (call) => {
          appendSubcall({
            phaseId: "title",
            label: "Title generation",
            endpoint: "chat.completions",
            status: "ok",
            modelUsed: call.model,
            inputTokens: call.usage?.prompt_tokens,
            outputTokens: call.usage?.completion_tokens,
            costCents: costCentsFromUsage(call.usage),
            durationMs: call.durationMs,
          });
        },
        logger,
      });
      if (route.trace.phasePlan?.some((phase) => phase.id === "title")) {
        await emitPhaseUpdate(
          "title",
          generatedTitle ? "completed" : "skipped",
          generatedTitle ? "Chat title updated." : "Title unchanged.",
        );
      }
      finalizePhasePlan({
        memoryUpdated: extractedMemory.length > 0,
        titleUpdated: Boolean(generatedTitle),
        repaired: route.trace.toolchain.some((tool) => tool.includes("repair")),
      });
      pipelineController.markStageCompleted("postProcess");
      const finalPipelineSnapshot = pipelineController.getState();
      route.trace.stepsExecuted = finalPipelineSnapshot.completedStages;
      route.trace.stepsSkipped = finalPipelineSnapshot.skippedStages.map((row) => ({
        step: row.step,
        reason: row.reason,
      }));
      (route.trace as any).totalCostCents = Number(
        ((route.trace.subcalls ?? []).reduce((sum, call) => sum + (call.costCents ?? 0), 0)).toFixed(4),
      );
      (route.trace as any).totalDurationMs = Date.now() - requestStartedAt;

      await send({
        type: "done",
        content: finalizedResponse,
        chatId,
        userMessageId: persistedUserMessageId,
        messageId: appended.messageId,
        modelUsed,
        modelRequested,
        usageIn: finalUsageIn,
        usageOut: finalUsageOut,
        whyThisResponse,
        citations,
        attachments: generatedArtifactAttachments,
        attachmentResourceIds: generatedArtifactResourceIds,
        verificationPassed,
        thinkingContent: thinkingContent || undefined,
        routeTrace: route.trace,
        spendingUpdate,
        autoResult: {
          modelUsed,
          searchEnabled: route.searchEnabled || routePlan.shouldUseWebSearch,
          thinkingLevel: effectiveThinkingLevel,
          promptEnhanced: auto.promptEnhanced,
        },
        enhancedPrompt: auto.promptEnhanced ? auto.message : undefined,
        chatTitle: generatedTitle,
        // Mode metadata: always include effective/suggested/userSelected for client tracking
        effectiveMode,
        suggestedMode: effectiveMode !== safeMode ? effectiveMode : undefined,
        userSelectedMode: safeMode,
        unlockedAchievements,
        agentSuggestion,
        agent:
          selectedAgent && selectedAgent._id
            ? {
                id: selectedAgent._id,
                name: selectedAgent.name,
                emoji: selectedAgent.avatarEmoji,
              }
            : undefined,
      });
      logger.info("chat done event emitted", {
        chatId,
        messageId: appended.messageId,
      });
    } catch (error) {
      logger.error(
        "chat stream failed",
        error instanceof Error ? error : new Error("Unknown stream failure"),
      );
      for (const phase of route.trace.phasePlan ?? []) {
        if (phase.status !== "running") continue;
        await emitPhaseUpdate(
          phase.id,
          "failed",
          error instanceof Error ? error.message : "Phase failed during streaming.",
        );
      }
      await recordModelRuntime(route.primaryModel, false, Date.now() - requestStartedAt);
      if (shouldPersistUserMessage && !assistantPersisted) {
        await convexMutation("chats:deleteLastUserMessage", {
          actorClerkId: actor.clerkId,
          chatId,
          expectedContent: normalizedMessage,
          expectedClientMessageId: normalizedClientMessageId,
        }).catch(() => {});
      }
      await send({
        type: "error",
        error: {
          code: "CHAT_STREAM_FAILED",
          message: error instanceof Error ? error.message : "Failed to stream response",
          retryable: true,
        },
      });
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
