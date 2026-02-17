import { requireSuperAdmin } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();

    const stats = await convexQuery<{ actorClerkId: string }, {
      totalOrgs: number;
      totalUsers: number;
      totalMessages: number;
    }>("superAdmin:getGlobalStats", { actorClerkId: actor.clerkId });

    return ok(stats);
  });
}
