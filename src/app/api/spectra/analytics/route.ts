import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

function finite(value: string | null) {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : undefined;
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const from = finite(request.nextUrl.searchParams.get("from"));
    const to = finite(request.nextUrl.searchParams.get("to"));
    if (from === undefined || to === undefined || to <= from)
      return badRequest("Analytics requires a valid date range.");
    return ok({ data: await convexQuery("analytics:personalOverview", { from, to }) });
  }, request);
}
