import { NextRequest } from "next/server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { requireActor } from "@/lib/auth-server";

const VALID_ROLES = new Set(["student", "teacher", "admin"]);

function normalizeRole(value: unknown) {
  if (typeof value !== "string") return undefined;
  return VALID_ROLES.has(value) ? (value as "student" | "teacher" | "admin") : undefined;
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const search = request.nextUrl.searchParams.get("search")?.trim() || undefined;
    const role = normalizeRole(request.nextUrl.searchParams.get("role"));
    const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "12");
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.round(rawLimit))) : 12;

    const result = await convexQuery("notifications:searchOrgRecipients", {
      actorClerkId: actor.clerkId,
      search,
      role,
      limit,
    }) as {
      recipients: Array<{
        _id: string;
        name: string;
        email: string;
        role: "student" | "teacher" | "admin";
      }>;
    };

    return ok(result);
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as {
      title?: string;
      body?: string;
      actionUrl?: string;
      recipientEmails?: string[];
      role?: string;
    } | null;

    const title = body?.title?.trim();
    const message = body?.body?.trim();
    if (!title || !message) {
      return badRequest("title and body are required");
    }

    const role = normalizeRole(body?.role);
    const recipientEmails = Array.isArray(body?.recipientEmails)
      ? body?.recipientEmails.filter((email): email is string => typeof email === "string" && email.trim().length > 0)
      : undefined;

    const result = await convexMutation("notifications:sendOrgAnnouncement", {
      actorClerkId: actor.clerkId,
      title,
      body: message,
      actionUrl: body?.actionUrl?.trim() || undefined,
      recipientEmails: recipientEmails && recipientEmails.length > 0 ? recipientEmails : undefined,
      role,
    }) as { sentCount: number };

    return ok(result);
  }, request);
}
