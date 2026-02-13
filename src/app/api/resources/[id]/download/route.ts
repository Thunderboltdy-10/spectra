import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;

    const result = (await convexQuery("resources:getResourceDownloadUrl", {
      actorClerkId: actor.clerkId,
      resourceId: id,
    })) as { url: string; filename?: string };

    const upstream = await fetch(result.url);
    if (!upstream.ok) {
      return NextResponse.redirect(result.url);
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const body = await upstream.arrayBuffer();
    const filename = (result.filename ?? "resource").replace(/["\r\n]/g, "").trim() || "resource";

    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
