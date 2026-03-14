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

    const overview = await convexQuery("superAdmin:getOrgSoulOverview", {
      actorClerkId: actor.clerkId,
      orgId: id as Id<"orgs">,
    });

    return ok(overview);
  }, request);
}
