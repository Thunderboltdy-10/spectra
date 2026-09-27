import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callModel } from "@/app/api/spectra/run/loop/plan";

const note = {
  type: "artifact.update",
  input: {
    artifactId: "review-task", blueprintKey: "planner_task",
    title: null, summary: null, content: null, tags: null,
    contentPatch: { changes: [{ path: "/progressNote", value: "Check the primary evidence." }] },
  },
};
const focusedArtifact = {
  id: "review-task", title: "Source review", type: "planner_task",
  content: { status: "todo", progressNote: "", timezone: "Europe/Madrid",
    recurrence: { frequency: "none", interval: 1, weekdays: [], exceptions: [] },
    linkedArtifactIds: [], subtasks: [] },
};
const REQUEST = "Original request:\nSet this task's progress note to 'Check the primary evidence.' and ask me how long its study block should last.\n\nClarification 1:\nSpectra asked: 30 or 60 minutes?\nUser answered: 60 minutes.";
const restored = (disposition: "accepted" | "needs_revalidation" | "withdrawn") => ({
  focusedArtifact,
  stagedContinuation: {
    originalRequest: "Set this task's progress note to 'Check the primary evidence.'",
    clarificationResponses: ["Spectra asked: 30 or 60 minutes?\nUser answered: 60 minutes."],
    candidates: [{ operation: note, disposition }],
    candidatesOmitted: false,
  },
});
const turn = (text: string, name?: string, args?: unknown) => () => Promise.resolve(
  new Response(JSON.stringify({ choices: [{
    finish_reason: name ? "tool_calls" : "stop",
    message: { content: text, ...(name ? { tool_calls: [{ id: `${name}-call`, type: "function",
      function: { name, arguments: JSON.stringify(args) } }] } : {}) },
  }] }), { status: 200 }),
);
const toolNames = (call: unknown[]) =>
  (JSON.parse(String((call[1] as RequestInit).body)) as { tools?: Array<{ function: { name: string } }> })
    .tools?.map((tool) => tool.function.name) ?? [];

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "disposable-continuation-key");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("restored clarification staged work", () => {
  it("applies accepted staged work with the final response without restaging it", async () => {
    const fetchMock = vi.fn().mockImplementation(turn("I set the progress note; the study block will last 60 minutes."));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("artifact", REQUEST, restored("accepted"), []);
    expect(result.plan.decision).toBe("operate");
    expect(result.plan.operations).toEqual([expect.objectContaining({
      type: "artifact.update", input: expect.objectContaining({ contentPatch: note.input.contentPatch }),
    })]);
    expect(toolNames(fetchMock.mock.calls[0]!)).toContain("revise_staged_operation");
    expect(JSON.stringify(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).messages))
      .toContain("staged earlier in this same request");
  });

  it("withdraws a staged position the answer cancelled", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(turn("", "revise_staged_operation", {
        operationIndex: 0, action: "withdraw", reason: "The user no longer wants the note changed.",
      }))
      .mockImplementation(turn("Understood: I left the progress note unchanged."));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("artifact", REQUEST, restored("accepted"), []);
    expect(result.plan.operations).toEqual([]);
  });

  it("never applies a restored candidate whose source changed until it is revised", async () => {
    const fetchMock = vi.fn().mockImplementation(turn("Done."));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callModel("artifact", REQUEST, restored("needs_revalidation"), []))
      .rejects.toThrow(/prepared before their source changed/);
    // The model was told to revise the position; it was never applied silently.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(String((fetchMock.mock.calls[1]![1] as RequestInit).body)).toContain("revise_staged_operation");
  });

  it("applies a revalidated replacement in the same staged position", async () => {
    const replacement = { ...note, input: { ...note.input,
      contentPatch: { changes: [{ path: "/progressNote", value: "Check the primary and secondary evidence." }] } } };
    const fetchMock = vi.fn()
      .mockImplementationOnce(turn("", "revise_staged_operation", {
        operationIndex: 0, action: "replace", operation: replacement, reason: "The note changed meanwhile.",
      }))
      .mockImplementation(turn("I updated the progress note for the 60 minute block."));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("artifact", REQUEST, restored("needs_revalidation"), []);
    expect(result.plan.operations).toEqual([expect.objectContaining({
      input: expect.objectContaining({ contentPatch: replacement.input.contentPatch }),
    })]);
  });

  it("re-parks carried positions when a second question is asked", async () => {
    const fetchMock = vi.fn().mockImplementation(turn("", "ask_user_choice", {
      question: "Should the block start in the morning or the afternoon?",
      options: [{ title: "Morning" }, { title: "Afternoon" }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("artifact", REQUEST, restored("needs_revalidation"), []);
    expect(result.plan.decision).toBe("clarify");
    expect(result.plan.operations).toEqual([]);
    expect("stagedCandidates" in result ? result.stagedCandidates : undefined).toEqual([
      expect.objectContaining({ disposition: "needs_revalidation", carried: true }),
    ]);
  });

  it("keeps ordinary requests on their lean tool list", async () => {
    const fetchMock = vi.fn().mockImplementation(turn("The note currently reads nothing."));
    vi.stubGlobal("fetch", fetchMock);
    await callModel("artifact", "What does this task's progress note say?", { focusedArtifact }, []);
    expect(toolNames(fetchMock.mock.calls[0]!)).not.toContain("revise_staged_operation");
  });
});
