import {
  openRouterChatCompletion,
  openRouterStreamChat,
  type OpenRouterMessage,
  type OpenRouterReasoningEffort,
  type OpenRouterToolDefinition,
  type OpenRouterUsage,
} from "@/lib/openrouter";
import type { ExecutedToolResult } from "@/lib/orchestrator/tool-executor";
import { executeGraph, synthesize, type TaskNode } from "@/lib/orchestrator/task-graph";
import { getSpecialist } from "@/lib/orchestrator/specialists";
import { runMarkerVerificationPipeline, type VerificationSubcall } from "@/lib/orchestrator/verification";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";
import type { CatalogModelEntry, ModelRuntimeStat } from "@/lib/model-selection";
import type { RouteTraceFallback, SpendingTier } from "@/types";

export function chunkString(value: string, size: number) {
  const chunks = value.match(new RegExp(`.{1,${size}}`, "g"));
  return chunks ?? [];
}

function reasoningEffortForThinkingLevel(
  thinkingLevel: "low" | "medium" | "high" | undefined,
): OpenRouterReasoningEffort | undefined {
  if (!thinkingLevel) return undefined;
  if (thinkingLevel === "high") return "high";
  if (thinkingLevel === "medium") return "medium";
  return "low";
}

function shouldRunToolLoop(params: {
  tools?: OpenRouterToolDefinition[];
  messages: OpenRouterMessage[];
}) {
  if (!params.tools?.length) return false;
  const lastUserMessage = [...params.messages].reverse().find((message) => message.role === "user");
  const content = typeof lastUserMessage?.content === "string"
    ? lastUserMessage.content.toLowerCase()
    : "";
  if (!content) return false;

  const toolNames = new Set(params.tools.map((tool) => tool.function.name));
  if (toolNames.has("search_web") && /\b(latest|recent|today|current|news|look up|search|find online)\b/.test(content)) {
    return true;
  }
  if (toolNames.has("recall_memory") && /\b(remember|previous|before|last time|my preference|my usual|you said)\b/.test(content)) {
    return true;
  }
  if ((toolNames.has("create_note") || toolNames.has("update_planner")) && /\b(note|summary|save this|task|deadline|todo|planner|milestone|remind)\b/.test(content)) {
    return true;
  }
  if (toolNames.has("fork_thread") && /\b(new thread|separate thread|continue elsewhere|research this separately)\b/.test(content)) {
    return true;
  }
  if (toolNames.has("get_workstream_context") && /\b(workstream|subject|project context|what have we done)\b/.test(content)) {
    return true;
  }
  if (toolNames.has("switch_mode") && /\b(quiz me|test me|switch to|research mode|tutor mode)\b/.test(content)) {
    return true;
  }
  if (
    (toolNames.has("create_note") || toolNames.has("surface_result"))
    && /\b(create|make|build|generate|draft|produce|save|export)\b.*\b(note|summary|artifact|worksheet|slides|report|handout|document|deck)\b/.test(content)
  ) {
    return true;
  }
  if (
    toolNames.has("get_workstream_context")
    && /\b(workspace|workstream|planner|artifact|notes|results|hub|panel)\b/.test(content)
  ) {
    return true;
  }
  return false;
}

