import { describe, expect, it } from "vitest";
import { nativeRoomBaselineExpected } from "../collaboration/native-bootstrap";

describe("native collaboration bootstrap order", () => {
  it.each([
    "closed",
    "connecting",
    "permission_lost",
    "synchronizing",
    "reconnecting",
    "unsynchronized",
  ])("does not expect a native baseline while transport is %s", (state) => {
    expect(nativeRoomBaselineExpected(state)).toBe(false);
  });

  it("expects the room-authored baseline once synchronization completes", () => {
    expect(nativeRoomBaselineExpected("synchronized")).toBe(true);
  });
});
