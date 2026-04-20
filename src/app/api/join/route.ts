import { NextRequest } from "next/server";
import { convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import {
  deriveInvitationAuthState,
  getInvitationCookies,
  normalizeInvitation,
  persistInvitationHandoff,
} from "@/lib/invitation-flow";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { auth, currentUser } from "@clerk/nextjs/server";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const { token: cookieToken, handoffToken } = await getInvitationCookies();
    const token = searchParams.get("token") ?? cookieToken ?? handoffToken;

    const { userId } = await auth();
    const profile = userId ? await currentUser().catch(() => null) : null;
    const emails = (profile?.emailAddresses ?? [])
      .map((entry) => entry.emailAddress?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));

    if (!token) {
      return ok(deriveInvitationAuthState({
        invitation: null,
        userId,
        emails,
        handoffToken,
        tokenProvided: false,
      }));
    }

    const invitation = await convexQuery<{ token: string }, {
      status: string;
      email: string;
      role: string;
      orgId: string;
      expiresAt: number;
      orgName?: string;
      orgWelcomeMessage?: string;
      orgLogoUrl?: string;
    } | null>("schoolAdmin:getInvitationByToken", { token });

    if (!invitation) {
      return ok(deriveInvitationAuthState({
        invitation: null,
        userId,
        emails,
        handoffToken,
        tokenProvided: true,
      }));
    }

    const normalizedInvitation = normalizeInvitation(invitation, token);
    await persistInvitationHandoff(token);

    return ok(deriveInvitationAuthState({
      invitation: normalizedInvitation,
      userId,
      emails,
      handoffToken,
      tokenProvided: true,
    }));
  });
}
