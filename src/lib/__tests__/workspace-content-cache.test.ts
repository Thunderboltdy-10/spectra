import { describe, expect, it, vi } from "vitest";
import { createWorkspaceContentController } from "@/components/workspace/workspace-canvas";

function createContent(id: string) {
  return {
    threads: [{ id: `${id}-thread`, title: `Thread ${id}`, messageCount: 1, lastActivityAt: 1 }],
    notes: [],
    plannerItems: [],
    artifacts: [],
    widgets: [],
    ghosts: [],
    hubQuickNotes: [],
    hubDeadlines: [],
    hubActivity: [],
  };
}

function createFetcher(delays: Record<string, number> = {}) {
  const calls: string[] = [];
  const fetcher = vi.fn(async (workstreamId: string) => {
    calls.push(workstreamId);
    const delay = delays[workstreamId] ?? 0;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return createContent(workstreamId);
  });
  return Object.assign(fetcher, { calls });
}

describe("workspace content cache controller", () => {
  it("deduplicates concurrent fetches for the same workspace", async () => {
    const fetcher = createFetcher({ alpha: 20 });
    const controller = createWorkspaceContentController({ fetchWorkstreamContent: fetcher });

    const [first, second] = await Promise.all([
      controller.fetch("alpha"),
      controller.fetch("alpha"),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(controller.snapshot().inFlightKeys).toEqual([]);
  });

  it("evicts the least recently used workspace when the cache exceeds seven entries", async () => {
    const fetcher = createFetcher();
    const controller = createWorkspaceContentController({
      fetchWorkstreamContent: fetcher,
      cacheMax: 7,
    });

    for (const id of ["w1", "w2", "w3", "w4", "w5", "w6", "w7"]) {
      await controller.fetch(id);
    }
    controller.getCachedContent("w3");
    await controller.fetch("w8");

    const snapshot = controller.snapshot();
    expect(snapshot.cacheSize).toBe(7);
    expect(snapshot.cacheKeys).toEqual(["w2", "w3", "w4", "w5", "w6", "w7", "w8"]);
    expect(snapshot.cacheKeys.includes("w1")).toBe(false);
  });

  it("drops stale in-flight results after invalidation and keeps the cache coherent", async () => {
    const fetcher = createFetcher({ alpha: 30 });
    const controller = createWorkspaceContentController({ fetchWorkstreamContent: fetcher });

    const firstFetch = controller.fetch("alpha");
    controller.invalidate("alpha");
    const secondFetch = controller.fetch("alpha");

    const [first, second] = await Promise.all([firstFetch, secondFetch]);
    const snapshot = controller.snapshot();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(first).toEqual(createContent("alpha"));
    expect(second).toEqual(createContent("alpha"));
    expect(snapshot.cacheSize).toBe(1);
    expect(snapshot.cacheKeys).toEqual(["alpha"]);
    expect(snapshot.contentById.alpha).toEqual(createContent("alpha"));
  });

  it("invalidates workspace and hub entries together when refreshHub is requested", async () => {
    const fetcher = createFetcher();
    const controller = createWorkspaceContentController({ fetchWorkstreamContent: fetcher });

    await controller.fetch("alpha");
    await controller.fetch("__hub__");

    controller.invalidate("alpha", { includeHub: true });

    const snapshot = controller.snapshot();
    expect(snapshot.cacheKeys).toEqual([]);
    expect(snapshot.contentById).toEqual({});
  });
});
