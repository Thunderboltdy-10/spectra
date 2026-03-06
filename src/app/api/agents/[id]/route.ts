import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { safeStudyMode, type StudyMode } from "@/types";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;

    const agent = await convexQuery("agents:getAgent", {
      actorClerkId: actor.clerkId,
      agentId: id,
    });

    return ok({ agent });
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      systemPrompt?: string;
      avatarEmoji?: string;
      avatarIcon?: string;
      category?: string;
      preferredModel?: string;
      preferredMode?: StudyMode;
      visibility?: "public" | "private" | "shared";
    };

    const validMode = body.preferredMode ? safeStudyMode(body.preferredMode, "PATCH /api/agents/[id]") : undefined;

    await convexMutation("agents:updateAgent", {
      actorClerkId: actor.clerkId,
      agentId: id,
      ...body,
      preferredMode: validMode,
    });

    return ok({ ok: true });
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;

    await convexMutation("agents:deleteAgent", {
      actorClerkId: actor.clerkId,
      agentId: id,
    });

    return ok({ ok: true });
  });
}
