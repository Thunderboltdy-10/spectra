import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callModel } from "@/app/api/spectra/run/loop/plan";
import { validatePlanAgainstIntent } from "../operations/validate-plan";

const note = {
  type: "artifact.update",
  input: {
    artifactId: "saved-task", blueprintKey: "planner_task", title: null,
    summary: null, content: null, tags: null,
    contentPatch: { changes: [{ path: "/progressNote", value: "Review the evidence." }] },
  },
};
const context = {
  focusedArtifact: {
    id: "saved-task", title: "Evidence review", type: "planner_task",
    content: { status: "todo", progressNote: "Old note", timezone: "Europe/Madrid",
      recurrence: { frequency: "none", interval: 1, weekdays: [], exceptions: [] },
      linkedArtifactIds: [], subtasks: [] },
  },
};
const reply = (text: string, name?: string, args?: unknown) => new Response(JSON.stringify({
  model: "openai/gpt-6-luna", provider: "OpenAI",
  choices: [{ finish_reason: name ? "tool_calls" : "stop", message: {
    content: text,
    ...(name ? { tool_calls: [{ id: crypto.randomUUID(), type: "function",
      function: { name, arguments: JSON.stringify(args) } }] } : {}),
  } }],
}), { status: 200 });

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "disposable-test-key");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("S11 ordinary model loop", () => {
  it.each([
    ["Hola, ¿cómo estás?", "Hola. ¿En qué estás trabajando?"],
    ["Why does the Moon have phases?", "We see different portions of its sunlit half as it orbits Earth."],
    ["What is 18 times 7?", "126"],
  ])("answers %s in one model turn with no tools or terminal metadata", async (prompt, answer) => {
    const fetchMock = vi.fn().mockImplementation(async () => reply(answer));
    const onOperation = vi.fn();
    const onProgress = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("chat", prompt!, {}, [], undefined, undefined,
      undefined, onOperation, undefined, onProgress);
    expect(result.plan).toMatchObject({ decision: "answer", operations: [], finalResponse: answer });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onOperation).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    const payload = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(payload.tool_choice).toBe("auto");
    expect(payload.response_format).toBeUndefined();
  });

  it("never executes a plan-looking JSON example in ordinary answer text", async () => {
    const answer = JSON.stringify({ decision: "operate", operations: [note], finalResponse: "Example" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => reply(answer)));
    const onOperation = vi.fn();
    const result = await callModel("chat", "Show a JSON operation example without applying it.", {}, [],
      undefined, undefined, undefined, onOperation);
    expect(result.plan).toMatchObject({ decision: "answer", operations: [], finalResponse: answer });
    expect(onOperation).not.toHaveBeenCalled();
  });

  it("keeps both parts of mixed work and finishes without a second plan or obligations", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => reply("", "propose_operation", {
        workSummary: "Updating the task note", fulfillsRequest: true, operation: note,
      }))
      .mockImplementationOnce(async () => reply("", "schedule_calendar_task", {
        planArtifactId: "saved-task", planTaskId: "task-1",
        startLocal: "2026-09-26T13:00", endLocal: "2026-09-26T14:00", timezone: "Europe/Madrid",
      }))
      .mockImplementationOnce(async () => reply("Updated the note and scheduled an hour to review it."));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("artifact", "Update this task's progress note to 'Review the evidence.' and schedule it tomorrow at 13:00 for one hour.", context, []);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.plan.operations.map((operation) => operation.type)).toEqual(["artifact.update", "app.command"]);
    expect(result.plan.intent.obligations).toBeUndefined();
    expect(() => validatePlanAgainstIntent(result.plan, {
      artifactIds: new Set(["saved-task"]), artifactBlueprints: new Map([["saved-task", "planner_task"]]),
      workspaceIds: new Set(), placementNodes: new Map(),
    })).not.toThrow();
  });

  it("preserves accepted mixed work and stable indexes through an empty-response recovery", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => reply("", "propose_operation", {
        workSummary: "Updating the task note", operation: note,
      }))
      .mockImplementationOnce(async () => reply(""))
      .mockImplementationOnce(async () => reply("", "navigate_spectra", { destination: "library" }))
      .mockImplementationOnce(async () => reply("Updated the note and requested Library navigation."));
    vi.stubGlobal("fetch", fetchMock);
    const onOperation = vi.fn();
    const onRepair = vi.fn();
    const result = await callModel("artifact", "Update this task's progress note to 'Review the evidence.' and then open the Library.",
      context, [], undefined, undefined, undefined, onOperation, onRepair);
    expect(result.plan.operations).toHaveLength(2);
    expect(result.plan.operations[0]).toMatchObject(note);
    expect(result.plan.operations[1]).toMatchObject({ type: "app.command", input: { command: "navigate_spectra" } });
    expect(onRepair).toHaveBeenCalledTimes(1);
    expect(onOperation.mock.calls.map((call) => call[1])).toEqual([0, 1]);
    const recoveryPayload = JSON.parse(String(fetchMock.mock.calls[2]![1].body));
    expect(recoveryPayload.tool_choice).toBe("auto");
    expect(recoveryPayload.response_format).toBeUndefined();
    expect(recoveryPayload.messages).toContainEqual(expect.objectContaining({
      role: "system", content: expect.stringContaining('"operationIndex":0'),
    }));
  });

  it("does not restart a semantically stalled loop through JSON repair or another provider", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reply("", "propose_operation", {
      workSummary: "Updating the task note", operation: note,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onOperation = vi.fn();
    const onRepair = vi.fn();
    await expect(callModel("artifact", "Update this task's progress note to 'Review the evidence.' and then open the Library.",
      context, [], undefined, undefined, undefined, onOperation, onRepair))
      .rejects.toMatchObject({ name: "SpectraAgentNoProgressError" });
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(onOperation).toHaveBeenCalledTimes(1);
    expect(onRepair).not.toHaveBeenCalled();
  });
});
