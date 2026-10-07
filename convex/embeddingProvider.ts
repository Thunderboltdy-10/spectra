/**
 * The one embedding provider for memory and the semantic index.
 *
 * Runs in the default Convex runtime (no Node), so search actions stay fast. The model comes from
 * `SPECTRA_EMBEDDING_MODEL` (read in ./env); only the vector size is fixed here, because every
 * vector index is declared with it. Every vector is stamped with `embeddingVersion()`.
 */
import { getEmbeddingModelSetting, getOpenRouterApiKey } from "./env";
import { EMBEDDING_DIMENSIONS } from "./embeddingDimensions";

export { EMBEDDING_DIMENSIONS };
/** Whole inputs only: anything larger is rejected, never truncated. Always under 8191 tokens. */
export const EMBEDDING_INPUT_MAX_BYTES = 8_000;
export const EMBEDDING_BATCH_SIZE = 32;

const ENDPOINT = "https://openrouter.ai/api/v1/embeddings";
const RESPONSE_BASE_BYTES = 16_384;
const RESPONSE_BYTES_PER_INPUT = 8_192;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_CAPACITY = 128;

export type EmbeddingFailure = "not_configured" | "missing_key" | "input_too_large" | "timeout" | "network" |
  "rate_limited" | "provider_unavailable" | "provider_rejected" | "invalid_response" | "dimension_mismatch";
export const EMBEDDING_FAILURES: readonly EmbeddingFailure[] = ["not_configured", "missing_key", "input_too_large",
  "timeout", "network", "rate_limited", "provider_unavailable", "provider_rejected", "invalid_response",
  "dimension_mismatch"];
export type EmbeddingFailureResult = { ok: false; code: EmbeddingFailure; retryable: boolean };
export type EmbeddingBatchResult = { ok: true; vectors: number[][]; version: string } | EmbeddingFailureResult;
export type QueryEmbeddingResult = { ok: true; vector: number[]; version: string; cacheHit: boolean } |
  (EmbeddingFailureResult & { cacheHit: false });

export type EmbeddingConfig = { model: string; provider: string | null; dimensions: number; version: string };

/** `null` when no model is configured: callers serve full-text results only. */
export function embeddingConfig(): EmbeddingConfig | null {
  const setting = getEmbeddingModelSetting();
  if (!setting) return null;
  const { model, provider } = setting;
  const [vendor, ...rest] = model.split("/");
  // Keeps the historic memory stamp (`openrouter:OpenAI:text-embedding-3-small:256:v1`) stable.
  const modelPart = provider && rest.length && vendor.toLowerCase() === provider.toLowerCase() ? rest.join("/") : model;
  return { model, provider, dimensions: EMBEDDING_DIMENSIONS,
    version: `openrouter:${provider ?? "any"}:${modelPart}:${EMBEDDING_DIMENSIONS}:v1` };
}

export function embeddingVersion() {
  return embeddingConfig()?.version ?? null;
}

export function validEmbeddingVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === EMBEDDING_DIMENSIONS &&
    value.every((number) => typeof number === "number" && Number.isFinite(number)) &&
    value.some((number) => number !== 0);
}

export function embeddingInputFits(text: string) {
  return text.length <= EMBEDDING_INPUT_MAX_BYTES &&
    new TextEncoder().encode(text).byteLength <= EMBEDDING_INPUT_MAX_BYTES;
}

export type EmbeddingRequestOptions = {
  key?: string | null;
  /** Total attempts; 2 retries once with backoff. Durable jobs that own their retries pass 1. */
  attempts?: number;
  timeoutMs?: number;
  /** Interactive queries do not retry a timeout: they fall back to full-text instead of waiting. */
  retryTimeouts?: boolean;
  backoffMs?: number;
};

let warnedDimension = "";

/** Embeds `texts` in order, in batches of 32. All or nothing: one failed batch fails the call. */
export async function requestEmbeddings(texts: string[], options: EmbeddingRequestOptions = {}): Promise<EmbeddingBatchResult> {
  const config = embeddingConfig();
  if (!config) return { ok: false, code: "not_configured", retryable: false };
  if (texts.some((text) => !text.trim())) return { ok: false, code: "provider_rejected", retryable: false };
  if (texts.some((text) => !embeddingInputFits(text))) return { ok: false, code: "input_too_large", retryable: false };
  const key = options.key === undefined ? getOpenRouterApiKey() : options.key;
  if (!key) return { ok: false, code: "missing_key", retryable: false };
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
    const attempts = Math.max(1, Math.min(3, options.attempts ?? 2));
    let result: EmbeddingBatchResult = { ok: false, code: "network", retryable: true };
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      result = await requestBatch(batch, config, key, options.timeoutMs ?? 10_000);
      if (result.ok || !result.retryable || attempt === attempts) break;
      if (result.code === "timeout" && !options.retryTimeouts) break;
      const backoff = (options.backoffMs ?? 500) * attempt * (0.75 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
    if (!result.ok) return result;
    vectors.push(...result.vectors);
  }
  return { ok: true, vectors, version: config.version };
}

