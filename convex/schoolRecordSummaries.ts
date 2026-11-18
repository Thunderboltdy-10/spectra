import { internal } from "./_generated/api";
import { convexToJson, type Value } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import type { SchoolSyncKind } from "../shared/school-sync";

// v2 leaves removed records out: every list skips them, and they piled up as tasks expired.
const MIGRATION_KEY = "school-record-summaries-v2";
const CLASS_FIELDS = ["title", "name", "subject", "yearGroupId", "archived"];
const TASK_FIELDS = ["title", "name", "className", "dueAt", "deadlineAt", "due_at", "due_date",
  "status", "taskType", "type", "term", "termName"];

function project(row: Doc<"externalRecords"> | null) {
  if (!row?.mappedAccountId || row.tombstone || (row.syncKind !== "classes" &&
    row.syncKind !== "current_tasks" && row.syncKind !== "past_tasks")) return null;
  const fields = row.syncKind === "classes" ? CLASS_FIELDS : TASK_FIELDS;
  const normalized: Record<string, Value> = {};
  if (row.normalized && typeof row.normalized === "object" && !Array.isArray(row.normalized)) {
    for (const field of fields) {
      const value = row.normalized[field];
      if (value !== undefined) normalized[field] = value;
    }
  }
  return {
    recordId: row._id,
    recordCreatedAt: row._creationTime,
    mappedAccountId: row.mappedAccountId,
    integrationId: row.integrationId,
    schoolId: row.schoolId,
    syncKind: row.syncKind,
    recordType: row.recordType,
    providerClassId: row.providerClassId,
    academicPeriodKey: row.academicPeriodKey,
    providerRecordId: row.providerRecordId,
    audienceScope: row.audienceScope,
    sourceState: row.sourceState,
    tombstone: row.tombstone,
    provenanceUrl: row.syncKind === "classes" ? undefined : row.provenanceUrl,
    normalized,
  };
}

export async function syncSchoolRecordSummary(
  ctx: Pick<MutationCtx, "db">,
  recordId: Id<"externalRecords">,
  before: Doc<"externalRecords"> | null,
  after: Doc<"externalRecords"> | null,
  /** The backfill compares with what's stored, not with an earlier version of the record. */
  force = false,
) {
  const previous = project(before);
  const next = project(after);
  if (!force && JSON.stringify(convexToJson(previous)) === JSON.stringify(convexToJson(next))) return;
  const existing = await ctx.db.query("schoolRecordSummaries")
    .withIndex("by_record", (q) => q.eq("recordId", recordId)).unique();
  if (next) {
    if (existing) {
      const { _id, _creationTime: _, ...current } = existing;
      if (JSON.stringify(convexToJson(current)) !== JSON.stringify(convexToJson(next)))
        await ctx.db.replace(_id, next);
    }
    else await ctx.db.insert("schoolRecordSummaries", next);
  } else if (existing) await ctx.db.delete(existing._id);
}

function migrationState(ctx: Pick<QueryCtx, "db">) {
  return ctx.db.query("spectraReadModelMigrations")
    .withIndex("by_key", (q) => q.eq("key", MIGRATION_KEY)).unique();
}

export async function createSchoolRecordListReader(ctx: QueryCtx) {
  const compact = (await migrationState(ctx))?.state === "complete";
  return async (accountId: Id<"accounts">, kind: SchoolSyncKind, limit: number, classId?: string) => {
    if (compact && (kind === "classes" || kind === "current_tasks" || kind === "past_tasks")) {
      const rows = await ctx.db.query("schoolRecordSummaries")
        .withIndex("by_account_kind_class_created", (q) => {
          const scoped = q.eq("mappedAccountId", accountId).eq("syncKind", kind);
          return classId === undefined ? scoped : scoped.eq("providerClassId", classId);
        }).take(limit);
      return rows.map((row) => ({ ...row, _id: row.recordId }));
    }
    return ctx.db.query("externalRecords")
      .withIndex("by_account_kind_class", (q) => {
        const scoped = q.eq("mappedAccountId", accountId).eq("syncKind", kind);
        return classId === undefined ? scoped : scoped.eq("providerClassId", classId);
      }).take(limit);
  };
}

export const continueBackfill = internalMutation({
  args: {},
  handler: async (ctx) => {
    const state = await migrationState(ctx);
    if (state?.state === "complete") return { done: true };
    const page = await ctx.db.query("externalRecords").paginate({
      cursor: state?.cursor ?? null,
      numItems: 100,
      maximumBytesRead: 2_000_000,
    });
    for (const record of page.page) await syncSchoolRecordSummary(ctx, record._id, null, record, true);
    const now = Date.now();
    const fields = {
      cursor: page.isDone ? undefined : page.continueCursor,
      state: page.isDone ? "complete" as const : "running" as const,
      scanned: (state?.scanned ?? 0) + page.page.length,
      repaired: (state?.repaired ?? 0) + page.page.length,
      updatedAt: now,
    };
    if (state) await ctx.db.patch(state._id, fields);
    else await ctx.db.insert("spectraReadModelMigrations", {
      ...fields, key: MIGRATION_KEY, version: 1, createdAt: now,
    });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.schoolRecordSummaries.continueBackfill, {});
    return { done: page.isDone };
  },
});
