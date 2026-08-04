import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, maximum = 20_000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function finite(value: unknown) {
  const candidate = typeof value === "string" ? Number(value) : value;
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const from = finite(request.nextUrl.searchParams.get("from"));
    const to = finite(request.nextUrl.searchParams.get("to"));
    if (from === undefined || to === undefined || to <= from)
      return badRequest("Calendar requires a valid time range.");
    const data = await convexQuery("calendar:overview", { from, to });
    return ok({ data });
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const body = object(await request.json());
    const action = text(body.action, 100);
    if (action === "ensureMigration")
      return ok({ data: await convexMutation("calendar:ensureLegacyMigration", {}) });
    if (action === "createPersonalItem") {
      const kind = ["personal_event", "task", "milestone", "reminder"].includes(
        String(body.kind),
      )
        ? String(body.kind)
        : "personal_event";
      return ok({
        data: await convexMutation("calendar:createPersonalItem", {
          kind,
          title: text(body.title, 500),
          notes: text(body.notes) || undefined,
          startAt: finite(body.startAt),
          endAt: finite(body.endAt),
          allDay: body.allDay === true,
          timezone: text(body.timezone, 100) || "UTC",
          linkedArtifactIds: Array.isArray(body.linkedArtifactIds)
            ? body.linkedArtifactIds.filter(
                (item): item is string => typeof item === "string",
              )
            : undefined,
        }),
      });
    }
    if (action === "scheduleTask") {
      const startAt = finite(body.startAt);
      const endAt = finite(body.endAt);
      if (startAt === undefined || endAt === undefined)
        return badRequest("Scheduling requires an exact start and end time.");
      return ok({
        data: await convexMutation("calendar:scheduleTask", {
          taskItemId: text(body.taskItemId, 180) || undefined,
          planArtifactId: text(body.planArtifactId, 180) || undefined,
          planTaskId: text(body.planTaskId, 180) || undefined,
          startAt,
          endAt,
          timezone: text(body.timezone, 100) || "UTC",
          actorKind: body.actorKind === "ai" ? "ai" : "human",
        }),
      });
    }
    if (action === "moveWorkBlock") {
      const startAt = finite(body.startAt);
      const endAt = finite(body.endAt);
      const expectedRevision = finite(body.expectedRevision);
      if (
        startAt === undefined ||
        endAt === undefined ||
        expectedRevision === undefined
      )
        return badRequest("Moving a work block requires exact times and its current revision.");
      return ok({
        data: await convexMutation("calendar:moveWorkBlock", {
          itemId: text(body.itemId, 180),
          startAt,
          endAt,
          expectedRevision,
        }),
      });
    }
    if (action === "resizeWorkBlock") {
      const endAt = finite(body.endAt);
      const expectedRevision = finite(body.expectedRevision);
      if (endAt === undefined || expectedRevision === undefined)
        return badRequest("Resizing a work block requires an exact end time and its current revision.");
      return ok({
        data: await convexMutation("calendar:resizeWorkBlock", {
          itemId: text(body.itemId, 180),
          endAt,
          expectedRevision,
        }),
      });
    }
    if (action === "removePersonalItem")
      return ok({
        data: await convexMutation("calendar:removePersonalItem", {
          itemId: text(body.itemId, 180),
        }),
      });
    return badRequest("That Calendar action is unavailable.");
  }, request);
}
