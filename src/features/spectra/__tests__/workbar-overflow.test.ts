import { describe, expect, it } from "vitest";
import { planWorkbarOverflow } from "../components/workbar-overflow";

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

  it("sheds disabled commands before essentials", () => {
    const plan = planWorkbarOverflow(
      [
        item("bold", 72, { priority: "essential" }),
        item("italic", 72, { priority: "essential" }),
        item("unused", 90, { disabled: true, priority: "secondary" }),
        item("notes", 96, { priority: "advanced" }),
      ],
      180,
    );
    expect([...plan.iconOnlyIds, ...plan.overflowIds]).toContain("unused");
    expect(plan.visibleIds).toContain("bold");
    expect(plan.visibleIds).toContain("italic");
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
});
