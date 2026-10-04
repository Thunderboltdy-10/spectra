/**
 * The School API: what one student's ManageBac data looks like in Spectra, and the controls
 * over it. Every read goes through the shared ManageBac visibility check, so a student only
 * ever reaches their own data, in their own school, in classes they selected, of kinds they
 * haven't turned Off. See ./school.README.md for the contract the School page builds on.
 */
import { v } from "convex/values";
import { query } from "./functions";
import { mutation } from "./orgNodeMutation";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import { createManagebacVisibilityReader } from "./managebacVisibility";
import { purgeSyncKindPage, submissionFiles } from "./managebac";
import { deleteStorageIfNoOtherBinding, storageHasOtherBinding } from "./durableStorageBindings";
import { vSchoolSyncKind, vSchoolSyncMode } from "./schoolSyncSchema";
import {
  CLASS_IDENTITY_TYPES,
  isArchived,
  loadSyncPreferences,
  nextAutoRunAt,
  queueSyncJob,
  writeSyncState,
} from "./schoolSyncShared";
import {
  CAS_LEARNING_OUTCOMES,
  CAS_WRITE_BACK,
  SCHOOL_FILE_MAX_BYTES,
  SCHOOL_SYNC_KINDS,
  SCHOOL_SYNC_KIND_INFO,
  describeSchoolSyncProblem,
  type SchoolSyncKind,
} from "../shared/school-sync";

type Ctx = QueryCtx | MutationCtx;
type Actor = NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>;

const NOT_FOUND = "SCHOOL_RECORD_NOT_FOUND: That isn't in your School data.";
/** Most records of one kind a list returns. */
const LIST_LIMIT = 500;

async function requireStudent(ctx: Ctx) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return actor;
}

async function managebacFor(ctx: Ctx, actor: Actor) {
  const rows = await ctx.db
    .query("schoolIntegrations")
    .withIndex("by_school_provider", (q) => q.eq("schoolId", actor.schoolId).eq("provider", "managebac"))
    .take(2);
  return rows.length === 1 ? rows[0]! : null;
}

async function requireManagebac(ctx: Ctx, actor: Actor) {
  const integration = await managebacFor(ctx, actor);
  if (!integration || integration.status === "revoked")
    throw new Error("INTEGRATION_NOT_CONNECTED: Your school hasn't connected ManageBac.");
  return integration;
}

function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : typeof value === "number" ? String(value) : "";
}

