import { describe, expect, it } from "vitest";
import {
  decideClose,
  persistableTitle,
  UNTITLED_WORK_TITLE,
} from "../components/artifact-persistence";

describe("artifact persistence (P1.I3)", () => {
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
