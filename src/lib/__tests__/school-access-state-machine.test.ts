import { describe, expect, it } from "vitest";
import { calculateCapacity } from "../../../convex/accessControl";
import { deriveInvitationAuthState, type InvitationSnapshot } from "@/lib/invitation-flow";

function invitation(overrides: Partial<InvitationSnapshot> = {}): InvitationSnapshot {
  return {
    token: "token_1",
    status: "pending",
    email: "student@example.com",
    role: "student",
    orgId: "org_1",
    orgName: "North School",
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe("school capacity reservations", () => {
  it("counts members and active invitation reservations against the same hard limit", () => {
    expect(calculateCapacity(3, 2, 1)).toEqual({
      maxMembers: 3,
      memberCount: 2,
      reservedInvitations: 1,
      used: 3,
      available: 0,
      full: true,
    });
  });

  it("releasing a reservation frees exactly one seat", () => {
    expect(calculateCapacity(3, 2, 0)).toMatchObject({ used: 2, available: 1, full: false });
  });

  it("acceptance swaps a reservation for a membership without changing seats used", () => {
    expect(calculateCapacity(4, 2, 1).used).toBe(calculateCapacity(4, 3, 0).used);
  });
});

describe("invitation page states", () => {
  it("keeps a signed-out invite stable and asks for authentication", () => {
    expect(deriveInvitationAuthState({ invitation: invitation(), userId: null, emails: [] }).state)
      .toBe("token_valid_signed_out");
  });

  it("distinguishes wrong identity from an existing membership in another school", () => {
    expect(deriveInvitationAuthState({ invitation: invitation(), userId: "clerk_1", emails: ["other@example.com"] }).state)
      .toBe("token_valid_signed_in_wrong_identity");
    expect(deriveInvitationAuthState({ invitation: invitation(), userId: "clerk_1", emails: ["student@example.com"], viewerOrgId: "org_2" }).state)
      .toBe("token_valid_signed_in_other_school");
  });

  it("renders revoked and capacity-blocked states without redirecting", () => {
    const revoked = deriveInvitationAuthState({ invitation: invitation({ status: "revoked" }), userId: "clerk_1", emails: ["student@example.com"] });
    const full = deriveInvitationAuthState({ invitation: invitation({ capacityFull: true }), userId: "clerk_1", emails: ["student@example.com"] });
    expect(revoked).toMatchObject({ state: "token_revoked", shouldAutoRedirectToAuth: false, canRedeemNow: false });
    expect(full).toMatchObject({ state: "token_over_capacity", shouldAutoRedirectToAuth: false, canRedeemNow: false });
  });

  it("keeps an accepted invitation in the used state after its original expiry time", () => {
    const used = deriveInvitationAuthState({
      invitation: invitation({ status: "accepted", expiresAt: Date.now() - 1 }),
      userId: "clerk_1",
      emails: ["student@example.com"],
    });
    expect(used.state).toBe("token_already_redeemed_same_user");
  });
});
