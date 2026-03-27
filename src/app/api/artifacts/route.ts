import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const params = request.nextUrl.searchParams;
    const action = params.get("action") ?? "list";

    if (action === "stats") {
      const stats = await convexQuery("artifacts:getStats", {
        actorClerkId: actor.clerkId,
      });
      return ok({ stats });
    }

    if (action === "get") {
      const artifactId = params.get("id");
      if (!artifactId) return badRequest("id is required");
      const artifact = await convexQuery("artifacts:get", {
        actorClerkId: actor.clerkId,
        artifactId,
      });
      return ok({ artifact });
    }

    if (action === "versions") {
      const artifactId = params.get("id");
      if (!artifactId) return badRequest("id is required");
      const versions = await convexQuery("artifacts:getVersions", {
        actorClerkId: actor.clerkId,
        artifactId,
      });
      return ok({ versions });
    }

    // Default: list
    const artifacts = await convexQuery("artifacts:list", {
      actorClerkId: actor.clerkId,
      type: params.get("type") ?? undefined,
      status: params.get("status") ?? undefined,
      workstreamId: params.get("workstreamId") ?? undefined,
      search: params.get("search") ?? undefined,
      limit: params.has("limit") ? Number(params.get("limit")) : undefined,
    });

    return ok({ artifacts });
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const action = (body.action as string) ?? "create";

    if (action === "create") {
      const { type, title, content, tags, linkedAgentId, linkedChatId, sourceMessageId } = body as {
        type?: string;
        title?: string;
        content?: unknown;
        tags?: string[];
        linkedAgentId?: string;
        linkedChatId?: string;
        sourceMessageId?: string;
      };
      if (!type || !title) return badRequest("type and title are required");

      const artifactId = await convexMutation("artifacts:create", {
        actorClerkId: actor.clerkId,
        type,
        title,
        content: content ?? {},
        tags,
        linkedAgentId,
        linkedChatId,
        sourceMessageId,
      });
      return ok({ artifactId });
    }

    if (action === "update") {
      const { artifactId, title, content, tags, description, authorType, sourceChatId, sourceMessageId } = body as {
        artifactId?: string;
        title?: string;
        content?: unknown;
        tags?: string[];
        description?: string;
        authorType?: string;
        sourceChatId?: string;
        sourceMessageId?: string;
      };
      if (!artifactId) return badRequest("artifactId is required");

      const result = await convexMutation("artifacts:update", {
        actorClerkId: actor.clerkId,
        artifactId,
        title,
        content,
        tags,
        description,
        authorType,
        sourceChatId,
        sourceMessageId,
      });
      return ok(result);
    }

    if (action === "archive") {
      const { artifactId } = body as { artifactId?: string };
      if (!artifactId) return badRequest("artifactId is required");
      const result = await convexMutation("artifacts:archive", {
        actorClerkId: actor.clerkId,
        artifactId,
      });
      return ok(result);
    }

    if (action === "restore") {
      const { artifactId } = body as { artifactId?: string };
      if (!artifactId) return badRequest("artifactId is required");
      const result = await convexMutation("artifacts:restore", {
        actorClerkId: actor.clerkId,
        artifactId,
      });
      return ok(result);
    }

    if (action === "delete") {
      const { artifactId } = body as { artifactId?: string };
      if (!artifactId) return badRequest("artifactId is required");
      const result = await convexMutation("artifacts:remove", {
        actorClerkId: actor.clerkId,
        artifactId,
      });
      return ok(result);
    }

    if (action === "togglePin") {
      const { artifactId } = body as { artifactId?: string };
      if (!artifactId) return badRequest("artifactId is required");
      const result = await convexMutation("artifacts:togglePin", {
        actorClerkId: actor.clerkId,
        artifactId,
      });
      return ok(result);
    }

    if (action === "restoreVersion") {
      const { artifactId, versionId } = body as { artifactId?: string; versionId?: string };
      if (!artifactId || !versionId) return badRequest("artifactId and versionId are required");
      const result = await convexMutation("artifacts:restoreVersion", {
        actorClerkId: actor.clerkId,
        artifactId,
        versionId,
      });
      return ok(result);
    }

    return badRequest(`Unknown action: ${action}`);
  }, request);
}
