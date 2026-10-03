import { describe, expect, it } from "vitest";
import { applyHarnessEvent, mergeTouch, type HarnessExchangeFields } from "../../harness-exchange";

const runId = "run";
const empty: HarnessExchangeFields = { steps: [] };

describe("live exchange from harness events", () => {
  it("shows captions as the trace, with the tool steps behind them as detail", () => {
    let state = applyHarnessEvent(empty, { type: "step", runId, id: "a", label: "Read Biology notes", status: "running" });
    state = applyHarnessEvent(state, { type: "step", runId, id: "a", label: "Read Biology notes", status: "done" });
    state = applyHarnessEvent(state, { type: "caption", runId, text: "Reading your Biology notes", final: false, stepIds: ["a"] });
    expect(state.steps).toMatchObject([{ title: "Reading your Biology notes", summary: "Read Biology notes", status: "running" }]);
    state = applyHarnessEvent(state, { type: "caption", runId, text: "Drafting six slides", final: false, stepIds: ["b"] });
    expect(state.steps.map((step) => step.status)).toEqual(["done", "running"]);
    state = applyHarnessEvent(state, { type: "caption", runId, text: "Made a six-slide deck", final: true, stepIds: ["a", "b"] });
    expect(state.caption).toBe("Made a six-slide deck");
    expect(state.steps.every((step) => step.status === "done")).toBe(true);
  });

  it("never repeats the same caption as a new bar", () => {
    let state = applyHarnessEvent(empty, { type: "caption", runId, text: "Reading notes", final: false, stepIds: ["a"] });
    state = applyHarnessEvent(state, { type: "caption", runId, text: "Reading notes", final: false, stepIds: ["b"] });
    expect(state.steps).toHaveLength(1);
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

  it("keeps one card per piece of work, and a creation stays a creation", () => {
    let list = mergeTouch([], { id: "w", type: "document", title: "Essay", action: "created" });
    list = mergeTouch(list, { id: "w", type: "document", title: "Essay v2", action: "edited", change: "Shortened the intro" });
    list = mergeTouch(list, { id: "x", type: "sheets", title: "Data", action: "referenced" });
    expect(list).toEqual([
      { id: "w", type: "document", title: "Essay v2", action: "created", change: "Shortened the intro" },
      { id: "x", type: "sheets", title: "Data", action: "referenced" },
    ]);
  });
});
