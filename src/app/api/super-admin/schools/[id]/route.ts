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
    const body = (await request.json()) as {
      action?: "assignAdmin" | "updateMemberRole" | "removeMember" | "updateBudget";
      email?: string;
      userId?: string;
      role?: "student" | "teacher" | "admin";
      monthlyBudgetCentsPerUser?: number;
      budgetMarginPercent?: number;
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
      });
      return ok(result);
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

    await convexMutation("superAdmin:updateOrg", {
      actorClerkId: actor.clerkId,
      orgId: id,
      ...body,
    });

    return ok({ ok: true });
  });
}