function time(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function num(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The ids a task is known by: ManageBac's id, and the tail of its record key. */
function taskIds(task: Doc<"externalRecords">) {
  return new Set([task.providerRecordId, task.providerRecordKey.split(":").at(-1) ?? ""].filter(Boolean));
}

/** One student's records of one kind, readable now. */
async function readableOfKind(
  ctx: Ctx,
  actor: Actor,
  integrationId: Id<"schoolIntegrations">,
  kind: SchoolSyncKind,
  canRead: (record: Doc<"externalRecords">) => Promise<boolean>,
  providerClassId?: string,
) {
  const rows = await ctx.db
    .query("externalRecords")
    .withIndex("by_account_kind_class", (q) => {
      const scoped = q.eq("mappedAccountId", actor.accountId).eq("syncKind", kind);
      return providerClassId === undefined ? scoped : scoped.eq("providerClassId", providerClassId);
    })
    .take(LIST_LIMIT);
  const own = rows.filter((row) => row.integrationId === integrationId && row.schoolId === actor.schoolId && !row.tombstone);
  const readable = await Promise.all(own.map((row) => canRead(row)));
  return own.filter((_, index) => readable[index]);
}

/** The student's own record by id, if they can read it now. */
async function ownRecord(ctx: Ctx, actor: Actor, recordId: Id<"externalRecords">) {
  const integration = await managebacFor(ctx, actor);
  const record = await ctx.db.get(recordId);
  if (!integration || !record || record.integrationId !== integration._id || record.schoolId !== actor.schoolId ||
      record.mappedAccountId !== actor.accountId)
    return null;
  const reader = createManagebacVisibilityReader(ctx, actor);
  return (await reader.canReadRecord(record)) ? { integration, record, reader } : null;
}

async function classTitles(ctx: Ctx, actor: Actor, integrationId: Id<"schoolIntegrations">) {
  const rows = await ctx.db
    .query("externalRecords")
    .withIndex("by_account_kind_class", (q) => q.eq("mappedAccountId", actor.accountId).eq("syncKind", "classes"))
    .take(LIST_LIMIT);
  const titles = new Map<string, string>();
  for (const row of rows)
    if (row.integrationId === integrationId && row.providerClassId && CLASS_IDENTITY_TYPES.has(row.recordType) && !row.tombstone) {
      const value = fields(row.normalized);
      const title = str(value.title) || str(value.name) || str(value.subject);
      if (title && !titles.has(row.providerClassId)) titles.set(row.providerClassId, title);
    }
  return titles;
}

function taskSummary(record: Doc<"externalRecords">, classTitle?: string) {
  const value = fields(record.normalized);
  return {
    recordId: record._id,
    title: str(value.title) || str(value.name) || "Task",
    providerClassId: record.providerClassId ?? null,
    className: classTitle ?? (str(value.className) || null),
    dueAt: time(value.dueAt ?? value.deadlineAt ?? value.due_at ?? value.due_date) ?? null,
    status: str(value.status, 80) || null,
    taskType: str(value.taskType ?? value.type, 80) || null,
    term: str(value.term ?? value.termName ?? record.academicPeriodKey, 120) || null,
    past: record.syncKind === "past_tasks",
    sourceState: record.sourceState ?? "available",
    provenanceUrl: record.provenanceUrl ?? null,
  };
}

function fileSummary(file: Doc<"schoolFiles">) {
  return {
    schoolFileId: file._id,
    sourceRecordId: file.sourceRecordId,
    origin: file.origin,
    providerFileId: file.providerFileId ?? null,
    filename: file.filename,
    mimeType: file.mimeType,
    bytes: file.bytes ?? null,
    state: file.state,
    hasText: Boolean(file.extractedText),
    problem: file.errorCode ? { code: file.errorCode, message: file.errorSummary ?? "" } : null,
    fetchedAt: file.fetchedAt ?? null,
  };
}

const vTaskView = v.union(v.literal("current"), v.literal("past"), v.literal("all"));

// ---------------------------------------------------------------------------------------------
// Preferences and sync status

export const preferences = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireStudent(ctx);
    const integration = await managebacFor(ctx, actor);
    if (!integration)
      return {
        connected: false,
        kinds: SCHOOL_SYNC_KINDS.map((kind) => ({ kind, ...kindInfo(kind), mode: SCHOOL_SYNC_KIND_INFO[kind].availability === "available" ? SCHOOL_SYNC_KIND_INFO[kind].defaultMode : ("off" as const), chosen: false })),
        classOverrides: [],
      };
    const prefs = await loadSyncPreferences(ctx, actor.accountId, integration._id);
    return {
      connected: integration.status === "connected" || integration.status === "degraded",
      kinds: SCHOOL_SYNC_KINDS.map((kind) => ({ kind, ...kindInfo(kind), mode: prefs.modeFor(kind), chosen: prefs.chosen(kind) !== undefined })),
      classOverrides: prefs.overrides
        .filter((row) => row.schoolId === actor.schoolId)
        .map((row) => ({ providerClassId: row.providerClassId, kind: row.kind, mode: row.mode }))
        .sort((a, b) => a.providerClassId.localeCompare(b.providerClassId) || a.kind.localeCompare(b.kind)),
    };
  },
});

function kindInfo(kind: SchoolSyncKind) {
  const info = SCHOOL_SYNC_KIND_INFO[kind];
  return {
    label: info.label,
    description: info.description,
    defaultMode: info.defaultMode,
    classScoped: info.classScoped,
    available: info.availability === "available",
    unavailableReason: info.unavailableReason ?? null,
    autoEveryMinutes: info.autoEveryMinutes,
  };
}