export async function runAssistantStreaming(params: {
  actorClerkId?: string;
  chatId?: string;
  shouldVerify: boolean;
  thinkingLevel?: "low" | "medium" | "high";
  primaryModel: string;
  fallbackModels: string[];
  verificationModel?: string;
  messages: OpenRouterMessage[];
  maxTokens?: number;
  send: (payload: Record<string, unknown>) => Promise<void>;
  onUsageTokens?: (tokens: number) => void;
  onFallback?: (event: RouteTraceFallback) => void;
  maxContinuations?: number;
  tools?: OpenRouterToolDefinition[];
  executeTool?: (params: { name: string; rawArguments: string }) => Promise<ExecutedToolResult>;
  maxToolRounds?: number;
  stopWhen?: (state: {
    toolRounds: number;
    toolCallsExecuted: number;
    responseText: string;
    finishReason?: string;
  }) => boolean;
  logger?: {
    info: (message: string, context?: Record<string, unknown>) => void;
  };
}) {
  let responseText = "";
  let modelUsed = params.primaryModel;
  let usageIn = 0;
  let usageOut = 0;
  let usage: OpenRouterUsage | undefined;
  let finishReason: string | undefined;
  let truncatedByLength = false;
  let continuationCount = 0;
  let verificationPassed: boolean | undefined;
  let thinkingContent = "";
  let verificationSubcalls: VerificationSubcall[] | undefined;

  const mergeUsage = (base: OpenRouterUsage | undefined, incoming: OpenRouterUsage | undefined): OpenRouterUsage | undefined => {
    if (!incoming) return base;
    const next: OpenRouterUsage = { ...(base ?? {}) };
    const sumField = (key: keyof OpenRouterUsage) => {
      const current = typeof next[key] === "number" ? (next[key] as number) : 0;
      const add = typeof incoming[key] === "number" ? (incoming[key] as number) : 0;
      if (current === 0 && add === 0 && next[key] === undefined && incoming[key] === undefined) {
        return;
      }
      next[key] = Number((current + add).toFixed(6));
    };
    sumField("prompt_tokens");
    sumField("completion_tokens");
    sumField("total_tokens");
    sumField("cost");
    sumField("cached_tokens");
    sumField("cache_creation_input_tokens");
    return next;
  };

  if (!params.shouldVerify) {
    const shouldRunTools = shouldRunToolLoop({
      tools: params.tools,
      messages: params.messages,
    });

    if (shouldRunTools && params.tools?.length && params.executeTool) {
      const workingMessages = [...params.messages];
      const maxToolRounds = Math.max(1, Math.min(6, params.maxToolRounds ?? 4));
      const allowedToolNames = new Set(params.tools.map((tool) => tool.function.name));
      let executedToolCalls = 0;

      for (let toolRound = 0; toolRound < maxToolRounds; toolRound += 1) {
        const completion = await openRouterChatCompletion({
          model: params.primaryModel,
          fallbackModels: params.fallbackModels,
          messages: workingMessages,
          maxTokens: params.maxTokens,
          reasoningEffort: reasoningEffortForThinkingLevel(params.thinkingLevel),
          tools: params.tools,
          toolChoice: "auto",
          onFallback: params.onFallback,
        });

        modelUsed = completion.model ?? modelUsed;
        const roundUsageIn = Math.max(0, completion.usage?.prompt_tokens ?? 0);
        const roundUsageOut = Math.max(0, completion.usage?.completion_tokens ?? 0);
        usageIn += roundUsageIn;
        usageOut += roundUsageOut;
        if (roundUsageIn + roundUsageOut > 0) {
          params.onUsageTokens?.(roundUsageIn + roundUsageOut);
        }
        usage = mergeUsage(usage, completion.usage);
        finishReason = completion.choices?.[0]?.message?.tool_calls?.length ? "tool_calls" : finishReason;
        if (params.actorClerkId) {
          await recordOpenRouterUsage({
            actorClerkId: params.actorClerkId,
            chatId: params.chatId,
            model: completion.model ?? params.primaryModel,
            usage: completion.usage,
          }).catch(() => {});
        }

        const assistantMessage = completion.choices?.[0]?.message;
        const toolCalls = (assistantMessage?.tool_calls ?? []).filter((toolCall) => {
          const name = toolCall.function?.name?.trim();
          return Boolean(name && allowedToolNames.has(name));
        });

        if (toolCalls.length === 0) {
          const finalContent = assistantMessage?.content?.trim() ?? "";
          responseText = finalContent;
          for (const chunk of chunkString(finalContent, 28)) {
            await params.send({ type: "delta", content: chunk });
          }
          break;
        }

        workingMessages.push({
          role: "assistant",
          content: assistantMessage?.content ?? "",
          tool_calls: toolCalls,
        });

        for (const toolCall of toolCalls) {
          const toolName = toolCall.function?.name?.trim();
          if (!toolName) continue;
          const callId = toolCall.id ?? `${toolName}-${toolRound}`;
          await params.send({
            type: "tool_call",
            toolName,
            toolCallId: callId,
            arguments: toolCall.function?.arguments ?? "{}",
          });
          const executed = await params.executeTool({
            name: toolName,
            rawArguments: toolCall.function?.arguments ?? "{}",
          });
          executedToolCalls += 1;
          if (executed.modeSwitch) {
            await params.send({
              type: "mode_switch",
              mode: executed.modeSwitch,
              reason: executed.eventPayload.reason,
            });
            workingMessages.push({
              role: "system",
              content: String(executed.modelPayload.systemInstruction ?? `Switch to ${executed.modeSwitch} mode.`),
            });
          }
          if (executed.threadFork) {
            await params.send({
              type: "thread_fork",
              ...executed.eventPayload,
            });
          }
          await params.send({
            type: "tool_result",
            toolName,
            toolCallId: callId,
            summary: executed.summary,
            result: executed.eventPayload,
          });
          workingMessages.push({
            role: "tool",
            name: toolName,
            tool_call_id: callId,
            content: JSON.stringify(executed.modelPayload),
          });
        }

        if (params.stopWhen?.({
          toolRounds: toolRound + 1,
          toolCallsExecuted: executedToolCalls,
          responseText,
          finishReason,
        })) {
          workingMessages.push({
            role: "system",
            content: "Stop tool use now and produce the final answer using the gathered evidence.",
          });
        }
      }

      return {
        responseText,
        modelUsed,
        usageIn,
        usageOut,
        usage,
        finishReason,
        truncatedByLength,
        continuationCount,
        verificationPassed,
        thinkingContent,
        sourceHints: [] as SearchSourceHint[],
        collaborators: undefined as
          | Array<{ role: string; model: string; tokensUsed: number; durationMs: number }>
          | undefined,
        verificationSubcalls,
      };
    }

    const maxContinuations = Math.max(0, Math.min(4, params.maxContinuations ?? 2));
    let continuationMessages = params.messages;

    while (true) {
      let roundResponse = "";
      let roundFinishReason: string | undefined;
      let roundModelUsed = modelUsed;
      let roundUsageIn = 0;
      let roundUsageOut = 0;
      let roundUsage: OpenRouterUsage | undefined;

      for await (const event of openRouterStreamChat({
        model: params.primaryModel,
        fallbackModels: params.fallbackModels,
        messages: continuationMessages,
        maxTokens: params.maxTokens,
        reasoningEffort: reasoningEffortForThinkingLevel(params.thinkingLevel),
        onFallback: params.onFallback,
      })) {
        if (event.type === "delta") {
          roundResponse += event.content;
          responseText += event.content;
          await params.send({ type: "delta", content: event.content });
        }
        if (event.type === "thinking") {
          thinkingContent += event.content;
          await params.send({ type: "thinking", content: event.content });
        }
        if (event.type === "done") {
          roundModelUsed = event.model ?? roundModelUsed;
          roundUsageIn = event.inputTokens ?? roundUsageIn;
          roundUsageOut = event.outputTokens ?? roundUsageOut;
          roundUsage = event.usage ?? roundUsage;
          roundFinishReason = event.finishReason?.trim() || undefined;
        }
        if (event.type === "error") {
          throw new Error(event.error);
        }
      }

      modelUsed = roundModelUsed;
      usageIn += Math.max(0, roundUsageIn);
      usageOut += Math.max(0, roundUsageOut);
      if (roundUsageIn + roundUsageOut > 0) {
        params.onUsageTokens?.(roundUsageIn + roundUsageOut);
      }
      usage = mergeUsage(usage, roundUsage);
      finishReason = roundFinishReason ?? finishReason;
      if (roundFinishReason === "length") {
        truncatedByLength = true;
      }

      const shouldContinue =
        roundFinishReason === "length" &&
        roundResponse.trim().length > 0 &&
        continuationCount < maxContinuations;
      if (!shouldContinue) break;

      continuationCount += 1;
      await params.send({
        type: "notice",
        message: "Expanding response...",
      });
      continuationMessages = [
        ...continuationMessages,
        { role: "assistant", content: roundResponse },
        { role: "user", content: "Continue from where you stopped. Do not restart, summarize, or repeat prior content unless needed for continuity." },
      ];
    }
  } else {
    const verified = await runMarkerVerificationPipeline({
      actorClerkId: params.actorClerkId,
      chatId: params.chatId,
      primaryModel: params.primaryModel,
      fallbackModels: params.fallbackModels,
      messages: params.messages,
      maxTokens: params.maxTokens,
      verificationModel: params.verificationModel,
      thinkingLevel: params.thinkingLevel,
      onFallback: params.onFallback,
      logger: params.logger,
    });

    responseText = verified.responseText;
    modelUsed = verified.modelUsed;
    usageIn = verified.usageIn;
    usageOut = verified.usageOut;
    usage = verified.usage;
    verificationPassed = verified.verificationPassed;
    verificationSubcalls = verified.subcalls;

    for (const chunk of chunkString(responseText, 24)) {
      await params.send({ type: "delta", content: chunk });
    }
  }

  return {
    responseText,
    modelUsed,
    usageIn,
    usageOut,
    usage,
    finishReason,
    truncatedByLength,
    continuationCount,
    verificationPassed,
    thinkingContent,
    sourceHints: [] as SearchSourceHint[],
    collaborators: undefined as
      | Array<{ role: string; model: string; tokensUsed: number; durationMs: number }>
      | undefined,
    verificationSubcalls,
  };
}

