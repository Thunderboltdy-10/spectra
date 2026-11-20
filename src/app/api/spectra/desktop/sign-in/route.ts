import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { hasClerkServerConfig } from "@/lib/clerk-config";
import { withRouteErrorHandling } from "@/lib/route-handler";

/** Long enough to reach the app's window, short enough to be useless after. */
const TICKET_SECONDS = 120;

/*
 * A one-time sign-in ticket for Spectra for desktop, for the person signed in
 * on this browser. Only this site's own page may ask (its Origin is checked),
 * and the page seals the ticket before it goes anywhere else.
 */
export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    if (!hasClerkServerConfig()) {
      return NextResponse.json({ error: "Sign-in is not set up on this Spectra." }, { status: 503 });
    }
    if (request.headers.get("origin") !== request.nextUrl.origin) {
      return NextResponse.json({ error: "Not for this page." }, { status: 403 });
    }
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Sign in to Spectra in this browser first." }, { status: 401 });
    }
    const client = await clerkClient();
    const token = await client.signInTokens.createSignInToken({ userId, expiresInSeconds: TICKET_SECONDS });
    return NextResponse.json({ ticket: token.token }, { headers: { "cache-control": "no-store" } });
  });
}
