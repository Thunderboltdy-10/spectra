import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { resolveActorContext } from "./identityShared";
import { writeAuditEvent } from "./auditShared";
import type { Id } from "./_generated/dataModel";
import type { IdentityCtx } from "./identityShared";
import type { MutationCtx } from "./_generated/server";

const category = v.union(
  v.literal("storage_bytes"),
  v.literal("bandwidth_bytes"),
  v.literal("model_input_tokens"),
  v.literal("model_output_tokens"),
  v.literal("render_milliseconds"),
  v.literal("collaboration_bytes"),
);
const limitCategory = v.union(
  v.literal("storage_bytes"),
  v.literal("bandwidth_bytes"),
  v.literal("model_tokens"),
  v.literal("render_milliseconds"),
  v.literal("collaboration_bytes"),
);
const safeDimensionValue = v.union(v.string(), v.number(), v.boolean());

function utcDay(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dimensionKey(dimensions?: Record<string, string | number | boolean>) {
  if (!dimensions) return "default";
  return (
    Object.entries(dimensions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${String(value)}`)
      .join("|")
      .slice(0, 400) || "default"
  );
}

export async function recordMeterEvent(
  ctx: MutationCtx,
  args: {
    schoolId?: Id<"schools">;
    accountId?: Id<"accounts">;
    category:
      | "storage_bytes"
      | "bandwidth_bytes"
      | "model_input_tokens"
      | "model_output_tokens"
      | "render_milliseconds"
      | "collaboration_bytes";
    quantity: number;
    sourceType: string;
    sourceId?: string;
    idempotencyKey: string;
    dimensions?: Record<string, string | number | boolean>;
    occurredAt: number;
  },
) {
  if (
    !Number.isFinite(args.quantity) ||
    (args.category !== "storage_bytes" && args.quantity < 0)
  )
    throw new Error(
      "METER_QUANTITY_INVALID: Usage must be finite and non-negative.",
    );
  const duplicate = await ctx.db
    .query("meterEvents")
    .withIndex("by_idempotency", (q) =>
      q.eq("idempotencyKey", args.idempotencyKey),
    )
    .unique();
  if (duplicate) return { eventId: duplicate._id, duplicate: true };
  const now = Date.now();
  const day = utcDay(args.occurredAt);
  const dimensionsKey = dimensionKey(args.dimensions);
  const eventId = await ctx.db.insert("meterEvents", {
    schoolId: args.schoolId,
    accountId: args.accountId,
    category: args.category,
    quantity: args.quantity,
    sourceType: args.sourceType.slice(0, 80),
    sourceId: args.sourceId?.slice(0, 180),
    idempotencyKey: args.idempotencyKey.slice(0, 240),
    dimensions: args.dimensions,
    occurredAt: args.occurredAt,
    createdAt: now,
  });
  const meter = await ctx.db
    .query("usageMeters")
    .withIndex("by_meter", (q) =>
      q
        .eq("schoolId", args.schoolId)
        .eq("accountId", args.accountId)
        .eq("category", args.category)
        .eq("day", day)
        .eq("dimensionsKey", dimensionsKey),
    )
    .unique();
  if (meter)
    await ctx.db.patch(meter._id, {
      quantity: meter.quantity + args.quantity,
      dimensions: args.dimensions,
      updatedAt: now,
    });
  else
    await ctx.db.insert("usageMeters", {
      schoolId: args.schoolId,
      accountId: args.accountId,
      category: args.category,
      day,
      dimensionsKey,
      quantity: args.quantity,
      dimensions: args.dimensions,
      updatedAt: now,
    });
  return { eventId, duplicate: false };
}

export const record = internalMutation({
  args: {
    schoolId: v.optional(v.id("schools")),
    accountId: v.optional(v.id("accounts")),
    category,
    quantity: v.number(),
    sourceType: v.string(),
    sourceId: v.optional(v.string()),
    idempotencyKey: v.string(),
    dimensions: v.optional(v.record(v.string(), safeDimensionValue)),
    occurredAt: v.number(),
  },
  handler: recordMeterEvent,
});

async function requireUsageViewer(ctx: IdentityCtx, schoolId: Id<"schools">) {
  const actor = await resolveActorContext(ctx);
  if (
    actor.membership?.schoolId !== schoolId ||
    actor.membership.role !== "school_admin"
  )
    throw new Error(
      "AUTH_USAGE_VIEW_REQUIRED: School administrator access is required.",
    );
  return actor;
}

export const schoolSummary = query({
  args: {
    schoolId: v.id("schools"),
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    fromDay: v.string(),
    toDay: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = args.operatorSessionId
      ? await resolveActorContext(ctx, args.operatorSessionId)
      : await requireUsageViewer(ctx, args.schoolId);
    if (
      args.operatorSessionId &&
      actor.operationalSchool?._id !== args.schoolId
    )
      throw new Error(
        "AUTH_SCHOOL_SCOPE_MISMATCH: The operational session targets another school.",
      );
    const meters = await ctx.db
      .query("usageMeters")
      .withIndex("by_school_day", (q) =>
        q
          .eq("schoolId", args.schoolId)
          .gte("day", args.fromDay)
          .lte("day", args.toDay),
      )
      .collect();
    const totals = new Map<string, number>();
    for (const meter of meters)
      totals.set(
        meter.category,
        (totals.get(meter.category) ?? 0) + meter.quantity,
      );
    return {
      schoolId: args.schoolId,
      fromDay: args.fromDay,
      toDay: args.toDay,
      totals: Object.fromEntries(totals),
      series: meters.map((meter) => ({
        day: meter.day,
        category: meter.category,
        quantity: meter.quantity,
        dimensions: meter.dimensions,
      })),
    };
  },
});

export const setLimitPolicy = mutation({
  args: {
    schoolId: v.optional(v.id("schools")),
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
    rules: v.array(
      v.object({
        category: limitCategory,
        period: v.union(
          v.literal("day"),
          v.literal("month"),
          v.literal("total"),
        ),
        warningAt: v.optional(v.number()),
        maximum: v.number(),
      }),
    ),
    enforcement: v.union(
      v.literal("disabled"),
      v.literal("simulate"),
      v.literal("enforced"),
    ),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await resolveActorContext(ctx, args.operatorSessionId);
    if (!actor.platformOperator)
      throw new Error(
        "AUTH_OPERATOR_REQUIRED: Platform operator access is required.",
      );
    if (args.schoolId) {
      if (
        !actor.operatorSession ||
        actor.operatorSession.schoolId !== args.schoolId ||
        actor.operatorSession.mode !== "manage"
      )
        throw new Error(
          "AUTH_OPERATOR_MANAGE_REQUIRED: Enter this school with manage access.",
        );
    } else if (args.operatorSessionId)
      throw new Error(
        "LIMIT_SCOPE_INVALID: Platform defaults do not use a school session.",
      );
    for (const rule of args.rules) {
      if (
        !Number.isFinite(rule.maximum) ||
        rule.maximum <= 0 ||
        (rule.warningAt !== undefined &&
          (rule.warningAt < 0 || rule.warningAt > rule.maximum))
      )
        throw new Error(
          "LIMIT_RULE_INVALID: Limits must be positive and warnings cannot exceed the maximum.",
        );
    }
    const scope = args.schoolId ? "school" : "platform_default";
    const existing = await ctx.db
      .query("limitPolicies")
      .withIndex("by_scope_school", (q) =>
        q.eq("scope", scope).eq("schoolId", args.schoolId),
      )
      .unique();
    const now = Date.now();
    let policyId;
    if (existing) {
      await ctx.db.patch(existing._id, {
        rules: args.rules,
        enforcement: args.enforcement,
        updatedByAccountId: actor.accountId,
        updatedAt: now,
      });
      policyId = existing._id;
    } else {
      policyId = await ctx.db.insert("limitPolicies", {
        schoolId: args.schoolId,
        scope,
        rules: args.rules,
        enforcement: args.enforcement,
        updatedByAccountId: actor.accountId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: args.schoolId,
      operatorSessionId: actor.operatorSession?._id,
      action: "limits.policy.changed",
      targetType: "limit_policy",
      targetId: policyId,
      metadata: {
        scope,
        enforcement: args.enforcement,
        ruleCount: args.rules.length,
      },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { policyId, scope, enforcement: args.enforcement, updatedAt: now };
  },
});

export const effectivePolicy = query({
  args: {
    schoolId: v.id("schools"),
    operatorSessionId: v.optional(v.id("operatorSchoolSessions")),
  },
  handler: async (ctx, args) => {
    const actor = args.operatorSessionId
      ? await resolveActorContext(ctx, args.operatorSessionId)
      : await requireUsageViewer(ctx, args.schoolId);
    if (
      args.operatorSessionId &&
      actor.operationalSchool?._id !== args.schoolId
    )
      throw new Error(
        "AUTH_SCHOOL_SCOPE_MISMATCH: The operational session targets another school.",
      );
    const school = await ctx.db
      .query("limitPolicies")
      .withIndex("by_scope_school", (q) =>
        q.eq("scope", "school").eq("schoolId", args.schoolId),
      )
      .unique();
    const fallback = await ctx.db
      .query("limitPolicies")
      .withIndex("by_scope_school", (q) =>
        q.eq("scope", "platform_default").eq("schoolId", undefined),
      )
      .unique();
    const policy = school ?? fallback;
    return policy
      ? {
          policyId: policy._id,
          source: school ? ("school" as const) : ("platform_default" as const),
          rules: policy.rules,
          enforcement: policy.enforcement,
          updatedAt: policy.updatedAt,
        }
      : {
          policyId: null,
          source: "built_in" as const,
          rules: [],
          enforcement: "disabled" as const,
          updatedAt: null,
        };
  },
});
