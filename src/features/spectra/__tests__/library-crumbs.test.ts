import { describe, expect, it } from "vitest";
import { crumbSteps } from "../organization/library-crumbs";
import type { TreeNode } from "../organization/tree-client";

const node = (nodeId: string, name: string) => ({ nodeId, name }) as TreeNode;

describe("crumbSteps", () => {
  const floor = { nodeId: "w", label: "University" };

  it("runs from the workspace down to the open folder", () => {
    const steps = crumbSteps({ path: [node("w", "University"), node("a", "UK"), node("b", "Imperial")], floor, onLeaveFloor: () => {} });
    expect(steps.map((step) => step.label)).toEqual(["Library home", "University", "UK", "Imperial"]);
  });

  it("keeps a folder reached through a reference after the workspace", () => {
    const steps = crumbSteps({ path: [node("o", "Other"), node("uk", "UK")], floor, onLeaveFloor: () => {} });
    expect(steps.map((step) => [step.label, step.nodeId])).toEqual([["Library home", null], ["University", "w"], ["UK", "uk"]]);
  });

  it("shows just the workspace at its own top", () => {
    expect(crumbSteps({ path: [], floor }).map((step) => step.label)).toEqual(["University"]);
  });
});
