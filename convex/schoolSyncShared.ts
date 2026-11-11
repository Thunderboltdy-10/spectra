/**
 * Per-student School sync: preferences, job state and what a job may reach. Plain helpers (no
 * registered functions) shared by the sync machinery (./managebac.ts), the visibility check
 * (./managebacVisibility.ts) and the School API (./school.ts).
 */
import type { Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  SCHOOL_SYNC_KIND_INFO,
  effectiveSchoolSyncMode,
  modeAdmitsTrigger,
  recordSyncKind,
  type SchoolSyncKind,
  type SchoolSyncMode,
} from "../shared/school-sync";
import type { vSchoolSyncKind, vSchoolSyncTrigger } from "./schoolSyncSchema";
import { getActorForAccountId } from "./identityShared";

type Ctx = QueryCtx | MutationCtx;
export const LOGIN_SYNC_SETUP_VERSION = 3;
/** Long enough that a brief can't land in the middle of someone's first setup. */
const ESTABLISHED_AFTER_MS = 48 * 60 * 60 * 1_000;

/**
 * The same durable gate drives onboarding and the first morning brief. It
 * never reads the clock: a query that does is not served from cache. Callers
 * compare `establishedAt` with their own time (a query with the day it is
 * given, a mutation with now, the browser with its clock).
 */
export async function schoolSetupForAccount(ctx: Ctx, accountId: Id<"accounts">) {
  const actor = await getActorForAccountId(ctx, accountId);
  const preferences = await ctx.db.query("accountPreferences").withIndex("by_account_scope_key", (q) => q.eq("accountId", accountId).eq("scope", "account").eq("scopeKey", "account")).unique();
  const tourComplete = preferences?.values?.integrations?.tourStatus === "done";
  const account = await ctx.db.get(accountId);
  const establishedAt = account ? account._creationTime + ESTABLISHED_AFTER_MS : null;
  const base = { accountId, tourComplete, establishedAt, schoolAdmin: actor?.schoolRole === "school_admin", completedAt: null as number | null, integrationId: null as Id<"schoolIntegrations"> | null };
  if (!actor) return { ...base, phase: "no_school" as const };
  const integration = await ctx.db.query("schoolIntegrations").withIndex("by_school_provider", (q) => q.eq("schoolId", actor.schoolId).eq("provider", "managebac")).unique();
  if (!integration || !["connected", "degraded"].includes(integration.status)) return { ...base, phase: "awaiting_connection" as const };
  const attempt = await ctx.db.query("schoolSyncBootstraps").withIndex("by_account_integration", (q) => q.eq("accountId", accountId).eq("integrationId", integration._id)).unique();
  const current = attempt?.setupVersion === LOGIN_SYNC_SETUP_VERSION;
  const connected = { ...base, integrationId: integration._id };
  if (current && attempt.classSelectionConfirmedAt !== undefined && attempt.completedAt !== undefined)
    return { ...connected, phase: "ready" as const, completedAt: attempt.completedAt };
  if (current && attempt.classSelectionConfirmedAt !== undefined) return { ...connected, phase: "syncing" as const };
  if (current && attempt.classesListedAt !== undefined) return { ...connected, phase: "choose_classes" as const };
  return { ...connected, phase: "loading_classes" as const };
}
export type SyncTrigger = Infer<typeof vSchoolSyncTrigger>;

// The validator and the shared list name the same kinds.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const kindsMatch: Same<Infer<typeof vSchoolSyncKind>, SchoolSyncKind> = true;
void kindsMatch;

/** Class identity rows are how a student chooses classes at all; no mode hides or purges them. */
export const CLASS_IDENTITY_TYPES = new Set(["class", "course", "membership"]);

/** Most stored tasks one grades or dropbox job reads per pass. */
export const MAX_TASK_TARGETS = 1_500;

export type SyncPreferences = Awaited<ReturnType<typeof loadSyncPreferences>>;

