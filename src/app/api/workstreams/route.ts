import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

function parseLimit(input: string | null) {
  const parsed = Number.parseInt(input ?? "", 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(1, Math.min(parsed, 300));
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const params = request.nextUrl.searchParams;
    const action = params.get("action") ?? "list";

    if (action === "get") {
      const workstreamId = params.get("id");
      if (!workstreamId) return badRequest("id is required");

      const workstream = await convexQuery("workstreams:get", {
        actorClerkId: actor.clerkId,
        workstreamId,
      });

      return ok({ workstream });
    }

    const workstreams = await convexQuery("workstreams:list", {
      actorClerkId: actor.clerkId,
      status: params.get("status") ?? undefined,
      type: params.get("type") ?? undefined,
      search: params.get("search") ?? undefined,
      limit: parseLimit(params.get("limit")),
    });

    return ok({ workstreams });
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const action = (body.action as string) ?? "create";

    if (action === "create") {
      const { type, title } = body as { type?: string; title?: string };
      if (!type || !title) return badRequest("type and title are required");

      const result = await convexMutation("workstreams:create", {
        actorClerkId: actor.clerkId,
        type,
        title,
        description: body.description as string | undefined,
        emoji: body.emoji as string | undefined,
        color: body.color as string | undefined,
        status: body.status as "active" | "completed" | "archived" | undefined,
        canvasX: body.canvasX as number | undefined,
        canvasY: body.canvasY as number | undefined,
        canvasWidth: body.canvasWidth as number | undefined,
        canvasHeight: body.canvasHeight as number | undefined,
        subjectCode: body.subjectCode as string | undefined,
        managebacClassId: body.managebacClassId as string | undefined,
        linkedAgentId: body.linkedAgentId as string | undefined,
        linkedPackId: body.linkedPackId as string | undefined,
        defaultMode: body.defaultMode as string | undefined,
        defaultThinking: body.defaultThinking as "low" | "medium" | "high" | undefined,
        artifactCount: body.artifactCount as number | undefined,
        lastActivityAt: body.lastActivityAt as number | undefined,
      });

      return ok(result);
    }

    if (action === "update") {
      const { workstreamId } = body as { workstreamId?: string };
      if (!workstreamId) return badRequest("workstreamId is required");

      const result = await convexMutation("workstreams:update", {
        actorClerkId: actor.clerkId,
        workstreamId,
        type: body.type as string | undefined,
        title: body.title as string | undefined,
        description: body.description as string | null | undefined,
        emoji: body.emoji as string | null | undefined,
        color: body.color as string | null | undefined,
        status: body.status as "active" | "completed" | "archived" | undefined,
        canvasX: body.canvasX as number | null | undefined,
        canvasY: body.canvasY as number | null | undefined,
        canvasWidth: body.canvasWidth as number | null | undefined,
        canvasHeight: body.canvasHeight as number | null | undefined,
        subjectCode: body.subjectCode as string | null | undefined,
        managebacClassId: body.managebacClassId as string | null | undefined,
        linkedAgentId: body.linkedAgentId as string | null | undefined,
        linkedPackId: body.linkedPackId as string | null | undefined,
        defaultMode: body.defaultMode as string | null | undefined,
        defaultThinking: body.defaultThinking as "low" | "medium" | "high" | null | undefined,
        artifactCount: body.artifactCount as number | undefined,
        lastActivityAt: body.lastActivityAt as number | null | undefined,
        completedAt: body.completedAt as number | null | undefined,
      });

      return ok(result);
    }

    if (action === "touchActivity") {
      const { workstreamId } = body as { workstreamId?: string };
      if (!workstreamId) return badRequest("workstreamId is required");

      const result = await convexMutation("workstreams:touchActivity", {
        actorClerkId: actor.clerkId,
        workstreamId,
        at: body.at as number | undefined,
      });

      return ok(result);
    }

    if (action === "delete") {
      const { workstreamId } = body as { workstreamId?: string };
      if (!workstreamId) return badRequest("workstreamId is required");

      const result = await convexMutation("workstreams:remove", {
        actorClerkId: actor.clerkId,
        workstreamId,
      });

      return ok(result);
    }

    return badRequest(`Unknown action: ${action}`);
  }, request);
}
