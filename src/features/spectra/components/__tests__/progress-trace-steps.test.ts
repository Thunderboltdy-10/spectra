import { describe, expect, it } from "vitest";
import { visibleTraceSteps } from "../progress-trace";

const step = (id: string, title: string, status = "done", kind = "tool") => ({ id, title, status, kind });

describe("what the trace shows", () => {
  it("folds a run of the same action into one line with a count", () => {
    const shown = visibleTraceSteps([step("a", "Updated your calendar"), step("b", "Updated your calendar"), step("c", "Updated your calendar")], false);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ id: "c", repeats: 3 });
  });

  it("keeps separate thoughts separate", () => {
    const shown = visibleTraceSteps([step("a", "Thinking", "done", "thinking"), step("b", "Thinking", "done", "thinking")], false);
    expect(shown).toHaveLength(2);
  });

  it("leaves out a failure that later work moved past, and keeps one nothing came after", () => {
    expect(visibleTraceSteps([step("a", "Reading your notes", "error"), step("b", "Edited your notes")], false).map((s) => s.id)).toEqual(["b"]);
    expect(visibleTraceSteps([step("a", "Edited your notes", "error"), step("b", "Edited your notes")], false).map((s) => s.id)).toEqual(["b"]);
    expect(visibleTraceSteps([step("a", "Edited your notes"), step("b", "Moving it to the Trash", "error")], false).map((s) => s.id)).toEqual(["a", "b"]);
    expect(visibleTraceSteps([step("a", "Reading your notes", "error")], false).map((s) => s.id)).toEqual(["a"]);
  });
});

describe("a run that moved to another runtime", () => {
  it("names the last runtime it finished with, and nothing when it never moved", async () => {
    const { finishedWithLabel } = await import("../progress-trace");
    expect(finishedWithLabel([step("a", "Read your notes")])).toBeUndefined();
    expect(finishedWithLabel([step("runtime-move:codex:claude", "Continued with Claude Code"), step("b", "Edited your notes")])).toBe("Finished with Claude Code");
    expect(
      finishedWithLabel([step("runtime-move:codex:claude", "Continued with Claude Code"), step("runtime-move:claude:spectra", "Continued with Spectra")]),
    ).toBe("Finished with Spectra");
  });

  it("keeps why the run moved on the step, for the hover", async () => {
    const { applyHarnessEvent } = await import("../../ai/harness-exchange");
    const fields = applyHarnessEvent(
      { steps: [], written: 0 },
      { type: "step", runId: "r", id: "runtime-move:codex:claude", label: "Continued with Claude Code", status: "done", durationMs: 0, detail: "Codex stopped responding" },
      1,
    );
    expect(fields.steps[0]).toMatchObject({ title: "Continued with Claude Code", summary: "Codex stopped responding" });
  });
});
