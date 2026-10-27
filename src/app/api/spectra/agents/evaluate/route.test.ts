import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSkill, type BenchCase } from "@/features/spectra/agents/foundry";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  convexQuery: vi.fn(),
  convexMutation: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/convex-server", () => ({
  convexQuery: mocks.convexQuery,
  convexMutation: mocks.convexMutation,
}));
vi.mock("@/features/spectra/ai/model-config", () => ({
  allowSpectraProviderFallbacks: () => false,
  getSpectraModelId: () => "env-model",
  getSpectraProviderRouting: () => ({}),
  getSpectraReasoningProfile: () => "high",
  getSpectraFallbackProviders: () => [],
  getSpectraPrimaryProvider: () => "env-provider",
}));
vi.mock("../model-work", async (original) => ({
  ...(await original<typeof import("../model-work")>()),
  admitAgentModelWork: vi.fn(),
  recordAgentModelWork: vi.fn(),
}));
import { POST } from "./route";

const saved: BenchCase = {
  id: "case1",
  prompt: "Mark my essay on the causes of WW1",
  checks: { mustInclude: ["thesis"], mustNotInclude: ["perfect"] },
  required: true,
  createdAt: 1,
  updatedAt: 1,
};

function foundryAgent() {
  return {
    title: "Essay coach",
    blueprintKey: "agent",
    content: {
      foundry: {
        foundationEstablished: true,
        mission: {
          objective: "Give students precise essay feedback against the rubric.",
          interactionStyle: { tone: "direct", responseLength: "balanced", clarificationPolicy: "ask_when_needed" },
        },
        skills: [
          createSkill(
            {
              id: "essay",
              name: "Essay feedback",
              purpose: "Mark essays against a rubric",
              status: "verified",
              procedure: [{ order: 1, action: "Read the essay" }],
              outputContract: { shape: "Feedback", mustInclude: ["next step"], mustNotInclude: [] },
            },
            1,
          ),
        ],
      },
    },
  };
}

describe("Run checks with saved bench tests", () => {
  let begun: { cases: Array<{ id: string; layer: string }> } | undefined;
  let settled: { results: Array<{ caseId: string; passed: boolean; reason: string }> } | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    begun = undefined;
    settled = undefined;
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("SPECTRA_AGENT_EVAL_BRIDGE_KEY", "x".repeat(40));
    mocks.auth.mockResolvedValue({ userId: "user_1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: "The thesis is clear; the next step is a source." } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function wire(agent: unknown, cases: BenchCase[]) {
    mocks.convexQuery.mockImplementation(async (name: string) => {
      if (name === "agents:draftForEvaluation") return agent;
      if (name === "agents:benchCases") return cases;
      throw new Error(`unexpected ${name}`);
    });
    mocks.convexMutation.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "agents:beginEvalRun") {
        begun = args as typeof begun;
        return {
          evalRunId: "eval_1",
          contentHash: "hash",
          cases: (args.cases as unknown[]) ?? [],
          agent: { title: "Essay coach", content: (agent as { content: unknown }).content },
        };
      }
      if (name === "agents:settleEvalRun") {
        settled = args as typeof settled;
        return { status: "passed" };
      }
      throw new Error(`unexpected ${name}`);
    });
  }

  function run() {
    return POST(
      new Request("https://example.test/api/spectra/agents/evaluate", {
        method: "POST",
        body: JSON.stringify({ agentId: "agent_1" }),
      }),
    );
  }

  it("runs each saved test in the regression layer and grades it in code", async () => {
    wire(foundryAgent(), [saved]);
    const response = await run();
    expect(response.status).toBe(200);
    expect(begun!.cases.at(-1)).toMatchObject({ id: "bench-case1", layer: "regression" });
    const result = settled!.results.find((entry) => entry.caseId === "bench-case1");
    expect(result).toMatchObject({ passed: true, reason: "Every check you saved holds." });
  });

  it("adds saved tests to an agent built before skills", async () => {
    wire(
      {
        title: "Old agent",
        blueprintKey: "agent",
        content: { instructions: { text: "Help." }, evals: [{ id: "legacy", prompt: "Hi", expected: "Greets" }] },
      },
      [saved],
    );
    await run();
    const ids = begun!.cases.map((entry) => entry.id);
    expect(ids[0]).toBe("legacy");
    expect(ids.at(-1)).toBe("bench-case1");
    // Without an injection-resistance case a layered run could never pass.
    expect(begun!.cases.some((entry) => entry.layer === "adversarial")).toBe(true);
  });

  it("checks an agent with no skills and no tests against the standard cases the page shows", async () => {
    wire({ title: "New agent", blueprintKey: "agent", content: { evals: [] } }, []);
    await run();
    expect(begun!.cases.length).toBeGreaterThan(0);
    expect(begun!.cases.every((entry) => entry.layer === "adversarial")).toBe(true);
  });
});
