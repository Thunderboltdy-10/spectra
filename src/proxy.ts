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

// Membership changes must be visible on the very next navigation. Caching this
// state caused approved users to bounce back to request-access until a cookie expired.
const ACCESS_STATE_CACHE_TTL_MS = 0;
const ACCESS_STATE_COOKIE = "ai-school-access-state";
const ACCESS_STATE_AT_COOKIE = "ai-school-access-state-at";

function persistAccessState(response: NextResponse, status: NonNullable<AccessStatePayload["status"]>) {
  response.cookies.set(ACCESS_STATE_COOKIE, status, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: Math.floor(ACCESS_STATE_CACHE_TTL_MS / 1000),
    path: "/",
  });
  response.cookies.set(ACCESS_STATE_AT_COOKIE, String(Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: Math.floor(ACCESS_STATE_CACHE_TTL_MS / 1000),
    path: "/",
  });
}

function clearAccessState(response: NextResponse) {
  response.cookies.delete(ACCESS_STATE_COOKIE);
  response.cookies.delete(ACCESS_STATE_AT_COOKIE);
}

async function fetchAccessState(req: NextRequest): Promise<{
  status: number;
  payload: AccessStatePayload | null;
} | null> {
  const cachedStatus = req.cookies.get(ACCESS_STATE_COOKIE)?.value;
  const cachedAtRaw = req.cookies.get(ACCESS_STATE_AT_COOKIE)?.value;
  const cachedAt = cachedAtRaw ? Number(cachedAtRaw) : Number.NaN;
  if (
    cachedStatus &&
    ["ok", "no_access", "org_inactive", "signed_out"].includes(cachedStatus) &&
    Number.isFinite(cachedAt) &&
    Date.now() - cachedAt < ACCESS_STATE_CACHE_TTL_MS
  ) {
    return {
      status: cachedStatus === "signed_out" ? 401 : 200,
      payload: { status: cachedStatus as AccessStatePayload["status"], expected: true },
    };
  }

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

const ACCESS_STATE_PATH_PREFIX = "/api/auth/access-state";

const authMiddleware = clerkMiddleware(async (auth, req) => {
  const url = new URL(req.url);
  const invitationToken = url.pathname.startsWith("/join")
    ? (url.searchParams.get("token") ?? url.searchParams.get("invitation"))
    : null;
  const isApiRoute = url.pathname.startsWith("/api/") || url.pathname.startsWith("/trpc");

  // Skip access-state check for the access-state route itself to prevent
  // recursive middleware invocations (fetchAccessState fetches this route,
  // which would re-enter the middleware and call fetchAccessState again).
  if (url.pathname.startsWith(ACCESS_STATE_PATH_PREFIX)) {
    return NextResponse.next();
  }

  const { userId } = await auth();

  // 1. Persist an invite token, but always keep /join stable. The page owns the
  // explicit sign-in, switch-account, and accept actions.
  if (invitationToken) {
    const response = NextResponse.next();

    clearAccessState(response);
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
    const shouldRedirectToApp = isLandingPageRoute(req) || isAuthRoute(req) || url.pathname.startsWith("/no-access");
    if (shouldRedirectToApp) {
      const response = NextResponse.redirect(new URL("/chat", req.url));
      response.cookies.delete(INVITATION_TOKEN_COOKIE);
      response.cookies.delete(INVITATION_HANDOFF_COOKIE);
      persistAccessState(response, "ok");
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
    persistAccessState(response, "org_inactive");
    return response;
  }

  if (access?.payload?.status === "no_access") {
    const destination = new URL("/request-access", req.url);
    destination.searchParams.set("return_url", `${url.pathname}${url.search}`);
    const response = NextResponse.redirect(destination);
    persistAccessState(response, "no_access");
    return response;
  }

  const response = NextResponse.next();
  if (userId && access?.payload?.status) {
    persistAccessState(response, access.payload.status);
  } else if (!userId) {
    clearAccessState(response);
  }
  return response;
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