/** Each kind's last run, next run and last problem, in plain words with who can fix it. */
export const syncStatus = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireStudent(ctx);
    const integration = await managebacFor(ctx, actor);
    if (!integration || integration.status === "revoked" || integration.status === "disconnected")
      return { connection: { state: "not_connected" as const, problem: describeSchoolSyncProblem("INTEGRATION_NOT_CONNECTED") }, running: false, kinds: [] };
    const [prefs, states, mapping] = await Promise.all([
      loadSyncPreferences(ctx, actor.accountId, integration._id),
      ctx.db.query("schoolSyncStates")
        .withIndex("by_account_integration_kind", (q) => q.eq("accountId", actor.accountId).eq("integrationId", integration._id))
        .take(20),
      ctx.db.query("externalIdentityMappings")
        .withIndex("by_integration_account", (q) => q.eq("integrationId", integration._id).eq("accountId", actor.accountId))
        .first(),
    ]);
    const connectionProblem = integration.status === "blocked"
      ? describeSchoolSyncProblem("INTEGRATION_CREDENTIAL_REJECTED")
      : integration.status !== "connected" && integration.status !== "degraded"
        ? describeSchoolSyncProblem("INTEGRATION_NOT_READY")
        : mapping?.status !== "verified"
          ? describeSchoolSyncProblem("INTEGRATION_IDENTITY_REQUIRED")
          : null;
    const kinds = SCHOOL_SYNC_KINDS.map((kind) => {
      const state = states.find((row) => row.kind === kind);
      const mode = prefs.modeFor(kind);
      const off = !prefs.hasAny(kind);
      return {
        kind,
        label: SCHOOL_SYNC_KIND_INFO[kind].label,
        mode,
        available: SCHOOL_SYNC_KIND_INFO[kind].availability === "available",
        state: off ? ("off" as const) : (state?.state ?? ("idle" as const)),
        lastRunAt: state?.lastRunAt ?? null,
        lastSuccessAt: state?.lastSuccessAt ?? null,
        nextRunAt: off ? null : state?.state === "running" ? null : state?.dueAt ?? null,
        nextRunTrigger: off ? null : state?.dueTrigger ?? null,
        problem: off
          ? null
          : SCHOOL_SYNC_KIND_INFO[kind].availability === "unavailable"
            ? describeSchoolSyncProblem("INTEGRATION_ENDPOINT_UNAVAILABLE", kind)
            : state?.errorCode
              ? { ...describeSchoolSyncProblem(state.errorCode, kind), detail: state.errorSummary ?? null }
              : null,
      };
    });
    return {
      connection: {
        state: connectionProblem ? ("blocked" as const) : integration.status === "degraded" ? ("degraded" as const) : ("connected" as const),
        lastSyncAt: integration.lastSyncAt ?? null,
        problem: connectionProblem,
      },
      running: kinds.some((row) => row.state === "running" || row.state === "queued"),
      kinds,
    };
  },
});

async function stateScope(ctx: MutationCtx, actor: Actor, kind: SchoolSyncKind) {
  const integration = await requireManagebac(ctx, actor);
  return { integration, scope: { accountId: actor.accountId, schoolId: actor.schoolId, integrationId: integration._id, kind } };
}

/** After a mode change: Auto is scheduled, Manual waits for Sync now, Off clears the queue. */
async function reschedule(ctx: MutationCtx, scope: Awaited<ReturnType<typeof stateScope>>["scope"]) {
  const prefs = await loadSyncPreferences(ctx, scope.accountId, scope.integrationId);
  const state = await ctx.db.query("schoolSyncStates")
    .withIndex("by_account_integration_kind", (q) => q.eq("accountId", scope.accountId).eq("integrationId", scope.integrationId).eq("kind", scope.kind))
    .first();
  if (!prefs.hasAny(scope.kind)) {
    await writeSyncState(ctx, scope, { state: "idle", dueAt: undefined, dueTrigger: undefined, errorCode: undefined, errorSummary: undefined });
    return;
  }
  const now = Date.now();
  if (prefs.hasAuto(scope.kind)) {
    await queueSyncJob(ctx, scope, "schedule", nextAutoRunAt(prefs, scope.kind, state?.lastSuccessAt, now) ?? now);
    return;
  }
  // Manual: a scheduled run no longer applies; a request already queued stays.
  if (state?.dueTrigger === "schedule" && state.state !== "running")
    await writeSyncState(ctx, scope, { dueAt: undefined, dueTrigger: undefined });
}

/** Sets one kind's mode. Off removes that kind's data now (the rest continues in the background). */
export const setMode = mutation({
  args: { kind: vSchoolSyncKind, mode: vSchoolSyncMode },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    const { integration, scope } = await stateScope(ctx, actor, args.kind);
    if (SCHOOL_SYNC_KIND_INFO[args.kind].availability === "unavailable" && args.mode !== "off")
      throw new Error(`SCHOOL_SYNC_KIND_UNAVAILABLE: ${SCHOOL_SYNC_KIND_INFO[args.kind].unavailableReason ?? "This isn't available."}`);
    const now = Date.now();
    const existing = await ctx.db.query("schoolSyncPreferences")
      .withIndex("by_account_integration_kind", (q) => q.eq("accountId", actor.accountId).eq("integrationId", integration._id).eq("kind", args.kind))
      .first();
    if (existing) await ctx.db.patch(existing._id, { mode: args.mode, updatedAt: now });
    else await ctx.db.insert("schoolSyncPreferences", {
      accountId: actor.accountId, schoolId: actor.schoolId, integrationId: integration._id, kind: args.kind, mode: args.mode, updatedAt: now,
    });
    const purge = args.mode === "off"
      ? await purgeSyncKindPage(ctx, { accountId: actor.accountId, integrationId: integration._id, kind: args.kind, cursor: null })
      : { purged: 0, done: true };
    await reschedule(ctx, scope);
    return { kind: args.kind, mode: args.mode, purged: purge.purged, purgeDone: purge.done };
  },
});

