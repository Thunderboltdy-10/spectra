import { requireActor } from "@/lib/auth-server";
import { convexAction } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: Request) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
    const snapshot = await convexAction("managebacSync:getUserSnapshot", { actorClerkId: actor.clerkId, forceRefresh });
    return ok(snapshot);
  });
}
