import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId");
    if (!orgId) return badRequest("orgId is required");

    const result = await convexQuery("superAdmin:listOrgMembers", {
      actorClerkId: actor.clerkId,
      orgId,
    });

    return ok(result);
  }, request);
}

export async function DELETE(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();

    const body = (await request.json()) as { userId?: string };
    if (!body.userId) return badRequest("userId is required");

    await convexMutation("superAdmin:removeAnyMember", {
      actorClerkId: actor.clerkId,
      userId: body.userId,
    });

    return ok({ ok: true });
  }, request);
}
