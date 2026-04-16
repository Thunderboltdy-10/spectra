import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { hasClerkServerConfig } from "@/lib/clerk-config";
import { INVITATION_HANDOFF_COOKIE, INVITATION_TOKEN_COOKIE, INVITATION_TOKEN_MAX_AGE } from "@/lib/invitation-flow";
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

// Routes the user must always be able to reach even when an invitation cookie
// is set. Without this, a signed-in user whose cookie points at an invitation
// they can no longer redeem (already accepted, wrong email, etc.) has no way
// to reach sign-in to switch accounts — they get looped back to /join.
const SAFE_EXIT_PREFIXES = [
  "/join",
  "/sign-in",
  "/sign-up",
  "/sign-out",
  "/no-access",
];

function isSafeExitPath(pathname: string) {
  return SAFE_EXIT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

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

  // Persist ?token=... into a cookie so that the post-signup flow (where the
  // token is no longer in the URL) can still redeem it server-side.
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

  const { userId } = await auth();

  // If the user is signed in and carrying an invitation cookie, only use it to
  // shepherd them to /join when they genuinely lack access. Once access is
  // confirmed (or the workspace is inactive), the cookie has served its purpose
  // and is deleted so the user isn't trapped.
  let cachedAccess: Awaited<ReturnType<typeof fetchAccessState>> = null;
  if (userId && cookieToken && !isApiRoute) {
    cachedAccess = await fetchAccessState(req);
    if (cachedAccess) {
      if (cachedAccess.status === 200) {
        // User has access; invitation cookie is moot. Clear it and continue.
        const response = NextResponse.next();
        response.cookies.delete(INVITATION_TOKEN_COOKIE);
        response.cookies.delete(INVITATION_HANDOFF_COOKIE);
        return response;
      }
      if (cachedAccess.status === 403 && cachedAccess.payload?.status === "org_inactive") {
        const destination = new URL("/no-access", req.url);
        destination.searchParams.set("reason", "inactive");
        const response = NextResponse.redirect(destination);
        response.cookies.delete(INVITATION_TOKEN_COOKIE);
        response.cookies.delete(INVITATION_HANDOFF_COOKIE);
        return response;
      }
      if (cachedAccess.status === 403 && !isSafeExitPath(url.pathname)) {
        return NextResponse.redirect(new URL(`/join?token=${cookieToken}`, req.url));
      }
      // 401 signed_out / safe-exit path / unknown: fall through to normal routing.
    }
  }

  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

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

  const shouldCheckAccess =
    !isApiRoute
    && !url.pathname.startsWith("/no-access");

  if (shouldCheckAccess) {
    // Reuse the access-state we already fetched above when possible.
    const access = cachedAccess ?? (await fetchAccessState(req));
    if (access?.status === 403) {
      const destination = new URL("/no-access", req.url);
      if (access.payload?.status === "org_inactive") {
        destination.searchParams.set("reason", "inactive");
      }
      return NextResponse.redirect(destination);
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
