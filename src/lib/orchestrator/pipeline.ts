import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";
import { openRouterChatCompletion, openRouterGenerateImage } from "@/lib/openrouter";
import { canUseInTier, chooseModelRoute } from "@/lib/routing/heuristic";
import {
  buildSystemPrompt,
  checkPromptPolicyResponse,
  tutorGate,
} from "@/lib/prompts/policy";
import {
  summarizeWhyResponse,
  toOpenRouterMessages,
} from "@/lib/orchestrator/compose";
import { IMAGE_GEN_FALLBACKS, MODEL_CONFIG } from "@/lib/model-config";
import { classifyExplainDepth, runAutoSettingsPipeline, suggestMode } from "@/lib/auto-settings";
import { matchAgentToMessage } from "@/lib/agent-matching";
import { countFlashcardPairs, isFlashcardDeckStructured, normalizeFlashcardDeck } from "@/lib/flashcard-format";
import { safeStudyMode } from "@/lib/contracts/studyModes";
import { createRequestLogger } from "@/lib/logging";
import { isModeAvailable } from "@/lib/modes";
import { normalizeAttachments } from "@/lib/attachments/normalizer";
import { gateCapabilities } from "@/lib/attachments/capability-gate";
import { runVisionPrepass } from "@/lib/attachments/vision-prepass";
import { extractAttemptStats, maybeCompactHistory, toChatMessageShape, type MemoryEntry } from "@/lib/orchestrator/history";
import {
  inferCitations,
  maybeExtractMemory,
  maybeGenerateTitle,
  maybeGenerateTitleFromUserPrompt,
  rewriteCitationMarkers,
  shouldInjectMemory,
  stripOrphanCitations,
} from "@/lib/orchestrator/post-process";
import { buildResearchEvidenceBlock, maybeSearchWeb, runRagRetrieval } from "@/lib/orchestrator/retrieval";
import { runAssistantStreaming, runCollaborativeStreaming } from "@/lib/orchestrator/streaming";
import { buildTaskGraph, shouldUseMultiAgent } from "@/lib/orchestrator/task-graph";
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

function jsonError(status: number, error: StructuredError, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    {
      error,
      ...extra,
    },
    { status },
  );
}

