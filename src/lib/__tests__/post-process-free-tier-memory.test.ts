import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convexMutation: vi.fn(),
  convexAction: vi.fn(),
  convexQuery: vi.fn(),
  openRouterEmbeddingRequest: vi.fn(),
  recordOpenRouterUsage: vi.fn(),
}));

vi.mock("@/lib/convex-server", () => ({
  convexMutation: mocks.convexMutation,
  convexAction: mocks.convexAction,
  convexQuery: mocks.convexQuery,
}));

vi.mock("@/lib/openrouter", () => ({
  openRouterChatCompletion: vi.fn(),
  openRouterEmbeddingRequest: mocks.openRouterEmbeddingRequest,
}));

vi.mock("@/lib/usage-tracking", () => ({
  recordOpenRouterUsage: mocks.recordOpenRouterUsage,
}));

describe("routeMemoryWrite free_only behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.convexMutation.mockResolvedValue({ inserted: 1, updated: 0, promoted: 0 });
  });

  it("persists explicit memory directives without embedding calls", async () => {
    const module = await import("@/lib/orchestrator/post-process");
    const entries = module.buildDirectiveMemoryEntries({
      statement: "I prefer concise answers",
      directiveType: "remember",
    });

    const result = await module.routeMemoryWrite({
      actorClerkId: "clerk_user_1",
      spendingTier: "free_only",
      sourceType: "user_explicit",
      entries,
    });

    expect(result).toEqual({ written: 1, promoted: 0 });
    expect(mocks.openRouterEmbeddingRequest).not.toHaveBeenCalled();
    expect(mocks.convexMutation).toHaveBeenCalledWith(
      "memory:routeMemoryWrite",
      expect.objectContaining({
        actorClerkId: "clerk_user_1",
      }),
    );
    const payload = mocks.convexMutation.mock.calls[0]?.[1] as {
      entries?: Array<{ embedding?: number[]; sourceType?: string }>;
    };
    expect(payload.entries?.[0]?.sourceType).toBe("user_explicit");
    expect(payload.entries?.[0]?.embedding).toBeUndefined();
  });

  it("keeps extraction writes blocked in free_only tier", async () => {
    const module = await import("@/lib/orchestrator/post-process");
    const result = await module.routeMemoryWrite({
      actorClerkId: "clerk_user_2",
      spendingTier: "free_only",
      sourceType: "extraction",
      entries: [
        {
          key: "study_goal",
          value: "Finish chapter 3 by Friday",
          confidence: 0.8,
          extractedAt: Date.now(),
        },
      ],
    });

    expect(result).toEqual({ written: 0, promoted: 0 });
    expect(mocks.convexMutation).not.toHaveBeenCalled();
    expect(mocks.openRouterEmbeddingRequest).not.toHaveBeenCalled();
  });
});

