import { describe, expect, it } from "vitest";
import {
  collaborationAccessRevoked,
  collaborationNeedsSignIn,
} from "../collaboration/auth-session";

describe("collaboration session doors", () => {
  it("opens sign-in only for session and token expiry copy", () => {
    expect(collaborationNeedsSignIn("Sign in to continue")).toBe(true);
    expect(collaborationNeedsSignIn("TOKEN_EXPIRED")).toBe(true);
    expect(collaborationNeedsSignIn("Permission denied")).toBe(false);
  });

  it("treats only explicit Spectra revoke codes as lost access", () => {
    expect(collaborationAccessRevoked("COLLABORATION_ACCESS_REVOKED")).toBe(
      true,
    );
    expect(collaborationAccessRevoked("Access was removed.")).toBe(true);
    expect(collaborationAccessRevoked("Access removed")).toBe(true);
    expect(collaborationAccessRevoked("Permission denied")).toBe(false);
    expect(collaborationAccessRevoked("COLLABORATION_GATEWAY_FORBIDDEN")).toBe(
      false,
    );
    expect(collaborationAccessRevoked("Access or permissions changed")).toBe(
      false,
    );
    expect(collaborationAccessRevoked("COLLABORATION_TOKEN_INVALID")).toBe(
      false,
    );
    expect(collaborationAccessRevoked("")).toBe(false);
  });
});
