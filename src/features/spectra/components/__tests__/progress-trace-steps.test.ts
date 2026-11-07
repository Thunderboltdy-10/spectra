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
