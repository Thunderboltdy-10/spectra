import type {
  OpenRouterAgentToolCall,
  OpenRouterAgentTurn,
  OpenRouterUsage,
} from "./openrouter-stream";
import { toModelToolResult } from "../tools/execution/tool-result";
import { readSnapshot, stableReadObservation, type ReadSnapshot } from "./read-snapshot";

export type SpectraAgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  /** Internal evidence-envelope marker; stripped before provider transport. */
  contextPreserve?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type AgentLoopCheckpoint = {
  messages: SpectraAgentMessage[];
  turns: number;
  toolCalls: number;
  elapsedMs: number;
  usage?: OpenRouterUsage;
  repeatedCalls: Array<[string, number]>;
  savedResults: Array<[string, unknown]>;
  savedReadResults: Array<[string, ReadSnapshot]>;
  turnsWithoutProgress: number;
  finalizationOnly: boolean;
  stalled: boolean;
  finalizationNudgeAdded: boolean;
  finalizationTurns: number;
  lastFinalizationText: string;
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

/** A semantic stall has already used its local recovery turns, not a provider outage. */
export class SpectraAgentNoProgressError extends Error {
  constructor() {
    super("This attempt stopped after repeated requests made no further progress. Continue in this conversation to retry the remaining work.");
    this.name = "SpectraAgentNoProgressError";
  }
}

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

function callFingerprint(call: OpenRouterAgentToolCall, read = false) {
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
    const parsed = JSON.parse(args);
    // Refresh changes whether to fetch, not which snapshot is being requested.
    // Invalid values must still reach schema validation instead of a cache hit.
    if (read && parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.refresh === "boolean")
      delete parsed.refresh;
    args = JSON.stringify(sortKeys(parsed));
  } catch {
    // The tool executor returns the parse error to the model. Keep the raw
    // arguments in the fingerprint so an actually corrected call is distinct.
  }
  return `${call.name}:${args}`;
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
    checkpoint: AgentLoopCheckpoint,
  ) => Promise<OpenRouterAgentTurn>;
  checkpoint?: {
    initial?: AgentLoopCheckpoint;
    afterTools?: (checkpoint: AgentLoopCheckpoint) => Promise<void>;
  };
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
  const restored = input.checkpoint?.initial;
  const messages = [...(restored?.messages ?? input.messages)];
  const repeatedCalls = new Map<string, number>(restored?.repeatedCalls);
  const savedResults = new Map<string, unknown>(restored?.savedResults);
  const savedReadResults = new Map<string, ReadSnapshot>(restored?.savedReadResults);
  const readRequestVersions = new Map<string, number>();
  const retryableReadFailures = new Set<string>();
  const readObservations = new Set<string>();
  let turnsWithoutProgress = restored?.turnsWithoutProgress ?? 0;
  let usage: OpenRouterUsage | undefined = restored?.usage;
  let model: string | undefined;
  let provider: string | undefined;
  let turns = restored?.turns ?? 0;
  let toolCalls = restored?.toolCalls ?? 0;
  let finalizationOnly = restored?.finalizationOnly ?? false;
  let stalled = restored?.stalled ?? false;
  let finalizationNudgeAdded = restored?.finalizationNudgeAdded ?? false;
  let finalizationTurns = restored?.finalizationTurns ?? 0;
  let lastFinalizationText = restored?.lastFinalizationText ?? "";
  const startedAt = Date.now() - (restored?.elapsedMs ?? 0);
  const checkpoint = (): AgentLoopCheckpoint => ({
    messages, turns, toolCalls, elapsedMs: Date.now() - startedAt, usage,
    repeatedCalls: [...repeatedCalls], savedResults: [...savedResults],
    savedReadResults: [...savedReadResults], turnsWithoutProgress, finalizationOnly,
    stalled, finalizationNudgeAdded, finalizationTurns, lastFinalizationText,
  });
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
    const nudge = `\n\nReliability guardrail: ${reason}. Finish now using the context and tool results already gathered. Do not call any more read or write tools. Give a final response, or use the required terminal tool for an assigned creation or coordination task. Preserve every requested outcome and distinguish staged work from saved results. If the request cannot be completed from existing evidence, say precisely what remains incomplete.`;
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
    if (finalizationOnly && finalizationTurns >= 2) {
      if (stalled) throw new SpectraAgentNoProgressError();
      return {
        text: lastFinalizationText,
        model,
        provider,
        usage,
        turns,
      } satisfies SpectraAgentLoopResult;
    }
    turns += 1;
    if (finalizationOnly) finalizationTurns += 1;
    const turn = await input.requestTurn(messages, turns, checkpoint());
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (finalizationOnly) lastFinalizationText = turn.text;
    input.onTurn?.(turn, turns);
    usage = mergeUsage(usage, turn.usage);
    // Request assembly owns proactive pressure measurement and reduction.
    // A successful provider response is not discarded for its token count.
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

    if (turn.toolCalls.length === 0) {
      if (stalled && !turn.text.trim()) throw new SpectraAgentNoProgressError();
      return {
        text: turn.text,
        model,
        provider,
        usage,
        turns,
      } satisfies SpectraAgentLoopResult;
    }

    messages.push({
      role: "assistant",
      content: turn.text || null,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    let madeProgress = false;
    const executeOne = async (call: OpenRouterAgentToolCall) => {
      if (input.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      if (finalizationOnly)
        return {
          status: 1,
          ok: false,
          code: "finalization_required",
          message:
            "Use the existing results and give your final response. Explain any remaining work accurately.",
        };
      if (toolCalls >= maxToolCalls) {
        enterFinalizationOnly(`its ${maxToolCalls}-tool limit was reached`);
        return {
          status: 1,
          ok: false,
          code: "tool_budget_reached",
          message:
            "No more tools can be called in this run. Use the existing results and give your final response, including any remaining work.",
        };
      }
      toolCalls += 1;
      const isRead = input.isParallelSafeTool?.(call) === true && !input.isMutationTool?.(call);
      let refresh = false;
      if (isRead) {
        try { refresh = JSON.parse(call.arguments)?.refresh === true; }
        catch { /* The executor returns the argument error. */ }
      }
      const fingerprint = callFingerprint(call, isRead);
      const repetition = (repeatedCalls.get(fingerprint) ?? 0) + 1;
      if (!refresh) repeatedCalls.set(fingerprint, repetition);
      if (savedResults.has(fingerprint))
        return savedResults.get(fingerprint);
      // Every explicit refresh reaches the authenticated executor, including
      // successive identical requests. A failed refresh invalidates old reuse.
      if (refresh) savedReadResults.delete(fingerprint);
      const cachedSnapshot = savedReadResults.get(fingerprint);
      if (cachedSnapshot)
        return {
          status: 0,
          ok: true,
          code: "read_result_reused",
          message:
            "Reuse only the earlier snapshot identified here, including its recorded revisions. No fresh data or permissions were checked. Use refresh: true if a new observation is needed.",
          readSnapshot: { ...cachedSnapshot, reused: true },
        };
      // One retry of an explicitly retryable read is useful recovery. Never
      // infer that an unacknowledged mutation is safe to execute again.
      const retryRead = repetition === 2 && retryableReadFailures.delete(fingerprint);
      if (!refresh && repetition === 2 && !retryRead)
        return {
            status: 1,
            ok: false,
            code: "identical_tool_call_repeated",
            error:
              "This exact tool request already returned a result. Use that result, change the request, or finish the task.",
            message:
              "This exact tool request already returned a result. Use that result, change the request, or finish the task.",
          };
      if (!refresh && repetition >= 3)
        return {
          status: 1,
          ok: false,
          code: "identical_tool_call_repeated",
          error:
            "This exact tool request has already been repeated without progress. Use the earlier result or finish the task.",
          message:
            "This exact tool request has already been repeated without progress. Use the earlier result or finish the task.",
        };
      const readVersion = (readRequestVersions.get(fingerprint) ?? 0) + 1;
      if (isRead) readRequestVersions.set(fingerprint, readVersion);
      const observe = (result: unknown) => {
        const normalized = toModelToolResult(result);
        if (isRead) {
          if (normalized.status === 0) {
            const snapshot = readSnapshot(normalized, call.id);
            if (readRequestVersions.get(fingerprint) === readVersion)
              savedReadResults.set(fingerprint, snapshot);
            const observation = callFingerprint({ ...call, arguments: JSON.stringify(stableReadObservation(normalized)) });
            if (!readObservations.has(observation)) madeProgress = true;
            readObservations.add(observation);
            return { ...normalized, readSnapshot: { ...snapshot, reused: false } };
          } else if ("retryable" in normalized && normalized.retryable === true) {
            retryableReadFailures.add(fingerprint);
          }
        } else if (normalized.status === 0) {
          madeProgress = true;
          if (input.isMutationTool?.(call)) savedResults.set(fingerprint, result);
        }
        return result;
      };
      try {
        const result = await input.executeTool(call);
        if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        return observe(result);
      } catch (error) {
        if (input.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
        return observe({ ok: false, code: "tool_execution_failed", retryable: true,
          message: error instanceof Error ? error.message : String(error) });
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
    turnsWithoutProgress = madeProgress ? 0 : turnsWithoutProgress + 1;
    if (!finalizationOnly && turnsWithoutProgress === 2) {
      // Add feedback after the observations, preserving the stable prompt
      // prefix and the complete user request. Writes remain available here.
      messages.push({
        role: "system",
        content: "The last two tool turns added no new information or accepted work. Use the results already available, correct a failed request, or take the next needed action. Continue every unresolved part of the user's request; an accepted operation covers only that operation. If nothing useful remains possible, explain the concrete missing information or failed action. Do not repeat the same retrieval cycle or invent saved results.",
      });
    }
    if (!finalizationOnly && turnsWithoutProgress >= 4) {
      stalled = true;
      enterFinalizationOnly("four consecutive tool turns added no new information or accepted work");
    }
    await input.checkpoint?.afterTools?.(checkpoint());
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  }
}
