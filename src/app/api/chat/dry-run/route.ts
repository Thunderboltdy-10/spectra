import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { runAutoSettingsPipeline } from "@/lib/auto-settings";
import { chooseModelRoute } from "@/lib/routing/heuristic";
import { MODEL_CONFIG } from "@/lib/model-config";
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
    })) as { tier: "normal" | "cheap_only" | "free_only" };

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

    const route = chooseModelRoute({
      mode: safeMode,
      thinkingLevel: auto.thinkingLevel,
      hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
      attachmentTypes: body.attachmentTypes ?? [],
      messageLength: auto.message.length,
      teacherStrictness: "medium",
      routerMode: autoSettings.autoModel ? body.routerMode : "manual",
      manualModel: autoSettings.autoModel ? body.manualModel : body.manualModel ?? MODEL_CONFIG.tutorFast,
      studentSeemsStuck: false,
      spendingTier: budget.tier,
      needsSearch: auto.searchEnabled,
      needsRag: Boolean(body.usePersonalResources),
      promptEnhanced: auto.promptEnhanced,
      promptCategory: auto.promptCategory,
      questionType: auto.questionType,
      isMultipart: auto.isMultipart,
    });

    return ok({ routeTrace: route.trace });
  });
}