/**
 * One class's mode for one kind, overriding the student's mode for the kind. `mode: null`
 * removes the override. To exclude a class entirely, deselect it (managebac.setSelectedClasses).
 */
export const setClassOverride = mutation({
  args: { providerClassId: v.string(), kind: vSchoolSyncKind, mode: v.union(vSchoolSyncMode, v.null()) },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    const { integration, scope } = await stateScope(ctx, actor, args.kind);
    if (!SCHOOL_SYNC_KIND_INFO[args.kind].classScoped)
      throw new Error(`SCHOOL_SYNC_KIND_NOT_PER_CLASS: ${SCHOOL_SYNC_KIND_INFO[args.kind].label} can't be set per class.`);
    const providerClassId = args.providerClassId.trim();
    const classes = await classTitles(ctx, actor, integration._id);
    if (!providerClassId || !classes.has(providerClassId)) throw new Error(NOT_FOUND);
    const now = Date.now();
    const existing = await ctx.db.query("schoolSyncClassOverrides")
      .withIndex("by_account_integration_kind_class", (q) => q.eq("accountId", actor.accountId).eq("integrationId", integration._id)
        .eq("kind", args.kind).eq("providerClassId", providerClassId))
      .first();
    if (args.mode === null) {
      if (existing) await ctx.db.delete(existing._id);
    } else if (existing) await ctx.db.patch(existing._id, { mode: args.mode, updatedAt: now });
    else await ctx.db.insert("schoolSyncClassOverrides", {
      accountId: actor.accountId, schoolId: actor.schoolId, integrationId: integration._id, providerClassId,
      kind: args.kind, mode: args.mode, updatedAt: now,
    });
    const purge = args.mode === "off"
      ? await purgeSyncKindPage(ctx, { accountId: actor.accountId, integrationId: integration._id, kind: args.kind, providerClassId, cursor: null })
      : { purged: 0, done: true };
    await reschedule(ctx, scope);
    return { providerClassId, kind: args.kind, mode: args.mode, purged: purge.purged, purgeDone: purge.done };
  },
});

/**
 * Sync now, in the background: queues one kind, or every kind not Off. The page shows progress
 * through syncStatus. (The ManageBac route's `sync` action runs the same jobs in the request.)
 */
export const syncNow = mutation({
  args: { kind: v.optional(vSchoolSyncKind) },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    const integration = await requireManagebac(ctx, actor);
    const mapping = await ctx.db.query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) => q.eq("integrationId", integration._id).eq("accountId", actor.accountId))
      .first();
    if (mapping?.status !== "verified")
      throw new Error("INTEGRATION_IDENTITY_REQUIRED: Spectra hasn't matched you to your ManageBac account yet.");
    const prefs = await loadSyncPreferences(ctx, actor.accountId, integration._id);
    if (args.kind && !prefs.hasAny(args.kind))
      throw new Error(`SCHOOL_SYNC_KIND_OFF: ${SCHOOL_SYNC_KIND_INFO[args.kind].label} is turned off.`);
    const kinds = args.kind ? [args.kind] : SCHOOL_SYNC_KINDS.filter((kind) => prefs.hasAny(kind));
    const now = Date.now();
    for (const kind of kinds)
      await queueSyncJob(ctx, { accountId: actor.accountId, schoolId: actor.schoolId, integrationId: integration._id, kind }, "user", now);
    return { queued: kinds };
  },
});

// ---------------------------------------------------------------------------------------------
// Classes and tasks

