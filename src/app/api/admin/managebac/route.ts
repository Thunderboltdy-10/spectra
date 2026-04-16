import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";
import { ok, badRequest } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { discoverManagebacEndpoints, fetchManagebacJson } from "@/lib/managebac/client";
import { encryptManagebacToken } from "../../../../../shared/managebac-crypto";
import { isAdminLikeActor } from "@/lib/auth-server";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (!isAdminLikeActor(actor)) return badRequest("Only admin", 403);
    const config = await convexQuery("managebacSync:getAdminConfig", { actorClerkId: actor.clerkId });
    return ok(config);
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (!isAdminLikeActor(actor)) return badRequest("Only admin", 403);
    const body = (await request.json()) as
      | { action: "discover"; baseUrl: string; token: string; studentId?: string }
      | { action: "sync" };

    if (body.action === "sync") {
      const result = await convexAction("managebacSync:manualSync", { actorClerkId: actor.clerkId });
      return ok(result);
    }

    if (!body.baseUrl?.trim() || !body.token?.trim()) {
      return badRequest("baseUrl and token are required");
    }

    const baseUrl = body.baseUrl.trim();
    const token = body.token.trim();
    const studentsPayload = await fetchManagebacJson({
      baseUrl,
      token,
      path: "/api/v2/students",
    }).catch(() => null);
    const resolvedStudentId = body.studentId?.trim()
      || (Array.isArray((studentsPayload as { data?: unknown } | null)?.data)
        ? String((((studentsPayload as { data?: Array<Record<string, unknown>> }).data?.[0]?.id) ?? "")).trim()
        : "")
      || undefined;

    const discovery = await discoverManagebacEndpoints({
      baseUrl,
      token,
      studentId: resolvedStudentId,
    });
    return ok({ ...discovery, autoResolvedStudentId: resolvedStudentId });
  });
}

export async function PATCH(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (!isAdminLikeActor(actor)) return badRequest("Only admin", 403);
    const body = (await request.json()) as {
      baseUrl: string;
      token?: string;
      studentMappings?: Array<{ clerkId: string; managebacStudentId: string; email?: string }>;
      syncEnabled?: boolean;
      syncFrequencyHours?: number;
      availableEndpoints?: unknown;
    };

    if (!body.baseUrl?.trim()) return badRequest("baseUrl is required");

    await convexMutation("managebacSync:saveAdminConfig", {
      actorClerkId: actor.clerkId,
      baseUrl: body.baseUrl.trim(),
      encryptedToken: body.token?.trim()
        ? await encryptManagebacToken(body.token.trim())
        : undefined,
      tokenLastFour: body.token?.trim() ? body.token.trim().slice(-4) : undefined,
      studentMappings: Array.isArray(body.studentMappings)
        ? body.studentMappings.map((mapping) => ({
          clerkId: mapping.clerkId,
          managebacStudentId: mapping.managebacStudentId,
          email: mapping.email?.trim() || undefined,
        }))
        : undefined,
      syncEnabled: body.syncEnabled,
      syncFrequencyHours:
        typeof body.syncFrequencyHours === "number" && Number.isFinite(body.syncFrequencyHours)
          ? Math.max(1, Math.round(body.syncFrequencyHours))
          : undefined,
      availableEndpoints: body.availableEndpoints,
    });

    return ok({ ok: true });
  });
}
