import type {
  OpenRouterAgentToolCall,
  OpenRouterAgentTurn,
  OpenRouterUsage,
} from "./openrouter-stream";
import { toModelToolResult } from "../tools/execution/tool-result";

export type SpectraAgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type SpectraAgentLoopResult = {
  terminalTool?: OpenRouterAgentToolCall;
  completedTool?: OpenRouterAgentToolCall;
  text: string;
  model?: string;
  provider?: string;
  usage?: OpenRouterUsage;
  turns: number;
};

function mergeUsage(
  total: OpenRouterUsage | undefined,
  value: OpenRouterUsage | undefined,
) {
  if (!total && !value) return undefined;
  const sum = (left?: number, right?: number) =>
    left === undefined && right === undefined
      ? undefined
      : (left ?? 0) + (right ?? 0);
  return {
    promptTokens: sum(total?.promptTokens, value?.promptTokens),
    promptCacheHitTokens: sum(
      total?.promptCacheHitTokens,
      value?.promptCacheHitTokens,
    ),
    promptCacheMissTokens: sum(
      total?.promptCacheMissTokens,
      value?.promptCacheMissTokens,
    ),
    completionTokens: sum(total?.completionTokens, value?.completionTokens),
    reasoningTokens: sum(total?.reasoningTokens, value?.reasoningTokens),
    totalTokens: sum(total?.totalTokens, value?.totalTokens),
    elapsedMs: sum(total?.elapsedMs, value?.elapsedMs),
  };
}

function callFingerprint(call: OpenRouterAgentToolCall) {
  let args = call.arguments.trim();
  try {
    const sortKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sortKeys);
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, sortKeys(item)]),
      );
    };
    args = JSON.stringify(sortKeys(JSON.parse(args)));
  } catch {
    // The tool executor returns the parse error to the model. Keep the raw
    // arguments in the fingerprint so an actually corrected call is distinct.
  }
  return `${call.name}:${args}`;
}

function readTargetFingerprint(call: OpenRouterAgentToolCall): string | null {
  const targetField =
    call.name === "read_artifact"
      ? "artifactId"
      : call.name === "read_workspace"
        ? "workspaceId"
        : call.name === "read_thread"
          ? "threadId"
          : null;
  if (!targetField) return null;
  try {
    const args = JSON.parse(call.arguments) as Record<string, unknown>;
    const target = args[targetField];
    return typeof target === "string" && target.trim()
      ? `${call.name}:${target.trim()}`
      : null;
  } catch {
    return null;
  }
}

/**
 * Runs the model/tool/result loop under explicit reliability guardrails. These
 * are not commercial quotas: they prevent a malformed agent from consuming
 * resources forever while leaving enough headroom for genuinely complex work.
 * Repeated no-progress calls remain a separate, earlier circuit breaker.
 */
