import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();
    const { id } = await params;

    const detail = await convexQuery<{ actorClerkId: string; orgId: string }, unknown>(
      "superAdmin:getOrgDetail",
      { actorClerkId: actor.clerkId, orgId: id },
    );

    return ok(detail);
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    await convexMutation("superAdmin:updateOrg", {
      actorClerkId: actor.clerkId,
      orgId: id,
      ...body,
    });

    return ok({ ok: true });
  });
}
