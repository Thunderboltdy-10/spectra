import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { safeStudyMode, type StudyMode } from "@/types";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;

    const data = await convexQuery("chats:getChat", {
      actorClerkId: actor.clerkId,
      chatId: id,
    });

    return ok(data);
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const body = (await request.json()) as {
      mode?: StudyMode;
      thinkingLevel?: "low" | "medium" | "high";
      routerMode?: "auto" | "manual" | "openrouter_auto";
      manualModel?: string;
      agentId?: string | null;
      workstreamId?: string | null;
      usePersonalResources?: boolean;
      title?: string;
    };

    const validMode = body.mode ? safeStudyMode(body.mode, "PATCH /api/chats/[id]") : undefined;

    await convexMutation("chats:updateChatSettings", {
      actorClerkId: actor.clerkId,
      chatId: id,
      ...body,
      mode: validMode,
    });

    return ok({ ok: true });
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      keepLatestMessages?: number;
    };

    const result = await convexAction("chats:manualCompact", {
      actorClerkId: actor.clerkId,
      chatId: id,
      keepLatestMessages:
        typeof body.keepLatestMessages === "number" && Number.isFinite(body.keepLatestMessages)
          ? body.keepLatestMessages
          : undefined,
    });

    return ok(result);
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;

    await convexMutation("chats:deleteChat", {
      actorClerkId: actor.clerkId,
      chatId: id,
    });

    return ok({ ok: true });
  });
}
