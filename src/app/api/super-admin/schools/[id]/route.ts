import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { sendInvitationEmail } from "@/lib/invitations";
import { buildJoinUrl } from "@/lib/app-url";

function inviteDeliveryMetadata(result: {
  status: string;
  reason?: string;
  accepted?: string[];
  rejected?: string[];
  response?: string;
  envelopeFrom?: string;
}) {
  return {
    emailStatus: result.status,
    emailReason: result.reason,
    emailAccepted: result.accepted,
    emailRejected: result.rejected,
    emailResponse: result.response,
    emailEnvelopeFrom: result.envelopeFrom,
  };
}

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

    const normalized = (() => {
      if (!detail || typeof detail !== "object") return detail;
      const payload = detail as { org?: { maxStudents?: number } };
      if (!payload.org) return detail;
      return {
        ...payload,
        org: {
          ...payload.org,
          maxMembers: payload.org.maxStudents,
        },
      };
    })();

    return ok(normalized);
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();
    const { id } = await params;
    const body = (await request.json()) as {
      action?: "assignAdmin" | "updateMemberRole" | "removeMember" | "updateBudget" | "deleteSchool";
      email?: string;
      userId?: string;
      role?: "student" | "teacher" | "admin";
      monthlyBudgetCentsPerUser?: number;
      budgetMarginPercent?: number;
      maxMembers?: number;
      maxResourceFileSizeBytes?: number;
      [key: string]: unknown;
    };

    if (body.action === "assignAdmin") {
      if (!body.email || !body.email.trim()) {
        throw new Error("Admin email is required");
      }
      const result = await convexMutation("superAdmin:assignOrgAdmin", {
        actorClerkId: actor.clerkId,
        orgId: id,
        email: body.email.trim(),
      }) as { token?: string; transferred?: boolean; [key: string]: unknown };
      if (result.transferred) {
        return ok(result);
      }
      const token = result.token;
      if (!token) {
        throw new Error("INVITATION_EMAIL_FAILED: Admin invitation token was not generated.");
      }
      const joinUrl = buildJoinUrl(token, new URL(request.url).origin);
      const detail = await convexQuery<{ actorClerkId: string; orgId: string }, { org?: { name?: string } } | null>(
        "superAdmin:getOrgDetail",
        { actorClerkId: actor.clerkId, orgId: id },
      );
      const emailResult = await sendInvitationEmail({
        to: body.email.trim(),
        role: "admin",
        joinUrl,
        orgName: detail?.org?.name,
      });
      if (emailResult.status !== "sent") {
        throw new Error(`INVITATION_EMAIL_FAILED: ${emailResult.reason}`);
      }
      return ok({ ...result, joinUrl, ...inviteDeliveryMetadata(emailResult) });
    }

    if (body.action === "updateMemberRole") {
      if (!body.userId || !body.role) {
        throw new Error("userId and role are required");
      }
      await convexMutation("superAdmin:updateOrgMemberRole", {
        actorClerkId: actor.clerkId,
        orgId: id,
        userId: body.userId,
        role: body.role,
      });
      return ok({ ok: true });
    }

    if (body.action === "removeMember") {
      if (!body.userId) {
        throw new Error("userId is required");
      }
      await convexMutation("superAdmin:removeOrgMember", {
        actorClerkId: actor.clerkId,
        orgId: id,
        userId: body.userId,
      });
      return ok({ ok: true });
    }

    if (body.action === "deleteSchool") {
      await convexMutation("superAdmin:deleteOrg", {
        actorClerkId: actor.clerkId,
        orgId: id,
      });
      return ok({ ok: true });
    }

    if (body.action === "updateBudget") {
      if (
        typeof body.monthlyBudgetCentsPerUser !== "number"
        || !Number.isFinite(body.monthlyBudgetCentsPerUser)
        || body.monthlyBudgetCentsPerUser <= 0
      ) {
        throw new Error("monthlyBudgetCentsPerUser must be a positive number");
      }
      if (
        typeof body.budgetMarginPercent !== "number"
        || !Number.isFinite(body.budgetMarginPercent)
      ) {
        throw new Error("budgetMarginPercent must be a number");
      }

      const result = await convexMutation("superAdmin:updateOrgBudget", {
        actorClerkId: actor.clerkId,
        orgId: id,
        monthlyBudgetCentsPerUser: body.monthlyBudgetCentsPerUser,
        budgetMarginPercent: body.budgetMarginPercent,
      });
      return ok(result);
    }

    const orgPatch = { ...body } as Record<string, unknown>;
    if (typeof orgPatch.maxMembers === "number" && !Number.isNaN(orgPatch.maxMembers)) {
      orgPatch.maxStudents = orgPatch.maxMembers;
    }
    delete orgPatch.maxMembers;

    await convexMutation("superAdmin:updateOrg", {
      actorClerkId: actor.clerkId,
      orgId: id,
      ...orgPatch,
    });

    return ok({ ok: true });
  });
}
