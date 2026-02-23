import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: Request) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { searchParams } = new URL(request.url);
    const limitParam = Number(searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(1, Math.round(limitParam))) : 20;
    const cursor = searchParams.get("cursor") || undefined;
    const readParam = searchParams.get("read");
    const read = readParam === "true" ? true : readParam === "false" ? false : undefined;

    const [page, unread] = await Promise.all([
      convexQuery<
        {
          actorClerkId: string;
          read?: boolean;
          limit?: number;
          cursor?: string;
        },
        {
          notifications: Array<{
            _id: string;
            type: string;
            title: string;
            body: string;
            actionUrl?: string;
            read: boolean;
            createdAt: number;
          }>;
          nextCursor?: string;
          totalCount: number;
        }
      >("notifications:listNotifications", {
        actorClerkId: actor.clerkId,
        read,
        limit,
        cursor,
      }),
      convexQuery<
        { actorClerkId: string },
        { unreadCount: number }
      >("notifications:getUnreadCount", {
        actorClerkId: actor.clerkId,
      }),
    ]);

    return ok({
      notifications: page.notifications ?? [],
      nextCursor: page.nextCursor,
      totalCount: page.totalCount ?? 0,
      unreadCount: unread.unreadCount ?? 0,
    });
  });
}

export async function POST(request: Request) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as { action?: string } | null;
    if (!body) {
      return badRequest("Request body must be valid JSON.");
    }

    if (body.action !== "mark_all_read") {
      return badRequest("Unsupported action.");
    }

    const result = await convexMutation<
      { actorClerkId: string },
      { updated: number }
    >("notifications:markAllRead", {
      actorClerkId: actor.clerkId,
    });

    return ok({
      ok: true,
      updated: result.updated ?? 0,
    });
  });
}