/** Every class ManageBac lists for the student, selected or not, with its per-class modes. */
export const classes = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireStudent(ctx);
    const integration = await managebacFor(ctx, actor);
    if (!integration) return { classes: [] };
    const reader = createManagebacVisibilityReader(ctx, actor);
    const [rows, selections, prefs] = await Promise.all([
      readableOfKind(ctx, actor, integration._id, "classes", reader.canReadRecord),
      ctx.db.query("managebacClassSelections")
        .withIndex("by_account_integration", (q) => q.eq("accountId", actor.accountId).eq("integrationId", integration._id))
        .take(LIST_LIMIT),
      loadSyncPreferences(ctx, actor.accountId, integration._id),
    ]);
    const byClass = new Map<string, Doc<"externalRecords">>();
    for (const row of rows)
      if (row.providerClassId && CLASS_IDENTITY_TYPES.has(row.recordType)) {
        const current = byClass.get(row.providerClassId);
        // A class row names it better than a membership row.
        if (!current || (current.recordType !== "class" && row.recordType === "class")) byClass.set(row.providerClassId, row);
      }
    const classList = [...byClass.entries()].map(([providerClassId, row]) => {
      const value = fields(row.normalized);
      return {
        providerClassId,
        recordId: row._id,
        title: str(value.title) || str(value.name) || str(value.subject) || "Class",
        subject: str(value.subject) || null,
        yearGroupId: str(value.yearGroupId, 40) || null,
        academicPeriodKey: row.academicPeriodKey ?? null,
        archived: isArchived(row.normalized),
        selected: selections.some((item) => item.providerClassId === providerClassId && item.selected && item.schoolId === actor.schoolId),
        modes: Object.fromEntries(
          SCHOOL_SYNC_KINDS.filter((kind) => SCHOOL_SYNC_KIND_INFO[kind].classScoped).map((kind) => [kind, prefs.modeFor(kind, providerClassId)]),
        ) as Partial<Record<SchoolSyncKind, "auto" | "manual" | "off">>,
      };
    });
    classList.sort((a, b) => a.title.localeCompare(b.title) || a.providerClassId.localeCompare(b.providerClassId));
    return { classes: classList };
  },
});

/** Tasks: current, past (the archive, grouped by class and term on the page) or all. */
export const tasks = query({
  args: { view: vTaskView, providerClassId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    const integration = await managebacFor(ctx, actor);
    if (!integration) return { tasks: [] };
    const reader = createManagebacVisibilityReader(ctx, actor);
    const kinds: SchoolSyncKind[] = args.view === "current" ? ["current_tasks"] : args.view === "past" ? ["past_tasks"] : ["current_tasks", "past_tasks"];
    const [titles, ...lists] = await Promise.all([
      classTitles(ctx, actor, integration._id),
      ...kinds.map((kind) => readableOfKind(ctx, actor, integration._id, kind, reader.canReadRecord, args.providerClassId)),
    ]);
    const rows = lists.flat().map((row) => taskSummary(row, row.providerClassId ? titles.get(row.providerClassId) : undefined));
    // Current work soonest first; the archive newest first.
    rows.sort((a, b) => a.past !== b.past ? (a.past ? 1 : -1)
      : a.past ? (b.dueAt ?? 0) - (a.dueAt ?? 0) : (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
    return { tasks: rows };
  },
});

/** One task with its brief, resources, the student's grade and feedback, and their submission. */
export const task = query({
  args: { recordId: v.id("externalRecords") },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    const own = await ownRecord(ctx, actor, args.recordId);
    if (!own || (own.record.syncKind !== "current_tasks" && own.record.syncKind !== "past_tasks")) return null;
    const { integration, record, reader } = own;
    const ids = taskIds(record);
    const classId = record.providerClassId;
    const forTask = (row: Doc<"externalRecords">) => ids.has(str(fields(row.normalized).taskId, 200));
    const [titles, grades, submissions, resources] = await Promise.all([
      classTitles(ctx, actor, integration._id),
      readableOfKind(ctx, actor, integration._id, "grades", reader.canReadRecord, classId),
      readableOfKind(ctx, actor, integration._id, "dropbox_files", reader.canReadRecord, classId),
      readableOfKind(ctx, actor, integration._id, "task_resources", reader.canReadRecord, classId),
    ]);
    const value = fields(record.normalized);
    const grade = grades.find(forTask);
    const submission = submissions.find(forTask);
    const cached = submission
      ? await ctx.db.query("schoolFiles")
          .withIndex("by_account_source", (q) => q.eq("accountId", actor.accountId).eq("sourceRecordId", submission._id))
          .take(100)
      : [];
    const gradeValue = fields(grade?.normalized);
    return {
      ...taskSummary(record, classId ? titles.get(classId) : undefined),
      brief: str(value.description ?? value.body ?? value.notes, 20_000) || null,
      resources: resources
        .filter((row) => forTask(row) || !str(fields(row.normalized).taskId))
        .slice(0, 50)
        .map((row) => {
          const resource = fields(row.normalized);
          return { recordId: row._id, title: str(resource.title) || str(resource.name) || "Resource",
            url: str(resource.url ?? resource.link, 2_000) || null, forThisTask: forTask(row) };
        }),
      grade: grade
        ? {
            recordId: grade._id,
            score: num(gradeValue.score ?? gradeValue.grade ?? gradeValue.mark) ?? null,
            maxScore: num(gradeValue.maxScore ?? gradeValue.max_score ?? gradeValue.outOf) ?? null,
            label: str(gradeValue.gradeLabel ?? gradeValue.grade, 80) || null,
            criteria: Array.isArray(gradeValue.criteria) ? gradeValue.criteria.slice(0, 20) : [],
            feedback: str(gradeValue.feedback ?? gradeValue.comments, 20_000) || null,
          }
        : null,
      submission: submission
        ? {
            recordId: submission._id,
            status: str(fields(submission.normalized).status, 80) || null,
            submittedAt: time(fields(submission.normalized).submittedAt) ?? null,
            files: submissionFiles(submission.normalized).map((file) => {
              const kept = cached.find((row) => row.providerFileId === file.id);
              return {
                providerFileId: file.id,
                filename: file.filename,
                mimeType: kept?.mimeType ?? file.mimeType,
                bytes: kept?.bytes ?? file.bytes ?? null,
                state: kept?.state ?? ("listed" as const),
                schoolFileId: kept?._id ?? null,
                tooLarge: (file.bytes ?? 0) > SCHOOL_FILE_MAX_BYTES,
              };
            }),
          }
        : null,
    };
  },
});

// ---------------------------------------------------------------------------------------------
// Files

/** The files the student keeps from School: fetched submissions and CAS evidence. */
export const files = query({
  args: { origin: v.optional(v.union(v.literal("dropbox"), v.literal("cas_evidence"))) },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    const integration = await managebacFor(ctx, actor);
    if (!integration) return { files: [] };
    const reader = createManagebacVisibilityReader(ctx, actor);
    const rows = (await ctx.db.query("schoolFiles")
      .withIndex("by_account_updated", (q) => q.eq("accountId", actor.accountId))
      .order("desc")
      .take(LIST_LIMIT))
      .filter((row) => row.schoolId === actor.schoolId && row.integrationId === integration._id && (!args.origin || row.origin === args.origin));
    const sources = await Promise.all(rows.map(async (row) => {
      const source = await ctx.db.get(row.sourceRecordId);
      return source && (await reader.canReadRecord(source)) ? source : null;
    }));
    return {
      files: rows.flatMap((row, index) => {
        const source = sources[index];
        return source ? [{ ...fileSummary(row), sourceTitle: str(fields(source.normalized).title) || str(fields(source.normalized).name) || null }] : [];
      }),
    };
  },
});

