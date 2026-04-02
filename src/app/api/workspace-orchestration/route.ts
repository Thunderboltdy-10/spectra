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

    return badRequest(`Unknown action: ${action}`);
  }, request);
}
