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


describe("AI×human gateway claim identity", () => {
  it("rejects a human append that tries to ride an AI claim", () => {
    expect(
      claimAuthorizesGatewayUpdate(
        { ...claim, actorKind: "ai" },
        { ...update, actorKind: "human" },
      ),
    ).toBe(false);
  });

  it("rejects an AI append that tries to ride a human claim", () => {
    expect(
      claimAuthorizesGatewayUpdate(
        { ...claim, actorKind: "human" },
        { ...update, actorKind: "ai" },
      ),
    ).toBe(false);
  });

  it("accepts a matching AI claim for the exact AI actor, client, and base", () => {
    expect(
      claimAuthorizesGatewayUpdate(
        { ...claim, actorKind: "ai" },
        { ...update, actorKind: "ai" },
      ),
    ).toBe(true);
  });

  it("rejects a different account even when actorKind matches", () => {
    expect(
      claimAuthorizesGatewayUpdate(
        { ...claim, actorKind: "ai", actorAccountId: "account-ai-owner" },
        { ...update, actorKind: "ai", actorAccountId: "account-other" },
      ),
    ).toBe(false);
  });
});
