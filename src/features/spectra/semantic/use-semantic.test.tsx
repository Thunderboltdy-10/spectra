// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRelated, useSemanticSearch, useThreadSearch } from "./use-semantic";

const mocks = vi.hoisted(() => ({ search: vi.fn(), searchThreads: vi.fn(), related: vi.fn() }));
vi.mock("../../../../convex/_generated/api", () => ({
  api: { semantic: { search: "search", searchThreads: "searchThreads", related: "related" } },
}));
vi.mock("convex/react", () => ({ useAction: (name: keyof typeof mocks) => mocks[name] }));

const result = (itemId: string) => ({ kind: "artifact", itemId, title: itemId, typeLabel: "Document", snippet: "", score: 1,
  matchedBy: ["meaning"], ownership: "mine", anchor: { kind: "artifact", artifactId: itemId } });
const answer = (ids: string[], extra = {}) => ({ results: ids.map(result), mode: "hybrid", tookMs: 5, ...extra });
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("stays idle for short queries and debounces typing into one request", async () => {
  mocks.search.mockResolvedValue(answer(["a"]));
  const { result: hook, rerender } = renderHook(({ query }) => useSemanticSearch(query), { initialProps: { query: "c" } });
  expect(hook.current.status).toBe("idle");
  rerender({ query: "ce" });
  rerender({ query: "cel" });
  rerender({ query: "cells" });
  expect(hook.current.status).toBe("loading");
  await settle(199);
  expect(mocks.search).not.toHaveBeenCalled();
  await settle(1);
  expect(mocks.search).toHaveBeenCalledTimes(1);
  expect(mocks.search.mock.calls[0]![0]).toMatchObject({ query: "cells",
    hints: { now: expect.any(Number), timezoneOffsetMinutes: expect.any(Number) } });
  expect(hook.current).toMatchObject({ status: "results", answered: "cells", mode: "hybrid", error: null });
  expect(hook.current.results.map((item) => item.itemId)).toEqual(["a"]);
});

it("keeps the previous results while loading and ignores answers to old queries", async () => {
  let resolveOld!: (value: unknown) => void;
  mocks.search.mockResolvedValueOnce(answer(["first"]))
    .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce(answer([]));
  const { result: hook, rerender } = renderHook(({ query }) => useSemanticSearch(query, { openItemIds: ["x"] }),
    { initialProps: { query: "first" } });
  await settle(200);
  rerender({ query: "second" });
  await settle(200);
  expect(hook.current).toMatchObject({ status: "loading", answered: "first" });
  rerender({ query: "third" });
  await settle(200);
  await act(async () => { resolveOld(answer(["stale"])); });
  expect(hook.current).toMatchObject({ status: "empty", answered: "third", results: [] });
  expect(mocks.search.mock.calls[2]![0].hints.openItemIds).toEqual(["x"]);
});

it("reports degraded answers and failures as data", async () => {
  mocks.searchThreads.mockResolvedValueOnce(answer(["t"], { mode: "words_only", degraded: { reason: "embeddings_unavailable" } }))
    .mockRejectedValueOnce(new Error("Network down"));
  const { result: hook } = renderHook(() => useThreadSearch("titration"));
  await settle(200);
  expect(hook.current).toMatchObject({ status: "results", mode: "words_only", degraded: "embeddings_unavailable" });
  act(() => hook.current.refresh());
  expect(hook.current.status).toBe("loading");
  await settle(0);
  expect(hook.current.status).toBe("error");
  expect(hook.current.error).toBeTruthy();
  expect(mocks.searchThreads).toHaveBeenCalledTimes(2);
});

it("loads related items at once and never shows another item's list", async () => {
  mocks.related.mockResolvedValueOnce({ ...answer(["b"]), cached: false })
    .mockReturnValueOnce(new Promise(() => {}));
  const { result: hook, rerender } = renderHook(({ id }) => useRelated(id), { initialProps: { id: null as string | null } });
  expect(hook.current.status).toBe("idle");
  rerender({ id: "a" });
  await settle(0);
  expect(hook.current).toMatchObject({ status: "results", cached: false });
  rerender({ id: "c" });
  expect(hook.current).toMatchObject({ status: "loading", results: [] });
});
