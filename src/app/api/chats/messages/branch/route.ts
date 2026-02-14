import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as {
      messageId?: string;
    };

    const messageId = body.messageId?.trim();
    if (!messageId) {
      return badRequest("messageId is required");
    }

    const result = await convexMutation("chats:branchFromMessage", {
      actorClerkId: actor.clerkId,
      messageId,
    });

    return ok(result);
  });
}
