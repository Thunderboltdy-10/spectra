export const APPLIED_CLAIM_GATEWAY_GRACE_MS = 5_000;

type GatewayClaim = {
  status: "active" | "queued" | "paused" | "released" | "rejected";
  resolution?:
    | "apply"
    | "keep_current"
    | "merge"
    | "cancel"
    | "expired"
    | "permission_revoked"
    | "run_stopped";
  releasedAt?: number;
  leaseExpiresAt: number;
  actorAccountId: string;
  actorKind: "human" | "ai";
  clientId: string;
  baseStateVectorHash: string;
};

type GatewayUpdateIdentity = {
  actorAccountId: string;
  actorKind: "human" | "ai";
  clientId: string;
  baseStateVectorHash: string;
  now: number;
};

/**
 * A local Yjs transaction is synchronous, while its gateway append is not.
 * The browser releases a successfully applied claim as soon as the local
 * transaction returns, so the append may observe that claim just after it
 * changed from active to released. Only the exact actor/client/base update is
 * allowed through that narrow acknowledgement race.
 */
export function claimAuthorizesGatewayUpdate(
  claim: GatewayClaim,
  update: GatewayUpdateIdentity,
) {
  if (
    claim.actorAccountId !== update.actorAccountId ||
    claim.actorKind !== update.actorKind ||
    claim.clientId !== update.clientId ||
    claim.leaseExpiresAt <= update.now
  )
    return false;
  if (claim.status === "active") return true;
  return (
    claim.status === "released" &&
    claim.resolution === "apply" &&
    claim.baseStateVectorHash === update.baseStateVectorHash &&
    typeof claim.releasedAt === "number" &&
    update.now >= claim.releasedAt &&
    update.now - claim.releasedAt <= APPLIED_CLAIM_GATEWAY_GRACE_MS
  );
}
