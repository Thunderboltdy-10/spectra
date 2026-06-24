export type OpenRouterUsage = {
  promptTokens?: number;
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

function normalizeUsage(value: unknown, elapsedMs: number): OpenRouterUsage | undefined {
  if (!value || typeof value !== "object") return elapsedMs > 0 ? { elapsedMs } : undefined;
  const usage = value as Record<string, unknown>;
  const details = usage.completion_tokens_details && typeof usage.completion_tokens_details === "object"
    ? usage.completion_tokens_details as Record<string, unknown>
    : {};
  return {
    promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
    completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined,
    reasoningTokens: typeof details.reasoning_tokens === "number" ? details.reasoning_tokens : undefined,
    totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
    elapsedMs,
  };
}

export async function readOpenRouterResponse(
  response: Response,
  onPublicText?: (delta: string) => void,
  onReasoningText?: (delta: string) => void,
): Promise<OpenRouterPlanResult> {
  const startedAt = Date.now();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const payload = await response.json() as Record<string, unknown>;
    const choices = Array.isArray(payload.choices) ? payload.choices as Array<Record<string, unknown>> : [];
    const message = choices[0]?.message && typeof choices[0].message === "object" ? choices[0].message as Record<string, unknown> : {};
    const content = message.content;
    const text = typeof content === "string" ? content : Array.isArray(content)
      ? content.map((part) => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string" ? (part as Record<string, unknown>).text : "").join("")
      : "";
    const extracted = extractPartialJsonStringField(text, "finalResponse");
    if (extracted.value) onPublicText?.(extracted.value);
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
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      const chunk = JSON.parse(raw) as Record<string, unknown>;
      if (typeof chunk.model === "string") model = chunk.model;
      if (typeof chunk.provider === "string") provider = chunk.provider;
      if (chunk.usage) rawUsage = chunk.usage;
      const choices = Array.isArray(chunk.choices) ? chunk.choices as Array<Record<string, unknown>> : [];
      const delta = choices[0]?.delta && typeof choices[0].delta === "object" ? choices[0].delta as Record<string, unknown> : {};
      if (typeof delta.content === "string") text += delta.content;
      if (typeof delta.reasoning === "string") onReasoningText?.(delta.reasoning);
      if (Array.isArray(delta.reasoning_details)) {
        for (const detail of delta.reasoning_details) {
          if (detail && typeof detail === "object" && typeof (detail as Record<string, unknown>).text === "string") onReasoningText?.((detail as Record<string, unknown>).text as string);
        }
      }
      const publicText = extractPartialJsonStringField(text, "finalResponse").value;
      if (publicText.length > emittedLength) {
        onPublicText?.(publicText.slice(emittedLength));
        emittedLength = publicText.length;
      }
      const error = chunk.error && typeof chunk.error === "object" ? chunk.error as Record<string, unknown> : null;
      if (error) throw new Error(typeof error.message === "string" ? error.message : "The model stream failed.");
    }
    if (done) break;
  }
  return { text, model, provider, usage: normalizeUsage(rawUsage, Date.now() - startedAt) };
}
