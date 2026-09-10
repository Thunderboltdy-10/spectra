import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { hasClerkServerConfig } from "@/lib/clerk-config";
import { convexPublicQuery, convexQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,80}$/;
const PUBLIC_ACCESS_STATES = new Set([
  "sign_in_required",
  "email_unverified",
  "domain_restricted",
]);

function isAccessDeniedProjection(
  value: unknown,
): value is {
  access: "sign_in_required" | "email_unverified" | "domain_restricted";
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const access = (value as { access?: unknown }).access;
  return typeof access === "string" && PUBLIC_ACCESS_STATES.has(access);
}

function isFunctionPathNotFound(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("FunctionPathNotFound") || message.includes("Could not find public function");
}

async function readProjection(tokenHash: string) {
  // A restricted link is authorized from the identity carried by the
  // authenticated Convex JWT. Never fall back to an anonymous query after a
  // signed-in request: doing so would hide an auth failure and weaken the
  // domain gate.
  const authState = hasClerkServerConfig() ? await auth() : null;
  const read = authState?.userId ? convexQuery : convexPublicQuery;
  try {
    return await read("authority:publicProjection", { tokenHash });
  } catch (error) {
    if (!isFunctionPathNotFound(error)) throw error;
    return read("authority.js:publicProjection", { tokenHash });
  }
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const body = await request.json().catch(() => null) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!TOKEN_PATTERN.test(token)) {
      return NextResponse.json({ error: "This public view is unavailable." }, { status: 404 });
    }
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const projection = await readProjection(tokenHash);
    if (!projection) {
      return NextResponse.json({ error: "This public view is unavailable or has expired." }, { status: 404 });
    }
    if (isAccessDeniedProjection(projection)) {
      if (projection.access === "sign_in_required") {
        return NextResponse.json(
          {
            code: "AUTH_REQUIRED",
            error: "Sign in with a verified school account to open this shared view.",
          },
          { status: 401 },
        );
      }
      if (projection.access === "email_unverified") {
        return NextResponse.json(
          {
            code: "AUTH_EMAIL_UNVERIFIED",
            error: "Verify your email address before opening this restricted shared view.",
          },
          { status: 403 },
        );
      }
      return NextResponse.json(
        {
          code: "PUBLIC_DOMAIN_RESTRICTED",
          error: "This shared view is limited to an eligible verified email domain.",
        },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { projection },
      { headers: { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive" } },
    );
  }, request);
}
