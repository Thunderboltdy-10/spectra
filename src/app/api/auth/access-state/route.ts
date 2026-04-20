import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from "@clerk/nextjs/server";
import { requireActor } from '@/lib/auth-server';
import { clearInvitationTracking, getInvitationCookies } from '@/lib/invitation-flow';

export async function GET(request: NextRequest) {
  const includeIdentity = new URL(request.url).searchParams.get("includeIdentity") === "1";
  const includeInvitation = new URL(request.url).searchParams.get("includeInvitation") === "1";
  if (includeIdentity) {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ status: 'signed_out' as const }, { status: 401 });
    }

    const profile = await currentUser().catch(() => null);
    const identityEmails = (profile?.emailAddresses ?? [])
      .map((entry) => entry.emailAddress?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));

    const cookieState = includeInvitation ? await getInvitationCookies() : null;
    return NextResponse.json({
      status: 'ok' as const,
      email: identityEmails[0] ?? null,
      emails: identityEmails,
      userId,
      invitationTokenPresent: includeInvitation ? Boolean(cookieState?.token || cookieState?.handoffToken) : undefined,
    }, { status: 200 });
  }

  try {
    const actor = await requireActor();

    // Clear any stale invitation cookie now that access is confirmed. This
    // makes every successful access check self-heal users who still have a
    // cookie from a prior failed or already-redeemed invitation.
    const response = NextResponse.json({
      status: 'ok' as const,
      email: actor.email,
      emails: [actor.email],
      userId: actor.clerkId,
      expected: true,
    }, { status: 200 });
    await clearInvitationTracking();
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('AUTH_NO_ACCESS')) {
      return NextResponse.json({ status: 'no_access' as const, expected: true }, { status: 200 });
    }
    if (message.startsWith('AUTH_ORG_INACTIVE')) {
      return NextResponse.json({ status: 'org_inactive' as const, expected: true }, { status: 200 });
    }
    if (message.startsWith('AUTH_NOT_SIGNED_IN')) {
      return NextResponse.json({ status: 'signed_out' as const, expected: true }, { status: 401 });
    }
    throw error;
  }
}
