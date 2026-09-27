import { describe, expect, it, vi } from "vitest";
import { createCatalogPageCache, type CatalogPage } from "../data/catalog-page-cache";

type Row = { _id: string; title: string };
const row = (id: string): Row => ({ _id: id, title: id });
const page = (items: Row[], cursor: string | null): CatalogPage<Row> => ({ items, isDone: cursor === null, continueCursor: cursor });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("catalogue result page cache", () => {
  it("coalesces refreshes across every visible page while completing agent filters", async () => {
    const tail = deferred<CatalogPage<Row>>();
    const fetch = vi.fn().mockResolvedValueOnce(page([row("a")], "page-2")).mockReturnValueOnce(tail.promise);
    const cache = createCatalogPageCache<Row>(fetch);
    const loading = cache.load("actor", { all: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.getSnapshot("actor")).toMatchObject({ items: [row("a")], status: "loading", isDone: false });
    expect(cache.load("actor", { force: true, all: true })).toBe(loading);
    tail.resolve(page([row("b")], null));
    await loading;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cache.getSnapshot("actor")).toMatchObject({ items: [row("a"), row("b")], status: "ready", isDone: true });
  });
  it("consumes empty nonfinal progress and keeps completion explicit", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(page([], "scan-1"))
      .mockResolvedValueOnce(page([], "scan-2"))
      .mockResolvedValueOnce(page([row("a")], "next-page"))
      .mockResolvedValueOnce(page([row("b")], null));
    const cache = createCatalogPageCache<Row>(fetch);
    await cache.load("actor");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(cache.getSnapshot("actor")).toMatchObject({ items: [row("a")], status: "ready", isDone: false });
    await cache.load("actor");
    expect(fetch).toHaveBeenCalledTimes(3);
    await cache.load("actor", { more: true });
    expect(cache.getSnapshot("actor")).toMatchObject({ items: [row("a"), row("b")], isDone: true });
    await cache.load("actor", { more: true });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("coalesces the complete pending scan even after a focus/polling interval", async () => {
    const response = deferred<CatalogPage<Row>>();
    const fetch = vi.fn(() => response.promise);
    const cache = createCatalogPageCache(fetch, 0);
    const first = cache.load("actor");
    const focus = cache.load("actor", { force: true });
    const next = cache.load("actor", { more: true });
    expect(first).toBe(focus);
    expect(first).toBe(next);
    response.resolve(page([row("a")], null));
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts invalidated work and ignores its late successful response", async () => {
    const old = deferred<CatalogPage<Row>>();
    const fresh = deferred<CatalogPage<Row>>();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const cache = createCatalogPageCache<Row>(fetch);
    const first = cache.load("actor");
    await Promise.resolve();
    const signal = fetch.mock.calls[0]![2] as AbortSignal;
    cache.invalidate();
    expect(signal.aborted).toBe(true);
    const second = cache.load("actor");
    await Promise.resolve();
    fresh.resolve(page([row("new")], null));
    await second;
    old.resolve(page([row("revoked")], null));
    await first;
    expect(cache.getSnapshot("actor").items).toEqual([row("new")]);
  });

  it("does not turn failed or nonadvancing traversal into an empty complete catalogue", async () => {
    const fetch = vi.fn().mockResolvedValue(page([], "same"));
    const cache = createCatalogPageCache<Row>(fetch);
    await cache.load("actor");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cache.getSnapshot("actor")).toMatchObject({ status: "error", isDone: false });
    fetch.mockResolvedValue(page([], null));
    await cache.load("actor");
    expect(cache.getSnapshot("actor")).toMatchObject({ items: [], status: "ready", isDone: true });
  });

  it("keeps scopes isolated and removes old identity rows on transition", async () => {
    const fetch = vi.fn(async (key: string) => page([row(key)], null));
    const cache = createCatalogPageCache(fetch);
    await cache.load("old-account/session/search-a");
    cache.retainScope("new-account/session/");
    await cache.load("new-account/session/search-a");
    expect(cache.getSnapshot("old-account/session/search-a").status).toBe("idle");
    expect(cache.getSnapshot("new-account/session/search-a").items).toEqual([row("new-account/session/search-a")]);
  });

  it("stops unfinished discovery when its last visible consumer leaves", async () => {
    const response = deferred<CatalogPage<Row>>();
    const fetch = vi.fn(() => response.promise);
    const cache = createCatalogPageCache(fetch);
    const unsubscribe = cache.subscribe("actor", () => undefined);
    const pending = cache.load("actor");
    await Promise.resolve();
    unsubscribe();
    response.resolve(page([], "next-progress"));
    await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.getSnapshot("actor").status).toBe("idle");
  });
});
