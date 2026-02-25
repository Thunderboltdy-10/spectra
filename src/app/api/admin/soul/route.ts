import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

function soulActionErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "SOUL action failed.";
  if (message.includes("OPENROUTER_API_KEY missing")) {
    return badRequest(
      "School SOUL publish/preview requires OPENROUTER_API_KEY to generate embeddings.",
      503,
    );
  }
  if (message.toLowerCase().includes("embedding failed")) {
    return badRequest("School SOUL embedding request failed. Check OpenRouter connectivity and model access.", 503);
  }
  console.error("[api/admin/soul] SOUL action failed", error);
  return badRequest("Unexpected server error", 500);
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "teacher" && actor.role !== "admin") {
      return badRequest("Only teacher/admin", 403);
    }

    const previewQuery = request.nextUrl.searchParams.get("preview");
    if (previewQuery && previewQuery.trim()) {
      try {
        const guidance = await convexAction("soul:retrieveSoulGuidance", {
          actorClerkId: actor.clerkId,
          query: previewQuery,
          limit: 8,
        });
        return ok({ preview: guidance });
      } catch (error) {
        return soulActionErrorResponse(error);
      }
    }

    const docs = await convexQuery("soul:listSoulDocs", {
      actorClerkId: actor.clerkId,
    });
    return ok({ docs });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "teacher" && actor.role !== "admin") {
      return badRequest("Only teacher/admin", 403);
    }

    const body = (await request.json()) as {
      title?: string;
      section?: string;
      content?: string;
    };

    if (!body.title?.trim() || !body.section?.trim() || !body.content?.trim()) {
      return badRequest("title, section, content are required");
    }

    const result = await convexMutation("soul:upsertSoulDoc", {
      actorClerkId: actor.clerkId,
      title: body.title.trim(),
      section: body.section.trim(),
      content: body.content.trim(),
    });
    return ok(result);
  });
}

export async function PATCH() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "teacher" && actor.role !== "admin") {
      return badRequest("Only teacher/admin", 403);
    }

    try {
      const result = await convexAction("soul:publishSoul", {
        actorClerkId: actor.clerkId,
      });
      return ok(result);
    } catch (error) {
      return soulActionErrorResponse(error);
    }
  });
}
