import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";
import { openRouterChatCompletion, openRouterEmbeddingRequest, openRouterGenerateImage } from "@/lib/openrouter";
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
import { inferRoutingLane, isModelTooExpensivePerMillion, modelSupportsCapability, pickModelAndFallbacks } from "@/lib/model-selection";
import { getLiveCatalogSnapshot } from "@/lib/openrouter-catalog-cache";
import { normalizeAttachments } from "@/lib/attachments/normalizer";
import { gateCapabilities } from "@/lib/attachments/capability-gate";
import { runVisionPrepass } from "@/lib/attachments/vision-prepass";
import { generateArtifactResources } from "@/lib/artifacts";
import { isGeneratedDocumentContent, parseGeneratedDocument } from "@/lib/document-generator";
import {
  extractAttemptStats,
  maybeCompactHistory,
  shouldScheduleCompaction,
  toChatMessageShape,
  type MemoryEntry,
} from "@/lib/orchestrator/history";
import {
  attachInlinePositionsToCitations,
  buildDirectiveMemoryEntries,
  ensureInlineCitationMarkers,
  inferCitations,
  maybeExtractMemory,
  maybeGenerateTitle,
  maybeGenerateTitleFromUserPrompt,
  planMemoryRead,
  routeMemoryWrite,
  rewriteCitationMarkers,
  stripOrphanCitations,
} from "@/lib/orchestrator/post-process";
import {
  buildResearchEvidenceBlock,
  maybeRetrieveManagebac,
  maybeSearchWeb,
  runRagRetrieval,
  type RetrievalResult,
  type WebSearchResult,
} from "@/lib/orchestrator/retrieval";
import { buildRoutePlan } from "@/lib/orchestrator/route-plan";
import { PipelineController } from "@/lib/orchestrator/pipeline-controller";
import { formatRuntimeSkillBlock, selectRuntimeSkills } from "@/lib/orchestrator/skills";
import {
  buildClassifierInput,
  validateClassifierDecision,
  validateClassifierInput,
  type ClassifierDecision,
} from "@/lib/orchestrator/classifier-contract";
import { runAssistantStreaming, runCollaborativeStreaming } from "@/lib/orchestrator/streaming";
import { buildCapabilityContract, getOpenRouterToolsForAssignmentLevel, formatToolUsageGuidance } from "@/lib/orchestrator/tool-definitions";
import { executeOrchestratorTool } from "@/lib/orchestrator/tool-executor";
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
import {
  buildRecentContextSnapshot,
  formatClarificationAsText,
  isClarificationFollowUpMessage,
  needsClarification,
  parseRecentContext,
  serializeRecentContext,
  type ClarificationBlock,
} from "@/lib/orchestrator/clarification";
import { generatePromptAwareClarification } from "@/lib/orchestrator/clarification-generator";
import { formatSchoolNow } from "@/lib/timezone";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";
import { MODEL_CONFIG } from "@/lib/model-config";
import type { ModelRouteResult, RouteTrace, StudyMode } from "@/types";

type ChatRequestBody = {
  chatId?: string;
  packId?: string;
  agentId?: string;
  workstreamId?: string;
  artifactId?: string;
  scopeLevel?: "global" | "workspace" | "artifact";
  clientMessageId?: string;
  mode: StudyMode;
  message: string;
  thinkingLevel: "low" | "medium" | "high";
  routerMode: "auto" | "manual" | "openrouter_auto";
  manualModel?: string;
  confirmExpensiveModel?: boolean;
  forcedModel?: string;
  imageModel?: string;
  usePersonalResources: boolean;
  regenerate?: boolean;
  retryAttempt?: number;
  skipUserMessagePersist?: boolean;
  parentMessageId?: string;
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
  };
  forceMultiAgent?: boolean;
};

type AgentSnapshot = {
  _id: string;
  name: string;
  category: string;
  description: string;
  subjectArea?: string;
  gradeLevel?: string;
  systemPrompt: string;
  avatarEmoji: string;
  avatarIcon?: string;
  preferredModel?: string;
  preferredMode?: StudyMode;
  allowedTools?: string[];
  modelAllowlist?: string[];
  modelDenylist?: string[];
  guidelinesSummary?: string;
  guidelinesTopicMap?: string[];
  guidelinesRubricHints?: string[];
  guidelinesMisconceptions?: string[];
  guidelinesVocabulary?: string[];
  guidelinesExamStructure?: string[];
};

function classifierOutputFormatForRoutePlan(outputFormat: string | undefined, fallback: string) {
  return outputFormat ?? fallback;
}

const CLASSIFIER_MODEL_LANE = "cheap_classifier";

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

function isParentMessageValidatorError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return lower.includes("argumentvalidationerror") && lower.includes("parentmessageid");
}

