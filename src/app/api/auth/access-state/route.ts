import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from "@clerk/nextjs/server";
import { requireActor } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor();
    const includeIdentity = new URL(request.url).searchParams.get("includeIdentity") === "1";
    const profile = includeIdentity ? await currentUser().catch(() => null) : null;
    const identityEmails = includeIdentity
      ? (profile?.emailAddresses ?? [])
          .map((entry) => entry.emailAddress?.trim().toLowerCase())
          .filter((value): value is string => Boolean(value))
      : [];

    return NextResponse.json({
      status: 'ok' as const,
      ...(includeIdentity
        ? {
            email: identityEmails[0] ?? actor.email,
            emails: identityEmails.length > 0 ? identityEmails : [actor.email],
            userId: actor.clerkId,
          }
        : {}),
    }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('AUTH_NO_ACCESS')) {
      return NextResponse.json({ status: 'no_access' as const }, { status: 403 });
    }
    if (message.startsWith('AUTH_ORG_INACTIVE')) {
      return NextResponse.json({ status: 'org_inactive' as const }, { status: 403 });
    }
    if (message.startsWith('AUTH_NOT_SIGNED_IN')) {
      return NextResponse.json({ status: 'signed_out' as const }, { status: 401 });
    }
    throw error;
  }
}
