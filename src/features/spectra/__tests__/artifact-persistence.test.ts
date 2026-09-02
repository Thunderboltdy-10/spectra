import { describe, expect, it } from "vitest";
import {
  claimCloseAction,
  decideClose,
  persistableTitle,
  UNTITLED_WORK_TITLE,
} from "../components/artifact-persistence";

describe("artifact persistence (P1.I3)", () => {
  it("admits only one save-or-discard close action at a time", () => {
    const lock = { current: false };
    expect(claimCloseAction(lock)).toBe(true);
    expect(claimCloseAction(lock)).toBe(false);
    lock.current = false;
    expect(claimCloseAction(lock)).toBe(true);
  });
  it("persists a blank title as Untitled instead of trapping the save", () => {
    expect(persistableTitle("")).toBe(UNTITLED_WORK_TITLE);
    expect(persistableTitle("   ")).toBe(UNTITLED_WORK_TITLE);
    expect(persistableTitle("Essay")).toBe("Essay");
  });

  it("asks before closing dirty work and closes clean work", () => {
    expect(decideClose(true)).toBe("confirm");
    expect(decideClose(false)).toBe("close");
  });
});
