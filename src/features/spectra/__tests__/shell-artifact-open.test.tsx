// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpectraArtifact } from "../data/api";
import { useShellArtifactOpen } from "../components/use-shell-artifact-open";
import { createShellArtifactAccess } from "../components/shell-artifact-access";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../data/api", () => ({ getSpectraArtifactForDeepLink: read }));
beforeEach(() => read.mockReset());
afterEach(cleanup);

function artifact(id: string, content: unknown = { text: id }): SpectraArtifact {
  return { _id: id, blueprintKey: "document", title: id, tags: [], status: "active", createdAt: 1, updatedAt: 1, content };
}
function deferred() {
  let resolve!: (value: { artifact: SpectraArtifact | null }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ artifact: SpectraArtifact | null }>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("selected shell artifact opening", () => {
  it("cancels only the selected work that an authoritative read revokes", async () => {
    const access = createShellArtifactAccess(read);
    const { result } = renderHook(() => {
      const opening = useShellArtifactOpen(access.read);
      useEffect(() => access.subscribe(opening.cancel), [opening.cancel]);
      return opening;
    });
    await act(async () => { await result.current.open("b", "push", "split", true, artifact("b")); });
    act(() => {
      const refresh = access.beginListRefresh();
      refresh.reconcile([{ ...artifact("a"), accessLevel: null }]);
      refresh.finish();
    });
    expect(result.current.pending?.artifact._id).toBe("b");
    act(() => {
      const refresh = access.beginListRefresh();
      refresh.reconcile([{ ...artifact("b"), accessLevel: null }]);
      refresh.finish();
    });
    expect(result.current.pending).toBeNull();
    const waiting = deferred();
    read.mockReturnValueOnce(waiting.promise);
    let opening!: Promise<void>;
    await act(async () => { opening = result.current.open("a"); });
    act(() => {
      const refresh = access.beginListRefresh();
      refresh.reconcile([{ ...artifact("a"), status: "deleted" }]);
      refresh.finish();
    });
    await act(async () => { waiting.resolve({ artifact: artifact("a") }); await opening; });
    expect(result.current.pending).toBeNull();
    expect(result.current.loadingId).toBeNull();
  });

  it("settles current missing responses but does not clear a newer request's loading state", async () => {
    const a = deferred(), b = deferred();
    read.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { result } = renderHook(() => useShellArtifactOpen());
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => { first = result.current.open("a"); });
    await act(async () => { second = result.current.open("b"); });
    await act(async () => { a.resolve({ artifact: null }); await first; });
    expect(result.current.loadingId).toBe("b");
    await act(async () => {
      b.resolve({ artifact: null });
      await expect(second).rejects.toThrow("not available");
    });
    expect(result.current.loadingId).toBeNull();
    expect(result.current.pending).toBeNull();
  });

  it("reuses only mounted detail for repeated Follow/split/tab opens, then reads again after close", async () => {
    const mounted = artifact("a");
    read.mockResolvedValueOnce({ artifact: mounted });
    const { result } = renderHook(() => useShellArtifactOpen());
    await act(async () => { await result.current.open("a"); });
    act(() => result.current.cancel());
    for (let i = 0; i < 10; i++) {
      await act(async () => { await result.current.open("a", "replace", i % 2 ? "tab" : "split", true, mounted); });
      expect(result.current.pending?.preserveFollow).toBe(true);
      expect(result.current.pending?.artifact).toBe(mounted);
      act(() => result.current.cancel());
    }
    expect(read).toHaveBeenCalledTimes(1);
    const fresh = { ...mounted, content: "new", accessLevel: "read" as const };
    read.mockResolvedValueOnce({ artifact: fresh });
    await act(async () => { await result.current.open("a"); });
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current.pending?.artifact).toBe(fresh);
  });

  it("cancels a pending network open when refocusing mounted work", async () => {
    const waiting = deferred();
    read.mockReturnValueOnce(waiting.promise);
    const { result } = renderHook(() => useShellArtifactOpen());
    let request!: Promise<void>;
    await act(async () => { request = result.current.open("a"); });
    await act(async () => { await result.current.open("b", "push", "split", false, artifact("b")); });
    expect(read.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { waiting.resolve({ artifact: artifact("a") }); await request; });
    expect(result.current.pending?.artifact._id).toBe("b");
    expect(result.current.loadingId).toBeNull();
  });

  it("aborts A when B is selected and ignores A even if its body arrives later", async () => {
    const a = deferred(), b = deferred();
    read.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { result } = renderHook(() => useShellArtifactOpen());
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => { first = result.current.open("a"); });
    await act(async () => { second = result.current.open("b", "replace", "tab", true); });
    expect(read.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { b.resolve({ artifact: artifact("b") }); await second; });
    expect(result.current.pending).toMatchObject({ artifact: { _id: "b" }, historyMode: "replace", mode: "tab", preserveFollow: true });
    await act(async () => { a.resolve({ artifact: artifact("a") }); await first; });
    expect(result.current.pending?.artifact._id).toBe("b");
  });

  it("does not reopen after close or unmount, and does not retain the completed handoff", async () => {
    const waiting = deferred();
    read.mockReturnValueOnce(waiting.promise);
    const { result, unmount } = renderHook(() => useShellArtifactOpen());
    let request!: Promise<void>;
    await act(async () => { request = result.current.open("a"); });
    act(() => result.current.cancel());
    expect(read.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { waiting.resolve({ artifact: artifact("a") }); await request; });
    expect(result.current.pending).toBeNull();
    read.mockResolvedValueOnce({ artifact: artifact("a") });
    await act(async () => { await result.current.open("a"); });
    act(() => result.current.cancel());
    expect(result.current.pending).toBeNull();
    const later = deferred();
    read.mockReturnValueOnce(later.promise);
    await act(async () => { request = result.current.open("a"); });
    unmount();
    expect(read.mock.calls[2][1].signal.aborted).toBe(true);
    later.resolve({ artifact: artifact("a") });
    await request;
  });

  it("coalesces concurrent same-id requests but fetches a fresh authorized body on every reopen", async () => {
    const waiting = deferred();
    read.mockReturnValueOnce(waiting.promise);
    const { result } = renderHook(() => useShellArtifactOpen());
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => {
      first = result.current.open("a");
      second = result.current.open("a", "replace", "tab");
    });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => { waiting.resolve({ artifact: artifact("a", "old long text") }); await Promise.all([first, second]); });
    expect(result.current.pending?.mode).toBe("tab");
    act(() => result.current.cancel());
    read.mockResolvedValueOnce({ artifact: { ...artifact("a", ""), accessLevel: "read", updatedAt: 2 } });
    await act(async () => { await result.current.open("a"); });
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current.pending?.artifact).toMatchObject({ content: "", accessLevel: "read", updatedAt: 2 });
    act(() => result.current.cancel());
    read.mockRejectedValueOnce(new Error("permission revoked"));
    await act(async () => { await expect(result.current.open("a")).rejects.toThrow("permission revoked"); });
    expect(result.current.pending).toBeNull();
  });

  it("rejects summary-only responses, accepts an empty native body and allows retry", async () => {
    const { result } = renderHook(() => useShellArtifactOpen());
    const summary = artifact("a");
    delete summary.content;
    read.mockResolvedValueOnce({ artifact: summary });
    await act(async () => { await expect(result.current.open("a")).rejects.toThrow("detail is unavailable"); });
    expect(result.current.pending).toBeNull();
    read.mockResolvedValueOnce({ artifact: artifact("a", null) });
    await act(async () => { await result.current.open("a"); });
    expect(result.current.pending?.artifact.content).toBeNull();
  });

  it("skips a canceled unstarted request and rejects explicit denial without showing old content", async () => {
    const { result } = renderHook(() => useShellArtifactOpen());
    await act(async () => {
      const request = result.current.open("a");
      result.current.cancel();
      await request;
    });
    expect(read).not.toHaveBeenCalled();
    read.mockResolvedValueOnce({ artifact: { ...artifact("a"), accessLevel: null } });
    await act(async () => { await expect(result.current.open("a")).rejects.toThrow("not available"); });
    expect(result.current.pending).toBeNull();
    expect(result.current.loadingId).toBeNull();
  });
});
