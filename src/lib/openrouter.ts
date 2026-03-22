import { getEnv } from "@/lib/env";
import type { RouteTraceFallback } from "@/types";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.OPENROUTER_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(raw) && raw >= 30_000 && raw <= 300_000) {
    return raw;
  }
  return 90_000;
})();

export type OpenRouterStreamEvent =
  | { type: "delta"; content: string }
  | { type: "thinking"; content: string }
  | {
      type: "done";
      id?: string;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      usage?: OpenRouterUsage;
      finishReason?: string;
      raw?: unknown;
    }
  | { type: "error"; error: string };

export type OpenRouterMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "auto" } };

export type OpenRouterMessage = {
  role: string;
  content: string | OpenRouterMessageContentPart[];
};

export type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

export type OpenRouterChatCompletionResult = {
  id?: string;
  model?: string;
  provider?: string;
  usage?: OpenRouterUsage;
  choices?: Array<{ message?: { content?: string } }>;
  [key: string]: unknown;
};

export type OpenRouterImageResult = {
  imageUrl: string;
  modelUsed: string;
  text?: string;
  usage?: OpenRouterUsage;
  raw?: unknown;
};

function openRouterHeaders() {
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing.");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  };
  if (env.OPENROUTER_APP_NAME) headers["X-Title"] = env.OPENROUTER_APP_NAME;
  if (env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = env.OPENROUTER_SITE_URL;
  return headers;
}

function uniqueModelList(primary: string, fallbackModels: string[]) {
  const set = new Set([primary, ...fallbackModels].filter(Boolean));
  return Array.from(set);
}

function supportsTemperatureControl(model: string) {
  const leaf = model.split("/").pop()?.toLowerCase() ?? model.toLowerCase();
  if (/^o\d/.test(leaf)) return false;
  if (leaf.includes("deep-research")) return false;
  return true;
}

function buildChatCompletionBody(params: {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}) {
  return {
    model: params.model,
    messages: params.messages,
    ...(params.stream ? { stream: true } : {}),
    ...(supportsTemperatureControl(params.model) ? { temperature: params.temperature ?? 0.2 } : {}),
    max_tokens: params.maxTokens,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("Request timed out"), OPENROUTER_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readOpenRouterError(response: Response) {
  const text = await response.text();
  if (!text) return `HTTP ${response.status}`;

  try {
    const parsed = JSON.parse(text) as {
      error?: string | { message?: string };
      message?: string;
    };
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.error?.message === "string") return parsed.error.message;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // OpenRouter may return HTML for missing paths; keep this compact.
  }

  if (/<!doctype html/i.test(text) || /<html/i.test(text)) {
    return `HTTP ${response.status} ${response.statusText || "Not Found"} (non-JSON response)`;
  }

  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

function imageUrlFromCompletionPayload(payload: unknown) {
  const json = payload as {
    choices?: Array<{
      message?: {
        images?: Array<{
          image_url?: string | { url?: string };
          url?: string;
        }>;
        content?: string;
      };
    }>;
    data?: Array<{ url?: string }>;
  };

  const firstImage = json.choices?.[0]?.message?.images?.[0];
  if (typeof firstImage?.image_url === "string") {
    return firstImage.image_url;
  }
  if (typeof firstImage?.image_url?.url === "string") {
    return firstImage.image_url.url;
  }
  if (typeof firstImage?.url === "string") {
    return firstImage.url;
  }
  if (typeof json.data?.[0]?.url === "string") {
    return json.data[0].url;
  }

  const content = json.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    const markdownImage = content.match(/!\[[^\]]*\]\((data:image\/[^\s)]+|https?:\/\/[^\s)]+)\)/i);
    if (markdownImage?.[1]) return markdownImage[1];
    const directUrl = content.match(/(data:image\/[^\s]+|https?:\/\/[^\s]+)/i);
    if (directUrl?.[1]) return directUrl[1];
  }

  return undefined;
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseUsage(payload: unknown): OpenRouterUsage | undefined {
  const raw = (payload as { usage?: Record<string, unknown> } | null)?.usage;
  if (!raw || typeof raw !== "object") return undefined;
  const usage: OpenRouterUsage = {
    prompt_tokens: toFiniteNumber(raw.prompt_tokens),
    completion_tokens: toFiniteNumber(raw.completion_tokens),
    total_tokens: toFiniteNumber(raw.total_tokens),
    cost: toFiniteNumber(raw.cost),
  };
  if (
    usage.prompt_tokens === undefined &&
    usage.completion_tokens === undefined &&
    usage.total_tokens === undefined &&
    usage.cost === undefined
  ) {
    return undefined;
  }
  return usage;
}

