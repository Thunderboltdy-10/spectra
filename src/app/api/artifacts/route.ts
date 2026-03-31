import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { stripGeneratedDocumentMarkers } from "@/lib/document-generator";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

function sanitizeArtifactTitle(value: unknown, fallback = "Untitled artifact") {
  const sanitized = typeof value === "string" ? stripGeneratedDocumentMarkers(value).trim() : "";
  return sanitized || fallback;
}

function sanitizeArtifactPlaintext(value: unknown) {
  if (typeof value !== "string") return value as string | undefined;
  return stripGeneratedDocumentMarkers(value);
}

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

    if (action === "search_content") {
      const query = params.get("query");
      if (!query) return badRequest("query is required");
      const artifacts = await convexQuery("artifacts:searchByContent", {
        actorClerkId: actor.clerkId,
        query,
        workstreamId: params.get("workstreamId") ?? undefined,
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ artifacts });
    }

    if (action === "hub") {
      const artifacts = await convexQuery("artifacts:listHubArtifacts", {
        actorClerkId: actor.clerkId,
        type: params.get("type") ?? undefined,
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ artifacts });
    }

    if (action === "getOrMigrateFromNote") {
      const noteId = params.get("noteId");
      if (!noteId) return badRequest("noteId is required");
      const existingArtifact = await convexQuery("artifacts:get", {
        actorClerkId: actor.clerkId,
        artifactId: noteId,
      }).catch(() => null) as { _id: string } | null;
      if (existingArtifact) {
        return ok({ artifactId: existingArtifact._id });
      }
      const result = await convexMutation("artifacts:getOrMigrateFromNote", {
        actorClerkId: actor.clerkId,
        noteId,
      });
      return ok(result);
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
        contentPlaintext?: string;
        workstreamId?: string;
        editorMode?: "standard" | "ai_enhanced" | "agentic" | "notion" | "simple";
        sourceType?: "user_manual" | "ai_generated" | "managebac_sync";
        managebacItemId?: string;
        sourceDeleted?: boolean;
        sourceUpdatedAt?: number;
        syncConflictSummary?: string;
        tags?: string[];
        linkedAgentId?: string;
        linkedChatId?: string;
        sourceMessageId?: string;
        lastAiEditId?: string;
        pendingDiffs?: unknown;
      };
      if (!type || !title) return badRequest("type and title are required");

      const artifactId = await convexMutation("artifacts:create", {
        actorClerkId: actor.clerkId,
        type,
        title: sanitizeArtifactTitle(title, type === "document" ? "Untitled document" : "Untitled artifact"),
        content: content ?? {},
        contentPlaintext: sanitizeArtifactPlaintext(body.contentPlaintext),
        workstreamId: body.workstreamId as string | undefined,
        editorMode: body.editorMode as "standard" | "ai_enhanced" | "agentic" | "notion" | "simple" | undefined,
        sourceType: body.sourceType as "user_manual" | "ai_generated" | "managebac_sync" | undefined,
        managebacItemId: body.managebacItemId as string | undefined,
        sourceDeleted: body.sourceDeleted as boolean | undefined,
        sourceUpdatedAt: body.sourceUpdatedAt as number | undefined,
        syncConflictSummary: body.syncConflictSummary as string | undefined,
        tags,
        linkedAgentId,
        linkedChatId,
        sourceMessageId,
        lastAiEditId: body.lastAiEditId as string | undefined,
        pendingDiffs: body.pendingDiffs,
      });
      return ok({ artifactId });
    }

    if (action === "update") {
      const { artifactId, title, content, tags, description, authorType, sourceChatId, sourceMessageId } = body as {
        artifactId?: string;
        title?: string;
        content?: unknown;
        contentPlaintext?: string | null;
        workstreamId?: string | null;
        editorMode?: "standard" | "ai_enhanced" | "agentic" | "notion" | "simple";
        sourceType?: "user_manual" | "ai_generated" | "managebac_sync" | null;
        managebacItemId?: string | null;
        sourceDeleted?: boolean | null;
        sourceUpdatedAt?: number | null;
        syncConflictSummary?: string | null;
        tags?: string[];
        description?: string;
        authorType?: string;
        sourceChatId?: string;
        sourceMessageId?: string;
        linkedChatId?: string | null;
        lastAiEditId?: string | null;
        pendingDiffs?: unknown;
      };
      if (!artifactId) return badRequest("artifactId is required");

      const result = await convexMutation("artifacts:update", {
        actorClerkId: actor.clerkId,
        artifactId,
        title: title == null ? undefined : sanitizeArtifactTitle(title),
        content,
        contentPlaintext: sanitizeArtifactPlaintext(body.contentPlaintext) as string | null | undefined,
        workstreamId: body.workstreamId as string | null | undefined,
        editorMode: body.editorMode as "standard" | "ai_enhanced" | "agentic" | "notion" | "simple" | undefined,
        sourceType: body.sourceType as "user_manual" | "ai_generated" | "managebac_sync" | null | undefined,
        managebacItemId: body.managebacItemId as string | null | undefined,
        sourceDeleted: body.sourceDeleted as boolean | null | undefined,
        sourceUpdatedAt: body.sourceUpdatedAt as number | null | undefined,
        syncConflictSummary: body.syncConflictSummary as string | null | undefined,
        tags,
        description,
        authorType,
        sourceChatId,
        sourceMessageId,
        linkedChatId: body.linkedChatId as string | null | undefined,
        lastAiEditId: body.lastAiEditId as string | null | undefined,
        pendingDiffs: body.pendingDiffs,
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

    if (action === "applyAiEdit") {
      const {
        artifactId,
        content,
        contentPlaintext,
        instruction,
        operations,
        summary,
        sourceChatId,
        sourceMessageId,
        lastAiEditId,
        pendingDiffs,
      } = body as {
        artifactId?: string;
        content?: unknown;
        contentPlaintext?: string;
        instruction?: string;
        operations?: unknown;
        summary?: string;
        sourceChatId?: string;
        sourceMessageId?: string;
        lastAiEditId?: string;
        pendingDiffs?: unknown;
      };
      if (!artifactId || content === undefined || !instruction) {
        return badRequest("artifactId, content, and instruction are required");
      }
      const result = await convexMutation("artifacts:applyAiEdit", {
        actorClerkId: actor.clerkId,
        artifactId,
        content,
        contentPlaintext,
        instruction,
        operations,
        summary,
        sourceChatId,
        sourceMessageId,
        lastAiEditId,
        pendingDiffs,
      });
      return ok(result);
    }

    if (action === "confirmAiEdit") {
      const { artifactId, versionId } = body as { artifactId?: string; versionId?: string };
      if (!artifactId || !versionId) return badRequest("artifactId and versionId are required");
      const result = await convexMutation("artifacts:confirmAiEdit", {
        actorClerkId: actor.clerkId,
        artifactId,
        versionId,
      });
      return ok(result);
    }

    if (action === "discardAiEdit") {
      const { artifactId, versionId } = body as { artifactId?: string; versionId?: string };
      if (!artifactId || !versionId) return badRequest("artifactId and versionId are required");
      const result = await convexMutation("artifacts:discardAiEdit", {
        actorClerkId: actor.clerkId,
        artifactId,
        versionId,
      });
      return ok(result);
    }

    if (action === "reapplyAiEdit") {
      const { artifactId, versionId, contentPlaintext } = body as {
        artifactId?: string;
        versionId?: string;
        contentPlaintext?: string;
      };
      if (!artifactId || !versionId) return badRequest("artifactId and versionId are required");
      const result = await convexMutation("artifacts:reapplyAiEdit", {
        actorClerkId: actor.clerkId,
        artifactId,
        versionId,
        contentPlaintext,
      });
      return ok(result);
    }

    if (action === "getOrMigrateFromNote") {
      const { noteId } = body as { noteId?: string };
      if (!noteId) return badRequest("noteId is required");
      const existingArtifact = await convexQuery("artifacts:get", {
        actorClerkId: actor.clerkId,
        artifactId: noteId,
      }).catch(() => null) as { _id: string } | null;
      if (existingArtifact) {
        return ok({ artifactId: existingArtifact._id });
      }
      const result = await convexMutation("artifacts:getOrMigrateFromNote", {
        actorClerkId: actor.clerkId,
        noteId,
      });
      return ok(result);
    }

    return badRequest(`Unknown action: ${action}`);
  }, request);
}
