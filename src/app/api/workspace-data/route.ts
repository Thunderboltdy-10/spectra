import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery, convexMutation } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

function sanitizeTitle(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function summarizeContent(value: unknown, max = 280) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const params = request.nextUrl.searchParams;
    const workstreamId = params.get("workstreamId");
    if (!workstreamId) return badRequest("workstreamId is required");

    const includeDismissedResults = params.get("includeDismissedResults") === "true";
    const commandResultLimit = Math.max(
      1,
      Math.min(Number(params.get("commandResultLimit")) || 25, 100),
    );

    const data = await convexQuery("workspaceItems:getWorkspacePageData", {
      actorClerkId: actor.clerkId,
      workstreamId,
      includeDismissedResults,
      commandResultLimit,
    });

    return ok(data);
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action as string;

    if (action === "dismissResult") {
      const resultId = body.resultId as string;
      if (!resultId) return badRequest("resultId is required");
      const result = await convexMutation(
        "workspaceCommandResults:dismiss",
        { actorClerkId: actor.clerkId, resultId },
      );
      return ok(result);
    }

    if (action === "createResult") {
      const workstreamId = body.workstreamId as string | undefined;
      if (!workstreamId) return badRequest("workstreamId is required");
      const result = await convexMutation("workspaceCommandResults:create", {
        actorClerkId: actor.clerkId,
        workstreamId,
        intent: (body.intent as any) || "result",
        status: (body.status as any) || "processing",
        title: sanitizeTitle(body.title, "Command"),
        summary: body.summary as string || "Processing...",
        targetKind: body.targetKind as any,
        targetId: body.targetId as string,
        variant: body.variant as any,
      });
      return ok(result);
    }

    if (action === "updateResult") {
      const resultId = body.resultId as string;
      if (!resultId) return badRequest("resultId is required");
      const result = await convexMutation("workspaceCommandResults:update", {
        actorClerkId: actor.clerkId,
        resultId,
        status: body.status as any,
        summary: body.summary as string,
        targetKind: body.targetKind as any,
        targetId: body.targetId as string,
        variant: body.variant as any,
      });
      return ok(result);
    }

    if (action === "reopenResult") {
      const resultId = body.resultId as string;
      if (!resultId) return badRequest("resultId is required");
      const result = await convexMutation(
        "workspaceCommandResults:reopen",
        { actorClerkId: actor.clerkId, resultId },
      );
      return ok(result);
    }

    if (action === "search") {
      const workstreamId = body.workstreamId as string | undefined;
      const query = body.query as string | undefined;
      if (!query?.trim()) return badRequest("query is required");
      const results = await convexQuery("workspaceItems:searchWorkspace", {
        actorClerkId: actor.clerkId,
        query: query.trim(),
        workstreamId,
        limit: Math.max(1, Math.min(Number(body.limit) || 12, 50)),
      });
      return ok({ results });
    }

    if (action === "createNote") {
      const workstreamId = body.workstreamId as string | undefined;
      if (!workstreamId) return badRequest("workstreamId is required");
      const title = sanitizeTitle(body.title, "Untitled note");
      const content = typeof body.content === "string" ? body.content : "";
      const artifactId = await convexMutation("artifacts:create", {
        actorClerkId: actor.clerkId,
        type: "note",
        title,
        content,
        contentPlaintext: summarizeContent(content, 1200),
        workstreamId,
        editorMode: "standard",
        sourceType: "user_manual",
      });
      await convexMutation("workspaceCommandResults:create", {
        actorClerkId: actor.clerkId,
        workstreamId,
        intent: "note",
        status: "completed",
        title,
        summary: `Created note in workspace`,
        variant: "artifact",
        targetKind: "artifact",
        targetId: artifactId,
        metadata: { source: "workspace-command-bar" },
      });
      return ok({ artifactId });
    }

    if (action === "createArtifact") {
      const workstreamId = body.workstreamId as string | undefined;
      const type = body.type as string | undefined;
      if (!workstreamId || !type) return badRequest("workstreamId and type are required");
      const title = sanitizeTitle(body.title, `Untitled ${type}`);
      const content = body.content ?? "";
      const artifactId = await convexMutation("artifacts:create", {
        actorClerkId: actor.clerkId,
        type,
        title,
        content,
        contentPlaintext: summarizeContent(typeof content === "string" ? content : JSON.stringify(content)),
        workstreamId,
        editorMode: type === "code_project" || type === "code_output" ? "standard" : "ai_enhanced",
        sourceType: "user_manual",
      });
      await convexMutation("workspaceCommandResults:create", {
        actorClerkId: actor.clerkId,
        workstreamId,
        intent: "note",
        status: "completed",
        title,
        summary: `Created ${type.replace(/_/g, " ")}`,
        variant: "artifact",
        targetKind: "artifact",
        targetId: artifactId,
        metadata: { source: "workspace-command-bar", type },
      });
      return ok({ artifactId });
    }

    if (action === "createPlannerItem") {
      const workstreamId = body.workstreamId as string | undefined;
      if (!workstreamId) return badRequest("workstreamId is required");
      const title = sanitizeTitle(body.title, "New task");
      const plannerItem = await convexMutation<{ actorClerkId: string; title: string; description?: string; workstreamId?: string; type?: "deadline" | "milestone" | "goal" | "reminder"; priority?: "low" | "medium" | "high"; status?: "pending" | "in_progress" | "completed" | "cancelled"; dueAt?: number; sourceType?: "user_manual" | "ai_suggested" | "managebac_sync" }, { plannerItemId: string }>("plannerItems:create", {
        actorClerkId: actor.clerkId,
        workstreamId,
        title,
        description: summarizeContent(body.description, 320),
        type: (body.type as "deadline" | "milestone" | "goal" | "reminder" | undefined) ?? "deadline",
        priority: (body.priority as "low" | "medium" | "high" | undefined) ?? "medium",
        status: (body.status as "pending" | "in_progress" | "completed" | "cancelled" | undefined) ?? "pending",
        dueAt: typeof body.dueAt === "number" ? body.dueAt : undefined,
        sourceType: "user_manual",
      });
      await convexMutation("workspaceCommandResults:create", {
        actorClerkId: actor.clerkId,
        workstreamId,
        intent: "planner",
        status: "completed",
        title,
        summary: "Added planner item",
        variant: "planner",
        targetKind: "plannerItem",
        targetId: plannerItem.plannerItemId,
        metadata: { source: "workspace-command-bar" },
      });
      return ok(plannerItem);
    }

    if (action === "createThread") {
      const workstreamId = body.workstreamId as string | undefined;
      if (!workstreamId) return badRequest("workstreamId is required");
      const title = sanitizeTitle(body.title, "New thread");
      const result = await convexMutation<{ actorClerkId: string; workstreamId?: string; title?: string; threadType?: "conversation" | "artifact_edit"; mode: "general"; thinkingLevel: "low"; routerMode: "auto"; usePersonalResources: true }, { chatId: string }>("chats:createChat", {
        actorClerkId: actor.clerkId,
        workstreamId,
        title,
        threadType: "conversation",
        mode: "general",
        thinkingLevel: "low",
        routerMode: "auto",
        usePersonalResources: true,
      });
      await convexMutation("workspaceCommandResults:create", {
        actorClerkId: actor.clerkId,
        workstreamId,
        intent: "thread",
        status: "completed",
        title,
        summary: "Created thread",
        variant: "thread",
        targetKind: "chat",
        targetId: result.chatId,
        metadata: { source: "workspace-command-bar" },
      });
      return ok(result);
    }

    if (action === "createWorkspace") {
      const title = sanitizeTitle(body.title, "New workspace");
      const created = await convexMutation<{ actorClerkId: string; title: string; type: "subject" | "project" | "general"; description?: string; emoji?: string }, { workstreamId: string }>("workstreams:create", {
        actorClerkId: actor.clerkId,
        title,
        type: (body.type as "subject" | "project" | "general" | undefined) ?? "general",
        description: summarizeContent(body.description, 320),
        emoji: typeof body.emoji === "string" ? body.emoji : undefined,
      });
      const suggestion = await convexMutation<{ actorClerkId: string; title: string }, { title: string; suggestion: unknown }>("workspaceOrchestration:suggestTemplate", {
        actorClerkId: actor.clerkId,
        title,
      });
      return ok({ workstreamId: created.workstreamId, templateSuggestion: suggestion.suggestion });
    }

    if (action === "pinWorkspaceItem") {
      const itemId = body.itemId as string | undefined;
      const pinned = body.pinned as boolean | undefined;
      if (!itemId || typeof pinned !== "boolean") return badRequest("itemId and pinned are required");
      const result = await convexMutation("workspaceItems:setPinned", {
        actorClerkId: actor.clerkId,
        itemId,
        pinned,
      });
      return ok(result);
    }

    return badRequest(`Unknown action: ${action}`);
  }, request);
}
