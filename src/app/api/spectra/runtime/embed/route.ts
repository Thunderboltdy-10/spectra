import { NextRequest, NextResponse } from "next/server";
import {
  MAX_EMBED_RUNTIME_BYTES,
  readBoundedRuntimeResponse,
  verifyEmbeddedRuntimeBytes,
} from "@/features/spectra/code/embed-runtime-integrity";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RuntimeBuildAccess = {
  storageUrl: string;
  payloadHash: string;
  payloadBytes: number;
};

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const embedId = request.nextUrl.searchParams.get("embedId")?.trim();
    if (!embedId) throw new Error("RUNTIME_EMBED_ID_REQUIRED");
    const access = await convexQuery<{ embedId: string }, RuntimeBuildAccess>(
      "artifactEmbeds:runtimeBuildAccess",
      { embedId },
    );
    if (access.payloadBytes > MAX_EMBED_RUNTIME_BYTES)
      throw new Error(
        "RUNTIME_BUILD_LIMIT: The published build exceeds its safety budget.",
      );
    const response = await fetch(access.storageUrl, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok)
      throw new Error(
        "RUNTIME_BUILD_UNAVAILABLE: The published build is unavailable.",
      );
    const declaredBytes = Number(response.headers.get("content-length") ?? 0);
    if (declaredBytes > MAX_EMBED_RUNTIME_BYTES)
      throw new Error(
        "RUNTIME_BUILD_LIMIT: The published build exceeds its safety budget.",
      );
    const bytes = await readBoundedRuntimeResponse(response);
    verifyEmbeddedRuntimeBytes(bytes, access);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }, request);
}