export async function runSpectraAgentLoop(input: {
  messages: SpectraAgentMessage[];
  requestTurn: (
    messages: SpectraAgentMessage[],
    turn: number,
  ) => Promise<OpenRouterAgentTurn>;
  executeTool: (call: OpenRouterAgentToolCall) => Promise<unknown>;
  isParallelSafeTool?: (call: OpenRouterAgentToolCall) => boolean;
  isMutationTool?: (call: OpenRouterAgentToolCall) => boolean;
  isTerminalTool: (call: OpenRouterAgentToolCall) => boolean;
  isCompleteAfterTool?: (
    call: OpenRouterAgentToolCall,
    result: unknown,
  ) => boolean;
  signal?: AbortSignal;
  onTurn?: (turn: OpenRouterAgentTurn, index: number) => void;
  budget?: {
    maxTurns?: number;
    maxToolCalls?: number;
    maxElapsedMs?: number;
    maxTotalTokens?: number;
  };
}) {
  const messages = [...input.messages];
  const repeatedCalls = new Map<string, number>();
  const savedResults = new Map<string, unknown>();
  const savedReadResults = new Map<string, unknown>();
  const readsByTarget = new Map<string, number>();
  let usage: OpenRouterUsage | undefined;
  let model: string | undefined;
  let provider: string | undefined;
  let turns = 0;
  let toolCalls = 0;
  let finalizationOnly = false;
  let finalizationNudgeAdded = false;
  let finalizationTurns = 0;
  let lastFinalizationText = "";
  const startedAt = Date.now();
  const maxTurns = Math.max(4, Math.min(40, input.budget?.maxTurns ?? 24));
  const maxToolCalls = Math.max(
    4,
    Math.min(100, input.budget?.maxToolCalls ?? 60),
  );
  const maxElapsedMs = Math.max(
    30_000,
    Math.min(10 * 60_000, input.budget?.maxElapsedMs ?? 4 * 60_000),
  );
  // maxTotalTokens is a per-turn context-size guard (prompt tokens on one
  // request), not a cumulative spend cap. Summing usage across turns falsely
  // paused focused sheets/document edits once conversation + artifact context
  // was large — the agent still had headroom, but the sum crossed 250k.
  const maxPromptTokens = Math.max(
    20_000,
    Math.min(500_000, input.budget?.maxTotalTokens ?? 250_000),
  );
  // Cumulative spend remains bounded, but loosely — turn/time/tool caps are the
  // primary runaway guards. Four full context windows is enough for complex QC.
  const maxCumulativeTokens = Math.max(
    maxPromptTokens,
    Math.min(2_000_000, maxPromptTokens * 4),
  );

  const enterFinalizationOnly = (reason: string) => {
    finalizationOnly = true;
    if (finalizationNudgeAdded) return;
    const systemMessage = messages.find((message) => message.role === "system");
    const nudge = `\n\nReliability guardrail: ${reason}. Finish now using the context and tool results already gathered. Do not call any more read or write tools. Return one valid terminal plan or the terminal creation tool. If the request cannot be completed from existing evidence, give a concise, honest answer that says what is missing.`;
    if (systemMessage) {
      const index = messages.indexOf(systemMessage);
      messages[index] = {
        ...systemMessage,
        content:
          typeof systemMessage.content === "string"
            ? systemMessage.content + nudge
            : `${String(systemMessage.content)}${nudge}`,
      };
    } else {
      messages.unshift({ role: "system", content: nudge.trim() });
    }
    finalizationNudgeAdded = true;
  };

  while (true) {
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!finalizationOnly && turns >= maxTurns)
      enterFinalizationOnly(`its ${maxTurns}-turn limit was reached`);
    if (!finalizationOnly && Date.now() - startedAt >= maxElapsedMs)
      enterFinalizationOnly("its time limit was reached");
    if (finalizationOnly && finalizationTurns >= 2)
      return {
        text: lastFinalizationText,
        model,
        provider,
        usage,
        turns,
      } satisfies SpectraAgentLoopResult;
    turns += 1;
    if (finalizationOnly) finalizationTurns += 1;
    const turn = await input.requestTurn(messages, turns);
    if (finalizationOnly) lastFinalizationText = turn.text;
    input.onTurn?.(turn, turns);
    usage = mergeUsage(usage, turn.usage);
    const turnPromptTokens = turn.usage?.promptTokens ?? 0;
    if (turnPromptTokens > maxPromptTokens)
      throw new Error(
        "Spectra paused this agent after its reliability context budget. Continue in the thread to resume with a narrower context.",
      );
    if ((usage?.totalTokens ?? 0) > maxCumulativeTokens)
      throw new Error(
        "Spectra paused this agent after its reliability token spend budget. Continue in the thread to resume safely.",
      );
    model = turn.model ?? model;
    provider = turn.provider ?? provider;

    const terminalCalls = turn.toolCalls.filter(input.isTerminalTool);
    const terminal = terminalCalls[0];
    if (terminal && turn.toolCalls.length === 1)
      return {
        terminalTool: terminal,
        text: turn.text,
        model,
        provider,
        usage,
        turns,
      } satisfies SpectraAgentLoopResult;

    if (turn.toolCalls.length === 0)
      return {
        text: turn.text,
        model,
        provider,
        usage,
        turns,
      } satisfies SpectraAgentLoopResult;

    messages.push({
      role: "assistant",
      content: turn.text || null,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    const executeOne = async (call: OpenRouterAgentToolCall) => {
      if (input.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      if (finalizationOnly)
        return {
          status: 1,
          ok: false,
          code: "finalization_required",
          message:
            "Do not call more tools. Use the tool results already in this conversation and return a terminal plan now.",
        };
      if (toolCalls >= maxToolCalls) {
        enterFinalizationOnly(`its ${maxToolCalls}-tool limit was reached`);
        return {
          status: 1,
          ok: false,
          code: "tool_budget_reached",
          message:
            "No more tools can be called in this run. Use the tool results already in this conversation and return a terminal plan now.",
        };
      }
      toolCalls += 1;
      const fingerprint = callFingerprint(call);
      const repetition = (repeatedCalls.get(fingerprint) ?? 0) + 1;
      repeatedCalls.set(fingerprint, repetition);
      if (repetition === 2 && savedResults.has(fingerprint))
        return savedResults.get(fingerprint);
      if (repetition === 2 && savedReadResults.has(fingerprint))
        return {
          status: 0,
          ok: true,
          code: "read_result_reused",
          message:
            "This exact read already returned successfully. Use its earlier result in this conversation; no fresh data was fetched.",
        };
      if (repetition === 2)
        return {
            status: 1,
            ok: false,
            code: "identical_tool_call_repeated",
            error:
              "This exact tool request already returned a result. Use that result, change the request, or finish the task.",
            message:
              "This exact tool request already returned a result. Use that result, change the request, or finish the task.",
          };
      if (repetition >= 3)
        return {
          status: 1,
          ok: false,
          code: "identical_tool_call_repeated",
          error:
            "This exact tool request has already been repeated without progress. Use the earlier result or finish the task.",
          message:
            "This exact tool request has already been repeated without progress. Use the earlier result or finish the task.",
        };
      const readTarget = readTargetFingerprint(call);
      if (readTarget) {
        const previousReads = readsByTarget.get(readTarget) ?? 0;
        if (previousReads >= 3)
          return {
            status: 1,
            ok: false,
            code: "read_target_budget_reached",
            message:
              "This item has already been read three times in this run. Use its existing tool results, make the requested changes, and submit the complete plan. Do not reread this item.",
          };
        readsByTarget.set(readTarget, previousReads + 1);
      }
      try {
        const result = await input.executeTool(call);
        if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const normalized = toModelToolResult(result);
        if (input.isMutationTool?.(call) && normalized.status === 0)
          savedResults.set(fingerprint, result);
        else if (input.isParallelSafeTool?.(call) && normalized.status === 0)
          savedReadResults.set(fingerprint, result);
        return result;
      } catch (error) {
        if (input.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
        return { ok: false, code: "tool_execution_failed", retryable: true,
          message: error instanceof Error ? error.message : String(error) };
      }
    };
    const terminalCallIds = new Set(terminalCalls.map((call) => call.id));
    const terminalCallError = {
      status: 1,
      ok: false,
      code: "terminal_tool_must_be_alone",
      error:
        "A terminal tool must be the only tool call in a turn. Use the other tool results, then retry the terminal tool alone.",
      message:
        "A terminal tool must be the only tool call in a turn. Use the other tool results, then retry the terminal tool alone.",
      retryable: true,
    };
    const mixedMutationCallError = {
      ...terminalCallError,
      code: "terminal_mixed_turn_action_not_executed",
      error:
        "A terminal tool was mixed with a non-read action. The action was not executed; retry it after using the read results and finish with the terminal tool alone.",
      message:
        "A terminal tool was mixed with a non-read action. The action was not executed; retry it after using the read results and finish with the terminal tool alone.",
    };
    let mutationChain = Promise.resolve<unknown>(undefined);
    const results = await Promise.all(
      turn.toolCalls.map((call) => {
        // Do not silently discard sibling reads/actions when a provider emits
        // a terminal call in the same turn. Feed the terminal call a
        // structured correction while still executing the non-terminal calls.
        // The next model turn can then use those results and finish cleanly.
        if (terminalCallIds.has(call.id)) return Promise.resolve(terminalCallError);
        if (terminalCalls.length && !input.isParallelSafeTool?.(call))
          return Promise.resolve(mixedMutationCallError);
        if (input.isParallelSafeTool?.(call)) return executeOne(call);
        const queued = mutationChain.then(() => executeOne(call));
        mutationChain = queued.then(
          () => undefined,
          () => undefined,
        );
        return queued;
      }),
    );
    for (const [index, call] of turn.toolCalls.entries()) {
      const result = toModelToolResult(results[index]);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
      if (turn.toolCalls.length === 1 && input.isCompleteAfterTool?.(call, result))
        return {
          completedTool: call,
          text: turn.text,
          model,
          provider,
          usage,
          turns,
        } satisfies SpectraAgentLoopResult;
    }
  }
}
