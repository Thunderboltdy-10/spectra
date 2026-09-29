import { query } from "./functions";
import { v } from "convex/values";
import { resolveActorContext } from "./identityShared";

export const listForSchool = query({
  args: {
    schoolId: v.id("schools"),
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    action: v.optional(v.string()),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx, args.operatorSessionId);
    const localAdmin = actor.membership?.schoolId === args.schoolId && actor.membership.role === "school_admin";
    const operator = actor.operatorSession?.schoolId === args.schoolId;
    if (!localAdmin && !operator) throw new Error("AUTH_AUDIT_VIEW_REQUIRED: Administrative access is required.");
    const limit = Math.max(1, Math.min(args.limit ?? 100, 250));
    const rows = await ctx.db.query("auditEvents").withIndex("by_school_created", (q) => q.eq("schoolId", args.schoolId)).order("desc").take(limit * 3);
    return rows.filter((event) => !args.action || event.action === args.action).filter((event) => !args.since || event.createdAt >= args.since).slice(0, limit).map((event) => ({ eventId: event._id, actorAccountId: event.actorAccountId, operatorSessionId: event.operatorSessionId, action: event.action, targetType: event.targetType, targetId: event.targetId, metadata: event.metadata, requestId: event.requestId, retentionClass: event.retentionClass, createdAt: event.createdAt }));
  },
});
