export type OpenRouterUsage = {
  promptTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  elapsedMs?: number;
};

export type OpenRouterPlanResult = {
  text: string;
  model?: string;
  provider?: string;
  usage?: OpenRouterUsage;
};

export type OpenRouterAgentToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type OpenRouterAgentTurn = OpenRouterPlanResult & {
  toolCalls: OpenRouterAgentToolCall[];
  finishReason?: string;
};

function decodePartialJsonString(source: string, start: number) {
  let value = "";
  let complete = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"') {
      complete = true;
      break;
    }
    if (character !== "\\") {
      value += character;
      continue;
    }
    const escape = source[index + 1];
    if (escape === undefined) break;
    index += 1;
    if (escape === "n") value += "\n";
    else if (escape === "r") value += "\r";
    else if (escape === "t") value += "\t";
    else if (escape === "b") value += "\b";
    else if (escape === "f") value += "\f";
    else if (escape === "u") {
      const hex = source.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
    } else value += escape;
  }
  return { value, complete };
}

export function extractPartialJsonStringField(source: string, field: string) {
  const match = new RegExp(`"${field}"\\s*:\\s*"`).exec(source);
  if (!match) return { value: "", complete: false, found: false };
  const start = match.index + match[0].length;
  return { ...decodePartialJsonString(source, start), found: true };
}

export function extractCompleteJsonArrayItems(source: string, field: string) {
  const match = new RegExp(`"${field}"\\s*:\\s*\\[`).exec(source);
  if (!match) return [] as unknown[];
  const values: unknown[] = [];
  let itemStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = match.index + match[0].length; index < source.length; index += 1) {
    const character = source[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "{") {
      if (depth === 0) itemStart = index;
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0 && itemStart >= 0) {
        try { values.push(JSON.parse(source.slice(itemStart, index + 1))); } catch { /* incomplete item */ }
        itemStart = -1;
      }
      continue;
    }
    if (character === "]" && depth === 0) break;
  }
  return values;
}

function normalizeUsage(value: unknown, elapsedMs: number): OpenRouterUsage | undefined {
  if (!value || typeof value !== "object") return elapsedMs > 0 ? { elapsedMs } : undefined;
  const usage = value as Record<string, unknown>;
  const details = usage.completion_tokens_details && typeof usage.completion_tokens_details === "object"
    ? usage.completion_tokens_details as Record<string, unknown>
    : {};
  return {
    promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
    promptCacheHitTokens:
      typeof usage.prompt_cache_hit_tokens === "number"
        ? usage.prompt_cache_hit_tokens
        : usage.prompt_tokens_details &&
            typeof usage.prompt_tokens_details === "object" &&
            typeof (usage.prompt_tokens_details as Record<string, unknown>).cached_tokens === "number"
          ? (usage.prompt_tokens_details as Record<string, number>).cached_tokens
          : undefined,
    promptCacheMissTokens:
      typeof usage.prompt_cache_miss_tokens === "number"
        ? usage.prompt_cache_miss_tokens
        : undefined,
    completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined,
    reasoningTokens: typeof details.reasoning_tokens === "number" ? details.reasoning_tokens : undefined,
    totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
    elapsedMs,
  };
}

function containsCompleteJsonObject(source: string) {
  const start = source.indexOf("{");
  if (start < 0) return false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const value = JSON.parse(source.slice(start, index + 1));
          return Boolean(value && typeof value === "object" && !Array.isArray(value));
        } catch { return false; }
      }
    }
  }
  return false;
}

export class ProviderStreamStalledError extends Error {
  readonly providerLabel: string;
  readonly timeoutMs: number;

  constructor(timeoutMs: number, providerLabel = "OpenAI") {
    super(
      `The current ${providerLabel} route produced no meaningful stream data for ${Math.round(timeoutMs / 1_000)} seconds.`,
    );
    this.name = "ProviderStreamStalledError";
    this.providerLabel = providerLabel;
    this.timeoutMs = timeoutMs;
  }
}

/** Display label for stall copy; prefer the live OpenRouter `provider` field. */
export function formatProviderStallLabel(
  provider?: string | null,
  fallback = "OpenAI",
) {
  const value = provider?.trim();
  if (!value) return fallback;
  if (/^deepseek$/i.test(value)) return "DeepSeek";
  if (/^baidu$/i.test(value)) return "Baidu";
  if (/^streamlake$/i.test(value)) return "StreamLake";
  if (/^deepinfra$/i.test(value)) return "DeepInfra";
  return value;
}

/**
 * Stream health is about whether the route is still emitting traffic, not only
 * user-visible content. Reasoning deltas, tool-argument fragments, empty role
 * heartbeats, and SSE comment keep-alives all prove the provider is alive.
 */