async function requestBatch(texts: string[], config: EmbeddingConfig, key: string, timeoutMs: number): Promise<EmbeddingBatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let receivedResponse = false;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model, dimensions: config.dimensions,
        input: texts.length === 1 ? texts[0] : texts, encoding_format: "float",
        ...(config.provider ? { provider: { only: [config.provider], order: [config.provider], allow_fallbacks: false } } : {}),
      }),
    });
    receivedResponse = true;
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false,
        code: response.status === 429 ? "rate_limited" : response.status >= 500 ? "provider_unavailable" : "provider_rejected",
        retryable: response.status === 429 || response.status >= 500,
      };
    }
    const body = await boundedJson(response, RESPONSE_BASE_BYTES + texts.length * RESPONSE_BYTES_PER_INPUT);
    const modelName = config.model.split("/").pop();
    if ((config.provider && body.provider !== config.provider) ||
      (body.model !== config.model && body.model !== modelName) || !Array.isArray(body.data) ||
      body.data.length !== texts.length)
      return { ok: false, code: "invalid_response", retryable: false };
    const vectors: number[][] = new Array(texts.length);
    for (const item of body.data as Array<{ index?: unknown; embedding?: unknown }>) {
      const index = item?.index;
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= texts.length || vectors[index])
        return { ok: false, code: "invalid_response", retryable: false };
      if (Array.isArray(item.embedding) && item.embedding.length !== config.dimensions) {
        if (warnedDimension !== config.version) {
          warnedDimension = config.version;
          console.error(`[embeddings] ${config.model} returned ${item.embedding.length} dimensions; ` +
            `the indexes are declared with ${config.dimensions}. Choose a SPECTRA_EMBEDDING_MODEL that supports ` +
            `${config.dimensions}-dimension output.`);
        }
        return { ok: false, code: "dimension_mismatch", retryable: false };
      }
      if (!validEmbeddingVector(item.embedding)) return { ok: false, code: "invalid_response", retryable: false };
      vectors[index] = item.embedding;
    }
    return { ok: true, vectors, version: config.version };
  } catch {
    return { ok: false,
      code: controller.signal.aborted ? "timeout" : receivedResponse ? "invalid_response" : "network",
      retryable: controller.signal.aborted || !receivedResponse,
    };
  } finally { clearTimeout(timer); }
}

async function boundedJson(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("response_size");
  if (!response.body) throw new Error("missing_body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("response_size");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(joined)) as Record<string, unknown>;
}

/** Vector-only, per-isolate LRU. Keyed by caller scope, model version and the exact query text. */
export class QueryVectorCache {
  private entries = new Map<string, { expiresAt: number; vector: number[] }>();

  get(scope: string, query: string, version: string, now = Date.now()) {
    const key = JSON.stringify([scope, version, query]);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= now) return undefined;
    this.entries.set(key, entry);
    return [...entry.vector];
  }

  put(scope: string, query: string, vector: number[], version: string, now = Date.now()) {
    const key = JSON.stringify([scope, version, query]);
    this.entries.delete(key);
    for (const [entryKey, entry] of this.entries)
      if (entry.expiresAt <= now) this.entries.delete(entryKey);
    while (this.entries.size >= CACHE_CAPACITY)
      this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { expiresAt: now + CACHE_TTL_MS, vector: [...vector] });
  }
}

const queryCache = new QueryVectorCache();

/**
 * Embeds one interactive query. Bounded for latency: a 3 s timeout that is not retried, one quick
 * retry for rate limits and network errors, and a cached vector for repeated text.
 */
export async function embedQuery(scope: string, text: string, options: EmbeddingRequestOptions = {}): Promise<QueryEmbeddingResult> {
  const config = embeddingConfig();
  if (!config) return { ok: false, code: "not_configured", retryable: false, cacheHit: false };
  const cached = queryCache.get(scope, text, config.version);
  if (cached) return { ok: true, vector: cached, version: config.version, cacheHit: true };
  const result = await requestEmbeddings([text], { timeoutMs: 3_000, attempts: 2, backoffMs: 150, ...options });
  if (!result.ok) return { ...result, cacheHit: false };
  queryCache.put(scope, text, result.vectors[0], result.version);
  return { ok: true, vector: result.vectors[0], version: result.version, cacheHit: false };
}
