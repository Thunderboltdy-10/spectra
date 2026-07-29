import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { convexPublicQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,80}$/;

function isFunctionPathNotFound(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("FunctionPathNotFound") || message.includes("Could not find public function");
}

async function readProjection(tokenHash: string) {
  try {
    return await convexPublicQuery("authority:publicProjection", { tokenHash });
  } catch (error) {
    if (!isFunctionPathNotFound(error)) throw error;
    return convexPublicQuery("authority.js:publicProjection", { tokenHash });
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
    return NextResponse.json(
      { projection },
      { headers: { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive" } },
    );
  }, request);
}
