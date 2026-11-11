import { describe, expect, it } from "vitest";
import { firstChangedRegion } from "./convex-backend";

describe("the region an edit changed (F5)", () => {
  it("is the first content region, never bookkeeping", () => {
    expect(firstChangedRegion(["metadata:title", "artifact:structure", "block:7", "block:9"])).toBe("block:7");
    expect(firstChangedRegion(["work:root", "metadata:title"])).toBeUndefined();
    expect(firstChangedRegion(undefined)).toBeUndefined();
    expect(firstChangedRegion([3, null, "card:2"])).toBe("card:2");
  });
});