async function ownFile(ctx: Ctx, actor: Actor, schoolFileId: Id<"schoolFiles">) {
  const file = await ctx.db.get(schoolFileId);
  if (!file || file.accountId !== actor.accountId || file.schoolId !== actor.schoolId) return null;
  const source = await ownRecord(ctx, actor, file.sourceRecordId);
  return source ? { file, ...source } : null;
}

/** A short-lived URL for a kept file's bytes, for Spectra's viewers. */
export const fileUrl = query({
  args: { schoolFileId: v.id("schoolFiles") },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    const own = await ownFile(ctx, actor, args.schoolFileId);
    if (!own || own.file.state !== "cached" || !own.file.storageId) return null;
    return { url: await ctx.storage.getUrl(own.file.storageId), filename: own.file.filename, mimeType: own.file.mimeType };
  },
});

/** Forgets a kept copy. A dropbox file can be fetched again; CAS evidence is gone. */
export const removeSchoolFile = mutation({
  args: { schoolFileId: v.id("schoolFiles") },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    const file = await ctx.db.get(args.schoolFileId);
    if (!file || file.accountId !== actor.accountId || file.schoolId !== actor.schoolId) throw new Error(NOT_FOUND);
    await ctx.db.delete(file._id);
    if (file.storageId) await deleteStorageIfNoOtherBinding(ctx, file.storageId, { table: "schoolFiles", id: String(file._id) });
    return { removed: true };
  },
});

// ---------------------------------------------------------------------------------------------
// CAS

