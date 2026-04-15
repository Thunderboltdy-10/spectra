import { NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const { userId } = await auth();
    if (!userId) {
      throw new Error("AUTH_NOT_SIGNED_IN: Sign in to accept this invitation.");
    }

    const profile = await currentUser();
    const emails = (profile?.emailAddresses ?? [])
      .map((entry) => entry.emailAddress?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));
    const primaryEmail = emails[0];
    const name = profile?.fullName ?? profile?.firstName ?? "Student";
    if (!primaryEmail || emails.length === 0) {
      throw new Error("AUTH_PROFILE_UNAVAILABLE: Signed-in Clerk user profile could not be loaded. Retry sign-in.");
    }

    const body = (await request.json().catch(() => null)) as { token?: string } | null;
    const token = body?.token?.trim();

    if (!token) {
      return badRequest("Token is required");
    }

    const invitation = await convexQuery<{ token: string }, {
      _id: string;
      status: string;
      email: string;
      role: string;
      orgId: string;
      expiresAt: number;
      orgName?: string;
    } | null>("schoolAdmin:getInvitationByToken", { token });

    if (!invitation) {
      return badRequest("Invitation not found", 404);
    }

    if (invitation.status === "expired" || Date.now() > invitation.expiresAt) {
      return badRequest("This invitation has expired", 410);
    }

    if (invitation.status === "accepted") {
      return ok({ alreadyAccepted: true, orgName: invitation.orgName });
    }

    const normalizedInvitationEmail = invitation.email.toLowerCase();
    const matchingEmail = emails.find((value) => value === normalizedInvitationEmail);
    if (!matchingEmail) {
      return badRequest("This invitation was sent to a different email address", 403);
    }

    await convexMutation("users:acceptInvitationByToken", {
      clerkId: userId,
      email: matchingEmail,
      name,
      token,
    });

    const cookieStore = await cookies();
    cookieStore.delete("ai-school-invitation-token");

    return ok({
      success: true,
      orgName: invitation.orgName,
      role: invitation.role,
      email: matchingEmail,
    });
  });
}
