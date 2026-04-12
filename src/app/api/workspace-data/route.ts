import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery, convexMutation } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

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

    if (action === "reopenResult") {
      const resultId = body.resultId as string;
      if (!resultId) return badRequest("resultId is required");
      const result = await convexMutation(
        "workspaceCommandResults:reopen",
        { actorClerkId: actor.clerkId, resultId },
      );
      return ok(result);
    }

    return badRequest(`Unknown action: ${action}`);
  }, request);
}
