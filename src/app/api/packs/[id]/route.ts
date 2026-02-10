import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;

    const data = await convexQuery("packs:getPack", {
      actorClerkId: actor.clerkId,
      packId: id,
    });

    return ok(data);
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const body = (await request.json()) as {
      strictness?: "hard" | "medium" | "soft";
      allowedModels?: string[];
      defaultModel?: string;
    };

    await convexMutation("packs:updatePackSettings", {
      actorClerkId: actor.clerkId,
      packId: id,
      ...body,
    });

    return ok({ ok: true });
  });
}
