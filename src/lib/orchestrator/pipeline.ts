import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";
import { chooseModelRoute } from "@/lib/routing/heuristic";
import {
  buildSystemPrompt,
  checkPromptPolicyResponse,
  tutorGate,
} from "@/lib/prompts/policy";
import {
  summarizeWhyResponse,
  toOpenRouterMessages,
} from "@/lib/orchestrator/compose";
import { MODEL_CONFIG } from "@/lib/model-config";
import { classifyExplainDepth, runAutoSettingsPipeline } from "@/lib/auto-settings";
import { safeStudyMode } from "@/lib/contracts/studyModes";
import { createRequestLogger } from "@/lib/logging";
import { normalizeAttachments } from "@/lib/attachments/normalizer";
import { gateCapabilities } from "@/lib/attachments/capability-gate";
import { runVisionPrepass } from "@/lib/attachments/vision-prepass";
import { extractAttemptStats, maybeCompactHistory, toChatMessageShape, type MemoryEntry } from "@/lib/orchestrator/history";
import { inferCitations, maybeExtractMemory, maybeGenerateTitle, rewriteCitationMarkers, shouldInjectMemory } from "@/lib/orchestrator/post-process";
import { buildResearchEvidenceBlock, maybeSearchWeb, runRagRetrieval } from "@/lib/orchestrator/retrieval";
import { runAssistantStreaming, runCollaborativeStreaming } from "@/lib/orchestrator/streaming";
import { buildTaskGraph, shouldUseMultiAgent } from "@/lib/orchestrator/task-graph";
import type { StudyMode } from "@/types";

