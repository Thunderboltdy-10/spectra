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

    if (action === "listMergeCandidates") {
      const result = await convexQuery("workspaceItems:listMergeCandidates", {
        actorClerkId: actor.clerkId,
        workstreamId: params.get("workstreamId") ?? undefined,
        topic: params.get("topic") ?? undefined,
        limit: parseLimit(params.get("limit")),
      });
      return ok(result);
    }

    if (action === "listMutations") {
      const mutations = await convexQuery("workspaceItems:listMutations", {
        actorClerkId: actor.clerkId,
        workstreamId: params.get("workstreamId") ?? undefined,
        limit: parseLimit(params.get("limit")),
      });
      return ok({ mutations });
    }

    if (action === "listGhosts") {
      const workstreamId = params.get("workstreamId");
      if (!workstreamId) return badRequest("workstreamId is required");
      const result = await convexQuery("ghosts:listVisible", {
        actorClerkId: actor.clerkId,
        workstreamId,
        sessionKey: params.get("sessionKey") ?? undefined,
        editingActive: params.get("editingActive") === "true",
      });
      return ok(result);
    }

    if (action === "search") {
      const q = params.get("q") ?? "";
      const result = await convexQuery("workspaceItems:globalSearch", {
        actorClerkId: actor.clerkId,
        q,
        limit: parseLimit(params.get("limit")),
      });
      return ok(result);
    }

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

    if (action === "createWidget") {
      const type = typeof body.type === "string" ? body.type : undefined;
      const title = typeof body.title === "string" ? body.title : undefined;
      if (!type || !title) return badRequest("type and title are required");

      const result = await convexMutation("workspaceItems:createWidget", {
        actorClerkId: actor.clerkId,
        workstreamId: typeof body.workstreamId === "string" ? body.workstreamId : undefined,
        type,
        itemType: typeof body.itemType === "string" ? body.itemType : undefined,
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
        zIndex: typeof body.zIndex === "number" ? body.zIndex : undefined,
        category: typeof body.category === "string" ? body.category : undefined,
        pinned: typeof body.pinned === "boolean" ? body.pinned : undefined,
        collapsed: typeof body.collapsed === "boolean" ? body.collapsed : undefined,
        hidden: typeof body.hidden === "boolean" ? body.hidden : undefined,
        visualGroup: typeof body.visualGroup === "string" ? body.visualGroup : undefined,
        renderProps: body.renderProps,
        provenanceSource:
          body.provenanceSource === "user" || body.provenanceSource === "ai" || body.provenanceSource === "system"
            ? body.provenanceSource
            : undefined,
        provenanceAction: typeof body.provenanceAction === "string" ? body.provenanceAction : undefined,
        mutationSummary: typeof body.mutationSummary === "string" ? body.mutationSummary : undefined,
      });
      return ok(result);
    }

    if (action === "updateWidget") {
      const itemId = typeof body.itemId === "string" ? body.itemId : undefined;
      if (!itemId) return badRequest("itemId is required");

      const result = await convexMutation("workspaceItems:updateWidget", {
        actorClerkId: actor.clerkId,
        itemId,
        x: typeof body.x === "number" ? body.x : undefined,
        y: typeof body.y === "number" ? body.y : undefined,
        width: typeof body.width === "number" ? body.width : undefined,
        height: typeof body.height === "number" ? body.height : undefined,
        zIndex: typeof body.zIndex === "number" ? body.zIndex : undefined,
        title: typeof body.title === "string" ? body.title : undefined,
        contentSummary: typeof body.contentSummary === "string" ? body.contentSummary : undefined,
        category: typeof body.category === "string" ? body.category : undefined,
        itemType: typeof body.itemType === "string" ? body.itemType : undefined,
        renderMode: typeof body.renderMode === "string" ? body.renderMode : undefined,
        status:
          body.status === "active" || body.status === "archived"
            ? body.status
            : undefined,
        pinned: typeof body.pinned === "boolean" ? body.pinned : undefined,
        collapsed: typeof body.collapsed === "boolean" ? body.collapsed : undefined,
        hidden: typeof body.hidden === "boolean" ? body.hidden : undefined,
        visualGroup: typeof body.visualGroup === "string" ? body.visualGroup : undefined,
        renderProps: body.renderProps,
        provenanceSource:
          body.provenanceSource === "user" || body.provenanceSource === "ai" || body.provenanceSource === "system"
            ? body.provenanceSource
            : undefined,
        provenanceAction: typeof body.provenanceAction === "string" ? body.provenanceAction : undefined,
        mutationSummary: typeof body.mutationSummary === "string" ? body.mutationSummary : undefined,
      });
      return ok(result);
    }

    if (action === "moveWidget") {
      const itemId = typeof body.itemId === "string" ? body.itemId : undefined;
      const workstreamId = typeof body.workstreamId === "string" ? body.workstreamId : undefined;
      if (!itemId || !workstreamId) return badRequest("itemId and workstreamId are required");

      const result = await convexMutation("workspaceItems:moveWidget", {
        actorClerkId: actor.clerkId,
        itemId,
        workstreamId,
        x: typeof body.x === "number" ? body.x : undefined,
        y: typeof body.y === "number" ? body.y : undefined,
        provenanceSource:
          body.provenanceSource === "user" || body.provenanceSource === "ai" || body.provenanceSource === "system"
            ? body.provenanceSource
            : undefined,
        mutationSummary: typeof body.mutationSummary === "string" ? body.mutationSummary : undefined,
      });
      return ok(result);
    }

    if (action === "attachItemsToWorkstream") {
      if (!Array.isArray(body.items)) return badRequest("items array is required");
      const workstreamId = typeof body.workstreamId === "string" ? body.workstreamId : undefined;
      if (!workstreamId) return badRequest("workstreamId is required");

      const result = await convexMutation("workspaceItems:attachItemsToWorkstream", {
        actorClerkId: actor.clerkId,
        workstreamId,
        items: body.items.map((entry) => {
          const record = entry as Record<string, unknown>;
          return {
            type: typeof record.type === "string" ? record.type : undefined,
            itemType: typeof record.itemType === "string" ? record.itemType : undefined,
            sourceChatId: typeof record.sourceChatId === "string" ? record.sourceChatId : undefined,
            sourceArtifactId: typeof record.sourceArtifactId === "string" ? record.sourceArtifactId : undefined,
            sourcePlannerItemId:
              typeof record.sourcePlannerItemId === "string" ? record.sourcePlannerItemId : undefined,
            title: typeof record.title === "string" ? record.title : undefined,
            contentSummary: typeof record.contentSummary === "string" ? record.contentSummary : undefined,
            renderMode: typeof record.renderMode === "string" ? record.renderMode : undefined,
            category: typeof record.category === "string" ? record.category : undefined,
            x: typeof record.x === "number" ? record.x : undefined,
            y: typeof record.y === "number" ? record.y : undefined,
            width: typeof record.width === "number" ? record.width : undefined,
            height: typeof record.height === "number" ? record.height : undefined,
            visualGroup: typeof record.visualGroup === "string" ? record.visualGroup : undefined,
          };
        }),
        provenanceSource:
          body.provenanceSource === "user" || body.provenanceSource === "ai" || body.provenanceSource === "system"
            ? body.provenanceSource
            : undefined,
        mutationSummary: typeof body.mutationSummary === "string" ? body.mutationSummary : undefined,
      });
      return ok(result);
    }

    if (action === "updateWorkstreamLayout") {
      if (!Array.isArray(body.widgets)) return badRequest("widgets array is required");
      const workstreamId = typeof body.workstreamId === "string" ? body.workstreamId : undefined;
      if (!workstreamId) return badRequest("workstreamId is required");

      const result = await convexMutation("workspaceItems:updateWorkstreamLayout", {
        actorClerkId: actor.clerkId,
        workstreamId,
        widgets: body.widgets.map((entry) => {
          const record = entry as Record<string, unknown>;
          return {
            itemId: String(record.itemId ?? ""),
            x: Number(record.x ?? 0),
            y: Number(record.y ?? 0),
            width: typeof record.width === "number" ? record.width : undefined,
            height: typeof record.height === "number" ? record.height : undefined,
            zIndex: typeof record.zIndex === "number" ? record.zIndex : undefined,
          };
        }),
        provenanceSource:
          body.provenanceSource === "user" || body.provenanceSource === "ai" || body.provenanceSource === "system"
            ? body.provenanceSource
            : undefined,
        mutationSummary: typeof body.mutationSummary === "string" ? body.mutationSummary : undefined,
      });
      return ok(result);
    }

    if (action === "revertMutation") {
      const mutationId = typeof body.mutationId === "string" ? body.mutationId : undefined;
      if (!mutationId) return badRequest("mutationId is required");
      const result = await convexMutation("workspaceItems:revertMutation", {
        actorClerkId: actor.clerkId,
        mutationId,
      });
      return ok(result);
    }

    if (action === "markGhostsVisible") {
      const workstreamId = typeof body.workstreamId === "string" ? body.workstreamId : undefined;
      const sessionKey = typeof body.sessionKey === "string" ? body.sessionKey : undefined;
      const visibleGhostIds = Array.isArray(body.visibleGhostIds)
        ? body.visibleGhostIds.filter((value): value is string => typeof value === "string")
        : [];
      if (!workstreamId || !sessionKey) return badRequest("workstreamId and sessionKey are required");
      const result = await convexMutation("ghosts:markVisible", {
        actorClerkId: actor.clerkId,
        workstreamId,
        sessionKey,
        visibleGhostIds,
      });
      return ok(result);
    }

    if (action === "acceptGhost") {
      const ghostId = typeof body.ghostId === "string" ? body.ghostId : undefined;
      if (!ghostId) return badRequest("ghostId is required");
      const result = await convexMutation("ghosts:accept", {
        actorClerkId: actor.clerkId,
        ghostId,
      });
      return ok(result);
    }

    if (action === "dismissGhost") {
      const ghostId = typeof body.ghostId === "string" ? body.ghostId : undefined;
      if (!ghostId) return badRequest("ghostId is required");
      const result = await convexMutation("ghosts:dismiss", {
        actorClerkId: actor.clerkId,
        ghostId,
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

    if (action === "duplicate") {
      const itemId = typeof body.itemId === "string" ? body.itemId : undefined;
      if (!itemId) return badRequest("itemId is required");
      const result = await convexMutation("workspaceItems:duplicate", {
        actorClerkId: actor.clerkId,
        itemId,
        targetWorkstreamId: typeof body.targetWorkstreamId === "string" ? body.targetWorkstreamId : undefined,
      });
      return ok(result);
    }

    if (action === "archive") {
      const itemId = typeof body.itemId === "string" ? body.itemId : undefined;
      if (!itemId) return badRequest("itemId is required");

      try {
        const result = await convexMutation("workspaceItems:update", {
          actorClerkId: actor.clerkId,
          itemId,
          status: "archived",
          provenanceSource: "user",
          provenanceAction: "archived",
        });
        return ok(result);
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        if (message.includes("workspace item not found")) {
          return badRequest("itemId is required");
        }
        throw error;
      }
    }

    if (action === "pin") {
      const itemId = typeof body.itemId === "string" ? body.itemId : undefined;
      if (!itemId) return badRequest("itemId is required");
      const result = await convexMutation("workspaceItems:update", {
        actorClerkId: actor.clerkId,
        itemId,
        pinned: typeof body.pinned === "boolean" ? body.pinned : true,
      });
      return ok(result);
    }

    return badRequest(`Unknown action: ${action}`);
  }, request);
}
