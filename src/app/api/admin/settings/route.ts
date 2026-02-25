import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") {
      return badRequest("Only admin", 403);
    }
    const data = await convexQuery("admin:getOrgSettings", { actorClerkId: actor.clerkId });
    return ok(data);
  });
}

export async function PATCH(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") {
      return badRequest("Only admin", 403);
    }

    const body = (await request.json()) as {
      verifyMarkerPassEnabled?: boolean;
      orchestratorV2Enabled?: boolean;
      soulEnabled?: boolean;
      agentModelBoostEnabled?: boolean;
      adaptiveQuizEnabled?: boolean;
      spacedRepetitionEnabled?: boolean;
    };

    await convexMutation("admin:updateOrgSettings", {
      actorClerkId: actor.clerkId,
      verifyMarkerPassEnabled: body.verifyMarkerPassEnabled,
      orchestratorV2Enabled: body.orchestratorV2Enabled,
      soulEnabled: body.soulEnabled,
      agentModelBoostEnabled: body.agentModelBoostEnabled,
      adaptiveQuizEnabled: body.adaptiveQuizEnabled,
      spacedRepetitionEnabled: body.spacedRepetitionEnabled,
    });

    return ok({ ok: true });
  });
}
