import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();

    const stats = await convexQuery("superAdmin:getStorageStats", {
      actorClerkId: actor.clerkId,
    });

    return ok(stats);
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      confirmation?: string;
    };

    if (body.action !== "resetPlatformData") {
      return badRequest("Unknown action.");
    }

    const confirmation = body.confirmation?.trim() ?? "";
    if (!confirmation) {
      return badRequest("confirmation is required");
    }

    const result = await convexMutation("superAdmin:resetPlatformData", {
      actorClerkId: actor.clerkId,
      confirmation,
    });

    return ok(result);
  }, request);
}
