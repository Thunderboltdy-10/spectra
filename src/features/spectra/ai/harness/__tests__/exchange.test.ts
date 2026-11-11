import { describe, expect, it } from "vitest";
import { applyHarnessEvent, mergeTouch, type HarnessExchangeFields } from "../../harness-exchange";

const runId = "run";
const empty: HarnessExchangeFields = { steps: [] };

describe("live exchange from harness events", () => {
  it("keeps thinking and tool steps in the order they happened", () => {
    let state = applyHarnessEvent(empty, { type: "reasoning_delta", runId, id: "t1", content: "**Finding the notes**\n\nLook" });
    state = applyHarnessEvent(state, { type: "reasoning_delta", runId, id: "t1", content: "ing" });
    state = applyHarnessEvent(state, { type: "step", runId, id: "s1", label: "Reading *Notes*", status: "running" });
    expect(state.steps.map((step) => step.status)).toEqual(["done", "running"]);
    state = applyHarnessEvent(state, { type: "step", runId, id: "s1", label: "Read *Notes*", status: "done" });
    state = applyHarnessEvent(state, { type: "reasoning_delta", runId, id: "t2", content: "Now the edit" });
    expect(state.steps.map((step) => step.id)).toEqual(["t1", "s1", "t2"]);
    expect(state.steps[0]!.summary).toBe("**Finding the notes**\n\nLooking");
    expect(state.steps[1]!.title).toBe("Read *Notes*");
    state = applyHarnessEvent(state, { type: "reasoning_delta", runId, id: "t2", content: "", done: true });
    expect(state.steps[2]!.status).toBe("done");
  });
  it("collapses an answered question to one line", () => {
    let state = applyHarnessEvent(empty, {
      type: "input_required",
      runId,
      input: { kind: "approval", toolCallId: "t1", executionId: "e", question: "Share Revision plan with Ana?" },
    });
    expect(state.input?.toolCallId).toBe("t1");
    state = applyHarnessEvent(state, { type: "input_answered", runId, toolCallId: "t1", label: "Allowed" });
    state = applyHarnessEvent(state, { type: "input_answered", runId, toolCallId: "t1", label: "Allowed" });
    expect(state.input).toBeUndefined();
    expect(state.answers).toEqual([{ toolCallId: "t1", kind: "approval", question: "Share Revision plan with Ana?", label: "Allowed" }]);
  });

  it("keeps one card per artifact, and a creation stays a creation", () => {
    let list = mergeTouch([], { id: "w", type: "document", title: "Essay", action: "created" });
    list = mergeTouch(list, { id: "w", type: "document", title: "Essay v2", action: "edited", change: "Shortened the intro" });
    list = mergeTouch(list, { id: "x", type: "sheets", title: "Data", action: "referenced" });
    expect(list).toEqual([
      { id: "w", type: "document", title: "Essay v2", action: "created", change: "Shortened the intro" },
      { id: "x", type: "sheets", title: "Data", action: "referenced" },
    ]);
  });
});
