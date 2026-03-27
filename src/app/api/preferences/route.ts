import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const preferences = await convexQuery("userPreferences:get", {
      actorClerkId: actor.clerkId,
    });
    return ok({ preferences });
  }, request);
}

export async function PATCH(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as Record<string, unknown>;

    const result = await convexMutation("userPreferences:upsert", {
      actorClerkId: actor.clerkId,
      defaultLanding: body.defaultLanding as "smart" | "workspace" | "chat" | undefined,
      workspaceLayout: body.workspaceLayout as { x: number; y: number; z: number } | null | undefined,
      editorDefaultMode: body.editorDefaultMode as "agentic" | "notion" | "simple" | null | undefined,
    });

    return ok(result);
  }, request);
}

export async function DELETE(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const params = request.nextUrl.searchParams;
    const force = params.get("force");
    if (force !== "true") {
      return badRequest("Set ?force=true to delete user preferences");
    }

    const result = await convexMutation("userPreferences:remove", {
      actorClerkId: actor.clerkId,
    });

    return ok(result);
  }, request);
}
