import {
  allowSpectraProviderFallbacks,
  assertPrimarySpectraRouting,
  getSpectraFallbackModelId,
  getSpectraModelProfile,
  getSpectraProviderRouting,
  getSpectraReasoningProfile,
  type SpectraReasoningProfile,
} from "../model-config";
import {
  ProviderStreamStalledError,
  readOpenRouterAgentTurn,
} from "../openrouter-stream";
import type { ModelCaller } from "./loop";
import {
  ProviderUnavailableError,
  type HarnessMessage,
  type ModelTurn,
  type ProviderToolSpec,
} from "./types";

/*
 * The OpenRouter client for the harness. The model, provider and reasoning
 * level come only from model-config (the environment). The single approved
 * exception is the caption writer, which asks for `low` reasoning explicitly.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PRIMARY_ATTEMPTS = 3;
const FALLBACK_ATTEMPTS = 2;
/** A provider-health threshold: no meaningful bytes for this long. */
const STREAM_IDLE_TIMEOUT_MS = 90_000;

export type ModelRequest = {
  messages: HarnessMessage[];
  tools?: ProviderToolSpec[];
  toolChoice?: "auto" | "none";
  signal: AbortSignal;
  onText?: (delta: string) => void;
  onRetry?: () => void;
  /** Only the caption writer passes this ("low"); everything else uses the environment. */
  reasoning?: SpectraReasoningProfile;
  maxTokens?: number;
  responseFormat?: Record<string, unknown>;
  title?: string;
};

class RetryableProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RetryableProviderError";
  }
}

function apiKey() {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key)
    throw new ProviderUnavailableError("OpenRouter is not configured for Spectra runs.");
  return key;
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function attempt(
  request: ModelRequest,
  route: "primary" | "fallback",
): Promise<ModelTurn> {
  const profile = getSpectraModelProfile();
  const provider = getSpectraProviderRouting(route);
  if (route === "primary") assertPrimarySpectraRouting(provider);
  const body: Record<string, unknown> = {
    model: route === "fallback" ? getSpectraFallbackModelId() : profile.route,
    reasoning: {
      effort: request.reasoning ?? getSpectraReasoningProfile(),
      exclude: true,
    },
    stream: true,
    stream_options: { include_usage: true },
    provider,
    messages: request.messages,
    ...(request.tools?.length
      ? { tools: request.tools, tool_choice: request.toolChoice ?? "auto" }
      : {}),
    ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
    ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
  };
  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        "X-OpenRouter-Title": request.title ?? "Spectra",
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    throw new RetryableProviderError(
      error instanceof Error ? error.message : "The model request failed.",
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const message = `The model request failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`;
    // 4xx other than rate limits and timeouts are request problems; another
    // attempt on the same route cannot fix them, the fallback route might.
    throw new RetryableProviderError(message, response.status);
  }
  try {
    const turn = await readOpenRouterAgentTurn(
      response,
      request.onText,
      undefined,
      undefined,
      STREAM_IDLE_TIMEOUT_MS,
    );
    return {
      text: turn.text,
      toolCalls: turn.toolCalls.map((call, index) => ({
        id: call.id || `call_${index + 1}`,
        name: call.name,
        arguments: call.arguments || "{}",
      })),
      finishReason: turn.finishReason,
      model: turn.model,
      provider: turn.provider,
      usage: turn.usage,
    };
  } catch (error) {
    if (request.signal.aborted) throw error;
    if (error instanceof ProviderStreamStalledError)
      throw new RetryableProviderError(error.message);
    throw new RetryableProviderError(
      error instanceof Error ? error.message : "The model stream failed.",
    );
  }
}

function retryableOnSameRoute(error: unknown) {
  if (!(error instanceof RetryableProviderError)) return false;
  const status = error.status;
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

/** One model turn with retries and the configured recovery route. */
export async function callSpectraModel(request: ModelRequest): Promise<ModelTurn> {
  let lastError: unknown;
  let streamed = false;
  const tracked: ModelRequest = {
    ...request,
    onText: (delta) => {
      streamed = true;
      request.onText?.(delta);
    },
  };
  const routes: Array<["primary" | "fallback", number]> = [
    ["primary", PRIMARY_ATTEMPTS],
    ...(allowSpectraProviderFallbacks()
      ? ([["fallback", FALLBACK_ATTEMPTS]] as Array<["fallback", number]>)
      : []),
  ];
  for (const [route, attempts] of routes) {
    for (let index = 0; index < attempts; index += 1) {
      if (request.signal.aborted) throw request.signal.reason;
      if (streamed) {
        streamed = false;
        request.onRetry?.();
      }
      try {
        return await attempt(tracked, route);
      } catch (error) {
        if (request.signal.aborted) throw error;
        if (error instanceof ProviderUnavailableError) throw error;
        lastError = error;
        if (!retryableOnSameRoute(error)) break;
        await delay(Math.min(4_000, 500 * 2 ** index), request.signal);
      }
    }
  }
  if (streamed) request.onRetry?.();
  throw new ProviderUnavailableError(
    "Spectra could not reach the AI model after several tries.",
    lastError,
  );
}

export const openRouterModelCaller: ModelCaller = (input) =>
  callSpectraModel({
    messages: input.messages,
    tools: input.tools,
    toolChoice: input.toolChoice,
    signal: input.signal,
    onText: input.onText,
    onRetry: input.onRetry,
  });

let contextWindowCache: { model: string; tokens: number } | null = null;

/**
 * The configured model's context window, read from OpenRouter's model list
 * once per process. SPECTRA_MODEL_CONTEXT_TOKENS overrides it.
 */
export async function spectraModelContextWindow(signal?: AbortSignal): Promise<number> {
  const configured = Number(process.env.SPECTRA_MODEL_CONTEXT_TOKENS);
  if (Number.isFinite(configured) && configured > 8_000) return configured;
  const model = getSpectraModelProfile().route;
  if (contextWindowCache?.model === model) return contextWindowCache.tokens;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", { signal });
    const payload = (await response.json()) as { data?: Array<{ id?: string; context_length?: number }> };
    const found = payload.data?.find((entry) => entry.id === model)?.context_length;
    if (typeof found === "number" && found > 8_000) {
      contextWindowCache = { model, tokens: found };
      return found;
    }
  } catch {
    // Fall through to a conservative window.
  }
  return 128_000;
}
