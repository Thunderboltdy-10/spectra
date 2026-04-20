import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery, convexMutation } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

type WorkspaceResultIntent = "note" | "planner" | "thread" | "result" | "widget";
type WorkspaceResultStatus = "processing" | "completed" | "dismissed";
type WorkspaceResultVariant = "summary" | "answer" | "artifact" | "planner" | "thread";
type WorkspaceResultTargetKind = "artifact" | "plannerItem" | "chat" | "workspaceItem" | "result";
type WorkspaceResultThreadStatus = "open" | "resolved" | "blocked";
type WorkspaceWidgetSource = "user" | "ai" | "system";
type WorkspaceViewMode = "spatial" | "type" | "topic" | "timeline";

function parseIntent(value: unknown): WorkspaceResultIntent {
  return value === "note" || value === "planner" || value === "thread" || value === "widget" ? value : "result";
}

function parseStatus(value: unknown, fallback: WorkspaceResultStatus): WorkspaceResultStatus {
  return value === "processing" || value === "completed" || value === "dismissed" ? value : fallback;
}

function parseVariant(value: unknown): WorkspaceResultVariant | undefined {
  return value === "summary" || value === "answer" || value === "artifact" || value === "planner" || value === "thread"
    ? value
    : undefined;
}

function parseTargetKind(value: unknown): WorkspaceResultTargetKind | undefined {
  return value === "artifact" || value === "plannerItem" || value === "chat" || value === "workspaceItem" || value === "result"
    ? value
    : undefined;
}

function parseThreadStatus(value: unknown): WorkspaceResultThreadStatus | undefined {
  return value === "open" || value === "resolved" || value === "blocked"
    ? value
    : undefined;
}

function sanitizeTitle(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function summarizeContent(value: unknown, max = 280) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function parseWidgetSource(value: unknown): WorkspaceWidgetSource {
  return value === "ai" || value === "system" ? value : "user";
}

function parseCanvasNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}



function parseQuickAction(value: unknown) {
  return value === "summarize" || value === "make_flashcards" || value === "plan_week" || value === "create_note" || value === "create_task" || value === "create_thread" || value === "artifact_request"
    ? value
    : undefined;
}
function parseWorkspaceViewMode(value: unknown): WorkspaceViewMode | undefined {
  return value === "spatial" || value === "type" || value === "topic" || value === "timeline"
    ? value
    : undefined;
}

function toPreferenceViewMode(value: WorkspaceViewMode | undefined) {
  if (value === "type") return "byType" as const;
  if (value === "topic") return "byTopic" as const;
  if (value === "timeline") return "timeline" as const;
  return null;
}

