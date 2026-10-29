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
  // Invitation instructions must be readable before someone has an account.
  "/request-access",
  "/public(.*)",
  // Bridge installers download before anyone signs in on that computer.
  "/bridge/download(.*)",
  "/api/spectra/public(.*)",
  // The scheduled connector worker authenticates with a short-lived HMAC in
  // the route itself. Interactive actions still call requireActor(), so
  // exposing this endpoint to the proxy does not expose ManageBac data.
  "/api/spectra/managebac",
  // Durable AI jobs are claimed by a separate local/production worker. Its
  // internal_work action is HMAC-authenticated before the route asks for a
  // user session; every interactive action still requires requireActor().
  "/api/spectra/run",
  // The morning brief's scheduled call is HMAC-signed and acts as its owner;
  // Home's own call still needs the student's session in the route.
  "/api/spectra/brief",
  "/api/contact(.*)",
  "/api/health(.*)",
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