/** One student's modes for one connection. Read once per transaction and reuse. */
export async function loadSyncPreferences(
  ctx: Ctx,
  accountId: Id<"accounts">,
  integrationId: Id<"schoolIntegrations">,
) {
  const [preferences, overrides] = await Promise.all([
    ctx.db.query("schoolSyncPreferences")
      .withIndex("by_account_integration_kind", (q) => q.eq("accountId", accountId).eq("integrationId", integrationId))
      .take(50),
    ctx.db.query("schoolSyncClassOverrides")
      .withIndex("by_account_integration_kind_class", (q) => q.eq("accountId", accountId).eq("integrationId", integrationId))
      .take(2_000),
  ]);
  const chosen = new Map(preferences.map((row) => [row.kind, row.mode] as const));
  const byClass = new Map(overrides.map((row) => [`${row.kind}|${row.providerClassId}`, row.mode] as const));
  const modeFor = (kind: SchoolSyncKind, providerClassId?: string): SchoolSyncMode =>
    effectiveSchoolSyncMode(kind, chosen.get(kind), providerClassId ? byClass.get(`${kind}|${providerClassId}`) : undefined);
  return {
    chosen: (kind: SchoolSyncKind) => chosen.get(kind),
    overrides,
    modeFor,
    /** Whether a run with this trigger may sync this kind for this class (or the kind as a whole). */
    admits: (kind: SchoolSyncKind, trigger: SyncTrigger, providerClassId?: string) =>
      modeAdmitsTrigger(modeFor(kind, providerClassId), trigger),
    /** Whether the kind runs in the background for the kind itself or any overridden class. */
    hasAuto: (kind: SchoolSyncKind) =>
      modeFor(kind) === "auto" ||
      (SCHOOL_SYNC_KIND_INFO[kind].classScoped && overrides.some((row) => row.kind === kind && modeFor(kind, row.providerClassId) === "auto")),
    /** Whether anything of the kind may sync at all. */
    hasAny: (kind: SchoolSyncKind) =>
      modeFor(kind) !== "off" ||
      (SCHOOL_SYNC_KIND_INFO[kind].classScoped && overrides.some((row) => row.kind === kind && modeFor(kind, row.providerClassId) !== "off")),
  };
}

/** The kind a stored or incoming record belongs to, for preference checks. */
export function kindOfRecord(
  record: Pick<Doc<"externalRecords">, "recordType" | "normalized"> & { syncKind?: SchoolSyncKind },
  now: number,
): SchoolSyncKind | undefined {
  return record.syncKind ?? recordSyncKind(record.recordType, record.normalized, { classArchived: false, now });
}

/** Whether a student's preferences hide a record. Class identity rows are never hidden. */
export function hiddenByPreferences(
  preferences: SyncPreferences,
  record: Pick<Doc<"externalRecords">, "recordType" | "normalized" | "providerClassId"> & { syncKind?: SchoolSyncKind },
  now: number,
) {
  if (CLASS_IDENTITY_TYPES.has(record.recordType)) return false;
  const kind = kindOfRecord(record, now);
  return kind !== undefined && preferences.modeFor(kind, record.providerClassId) === "off";
}

export async function syncStateFor(
  ctx: Ctx,
  accountId: Id<"accounts">,
  integrationId: Id<"schoolIntegrations">,
  kind: SchoolSyncKind,
) {
  return ctx.db.query("schoolSyncStates")
    .withIndex("by_account_integration_kind", (q) => q.eq("accountId", accountId).eq("integrationId", integrationId).eq("kind", kind))
    .first();
}

type StateScope = {
  accountId: Id<"accounts">;
  schoolId: Id<"schools">;
  integrationId: Id<"schoolIntegrations">;
  kind: SchoolSyncKind;
};
type StatePatch = Partial<Omit<Doc<"schoolSyncStates">, "_id" | "_creationTime" | "accountId" | "schoolId" | "integrationId" | "kind">>;

/** Writes one job's state, creating its row on first use. Schedules the worker for a new due time. */
export async function writeSyncState(ctx: MutationCtx, scope: StateScope, patch: StatePatch) {
  const now = Date.now();
  const existing = await syncStateFor(ctx, scope.accountId, scope.integrationId, scope.kind);
  if (existing) await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
  else await ctx.db.insert("schoolSyncStates", { ...scope, state: "idle", ...patch, updatedAt: now });
  const dueAt = patch.dueAt;
  if (typeof dueAt === "number" && dueAt !== existing?.dueAt)
    await ctx.scheduler.runAt(Math.max(now, dueAt), internal.executionScheduler.dispatchManageBacSync, {
      integrationId: scope.integrationId, scheduledFor: dueAt,
    });
}

