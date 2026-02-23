import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

const VALID_STATUS = new Set(["new", "in_progress", "shipped"]);
const VALID_CATEGORY = new Set(["bug", "confusing", "feature", "safety"]);

function normalizeSingleFilter(value: string | null, valid: Set<string>) {
  if (!value) return undefined;
  const clean = value.trim();
  if (!clean || clean.includes(",")) return undefined;
  return valid.has(clean) ? clean : undefined;
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();
    const params = request.nextUrl.searchParams;
    const status = normalizeSingleFilter(params.get("status"), VALID_STATUS) as
      | "new"
      | "in_progress"
      | "shipped"
      | undefined;
    const category = normalizeSingleFilter(params.get("category"), VALID_CATEGORY) as
      | "bug"
      | "confusing"
      | "feature"
      | "safety"
      | undefined;
    const rawLimit = Number(params.get("limit") || 100);
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.floor(rawLimit))) : 100;

    const result = await convexQuery<
      {
        actorClerkId: string;
        status?: "new" | "in_progress" | "shipped";
        category?: "bug" | "confusing" | "feature" | "safety";
        limit: number;
      },
      {
        feedback: unknown[];
        nextCursor?: string;
        totalCount: number;
      }
    >("feedback:listFeedback", {
      actorClerkId: actor.clerkId,
      status,
      category,
      limit,
    });

    return ok(result);
  }, request);
}

export async function PATCH(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();
    const body = (await request.json().catch(() => null)) as {
      feedbackId?: string;
      status?: string;
    } | null;

    if (!body?.feedbackId) return badRequest("feedbackId is required");
    if (!body.status || !VALID_STATUS.has(body.status)) return badRequest("Valid status is required");

    const result = await convexMutation<
      {
        actorClerkId: string;
        feedbackId: string;
        status: "new" | "in_progress" | "shipped";
      },
      { ok: boolean }
    >("feedback:updateFeedbackStatus", {
      actorClerkId: actor.clerkId,
      feedbackId: body.feedbackId,
      status: body.status as "new" | "in_progress" | "shipped",
    });

    return ok(result);
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();
    const body = (await request.json().catch(() => null)) as {
      feedbackId?: string;
      adminReply?: string;
    } | null;

    if (!body?.feedbackId) return badRequest("feedbackId is required");
    if (!body.adminReply?.trim()) return badRequest("adminReply is required");

    const result = await convexMutation<
      {
        actorClerkId: string;
        feedbackId: string;
        adminReply: string;
      },
      { ok: boolean }
    >("feedback:replyToFeedback", {
      actorClerkId: actor.clerkId,
      feedbackId: body.feedbackId,
      adminReply: body.adminReply.trim(),
    });

    return ok(result);
  }, request);
}