function casSummary(record: Doc<"externalRecords">, outcomes: number[], counts: { reflections: number; evidence: number }) {
  const value = fields(record.normalized);
  const flag = (key: string) => value[key] === true || value[key] === "true" || (Array.isArray(value.types) && value.types.includes(key));
  return {
    recordId: record._id,
    title: str(value.title) || str(value.name) || "CAS experience",
    description: str(value.description, 5_000) || null,
    types: { creativity: flag("creativity"), activity: flag("activity"), service: flag("service") },
    startsAt: time(value.startsAt ?? value.startDate ?? value.start_date) ?? null,
    endsAt: time(value.endsAt ?? value.endDate ?? value.end_date) ?? null,
    supervisor: str(value.supervisor ?? value.supervisorName, 200) || null,
    status: str(value.status, 80) || null,
    isProject: value.project === true || value.casProject === true,
    outcomes,
    reflectionCount: counts.reflections,
    evidenceCount: counts.evidence,
    provenanceUrl: record.provenanceUrl ?? null,
  };
}

async function casExtras(ctx: Ctx, actor: Actor, experienceRecordId: Id<"externalRecords">) {
  const [reflections, tags, evidence] = await Promise.all([
    ctx.db.query("casReflections")
      .withIndex("by_account_experience", (q) => q.eq("accountId", actor.accountId).eq("experienceRecordId", experienceRecordId)).take(200),
    ctx.db.query("casOutcomeTags")
      .withIndex("by_account_experience", (q) => q.eq("accountId", actor.accountId).eq("experienceRecordId", experienceRecordId)).first(),
    ctx.db.query("schoolFiles")
      .withIndex("by_account_source", (q) => q.eq("accountId", actor.accountId).eq("sourceRecordId", experienceRecordId)).take(100),
  ]);
  return {
    reflections: reflections.filter((row) => row.schoolId === actor.schoolId).sort((a, b) => a.createdAt - b.createdAt),
    outcomes: tags?.schoolId === actor.schoolId ? tags.outcomes : [],
    evidence: evidence.filter((row) => row.schoolId === actor.schoolId && row.origin === "cas_evidence"),
  };
}

/** CAS at a glance: experiences, and which of the seven learning outcomes each covers. */
export const cas = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireStudent(ctx);
    const integration = await managebacFor(ctx, actor);
    const base = { writeBack: CAS_WRITE_BACK, learningOutcomes: CAS_LEARNING_OUTCOMES };
    if (!integration) return { ...base, experiences: [], outcomeCoverage: [] };
    const reader = createManagebacVisibilityReader(ctx, actor);
    const rows = (await readableOfKind(ctx, actor, integration._id, "cas", reader.canReadRecord))
      .filter((row) => row.recordType === "cas_experience");
    const experiences = await Promise.all(rows.map(async (row) => {
      const extras = await casExtras(ctx, actor, row._id);
      return casSummary(row, extras.outcomes, { reflections: extras.reflections.length, evidence: extras.evidence.length });
    }));
    experiences.sort((a, b) => (b.startsAt ?? 0) - (a.startsAt ?? 0) || a.title.localeCompare(b.title));
    return {
      ...base,
      experiences,
      outcomeCoverage: CAS_LEARNING_OUTCOMES.map((outcome) => {
        const covered = experiences.filter((row) => row.outcomes.includes(outcome.id)).map((row) => row.recordId);
        return { id: outcome.id, label: outcome.label, experienceIds: covered, missing: covered.length === 0 };
      }),
    };
  },
});

export const casExperience = query({
  args: { recordId: v.id("externalRecords") },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    const own = await ownRecord(ctx, actor, args.recordId);
    if (!own || own.record.recordType !== "cas_experience") return null;
    const extras = await casExtras(ctx, actor, own.record._id);
    return {
      ...casSummary(own.record, extras.outcomes, { reflections: extras.reflections.length, evidence: extras.evidence.length }),
      reflections: extras.reflections.map((row) => ({ reflectionId: row._id, body: row.body, createdAt: row.createdAt, updatedAt: row.updatedAt })),
      evidence: extras.evidence.map(fileSummary),
      writeBack: CAS_WRITE_BACK,
    };
  },
});

async function ownExperience(ctx: MutationCtx, actor: Actor, experienceRecordId: Id<"externalRecords">) {
  const own = await ownRecord(ctx, actor, experienceRecordId);
  if (!own || own.record.recordType !== "cas_experience") throw new Error(NOT_FOUND);
  return own;
}

