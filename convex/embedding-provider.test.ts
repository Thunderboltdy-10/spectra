import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_DIMENSIONS, QueryVectorCache, embedQuery, embeddingConfig, embeddingVersion, requestEmbeddings,
} from "./embeddingProvider";

const vector = Array.from({ length: 256 }, (_, index) => index === 0 ? 1 : 0);
const body = (count = 1) => ({ model: "text-embedding-3-small", provider: "OpenAI",
  data: Array.from({ length: count }, (_, index) => ({ index, embedding: vector })) });
const KEY = { key: "synthetic-test" };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("embedding configuration", () => {
  it("reads the model and provider from the environment and keeps the historic version stamp", () => {
    expect(embeddingConfig()).toEqual({ model: "openai/text-embedding-3-small", provider: "OpenAI",
      dimensions: 256, version: "openrouter:OpenAI:text-embedding-3-small:256:v1" });
    vi.stubEnv("SPECTRA_EMBEDDING_MODEL", "qwen/qwen3-embedding-8b");
    vi.stubEnv("SPECTRA_EMBEDDING_PROVIDER", "");
    expect(embeddingVersion()).toBe("openrouter:any:qwen/qwen3-embedding-8b:256:v1");
  });

  it("disables vectors without a model and never calls the provider", async () => {
    vi.stubEnv("SPECTRA_EMBEDDING_MODEL", "");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(embeddingVersion()).toBeNull();
    expect(await requestEmbeddings(["text"], KEY)).toEqual({ ok: false, code: "not_configured", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("bounded embedding provider requests", () => {
  it("requests the configured model, provider and dimensions and accepts a validated vector", async () => {
    const fetcher = vi.fn(async () => Response.json(body()));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestEmbeddings(["Reflector material"], KEY)).toEqual({ ok: true, vectors: [vector],
      version: "openrouter:OpenAI:text-embedding-3-small:256:v1" });
    const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(request[0]).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(JSON.parse(request[1].body as string)).toMatchObject({
      model: "openai/text-embedding-3-small", dimensions: EMBEDDING_DIMENSIONS, input: "Reflector material",
      provider: { only: ["OpenAI"], allow_fallbacks: false },
    });
  });

  it("leaves routing to OpenRouter when no provider is pinned", async () => {
    vi.stubEnv("SPECTRA_EMBEDDING_PROVIDER", "");
    const fetcher = vi.fn(async () => Response.json({ ...body(), provider: "Azure" }));
    vi.stubGlobal("fetch", fetcher);
    expect((await requestEmbeddings(["text"], KEY)).ok).toBe(true);
    const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(request[1].body as string).provider).toBeUndefined();
  });

  it("batches 32 inputs per request and returns vectors in input order", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(init.body as string).input as string[];
      return Response.json({ model: "text-embedding-3-small", provider: "OpenAI",
        data: input.map((text, index) => ({ index, embedding: vector.map((n, i) => i === 1 ? Number(text) + 1 : n) })).reverse() });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await requestEmbeddings(Array.from({ length: 40 }, (_, index) => String(index)), KEY);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.ok && result.vectors.map((item) => item[1])).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
  });

  it("fails clearly when the model returns a different vector size", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...body(), data: [{ index: 0, embedding: [1, 2, 3] }] })));
    expect(await requestEmbeddings(["text"], KEY)).toEqual({ ok: false, code: "dimension_mismatch", retryable: false });
    expect(String(error.mock.calls[0]?.[0])).toContain("returned 3 dimensions");
    error.mockRestore();
  });

  it.each(["model", "provider", "nonfinite", "zero", "count", "index", "duplicate"])("rejects a mismatched %s response", async (field) => {
    const response: Record<string, unknown> = body(field === "duplicate" ? 2 : 1);
    if (field === "model") response.model = "different-model";
    if (field === "provider") response.provider = "different-provider";
    if (field === "nonfinite") response.data = [{ index: 0, embedding: [null, ...vector.slice(1)] }];
    if (field === "zero") response.data = [{ index: 0, embedding: vector.map(() => 0) }];
    if (field === "count") response.data = [];
    if (field === "index") response.data = [{ index: 1, embedding: vector }];
    if (field === "duplicate") response.data = [{ index: 0, embedding: vector }, { index: 0, embedding: vector }];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(response)));
    const inputs = field === "duplicate" ? ["a", "b"] : ["Reflector material"];
    expect(await requestEmbeddings(inputs, KEY)).toEqual({ ok: false, code: "invalid_response", retryable: false });
  });

  it.each([429, 503, 400, 401])("classifies HTTP %i without keeping body content, retrying once only when retryable", async (status) => {
    const fetcher = vi.fn(async () => new Response("private provider error and input", { status }));
    vi.stubGlobal("fetch", fetcher);
    const result = await requestEmbeddings(["Reflector material"], { ...KEY, backoffMs: 1 });
    const retryable = status === 429 || status >= 500;
    expect(result).toMatchObject({ ok: false, retryable });
    expect(JSON.stringify(result)).not.toContain("private provider");
    expect(fetcher).toHaveBeenCalledTimes(retryable ? 2 : 1);
  });

  it("recovers on the retry and sends one request when the caller owns retries", async () => {
    const fetcher = vi.fn(async () => new Response("busy", { status: 503 }));
    fetcher.mockImplementationOnce(async () => new Response("busy", { status: 503 }))
      .mockImplementationOnce(async () => Response.json(body()));
    vi.stubGlobal("fetch", fetcher);
    expect((await requestEmbeddings(["text"], { ...KEY, backoffMs: 1 })).ok).toBe(true);
    fetcher.mockReset(); fetcher.mockImplementation(async () => new Response("busy", { status: 503 }));
    await requestEmbeddings(["text"], { ...KEY, attempts: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized UTF-8 inputs whole, without sending a prefix", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const query of ["界".repeat(3_000), "x".repeat(8_001)])
      expect(await requestEmbeddings([query], KEY)).toEqual({ ok: false, code: "input_too_large", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("bounds streamed response bytes even when content-length is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(40_000))));
    expect(await requestEmbeddings(["Reflector material"], { ...KEY, attempts: 1 })).toEqual({ ok: false, code: "invalid_response", retryable: false });
  });

  it("aborts a stalled request at the timeout and does not retry interactive timeouts", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    vi.stubGlobal("fetch", fetcher);
    const pending = requestEmbeddings(["Reflector material"], KEY);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toEqual({ ok: false, code: "timeout", retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const query = embedQuery("account", "slow query", KEY);
    await vi.advanceTimersByTimeAsync(3_001);
    expect(await query).toMatchObject({ ok: false, code: "timeout" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("best-effort query vector cache", () => {
  const version = "openrouter:OpenAI:text-embedding-3-small:256:v1";
  it("keys exact text, model version and scope, expires in five minutes, and copies vectors", () => {
    const cache = new QueryVectorCache();
    cache.put("account-a", "Exact Query", vector, version, 0);
    expect(cache.get("account-b", "Exact Query", version, 1)).toBeUndefined();
    expect(cache.get("account-a", "exact query", version, 1)).toBeUndefined();
    expect(cache.get("account-a", "Exact Query", "new-model", 1)).toBeUndefined();
    const hit = cache.get("account-a", "Exact Query", version, 1)!;
    hit[0] = 99;
    expect(cache.get("account-a", "Exact Query", version, 2)).toEqual(vector);
    expect(cache.get("account-a", "Exact Query", version, 300_000)).toBeUndefined();
  });

  it("evicts least-recently-used entries at 128", () => {
    const cache = new QueryVectorCache();
    for (let i = 0; i < 128; i += 1) cache.put("account", `query-${i}`, vector, version, 0);
    cache.get("account", "query-0", version, 1);
    cache.put("account", "query-new", vector, version, 2);
    expect(cache.get("account", "query-1", version, 3)).toBeUndefined();
    expect(cache.get("account", "query-0", version, 3)).toEqual(vector);
  });

  it("serves a repeated query from the cache", async () => {
    const fetcher = vi.fn(async () => Response.json(body()));
    vi.stubGlobal("fetch", fetcher);
    const first = await embedQuery("account-cache", "cached words", KEY);
    const second = await embedQuery("account-cache", "cached words", KEY);
    expect([first.cacheHit, second.cacheHit, second.ok]).toEqual([false, true, true]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
