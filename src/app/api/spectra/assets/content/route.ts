import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { resolveArtifactAssetBytes } from "@/features/spectra/lenses/asset-resolver-server";
import type { Id } from "../../../../../../convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const assetId = request.nextUrl.searchParams.get("assetId")?.trim();
    if (!assetId) throw new Error("ASSET_ID_REQUIRED");

    // Resolve through the same authenticated, digest-checked path used by
    // native Office writers. This route is for the editor preview only; the
    // returned bytes are never persisted as a package URL.
    const resolved = await resolveArtifactAssetBytes(assetId as Id<"artifactAssets">);
    return new NextResponse(Buffer.from(resolved.bytes), {
      headers: {
        "Content-Type": resolved.mediaType,
        "Content-Disposition": `inline; filename="${resolved.name.replace(/["\\\r\n]/gu, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Spectra-Asset-Id": assetId,
      },
    });
  }, request);
}
