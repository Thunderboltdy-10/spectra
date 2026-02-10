import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function POST() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();

    if (actor.role !== "admin") {
      throw new Error("Only admin can seed demo content");
    }

    const packResult = await convexMutation("seed:seedDemoPack", {
      orgId: actor.orgId,
      ownerUserId: actor.userId,
    });

    const agentResult = await convexMutation("seed:seedDefaultAgents", {
      orgId: actor.orgId,
      creatorUserId: actor.userId,
    });

    const catalogResult = await convexMutation("models:seedCatalogIfEmpty", {
      actorClerkId: actor.clerkId,
    });

    return NextResponse.json({
      ok: true,
      pack: packResult,
      agents: agentResult,
      catalog: catalogResult,
    });
  });
}