/** Applying staged changes is still running; partial results are never successful syncs. */
export async function settleStudentSyncState(
  ctx: MutationCtx,
  run: Doc<"externalSyncRuns">,
  status: "running" | "completed" | "partial" | "awaiting_review",
  now: number,
) {
  if (!run.accountId || !run.syncKind) return;
  const scope = { accountId: run.accountId, schoolId: run.schoolId, integrationId: run.integrationId, kind: run.syncKind };
  const current = await syncStateFor(ctx, scope.accountId, scope.integrationId, scope.kind);
  // A newer sync may have taken over while this run's projections drained.
  if (current?.lastSyncRunId !== run._id) return;
  const preferences = await loadSyncPreferences(ctx, run.accountId, run.integrationId);
  const dueAt = status === "running" ? now + 5 * 60_000
    : status === "completed" ? nextAutoRunAt(preferences, run.syncKind, now, now)
    : status === "partial" && preferences.hasAuto(run.syncKind) ? now + 5 * 60_000 : undefined;
  await writeSyncState(ctx, scope, {
    state: status === "running" ? "running" : status === "completed" ? "idle" : "failed",
    ...(status === "completed" ? { lastSuccessAt: now } : {}),
    dueAt,
    dueTrigger: dueAt === undefined ? undefined : "schedule",
    errorCode: status === "partial" ? "INTEGRATION_SYNC_PARTIAL" : status === "awaiting_review" ? "INTEGRATION_REVIEW_REQUIRED" : undefined,
    errorSummary: status === "partial" ? "Some data could not be synced." : status === "awaiting_review" ? "Some changes need review." : undefined,
  });
}

/** When Auto should next run this kind, or undefined when nothing of it is Auto. */
export function nextAutoRunAt(preferences: SyncPreferences, kind: SchoolSyncKind, lastSuccessAt: number | undefined, now: number) {
  if (!preferences.hasAuto(kind)) return undefined;
  const every = SCHOOL_SYNC_KIND_INFO[kind].autoEveryMinutes * 60_000;
  return Math.max(now, (lastSuccessAt ?? now) + every);
}

/**
 * Puts a job in the worker's queue. A student's or the AI's request runs as soon as possible;
 * the schedule never moves an earlier request later.
 */
export async function queueSyncJob(ctx: MutationCtx, scope: StateScope, trigger: SyncTrigger, at = Date.now()) {
  const current = await syncStateFor(ctx, scope.accountId, scope.integrationId, scope.kind);
  if (current?.dueAt !== undefined && current.dueAt <= at && (current.dueTrigger !== "schedule" || trigger === "schedule")) return;
  await writeSyncState(ctx, scope, {
    dueAt: at,
    dueTrigger: trigger,
    ...(current?.state === "running" ? {} : { state: trigger === "schedule" ? (current?.state ?? "idle") : "queued" }),
  });
}

type ClassRow = { providerClassId: string; archived: boolean };

/** The student's selected classes, with whether each is archived in ManageBac. */
export async function selectedClasses(
  ctx: Ctx,
  accountId: Id<"accounts">,
  integrationId: Id<"schoolIntegrations">,
): Promise<ClassRow[]> {
  const selections = await ctx.db.query("managebacClassSelections")
    .withIndex("by_account_integration", (q) => q.eq("accountId", accountId).eq("integrationId", integrationId))
    .take(500);
  const selectedIds = [...new Set(selections.filter((row) => row.selected).map((row) => row.providerClassId))];
  return Promise.all(selectedIds.map(async (providerClassId) => {
    const rows = await ctx.db.query("externalRecords")
      .withIndex("by_account_kind_class", (q) => q.eq("mappedAccountId", accountId).eq("syncKind", "classes").eq("providerClassId", providerClassId))
      .take(10);
    const archived = rows.some((row) => row.integrationId === integrationId && !row.tombstone &&
      CLASS_IDENTITY_TYPES.has(row.recordType) && isArchived(row.normalized));
    return { providerClassId, archived };
  }));
}

