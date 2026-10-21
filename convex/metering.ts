import { internalMutation, mutation, query } from "./functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
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
  if (
    args.schoolId &&
    (args.category === "model_input_tokens" ||
      args.category === "model_output_tokens")
  )
    await addSchoolModelTokens(ctx, args.schoolId, args.quantity, args.occurredAt, now);
  if (args.schoolId && args.category === "storage_bytes")
    await addSchoolStorageBytes(ctx, args.schoolId, args.quantity, now);
  return { eventId, duplicate: false };
}

/**
 * Model work of any kind (a run, Agent Foundry, an agent evaluation) meters
 * its input and output tokens through here, so the school rollups the
 * ceiling reads see all of it. Each category is idempotent on
 * `${idempotencyPrefix}:${category}`.
 */
export async function recordModelTokenUsage(
  ctx: MutationCtx,
  args: {
    schoolId?: Id<"schools">;
    accountId?: Id<"accounts">;
    inputTokens: number;
    outputTokens: number;
    sourceType: string;
    sourceId?: string;
    idempotencyPrefix: string;
    dimensions?: Record<string, string | number | boolean>;
    occurredAt: number;
  },
) {
  for (const [category, quantity] of [
    ["model_input_tokens", args.inputTokens],
    ["model_output_tokens", args.outputTokens],
  ] as const) {
    const tokens = Number.isFinite(quantity) ? Math.max(0, Math.round(quantity)) : 0;
    if (tokens <= 0) continue;
    await recordMeterEvent(ctx, {
      schoolId: args.schoolId,
      accountId: args.accountId,
      category,
      quantity: tokens,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      idempotencyKey: `${args.idempotencyPrefix}:${category}`,
      dimensions: args.dimensions,
      occurredAt: args.occurredAt,
    });
  }
}

type LimitPeriod = "day" | "month" | "total";

function periodKey(period: LimitPeriod, timestamp: number) {
  const day = utcDay(timestamp);
  return period === "day" ? `day:${day}` : period === "month" ? `month:${day.slice(0, 7)}` : "total";
}

async function addSchoolModelTokens(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  quantity: number,
  occurredAt: number,
  now: number,
) {
  for (const period of ["day", "month", "total"] as const) {
    const key = periodKey(period, occurredAt);
    const row = await ctx.db
      .query("schoolUsageTotals")
      .withIndex("by_school_period", (q) =>
        q.eq("schoolId", schoolId).eq("category", "model_tokens").eq("periodKey", key),
      )
      .unique();
    if (row) await ctx.db.patch(row._id, { quantity: row.quantity + quantity, updatedAt: now });
    else
      await ctx.db.insert("schoolUsageTotals", {
        schoolId,
        category: "model_tokens",
        periodKey: key,
        quantity,
        updatedAt: now,
      });
  }
}

/** Storage is a running balance, not a period: one "total" row per school. */
async function schoolStorageRow(ctx: IdentityCtx, schoolId: Id<"schools">) {
  return ctx.db
    .query("schoolUsageTotals")
    .withIndex("by_school_period", (q) =>
      q.eq("schoolId", schoolId).eq("category", "storage_bytes").eq("periodKey", "total"),
    )
    .unique();
}

async function addSchoolStorageBytes(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  quantity: number,
  now: number,
) {
  const row = await schoolStorageRow(ctx, schoolId);
  if (row) await ctx.db.patch(row._id, { quantity: Math.max(0, row.quantity + quantity), updatedAt: now });
  else
    await ctx.db.insert("schoolUsageTotals", {
      schoolId,
      category: "storage_bytes",
      periodKey: "total",
      quantity: Math.max(0, quantity),
      updatedAt: now,
    });
}

/**
 * Upload admission against an enforced storage rule. A storage rule caps
 * what the school keeps, whatever period it names.
 */
export async function assertSchoolStorageCeiling(
  ctx: MutationCtx,
  schoolId: Id<"schools"> | undefined,
  incomingBytes: number,
) {
  if (!schoolId) return;
  const { policy } = await effectiveLimitPolicy(ctx, schoolId);
  if (!policy || policy.enforcement !== "enforced") return;
  const rules = policy.rules.filter((rule) => rule.category === "storage_bytes");
  if (!rules.length) return;
  const used = (await schoolStorageRow(ctx, schoolId))?.quantity ?? 0;
  if (rules.some((rule) => used + Math.max(0, incomingBytes) > rule.maximum))
    throw new Error(
      "STORAGE_LIMIT_REACHED: Your school has used all of its Spectra storage. Remove files you no longer need, or ask a school administrator about the limit.",
    );
}

