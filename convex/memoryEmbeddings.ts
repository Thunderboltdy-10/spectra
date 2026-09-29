"use node";

import { getEncoding } from "js-tiktoken";
import { v } from "convex/values";
import { internalAction } from "./functions";
import { internal } from "./_generated/api";
import { getOpenRouterApiKey } from "./env";
import {
  MEMORY_EMBEDDING_DIMENSIONS,
  MEMORY_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_VERSION,
  MEMORY_QUERY_MAX_TOKENS,
  memoryQueryFitsBytes,
  validMemoryVector,
  type MemoryEmbeddingResult,
} from "./memoryEmbeddingPolicy";

const ENDPOINT = "https://openrouter.ai/api/v1/embeddings";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 32_768;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_CAPACITY = 128;

let encoder: ReturnType<typeof getEncoding> | undefined;

/** Vector-only, per-process cache. Authority and result documents are never cached. */
export class QueryVectorCache {
  private entries = new Map<string, { expiresAt: number; vector: number[] }>();

  get(accountId: string, query: string, version = MEMORY_EMBEDDING_VERSION, now = Date.now()) {
    const key = JSON.stringify([accountId, version, query]);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= now) return undefined;
    this.entries.set(key, entry);
    return [...entry.vector];
  }

  put(accountId: string, query: string, vector: number[], version = MEMORY_EMBEDDING_VERSION, now = Date.now()) {
    const key = JSON.stringify([accountId, version, query]);
    this.entries.delete(key);
    for (const [entryKey, entry] of this.entries)
      if (entry.expiresAt <= now) this.entries.delete(entryKey);
    while (this.entries.size >= CACHE_CAPACITY)
      this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { expiresAt: now + CACHE_TTL_MS, vector: [...vector] });
  }
}

const queryCache = new QueryVectorCache();

async function boundedJson(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES)
    throw new Error("response_size");
  if (!response.body) throw new Error("missing_body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("response_size");
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

/** One network attempt. The durable job owns retries; query failure falls back immediately. */
export async function requestMemoryEmbedding(text: string, key = getOpenRouterApiKey()): Promise<MemoryEmbeddingResult> {
  if (!memoryQueryFitsBytes(text)) return { ok: false, code: "query_too_large", retryable: false };
  encoder ??= getEncoding("cl100k_base");
  if (encoder.encode(text, [], []).length > MEMORY_QUERY_MAX_TOKENS)
    return { ok: false, code: "query_too_large", retryable: false };
  if (!key) return { ok: false, code: "missing_key", retryable: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let receivedResponse = false;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MEMORY_EMBEDDING_MODEL, dimensions: MEMORY_EMBEDDING_DIMENSIONS,
        input: text, encoding_format: "float",
        provider: { only: ["OpenAI"], order: ["OpenAI"], allow_fallbacks: false },
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
    const body = await boundedJson(response);
    const data = body.data;
    if (body.provider !== "OpenAI" ||
      (body.model !== "text-embedding-3-small" && body.model !== MEMORY_EMBEDDING_MODEL) ||
      !Array.isArray(data) || data.length !== 1 || data[0]?.index !== 0 ||
      !validMemoryVector(data[0]?.embedding))
      return { ok: false, code: "invalid_response", retryable: false };
    return { ok: true, vector: data[0].embedding };
  } catch {
    return { ok: false,
      code: controller.signal.aborted ? "timeout" : receivedResponse ? "invalid_response" : "network",
      retryable: controller.signal.aborted || !receivedResponse,
    };
  } finally { clearTimeout(timer); }
}

export const queryVector = internalAction({
  args: { accountId: v.id("accounts"), queryText: v.string() },
  handler: async (_ctx, args): Promise<MemoryEmbeddingResult> => {
    if (!memoryQueryFitsBytes(args.queryText)) return { ok: false, code: "query_too_large", retryable: false };
    const cached = queryCache.get(args.accountId, args.queryText);
    if (cached) return { ok: true, vector: cached, cacheHit: true };
    const result = await requestMemoryEmbedding(args.queryText);
    if (result.ok) queryCache.put(args.accountId, args.queryText, result.vector);
    return { ...result, cacheHit: false };
  },
});

export const generate = internalAction({
  args: { jobId: v.id("memoryJobs"), leaseOwner: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const input = await ctx.runQuery(internal.memory.embeddingInput, args);
    if (!input) {
      await ctx.runMutation(internal.memory.completeEmbedding, { ...args, error: "source_unavailable", retryable: false });
      return;
    }
    const result = await requestMemoryEmbedding(input.proposition);
    await ctx.runMutation(internal.memory.completeEmbedding, {
      ...args,
      ...(result.ok ? { vector: result.vector } : { error: result.code, retryable: result.retryable }),
    });
  },
});
