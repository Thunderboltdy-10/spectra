import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { safeStudyMode, type StudyMode } from "@/types";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const packId = request.nextUrl.searchParams.get("packId") ?? undefined;
    const limitRaw = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 300)) : 120;
    const chats = await convexQuery("chats:listChats", {
      actorClerkId: actor.clerkId,
      packId,
      limit,
    });
    return ok({ chats });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as {
      packId?: string;
      mode?: StudyMode;
      agentId?: string;
      thinkingLevel?: "low" | "medium" | "high";
      routerMode?: "auto" | "manual" | "openrouter_auto";
      manualModel?: string;
      usePersonalResources?: boolean;
      title?: string;
    };

    if (!body.mode || !body.thinkingLevel || !body.routerMode) {
      return badRequest("Missing required chat fields");
    }

    const validMode = safeStudyMode(body.mode, "POST /api/chats");

    const result = await convexMutation("chats:createChat", {
      actorClerkId: actor.clerkId,
      packId: body.packId,
      agentId: body.agentId,
      mode: validMode,
      thinkingLevel: body.thinkingLevel,
      routerMode: body.routerMode,
      manualModel: body.manualModel,
      usePersonalResources: body.usePersonalResources ?? true,
      title: body.title,
    });

    return ok(result);
  });
}
