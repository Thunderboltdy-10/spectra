import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const query = request.nextUrl.searchParams.get("q") ?? "";
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "30");

    const results = await convexQuery("chats:searchMessages", {
      actorClerkId: actor.clerkId,
      query,
      limit,
    });

    return ok({ results });
  });
}
