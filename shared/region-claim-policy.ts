/** acquire returns only these; nothing writes the legacy "paused" status. */
export type RegionClaimAcquireStatus = "active" | "queued";

/** Large atomic edits claim the existing whole-artifact domain, never a truncated
 * set of cells or thousands of sequential leases that expire during acquisition. */
export function boundedRegionClaims(regions: Array<{ regionId: string; overlapDomains: string[] }>) {
  return regions.length <= 128 ? regions : [{ regionId: "artifact:structure", overlapDomains: ["artifact:structure"] }];
}

/**
 * Only an active lease may mutate. A queued lease waits in place. Any other
 * status (a released, rejected or legacy row) is never treated as acquired.
 */
export function claimAcquireAction(
  status: RegionClaimAcquireStatus | string,
): "apply" | "wait" | "refuse" {
  if (status === "active") return "apply";
  if (status === "queued") return "wait";
  return "refuse";
}
