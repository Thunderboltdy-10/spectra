import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/openrouter", () => ({
  openRouterChatCompletion: vi.fn(),
  openRouterEmbeddingRequest: vi.fn(),
}));

import { maybeSearchWeb } from "@/lib/orchestrator/retrieval";
import { openRouterChatCompletion } from "@/lib/openrouter";

describe("maybeSearchWeb", () => {
  it("does not fall back to paid model calls when free_only has no search-capable free models", async () => {
    const result = await maybeSearchWeb("latest policy updates", "low", {
      spendingTier: "free_only",
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

  it("does not use online-model fallback for research search strategies", async () => {
    const result = await maybeSearchWeb("research this topic deeply", "high", {
      spendingTier: "normal",
      modelCatalog: [
        {
          modelId: "openai/gpt-5.4-mini",
          name: "GPT-5.4 Mini",
          provider: "openai",
          tags: ["reasoning", "search"],
          isFree: false,
          inputCostPerM: 1,
          outputCostPerM: 2,
        },
      ],
      searchPlan: {
        strategy: "search_extract",
        trigger: "research_mode",
        query: "research this topic deeply",
      },
    });

    expect(result.provider).toBe("error");
    expect(result.urls).toEqual([]);
    expect(openRouterChatCompletion).not.toHaveBeenCalled();
  });
});
