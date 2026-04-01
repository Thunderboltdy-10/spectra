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

    const items = await convexQuery("workspaceItems:list", {
      actorClerkId: actor.clerkId,
      workstreamId: params.get("workstreamId") ?? undefined,
      limit: parseLimit(params.get("limit")),
    });

    return ok({ items });
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "create";

    if (action === "create") {
      const type = typeof body.type === "string" ? body.type : undefined;
      const title = typeof body.title === "string" ? body.title : undefined;
      if (!type || !title) return badRequest("type and title are required");

      const result = await convexMutation("workspaceItems:create", {
        actorClerkId: actor.clerkId,
        workstreamId: typeof body.workstreamId === "string" ? body.workstreamId : undefined,
        type,
        renderMode: typeof body.renderMode === "string" ? body.renderMode : undefined,
        sourceChatId: typeof body.sourceChatId === "string" ? body.sourceChatId : undefined,
        sourceArtifactId: typeof body.sourceArtifactId === "string" ? body.sourceArtifactId : undefined,
        sourcePlannerItemId:
          typeof body.sourcePlannerItemId === "string" ? body.sourcePlannerItemId : undefined,
        title,
        contentSummary: typeof body.contentSummary === "string" ? body.contentSummary : undefined,
        x: typeof body.x === "number" ? body.x : 0,
        y: typeof body.y === "number" ? body.y : 0,
        width: typeof body.width === "number" ? body.width : undefined,
        height: typeof body.height === "number" ? body.height : undefined,
        pinned: typeof body.pinned === "boolean" ? body.pinned : undefined,
      });
      return ok(result);
    }

    if (action === "update") {
      const itemId = typeof body.itemId === "string" ? body.itemId : undefined;
      if (!itemId) return badRequest("itemId is required");

      const result = await convexMutation("workspaceItems:update", {
        actorClerkId: actor.clerkId,
        itemId,
        x: typeof body.x === "number" ? body.x : undefined,
        y: typeof body.y === "number" ? body.y : undefined,
        width: typeof body.width === "number" ? body.width : undefined,
        height: typeof body.height === "number" ? body.height : undefined,
        title: typeof body.title === "string" ? body.title : undefined,
        contentSummary: typeof body.contentSummary === "string" ? body.contentSummary : undefined,
        renderMode: typeof body.renderMode === "string" ? body.renderMode : undefined,
        status:
          body.status === "active" || body.status === "archived"
            ? body.status
            : undefined,
        pinned: typeof body.pinned === "boolean" ? body.pinned : undefined,
      });
      return ok(result);
    }

    if (action === "batchUpdatePositions") {
      if (!Array.isArray(body.positions)) return badRequest("positions array is required");
      const result = await convexMutation("workspaceItems:batchUpdatePositions", {
        actorClerkId: actor.clerkId,
        positions: body.positions.map((entry) => {
          const record = entry as Record<string, unknown>;
          return {
            itemId: String(record.itemId ?? ""),
            x: Number(record.x ?? 0),
            y: Number(record.y ?? 0),
            width: typeof record.width === "number" ? record.width : undefined,
            height: typeof record.height === "number" ? record.height : undefined,
          };
        }),
      });
      return ok(result);
    }

    if (action === "delete") {
      const itemId = typeof body.itemId === "string" ? body.itemId : undefined;
      if (!itemId) return badRequest("itemId is required");
      const result = await convexMutation("workspaceItems:remove", {
        actorClerkId: actor.clerkId,
        itemId,
      });
      return ok(result);
    }

    return badRequest(`Unknown action: ${action}`);
  }, request);
}
