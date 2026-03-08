import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") {
      return badRequest("Only admin", 403);
    }

    const [users, usage] = await Promise.all([
      convexQuery("users:listUsersInOrg", { actorClerkId: actor.clerkId }),
      convexQuery("admin:usageOverview", { actorClerkId: actor.clerkId, days: 14 }),
    ]);

    return ok({ users, usage });
  });
}

export async function PATCH(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") {
      return badRequest("Only admin", 403);
    }

    const body = (await request.json()) as {
      targetUserId?: string;
      role?: "student" | "teacher";
    };

    if (!body.targetUserId || !body.role) {
      return badRequest("targetUserId and role are required");
    }
    if (body.role !== "student" && body.role !== "teacher") {
      return badRequest("Legacy admin route can only assign student or teacher roles");
    }

    await convexMutation("users:updateRole", {
      actorClerkId: actor.clerkId,
      targetUserId: body.targetUserId,
      role: body.role,
    });

    return ok({ ok: true });
  });
}
