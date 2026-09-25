// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePinVersionPicker } from "../components/use-pin-version-picker";

const { getVersions } = vi.hoisted(() => ({ getVersions: vi.fn() }));
vi.mock("../data/api", () => ({ getSpectraArtifactVersions: getVersions }));

function version(artifactId: string, index = 1) {
  return {
    _id: `${artifactId}-${index}`,
    artifactId,
    source: "manual" as const,
    createdAt: index,
    summary: `Version ${index}`,
  };
}
function page(
  artifactId: string,
  indexes = [1],
  continueCursor: string | null = null,
) {
  return {
    versions: indexes.map((index) => version(artifactId, index)),
    continueCursor,
    isDone: continueCursor === null,
  };
}
function deferred() {
  let resolve!: (value: ReturnType<typeof page>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReturnType<typeof page>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  getVersions.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("pin version metadata picker", () => {
  it("loads only on demand, requesting 20 metadata rows", async () => {
    getVersions.mockResolvedValue(page("a"));
    const { result, rerender } = renderHook(
      ({ enabled }) => usePinVersionPicker("a", enabled),
      { initialProps: { enabled: false } },
    );
    expect(getVersions).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.selectedId).toBe("a-1"));
    expect(getVersions).toHaveBeenCalledWith(
      "a",
      20,
      undefined,
      expect.any(AbortSignal),
    );
    expect(result.current.versions).toEqual([version("a")]);
  });

  it("appends a requested page, deduplicates rows, and preserves the chosen pin", async () => {
    getVersions
      .mockResolvedValueOnce(page("a", [1, 2], "older-a"))
      .mockResolvedValueOnce(page("a", [2, 3]));
    const { result } = renderHook(() => usePinVersionPicker("a", true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.select("a-2"));
    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.versions).toHaveLength(3));
    expect(getVersions).toHaveBeenCalledTimes(2);
    expect(getVersions.mock.calls[1].slice(0, 3)).toEqual(["a", 20, "older-a"]);
    expect(result.current.selectedId).toBe("a-2");
    expect(result.current.isDone).toBe(true);
    act(() => result.current.loadMore());
    expect(getVersions).toHaveBeenCalledTimes(2);
  });

  it("clears a pin immediately on source change and ignores the old source's late page", async () => {
    const olderA = deferred();
    const firstB = deferred();
    getVersions
      .mockResolvedValueOnce(page("a", [1], "older-a"))
      .mockReturnValueOnce(olderA.promise)
      .mockReturnValueOnce(firstB.promise);
    const { result, rerender } = renderHook(
      ({ source }) => usePinVersionPicker(source, true),
      { initialProps: { source: "a" } },
    );
    await waitFor(() => expect(result.current.selectedId).toBe("a-1"));
    act(() => result.current.loadMore());
    const oldSignal = getVersions.mock.calls[1][3] as AbortSignal;
    rerender({ source: "b" });
    expect(oldSignal.aborted).toBe(true);
    expect(result.current.selectedId).toBe("");
    expect(result.current.versions).toEqual([]);
    await act(async () => {
      firstB.resolve(page("b"));
    });
    await act(async () => {
      olderA.resolve(page("a", [2]));
    });
    expect(result.current.selectedId).toBe("b-1");
    expect(result.current.versions).toEqual([version("b")]);
  });

  it("can continue an empty metadata page and select its first available version", async () => {
    getVersions
      .mockResolvedValueOnce(page("a", [], "older-a"))
      .mockResolvedValueOnce(page("a", [2]));
    const { result } = renderHook(() => usePinVersionPicker("a", true));
    await waitFor(() => expect(result.current.cursor).toBe("older-a"));
    expect(result.current.versions).toEqual([]);
    expect(result.current.isDone).toBe(false);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.selectedId).toBe("a-2"));
    expect(result.current.isDone).toBe(true);
  });

  it("fences a closed request even if the same source is reopened", async () => {
    const first = deferred();
    const reopened = deferred();
    getVersions
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(reopened.promise);
    const { result, rerender } = renderHook(
      ({ enabled }) => usePinVersionPicker("a", enabled),
      { initialProps: { enabled: true } },
    );
    rerender({ enabled: false });
    expect((getVersions.mock.calls[0][3] as AbortSignal).aborted).toBe(true);
    expect(result.current.selectedId).toBe("");
    rerender({ enabled: true });
    await act(async () => {
      reopened.resolve(page("a", [2]));
    });
    await act(async () => {
      first.resolve(page("a", [1]));
    });
    expect(result.current.selectedId).toBe("a-2");
  });

  it("retains the chosen pin when an older page fails and retries the same cursor", async () => {
    getVersions
      .mockResolvedValueOnce(page("a", [1, 2], "older-a"))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(page("a", [3]));
    const { result } = renderHook(() => usePinVersionPicker("a", true));
    await waitFor(() => expect(result.current.selectedId).toBe("a-1"));
    act(() => result.current.select("a-2"));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBe("Offline"));
    expect(result.current.selectedId).toBe("a-2");
    expect(result.current.versions).toHaveLength(2);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBeNull());
    await waitFor(() => expect(result.current.versions).toHaveLength(3));
    expect(getVersions.mock.calls[2].slice(0, 3)).toEqual(["a", 20, "older-a"]);
    expect(result.current.selectedId).toBe("a-2");
  });

  it("recovers from an initial denial only after a fresh successful metadata request", async () => {
    getVersions
      .mockRejectedValueOnce(new Error("Access denied"))
      .mockResolvedValueOnce(page("a"));
    const { result } = renderHook(() => usePinVersionPicker("a", true));
    await waitFor(() => expect(result.current.error).toBe("Access denied"));
    expect(result.current.selectedId).toBe("");
    expect(result.current.versions).toEqual([]);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.selectedId).toBe("a-1"));
    expect(result.current.error).toBeNull();
  });

  it("rejects wrong-source rows and does not permit selecting an unknown version", async () => {
    getVersions.mockResolvedValue(page("b"));
    const { result } = renderHook(() => usePinVersionPicker("a", true));
    await waitFor(() =>
      expect(result.current.error).toContain("could not be loaded"),
    );
    act(() => result.current.select("b-1"));
    expect(result.current.selectedId).toBe("");
    expect(result.current.versions).toEqual([]);
  });

  it("rejects a non-advancing cursor while preserving existing versions", async () => {
    getVersions
      .mockResolvedValueOnce(page("a", [1], "older-a"))
      .mockResolvedValueOnce(page("a", [2], "older-a"));
    const { result } = renderHook(() => usePinVersionPicker("a", true));
    await waitFor(() => expect(result.current.selectedId).toBe("a-1"));
    act(() => result.current.loadMore());
    await waitFor(() =>
      expect(result.current.error).toContain("could not be loaded"),
    );
    expect(result.current.selectedId).toBe("a-1");
    expect(result.current.versions).toEqual([version("a")]);
  });

  it("aborts discarded Strict Mode and unmounted requests", async () => {
    getVersions.mockImplementation(() => new Promise(() => {}));
    const { unmount } = renderHook(() => usePinVersionPicker("a", true), {
      wrapper: StrictMode,
    });
    expect(getVersions).toHaveBeenCalledTimes(2);
    expect((getVersions.mock.calls[0][3] as AbortSignal).aborted).toBe(true);
    expect((getVersions.mock.calls[1][3] as AbortSignal).aborted).toBe(false);
    unmount();
    expect((getVersions.mock.calls[1][3] as AbortSignal).aborted).toBe(true);
  });
});
