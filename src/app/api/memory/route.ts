import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const entries = await convexQuery("memory:listMemoryEntries", {
      actorClerkId: actor.clerkId,
    });
    return ok({ entries });
  });
}

export async function PATCH(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as {
      action?: "confirm" | "dismiss" | "delete" | "forget_topic";
      entryId?: string;
      topic?: string;
    };

    if (!body.action) {
      return badRequest("action is required");
    }

    if (body.action === "forget_topic") {
      if (!body.topic || !body.topic.trim()) {
        return badRequest("topic is required for forget_topic");
      }
      const result = await convexMutation("memory:forgetAllByTopic", {
        actorClerkId: actor.clerkId,
        topic: body.topic.trim(),
      });
      return ok(result);
    }

    if (!body.entryId || !body.entryId.trim()) {
      return badRequest("entryId is required");
    }

    if (body.action === "confirm") {
      await convexMutation("memory:setMemoryEntryStatus", {
        actorClerkId: actor.clerkId,
        entryId: body.entryId,
        status: "confirmed",
      });
      return ok({ ok: true });
    }

    if (body.action === "dismiss" || body.action === "delete") {
      await convexMutation("memory:removeMemoryEntry", {
        actorClerkId: actor.clerkId,
        entryId: body.entryId,
      });
      return ok({ ok: true });
    }

    return badRequest("unsupported action");
  }, request);
}
