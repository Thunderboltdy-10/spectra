import { afterEach, describe, expect, it, vi } from "vitest";
import { callModel } from "@/app/api/spectra/run/loop/plan";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const update = {
  type: "artifact.update", input: { artifactId: "saved-task", blueprintKey: "planner_task",
    title: null, summary: null, content: null, tags: null,
    contentPatch: { changes: [{ path: "/progressNote", value: "Review evidence before drafting." }] } },
};
const schedule = { type: "app.command", input: { command: "schedule_calendar_task", args: {
  planArtifactId: "saved-task", planTaskId: "task-1", startLocal: "2026-09-25T13:00",
  endLocal: "2026-09-25T14:00", timezone: "Europe/Madrid",
} } };
const toolReply = (name: string, args: unknown) => new Response(JSON.stringify({
  choices: [{ finish_reason: "tool_calls", message: { content: "", tool_calls: [{
    id: name, type: "function", function: { name, arguments: JSON.stringify(args) },
  }] } }],
}), { status: 200 });

describe("S10 independent review: focused edit plus another requested outcome", () => {
  it.each([
    { remainder: "and schedule it tomorrow at 13:00 for one hour", operation: schedule, command: "schedule_calendar_task" },
    { remainder: "and then open the Library", operation: { type: "app.command", input: { command: "navigate_spectra", args: { destination: "library" } } }, command: "navigate_spectra" },
    { remainder: "and then switch Spectra to compact density", operation: { type: "app.command", input: { command: "change_spectra_settings", args: { patch: { appearance: { density: "compact" } } } } }, command: "change_spectra_settings" },
  ])("keeps the remaining $command outcome after editing the open task", async ({ remainder, operation, command }) => {
    vi.stubEnv("OPENROUTER_API_KEY", "disposable-test-key");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => toolReply("propose_operation", {
        workSummary: "Updating the task note", fulfillsRequest: true, operation: update,
      }))
      .mockImplementation(async () => toolReply("submit_plan", {
        decision: "operate", finalResponse: "Updated the note and scheduled the study block.",
        intent: { mode: "mixed", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0,
          targetArtifactId: "saved-task", targetWorkspaceId: null,
          obligations: [
            { id: "note", description: "Update the task note", operationIndexes: [0] },
            { id: "remainder", description: remainder, operationIndexes: [1] },
          ] },
        operations: [operation],
      }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("artifact",
      `Update this task's progress note to 'Review evidence before drafting.' ${remainder}.`,
      { focusedArtifact: { id: "saved-task", title: "Evidence review", type: "planner_task",
        content: { status: "todo", progressNote: "Old note", timezone: "Europe/Madrid",
          recurrence: { frequency: "none", interval: 1, weekdays: [], exceptions: [] }, linkedArtifactIds: [], subtasks: [] } } },
      [],
    );
    expect(result.plan.operations).toHaveLength(2);
    expect(result.plan.operations.some((operation) => operation.type === "app.command"
      && operation.input.command === command)).toBe(true);
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const propose = payload.tools.find((tool: { function: { name: string } }) => tool.function.name === "propose_operation");
    expect(propose.function.parameters.properties.fulfillsRequest.const).not.toBe(true);
  });
});
