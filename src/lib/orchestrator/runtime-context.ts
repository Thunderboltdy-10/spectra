import type { RoutePlan } from "@/types";
import type { RuntimeContextEnvelope, RuntimeLayeredBudget, RuntimeSurface } from "@/lib/orchestrator/runtime-contract";

function normalizeBlock(block: string | undefined) {
  return block?.trim() ? block.trim() : "";
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function budgetLayer(name: RuntimeLayeredBudget["layers"][number]["name"], requestedTokens: number, appliedText: string, reason: string) {
  const appliedTokens = estimateTokens(appliedText);
  return {
    name,
    requestedTokens,
    appliedTokens,
    included: appliedTokens > 0,
    reason,
  };
}

export function buildRuntimeContextEnvelope(params: {
  routePlan: RoutePlan;
  surface: RuntimeSurface;
  systemPromptParts: string[];
  historyMessages: Array<{ role: string; content: string }>;
  memoryProfile?: string;
  retrievalBlock?: string;
  searchBlock?: string;
  attachmentsBlock?: string;
  workspaceBlock?: string;
}): RuntimeContextEnvelope {
  const tokenBudget = params.routePlan.tokenBudgetTarget;
  const normalizedHistory = params.historyMessages
    .slice(-6)
    .map((message) => `${message.role}: ${normalizeBlock(message.content)}`)
    .filter(Boolean);
  const layers = {
    systemPrompt: params.systemPromptParts.map(normalizeBlock).filter(Boolean),
    history: normalizedHistory,
    memory: [normalizeBlock(params.memoryProfile)].filter(Boolean),
    retrieval: [normalizeBlock(params.retrievalBlock)].filter(Boolean),
    search: [normalizeBlock(params.searchBlock)].filter(Boolean),
    attachments: [normalizeBlock(params.attachmentsBlock)].filter(Boolean),
    workspace: [normalizeBlock(params.workspaceBlock)].filter(Boolean),
  };

  const layeredBudget: RuntimeLayeredBudget = {
    totalBudget: tokenBudget.total,
    reserveOutputTokens: params.routePlan.contextWindowStrategy.estimatedOutputTokens,
    layers: [
      budgetLayer("system", tokenBudget.systemPrompt, layers.systemPrompt.join("\n\n"), "System prompt and policy instructions."),
      budgetLayer("history", Math.max(400, Math.round(tokenBudget.total * 0.18)), layers.history.join("\n"), "Only the most recent turns are carried forward."),
      budgetLayer("memory", tokenBudget.memory, layers.memory.join("\n"), "Durable memory is injected only when route plan enables it."),
      budgetLayer("retrieval", tokenBudget.artifacts, layers.retrieval.join("\n"), "Resource-grounded retrieval context."),
      budgetLayer("search", tokenBudget.search, layers.search.join("\n"), "Search evidence block when route requires current information."),
      budgetLayer("attachments", Math.max(250, Math.round(tokenBudget.total * 0.08)), layers.attachments.join("\n"), "Attachment or vision summaries."),
      budgetLayer("workspace", tokenBudget.artifacts, layers.workspace.join("\n"), "Workspace and artifact scope context."),
    ],
  };

  const topicContinuity = params.routePlan.threadStrategy.topicContinuity;
  const continueThread =
    params.routePlan.threadStrategy.action === "continue"
    && topicContinuity >= 0.68
    && params.routePlan.contextWindowStrategy.contextWindowPressure < 0.82;

  return {
    surface: params.surface,
    layeredBudget,
    continuity: {
      continueThread,
      confidence: continueThread ? params.routePlan.threadStrategy.confidence : Math.max(0.1, 1 - params.routePlan.threadStrategy.confidence),
      reason: continueThread
        ? params.routePlan.threadStrategy.reason
        : "Weak continuity evidence; keep history shallow and avoid sticky semantic carryover.",
    },
    layers,
  };
}
