import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { convexQuery } from "@/lib/convex-server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/join(.*)",
  "/no-access(.*)",
  "/api/join(.*)",
  "/api/invitations/(.*)",
]);

const hasClerkConfig = Boolean(
  process.env.CLERK_SECRET_KEY && (process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
);

const INVITATION_TOKEN_COOKIE = "ai-school-invitation-token";
const INVITATION_TOKEN_MAX_AGE = 60 * 60 * 24;

const authMiddleware = clerkMiddleware(async (auth, req) => {
  const url = new URL(req.url);
  const invitationToken = url.searchParams.get("invitation");

  if (invitationToken) {
    const response = NextResponse.redirect(new URL("/sign-up", req.url));
    response.cookies.set(INVITATION_TOKEN_COOKIE, invitationToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: INVITATION_TOKEN_MAX_AGE,
      path: "/",
    });
    return response;
  }

  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  const { userId } = await auth();
  
  if (!userId) {
    if (req.nextUrl.pathname.startsWith("/api/") || req.nextUrl.pathname.startsWith("/trpc")) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "AUTH_NOT_SIGNED_IN",
            message: "You must sign in to access this API route.",
            status: 401,
          },
        },
        { status: 401 },
      );
    }
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", req.url);
    return NextResponse.redirect(signInUrl);
  }

  const cookieToken = req.cookies.get(INVITATION_TOKEN_COOKIE)?.value;
  if (cookieToken && !url.pathname.startsWith("/join")) {
    const response = NextResponse.redirect(new URL(`/join?token=${cookieToken}`, req.url));
    response.cookies.delete(INVITATION_TOKEN_COOKIE);
    return response;
  }

  const actor = await convexQuery("users:me", {
    clerkId: userId,
  }).catch(() => null as null | { _id: string });

  if (!actor) {
    if (req.nextUrl.pathname.startsWith("/api/") || req.nextUrl.pathname.startsWith("/trpc")) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "AUTH_NO_ACCESS",
            message: "Your account isn't linked to a school. Contact your school administrator.",
            status: 403,
          },
        },
        { status: 403 },
      );
    }

    return NextResponse.redirect(new URL("/no-access", req.url));
  }

  return NextResponse.next();
});

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!hasClerkConfig) {
    return NextResponse.next();
  }
  return authMiddleware(request, event);
}

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
