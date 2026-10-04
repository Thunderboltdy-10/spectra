import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * An agent the user chose that can no longer run fails the run with a typed
 * error the UI can act on (choose again or switch to Auto), never a silent
 * fallback to Auto and never a pointless "Try again".
 */

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const modelCalls: unknown[] = [];

vi.mock("./io", async (importOriginal) => {
  const original = await importOriginal<typeof import("./io")>();
  const handle = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    switch (name) {
      case "spectraArtifacts:getAgentRuntime":
        return null;
      case "spectraRuns:get":
        return {
          run: { status: "running", sourceSurface: "chat", userPrompt: "Help", threadId: "thread-1", executionId: "exec-1" },
          cards: [{ _id: "card-1", runId: "run-1", status: "failed", title: "Agent unavailable", variant: "status", actions: [], updatedAt: 1 }],
          operations: [],
        };
      case "spectraThreads:listMessages":
        return { messages: [] };
      case "memory:listMine":
        return { claims: [] };
      case "bridge:devices":
      case "accountPreferences:layers":
        return [];
      default:
        return null;
    }
  };
  return { ...original, query: handle, mutate: handle, act: handle };
});

vi.mock("@/features/spectra/ai/harness/model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/spectra/ai/harness/model")>();
  return {
    ...original,
    openRouterModelCaller: async () => {
      modelCalls.push(1);
      return { text: "Hi", toolCalls: [] };
    },
    callSpectraModel: async () => ({ text: "{}", toolCalls: [] }),
    spectraModelContextWindow: async () => 200_000,
  };
});

describe("an explicit agent that cannot run", () => {
  beforeEach(() => {
    calls.length = 0;
    modelCalls.length = 0;
  });

  it("fails the run with AI_AGENT_UNAVAILABLE and no retry", async () => {
    const { runHarnessAttempt } = await import("./attempt");
    const events: Array<Record<string, unknown>> = [];
    await runHarnessAttempt(
      {
        actorClerkId: "user_1",
        runId: "run-1",
        resultCardId: "card-1",
        executionId: "exec-1",
        workerId: "test",
        prompt: "Help",
        surface: "chat",
        threadId: "thread-1",
        agentId: "agent-gone",
        mode: "start",
      },
      (event) => events.push(event as Record<string, unknown>),
    );
    expect(modelCalls).toHaveLength(0);
    const failed = calls.find((call) => call.name === "spectraRuns:updateStatus")?.args;
    expect(failed).toMatchObject({ status: "failed", retryable: false, resultActions: [], resultTitle: "Agent unavailable" });
    expect(String(failed?.error)).toMatch(/^AI_AGENT_UNAVAILABLE: /);
    expect(events.find((event) => event.type === "error")).toMatchObject({
      code: "AI_AGENT_UNAVAILABLE",
      message: expect.stringContaining("switch back to Auto"),
    });
    expect(calls.some((call) => call.name === "spectraRuns:setAgentRouting")).toBe(false);
  });
});