export function extractVisualArtifactFromResponse(params: {
  response: string;
  effectiveMode: StudyMode;
  routePlan: { modeContract: { outputFormat: string } };
  runtimeSkills: Array<{ id: string }>;
}) {
  const visualSkillSelected = params.runtimeSkills.some((skill) => skill.id === "spectra-visual-skill");
  const visualFormat = params.routePlan.modeContract.outputFormat === "explanation_with_visual"
    || params.routePlan.modeContract.outputFormat === "visual_artifact";
  const visualRequest = visualSkillSelected || visualFormat;
  if (!visualRequest) return null;

  const svgMatch = params.response.match(/<svg[\s\S]*?<\/svg>/i);
  if (svgMatch) {
    const svg = svgMatch[0].trim();
    const titleMatch = svg.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || "Spectra visual";
    const summary = params.response
      .replace(svg, " ")
      .replace(/[`#>*_-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      title,
      content: svg,
      summary,
      renderMode: "visualization",
      type: "visualization" as const,
      category: "visualizations" as const,
      renderProps: {
        visualKind: "svg",
        svg,
      },
    };
  }

  return null;
}

async function appendAssistantMessageWithCitationFallback(params: {
  actorClerkId: string;
  chatId: string;
  parentMessageId?: string;
  content: string;
  mode: StudyMode;
  attachments?: string[];
  attachmentResourceIds?: string[];
  citations: Array<{
    filename: string;
    page?: number;
    sourceType: "pack" | "personal" | "agent" | "general" | "search";
    url?: string;
    title?: string;
    domain?: string;
    resourceId?: string;
    snippet?: string;
    relevanceScore?: number;
    inlinePositions?: number[];
    reliabilityScore?: number;
    reliabilityLabel?: "high" | "medium" | "low";
    reliabilityReason?: string;
    publishedDate?: string;
    favicon?: string;
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
    parentMessageId: params.parentMessageId,
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
    const citationCompatError = isLegacyCitationValidatorError(error);
    const parentCompatError = isParentMessageValidatorError(error);
    if (!citationCompatError && !parentCompatError) {
      throw error;
    }

    const normalizedCitationArgs = {
      ...baseArgs,
      citations: params.citations.map((citation) => ({
        filename: citation.filename,
        page: citation.page,
        sourceType: citation.sourceType,
        url: citation.url,
        resourceId: citation.resourceId,
        snippet: citation.snippet,
        relevanceScore: citation.relevanceScore,
        inlinePositions: citation.inlinePositions,
        reliabilityScore: citation.reliabilityScore,
        reliabilityLabel: citation.reliabilityLabel,
        reliabilityReason: citation.reliabilityReason,
        publishedDate: citation.publishedDate,
        favicon: citation.favicon,
      })),
    };
    const withoutParent = {
      ...baseArgs,
      parentMessageId: undefined,
    };
    const withoutParentNormalizedCitations = {
      ...normalizedCitationArgs,
      parentMessageId: undefined,
    };

    if (citationCompatError && parentCompatError) {
      return await convexMutation("chats:appendMessage", withoutParentNormalizedCitations) as { messageId: string };
    }
    if (citationCompatError) {
      return await convexMutation("chats:appendMessage", normalizedCitationArgs) as { messageId: string };
    }
    try {
      return await convexMutation("chats:appendMessage", withoutParent) as { messageId: string };
    } catch (retryError) {
      if (!isLegacyCitationValidatorError(retryError)) throw retryError;
      return await convexMutation("chats:appendMessage", withoutParentNormalizedCitations) as { messageId: string };
    }
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
  const allocateInputTokenBreakdown = (params: {
    inputTokens: number;
    systemChars: number;
    historyChars: number;
    memoryChars: number;
    sourceChars: number;
  }) => {
    const totalChars = Math.max(
      1,
      params.systemChars + params.historyChars + params.memoryChars + params.sourceChars,
    );
    const provisional = {
      systemPrompt: Math.floor((params.inputTokens * params.systemChars) / totalChars),
      history: Math.floor((params.inputTokens * params.historyChars) / totalChars),
      memory: Math.floor((params.inputTokens * params.memoryChars) / totalChars),
      sources: Math.floor((params.inputTokens * params.sourceChars) / totalChars),
    };
    const used =
      provisional.systemPrompt
      + provisional.history
      + provisional.memory
      + provisional.sources;
    if (used < params.inputTokens) {
      provisional.history += params.inputTokens - used;
    }
    return provisional;
  };
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
  const globalRecentAssistantModels = (await convexQuery("chats:listRecentAssistantModels", {
    actorClerkId: actor.clerkId,
    limit: 30,
  })) as string[];
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
    const hasFreeModel = catalog.some((model) => canUseInTier(model.modelId, "free_only", catalog));
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

  const auto = await runAutoSettingsPipeline({
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
  const userDirectives = parseUserDirectives(normalizedMessage, { modelCatalog: catalog });
  if (userDirectives.forcedModel) {
    logger.info("user directive: forced model", {
      model: userDirectives.forcedModel,
      phrase: userDirectives.detectedModelPhrase,
      score: userDirectives.detectedModelScore,
      source: userDirectives.detectedModelSource,
    });
  }
  if (userDirectives.forceMultiAgent) {
    logger.info("user directive: force multi-agent");
    (body as Record<string, unknown>).forceMultiAgent = true;
  }
  if (userDirectives.memoryActions?.length) {
    logger.info("user directive: memory actions", {
      actions: userDirectives.memoryActions.map((action) => action.type),
    });
  }
  logger.info("auto-settings complete", {
    skippedForT0: false,
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
  let streamClosed = false;

  const send = async (payload: Record<string, unknown>) => {
    if (streamClosed) return;
    try {
      await writer.write(encoder.encode(`${JSON.stringify(payload)}\n`));
    } catch (error) {
      streamClosed = true;
      const err = error as { code?: string; message?: string } | undefined;
      const message = err?.message ?? "";
      const isClosedStreamError =
        err?.code === "ERR_INVALID_STATE"
        || /writablestream is closed/i.test(message)
        || /invalid state/i.test(message);
      if (!isClosedStreamError) {
        logger.warn("stream write failed", {
          error: message || String(error),
        });
      }
    }
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

  if (!isRegenerate && shouldPersistUserMessage) {
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

  let activeWorkstreamId =
    typeof (chatData.chat as { workstreamId?: unknown }).workstreamId === "string"
      ? String((chatData.chat as { workstreamId?: unknown }).workstreamId)
      : undefined;
  // Allow client-specified scope metadata to override or supplement DB values
  if (!activeWorkstreamId && body.workstreamId) {
    activeWorkstreamId = body.workstreamId;
  }
  const clientArtifactId = body.artifactId;
  const clientScopeLevel = body.scopeLevel;
  const [
    workstreamCandidates,
    initialActiveWorkstream,
    initialActiveWorkstreamPlannerItems,
    initialActiveWorkstreamNotes,
    initialActiveWorkstreamArtifacts,
  ] = await Promise.all([
    convexQuery("workstreams:list", {
      actorClerkId: actor.clerkId,
      status: "active",
      limit: 24,
    }).catch(() => []) as Promise<Array<Record<string, unknown>>>,
    activeWorkstreamId
      ? convexQuery("workstreams:get", {
          actorClerkId: actor.clerkId,
          workstreamId: activeWorkstreamId,
        }).catch(() => null)
      : Promise.resolve(null),
    activeWorkstreamId
      ? convexQuery("plannerItems:list", {
          actorClerkId: actor.clerkId,
          workstreamId: activeWorkstreamId,
          limit: 8,
        }).catch(() => [])
      : Promise.resolve([]),
    activeWorkstreamId
      ? convexQuery("notes:list", {
          actorClerkId: actor.clerkId,
          workstreamId: activeWorkstreamId,
          limit: 8,
        }).catch(() => [])
      : Promise.resolve([]),
    activeWorkstreamId
      ? convexQuery("artifacts:list", {
          actorClerkId: actor.clerkId,
          workstreamId: activeWorkstreamId,
          limit: 8,
        }).catch(() => [])
      : Promise.resolve([]),
  ]);
  let activeWorkstream = initialActiveWorkstream as Record<string, unknown> | null;
  let activeWorkstreamPlannerItems = initialActiveWorkstreamPlannerItems as Array<Record<string, unknown>>;
  let activeWorkstreamNotes = initialActiveWorkstreamNotes as Array<Record<string, unknown>>;
  let activeWorkstreamArtifacts = Array.isArray(initialActiveWorkstreamArtifacts)
    ? (initialActiveWorkstreamArtifacts as Array<Record<string, unknown>>).filter(
        (artifact) => String((artifact as { type?: unknown }).type ?? "") !== "document",
      )
    : [];

  if (!selectedAgent && activeWorkstream && typeof (activeWorkstream as { linkedAgentId?: unknown }).linkedAgentId === "string") {
    const linkedWorkstreamAgent = (await convexQuery("agents:getAgent", {
      actorClerkId: actor.clerkId,
      agentId: String((activeWorkstream as { linkedAgentId?: unknown }).linkedAgentId),
    }).catch(() => null)) as AgentSnapshot | null;
    if (linkedWorkstreamAgent?._id) {
      selectedAgent = linkedWorkstreamAgent;
    }
  }

  const history = toChatMessageShape(chatData.messages);
  const storedLearningContext = parseLearningContext((chatData.chat as { learningContext?: unknown }).learningContext);
  const recentContextCache = parseRecentContext({
    raw: (chatData.chat as { recentContext?: unknown }).recentContext,
    savedAt: (chatData.chat as { recentContextAt?: unknown }).recentContextAt,
  });
  const lastAssistantMessage = [...history].reverse().find((message) => message.role === "assistant");
  const lastClarificationBlock = (
    lastAssistantMessage?.routeTrace as { clarificationBlock?: ClarificationBlock } | undefined
  )?.clarificationBlock;
  const lastAssistantWasClarification = Boolean(lastClarificationBlock);
  const clarificationFollowUp = isClarificationFollowUpMessage({
    message: normalizedMessage,
    block: lastClarificationBlock,
  });
  const shouldReuseRecentContext = Boolean(
    recentContextCache
    && lastAssistantWasClarification
    && clarificationFollowUp,
  );
  if (recentContextCache && lastAssistantWasClarification) {
    void convexMutation("chats:setRecentContext", {
      actorClerkId: actor.clerkId,
      chatId,
      recentContext: undefined,
      recentContextAt: undefined,
    }).catch(() => {});
  }
  const latestUserMessageInHistory = [...history].reverse().find((message) => message.role === "user");
  const requestedParentMessageId =
    typeof body.parentMessageId === "string" && body.parentMessageId.trim().length > 0
      ? body.parentMessageId.trim()
      : undefined;
  const requestedParentExists = requestedParentMessageId
    ? history.some((message) => message._id === requestedParentMessageId && message.role === "user")
    : false;
  const currentTurnParentMessageId =
    (requestedParentExists ? requestedParentMessageId : undefined)
    ?? persistedUserMessageId
    ?? latestUserMessageInHistory?._id;
  const resolvedUserMessageId = persistedUserMessageId ?? currentTurnParentMessageId;
  const historyForTurn = (() => {
    if (!isRegenerate) return history;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i]?.role === "user") {
        return history.slice(0, i + 1);
      }
    }
    return history;
  })();
  const isFirstAssistantTurn = history.every((message) => message.role !== "assistant");
  // Don't generate a title if the chat already has a meaningful non-default title.
  const existingChatTitle = typeof (chatData.chat as { title?: unknown }).title === "string"
    ? ((chatData.chat as { title?: string }).title ?? "").trim()
    : "";
  const chatAlreadyNamed = existingChatTitle.length > 0
    && existingChatTitle !== "New chat"
    && existingChatTitle !== "Untitled";
  const shouldGenerateTitle = isFirstAssistantTurn && !chatAlreadyNamed;
  const attemptStats = extractAttemptStats(history);
  const currentWorkstreamFocusSurface = (): "workspace" | "panel" | "chat" | "none" =>
    activeWorkstreamId
      ? (body.chatId ? "chat" : "panel")
      : "none";
  const workstreamClassificationContext = {
    activeWorkstreamId,
    focusSurface: currentWorkstreamFocusSurface(),
    artifactCount: Array.isArray(activeWorkstreamArtifacts) ? activeWorkstreamArtifacts.length : 0,
    noteCount: Array.isArray(activeWorkstreamNotes) ? activeWorkstreamNotes.length : 0,
    plannerItemCount: Array.isArray(activeWorkstreamPlannerItems) ? activeWorkstreamPlannerItems.length : 0,
    threadCount: activeWorkstream ? Number((activeWorkstream as { threadCount?: unknown }).threadCount ?? 0) : 0,
    linkedAgent: Boolean(selectedAgent?._id || (activeWorkstream as { linkedAgentId?: unknown } | null)?.linkedAgentId),
    recentActivityAt:
      activeWorkstream && typeof (activeWorkstream as { lastActivityAt?: unknown }).lastActivityAt === "number"
        ? Number((activeWorkstream as { lastActivityAt?: unknown }).lastActivityAt)
        : undefined,
  };
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
        logger.info("memory directive applied: forget", {
          target: action.target,
          deleted: result.deleted ?? 0,
        });
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
          spendingTier: budget.tier,
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

  let workstreamDefaultMode: StudyMode | undefined;
  let workstreamDefaultThinking: "low" | "medium" | "high" | undefined;
  const syncWorkstreamDefaults = () => {
    workstreamDefaultMode =
      activeWorkstream && typeof (activeWorkstream as { defaultMode?: unknown }).defaultMode === "string"
        ? safeStudyMode(String((activeWorkstream as { defaultMode?: unknown }).defaultMode), "pipeline workstream defaultMode")
        : undefined;
    workstreamDefaultThinking =
      activeWorkstream && typeof (activeWorkstream as { defaultThinking?: unknown }).defaultThinking === "string"
        ? ((activeWorkstream as { defaultThinking?: unknown }).defaultThinking as "low" | "medium" | "high")
        : undefined;
  };
  syncWorkstreamDefaults();
  if (safeMode === "auto" && workstreamDefaultMode && (effectiveMode === "general" || effectiveMode === "tutor")) {
    effectiveMode = workstreamDefaultMode;
    auto.suggestedMode = workstreamDefaultMode;
    earlyEventBuffer.push({
      type: "mode_update",
      suggestedMode: effectiveMode,
    });
  }
  if (workstreamDefaultThinking && auto.thinkingLevel === "low" && workstreamDefaultThinking !== "low") {
    auto.thinkingLevel = workstreamDefaultThinking;
  }

  // Vague request detection for quiz/flashcard modes.
  // When a request is ambiguous (no topic specified), skip format-repair so the
  // model can ask a clarifying question instead of generating empty/wrong content.
  const isVagueRequest =
    (effectiveMode === "quiz" || effectiveMode === "flashcard") &&
    normalizedMessage.split(/\s+/).length < 4 &&
    !/\b(about|on|for|regarding|the|topic)\b/i.test(normalizedMessage);

  const requestClassification = classifyRequest({
    message: normalizedMessage,
    complexity: auto.complexity,
    mode: effectiveMode,
    hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
    isFirstMessage: isFirstAssistantTurn,
    multiAgentRequested: Boolean(body.forceMultiAgent),
    spendingTier: budget.tier,
    workstreamContext: workstreamClassificationContext,
  });
  auto.requestClass = requestClassification.requestClass;
  auto.assignmentLevel = requestClassification.assignmentLevel;
  auto.classificationReason = requestClassification.reason;
  let pipelineController = new PipelineController({
    requestClass: requestClassification.requestClass,
    classificationReason: requestClassification.reason,
  });
  if (requestClassification.requestClass === "T0") {
    auto.message = normalizedMessage;
    auto.promptEnhanced = false;
    auto.searchEnabled = false;
    auto.thinkingLevel = "low";
    pipelineController.markStageSkipped("autoSettings", "Skipped for trivial filler T0 request.");
  } else {
    pipelineController.markStageCompleted("autoSettings");
  }

  let agentSuggestion:
    | {
        id: string;
        name: string;
        score: number;
        reason: string;
      }
    | undefined;
  let autoSelectedAgent:
    | {
        id: string;
        name: string;
        score: number;
        reason: string;
        emoji?: string;
      }
    | undefined;
  if (!selectedAgent && (safeMode === "auto" || body.routerMode === "auto")) {
    const availableAgents = (await convexQuery("agents:listAgents", {
      actorClerkId: actor.clerkId,
    })) as AgentSnapshot[];
    const matched = await matchAgentToMessage(auto.message, availableAgents, {
      linkedAgentId:
        typeof (activeWorkstream as { linkedAgentId?: unknown } | null)?.linkedAgentId === "string"
          ? String((activeWorkstream as { linkedAgentId?: unknown }).linkedAgentId)
          : null,
      mode: safeMode === "auto" ? effectiveMode : safeMode,
      activeWorkstreamLinked: Boolean(activeWorkstream && typeof (activeWorkstream as { linkedAgentId?: unknown }).linkedAgentId === "string"),
    });
    if (matched) {
      const matchedScore = Number(matched.score.toFixed(2));
      if (matched.score >= 0.7) {
        const autoAgent = availableAgents.find((agent) => agent._id === matched.agentId);
        if (autoAgent) {
          selectedAgent = autoAgent;
          autoSelectedAgent = {
            id: autoAgent._id,
            name: autoAgent.name,
            score: matchedScore,
            reason: matched.reason,
            emoji: autoAgent.avatarEmoji,
          };
          logger.info("agent auto-selected", {
            agentId: autoAgent._id,
            score: matched.score,
          });
        }
      } else if (matched.score >= 0.4) {
        agentSuggestion = {
          id: matched.agentId,
          name: matched.agentName,
          score: matchedScore,
          reason: matched.reason,
        };
        logger.info("agent suggestion generated", {
          agentId: matched.agentId,
          score: matched.score,
        });
      }
    }
  }
  const classifierAvailableAgents =
    selectedAgent
      ? [selectedAgent]
      : !selectedAgent && (safeMode === "auto" || body.routerMode === "auto")
        ? ((await convexQuery("agents:listAgents", {
            actorClerkId: actor.clerkId,
          })) as AgentSnapshot[])
        : [];
  if (autoSelectedAgent?.id) {
    void convexMutation("chats:updateChatSettings", {
      actorClerkId: actor.clerkId,
      chatId,
      agentId: autoSelectedAgent.id,
    }).catch(() => {});
    earlyEventBuffer.push({
      type: "agent_update",
      status: "auto_selected",
      agent: autoSelectedAgent,
      message: `Using ${autoSelectedAgent.name} for this question`,
    });
  }

  const existingSummary =
    typeof chatData.chat.contextSummary === "string" && chatData.chat.contextSummary.trim().length > 0
      ? String(chatData.chat.contextSummary)
      : undefined;

  const scheduledCompaction = shouldScheduleCompaction({
    history: historyForTurn,
    mode: effectiveMode,
    hasExistingSummary: Boolean(existingSummary),
  });
  if (scheduledCompaction) {
    earlyEventBuffer.push({ type: "phase", phase: "compacting" });
    void maybeCompactHistory({
      actorClerkId: actor.clerkId,
      chatId,
      history: historyForTurn,
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
  const recentHistory = existingSummary ? historyForTurn.slice(-compactedWindow) : historyForTurn;
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
  const estimatedHistoryTokens = Math.ceil(
    historyForTurn.reduce(
      (sum, message) => sum + (message.content?.length ?? 0) + Math.min(message.thinkingContent?.length ?? 0, 400),
      0,
    ) / 4,
  );
  const buildWorkstreamRouteContext = () => ({
    activeWorkstreamId,
    focusSurface: currentWorkstreamFocusSurface(),
    activeWorkstream: activeWorkstream
      ? {
          _id: String((activeWorkstream as { _id: unknown })._id),
          title: String((activeWorkstream as { title?: unknown }).title ?? "Workstream"),
          description:
            typeof (activeWorkstream as { description?: unknown }).description === "string"
              ? String((activeWorkstream as { description?: unknown }).description)
              : undefined,
          subjectCode:
            typeof (activeWorkstream as { subjectCode?: unknown }).subjectCode === "string"
              ? String((activeWorkstream as { subjectCode?: unknown }).subjectCode)
              : undefined,
          linkedAgentId:
            typeof (activeWorkstream as { linkedAgentId?: unknown }).linkedAgentId === "string"
              ? String((activeWorkstream as { linkedAgentId?: unknown }).linkedAgentId)
              : undefined,
          lastActivityAt:
            typeof (activeWorkstream as { lastActivityAt?: unknown }).lastActivityAt === "number"
              ? Number((activeWorkstream as { lastActivityAt?: unknown }).lastActivityAt)
              : undefined,
          defaultMode: workstreamDefaultMode,
          defaultThinking: workstreamDefaultThinking,
          artifactCount: Array.isArray(activeWorkstreamArtifacts) ? activeWorkstreamArtifacts.length : 0,
          noteCount: Array.isArray(activeWorkstreamNotes) ? activeWorkstreamNotes.length : 0,
          plannerItemCount: Array.isArray(activeWorkstreamPlannerItems) ? activeWorkstreamPlannerItems.length : 0,
          threadCount: historyForTurn.length,
          recentArtifactTitles: Array.isArray(activeWorkstreamArtifacts)
            ? activeWorkstreamArtifacts
                .slice(0, 4)
                .map((artifact) => String((artifact as { title?: unknown }).title ?? ""))
                .filter(Boolean)
            : [],
          recentNoteTitles: Array.isArray(activeWorkstreamNotes)
            ? activeWorkstreamNotes
                .slice(0, 4)
                .map((note) => String((note as { title?: unknown }).title ?? ""))
                .filter(Boolean)
            : [],
          recentPlannerTitles: Array.isArray(activeWorkstreamPlannerItems)
            ? activeWorkstreamPlannerItems
                .slice(0, 4)
                .map((item) => String((item as { title?: unknown }).title ?? ""))
                .filter(Boolean)
            : [],
        }
      : undefined,
    candidates: Array.isArray(workstreamCandidates)
      ? workstreamCandidates
          .map((candidate) => ({
            _id: String((candidate as { _id: unknown })._id),
            title: String((candidate as { title?: unknown }).title ?? ""),
            description:
              typeof (candidate as { description?: unknown }).description === "string"
                ? String((candidate as { description?: unknown }).description)
                : undefined,
            subjectCode:
              typeof (candidate as { subjectCode?: unknown }).subjectCode === "string"
                ? String((candidate as { subjectCode?: unknown }).subjectCode)
                : undefined,
            linkedAgentId:
              typeof (candidate as { linkedAgentId?: unknown }).linkedAgentId === "string"
                ? String((candidate as { linkedAgentId?: unknown }).linkedAgentId)
                : undefined,
            lastActivityAt:
              typeof (candidate as { lastActivityAt?: unknown }).lastActivityAt === "number"
                ? Number((candidate as { lastActivityAt?: unknown }).lastActivityAt)
                : undefined,
            defaultMode:
              typeof (candidate as { defaultMode?: unknown }).defaultMode === "string"
                ? safeStudyMode(String((candidate as { defaultMode?: unknown }).defaultMode), "pipeline workstream candidate defaultMode")
                : undefined,
          }))
          .filter((candidate) => candidate.title)
      : [],
  });
  const buildSelectedAgentSnapshot = () =>
    selectedAgent
      ? {
          _id: selectedAgent._id,
          name: selectedAgent.name,
          preferredModel: selectedAgent.preferredModel,
          preferredMode: selectedAgent.preferredMode,
          systemPrompt: selectedAgent.systemPrompt,
          description: selectedAgent.description,
          subjectArea: selectedAgent.subjectArea,
          gradeLevel: selectedAgent.gradeLevel,
          modelAllowlist: selectedAgent.modelAllowlist,
          modelDenylist: selectedAgent.modelDenylist,
          allowedTools: selectedAgent.allowedTools,
          guidelinesSummary: selectedAgent.guidelinesSummary,
          guidelinesTopicMap: selectedAgent.guidelinesTopicMap,
          guidelinesRubricHints: selectedAgent.guidelinesRubricHints,
          guidelinesMisconceptions: selectedAgent.guidelinesMisconceptions,
          guidelinesVocabulary: selectedAgent.guidelinesVocabulary,
          guidelinesExamStructure: selectedAgent.guidelinesExamStructure,
        }
      : undefined;
  const buildThreadContext = (): {
    currentChatId: string;
    turnCount: number;
    turnsSinceCompaction: number;
    contextWindowUtilization: number;
    lastMessageAt: number | undefined;
    recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
    explicitlySameThread: boolean;
  } => ({
    currentChatId: chatId,
    turnCount: historyForTurn.length,
    turnsSinceCompaction: existingSummary ? Math.min(historyForTurn.length, 8) : historyForTurn.length,
    contextWindowUtilization: Math.max(0, Math.min(1, estimatedHistoryTokens / 128_000)),
    lastMessageAt: historyForTurn[historyForTurn.length - 1]?.createdAt,
    recentMessages: historyForTurn.slice(existingSummary ? -10 : -6).map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    })),
    explicitlySameThread: Boolean(requestedParentMessageId),
  });
  let routePlan = buildRoutePlan({
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
    assignmentLevel: auto.assignmentLevel,
    selectedAgent: buildSelectedAgentSnapshot(),
    workstreamContext: buildWorkstreamRouteContext(),
    threadContext: buildThreadContext(),
    schoolSoulVersion: schoolSoulCapsule.version,
  });
  // Resolve artifact title for scope context when client specifies an artifact
  let clientArtifactTitle: string | undefined;
  if (clientArtifactId) {
    const matchedArtifact = activeWorkstreamArtifacts.find(
      (a) => String((a as { _id?: unknown })._id) === clientArtifactId,
    );
    if (matchedArtifact && typeof (matchedArtifact as { title?: unknown }).title === "string") {
      clientArtifactTitle = String((matchedArtifact as { title?: unknown }).title);
    }
  }
  const classifierInput = buildClassifierInput({
    message: auto.message,
    mode: effectiveMode,
    activeWorkstreamId,
    activeWorkstreamTitle:
      typeof (activeWorkstream as { title?: unknown } | undefined)?.title === "string"
        ? String((activeWorkstream as { title?: unknown }).title)
        : undefined,
    activeArtifactId: clientArtifactId,
    activeArtifactTitle: clientArtifactTitle,
    scopeLevel: clientScopeLevel,
    selectedAgentId: selectedAgent?._id,
    conversationHistory: history.map((msg) => ({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: msg.content,
      mode: msg.mode as string | undefined,
    })),
    userThinkingLevel: body.thinkingLevel,
    routerMode: body.routerMode,
    memoryEnabled,
    usePersonalResources: body.usePersonalResources,
    availableAgents: classifierAvailableAgents,
  });
  const classifierInputValid = validateClassifierInput(classifierInput);
  const classifierSkillIds = classifierInput.availableSkills;
  const classifierDecisionSource = {
    tier: auto.requestClass,
    skills: selectRuntimeSkills({
      message: auto.message,
      mode: effectiveMode,
      allowedToolBundles: routePlan.allowedToolBundles,
      maxSkills: routePlan.responseBudget === "deep" ? 6 : 4,
    }).map((skill) => skill.id),
    workspaceTarget: activeWorkstreamId
      ? { kind: "current" as const, workspaceId: activeWorkstreamId }
      : routePlan.workstreamAssignment.status === "assigned"
        ? { kind: "specific" as const, workspaceId: routePlan.workstreamAssignment.workstreamId }
        : { kind: "none" as const },
    agentId: selectedAgent?._id ?? autoSelectedAgent?.id ?? null,
    needsSearch: routePlan.shouldUseWebSearch,
    needsMemory: memoryEnabled && routePlan.shouldConsultMemory,
    needsRag: routePlan.retrievalScopes.length > 0,
    outputFormat: classifierOutputFormatForRoutePlan(routePlan.modeContract.outputFormat, "conversational"),
    thinkingLevel: auto.thinkingLevel,
    confidence:
      routePlan.workstreamAssignment.status === "assigned"
        ? Math.max(routePlan.workstreamAssignment.confidence, auto.requestClass === "T0" ? 0.9 : 0.72)
        : auto.requestClass === "T0"
          ? 0.96
          : auto.requestClass === "T1"
            ? 0.82
            : auto.requestClass === "T2"
              ? 0.76
              : 0.71,
  };
  const classifierMeta = {
    modelId: MODEL_CONFIG.smartCheap,
    modelLane: CLASSIFIER_MODEL_LANE,
    fallbackUsed: false,
    fallbackReason: undefined as string | undefined,
    timedOut: false,
    durationMs: 0,
  };
  const classifierValidation = classifierInputValid
    ? validateClassifierDecision(classifierDecisionSource, classifierSkillIds)
    : { ok: false as const, error: "Classifier input payload is malformed." };
  if (!classifierValidation.ok) {
    logger.warn("classifier contract validation failed", {
      error: classifierValidation.error,
      inputValid: classifierInputValid,
    });
    return jsonError(500, {
      code: "CLASSIFIER_CONTRACT_INVALID",
      message: "Classifier output failed validation before pipeline consumption.",
      retryable: true,
    });
  }
  const classifierDecision: ClassifierDecision = classifierValidation.value;
  pipelineController.markStageCompleted("classifyRequest");
  const initialWorkstreamAssignment = routePlan.workstreamAssignment;
  const routedWorkstreamId =
    routePlan.workstreamAssignment.status === "assigned"
      ? routePlan.workstreamAssignment.workstreamId
      : undefined;
  if (routedWorkstreamId && routedWorkstreamId !== activeWorkstreamId) {
    activeWorkstreamId = routedWorkstreamId;
    await convexMutation("chats:updateChatSettings", {
      actorClerkId: actor.clerkId,
      chatId,
      workstreamId: routedWorkstreamId,
    }).catch(() => {});
    await convexMutation("workstreams:touchActivity", {
      actorClerkId: actor.clerkId,
      workstreamId: routedWorkstreamId,
      at: Date.now(),
    }).catch(() => {});
    const [
      hydratedWorkstream,
      hydratedPlannerItems,
      hydratedNotes,
      hydratedArtifacts,
    ] = await Promise.all([
      convexQuery("workstreams:get", {
        actorClerkId: actor.clerkId,
        workstreamId: routedWorkstreamId,
      }).catch(() => null),
      convexQuery("plannerItems:list", {
        actorClerkId: actor.clerkId,
        workstreamId: routedWorkstreamId,
        limit: 8,
      }).catch(() => []),
      convexQuery("notes:list", {
        actorClerkId: actor.clerkId,
        workstreamId: routedWorkstreamId,
        limit: 8,
      }).catch(() => []),
      convexQuery("artifacts:list", {
        actorClerkId: actor.clerkId,
        workstreamId: routedWorkstreamId,
        limit: 8,
      }).catch(() => []),
    ]);
    activeWorkstream = (hydratedWorkstream as Record<string, unknown> | null) ?? activeWorkstream;
    activeWorkstreamPlannerItems = Array.isArray(hydratedPlannerItems) ? hydratedPlannerItems as Array<Record<string, unknown>> : [];
    activeWorkstreamNotes = Array.isArray(hydratedNotes) ? hydratedNotes as Array<Record<string, unknown>> : [];
    activeWorkstreamArtifacts = Array.isArray(hydratedArtifacts)
      ? (hydratedArtifacts as Array<Record<string, unknown>>).filter(
          (artifact) => String((artifact as { type?: unknown }).type ?? "") !== "document",
        )
      : [];
    syncWorkstreamDefaults();
    if (!selectedAgent && activeWorkstream && typeof (activeWorkstream as { linkedAgentId?: unknown }).linkedAgentId === "string") {
      const linkedWorkstreamAgent = (await convexQuery("agents:getAgent", {
        actorClerkId: actor.clerkId,
        agentId: String((activeWorkstream as { linkedAgentId?: unknown }).linkedAgentId),
      }).catch(() => null)) as AgentSnapshot | null;
      if (linkedWorkstreamAgent?._id) {
        selectedAgent = linkedWorkstreamAgent;
      }
    }
    if (safeMode === "auto" && workstreamDefaultMode && (effectiveMode === "general" || effectiveMode === "tutor")) {
      effectiveMode = workstreamDefaultMode;
      auto.suggestedMode = workstreamDefaultMode;
      earlyEventBuffer.push({
        type: "mode_update",
        suggestedMode: effectiveMode,
      });
    }
    if (workstreamDefaultThinking && auto.thinkingLevel === "low" && workstreamDefaultThinking !== "low") {
      auto.thinkingLevel = workstreamDefaultThinking;
    }
    const refreshedClassification = classifyRequest({
      message: normalizedMessage,
      complexity: auto.complexity,
      mode: effectiveMode,
      hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
      isFirstMessage: history.length === 0,
      multiAgentRequested: Boolean(body.forceMultiAgent),
      spendingTier: budget.tier,
      workstreamContext: {
        activeWorkstreamId,
        focusSurface: currentWorkstreamFocusSurface(),
        artifactCount: Array.isArray(activeWorkstreamArtifacts) ? activeWorkstreamArtifacts.length : 0,
        noteCount: Array.isArray(activeWorkstreamNotes) ? activeWorkstreamNotes.length : 0,
        plannerItemCount: Array.isArray(activeWorkstreamPlannerItems) ? activeWorkstreamPlannerItems.length : 0,
        threadCount: historyForTurn.length,
        linkedAgent: Boolean(
          selectedAgent?._id
          || (activeWorkstream && typeof (activeWorkstream as { linkedAgentId?: unknown }).linkedAgentId === "string"),
        ),
        recentActivityAt:
          activeWorkstream && typeof (activeWorkstream as { lastActivityAt?: unknown }).lastActivityAt === "number"
            ? Number((activeWorkstream as { lastActivityAt?: unknown }).lastActivityAt)
            : undefined,
      },
    });
    auto.requestClass = refreshedClassification.requestClass;
    auto.assignmentLevel = refreshedClassification.assignmentLevel;
    auto.classificationReason = refreshedClassification.reason;
    if (pipelineController.getState().requestClass !== refreshedClassification.requestClass) {
      pipelineController = new PipelineController({
        requestClass: refreshedClassification.requestClass,
        classificationReason: refreshedClassification.reason,
      });
      if (refreshedClassification.requestClass === "T0") {
        pipelineController.markStageSkipped("autoSettings", "Skipped for trivial filler T0 request.");
      } else {
        pipelineController.markStageCompleted("autoSettings");
      }
    }
    routePlan = buildRoutePlan({
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
      assignmentLevel: auto.assignmentLevel,
      selectedAgent: buildSelectedAgentSnapshot(),
      workstreamContext: buildWorkstreamRouteContext(),
      threadContext: buildThreadContext(),
      schoolSoulVersion: schoolSoulCapsule.version,
    });
    routePlan.workstreamAssignment = initialWorkstreamAssignment;
  }
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
        preferredSkillIds: classifierDecision.skills,
        allowedToolBundles: routePlan.allowedToolBundles,
        assignmentLevel: routePlan.assignmentLevel,
        hasAgent: Boolean(selectedAgent?._id),
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

  const defaultRetrievalResult: RetrievalResult = {
    citations: [],
    sourceBlock: "No retrieved sources.",
    queryEmbedding: undefined,
    diagnostics: {
      scopesAttempted: [],
      status: "not_requested" as const,
      reason: "Retrieval not enabled by the route plan.",
      embeddingModel: undefined,
    },
  };
  const defaultSearchResult: WebSearchResult = {
    text: "",
    urls: [],
    sources: [],
    provider: "disabled" as const,
    modelUsed: undefined,
    usage: undefined,
    durationMs: undefined,
  };
  const hasReusableRecentContext =
    shouldReuseRecentContext
    && Boolean(recentContextCache?.retrieval || recentContextCache?.search);

  const managebacRequested = /\b(managebac|assignment|assignments|cas|timetable|class schedule|ib class|announcement|manage bac)\b/i.test(auto.message);
  const managebacPromise = maybeRetrieveManagebac({
    actorClerkId: actor.clerkId,
    message: auto.message,
    enabled: managebacRequested,
  });

  const retrievalPromise = hasReusableRecentContext
    ? Promise.resolve({
        citations: recentContextCache?.retrieval.citations ?? [],
        sourceBlock: recentContextCache?.retrieval.sourceBlock ?? "Reused cached retrieval context.",
        queryEmbedding: undefined,
        diagnostics: {
          scopesAttempted: recentContextCache?.retrieval.diagnostics?.scopesAttempted ?? [],
          status: recentContextCache?.retrieval.diagnostics?.status ?? ("retrieved" as const),
          reason: recentContextCache?.retrieval.diagnostics?.reason ?? "Loaded from recent clarification context cache.",
          embeddingModel: recentContextCache?.retrieval.diagnostics?.embeddingModel,
        },
      })
    : routePlan.allowedToolBundles.includes("retrieval") && routePlan.retrievalScopes.length > 0
      ? runRagRetrieval({
          actorClerkId: actor.clerkId,
          chatId,
          packId: routePlan.retrievalScopes.includes("pack") ? activePackId : undefined,
          usePersonalResources: routePlan.retrievalScopes.includes("personal") && body.usePersonalResources,
          selectedAgentId: routePlan.retrievalScopes.includes("agent") ? selectedAgent?._id : undefined,
          message: auto.message,
          logger,
        })
      : Promise.resolve(defaultRetrievalResult);

  const searchPromise: Promise<WebSearchResult> = hasReusableRecentContext
    ? Promise.resolve({
        text: recentContextCache?.search.text ?? "",
        urls: recentContextCache?.search.urls ?? [],
        sources: recentContextCache?.search.sources ?? [],
        provider: recentContextCache?.search.provider ?? ("disabled" as const),
        strategy: routePlan.searchPlan?.strategy,
        triggeredBy: routePlan.searchPlan?.trigger,
        modelUsed: undefined,
        usage: undefined,
        durationMs: undefined,
      })
    : routePlan.shouldUseWebSearch
      ? maybeSearchWeb(auto.message, auto.thinkingLevel, {
          actorClerkId: actor.clerkId,
          chatId,
          modelCatalog: catalog,
          spendingTier: budget.tier,
          modelRuntimeStats: runtimeStatMap,
          searchPlan: routePlan.searchPlan,
        }).catch(() => ({
          text: "",
          urls: [] as string[],
          sources: [] as Array<{ url: string; title: string; domain: string }>,
          provider: "error" as const,
          strategy: routePlan.searchPlan?.strategy,
          triggeredBy: routePlan.searchPlan?.trigger,
          fallbackReason: "search_request_failed",
          operations: [{
            tool: "search",
            status: "failed" as const,
            reason: "Search request failed before response parsing.",
          }],
          modelUsed: undefined,
          usage: undefined,
          durationMs: undefined,
        }))
      : Promise.resolve(defaultSearchResult);
  if (routePlan.shouldUseWebSearch || hasReusableRecentContext) {
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

  const [retrieval, webResult, quizAdaptive, latestDeck, managebacContext] = await Promise.all([
    retrievalPromise,
    searchPromise,
    adaptiveQuizPromise,
    latestDeckPromise,
    managebacPromise,
  ]);

  const searchBlock = webResult.text ?? "";
  const searchUrls = webResult.urls ?? [];
  let searchSources = webResult.sources ?? [];
  const searchProvider = webResult.provider;
  const usedRecentContextCache = hasReusableRecentContext;
  const retrievalExpectedByUser = routePlan.shouldUseSchoolResources && routePlan.retrievalScopes.length > 0;
  const retrievalMissedExpectedSources =
    retrievalExpectedByUser
    && retrieval.citations.length === 0
    && (
      retrieval.diagnostics?.status === "no_high_confidence_matches"
      || retrieval.diagnostics?.status === "no_sources_available"
      || retrieval.diagnostics?.status === "failed"
    );
  const routeTraceSearchStatus =
    !routePlan.shouldUseWebSearch && !usedRecentContextCache
      ? "skipped"
      : searchProvider === "tavily"
        ? "real_search"
        : searchProvider === "model_fallback"
          ? "model_knowledge"
          : searchProvider === "disabled"
            ? "skipped"
          : "error";
  if (usedRecentContextCache || routePlan.retrievalScopes.length > 0) {
    pipelineController.markStageCompleted("ragRetrieval");
  } else {
    pipelineController.markStageSkipped("ragRetrieval", "No retrieval scope enabled after cost and route gating.");
  }
  if (usedRecentContextCache || routePlan.shouldUseWebSearch) {
    pipelineController.markStageCompleted("webSearch");
  } else {
    pipelineController.markStageSkipped("webSearch", "Web search disabled after request-class and route gating.");
  }
  const routeSearchTrace: RouteTrace["searchTrace"] = {
    provider: searchProvider,
    strategy: webResult.strategy ?? routePlan.searchPlan?.strategy,
    triggeredBy: webResult.triggeredBy ?? routePlan.searchPlan?.trigger,
    fallbackReason: webResult.fallbackReason,
    costCredits: webResult.costCredits,
    operations: webResult.operations,
  };
  const diag = retrieval.diagnostics;
  const embeddingUsage = diag && "embeddingUsage" in diag ? diag.embeddingUsage : undefined;
  const embeddingDurationMs = diag && "embeddingDurationMs" in diag ? diag.embeddingDurationMs : undefined;
  if (diag?.embeddingModel || embeddingUsage) {
    deferSubcall({
      phaseId: "retrieval",
      label: "Retrieval embedding",
      endpoint: "embeddings",
      status: "ok",
      modelUsed: diag?.embeddingModel,
      inputTokens: embeddingUsage?.prompt_tokens,
      outputTokens: embeddingUsage?.completion_tokens,
      costCents: costCentsFromUsage(embeddingUsage),
      durationMs: embeddingDurationMs,
    });
  }
  if (searchProvider === "model_fallback") {
    logger.warn("Tavily search failed; using :online model fallback", {
      reason: webResult.fallbackReason ?? "unknown",
      strategy: webResult.strategy ?? routePlan.searchPlan?.strategy ?? "search",
      trigger: webResult.triggeredBy ?? routePlan.searchPlan?.trigger ?? "none",
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
  if (routePlan.shouldUseWebSearch || usedRecentContextCache) {
    logger.info("web search complete", { urlCount: searchUrls.length });
    if (searchProvider === "model_fallback") {
      const fallbackSourceCount = Math.max(0, searchUrls.length);
      earlyEventBuffer.push({
        type: "search_status",
        status: fallbackSourceCount > 0 ? "completed" : "failed",
        searchStatus: "model_fallback",
        sourceCount: fallbackSourceCount,
      });
    } else if (searchProvider === "tavily") {
      earlyEventBuffer.push({
        type: "search_status",
        status: "completed",
        searchStatus: "real_search",
        sourceCount: Math.max(0, searchUrls.length),
      });
    } else if (searchProvider === "error") {
      earlyEventBuffer.push({ type: "search_status", status: "failed", searchStatus: "error", sourceCount: 0 });
    }
  }
  if (retrievalMissedExpectedSources) {
    earlyEventBuffer.push({
      type: "notice",
      message:
        "I could not find usable evidence in your uploaded resources for this request, so I will respond with general guidance unless you point me to a specific file or section.",
    });
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
  const previousAssistantTurn = [...history]
    .reverse()
    .find((message) => message.role === "assistant" && message.modelUsed);
  const cacheWindow = {
    lastModel: previousAssistantTurn?.modelUsed,
    lastUsedAt: previousAssistantTurn?.createdAt,
    compactedAt: typeof chatData.chat.compactedAt === "number" ? chatData.chat.compactedAt : undefined,
    ttlMs: 5 * 60 * 1000,
  };
  const chatRecentAssistantModels = history
    .filter((message) => message.role === "assistant")
    .map((message) => message.modelUsed)
    .filter((model): model is string => Boolean(model))
    .slice(-20);
  const combinedRecentAssistantModels = Array.from(
    [
      ...chatRecentAssistantModels,
      ...globalRecentAssistantModels.filter((model): model is string => Boolean(model && model.trim())),
    ],
  ).slice(-20);
  const constrainedCatalog = (() => {
    if (!selectedAgent) return catalog;
    const allowlist = Array.from(
      new Set((selectedAgent.modelAllowlist ?? []).map((model) => model.trim()).filter(Boolean)),
    );
    const denylist = new Set((selectedAgent.modelDenylist ?? []).map((model) => model.trim()).filter(Boolean));
    let filtered = catalog;
    if (allowlist.length > 0) {
      const allowSet = new Set(allowlist);
      filtered = filtered.filter((model) => model.modelId === "openrouter/auto" || allowSet.has(model.modelId));
    }
    if (denylist.size > 0) {
      filtered = filtered.filter((model) => !denylist.has(model.modelId));
    }
    const hasRunnableModel = filtered.some((model) => model.modelId !== "openrouter/auto");
    return hasRunnableModel ? filtered : catalog;
  })();
  if (selectedAgent?.modelAllowlist?.length || selectedAgent?.modelDenylist?.length) {
    routePlan.intentSignals = {
      ...(routePlan.intentSignals ?? {}),
      requestedModelPhrase:
        routePlan.intentSignals?.requestedModelPhrase
        ?? `agent_model_constraints:${(selectedAgent.modelAllowlist ?? []).length} allow / ${(selectedAgent.modelDenylist ?? []).length} deny`,
    };
  }

  const fallbackManualModel =
    body.manualModel
    ?? constrainedCatalog.find((model) => model.modelId !== "openrouter/auto")?.modelId
    ?? "openrouter/auto";
  const intentForcesManualModel = userDirectives.forcedModel
    && body.routerMode !== "manual"
    && autoSettings.autoModel;
  const routingMode = autoSettings.autoModel
    ? (intentForcesManualModel ? "manual" : body.routerMode)
    : "manual";
  const routingManualModel = autoSettings.autoModel
    ? (intentForcesManualModel ? userDirectives.forcedModel : body.manualModel)
    : fallbackManualModel;
  const detectedIntents = [
    userDirectives.detectedModelPhrase && userDirectives.forcedModel
      ? `model_request:${userDirectives.detectedModelPhrase}->${userDirectives.forcedModel}`
      : undefined,
    userDirectives.orchestrationPhraseDetected ? "orchestration_request:multi_model" : undefined,
    routePlan.intentSignals?.requestedOrchestration ? "route_plan_orchestration_signal" : undefined,
    selectedAgent?.modelAllowlist?.length ? `agent_allowlist:${selectedAgent.modelAllowlist.length}` : undefined,
    selectedAgent?.modelDenylist?.length ? `agent_denylist:${selectedAgent.modelDenylist.length}` : undefined,
  ].filter((value): value is string => Boolean(value));
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
    needsSearch: routePlan.shouldUseWebSearch || usedRecentContextCache,
    hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
    requiredCapabilities: routePlan.candidateModelRequirements.required,
    preferredCapabilities: routePlan.candidateModelRequirements.preferred,
    preferredModelIds: [
      selectedAgent?.preferredModel,
    ].filter((value): value is string => Boolean(value)),
    previousModelUsed: previousAssistantModel,
    conversationTurnCount: history.length,
    recentModels: combinedRecentAssistantModels,
    requestClass: auto.requestClass,
    assignmentLevel: auto.assignmentLevel,
    estimatedInputTokens: routePlan.contextWindowStrategy.estimatedInputTokens,
    estimatedOutputTokens: routePlan.contextWindowStrategy.estimatedOutputTokens,
    desiredContextTokens: routePlan.contextWindowStrategy.desiredContextTokens,
    preferLargeContext: routePlan.contextWindowStrategy.preferLargeContext,
    cacheWindow,
    manualModelConfirmedExpensive: Boolean(body.confirmExpensiveModel),
    modelCatalog: constrainedCatalog,
    modelRuntimeStats: runtimeStatMap,
    seedKey: `${chatId}:${normalizedMessage}`,
  });
  pipelineController.markStageCompleted("modelSelection");
  const pipelineSnapshot = pipelineController.getState();
  const route: ModelRouteResult = {
    primaryModel: routeDecision.selectedModel,
    fallbackModels: routeDecision.fallbackModels,
    verificationModel: undefined as string | undefined,
    reason: routeDecision.reason,
    autoEnhanced: routingMode !== "manual",
    searchEnabled: routePlan.shouldUseWebSearch || usedRecentContextCache,
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
        needsSearch: classifierDecision.needsSearch,
        needsRag: classifierDecision.needsRag,
        needsVision: (body.attachmentTypes?.length ?? 0) > 0,
        needsTabular: false,
        spendingTier: budget.tier,
        hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
        attachmentTypes: body.attachmentTypes ?? [],
        promptEnhanced: auto.promptEnhanced,
        messageLength: auto.message.length,
        conversationLength: history.length,
        assignmentLevel: auto.assignmentLevel,
        requestClass: auto.requestClass,
        classificationReason: auto.classificationReason,
        previousModelUsed: previousAssistantModel,
        agentPreferredModel: selectedAgent?.preferredModel,
        detectedIntents,
        workstreamId: activeWorkstreamId,
        classifierInput,
        classifierDecision,
        classifierMeta,
        modelLanes: {
          classifier: classifierMeta.modelLane,
          generation: routeDecision.lane,
        },
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
      assignmentLevel: auto.assignmentLevel,
      requestClass: auto.requestClass,
      classificationReason: auto.classificationReason,
      classifierInput,
      classifierDecision,
      classifierMeta,
      stepsExecuted: pipelineSnapshot.completedStages,
      stepsSkipped: pipelineSnapshot.skippedStages.map((row) => ({
        step: row.step,
        reason: row.reason,
      })),
      searchStatus: routeTraceSearchStatus,
      searchTrace: routeSearchTrace,
      costBudgetUsd: pipelineSnapshot.costBudgetUsd,
      usageBudgetRemaining: pipelineSnapshot.usageBudgetRemaining,
      workstreamAssignment: routePlan.workstreamAssignment,
      threadStrategy: routePlan.threadStrategy,
      contextWindowStrategy: routePlan.contextWindowStrategy,
      inputTokenBreakdown: undefined as
        | {
          systemPrompt: number;
          history: number;
          memory: number;
          sources: number;
        }
        | undefined,
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
      if (phase.id === "ws_memory") {
        return injectedWorkstreamMemory.length > 0
          ? { ...phase, status: "completed", detail: `Injected ${injectedWorkstreamMemory.length} scoped workstream memory entr${injectedWorkstreamMemory.length === 1 ? "y" : "ies"}.` }
          : surfacedWorkstreamMemory.length > 0
            ? { ...phase, status: "skipped", detail: "Matched workstream memory was surfaced but not auto-injected." }
            : { ...phase, status: "skipped", detail: "No matching workstream memory." };
      }
      if (phase.id === "ws_artifacts") {
        return (workstreamPlannerSummary || workstreamArtifactSummary)
          ? { ...phase, status: "completed", detail: "Planner and artifact workspace context injected." }
          : { ...phase, status: "skipped", detail: "No planner or artifact context available." };
      }
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
  const manualLockRequested = routingMode === "manual" && Boolean(routingManualModel) && !body.forcedModel;
  const manualModelMeta = routingManualModel
    ? catalog.find((model) => model.modelId === routingManualModel)
    : undefined;
  const generationLane = inferRoutingLane({
    mode: effectiveMode,
    requiredCapabilities: routePlan.candidateModelRequirements.required,
    needsSearch: routePlan.shouldUseWebSearch || usedRecentContextCache,
    preferFast: routePlan.responseBudget === "simple",
  });
  const manualModelExceedsCap = Boolean(manualModelMeta && isModelTooExpensivePerMillion(manualModelMeta, { lane: generationLane }));
  if (manualLockRequested && routingManualModel && manualModelExceedsCap && !body.confirmExpensiveModel) {
    await rollbackPersistedUserMessage();
    return jsonError(409, {
      code: "MANUAL_MODEL_CONFIRM_REQUIRED",
      message: `The selected model (${routingManualModel}) exceeds the automatic 30/M cap. Confirm once to run it manually for this request.`,
      retryable: false,
    }, {
      requiredConfirmation: true,
      modelId: routingManualModel,
      inputCostPerM: manualModelMeta?.inputCostPerM,
      outputCostPerM: manualModelMeta?.outputCostPerM,
    });
  }
  if (manualLockRequested && routingManualModel && route.primaryModel !== routingManualModel) {
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
  if (retrievalMissedExpectedSources) {
    route.trace.toolchain.push("retrieval_expected_no_sources");
  }
  if (usedRecentContextCache) {
    route.trace.toolchain.push("recent_context_reused");
  }
  if (routePlan.shouldUseWebSearch || usedRecentContextCache) route.trace.toolchain.push("web_search");
  if (routePlan.shouldUseWebSearch || usedRecentContextCache) {
    if (searchProvider === "tavily") {
      route.trace.toolchain.push("search_provider_tavily");
    } else if (searchProvider === "model_fallback") {
      route.trace.toolchain.push("search_provider_model_fallback");
    } else if (searchProvider === "error") {
      route.trace.toolchain.push("search_provider_error");
    }
  }
  if (autoSelectedAgent) route.trace.toolchain.push("agent_auto_selected");
  if (agentSuggestion) route.trace.toolchain.push("agent_suggestion");
  if (userDirectives.detectedModelPhrase && userDirectives.forcedModel) {
    route.trace.toolchain.push("intent_model_request");
  }
  if (userDirectives.orchestrationPhraseDetected) {
    route.trace.toolchain.push("intent_orchestration_request");
  }
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
  if (routePlan.workstreamAssignment.status === "assigned") {
    route.trace.toolchain.push("workstream_assigned");
  } else if (routePlan.workstreamAssignment.status === "suggested") {
    route.trace.toolchain.push("workstream_suggested");
  } else if (routePlan.workstreamAssignment.status === "new_candidate") {
    route.trace.toolchain.push("workstream_new_candidate");
  }
  route.trace.toolchain.push(`thread_${routePlan.threadStrategy.action}`);
  route.trace.routePlan = routePlan;
  if (selectedAgent?._id) {
    (route.trace as { activeAgent?: { id: string; name: string; autoSelected?: boolean } }).activeAgent = {
      id: selectedAgent._id,
      name: selectedAgent.name,
      autoSelected: Boolean(autoSelectedAgent && autoSelectedAgent.id === selectedAgent._id),
    };
  }
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
    modelCatalog: constrainedCatalog,
    spendingTier: budget.tier,
  });

  if (capability.modelSwitched) {
    if (manualLockRequested) {
      const manualVisionPrepassModel = capability.prepassModel
        ?? route.fallbackModels.find((candidate) => {
          const fallbackMeta = constrainedCatalog.find((model) => model.modelId === candidate);
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
    routeTrace: route.trace,
  });

  let imageDescriptionBlock = "";
  if (capability.requiresPrepass && capability.prepassModel && allImageBlocks.length > 0) {
    const visionPrepassStartedAt = Date.now();
    const visionPrepassFallbackModels = Array.from(
      new Set([
        ...route.fallbackModels,
        ...catalog
          .filter((model) => model.modelId !== capability.prepassModel)
          .filter((model) => modelSupportsCapability(model, "vision"))
          .map((model) => model.modelId)
          .slice(0, 3),
      ]),
    ).filter((candidate) => candidate !== capability.prepassModel);
    imageDescriptionBlock = await runVisionPrepass({
      actorClerkId: actor.clerkId,
      chatId,
      imageContentBlocks: allImageBlocks,
      userMessage: auto.message,
      model: capability.prepassModel,
      fallbackModels: visionPrepassFallbackModels,
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
  const searchStatus = routePlan.shouldUseWebSearch || usedRecentContextCache
    ? (searchBlock.trim()
        ? "web search already run; use the provided web context and do not claim browsing is unavailable"
        : "web search allowed for this route but returned no usable results")
    : "web search not enabled for this route";
  const managebacStatus = managebacContext.available
    ? (managebacContext.items.length > 0 ? `available (${managebacContext.items.length} item${managebacContext.items.length === 1 ? "" : "s"})` : "available (no strong match)")
    : managebacRequested
      ? `requested but unavailable (${managebacContext.reason})`
      : "not requested";
  const shouldPlanMemoryRead = memoryEnabled && pipelineController.shouldRun("memoryRead");
  const memoryPlan = shouldPlanMemoryRead
    ? await planMemoryRead({
        actorClerkId: actor.clerkId,
        chatId,
        spendingTier: budget.tier,
        message: auto.message,
        includeTopicMemory: routePlan.shouldConsultMemory && budget.tier !== "free_only",
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
        injectedProfileEntries: [],
        injectedTopicEntries: [],
        surfacedTopicEntries: [],
        retrievedTopicEntries: [],
      };
  if (shouldPlanMemoryRead) {
    pipelineController.markStageCompleted("memoryRead");
  } else if (!memoryEnabled) {
    pipelineController.markStageSkipped("memoryRead", "Memory disabled by user preference.");
  }

  let workstreamMemoryMatches: Array<{
    _id: string;
    key: string;
    text: string;
    category: string;
    confidence: number;
    freshness: number;
    score: number;
    lexicalScore?: number;
    sourceChatId?: string;
    sourceMessageId?: string;
    sourceArtifactId?: string;
    fusedScore: number;
  }> = [];
  let workstreamMemoryEmbeddingModel: string | undefined;
  if (
    routePlan.assignmentLevel === "L4"
    && activeWorkstreamId
    && budget.tier !== "free_only"
  ) {
    try {
      const workstreamEmbedding = retrieval.queryEmbedding
        ? {
            embedding: retrieval.queryEmbedding,
            model: (retrieval.diagnostics as { embeddingModel?: string } | undefined)?.embeddingModel,
          }
        : await (async () => {
            const startedAt = Date.now();
            const embedding = await openRouterEmbeddingRequest(auto.message.slice(0, 3000), "openai/text-embedding-3-small");
            workstreamMemoryEmbeddingModel = embedding.model;
            appendSubcall({
              phaseId: "ws_memory",
              label: "Workstream memory embedding",
              endpoint: "embeddings",
              status: "ok",
              modelUsed: embedding.model,
              inputTokens: embedding.usage?.prompt_tokens,
              outputTokens: embedding.usage?.completion_tokens,
              costCents: costCentsFromUsage(embedding.usage),
              durationMs: Date.now() - startedAt,
            });
            return embedding;
          })();
      workstreamMemoryMatches = (await convexAction("workstreamMemory:retrieveRelevantForPrompt", {
        actorClerkId: actor.clerkId,
        workstreamId: activeWorkstreamId,
        embedding: workstreamEmbedding.embedding,
        message: auto.message,
        topK: 6,
        minScore: 0.34,
      }).catch(() => [])) as typeof workstreamMemoryMatches;
      if (workstreamMemoryMatches.some((entry) => entry.confidence >= 0.5 && entry.freshness >= 0.2)) {
        route.trace.toolchain.push("workstream_memory_injection");
      }
    } catch {
      workstreamMemoryMatches = [];
    }
  }

  const injectedWorkstreamMemory = workstreamMemoryMatches
    .filter((entry) => entry.confidence >= 0.5 && entry.freshness >= 0.2)
    .slice(0, 3);
  const surfacedWorkstreamMemory = workstreamMemoryMatches
    .filter((entry) => !injectedWorkstreamMemory.some((candidate) => candidate._id === entry._id))
    .slice(0, 4)
    .map((entry) => ({
      ...entry,
      reason:
        entry.confidence < 0.5
          ? "low_confidence" as const
          : entry.freshness < 0.2
            ? "low_freshness" as const
            : "not_in_top_matches" as const,
    }));
  if (surfacedWorkstreamMemory.length > 0) {
    route.trace.toolchain.push("workstream_memory_surfaced");
  }

  const workstreamPlannerSummary = activeWorkstreamId
    ? (Array.isArray(activeWorkstreamPlannerItems)
        ? activeWorkstreamPlannerItems
            .filter((item) => String((item as { status?: unknown }).status ?? "pending") !== "completed")
            .slice()
            .sort((a, b) => {
              const dueA = typeof (a as { dueAt?: unknown }).dueAt === "number" ? Number((a as { dueAt?: unknown }).dueAt) : Number.MAX_SAFE_INTEGER;
              const dueB = typeof (b as { dueAt?: unknown }).dueAt === "number" ? Number((b as { dueAt?: unknown }).dueAt) : Number.MAX_SAFE_INTEGER;
              return dueA - dueB;
            })
            .slice(0, 3)
            .map((item) => {
              const title = String((item as { title?: unknown }).title ?? "Untitled");
              const type = String((item as { type?: unknown }).type ?? "item");
              const dueAt = typeof (item as { dueAt?: unknown }).dueAt === "number" ? Number((item as { dueAt?: unknown }).dueAt) : undefined;
              const dueLabel = dueAt ? new Date(dueAt).toISOString().slice(0, 10) : "no due date";
              return `- ${title} (${type}; due ${dueLabel})`;
            })
            .join("\n")
        : "")
    : "";
  const workstreamArtifactSummary = activeWorkstreamId
    ? [
        ...(Array.isArray(activeWorkstreamArtifacts)
          ? activeWorkstreamArtifacts.slice(0, 3).map((artifact) => {
              const title = String((artifact as { title?: unknown }).title ?? "Untitled artifact");
              const type = String((artifact as { type?: unknown }).type ?? "artifact");
              return `- ${title} [${type}]`;
            })
          : []),
        ...(Array.isArray(activeWorkstreamNotes)
          ? activeWorkstreamNotes.slice(0, 2).map((note) => `- ${String((note as { title?: unknown }).title ?? "Untitled note")} [note]`)
          : []),
      ].slice(0, 5).join("\n")
    : "";
  const workstreamMemoryBlock = injectedWorkstreamMemory.length > 0
    ? injectedWorkstreamMemory
        .map((entry) => `- ${entry.key}: ${entry.text}`)
        .join("\n")
    : "";

  const memoryStatus = memoryPlan.profileText || injectedWorkstreamMemory.length > 0
    ? `profile ${memoryPlan.layer2Count}, topic ${memoryPlan.layer3Count}, workstream ${injectedWorkstreamMemory.length}`
    : "no relevant memory entries";
  const usedMemory = [
    ...memoryPlan.injectedProfileEntries.map((entry) => ({
      key: entry.key,
      text: entry.text,
      category: entry.category,
    })),
    ...memoryPlan.injectedTopicEntries.map((entry) => ({
      key: entry.key,
      text: entry.text,
      category: entry.category,
    })),
    ...injectedWorkstreamMemory.map((entry) => ({
      key: entry.key,
      text: entry.text,
      category: "topic" as const,
    })),
  ].slice(0, 8);
  if (usedMemory.length > 0) {
    (route.trace as { usedMemory?: typeof usedMemory }).usedMemory = usedMemory;
  }
  const relatedMemory = [
    ...memoryPlan.surfacedTopicEntries.map((entry) => ({
      id: entry._id,
      source: "personal" as const,
      key: entry.key,
      text: entry.text,
      category: entry.category,
      confidence: entry.confidence,
      freshness: entry.freshness,
      reason: entry.reason,
    })),
    ...surfacedWorkstreamMemory.map((entry) => ({
      id: entry._id,
      source: "workstream" as const,
      key: entry.key,
      text: entry.text,
      category: entry.category,
      confidence: entry.confidence,
      freshness: entry.freshness,
      reason: entry.reason,
    })),
  ].slice(0, 6);
  if (relatedMemory.length > 0) {
    (route.trace as { relatedMemory?: typeof relatedMemory }).relatedMemory = relatedMemory;
  }
  const directiveStatus = directiveMemorySummary.forgotten > 0
    || directiveMemorySummary.negativeLinks > 0
    || directiveMemorySummary.written > 0
    ? `forget=${directiveMemorySummary.forgotten}, blockedLinks=${directiveMemorySummary.negativeLinks}, explicitWrites=${directiveMemorySummary.written}`
    : "none";
  const learningContextPrompt = formatLearningContextForPrompt(storedLearningContext);
  const managebacContextBlock = managebacContext.sourceBlock;
  const groundedSourceTitles = Array.from(new Set([
    ...retrieval.citations.map((citation) => citation.filename).filter((value): value is string => Boolean(value)),
    ...searchSources.map((source) => source.title).filter((value): value is string => Boolean(value)),
    ...attachments.prepared.map((attachment) => attachment.filename).filter((value): value is string => Boolean(value)),
  ])).slice(0, 8);
  const sourceGroundingRequired = Boolean(
    body.attachmentResourceIds?.length
    || ((effectiveMode === "document" || effectiveMode === "flashcard" || effectiveMode === "quiz" || effectiveMode === "exam")
      && (retrieval.citations.length > 0 || attachments.prepared.length > 0)),
  );
  const modeTransformGuidance = buildModeTransformGuidance({
    mode: effectiveMode,
    message: normalizedMessage,
    learningContext: storedLearningContext,
    existingFlashcardFronts: latestDeck?.cards.map((card) => card.front) ?? [],
    sourceTitles: groundedSourceTitles,
    sourceRequired: sourceGroundingRequired,
  });
  const learningContextStatus = storedLearningContext
    ? `topics=${storedLearningContext.topics.length}, facts=${storedLearningContext.keyFacts.length}, cards=${storedLearningContext.flashcardCandidates.length}`
    : "none";
  const shouldRunClarificationCheck = pipelineController.shouldRun("clarificationCheck");
  let clarificationDecision = shouldRunClarificationCheck
    ? needsClarification({
        requestClass: auto.requestClass,
        mode: effectiveMode,
        message: normalizedMessage,
        userDirectives,
        lastAssistantWasClarification,
      })
    : null;
  if (shouldRunClarificationCheck) {
    pipelineController.markStageCompleted("clarificationCheck");
  }
  if (clarificationDecision?.block) {
    const promptAwareClarification = await generatePromptAwareClarification({
      mode: effectiveMode,
      reason: clarificationDecision.reason,
      message: normalizedMessage,
      fallbackBlock: clarificationDecision.block,
      onModelCall: (call) => {
        appendSubcall({
          phaseId: "clarificationCheck",
          label: "Prompt-aware clarification generation",
          endpoint: "chat.completions",
          status: "ok",
          modelUsed: call.model,
          inputTokens: call.usage?.prompt_tokens,
          outputTokens: call.usage?.completion_tokens,
          costCents: costCentsFromUsage(call.usage),
          durationMs: call.durationMs,
        });
        void recordOpenRouterUsage({
          actorClerkId: actor.clerkId,
          chatId,
          model: call.model,
          usage: call.usage,
          pricing: resolveCatalogPricing(call.model),
        }).catch(() => {});
      },
    }).catch((error) => {
      logger.warn("prompt-aware clarification generation failed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });

    if (promptAwareClarification?.block) {
      clarificationDecision = {
        ...clarificationDecision,
        block: promptAwareClarification.block,
      };
      route.trace.toolchain.push("clarification_prompt_aware");
    } else {
      route.trace.toolchain.push("clarification_prompt_aware_fallback");
    }
  }
  const clarificationBlock = clarificationDecision?.block ?? null;
  const clarificationText = clarificationBlock ? formatClarificationAsText(clarificationBlock) : null;
  if (clarificationBlock) {
    route.trace.toolchain.push("clarification_interrupt");
    (route.trace as { clarificationBlock?: ClarificationBlock }).clarificationBlock = clarificationBlock;
  } else if (shouldRunClarificationCheck) {
    route.trace.toolchain.push("clarification_not_needed");
  }
  if (
    clarificationBlock
    && (auto.requestClass === "T2" || auto.requestClass === "T3")
    && (retrieval.citations.length > 0 || searchSources.length > 0 || searchBlock.trim().length > 0)
  ) {
    const recentContextSnapshot = buildRecentContextSnapshot({
      requestClass: auto.requestClass,
      mode: effectiveMode,
      retrieval: {
        citations: retrieval.citations,
        sourceBlock: retrieval.sourceBlock,
        diagnostics: retrieval.diagnostics
          ? {
              scopesAttempted: retrieval.diagnostics.scopesAttempted,
              status: retrieval.diagnostics.status,
              reason: retrieval.diagnostics.reason,
              embeddingModel: retrieval.diagnostics.embeddingModel,
            }
          : undefined,
      },
      search: {
        text: searchBlock,
        urls: searchUrls,
        sources: searchSources,
        provider: searchProvider,
      },
      clarification: clarificationBlock,
    });
    await convexMutation("chats:setRecentContext", {
      actorClerkId: actor.clerkId,
      chatId,
      recentContext: serializeRecentContext(recentContextSnapshot),
      recentContextAt: recentContextSnapshot.createdAt,
    }).catch(() => {});
    route.trace.toolchain.push("recent_context_cached");
  }

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
    `ManageBac: ${managebacStatus}`,
    `Workstream routing: ${routePlan.workstreamAssignment.status}${routePlan.workstreamAssignment.title ? ` (${routePlan.workstreamAssignment.title})` : ""}`,
    `Thread strategy: ${routePlan.threadStrategy.action}`,
    `Context strategy: target ${routePlan.contextWindowStrategy.desiredContextTokens.toLocaleString()} tok, pressure ${(routePlan.contextWindowStrategy.contextWindowPressure * 100).toFixed(0)}%`,
    `Memory directives applied: ${directiveStatus}`,
    `Learning context: ${learningContextStatus}`,
  ].join("\n");
  const openRouterTools = getOpenRouterToolsForAssignmentLevel(routePlan.assignmentLevel)
    .filter((tool) => routePlan.allowedAiTools.includes(tool.function.name as typeof routePlan.allowedAiTools[number]));
  const toolUsageGuidance = formatToolUsageGuidance(routePlan.allowedAiTools);
  const capabilityContract = buildCapabilityContract({
    toolNames: routePlan.allowedAiTools,
    recursiveExecutionAllowed: routePlan.allowSubAgents,
    allowConversationForking: routePlan.threadStrategy.action === "fork" || routePlan.assignmentLevel === "L4",
    availableSkills: runtimeSkills.map((skill) => skill.id),
    availableSurfaces: ["chat", activeWorkstream ? "workspace" : undefined, body.artifactId ? "artifact" : undefined, body.packId ? "pack" : undefined, managebacContext.available ? "managebac" : undefined].filter((value): value is string => Boolean(value)),
    activeMode: effectiveMode,
    assignmentLevel: routePlan.assignmentLevel,
    allowedToolBundles: routePlan.allowedToolBundles,
    retrievalScopes: [...routePlan.retrievalScopes, ...(managebacContext.available ? ["managebac"] : [])],
    availableAgents: classifierAvailableAgents.slice(0, 5).map((agent) => ({ id: agent._id, name: agent.name })),
    activeAgent: selectedAgent ? { id: selectedAgent._id, name: selectedAgent.name } : null,
    sourceGrounding: {
      attachmentIds: body.attachmentResourceIds ?? [],
      attachmentRequirement: (body.attachmentResourceIds?.length ?? 0) > 0 && ["document", "flashcard", "quiz", "exam"].includes(effectiveMode) ? "required" : (body.attachmentResourceIds?.length ?? 0) > 0 ? "preferred" : "not_applicable",
      sourceKinds: Array.from(new Set([
        ...(retrieval.citations.length > 0 ? ["retrieval"] : []),
        ...(searchSources.length > 0 ? ["search"] : []),
        ...(managebacContext.available ? ["managebac"] : []),
        ...((body.attachmentResourceIds?.length ?? 0) > 0 ? ["attachment"] : []),
      ])),
    },
  });
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

  const systemPromptTier = auto.requestClass === "T3"
    ? "T3"
    : auto.requestClass === "T2"
      ? "T2"
      : auto.requestClass === "T1"
        ? "T1"
        : "T0";
  const includeRuntimeContextBlocks = systemPromptTier !== "T0";
  const includeRichContextBlocks = systemPromptTier === "T2" || systemPromptTier === "T3";
  const includeFullContextBlocks = systemPromptTier === "T3";

  const systemPromptParts = [buildSystemPrompt({
    mode: effectiveMode,
    strictness: "medium",
    promptTier: systemPromptTier,
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
  if (effectiveMode === "research") {
    systemPromptParts.push(
      `=== RESEARCH OUTPUT CONTRACT ===
Return the response in this exact section order:
## Findings
- Provide evidence-backed findings.
- For non-trivial claims, add compact inline citations like [1], [2], or [1][3].

## Source Reliability
- Briefly assess reliability per key source (high / medium / low) with one short reason.
- Prefer institutional, academic, and primary reporting sources when available.

## Conclusion
- Give a direct conclusion tied to the strongest cited evidence.
- Explicitly note uncertainty when evidence is mixed or weak.

## Further Questions
- Add 2-4 specific follow-up questions worth researching next.

Rules:
- Keep citations inline and compact; avoid verbose footnote prose.
- Do not invent sources or source details.
- If evidence is insufficient, say so clearly and narrow the claim scope.
=== END RESEARCH OUTPUT CONTRACT ===`,
    );
    route.trace.toolchain.push("research_output_contract");
  }

  if (includeRuntimeContextBlocks) {
    systemPromptParts.push(`=== RUNTIME CONTEXT ===\n${runtimeContextBlock}\n=== END RUNTIME CONTEXT ===`);
  }
  if (includeRuntimeContextBlocks && learningContextPrompt) {
    systemPromptParts.push(`=== LEARNING CONTEXT ===\n${learningContextPrompt}\n=== END LEARNING CONTEXT ===`);
  }
  if (includeRichContextBlocks && routePlan.assignmentLevel === "L4" && activeWorkstream) {
    systemPromptParts.push(
      `=== WORKSTREAM CONTEXT ===
Workstream: ${String((activeWorkstream as { title?: unknown }).title ?? "Workspace")}
Description: ${typeof (activeWorkstream as { description?: unknown }).description === "string" ? String((activeWorkstream as { description?: unknown }).description) : "No description"}
Routing reason: ${routePlan.workstreamAssignment.reason}
Thread action: ${routePlan.threadStrategy.action} (${routePlan.threadStrategy.reason})
Planner priorities:
${workstreamPlannerSummary || "- No pending planner items"}
Recent durable items:
${workstreamArtifactSummary || "- No notes or artifacts yet"}
Workstream memory:
${workstreamMemoryBlock || "- No high-confidence workstream memory matched"}
=== END WORKSTREAM CONTEXT ===`,
    );
  }
  if (includeRuntimeContextBlocks && modeTransformGuidance) {
    systemPromptParts.push(`=== MODE TRANSFORM GUIDANCE ===\n${modeTransformGuidance}\n=== END MODE TRANSFORM GUIDANCE ===`);
  }
  if (includeRichContextBlocks) {
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
Web search bundle: ${routePlan.shouldUseWebSearch || usedRecentContextCache ? "enabled" : "disabled"}.
Retrieved school resources: ${retrieval.citations.length > 0 ? `${retrieval.citations.length} source(s) available` : routePlan.retrievalScopes.length > 0 ? "enabled but no high-confidence sources found" : "disabled"}.
Memory bundle: ${useMemoryProfile ? "layered memory injected (global + topic-aware)" : memoryEnabled ? "enabled but no relevant memory injected" : "disabled"}.
Multi-agent collaboration: ${routePlan.allowSubAgents ? "allowed only if the route earns it" : "disabled"}.
If web search is enabled, use the provided search briefing and sources instead of claiming you lack web access.
If retrieval is enabled, ground claims in the provided classroom sources instead of saying files are unavailable.
If sources exist, cite them inline where useful and finish with a compact sources section.
Do not invent tool calls that were not actually run.
=== END ROUTE PRIMITIVES ===`,
    );
  }
  if (includeFullContextBlocks) {
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
Preferred mode: ${routePlan.agentContract.preferredMode ?? "none"}
Preferred model: ${routePlan.agentContract.preferredModel ?? "none"}
Allowed tools: ${routePlan.agentContract.allowedTools?.join(", ") || "all route-approved"}
Model allowlist: ${routePlan.agentContract.modelAllowlist?.join(", ") || "none"}
Model denylist: ${routePlan.agentContract.modelDenylist?.join(", ") || "none"}
Linked to active workstream: ${routePlan.agentContract.activeWorkstreamLinked ? "yes" : "no"}
Knowledge signals: ${routePlan.agentContract.knowledgeSignals?.join(" | ") || "none"}
Summary: ${routePlan.agentContract.promptSummary ?? "none"}
Prompt guidance:
${routePlan.agentContract.promptGuidance ?? "none"}
=== END AGENT CONTRACT ===`,
      );
    }
    systemPromptParts.push(
      `=== TOOL EXECUTION CONTEXT ===
Route-approved bundles: ${routePlan.allowedToolBundles.join(", ") || "none"}
Search route enabled: ${routePlan.shouldUseWebSearch || usedRecentContextCache ? "yes" : "no"}
Retrieval scopes enabled: ${routePlan.retrievalScopes.join(", ") || "none"}
Memory route enabled: ${memoryEnabled ? "yes" : "no"}
Web results provided below: ${searchSources.length > 0 ? "yes" : "no"}
Retrieved classroom/personal sources provided below: ${retrieval.citations.length > 0 ? "yes" : "no"}
If a route-approved capability returned no results, say that no usable results were found.
Do not claim you lack a supported tool when search, retrieval, or memory context is already provided in this prompt.
=== END TOOL EXECUTION CONTEXT ===`,
    );
    if (toolUsageGuidance) {
      systemPromptParts.push(toolUsageGuidance);
    }
    systemPromptParts.push(capabilityContract);
  }
  if (includeRichContextBlocks && featureEnabled(orgSettings.org?.soulEnabled) && schoolSoulCapsule.capsule.trim()) {
    systemPromptParts.push(
      `=== SCHOOL SOUL ${schoolSoulCapsule.version} ===\n${schoolSoulCapsule.capsule}\n=== END SCHOOL SOUL ===`,
    );
  }

  if (includeRichContextBlocks && attachments.quickExtractBlock) {
    systemPromptParts.push(attachments.quickExtractBlock);
  }
  if (includeRichContextBlocks && researchEvidenceBlock) {
    systemPromptParts.push(researchEvidenceBlock);
  }
  if (includeRichContextBlocks && managebacContextBlock) {
    systemPromptParts.push(managebacContextBlock);
    route.trace.toolchain.push("managebac_context");
  }
  if (includeRichContextBlocks && imageDescriptionBlock) {
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
  route.trace.usageBudgetRemaining = gatedPipelineSnapshot.usageBudgetRemaining;

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
    conversationTurnCount: history.length,
    recentModels: combinedRecentAssistantModels,
    requestClass: auto.requestClass,
    assignmentLevel: auto.assignmentLevel,
    estimatedInputTokens: routePlan.contextWindowStrategy.estimatedInputTokens,
    estimatedOutputTokens: Math.max(640, Math.round(routePlan.contextWindowStrategy.estimatedOutputTokens * 0.7)),
    desiredContextTokens: routePlan.contextWindowStrategy.minimumContextTokens,
    preferLargeContext: routePlan.contextWindowStrategy.preferLargeContext,
    cacheWindow,
    manualModelConfirmedExpensive: Boolean(body.confirmExpensiveModel),
    modelCatalog: constrainedCatalog,
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
    conversationTurnCount: history.length,
    recentModels: combinedRecentAssistantModels,
    requestClass: auto.requestClass,
    assignmentLevel: auto.assignmentLevel,
    estimatedInputTokens: routePlan.contextWindowStrategy.estimatedInputTokens,
    estimatedOutputTokens: routePlan.contextWindowStrategy.estimatedOutputTokens,
    desiredContextTokens: routePlan.contextWindowStrategy.desiredContextTokens,
    preferLargeContext: routePlan.contextWindowStrategy.preferLargeContext,
    cacheWindow,
    manualModelConfirmedExpensive: Boolean(body.confirmExpensiveModel),
    modelCatalog: constrainedCatalog,
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
  const inputContextChars = {
    systemChars: systemPromptParts.join("\n\n").length,
    historyChars: historyForModel.reduce((sum, item) => sum + (item.content?.length ?? 0), 0),
    memoryChars:
      (memoryPlan.profileText?.length ?? 0)
      + (memoryPlan.layer2Text?.length ?? 0)
      + (memoryPlan.layer3Text?.length ?? 0)
      + (personalSoulExcerpt?.length ?? 0)
      + (workstreamMemoryBlock?.length ?? 0),
    sourceChars:
      (retrieval.sourceBlock?.length ?? 0)
      + (searchBlock?.length ?? 0)
      + (researchEvidenceBlock?.length ?? 0)
      + (workstreamPlannerSummary?.length ?? 0)
      + (workstreamArtifactSummary?.length ?? 0),
  };
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
      conversationTurnCount: history.length,
      recentModels: combinedRecentAssistantModels,
      requestClass: auto.requestClass,
      assignmentLevel: auto.assignmentLevel,
      estimatedInputTokens: routePlan.contextWindowStrategy.estimatedInputTokens,
      estimatedOutputTokens: Math.max(512, Math.round(routePlan.contextWindowStrategy.estimatedOutputTokens * 0.65)),
      desiredContextTokens: routePlan.contextWindowStrategy.minimumContextTokens,
      preferLargeContext: routePlan.contextWindowStrategy.preferLargeContext,
      cacheWindow,
      manualModelConfirmedExpensive: Boolean(body.confirmExpensiveModel),
      modelCatalog: constrainedCatalog,
      modelRuntimeStats: runtimeStatMap,
      seedKey: `${chatId}:${normalizedMessage}:verification`,
    });
    route.verificationModel = verificationDecision.selectedModel;
  }
  route.trace.phasePlan = buildPhasePlan({
    routeNeedsWorkstreamMemory: routePlan.assignmentLevel === "L4" && workstreamMemoryMatches.length > 0,
    routeNeedsWorkstreamArtifacts: routePlan.assignmentLevel === "L4" && Boolean(workstreamPlannerSummary || workstreamArtifactSummary),
    routeNeedsRetrieval: retrieval.citations.length > 0 || routePlan.retrievalScopes.length > 0,
    routeNeedsSearch: routePlan.shouldUseWebSearch || usedRecentContextCache,
    multiAgentEnabled,
    shouldVerify,
    shouldRepair: effectiveMode === "quiz" || effectiveMode === "flashcard",
    shouldWriteMemory: routePlan.shouldWriteMemory,
    shouldGenerateTitle: shouldGenerateTitle,
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
    if (phase.id === "ws_memory") return { ...phase, model: workstreamMemoryEmbeddingModel ?? retrieval.diagnostics?.embeddingModel };
    if (phase.id === "retrieval") return { ...phase, model: retrieval.diagnostics?.embeddingModel };
    if (phase.id === "search") return { ...phase, model: webResult.modelUsed };
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
  if (route.trace.phasePlan?.some((phase) => phase.id === "ws_memory")) {
    queuePhaseUpdate(
      "ws_memory",
      injectedWorkstreamMemory.length > 0 ? "completed" : "skipped",
      injectedWorkstreamMemory.length > 0
        ? `Injected ${injectedWorkstreamMemory.length} scoped workstream memory entr${injectedWorkstreamMemory.length === 1 ? "y" : "ies"}.`
        : surfacedWorkstreamMemory.length > 0
          ? "Matched workstream memory was surfaced but not auto-injected."
          : "No matching workstream memory.",
    );
  }
  if (route.trace.phasePlan?.some((phase) => phase.id === "ws_artifacts")) {
    queuePhaseUpdate(
      "ws_artifacts",
      workstreamPlannerSummary || workstreamArtifactSummary ? "completed" : "skipped",
      workstreamPlannerSummary || workstreamArtifactSummary
        ? "Planner and artifact workspace context injected."
        : "No planner or artifact context available.",
    );
  }
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
    if (!routePlan.shouldUseWebSearch && !usedRecentContextCache) {
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
  const baseBudgetAwareMaxTokens =
    routePlan.responseBudget === "simple"
      ? Math.min(modeMaxTokens, 900)
      : routePlan.responseBudget === "normal"
        ? Math.min(modeMaxTokens, effectiveMode === "research" || effectiveMode === "document" ? 2400 : 1800)
        : modeMaxTokens;
  const assignmentOverflowSlack =
    routePlan.assignmentLevel === "L4"
      ? 384
      : routePlan.assignmentLevel === "L3"
        ? 256
        : routePlan.assignmentLevel === "L2"
          ? 160
          : routePlan.assignmentLevel === "L1"
            ? 96
            : 64;
  const softOutputFloor = routePlan.contextWindowStrategy.estimatedOutputTokens + assignmentOverflowSlack;
  const budgetAwareMaxTokens = Math.max(
    baseBudgetAwareMaxTokens,
    Math.min(modeMaxTokens + assignmentOverflowSlack, softOutputFloor),
  );
  const primaryCatalogEntry =
    catalog.find((model) => model.modelId === route.primaryModel)
    ?? catalog.find((model) => model.modelId.replace(/:free$/i, "") === route.primaryModel.replace(/:free$/i, ""));
  const estimatedInputTokens = Math.ceil(
    (
      inputContextChars.systemChars
      + inputContextChars.historyChars
      + inputContextChars.memoryChars
      + inputContextChars.sourceChars
    ) / 4,
  );
  const modelContextAwareCap =
    typeof primaryCatalogEntry?.contextLength === "number" && Number.isFinite(primaryCatalogEntry.contextLength) && primaryCatalogEntry.contextLength > 0
      ? Math.max(256, Math.floor(primaryCatalogEntry.contextLength - estimatedInputTokens - 1024))
      : undefined;
  const contextAwareMaxTokens =
    typeof modelContextAwareCap === "number"
      ? Math.max(256, Math.min(budgetAwareMaxTokens, modelContextAwareCap))
      : budgetAwareMaxTokens;
  if (typeof modelContextAwareCap === "number" && modelContextAwareCap < budgetAwareMaxTokens) {
    route.trace.toolchain.push("context_window_token_cap");
  }
  if (routePlan.contextWindowStrategy.compactionSuggested) {
    route.trace.toolchain.push("context_window_pressure");
  }
  const maxTokens = isVagueRequest
    ? Math.min(512, contextAwareMaxTokens)
    : contextAwareMaxTokens;
  const maxContinuations =
    routePlan.assignmentLevel === "L4"
      ? 4
      : routePlan.assignmentLevel === "L3"
        ? 3
        : routePlan.responseBudget === "simple"
          ? 0
          : routePlan.responseBudget === "normal"
            ? 1
            : 2;
  const earlyTitlePromise = shouldGenerateTitle
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

      if (clarificationBlock && clarificationText) {
        await send({
          type: "phase_update",
          phaseId: "clarificationCheck",
          status: "in_progress",
          detail: "Checking whether additional scope details are needed.",
        });
        await send({
          type: "phase_update",
          phaseId: "clarificationCheck",
          status: "completed",
          detail: clarificationDecision?.reason ?? "Clarification required before generation.",
        });

        pipelineController.markStageSkipped("generation", "Clarification required before response generation.");
        pipelineController.markStageSkipped("postProcess", "Waiting for user clarification before post-processing.");
        route.trace.phasePlan = (route.trace.phasePlan ?? []).map((phase) => {
          if (phase.status === "completed" || phase.status === "skipped" || phase.status === "failed") {
            return phase;
          }
          return {
            ...phase,
            status: "skipped",
            detail: phase.detail ?? "Deferred until clarification answers are provided.",
          };
        });
        const clarificationSnapshot = pipelineController.getState();
        route.trace.stepsExecuted = clarificationSnapshot.completedStages;
        route.trace.stepsSkipped = clarificationSnapshot.skippedStages.map((row) => ({
          step: row.step,
          reason: row.reason,
        }));
        route.trace.totalDurationMs = Date.now() - requestStartedAt;

        const appended = await appendAssistantMessageWithCitationFallback({
          actorClerkId: actor.clerkId,
          chatId,
          parentMessageId: currentTurnParentMessageId,
          content: clarificationText,
          mode: effectiveMode,
          citations: [],
          modelRequested: undefined,
          modelUsed: undefined,
          whyThisResponse: "Additional clarification required before executing the full workflow.",
          usageIn: undefined,
          usageOut: undefined,
          verificationPassed: undefined,
          thinkingContent: undefined,
          routeTrace: route.trace,
        });
        assistantPersisted = true;


        await send({
          type: "done",
          content: clarificationText,
          chatId,
          userMessageId: resolvedUserMessageId,
          messageId: appended.messageId,
          modelUsed: undefined,
          modelRequested: route.primaryModel,
          whyThisResponse: "Clarification requested before executing the expensive stages.",
          citations: [],
          routeTrace: route.trace,
          finishReason: undefined,
          autoResult: {
            modelUsed: undefined,
            searchEnabled: route.searchEnabled || routePlan.shouldUseWebSearch || usedRecentContextCache,
            thinkingLevel: effectiveThinkingLevel,
            promptEnhanced: auto.promptEnhanced,
          },
          enhancedPrompt: auto.promptEnhanced ? auto.message : undefined,
          effectiveMode,
          suggestedMode: effectiveMode !== safeMode ? effectiveMode : undefined,
          userSelectedMode: safeMode,
          agentSuggestion,
        });
        return;
      }

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
        const requestedImageModel = body.imageModel
          && canUseInTier(body.imageModel, budget.tier, catalog)
          && modelSupportsCapability(
            catalog.find((model) => model.modelId === body.imageModel) ?? { modelId: body.imageModel },
            "image_generation",
          )
          ? body.imageModel
          : undefined;
        const selectedImageModel = requestedImageModel || imageModelSelection.selected?.modelId;
        if (!selectedImageModel) {
          throw new Error("No image-generation model is available in the current budget tier.");
        }
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
            route.trace.fallbacks.push(event);
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
        if (modelUsed && route.trace.selected.modelId !== modelUsed) {
          route.trace.selected = {
            modelId: modelUsed,
            reason: `${route.trace.selected.reason} Final generation used ${modelUsed}.`,
          };
          route.trace.toolchain.push("final_model_reconciled");
        }
        const usageIn = imageResult.usage?.prompt_tokens ?? 0;
        const usageOut = imageResult.usage?.completion_tokens ?? 0;
        const imageSubcallTotals = subcallTokenTotals();
        const finalUsageIn = imageSubcallTotals.input > 0 ? imageSubcallTotals.input : usageIn;
        const finalUsageOut = imageSubcallTotals.output > 0 ? imageSubcallTotals.output : usageOut;
        const citations: Array<{
          filename: string;
          url?: string;
          page?: number;
          sourceType: "pack" | "personal" | "agent" | "general" | "search";
          resourceId?: string;
        }> = [];

        route.trace.toolchain = [...new Set(route.trace.toolchain)];
        if (route.trace.phasePlan?.some((phase) => phase.id === "authoring")) {
          await emitPhaseUpdate("authoring", "completed", "Image generated successfully.");
        }
        pipelineController.markStageCompleted("generation");
        route.trace.totalCostCents = Number(
          ((route.trace.subcalls ?? []).reduce((sum, call) => sum + (call.costCents ?? 0), 0)).toFixed(4),
        );
        route.trace.totalDurationMs = Date.now() - requestStartedAt;

        const appended = await appendAssistantMessageWithCitationFallback({
          actorClerkId: actor.clerkId,
          chatId,
          parentMessageId: currentTurnParentMessageId,
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
            hasCitations?: boolean;
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
          hasCitations: citations.length > 0,
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
        route.trace.totalCostCents = Number(
          ((route.trace.subcalls ?? []).reduce((sum, call) => sum + (call.costCents ?? 0), 0)).toFixed(4),
        );
        route.trace.totalDurationMs = Date.now() - requestStartedAt;

        await send({
          type: "done",
          content: finalizedResponse,
          chatId,
          userMessageId: resolvedUserMessageId,
          messageId: appended.messageId,
          modelUsed,
          modelRequested,
          usageIn: finalUsageIn,
          usageOut: finalUsageOut,
          whyThisResponse,
          citations,
          verificationPassed: undefined,
          thinkingContent: undefined,
          finishReason: undefined,
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
                  autoSelected: Boolean(autoSelectedAgent && autoSelectedAgent.id === selectedAgent._id),
                }
              : undefined,
        });
        return;
      }

      const fallbackModels = manualLockRequested ? [] : route.fallbackModels;
      const onFallback = (event: { fromModel: string; toModel: string; error: string; attemptIndex: number }) => {
        route.trace.fallbacks.push(event);
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
      const consumeUsageTokens = (tokens: number) => {
        const remaining = pipelineController.consumeUsageTokens(tokens);
        route.trace.usageBudgetRemaining = remaining;
      };
      const usageBudgetState = pipelineController.getState();
      const executeAssistantTool = async (tool: { name: string; rawArguments: string }) =>
        executeOrchestratorTool({
          name: tool.name as typeof routePlan.allowedAiTools[number],
          rawArguments: tool.rawArguments,
          context: {
            actorClerkId: actor.clerkId,
            chatId,
            activeWorkstreamId,
            artifactId: body.artifactId,
            mode: effectiveMode,
            spendingTier: budget.tier,
            onModelCall: (call) => {
              appendSubcall({
                phaseId: "analysis",
                label: `Tool helper model: ${tool.name}`,
                endpoint: "embeddings",
                status: "ok",
                modelUsed: call.model,
                inputTokens: call.usage?.prompt_tokens,
                outputTokens: call.usage?.completion_tokens,
                costCents: costCentsFromUsage(call.usage),
                durationMs: call.durationMs,
              });
            },
          },
        });

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
            thinkingLevel: effectiveThinkingLevel,
            maxTokens,
            maxContinuations: Math.max(maxContinuations, routePlan.responseBudget === "deep" ? 4 : 2),
            maxSubcalls: collabLimits.maxSubcalls,
            maxTokensPerSpecialist: collabLimits.maxTokensPerSpecialist,
            maxWallTimeMs: collabLimits.maxWallTimeMs,
            usageBudgetTokens: usageBudgetState.usageBudgetRemaining,
            budgetOverrunFactor: 1.5,
            send,
            onUsageTokens: consumeUsageTokens,
            onFallback,
            logger,
          })
        : await runAssistantStreaming({
            actorClerkId: actor.clerkId,
            chatId,
            shouldVerify,
            thinkingLevel: effectiveThinkingLevel,
            primaryModel,
            fallbackModels,
            verificationModel: route.verificationModel,
            messages,
            maxTokens,
            maxContinuations: Math.max(maxContinuations, routePlan.responseBudget === "deep" ? 4 : 2),
            maxToolRounds:
              routePlan.executionPath === "single_action"
                ? 2
                : routePlan.executionPath === "action_loop"
                  ? 4
                  : routePlan.executionPath === "research_workflow"
                    ? 5
                    : 1,
            executionPath: routePlan.executionPath ?? "direct_chat",
            send,
            onUsageTokens: consumeUsageTokens,
            onFallback,
            tools: openRouterTools,
            executeTool: executeAssistantTool,
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
      const finishReason = streamed.finishReason;
      const truncatedByLength = streamed.truncatedByLength;
      const continuationCount = streamed.continuationCount;
      const verificationPassed = streamed.verificationPassed;
      const thinkingContent = streamed.thinkingContent;
      const modelRequested = primaryModel;
      if (modelUsed && route.trace.selected.modelId !== modelUsed) {
        route.trace.selected = {
          modelId: modelUsed,
          reason: `${route.trace.selected.reason} Final generation used ${modelUsed}.`,
        };
        route.trace.toolchain.push("final_model_reconciled");
      }
      if (continuationCount > 0) {
        route.trace.toolchain.push("length_auto_continue");
      }
      if (truncatedByLength && continuationCount >= 2 && finishReason === "length") {
        route.trace.toolchain.push("length_cap_reached");
      }
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
        route.trace.collaborators = streamed.collaborators;
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
      // Strip any internal policy/correction notices the model may have leaked into the response.
      // These patterns must never appear in user-facing output.
      let correctedResponse = responseText
        // Remove entire lines starting with these prefixes (all occurrences)
        .replace(/^Policy correction:.*$/gim, "")
        .replace(/^Content policy:.*$/gim, "")
        .replace(/^Note:\s*This response.*?(?:\n|$)/gim, "")
        .replace(/^Important note:\s*As a school.*?(?:\n|$)/gim, "")
        // Remove inline occurrences mid-text (e.g. [...policy correction...])
        .replace(/\[?policy correction[:\]].*/gi, "")
        .replace(/\[?content policy[:\]].*/gi, "")
        // Collapse runs of 3+ blank lines down to 2 after stripping
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (!policyPass) {
        if (effectiveMode === "quiz" || effectiveMode === "flashcard") {
          route.trace.toolchain.push("structure_policy_guard");
        }
        // No visible policy notice appended — policy checks are internal only
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

      const visualArtifact = extractVisualArtifactFromResponse({
        response: correctedResponse,
        effectiveMode,
        routePlan,
        runtimeSkills,
      });
      let citations = inferCitations(
        correctedResponse,
        retrieval.citations,
        searchSources,
        attachmentCitations,
      );
      const shouldEnforceGroundedTransform =
        sourceGroundingRequired
        && ["document", "flashcard", "quiz", "exam", "research"].includes(effectiveMode);
      const groundedSourceLower = groundedSourceTitles.map((title) => title.toLowerCase());
      const responseMentionsGroundedSource = groundedSourceLower.length === 0
        ? false
        : groundedSourceLower.some((title) => correctedResponse.toLowerCase().includes(title));
      const hasGroundedCitations = citations.length > 0;
      const groundingLooksWeak =
        shouldEnforceGroundedTransform
        && groundedSourceTitles.length > 0
        && !hasGroundedCitations
        && !responseMentionsGroundedSource;
      const rewrittenResponse = rewriteCitationMarkers(correctedResponse, citations);
      const withInlineMarkers = ensureInlineCitationMarkers(rewrittenResponse, citations);
      // Strip orphan citation markers [N] that have no matching citation.
      let finalizedResponse = stripOrphanCitations(withInlineMarkers, citations);
      if (groundingLooksWeak) {
        if (effectiveMode === "research") {
          finalizedResponse = `${finalizedResponse.trim()}\n\n## Source limits\n- I do not have enough grounded evidence from the provided sources to make stronger claims safely.`;
        } else {
          finalizedResponse = `${finalizedResponse.trim()}\n\nSource grounding note: I kept this limited because the available source evidence was too thin to safely add more unsupported details.`;
        }
        route.trace.toolchain.push("source_grounding_guard");
      }
      let generatedArtifactAttachments: string[] | undefined;
      let generatedArtifactResourceIds: string[] | undefined;
      if (effectiveMode === "document" || isGeneratedDocumentContent(finalizedResponse)) {
        const parsedDocument = parseGeneratedDocument(finalizedResponse);
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
          const userFacingDocumentResponse = parsedDocument.document
            ? parsedDocument.preamble || `Created ${parsedDocument.document.title}.`
            : finalizedResponse;
          finalizedResponse = artifactResult.markdownBlock
            ? `${userFacingDocumentResponse}\n\n${artifactResult.markdownBlock}`
            : userFacingDocumentResponse;
          route.trace.toolchain.push("artifact_generation");
        }
      }
      citations = attachInlinePositionsToCitations(finalizedResponse, citations);
      const whyThisResponse = summarizeWhyResponse(effectiveMode, route.reason);
      const finalSubcallTotals = subcallTokenTotals();
      const finalUsageIn = finalSubcallTotals.input > 0 ? finalSubcallTotals.input : usageIn;
      const finalUsageOut = finalSubcallTotals.output > 0 ? finalSubcallTotals.output : usageOut;
      route.trace.inputTokenBreakdown = allocateInputTokenBreakdown({
        inputTokens: Math.max(0, finalUsageIn),
        systemChars: inputContextChars.systemChars,
        historyChars: inputContextChars.historyChars,
        memoryChars: inputContextChars.memoryChars,
        sourceChars: inputContextChars.sourceChars,
      });
      route.trace.usageBudgetRemaining = pipelineController.getState().usageBudgetRemaining;
      route.trace.totalCostCents = Number(
        ((route.trace.subcalls ?? []).reduce((sum, call) => sum + (call.costCents ?? 0), 0)).toFixed(4),
      );
      route.trace.totalDurationMs = Date.now() - requestStartedAt;
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
        parentMessageId: currentTurnParentMessageId,
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

      if (visualArtifact && activeWorkstreamId) {
        try {
          const visualArtifactId = await convexMutation<
            {
              actorClerkId: string;
              type: string;
              title: string;
              content: string;
              contentPlaintext: string;
              workstreamId?: string;
              sourceType?: string;
              linkedChatId?: string;
              sourceMessageId?: string;
              createdAt?: number;
            },
            string
          >("artifacts:create", {
            actorClerkId: actor.clerkId,
            type: visualArtifact.type,
            title: visualArtifact.title,
            content: visualArtifact.content,
            contentPlaintext: visualArtifact.summary || visualArtifact.title,
            workstreamId: activeWorkstreamId,
            sourceType: "ai_generated",
            linkedChatId: chatId,
            sourceMessageId: appended.messageId,
          });

          await convexMutation("workspaceItems:updateBySourceArtifact", {
            actorClerkId: actor.clerkId,
            sourceArtifactId: visualArtifactId,
            renderMode: visualArtifact.renderMode,
            title: visualArtifact.title,
            contentSummary: visualArtifact.summary || visualArtifact.title,
            renderProps: visualArtifact.renderProps,
            provenanceSource: "ai",
            provenanceAction: "created",
            mutationSummary: `AI rendered visual artifact ${visualArtifact.title}`,
          }).catch(() => {});

          route.trace.toolchain.push("spectra_visual_dual_render");
        } catch (error) {
          logger.warn("visual artifact persistence failed", {
            chatId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

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
          finishReason,
          truncatedByLength,
          pricing,
        });
      }
      await recordModelRuntime(modelUsed, true, Date.now() - requestStartedAt);
      await convexMutation("models:recordModelQualitySignals", {
        actorClerkId: actor.clerkId,
        modelId: modelUsed,
        finishReason,
        responseLength: finalizedResponse.length,
      }).catch(() => {});
      if (route.trace.collaborators?.length) {
        for (const collaborator of route.trace.collaborators) {
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
          hasCitations?: boolean;
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
        hasCitations: citations.length > 0,
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
      let extractedWorkstreamMemory: Array<{
        key: string;
        text: string;
        category: "concept" | "progress" | "preference" | "deadline" | "correction" | "resource_link";
        confidence: number;
      }> = [];
      const extractedMemory = (routePlan.shouldWriteMemory || shouldExtractLearningContext)
        ? await maybeExtractMemory({
            actorClerkId: actor.clerkId,
            chatId,
            existingEntries: userMemory.entries,
            userMessage: normalizedMessage,
            assistantResponse: finalizedResponse,
            persistMemory: routePlan.shouldWriteMemory,
            workstreamContext: activeWorkstreamId && activeWorkstream
              ? {
                  workstreamId: activeWorkstreamId,
                  title: String((activeWorkstream as { title?: unknown }).title ?? "Workstream"),
                  description:
                    typeof (activeWorkstream as { description?: unknown }).description === "string"
                      ? String((activeWorkstream as { description?: unknown }).description)
                      : undefined,
                  plannerTitles: Array.isArray(activeWorkstreamPlannerItems)
                    ? activeWorkstreamPlannerItems
                        .slice(0, 4)
                        .map((item) => String((item as { title?: unknown }).title ?? ""))
                        .filter(Boolean)
                    : [],
                  artifactTitles: Array.isArray(activeWorkstreamArtifacts)
                    ? activeWorkstreamArtifacts
                        .slice(0, 4)
                        .map((item) => String((item as { title?: unknown }).title ?? ""))
                        .filter(Boolean)
                    : [],
                  noteTitles: Array.isArray(activeWorkstreamNotes)
                    ? activeWorkstreamNotes
                        .slice(0, 4)
                        .map((item) => String((item as { title?: unknown }).title ?? ""))
                        .filter(Boolean)
                    : [],
                }
              : undefined,
            onWorkstreamMemoryExtracted: (entries) => {
              extractedWorkstreamMemory = entries;
            },
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
            sourceMessageId: appended.messageId,
            spendingTier: budget.tier,
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
      const personalWorkstreamMirrorWrite =
        routePlan.shouldWriteMemory && extractedWorkstreamMemory.length > 0
          ? await routeMemoryWrite({
              actorClerkId: actor.clerkId,
              chatId,
              sourceMessageId: appended.messageId,
              sourceWorkstreamId: activeWorkstreamId,
              spendingTier: budget.tier,
              entries: extractedWorkstreamMemory.map((entry) => ({
                key: entry.key,
                value: entry.text,
                confidence: entry.confidence,
                extractedAt: Date.now(),
              })),
              sourceType: "extraction",
              onModelCall: (call) => {
                appendSubcall({
                  phaseId: "memory",
                  label: "Workstream memory mirror embedding",
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
      const workstreamMemoryWrite =
        routePlan.shouldWriteMemory && activeWorkstreamId && extractedWorkstreamMemory.length > 0
          ? await convexMutation<
              {
                actorClerkId: string;
                workstreamId: string;
                sourceChatId?: string;
                sourceMessageId?: string;
                entries: Array<{
                  key: string;
                  text: string;
                  category: "concept" | "progress" | "preference" | "deadline" | "correction" | "resource_link";
                  confidence: number;
                  freshness: number;
                  sourceType: "chat_extraction";
                }>;
              },
              { inserted: number; updated: number; superseded: number }
            >("workstreamMemory:upsertEntries", {
              actorClerkId: actor.clerkId,
              workstreamId: activeWorkstreamId,
              sourceChatId: chatId,
              sourceMessageId: appended.messageId,
              entries: extractedWorkstreamMemory.map((entry) => ({
                key: entry.key,
                text: entry.text,
                category: entry.category,
                confidence: entry.confidence,
                freshness: 1,
                sourceType: "chat_extraction" as const,
              })),
            }).catch(() => ({ inserted: 0, updated: 0, superseded: 0 }))
          : { inserted: 0, updated: 0, superseded: 0 };
      if (route.trace.phasePlan?.some((phase) => phase.id === "memory") && routePlan.shouldWriteMemory) {
        await emitPhaseUpdate(
          "memory",
          routedMemoryWrite.written > 0 || personalWorkstreamMirrorWrite.written > 0 || workstreamMemoryWrite.inserted > 0 || workstreamMemoryWrite.updated > 0 || extractedMemory.length > 0 || extractedWorkstreamMemory.length > 0
            ? "completed"
            : "skipped",
          routedMemoryWrite.written > 0 || personalWorkstreamMirrorWrite.written > 0 || workstreamMemoryWrite.inserted > 0 || workstreamMemoryWrite.updated > 0
            ? `Layered memory updated (personal ${routedMemoryWrite.written + personalWorkstreamMirrorWrite.written}, workstream ${workstreamMemoryWrite.inserted + workstreamMemoryWrite.updated}, superseded ${workstreamMemoryWrite.superseded}).`
            : extractedMemory.length > 0 || extractedWorkstreamMemory.length > 0
              ? "Memory extracted but no durable write completed."
              : "No durable memory update extracted.",
        );
      }
      if (extractedMemory.length > 0 || extractedWorkstreamMemory.length > 0) {
        await send({
          type: "soul_update",
          content:
            extractedWorkstreamMemory.length > 0
              ? `Saved ${extractedMemory.length} personal entr${extractedMemory.length === 1 ? "y" : "ies"} and ${extractedWorkstreamMemory.length} workstream cue${extractedWorkstreamMemory.length === 1 ? "" : "s"}.`
              : undefined,
          entries: [
            ...extractedMemory.slice(0, 4).map((entry) => ({
              key: entry.key,
              value: entry.value,
              confidence: entry.confidence,
            })),
            ...extractedWorkstreamMemory.slice(0, 2).map((entry) => ({
              key: `${entry.category}:${entry.key}`,
              value: entry.text,
              confidence: entry.confidence,
            })),
          ],
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
        memoryUpdated: extractedMemory.length > 0 || extractedWorkstreamMemory.length > 0,
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
      route.trace.totalCostCents = Number(
        ((route.trace.subcalls ?? []).reduce((sum, call) => sum + (call.costCents ?? 0), 0)).toFixed(4),
      );
      route.trace.totalDurationMs = Date.now() - requestStartedAt;

      await send({
        type: "done",
        content: finalizedResponse,
        chatId,
        userMessageId: resolvedUserMessageId,
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
        finishReason,
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
                autoSelected: Boolean(autoSelectedAgent && autoSelectedAgent.id === selectedAgent._id),
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
      if (!streamClosed) {
        await writer.close().catch(() => {});
      }
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
