import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const mockCatalog = [
  {
    modelId: "meta-llama/llama-3.1-8b-instruct:free",
    name: "Llama 3.1 8B Free",
    provider: "meta",
    tags: ["chat", "fast"],
    isFree: true,
    inputCostPerM: 0,
    outputCostPerM: 0,
    capabilities: {
      reasoning: 1,
      creative: 3,
      code: 1,
      vision: 0,
      speed: 9,
    },
  },
  {
    modelId: "google/gemini-3.1-flash",
    name: "Gemini 3.1 Flash",
    provider: "google",
    tags: ["reasoning", "search", "fast"],
    isFree: false,
    inputCostPerM: 0.3,
    outputCostPerM: 0.6,
    capabilities: {
      reasoning: 6,
      creative: 6,
      code: 4,
      vision: 5,
      speed: 8,
    },
  },
  {
    modelId: "openai/gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    provider: "openai",
    tags: ["reasoning", "search", "reliable"],
    isFree: false,
    inputCostPerM: 2.2,
    outputCostPerM: 4.4,
    capabilities: {
      reasoning: 9,
      creative: 8,
      code: 8,
      vision: 7,
      speed: 6,
    },
  },
];

function setupDryRunMocks() {
  const requireActor = vi.fn().mockResolvedValue({
    clerkId: "user_routing",
    email: "student@example.com",
    name: "Student",
    role: "student",
    orgId: "org_1",
    userId: "user_1",
    onboardingComplete: true,
  });

  const convexQuery = vi.fn().mockImplementation(async (fnName: string) => {
    if (fnName === "usage:checkUserBudget") {
      return { tier: "normal" as const };
    }
    if (fnName === "models:listModels") {
      return mockCatalog;
    }
    if (fnName === "models:listRuntimeStats") {
      return [
        { modelId: "meta-llama/llama-3.1-8b-instruct:free", successCount: 12, failureCount: 1, avgLatencyMs: 1200 },
        { modelId: "google/gemini-3.1-flash", successCount: 2, failureCount: 20, avgLatencyMs: 2200 },
        { modelId: "openai/gpt-5.4-mini", successCount: 22, failureCount: 1, avgLatencyMs: 3400 },
      ];
    }
    return null;
  });

  vi.doMock("@/lib/auth-server", () => ({ requireActor }));
  vi.doMock("@/lib/convex-server", () => ({ convexQuery }));
  vi.doMock("@/lib/openrouter-catalog-cache", () => ({
    getLiveCatalogSnapshot: vi.fn().mockResolvedValue({
      models: mockCatalog,
    }),
  }));
}

describe("/api/chat/dry-run routing integration", () => {
  it("selects different models for simple vs deep-research prompts in auto mode", async () => {
    setupDryRunMocks();
    const route = await import("@/app/api/chat/dry-run/route");

    const simpleResponse = await route.POST(
      new NextRequest("http://localhost/api/chat/dry-run", {
        method: "POST",
        body: JSON.stringify({
          mode: "general",
          message: "What is ATP?",
          thinkingLevel: "low",
          routerMode: "auto",
          autoSettings: {
            searchMode: "off",
          },
        }),
      }),
    );
    expect(simpleResponse.status).toBe(200);
    const simplePayload = (await simpleResponse.json()) as {
      routeTrace: {
        selected: { modelId: string };
        inputs: { needsSearch: boolean };
      };
    };

    const researchResponse = await route.POST(
      new NextRequest("http://localhost/api/chat/dry-run", {
        method: "POST",
        body: JSON.stringify({
          mode: "research",
          message: "What are the latest AI education policy changes this week? Cite current sources.",
          thinkingLevel: "high",
          routerMode: "auto",
          autoSettings: {
            searchMode: "on",
          },
        }),
      }),
    );
    expect(researchResponse.status).toBe(200);
    const researchPayload = (await researchResponse.json()) as {
      routeTrace: {
        selected: { modelId: string };
        inputs: { needsSearch: boolean };
      };
    };

    expect(
      mockCatalog.some((entry) => entry.modelId === simplePayload.routeTrace.selected.modelId),
    ).toBe(true);
    expect(researchPayload.routeTrace.selected.modelId).toBe("openai/gpt-5.4-mini");
    expect(researchPayload.routeTrace.inputs.needsSearch).toBe(true);
    expect(simplePayload.routeTrace.inputs.needsSearch).toBe(false);
  });

  it("honors manual routing lock for selected model", async () => {
    setupDryRunMocks();
    const route = await import("@/app/api/chat/dry-run/route");

    const response = await route.POST(
      new NextRequest("http://localhost/api/chat/dry-run", {
        method: "POST",
        body: JSON.stringify({
          mode: "tutor",
          message: "Help me plan my study session.",
          thinkingLevel: "medium",
          routerMode: "manual",
          manualModel: "google/gemini-3.1-flash",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      routeTrace: {
        selected: { modelId: string };
        inputs: { routerMode: string };
      };
    };

    expect(payload.routeTrace.inputs.routerMode).toBe("manual");
    expect(payload.routeTrace.selected.modelId).toBe("google/gemini-3.1-flash");
  });
});
