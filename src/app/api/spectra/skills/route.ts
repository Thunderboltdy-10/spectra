import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

function skillId(request: NextRequest, body?: unknown) {
  const fromQuery = request.nextUrl.searchParams.get("skillId")?.trim();
  if (fromQuery) return fromQuery.slice(0, 160);
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const candidate = (body as Record<string, unknown>).skillId;
    if (typeof candidate === "string" && candidate.trim())
      return candidate.trim().slice(0, 160);
  }
  return "";
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const id = skillId(request);
    if (!id)
      return ok({ data: await convexQuery("userSkills:listMetadata", {}) });
    const data = await convexQuery("userSkills:read", { skillId: id });
    if (!data) return badRequest("That skill is no longer available.", 404);
    return ok({ data });
  }, request);
}

export async function DELETE(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const id = skillId(request, await request.json().catch(() => null));
    if (!id) return badRequest("Choose a skill to delete.");
    return ok({
      data: await convexMutation("userSkills:remove", { skillId: id }),
    });
  }, request);
}
