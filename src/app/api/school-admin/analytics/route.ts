import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") return badRequest("Admin access required", 403);

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") ?? "30", 10);

    const data = await convexQuery<{ actorClerkId: string; days: number }, unknown>(
      "schoolAdmin:getSchoolAnalytics",
      { actorClerkId: actor.clerkId, days },
    );

    return ok(data);
  });
}
