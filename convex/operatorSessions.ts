import { mutation, query } from "./functions";
import { v } from "convex/values";
import { resolveActorContext } from "./identityShared";
import { writeAuditEvent } from "./auditShared";

function clean(value: string, maximum: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, maximum);
}

export const listSchools = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx);
    if (!actor.platformOperator) throw new Error("AUTH_OPERATOR_REQUIRED: Platform operator access is required.");
    const schools = args.includeInactive
      ? await ctx.db.query("schools").collect()
      : await ctx.db.query("schools").withIndex("by_status", (q) => q.eq("status", "active")).collect();
    return schools.map((school) => ({
      schoolId: school._id,
      name: school.name,
      slug: school.slug,
      status: school.status,
      timezone: school.timezone,
      policyVersion: school.policyVersion,
      updatedAt: school.updatedAt,
    }));
  },
});

export const start = mutation({
  args: {
    schoolId: v.id("schools"),
    label: v.string(),
    reason: v.string(),
    mode: v.union(v.literal("inspect"), v.literal("manage")),
    durationMinutes: v.optional(v.number()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx);
    if (!actor.platformOperator) throw new Error("AUTH_OPERATOR_REQUIRED: Platform operator access is required.");
    const school = await ctx.db.get(args.schoolId);
    if (!school || school.status !== "active") throw new Error("OPERATOR_SCHOOL_UNAVAILABLE: The school is unavailable.");
    const label = clean(args.label, 80);
    const reason = clean(args.reason, 500);
    if (label.length < 3 || reason.length < 12) throw new Error("OPERATOR_JUSTIFICATION_REQUIRED: Add a clear label and operational reason.");
    const duration = Math.max(5, Math.min(60, Math.round(args.durationMinutes ?? 30)));
    const now = Date.now();
    const previous = await ctx.db.query("operatorSchoolSessions").withIndex("by_operator", (q) => q.eq("operatorAccountId", actor.accountId)).collect();
    for (const session of previous) {
      if (!session.revokedAt && session.expiresAt > now) await ctx.db.patch(session._id, { revokedAt: now });
    }
    const sessionId = await ctx.db.insert("operatorSchoolSessions", {
      operatorAccountId: actor.accountId,
      schoolId: school._id,
      label,
      reason,
      mode: args.mode,
      createdAt: now,
      expiresAt: now + duration * 60_000,
      lastUsedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: school._id,
      operatorSessionId: sessionId,
      action: "operator.session.started",
      targetType: "school",
      targetId: school._id,
      metadata: { label, reason, mode: args.mode, durationMinutes: duration },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { sessionId, schoolId: school._id, expiresAt: now + duration * 60_000, mode: args.mode };
  },
});

export const current = query({
  args: { sessionId: v.id("operatorSchoolSessions") },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx, args.sessionId);
    return {
      sessionId: actor.operatorSession!._id,
      label: actor.operatorSession!.label,
      reason: actor.operatorSession!.reason,
      mode: actor.operatorSession!.mode,
      expiresAt: actor.operatorSession!.expiresAt,
      school: {
        schoolId: actor.operationalSchool!._id,
        name: actor.operationalSchool!.name,
        slug: actor.operationalSchool!.slug,
        timezone: actor.operationalSchool!.timezone,
      },
    };
  },
});

export const touch = mutation({
  args: { sessionId: v.id("operatorSchoolSessions") },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx, args.sessionId);
    const now = Date.now();
    await ctx.db.patch(actor.operatorSession!._id, { lastUsedAt: now });
    return { sessionId: actor.operatorSession!._id, lastUsedAt: now, expiresAt: actor.operatorSession!.expiresAt };
  },
});

export const end = mutation({
  args: { sessionId: v.id("operatorSchoolSessions"), requestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx, args.sessionId);
    const now = Date.now();
    await ctx.db.patch(actor.operatorSession!._id, { revokedAt: now });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.operationalSchool!._id,
      operatorSessionId: actor.operatorSession!._id,
      action: "operator.session.ended",
      targetType: "school",
      targetId: actor.operationalSchool!._id,
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { sessionId: actor.operatorSession!._id, endedAt: now };
  },
});
