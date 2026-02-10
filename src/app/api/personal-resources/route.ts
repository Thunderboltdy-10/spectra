import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const resources = await convexQuery("resources:listPersonalResources", {
      actorClerkId: actor.clerkId,
    });
    return ok({ resources });
  });
}

export async function DELETE(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const resourceId = request.nextUrl.searchParams.get("resourceId");
    if (!resourceId) {
      return badRequest("resourceId required");
    }

    await convexMutation("resources:deleteResource", {
      actorClerkId: actor.clerkId,
      resourceId,
    });

    return ok({ ok: true });
  });
}