export async function openRouterEmbeddingRequest(input: string, model: string) {
  const response = await fetchWithTimeout(`${OPENROUTER_BASE_URL}/embeddings`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model,
      input,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed: ${await response.text()}`);
  }

  const json = (await response.json()) as {
    id?: string;
    model?: string;
    usage?: Record<string, unknown>;
    data?: Array<{ embedding?: number[] }>;
  };

  const embedding = json.data?.[0]?.embedding;
  if (!embedding) {
    throw new Error("Embedding response missing vector data");
  }

  return {
    id: json.id,
    model: json.model ?? model,
    usage: parseUsage(json),
    embedding,
    raw: json,
  };
}

export async function openRouterEmbedding(input: string, model: string) {
  const result = await openRouterEmbeddingRequest(input, model);
  return result.embedding;
}

export async function openRouterChatCompletion(params: {
  model: string;
  fallbackModels: string[];
  messages: OpenRouterMessage[];
  temperature?: number;
  maxTokens?: number;
  onFallback?: (event: RouteTraceFallback) => void;
}): Promise<OpenRouterChatCompletionResult> {
  const candidates = uniqueModelList(params.model, params.fallbackModels);
  const errors: string[] = [];

  for (let idx = 0; idx < candidates.length; idx += 1) {
    const model = candidates[idx]!;

    try {
      const response = await fetchWithTimeout(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: openRouterHeaders(),
        body: JSON.stringify(
          buildChatCompletionBody({
            model,
            messages: params.messages,
            temperature: params.temperature,
            maxTokens: params.maxTokens,
          }),
        ),
      });

      if (!response.ok) {
        const errorText = await response.text();
        errors.push(`${model}: ${errorText}`);
        const toModel = candidates[idx + 1];
        if (toModel) {
          params.onFallback?.({
            fromModel: model,
            toModel,
            error: errorText,
            attemptIndex: idx,
          });
        }
        continue;
      }

      const json = (await response.json()) as OpenRouterChatCompletionResult;
      return {
        ...json,
        usage: parseUsage(json),
      };
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "Unknown model request failure";
      errors.push(`${model}: ${errorText}`);
      const toModel = candidates[idx + 1];
      if (toModel) {
        params.onFallback?.({
          fromModel: model,
          toModel,
          error: errorText,
          attemptIndex: idx,
        });
      }
    }
  }

  throw new Error(`Chat completion failed across fallback models. ${errors.join(" | ")}`);
}

export async function openRouterGenerateImage(params: {
  model: string;
  fallbackModels?: string[];
  prompt: string;
  size?: string;
  onFallback?: (event: RouteTraceFallback) => void;
}): Promise<OpenRouterImageResult> {
  const candidates = uniqueModelList(params.model, params.fallbackModels ?? []);
  const errors: string[] = [];

  for (let idx = 0; idx < candidates.length; idx += 1) {
    const model = candidates[idx]!;
    try {
      const response = await fetchWithTimeout(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: openRouterHeaders(),
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: params.prompt }],
          modalities: ["image", "text"],
          image: { size: params.size ?? "1024x1024" },
        }),
      });

      if (!response.ok) {
        const errorText = await readOpenRouterError(response);
        errors.push(`${model}: ${errorText}`);
        const toModel = candidates[idx + 1];
        if (toModel) {
          params.onFallback?.({
            fromModel: model,
            toModel,
            error: errorText,
            attemptIndex: idx,
          });
        }
        continue;
      }

      const json = (await response.json()) as unknown;
      const imageUrl = imageUrlFromCompletionPayload(json);
      if (!imageUrl) {
        errors.push(`${model}: No image returned in completion payload`);
        const toModel = candidates[idx + 1];
        if (toModel) {
          params.onFallback?.({
            fromModel: model,
            toModel,
            error: "No image returned in completion payload",
            attemptIndex: idx,
          });
        }
        continue;
      }

      const text =
        (json as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content;

      return {
        imageUrl,
        modelUsed: model,
        text: typeof text === "string" ? text : undefined,
        usage: parseUsage(json),
        raw: json,
      };
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "Unknown image generation failure";
      errors.push(`${model}: ${errorText}`);
      const toModel = candidates[idx + 1];
      if (toModel) {
        params.onFallback?.({
          fromModel: model,
          toModel,
          error: errorText,
          attemptIndex: idx,
        });
      }
    }
  }

  throw new Error(`Image generation failed across fallback models. ${errors.join(" | ")}`);
}

export async function* openRouterStreamChat(params: {
  model: string;
  fallbackModels: string[];
  messages: OpenRouterMessage[];
  temperature?: number;
  maxTokens?: number;
  onFallback?: (event: RouteTraceFallback) => void;
}): AsyncGenerator<OpenRouterStreamEvent> {
  const candidates = uniqueModelList(params.model, params.fallbackModels);
  const errors: string[] = [];

  for (let idx = 0; idx < candidates.length; idx += 1) {
    const model = candidates[idx]!;

    try {
      const response = await fetchWithTimeout(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: openRouterHeaders(),
        body: JSON.stringify(
          buildChatCompletionBody({
            model,
            messages: params.messages,
            temperature: params.temperature,
            maxTokens: params.maxTokens,
            stream: true,
          }),
        ),
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        errors.push(`${model}: ${errorText}`);
        const toModel = candidates[idx + 1];
        if (toModel) {
          params.onFallback?.({
            fromModel: model,
            toModel,
            error: errorText,
            attemptIndex: idx,
          });
        }
        continue;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalId: string | undefined;
      let finalModel: string | undefined;
      let usage: OpenRouterUsage | undefined;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let finishReason: string | undefined;
      let visibleOutputChars = 0;
      let raw: unknown;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const json = JSON.parse(data) as {
              id?: string;
              model?: string;
              usage?: Record<string, unknown>;
              choices?: Array<{
                finish_reason?: string;
                delta?: {
                  content?: string;
                  reasoning?: string;
                  reasoning_content?: string;
                  thinking?: string;
                };
                reasoning?: string;
                reasoning_content?: string;
              }>;
              reasoning?: string;
              reasoning_content?: string;
            };

            raw = json;
            if (json.id) {
              finalId = json.id;
            }
            if (json.model) {
              finalModel = json.model;
            }
            const nextUsage = parseUsage(json);
            if (nextUsage) {
              usage = {
                ...usage,
                ...nextUsage,
              };
              inputTokens = nextUsage.prompt_tokens ?? inputTokens;
              outputTokens = nextUsage.completion_tokens ?? outputTokens;
            }

            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              visibleOutputChars += delta.length;
              yield { type: "delta", content: delta };
            }

            const chunkFinishReason = json.choices?.[0]?.finish_reason;
            if (typeof chunkFinishReason === "string" && chunkFinishReason.trim()) {
              finishReason = chunkFinishReason.trim();
            }

            const reasoningDelta =
              json.choices?.[0]?.delta?.reasoning ??
              json.choices?.[0]?.delta?.reasoning_content ??
              json.choices?.[0]?.delta?.thinking ??
              json.choices?.[0]?.reasoning ??
              json.choices?.[0]?.reasoning_content ??
              json.reasoning_content ??
              json.reasoning;
            if (typeof reasoningDelta === "string" && reasoningDelta.trim()) {
              yield { type: "thinking", content: reasoningDelta };
            }
          } catch {
            // Ignore malformed SSE lines from providers.
          }
        }
      }

      const nextModel = candidates[idx + 1];
      const endedByLength = finishReason === "length";
      if (endedByLength && visibleOutputChars === 0 && nextModel) {
        const errorText = `No visible output before length cutoff (${model})`;
        errors.push(`${model}: ${errorText}`);
        params.onFallback?.({
          fromModel: model,
          toModel: nextModel,
          error: errorText,
          attemptIndex: idx,
        });
        continue;
      }

      yield {
        type: "done",
        id: finalId,
        model: finalModel ?? model,
        inputTokens,
        outputTokens,
        usage,
        finishReason,
        raw,
      };
      return;
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "Unknown stream request failure";
      errors.push(`${model}: ${errorText}`);
      const toModel = candidates[idx + 1];
      if (toModel) {
        params.onFallback?.({
          fromModel: model,
          toModel,
          error: errorText,
          attemptIndex: idx,
        });
      }
    }
  }

  yield {
    type: "error",
    error: `OpenRouter stream failed across fallback models. ${errors.join(" | ")}`,
  };
}

export type OpenRouterModel = {
  id: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  architecture?: {
    modality?: string;
  };
  top_provider?: {
    name?: string;
  };
};

export async function fetchOpenRouterModels() {
  const response = await fetchWithTimeout(`${OPENROUTER_BASE_URL}/models`, {
    headers: openRouterHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Model listing failed: ${await response.text()}`);
  }

  const json = (await response.json()) as { data?: OpenRouterModel[] };
  return json.data ?? [];
}
