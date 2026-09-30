import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveArtifactWriteInput } from "@/features/spectra/operations/artifact-write-content";
import { parseModelOperation, SPECTRA_PLAN_JSON_SCHEMA } from "@/features/spectra/operations/schema";
import { assertRequestedArtifactContent, singleCreationAgentTool } from "@/app/api/spectra/run/loop/plan";
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


  it("keeps provider reply contracts aligned with unrestricted final prose", () => {
    expect(SPECTRA_PLAN_JSON_SCHEMA.properties.finalResponse).toEqual({ type: "string", minLength: 1 });
    const tool = singleCreationAgentTool("planner_task");
    const parameters = tool.function.parameters as { properties: { finalResponse: unknown } };
    expect(parameters.properties.finalResponse).toEqual({ type: "string", minLength: 1 });
  });

  it("preserves a long ordinary answer without repair or shortening", async () => {
    const answer = "A complete paragraph of the requested explanation. ".repeat(600);
    const fetchMock = vi.fn().mockImplementation(turn(answer));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("chat", "Explain this subject in detail.", {}, []);
    expect(result.plan.finalResponse).toBe(answer.trim());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("preserves long continued prose and its truthful cutoff note (%s)", async (stillCutOff) => {
    const prefix = "First part of a detailed explanation. ".repeat(350);
    const tail = "The remaining explanation ends here.";
    const limited = () => Promise.resolve(new Response(JSON.stringify({ choices: [{
      finish_reason: "length", message: { content: prefix },
    }] }), { status: 200 }));
    const fetchMock = vi.fn().mockImplementationOnce(limited);
    if (stillCutOff) fetchMock.mockImplementation(limited);
    else fetchMock.mockImplementation(turn(tail));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("chat", "Explain this subject in detail.", {}, []);
    expect(result.plan.finalResponse).toBe(stillCutOff
      ? prefix.repeat(4).trimEnd() + "\n\n_This answer reached the length limit and stops here. Ask me to continue for the rest._"
      : prefix + tail);
    expect(fetchMock).toHaveBeenCalledTimes(stillCutOff ? 4 : 2);
  });

  it("preserves a long completion with accepted operations", async () => {
    const answer = "The evidence note is ready for the next review. ".repeat(150);
    const fetchMock = vi.fn()
      .mockImplementationOnce(turn("", "propose_operation", {
        workSummary: "Updating the evidence note", fulfillsRequest: false, operation: note,
      }))
      .mockImplementation(turn(answer));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("artifact", "Update the evidence note and explain the review process.", context, []);
    expect(result.plan.finalResponse).toBe(answer.trim());
    expect(result.plan.operations).toEqual([note]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });


  it.each(["flashcard_deck", "quiz"] as const)("accepts an append to an existing %s without imposing a creation total", async (blueprintKey) => {
    const field = blueprintKey === "quiz" ? "questions" : "cards";
    const noun = blueprintKey === "quiz" ? "questions" : "cards";
    const item = (id: string) => blueprintKey === "quiz"
      ? { id, type: "short_answer", prompt: "What is carbon fixation?", correctAnswer: "Carbon dioxide becomes organic carbon." }
      : { id, front: "What is carbon fixation?", back: "Carbon dioxide becomes organic carbon.", hint: "Track the carbon." };
    const original = Array.from({ length: 8 }, (_, i) => item("old-" + i));
    const changes = Array.from({ length: 4 }, (_, i) => ({ path: "/" + field + "/-", value: item("new-" + i) }));
    const operation = { type: "artifact.update", input: {
      artifactId: "review-deck", blueprintKey, title: null, summary: null, content: null, tags: null,
      contentPatch: { changes },
    } };
    const fetchMock = vi.fn()
      .mockImplementationOnce(turn("", "propose_operation", { workSummary: "Adding the four review items", fulfillsRequest: false, operation }))
      .mockImplementation(turn("The four items are staged for addition."));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callModel("artifact", "Add 4 " + noun + " about the Calvin cycle.", {
      focusedArtifact: { id: "review-deck", title: "Photosynthesis", type: blueprintKey, content: { [field]: original } },
    }, []);
    expect(result.plan.operations).toHaveLength(1);
    expect(result.plan.operations[0]).toMatchObject(operation);
    const accepted = result.plan.operations[0]!;
    expect(accepted.type).toBe("artifact.update");
    if (accepted.type !== "artifact.update") throw new Error("Expected an update");
    const saved = resolveArtifactWriteInput(blueprintKey, { [field]: original }, accepted.input, "Add four review items.").content as Record<string, Array<{ id: string }>>;
    expect(saved[field]).toHaveLength(12);
    expect(saved[field]!.slice(0, 8).map((value) => value.id)).toEqual(original.map((value) => value.id));
    expect(saved[field]!.slice(8).map((value) => value.id)).toEqual(["new-0", "new-1", "new-2", "new-3"]);
    expect(original).toHaveLength(8);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["flashcard_deck", "quiz"] as const)("allows full updates but preserves exact creation counts for %s", (blueprintKey) => {
    const field = blueprintKey === "quiz" ? "questions" : "cards";
    const noun = blueprintKey === "quiz" ? "questions" : "cards";
    const content = { [field]: Array.from({ length: 12 }, (_, i) => blueprintKey === "quiz"
      ? { id: "item-" + i, type: "short_answer", prompt: "Review question " + i, correctAnswer: "Review answer " + i }
      : { id: "item-" + i, front: "Review question " + i, back: "Review answer " + i }) };
    const update = parseModelOperation({ type: "artifact.update", input: {
      artifactId: "review-deck", blueprintKey, title: null, summary: null, tags: null, content,
    } });
    expect(() => assertRequestedArtifactContent([update], "Add 4 " + noun + ".")).not.toThrow();
    const create = parseModelOperation({ type: "artifact.create", input: {
      blueprintKey, content, title: "New review", summary: null, tags: [], workspaceId: null, placement: "inbox",
    } });
    expect(() => assertRequestedArtifactContent([create], "Create a review with 4 " + noun + ".")).toThrow("must contain exactly 4");
    expect(() => assertRequestedArtifactContent([create], "Create a review with 12 " + noun + ".")).not.toThrow();
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