type CollaboratorTrace = {
  role: string;
  model: string;
  tokensUsed: number;
  durationMs: number;
};

type SearchSourceHint = {
  url: string;
  title: string;
  domain: string;
};

function summarizeDependencyResults(nodes: TaskNode[]) {
  const text = nodes
    .map((node) => `${node.role}: ${(node.result ?? "").slice(0, 700)}`)
    .join("\n\n")
    .trim();
  return text || "No dependency output available.";
}

function cleanUrlToken(raw: string) {
  return raw.replace(/[),.;]+$/g, "").trim();
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractSourceHintsFromResult(result: string) {
  const byUrl = new Map<string, SearchSourceHint>();
  const text = result || "";

  for (const match of text.matchAll(/\[([^\]]{2,120})\]\((https?:\/\/[^\s)]+)\)/g)) {
    const title = (match[1] ?? "").trim();
    const url = cleanUrlToken(match[2] ?? "");
    if (!url) continue;
    byUrl.set(url, {
      url,
      title: title || domainFromUrl(url) || "Source",
      domain: domainFromUrl(url),
    });
  }

  for (const match of text.matchAll(/https?:\/\/[^\s)\]]+/g)) {
    const url = cleanUrlToken(match[0] ?? "");
    if (!url || byUrl.has(url)) continue;
    const domain = domainFromUrl(url);
    byUrl.set(url, {
      url,
      title: domain || "Source",
      domain,
    });
  }

  return [...byUrl.values()].slice(0, 8);
}

