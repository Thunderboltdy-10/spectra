import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../model-work", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model-work")>()),
  admitAgentModelWork: mocks.admit,
  recordHarnessModelWork: mocks.meter,
}));
import { compilationForModel, compileAgentDraft } from "./compile";
import { POST } from "./route";

const compiled = {
  skills: [
    {
      id: "mark-essay",
      name: "Mark an essay",
      purpose: "Grades an essay against the rubric.",
      triggers: [{ kind: "keyword", terms: ["mark"] }],
      procedure: [{ order: 1, action: "Read the rubric" }],
    },
  ],
  routingDescription: "Essay feedback",
  routingExamples: ["Mark my essay"],
  negativeExamples: ["Write my essay"],
  releaseNotes: "First skills.",
};

function draft(objective: string) {
  return {
    title: "Essay coach",
    blueprintKey: "agent",
    content: { foundry: { mission: { objective, domains: ["English"] } } },
  };
}

function jobUpdates() {
  return mocks.convexMutation.mock.calls.filter(([name]) => name === "agents:updateCompilerJob").map(([, args]) => args as Record<string, unknown>);
}

describe("compiling an agent in the Foundry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user_1" });
    mocks.admit.mockResolvedValue(undefined);
    mocks.meter.mockResolvedValue(undefined);
    mocks.convexQuery.mockImplementation(async (name: string) => (name === "agents:draftForEvaluation" ? draft("Mark essays kindly") : null));
    mocks.convexMutation.mockImplementation(async (name: string) =>
      name === "agents:beginCompilerJob" ? { jobId: "job", runId: "compile-run" } : { ok: true });
    mocks.callSpectraModel.mockImplementation(async (request: { onText?: (delta: string) => void }) => {
      request.onText?.("{");
      return { text: JSON.stringify(compiled), toolCalls: [], usage: { promptTokens: 900, completionTokens: 300 } };
    });
  });

  it("drafts skills, routing and notes on a completed job, with the model and reasoning from the environment, and meters the work", async () => {
    const result = await compileAgentDraft({ userId: "user_1", agentId: "agent" });
    expect(mocks.convexMutation).toHaveBeenCalledWith("agents:beginCompilerJob", { agentId: "agent", skipStages: ["extract_evidence", "detect_overlap"] });
    const request = mocks.callSpectraModel.mock.calls[0]![0] as Record<string, unknown>;
    expect(request.responseFormat).toEqual({ type: "json_object" });
    expect(request).not.toHaveProperty("model");
    expect(request).not.toHaveProperty("reasoning");
    expect(request).not.toHaveProperty("maxTokens");
    expect(result).toMatchObject({
      jobId: "job",
      runId: "compile-run",
      skills: [{ id: "mark-essay", name: "Mark an essay" }],
      routing: { description: "Essay feedback", examples: ["Mark my essay"], negativeExamples: ["Write my essay"] },
      releaseNotes: "First skills.",
    });
    const last = jobUpdates().at(-1)!;
    expect(last).toMatchObject({ jobId: "job", status: "completed", result: { releaseNotes: "First skills." } });
    expect((last.stages as Array<{ status: string }>).every((stage) => stage.status === "completed" || stage.status === "skipped")).toBe(true);
    expect(mocks.meter).toHaveBeenCalledTimes(1);
    expect(mocks.meter).toHaveBeenCalledWith("user_1", "agent", "agent_foundry", { inputTokens: 900, outputTokens: 300 });

    const forModel = compilationForModel(result);
    expect(forModel).toMatchObject({ state: "compiled", skills: [{ id: "mark-essay", triggers: ["words: mark"], steps: 1 }] });
    expect(forModel.note).toMatch(/never instructions/);
  });

  it("cancels the job when it is stopped, and meters what the stopped call spent", async () => {
    const controller = new AbortController();
    mocks.callSpectraModel.mockImplementation(async (request: { onText?: (delta: string) => void }) => {
      request.onText?.('{"skills": [');
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(compileAgentDraft({ userId: "user_1", agentId: "agent", signal: controller.signal })).rejects.toThrow();
    expect(mocks.convexMutation).toHaveBeenCalledWith("agents:cancelCompilerJob", { jobId: "job" });
    expect(jobUpdates().some((update) => update.status === "failed" || update.status === "completed")).toBe(false);
    expect(mocks.meter).toHaveBeenCalledWith("user_1", "agent", "agent_foundry", expect.objectContaining({ inputTokens: expect.any(Number) }), { stopped: true });
    const stopped = mocks.meter.mock.calls.find((call) => call[4])![3] as { inputTokens: number; outputTokens: number };
    expect(stopped.inputTokens).toBeGreaterThan(0);
    expect(stopped.outputTokens).toBeGreaterThan(0);
  });

  it("fails the stage, never the draft, on an unusable answer or a missing objective", async () => {
    mocks.callSpectraModel.mockResolvedValueOnce({ text: "not json", toolCalls: [], usage: { promptTokens: 10, completionTokens: 2 } });
    await expect(compileAgentDraft({ userId: "user_1", agentId: "agent" })).rejects.toThrow("unusable result");
    expect(jobUpdates().at(-1)).toMatchObject({ status: "failed" });
    expect(mocks.convexMutation).not.toHaveBeenCalledWith("agents:cancelCompilerJob", expect.anything());

    vi.clearAllMocks();
    mocks.convexQuery.mockResolvedValue(draft(""));
    mocks.convexMutation.mockResolvedValue({ jobId: "job", runId: "compile-run" });
    await expect(compileAgentDraft({ userId: "user_1", agentId: "agent" })).rejects.toThrow("before compiling");
    expect(mocks.callSpectraModel).not.toHaveBeenCalled();
    expect(jobUpdates().at(-1)).toMatchObject({ status: "failed" });
  });

  it("is what the studio's Compile runs, through the Foundry route", async () => {
    const response = await POST(
      new Request("https://example.test/api/spectra/agents/foundry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "compile", agentId: "agent" }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, jobId: "job", skills: [{ id: "mark-essay" }], releaseNotes: "First skills." });
    expect(mocks.meter).toHaveBeenCalledTimes(1);
  });

  it("answers the route's other steps through the same model call, metered once each", async () => {
    mocks.callSpectraModel.mockResolvedValueOnce({ text: '{"title": "Essay coach", "objective": "Mark essays"}', toolCalls: [], usage: { promptTokens: 50, completionTokens: 20 } });
    const response = await POST(
      new Request("https://example.test/api/spectra/agents/foundry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "foundation", agentId: "agent", objective: "Mark essays", interaction: "Kind" }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({ ok: true, title: "Essay coach" });
    expect((mocks.callSpectraModel.mock.calls[0]![0] as Record<string, unknown>).responseFormat).toEqual({ type: "json_object" });
    expect(mocks.meter).toHaveBeenCalledTimes(1);
    expect(mocks.meter).toHaveBeenCalledWith("user_1", "agent", "agent_foundry", { inputTokens: 50, outputTokens: 20 });
  });
});
