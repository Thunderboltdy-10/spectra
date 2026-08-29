import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { planWorkbarOverflow, sameIdList, shouldCommitWorkbarPlan, shouldIgnoreWorkbarHostResize, shouldReplaceWorkbarPlan, shouldWarnEssentialOverBudget } from "../components/workbar-overflow";

function item(
  id: string,
  fullWidth: number,
  extra?: { disabled?: boolean; priority?: "essential" | "secondary" | "advanced"; iconWidth?: number },
) {
  return {
    id,
    fullWidth,
    iconWidth: extra?.iconWidth ?? 32,
    disabled: extra?.disabled,
    priority: extra?.priority,
  };
}

describe("planWorkbarOverflow", () => {
  it("keeps every labelled command when the row has room", () => {
    const plan = planWorkbarOverflow(
      [item("a", 80), item("b", 80), item("c", 80)],
      400,
    );
    expect(plan.overflowIds).toEqual([]);
    expect(plan.iconOnlyIds).toEqual([]);
    expect(plan.visibleIds).toEqual(["a", "b", "c"]);
  });

  it("keeps honest-disabled essentials visible while shedding advanced extras", () => {
    const plan = planWorkbarOverflow(
      [
        item("bold", 72, { priority: "essential", disabled: true }),
        item("italic", 72, { priority: "essential" }),
        item("notes", 96, { priority: "advanced" }),
      ],
      160,
    );
    expect(plan.visibleIds).toContain("bold");
    expect(plan.visibleIds).toContain("italic");
    expect([...plan.iconOnlyIds, ...plan.overflowIds]).toContain("notes");
  });

  it("collapses advanced labels before essential labels", () => {
    const plan = planWorkbarOverflow(
      [
        item("add", 90, { priority: "essential" }),
        item("theme", 90, { priority: "advanced" }),
        item("present", 90, { priority: "essential" }),
      ],
      220,
    );
    expect(plan.iconOnlyIds).toContain("theme");
    expect(plan.iconOnlyIds).not.toContain("add");
  });

  it("refuses to commit a plan while every measured command is still 0px", () => {
    expect(shouldCommitWorkbarPlan([{ full: 0 }, { full: 0 }])).toBe(false);
    expect(shouldCommitWorkbarPlan([{ full: 0 }, { full: 72 }])).toBe(true);
  });

  it("treats identical overflow id lists as the same plan", () => {
    expect(sameIdList(["notes"], ["notes"])).toBe(true);
    expect(sameIdList(["notes"], ["export"])).toBe(false);
  });

  it("refuses to replace a plan that is bouncing back to the previous one", () => {
    expect(shouldReplaceWorkbarPlan("b", "a", null)).toBe(true);
    expect(shouldReplaceWorkbarPlan("a", "a", null)).toBe(false);
    expect(shouldReplaceWorkbarPlan("a", "b", "a")).toBe(false);
  });

  it("ignores a ResizeObserver tick that did not change host width", () => {
    expect(shouldIgnoreWorkbarHostResize(null, 720)).toBe(false);
    expect(shouldIgnoreWorkbarHostResize(720, 720)).toBe(true);
    expect(shouldIgnoreWorkbarHostResize(720, 640)).toBe(false);
  });

  it("warns once per overflowing tab instead of on every render", () => {
    const key = `presentation:Shape:${Math.random()}`;
    expect(shouldWarnEssentialOverBudget(key, 20.6, 11)).toBe(true);
    expect(shouldWarnEssentialOverBudget(key, 20.6, 11)).toBe(false);
    expect(shouldWarnEssentialOverBudget(key, 8, 11)).toBe(false);
  });

  it("does not wipe oscillation guards when only disabled flags change", () => {
    const source = readFileSync(
      "src/features/spectra/components/artifact-workbar.tsx",
      "utf8",
    );
    expect(source).toContain("overflowCommandIdsRef");
    expect(source).toContain(
      "if (overflowCommandIdsRef.current !== overflowCommandIds)",
    );
    expect(source).toContain("shouldIgnoreWorkbarHostResize");
    expect(source).toContain("overflowHostWidthRef");
    expect(source).toContain("fromResize");
  });
});
