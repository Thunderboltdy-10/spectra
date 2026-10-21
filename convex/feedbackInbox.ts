import { v } from "convex/values";
import { query } from "./functions";
import { mutation } from "./orgNodeMutation";
import { resolveActorContext } from "./identityShared";
import { writeAuditEvent } from "./auditShared";
import type { QueryCtx } from "./_generated/server";

/**
 * The platform's feedback inbox: everything people sent from the feedback
 * button, across every school, with the screenshot they sent it with.
 */
const status = v.union(
  v.literal("new"),
  v.literal("triaged"),
  v.literal("in_progress"),
  v.literal("resolved"),
  v.literal("closed"),
);

async function operator(ctx: QueryCtx) {
  const actor = await resolveActorContext(ctx);
  if (!actor.platformOperator)
    throw new Error("AUTH_OPERATOR_REQUIRED: Platform operator access is required.");
  return actor;
}

export const list = query({
  args: { open: v.boolean() },
  handler: async (ctx, args) => {
    await operator(ctx);
    const statuses = args.open
      ? (["new", "triaged", "in_progress"] as const)
      : (["resolved", "closed"] as const);
    const rows = (
      await Promise.all(
        statuses.map((which) =>
          ctx.db
            .query("feedbackReports")
            .withIndex("by_status_created", (q) => q.eq("status", which))
            .order("desc")
            .take(100),
        ),
      )
    )
      .flat()
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 150);
    return Promise.all(
      rows.map(async (row) => {
        const [reporter, school, screenshotUrl, attachments] = await Promise.all([
          ctx.db.get(row.reporterAccountId),
          row.schoolId ? ctx.db.get(row.schoolId) : null,
          row.screenshotStorageId ? ctx.storage.getUrl(row.screenshotStorageId) : null,
          Promise.all(
            (row.attachments ?? []).map(async (file) => ({
              name: file.name,
              mediaType: file.mediaType,
              bytes: file.bytes,
              url: await ctx.storage.getUrl(file.storageId),
            })),
          ),
        ]);
        return {
          feedbackId: row._id,
          reporter: reporter ? { name: reporter.name, email: reporter.email } : null,
          school: school?.name ?? null,
          category: row.category,
          subject: row.subject,
          message: row.message,
          pagePath: row.pagePath ?? null,
          screenshotUrl,
          attachments: attachments.filter((file): file is typeof file & { url: string } => file.url !== null),
          status: row.status,
          createdAt: row.createdAt,
        };
      }),
    );
  },
});

export const setStatus = mutation({
  args: { feedbackId: v.id("feedbackReports"), status },
  handler: async (ctx, args) => {
    const actor = await operator(ctx);
    const row = await ctx.db.get(args.feedbackId);
    if (!row) throw new Error("FEEDBACK_NOT_FOUND: This feedback no longer exists.");
    await ctx.db.patch(row._id, {
      status: args.status,
      responderScope: "platform",
      updatedAt: Date.now(),
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: row.schoolId,
      action: "feedback.status.changed",
      targetType: "feedback",
      targetId: row._id,
      metadata: { status: args.status },
    });
    return { feedbackId: row._id, status: args.status };
  },
});
