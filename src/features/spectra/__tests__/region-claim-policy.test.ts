import { describe, expect, it } from "vitest";
import { boundedRegionClaims, claimAcquireAction } from "../../../../shared/region-claim-policy";
import { regionDomainsIntersect } from "../../../../convex/regionClaims";

describe("claimAcquireAction", () => {
  it("bounds a large atomic edit without leaving its tail unclaimed", () => {
    const regions = Array.from({ length: 200_000 }, (_, index) => ({ regionId: `cell:${index}`, overlapDomains: [`cell:${index}`] }));
    const claims = boundedRegionClaims(regions);
    expect(claims).toHaveLength(1);
    expect(regionDomainsIntersect(claims[0]!.overlapDomains, regions.at(-1)!.overlapDomains)).toBe(true);
    expect(boundedRegionClaims(regions.slice(0, 1))).toEqual(regions.slice(0, 1));
  });
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