/** Rebuilds each school's storage balance from its storage meters. */
export const backfillStorageTotals = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("schools").paginate({ cursor: args.cursor ?? null, numItems: 5 });
    const now = Date.now();
    for (const school of page.page) {
      let total = 0;
      for await (const meter of ctx.db
        .query("usageMeters")
        .withIndex("by_school_category_day", (q) => q.eq("schoolId", school._id).eq("category", "storage_bytes")))
        total += meter.quantity;
      const row = await schoolStorageRow(ctx, school._id);
      if (row) await ctx.db.patch(row._id, { quantity: Math.max(0, total), updatedAt: now });
      else if (total > 0)
        await ctx.db.insert("schoolUsageTotals", { schoolId: school._id, category: "storage_bytes", periodKey: "total", quantity: total, updatedAt: now });
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.metering.backfillStorageTotals, { cursor: page.continueCursor });
    return { done: page.isDone };
  },
});

async function effectiveLimitPolicy(ctx: IdentityCtx, schoolId: Id<"schools">) {
  const school = await ctx.db
    .query("limitPolicies")
    .withIndex("by_scope_school", (q) => q.eq("scope", "school").eq("schoolId", schoolId))
    .unique();
  if (school) return { policy: school, source: "school" as const };
  const fallback = await ctx.db
    .query("limitPolicies")
    .withIndex("by_scope_school", (q) => q.eq("scope", "platform_default").eq("schoolId", undefined))
    .unique();
  return { policy: fallback, source: "platform_default" as const };
}

const CEILING_MESSAGES: Record<LimitPeriod, string> = {
  day: "Your school has reached its AI usage limit for today. Try again tomorrow, or ask a school administrator about the limit.",
  month: "Your school has reached its AI usage limit for this month. Ask a school administrator about the limit.",
  total: "Your school has reached its AI usage limit. Ask a school administrator about the limit.",
};

/**
 * AI admission against the school's effective limit policy. Only an
 * "enforced" policy blocks, only its model_tokens rules apply here, and a
 * rule blocks once usage reaches its maximum, the same test the operator
 * simulation shows as "would block". Periods are UTC, as meters are.
 */
