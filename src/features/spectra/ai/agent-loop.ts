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
 * Runs the model/tool/result loop without an arbitrary turn, time, or token
 * limit. It stops only when the model finishes, invokes a terminal tool, the
 * caller aborts, or the exact same ineffective tool call proves a no-progress
 * cycle. The latter is feedback first, failure only after the model ignores the
 * same structured feedback and repeats the identical call again.
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
}) {
  const messages = [...input.messages];
  const repeatedCalls = new Map<string, number>();
  let usage: OpenRouterUsage | undefined;
  let model: string | undefined;
  let provider: string | undefined;
  let turns = 0;

  while (true) {
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    turns += 1;
    const turn = await input.requestTurn(messages, turns);
    input.onTurn?.(turn, turns);
    usage = mergeUsage(usage, turn.usage);
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
          : await input.executeTool(call);
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
