import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();
    const parsedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 100;

    const logs = await convexQuery("auditLog:listAuditLogs", {
      actorClerkId: actor.clerkId,
      limit,
    });

    return ok({ logs });
  });
}
