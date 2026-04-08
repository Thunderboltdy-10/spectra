import { describe, expect, it } from "vitest";
import { DEFAULT_UTILITY_ZONES } from "@/lib/workspace/contracts";

describe("workspace utility contracts", () => {
  it("places the focus timer in the bottom-right zone", () => {
    expect(DEFAULT_UTILITY_ZONES.focus_timer).toBe("bottom-right");
  });
});
