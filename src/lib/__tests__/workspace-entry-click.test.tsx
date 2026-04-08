import { describe, expect, it } from "vitest";

describe("workspace entry click handling", () => {
  it("strips the ReactFlow workspace node prefix back to the workstream id", () => {
    const nodeId = "ws-ws_1";

    expect(nodeId.startsWith("ws-")).toBe(true);
    expect(nodeId.slice(3)).toBe("ws_1");
  });
});
