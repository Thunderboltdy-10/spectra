import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { hasClerkServerConfig } from "@/lib/clerk-config";

const isPublicRoute = createRouteMatcher([
  "/",
  "/landing(.*)",
  "/legal(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/contact(.*)",
  "/api/webhooks(.*)",
]);

const authMiddleware = clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return NextResponse.next();
  const { userId } = await auth();
  if (userId) return NextResponse.next();
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: { code: "AUTH_NOT_SIGNED_IN", message: "Sign in to continue.", status: 401 } },
      { status: 401 },
    );
  }
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("redirect_url", `${url.pathname}${url.search}`);
  return NextResponse.redirect(signIn);
});

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!hasClerkServerConfig()) return NextResponse.next();
  return authMiddleware(request, event);
}

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
