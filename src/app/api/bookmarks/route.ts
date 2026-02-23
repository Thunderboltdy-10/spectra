import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const chatId = request.nextUrl.searchParams.get("chatId") ?? undefined;

    const bookmarks = await convexQuery("bookmarks:getBookmarkedMessages", {
      actorClerkId: actor.clerkId,
      chatId,
    });

    return ok({ bookmarks });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as {
      chatId?: string;
      messageId?: string;
      note?: string;
    };

    const chatId = body.chatId?.trim();
    const messageId = body.messageId?.trim();
    if (!chatId || !messageId) {
      return badRequest("chatId and messageId are required");
    }

    const result = await convexMutation("bookmarks:toggleBookmark", {
      actorClerkId: actor.clerkId,
      chatId,
      messageId,
      note: body.note?.trim() || undefined,
    });

    return ok(result);
  });
}
