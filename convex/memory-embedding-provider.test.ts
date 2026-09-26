import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryVectorCache, requestMemoryEmbedding } from "./memoryEmbeddings";
import { MEMORY_EMBEDDING_VERSION } from "./memoryEmbeddingPolicy";

const vector = Array.from({ length: 256 }, (_, index) => index === 0 ? 1 : 0);
const body = () => ({ model: "text-embedding-3-small", provider: "OpenAI", data: [{ index: 0, embedding: vector }] });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("bounded embedding provider requests", () => {
  it("pins the measured provider/model/dimensions and accepts a validated vector", async () => {
    const fetcher = vi.fn(async () => Response.json(body()));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestMemoryEmbedding("Reflector material", "synthetic-test")).toEqual({ ok: true, vector });
    const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(request[0]).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(JSON.parse(request[1].body as string)).toMatchObject({
      model: "openai/text-embedding-3-small", dimensions: 256, input: "Reflector material",
      provider: { only: ["OpenAI"], allow_fallbacks: false },
    });
  });

  it.each(["model", "provider", "dimension", "nonfinite", "zero", "count", "index"])("rejects a mismatched %s response", async (field) => {
    const response: Record<string, unknown> = body();
    if (field === "model") response.model = "different-model";
    if (field === "provider") response.provider = "different-provider";
    if (field === "dimension") response.data = [{ index: 0, embedding: [1, 2] }];
    if (field === "nonfinite") response.data = [{ index: 0, embedding: [null, ...vector.slice(1)] }];
    if (field === "zero") response.data = [{ index: 0, embedding: vector.map(() => 0) }];
    if (field === "count") response.data = [];
    if (field === "index") response.data = [{ index: 1, embedding: vector }];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(response)));
    expect(await requestMemoryEmbedding("Reflector material", "synthetic-test")).toEqual({ ok: false, code: "invalid_response", retryable: false });
  });

  it.each([429, 503, 400, 401])("classifies HTTP %i without persisting body content or retrying inside the action", async (status) => {
    const fetcher = vi.fn(async () => new Response("private provider error and input", { status }));
    vi.stubGlobal("fetch", fetcher);
    const result = await requestMemoryEmbedding("Reflector material", "synthetic-test");
    expect(result).toMatchObject({ ok: false, retryable: status === 429 || status >= 500 });
    expect(JSON.stringify(result)).not.toContain("private provider");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized UTF-8 and token inputs whole, without sending a prefix", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const query of ["界".repeat(3_000), "x ".repeat(2_100)])
      expect(await requestMemoryEmbedding(query, "synthetic-test")).toEqual({ ok: false, code: "query_too_large", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("bounds streamed response bytes even when content-length is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(40_000))));
    expect(await requestMemoryEmbedding("Reflector material", "synthetic-test")).toEqual({ ok: false, code: "invalid_response", retryable: false });
  });

  it("aborts a stalled provider request within ten seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })));
    const pending = requestMemoryEmbedding("Reflector material", "synthetic-test");
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toEqual({ ok: false, code: "timeout", retryable: true });
  });
});

describe("best-effort query vector cache", () => {
  it("keys exact text, model version and account, expires in five minutes, and copies vectors", () => {
    const cache = new QueryVectorCache();
    cache.put("account-a", "Exact Query", vector, MEMORY_EMBEDDING_VERSION, 0);
    expect(cache.get("account-b", "Exact Query", MEMORY_EMBEDDING_VERSION, 1)).toBeUndefined();
    expect(cache.get("account-a", "exact query", MEMORY_EMBEDDING_VERSION, 1)).toBeUndefined();
    expect(cache.get("account-a", "Exact Query", "new-model", 1)).toBeUndefined();
    const hit = cache.get("account-a", "Exact Query", MEMORY_EMBEDDING_VERSION, 1)!;
    hit[0] = 99;
    expect(cache.get("account-a", "Exact Query", MEMORY_EMBEDDING_VERSION, 2)).toEqual(vector);
    expect(cache.get("account-a", "Exact Query", MEMORY_EMBEDDING_VERSION, 300_000)).toBeUndefined();
  });

  it("evicts least-recently-used entries at 128", () => {
    const cache = new QueryVectorCache();
    for (let i = 0; i < 128; i += 1) cache.put("account", `query-${i}`, vector, MEMORY_EMBEDDING_VERSION, 0);
    cache.get("account", "query-0", MEMORY_EMBEDDING_VERSION, 1);
    cache.put("account", "query-new", vector, MEMORY_EMBEDDING_VERSION, 2);
    expect(cache.get("account", "query-1", MEMORY_EMBEDDING_VERSION, 3)).toBeUndefined();
    expect(cache.get("account", "query-0", MEMORY_EMBEDDING_VERSION, 3)).toEqual(vector);
  });
});