function buildCriticFallback(params: {
  originalPrompt: string;
  dependencies: TaskNode[];
}) {
  const doneNodes = params.dependencies.filter((node) => node.status === "done" && (node.result ?? "").trim().length > 0);
  if (doneNodes.length === 0) {
    return [
      "- Confidence: low",
      "- Issue: no completed specialist findings were available for detailed audit.",
      "- Suggestion: answer conservatively, acknowledge uncertainty, and request clarification on scope.",
      `- Original prompt anchor: ${params.originalPrompt.slice(0, 180)}`,
    ].join("\n");
  }

  const shortFindings = doneNodes
    .slice(0, 3)
    .map((node) => `- [${node.role}] ${(node.result ?? "").replace(/\s+/g, " ").trim().slice(0, 180)}`)
    .join("\n");

  return [
    "- Confidence: medium",
    "- Audit summary: completed specialist outputs were checked for consistency.",
    "- Potential gap: verify quantitative claims and date-sensitive facts before finalizing.",
    "- Potential gap: explicitly separate established facts from assumptions.",
    "- Corrective action: include one concise uncertainty note in the final response if evidence is partial.",
    "Specialist snapshot:",
    shortFindings,
  ].join("\n");
}

export async function runCollaborativeStreaming(params: {
  actorClerkId?: string;
  chatId?: string;
  graph: TaskNode[];
  originalPrompt: string;
  conversationContext?: string;
  baseSystemPrompt: string;
  primaryModel: string;
  fallbackModels: string[];
  synthesisModel?: string;
  synthesisFallbackModels?: string[];
  catalog?: CatalogModelEntry[];
  modelRuntimeStats?: Record<string, ModelRuntimeStat>;
  spendingTier?: SpendingTier;
  thinkingLevel?: "low" | "medium" | "high";
  maxTokens?: number;
  maxSubcalls?: number;
  maxTokensPerSpecialist?: number;
  maxWallTimeMs?: number;
  usageBudgetTokens?: number;
  budgetOverrunFactor?: number;
  send: (payload: Record<string, unknown>) => Promise<void>;
  onUsageTokens?: (tokens: number) => void;
  onFallback?: (event: RouteTraceFallback) => void;
  maxContinuations?: number;
  logger?: {
    info: (message: string, context?: Record<string, unknown>) => void;
  };
}) {
  const sourceHintsByUrl = new Map<string, SearchSourceHint>();
  const executionGraph = params.graph.filter((node) => node.role !== "synthesizer");
  const collaboratorNodes = executionGraph;
  const specialistModelHistory = new Set<string>();
  await params.send({ type: "collab_start", agents: collaboratorNodes.map((node) => node.role) });
  await params.send({
    type: "thinking",
    content: "Planning specialist workflow.\n\nIdentifying evidence paths and assigning sub-tasks.",
  });

  const executed = await executeGraph(
    executionGraph,
    async (node, dependencies) => {
      const startedAt = Date.now();
      const specialist = getSpecialist(node.role, {
        defaultModel: params.primaryModel,
        fallbackModels: params.fallbackModels,
        catalog: params.catalog,
        runtimeStats: params.modelRuntimeStats,
        spendingTier: params.spendingTier,
        avoidModels: [...specialistModelHistory],
      });
      specialistModelHistory.add(specialist.model);
      node.specialist = specialist.model;
      await params.send({
        type: "agent_summoned",
        agent: node.role,
        model: specialist.model,
        reason: node.prompt.slice(0, 160),
      });
      await params.send({
        type: "collab_progress",
        agent: node.role,
        model: specialist.model,
        status: "running",
        preview: `Running ${node.role.replace(/_/g, " ")} on ${specialist.model}...`,
      });
      await params.send({
        type: "thinking",
        content: `Running ${node.role.replace(/_/g, " ")} specialist.`,
      });

      let result = "";
      let tokens = 0;

      try {
        const completion = await openRouterChatCompletion({
          model: specialist.model,
          fallbackModels: specialist.fallbackModels,
          messages: [
            {
              role: "system",
              content: `${specialist.systemPrompt}\n\nOutput in concise markdown bullets. If uncertain, state confidence.`,
            },
            {
              role: "user",
              content: [
                `Original user prompt:\n${params.originalPrompt}`,
                params.conversationContext
                  ? `Conversation context:\n${params.conversationContext}`
                  : "",
                `Task focus:\n${node.prompt}`,
                `Dependency findings:\n${summarizeDependencyResults(dependencies)}`,
              ].filter(Boolean).join("\n\n"),
            },
          ],
          temperature: 0.2,
          reasoningEffort:
            params.thinkingLevel === "high"
              ? "medium"
              : reasoningEffortForThinkingLevel(params.thinkingLevel),
          maxTokens: Math.min(1800, Math.max(800, params.maxTokens ?? 1800)),
          onFallback: params.onFallback,
        });

        result = completion.choices?.[0]?.message?.content?.trim() ?? "";
        tokens = (completion.usage?.prompt_tokens ?? 0) + (completion.usage?.completion_tokens ?? 0);
        if (params.actorClerkId) {
          await recordOpenRouterUsage({
            actorClerkId: params.actorClerkId,
            chatId: params.chatId,
            model: completion.model ?? specialist.model,
            usage: completion.usage,
          }).catch(() => {});
        }
      } catch (error) {
        if (node.role !== "critic") {
          throw error;
        }
        result = buildCriticFallback({
          originalPrompt: params.originalPrompt,
          dependencies,
        });
        tokens = 0;
      }

      const durationMs = Date.now() - startedAt;
      if (tokens > 0) {
        params.onUsageTokens?.(tokens);
      }
      if (node.role === "web_researcher" || node.role === "fact_checker") {
        for (const hint of extractSourceHintsFromResult(result)) {
          sourceHintsByUrl.set(hint.url, hint);
        }
      }
      await params.send({
        type: "collab_done",
        agent: node.role,
        model: specialist.model,
        tokensUsed: tokens,
        preview: result.slice(0, 120),
      });
      await params.send({
        type: "thinking",
        content: `${node.role.replace(/_/g, " ")} completed. Folding findings into synthesis queue.`,
      });
      return { result, tokens, durationMs };
    },
    {
      maxSubcalls: params.maxSubcalls ?? 4,
      maxTokensPerSpecialist: params.maxTokensPerSpecialist ?? 1200,
      maxWallTimeMs: params.maxWallTimeMs ?? 120_000,
      maxConcurrency: 3,
      usageBudgetTokens: params.usageBudgetTokens,
      budgetOverrunFactor: params.budgetOverrunFactor ?? 1.5,
    },
  );

  for (const node of executed) {
    if (node.status === "failed") {
      await params.send({
        type: "collab_progress",
        agent: node.role,
        status: "failed",
        preview: "Specialist step failed; continuing with available evidence.",
      });
    }
    if (node.status === "skipped") {
      await params.send({
        type: "collab_progress",
        agent: node.role,
        status: "skipped",
        preview: "Skipped to keep response latency and budget within limits.",
      });
    }
  }

  await params.send({ type: "collab_synthesizing" });
  await params.send({
    type: "thinking",
    content: "Synthesizing specialist outputs into one response with cross-source consistency checks.",
  });

  const combinedFindings = synthesize(executed, params.originalPrompt);
  const synthesisStartedAt = Date.now();
  let responseText = "";
  let usageIn = 0;
  let usageOut = 0;
  let usage: OpenRouterUsage | undefined;
  let modelUsed = params.synthesisModel ?? params.primaryModel;
  let finishReason: string | undefined;
  let truncatedByLength = false;
  const mergeUsage = (base: OpenRouterUsage | undefined, incoming: OpenRouterUsage | undefined): OpenRouterUsage | undefined => {
    if (!incoming) return base;
    const next: OpenRouterUsage = { ...(base ?? {}) };
    const sumField = (key: keyof OpenRouterUsage) => {
      const current = typeof next[key] === "number" ? (next[key] as number) : 0;
      const add = typeof incoming[key] === "number" ? (incoming[key] as number) : 0;
      if (current === 0 && add === 0 && next[key] === undefined && incoming[key] === undefined) return;
      next[key] = Number((current + add).toFixed(6));
    };
    sumField("prompt_tokens");
    sumField("completion_tokens");
    sumField("total_tokens");
    sumField("cost");
    sumField("cached_tokens");
    sumField("cache_creation_input_tokens");
    return next;
  };

  const maxContinuations = Math.max(0, Math.min(4, params.maxContinuations ?? 2));
  let continuationCount = 0;
  let continuationMessages: OpenRouterMessage[] = [
    { role: "system", content: params.baseSystemPrompt },
    {
      role: "user",
      content: [
        "Merge these specialist findings into a coherent answer for the user.",
        "Keep evidence grounded and include confidence notes if there were disagreements.",
        params.conversationContext
          ? `Conversation context (must stay consistent):\n${params.conversationContext}`
          : "",
        combinedFindings,
      ].filter(Boolean).join("\n\n"),
    },
  ];

  while (true) {
    let roundResponse = "";
    let roundFinishReason: string | undefined;
    let roundUsageIn = 0;
    let roundUsageOut = 0;
    let roundUsage: OpenRouterUsage | undefined;
    let roundModelUsed = modelUsed;

    for await (const event of openRouterStreamChat({
      model: params.synthesisModel ?? params.primaryModel,
      fallbackModels: params.synthesisFallbackModels ?? params.fallbackModels,
      messages: continuationMessages,
      temperature: 0.2,
      reasoningEffort: reasoningEffortForThinkingLevel(params.thinkingLevel),
      maxTokens: params.maxTokens,
      onFallback: params.onFallback,
    })) {
      if (event.type === "delta") {
        roundResponse += event.content;
        responseText += event.content;
        await params.send({ type: "delta", content: event.content });
      }
      if (event.type === "thinking") {
        await params.send({ type: "thinking", content: event.content });
      }
      if (event.type === "done") {
        roundModelUsed = event.model ?? roundModelUsed;
        roundUsageIn = event.inputTokens ?? roundUsageIn;
        roundUsageOut = event.outputTokens ?? roundUsageOut;
        roundUsage = event.usage ?? roundUsage;
        roundFinishReason = event.finishReason?.trim() || undefined;
      }
      if (event.type === "error") {
        throw new Error(event.error);
      }
    }

    modelUsed = roundModelUsed;
    usageIn += Math.max(0, roundUsageIn);
    usageOut += Math.max(0, roundUsageOut);
    usage = mergeUsage(usage, roundUsage);
    finishReason = roundFinishReason ?? finishReason;
    if (roundFinishReason === "length") {
      truncatedByLength = true;
    }

    const shouldContinue =
      roundFinishReason === "length" &&
      roundResponse.trim().length > 0 &&
      continuationCount < maxContinuations;
    if (!shouldContinue) break;

    continuationCount += 1;
    await params.send({ type: "notice", message: "Expanding response..." });
    continuationMessages = [
      ...continuationMessages,
      { role: "assistant", content: roundResponse },
      { role: "user", content: "Continue from where you stopped. Do not restart, summarize, or repeat prior content unless needed for continuity." },
    ];
  }
  const synthesisDurationMs = Date.now() - synthesisStartedAt;

  if (params.actorClerkId) {
    await recordOpenRouterUsage({
      actorClerkId: params.actorClerkId,
      chatId: params.chatId,
      model: modelUsed,
      usage,
    }).catch(() => {});
  }
  if (usageIn + usageOut > 0) {
    params.onUsageTokens?.(usageIn + usageOut);
  }

  const collaborators: CollaboratorTrace[] = executed
    .filter((node) => node.status !== "skipped")
    .map((node) => {
      return {
        role: node.role,
        model: node.specialist,
        tokensUsed: node.tokens ?? 0,
        durationMs: node.durationMs ?? 0,
      };
    })
    .concat({
      role: "synthesizer",
      model: modelUsed,
      tokensUsed: usageIn + usageOut,
      durationMs: synthesisDurationMs,
    });

  params.logger?.info("multi-agent execution complete", {
    collaboratorCount: collaborators.length,
    synthesisModel: modelUsed,
  });

  return {
    responseText,
    modelUsed,
    usageIn,
    usageOut,
    usage,
    finishReason,
    truncatedByLength,
    continuationCount,
    thinkingContent: "",
    sourceHints: [...sourceHintsByUrl.values()].slice(0, 12),
    verificationPassed: undefined,
    collaborators,
    verificationSubcalls: undefined as VerificationSubcall[] | undefined,
  };
}
