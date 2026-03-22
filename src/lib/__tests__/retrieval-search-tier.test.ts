import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/openrouter", () => ({
  openRouterChatCompletion: vi.fn(),
  openRouterEmbeddingRequest: vi.fn(),
}));

vi.mock("@/lib/search/searxng", () => ({
  searxngSearch: vi.fn().mockResolvedValue([]),
}));

import { maybeSearchWeb } from "@/lib/orchestrator/retrieval";
import { openRouterChatCompletion } from "@/lib/openrouter";

describe("maybeSearchWeb", () => {
  it("does not fall back to paid model calls when free_only has no search-capable free models", async () => {
    const result = await maybeSearchWeb("latest policy updates", "low", {
      spendingTier: "free_only",
      searxngEnabled: false,
      modelCatalog: [
        {
          modelId: "openai/gpt-5.4-mini",
          name: "GPT-5.4 Mini",
          provider: "openai",
          tags: ["reasoning"],
          isFree: false,
          inputCostPerM: 1,
          outputCostPerM: 2,
        },
      ],
    });

    expect(result.provider).toBe("disabled");
    expect(result.text).toBe("");
    expect(result.urls).toEqual([]);
    expect(openRouterChatCompletion).not.toHaveBeenCalled();
  });
});
