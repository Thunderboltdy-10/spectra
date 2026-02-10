import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;

    const result = (await convexQuery("resources:getResourceDownloadUrl", {
      actorClerkId: actor.clerkId,
      resourceId: id,
    })) as { url: string };

    return NextResponse.redirect(result.url);
  });
}