export function streamEventIsMeaningful(input: {
  line?: string;
  delta?: Record<string, unknown> | null;
  chunk?: Record<string, unknown> | null;
  pendingJsonContinued?: boolean;
}) {
  const line = input.line?.trim() ?? "";
  if (line.startsWith(":")) return true;
  if (input.pendingJsonContinued) return true;
  const delta = input.delta;
  if (delta) {
    if (typeof delta.content === "string" && delta.content) return true;
    if (typeof delta.reasoning === "string" && delta.reasoning) return true;
    if (Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0)
      return true;
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0)
      return true;
    if (
      "role" in delta ||
      "content" in delta ||
      "reasoning" in delta ||
      "reasoning_details" in delta ||
      "tool_calls" in delta
    )
      return true;
  }
  const chunk = input.chunk;
  if (chunk) {
    if (chunk.usage) return true;
    if (typeof chunk.provider === "string" && chunk.provider) return true;
    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    if (choices.length > 0) return true;
  }
  return false;
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  lastMeaningfulAt: number,
  idleTimeoutMs?: number,
  providerLabel = "OpenAI",
) {
  if (!idleTimeoutMs) return reader.read();
  const remaining = Math.max(1, idleTimeoutMs - (Date.now() - lastMeaningfulAt));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ProviderStreamStalledError(idleTimeoutMs, providerLabel)),
          remaining,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof ProviderStreamStalledError)
      await reader.cancel("provider stream stalled").catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readOpenRouterResponse(
  response: Response,
  onPublicText?: (delta: string) => void,
  onReasoningText?: (delta: string) => void,
  onPlanText?: (text: string) => void,
  idleTimeoutMs?: number,
  providerLabelHint = "OpenAI",
): Promise<OpenRouterPlanResult> {
  const startedAt = Date.now();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || payload.error) {
      const error = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : null;
      throw new Error(typeof error?.message === "string" ? error.message : `The model request failed (${response.status}).`);
    }
    const choices = Array.isArray(payload.choices) ? payload.choices as Array<Record<string, unknown>> : [];
    const message = choices[0]?.message && typeof choices[0].message === "object" ? choices[0].message as Record<string, unknown> : {};
    const content = message.content;
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls as Array<Record<string, unknown>> : [];
    const toolFunction = toolCalls[0]?.function && typeof toolCalls[0].function === "object" ? toolCalls[0].function as Record<string, unknown> : {};
    const toolArguments = typeof toolFunction.arguments === "string" ? toolFunction.arguments : "";
    const contentText = typeof content === "string" ? content : Array.isArray(content)
      ? content.map((part) => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string" ? (part as Record<string, unknown>).text : "").join("")
      : "";
    const text = toolArguments || contentText;
    const extracted = extractPartialJsonStringField(text, "finalResponse");
    if (extracted.value) onPublicText?.(extracted.value);
    onPlanText?.(text);
    return {
      text,
      model: typeof payload.model === "string" ? payload.model : undefined,
      provider: typeof payload.provider === "string" ? payload.provider : undefined,
      usage: normalizeUsage(payload.usage, Date.now() - startedAt),
    };
  }

  if (!response.body) throw new Error("OpenRouter returned an empty stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let emittedLength = 0;
  let model: string | undefined;
  let provider: string | undefined;
  let rawUsage: unknown;
  let toolArguments = "";
  let pendingJsonPayload = "";
  let trailingError: Error | undefined;
  let lastMeaningfulAt = Date.now();
  while (true) {
    const stallLabel = formatProviderStallLabel(provider, providerLabelHint);
    const { value, done } = await readStreamChunk(
      reader,
      lastMeaningfulAt,
      idleTimeoutMs,
      stallLabel,
    );
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (streamEventIsMeaningful({ line })) {
        lastMeaningfulAt = Date.now();
        continue;
      }
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") {
        if (raw === "[DONE]") lastMeaningfulAt = Date.now();
        continue;
      }
      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(pendingJsonPayload + raw) as Record<string, unknown>;
        pendingJsonPayload = "";
      } catch {
        // A provider may split one SSE JSON event across multiple `data:`
        // records. Preserve it for the next record. If the next record is a
        // complete standalone event, discard only the malformed fragment and
        // continue the authoritative stream instead of failing the whole run.
        if (pendingJsonPayload) {
          try {
            chunk = JSON.parse(raw) as Record<string, unknown>;
            pendingJsonPayload = "";
          } catch {
            pendingJsonPayload += raw;
            if (streamEventIsMeaningful({ pendingJsonContinued: true }))
              lastMeaningfulAt = Date.now();
            continue;
          }
        } else {
          pendingJsonPayload = raw;
          if (streamEventIsMeaningful({ pendingJsonContinued: true }))
            lastMeaningfulAt = Date.now();
          continue;
        }
      }
      if (typeof chunk.model === "string") model = chunk.model;
      if (typeof chunk.provider === "string") provider = chunk.provider;
      if (chunk.usage) rawUsage = chunk.usage;
      const choices = Array.isArray(chunk.choices) ? chunk.choices as Array<Record<string, unknown>> : [];
      const delta = choices[0]?.delta && typeof choices[0].delta === "object" ? choices[0].delta as Record<string, unknown> : {};
      if (streamEventIsMeaningful({ delta, chunk })) lastMeaningfulAt = Date.now();
      if (typeof delta.content === "string") {
        text += delta.content;
        onPlanText?.(text);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const toolCall of delta.tool_calls) {
          if (!toolCall || typeof toolCall !== "object") continue;
          const fn = (toolCall as Record<string, unknown>).function;
          if (!fn || typeof fn !== "object") continue;
          const args = (fn as Record<string, unknown>).arguments;
          if (typeof args !== "string") continue;
          toolArguments += args;
          text = toolArguments;
          onPlanText?.(text);
        }
      }
      if (typeof delta.reasoning === "string") {
        onReasoningText?.(delta.reasoning);
      }
      if (Array.isArray(delta.reasoning_details)) {
        for (const detail of delta.reasoning_details) {
          if (detail && typeof detail === "object" && typeof (detail as Record<string, unknown>).text === "string")
            onReasoningText?.((detail as Record<string, unknown>).text as string);
        }
      }
      const publicText = extractPartialJsonStringField(text, "finalResponse").value;
      if (publicText.length > emittedLength) {
        onPublicText?.(publicText.slice(emittedLength));
        emittedLength = publicText.length;
      }
      const error = chunk.error && typeof chunk.error === "object" ? chunk.error as Record<string, unknown> : null;
      if (error) {
        trailingError = new Error(typeof error.message === "string" ? error.message : "The model stream failed.");
        break;
      }
    }
    if (done || trailingError) break;
  }
  // Some routed providers append an error envelope after successfully
  // streaming the complete structured response. The response can be fenced or
  // have trailing transport text, so inspect the balanced JSON object rather
  // than requiring the entire raw stream to be directly parseable.
  if (trailingError) {
    const hasPlanFields = text.includes('"operations"') && text.includes('"finalResponse"');
    const hasCompleteOperations = extractCompleteJsonArrayItems(text, "operations").length > 0
      || /"operations"\s*:\s*\[\s*\]/.test(text);
    if (!containsCompleteJsonObject(text) && !(hasPlanFields && hasCompleteOperations)) throw trailingError;
  }
  return { text, model, provider, usage: normalizeUsage(rawUsage, Date.now() - startedAt) };
}

