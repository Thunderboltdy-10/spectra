import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as {
      chatId?: string;
      messageId?: string;
      agentId?: string;
      modelId?: string;
      positive?: boolean;
    } | null;

    if (!body?.messageId || typeof body.positive !== "boolean") {
      return badRequest("messageId and positive are required");
    }

    await convexMutation("feedback:recordAssistantMessageFeedback", {
      actorClerkId: actor.clerkId,
      messageId: body.messageId,
      chatId: body.chatId,
      agentId: body.agentId,
      modelId: body.modelId,
      positive: body.positive,
    });

    if (body.modelId) {
      await convexMutation("models:recordModelFeedbackSignal", {
        actorClerkId: actor.clerkId,
        modelId: body.modelId,
        positive: body.positive,
      });
    }

    if (body.agentId && body.modelId) {
      await convexMutation("agents:recordAgentModelFeedback", {
        actorClerkId: actor.clerkId,
        agentId: body.agentId,
        modelId: body.modelId,
        positive: body.positive,
      });
    }

    return ok({ ok: true });
  });
}