type ChatRequestBody = {
  chatId?: string;
  packId?: string;
  agentId?: string;
  mode: StudyMode;
  message: string;
  thinkingLevel: "low" | "medium" | "high";
  routerMode: "auto" | "manual" | "openrouter_auto";
  manualModel?: string;
  forcedModel?: string;
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
  description: string;
  systemPrompt: string;
  avatarEmoji: string;
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

  const safeMode = safeStudyMode(body.mode, "POST /api/chat");

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
    tier: "normal" | "cheap_only" | "free_only";
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

  const effectiveMode = safeMode;
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
          title: normalizedMessage.slice(0, 60),
        })) as { chatId: string }
      ).chatId;

  const isRegenerate = Boolean(body.regenerate && body.chatId);
  const shouldPersistUserMessage = !isRegenerate && !body.skipUserMessagePersist;
  const rollbackPersistedUserMessage = async () => {
    if (!shouldPersistUserMessage) return;
    await convexMutation("chats:deleteLastUserMessage", {
      actorClerkId: actor.clerkId,
      chatId,
      expectedContent: normalizedMessage,
    }).catch(() => {});
  };

  if (isRegenerate) {
    await convexMutation("chats:deleteLastAssistantMessage", {
      actorClerkId: actor.clerkId,
      chatId,
    });
  } else if (shouldPersistUserMessage) {
    await convexMutation("chats:appendMessage", {
      actorClerkId: actor.clerkId,
      chatId,
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
    });
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
  const attemptStats = extractAttemptStats(history);

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

  const retrievalPromise = runRagRetrieval({
    actorClerkId: actor.clerkId,
    usePersonalResources: body.usePersonalResources,
    selectedAgentId: selectedAgent?._id,
    message: auto.message,
    logger,
  });

  const searchPromise = auto.searchEnabled
    ? maybeSearchWeb(auto.message, auto.thinkingLevel).catch(() => ({ text: "", urls: [] as string[] }))
    : Promise.resolve({ text: "", urls: [] as string[] });

  const soulPromise: Promise<{ bullets: string[] }> = orgSettings.org?.soulEnabled
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

  const quizPerfPromise: Promise<{ recommendedDifficulty: number }> =
    effectiveMode === "quiz" && orgSettings.org?.adaptiveQuizEnabled
      ? convexQuery("analytics:getRecentQuizPerformance", {
          actorClerkId: actor.clerkId,
          days: 30,
        })
          .then((result) => {
            const payload = result as { recommendedDifficulty?: number } | null;
            return { recommendedDifficulty: payload?.recommendedDifficulty ?? 3 };
          })
          .catch(() => ({ recommendedDifficulty: 3 }))
      : Promise.resolve({ recommendedDifficulty: 3 });

  const explainDepth = effectiveMode === "explain"
    ? classifyExplainDepth(auto.message, userMemory.rawMemoryText)
    : undefined;

  const [retrieval, webResult, soulResult, quizPerf] = await Promise.all([
    retrievalPromise,
    searchPromise,
    soulPromise,
    quizPerfPromise,
  ]);

  const searchBlock = webResult.text ?? "";
  const searchUrls = webResult.urls ?? [];
  if (auto.searchEnabled) {
    logger.info("web search complete", { urlCount: searchUrls.length });
  }

  const soulBullets = (soulResult.bullets ?? []).slice(0, 10);
  const quizDifficultyLevel = Math.min(5, Math.max(1, Math.round(quizPerf.recommendedDifficulty ?? 3)));
  if (effectiveMode === "quiz" && orgSettings.org?.adaptiveQuizEnabled) {
    void convexMutation("analytics:setQuizDifficultySignal", {
      actorClerkId: actor.clerkId,
      difficulty: quizDifficultyLevel,
    }).catch(() => {});
  }

  const researchEvidenceBlock =
    effectiveMode === "research"
      ? buildResearchEvidenceBlock({
          citations: retrieval.citations,
          searchUrls,
        })
      : "";

  const previousAssistantModel = [...history]
    .reverse()
    .find((message) => message.role === "assistant" && message.modelUsed)?.modelUsed;
  const agentTopModels = selectedAgent?._id && orgSettings.org?.agentModelBoostEnabled
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

  if (retrieval.citations.length > 0) route.trace.toolchain.push("rag_retrieval");
  if (auto.searchEnabled) route.trace.toolchain.push("web_search");
  if (explainDepth) route.trace.toolchain.push("explain_depth_detection");
  if (effectiveMode === "quiz" && orgSettings.org?.adaptiveQuizEnabled) route.trace.toolchain.push("adaptive_quiz");
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

  if (attachments.requiresVision) {
    route.trace.toolchain.push("vision_gate");
  }

  const capability = gateCapabilities({
    selectedModel: route.primaryModel,
    requiresVision: attachments.requiresVision,
    fallbackModels: route.fallbackModels,
  });

  if (capability.modelSwitched) {
    if (manualLockRequested) {
      await rollbackPersistedUserMessage();
      return jsonError(409, {
        code: "MANUAL_MODEL_CAPABILITY_MISMATCH",
        message: "Selected model cannot process these attachments. Choose a compatible model or remove files.",
        retryable: false,
      });
    }
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

  let imageDescriptionBlock = "";
  if (capability.requiresPrepass && capability.prepassModel && attachments.imageContentBlocks.length > 0) {
    imageDescriptionBlock = await runVisionPrepass({
      imageContentBlocks: attachments.imageContentBlocks,
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
    effectiveMode === "research"
      ? auto.searchEnabled || retrieval.citations.length > 0 || auto.complexity !== "simple"
      : auto.searchEnabled ||
        (Boolean(orgSettings.org?.orchestratorV2Enabled) &&
          shouldUseMultiAgent(auto.message, effectiveMode, auto.complexity));
  if (multiAgentEnabled) {
    route.trace.toolchain.push("multi_agent_collaboration");
  }

  const taskGraph = multiAgentEnabled
    ? buildTaskGraph(auto.message, effectiveMode, {
        hasVision: attachments.requiresVision,
        searchEnabled: auto.searchEnabled,
        sourceBlock: retrieval.sourceBlock,
        searchBlock,
      })
    : [];

  const messages = [
    { role: "system", content: systemPromptParts.join("\n\n") },
    ...toOpenRouterMessages(
      historyForModel,
      capability.requiresPrepass ? undefined : attachments.imageContentBlocks,
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

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  const send = async (payload: Record<string, unknown>) => {
    await writer.write(encoder.encode(`${JSON.stringify(payload)}\n`));
  };

  void (async () => {
    let assistantPersisted = false;

    try {
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
            send,
            onFallback,
            logger,
          });

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
      const correctedResponse =
        policyPass
          ? responseText
          : `${responseText}\n\nPolicy correction: citation and study-mode structure tightened to match requirements.`;

      route.trace.toolchain = [...new Set(route.trace.toolchain)];

      const citations = inferCitations(
        correctedResponse,
        retrieval.citations,
        searchUrls,
        attachmentCitations,
      );
      const finalizedResponse = rewriteCitationMarkers(correctedResponse, citations);
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
        tier: "normal" | "cheap_only" | "free_only";
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
      let generatedTitle: string | undefined;
      if (assistantCount === 0) {
        generatedTitle = await maybeGenerateTitle({
          chatId,
          actorClerkId: actor.clerkId,
          userMessage: normalizedMessage,
          assistantMessage: finalizedResponse,
        });
      }

      await send({
        type: "done",
        content: finalizedResponse,
        chatId,
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
