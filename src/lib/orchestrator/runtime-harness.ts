import type { OpenRouterMessage, OpenRouterToolDefinition } from "@/lib/openrouter";
import type { ExecutedToolResult } from "@/lib/orchestrator/tool-executor";
import { runAssistantStreaming, runCollaborativeStreaming } from "@/lib/orchestrator/streaming";
import { type RuntimeEvent, type RuntimeSurface } from "@/lib/orchestrator/runtime-contract";
import type { CatalogModelEntry } from "@/lib/model-selection";
import type { RouteTraceFallback, RuntimeExecutionPath } from "@/types";

type StreamedRuntimeResult = Awaited<ReturnType<typeof runAssistantStreaming>>;
type CollaborativeRuntimeResult = Awaited<ReturnType<typeof runCollaborativeStreaming>>;

export type RuntimeHarnessParams =
  | {
      mode: "assistant";
      actorClerkId?: string;
      chatId?: string;
      shouldVerify: boolean;
      thinkingLevel?: "low" | "medium" | "high";
      primaryModel: string;
      fallbackModels: string[];
      verificationModel?: string;
      messages: OpenRouterMessage[];
      maxTokens?: number;
      maxContinuations?: number;
      executionPath?: RuntimeExecutionPath;
      tools?: OpenRouterToolDefinition[];
      executeTool?: (params: { name: string; rawArguments: string }) => Promise<ExecutedToolResult>;
      maxToolRounds?: number;
      stopWhen?: Parameters<typeof runAssistantStreaming>[0]["stopWhen"];
      logger?: Parameters<typeof runAssistantStreaming>[0]["logger"];
      onUsageTokens?: (tokens: number) => void;
      onFallback?: (event: RouteTraceFallback) => void;
      emit: (event: RuntimeEvent) => Promise<void>;
      surface: RuntimeSurface;
    }
  | {
      mode: "collaborative";
      actorClerkId?: string;
      chatId?: string;
      graph: Parameters<typeof runCollaborativeStreaming>[0]["graph"];
      originalPrompt: string;
      conversationContext: string;
      baseSystemPrompt: string;
      primaryModel: string;
      fallbackModels: string[];
      synthesisModel: string;
      synthesisFallbackModels: string[];
      catalog?: CatalogModelEntry[];
      modelRuntimeStats?: Record<string, { successCount: number; failureCount: number; avgLatencyMs?: number }>;
      spendingTier: Parameters<typeof runCollaborativeStreaming>[0]["spendingTier"];
      thinkingLevel?: "low" | "medium" | "high";
      maxTokens?: number;
      maxContinuations?: number;
      maxSubcalls?: number;
      maxTokensPerSpecialist?: number;
      maxWallTimeMs?: number;
      usageBudgetTokens?: number;
      budgetOverrunFactor?: number;
      onUsageTokens?: (tokens: number) => void;
      onFallback?: (event: RouteTraceFallback) => void;
      logger?: Parameters<typeof runCollaborativeStreaming>[0]["logger"];
      emit: (event: RuntimeEvent) => Promise<void>;
      surface: RuntimeSurface;
    };

export async function runRuntimeHarness(
  params: RuntimeHarnessParams,
): Promise<StreamedRuntimeResult | CollaborativeRuntimeResult> {
  const emit = async (event: RuntimeEvent) => {
    await params.emit(event);
  };

  if (params.mode === "assistant") {
    return runAssistantStreaming({
      actorClerkId: params.actorClerkId,
      chatId: params.chatId,
      shouldVerify: params.shouldVerify,
      thinkingLevel: params.thinkingLevel,
      primaryModel: params.primaryModel,
      fallbackModels: params.fallbackModels,
      verificationModel: params.verificationModel,
      messages: params.messages,
      maxTokens: params.maxTokens,
      maxContinuations: params.maxContinuations,
      executionPath: params.executionPath,
      tools: params.tools,
      executeTool: params.executeTool,
      maxToolRounds: params.maxToolRounds,
      stopWhen: params.stopWhen,
      logger: params.logger,
      onUsageTokens: params.onUsageTokens,
      onFallback: params.onFallback,
      send: async (payload) => {
        await emit(payload as RuntimeEvent);
      },
    });
  }

  return runCollaborativeStreaming({
    actorClerkId: params.actorClerkId,
    chatId: params.chatId,
    graph: params.graph,
    originalPrompt: params.originalPrompt,
    conversationContext: params.conversationContext,
    baseSystemPrompt: params.baseSystemPrompt,
    primaryModel: params.primaryModel,
    fallbackModels: params.fallbackModels,
    synthesisModel: params.synthesisModel,
    synthesisFallbackModels: params.synthesisFallbackModels,
    catalog: params.catalog,
    modelRuntimeStats: params.modelRuntimeStats,
    spendingTier: params.spendingTier,
    thinkingLevel: params.thinkingLevel,
    maxTokens: params.maxTokens,
    maxContinuations: params.maxContinuations,
    maxSubcalls: params.maxSubcalls,
    maxTokensPerSpecialist: params.maxTokensPerSpecialist,
    maxWallTimeMs: params.maxWallTimeMs,
    usageBudgetTokens: params.usageBudgetTokens,
    budgetOverrunFactor: params.budgetOverrunFactor,
    logger: params.logger,
    onUsageTokens: params.onUsageTokens,
    onFallback: params.onFallback,
    send: async (payload) => {
      await emit(payload as RuntimeEvent);
    },
  });
}
