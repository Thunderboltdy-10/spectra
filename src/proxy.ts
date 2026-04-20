import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { hasClerkServerConfig } from "@/lib/clerk-config";
import { INVITATION_HANDOFF_COOKIE, INVITATION_TOKEN_COOKIE, INVITATION_TOKEN_MAX_AGE } from "@/lib/invitation-flow";
import { getAppUrl } from "@/lib/app-url";

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

const isAuthRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

const isLandingPageRoute = createRouteMatcher([
  "/",
  "/landing(.*)",
]);

type AccessStatePayload = {
  status?: "ok" | "no_access" | "org_inactive" | "signed_out";
  expected?: boolean;
};

async function fetchAccessState(req: NextRequest): Promise<{
  status: number;
  payload: AccessStatePayload | null;
} | null> {
  try {
    const response = await fetch(new URL("/api/auth/access-state", req.url), {
      method: "GET",
      headers: {
        cookie: req.headers.get("cookie") ?? "",
      },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as AccessStatePayload | null;
    return { status: response.status, payload };
  } catch {
    return null;
  }
}

const authMiddleware = clerkMiddleware(async (auth, req) => {
  const url = new URL(req.url);
  const invitationToken = url.searchParams.get("token") ?? url.searchParams.get("invitation");
  const cookieToken = req.cookies.get(INVITATION_TOKEN_COOKIE)?.value;
  const isApiRoute = url.pathname.startsWith("/api/") || url.pathname.startsWith("/trpc");

  const { userId } = await auth();

  // 1. Persist ?token=... into a cookie and shepherd to join/signup.
  if (invitationToken) {
    const appUrl = getAppUrl(req.url);
    const redirect = encodeURIComponent(`${appUrl}/join?token=${encodeURIComponent(invitationToken)}`);
    const destination = userId
      ? new URL(`/join?token=${invitationToken}`, req.url)
      : new URL(`/sign-up?redirect_url=${redirect}`, req.url);

    const response = (url.pathname.startsWith("/join") && !userId)
      ? NextResponse.next()
      : NextResponse.redirect(destination);

    response.cookies.set(INVITATION_TOKEN_COOKIE, invitationToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: INVITATION_TOKEN_MAX_AGE,
      path: "/",
    });
    return response;
  }

  // 2. Determine access state if signed in.
  let access: Awaited<ReturnType<typeof fetchAccessState>> = null;
  if (userId) {
    access = await fetchAccessState(req);
  }

  // 3. Seamlessly redirect authorized users from public/auth pages to the workspace.
  if (userId && access?.payload?.status === "ok") {
    const shouldRedirectToApp = isLandingPageRoute(req) || isAuthRoute(req) || url.pathname.startsWith("/join") || url.pathname.startsWith("/no-access") || url.pathname.startsWith("/request-access");
    if (shouldRedirectToApp) {
      const response = NextResponse.redirect(new URL("/chat", req.url));
      response.cookies.delete(INVITATION_TOKEN_COOKIE);
      response.cookies.delete(INVITATION_HANDOFF_COOKIE);
      return response;
    }
  }

  // 4. Allow public routes to proceed (including for signed-in users without access).
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  // 5. Handle unauthenticated access to protected routes.
  if (!userId) {
    if (isApiRoute) {
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

  // 6. Handle authenticated access to protected routes when access is not "ok".
  if (access?.payload?.status === "org_inactive") {
    const destination = new URL("/request-access", req.url);
    destination.searchParams.set("reason", "inactive");
    const response = NextResponse.redirect(destination);
    response.cookies.delete(INVITATION_TOKEN_COOKIE);
    response.cookies.delete(INVITATION_HANDOFF_COOKIE);
    return response;
  }

  if (access?.payload?.status === "no_access") {
    // If they have an invitation token, send them to /join to accept it.
    if (cookieToken) {
      return NextResponse.redirect(new URL(`/join?token=${cookieToken}`, req.url));
    }
    // Otherwise, send them to request access.
    return NextResponse.redirect(new URL("/request-access", req.url));
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
