import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchStreamEvent } from "@/features/spectra/agents/foundry";
import { ProviderUnavailableError } from "@/features/spectra/ai/harness/types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  convexQuery: vi.fn(),
  convexMutation: vi.fn(),
  callSpectraModel: vi.fn(),
  admit: vi.fn(),
  meter: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/convex-server", () => ({
  convexQuery: mocks.convexQuery,
  convexMutation: mocks.convexMutation,
}));
vi.mock("@/features/spectra/ai/harness/model", () => ({
  callSpectraModel: mocks.callSpectraModel,
}));
vi.mock("../model-work", () => ({
  admitAgentModelWork: mocks.admit,
  recordAgentModelWork: mocks.meter,
}));
import { POST } from "./route";

const draft = {
  title: "Essay coach",
  summary: "Feedback",
  blueprintKey: "agent",
  content: { instructions: { text: "Be precise." } },
};

function post(body: unknown) {
  return POST(
    new Request("https://example.test/api/spectra/agents/bench", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function events(response: Response): Promise<BenchStreamEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BenchStreamEvent);
}

describe("the bench route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user_1" });
    mocks.admit.mockResolvedValue(undefined);
    mocks.meter.mockResolvedValue(undefined);
    mocks.convexQuery.mockImplementation(async (name: string) => {
      if (name === "agents:draftForEvaluation") return draft;
      if (name === "spectraArtifacts:agentBenchRelease")
        return { releaseNumber: 3, title: "Essay coach", content: { instructions: { text: "Old." } } };
      throw new Error(`unexpected ${name}`);
    });
    mocks.convexMutation.mockResolvedValue({ runId: "run_1", createdAt: 42 });
    mocks.callSpectraModel.mockImplementation(async (request: { onText?: (delta: string) => void }) => {
      request.onText?.("Your thesis ");
      request.onText?.("is clear.");
      return { text: "Your thesis is clear.", toolCalls: [], usage: { promptTokens: 120, completionTokens: 8 } };
    });
  });

  it("streams the draft's answer, meters it, and keeps it for the next comparison", async () => {
    const response = await post({ agentId: "agent_1", prompt: "  Mark my essay  " });
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await events(response)).toEqual([
      { type: "start", target: "draft" },
      { type: "text", delta: "Your thesis " },
      { type: "text", delta: "is clear." },
      {
        type: "done",
        run: { id: "run_1", prompt: "Mark my essay", target: "draft", output: "Your thesis is clear.", createdAt: 42 },
      },
    ]);
    expect(mocks.admit).toHaveBeenCalledWith("agent_1");
    expect(mocks.meter).toHaveBeenCalledWith("user_1", "agent_1", "agent_bench", { inputTokens: 120, outputTokens: 8 });
    expect(mocks.convexMutation).toHaveBeenCalledWith("agents:recordBenchRun", {
      agentId: "agent_1",
      prompt: "Mark my essay",
      target: "draft",
      output: "Your thesis is clear.",
    });
    const request = mocks.callSpectraModel.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
      reasoning?: string;
    };
    // The model and reasoning come from the environment, never from the bench.
    expect(request.reasoning).toBeUndefined();
    expect(request.messages[0]!.content).toContain("Be precise.");
    expect(request.messages[1]).toEqual({ role: "user", content: "Mark my essay" });
  });

  it("answers with the editor's unsaved content when it sends one", async () => {
    await events(await post({ agentId: "agent_1", prompt: "Hi", content: { instructions: { text: "Unsaved edit." } } }));
    const request = mocks.callSpectraModel.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(request.messages[0]!.content).toContain("Unsaved edit.");
  });

  it("answers as the last release, and says which", async () => {
    const stream = await events(await post({ agentId: "agent_1", prompt: "Hi", target: "release" }));
    expect(stream[0]).toEqual({ type: "start", target: "release", releaseNumber: 3 });
    expect(stream.at(-1)).toMatchObject({ type: "done", run: { target: "release", releaseNumber: 3 } });
    const request = mocks.callSpectraModel.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(request.messages[0]!.content).toContain("Old.");
  });

  it("says plainly when there is no release yet, before any model work", async () => {
    mocks.convexQuery.mockResolvedValue(null);
    const response = await post({ agentId: "agent_1", prompt: "Hi", target: "release" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "AGENT_BENCH_NO_RELEASE", message: "This agent has no release to compare with yet." },
    });
    expect(mocks.admit).not.toHaveBeenCalled();
    expect(mocks.callSpectraModel).not.toHaveBeenCalled();
  });

  it("refuses an empty question and a signed-out caller", async () => {
    expect((await post({ agentId: "agent_1", prompt: "  " })).status).toBe(400);
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await post({ agentId: "agent_1", prompt: "Hi" })).status).toBe(401);
    expect(mocks.callSpectraModel).not.toHaveBeenCalled();
  });

  it("stops at the school's usage limit before asking the model", async () => {
    mocks.admit.mockRejectedValue(new Error("SCHOOL_MODEL_TOKEN_CEILING: Your school reached its AI usage limit for today."));
    const response = await post({ agentId: "agent_1", prompt: "Hi" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("Your school reached its AI usage limit for today.");
    expect(mocks.callSpectraModel).not.toHaveBeenCalled();
  });

  it("tells the bench to start over when the provider retried", async () => {
    mocks.callSpectraModel.mockImplementation(async (request: { onText?: (d: string) => void; onRetry?: () => void }) => {
      request.onText?.("Half");
      request.onRetry?.();
      request.onText?.("Whole answer.");
      return { text: "Whole answer.", toolCalls: [] };
    });
    const stream = await events(await post({ agentId: "agent_1", prompt: "Hi" }));
    expect(stream.map((event) => event.type)).toEqual(["start", "text", "retry", "text", "done"]);
  });

  it("ends the stream with a plain sentence when the model cannot be reached", async () => {
    mocks.callSpectraModel.mockRejectedValue(new ProviderUnavailableError("down"));
    const stream = await events(await post({ agentId: "agent_1", prompt: "Hi" }));
    expect(stream.at(-1)).toEqual({ type: "error", message: "Spectra could not reach the AI model. Try again in a moment." });
    expect(mocks.convexMutation).not.toHaveBeenCalled();
  });

  it("still shows the answer when it cannot be kept", async () => {
    mocks.convexMutation.mockRejectedValue(new Error("offline"));
    const stream = await events(await post({ agentId: "agent_1", prompt: "Hi" }));
    expect(stream.at(-1)).toMatchObject({ type: "done", run: { output: "Your thesis is clear." } });
  });
});