/** Writes or edits a reflection. It stays in Spectra: ManageBac's API can't store it (CAS_WRITE_BACK). */
export const saveCasReflection = mutation({
  args: { experienceRecordId: v.id("externalRecords"), reflectionId: v.optional(v.id("casReflections")), body: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    const { record } = await ownExperience(ctx, actor, args.experienceRecordId);
    const body = args.body.trim();
    if (!body) throw new Error("SCHOOL_REFLECTION_EMPTY: Write something first.");
    if (body.length > 20_000) throw new Error("SCHOOL_REFLECTION_TOO_LONG: Keep a reflection under 20,000 characters.");
    const now = Date.now();
    if (args.reflectionId) {
      const existing = await ctx.db.get(args.reflectionId);
      if (!existing || existing.accountId !== actor.accountId || existing.schoolId !== actor.schoolId || existing.experienceRecordId !== record._id)
        throw new Error(NOT_FOUND);
      await ctx.db.patch(existing._id, { body, updatedAt: now });
      return { reflectionId: existing._id };
    }
    const reflectionId = await ctx.db.insert("casReflections", {
      accountId: actor.accountId, schoolId: actor.schoolId, experienceRecordId: record._id, body, createdAt: now, updatedAt: now,
    });
    return { reflectionId };
  },
});

export const deleteCasReflection = mutation({
  args: { reflectionId: v.id("casReflections") },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    const existing = await ctx.db.get(args.reflectionId);
    if (!existing || existing.accountId !== actor.accountId || existing.schoolId !== actor.schoolId) throw new Error(NOT_FOUND);
    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});

/** Tags an experience with the learning outcomes it meets (1 to 7). */
export const setCasOutcomes = mutation({
  args: { experienceRecordId: v.id("externalRecords"), outcomes: v.array(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    const { record } = await ownExperience(ctx, actor, args.experienceRecordId);
    const valid = new Set<number>(CAS_LEARNING_OUTCOMES.map((outcome) => outcome.id));
    const outcomes = [...new Set(args.outcomes)].filter((id) => valid.has(id)).sort((a, b) => a - b);
    const existing = await ctx.db.query("casOutcomeTags")
      .withIndex("by_account_experience", (q) => q.eq("accountId", actor.accountId).eq("experienceRecordId", record._id)).first();
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { outcomes, updatedAt: now });
    else await ctx.db.insert("casOutcomeTags", { accountId: actor.accountId, schoolId: actor.schoolId, experienceRecordId: record._id, outcomes, updatedAt: now });
    return { outcomes };
  },
});

/** Step one of adding evidence: an upload URL for the file's bytes. */
export const beginCasEvidenceUpload = mutation({
  args: { experienceRecordId: v.id("externalRecords") },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    await ownExperience(ctx, actor, args.experienceRecordId);
    return { uploadUrl: await ctx.storage.generateUploadUrl(), maxBytes: SCHOOL_FILE_MAX_BYTES };
  },
});

function hexOfBase64(value: string) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return [...binary].map((char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}

/** Step two: keeps the uploaded file as evidence. The same bytes are stored once per student. */
export const attachCasEvidence = mutation({
  args: { experienceRecordId: v.id("externalRecords"), storageId: v.id("_storage"), filename: v.string(), mimeType: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireStudent(ctx);
    const stored = await ctx.db.system.get(args.storageId);
    // Only a fresh upload becomes evidence: bytes something else keeps are never adopted.
    if (!stored || await storageHasOtherBinding(ctx, args.storageId, { table: "schoolFiles", id: "" })) throw new Error(NOT_FOUND);
    const discard = () => deleteStorageIfNoOtherBinding(ctx, args.storageId, { table: "schoolFiles", id: "" });
    let own: Awaited<ReturnType<typeof ownExperience>>;
    try {
      own = await ownExperience(ctx, actor, args.experienceRecordId);
    } catch (error) {
      await discard();
      throw error;
    }
    if (stored.size > SCHOOL_FILE_MAX_BYTES) {
      await discard();
      throw new Error("SCHOOL_FILE_TOO_LARGE: This file is larger than Spectra keeps (50 MB).");
    }
    const contentHash = hexOfBase64(stored.sha256);
    const twin = (await ctx.db.query("schoolFiles")
      .withIndex("by_account_hash", (q) => q.eq("accountId", actor.accountId).eq("contentHash", contentHash)).take(5))
      .find((row) => row.storageId && row.storageId !== args.storageId);
    const storageId = twin?.storageId ?? args.storageId;
    if (twin) await ctx.storage.delete(args.storageId);
    const now = Date.now();
    const schoolFileId = await ctx.db.insert("schoolFiles", {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      integrationId: own.integration._id,
      sourceRecordId: own.record._id,
      origin: "cas_evidence",
      filename: args.filename.trim().slice(0, 240) || "Evidence",
      mimeType: (args.mimeType.trim() || stored.contentType || "application/octet-stream").slice(0, 160),
      state: "cached",
      bytes: stored.size,
      contentHash,
      storageId,
      fetchedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { schoolFileId, deduplicated: Boolean(twin) };
  },
});
