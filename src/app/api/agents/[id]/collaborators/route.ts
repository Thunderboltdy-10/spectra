import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const search = request.nextUrl.searchParams.get("search")?.trim() || undefined;

    const result = await convexQuery("agents:listCollaborators", {
      actorClerkId: actor.clerkId,
      agentId: id,
      search,
    });

    return ok(result);
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const body = (await request.json()) as { userId?: string };

    if (!body.userId) {
      return badRequest("userId is required");
    }

    const result = await convexMutation("agents:inviteCollaborator", {
      actorClerkId: actor.clerkId,
      agentId: id,
      userId: body.userId,
    });

    return ok(result);
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const body = (await request.json()) as { userId?: string };

    if (!body.userId) {
      return badRequest("userId is required");
    }

    const result = await convexMutation("agents:removeCollaborator", {
      actorClerkId: actor.clerkId,
      agentId: id,
      userId: body.userId,
    });

    return ok(result);
  });
}
