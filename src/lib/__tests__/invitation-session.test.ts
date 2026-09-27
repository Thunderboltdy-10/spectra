import { describe, expect, it } from "vitest";
import {
  JOIN_TOKEN_COOKIE,
  authHrefForRedirect,
  clearJoinTokenCookie,
  invitationFailureText,
  invitationPreviewCanRetry,
  joinHrefForToken,
  joinTokenFromSearch,
  persistJoinTokenCookie,
  readJoinTokenCookie,
  resolveJoinToken,
} from "../invitation-session";

describe("invitation cookie recovery", () => {
  it("keeps the join token across a dropped query string", () => {
    const store = { cookie: "" };
    persistJoinTokenCookie("invite-token", store);
    expect(store.cookie).toContain(`${JOIN_TOKEN_COOKIE}=invite-token`);
    expect(readJoinTokenCookie(store.cookie)).toBe("invite-token");
    expect(resolveJoinToken("", store.cookie)).toBe("invite-token");
    expect(joinHrefForToken("invite-token")).toBe("/join?token=invite-token");
  });

  it("prefers the URL token and can forget a spent cookie", () => {
    const store = { cookie: "" };
    persistJoinTokenCookie("stale", store);
    expect(joinTokenFromSearch("?token=fresh")).toBe("fresh");
    expect(resolveJoinToken("?token=fresh", store.cookie)).toBe("fresh");
    clearJoinTokenCookie(store);
    expect(readJoinTokenCookie(store.cookie)).toBe("");
  });

  it("keeps the invitation redirect when switching sign-in and sign-up", () => {
    const redirect = "/join?token=invite-token";
    expect(authHrefForRedirect("/sign-in", redirect)).toBe(
      "/sign-in?redirect_url=%2Fjoin%3Ftoken%3Dinvite-token",
    );
    expect(authHrefForRedirect("/sign-up", redirect)).toBe(
      "/sign-up?redirect_url=%2Fjoin%3Ftoken%3Dinvite-token",
    );
    expect(authHrefForRedirect("/sign-in")).toBe("/sign-in");
  });

  it("only offers preview retry for transient failures", () => {
    expect(invitationPreviewCanRetry("INTEGRATION_UNAVAILABLE: Try again.")).toBe(true);
    expect(invitationPreviewCanRetry("INTEGRATION_UNAVAILABLE: Try again.", 2)).toBe(false);
    expect(invitationPreviewCanRetry("INVITATION_EXPIRED: This invitation has expired.")).toBe(false);
    expect(invitationPreviewCanRetry("INVITATION_INVALID: This invitation is unavailable.")).toBe(false);
    // Signing in with another account, not retrying, resolves these.
    expect(invitationPreviewCanRetry("INVITATION_EMAIL_MISMATCH: Sign in with the invited verified email.")).toBe(false);
    expect(invitationPreviewCanRetry("MEMBERSHIP_SINGLE_SCHOOL: Leave your current school first.")).toBe(false);
  });

  it("rejoins the route's machine code with its sentence for branching", () => {
    const error = Object.assign(new Error("This invitation has expired."), { code: "INVITATION_EXPIRED" });
    expect(invitationFailureText(error)).toBe("INVITATION_EXPIRED: This invitation has expired.");
    expect(invitationFailureText(new Error("Offline."))).toBe("Offline.");
    expect(invitationFailureText("nope")).toBe("");
  });
});
