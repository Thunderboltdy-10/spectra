import "server-only";
import { createHash } from "node:crypto";
import { convexPublicQuery } from "@/lib/convex-server";

export type InvitationLanding = {
  token: string;
  schoolName: string;
  role: "student" | "teacher" | "school_admin";
  email: string;
};

export function invitationRoleLabel(role: InvitationLanding["role"]) {
  if (role === "school_admin") return "school administrator";
  if (role === "teacher") return "teacher";
  return "student";
}

/** The token in a `/join?token=…` redirect, if that is where auth returns to. */
export function joinTokenFromRedirect(redirectUrl?: string) {
  if (!redirectUrl?.startsWith("/join")) return "";
  return new URL(redirectUrl, "http://spectra.local").searchParams.get("token")?.trim() ?? "";
}

/** What an invitation link names, read before anyone has signed in. */
export async function invitationLanding(token: string): Promise<InvitationLanding | null> {
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("base64url");
  const found = await convexPublicQuery<
    { tokenHash: string },
    Omit<InvitationLanding, "token"> | null
  >("memberships:invitationLanding", { tokenHash }).catch(() => null);
  return found ? { token, ...found } : null;
}
