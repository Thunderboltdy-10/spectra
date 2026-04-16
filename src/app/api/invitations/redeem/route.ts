import { NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { clearInvitationTracking, getInvitationCookies, persistInvitationHandoff } from "@/lib/invitation-flow";
import { withRouteErrorHandling } from "@/lib/route-handler";

// Escape hatch for the client. The invitation cookie is httpOnly so pages
// can't delete it on their own. This endpoint is called from the /join page
// when the user hits a terminal state (expired, wrong email, already-used)
// so they can navigate away without the middleware snapping them back.
export async function DELETE() {
  return withRouteErrorHandling(async () => {
    await clearInvitationTracking();
    return ok({ cleared: true });
  });
}

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
    const cookieState = await getInvitationCookies();
    const token = body?.token?.trim() ?? cookieState.handoffToken ?? cookieState.token;

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
      await clearInvitationTracking();
      return badRequest("Invitation not found", 404);
    }

    if (invitation.status === "expired" || Date.now() > invitation.expiresAt) {
      await clearInvitationTracking();
      return badRequest("This invitation has expired", 410);
    }

    if (invitation.status === "accepted") {
      const normalizedInvitationEmail = invitation.email.toLowerCase();
      const matchingEmail = emails.find((value) => value === normalizedInvitationEmail);
      if (matchingEmail) {
        await clearInvitationTracking();
        return ok({ alreadyAccepted: true, sameUser: true, orgName: invitation.orgName });
      }
      await persistInvitationHandoff(token);
      return ok({ alreadyAccepted: true, sameUser: false, orgName: invitation.orgName });
    }

    const normalizedInvitationEmail = invitation.email.toLowerCase();
    const matchingEmail = emails.find((value) => value === normalizedInvitationEmail);
    if (!matchingEmail) {
      await persistInvitationHandoff(token);
      return badRequest("This invitation was sent to a different email address", 403);
    }

    await convexMutation("users:acceptInvitationByToken", {
      clerkId: userId,
      email: matchingEmail,
      name,
      token,
    });

    await clearInvitationTracking();

    return ok({
      success: true,
      orgName: invitation.orgName,
      role: invitation.role,
      email: matchingEmail,
    });
  });
}
