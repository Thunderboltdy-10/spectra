/**
 * Collaboration session failures that must open a sign-in door, not keep
 * spinning as Saving or Reconnecting.
 */
export function collaborationNeedsSignIn(reason?: string) {
  const value = (reason ?? "").toLowerCase();
  if (!value) return false;
  return (
    /\bsign in\b/.test(value) ||
    value.includes("session expired") ||
    value.includes("token_expired") ||
    value.includes("token expired")
  );
}

/**
 * True only when the gateway or session endpoint proved this person no
 * longer has the room. Generic Hocuspocus "Permission denied", policy-bump
 * closes, and FORBIDDEN substrings during a gateway restart are reconnects.
 */
export function collaborationAccessRevoked(reason?: string) {
  const value = (reason ?? "").toUpperCase();
  if (!value) return false;
  if (value.includes("TOKEN_EXPIRED") || value.includes("SESSION_EXPIRED"))
    return false;
  if (value.includes("ACCESS OR PERMISSIONS CHANGED")) return false;
  return (
    value.includes("COLLABORATION_ACCESS_REVOKED") ||
    value.includes("ACCESS WAS REMOVED") ||
    value.includes("ACCESS REMOVED")
  );
}
