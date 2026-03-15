import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { runAutoSettingsPipeline } from "@/lib/auto-settings";
import { selectModelForPhase } from "@/lib/routing/phase-router";
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
      needsSearch: auto.searchEnabled,
      hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
      requiredCapabilities: (body.attachmentTypes?.length ?? 0) > 0 ? ["vision"] : [],
      preferredCapabilities: auto.searchEnabled ? ["reasoning", "search"] : ["reasoning"],
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
          needsSearch: auto.searchEnabled,
          needsRag: Boolean(body.usePersonalResources),
          needsVision: (body.attachmentTypes?.length ?? 0) > 0,
          needsTabular: false,
          spendingTier: budget.tier,
          hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
          attachmentTypes: body.attachmentTypes ?? [],
          promptEnhanced: auto.promptEnhanced,
          messageLength: auto.message.length,
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
      },
    });
  });
}
