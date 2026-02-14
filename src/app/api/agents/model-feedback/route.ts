import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as {
      agentId?: string;
      modelId?: string;
      positive?: boolean;
    } | null;

    if (!body?.agentId || !body.modelId || typeof body.positive !== "boolean") {
      return badRequest("agentId, modelId, positive are required");
    }

    await convexMutation("agents:recordAgentModelFeedback", {
      actorClerkId: actor.clerkId,
      agentId: body.agentId,
      modelId: body.modelId,
      positive: body.positive,
    });

    return ok({ ok: true });
  });
}