export function isArchived(normalized: unknown) {
  const value = normalized && typeof normalized === "object" ? (normalized as Record<string, unknown>) : {};
  return value.archived === true || value.archived === "true";
}

export type SyncTargets = {
  classIds: string[];
  yearGroupIds: string[];
  tasks: Array<{ classId: string; taskId: string }>;
};

/**
 * What one job may reach: the selected classes whose mode admits the trigger, the student's
 * year groups, or the stored tasks of those classes. Computed here, never by the route.
 */
export async function syncTargets(
  ctx: Ctx,
  input: {
    integration: Doc<"schoolIntegrations">;
    accountId: Id<"accounts">;
    kind: SchoolSyncKind;
    trigger: SyncTrigger;
    preferences: SyncPreferences;
    mapping: Doc<"externalIdentityMappings"> | null;
  },
): Promise<SyncTargets> {
  const { integration, accountId, kind, trigger, preferences } = input;
  const empty: SyncTargets = { classIds: [], yearGroupIds: [], tasks: [] };
  if (kind === "calendar_events") return empty;
  if (kind === "cas") {
    if (!preferences.admits("cas", trigger)) return empty;
    const classRows = await ctx.db.query("externalRecords")
      .withIndex("by_account_kind_class", (q) => q.eq("mappedAccountId", accountId).eq("syncKind", "classes"))
      .take(500);
    const yearGroups = new Set<string>();
    if (input.mapping?.providerYearGroupId) yearGroups.add(input.mapping.providerYearGroupId);
    for (const row of classRows) {
      if (row.integrationId !== integration._id || row.tombstone) continue;
      const value = row.normalized && typeof row.normalized === "object" ? (row.normalized as Record<string, unknown>) : {};
      const yearGroupId = String(value.yearGroupId ?? "").trim();
      if (/^\d+$/.test(yearGroupId)) yearGroups.add(yearGroupId);
    }
    return { ...empty, yearGroupIds: [...yearGroups].sort() };
  }
  const classes = (await selectedClasses(ctx, accountId, integration._id))
    .filter((row) => preferences.admits(kind, trigger, row.providerClassId))
    // Archived classes have no current work; their tasks are the archive.
    .filter((row) => kind !== "current_tasks" || !row.archived);
  const classIds = classes.map((row) => row.providerClassId).sort();
  if (kind !== "grades" && kind !== "dropbox_files") return { ...empty, classIds };
  const now = Date.now();
  const tasks: Array<{ classId: string; taskId: string; due: number }> = [];
  for (const classId of classIds)
    for (const taskKind of ["current_tasks", "past_tasks"] as const) {
      const rows = await ctx.db.query("externalRecords")
        .withIndex("by_account_kind_class", (q) => q.eq("mappedAccountId", accountId).eq("syncKind", taskKind).eq("providerClassId", classId))
        .take(MAX_TASK_TARGETS);
      for (const row of rows) {
        if (row.integrationId !== integration._id || row.tombstone) continue;
        const value = row.normalized && typeof row.normalized === "object" ? (row.normalized as Record<string, unknown>) : {};
        const dueRaw = value.dueAt;
        const due = typeof dueRaw === "string" ? Date.parse(dueRaw) : typeof dueRaw === "number" ? dueRaw : Number.NaN;
        // Grades exist once work is due; a submission can exist any time.
        if (kind === "grades" && taskKind === "current_tasks" && Number.isFinite(due) && due > now) continue;
        tasks.push({ classId, taskId: row.providerRecordId, due: Number.isFinite(due) ? due : 0 });
      }
    }
  tasks.sort((a, b) => b.due - a.due || a.taskId.localeCompare(b.taskId));
  const bounded = tasks.slice(0, MAX_TASK_TARGETS).map(({ classId, taskId }) => ({ classId, taskId }));
  return { ...empty, classIds: [...new Set(bounded.map((task) => task.classId))].sort(), tasks: bounded };
}
