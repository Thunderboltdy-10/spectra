import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

const SCHOOL_MANAGED_ROLES = new Set(["student", "teacher"]);

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") return badRequest("Admin access required", 403);

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? undefined;

    const [members, invitations] = await Promise.all([
      convexQuery<{ actorClerkId: string; search?: string }, unknown>(
        "schoolAdmin:listMembers",
        { actorClerkId: actor.clerkId, search },
      ),
      convexQuery<{ actorClerkId: string; status?: string }, unknown>(
        "schoolAdmin:listInvitations",
        { actorClerkId: actor.clerkId, status: "pending" },
      ),
    ]);

    return ok({ members, invitations });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") return badRequest("Admin access required", 403);

    const body = (await request.json()) as { email?: string; role?: string };
    if (!body.email?.trim()) return badRequest("email is required");
    if (!body.role) return badRequest("role is required");
    if (!SCHOOL_MANAGED_ROLES.has(body.role)) {
      return badRequest("School admins can only invite student or teacher roles");
    }

    const result = await convexMutation<{
      actorClerkId: string;
      email: string;
      role: string;
    }, unknown>("schoolAdmin:inviteMember", {
      actorClerkId: actor.clerkId,
      email: body.email.trim(),
      role: body.role,
    });

    return ok(result);
  });
}

export async function PATCH(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") return badRequest("Admin access required", 403);

    const body = (await request.json()) as {
      userId?: string;
      role?: string;
      action?: "updateRole" | "remove" | "cancelInvite" | "resendInvite";
      invitationId?: string;
    };

    if (body.action === "remove" && body.userId) {
      await convexMutation("schoolAdmin:removeMember", {
        actorClerkId: actor.clerkId,
        userId: body.userId,
      });
      return ok({ ok: true });
    }

    if (body.action === "cancelInvite" && body.invitationId) {
      await convexMutation("schoolAdmin:cancelInvitation", {
        actorClerkId: actor.clerkId,
        invitationId: body.invitationId,
      });
      return ok({ ok: true });
    }

    if (body.action === "resendInvite" && body.invitationId) {
      await convexMutation("schoolAdmin:resendInvitation", {
        actorClerkId: actor.clerkId,
        invitationId: body.invitationId,
      });
      return ok({ ok: true });
    }

    if (body.userId && body.role) {
      if (!SCHOOL_MANAGED_ROLES.has(body.role)) {
        return badRequest("School admins can only assign student or teacher roles");
      }
      await convexMutation("schoolAdmin:updateMemberRole", {
        actorClerkId: actor.clerkId,
        userId: body.userId,
        role: body.role,
      });
      return ok({ ok: true });
    }

    return badRequest("Invalid action");
  });
}
