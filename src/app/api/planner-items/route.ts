import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const params = request.nextUrl.searchParams;
    const plannerItemId = params.get("plannerItemId");

    if (plannerItemId) {
      const item = await convexQuery("plannerItems:get", {
        actorClerkId: actor.clerkId,
        plannerItemId,
      });
      return ok({ item });
    }

    // Support hub aggregation mode
    if (params.get("hub") === "true") {
      const result = await convexQuery("plannerItems:listHubItems", {
        actorClerkId: actor.clerkId,
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
        daysAhead: params.has("daysAhead") ? Number(params.get("daysAhead")) : undefined,
      });
      return ok(result);
    }

    const items = await convexQuery("plannerItems:list", {
      actorClerkId: actor.clerkId,
      workstreamId: params.get("workstreamId") ?? undefined,
      status: params.get("status") ?? undefined,
      type: params.get("type") ?? undefined,
      limit: params.has("limit") ? Number(params.get("limit")) : undefined,
    });
    return ok({ items });
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const title = (body.title as string | undefined)?.trim();
    if (!title) return badRequest("title is required");

    const result = await convexMutation("plannerItems:create", {
      actorClerkId: actor.clerkId,
      title,
      description: (body.description as string | undefined) ?? undefined,
      workstreamId: (body.workstreamId as string | undefined) ?? undefined,
      type: (body.type as "deadline" | "milestone" | "goal" | "reminder" | undefined) ?? "deadline",
      priority: (body.priority as "low" | "medium" | "high" | undefined) ?? "medium",
      status: (body.status as "pending" | "in_progress" | "completed" | "cancelled" | undefined) ?? "pending",
      dueAt: typeof body.dueAt === "number" ? body.dueAt : undefined,
      sourceType: "user_manual",
    });

    return ok(result);
  }, request);
}

export async function PATCH(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const plannerItemId = body.plannerItemId as string | undefined;
    if (!plannerItemId) return badRequest("plannerItemId is required");

    const result = await convexMutation("plannerItems:update", {
      actorClerkId: actor.clerkId,
      plannerItemId,
      title: body.title as string | undefined,
      description: body.description as string | null | undefined,
      workstreamId: body.workstreamId as string | null | undefined,
      type: body.type as "deadline" | "milestone" | "goal" | "reminder" | undefined,
      priority: body.priority as "low" | "medium" | "high" | undefined,
      status: body.status as "pending" | "in_progress" | "completed" | "cancelled" | undefined,
      dueAt: body.dueAt as number | null | undefined,
      completedAt: body.completedAt as number | null | undefined,
    });

    return ok(result);
  }, request);
}

export async function DELETE(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const params = request.nextUrl.searchParams;
    const plannerItemId = params.get("plannerItemId");
    if (!plannerItemId) return badRequest("plannerItemId is required");

    const result = await convexMutation("plannerItems:remove", {
      actorClerkId: actor.clerkId,
      plannerItemId,
    });

    return ok(result);
  }, request);
}
