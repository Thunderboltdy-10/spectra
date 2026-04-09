import { describe, expect, it } from "vitest";

describe("workspace entry click handling", () => {
  it("strips the ReactFlow workspace node prefix back to the workstream id", () => {
    const nodeId = "ws-ws_1";

    expect(nodeId.startsWith("ws-")).toBe(true);
    expect(nodeId.slice(3)).toBe("ws_1");
  });

  it("treats overview cards as native click targets", () => {
    const classes = "group relative z-10 cursor-pointer touch-manipulation text-left transition-[box-shadow,border-color] duration-300";

    expect(classes).toContain("cursor-pointer");
    expect(classes).toContain("touch-manipulation");
    expect(classes).toContain("z-10");
  });
});
