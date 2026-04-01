import { describe, expect, it } from "vitest";
import { resolveWorkstreamTransfer } from "../workstream-assignment";

describe("resolveWorkstreamTransfer", () => {
  it("does not move counts when the request did not include workstreamId", () => {
    expect(
      resolveWorkstreamTransfer({
        currentWorkstreamId: "ws_1",
        requestedWorkstreamId: undefined,
        requestIncludesWorkstreamId: false,
        isActive: true,
      }),
    ).toBeNull();
  });

  it("returns a transfer when a workstream is explicitly cleared", () => {
    expect(
      resolveWorkstreamTransfer({
        currentWorkstreamId: "ws_1",
        requestedWorkstreamId: null,
        requestIncludesWorkstreamId: true,
        isActive: true,
      }),
    ).toEqual({
      from: "ws_1",
      to: undefined,
    });
  });

  it("returns a transfer when the workstream actually changes", () => {
    expect(
      resolveWorkstreamTransfer({
        currentWorkstreamId: "ws_1",
        requestedWorkstreamId: "ws_2",
        requestIncludesWorkstreamId: true,
        isActive: true,
      }),
    ).toEqual({
      from: "ws_1",
      to: "ws_2",
    });
  });
});
