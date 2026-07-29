import type {
  OpenRouterAgentToolCall,
  OpenRouterAgentTurn,
  OpenRouterUsage,
} from "./openrouter-stream";

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
    args = JSON.stringify(JSON.parse(args));
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
  ) => Promise<OpenRouterAgentTurn>;
  executeTool: (call: OpenRouterAgentToolCall) => Promise<unknown>;
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
  let usage: OpenRouterUsage | undefined;
  let model: string | undefined;
  let provider: string | undefined;
  let turns = 0;
  let toolCalls = 0;
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

  while (true) {
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (turns >= maxTurns)
      throw new Error(
        `Spectra stopped this agent after ${maxTurns} model turns without a completed result. Continue in the thread to resume with the preserved context.`,
      );
    if (Date.now() - startedAt >= maxElapsedMs)
      throw new Error(
        "Spectra paused this agent after its reliability time budget. Continue in the thread to resume safely.",
      );
    turns += 1;
    const turn = await input.requestTurn(messages, turns);
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

    const terminal = turn.toolCalls.find(input.isTerminalTool);
    if (terminal)
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

    for (const call of turn.toolCalls) {
      toolCalls += 1;
      if (toolCalls > maxToolCalls)
        throw new Error(
          `Spectra stopped this agent after ${maxToolCalls} tool calls without a completed result. Continue in the thread to resume safely.`,
        );
      const fingerprint = callFingerprint(call);
      const repetition = (repeatedCalls.get(fingerprint) ?? 0) + 1;
      repeatedCalls.set(fingerprint, repetition);
      if (repetition >= 3)
        throw new Error(
          `Spectra stopped after the agent repeated the identical ${call.name} request without making progress.`,
        );
      const result =
        repetition === 2
          ? {
              ok: false,
              code: "identical_tool_call_repeated",
              message:
                "This exact tool request already returned a result. Use that result, change the request, or finish the task.",
            }
          : await (async () => {
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                return await Promise.race([
                  input.executeTool(call),
                  new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                      reject(
                        Object.assign(
                          new Error(
                            `Spectra paused because ${call.name} took too long. Continue with what you already have, or finish the plan now.`,
                          ),
                          { code: "tool_timeout" },
                        ),
                      );
                    }, 20_000);
                  }),
                ]);
              } catch (error) {
                if (
                  error &&
                  typeof error === "object" &&
                  "code" in error &&
                  (error as { code?: string }).code === "tool_timeout"
                ) {
                  return {
                    ok: false,
                    code: "tool_timeout",
                    message:
                      error instanceof Error
                        ? error.message
                        : `${call.name} timed out.`,
                  };
                }
                throw error;
              } finally {
                if (timer) clearTimeout(timer);
              }
            })();
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
      if (input.isCompleteAfterTool?.(call, result))
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
