import { describe, expect, it } from "vitest";
import { buildRoutePlan } from "@/lib/orchestrator/route-plan";

describe("route plan search query generation", () => {
  it("builds an intent-focused Tavily query instead of using the raw prompt", () => {
    const plan = buildRoutePlan({
      message: "Can you search the web for the latest NASA Artemis II launch update and cite sources?",
      mode: "research",
      selectedMode: "research",
      hasAttachments: false,
      hasAgent: false,
      hasPack: false,
      hasPersonalResources: false,
      hasAgentResources: false,
      autoSearchEnabled: true,
      thinkingLevel: "medium",
      complexity: "medium",
    });

    expect(plan.searchPlan?.query).toContain("NASA Artemis II launch update");
    expect(plan.searchPlan?.query).toContain("2026 latest");
    expect(plan.searchPlan?.query).not.toContain("Can you search the web");
  });
});