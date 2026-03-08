import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const resources = await convexQuery("resources:listPersonalResources", {
      actorClerkId: actor.clerkId,
    });
    return ok({ resources });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as {
      action?: string;
      resourceIds?: string[];
    } | null;

    if (body?.action !== "retry_processing" || !Array.isArray(body.resourceIds) || body.resourceIds.length === 0) {
      return badRequest("action=retry_processing and resourceIds[] are required");
    }

    const results: Array<{
      resourceId: string;
      ok: boolean;
      skipped?: boolean;
      reason?: string;
      error?: string;
    }> = [];
    for (const resourceId of body.resourceIds) {
      try {
        const result = (await convexMutation("resources:enqueueResourceProcessing", {
          actorClerkId: actor.clerkId,
          resourceId,
        })) as { ok?: boolean; skipped?: boolean; reason?: string };
        if (result?.ok === false) {
          results.push({
            resourceId,
            ok: false,
            reason: result.reason,
            error: result.reason ?? "Retry failed",
          });
          continue;
        }
        results.push({
          resourceId,
          ok: true,
          skipped: result?.skipped,
          reason: result?.reason,
        });
      } catch (error) {
        results.push({
          resourceId,
          ok: false,
          error: error instanceof Error ? error.message : "Retry failed",
        });
      }
    }

    const failures = results.filter((result) => !result.ok);
    return ok({
      ok: failures.length === 0,
      retried: results.filter((result) => result.ok && !result.skipped).length,
      skipped: results.filter((result) => result.skipped).length,
      failures,
    });
  }, request);
}

export async function DELETE(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const resourceId = request.nextUrl.searchParams.get("resourceId");
    if (!resourceId) {
      return badRequest("resourceId required");
    }

    await convexMutation("resources:deleteResource", {
      actorClerkId: actor.clerkId,
      resourceId,
    });

    return ok({ ok: true });
  });
}