type AttachedItemsResult = {
  itemIds?: string[];
};

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
    const widgetLimit = Math.max(
      1,
      Math.min(Number(params.get("widgetLimit")) || 25, 100),
    );

    const data = await convexQuery("workspaceItems:getWorkspacePageData", {
      actorClerkId: actor.clerkId,
      workstreamId,
      includeDismissedResults,
      commandResultLimit,
      widgetLimit,
    });
    const preferences = await convexQuery("userPreferences:get", {
      actorClerkId: actor.clerkId,
    });
    return ok({
      ...(data as Record<string, unknown>),
      preferences,
    });
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
        intent: parseIntent(body.intent),
        status: parseStatus(body.status, "processing"),
        title: sanitizeTitle(body.title, "Command"),
        summary: body.summary as string || "Processing...",
        targetKind: parseTargetKind(body.targetKind),
        targetId: body.targetId as string,
        variant: parseVariant(body.variant),
        topicCluster: body.topicCluster as string | undefined,
        timelineAt: typeof body.timelineAt === "number" ? body.timelineAt : undefined,
        signalStrength: typeof body.signalStrength === "number" ? body.signalStrength : undefined,
        threadStatus: parseThreadStatus(body.threadStatus),
      });
      return ok(result);
    }

    if (action === "updateResult") {
      const resultId = body.resultId as string;
      if (!resultId) return badRequest("resultId is required");
      const result = await convexMutation("workspaceCommandResults:update", {
        actorClerkId: actor.clerkId,
        resultId,
        title: body.title as string | undefined,
        status: parseStatus(body.status, "completed"),
        summary: body.summary as string,
        detail: body.detail as string | undefined,
        targetKind: parseTargetKind(body.targetKind),
        targetId: body.targetId as string,
        variant: parseVariant(body.variant),
        metadata: body.metadata,
        topicCluster: body.topicCluster as string | undefined,
        timelineAt: typeof body.timelineAt === "number" ? body.timelineAt : undefined,
        signalStrength: typeof body.signalStrength === "number" ? body.signalStrength : undefined,
        threadStatus: parseThreadStatus(body.threadStatus),
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


    if (action === "executeQuickAction") {
      const workstreamId = body.workstreamId as string | undefined;
      if (!workstreamId) return badRequest("workstreamId is required");
      const result = await convexMutation("workspaceCommandResults:executeQuickAction", {
        actorClerkId: actor.clerkId,
        workstreamId,
        sourceChatId: body.sourceChatId as string | undefined,
        sourceMessageId: body.sourceMessageId as string | undefined,
        prompt: typeof body.prompt === "string" && body.prompt.trim().length > 0 ? body.prompt.trim() : "Quick action",
        action: parseQuickAction(body.quickAction),
        title: body.title as string | undefined,
        content: body.content as string | undefined,
        dueAt: typeof body.dueAt === "number" ? body.dueAt : undefined,
        cards: Array.isArray(body.cards) ? body.cards as Array<{ front: string; back: string }> : undefined,
        targetArtifactId: body.targetArtifactId as string | undefined,
        targetPlannerItemId: body.targetPlannerItemId as string | undefined,
        targetChatId: body.targetChatId as string | undefined,
        metadata: body.metadata,
      });
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
      const canvasX = parseCanvasNumber(body.canvasX);
      const canvasY = parseCanvasNumber(body.canvasY);
      if (canvasX !== undefined || canvasY !== undefined) {
        await convexMutation("workspaceItems:updateBySourceArtifact", {
          actorClerkId: actor.clerkId,
          sourceArtifactId: artifactId,
          provenanceSource: "user",
        });
      }
      const createdItemIds = await convexMutation("workspaceItems:attachItemsToWorkstream", {
        actorClerkId: actor.clerkId,
        workstreamId,
        items: [{
          title,
          itemType: "artifact",
          sourceArtifactId: artifactId,
          renderMode: "note",
          contentSummary: summarizeContent(content, 280),
          x: canvasX,
          y: canvasY,
          category: "documents",
        }],
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
      return ok({ artifactId, itemIds: (createdItemIds as AttachedItemsResult).itemIds });
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
      const canvasX = parseCanvasNumber(body.canvasX);
      const canvasY = parseCanvasNumber(body.canvasY);
      const createdItemIds = await convexMutation("workspaceItems:attachItemsToWorkstream", {
        actorClerkId: actor.clerkId,
        workstreamId,
        items: [{
          title,
          itemType: "artifact",
          sourceArtifactId: artifactId,
          renderMode: type,
          contentSummary: summarizeContent(typeof content === "string" ? content : JSON.stringify(content), 280),
          x: canvasX,
          y: canvasY,
        }],
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
      return ok({ artifactId, itemIds: (createdItemIds as AttachedItemsResult).itemIds });
    }

    if (action === "createPlannerItem") {
      const workstreamId = body.workstreamId as string | undefined;
      if (!workstreamId) return badRequest("workstreamId is required");
      const title = sanitizeTitle(body.title, "New task");
      const description = summarizeContent(body.description, 320);
      const plannerItem = await convexMutation<{ actorClerkId: string; title: string; description?: string; workstreamId?: string; type?: "deadline" | "milestone" | "goal" | "reminder"; priority?: "low" | "medium" | "high"; status?: "pending" | "in_progress" | "completed" | "cancelled"; dueAt?: number; sourceType?: "user_manual" | "ai_suggested" | "managebac_sync" }, { plannerItemId: string }>("plannerItems:create", {
        actorClerkId: actor.clerkId,
        workstreamId,
        title,
        description,
        type: (body.type as "deadline" | "milestone" | "goal" | "reminder" | undefined) ?? "deadline",
        priority: (body.priority as "low" | "medium" | "high" | undefined) ?? "medium",
        status: (body.status as "pending" | "in_progress" | "completed" | "cancelled" | undefined) ?? "pending",
        dueAt: typeof body.dueAt === "number" ? body.dueAt : undefined,
        sourceType: "user_manual",
      });
      const canvasX = parseCanvasNumber(body.canvasX);
      const canvasY = parseCanvasNumber(body.canvasY);
      if (canvasX !== undefined || canvasY !== undefined) {
        const itemRows = await convexQuery("workspaceItems:getWorkspacePageData", {
          actorClerkId: actor.clerkId,
          workstreamId,
          includeDismissedResults: false,
          commandResultLimit: 1,
          widgetLimit: 1,
        });
        const linkedItem = ((itemRows as { items?: Array<{ sourcePlannerItemId?: string; _id: string }> }).items ?? []).find((item) => item.sourcePlannerItemId === plannerItem.plannerItemId);
        if (linkedItem) {
          await convexMutation("workspaceItems:updateWidget", {
            actorClerkId: actor.clerkId,
            itemId: linkedItem._id,
            x: canvasX,
            y: canvasY,
            contentSummary: summarizeContent(description, 280),
            renderMode: (body.type as string | undefined) ?? "deadline",
            category: "planner",
          });
        }
      }
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
      const canvasX = parseCanvasNumber(body.canvasX);
      const canvasY = parseCanvasNumber(body.canvasY);
      if (canvasX !== undefined || canvasY !== undefined) {
        await convexMutation("workspaceItems:attachItemsToWorkstream", {
          actorClerkId: actor.clerkId,
          workstreamId,
          items: [{
            title,
            itemType: "thread",
            sourceChatId: result.chatId,
            renderMode: "thread",
            x: canvasX,
            y: canvasY,
            category: "threads",
          }],
        });
      }
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

    if (action === "updateWorkspace") {
      const workstreamId = body.workstreamId as string | undefined;
      if (!workstreamId) return badRequest("workstreamId is required");
      const result = await convexMutation("workstreams:update", {
        actorClerkId: actor.clerkId,
        workstreamId,
        title: typeof body.title === "string" ? body.title : undefined,
        emoji: typeof body.emoji === "string" ? body.emoji : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
      });
      return ok(result);
    }

    if (action === "seedDemoWorkspaces") {
      const result = await convexMutation("workspaceBlueprints:seedRichDemoWorkspaces", {
        actorClerkId: actor.clerkId,
        force: body.force === true,
      });
      return ok(result);
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

    if (action === "createWidget") {
      const kind = body.kind as string | undefined;
      if (!kind) return badRequest("kind is required");
      const result = await convexMutation("workspaceWidgets:create", {
        actorClerkId: actor.clerkId,
        workstreamId: body.workstreamId as string | undefined,
        kind,
        title: body.title as string | undefined,
        x: parseCanvasNumber(body.x) ?? 96,
        y: parseCanvasNumber(body.y) ?? 96,
        w: parseCanvasNumber(body.w) ?? 280,
        h: parseCanvasNumber(body.h) ?? 200,
        collapsed: typeof body.collapsed === "boolean" ? body.collapsed : undefined,
        hidden: typeof body.hidden === "boolean" ? body.hidden : undefined,
        state: body.state,
        source: parseWidgetSource(body.source),
      });
      return ok(result);
    }

    if (action === "updateWidget") {
      const widgetId = body.widgetId as string | undefined;
      if (!widgetId) return badRequest("widgetId is required");
      const result = await convexMutation("workspaceWidgets:update", {
        actorClerkId: actor.clerkId,
        widgetId,
        title: body.title as string | undefined,
        x: parseCanvasNumber(body.x),
        y: parseCanvasNumber(body.y),
        w: parseCanvasNumber(body.w),
        h: parseCanvasNumber(body.h),
        collapsed: typeof body.collapsed === "boolean" ? body.collapsed : undefined,
        hidden: typeof body.hidden === "boolean" ? body.hidden : undefined,
        state: body.state,
      });
      return ok(result);
    }

    if (action === "removeWidget") {
      const widgetId = body.widgetId as string | undefined;
      if (!widgetId) return badRequest("widgetId is required");
      const result = await convexMutation("workspaceWidgets:remove", {
        actorClerkId: actor.clerkId,
        widgetId,
      });
      return ok(result);
    }

    if (action === "persistViewMode") {
      const viewMode = parseWorkspaceViewMode(body.viewMode);
      if (!viewMode) return badRequest("viewMode is required");
      const result = await convexMutation("userPreferences:upsert", {
        actorClerkId: actor.clerkId,
        workspaceViewMode: toPreferenceViewMode(viewMode),
      });
      return ok(result);
    }

    return badRequest(`Unknown action: ${action}`);
  }, request);
}
