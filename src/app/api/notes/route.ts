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

function pickResolvedArtifactId(value: { _id: string } | { artifactId: string } | null) {
  if (!value) {
    throw new Error("Artifact not found");
  }
  return "artifactId" in value ? value.artifactId : value._id;
}

async function findExistingArtifact(actorClerkId: string, artifactId: string) {
  try {
    return await convexQuery("artifacts:get", {
      actorClerkId,
      artifactId,
    }) as { _id: string } | null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const params = request.nextUrl.searchParams;
    const action = params.get("action") ?? "list";

    if (action === "get") {
      const noteId = params.get("id");
      if (!noteId) return badRequest("id is required");
      const existingArtifact = await findExistingArtifact(actor.clerkId, noteId);
      const artifact = existingArtifact ?? await convexMutation("artifacts:getOrMigrateFromNote", {
        actorClerkId: actor.clerkId,
        noteId,
      });
      const artifactId = pickResolvedArtifactId(artifact);
      const note = await convexQuery("artifacts:get", {
        actorClerkId: actor.clerkId,
        artifactId,
      });
      return ok({ note });
    }

    const notes = await convexQuery("artifacts:listDocumentCompat", {
      actorClerkId: actor.clerkId,
      workstreamId: params.get("workstreamId") ?? undefined,
      search: params.get("search") ?? undefined,
      limit: parseLimit(params.get("limit")),
    });

    return ok({ notes });
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

      const artifactId = await convexMutation("artifacts:create", {
        actorClerkId: actor.clerkId,
        type: "document",
        title,
        content: body.content ?? {},
        contentPlaintext: body.contentPlaintext as string | undefined,
        editorMode: body.editorMode as "standard" | "ai_enhanced" | "agentic" | "notion" | "simple" | undefined,
        sourceType: body.sourceType as "user_manual" | "ai_generated" | "managebac_sync" | undefined,
        managebacItemId: body.managebacItemId as string | undefined,
        sourceDeleted: body.sourceDeleted as boolean | undefined,
        sourceUpdatedAt: body.sourceUpdatedAt as number | undefined,
        syncConflictSummary: body.syncConflictSummary as string | undefined,
        workstreamId: body.workstreamId as string | undefined,
        linkedChatId: body.linkedChatId as string | undefined,
        sourceMessageId: body.sourceMessageId as string | undefined,
        lastAiEditId: body.lastAiEditId as string | undefined,
        pendingDiffs: body.pendingDiffs,
      });
      return ok({ noteId: artifactId, artifactId });
    }

    if (action === "update") {
      const { noteId } = body as { noteId?: string };
      if (!noteId) return badRequest("noteId is required");

      const existingArtifact = await findExistingArtifact(actor.clerkId, noteId);
      const resolved = existingArtifact ?? await convexMutation("artifacts:getOrMigrateFromNote", {
        actorClerkId: actor.clerkId,
        noteId,
      });
      const artifactId = pickResolvedArtifactId(resolved);
      const result = await convexMutation("artifacts:update", {
        actorClerkId: actor.clerkId,
        artifactId,
        title: body.title as string | undefined,
        content: body.content,
        contentPlaintext: body.contentPlaintext as string | null | undefined,
        editorMode: body.editorMode as "standard" | "ai_enhanced" | "agentic" | "notion" | "simple" | undefined,
        sourceType: body.sourceType as "user_manual" | "ai_generated" | "managebac_sync" | null | undefined,
        managebacItemId: body.managebacItemId as string | null | undefined,
        sourceDeleted: body.sourceDeleted as boolean | null | undefined,
        sourceUpdatedAt: body.sourceUpdatedAt as number | null | undefined,
        syncConflictSummary: body.syncConflictSummary as string | null | undefined,
        workstreamId: body.workstreamId as string | null | undefined,
        linkedChatId: body.linkedChatId as string | null | undefined,
        sourceMessageId: body.sourceMessageId as string | undefined,
        lastAiEditId: body.lastAiEditId as string | null | undefined,
        pendingDiffs: body.pendingDiffs as unknown,
      });

      const responsePayload =
        typeof result === "object" && result !== null
          ? result as Record<string, unknown>
          : {};

      return ok({
        ...responsePayload,
        noteId: artifactId,
        artifactId,
        migratedFromLegacy: artifactId !== noteId,
      });
    }

    if (action === "delete") {
      const { noteId } = body as { noteId?: string };
      if (!noteId) return badRequest("noteId is required");
      const result = await convexMutation("notes:remove", {
        actorClerkId: actor.clerkId,
        noteId,
      });
      return ok(result);
    }

    return badRequest(`Unknown action: ${action}`);
  }, request);
}