export async function runChatPipeline(request: NextRequest) {
  const requestStartedAt = Date.now();
  const actor = await requireActor();
  const logger = createRequestLogger(request).child({ userId: actor.clerkId });

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

  const catalog = (await convexQuery("models:listModels", {
    actorClerkId: actor.clerkId,
  })) as Array<{ modelId: string; isFree?: boolean; inputCostPerM?: number }>;

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

  const auto = await runAutoSettingsPipeline({
    message: normalizedMessage,
    currentThinkingLevel: body.thinkingLevel,
    spendingTier: budget.tier,
    autoEnhancePrompt: autoSettings.enhancePrompt,
    autoThinking: autoSettings.autoThinking,
    autoSearch: autoSettings.autoSearch,
    enhanceMode: autoSettings.enhanceMode,
    thinkingMode: autoSettings.thinkingMode,
    searchMode: autoSettings.searchMode,
  });
  logger.info("auto-settings complete", {
    promptEnhanced: auto.promptEnhanced,
    searchEnabled: auto.searchEnabled,
    promptCategory: auto.promptCategory,
    complexity: auto.complexity,
  });

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

  // Research mode always enables search
  if (effectiveMode === "research") {
    auto.searchEnabled = true;
  }
  const attachmentResourceIds = (body.attachmentResourceIds ?? []).filter((id) => typeof id === "string" && id.trim().length > 0);
  const uploadedAttachmentMeta = attachmentResourceIds.length > 0
    ? ((await convexQuery("resources:getResourceNamesByIds", {
        actorClerkId: actor.clerkId,
        resourceIds: attachmentResourceIds,
      })) as Array<{ _id: string; filename: string; status: "uploaded" | "processed" | "failed" }>)
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

  const [chatData, orgSettings, userMemory] = await Promise.all([
    convexQuery("chats:getChat", {
      actorClerkId: actor.clerkId,
      chatId,
    }) as Promise<{ chat: Record<string, unknown>; messages: Array<Record<string, unknown>> }>,
    convexQuery("admin:getOrgSettings", { actorClerkId: actor.clerkId }) as Promise<{
      org: {
        verifyMarkerPassEnabled: boolean;
        orchestratorV2Enabled?: boolean;
        soulEnabled?: boolean;
        agentModelBoostEnabled?: boolean;
        adaptiveQuizEnabled?: boolean;
      };
    }>,
    convexQuery("memory:getUserMemory", {
      actorClerkId: actor.clerkId,
    }) as Promise<{ rawMemoryText: string; entries: MemoryEntry[] }>,
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
  const isFirstAssistantTurn = history.every((message) => message.role !== "assistant");
  const attemptStats = extractAttemptStats(history);

  // Conversation-aware mode refinement: now that we have history, run suggestMode
  // again with full context and optionally override the initial effectiveMode.
  // Only applies when in auto mode or soft-switchable modes (tutor/general).
  if (safeMode === "auto" || safeMode === "tutor" || safeMode === "general") {
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
    }
  }

  // Vague request detection for quiz/flashcard modes.
  // When a request is ambiguous (no topic specified), skip format-repair so the
  // model can ask a clarifying question instead of generating empty/wrong content.
  const isVagueRequest =
    (effectiveMode === "quiz" || effectiveMode === "flashcard") &&
    normalizedMessage.split(/\s+/).length < 4 &&
    !/\b(about|on|for|regarding|the|topic)\b/i.test(normalizedMessage);

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

  const scheduledCompaction = history.length > 20 && !existingSummary;
  if (scheduledCompaction) {
    void maybeCompactHistory({
      actorClerkId: actor.clerkId,
      chatId,
      history,
    }).catch(() => {});
  }

  const recentHistory = existingSummary ? history.slice(-6) : history;
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

  const retrievalPromise = runRagRetrieval({
    actorClerkId: actor.clerkId,
    usePersonalResources: body.usePersonalResources,
    selectedAgentId: selectedAgent?._id,
    message: auto.message,
    logger,
  });

  const searchPromise = auto.searchEnabled
    ? maybeSearchWeb(auto.message, auto.thinkingLevel).catch(() => ({
      text: "",
      urls: [] as string[],
      sources: [] as Array<{ url: string; title: string; domain: string }>,
    }))
    : Promise.resolve({
      text: "",
      urls: [] as string[],
      sources: [] as Array<{ url: string; title: string; domain: string }>,
    });

  const soulPromise: Promise<{ bullets: string[] }> = featureEnabled(orgSettings.org?.soulEnabled)
    ? convexAction("soul:retrieveSoulGuidance", {
        actorClerkId: actor.clerkId,
        query: auto.message,
        limit: 8,
      })
        .then((result) => {
          const payload = result as { bullets?: string[] } | null;
          return { bullets: payload?.bullets ?? [] };
        })
        .catch(() => ({ bullets: [] as string[] }))
    : Promise.resolve({ bullets: [] as string[] });

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

  const [retrieval, webResult, soulResult, quizAdaptive] = await Promise.all([
    retrievalPromise,
    searchPromise,
    soulPromise,
    adaptiveQuizPromise,
  ]);

  const searchBlock = webResult.text ?? "";
  const searchUrls = webResult.urls ?? [];
  let searchSources = webResult.sources ?? [];
  if (auto.searchEnabled) {
    logger.info("web search complete", { urlCount: searchUrls.length });
  }

  const soulBullets = (soulResult.bullets ?? []).slice(0, 10);
  const quizDifficultyLevel = clampQuizDifficultyLevel(quizAdaptive.level);
  const quizDifficultyLabel = quizAdaptive.label;
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
  const agentTopModels = selectedAgent?._id && featureEnabled(orgSettings.org?.agentModelBoostEnabled)
    ? ((await convexQuery("agents:getTopModelsForAgent", {
        actorClerkId: actor.clerkId,
        agentId: selectedAgent._id,
        limit: 5,
      })) as Array<{ modelId: string; score: number }>)
    : [];

  const route = chooseModelRoute({
    mode: effectiveMode,
    thinkingLevel: auto.thinkingLevel,
    hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
    attachmentTypes: body.attachmentTypes ?? [],
    messageLength: auto.message.length,
    teacherStrictness: "medium",
    routerMode: autoSettings.autoModel ? body.routerMode : "manual",
    manualModel: autoSettings.autoModel ? body.manualModel : body.manualModel ?? MODEL_CONFIG.tutorFast,
    studentSeemsStuck: effectiveMode === "tutor" && attemptStats.attemptCount >= 2,
    spendingTier: budget.tier,
    needsSearch: auto.searchEnabled,
    needsRag: retrieval.citations.length > 0,
    promptEnhanced: auto.promptEnhanced,
    promptCategory: auto.promptCategory,
    questionType: auto.questionType,
    isMultipart: auto.isMultipart,
    conversationLength: history.length,
    previousModelUsed: previousAssistantModel,
    agentPreferredModel: selectedAgent?.preferredModel,
    agentTopModels,
  });
  const manualLockRequested = body.routerMode === "manual" && Boolean(body.manualModel) && !body.forcedModel;
  if (manualLockRequested && body.manualModel && route.primaryModel !== body.manualModel) {
    await rollbackPersistedUserMessage();
    return jsonError(409, {
      code: "MANUAL_MODEL_RESTRICTED",
      message: "Selected model cannot be used under current tier limits. Choose a budget-safe model.",
      retryable: false,
    });
  }
  logger.info("routing complete", {
    primaryModel: route.primaryModel,
    fallbackCount: route.fallbackModels.length,
    reason: route.reason,
  });

  if (body.forcedModel && body.forcedModel !== route.primaryModel) {
    if (!canUseInTier(body.forcedModel, budget.tier)) {
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
  if (auto.searchEnabled) route.trace.toolchain.push("web_search");
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
  });

  if (capability.modelSwitched) {
    if (manualLockRequested) {
      capability = {
        finalModel: route.primaryModel,
        modelSwitched: false,
        requiresPrepass: true,
        prepassModel: capability.prepassModel ?? MODEL_CONFIG.multimodal,
        userNotice: "Manual model kept; using vision prepass for attached images.",
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

  let imageDescriptionBlock = "";
  if (capability.requiresPrepass && capability.prepassModel && allImageBlocks.length > 0) {
    imageDescriptionBlock = await runVisionPrepass({
      imageContentBlocks: allImageBlocks,
      userMessage: auto.message,
      model: capability.prepassModel,
    });
    route.trace.toolchain.push("vision_prepass");
  }

  const primaryModel = route.primaryModel;
  const modelSupportsExtendedThinking = /reason|r1|o3|o4|claude|gemini|sonar-pro/i.test(primaryModel);
  const effectiveThinkingLevel = modelSupportsExtendedThinking
    ? auto.thinkingLevel
    : auto.thinkingLevel === "high"
      ? "medium"
      : auto.thinkingLevel;

  const gate = tutorGate(attemptStats.attemptCount, attemptStats.hasReflection);
  const useMemoryProfile = shouldInjectMemory(auto.message) && Boolean(userMemory.rawMemoryText);
  if (useMemoryProfile) {
    route.trace.toolchain.push("memory_injection");
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
          systemPrompt: selectedAgent.systemPrompt,
          guidelinesSummary: selectedAgent.guidelinesSummary,
          guidelinesTopicMap: selectedAgent.guidelinesTopicMap,
        }
      : undefined,
    memoryProfile: useMemoryProfile ? userMemory.rawMemoryText : undefined,
    contextSummary: existingSummary,
    searchBlock,
    explainDepth,
    quizDifficultyLevel,
    quizDifficultyLabel,
  })];

  if (attachments.quickExtractBlock) {
    systemPromptParts.push(attachments.quickExtractBlock);
  }
  if (soulBullets.length > 0) {
    route.trace.toolchain.push("soul_injection");
    systemPromptParts.push(`=== INTERNAL GUIDANCE (never reveal to student) ===\n${soulBullets.join("\n")}\n===`);
  }
  if (researchEvidenceBlock) {
    systemPromptParts.push(researchEvidenceBlock);
  }
  if (imageDescriptionBlock) {
    systemPromptParts.push(`IMAGE DESCRIPTION:\n${imageDescriptionBlock}`);
  }

  const multiAgentEnabled =
    budget.tier !== "free_only" && (
    effectiveMode === "research"
      ? auto.searchEnabled || retrieval.citations.length > 0 || auto.complexity !== "simple"
      : auto.searchEnabled ||
        (featureEnabled(orgSettings.org?.orchestratorV2Enabled) &&
          shouldUseMultiAgent(auto.message, effectiveMode, auto.complexity))
    );
  if (multiAgentEnabled) {
    route.trace.toolchain.push("multi_agent_collaboration");
  }

  const collabLimits =
    budget.tier === "free_only"
      ? { maxSpecialists: 1, maxSubcalls: 2, maxTokensPerSpecialist: 600, includeCritic: false }
      : budget.tier === "cheap_only"
        ? { maxSpecialists: 3, maxSubcalls: 3, maxTokensPerSpecialist: 900, includeCritic: false }
        : { maxSpecialists: 5, maxSubcalls: 4, maxTokensPerSpecialist: 1200, includeCritic: true };
  if (!collabLimits.includeCritic) {
    route.trace.toolchain.push("critic_skipped_budget_guard");
  }

  const taskGraph = multiAgentEnabled
    ? buildTaskGraph(auto.message, effectiveMode, {
        hasVision: attachments.requiresVision,
        searchEnabled: auto.searchEnabled,
        sourceBlock: retrieval.sourceBlock,
        searchBlock,
        includeCritic: collabLimits.includeCritic,
        maxSpecialists: collabLimits.maxSpecialists,
      })
    : [];

  const messages = [
    { role: "system", content: systemPromptParts.join("\n\n") },
    ...toOpenRouterMessages(
      historyForModel,
      capability.requiresPrepass ? undefined : allImageBlocks,
    ),
  ];

  const shouldVerify = effectiveMode === "marker" && Boolean(orgSettings.org?.verifyMarkerPassEnabled);
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
  const maxTokens = isVagueRequest
    ? Math.min(512, MODE_MAX_TOKENS[effectiveMode] ?? 2048)
    : (MODE_MAX_TOKENS[effectiveMode] ?? 2048);
  const earlyTitlePromise = isFirstAssistantTurn
    ? maybeGenerateTitleFromUserPrompt({
        chatId,
        actorClerkId: actor.clerkId,
        userMessage: normalizedMessage,
      }).catch((error) => {
        logger.warn("early chat title generation failed", {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      })
    : Promise.resolve(undefined);

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  const send = async (payload: Record<string, unknown>) => {
    await writer.write(encoder.encode(`${JSON.stringify(payload)}\n`));
  };

  void (async () => {
    let assistantPersisted = false;

    try {
      void earlyTitlePromise.then((title) => {
        if (!title) return;
        void send({
          type: "chat_title",
          chatTitle: title,
          chatId,
        });
      });

      if (effectiveMode === "image") {
        route.trace.toolchain.push("image_prompt_refinement");
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

        const refinedPrompt =
          promptRefinement?.choices?.[0]?.message?.content?.trim() || auto.message;

        route.trace.toolchain.push("image_generation");
        const selectedImageModel = body.imageModel || MODEL_CONFIG.imageGen;
        const imageResult = await openRouterGenerateImage({
          model: selectedImageModel,
          fallbackModels: [...IMAGE_GEN_FALLBACKS],
          prompt: refinedPrompt,
          size: "1024x1024",
          onFallback: (event) => {
            route.trace.fallbacks.push(event);
          },
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
        const usageIn = 0;
        const usageOut = 0;
        const citations: Array<{
          filename: string;
          url?: string;
          page?: number;
          sourceType: "pack" | "personal" | "general" | "search";
          resourceId?: string;
        }> = [];

        route.trace.toolchain = [...new Set(route.trace.toolchain)];
        route.trace.totalDurationMs = Date.now() - requestStartedAt;

        const appended = (await convexMutation("chats:appendMessage", {
          actorClerkId: actor.clerkId,
          chatId,
          role: "assistant",
          content: finalizedResponse,
          attachments: undefined,
          attachmentResourceIds: undefined,
          mode: effectiveMode,
          citations,
          modelRequested,
          modelUsed,
          whyThisResponse,
          usageIn,
          usageOut,
          verificationPassed: undefined,
          thinkingContent: undefined,
          routeTrace: route.trace,
        })) as { messageId: string };
        assistantPersisted = true;

        const pricing = (await convexQuery("models:getModelPricing", {
          actorClerkId: actor.clerkId,
          modelId: modelUsed,
        })) as { inputCostPerM?: number; outputCostPerM?: number; isFree?: boolean };

        await convexMutation("usage:recordUsageWithCost", {
          actorClerkId: actor.clerkId,
          chatId,
          messageId: appended.messageId,
          model: modelUsed,
          inputTokens: usageIn,
          outputTokens: usageOut,
          inputCostPerM: pricing.inputCostPerM,
          outputCostPerM: pricing.outputCostPerM,
        }).catch(() => {});

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
          tokensUsed: usageIn + usageOut,
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
        const generatedTitle = await resolveFirstTurnTitle({
          assistantCount,
          chatId,
          actorClerkId: actor.clerkId,
          userMessage: normalizedMessage,
          assistantMessage: finalizedResponse,
          logger,
        });

        await send({
          type: "done",
          content: finalizedResponse,
          chatId,
          userMessageId: persistedUserMessageId,
          messageId: appended.messageId,
          modelUsed,
          modelRequested,
          usageIn,
          usageOut,
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
        route.trace.fallbacks.push(event);
      };

      const streamed = multiAgentEnabled
        ? await runCollaborativeStreaming({
            graph: taskGraph,
            originalPrompt: auto.message,
            baseSystemPrompt: systemPromptParts.join("\n\n"),
            primaryModel,
            fallbackModels,
            maxTokens,
            maxSubcalls: collabLimits.maxSubcalls,
            maxTokensPerSpecialist: collabLimits.maxTokensPerSpecialist,
            send,
            onFallback,
            logger,
          })
        : await runAssistantStreaming({
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
      const verificationPassed = streamed.verificationPassed;
      const thinkingContent = streamed.thinkingContent;
      const modelRequested = primaryModel;
      if (streamed.collaborators && streamed.collaborators.length > 0) {
        route.trace.collaborators = streamed.collaborators;
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
        const repaired = await openRouterChatCompletion({
          model: MODEL_CONFIG.tutorFast,
          fallbackModels: [route.primaryModel, ...route.fallbackModels].slice(0, 3),
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
        const regenerated = await openRouterChatCompletion({
          model: MODEL_CONFIG.tutorFast,
          fallbackModels: [route.primaryModel, ...route.fallbackModels].slice(0, 3),
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
      }

      const finalQuizRepairNeeded =
        !isVagueRequest &&
        effectiveMode === "quiz" &&
        (!isQuizStructured(correctedResponse) || countQuizQuestions(correctedResponse) < MIN_QUIZ_QUESTIONS);
      if (finalQuizRepairNeeded) {
        const finalRepair = await openRouterChatCompletion({
          model: MODEL_CONFIG.tutorFast,
          fallbackModels: [route.primaryModel, ...route.fallbackModels].slice(0, 3),
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
        const finalCandidate = finalRepair.choices?.[0]?.message?.content?.trim() ?? "";
        if (finalCandidate && isQuizStructured(finalCandidate) && countQuizQuestions(finalCandidate) >= MIN_QUIZ_QUESTIONS) {
          correctedResponse = finalCandidate;
          route.trace.toolchain.push("quiz_final_repair");
        }
      }

      const finalFlashcardRepairNeeded =
        !isVagueRequest &&
        effectiveMode === "flashcard" &&
        (!isFlashcardDeckStructured(correctedResponse) || countFlashcardPairs(correctedResponse) < MIN_FLASHCARD_PAIRS);
      if (finalFlashcardRepairNeeded) {
        const finalFlashcardRepair = await openRouterChatCompletion({
          model: MODEL_CONFIG.tutorFast,
          fallbackModels: [route.primaryModel, ...route.fallbackModels].slice(0, 3),
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
        const finalFlashcardCandidate = finalFlashcardRepair.choices?.[0]?.message?.content?.trim() ?? "";
        const normalizedFinalFlashcards = normalizeFlashcardDeck(finalFlashcardCandidate);
        if (normalizedFinalFlashcards && countFlashcardPairs(normalizedFinalFlashcards) >= MIN_FLASHCARD_PAIRS) {
          correctedResponse = normalizedFinalFlashcards;
          route.trace.toolchain.push("flashcard_final_repair");
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
      const finalizedResponse = stripOrphanCitations(rewrittenResponse, citations);
      const whyThisResponse = summarizeWhyResponse(effectiveMode, route.reason);
      route.trace.totalDurationMs = Date.now() - requestStartedAt;
      logger.info("streaming complete", {
        modelUsed,
        usageIn,
        usageOut,
        fallbackCount: route.trace.fallbacks.length,
      });

      const appended = (await convexMutation("chats:appendMessage", {
        actorClerkId: actor.clerkId,
        chatId,
        role: "assistant",
        content: finalizedResponse,
        attachments: undefined,
        attachmentResourceIds: undefined,
        mode: effectiveMode,
        citations,
        modelRequested,
        modelUsed,
        whyThisResponse,
        usageIn,
        usageOut,
        verificationPassed,
        thinkingContent: thinkingContent || undefined,
        routeTrace: route.trace,
      })) as { messageId: string };
      assistantPersisted = true;

      const pricing = (await convexQuery("models:getModelPricing", {
        actorClerkId: actor.clerkId,
        modelId: modelUsed,
      })) as { inputCostPerM?: number; outputCostPerM?: number; isFree?: boolean };

      await convexMutation("usage:recordUsageWithCost", {
        actorClerkId: actor.clerkId,
        chatId,
        messageId: appended.messageId,
        model: modelUsed,
        inputTokens: usageIn,
        outputTokens: usageOut,
        inputCostPerM: pricing.inputCostPerM,
        outputCostPerM: pricing.outputCostPerM,
      });

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
        tokensUsed: usageIn + usageOut,
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

      void maybeExtractMemory({
        actorClerkId: actor.clerkId,
        existingEntries: userMemory.entries,
        userMessage: normalizedMessage,
        assistantResponse: finalizedResponse,
      }).catch(() => {});

      const assistantCount = history.filter((message) => message.role === "assistant").length;
      const generatedTitle = await resolveFirstTurnTitle({
        assistantCount,
        chatId,
        actorClerkId: actor.clerkId,
        userMessage: normalizedMessage,
        assistantMessage: finalizedResponse,
        logger,
      });

      await send({
        type: "done",
        content: finalizedResponse,
        chatId,
        userMessageId: persistedUserMessageId,
        messageId: appended.messageId,
        modelUsed,
        modelRequested,
        usageIn,
        usageOut,
        whyThisResponse,
        citations,
        verificationPassed,
        thinkingContent: thinkingContent || undefined,
        routeTrace: route.trace,
        spendingUpdate,
        autoResult: {
          modelUsed,
          searchEnabled: route.searchEnabled || auto.searchEnabled,
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
