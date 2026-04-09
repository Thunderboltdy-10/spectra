import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { classifyRequest, runAutoSettingsPipeline } from "@/lib/auto-settings";
import { buildClassifierInput, validateClassifierDecision, validateClassifierInput } from "@/lib/orchestrator/classifier-contract";
import { PipelineController } from "@/lib/orchestrator/pipeline-controller";
import { selectModelForPhase } from "@/lib/routing/phase-router";
import { MODEL_CONFIG } from "@/lib/model-config";
import { getLiveCatalogSnapshot } from "@/lib/openrouter-catalog-cache";
import { safeStudyMode, type StudyMode } from "@/types";

export const runtime = "nodejs";

type DryRunRequest = {
  mode: StudyMode;
  message: string;
  thinkingLevel: "low" | "medium" | "high";
  routerMode: "auto" | "manual" | "openrouter_auto";
  manualModel?: string;
  attachmentTypes?: string[];
  usePersonalResources?: boolean;
  autoSettings?: {
    enhancePrompt?: boolean;
    autoModel?: boolean;
    autoThinking?: boolean;
    autoSearch?: boolean;
    enhanceMode?: "auto" | "on" | "off";
    thinkingMode?: "auto" | "on" | "off";
    searchMode?: "auto" | "on" | "off";
  };
};

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as DryRunRequest | null;

    if (!body || !body.mode || !body.message || !body.thinkingLevel || !body.routerMode) {
      return Response.json({ error: "mode, message, thinkingLevel, and routerMode are required." }, { status: 400 });
    }

    const safeMode = safeStudyMode(body.mode, "POST /api/chat/dry-run");
    const normalizedMessage = body.message.trim();
    if (!normalizedMessage) {
      return Response.json({ error: "Message cannot be empty." }, { status: 400 });
    }

    const budget = (await convexQuery("usage:checkUserBudget", {
      actorClerkId: actor.clerkId,
    })) as { tier: "normal" | "expensive_blocked" | "cheap_only" | "free_only" };
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
    const catalog = liveCatalog.models.length > 0 ? liveCatalog.models : dbCatalog;
    const fallbackManualModel =
      body.manualModel
      ?? catalog.find((model) => model.modelId !== "openrouter/auto")?.modelId
      ?? "openrouter/auto";

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
      mode: safeMode,
      hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
      isFirstMessage: false,
      currentThinkingLevel: body.thinkingLevel,
      spendingTier: budget.tier,
      autoEnhancePrompt: autoSettings.enhancePrompt,
      autoThinking: autoSettings.autoThinking,
      autoSearch: autoSettings.autoSearch,
      enhanceMode: autoSettings.enhanceMode,
      thinkingMode: autoSettings.thinkingMode,
      searchMode: autoSettings.searchMode,
      skipModelCalls: true,
    });
    const requestClassification = classifyRequest({
      message: normalizedMessage,
      complexity: auto.complexity,
      mode: safeMode,
      hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
      isFirstMessage: false,
      spendingTier: budget.tier,
    });
    auto.requestClass = requestClassification.requestClass;
    auto.assignmentLevel = requestClassification.assignmentLevel;
    auto.classificationReason = requestClassification.reason;
    const pipelineController = new PipelineController({
      requestClass: requestClassification.requestClass,
      classificationReason: requestClassification.reason,
    });
    if (requestClassification.requestClass === "T0") {
      pipelineController.markStageSkipped("autoSettings", "Skipped for trivial filler T0 request.");
      auto.message = normalizedMessage;
      auto.promptEnhanced = false;
      auto.searchEnabled = false;
      auto.thinkingLevel = "low";
    } else {
      pipelineController.markStageCompleted("autoSettings");
    }
    const costGates = pipelineController.applyCostGates({
      allowSearch: auto.searchEnabled,
      allowRag: Boolean(body.usePersonalResources),
      allowMultiAgent: false,
      spendingTier: budget.tier,
      forceMultiAgentRequested: false,
      orchestratorEnabled: true,
      budgetSoftLimited: false,
    });
    const classifierInput = buildClassifierInput({
      message: normalizedMessage,
      mode: safeMode,
      conversationHistory: [],
      userThinkingLevel: body.thinkingLevel,
      routerMode: body.routerMode,
      memoryEnabled: true,
      usePersonalResources: Boolean(body.usePersonalResources),
      availableAgents: [],
    });
    const classifierInputValid = validateClassifierInput(classifierInput);
    const classifierDecisionSource = {
      tier: requestClassification.requestClass,
      skills: ["concise-chat"],
      workspaceTarget: { kind: "none" as const },
      agentId: null,
      needsSearch: costGates.searchEnabled,
      needsMemory: true,
      needsRag: costGates.ragEnabled,
      outputFormat: "conversational" as const,
      thinkingLevel: auto.thinkingLevel,
      confidence: requestClassification.requestClass === "T0" ? 0.98 : 0.82,
    };
    const classifierValidation = classifierInputValid
      ? validateClassifierDecision(classifierDecisionSource, classifierInput.availableSkills)
      : { ok: false as const, error: "Classifier input payload is malformed." };
    if (!classifierValidation.ok) {
      return Response.json({ error: "Classifier contract invalid." }, { status: 500 });
    }
    const classifierDecision = classifierValidation.value;
    const classifierMeta = {
      modelId: MODEL_CONFIG.smartCheap,
      modelLane: "cheap_classifier",
      fallbackUsed: false,
      timedOut: false,
      durationMs: 0,
    };
    pipelineController.markStageCompleted("classifyRequest");
    pipelineController.markStageCompleted("modelSelection");

    const routingMode = autoSettings.autoModel ? body.routerMode : "manual";
    const routingManualModel = autoSettings.autoModel ? body.manualModel : fallbackManualModel;
    const phaseStake =
      auto.complexity === "complex"
        ? "high"
        : auto.complexity === "simple"
          ? "low"
          : "medium";
    const routeDecision = selectModelForPhase({
      phaseId: "analysis",
      phaseLabel: "Primary response",
      mode: safeMode,
      routerMode: routingMode,
      manualModel: routingManualModel,
      spendingTier: budget.tier,
      thinkingLevel: auto.thinkingLevel,
      stakes: phaseStake,
      messageLength: auto.message.length,
      needsSearch: costGates.searchEnabled,
      hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
      requiredCapabilities: (body.attachmentTypes?.length ?? 0) > 0 ? ["vision"] : [],
      preferredCapabilities: auto.searchEnabled ? ["reasoning", "search"] : ["reasoning"],
      requestClass: auto.requestClass,
      assignmentLevel: auto.assignmentLevel,
      estimatedInputTokens: Math.ceil(auto.message.length / 4) + (body.attachmentTypes?.length ? 700 : 0),
      estimatedOutputTokens:
        auto.assignmentLevel === "L0"
          ? 420
          : auto.assignmentLevel === "L1"
            ? 750
            : auto.assignmentLevel === "L2"
              ? 1300
              : auto.assignmentLevel === "L3"
                ? 1900
                : 2200,
      desiredContextTokens: auto.assignmentLevel === "L4" ? 80_000 : auto.assignmentLevel === "L3" ? 56_000 : 24_000,
      preferLargeContext: auto.assignmentLevel === "L3" || auto.assignmentLevel === "L4" || auto.searchEnabled,
      manualModelConfirmedExpensive: false,
      modelCatalog: catalog,
      modelRuntimeStats: runtimeStatMap,
      seedKey: `dry-run:${actor.clerkId}:${normalizedMessage}`,
    });

    return ok({
      routeTrace: {
        inputs: {
          routerMode: routingMode,
          manualModel: routingManualModel,
          mode: safeMode,
          thinkingLevel: auto.thinkingLevel,
          complexPrompt: auto.complexity === "complex",
          promptCategory: auto.promptCategory,
          questionType: auto.questionType,
          isMultipart: auto.isMultipart,
          needsSearch: costGates.searchEnabled,
          needsRag: costGates.ragEnabled,
          needsVision: (body.attachmentTypes?.length ?? 0) > 0,
          needsTabular: false,
          spendingTier: budget.tier,
          hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
          attachmentTypes: body.attachmentTypes ?? [],
          promptEnhanced: auto.promptEnhanced,
          messageLength: auto.message.length,
          assignmentLevel: auto.assignmentLevel,
          requestClass: auto.requestClass,
          classificationReason: auto.classificationReason,
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
        fallbacks: [],
        routingDurationMs: routeDecision.routingDurationMs,
        phasePlan: [routeDecision.phase],
        subcalls: [],
        assignmentLevel: auto.assignmentLevel,
        requestClass: auto.requestClass,
        classificationReason: auto.classificationReason,
        classifierInput,
        classifierDecision,
        classifierMeta,
        stepsExecuted: pipelineController.getState().completedStages,
        stepsSkipped: pipelineController.getState().skippedStages.map((row) => ({
          step: row.step,
          reason: row.reason,
        })),
        searchStatus: costGates.searchEnabled ? "real_search" : "skipped",
        costBudgetUsd: costGates.costBudgetUsd,
        usageBudgetRemaining: costGates.usageBudgetRemaining,
      },
    });
  });
}
