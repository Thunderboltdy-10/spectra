import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

function parseLimit(input: string | null) {
  const parsed = Number.parseInt(input ?? "", 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(1, Math.min(parsed, 500));
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const params = request.nextUrl.searchParams;
    const action = params.get("action") ?? "list";

    if (action === "get") {
      const plannerItemId = params.get("id");
      if (!plannerItemId) return badRequest("id is required");

      const plannerItem = await convexQuery("plannerItems:get", {
        actorClerkId: actor.clerkId,
        plannerItemId,
      });

      return ok({ plannerItem });
    }

    const plannerItems = await convexQuery("plannerItems:list", {
      actorClerkId: actor.clerkId,
      workstreamId: params.get("workstreamId") ?? undefined,
      status: params.get("status") ?? undefined,
      type: params.get("type") ?? undefined,
      limit: parseLimit(params.get("limit")),
    });

    return ok({ plannerItems });
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const action = (body.action as string) ?? "create";

    if (action === "create") {
      const { title } = body as { title?: string };
      if (!title) return badRequest("title is required");

      const result = await convexMutation("plannerItems:create", {
        actorClerkId: actor.clerkId,
        title,
        description: body.description as string | undefined,
        workstreamId: body.workstreamId as string | undefined,
        type: body.type as "deadline" | "milestone" | "goal" | "reminder" | undefined,
        priority: body.priority as "low" | "medium" | "high" | undefined,
        status: body.status as "pending" | "in_progress" | "completed" | "cancelled" | undefined,
        dueAt: body.dueAt as number | undefined,
        completedAt: body.completedAt as number | undefined,
        sourceType: body.sourceType as "user_manual" | "ai_suggested" | "managebac_sync" | undefined,
        sourceArtifactId: body.sourceArtifactId as string | undefined,
        sourceChatId: body.sourceChatId as string | undefined,
        managebacItemId: body.managebacItemId as string | undefined,
      });

      return ok(result);
    }

    if (action === "update") {
      const { plannerItemId } = body as { plannerItemId?: string };
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
        sourceType: body.sourceType as "user_manual" | "ai_suggested" | "managebac_sync" | undefined,
        sourceArtifactId: body.sourceArtifactId as string | null | undefined,
        sourceChatId: body.sourceChatId as string | null | undefined,
        managebacItemId: body.managebacItemId as string | null | undefined,
      });

      return ok(result);
    }

    if (action === "delete") {
      const { plannerItemId } = body as { plannerItemId?: string };
      if (!plannerItemId) return badRequest("plannerItemId is required");

      const result = await convexMutation("plannerItems:remove", {
        actorClerkId: actor.clerkId,
        plannerItemId,
      });

      return ok(result);
    }

    return badRequest(`Unknown action: ${action}`);
  }, request);
}
