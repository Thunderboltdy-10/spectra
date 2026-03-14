import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import type { Id } from "../../../../../../../convex/_generated/dataModel";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();
    const { id } = await params;
    const daysRaw = Number.parseInt(request.nextUrl.searchParams.get("days") ?? "30", 10);
    const days = Number.isFinite(daysRaw) ? daysRaw : 30;

    const usage = await convexQuery("superAdmin:getOrgUsageSummary", {
      actorClerkId: actor.clerkId,
      orgId: id as Id<"orgs">,
      days,
    });

    return ok(usage);
  }, request);
}
