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
      newContent?: string;
    };

    const messageId = body.messageId?.trim();
    const newContent = body.newContent?.trim();
    if (!messageId || !newContent) {
      return badRequest("messageId and newContent are required");
    }

    const result = await convexMutation("chats:editMessageAsSibling", {
      actorClerkId: actor.clerkId,
      messageId,
      newContent,
    });

    return ok(result);
  });
}