export async function assertSchoolModelTokenCeiling(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  now: number,
) {
  const { policy } = await effectiveLimitPolicy(ctx, schoolId);
  if (!policy || policy.enforcement !== "enforced") return;
  for (const rule of policy.rules) {
    if (rule.category !== "model_tokens") continue;
    const key = periodKey(rule.period, now);
    const usage = await ctx.db
      .query("schoolUsageTotals")
      .withIndex("by_school_period", (q) =>
        q.eq("schoolId", schoolId).eq("category", "model_tokens").eq("periodKey", key),
      )
      .unique();
    if ((usage?.quantity ?? 0) >= rule.maximum)
      throw new Error(CEILING_MESSAGES[rule.period]);
  }
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

// ------------------------------------------------ school usage totals backfill

const USAGE_TOTALS_BACKFILL_KEY = "school-usage-totals";
const USAGE_TOTALS_BACKFILL_VERSION = 1;
const USAGE_TOTALS_METER_PAGE = 50;
const TOKEN_METER_CATEGORIES = ["model_input_tokens", "model_output_tokens"] as const;

type UsageTotalsBackfillCursor = {
  /** Cursor over schools; null before the first school. */
  schools: string | null;
  schoolId?: Id<"schools">;
  /** 0 and 1 walk the token meter categories; 2 rolls days up. */
  step?: number;
  meters?: string | null;
};

async function setSchoolUsageTotal(ctx: MutationCtx, schoolId: Id<"schools">, periodKey: string, quantity: number, now: number) {
  const row = await ctx.db
    .query("schoolUsageTotals")
    .withIndex("by_school_period", (q) => q.eq("schoolId", schoolId).eq("category", "model_tokens").eq("periodKey", periodKey))
    .unique();
  if (row) {
    if (row.quantity !== quantity) await ctx.db.patch(row._id, { quantity, updatedAt: now });
    return row.quantity !== quantity;
  }
  if (quantity === 0) return false;
  await ctx.db.insert("schoolUsageTotals", { schoolId, category: "model_tokens", periodKey, quantity, updatedAt: now });
  return true;
}

/** A day's total is exactly the school's token meters for that day. Reading
 * the meters and writing the total in one transaction keeps it exact while
 * new usage keeps arriving: a concurrent meter write conflicts and retries. */
async function rebuildSchoolUsageDay(ctx: MutationCtx, schoolId: Id<"schools">, day: string, now: number) {
  let quantity = 0;
  for (const tokenCategory of TOKEN_METER_CATEGORIES)
    for (const meter of await ctx.db
      .query("usageMeters")
      .withIndex("by_school_category_day", (q) => q.eq("schoolId", schoolId).eq("category", tokenCategory).eq("day", day))
      .collect())
      quantity += meter.quantity;
  return setSchoolUsageTotal(ctx, schoolId, `day:${day}`, quantity, now);
}

/**
 * One-off operator repair for per-school model-token totals that predate the
 * rollup (convex/metering.ts addSchoolModelTokens): usage metered before it
 * shipped is missing from the day, month and total rows the ceiling reads.
 *
 * It rebuilds rather than adds, so it never double counts and may be re-run:
 * each day row is set from `usageMeters` (which keeps the full history), then
 * month and total rows are set from the day rows. Work is one bounded page
 * per mutation, chained through the scheduler, with progress in
 * `spectraReadModelMigrations` under the key "school-usage-totals".
 *
 * Operator step (once, after deploying this version):
 *   npx convex run metering:backfillSchoolUsageTotals '{}'
 * Re-run after completion with '{"restart":true}'. Progress:
 *   the spectraReadModelMigrations row with key "school-usage-totals".
 */
export const backfillSchoolUsageTotals = internalMutation({
  args: { restart: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const migration = await ctx.db
      .query("spectraReadModelMigrations")
      .withIndex("by_key", (q) => q.eq("key", USAGE_TOTALS_BACKFILL_KEY))
      .unique();
    if (migration?.state === "complete" && !args.restart) return { state: "complete" as const, scanned: migration.scanned, repaired: migration.repaired };
    const fresh = !migration || (migration.state === "complete" && args.restart === true);
    const cursor: UsageTotalsBackfillCursor = !fresh && migration?.cursor
      ? (JSON.parse(migration.cursor) as UsageTotalsBackfillCursor)
      : { schools: null };
    let scanned = 0;
    let repaired = 0;
    let complete = false;

    if (!cursor.schoolId) {
      const schools = await ctx.db.query("schools").paginate({ cursor: cursor.schools, numItems: 1 });
      const school = schools.page[0];
      if (school) Object.assign(cursor, { schoolId: school._id, step: 0, meters: null });
      cursor.schools = schools.continueCursor;
      complete = !school && schools.isDone;
    } else if ((cursor.step ?? 0) < TOKEN_METER_CATEGORIES.length) {
      const schoolId = cursor.schoolId;
      const tokenCategory = TOKEN_METER_CATEGORIES[cursor.step ?? 0];
      const meters = await ctx.db
        .query("usageMeters")
        .withIndex("by_school_category_day", (q) => q.eq("schoolId", schoolId).eq("category", tokenCategory))
        .paginate({ cursor: cursor.meters ?? null, numItems: USAGE_TOTALS_METER_PAGE });
      scanned += meters.page.length;
      for (const day of new Set(meters.page.map((meter) => meter.day)))
        if (await rebuildSchoolUsageDay(ctx, schoolId, day, now)) repaired += 1;
      Object.assign(cursor, meters.isDone
        ? { step: (cursor.step ?? 0) + 1, meters: null }
        : { meters: meters.continueCursor });
    } else {
      // A school has one day row per day it used AI: bounded by its age.
      const schoolId = cursor.schoolId;
      const days = await ctx.db
        .query("schoolUsageTotals")
        .withIndex("by_school_period", (q) => q.eq("schoolId", schoolId).eq("category", "model_tokens").gte("periodKey", "day:").lt("periodKey", "day;"))
        .collect();
      scanned += days.length;
      const months = new Map<string, number>();
      let total = 0;
      for (const day of days) {
        const month = `month:${day.periodKey.slice(4, 11)}`;
        months.set(month, (months.get(month) ?? 0) + day.quantity);
        total += day.quantity;
      }
      for (const [month, quantity] of months)
        if (await setSchoolUsageTotal(ctx, schoolId, month, quantity, now)) repaired += 1;
      if (await setSchoolUsageTotal(ctx, schoolId, "total", total, now)) repaired += 1;
      Object.assign(cursor, { schoolId: undefined, step: undefined, meters: undefined });
    }

    const progress = {
      version: USAGE_TOTALS_BACKFILL_VERSION,
      state: complete ? ("complete" as const) : ("running" as const),
      cursor: complete ? undefined : JSON.stringify(cursor),
      scanned: (fresh ? 0 : (migration?.scanned ?? 0)) + scanned,
      repaired: (fresh ? 0 : (migration?.repaired ?? 0)) + repaired,
      updatedAt: now,
    };
    if (migration) await ctx.db.patch(migration._id, progress);
    else await ctx.db.insert("spectraReadModelMigrations", { key: USAGE_TOTALS_BACKFILL_KEY, createdAt: now, ...progress });
    if (!complete) await ctx.scheduler.runAfter(0, internal.metering.backfillSchoolUsageTotals, {});
    return { state: progress.state, scanned: progress.scanned, repaired: progress.repaired };
  },
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
    const { policy, source } = await effectiveLimitPolicy(ctx, args.schoolId);
    return policy
      ? {
          policyId: policy._id,
          source,
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
