export type RegionClaimAcquireStatus = "active" | "queued" | "paused";

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
