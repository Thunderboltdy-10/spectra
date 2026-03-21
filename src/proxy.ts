import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { hasClerkServerConfig } from "@/lib/clerk-config";
const isPublicRoute = createRouteMatcher([
  "/",
  "/landing(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/request-access(.*)",
  "/api/webhooks(.*)",
  "/join(.*)",
  "/no-access(.*)",
  "/api/join(.*)",
  "/api/request-access(.*)",
  "/api/contact(.*)",
  "/api/invitations/(.*)",
  "/api/auth/access-state(.*)",
]);

const INVITATION_TOKEN_COOKIE = "ai-school-invitation-token";
const INVITATION_TOKEN_MAX_AGE = 60 * 60 * 24;

const authMiddleware = clerkMiddleware(async (auth, req) => {
  const url = new URL(req.url);
  const invitationToken = url.searchParams.get("token") ?? url.searchParams.get("invitation");

  if (invitationToken) {
    const response = url.pathname.startsWith("/join")
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/sign-up", req.url));
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

  const shouldCheckAccess =
    !url.pathname.startsWith("/api/")
    && !url.pathname.startsWith("/trpc")
    && !url.pathname.startsWith("/no-access");

  if (shouldCheckAccess) {
    try {
      const accessResponse = await fetch(new URL("/api/auth/access-state", req.url), {
        method: "GET",
        headers: {
          cookie: req.headers.get("cookie") ?? "",
        },
        cache: "no-store",
      });
      if (accessResponse.status === 403) {
        const payload = (await accessResponse.json().catch(() => null)) as { status?: string } | null;
        const destination = new URL("/no-access", req.url);
        if (payload?.status === "org_inactive") {
          destination.searchParams.set("reason", "inactive");
        }
        return NextResponse.redirect(destination);
      }
    } catch {
      // Fail open in middleware; route handlers and page guards still enforce access.
    }
  }

  return NextResponse.next();
});

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!hasClerkServerConfig()) {
    return NextResponse.next();
  }
  return authMiddleware(request, event);
}

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
