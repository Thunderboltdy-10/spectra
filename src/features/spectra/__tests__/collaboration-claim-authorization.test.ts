import { describe, expect, it } from "vitest";
import { claimAuthorizesGatewayUpdate } from "../../../../convex/collaborationClaimAuthorization";

const now = 20_000;
const update = {
  actorAccountId: "account-p",
  actorKind: "human" as const,
  clientId: "client-p",
  baseStateVectorHash: "base-vector-hash-1234",
  now,
};
const claim = {
  status: "released" as const,
  resolution: "apply" as const,
  releasedAt: now - 250,
  leaseExpiresAt: now + 10_000,
  actorAccountId: update.actorAccountId,
  actorKind: update.actorKind,
  clientId: update.clientId,
  baseStateVectorHash: update.baseStateVectorHash,
};

describe("gateway claim acknowledgement race", () => {
  it("accepts a recently applied claim for the exact actor, client, and base", () => {
    expect(claimAuthorizesGatewayUpdate(claim, update)).toBe(true);
  });

  it.each([
    [{ ...claim, resolution: "cancel" as const }],
    [{ ...claim, resolution: "expired" as const }],
    [{ ...claim, releasedAt: now - 5_001 }],
    [{ ...claim, leaseExpiresAt: now }],
    [{ ...claim, clientId: "client-c" }],
    [{ ...claim, baseStateVectorHash: "different-base-vector" }],
  ])("rejects a released claim that cannot acknowledge this update", (candidate) => {
    expect(claimAuthorizesGatewayUpdate(candidate, update)).toBe(false);
  });
});
