import { describe, expect, it } from "vitest";
import { claimAcquireAction } from "../../../../shared/region-claim-policy";

describe("claimAcquireAction", () => {
  it("applies only an active lease", () => {
    expect(claimAcquireAction("active")).toBe("apply");
  });

  it("waits on a queued lease instead of cancelling it", () => {
    expect(claimAcquireAction("queued")).toBe("wait");
  });

  it("refuses a paused lease instead of treating it as acquired", () => {
    expect(claimAcquireAction("paused")).toBe("refuse");
  });

  it("refuses unknown statuses", () => {
    expect(claimAcquireAction("released")).toBe("refuse");
  });
});
