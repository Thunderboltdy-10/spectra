import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireSuperAdmin();
    const parsedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(parsedLimit) ? Math.min(100, parsedLimit) : 50;

    const errors = await convexQuery("errorEvents:list", { limit });
    return ok({ errors });
  });
}
