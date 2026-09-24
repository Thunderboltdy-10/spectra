import { describe, expect, it, vi } from "vitest";
import { createLatestStudioLoad } from "../components/latest-studio-load";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("selected studio detail requests", () => {
  it("deduplicates an in-flight selection, aborts the previous one, and ignores its late result", async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const read = vi.fn((id: string, _signal: AbortSignal) => id === "a" ? a.promise : b.promise);
    const loader = createLatestStudioLoad(read);
    const first = loader.load("a");
    expect(loader.load("a")).toBe(first);
    await Promise.resolve();
    const second = loader.load("b");
    await Promise.resolve();
    expect(read.mock.calls[0]![1].aborted).toBe(true);
    b.resolve("new document");
    await expect(second).resolves.toBe("new document");
    a.resolve("old document");
    await expect(first).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not reopen after close or report stale failures, but surfaces the current failure for retry", async () => {
    const pending = deferred<string>();
    const read = vi.fn(() => pending.promise);
    const loader = createLatestStudioLoad(read);
    const request = loader.load("a");
    await Promise.resolve();
    loader.cancel();
    pending.reject(new Error("connection lost"));
    await expect(request).resolves.toBeNull();
    read.mockRejectedValueOnce(new Error("not authorized"));
    await expect(loader.load("a")).rejects.toThrow("not authorized");
    read.mockResolvedValueOnce("fresh authorized body");
    await expect(loader.load("a")).resolves.toBe("fresh authorized body");
  });

  it("revalidates after completion and fences A → B → A without a stale-body cache", async () => {
    const oldA = deferred<string>();
    const currentA = deferred<string>();
    const read = vi.fn<(id: string, signal: AbortSignal) => Promise<string>>()
      .mockImplementationOnce(() => oldA.promise)
      .mockImplementationOnce(() => currentA.promise)
      .mockResolvedValueOnce("");
    const loader = createLatestStudioLoad(read);
    const first = loader.load("a");
    await Promise.resolve();
    const skippedB = loader.load("b");
    const last = loader.load("a");
    await Promise.resolve();
    currentA.resolve("shorter authoritative body");
    oldA.resolve("stale longer body");
    await expect(first).resolves.toBeNull();
    await expect(skippedB).resolves.toBeNull();
    await expect(last).resolves.toBe("shorter authoritative body");
    await expect(loader.load("a")).resolves.toBe("");
    expect(read).toHaveBeenCalledTimes(3);
  });
});