// Agent turns must preserve tool-call identity. Concatenating every streamed
// function argument into one JSON string (which is acceptable for the legacy
// single-plan tool) makes a real multi-tool loop impossible: parallel reads,
// one-operation mutations, and tool-result correlation all lose their
// boundaries. This parser is the transport boundary for the iterative harness.
export async function readOpenRouterAgentTurn(
  response: Response,
  onText?: (delta: string) => void,
  onReasoningText?: (delta: string) => void,
  onToolArguments?: (call: OpenRouterAgentToolCall) => void,
  idleTimeoutMs?: number,
  providerLabelHint = "OpenAI",
): Promise<OpenRouterAgentTurn> {
  const startedAt = Date.now();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok || payload.error) {
      const error = payload.error && typeof payload.error === "object"
        ? (payload.error as Record<string, unknown>)
        : null;
      throw new Error(
        typeof error?.message === "string"
          ? error.message
          : `The model request failed (${response.status}).`,
      );
    }
    const choices = Array.isArray(payload.choices)
      ? (payload.choices as Array<Record<string, unknown>>)
      : [];
    const choice = choices[0] ?? {};
    const message = choice.message && typeof choice.message === "object"
      ? (choice.message as Record<string, unknown>)
      : {};
    const text = typeof message.content === "string" ? message.content : "";
    if (text) onText?.(text);
    const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
      .flatMap((value, index) => {
        if (!value || typeof value !== "object") return [];
        const row = value as Record<string, unknown>;
        const fn = row.function && typeof row.function === "object"
          ? (row.function as Record<string, unknown>)
          : {};
        if (typeof fn.name !== "string") return [];
        const call = {
          id: typeof row.id === "string" ? row.id : `call-${index + 1}`,
          name: fn.name,
          arguments: typeof fn.arguments === "string" ? fn.arguments : "{}",
        };
        onToolArguments?.(call);
        return [call];
      });
    return {
      text,
      toolCalls,
      finishReason:
        typeof choice.finish_reason === "string"
          ? choice.finish_reason
          : undefined,
      model: typeof payload.model === "string" ? payload.model : undefined,
      provider:
        typeof payload.provider === "string" ? payload.provider : undefined,
      usage: normalizeUsage(payload.usage, Date.now() - startedAt),
    };
  }

  if (!response.body) throw new Error("OpenRouter returned an empty stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, OpenRouterAgentToolCall>();
  let buffer = "";
  let pendingJsonPayload = "";
  let text = "";
  let model: string | undefined;
  let provider: string | undefined;
  let finishReason: string | undefined;
  let rawUsage: unknown;
  let trailingError: Error | undefined;
  let lastMeaningfulAt = Date.now();
  while (true) {
    const stallLabel = formatProviderStallLabel(provider, providerLabelHint);
    const { value, done } = await readStreamChunk(
      reader,
      lastMeaningfulAt,
      idleTimeoutMs,
      stallLabel,
    );
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (streamEventIsMeaningful({ line })) {
        lastMeaningfulAt = Date.now();
        continue;
      }
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") {
        if (raw === "[DONE]") lastMeaningfulAt = Date.now();
        continue;
      }
      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(pendingJsonPayload + raw) as Record<string, unknown>;
        pendingJsonPayload = "";
      } catch {
        // OpenRouter-compatible routes occasionally emit one malformed fragment
        // and then resume with a complete standalone event. Do not poison the
        // remainder of the agent turn by concatenating every later event onto
        // that fragment; prefer the authoritative standalone event when it is
        // valid, while still supporting genuinely split data records.
        if (pendingJsonPayload) {
          try {
            chunk = JSON.parse(raw) as Record<string, unknown>;
            pendingJsonPayload = "";
          } catch {
            pendingJsonPayload += raw;
            if (streamEventIsMeaningful({ pendingJsonContinued: true }))
              lastMeaningfulAt = Date.now();
            continue;
          }
        } else {
          pendingJsonPayload = raw;
          if (streamEventIsMeaningful({ pendingJsonContinued: true }))
            lastMeaningfulAt = Date.now();
          continue;
        }
      }
      if (typeof chunk.model === "string") model = chunk.model;
      if (typeof chunk.provider === "string") provider = chunk.provider;
      if (chunk.usage) rawUsage = chunk.usage;
      const choices = Array.isArray(chunk.choices)
        ? (chunk.choices as Array<Record<string, unknown>>)
        : [];
      const choice = choices[0] ?? {};
      if (typeof choice.finish_reason === "string")
        finishReason = choice.finish_reason;
      const delta = choice.delta && typeof choice.delta === "object"
        ? (choice.delta as Record<string, unknown>)
        : {};
      if (streamEventIsMeaningful({ delta, chunk })) lastMeaningfulAt = Date.now();
      if (typeof delta.content === "string") {
        text += delta.content;
        onText?.(delta.content);
      }
      if (typeof delta.reasoning === "string") {
        onReasoningText?.(delta.reasoning);
      }
      if (Array.isArray(delta.reasoning_details)) {
        for (const detail of delta.reasoning_details) {
          if (
            detail &&
            typeof detail === "object" &&
            typeof (detail as Record<string, unknown>).text === "string"
          )
            onReasoningText?.(
              (detail as Record<string, unknown>).text as string,
            );
        }
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const value of delta.tool_calls) {
          if (!value || typeof value !== "object") continue;
          const row = value as Record<string, unknown>;
          const index = typeof row.index === "number" ? row.index : 0;
          const previous = calls.get(index) ?? {
            id: `call-${index + 1}`,
            name: "",
            arguments: "",
          };
          const fn = row.function && typeof row.function === "object"
            ? (row.function as Record<string, unknown>)
            : {};
          const nameDelta = typeof fn.name === "string" ? fn.name : "";
          const nextName = !nameDelta
            ? previous.name
            : !previous.name || nameDelta.startsWith(previous.name)
              ? nameDelta
              : previous.name.endsWith(nameDelta)
                ? previous.name
                : `${previous.name}${nameDelta}`;
          const next = {
            id:
              typeof row.id === "string" && row.id
                ? row.id
                : previous.id,
            name:
              nextName,
            arguments:
              typeof fn.arguments === "string"
                ? `${previous.arguments}${fn.arguments}`
                : previous.arguments,
          };
          calls.set(index, next);
          onToolArguments?.(next);
        }
      }
      const error = chunk.error && typeof chunk.error === "object"
        ? (chunk.error as Record<string, unknown>)
        : null;
      if (error) {
        trailingError = new Error(
          typeof error.message === "string"
            ? error.message
            : "The model stream failed.",
        );
        break;
      }
    }
    if (done || trailingError) break;
  }
  if (trailingError && !text && calls.size === 0) throw trailingError;
  return {
    text,
    toolCalls: [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => call)
      .filter((call) => call.name),
    finishReason,
    model,
    provider,
    usage: normalizeUsage(rawUsage, Date.now() - startedAt),
  };
}
