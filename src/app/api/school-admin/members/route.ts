import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { sendInvitationEmail } from "@/lib/invitations";
import { withRouteErrorHandling } from "@/lib/route-handler";

const SCHOOL_MANAGED_ROLES = new Set(["student", "teacher"]);

function inviteDeliveryErrorMessage(reason?: string) {
  if (!reason) {
    return "Invitation email could not be sent.";
  }
  return `Invitation email could not be sent: ${reason}`;
}

async function loadOrgSettingsName(actorClerkId: string) {
  try {
    const result = (await convexQuery("admin:getOrgSettings", {
      actorClerkId,
    })) as { org?: { name?: string } } | null;
    return result ?? {};
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") return badRequest("Admin access required", 403);

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? undefined;

    const [members, invitations, accessRequests] = await Promise.all([
      convexQuery<{ actorClerkId: string; search?: string }, unknown>(
        "schoolAdmin:listMembers",
        { actorClerkId: actor.clerkId, search },
      ),
      convexQuery<{ actorClerkId: string; status?: string }, unknown>(
        "schoolAdmin:listInvitations",
        { actorClerkId: actor.clerkId, status: "pending" },
      ),
      convexQuery<{ actorClerkId: string; status?: string }, unknown>(
        "accessRequests:listOrgAccessRequests",
        { actorClerkId: actor.clerkId, status: "pending" },
      ),
    ]);

    return ok({ members, invitations, accessRequests });
  }, request);
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

    const orgSettings = await loadOrgSettingsName(actor.clerkId);
    let result: { invitationId: string; token?: string };
    try {
      result = await convexMutation<{
        actorClerkId: string;
        email: string;
        role: string;
      }, { invitationId: string; token?: string }>("schoolAdmin:inviteMember", {
        actorClerkId: actor.clerkId,
        email: body.email.trim(),
        role: body.role,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("already a member")) {
        return badRequest("This email is already a member of the school.", 409);
      }
      if (msg.includes("SEAT_LIMIT_REACHED")) {
        return badRequest("Student seat limit reached for this school. Please upgrade your plan.", 402);
      }
      throw err;
    }

    const origin = new URL(request.url).origin;
    const joinUrl = result.token ? `${origin}/join?token=${encodeURIComponent(result.token)}` : undefined;
    const emailResult = joinUrl
      ? await sendInvitationEmail({
          to: body.email.trim(),
          role: body.role,
          joinUrl,
          orgName: orgSettings.org?.name,
        })
      : { status: "skipped" as const, reason: "Invitation token was not generated." };
    if (emailResult.status !== "sent") {
      return badRequest(inviteDeliveryErrorMessage("reason" in emailResult ? emailResult.reason : undefined), 502);
    }

    return ok({
      invitationId: result.invitationId,
      joinUrl,
      emailStatus: emailResult.status,
      emailReason: "reason" in emailResult ? emailResult.reason : undefined,
    });
  });
}

export async function PATCH(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") return badRequest("Admin access required", 403);

    const body = (await request.json()) as {
      userId?: string;
      role?: string;
      action?:
        | "updateRole"
        | "remove"
        | "cancelInvite"
        | "resendInvite"
        | "approveAccessRequest"
        | "rejectAccessRequest";
      invitationId?: string;
      requestId?: string;
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
      const orgSettings = await loadOrgSettingsName(actor.clerkId);
      const result = await convexMutation<{
        actorClerkId: string;
        invitationId: string;
      }, { ok: boolean; token?: string; email?: string; role?: string }>("schoolAdmin:resendInvitation", {
        actorClerkId: actor.clerkId,
        invitationId: body.invitationId,
      });
      const origin = new URL(request.url).origin;
      const joinUrl = result.token ? `${origin}/join?token=${encodeURIComponent(result.token)}` : undefined;
      const emailResult =
        result.email && result.role && joinUrl
          ? await sendInvitationEmail({
              to: result.email,
              role: result.role,
              joinUrl,
              orgName: orgSettings.org?.name,
            })
          : { status: "skipped" as const, reason: "Invitation token was not generated." };
      if (emailResult.status !== "sent") {
        return badRequest(inviteDeliveryErrorMessage("reason" in emailResult ? emailResult.reason : undefined), 502);
      }
      return ok({
        ok: true,
        joinUrl,
        emailStatus: emailResult.status,
        emailReason: "reason" in emailResult ? emailResult.reason : undefined,
      });
    }

    if (body.action === "approveAccessRequest" && body.requestId && body.role) {
      if (!SCHOOL_MANAGED_ROLES.has(body.role)) {
        return badRequest("School admins can only invite student or teacher roles");
      }

      const accessRequest = await convexQuery<{
        actorClerkId: string;
        requestId: string;
      }, { email: string }>("accessRequests:getOrgAccessRequest", {
        actorClerkId: actor.clerkId,
        requestId: body.requestId,
      });

      const orgSettings = await loadOrgSettingsName(actor.clerkId);
      const result = await convexMutation<{
        actorClerkId: string;
        email: string;
        role: string;
      }, { invitationId: string; token?: string }>("schoolAdmin:inviteMember", {
        actorClerkId: actor.clerkId,
        email: accessRequest.email,
        role: body.role,
      });

      const origin = new URL(request.url).origin;
      const joinUrl = result.token ? `${origin}/join?token=${encodeURIComponent(result.token)}` : undefined;
      const emailResult = joinUrl
        ? await sendInvitationEmail({
            to: accessRequest.email,
            role: body.role,
            joinUrl,
            orgName: orgSettings.org?.name,
          })
        : { status: "skipped" as const, reason: "Invitation token was not generated." };
      if (emailResult.status !== "sent") {
        return badRequest(inviteDeliveryErrorMessage("reason" in emailResult ? emailResult.reason : undefined), 502);
      }

      await convexMutation("accessRequests:resolveAccessRequest", {
        actorClerkId: actor.clerkId,
        requestId: body.requestId,
        status: "invited",
        role: body.role,
      });

      return ok({ ok: true, invitationId: result.invitationId, joinUrl });
    }

    if (body.action === "rejectAccessRequest" && body.requestId) {
      await convexMutation("accessRequests:resolveAccessRequest", {
        actorClerkId: actor.clerkId,
        requestId: body.requestId,
        status: "rejected",
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
