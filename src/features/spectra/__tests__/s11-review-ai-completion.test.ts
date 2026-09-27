import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callModel } from "@/app/api/spectra/run/loop/plan";

// Independent acceptance sources. These intentionally exercise the public
// planner boundary, not the new completion adapter in isolation.
const note = {
  type: "artifact.update",
  input: {
    artifactId: "review-task", blueprintKey: "planner_task",
    title: null, summary: null, content: null, tags: null,
    contentPatch: { changes: [{ path: "/progressNote", value: "Check the primary evidence." }] },
  },
};
const navigate = {
  type: "app.command",
  input: { command: "navigate_spectra", args: { destination: "library" } },
};
const context = {
  focusedArtifact: {
    id: "review-task", title: "Source review", type: "planner_task",
    content: { status: "todo", progressNote: "", timezone: "Europe/Madrid",
      recurrence: { frequency: "none", interval: 1, weekdays: [], exceptions: [] },
      linkedArtifactIds: [], subtasks: [] },
  },
};
const turn = (text: string, name?: string, args?: unknown) => () => Promise.resolve(
  new Response(JSON.stringify({ choices: [{
    finish_reason: name ? "tool_calls" : "stop",
    message: { content: text, ...(name ? { tool_calls: [{ id: name, type: "function",
      function: { name, arguments: JSON.stringify(args) } }] } : {}) },
  }] }), { status: 200 }),
);

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "disposable-review-key");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("S11 independent review: ordinary completion and whole request", () => {
  it("accepts a factual answer on the first model turn without planning or tool execution", async () => {
    const answer = "A lunar eclipse occurs when Earth casts its shadow on the Moon.";
    const fetchMock = vi.fn().mockImplementation(turn(answer));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("chat", "What causes a lunar eclipse?", {}, []);
    expect(result.plan.decision).toBe("answer");
    expect(result.plan.finalResponse).toBe(answer);
    expect(result.plan.operations).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not execute JSON printed as an ordinary answer", async () => {
    const answer = JSON.stringify({ decision: "operate", operations: [navigate], finalResponse: "Example only" });
    const fetchMock = vi.fn().mockImplementation(turn(answer));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("chat", "Show a JSON example of a navigation instruction; do not run it.", {}, []);
    expect(result.plan.operations).toEqual([]);
    expect(result.plan.finalResponse).toBe(answer);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("continues after a focused tool claims fulfillment and retains the second requested action", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(turn("", "propose_operation", {
        workSummary: "Updating the evidence note", fulfillsRequest: true, operation: note,
      }))
      .mockImplementationOnce(turn("", "navigate_spectra", { destination: "library" }))
      .mockImplementation(turn("Updated the task note and requested Library navigation."));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("artifact",
      "Set this task's progress note to 'Check the primary evidence.' and then open the Library.", context, []);
    expect(result.plan.operations).toHaveLength(2);
    expect(result.plan.operations[0]).toMatchObject(note);
    expect(result.plan.operations[1]).toMatchObject(navigate);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(JSON.stringify(secondRequest.messages)).toContain("staged");
  });

  it("retains accepted work across a malformed final response and deduplicates its repair replay", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(turn("", "propose_operation", {
        workSummary: "Updating the evidence note", fulfillsRequest: false, operation: note,
      }))
      .mockImplementationOnce(turn("", "submit_plan", null))
      .mockImplementationOnce(turn("", "propose_operation", {
        workSummary: "Updating the evidence note", fulfillsRequest: false, operation: note,
      }))
      .mockImplementationOnce(turn("", "navigate_spectra", { destination: "library" }))
      .mockImplementation(turn("Updated the task note and requested Library navigation."));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("artifact",
      "Set this task's progress note to 'Check the primary evidence.' and then open the Library.", context, []);
    expect(result.plan.operations).toHaveLength(2);
    expect(result.plan.operations[0]).toMatchObject(note);
    expect(result.plan.operations[1]).toMatchObject(navigate);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const repairRequest = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(JSON.stringify(repairRequest.messages)).toContain("Check the primary evidence.");
  });

  it("returns the accepted candidate when a later outcome needs clarification", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(turn("", "propose_operation", {
        workSummary: "Updating the evidence note", fulfillsRequest: false, operation: note,
      }))
      .mockImplementation(turn("", "ask_user_choice", {
        question: "Should the study block last 30 or 60 minutes?",
        options: [{ title: "30 minutes" }, { title: "60 minutes" }],
      }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("artifact",
      "Set this task's progress note to 'Check the primary evidence.' Then ask me how long its study block should last.",
      context, []);
    expect(result.plan.decision).toBe("clarify");
    expect(result.plan.choices && "question" in result.plan.choices ? result.plan.choices.question : undefined).toContain("30 or 60");
    // Do not prescribe the persisted candidate field: awaiting input must not
    // silently erase its typed payload. A follow-up integration test must also
    // reload that candidate and revalidate it before effect.
    const findCandidates = (value: unknown): unknown[] => {
      if (!value || typeof value !== "object") return [];
      if (Array.isArray(value)) return value.flatMap(findCandidates);
      const record = value as Record<string, unknown>;
      return record.type === "artifact.update" && record.input
        ? [record] : Object.values(record).flatMap(findCandidates);
    };
    expect(findCandidates(result)).toContainEqual(expect.objectContaining({
      type: "artifact.update", input: expect.objectContaining({
        artifactId: "review-task", contentPatch: note.input.contentPatch,
      }),
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
