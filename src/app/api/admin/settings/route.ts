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
    const data = await convexQuery("admin:getOrgSettings", { actorClerkId: actor.clerkId });
    return ok(data);
  });
}

export async function PATCH(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "admin") {
      return badRequest("Only admin", 403);
    }

    const body = (await request.json()) as {
      verifyMarkerPassEnabled?: boolean;
      monthlyBudgetCentsPerUser?: number;
      budgetMarginPercent?: number;
      allowPaidModels?: boolean;
      description?: string;
      schoolType?: string;
      timezone?: string;
      maxStudents?: number;
      maxResourceFileSizeBytes?: number;
      orchestratorV2Enabled?: boolean;
      searxngEnabled?: boolean;
      soulEnabled?: boolean;
      agentModelBoostEnabled?: boolean;
      adaptiveQuizEnabled?: boolean;
      spacedRepetitionEnabled?: boolean;
    };

    const safeNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
    const safeString = (value: unknown) => (typeof value === "string" ? value.trim() : undefined);

    await convexMutation("admin:updateOrgSettings", {
      actorClerkId: actor.clerkId,
      verifyMarkerPassEnabled: body.verifyMarkerPassEnabled,
      monthlyBudgetCentsPerUser: safeNumber(body.monthlyBudgetCentsPerUser),
      budgetMarginPercent: safeNumber(body.budgetMarginPercent),
      allowPaidModels: body.allowPaidModels,
      description: safeString(body.description),
      schoolType: safeString(body.schoolType),
      timezone: safeString(body.timezone),
      maxStudents: safeNumber(body.maxStudents),
      maxResourceFileSizeBytes: safeNumber(body.maxResourceFileSizeBytes),
      orchestratorV2Enabled: body.orchestratorV2Enabled,
      searxngEnabled: body.searxngEnabled,
      soulEnabled: body.soulEnabled,
      agentModelBoostEnabled: body.agentModelBoostEnabled,
      adaptiveQuizEnabled: body.adaptiveQuizEnabled,
      spacedRepetitionEnabled: body.spacedRepetitionEnabled,
    });

    return ok({ ok: true });
  });
}
