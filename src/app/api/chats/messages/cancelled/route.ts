import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { safeStudyMode, type RouteTrace, type StudyMode } from "@/types";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as {
      chatId?: string;
      content?: string;
      mode?: StudyMode;
      modelUsed?: string;
      modelRequested?: string;
      thinkingContent?: string;
      routeTrace?: RouteTrace;
      parentMessageId?: string;
    };

    const chatId = body.chatId?.trim();
    const content = body.content?.trim();
    if (!chatId || !content) {
      return badRequest("chatId and content are required");
    }

    const mode = body.mode ? safeStudyMode(body.mode, "POST /api/chats/messages/cancelled") : "tutor";

    const result = await convexMutation("chats:appendMessage", {
      actorClerkId: actor.clerkId,
      chatId,
      role: "assistant",
      mode,
      content,
      citations: [],
      modelUsed: body.modelUsed?.trim() || undefined,
      modelRequested: body.modelRequested?.trim() || undefined,
      thinkingContent: body.thinkingContent?.trim() || undefined,
      routeTrace: body.routeTrace,
      parentMessageId: body.parentMessageId?.trim() || undefined,
      cancelled: true,
    });

    return ok(result);
  });
}
