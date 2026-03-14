import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth-server';

export async function GET() {
  try {
    await requireActor();
    return NextResponse.json({ status: 'ok' as const }, { status: 200 });
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
