import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { safeStudyMode, type StudyMode } from "@/types";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const search = request.nextUrl.searchParams.get("search")?.trim();
    const category = request.nextUrl.searchParams.get("category")?.trim() || undefined;

    if (search) {
      const agents = await convexQuery("agents:searchAgents", {
        actorClerkId: actor.clerkId,
        query: search,
      });
      return ok({ agents });
    }

    const agents = await convexQuery("agents:listAgents", {
      actorClerkId: actor.clerkId,
      category,
    });

    return ok({ agents });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      systemPrompt?: string;
      avatarEmoji?: string;
      avatarIcon?: string;
      category?: string;
      preferredModel?: string;
      preferredMode?: StudyMode;
      visibility?: "public" | "private";
    };

    if (!body.name || !body.description || !body.systemPrompt || !body.category) {
      return badRequest("name, description, systemPrompt and category are required");
    }

    const validMode = body.preferredMode ? safeStudyMode(body.preferredMode, "POST /api/agents") : undefined;

    const result = await convexMutation("agents:createAgent", {
      actorClerkId: actor.clerkId,
      name: body.name,
      description: body.description,
      systemPrompt: body.systemPrompt,
      avatarEmoji: body.avatarEmoji,
      avatarIcon: body.avatarIcon,
      category: body.category,
      preferredModel: body.preferredModel,
      preferredMode: validMode,
      visibility: body.visibility ?? "public",
    });

    return ok(result);
  });
}
