import { getEnv } from "@/lib/env";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_TIMEOUT_MS = 30_000;

export type OpenRouterStreamEvent =
  | { type: "delta"; content: string }
  | {
      type: "done";
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      raw?: unknown;
    }
  | { type: "error"; error: string };

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

export async function openRouterEmbedding(input: string, model: string) {
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
    data?: Array<{ embedding?: number[] }>;
  };

  const embedding = json.data?.[0]?.embedding;
  if (!embedding) {
    throw new Error("Embedding response missing vector data");
  }
  return embedding;
}

export async function openRouterChatCompletion(params: {
  model: string;
  fallbackModels: string[];
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
}) {
  const candidates = uniqueModelList(params.model, params.fallbackModels);
  const errors: string[] = [];

  for (const model of candidates) {
    const response = await fetchWithTimeout(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: openRouterHeaders(),
      body: JSON.stringify({
        model,
        messages: params.messages,
        temperature: params.temperature ?? 0.2,
      }),
    });

    if (!response.ok) {
      errors.push(`${model}: ${await response.text()}`);
      continue;
    }

    return response.json() as Promise<{
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices?: Array<{ message?: { content?: string } }>;
    }>;
  }

  throw new Error(`Chat completion failed across fallback models. ${errors.join(" | ")}`);
}

export async function* openRouterStreamChat(params: {
  model: string;
  fallbackModels: string[];
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
}): AsyncGenerator<OpenRouterStreamEvent> {
  const candidates = uniqueModelList(params.model, params.fallbackModels);
  const errors: string[] = [];

  for (const model of candidates) {
    const response = await fetchWithTimeout(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: openRouterHeaders(),
      body: JSON.stringify({
        model,
        messages: params.messages,
        stream: true,
        temperature: params.temperature ?? 0.2,
      }),
    });

    if (!response.ok || !response.body) {
      errors.push(`${model}: ${await response.text()}`);
      continue;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalModel: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
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
            model?: string;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
            choices?: Array<{ delta?: { content?: string } }>;
          };

          raw = json;
          if (json.model) {
            finalModel = json.model;
          }
          if (json.usage) {
            inputTokens = json.usage.prompt_tokens ?? inputTokens;
            outputTokens = json.usage.completion_tokens ?? outputTokens;
          }

          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            yield { type: "delta", content: delta };
          }
        } catch {
          // Ignore malformed SSE lines from providers.
        }
      }
    }

    yield {
      type: "done",
      model: finalModel ?? model,
      inputTokens,
      outputTokens,
      raw,
    };
    return;
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
