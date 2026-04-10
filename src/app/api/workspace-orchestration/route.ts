import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

function parseLimit(input: string | null) {
  const parsed = Number.parseInt(input ?? "", 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(1, Math.min(parsed, 20));
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const params = request.nextUrl.searchParams;
    const action = params.get("action") ?? "suggestWorkspaceFromTopic";

    if (action === "suggestWorkspaceFromTopic") {
      const topic = params.get("topic");
      if (!topic) return badRequest("topic is required");

      const result = await convexQuery("workspaceOrchestration:suggestWorkspaceFromTopic", {
        actorClerkId: actor.clerkId,
        topic,
        limit: parseLimit(params.get("limit")),
      });
      return ok(result);
    }

    return badRequest(`Unknown action: ${action}`);
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "createWorkstream";

    if (action === "createWorkstream") {
      const title = typeof body.title === "string" ? body.title : undefined;
      if (!title) return badRequest("title is required");

      const result = await convexMutation("workspaceOrchestration:createWorkstream", {
        actorClerkId: actor.clerkId,
        title,
        description: typeof body.description === "string" ? body.description : undefined,
        emoji: typeof body.emoji === "string" ? body.emoji : undefined,
        color: typeof body.color === "string" ? body.color : undefined,
        type: typeof body.type === "string" ? body.type : undefined,
        provenanceSource:
          body.provenanceSource === "user" || body.provenanceSource === "ai" || body.provenanceSource === "system"
            ? body.provenanceSource
            : undefined,
        mutationSummary: typeof body.mutationSummary === "string" ? body.mutationSummary : undefined,
      });
      return ok(result);
    }

    if (action === "resolveCommand") {
      const query = typeof body.query === "string" ? body.query.trim() : "";
      const workstreamId = typeof body.workstreamId === "string" ? body.workstreamId : undefined;
      if (!query) return badRequest("query is required");

      const plannerMatch = query.match(/^(?:create|add|make)\s+(?:a\s+)?(?:planner|task|todo|reminder)\s*:?\s+(.+)$/i);
      const noteMatch = query.match(/^(?:create|add|make|write)\s+(?:a\s+)?note\s*:?\s+(.+)$/i);
      const codeMatch = query.match(/^(?:create|add|make|write)\s+(?:a\s+)?(?:code|snippet|script|function)\s*:?\s+(.+)$/i);
      const quizMatch = query.match(/^(?:create|add|make|generate)\s+(?:a\s+)?quiz\s*:?\s+(.+)$/i);
      const flashcardMatch = query.match(/^(?:create|add|make|generate)\s+(?:a\s+)?(?:flashcards?|flashcard\s+deck)\s*:?\s+(.+)$/i);

      if (plannerMatch?.[1]) {
        const title = plannerMatch[1].trim();
        const result = await convexMutation("plannerItems:create", {
          actorClerkId: actor.clerkId,
          workstreamId,
          title,
          status: "pending",
          priority: "medium",
          type: "goal",
          sourceType: "ai_suggested",
        }) as { plannerItemId: string };
        return ok({
          outcome: "planner",
          resolvedAction: "create_planner",
          plannerItemId: result.plannerItemId,
          title,
          openPanel: { type: "planner", id: result.plannerItemId },
        });
      }

      if (noteMatch?.[1] || codeMatch?.[1] || quizMatch?.[1] || flashcardMatch?.[1]) {
        const title = (noteMatch?.[1] ?? codeMatch?.[1] ?? quizMatch?.[1] ?? flashcardMatch?.[1] ?? query).trim();
        const type =
          noteMatch ? "note" :
          codeMatch ? "code_project" :
          quizMatch ? "quiz" :
          "flashcard_deck";
        const editorMode = type === "note" ? "standard" : type === "code_project" ? "code" : "ai_enhanced";
        const result = await convexMutation("artifacts:create", {
          actorClerkId: actor.clerkId,
          workstreamId,
          type,
          title,
          content: type === "note" ? { type: "doc", content: [{ type: "paragraph" }] } : "",
          contentPlaintext: "",
          editorMode,
          tags: [],
          sourceType: "ai_generated",
          sourceChatId: optionalString(body.sourceChatId),
        }) as { artifactId: string };
        return ok({
          outcome: "artifact",
          resolvedAction:
            type === "note"
              ? "create_note"
              : type === "code_project"
                ? "create_code_project"
                : type === "quiz"
                  ? "create_quiz"
                  : "create_flashcard_deck",
          artifactId: result.artifactId,
          artifactType: type,
          title,
          openPanel: { type: "artifact", id: result.artifactId },
        });
      }

      return ok({ outcome: "chat", resolvedAction: "fallback_chat" });
    }

    return badRequest(`Unknown action: ${action}`);
  }, request);
}
