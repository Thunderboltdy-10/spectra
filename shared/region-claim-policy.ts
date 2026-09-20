export type RegionClaimAcquireStatus = "active" | "queued" | "paused";

/** Large atomic edits claim the existing whole-artifact domain, never a truncated
 * set of cells or thousands of sequential leases that expire during acquisition. */
export function boundedRegionClaims(regions: Array<{ regionId: string; overlapDomains: string[] }>) {
  return regions.length <= 128 ? regions : [{ regionId: "artifact:structure", overlapDomains: ["artifact:structure"] }];
}

/**
 * Only an active lease may mutate. A queued lease waits in place.
 * Paused is an honest refuse — never treat it as acquired.
 */
export function claimAcquireAction(
  status: RegionClaimAcquireStatus | string,
): "apply" | "wait" | "refuse" {
  if (status === "active") return "apply";
  if (status === "queued") return "wait";
  return "refuse";
}
