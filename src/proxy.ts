import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/join(.*)",
  "/api/invitations/(.*)",
]);

const isSuperAdminRoute = createRouteMatcher(["/super-admin(.*)"]);

const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS ?? "pablo.martinez.dovale@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

const hasClerkConfig = Boolean(
  process.env.CLERK_SECRET_KEY && (process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
);

const INVITATION_TOKEN_COOKIE = "ai-school-invitation-token";
const INVITATION_TOKEN_MAX_AGE = 60 * 60 * 24;

function extractEmailFromClaims(sessionClaims: unknown): string | undefined {
  if (!sessionClaims || typeof sessionClaims !== "object") return undefined;
  const claims = sessionClaims as Record<string, unknown>;
  return claims.email as string | undefined;
}

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

  const { userId, sessionClaims } = await auth();
  
  if (!userId) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", req.url);
    return NextResponse.redirect(signInUrl);
  }

  const email = extractEmailFromClaims(sessionClaims)?.toLowerCase();

  if (isSuperAdminRoute(req)) {
    if (!email || !SUPER_ADMIN_EMAILS.has(email)) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  const cookieToken = req.cookies.get(INVITATION_TOKEN_COOKIE)?.value;
  if (cookieToken && !url.pathname.startsWith("/join")) {
    const response = NextResponse.redirect(new URL(`/join?token=${cookieToken}`, req.url));
    response.cookies.delete(INVITATION_TOKEN_COOKIE);
    return response;
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
