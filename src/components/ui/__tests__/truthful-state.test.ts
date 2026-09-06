import { describe, expect, it } from "vitest";
import { describeFailure } from "../truthful-state";

describe("describeFailure AUTH_* identity mapping", () => {
  const connectionFallback =
    "Check your connection, then try loading your workspace again.";

  it("maps AUTH_EMAIL_UNVERIFIED to verify-email copy, not connection", () => {
    const result = describeFailure(
      new Error(
        "AUTH_EMAIL_UNVERIFIED: Verify your school email before using Spectra.",
      ),
      { fallback: connectionFallback },
    );
    expect(result.message).toBe(
      "Verify your school email before using Spectra.",
    );
    expect(result.message).not.toMatch(/connection/i);
  });

  it("maps other AUTH_* codes away from connection fallbacks", () => {
    expect(
      describeFailure(new Error("AUTH_NOT_SIGNED_IN: Sign in to continue."), {
        fallback: connectionFallback,
      }).message,
    ).toBe("Sign in to continue.");
    expect(
      describeFailure(
        new Error(
          "AUTH_NO_SCHOOL: This account does not have an active school membership.",
        ),
        { fallback: connectionFallback },
      ).message,
    ).toMatch(/school membership/i);
    expect(
      describeFailure(new Error("AUTH_SECRET_MANAGE_REQUIRED: Operator only."), {
        fallback: connectionFallback,
      }).message,
    ).toBe("Check your account, then try again.");
  });

  it("keeps non-AUTH failures on the caller fallback", () => {
    expect(
      describeFailure(new Error("NETWORK_DOWN"), {
        fallback: connectionFallback,
      }).message,
    ).toBe(connectionFallback);
  });
});
