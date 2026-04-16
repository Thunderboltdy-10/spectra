import { isAdminLikeActor, requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (!isAdminLikeActor(actor)) {
      return badRequest("Admin access required", 403);
    }

    const data = await convexQuery<{ actorClerkId: string }, unknown>(
      "schoolAdmin:getSchoolDashboard",
      { actorClerkId: actor.clerkId },
    );

    return ok(data);
  });
}
