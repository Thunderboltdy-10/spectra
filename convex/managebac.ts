import { query } from "./functions";
import { internalMutation, mutation } from "./orgNodeMutation";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAuditEvent } from "./auditShared";
import {
  dissolveWorkspaceNode,
  ensureWorkspaceNode,
  findPrimaryNode,
  placeSourceNode,
  DISSOLVE_CHILD_BATCH,
} from "./orgTreeShared";
import {
  getAccountByClerkId,
  getActorForAccountId,
  getAuthenticatedActor,
} from "./identityShared";
import {
  buildArtifactTextIndex,
  defaultArtifactContent,
  defaultArtifactSchemaVersion,
} from "./spectraShared";
import { upsertSourceCalendarItem } from "./calendarShared";
import { managebacPlainText as plainText, managebacText as text } from "../shared/planner-provider-refresh";
import {
  addProviderWork, applyPlannerProviderUpdate, inlinePlannerProjections, recordProviderConflict, scheduleProviderFanout,
  settleProviderWork, syncRunOutcome, PROVIDER_INLINE_PLANNERS,
} from "./managebacProjectionJobs";
import { vSchoolSyncKind } from "./schoolSyncSchema";
import {
  CLASS_IDENTITY_TYPES, hiddenByPreferences, isArchived, loadSyncPreferences, nextAutoRunAt, queueSyncJob, syncStateFor,
  syncTargets, writeSyncState, type SyncPreferences, type SyncTargets, type SyncTrigger,
} from "./schoolSyncShared";
import { deleteStorageIfNoOtherBinding, storageHasOtherBinding } from "./durableStorageBindings";
import {
  SCHOOL_FILE_MAX_BYTES, SCHOOL_FILE_TEXT_MAX_CHARS, SCHOOL_SYNC_KINDS, SCHOOL_SYNC_KIND_INFO, capabilitySyncKinds, recordSyncKind,
  type SchoolSyncKind,
} from "../shared/school-sync";

const EMPTY_COUNTS = {
  fetched: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  tombstoned: 0,
  projected: 0,
  skipped: 0,
  quarantined: 0,
  conflicts: 0,
  errors: 0,
};

/**
 * The request that owns a sync lives at most 300 seconds (the ManageBac
 * route's maxDuration) and renews the lease on every committed page. A lease
 * that outlives that request only blocks the next sync after a killed
 * request, so it expires one page gap after the request's own limit.
 */
const SYNC_LEASE_MS = 6 * 60_000;

function canonicalAcademicPeriodKey(value: unknown) {
  const key = text(value, 300);
  return key || undefined;
}

/**
 * Provider ids are only stable inside the provider account and academic
 * period. Personal rows additionally carry the Spectra account. Keeping this
 * key beside the raw provider key lets the bounded migration reconcile legacy
 * rows without ever treating equal provider ids as equal people.
 */
function sourceIdentityKey(
  integrationId: Id<"schoolIntegrations">,
  accountId: Id<"accounts"> | undefined,
  input: {
    providerRecordKey: string;
    audienceScope: string;
    academicPeriodKey?: string;
  },
) {
  const owner =
    input.audienceScope === "mapped_user"
      ? `account:${accountId ?? "unknown"}`
      : `scope:${input.audienceScope}`;
  return [
    String(integrationId),
    owner,
    `period:${canonicalAcademicPeriodKey(input.academicPeriodKey) ?? "unknown"}`,
    input.providerRecordKey.trim().slice(0, 700),
  ].join("|");
}

function projectionSourceKey(source: Doc<"externalRecords">) {
  // Keep the legacy raw calendar key stable when the provider supplied no
  // academic period. Period-bearing rows use the canonical identity so a
  // rollover cannot collide with the prior year's projection.
  return source.academicPeriodKey
    ? source.sourceIdentityKey ?? source.providerRecordKey
    : source.providerRecordKey;
}

async function selectionSnapshot(
  ctx: Ctx,
  integrationId: Id<"schoolIntegrations">,
  accountId: Id<"accounts">,
) {
  const rows = await ctx.db
    .query("managebacClassSelections")
    .withIndex("by_account_integration", (q) =>
      q.eq("accountId", accountId).eq("integrationId", integrationId),
    )
    .collect();
  return {
    revision: rows.reduce((highest, row) => Math.max(highest, row.selectionRevision), 0),
    selectedClassIds: rows.filter((row) => row.selected).map((row) => row.providerClassId),
  };
}

async function assertCurrentSyncLease(
  ctx: MutationCtx,
  syncRun: Doc<"externalSyncRuns">,
  leaseToken?: string,
  options: { allowSelectionChange?: boolean } = {},
) {
  if (syncRun.status === "completed" || syncRun.status === "failed" || syncRun.status === "cancelled" ||
      syncRun.projectionIngestionComplete)
    throw new Error("INTEGRATION_SYNC_FENCED: This sync is no longer current.");
  if (syncRun.leaseToken && syncRun.leaseToken !== leaseToken)
    throw new Error("INTEGRATION_SYNC_FENCED: A newer sync owns this work.");
  if (syncRun.leaseToken && (!syncRun.leaseExpiresAt || syncRun.leaseExpiresAt <= Date.now()))
    throw new Error("INTEGRATION_SYNC_FENCED: The sync lease expired.");
  if (syncRun.accountId && syncRun.selectionRevision !== undefined) {
    const current = await selectionSnapshot(ctx, syncRun.integrationId, syncRun.accountId);
    if (
      current.revision !== syncRun.selectionRevision &&
      !options.allowSelectionChange
    )
      throw new Error("INTEGRATION_SELECTION_CHANGED: Class selection changed while this sync was running.");
  }
}

/** A kept or archived class stops following at the source boundary, not just
 * at the provider fan-out. Whole-account routes and shared reconciliations
 * must also preserve that account's existing projections. */
function classFollowPolicy(ctx: Ctx, integrationId: Id<"schoolIntegrations">) {
  const selections = new Map<string, Promise<Doc<"managebacClassSelections">[]>>();
  return async (
    accountId: Id<"accounts"> | undefined,
    source: { providerClassId?: string; academicPeriodKey?: string; recordType: string },
  ) => {
    if (!accountId || !source.providerClassId || ["class", "course", "membership"].includes(source.recordType)) return true;
    const key = JSON.stringify([accountId, source.providerClassId]);
    let pending = selections.get(key);
    if (!pending) {
      pending = ctx.db.query("managebacClassSelections")
        .withIndex("by_integration_account_class", q => q.eq("integrationId", integrationId).eq("accountId", accountId).eq("providerClassId", source.providerClassId!))
        .collect();
      selections.set(key, pending);
    }
    const rows = await pending;
    const matching = rows.filter(row =>
      row.providerClassId === source.providerClassId &&
      (!source.academicPeriodKey || !row.academicPeriodKey || row.academicPeriodKey === source.academicPeriodKey));
    // A class-scoped record without a matching selection is not followed.
    // Class/course rows themselves are admitted by the early return above so
    // the selection UI can still discover available classes.
    return matching.some(row => row.selected);
  };
}

/**
 * The run that owns one scope now: one student's job for one kind of data, or the school-wide
 * reconciliation (no account, no kind). Each kind is its own scope, so a slow kind never blocks
 * another.
 */
async function activeRunForScope(
  ctx: MutationCtx,
  integrationId: Id<"schoolIntegrations">,
  accountId: Id<"accounts"> | undefined,
  syncKind: SchoolSyncKind | undefined,
  now: number,
) {
  const rows = (
    await Promise.all(
      (["queued", "leased", "running"] as const).map((status) =>
        ctx.db
          .query("externalSyncRuns")
          .withIndex("by_integration_account_kind_status", (q) =>
            q.eq("integrationId", integrationId).eq("accountId", accountId).eq("syncKind", syncKind).eq("status", status),
          )
          .collect(),
      ),
    )
  ).flat();
  for (const row of rows) {
    // Ingestion finished; only staged planner effects remain. They are fenced
    // by source hash, not by this run's lease, and never block a new sync.
    if (row.projectionIngestionComplete) continue;
    if (row.accountId && row.selectionRevision !== undefined) {
      const current = await selectionSnapshot(ctx, integrationId, row.accountId);
      if (current.revision !== row.selectionRevision) {
        await ctx.db.patch(row._id, {
          status: "failed",
          stage: "selection_changed",
          errorCode: "INTEGRATION_SELECTION_CHANGED",
          errorSummary: "This sync no longer owns the selected classes.",
          completedAt: now,
          updatedAt: now,
        });
        await closePass(ctx, row._id);
        continue;
      }
    }
    if (row.leaseExpiresAt && row.leaseExpiresAt > now) return row;
    const pass = syncPass(row);
    if (pass && !pass.reconcile) {
      // The request that owned this pass was killed after its last saved
      // page. The pass keeps its place for the next request to continue.
      await ctx.db.patch(row._id, {
        status: "partial",
        stage: "suspended",
        errorCode: "INTEGRATION_WORKER_LEASE_EXPIRED",
        errorSummary: "The request running this sync stopped. The next sync continues from its last saved page.",
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      continue;
    }
    // Rows written before scoped leases were introduced cannot safely accept
    // a late response, so close them before allowing a replacement claim.
    await ctx.db.patch(row._id, {
      status: "failed",
      stage: "lease_expired",
      errorCode: "INTEGRATION_WORKER_LEASE_EXPIRED",
      errorSummary: "This older sync no longer owns provider work.",
      completedAt: now,
      updatedAt: now,
    });
    await closePass(ctx, row._id);
  }
  return null;
}

/*
 * A full sync pass can need more than one request: each request stops asking
 * the provider for pages at the route's time budget. The pass keeps its place
 * in `cursorState` and the records it saw in `externalSyncSeenKeys`, so the
 * next request for the same scope continues it instead of starting again.
 * Records the provider no longer lists are removed only after the request
 * that finishes the whole pass calls completeSync; a partial pass removes
 * nothing.
 */
const SYNC_RESUME_DELAY_MS = 30_000;
/** A pass that cannot finish within these is dropped and a fresh one starts. */
const MAX_PASS_REQUESTS = 40;
const MAX_PASS_AGE_MS = 24 * 60 * 60_000;
const MAX_PASS_FANOUT_IDS = 5_000;
const RECONCILE_BATCH = 100;
const SEEN_KEY_PURGE_BATCH = 500;

type PassPosition = {
  capabilityId: string;
  /** The fan-out value (a class or year group id); "" for an unbound route. */
  binding: string;
  /** The last committed page and the cursor that requested it. */
  page: number;
  cursor?: string;
  bindingDone: boolean;
};

type PassReconcile = {
  streams: Array<{ scope: "personal" | "shared"; recordType: string }>;
  stream: number;
  /** The `_creationTime` of the last record read in the current stream. */
  after: number | null;
  tombstoned: number;
  importerAccountId: Id<"accounts">;
};

type SyncPass = {
  version: 1;
  startedAt: number;
  requests: number;
  /** The student's kind of data this pass syncs; none for a school reconciliation. */
  syncKind?: SchoolSyncKind;
  /** What must not change for a pass to continue: what it targets (the
   * followed classes and the student's modes), the connection and the
   * capability manifest it started with. */
  selectionDigest: string;
  connectionKey: string;
  manifestVersion: number;
  completedCapabilityIds: string[];
  position?: PassPosition;
  /** A student's job reads exactly these, computed by Convex when it starts.
   * A school reconciliation learns its class and year-group ids as it reads. */
  targets?: SyncTargets;
  classIds: string[];
  yearGroupIds: string[];
  reconcile?: PassReconcile;
};

type PassIdentity = Pick<
  SyncPass,
  "syncKind" | "selectionDigest" | "connectionKey" | "manifestVersion"
> & { targets?: SyncTargets };

const vPassProgress = v.object({
  binding: v.string(),
  page: v.number(),
  cursor: v.optional(v.string()),
  bindingDone: v.boolean(),
  capabilityDone: v.boolean(),
  classIds: v.array(v.string()),
  yearGroupIds: v.array(v.string()),
});

function syncPass(run: Doc<"externalSyncRuns">): SyncPass | undefined {
  const state = record(run.cursorState);
  return state.version === 1 ? (state as unknown as SyncPass) : undefined;
}

async function passIdentity(
  ctx: Ctx,
  integration: Doc<"schoolIntegrations">,
  selectionAccountId: Id<"accounts">,
  syncKind: SchoolSyncKind | undefined,
  targets?: SyncTargets,
): Promise<PassIdentity> {
  const selection = await selectionSnapshot(ctx, integration._id, selectionAccountId);
  return {
    ...(syncKind ? { syncKind } : {}),
    ...(targets ? { targets } : {}),
    selectionDigest: await exactDigest(targets ?? [...selection.selectedClassIds].sort()),
    connectionKey: await exactDigest([
      integration.baseUrl,
      integration.authHeaderName,
      integration.authScheme,
      integration.credentialFingerprint ?? "",
    ]),
    manifestVersion: integration.manifestVersion,
  };
}

function newPass(identity: PassIdentity, now: number): SyncPass {
  return {
    version: 1,
    startedAt: now,
    requests: 1,
    ...identity,
    completedCapabilityIds: [],
    classIds: identity.targets?.classIds ?? [],
    yearGroupIds: identity.targets?.yearGroupIds ?? [],
  };
}

/** What the route needs to continue a pass where the last request stopped,
 * and, for a student's job, exactly which classes, year groups and tasks it reads. */
function passForRoute(pass: SyncPass) {
  return {
    requests: pass.requests,
    completedCapabilityIds: pass.completedCapabilityIds,
    ...(pass.position ? { position: pass.position } : {}),
    ...(pass.syncKind ? { syncKind: pass.syncKind } : {}),
    targeted: Boolean(pass.targets),
    classIds: pass.targets?.classIds ?? pass.classIds,
    yearGroupIds: pass.targets?.yearGroupIds ?? pass.yearGroupIds,
    tasks: pass.targets?.tasks ?? [],
  };
}

/** The newest run of this scope, if it is a pass waiting to continue. */
async function suspendedPass(
  ctx: MutationCtx,
  integrationId: Id<"schoolIntegrations">,
  accountId: Id<"accounts"> | undefined,
  syncKind: SchoolSyncKind | undefined,
) {
  const latest = await ctx.db
    .query("externalSyncRuns")
    .withIndex("by_integration_account_kind_status", (q) =>
      q.eq("integrationId", integrationId).eq("accountId", accountId).eq("syncKind", syncKind).eq("status", "partial"),
    )
    .order("desc")
    .first();
  const pass = latest && latest.stage === "suspended" ? syncPass(latest) : undefined;
  return latest && pass ? { run: latest, pass } : null;
}

/** Why a newer sync request starts a fresh pass instead of continuing. */
function passRestartReason(
  run: Doc<"externalSyncRuns">,
  pass: SyncPass,
  identity: PassIdentity,
  readableIds: Array<Id<"integrationCapabilities">>,
  now: number,
  selectionRevision?: number,
) {
  if (pass.syncKind !== identity.syncKind)
    return "A different kind of sync was requested.";
  if (pass.connectionKey !== identity.connectionKey)
    return "The ManageBac connection changed.";
  if (pass.manifestVersion !== identity.manifestVersion ||
      readableIds.some((id) => !run.capabilityIds.includes(id)))
    return "The readable ManageBac routes changed.";
  if (pass.selectionDigest !== identity.selectionDigest ||
      (selectionRevision !== undefined && run.selectionRevision !== selectionRevision))
    return "The followed classes or sync settings changed.";
  if (now - pass.startedAt >= MAX_PASS_AGE_MS || pass.requests >= MAX_PASS_REQUESTS)
    return "The earlier sync could not finish in time.";
  return null;
}

async function resumePass(
  ctx: MutationCtx,
  run: Doc<"externalSyncRuns">,
  pass: SyncPass,
  leaseOwner: string,
  now: number,
) {
  const leaseToken = crypto.randomUUID();
  const resumed = { ...pass, requests: pass.requests + 1 };
  await ctx.db.patch(run._id, {
    status: "leased",
    stage: "resuming",
    leaseOwner,
    leaseToken,
    leaseExpiresAt: now + SYNC_LEASE_MS,
    cursorState: resumed,
    attemptCount: run.attemptCount + 1,
    errorCode: undefined,
    errorSummary: undefined,
    completedAt: undefined,
    updatedAt: now,
  });
  return { leaseToken, pass: resumed };
}

async function abandonPass(
  ctx: MutationCtx,
  run: Doc<"externalSyncRuns">,
  reason: string,
  now: number,
) {
  await ctx.db.patch(run._id, {
    status: "cancelled",
    stage: "restarted",
    errorCode: "INTEGRATION_SYNC_RESTARTED",
    errorSummary: reason,
    completedAt: now,
    updatedAt: now,
  });
  await closePass(ctx, run._id);
}

/** A closed pass never reconciles; its seen keys are deleted in batches. */
async function closePass(ctx: MutationCtx, syncRunId: Id<"externalSyncRuns">) {
  await ctx.scheduler.runAfter(0, internal.managebac.purgeSyncSeenKeys, { syncRunId });
}

export const purgeSyncSeenKeys = internalMutation({
  args: { syncRunId: v.id("externalSyncRuns") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("externalSyncSeenKeys")
      .withIndex("by_run_identity", (q) => q.eq("syncRunId", args.syncRunId))
      .take(SEEN_KEY_PURGE_BATCH);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === SEEN_KEY_PURGE_BATCH)
      await ctx.scheduler.runAfter(0, internal.managebac.purgeSyncSeenKeys, args);
    return { deleted: rows.length };
  },
});

/** Merges one committed page into the pass and records what it saw. */
async function recordPassPage(
  ctx: MutationCtx,
  syncRun: Doc<"externalSyncRuns">,
  integration: Doc<"schoolIntegrations">,
  capabilityId: Id<"integrationCapabilities">,
  progress: {
    binding: string;
    page: number;
    cursor?: string;
    bindingDone: boolean;
    capabilityDone: boolean;
    classIds: string[];
    yearGroupIds: string[];
  },
  seenKeys: Array<{ sourceIdentityKey: string; providerRecordKey: string }>,
) {
  // Runs created before passes existed start theirs at their first page.
  const pass = syncPass(syncRun) ?? newPass({
    selectionDigest: "",
    connectionKey: "",
    manifestVersion: integration.manifestVersion,
  }, syncRun.startedAt ?? syncRun.createdAt);
  const merge = (current: string[], added: string[]) => {
    const merged = [...new Set([...current, ...added.map((item) => text(item, 500)).filter(Boolean)])];
    if (merged.length > MAX_PASS_FANOUT_IDS)
      throw new Error("INTEGRATION_SYNC_STATE_TOO_LARGE: This sync follows more classes than one pass can track.");
    return merged;
  };
  for (const key of seenKeys)
    await ctx.db.insert("externalSyncSeenKeys", {
      syncRunId: syncRun._id,
      schoolId: syncRun.schoolId,
      ...key,
    });
  return {
    ...pass,
    completedCapabilityIds:
      progress.capabilityDone && !pass.completedCapabilityIds.includes(capabilityId)
        ? [...pass.completedCapabilityIds, capabilityId]
        : pass.completedCapabilityIds,
    position: {
      capabilityId,
      binding: text(progress.binding, 500),
      page: Math.max(1, Math.floor(progress.page)),
      ...(progress.cursor ? { cursor: text(progress.cursor, 1_000) } : {}),
      bindingDone: progress.bindingDone,
    },
    // A student's job reads fixed targets; only a school pass learns ids.
    classIds: pass.targets ? pass.classIds : merge(pass.classIds, progress.classIds),
    yearGroupIds: pass.targets ? pass.yearGroupIds : merge(pass.yearGroupIds, progress.yearGroupIds),
  } satisfies SyncPass;
}

function scheduleSync(
  ctx: MutationCtx,
  integrationId: Id<"schoolIntegrations">,
  scheduledFor: number,
) {
  return ctx.scheduler.runAt(
    Math.max(Date.now(), scheduledFor),
    internal.executionScheduler.dispatchManageBacSync,
    { integrationId, scheduledFor },
  );
}

export const scheduleExisting = internalMutation({
  args: {
    /** Connected, then degraded school connections (their school-wide
     * reconciliation), then every student's queued job. */
    stream: v.optional(v.union(v.literal("connected"), v.literal("degraded"), v.literal("students"))),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stream = args.stream ?? "connected";
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 100)));
    // A repair can cover many schools. Resume one indexed stream at a time
    // rather than loading every row and queuing every job at once.
    let scheduled = 0;
    let scanned = 0;
    let isDone = true;
    let continueCursor: string | null = null;
    if (stream === "students") {
      const page = await ctx.db
        .query("schoolSyncStates")
        .withIndex("by_due", (q) => q.gte("dueAt", 0))
        .paginate({ cursor: args.cursor ?? null, numItems: limit, maximumBytesRead: 1_000_000 });
      // Students of one school due at the same moment share one worker wake-up.
      const wakeUps = new Set<string>();
      for (const state of page.page) {
        if (typeof state.dueAt !== "number") continue;
        const key = `${state.integrationId}|${state.dueAt}`;
        if (wakeUps.has(key)) continue;
        wakeUps.add(key);
        await scheduleSync(ctx, state.integrationId, state.dueAt);
        scheduled += 1;
      }
      scanned = page.page.length;
      isDone = page.isDone;
      continueCursor = page.continueCursor;
    } else {
      const page = await ctx.db
        .query("schoolIntegrations")
        .withIndex("by_status_next_sync", (q) => q.eq("status", stream))
        .paginate({ cursor: args.cursor ?? null, numItems: limit, maximumBytesRead: 1_000_000 });
      for (const integration of page.page) {
        if (
          typeof integration.nextSyncAt !== "number" ||
          integration.blockedReason
        )
          continue;
        await scheduleSync(ctx, integration._id, integration.nextSyncAt);
        scheduled += 1;
      }
      scanned = page.page.length;
      isDone = page.isDone;
      continueCursor = page.continueCursor;
    }
    const next = !isDone
      ? { stream, cursor: continueCursor, limit }
      : stream === "connected"
        ? { stream: "degraded" as const, cursor: null, limit }
        : stream === "degraded"
          ? { stream: "students" as const, cursor: null, limit }
          : null;
    if (next)
      await ctx.scheduler.runAfter(0, internal.managebac.scheduleExisting, next);
    return { scheduled, scanned, done: next === null };
  },
});

const vCapabilityInput = v.object({
  category: v.string(),
  name: v.string(),
  recordType: v.string(),
  path: v.string(),
  purpose: v.string(),
  scope: v.union(
    v.literal("personal"),
    v.literal("class"),
    v.literal("school"),
  ),
  minimumRole: v.union(
    v.literal("student"),
    v.literal("teacher"),
    v.literal("school_admin"),
  ),
  pagination: v.union(
    v.literal("none"),
    v.literal("page"),
    v.literal("cursor"),
    v.literal("unknown"),
  ),
  changeStrategy: v.union(
    v.literal("full_reconciliation"),
    v.literal("modified_since"),
    v.literal("cursor"),
    v.literal("unknown"),
  ),
  freshnessSlaMinutes: v.number(),
  contractVersion: v.string(),
  responseSchemaHash: v.optional(v.string()),
  permissionState: v.union(
    v.literal("read_only"),
    v.literal("not_enabled"),
    v.literal("unverified"),
  ),
  verificationStatus: v.union(
    v.literal("verified"),
    v.literal("failed"),
    v.literal("quarantined"),
    v.literal("unverified"),
  ),
  routeSource: v.union(
    v.literal("tenant_reference"),
    v.literal("api_manager"),
    v.literal("manual_verified"),
  ),
  personalIdParameter: v.optional(v.string()),
  normalization: v.any(),
});

const vNormalizedRecord = v.object({
  providerRecordId: v.string(),
  providerRecordKey: v.string(),
  classification: v.union(
    v.literal("personal"),
    v.literal("class"),
    v.literal("school"),
    v.literal("public_resource"),
  ),
  audienceScope: v.union(
    v.literal("mapped_user"),
    v.literal("class_members"),
    v.literal("authorized_staff"),
    v.literal("school"),
  ),
  providerClassId: v.optional(v.string()),
  academicPeriodKey: v.optional(v.string()),
  normalized: v.any(),
  payloadVersion: v.string(),
  sourceHash: v.string(),
  sourceModifiedAt: v.optional(v.number()),
  provenanceUrl: v.optional(v.string()),
});

type Ctx = QueryCtx | MutationCtx;
type Actor = NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function timestampValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return Date.parse(value);
  return undefined;
}

function isoValue(value: unknown) {
  const time = timestampValue(value);
  return time === undefined ? undefined : new Date(time).toISOString();
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string) {
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

async function exactDigest(value: unknown) {
  return sha256(canonicalJson(value));
}

async function verifyBridge(
  ctx: MutationCtx,
  actor: Actor,
  input: {
    operation: string;
    integrationId: string;
    syncRunId?: string;
    timestamp: number;
    nonce: string;
    payloadDigest: string;
    signature: string;
  },
) {
  const key = process.env.SPECTRA_CONNECTOR_BRIDGE_KEY;
  if (!key || key.length < 32)
    throw new Error(
      "INTEGRATION_BRIDGE_CONFIG_MISSING: Configure a strong connector bridge key.",
    );
  if (Math.abs(Date.now() - input.timestamp) > 60_000)
    throw new Error("INTEGRATION_BRIDGE_EXPIRED: The server request expired.");
  const replay = await ctx.db
    .query("secretBridgeNonces")
    .withIndex("by_nonce", (q) => q.eq("nonce", input.nonce))
    .unique();
  if (replay)
    throw new Error(
      "INTEGRATION_BRIDGE_REPLAYED: This server request was already used.",
    );
  const canonical = [
    input.operation,
    actor.clerkId,
    input.integrationId,
    input.syncRunId ?? "-",
    input.timestamp,
    input.nonce,
    input.payloadDigest,
  ].join("|");
  const imported = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    imported,
    decodeBase64Url(input.signature),
    new TextEncoder().encode(canonical),
  );
  if (!valid)
    throw new Error(
      "INTEGRATION_BRIDGE_INVALID: The server signature is invalid.",
    );
  await ctx.db.insert("secretBridgeNonces", {
    nonce: input.nonce,
    operation: input.operation,
    accountId: actor.accountId,
    expiresAt: input.timestamp + 60_000,
    createdAt: Date.now(),
  });
}

async function requireActor(ctx: Ctx) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor)
    throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return actor;
}

async function requireActorOrService(
  ctx: MutationCtx,
  serviceSubject?: string,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    if (serviceSubject && serviceSubject !== identity.subject)
      throw new Error(
        "INTEGRATION_SUBJECT_MISMATCH: The service subject does not match the authenticated account.",
      );
    return requireActor(ctx);
  }
  if (!serviceSubject)
    throw new Error("AUTH_NOT_SIGNED_IN: Sign in to continue.");
  const account = await getAccountByClerkId(ctx, serviceSubject);
  const actor = account ? await getActorForAccountId(ctx, account._id) : null;
  if (!actor)
    throw new Error(
      "AUTH_ACCOUNT_REQUIRED: The scheduled connector owner is unavailable.",
    );
  return actor;
}

async function verifyScheduledClaim(
  ctx: MutationCtx,
  actor: Actor,
  input: {
    timestamp: number;
    nonce: string;
    payloadDigest: string;
    signature: string;
  },
) {
  const key = process.env.SPECTRA_CONNECTOR_BRIDGE_KEY;
  if (!key || key.length < 32)
    throw new Error(
      "INTEGRATION_BRIDGE_CONFIG_MISSING: Configure a strong connector bridge key.",
    );
  if (Math.abs(Date.now() - input.timestamp) > 60_000)
    throw new Error("INTEGRATION_BRIDGE_EXPIRED: The worker request expired.");
  const replay = await ctx.db
    .query("secretBridgeNonces")
    .withIndex("by_nonce", (q) => q.eq("nonce", input.nonce))
    .unique();
  if (replay)
    throw new Error(
      "INTEGRATION_BRIDGE_REPLAYED: This worker request was already used.",
    );
  const canonical = [
    "scheduled-claim",
    input.timestamp,
    input.nonce,
    input.payloadDigest,
  ].join("|");
  const imported = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    imported,
    decodeBase64Url(input.signature),
    new TextEncoder().encode(canonical),
  );
  if (!valid)
    throw new Error(
      "INTEGRATION_BRIDGE_INVALID: The worker signature is invalid.",
    );
  await ctx.db.insert("secretBridgeNonces", {
    nonce: input.nonce,
    operation: "scheduled-claim",
    accountId: actor.accountId,
    expiresAt: input.timestamp + 60_000,
    createdAt: Date.now(),
  });
}

async function requireSchoolAdmin(ctx: Ctx) {
  const actor = await requireActor(ctx);
  if (actor.schoolRole !== "school_admin")
    throw new Error(
      "AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.",
    );
  return actor;
}

async function integrationForSchool(ctx: Ctx, schoolId: Id<"schools">) {
  return ctx.db
    .query("schoolIntegrations")
    .withIndex("by_school_provider", (q) =>
      q.eq("schoolId", schoolId).eq("provider", "managebac"),
    )
    .unique();
}

async function requireIntegration(
  ctx: Ctx,
  actor: Actor,
  integrationId: Id<"schoolIntegrations">,
) {
  const integration = await ctx.db.get(integrationId);
  if (!integration || integration.schoolId !== actor.schoolId)
    throw new Error(
      "INTEGRATION_NOT_FOUND: The ManageBac integration is unavailable.",
    );
  return integration;
}

function coverage(capabilities: Array<Doc<"integrationCapabilities">>) {
  return {
    discovered: capabilities.length,
    verifiedReadable: capabilities.filter(
      (item) =>
        item.permissionState === "read_only" &&
        item.verificationStatus === "verified",
    ).length,
    unverified: capabilities.filter(
      (item) => item.verificationStatus === "unverified",
    ).length,
    failed: capabilities.filter((item) => item.verificationStatus === "failed")
      .length,
    quarantined: capabilities.filter(
      (item) => item.verificationStatus === "quarantined",
    ).length,
  };
}

function safeIntegration(integration: Doc<"schoolIntegrations">) {
  return {
    _id: integration._id,
    provider: integration.provider,
    baseUrl: integration.baseUrl,
    referenceUrl: integration.referenceUrl,
    authHeaderName: integration.authHeaderName,
    authScheme: integration.authScheme,
    status: integration.status,
    tokenMode: integration.tokenMode,
    credentialFingerprint: integration.credentialFingerprint,
    providerVersion: integration.providerVersion,
    manifestVersion: integration.manifestVersion,
    capabilityCoverage: integration.capabilityCoverage,
    syncPolicy: {
      ...integration.syncPolicy,
      autoCreateClasses: true,
      autoImportTasks: true,
    },
    freshnessSlaMinutes: integration.freshnessSlaMinutes,
    requestBudgetPerMinute: integration.requestBudgetPerMinute,
    bootstrapVersion: integration.bootstrapVersion,
    lastValidatedAt: integration.lastValidatedAt,
    lastSyncAt: integration.lastSyncAt,
    nextSyncAt: integration.nextSyncAt,
    blockedReason: integration.blockedReason,
    rotationDueAt: integration.rotationDueAt,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };
}

export const configure = mutation({
  args: {
    baseUrl: v.string(),
    referenceUrl: v.optional(v.string()),
    authHeaderName: v.string(),
    authScheme: v.union(v.literal("raw"), v.literal("bearer")),
    credentialFingerprint: v.optional(v.string()),
    frequencyMinutes: v.optional(v.number()),
    autoApplySafeUpdates: v.optional(v.boolean()),
    conflictMode: v.optional(v.union(v.literal("review"), v.literal("ask_me"))),
    rotationDueAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSchoolAdmin(ctx);
    const baseUrl = args.baseUrl.trim().replace(/\/+$/, "");
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error(
        "INTEGRATION_URL_INVALID: Enter the tenant API base URL.",
      );
    }
    const localStack = process.env.SPECTRA_APP_URL?.startsWith(
      "http://localhost:",
    );
    const localFixture =
      (process.env.SPECTRA_ALLOW_LOCAL_MANAGEBAC_FIXTURE === "true" ||
        localStack) &&
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !localFixture)
      throw new Error("INTEGRATION_URL_INVALID: ManageBac must use HTTPS.");
    if (
      parsed.username ||
      parsed.password ||
      parsed.hostname === "localhost" ||
      parsed.hostname.endsWith(".local")
    )
      throw new Error(
        "INTEGRATION_EGRESS_BLOCKED: This API host is not allowed.",
      );
    const authHeaderName = text(args.authHeaderName, 120);
    if (
      !/^[A-Za-z0-9-]{2,120}$/.test(authHeaderName) ||
      /^(?:host|cookie|set-cookie|content-length|connection)$/i.test(
        authHeaderName,
      )
    )
      throw new Error(
        "INTEGRATION_AUTH_HEADER_INVALID: Use the header documented by the tenant reference.",
      );
    const current = await integrationForSchool(ctx, actor.schoolId);
    const now = Date.now();
    const connectionContractChanged = Boolean(
      current &&
      (current.baseUrl !== baseUrl ||
        current.authHeaderName !== authHeaderName ||
        current.authScheme !== args.authScheme),
    );
    const syncPolicy = {
      frequencyMinutes: Math.max(
        15,
        Math.min(
          1_440,
          Math.round(
            args.frequencyMinutes ??
              current?.syncPolicy.frequencyMinutes ??
              180,
          ),
        ),
      ),
      autoCreateClasses: true,
      autoImportTasks: true,
      autoApplySafeUpdates:
        args.autoApplySafeUpdates ??
        current?.syncPolicy.autoApplySafeUpdates ??
        true,
      conflictMode:
        args.conflictMode ?? current?.syncPolicy.conflictMode ?? "review",
    } as const;
    let nextStatus:
      | "disconnected"
      | "validating"
      | "connected"
      | "degraded"
      | "blocked"
      | "revoked" = "validating";
    if (current && !connectionContractChanged) {
      if (
        current.status === "revoked" || current.status === "validating" ||
        (current.status === "blocked" && args.credentialFingerprint !== undefined)
      ) {
        const existingCapabilities = await ctx.db
          .query("integrationCapabilities")
          .withIndex("by_integration", (q) =>
            q.eq("integrationId", current._id),
          )
          .collect();
        const verifiedReadable = existingCapabilities.some(
          (item) =>
            item.permissionState === "read_only" &&
            item.verificationStatus === "verified",
        );
        nextStatus = verifiedReadable ? "connected" : "validating";
      } else {
        nextStatus = current.status;
      }
    }
    const patch = {
      baseUrl,
      referenceUrl: args.referenceUrl?.trim().slice(0, 2_000),
      authHeaderName,
      authScheme: args.authScheme,
      status: nextStatus,
      tokenMode: "read_only" as const,
      credentialFingerprint:
        args.credentialFingerprint ?? current?.credentialFingerprint,
      syncPolicy,
      freshnessSlaMinutes: Math.max(180, syncPolicy.frequencyMinutes + 20),
      rotationDueAt: args.rotationDueAt,
      updatedByAccountId: actor.accountId,
      blockedReason: nextStatus === "blocked" ? current?.blockedReason : undefined,
      updatedAt: now,
    };
    let integrationId: Id<"schoolIntegrations">;
    if (current) {
      await ctx.db.patch(current._id, patch);
      integrationId = current._id;
      if (connectionContractChanged) {
        const capabilities = await ctx.db
          .query("integrationCapabilities")
          .withIndex("by_integration", (q) =>
            q.eq("integrationId", current._id),
          )
          .collect();
        for (const capability of capabilities)
          await ctx.db.patch(capability._id, {
            permissionState: "unverified",
            verificationStatus: "unverified",
            lastVerifiedAt: undefined,
            lastErrorCode: "CONNECTION_CONTRACT_CHANGED",
            updatedAt: now,
          });
      }
    } else {
      integrationId = await ctx.db.insert("schoolIntegrations", {
        schoolId: actor.schoolId,
        provider: "managebac",
        ...patch,
        secretPurpose: "managebac-api-token",
        manifestVersion: 0,
        capabilityCoverage: {
          discovered: 0,
          verifiedReadable: 0,
          unverified: 0,
          failed: 0,
          quarantined: 0,
        },
        requestBudgetPerMinute: 180,
        bootstrapVersion: 1,
        createdByAccountId: actor.accountId,
        createdAt: now,
      });
    }
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: current
        ? "integration.managebac.configured"
        : "integration.managebac.created",
      targetType: "school_integration",
      targetId: integrationId,
      metadata: {
        host: parsed.hostname,
        authHeaderName,
        authScheme: args.authScheme,
        tokenMode: "read_only",
        credentialFingerprint: args.credentialFingerprint ?? null,
      },
      retentionClass: "security",
    });
    return { integrationId };
  },
});

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireSchoolAdmin(ctx);
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (!integration) return { disconnected: false };
    const now = Date.now();
    const [mappings, activeRuns] = await Promise.all([
      ctx.db
        .query("externalIdentityMappings")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", actor.schoolId).eq("status", "verified"),
        )
        .collect(),
      ctx.db
        .query("externalSyncRuns")
        .withIndex("by_integration_created", (q) =>
          q.eq("integrationId", integration._id),
        )
        .order("desc")
        .take(500),
    ]);
    for (const mapping of mappings)
      await ctx.db.patch(mapping._id, {
        status: "revoked",
        providerUserId: undefined,
        providerUserIdHash: undefined,
        revokedAt: now,
        updatedAt: now,
      });
    // A suspended pass is still open: cancelling it stops a later request
    // from continuing it, and its saved reading position is discarded.
    const cancelledRuns = activeRuns.filter((item) =>
      ["queued", "leased", "running", "awaiting_review"].includes(item.status) ||
      (item.status === "partial" && item.stage === "suspended"),
    );
    for (const run of cancelledRuns) {
      await ctx.db.patch(run._id, {
        status: "cancelled",
        stage: "integration_disconnected",
        cursorState: undefined,
        leaseExpiresAt: undefined,
        completedAt: now,
        updatedAt: now,
      });
      await closePass(ctx, run._id);
    }
    const sources = await ctx.db
      .query("externalRecords")
      .withIndex("by_school_updated", (q) => q.eq("schoolId", actor.schoolId))
      .take(5_000);
    for (const source of sources.filter(
      (item) => item.integrationId === integration._id && !item.tombstone,
    ))
      await ctx.db.patch(source._id, {
        sourceState: "removed",
        sourceStateAt: now,
        sourceStateReason:
          "The ManageBac connection was disconnected by a school administrator.",
        updatedAt: now,
      });
    await ctx.db.patch(integration._id, {
      status: "revoked",
      blockedReason: "Disconnected by a school administrator.",
      nextSyncAt: undefined,
      updatedByAccountId: actor.accountId,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.disconnected",
      targetType: "school_integration",
      targetId: integration._id,
      metadata: {
        mappingsRevoked: mappings.length,
        runsCancelled: cancelledRuns.length,
      },
      retentionClass: "security",
    });
    return { disconnected: true };
  },
});

export const replaceCapabilityManifest = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    sourceHash: v.string(),
    providerVersion: v.optional(v.string()),
    capabilities: v.array(vCapabilityInput),
  },
  handler: async (ctx, args) => {
    const actor = await requireSchoolAdmin(ctx);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    if (args.capabilities.length > 500)
      throw new Error("INTEGRATION_MANIFEST_TOO_LARGE: Too many routes.");
    const seen = new Set<string>();
    for (const item of args.capabilities) {
      if (!item.path.startsWith("/") || item.path.includes("://"))
        throw new Error(
          "INTEGRATION_ROUTE_INVALID: Route paths must be relative.",
        );
      const key = `GET ${item.path}`;
      if (seen.has(key)) throw new Error(`INTEGRATION_ROUTE_DUPLICATE: ${key}`);
      seen.add(key);
      if (
        item.permissionState === "read_only" &&
        item.verificationStatus === "verified" &&
        !item.responseSchemaHash
      )
        throw new Error(
          `INTEGRATION_CONTRACT_REQUIRED: ${key} needs a verified schema hash.`,
        );
    }
    const existing = await ctx.db
      .query("integrationCapabilities")
      .withIndex("by_integration", (q) =>
        q.eq("integrationId", integration._id),
      )
      .collect();
    for (const item of existing) await ctx.db.delete(item._id);
    const now = Date.now();
    const inserted: Array<Id<"integrationCapabilities">> = [];
    for (const item of args.capabilities) {
      inserted.push(
        await ctx.db.insert("integrationCapabilities", {
          integrationId: integration._id,
          schoolId: actor.schoolId,
          category: text(item.category, 100),
          name: text(item.name, 160),
          recordType: text(item.recordType, 100),
          method: "GET",
          path: item.path.slice(0, 1_000),
          purpose: text(item.purpose, 300),
          scope: item.scope,
          minimumRole: item.minimumRole,
          pagination: item.pagination,
          changeStrategy: item.changeStrategy,
          freshnessSlaMinutes: Math.max(
            5,
            Math.min(10_080, Math.round(item.freshnessSlaMinutes)),
          ),
          contractVersion: text(item.contractVersion, 100),
          responseSchemaHash: item.responseSchemaHash?.slice(0, 180),
          permissionState: item.permissionState,
          verificationStatus: item.verificationStatus,
          routeSource: item.routeSource,
          personalIdParameter: item.personalIdParameter?.slice(0, 120),
          normalization: item.normalization,
          lastVerifiedAt:
            item.verificationStatus === "verified" ? now : undefined,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    const capabilityRows = (
      await Promise.all(inserted.map((id) => ctx.db.get(id)))
    ).filter((item): item is Doc<"integrationCapabilities"> => Boolean(item));
    await ctx.db.patch(integration._id, {
      manifestVersion: integration.manifestVersion + 1,
      manifestSourceHash: args.sourceHash.slice(0, 180),
      providerVersion: args.providerVersion?.slice(0, 100),
      capabilityCoverage: coverage(capabilityRows),
      status: capabilityRows.some(
        (item) =>
          item.permissionState === "read_only" &&
          item.verificationStatus === "verified",
      )
        ? "connected"
        : "blocked",
      blockedReason:
        capabilityRows.length === 0
          ? "No tenant-reference routes have been imported."
          : capabilityRows.some(
                (item) =>
                  item.permissionState === "read_only" &&
                  item.verificationStatus === "verified",
              )
            ? undefined
            : "No readable route has a verified response contract.",
      lastValidatedAt: now,
      updatedByAccountId: actor.accountId,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.manifest_replaced",
      targetType: "school_integration",
      targetId: integration._id,
      metadata: {
        routeCount: capabilityRows.length,
        verifiedReadable: coverage(capabilityRows).verifiedReadable,
        sourceHash: args.sourceHash.slice(0, 180),
      },
      retentionClass: "security",
    });
    return {
      integrationId: integration._id,
      manifestVersion: integration.manifestVersion + 1,
      coverage: coverage(capabilityRows),
    };
  },
});

export const adminOverview = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireSchoolAdmin(ctx);
    const periodMaps = await ctx.db
      .query("calendarPeriodMaps")
      .withIndex("by_school_updated", (q) => q.eq("schoolId", actor.schoolId))
      .collect();
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (!integration)
      return {
        integration: null,
        periodMaps,
        capabilities: [],
        syncRuns: [],
        conflicts: [],
        quarantine: [],
        identityQueue: [],
      };
    const [
      capabilities,
      syncRuns,
      conflicts,
      quarantine,
      ambiguousIdentityQueue,
      noMatchIdentityQueue,
      schoolRecords,
    ] = await Promise.all([
      ctx.db
        .query("integrationCapabilities")
        .withIndex("by_integration", (q) =>
          q.eq("integrationId", integration._id),
        )
        .collect(),
      ctx.db
        .query("externalSyncRuns")
        .withIndex("by_integration_created", (q) =>
          q.eq("integrationId", integration._id),
        )
        .order("desc")
        .take(50),
      ctx.db
        .query("externalSyncConflicts")
        .withIndex("by_integration_status", (q) =>
          q.eq("integrationId", integration._id).eq("status", "open"),
        )
        .take(100),
      ctx.db
        .query("externalQuarantineRecords")
        .withIndex("by_integration_status", (q) =>
          q.eq("integrationId", integration._id).eq("status", "open"),
        )
        .take(100),
      ctx.db
        .query("externalIdentityMappings")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", actor.schoolId).eq("status", "ambiguous"),
        )
        .take(100)
        .then((rows) =>
          rows.filter((item) => item.integrationId === integration._id),
        ),
      ctx.db
        .query("externalIdentityMappings")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", actor.schoolId).eq("status", "no_match"),
        )
        .take(100)
        .then((rows) =>
          rows.filter((item) => item.integrationId === integration._id),
        ),
      ctx.db
        .query("externalRecords")
        .withIndex("by_school_updated", (q) => q.eq("schoolId", actor.schoolId))
        .order("desc")
        .take(500),
    ]);
    const school = await ctx.db.get(actor.schoolId);
    return {
      integration: safeIntegration(integration),
      periodMaps,
      school: school ? { _id: school._id, name: school.name } : null,
      capabilities,
      syncRuns,
      conflicts,
      quarantine,
      previews: schoolRecords
        .filter(
          (item) =>
            item.integrationId === integration._id &&
            !item.mappedAccountId &&
            item.classification !== "personal" &&
            item.audienceScope !== "mapped_user",
        )
        .slice(0, 120)
        .map((item) => ({
          _id: item._id,
          recordType: item.recordType,
          providerClassId: item.providerClassId,
          academicPeriodKey: item.academicPeriodKey,
          normalized: item.normalized,
          sourceModifiedAt: item.sourceModifiedAt,
          fetchedAt: item.fetchedAt,
          tombstone: item.tombstone,
          provenanceUrl: item.provenanceUrl,
        })),
      identityQueue: await Promise.all(
        [...ambiguousIdentityQueue, ...noMatchIdentityQueue].map(
          async (mapping) => {
            const account = await ctx.db.get(mapping.accountId);
            return {
              mappingId: mapping._id,
              account: account
                ? { name: account.name, email: account.email }
                : null,
              status: mapping.status,
              matchCount: mapping.matchCount,
              updatedAt: mapping.updatedAt,
            };
          },
        ),
      ),
    };
  },
});

export const upsertCalendarPeriodMap = mutation({
  args: {
    periodKey: v.string(),
    label: v.string(),
    startMinutes: v.number(),
    endMinutes: v.number(),
    timezone: v.string(),
    weekdays: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSchoolAdmin(ctx);
    const periodKey = args.periodKey.trim().slice(0, 120);
    const label = args.label.trim().slice(0, 160);
    const timezone = args.timezone.trim().slice(0, 100);
    const weekdays = [...new Set(args.weekdays.map(Math.floor))].filter(
      (weekday) => weekday >= 0 && weekday <= 6,
    );
    if (!periodKey || !label || !timezone)
      throw new Error("CALENDAR_PERIOD_REQUIRED: Key, label, and timezone are required.");
    if (
      !Number.isInteger(args.startMinutes) ||
      !Number.isInteger(args.endMinutes) ||
      args.startMinutes < 0 ||
      args.endMinutes > 24 * 60 ||
      args.endMinutes <= args.startMinutes
    )
      throw new Error("CALENDAR_PERIOD_TIME_INVALID: Choose a valid start and end time.");
    if (!weekdays.length)
      throw new Error("CALENDAR_PERIOD_WEEKDAYS_REQUIRED: Choose at least one weekday.");
    const existing = await ctx.db
      .query("calendarPeriodMaps")
      .withIndex("by_school_period", (q) =>
        q.eq("schoolId", actor.schoolId).eq("periodKey", periodKey),
      )
      .unique();
    const now = Date.now();
    const value = {
      label,
      startMinutes: args.startMinutes,
      endMinutes: args.endMinutes,
      timezone,
      weekdays,
      verifiedByAccountId: actor.accountId,
      verifiedAt: now,
      source: "school_admin" as const,
      updatedAt: now,
    };
    const periodMapId = existing
      ? (await ctx.db.patch(existing._id, value), existing._id)
      : await ctx.db.insert("calendarPeriodMaps", {
          schoolId: actor.schoolId,
          periodKey,
          ...value,
          createdAt: now,
        });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.period_map.upserted",
      targetType: "calendar_period_map",
      targetId: periodMapId,
      metadata: { periodKey, timezone },
      retentionClass: "security",
    });
    return { periodMapId, verifiedAt: now };
  },
});

export const removeCalendarPeriodMap = mutation({
  args: { periodMapId: v.id("calendarPeriodMaps") },
  handler: async (ctx, args) => {
    const actor = await requireSchoolAdmin(ctx);
    const period = await ctx.db.get(args.periodMapId);
    if (!period || period.schoolId !== actor.schoolId)
      throw new Error("CALENDAR_PERIOD_NOT_FOUND");
    await ctx.db.delete(period._id);
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.period_map.removed",
      targetType: "calendar_period_map",
      targetId: period._id,
      metadata: { periodKey: period.periodKey },
      retentionClass: "security",
    });
    return { removed: true };
  },
});

export const myOverview = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (!integration || integration.status === "revoked")
      return {
        integration: null,
        mapping: null,
        capabilities: [],
        syncRuns: [],
        conflicts: [],
        records: [],
      };
    const mapping = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) =>
        q.eq("integrationId", integration._id).eq("accountId", actor.accountId),
      )
      .unique();
    const selectedClassKeys = new Set(
      (await ctx.db
        .query("managebacClassSelections")
        .withIndex("by_account_integration", (q) =>
          q.eq("accountId", actor.accountId).eq("integrationId", integration._id),
        )
        .collect())
        .filter((row) => row.selected)
        .map((row) => `${row.providerClassId}|${row.academicPeriodKey ?? "unknown"}`),
    );
    const [capabilities, syncRuns, conflicts, records] = await Promise.all([
      ctx.db
        .query("integrationCapabilities")
        .withIndex("by_integration", (q) =>
          q.eq("integrationId", integration._id),
        )
        .collect(),
      ctx.db
        .query("externalSyncRuns")
        .withIndex("by_account_created", (q) =>
          q.eq("accountId", actor.accountId),
        )
        .order("desc")
        .take(30)
        .then((rows) =>
          rows.filter(
            (item) =>
              item.integrationId === integration._id &&
              item.schoolId === actor.schoolId &&
              (!item.providerClassId ||
                selectedClassKeys.has(`${item.providerClassId}|${item.academicPeriodKey ?? "unknown"}`) ||
                selectedClassKeys.has(`${item.providerClassId}|unknown`)),
          ),
        ),
      ctx.db
        .query("externalSyncConflicts")
        .withIndex("by_account_status", (q) =>
          q.eq("accountId", actor.accountId).eq("status", "open"),
        )
        .take(100)
        .then((rows) =>
          rows.filter(
            (item) =>
              item.integrationId === integration._id &&
              item.schoolId === actor.schoolId,
          ),
        ),
      ctx.db
        .query("externalRecords")
        .withIndex("by_account_type", (q) =>
          q.eq("mappedAccountId", actor.accountId),
        )
        .order("desc")
        .take(2_000)
        .then((rows) =>
          rows.filter(
            (item) =>
              item.integrationId === integration._id &&
              item.schoolId === actor.schoolId,
          ),
        ),
    ]);
    return {
      integration: safeIntegration(integration),
      mapping: mapping
        ? {
            status: mapping.status,
            matchCount:
              mapping.status === "ambiguous" ? undefined : mapping.matchCount,
            resolvedAt: mapping.resolvedAt,
            updatedAt: mapping.updatedAt,
          }
        : null,
      capabilities: capabilities.map((item) => ({
        _id: item._id,
        category: item.category,
        name: item.name,
        recordType: item.recordType,
        purpose: item.purpose,
        scope: item.scope,
        permissionState: item.permissionState,
        verificationStatus: item.verificationStatus,
        freshnessSlaMinutes: item.freshnessSlaMinutes,
        lastVerifiedAt: item.lastVerifiedAt,
        lastSuccessAt: item.lastSuccessAt,
        lastErrorCode: item.lastErrorCode,
      })),
      syncRuns,
      conflicts,
      records: records.map((item) => ({
        _id: item._id,
        recordType: item.recordType,
        classification: item.classification,
        audienceScope: item.audienceScope,
        sourceIdentityKey: item.sourceIdentityKey,
        providerClassId: item.providerClassId,
        academicPeriodKey: item.academicPeriodKey,
        normalized: item.normalized,
        sourceHash: item.sourceHash,
        sourceModifiedAt: item.sourceModifiedAt,
        fetchedAt: item.fetchedAt,
        tombstone: item.tombstone,
        sourceState: item.sourceState ?? (item.tombstone ? "removed" : "available"),
        sourceStateReason: item.sourceStateReason,
        provenanceUrl: item.provenanceUrl,
      })),
    };
  },
});

/** At most this many student jobs read one school's ManageBac at once, so per-student syncs
 * share the school's API budget instead of multiplying it. */
const MAX_RUNNING_STUDENT_JOBS = 2;
/** A claimed job is due again after this if nothing finishes, fails or suspends it first. */
const JOB_WATCHDOG_MS = SYNC_LEASE_MS + 60_000;

async function runningStudentJobs(ctx: MutationCtx, integrationId: Id<"schoolIntegrations">, now: number) {
  const rows = (
    await Promise.all(
      (["leased", "running"] as const).map((status) =>
        ctx.db
          .query("externalSyncRuns")
          .withIndex("by_integration_status", (q) => q.eq("integrationId", integrationId).eq("status", status))
          .take(50),
      ),
    )
  ).flat();
  return rows.filter((row) =>
    row.accountId !== undefined && row.syncKind !== undefined && !row.projectionIngestionComplete &&
    (row.leaseExpiresAt ?? 0) > now).length;
}

function runTrigger(trigger: SyncTrigger) {
  return trigger === "schedule" ? ("schedule" as const) : trigger === "ai" ? ("ai" as const) : ("user" as const);
}

function triggerOfRun(run: Doc<"externalSyncRuns">): SyncTrigger {
  return run.trigger === "schedule" ? "schedule" : run.trigger === "ai" ? "ai" : "user";
}

function stateScope(run: { accountId?: Id<"accounts">; schoolId: Id<"schools">; integrationId: Id<"schoolIntegrations">; syncKind?: SchoolSyncKind }) {
  return run.accountId && run.syncKind
    ? { accountId: run.accountId, schoolId: run.schoolId, integrationId: run.integrationId, kind: run.syncKind }
    : null;
}

/**
 * Starts (or continues) one student's job for one kind of data. The job reads only what the
 * student's modes admit for its trigger, computed here: the route never chooses targets.
 */
async function startStudentJob(
  ctx: MutationCtx,
  input: {
    integration: Doc<"schoolIntegrations">;
    actor: Actor;
    mapping: Doc<"externalIdentityMappings"> | null;
    syncKind: SchoolSyncKind;
    trigger: SyncTrigger;
    leaseOwner: string;
    now: number;
  },
) {
  const { integration, actor, syncKind, trigger, now } = input;
  const label = SCHOOL_SYNC_KIND_INFO[syncKind].label;
  const preferences = await loadSyncPreferences(ctx, actor.accountId, integration._id);
  if (!preferences.hasAny(syncKind))
    throw new Error(`SCHOOL_SYNC_KIND_OFF: ${label} is turned off.`);
  const capabilities = await ctx.db
    .query("integrationCapabilities")
    .withIndex("by_integration", (q) => q.eq("integrationId", integration._id))
    .collect();
  const readable = capabilities.filter(
    (item) =>
      item.permissionState === "read_only" &&
      item.verificationStatus === "verified" &&
      (item.scope === "personal" || Boolean(item.personalIdParameter)) &&
      capabilitySyncKinds(item).includes(syncKind),
  );
  if (readable.length === 0)
    throw new Error(`INTEGRATION_ENDPOINT_UNAVAILABLE: ManageBac has no readable route for ${label.toLowerCase()}.`);
  if (await activeRunForScope(ctx, integration._id, actor.accountId, syncKind, now))
    throw new Error(`INTEGRATION_SYNC_BUSY: ${label} is already syncing.`);
  const selection = await selectionSnapshot(ctx, integration._id, actor.accountId);
  const targets = await syncTargets(ctx, {
    integration, accountId: actor.accountId, kind: syncKind, trigger, preferences, mapping: input.mapping,
  });
  const identity = await passIdentity(ctx, integration, actor.accountId, syncKind, targets);
  const scope = { accountId: actor.accountId, schoolId: integration.schoolId, integrationId: integration._id, kind: syncKind };
  const running = (syncRunId: Id<"externalSyncRuns">) => writeSyncState(ctx, scope, {
    state: "running",
    dueAt: now + JOB_WATCHDOG_MS,
    dueTrigger: trigger,
    lastRunAt: now,
    lastSyncRunId: syncRunId,
    errorCode: undefined,
    errorSummary: undefined,
  });
  // A newer request continues a pass that stopped part-way, unless what
  // the pass depends on changed; then that pass is dropped unreconciled.
  const suspended = await suspendedPass(ctx, integration._id, actor.accountId, syncKind);
  const restartReason = suspended
    ? passRestartReason(suspended.run, suspended.pass, identity, readable.map((item) => item._id), now, selection.revision)
    : null;
  if (suspended && !restartReason) {
    const resumed = await resumePass(ctx, suspended.run, suspended.pass, input.leaseOwner, now);
    await running(suspended.run._id);
    return {
      syncRunId: suspended.run._id,
      integrationId: integration._id,
      leaseToken: resumed.leaseToken,
      selectionRevision: suspended.run.selectionRevision ?? 0,
      syncKind,
      pass: passForRoute(resumed.pass),
    };
  }
  if (suspended && restartReason)
    await abandonPass(ctx, suspended.run, restartReason, now);
  const pass = newPass(identity, now);
  const leaseToken = crypto.randomUUID();
  const syncRunId = await ctx.db.insert("externalSyncRuns", {
    integrationId: integration._id,
    schoolId: integration.schoolId,
    accountId: actor.accountId,
    kind: trigger === "schedule" ? "scheduled" : "manual",
    status: "leased",
    trigger: runTrigger(trigger),
    stage: "claimed",
    capabilityIds: readable.map((item) => item._id),
    cursorState: pass,
    counts: EMPTY_COUNTS,
    leaseOwner: input.leaseOwner,
    leaseToken,
    leaseExpiresAt: now + SYNC_LEASE_MS,
    selectionRevision: selection.revision,
    syncKind,
    attemptCount: 1,
    nextAttemptAt: now,
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  for (const capability of readable)
    await ctx.db.insert("externalSyncCapabilityRuns", {
      syncRunId,
      integrationId: integration._id,
      capabilityId: capability._id,
      status: "queued",
      pageCount: 0,
      recordCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  await running(syncRunId);
  return {
    syncRunId,
    integrationId: integration._id,
    leaseToken,
    selectionRevision: selection.revision,
    syncKind,
    pass: passForRoute(pass),
  };
}

function connectorActor(actor: Actor) {
  return {
    clerkId: actor.clerkId,
    accountId: actor.accountId,
    email: actor.email,
    name: actor.name,
    schoolId: actor.schoolId,
    schoolRole: actor.schoolRole,
    membershipId: actor.membershipId,
  };
}

/** The next student job that is due, claimed as that student. */
async function claimStudentJob(
  ctx: MutationCtx,
  workerId: string,
  now: number,
  verify: (actor: Actor) => Promise<void>,
) {
  const due = await ctx.db
    .query("schoolSyncStates")
    .withIndex("by_due", (q) => q.gte("dueAt", 0).lte("dueAt", now))
    .take(20);
  const busy = new Map<string, number>();
  for (const state of due) {
    const actor = await getActorForAccountId(ctx, state.accountId);
    if (!actor) continue;
    // Nothing is written before the worker's signature is checked.
    await verify(actor);
    const scope = { accountId: state.accountId, schoolId: state.schoolId, integrationId: state.integrationId, kind: state.kind };
    const integration = await ctx.db.get(state.integrationId);
    if (!integration || integration.schoolId !== state.schoolId || actor.schoolId !== state.schoolId ||
        !["connected", "degraded"].includes(integration.status)) {
      await writeSyncState(ctx, scope, {
        state: "blocked", dueAt: undefined, dueTrigger: undefined,
        errorCode: "INTEGRATION_NOT_READY", errorSummary: "ManageBac isn't connected for this school.",
      });
      continue;
    }
    const mapping = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) => q.eq("integrationId", integration._id).eq("accountId", state.accountId))
      .unique();
    if (!mapping || mapping.status !== "verified") {
      await writeSyncState(ctx, scope, {
        state: "blocked", dueAt: undefined, dueTrigger: undefined,
        errorCode: "INTEGRATION_IDENTITY_REQUIRED", errorSummary: "Spectra hasn't matched this student to ManageBac yet.",
      });
      continue;
    }
    const trigger = state.dueTrigger ?? "schedule";
    const preferences = await loadSyncPreferences(ctx, state.accountId, integration._id);
    if (!preferences.hasAny(state.kind) || (trigger === "schedule" && !preferences.hasAuto(state.kind))) {
      await writeSyncState(ctx, scope, { state: "idle", dueAt: undefined, dueTrigger: undefined });
      continue;
    }
    const running = busy.get(integration._id) ?? (await runningStudentJobs(ctx, integration._id, now));
    busy.set(integration._id, running);
    if (running >= MAX_RUNNING_STUDENT_JOBS) continue;
    if (await activeRunForScope(ctx, integration._id, state.accountId, state.kind, now)) continue;
    try {
      const started = await startStudentJob(ctx, {
        integration, actor, mapping, syncKind: state.kind, trigger, leaseOwner: workerId, now,
      });
      return {
        ...started,
        schoolId: integration.schoolId,
        serviceSubject: actor.clerkId,
        actor: connectorActor(actor),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const code = message.match(/^([A-Z0-9_]+)/)?.[1] ?? "SCHOOL_SYNC_FAILED";
      await writeSyncState(ctx, scope, {
        state: code === "SCHOOL_SYNC_KIND_OFF" ? "idle" : "blocked",
        dueAt: undefined,
        dueTrigger: undefined,
        ...(code === "SCHOOL_SYNC_KIND_OFF" ? {} : { errorCode: code, errorSummary: message.replace(/^[A-Z0-9_]+:\s*/, "").slice(0, 500) }),
      });
    }
  }
  return null;
}

export const claimScheduledSync = mutation({
  args: {
    workerId: v.string(),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const workerId = text(args.workerId, 200);
    if ((await exactDigest({ workerId })) !== args.payloadDigest)
      throw new Error(
        "INTEGRATION_PAYLOAD_INVALID: Scheduled claim payload changed.",
      );
    let verified = false;
    const verify = async (actor: Actor) => {
      if (verified) return;
      await verifyScheduledClaim(ctx, actor, args);
      verified = true;
    };
    // Students' own jobs first: each kind of data on its own schedule.
    const studentJob = await claimStudentJob(ctx, workerId, now, verify);
    if (studentJob) return studentJob;
    // Then the school-wide reconciliation of shared (non-personal) routes.
    const due = (
      await Promise.all(
        (["connected", "degraded"] as const).map((status) =>
          ctx.db
            .query("schoolIntegrations")
            .withIndex("by_status_next_sync", (q) =>
              q.eq("status", status).lte("nextSyncAt", now),
            )
            .take(20),
        ),
      )
    )
      .flat()
      .filter(
        (integration) =>
          integration.status === "connected" || !integration.blockedReason,
      )
      .sort(
        (a, b) => (a.nextSyncAt ?? a.createdAt) - (b.nextSyncAt ?? b.createdAt),
    );
    for (const integration of due) {
      const admins = await ctx.db
        .query("schoolMemberships")
        .withIndex("by_school_role", (q) =>
          q.eq("schoolId", integration.schoolId).eq("role", "school_admin"),
        )
        .collect();
      const activeAdmins = admins.filter((item) => item.status === "active");
      const preferred =
        activeAdmins.find(
          (item) => item.accountId === integration.createdByAccountId,
        ) ?? activeAdmins[0];
      const actor = preferred ? await getActorForAccountId(ctx, preferred.accountId) : null;
      if (!actor) continue;
      await verify(actor);
      if (await activeRunForScope(ctx, integration._id, undefined, undefined, now))
        continue;
      const capabilities = await ctx.db
        .query("integrationCapabilities")
        .withIndex("by_integration", (q) =>
          q.eq("integrationId", integration._id),
        )
        .collect();
      const readable = capabilities.filter(
        (item) =>
          item.permissionState === "read_only" &&
          item.verificationStatus === "verified" &&
          item.scope !== "personal",
      );
      if (readable.length === 0) {
        // Personal routes are read by each student's own jobs; with no
        // shared route there is no school-wide reconciliation to run.
        await ctx.db.patch(integration._id, { nextSyncAt: undefined, updatedAt: now });
        continue;
      }
      const started = await startSchoolReconciliation(ctx, integration, actor, readable, workerId, "schedule", now);
      const nextSyncAt =
        now + integration.syncPolicy.frequencyMinutes * 60_000;
      await ctx.db.patch(integration._id, {
        nextSyncAt,
        blockedReason: undefined,
        updatedAt: now,
      });
      await scheduleSync(ctx, integration._id, nextSyncAt);
      return {
        ...started,
        schoolId: integration.schoolId,
        serviceSubject: actor.clerkId,
        actor: connectorActor(actor),
      };
    }
    return null;
  },
});

/** Starts (or continues) the school-wide reconciliation of shared routes. */
async function startSchoolReconciliation(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  actor: Actor,
  readable: Array<Doc<"integrationCapabilities">>,
  leaseOwner: string,
  trigger: "schedule" | "school_admin",
  now: number,
) {
  const identity = await passIdentity(ctx, integration, actor.accountId, undefined);
  // A school pass that stopped at its time budget continues here.
  const suspended = await suspendedPass(ctx, integration._id, undefined, undefined);
  const restartReason = suspended
    ? passRestartReason(suspended.run, suspended.pass, identity, readable.map((item) => item._id), now)
    : null;
  if (suspended && !restartReason) {
    const resumed = await resumePass(ctx, suspended.run, suspended.pass, leaseOwner, now);
    return {
      integrationId: integration._id,
      syncRunId: suspended.run._id,
      leaseToken: resumed.leaseToken,
      selectionRevision: 0,
      pass: passForRoute(resumed.pass),
    };
  }
  if (suspended && restartReason)
    await abandonPass(ctx, suspended.run, restartReason, now);
  const leaseToken = crypto.randomUUID();
  const pass = newPass(identity, now);
  const syncRunId = await ctx.db.insert("externalSyncRuns", {
    integrationId: integration._id,
    schoolId: integration.schoolId,
    kind: trigger === "schedule" ? "scheduled" : "reconciliation",
    status: "leased",
    trigger,
    stage: "claimed",
    capabilityIds: readable.map((item) => item._id),
    cursorState: pass,
    counts: EMPTY_COUNTS,
    leaseOwner,
    leaseToken,
    leaseExpiresAt: now + SYNC_LEASE_MS,
    attemptCount: 1,
    nextAttemptAt: now,
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  for (const capability of readable)
    await ctx.db.insert("externalSyncCapabilityRuns", {
      syncRunId,
      integrationId: integration._id,
      capabilityId: capability._id,
      status: "queued",
      pageCount: 0,
      recordCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  return {
    integrationId: integration._id,
    syncRunId,
    leaseToken,
    selectionRevision: 0,
    pass: passForRoute(pass),
  };
}

export const connectorContext = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    serviceSubject: v.optional(v.string()),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorOrService(ctx, args.serviceSubject);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    await verifyBridge(ctx, actor, {
      operation: "context",
      integrationId: integration._id,
      timestamp: args.timestamp,
      nonce: args.nonce,
      payloadDigest: args.payloadDigest,
      signature: args.signature,
    });
    const [capabilities, mapping, selection] = await Promise.all([
      ctx.db
        .query("integrationCapabilities")
        .withIndex("by_integration", (q) =>
          q.eq("integrationId", integration._id),
        )
        .collect(),
      ctx.db
        .query("externalIdentityMappings")
        .withIndex("by_integration_account", (q) =>
          q
            .eq("integrationId", integration._id)
            .eq("accountId", actor.accountId),
        )
        .unique(),
      selectionSnapshot(ctx, integration._id, actor.accountId),
    ]);
    return {
      integration: {
        _id: integration._id,
        schoolId: integration.schoolId,
        baseUrl: integration.baseUrl,
        authHeaderName: integration.authHeaderName,
        authScheme: integration.authScheme,
        requestBudgetPerMinute: integration.requestBudgetPerMinute,
        bootstrapVersion: integration.bootstrapVersion,
        status: integration.status,
      },
      capabilities: capabilities
        .filter(
          (item) =>
            item.permissionState === "read_only" &&
            item.verificationStatus === "verified",
        )
        .map((item) => ({
          _id: item._id,
          category: item.category,
          name: item.name,
          recordType: item.recordType,
          path: item.path,
          purpose: item.purpose,
          scope: item.scope,
          minimumRole: item.minimumRole,
          pagination: item.pagination,
          changeStrategy: item.changeStrategy,
          contractVersion: item.contractVersion,
          responseSchemaHash: item.responseSchemaHash,
          personalIdParameter: item.personalIdParameter,
          normalization: item.normalization,
        })),
      mapping:
        mapping?.status === "verified"
          ? {
              status: mapping.status,
              providerUserId: mapping.providerUserId,
            }
          : { status: mapping?.status ?? "pending" },
      selection,
      actor: {
        accountId: actor.accountId,
        email: actor.email,
        schoolRole: actor.schoolRole,
      },
    };
  },
});

export const beginSync = mutation({
  args: {
    /** identity: resolve the student; manual: one student job for `syncKind`;
     * reconciliation: the school-wide pass over shared routes (administrators). */
    kind: v.union(
      v.literal("identity"),
      v.literal("manual"),
      v.literal("reconciliation"),
    ),
    syncKind: v.optional(vSchoolSyncKind),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (
      !integration ||
      !["connected", "degraded"].includes(integration.status)
    )
      throw new Error(
        "INTEGRATION_NOT_READY: ManageBac must be connected with verified readable capabilities.",
      );
    const now = Date.now();
    const capabilities = await ctx.db
      .query("integrationCapabilities")
      .withIndex("by_integration", (q) =>
        q.eq("integrationId", integration._id),
      )
      .collect();
    const readable = capabilities.filter(
      (item) =>
        item.permissionState === "read_only" &&
        item.verificationStatus === "verified",
    );
    if (readable.length === 0)
      throw new Error("INTEGRATION_CAPABILITY_REQUIRED: No route is verified.");
    if (args.kind === "reconciliation") {
      if (actor.schoolRole !== "school_admin")
        throw new Error("AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.");
      const shared = readable.filter((item) => item.scope !== "personal");
      if (shared.length === 0)
        throw new Error("INTEGRATION_CAPABILITY_REQUIRED: No shared school route is verified.");
      if (await activeRunForScope(ctx, integration._id, undefined, undefined, now))
        throw new Error("INTEGRATION_SYNC_BUSY: The school reconciliation is already running.");
      return startSchoolReconciliation(ctx, integration, actor, shared, actor.clerkId, "school_admin", now);
    }
    if (args.kind === "identity") {
      if (await activeRunForScope(ctx, integration._id, actor.accountId, undefined, now))
        throw new Error(
          "INTEGRATION_SYNC_BUSY: A sync for this account and connection is already running.",
        );
      const leaseToken = crypto.randomUUID();
      const capabilityIds = readable
        .filter((item) => item.recordType === "person" || item.recordType === "membership")
        .map((item) => item._id);
      const syncRunId = await ctx.db.insert("externalSyncRuns", {
        integrationId: integration._id,
        schoolId: actor.schoolId,
        accountId: actor.accountId,
        kind: "identity",
        status: "queued",
        trigger: actor.schoolRole === "school_admin" ? "school_admin" : "user",
        stage: "resolving_identity",
        capabilityIds,
        counts: EMPTY_COUNTS,
        leaseOwner: actor.clerkId,
        leaseToken,
        leaseExpiresAt: now + SYNC_LEASE_MS,
        attemptCount: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      });
      for (const capabilityId of capabilityIds)
        await ctx.db.insert("externalSyncCapabilityRuns", {
          syncRunId,
          integrationId: integration._id,
          capabilityId,
          status: "queued",
          pageCount: 0,
          recordCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      // Identity runs read fixed routes; there is no pass to continue.
      return { syncRunId, integrationId: integration._id, leaseToken, selectionRevision: 0, pass: undefined };
    }
    if (!args.syncKind)
      throw new Error("SCHOOL_SYNC_KIND_REQUIRED: Choose which kind of School data to sync.");
    const mapping = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) =>
        q.eq("integrationId", integration._id).eq("accountId", actor.accountId),
      )
      .unique();
    if (!mapping || mapping.status !== "verified")
      throw new Error(
        "INTEGRATION_IDENTITY_REQUIRED: Resolve your school identity first.",
      );
    return startStudentJob(ctx, {
      integration, actor, mapping, syncKind: args.syncKind, trigger: "user", leaseOwner: actor.clerkId, now,
    });
  },
});

/** How soon the AI may ask for School data again, so it never thrashes ManageBac. */
const AI_REFRESH_COOLDOWN_MS = 15 * 60_000;

/**
 * AI-triggered refresh: queues this student's jobs (every kind not Off) for the background
 * worker. The AI harness reads the result shape below; keep it.
 */
export const requestAiRefresh = mutation({
  args: {
    reason: v.optional(v.string()),
    force: v.optional(v.boolean()),
    /** The kinds the AI needs fresher; every kind not Off when omitted. */
    kinds: v.optional(v.array(vSchoolSyncKind)),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (!integration || integration.status !== "connected")
      return {
        started: false,
        skipped: true,
        reason: "not_connected" as const,
      };
    const mapping = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) =>
        q
          .eq("integrationId", integration._id)
          .eq("accountId", actor.accountId),
      )
      .unique();
    if (!mapping || mapping.status !== "verified")
      return {
        started: false,
        skipped: true,
        reason: "identity_required" as const,
      };
    const now = Date.now();
    const preferences = await loadSyncPreferences(ctx, actor.accountId, integration._id);
    const kinds = SCHOOL_SYNC_KINDS.filter(
      (kind) => preferences.hasAny(kind) && (!args.kinds || args.kinds.includes(kind)),
    );
    const states = (
      await Promise.all(kinds.map((kind) => syncStateFor(ctx, actor.accountId, integration._id, kind)))
    ).filter((state): state is Doc<"schoolSyncStates"> => Boolean(state));
    const lastSyncAt = states.reduce<number | undefined>(
      (latest, state) => (state.lastSuccessAt !== undefined && (latest === undefined || state.lastSuccessAt > latest) ? state.lastSuccessAt : latest),
      undefined,
    );
    const lastRunAt = states.reduce((latest, state) => Math.max(latest, state.lastRunAt ?? 0), 0);
    const cooldownMs = args.force ? 2 * 60_000 : AI_REFRESH_COOLDOWN_MS;
    if (lastRunAt && now - lastRunAt < cooldownMs)
      return {
        started: false,
        skipped: true,
        reason: "fresh" as const,
        lastSyncAt,
        nextEligibleAt: lastRunAt + cooldownMs,
      };
    if (states.some((state) => state.state === "running" && (state.dueAt ?? 0) > now))
      return {
        started: false,
        skipped: true,
        reason: "already_running" as const,
        lastSyncAt,
      };
    for (const kind of kinds)
      await queueSyncJob(ctx, { accountId: actor.accountId, schoolId: actor.schoolId, integrationId: integration._id, kind }, "ai", now);
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.ai_refresh",
      targetType: "school_integration",
      targetId: integration._id,
      metadata: {
        reason: (args.reason ?? "stale_school_data").slice(0, 240),
        kinds: kinds.join(","),
        nextSyncAt: now,
      },
      retentionClass: "operational",
    });
    return {
      started: kinds.length > 0,
      skipped: kinds.length === 0,
      lastSyncAt,
      nextSyncAt: now,
    };
  },
});

export const commitIdentityResolution = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    syncRunId: v.id("externalSyncRuns"),
    matchCount: v.number(),
    providerUserId: v.optional(v.string()),
    providerUserIdHash: v.optional(v.string()),
    verifiedEmailHash: v.string(),
    evidenceCapabilityId: v.optional(v.id("integrationCapabilities")),
    /** The student's year group, which CAS is read through. */
    providerYearGroupId: v.optional(v.string()),
    leaseToken: v.optional(v.string()),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    const syncRun = await ctx.db.get(args.syncRunId);
    if (
      !syncRun ||
      syncRun.integrationId !== integration._id ||
      syncRun.accountId !== actor.accountId ||
      syncRun.kind !== "identity"
    )
      throw new Error("INTEGRATION_SYNC_FORBIDDEN: Identity run mismatch.");
    await assertCurrentSyncLease(ctx, syncRun, args.leaseToken);
    const expectedDigest = await exactDigest({
      matchCount: args.matchCount,
      ...(args.providerUserId ? { providerUserId: args.providerUserId } : {}),
      ...(args.providerUserIdHash
        ? { providerUserIdHash: args.providerUserIdHash }
        : {}),
      verifiedEmailHash: args.verifiedEmailHash,
      ...(args.evidenceCapabilityId
        ? { evidenceCapabilityId: args.evidenceCapabilityId }
        : {}),
      ...(args.providerYearGroupId ? { providerYearGroupId: args.providerYearGroupId } : {}),
      ...(args.leaseToken ? { leaseToken: args.leaseToken } : {}),
    });
    if (expectedDigest !== args.payloadDigest)
      throw new Error("INTEGRATION_PAYLOAD_INVALID: Identity payload changed.");
    await verifyBridge(ctx, actor, {
      operation: "identity",
      integrationId: integration._id,
      syncRunId: syncRun._id,
      timestamp: args.timestamp,
      nonce: args.nonce,
      payloadDigest: args.payloadDigest,
      signature: args.signature,
    });
    const matchCount = Math.max(0, Math.floor(args.matchCount));
    if (matchCount === 1 && !args.providerUserId)
      throw new Error("INTEGRATION_IDENTITY_INVALID: Exact match needs an id.");
    const existing = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) =>
        q.eq("integrationId", integration._id).eq("accountId", actor.accountId),
      )
      .unique();
    const now = Date.now();
    const status =
      matchCount === 1
        ? ("verified" as const)
        : matchCount === 0
          ? ("no_match" as const)
          : ("ambiguous" as const);
    const patch = {
      providerUserId: status === "verified" ? args.providerUserId : undefined,
      providerUserIdHash:
        status === "verified" ? args.providerUserIdHash : undefined,
      verifiedEmailHash: args.verifiedEmailHash.slice(0, 180),
      status,
      evidenceCapabilityId: args.evidenceCapabilityId,
      providerYearGroupId:
        status === "verified" && args.providerYearGroupId && /^\d{1,20}$/.test(args.providerYearGroupId.trim())
          ? args.providerYearGroupId.trim()
          : undefined,
      matchCount,
      resolvedAt: status === "verified" ? now : undefined,
      revokedAt: undefined,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else
      await ctx.db.insert("externalIdentityMappings", {
        integrationId: integration._id,
        schoolId: actor.schoolId,
        accountId: actor.accountId,
        ...patch,
        createdAt: now,
      });
    await ctx.db.patch(syncRun._id, {
      status: status === "verified" ? "completed" : "awaiting_review",
      stage: status,
      completedAt: status === "verified" ? now : undefined,
      counts: { ...syncRun.counts, fetched: matchCount },
      updatedAt: now,
    });
    // A newly matched student's Auto kinds start in the background. The
    // class list comes first, in the request that resolved the identity.
    if (status === "verified" && existing?.status !== "verified") {
      const preferences = await loadSyncPreferences(ctx, actor.accountId, integration._id);
      for (const kind of SCHOOL_SYNC_KINDS)
        if (kind !== "classes" && preferences.hasAuto(kind))
          await queueSyncJob(ctx, { accountId: actor.accountId, schoolId: actor.schoolId, integrationId: integration._id, kind }, "schedule", now);
    }
    return { status };
  },
});

async function ensureClassWorkspace(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  accountId: Id<"accounts">,
  source: Doc<"externalRecords">,
) {
  const providerKey = `class:${source.providerClassId ?? source.providerRecordId}:${source.academicPeriodKey ?? "current"}`;
  const existing = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q.eq("integrationId", integration._id).eq("providerKey", providerKey),
    )
    .collect()
    .then(
      (rows) =>
        rows.find(
          (item) =>
            item.schoolId === integration.schoolId &&
            item.accountId === accountId &&
            item.projectionType === "workspace",
        ) ?? null,
    );
  const normalized = record(source.normalized);
  const now = Date.now();
  const projectedTitle = text(
    normalized.name ?? normalized.title,
    180,
    "ManageBac class",
  );
  const capabilities = await ctx.db
    .query("integrationCapabilities")
    .withIndex("by_integration", (q) => q.eq("integrationId", integration._id))
    .collect();
  const availableCapabilities = capabilities
    .filter(
      (capability) =>
        capability.permissionState === "read_only" &&
        capability.verificationStatus === "verified" &&
        capability.lastSuccessAt !== undefined,
    )
    .map((capability) => capability.category);
  const missingCapabilities = capabilities
    .filter(
      (capability) =>
        capability.permissionState !== "read_only" ||
        capability.verificationStatus !== "verified" ||
        capability.lastErrorCode !== undefined,
    )
    .map((capability) => capability.category);
  const sourceContext = {
    provider: "managebac",
    integrationId: integration._id,
    sourceRecordId: source._id,
    providerClassId: source.providerClassId,
    academicPeriodKey: source.academicPeriodKey,
    sourceHash: source.sourceHash,
    freshAt: source.fetchedAt,
    projectedTitle,
    capabilityState:
      now - source.fetchedAt > integration.freshnessSlaMinutes * 60_000
        ? ("stale" as const)
        : missingCapabilities.length
          ? ("partial" as const)
          : ("available" as const),
    availableCapabilities: [...new Set(availableCapabilities)].sort(),
    missingCapabilities: [...new Set(missingCapabilities)].sort(),
  };
  if (existing) {
    const existingWorkspaceId =
      existing.projectionType === "workspace"
        ? ctx.db.normalizeId("spectraWorkspaces", existing.projectionId)
        : null;
    const existingWorkspace = existingWorkspaceId
      ? await ctx.db.get(existingWorkspaceId)
      : null;
    if (existingWorkspace) {
      const previouslyProjectedTitle =
        existingWorkspace.sourceContext?.projectedTitle;
      await ctx.db.patch(existingWorkspace._id, {
        ...(previouslyProjectedTitle &&
        existingWorkspace.title === previouslyProjectedTitle
          ? { title: projectedTitle }
          : {}),
        description:
          text(normalized.description, 600) ||
          `${text(normalized.course ?? normalized.programme, 120)} - Source-linked from ManageBac`,
        sourceContext,
        status: "active",
        updatedAt: now,
      });
      await ctx.db.patch(existing._id, {
        recordId: source._id,
        sourceHash: source.sourceHash,
        state: "active",
        updatedAt: now,
      });
      return {
        projection: (await ctx.db.get(existing._id))!,
        created: false,
        refreshed: true,
      };
    }
  }
  const workspaceId = await ctx.db.insert("spectraWorkspaces", {
    ownerAccountId: accountId,
    schoolId: integration.schoolId,
    title: projectedTitle,
    description: text(
      normalized.description ??
        `${text(normalized.course ?? normalized.programme, 120)} · Source-linked from ManageBac`,
      600,
    ),
    icon: "BookOpen",
    color: text(normalized.color, 32, "#429379"),
    starterKey: "managebac-class",
    sourceContext,
    status: "active",
    defaultView: "cards",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  });
  /* A projected class is a workspace like any other, so it is a place in the
     tree from the moment it exists (D32). Without this the class is real but
     unreachable: nothing in the Library or on the board can show a workspace
     that has no node. */
  const projected = await ctx.db.get(workspaceId);
  if (projected) await ensureWorkspaceNode(ctx, projected);
  if (existing) {
    await ctx.db.patch(existing._id, {
      recordId: source._id,
      projectionType: "workspace",
      projectionId: String(workspaceId),
      sourceHash: source.sourceHash,
      state: "active",
      updatedAt: now,
    });
    return {
      projection: (await ctx.db.get(existing._id))!,
      created: true,
      refreshed: false,
    };
  }
  const projectionId = await ctx.db.insert("externalProjections", {
    integrationId: integration._id,
    schoolId: integration.schoolId,
    recordId: source._id,
    accountId,
    projectionType: "workspace",
    projectionId: workspaceId,
    providerKey,
    sourceHash: source.sourceHash,
    state: "active",
    bootstrapVersion: integration.bootstrapVersion,
    createdAt: now,
    updatedAt: now,
  });
  return { projection: (await ctx.db.get(projectionId))!, created: true };
}

async function classWorkspaceId(
  ctx: MutationCtx,
  integrationId: Id<"schoolIntegrations">,
  accountId: Id<"accounts">,
  providerClassId?: string,
  academicPeriodKey?: string,
) {
  if (!providerClassId) return null;
  const providerKey = `class:${providerClassId}:${academicPeriodKey ?? "current"}`;
  const projection = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q.eq("integrationId", integrationId).eq("providerKey", providerKey),
    )
    .collect()
    .then(
      (rows) =>
        rows.find(
          (item) =>
            item.accountId === accountId && item.projectionType === "workspace",
        ) ?? null,
    );
  return projection?.projectionType === "workspace"
    ? ctx.db.normalizeId("spectraWorkspaces", projection.projectionId)
    : null;
}

async function ensurePlannerProjection(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  accountId: Id<"accounts">,
  source: Doc<"externalRecords">,
) {
  const sourceKey = projectionSourceKey(source);
  const providerKey = `planner:${sourceKey}`;
  const existingByKey = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q.eq("integrationId", integration._id).eq("providerKey", providerKey),
    )
    .collect();
  const existingByRecord = await ctx.db
    .query("externalProjections")
    .withIndex("by_record_type", (q) =>
      q.eq("recordId", source._id).eq("projectionType", "planner_task"),
    )
    .collect();
  const existing =
    existingByKey.find(
      (item) =>
        item.schoolId === integration.schoolId &&
        item.accountId === accountId &&
        item.projectionType === "planner_task",
    ) ??
    existingByRecord.find(
      (item) => item.schoolId === integration.schoolId && item.accountId === accountId,
    ) ??
    null;
  if (existing) {
    if (existing.providerKey !== providerKey || existing.state !== "active")
      await ctx.db.patch(existing._id, {
        providerKey,
        state: "active",
        updatedAt: Date.now(),
      });
    return {
      projection: (await ctx.db.get(existing._id))!,
      created: false,
    };
  }
  const normalized = record(source.normalized);
  const now = Date.now();
  const content = {
    ...(defaultArtifactContent("planner_task") as Record<string, unknown>),
    taskTitle: text(normalized.title ?? normalized.name, 240, "ManageBac task"),
    description: plainText(normalized.description, 20_000),
    status: "todo",
    priority:
      normalized.priority === "high" || normalized.priority === "low"
        ? normalized.priority
        : "medium",
    dueAt:
      typeof normalized.dueAt === "number"
        ? normalized.dueAt
        : typeof normalized.dueAt === "string" &&
            !Number.isNaN(Date.parse(normalized.dueAt))
          ? Date.parse(normalized.dueAt)
          : undefined,
    source: {
      provider: "managebac",
      externalId: source.providerRecordId,
      version: source.payloadVersion,
      hash: source.sourceHash,
      status: source.tombstone ? "removed" : "active",
      lockedFields: ["taskTitle", "description", "dueAt", "source"],
    },
    sourceRefs: [`managebac:${sourceKey}`],
    personalOverlay: {},
  };
  const title = text(
    normalized.title ?? normalized.name,
    240,
    "ManageBac task",
  );
  const artifactId = await ctx.db.insert("spectraArtifacts", {
    ownerAccountId: accountId,
    schoolId: integration.schoolId,
    blueprintKey: "planner_task",
    schemaVersion: defaultArtifactSchemaVersion("planner_task"),
    title,
    summary: plainText(
      normalized.description,
      600,
      "Source-linked ManageBac task",
    ),
    content,
    textIndex: buildArtifactTextIndex({
      title,
      summary: plainText(normalized.description, 600),
      content,
      tags: ["managebac", "source-linked"],
    }),
    tags: ["managebac", "source-linked"],
    status: "active",
    createdFrom: {
      source: "manual",
      contextSummary: `ManageBac ${source.recordType} ${source.providerRecordKey}`,
    },
    createdAt: now,
    updatedAt: now,
  });
  const workspaceId = await classWorkspaceId(
    ctx,
    integration._id,
    accountId,
    source.providerClassId,
    source.academicPeriodKey,
  );
  await placeSourceNode(ctx, {
    accountId,
    schoolId: integration.schoolId,
    kind: "work",
    sourceId: artifactId,
    name: title,
    target: workspaceId ? { workspaceId } : {},
    placedByAccountId: accountId,
    accessProjection: true,
  });
  const projectionId = await ctx.db.insert("externalProjections", {
    integrationId: integration._id,
    schoolId: integration.schoolId,
    recordId: source._id,
    accountId,
    projectionType: "planner_task",
    projectionId: artifactId,
    providerKey,
    sourceHash: source.sourceHash,
    state: "active",
    bootstrapVersion: integration.bootstrapVersion,
    createdAt: now,
    updatedAt: now,
  });
  return { projection: (await ctx.db.get(projectionId))!, created: true };
}

async function ensureTimetableProjection(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  accountId: Id<"accounts">,
  source: Doc<"externalRecords">,
) {
  const sourceKey = projectionSourceKey(source);
  const providerKey = `timetable:${sourceKey}`;
  const existingByKey = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q.eq("integrationId", integration._id).eq("providerKey", providerKey),
    )
    .collect();
  const existingByRecord = await ctx.db
    .query("externalProjections")
    .withIndex("by_record_type", (q) =>
      q.eq("recordId", source._id).eq("projectionType", "timetable_event"),
    )
    .collect();
  const existing =
    existingByKey.find(
      (item) =>
        item.schoolId === integration.schoolId &&
        item.accountId === accountId &&
        item.projectionType === "timetable_event",
    ) ??
    existingByRecord.find(
      (item) => item.schoolId === integration.schoolId && item.accountId === accountId,
    ) ??
    null;
  const legacyCalendarItem = existing
    ? await legacyTimetableCalendarItem(
        ctx,
        existing,
        integration.schoolId,
        accountId,
      )
    : null;
  const calendar = await upsertSourceCalendarItem(ctx, {
    ownerAccountId: accountId,
    schoolId: integration.schoolId,
    sourceRecordId: source._id,
    ...(legacyCalendarItem ? { existingItemId: legacyCalendarItem._id } : {}),
    sourceKey,
    sourceHash: source.sourceHash,
    sourceUrl: source.provenanceUrl,
    fetchedAt: source.fetchedAt,
    recordType: source.recordType,
    normalized: record(source.normalized),
  });
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      projectionId: String(calendar.itemId),
      providerKey,
      sourceHash: source.sourceHash,
      state: "active",
      updatedAt: now,
    });
    return { projection: (await ctx.db.get(existing._id))!, created: calendar.created };
  }
  const projectionId = await ctx.db.insert("externalProjections", {
      integrationId: integration._id,
      schoolId: integration.schoolId,
      recordId: source._id,
      accountId,
      projectionType: "timetable_event",
      projectionId: String(calendar.itemId),
      providerKey,
      sourceHash: source.sourceHash,
      state: "active",
      bootstrapVersion: integration.bootstrapVersion,
      createdAt: now,
      updatedAt: now,
    });
  return { projection: (await ctx.db.get(projectionId))!, created: calendar.created };
}

function legacyTimetableParts(projectionId: string) {
  const separator = projectionId.indexOf("#");
  if (separator <= 0 || separator === projectionId.length - 1) return null;
  return {
    artifactValue: projectionId.slice(0, separator),
    eventId: projectionId.slice(separator + 1),
  };
}

async function legacyTimetableCalendarItem(
  ctx: MutationCtx,
  projection: Doc<"externalProjections">,
  schoolId: Id<"schools">,
  accountId: Id<"accounts">,
) {
  if (!accountId) return null;
  const legacy = legacyTimetableParts(projection.projectionId);
  if (!legacy) return null;
  const artifactId = ctx.db.normalizeId("spectraArtifacts", legacy.artifactValue);
  if (!artifactId) return null;
  const item = await ctx.db
    .query("calendarItems")
    .withIndex("by_legacy_event", (q) =>
      q.eq("legacyArtifactId", artifactId).eq("legacyEventId", legacy.eventId),
    )
    .unique();
  if (
    !item ||
    item.ownerAccountId !== accountId ||
    item.schoolId !== schoolId ||
    !item.sourceLocked
  )
    return null;
  return item;
}

async function legacyTimetableArtifactEvent(
  ctx: MutationCtx,
  projection: Doc<"externalProjections">,
) {
  const legacy = legacyTimetableParts(projection.projectionId);
  if (!legacy) return null;
  const artifactId = ctx.db.normalizeId("spectraArtifacts", legacy.artifactValue);
  if (!artifactId) return null;
  const artifact = await ctx.db.get(artifactId);
  if (
    !artifact ||
    artifact.blueprintKey !== "timetable" ||
    (projection.accountId && artifact.ownerAccountId !== projection.accountId) ||
    artifact.schoolId !== projection.schoolId
  )
    return null;
  const content = record(artifact.content);
  const events = array(content.events).map(record);
  const index = events.findIndex((event) => event.id === legacy.eventId);
  if (index < 0) return null;
  return {
    artifact,
    content,
    events,
    eventId: legacy.eventId,
    index,
  };
}

async function directTimetableCalendarItem(
  ctx: MutationCtx,
  projection: Doc<"externalProjections">,
  source: Doc<"externalRecords">,
) {
  if (!projection.accountId) return null;
  const itemId = ctx.db.normalizeId("calendarItems", projection.projectionId);
  if (!itemId) return null;
  const item = await ctx.db.get(itemId);
  if (
    !item ||
    item.ownerAccountId !== projection.accountId ||
    item.schoolId !== projection.schoolId ||
    item.sourceProvider !== "managebac" ||
    item.sourceRecordId !== source._id ||
    !item.sourceLocked
  )
    return null;
  return item;
}

async function ensureResourceProjection(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  accountId: Id<"accounts">,
  source: Doc<"externalRecords">,
) {
  const sourceKey = projectionSourceKey(source);
  const providerKey = `resource:${sourceKey}`;
  const existingByKey = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q.eq("integrationId", integration._id).eq("providerKey", providerKey),
    )
    .collect();
  const existingByRecord = await ctx.db
    .query("externalProjections")
    .withIndex("by_record_type", (q) =>
      q.eq("recordId", source._id).eq("projectionType", "resource"),
    )
    .collect();
  const existing =
    existingByKey.find(
      (item) =>
        item.schoolId === integration.schoolId &&
        item.accountId === accountId &&
        item.projectionType === "resource",
    ) ??
    existingByRecord.find(
      (item) => item.schoolId === integration.schoolId && item.accountId === accountId,
    ) ??
    null;
  const now = Date.now();
  const sourceId = `managebac:${source._id}`;
  /* The projection below is the record of this resource. It gets no tree node:
     the tree holds identities, and a provider resource has none here until it
     becomes a real artifact. */
  if (existing) {
    await ctx.db.patch(existing._id, {
      recordId: source._id,
      sourceHash: source.sourceHash,
      providerKey,
      state: "active",
      updatedAt: now,
    });
    return { projection: (await ctx.db.get(existing._id))!, created: false };
  }
  const projectionId = await ctx.db.insert("externalProjections", {
    integrationId: integration._id,
    schoolId: integration.schoolId,
    recordId: source._id,
    accountId,
    projectionType: "resource",
    projectionId: sourceId,
    providerKey,
    sourceHash: source.sourceHash,
    state: "active",
    bootstrapVersion: integration.bootstrapVersion,
    createdAt: now,
    updatedAt: now,
  });
  return { projection: (await ctx.db.get(projectionId))!, created: true };
}

async function ensureSourceRelations(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  source: Doc<"externalRecords">,
) {
  if (!source.providerClassId || source.recordType === "class") return;
  const classCandidates = await ctx.db
    .query("externalRecords")
    .withIndex("by_integration_type", (q) =>
      q.eq("integrationId", integration._id).eq("recordType", "class"),
    )
    .take(500);
  const target = classCandidates.find(
    (item) =>
      item.schoolId === integration.schoolId &&
      (item.mappedAccountId === undefined ||
        item.mappedAccountId === source.mappedAccountId) &&
      (item.providerRecordId === source.providerClassId ||
        item.providerClassId === source.providerClassId),
  );
  if (!target) return;
  const relationType =
    source.recordType === "assessment"
      ? ("assessment_for" as const)
      : source.recordType === "deadline"
        ? ("deadline_for" as const)
        : ["resource", "file", "class_resource", "school_resource"].includes(
              source.recordType,
            )
          ? ("resource_for" as const)
          : ("belongs_to_class" as const);
  const existing = (
    await ctx.db
      .query("externalRecordRelations")
      .withIndex("by_source", (q) => q.eq("sourceRecordId", source._id))
      .collect()
  ).find(
    (item) =>
      item.targetRecordId === target._id && item.relationType === relationType,
  );
  if (existing) return;
  await ctx.db.insert("externalRecordRelations", {
    integrationId: integration._id,
    schoolId: integration.schoolId,
    sourceRecordId: source._id,
    targetRecordId: target._id,
    relationType,
    createdAt: Date.now(),
  });
}

/** Non-planner source projections. Planner content is provider-owned only
 * through `managebacProjectionJobs`, which records import history. */
async function safelyRefreshProjection(
  ctx: MutationCtx,
  projection: Doc<"externalProjections">,
  previousSourceHash: string,
  source: Doc<"externalRecords">,
  force = false,
) {
  const normalized = record(source.normalized);
  if (projection.projectionType === "timetable_event") {
    const directItem = await directTimetableCalendarItem(ctx, projection, source);
    if (directItem) {
      if (!force && directItem.sourceHash !== previousSourceHash) return false;
      await upsertSourceCalendarItem(ctx, {
        ownerAccountId: projection.accountId!,
        schoolId: projection.schoolId,
        sourceRecordId: source._id,
        existingItemId: directItem._id,
        sourceKey: projectionSourceKey(source),
        sourceHash: source.sourceHash,
        sourceUrl: source.provenanceUrl,
        fetchedAt: source.fetchedAt,
        recordType: source.recordType,
        normalized,
      });
      return true;
    }

    const legacy = await legacyTimetableArtifactEvent(ctx, projection);
    if (!legacy) return false;
    const oldEvent = legacy.events[legacy.index]!;
    if (!force && oldEvent.sourceHash !== previousSourceHash) return false;
    const start =
      isoValue(normalized.startAt ?? normalized.start ?? normalized.beginsAt) ??
      text(oldEvent.start, 100);
    const end =
      isoValue(normalized.endAt ?? normalized.end ?? normalized.finishesAt) ??
      text(oldEvent.end, 100);
    legacy.events[legacy.index] = {
      ...oldEvent,
      title: text(
        normalized.title ?? normalized.name,
        300,
        text(oldEvent.title, 300),
      ),
      start,
      end:
        Date.parse(end) > Date.parse(start)
          ? end
          : new Date(Date.parse(start) + 30 * 60_000).toISOString(),
      sourceVersion: source.payloadVersion,
      sourceHash: source.sourceHash,
      sourceStatus: "active",
      ...(text(normalized.location, 300)
        ? { location: text(normalized.location, 300) }
        : {}),
      ...(text(normalized.description ?? normalized.notes, 20_000)
        ? { notes: text(normalized.description ?? normalized.notes, 20_000) }
        : {}),
    };
    const nextContent = { ...legacy.content, events: legacy.events };
    const now = Date.now();
    await ctx.db.patch(legacy.artifact._id, {
      content: nextContent,
      textIndex: buildArtifactTextIndex({
        title: legacy.artifact.title,
        summary: legacy.artifact.summary ?? "",
        content: nextContent,
        tags: legacy.artifact.tags,
      }),
      updatedAt: now,
    });
    const legacyCalendarItem = projection.accountId
      ? await legacyTimetableCalendarItem(
          ctx,
          projection,
          projection.schoolId,
          projection.accountId,
        )
      : null;
    if (legacyCalendarItem)
      await upsertSourceCalendarItem(ctx, {
        ownerAccountId: projection.accountId!,
        schoolId: projection.schoolId,
        sourceRecordId: source._id,
        existingItemId: legacyCalendarItem._id,
        sourceKey: projectionSourceKey(source),
        sourceHash: source.sourceHash,
        sourceUrl: source.provenanceUrl,
        fetchedAt: source.fetchedAt,
        recordType: source.recordType,
        normalized,
      });
    return true;
  }
  return true;
}

async function markProjectionSourceRemoved(
  ctx: MutationCtx,
  projection: Doc<"externalProjections">,
) {
  if (projection.projectionType === "timetable_event") {
    const source = await ctx.db.get(projection.recordId);
    const directItem = source
      ? await directTimetableCalendarItem(ctx, projection, source)
      : null;
    if (directItem) {
      if (directItem.status !== "removed" || directItem.sourceCapabilityState !== "stale")
        await ctx.db.patch(directItem._id, {
          status: "removed",
          sourceCapabilityState: "stale",
          revision: directItem.revision + 1,
          updatedAt: Date.now(),
        });
      return;
    }
    const legacy = await legacyTimetableArtifactEvent(ctx, projection);
    if (!legacy) return;
    legacy.events[legacy.index] = {
      ...legacy.events[legacy.index],
      sourceStatus: "removed",
    };
    const now = Date.now();
    const nextContent = { ...legacy.content, events: legacy.events };
    await ctx.db.patch(legacy.artifact._id, {
      content: nextContent,
      textIndex: buildArtifactTextIndex({
        title: legacy.artifact.title,
        summary: legacy.artifact.summary ?? "",
        content: nextContent,
        tags: legacy.artifact.tags,
      }),
      updatedAt: now,
    });
    if (source) {
      const legacyCalendarItem = projection.accountId
        ? await legacyTimetableCalendarItem(
            ctx,
            projection,
            projection.schoolId,
            projection.accountId,
          )
        : null;
      if (
        legacyCalendarItem &&
        (legacyCalendarItem.status !== "removed" ||
          legacyCalendarItem.sourceCapabilityState !== "stale")
      )
        await ctx.db.patch(legacyCalendarItem._id, {
          status: "removed",
          sourceCapabilityState: "stale",
          revision: legacyCalendarItem.revision + 1,
          updatedAt: now,
        });
    }
  }
}

/** Existing projections of one source. A personal sync reads only its own
 * rows of a widely shared source; a shared reconciliation reads a bounded set
 * of planner projections and otherwise continues them as a fanout chain. */
async function projectionsForRecord(
  ctx: MutationCtx,
  recordId: Id<"externalRecords">,
  accountId: Id<"accounts"> | undefined,
) {
  if (accountId) {
    const rows = await ctx.db
      .query("externalProjections")
      .withIndex("by_account_record", (q) => q.eq("accountId", accountId).eq("recordId", recordId))
      .collect();
    return { rows, fanout: false };
  }
  const [planners, others] = await Promise.all([
    inlinePlannerProjections(ctx, recordId),
    Promise.all((["workspace", "timetable_event", "resource", "link"] as const).map((projectionType) =>
      ctx.db
        .query("externalProjections")
        .withIndex("by_record_type", (q) => q.eq("recordId", recordId).eq("projectionType", projectionType))
        .collect(),
    )),
  ]);
  return { rows: [...(planners ?? []), ...others.flat()], fanout: planners === null };
}

async function projectRecord(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  syncRun: Doc<"externalSyncRuns">,
  source: Doc<"externalRecords">,
) {
  if (!syncRun.accountId) return { projected: false, created: false };
  if (source.recordType === "class") {
    // Class workspaces are never auto-created. Sync stores the record only;
    // each user chooses which classes to materialize from the school-data dashboard.
    return { projected: false, created: false };
  }
  if (["assignment", "deadline", "assessment"].includes(source.recordType)) {
    const result = await ensurePlannerProjection(
      ctx,
      integration,
      syncRun.accountId,
      source,
    );
    const calendar = await ensureTimetableProjection(
      ctx,
      integration,
      syncRun.accountId,
      source,
    );
    return {
      projected: true,
      created: result.created || calendar.created,
    };
  }
  if (
    ["timetable", "lesson", "class_event", "calendar_event"].includes(
      source.recordType,
    )
  ) {
    const result = await ensureTimetableProjection(
      ctx,
      integration,
      syncRun.accountId,
      source,
    );
    return { projected: Boolean(result.projection), created: result.created };
  }
  if (
    ["resource", "file", "class_resource", "school_resource"].includes(
      source.recordType,
    )
  ) {
    const result = await ensureResourceProjection(
      ctx,
      integration,
      syncRun.accountId,
      source,
    );
    return { projected: true, created: result.created };
  }
  return { projected: false, created: false };
}

/** Errors no retry fixes: someone has to change something first (see describeSchoolSyncProblem). */
const BLOCKING_SYNC_ERRORS = new Set([
  "INTEGRATION_PERMISSION_DENIED",
  "INTEGRATION_CREDENTIAL_REJECTED",
  "INTEGRATION_TOKEN_REQUIRED",
  "INTEGRATION_IDENTITY_REQUIRED",
  "INTEGRATION_ENDPOINT_UNAVAILABLE",
]);

/**
 * The kind each record of one route belongs to, and the student's modes, read once per page.
 * A route that serves one kind decides it; a tasks route splits current from past by due date
 * and by whether the class is archived.
 */
function recordKindPolicy(
  ctx: MutationCtx,
  integrationId: Id<"schoolIntegrations">,
  capability: Doc<"integrationCapabilities">,
  now: number,
) {
  const capabilityKinds = capabilitySyncKinds(capability);
  const archived = new Map<string, Promise<boolean>>();
  const preferences = new Map<string, Promise<SyncPreferences>>();
  const classArchived = (accountId: Id<"accounts">, providerClassId: string | undefined) => {
    if (!providerClassId) return Promise.resolve(false);
    const key = `${accountId}|${providerClassId}`;
    let pending = archived.get(key);
    if (!pending) {
      pending = ctx.db
        .query("externalRecords")
        .withIndex("by_account_kind_class", (q) =>
          q.eq("mappedAccountId", accountId).eq("syncKind", "classes").eq("providerClassId", providerClassId),
        )
        .take(10)
        .then((rows) => rows.some((row) =>
          row.integrationId === integrationId && !row.tombstone &&
          CLASS_IDENTITY_TYPES.has(row.recordType) && isArchived(row.normalized)));
      archived.set(key, pending);
    }
    return pending;
  };
  const kindOf = async (
    accountId: Id<"accounts">,
    input: { normalized: unknown; providerClassId?: string },
  ): Promise<SchoolSyncKind | undefined> => {
    if (capabilityKinds.length === 1) return capabilityKinds[0];
    return recordSyncKind(capability.recordType, input.normalized, {
      classArchived: await classArchived(accountId, input.providerClassId),
      now,
    });
  };
  return Object.assign(kindOf, {
    preferences: (accountId: Id<"accounts">) => {
      let pending = preferences.get(accountId);
      if (!pending) {
        pending = loadSyncPreferences(ctx, accountId, integrationId);
        preferences.set(accountId, pending);
      }
      return pending;
    },
  });
}

/**
 * Whether one personal record of a page is stored. A job stores only its own kind, in the
 * classes whose mode admits its trigger. A record the job owned that now belongs to another
 * kind (a task that became past) follows that kind's mode. Off removes what was kept.
 */
async function admitPersonalRecord(
  _ctx: MutationCtx,
  input: {
    preferences: SyncPreferences;
    runKind: SchoolSyncKind | undefined;
    trigger: SyncTrigger;
    recordType: string;
    syncKind: SchoolSyncKind | undefined;
    providerClassId: string | undefined;
    existing: Doc<"externalRecords"> | undefined;
  },
): Promise<"store" | "skip" | "purge"> {
  const { preferences, runKind, syncKind, existing } = input;
  // The class list is how a student chooses classes at all.
  if (CLASS_IDENTITY_TYPES.has(input.recordType))
    return !runKind || runKind === "classes" ? "store" : "skip";
  if (!syncKind) return runKind ? "skip" : "store";
  const mode = preferences.modeFor(syncKind, input.providerClassId);
  if (mode === "off") return existing ? "purge" : "skip";
  if (!runKind) return "store";
  if (syncKind === runKind) return preferences.admits(syncKind, input.trigger, input.providerClassId) ? "store" : "skip";
  return existing?.syncKind === runKind ? "store" : "skip";
}

/** Whether a stored record is one this job reads, so its reconciliation may remove it. */
function inJobTargets(
  runKind: SchoolSyncKind | undefined,
  targets: SyncTargets | undefined,
  source: Doc<"externalRecords">,
) {
  if (!runKind) return true;
  if (source.syncKind !== runKind) return false;
  if (!targets) return true;
  if (
    SCHOOL_SYNC_KIND_INFO[runKind].classScoped &&
    !CLASS_IDENTITY_TYPES.has(source.recordType) &&
    !(source.providerClassId && targets.classIds.includes(source.providerClassId))
  )
    return false;
  if (runKind === "grades" || runKind === "dropbox_files") {
    const taskId = String(record(source.normalized).taskId ?? "");
    return targets.tasks.some((task) => task.taskId === taskId);
  }
  return true;
}

/**
 * Removes one student's record and what Spectra keeps only because of it: overlays, links,
 * open conflicts, fetched files, CAS reflections and outcomes, import receipts and its
 * projections. Work the student made from it (a planner plan, a Library copy) stays theirs;
 * an official deadline or lesson it put on the Calendar is marked removed. The class list is
 * never purged.
 */
export async function purgeSchoolRecord(
  ctx: MutationCtx,
  source: Doc<"externalRecords">,
  now = Date.now(),
) {
  const owner = source.mappedAccountId;
  if (!owner || CLASS_IDENTITY_TYPES.has(source.recordType)) return false;
  const [overlays, outgoing, incoming, projections, receipts, files, reflections, outcomes, conflicts, calendar, migrations] =
    await Promise.all([
      ctx.db.query("externalRecordOverlays").withIndex("by_record_account", (q) => q.eq("recordId", source._id)).take(50),
      ctx.db.query("externalRecordRelations").withIndex("by_source", (q) => q.eq("sourceRecordId", source._id)).take(200),
      ctx.db.query("externalRecordRelations").withIndex("by_target", (q) => q.eq("targetRecordId", source._id)).take(200),
      ctx.db.query("externalProjections").withIndex("by_account_record", (q) => q.eq("accountId", owner).eq("recordId", source._id)).take(50),
      ctx.db.query("managebacResourceImports").withIndex("by_account_source_record", (q) => q.eq("accountId", owner).eq("sourceRecordId", source._id)).take(50),
      ctx.db.query("schoolFiles").withIndex("by_account_source", (q) => q.eq("accountId", owner).eq("sourceRecordId", source._id)).take(100),
      ctx.db.query("casReflections").withIndex("by_account_experience", (q) => q.eq("accountId", owner).eq("experienceRecordId", source._id)).take(200),
      ctx.db.query("casOutcomeTags").withIndex("by_account_experience", (q) => q.eq("accountId", owner).eq("experienceRecordId", source._id)).take(5),
      ctx.db.query("externalSyncConflicts").withIndex("by_account_status", (q) => q.eq("accountId", owner).eq("status", "open")).take(500),
      ctx.db.query("calendarItems").withIndex("by_source_record", (q) => q.eq("sourceRecordId", source._id)).take(50),
      ctx.db.query("externalRecordIdentityMigrations").withIndex("by_legacy_record", (q) => q.eq("legacyRecordId", source._id)).take(10),
    ]);
  for (const projection of projections) {
    if (projection.projectionType === "timetable_event") await markProjectionSourceRemoved(ctx, projection);
    await ctx.db.delete(projection._id);
  }
  for (const item of calendar)
    if (item.ownerAccountId === owner && item.sourceLocked && item.status !== "removed")
      await ctx.db.patch(item._id, {
        status: "removed",
        sourceCapabilityState: "unavailable",
        revision: item.revision + 1,
        updatedAt: now,
      });
  for (const row of [...overlays, ...outgoing, ...incoming, ...receipts, ...reflections, ...outcomes, ...migrations])
    await ctx.db.delete(row._id);
  for (const conflict of conflicts)
    if (conflict.recordId === source._id) await ctx.db.delete(conflict._id);
  for (const file of files) {
    await ctx.db.delete(file._id);
    if (file.storageId)
      await deleteStorageIfNoOtherBinding(ctx, file.storageId, { table: "schoolFiles", id: String(file._id) });
  }
  await ctx.db.delete(source._id);
  return true;
}

/** Records one student keeps of one kind (in one class, when given). */
function recordsOfKind(
  ctx: MutationCtx,
  scope: { accountId: Id<"accounts">; kind: SchoolSyncKind; providerClassId?: string },
) {
  return ctx.db.query("externalRecords").withIndex("by_account_kind_class", (q) => {
    const kind = q.eq("mappedAccountId", scope.accountId).eq("syncKind", scope.kind);
    return scope.providerClassId === undefined ? kind : kind.eq("providerClassId", scope.providerClassId);
  });
}

const PURGE_BATCH = 100;

/**
 * Removes one page of what a student turned Off, then continues in the background. Each page
 * re-reads the modes, so turning a kind back on stops the purge.
 */
export async function purgeSyncKindPage(
  ctx: MutationCtx,
  scope: {
    accountId: Id<"accounts">;
    integrationId: Id<"schoolIntegrations">;
    kind: SchoolSyncKind;
    providerClassId?: string;
    cursor: string | null;
  },
) {
  const preferences = await loadSyncPreferences(ctx, scope.accountId, scope.integrationId);
  const page = await recordsOfKind(ctx, scope).paginate({ cursor: scope.cursor, numItems: PURGE_BATCH });
  const now = Date.now();
  let purged = 0;
  for (const row of page.page)
    if (row.integrationId === scope.integrationId && preferences.modeFor(scope.kind, row.providerClassId) === "off" &&
        await purgeSchoolRecord(ctx, row, now))
      purged += 1;
  if (!page.isDone)
    await ctx.scheduler.runAfter(0, internal.managebac.purgeSyncKindData, {
      accountId: scope.accountId,
      integrationId: scope.integrationId,
      kind: scope.kind,
      ...(scope.providerClassId !== undefined ? { providerClassId: scope.providerClassId } : {}),
      cursor: page.continueCursor,
    });
  return { purged, done: page.isDone };
}

export const purgeSyncKindData = internalMutation({
  args: {
    accountId: v.id("accounts"),
    integrationId: v.id("schoolIntegrations"),
    kind: vSchoolSyncKind,
    providerClassId: v.optional(v.string()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: (ctx, args) => purgeSyncKindPage(ctx, args),
});

export const commitNormalizedPage = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    syncRunId: v.id("externalSyncRuns"),
    serviceSubject: v.optional(v.string()),
    capabilityId: v.id("integrationCapabilities"),
    records: v.array(vNormalizedRecord),
    nextCursor: v.optional(v.string()),
    pageNumber: v.number(),
    progress: vPassProgress,
    leaseToken: v.optional(v.string()),
    selectionRevision: v.optional(v.number()),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorOrService(ctx, args.serviceSubject);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    const [syncRun, capability] = await Promise.all([
      ctx.db.get(args.syncRunId),
      ctx.db.get(args.capabilityId),
    ]);
    if (
      !syncRun ||
      syncRun.integrationId !== integration._id ||
      (syncRun.accountId &&
        syncRun.accountId !== actor.accountId &&
        actor.schoolRole !== "school_admin") ||
      !capability ||
      capability.integrationId !== integration._id ||
      !syncRun.capabilityIds.includes(capability._id)
    )
      throw new Error("INTEGRATION_SYNC_FORBIDDEN: Sync scope mismatch.");
    await assertCurrentSyncLease(ctx, syncRun, args.leaseToken);
    if (
      args.selectionRevision !== undefined &&
      args.selectionRevision !== (syncRun.selectionRevision ?? 0)
    )
      throw new Error(
        "INTEGRATION_SELECTION_CHANGED: This page belongs to an older class selection.",
      );
    const expectedDigest = await exactDigest({
      capabilityId: args.capabilityId,
      records: args.records,
      ...(args.nextCursor ? { nextCursor: args.nextCursor } : {}),
      pageNumber: args.pageNumber,
      progress: args.progress,
      ...(args.leaseToken ? { leaseToken: args.leaseToken } : {}),
      ...(args.selectionRevision !== undefined
        ? { selectionRevision: args.selectionRevision }
        : {}),
    });
    if (expectedDigest !== args.payloadDigest)
      throw new Error("INTEGRATION_PAYLOAD_INVALID: Sync page changed.");
    await verifyBridge(ctx, actor, {
      operation: "sync-page",
      integrationId: integration._id,
      syncRunId: syncRun._id,
      timestamp: args.timestamp,
      nonce: args.nonce,
      payloadDigest: args.payloadDigest,
      signature: args.signature,
    });
    if (
      capability.permissionState !== "read_only" ||
      capability.verificationStatus !== "verified"
    )
      throw new Error(
        "INTEGRATION_CAPABILITY_UNVERIFIED: Route is not usable.",
      );
    if (args.records.length > 500)
      throw new Error(
        "INTEGRATION_PAGE_TOO_LARGE: Page exceeds the safe bound.",
      );
    const now = Date.now();
    const counts = { ...syncRun.counts };
    counts.fetched += args.records.length;
    const followsClass = classFollowPolicy(ctx, integration._id);
    const kindOf = recordKindPolicy(ctx, integration._id, capability, now);
    const runTrigger = triggerOfRun(syncRun);
    const seenKeys: Array<{ sourceIdentityKey: string; providerRecordKey: string }> = [];
    for (const input of args.records) {
      const mappedAccountId =
        input.audienceScope === "mapped_user" ? syncRun.accountId : undefined;
      const canonicalKey = sourceIdentityKey(integration._id, mappedAccountId, {
        providerRecordKey: input.providerRecordKey,
        audienceScope: input.audienceScope,
        academicPeriodKey: input.academicPeriodKey,
      });
      // Every listed record counts as seen, followed or not, exactly as the
      // reconciliation compares them.
      seenKeys.push({
        sourceIdentityKey: canonicalKey,
        providerRecordKey: input.providerRecordKey.slice(0, 700),
      });
      if (!await followsClass(syncRun.accountId, { ...input, recordType: capability.recordType })) {
        counts.skipped += 1;
        continue;
      }
      const canonicalMatches = await ctx.db
        .query("externalRecords")
        .withIndex("by_source_identity", (q) =>
          q.eq("integrationId", integration._id).eq("sourceIdentityKey", canonicalKey),
        )
        .collect();
      const existing =
        canonicalMatches.find(
          (item) =>
            item.schoolId === integration.schoolId &&
            item.sourceIdentityKey === canonicalKey,
        ) ??
        (
          await ctx.db
        .query("externalRecords")
        .withIndex("by_integration_key", (q) =>
          q
            .eq("integrationId", integration._id)
            .eq("providerRecordKey", input.providerRecordKey),
        )
        .collect()
        ).find(
          (item) =>
            item.schoolId === integration.schoolId &&
            item.sourceIdentityKey === undefined &&
            item.audienceScope === input.audienceScope &&
            item.mappedAccountId === mappedAccountId &&
            canonicalAcademicPeriodKey(item.academicPeriodKey) ===
              canonicalAcademicPeriodKey(input.academicPeriodKey),
        );
      // The student's modes decide what a personal record may become, on
      // every page: Off never stores, and a job stores only its own kind.
      const syncKind = mappedAccountId ? await kindOf(mappedAccountId, input) : undefined;
      if (mappedAccountId) {
        const admission = await admitPersonalRecord(ctx, {
          preferences: await kindOf.preferences(mappedAccountId),
          runKind: syncRun.syncKind,
          trigger: runTrigger,
          recordType: capability.recordType,
          syncKind,
          providerClassId: input.providerClassId,
          existing,
        });
        if (admission === "purge" && existing) await purgeSchoolRecord(ctx, existing, now);
        if (admission !== "store") {
          counts.skipped += 1;
          continue;
        }
      }
      let source: Doc<"externalRecords">;
      if (existing?.sourceHash === input.sourceHash && !existing.tombstone) {
        counts.unchanged += 1;
        await ctx.db.patch(existing._id, {
          syncKind,
          sourceIdentityKey: canonicalKey,
          sourceState: "available",
          sourceStateAt: now,
          sourceStateReason: undefined,
          updatedAt: now,
        });
        source = (await ctx.db.get(existing._id))!;
      } else if (existing) {
        const previousNormalized = existing.normalized;
        await ctx.db.patch(existing._id, {
          providerRecordId: input.providerRecordId.slice(0, 500),
          recordType: capability.recordType,
          classification: input.classification,
          audienceScope: input.audienceScope,
          mappedAccountId,
          providerClassId: input.providerClassId?.slice(0, 500),
          academicPeriodKey: input.academicPeriodKey?.slice(0, 300),
          normalized: input.normalized,
          payloadVersion: input.payloadVersion.slice(0, 100),
          sourceHash: input.sourceHash.slice(0, 180),
          sourceModifiedAt: input.sourceModifiedAt,
          provenanceUrl: input.provenanceUrl?.slice(0, 2_000),
          tombstone: false,
          tombstonedAt: undefined,
          syncKind,
          sourceIdentityKey: canonicalKey,
          sourceState:
            existing.sourceHash === input.sourceHash ? "available" : "changed",
          sourceStateAt: now,
          sourceStateReason: undefined,
          fetchedAt: now,
          updatedAt: now,
        });
        source = (await ctx.db.get(existing._id))!;
        counts.updated += 1;
        const current = await projectionsForRecord(ctx, existing._id, syncRun.accountId);
        const following = await Promise.all(current.rows.map(projection => followsClass(projection.accountId, source)));
        const projections = current.rows.filter((_, index) => following[index]);
        const overlays = syncRun.accountId
          ? await ctx.db
              .query("externalRecordOverlays")
              .withIndex("by_record_account", (q) =>
                q
                  .eq("recordId", existing._id)
                  .eq("accountId", syncRun.accountId!),
              )
              .unique()
          : null;
        const sourceChangedUnderOverlay =
          Boolean(overlays) && overlays!.sourceHashAtEdit !== input.sourceHash;
        const conflicted = sourceChangedUnderOverlay ? projections : [];
        if (!sourceChangedUnderOverlay) {
          for (const projection of projections) {
            if (projection.projectionType === "planner_task") {
              const outcome = await applyPlannerProviderUpdate(ctx, projection, source, {
                mode: "refresh", syncRunId: syncRun._id, importerAccountId: actor.accountId,
                previousSourceHash: existing.sourceHash, previousNormalized,
              });
              if (outcome === "conflict") conflicted.push(projection);
              continue;
            }
            if (!await safelyRefreshProjection(ctx, projection, existing.sourceHash, source)) {
              conflicted.push(projection);
              continue;
            }
            await ctx.db.patch(projection._id, {
              sourceHash: input.sourceHash,
              state: "active",
              updatedAt: now,
            });
          }
          if (current.fanout)
            await scheduleProviderFanout(ctx, {
              recordId: existing._id, expectedSourceHash: source.sourceHash, mode: "refresh",
              syncRunId: syncRun._id, importerAccountId: actor.accountId,
              previousSourceHash: existing.sourceHash, previousNormalized,
            });
        }
        if (conflicted.length) {
          await recordProviderConflict(ctx, syncRun, source, conflicted, previousNormalized, overlays ?? undefined);
          counts.conflicts += 1;
        }
      } else {
        const id = await ctx.db.insert("externalRecords", {
          integrationId: integration._id,
          schoolId: integration.schoolId,
          providerRecordId: input.providerRecordId.slice(0, 500),
          providerRecordKey: input.providerRecordKey.slice(0, 700),
          recordType: capability.recordType,
          classification: input.classification,
          audienceScope: input.audienceScope,
          mappedAccountId,
          providerClassId: input.providerClassId?.slice(0, 500),
          academicPeriodKey: input.academicPeriodKey?.slice(0, 300),
          normalized: input.normalized,
          payloadVersion: input.payloadVersion.slice(0, 100),
          sourceHash: input.sourceHash.slice(0, 180),
          sourceModifiedAt: input.sourceModifiedAt,
          provenanceUrl: input.provenanceUrl?.slice(0, 2_000),
          tombstone: false,
          syncKind,
          sourceIdentityKey: canonicalKey,
          sourceState: "available",
          sourceStateAt: now,
          fetchedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        source = (await ctx.db.get(id))!;
        counts.created += 1;
      }
      await ensureSourceRelations(ctx, integration, source);
      const projection = await projectRecord(ctx, integration, syncRun, source);
      if (projection.projected) counts.projected += projection.created ? 1 : 0;
    }
    const capabilityRun = (
      await ctx.db
        .query("externalSyncCapabilityRuns")
        .withIndex("by_sync_run", (q) => q.eq("syncRunId", syncRun._id))
        .collect()
    ).find((item) => item.capabilityId === capability._id);
    if (capabilityRun)
      await ctx.db.patch(capabilityRun._id, {
        status: args.progress.capabilityDone ? "completed" : "running",
        pageCount: capabilityRun.pageCount + 1,
        recordCount: capabilityRun.recordCount + args.records.length,
        cursor: args.nextCursor,
        schemaHash: capability.responseSchemaHash,
        startedAt: capabilityRun.startedAt ?? now,
        completedAt: args.progress.capabilityDone ? now : undefined,
        updatedAt: now,
      });
    const pass = await recordPassPage(ctx, syncRun, integration, capability._id, args.progress, seenKeys);
    await ctx.db.patch(syncRun._id, {
      status: "running",
      stage: `syncing:${capability.category}`,
      currentCapabilityId: capability._id,
      cursorState: pass,
      counts,
      startedAt: syncRun.startedAt ?? now,
      leaseExpiresAt: syncRun.leaseToken
        ? now + SYNC_LEASE_MS
        : syncRun.leaseExpiresAt,
      updatedAt: now,
    });
    return { counts, nextCursor: args.nextCursor };
  },
});

export const commitQuarantine = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    syncRunId: v.id("externalSyncRuns"),
    serviceSubject: v.optional(v.string()),
    capabilityId: v.id("integrationCapabilities"),
    reasonCode: v.string(),
    payloadHash: v.string(),
    providerRecordKeyHash: v.string(),
    sanitizedSample: v.optional(v.any()),
    leaseToken: v.optional(v.string()),
    selectionRevision: v.optional(v.number()),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorOrService(ctx, args.serviceSubject);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    const [syncRun, capability] = await Promise.all([
      ctx.db.get(args.syncRunId),
      ctx.db.get(args.capabilityId),
    ]);
    if (
      !syncRun ||
      syncRun.integrationId !== integration._id ||
      (syncRun.accountId &&
        syncRun.accountId !== actor.accountId &&
        actor.schoolRole !== "school_admin") ||
      !capability ||
      capability.integrationId !== integration._id
    )
      throw new Error("INTEGRATION_SYNC_FORBIDDEN: Quarantine scope mismatch.");
    await assertCurrentSyncLease(ctx, syncRun, args.leaseToken);
    if (
      args.selectionRevision !== undefined &&
      args.selectionRevision !== (syncRun.selectionRevision ?? 0)
    )
      throw new Error(
        "INTEGRATION_SELECTION_CHANGED: This quarantine belongs to an older class selection.",
      );
    const expectedDigest = await exactDigest({
      capabilityId: args.capabilityId,
      reasonCode: args.reasonCode,
      payloadHash: args.payloadHash,
      providerRecordKeyHash: args.providerRecordKeyHash,
      ...(args.sanitizedSample !== undefined
        ? { sanitizedSample: args.sanitizedSample }
        : {}),
      ...(args.leaseToken ? { leaseToken: args.leaseToken } : {}),
      ...(args.selectionRevision !== undefined
        ? { selectionRevision: args.selectionRevision }
        : {}),
    });
    if (expectedDigest !== args.payloadDigest)
      throw new Error(
        "INTEGRATION_PAYLOAD_INVALID: Quarantine payload changed.",
      );
    await verifyBridge(ctx, actor, {
      operation: "quarantine",
      integrationId: integration._id,
      syncRunId: syncRun._id,
      timestamp: args.timestamp,
      nonce: args.nonce,
      payloadDigest: args.payloadDigest,
      signature: args.signature,
    });
    const now = Date.now();
    const quarantineId = await ctx.db.insert("externalQuarantineRecords", {
      syncRunId: syncRun._id,
      integrationId: integration._id,
      schoolId: integration.schoolId,
      capabilityId: capability._id,
      providerRecordKeyHash: args.providerRecordKeyHash.slice(0, 180),
      payloadHash: args.payloadHash.slice(0, 180),
      sanitizedSample: args.sanitizedSample,
      reasonCode: text(args.reasonCode, 200),
      contractVersion: capability.contractVersion,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(capability._id, {
      verificationStatus: "quarantined",
      lastErrorCode: text(args.reasonCode, 200),
      updatedAt: now,
    });
    const capabilityRun = (
      await ctx.db
        .query("externalSyncCapabilityRuns")
        .withIndex("by_sync_run", (q) => q.eq("syncRunId", syncRun._id))
        .collect()
    ).find((item) => item.capabilityId === capability._id);
    if (capabilityRun)
      await ctx.db.patch(capabilityRun._id, {
        status: "quarantined",
        errorCode: text(args.reasonCode, 200),
        errorSummary:
          "Provider response shape or route behavior requires administrator review.",
        completedAt: now,
        updatedAt: now,
      });
    await ctx.db.patch(syncRun._id, {
      status: "running",
      stage: `quarantined:${capability.category}`,
      counts: {
        ...syncRun.counts,
        quarantined: syncRun.counts.quarantined + 1,
        errors: syncRun.counts.errors + 1,
      },
      updatedAt: now,
    });
    return { quarantineId };
  },
});

export const failSync = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    syncRunId: v.id("externalSyncRuns"),
    serviceSubject: v.optional(v.string()),
    errorCode: v.string(),
    errorSummary: v.string(),
    retryAfterAt: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorOrService(ctx, args.serviceSubject);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    const syncRun = await ctx.db.get(args.syncRunId);
    if (
      !syncRun ||
      syncRun.integrationId !== integration._id ||
      (syncRun.accountId &&
        syncRun.accountId !== actor.accountId &&
        actor.schoolRole !== "school_admin")
    )
      throw new Error("INTEGRATION_SYNC_FORBIDDEN: Sync run mismatch.");
    const selectionChanged = args.errorCode === "INTEGRATION_SELECTION_CHANGED";
    await assertCurrentSyncLease(ctx, syncRun, args.leaseToken, {
      allowSelectionChange: selectionChanged,
    });
    const expectedDigest = await exactDigest({
      errorCode: args.errorCode,
      errorSummary: args.errorSummary,
      ...(args.retryAfterAt !== undefined
        ? { retryAfterAt: args.retryAfterAt }
        : {}),
      ...(args.leaseToken ? { leaseToken: args.leaseToken } : {}),
    });
    if (expectedDigest !== args.payloadDigest)
      throw new Error("INTEGRATION_PAYLOAD_INVALID: Failure payload changed.");
    await verifyBridge(ctx, actor, {
      operation: "sync-fail",
      integrationId: integration._id,
      syncRunId: syncRun._id,
      timestamp: args.timestamp,
      nonce: args.nonce,
      payloadDigest: args.payloadDigest,
      signature: args.signature,
    });
    const now = Date.now();
    const retryAt =
      args.retryAfterAt ??
      (args.errorCode === "INTEGRATION_CREDENTIAL_REJECTED"
        ? now + 365 * 24 * 60 * 60_000
        : now + Math.min(30 * 60_000, 30_000 * 2 ** syncRun.attemptCount));
    const partial =
      syncRun.counts.created +
        syncRun.counts.updated +
        syncRun.counts.unchanged >
      0;
    const jobScope = stateScope(syncRun);
    if (!selectionChanged) {
      // A student's job marks only its own kind unavailable.
      const sources = jobScope
        ? await ctx.db
            .query("externalRecords")
            .withIndex("by_account_kind_class", (q) =>
              q.eq("mappedAccountId", jobScope.accountId).eq("syncKind", jobScope.kind),
            )
            .take(5_000)
        : await ctx.db
            .query("externalRecords")
            .withIndex("by_school_updated", (q) => q.eq("schoolId", actor.schoolId))
            .take(5_000);
      const scopedSources = sources.filter(
        (item) =>
          item.integrationId === integration._id &&
          !item.tombstone &&
          (syncRun.accountId
            ? item.mappedAccountId === syncRun.accountId
            : item.mappedAccountId === undefined),
      );
      for (const source of scopedSources)
        await ctx.db.patch(source._id, {
          sourceState: "temporarily_unavailable",
          sourceStateAt: now,
          sourceStateReason: text(args.errorSummary, 500),
          updatedAt: now,
        });
    }
    const capabilityRuns = await ctx.db
      .query("externalSyncCapabilityRuns")
      .withIndex("by_sync_run", (q) => q.eq("syncRunId", syncRun._id))
      .collect();
    for (const capabilityRun of capabilityRuns.filter((item) =>
      ["queued", "running"].includes(item.status),
    ))
      await ctx.db.patch(capabilityRun._id, {
        status: partial ? "partial" : "failed",
        errorCode: text(args.errorCode, 200),
        errorSummary: text(args.errorSummary, 500),
        retryAfterAt: args.retryAfterAt,
        completedAt: now,
        updatedAt: now,
      });
    await ctx.db.patch(syncRun._id, {
      status: partial ? "partial" : "failed",
      stage: selectionChanged ? "selection_changed" : "failed",
      errorCode: text(args.errorCode, 200),
      errorSummary: text(args.errorSummary, 500),
      nextAttemptAt: retryAt,
      attemptCount: syncRun.attemptCount + 1,
      leaseExpiresAt: undefined,
      completedAt: now,
      updatedAt: now,
    });
    if (jobScope && !selectionChanged) {
      // One student's job failing says nothing about the school's connection,
      // except that ManageBac rejected the school's credential.
      const blocked = BLOCKING_SYNC_ERRORS.has(args.errorCode);
      const preferences = await loadSyncPreferences(ctx, jobScope.accountId, jobScope.integrationId);
      await writeSyncState(ctx, jobScope, {
        state: blocked ? "blocked" : "failed",
        dueAt: blocked
          ? preferences.hasAuto(jobScope.kind) ? now + 24 * 60 * 60_000 : undefined
          : retryAt,
        dueTrigger: blocked ? (preferences.hasAuto(jobScope.kind) ? "schedule" : undefined) : triggerOfRun(syncRun),
        errorCode: text(args.errorCode, 200),
        errorSummary: text(args.errorSummary, 500),
      });
      if (args.errorCode === "INTEGRATION_CREDENTIAL_REJECTED")
        await ctx.db.patch(integration._id, {
          status: "blocked",
          blockedReason: "The stored read-only credential was rejected by ManageBac.",
          nextSyncAt: undefined,
          updatedAt: now,
        });
    } else if (jobScope && selectionChanged) {
      // The classes changed under the job: it runs again with the new targets.
      await writeSyncState(ctx, jobScope, { state: "queued", dueAt: now, dueTrigger: triggerOfRun(syncRun) });
    } else if (!selectionChanged && !syncRun.accountId) {
      await ctx.db.patch(integration._id, {
        status:
          args.errorCode === "INTEGRATION_CREDENTIAL_REJECTED"
            ? "blocked"
            : "degraded",
        blockedReason:
          args.errorCode === "INTEGRATION_CREDENTIAL_REJECTED"
            ? "The stored read-only credential was rejected by ManageBac."
            : undefined,
        nextSyncAt:
          args.errorCode === "INTEGRATION_CREDENTIAL_REJECTED"
            ? undefined
            : retryAt,
        updatedAt: now,
      });
      if (args.errorCode !== "INTEGRATION_CREDENTIAL_REJECTED")
        await scheduleSync(ctx, integration._id, retryAt);
    }
    // A failed pass is not continued: the next sync starts a fresh one.
    await closePass(ctx, syncRun._id);
    return { failed: true, partial };
  },
});

/**
 * The route stopped a pass before it finished (its time budget, or the
 * provider asked it to wait). The pass keeps every committed page and its
 * place; the lease is released so the next sync for this scope continues it.
 * Nothing is marked unavailable and nothing is removed.
 */
export const suspendSync = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    syncRunId: v.id("externalSyncRuns"),
    serviceSubject: v.optional(v.string()),
    errorCode: v.string(),
    errorSummary: v.string(),
    resumeAfterAt: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    selectionRevision: v.optional(v.number()),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorOrService(ctx, args.serviceSubject);
    const integration = await requireIntegration(ctx, actor, args.integrationId);
    const syncRun = await ctx.db.get(args.syncRunId);
    if (
      !syncRun ||
      syncRun.integrationId !== integration._id ||
      (syncRun.accountId &&
        syncRun.accountId !== actor.accountId &&
        actor.schoolRole !== "school_admin")
    )
      throw new Error("INTEGRATION_SYNC_FORBIDDEN: Sync run mismatch.");
    await assertCurrentSyncLease(ctx, syncRun, args.leaseToken);
    const expectedDigest = await exactDigest({
      errorCode: args.errorCode,
      errorSummary: args.errorSummary,
      ...(args.resumeAfterAt !== undefined ? { resumeAfterAt: args.resumeAfterAt } : {}),
      ...(args.leaseToken ? { leaseToken: args.leaseToken } : {}),
      ...(args.selectionRevision !== undefined
        ? { selectionRevision: args.selectionRevision }
        : {}),
    });
    if (expectedDigest !== args.payloadDigest)
      throw new Error("INTEGRATION_PAYLOAD_INVALID: Suspension payload changed.");
    await verifyBridge(ctx, actor, {
      operation: "sync-suspend",
      integrationId: integration._id,
      syncRunId: syncRun._id,
      timestamp: args.timestamp,
      nonce: args.nonce,
      payloadDigest: args.payloadDigest,
      signature: args.signature,
    });
    const now = Date.now();
    const resumeAt = Math.max(
      now + SYNC_RESUME_DELAY_MS,
      Math.min(now + 30 * 60_000, args.resumeAfterAt ?? 0),
    );
    await ctx.db.patch(syncRun._id, {
      status: "partial",
      stage: "suspended",
      cursorState: syncPass(syncRun) ?? newPass(
        await passIdentity(ctx, integration, actor.accountId, syncRun.syncKind),
        syncRun.startedAt ?? now,
      ),
      errorCode: text(args.errorCode, 200),
      errorSummary: text(args.errorSummary, 500),
      nextAttemptAt: resumeAt,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    // A student's job and a school pass both continue through the scheduled
    // worker; an identity pass continues on that person's next sync.
    const jobScope = stateScope(syncRun);
    if (jobScope)
      await writeSyncState(ctx, jobScope, {
        state: "queued",
        dueAt: resumeAt,
        dueTrigger: triggerOfRun(syncRun),
        errorCode: text(args.errorCode, 200),
        errorSummary: text(args.errorSummary, 500),
      });
    else if (!syncRun.accountId) {
      await ctx.db.patch(integration._id, { nextSyncAt: resumeAt, updatedAt: now });
      await scheduleSync(ctx, integration._id, resumeAt);
    }
    return { suspended: true, resumeAt };
  },
});

export const completeSync = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    syncRunId: v.id("externalSyncRuns"),
    serviceSubject: v.optional(v.string()),
    leaseToken: v.optional(v.string()),
    selectionRevision: v.optional(v.number()),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorOrService(ctx, args.serviceSubject);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    const syncRun = await ctx.db.get(args.syncRunId);
    if (
      !syncRun ||
      syncRun.integrationId !== integration._id ||
      (syncRun.accountId &&
        syncRun.accountId !== actor.accountId &&
        actor.schoolRole !== "school_admin")
    )
      throw new Error("INTEGRATION_SYNC_FORBIDDEN: Sync run mismatch.");
    await assertCurrentSyncLease(ctx, syncRun, args.leaseToken);
    if (
      args.selectionRevision !== undefined &&
      args.selectionRevision !== (syncRun.selectionRevision ?? 0)
    )
      throw new Error(
        "INTEGRATION_SELECTION_CHANGED: This completion belongs to an older class selection.",
      );
    const expectedDigest = await exactDigest({
      ...(args.leaseToken ? { leaseToken: args.leaseToken } : {}),
      ...(args.selectionRevision !== undefined
        ? { selectionRevision: args.selectionRevision }
        : {}),
    });
    if (expectedDigest !== args.payloadDigest)
      throw new Error(
        "INTEGRATION_PAYLOAD_INVALID: Reconciliation set changed.",
      );
    await verifyBridge(ctx, actor, {
      operation: "sync-complete",
      integrationId: integration._id,
      syncRunId: syncRun._id,
      timestamp: args.timestamp,
      nonce: args.nonce,
      payloadDigest: args.payloadDigest,
      signature: args.signature,
    });
    // The route calls this only after every route of the pass was read, so
    // the pass's own record of finished routes decides what is reconciled.
    const pass = syncPass(syncRun) ?? newPass({
      selectionDigest: "",
      connectionKey: "",
      manifestVersion: integration.manifestVersion,
    }, syncRun.startedAt ?? syncRun.createdAt);
    const capabilities = (
      await Promise.all(
        pass.completedCapabilityIds
          .slice(0, 500)
          .map((capabilityId) => ctx.db.get(capabilityId as Id<"integrationCapabilities">)),
      )
    ).filter((capability): capability is Doc<"integrationCapabilities"> =>
      Boolean(
        capability &&
        capability.integrationId === integration._id &&
        syncRun.capabilityIds.includes(capability._id) &&
        capability.changeStrategy === "full_reconciliation",
      ),
    );
    const typesFor = (personal: boolean) => [
      ...new Set(
        capabilities
          .filter((capability) => (capability.scope === "personal") === personal)
          .map((capability) => capability.recordType),
      ),
    ];
    const streams = [
      ...(syncRun.accountId
        ? typesFor(true).map((recordType) => ({ scope: "personal" as const, recordType }))
        : []),
      ...(actor.schoolRole === "school_admin"
        ? typesFor(false).map((recordType) => ({ scope: "shared" as const, recordType }))
        : []),
    ];
    const now = Date.now();
    const capabilityRuns = await ctx.db
      .query("externalSyncCapabilityRuns")
      .withIndex("by_sync_run", (q) => q.eq("syncRunId", syncRun._id))
      .collect();
    const unfinishedCapabilityRuns = capabilityRuns.filter((item) =>
      ["queued", "running"].includes(item.status),
    );
    for (const capabilityRun of unfinishedCapabilityRuns)
      await ctx.db.patch(capabilityRun._id, {
        status: "skipped",
        errorCode: "CAPABILITY_NOT_APPLICABLE",
        errorSummary:
          "The route was outside this actor’s verified identity or permission scope.",
        completedAt: now,
        updatedAt: now,
      });
    // A fresh token fences the route's lease: from here the pass belongs to
    // its reconciliation, which renews the lease until it finishes.
    const reconcileToken = crypto.randomUUID();
    const { position: _position, ...finished } = pass;
    await ctx.db.patch(syncRun._id, {
      status: "running",
      stage: "reconciling",
      currentCapabilityId: undefined,
      leaseToken: reconcileToken,
      leaseExpiresAt: now + SYNC_LEASE_MS,
      cursorState: {
        ...finished,
        reconcile: { streams, stream: 0, after: null, tombstoned: 0, importerAccountId: actor.accountId },
      } satisfies SyncPass,
      counts: {
        ...syncRun.counts,
        skipped: syncRun.counts.skipped + unfinishedCapabilityRuns.length,
      },
      updatedAt: now,
    });
    return reconcileSyncPass(ctx, syncRun._id, reconcileToken);
  },
});

export const continueSyncReconciliation = internalMutation({
  args: { syncRunId: v.id("externalSyncRuns"), leaseToken: v.string() },
  handler: (ctx, args) => reconcileSyncPass(ctx, args.syncRunId, args.leaseToken),
});

/**
 * One bounded batch of the end-of-pass reconciliation: a record of a fully
 * read route that the pass did not see is tombstoned and its projections are
 * marked removed. Each call reads at most one page of records and continues
 * itself; the last one closes the pass.
 */
async function reconcileSyncPass(
  ctx: MutationCtx,
  syncRunId: Id<"externalSyncRuns">,
  leaseToken: string,
) {
  const syncRun = await ctx.db.get(syncRunId);
  const pass = syncRun ? syncPass(syncRun) : undefined;
  const state = pass?.reconcile;
  const integration = syncRun ? await ctx.db.get(syncRun.integrationId) : null;
  // A disconnected connection or a replaced run stops here, removing nothing more.
  if (!syncRun || !pass || !state || !integration || syncRun.status !== "running" ||
      syncRun.stage !== "reconciling" || syncRun.leaseToken !== leaseToken)
    return { status: syncRun?.status ?? ("cancelled" as const), counts: syncRun?.counts ?? EMPTY_COUNTS };
  const now = Date.now();
  let { stream, after, tombstoned } = state;
  let budget = RECONCILE_BATCH;
  const followsClass = classFollowPolicy(ctx, integration._id);
  while (budget > 0 && stream < state.streams.length) {
    const current = state.streams[stream]!;
    const from = after;
    const rows = await (current.scope === "personal"
      ? ctx.db.query("externalRecords").withIndex("by_account_type", (q) => {
          const range = q.eq("mappedAccountId", syncRun.accountId!).eq("recordType", current.recordType);
          return from === null ? range : range.gt("_creationTime", from);
        })
      : ctx.db.query("externalRecords").withIndex("by_integration_type", (q) => {
          const range = q.eq("integrationId", integration._id).eq("recordType", current.recordType);
          return from === null ? range : range.gt("_creationTime", from);
        })
    ).take(budget);
    budget -= rows.length;
    for (const source of rows) {
      const inScope = current.scope === "personal"
        ? source.integrationId === integration._id && source.schoolId === integration.schoolId &&
          inJobTargets(syncRun.syncKind, pass.targets, source)
        : !source.mappedAccountId;
      if (inScope && await removeUnseenSource(ctx, integration, syncRun, pass, state.importerAccountId, source, followsClass, now))
        tombstoned += 1;
    }
    if (budget > 0) {
      stream += 1;
      after = null;
    } else after = rows.at(-1)?._creationTime ?? after;
  }
  if (stream < state.streams.length) {
    await ctx.db.patch(syncRun._id, {
      cursorState: { ...pass, reconcile: { ...state, stream, after, tombstoned } } satisfies SyncPass,
      leaseExpiresAt: now + SYNC_LEASE_MS,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.managebac.continueSyncReconciliation, { syncRunId, leaseToken });
    return { status: "running" as const, counts: syncRun.counts };
  }
  // Staged provider effects keep the run pending; the last one to drain
  // records the final status from the then-current errors and conflicts.
  const latestRun = (await ctx.db.get(syncRun._id))!;
  const outcome = await syncRunOutcome(ctx, latestRun);
  const pendingProjections = (latestRun.projectionWorkRemaining ?? 0) > 0;
  const status = pendingProjections ? ("running" as const) : outcome.status;
  const counts = {
    ...latestRun.counts,
    tombstoned: latestRun.counts.tombstoned + tombstoned,
    conflicts: outcome.conflicts,
  };
  await ctx.db.patch(syncRun._id, {
    status,
    stage: pendingProjections ? "applying_projections"
      : status === "awaiting_review" ? "review_conflicts" : "complete",
    projectionIngestionComplete: true,
    cursorState: undefined,
    counts,
    leaseExpiresAt: undefined,
    completedAt: pendingProjections ? undefined : now,
    updatedAt: now,
  });
  await closePass(ctx, syncRun._id);
  const jobScope = stateScope(syncRun);
  if (jobScope) {
    // The job is done: Auto runs it again on its own schedule.
    const preferences = await loadSyncPreferences(ctx, jobScope.accountId, jobScope.integrationId);
    const dueAt = nextAutoRunAt(preferences, jobScope.kind, now, now);
    await writeSyncState(ctx, jobScope, {
      state: "idle",
      lastSuccessAt: now,
      dueAt,
      dueTrigger: dueAt === undefined ? undefined : "schedule",
      errorCode: undefined,
      errorSummary: undefined,
    });
    await ctx.db.patch(integration._id, {
      lastSyncAt: now,
      ...(integration.status === "degraded" && !integration.blockedReason && syncRun.counts.errors === 0
        ? { status: "connected" as const }
        : {}),
      updatedAt: now,
    });
    return { status, counts };
  }
  if (syncRun.accountId) {
    await ctx.db.patch(integration._id, { lastSyncAt: now, updatedAt: now });
    return { status, counts };
  }
  const nextSyncAt =
    now + integration.syncPolicy.frequencyMinutes * 60_000;
  await ctx.db.patch(integration._id, {
    status: syncRun.counts.errors > 0 ? "degraded" : "connected",
    lastSyncAt: now,
    nextSyncAt,
    updatedAt: now,
  });
  await scheduleSync(ctx, integration._id, nextSyncAt);
  return { status, counts };
}

/** Tombstones one source the finished pass did not see. Returns whether it did. */
async function removeUnseenSource(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  syncRun: Doc<"externalSyncRuns">,
  pass: SyncPass,
  importerAccountId: Id<"accounts">,
  source: Doc<"externalRecords">,
  followsClass: ReturnType<typeof classFollowPolicy>,
  now: number,
) {
  if (source.tombstone || !await followsClass(source.mappedAccountId ?? syncRun.accountId, source))
    return false;
  const seen = source.sourceIdentityKey !== undefined
    ? await ctx.db.query("externalSyncSeenKeys").withIndex("by_run_identity", (q) =>
        q.eq("syncRunId", syncRun._id).eq("sourceIdentityKey", source.sourceIdentityKey!)).first()
    : await ctx.db.query("externalSyncSeenKeys").withIndex("by_run_provider", (q) =>
        q.eq("syncRunId", syncRun._id).eq("providerRecordKey", source.providerRecordKey)).first();
  if (seen) return false;
  // A pass reads the provider over time. A record another sync created or
  // saw after this pass began is present, even though this pass read its
  // page before it appeared; it is not removed.
  if (source.createdAt > pass.startedAt ||
      ((source.sourceState === "available" || source.sourceState === "changed") &&
        (source.sourceStateAt ?? 0) > pass.startedAt))
    return false;
  await ctx.db.patch(source._id, {
    tombstone: true,
    tombstonedAt: now,
    sourceState: "missing",
    sourceStateAt: now,
    sourceStateReason: "The provider omitted this record from a complete reconciliation.",
    fetchedAt: now,
    updatedAt: now,
  });
  const removed = (await ctx.db.get(source._id))!;
  const current = await projectionsForRecord(ctx, source._id, syncRun.accountId);
  const following = await Promise.all(current.rows.map(projection => followsClass(projection.accountId, source)));
  const projections = current.rows.filter((_, index) => following[index]);
  for (const projection of projections) {
    if (projection.projectionType === "planner_task")
      await applyPlannerProviderUpdate(ctx, projection, removed, {
        mode: "removed", syncRunId: syncRun._id, importerAccountId,
        previousSourceHash: projection.sourceHash,
      });
    else await markProjectionSourceRemoved(ctx, projection);
    await ctx.db.patch(projection._id, {
      state: "tombstoned",
      updatedAt: now,
    });
  }
  if (current.fanout)
    await scheduleProviderFanout(ctx, {
      recordId: source._id, expectedSourceHash: removed.sourceHash, mode: "removed",
      syncRunId: syncRun._id, importerAccountId,
    });
  if (projections.length || current.fanout)
    await ctx.db.insert("externalSyncConflicts", {
      syncRunId: syncRun._id,
      integrationId: integration._id,
      schoolId: integration.schoolId,
      accountId: syncRun.accountId,
      recordId: source._id,
      projectionType: projections[0]?.projectionType ?? "planner_task",
      projectionId: projections[0]?.projectionId,
      kind: "source_removed",
      oldSource: source.normalized,
      newSource: null,
      affectedLinks: projections.map((item) => item.projectionId),
      suggestedActions: ["detach", "archive_projection"],
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
  return true;
}

export const setOverlay = mutation({
  args: {
    recordId: v.id("externalRecords"),
    notes: v.optional(v.string()),
    completion: v.optional(v.boolean()),
    reminders: v.optional(v.array(v.number())),
    tags: v.optional(v.array(v.string())),
    alternativeStartAt: v.optional(v.number()),
    alternativeEndAt: v.optional(v.number()),
    placementWorkspaceId: v.optional(v.id("spectraWorkspaces")),
    linkedArtifactIds: v.optional(v.array(v.id("spectraArtifacts"))),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const source = await ctx.db.get(args.recordId);
    if (
      !source ||
      source.schoolId !== actor.schoolId ||
      (source.audienceScope === "mapped_user" &&
        source.mappedAccountId !== actor.accountId)
    )
      throw new Error("INTEGRATION_RECORD_FORBIDDEN: Record is unavailable.");
    const existing = await ctx.db
      .query("externalRecordOverlays")
      .withIndex("by_record_account", (q) =>
        q.eq("recordId", source._id).eq("accountId", actor.accountId),
      )
      .unique();
    const now = Date.now();
    /* Omit-means-preserve for personal fields so a completion-only write
       cannot wipe notes (and vice versa). Pass "" / [] / false explicitly
       to clear. Tags and linkedArtifactIds already merged with existing. */
    const patch = {
      notes:
        args.notes !== undefined
          ? args.notes.slice(0, 100_000)
          : existing?.notes,
      completion:
        args.completion !== undefined
          ? args.completion
          : existing?.completion,
      reminders:
        args.reminders !== undefined
          ? args.reminders
              .filter((item) => Number.isFinite(item))
              .slice(0, 20)
          : existing?.reminders,
      tags: (args.tags ?? existing?.tags ?? [])
        .map((item) => item.trim().slice(0, 48))
        .filter(Boolean)
        .slice(0, 32),
      alternativeStartAt:
        args.alternativeStartAt !== undefined
          ? args.alternativeStartAt
          : existing?.alternativeStartAt,
      alternativeEndAt:
        args.alternativeEndAt !== undefined
          ? args.alternativeEndAt
          : existing?.alternativeEndAt,
      placementWorkspaceId:
        args.placementWorkspaceId !== undefined
          ? args.placementWorkspaceId
          : existing?.placementWorkspaceId,
      linkedArtifactIds: (
        args.linkedArtifactIds ??
        existing?.linkedArtifactIds ??
        []
      ).slice(0, 50),
      sourceHashAtEdit: source.sourceHash,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { overlayId: existing._id };
    }
    const overlayId = await ctx.db.insert("externalRecordOverlays", {
      recordId: source._id,
      schoolId: actor.schoolId,
      accountId: actor.accountId,
      ...patch,
      createdAt: now,
    });
    return { overlayId };
  },
});

const conflictResolution = v.union(
  v.literal("rebase"),
  v.literal("keep_overlay"),
  v.literal("detach"),
  v.literal("archive_projection"),
  v.literal("link_existing"),
);
type ConflictResolution = NonNullable<Doc<"externalSyncConflicts">["resolution"]>;

/** A school-wide conflict resolves inline only for this many projections. A
 * record shared with a whole school has one projection per member, and each
 * one is a write, so beyond this the resolution continues in batches. */
export const RESOLVE_INLINE_PROJECTIONS = 64;
const RESOLVE_BATCH = 64;

function conflictRebaseFailed() {
  return new Error(
    "INTEGRATION_CONFLICT_REBASE_FAILED: The source projection is unavailable or no longer has a compatible shape.",
  );
}

async function patchProjectionForResolution(
  ctx: MutationCtx,
  projection: Doc<"externalProjections">,
  resolution: ConflictResolution,
  linkProjectionId: string | undefined,
  now: number,
) {
  if (resolution === "detach")
    await ctx.db.patch(projection._id, { state: "detached", updatedAt: now });
  else if (resolution === "archive_projection")
    await ctx.db.patch(projection._id, { state: "tombstoned", updatedAt: now });
  else
    await ctx.db.patch(projection._id, {
      state: "active",
      projectionId:
        resolution === "link_existing" && linkProjectionId
          ? linkProjectionId
          : projection.projectionId,
      updatedAt: now,
    });
}

/** Rebase a non-planner projection onto the current source. */
async function refreshConflictProjection(
  ctx: MutationCtx,
  projection: Doc<"externalProjections">,
  source: Doc<"externalRecords">,
  now: number,
) {
  const refreshed = await safelyRefreshProjection(ctx, projection, projection.sourceHash, source, true);
  if (!refreshed) return false;
  await ctx.db.patch(projection._id, { sourceHash: source.sourceHash, state: "active", updatedAt: now });
  return true;
}

/**
 * One batch of a school-wide resolution. The conflict stays open, marked with
 * its accepted resolution, until every batch and any planner fanout settle.
 * A projection that cannot be rebased settles the work as failed: the
 * conflict stays open for the administrator instead of resolving half-done.
 */
export const resolveConflictProjections = internalMutation({
  args: {
    conflictId: v.id("externalSyncConflicts"),
    resolution: conflictResolution,
    linkProjectionId: v.optional(v.string()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const conflict = await ctx.db.get(args.conflictId);
    if (!conflict) return;
    const owner = { syncRunId: conflict.syncRunId, conflictId: conflict._id };
    if (conflict.status !== "open" || conflict.projectionResolution !== args.resolution || !conflict.resolvedByAccountId)
      return settleProviderWork(ctx, owner, false);
    const source = await ctx.db.get(conflict.recordId);
    const refreshing = args.resolution === "rebase" || args.resolution === "keep_overlay";
    const now = Date.now();
    const page = await ctx.db
      .query("externalProjections")
      .withIndex("by_record_type", (q) => q.eq("recordId", conflict.recordId))
      .paginate({ cursor: args.cursor, numItems: RESOLVE_BATCH });
    for (const projection of page.page) {
      if (projection.schoolId !== conflict.schoolId || projection.integrationId !== conflict.integrationId) continue;
      await patchProjectionForResolution(ctx, projection, args.resolution, args.linkProjectionId, now);
      if (!source || !refreshing) continue;
      if (projection.projectionType === "planner_task") {
        // Planners with provider facts are rebased by the fanout below.
        if (source.tombstone)
          await ctx.db.patch(projection._id, { sourceHash: source.sourceHash, state: "active", updatedAt: now });
        continue;
      }
      if (!(await refreshConflictProjection(ctx, projection, source, now)))
        return settleProviderWork(ctx, owner, false);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.managebac.resolveConflictProjections, {
        ...args, cursor: page.continueCursor,
      });
      return;
    }
    if (source && !source.tombstone && (args.resolution === "rebase" || args.resolution === "keep_overlay"))
      await scheduleProviderFanout(ctx, {
        recordId: source._id, expectedSourceHash: source.sourceHash, mode: args.resolution,
        syncRunId: conflict.syncRunId, conflictId: conflict._id, importerAccountId: conflict.resolvedByAccountId,
        previousNormalized: conflict.oldSource,
      });
    await settleProviderWork(ctx, owner, true);
  },
});

export const resolveConflict = mutation({
  args: {
    conflictId: v.id("externalSyncConflicts"),
    resolution: conflictResolution,
    linkProjectionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const conflict = await ctx.db.get(args.conflictId);
    if (
      !conflict ||
      conflict.schoolId !== actor.schoolId ||
      conflict.status !== "open" ||
      (conflict.accountId === undefined &&
        actor.schoolRole !== "school_admin") ||
      (conflict.accountId &&
        conflict.accountId !== actor.accountId &&
        actor.schoolRole !== "school_admin")
    )
      throw new Error(
        "INTEGRATION_CONFLICT_FORBIDDEN: Conflict is unavailable.",
      );
    if (conflict.projectionResolution)
      throw new Error(
        "INTEGRATION_CONFLICT_PENDING: This resolution is still being applied.",
      );
    const now = Date.now();
    // A personal conflict touches only that account's projections. Reading
    // every account's projection of a shared record made each student's
    // resolution O(class size) and conflict with every classmate's write.
    // A school-wide conflict reads a bounded set and batches beyond it.
    const candidates = conflict.accountId
      ? await ctx.db
          .query("externalProjections")
          .withIndex("by_account_record", (q) =>
            q.eq("accountId", conflict.accountId).eq("recordId", conflict.recordId),
          )
          .collect()
      : await ctx.db
          .query("externalProjections")
          .withIndex("by_record_type", (q) => q.eq("recordId", conflict.recordId))
          .take(RESOLVE_INLINE_PROJECTIONS + 1);
    const projections = candidates.filter(
      (projection) =>
        projection.schoolId === actor.schoolId &&
        projection.integrationId === conflict.integrationId &&
        (conflict.accountId === undefined ||
          projection.accountId === conflict.accountId),
    );
    if (args.resolution === "link_existing" && args.linkProjectionId) {
      const linkTarget = (
        await ctx.db
          .query("externalProjections")
          .withIndex("by_projection", (q) =>
            q
              .eq("projectionType", conflict.projectionType)
              .eq("projectionId", args.linkProjectionId!),
          )
          .take(20)
      ).find(
        (projection) =>
          projection.schoolId === actor.schoolId &&
          projection.integrationId === conflict.integrationId &&
          projection.state === "active" &&
          (conflict.accountId === undefined ||
            projection.accountId === conflict.accountId),
      );
      if (!linkTarget)
        throw new Error(
          "INTEGRATION_CONFLICT_LINK_FORBIDDEN: Target projection is unavailable.",
        );
    }
    if (!conflict.accountId && candidates.length > RESOLVE_INLINE_PROJECTIONS) {
      const source = await ctx.db.get(conflict.recordId);
      // A withdrawn source has no provider facts to rebase onto.
      if (source?.tombstone && args.resolution === "rebase") throw conflictRebaseFailed();
      await ctx.db.patch(conflict._id, {
        projectionResolution: args.resolution,
        resolvedByAccountId: actor.accountId,
        updatedAt: now,
      });
      await addProviderWork(ctx, { syncRunId: conflict.syncRunId, conflictId: conflict._id });
      await ctx.scheduler.runAfter(0, internal.managebac.resolveConflictProjections, {
        conflictId: conflict._id,
        resolution: args.resolution,
        ...(args.linkProjectionId ? { linkProjectionId: args.linkProjectionId } : {}),
        cursor: null,
      });
      return { conflictId: conflict._id, resolution: args.resolution, pending: true };
    }
    for (const projection of projections)
      await patchProjectionForResolution(ctx, projection, args.resolution, args.linkProjectionId, now);
    const overlay = conflict.accountId
      ? await ctx.db
          .query("externalRecordOverlays")
          .withIndex("by_record_account", (q) =>
            q
              .eq("recordId", conflict.recordId)
              .eq("accountId", conflict.accountId!),
          )
          .unique()
      : null;
    const source = await ctx.db.get(conflict.recordId);
    const rebaseFailed = conflictRebaseFailed;
    if (
      source &&
      (args.resolution === "rebase" || args.resolution === "keep_overlay")
    ) {
      const mode = args.resolution;
      const planners = projections.filter((projection) => projection.projectionType === "planner_task");
      // Staged canonical-room effects must see this accepted resolution; the
      // conflict resolves only when every one of them has committed.
      if (planners.length && !source.tombstone)
        await ctx.db.patch(conflict._id, {
          projectionResolution: mode,
          resolvedByAccountId: actor.accountId,
          updatedAt: now,
        });
      if (planners.length > PROVIDER_INLINE_PLANNERS && !source.tombstone)
        await scheduleProviderFanout(ctx, {
          recordId: source._id, expectedSourceHash: source.sourceHash, mode,
          syncRunId: conflict.syncRunId, conflictId: conflict._id, importerAccountId: actor.accountId,
          accountId: conflict.accountId, previousNormalized: conflict.oldSource,
        });
      for (const projection of projections) {
        if (projection.projectionType === "planner_task") {
          if (source.tombstone) {
            // A withdrawn source has no provider facts to rebase onto.
            if (mode === "rebase") throw rebaseFailed();
            await ctx.db.patch(projection._id, { sourceHash: source.sourceHash, state: "active", updatedAt: now });
            continue;
          }
          if (planners.length > PROVIDER_INLINE_PLANNERS) continue;
          const outcome = await applyPlannerProviderUpdate(ctx, projection, source, {
            mode, syncRunId: conflict.syncRunId, conflictId: conflict._id, importerAccountId: actor.accountId,
            previousSourceHash: projection.sourceHash, previousNormalized: conflict.oldSource,
          });
          if (outcome === "unavailable" || outcome === "conflict") throw rebaseFailed();
          continue;
        }
        if (!(await refreshConflictProjection(ctx, projection, source, now)))
          throw rebaseFailed();
      }
      const staged = await ctx.db.get(conflict._id);
      if ((staged?.projectionWorkRemaining ?? 0) > 0)
        return { conflictId: conflict._id, resolution: args.resolution, pending: true };
    }
    if (
      overlay &&
      source &&
      (args.resolution === "rebase" || args.resolution === "keep_overlay")
    )
      await ctx.db.patch(overlay._id, {
        sourceHashAtEdit: source.sourceHash,
        updatedAt: now,
      });
    await ctx.db.patch(conflict._id, {
      status: "resolved",
      resolution: args.resolution,
      projectionResolution: undefined,
      resolvedByAccountId: actor.accountId,
      resolvedAt: now,
      updatedAt: now,
    });
    return { conflictId: conflict._id, resolution: args.resolution, pending: false };
  },
});

export const recordsForPurpose = query({
  args: {
    purpose: v.union(
      v.literal("upcoming_deadlines"),
      v.literal("class_resources"),
      v.literal("timetable"),
      v.literal("classes"),
      v.literal("cas"),
    ),
    classId: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (!integration)
      return {
        connected: false,
        records: [],
        stale: true,
        unavailableReason: "not_connected",
        provenance: null,
      };
    const mapping = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) =>
        q.eq("integrationId", integration._id).eq("accountId", actor.accountId),
      )
      .unique();
    if (!mapping || mapping.status !== "verified")
      return {
        connected: true,
        records: [],
        stale: true,
        identityRequired: true,
        unavailableReason: "identity_required",
        provenance: {
          provider: "ManageBac",
          lastSyncAt: integration.lastSyncAt,
          purpose: args.purpose,
        },
      };
    // A kind the student turned Off shows nothing, here as everywhere.
    const preferences = await loadSyncPreferences(ctx, actor.accountId, integration._id);
    const purposeKind = ({
      upcoming_deadlines: "current_tasks",
      class_resources: "task_resources",
      timetable: "classes",
      classes: undefined,
      cas: "cas",
    } as const)[args.purpose];
    if (purposeKind && !preferences.hasAny(purposeKind))
      return {
        connected: true,
        records: [],
        stale: false,
        unavailableReason: "sync_off",
        provenance: {
          provider: "ManageBac",
          lastSyncAt: integration.lastSyncAt,
          purpose: args.purpose,
        },
      };
    const now = Date.now();
    const typeMap = {
      upcoming_deadlines: ["assignment", "deadline", "assessment"],
      class_resources: [
        "class_resource",
        "school_resource",
        "resource",
        "file",
      ],
      timetable: [
        "timetable",
        "timetable_event",
        "lesson",
        "class_event",
        "calendar_event",
      ],
      classes: ["class", "course", "membership"],
      cas: ["cas_experience", "cas_reflection", "cas_evidence"],
    } as const;
    const allowed = new Set<string>(typeMap[args.purpose]);
    const personalRows = (
      await Promise.all(
        [...allowed].map((recordType) =>
          ctx.db
            .query("externalRecords")
            .withIndex("by_account_type", (q) =>
              q
                .eq("mappedAccountId", actor.accountId)
                .eq("recordType", recordType),
            )
            .order("desc")
            .take(500)
            .then((rows) =>
              rows.filter((item) => item.mappedAccountId === actor.accountId),
            ),
        ),
      )
    )
      .flat()
      .filter(
        (item) =>
          item.integrationId === integration._id &&
          item.schoolId === actor.schoolId,
      );
    const selectedKeys = new Set(
      (await ctx.db
        .query("managebacClassSelections")
        .withIndex("by_account_integration", (q) =>
          q.eq("accountId", actor.accountId).eq("integrationId", integration._id),
        )
        .collect())
        .filter((row) => row.selected)
        .map(
          (row) =>
            `${row.providerClassId}|${row.academicPeriodKey ?? "unknown"}`,
        ),
    );
    const membershipRows = (
      await Promise.all(
        ["class", "course", "membership"].map((recordType) =>
          ctx.db
            .query("externalRecords")
            .withIndex("by_account_type", (q) =>
              q
                .eq("mappedAccountId", actor.accountId)
                .eq("recordType", recordType),
            )
            .take(500)
            .then((rows) =>
              rows.filter((item) => item.mappedAccountId === actor.accountId),
            ),
        ),
      )
    )
      .flat()
      .filter(
        (item) =>
          item.integrationId === integration._id &&
          item.schoolId === actor.schoolId &&
          !item.tombstone,
      );
    const accessibleClassIds = new Set(
      membershipRows
        .flat()
        .flatMap((item) =>
          item.providerClassId ? [item.providerClassId] : [],
        ),
    );
    const scopedRows = (
      await Promise.all(
        [...allowed].map((recordType) =>
          ctx.db
            .query("externalRecords")
            .withIndex("by_integration_type", (q) =>
              q
                .eq("integrationId", integration._id)
                .eq("recordType", recordType),
            )
            .order("desc")
            .take(500),
        ),
      )
    )
      .flat()
      .filter((item) => !item.mappedAccountId)
      .filter(
        (item) =>
          item.audienceScope === "school" ||
          (item.audienceScope === "class_members" &&
            Boolean(
              item.providerClassId &&
              accessibleClassIds.has(item.providerClassId),
            )) ||
          (item.audienceScope === "authorized_staff" &&
            (actor.schoolRole === "teacher" ||
              actor.schoolRole === "school_admin")),
      );
    const deduped = new Map(
      [...scopedRows, ...personalRows].map((item) => [
        item.sourceIdentityKey ??
          `${item.mappedAccountId ?? "shared"}|${item.academicPeriodKey ?? "unknown"}|${item.providerRecordKey}`,
        item,
      ]),
    );
    const limited = [...deduped.values()]
      .filter((item) => !item.tombstone)
      .filter((item) => !item.mappedAccountId || !hiddenByPreferences(preferences, item, now))
      .filter(
        (item) =>
          args.purpose === "classes" ||
          !item.providerClassId ||
          selectedKeys.has(
            `${item.providerClassId}|${item.academicPeriodKey ?? "unknown"}`,
          ) ||
          selectedKeys.has(`${item.providerClassId}|unknown`) ||
          (item.academicPeriodKey === undefined &&
            [...selectedKeys].some((key) =>
              key.startsWith(`${item.providerClassId}|`),
            )),
      )
      .filter(
        (item) =>
          !args.classId ||
          (accessibleClassIds.has(args.classId) &&
            item.providerClassId === args.classId),
      )
      .filter((item) => {
        const normalized = record(item.normalized);
        const timestamp =
          timestampValue(normalized.dueAt ?? normalized.deadlineAt) ??
          timestampValue(normalized.startAt ?? normalized.start) ??
          null;
        // Upcoming deadlines default to "now onward" so stale historical tasks
        // do not crowd out current ManageBac work when the model omits a range.
        const effectiveFrom =
          args.from ??
          (args.purpose === "upcoming_deadlines"
            ? Date.now() - 2 * 24 * 60 * 60_000
            : undefined);
        return (
          timestamp === null ||
          ((effectiveFrom === undefined || timestamp >= effectiveFrom) &&
            (args.to === undefined || timestamp <= args.to))
        );
      })
      .sort((a, b) => {
        const left = record(a.normalized);
        const right = record(b.normalized);
        const leftTs =
          timestampValue(left.dueAt ?? left.startAt ?? left.start) ??
          Number.MAX_SAFE_INTEGER;
        const rightTs =
          timestampValue(right.dueAt ?? right.startAt ?? right.start) ??
          Number.MAX_SAFE_INTEGER;
        if (args.purpose === "upcoming_deadlines") return leftTs - rightTs;
        // Prefer freshest provider updates for CAS/classes/resources.
        return (
          (b.sourceModifiedAt ?? b.fetchedAt ?? 0) -
          (a.sourceModifiedAt ?? a.fetchedAt ?? 0)
        );
      })
      .slice(0, Math.max(1, Math.min(args.limit ?? 50, 200)));
    const staleByAge =
      !integration.lastSyncAt ||
      Date.now() - integration.lastSyncAt >
        integration.freshnessSlaMinutes * 60_000;
    // Empty CAS/deadlines while connected usually means the cache never
    // ingested those routes — treat as stale so the AI can refresh.
    const staleByEmptyPurpose =
      limited.length === 0 &&
      (args.purpose === "cas" ||
        args.purpose === "upcoming_deadlines" ||
        args.purpose === "class_resources");
    return {
      connected: true,
      records: limited.map((item) => ({
        id: item._id,
        recordType: item.recordType,
        normalized: item.normalized,
        providerClassId: item.providerClassId,
        academicPeriodKey: item.academicPeriodKey,
        sourceIdentityKey: item.sourceIdentityKey,
        sourceState: item.sourceState ?? (item.tombstone ? "removed" : "available"),
        sourceHash: item.sourceHash,
        sourceModifiedAt: item.sourceModifiedAt,
        fetchedAt: item.fetchedAt,
        provenanceUrl: item.provenanceUrl,
      })),
      stale: staleByAge || staleByEmptyPurpose,
      provenance: {
        provider: "ManageBac",
        lastSyncAt: integration.lastSyncAt,
        purpose: args.purpose,
      },
    };
  },
});

async function permissionedResourceImportSource(
  ctx: Ctx,
  sourceRecordId: Id<"externalRecords">,
) {
  const actor = await requireActor(ctx);
  const integration = await integrationForSchool(ctx, actor.schoolId);
  if (!integration || integration.status === "revoked")
    throw new Error("INTEGRATION_NOT_CONNECTED: ManageBac is not connected.");
  const mapping = await ctx.db
    .query("externalIdentityMappings")
    .withIndex("by_integration_account", (q) =>
      q.eq("integrationId", integration._id).eq("accountId", actor.accountId),
    )
    .unique();
  if (actor.schoolRole !== "school_admin" && (!mapping || mapping.status !== "verified"))
    throw new Error("INTEGRATION_IDENTITY_REQUIRED: Resolve your verified provider identity first.");
  const source = await ctx.db.get(sourceRecordId);
  if (
    !source ||
    source.integrationId !== integration._id ||
    source.schoolId !== actor.schoolId ||
    !["resource", "class_resource", "school_resource", "file"].includes(
      source.recordType,
    ) ||
    (source.mappedAccountId !== undefined &&
      source.mappedAccountId !== actor.accountId) ||
    !source.providerClassId
  )
    throw new Error(
      "INTEGRATION_RESOURCE_NOT_ALLOWED: Choose a resource from your selected class shelf.",
    );
  const selected = await ctx.db
    .query("managebacClassSelections")
    .withIndex("by_integration_account_class", (q) =>
      q
        .eq("integrationId", integration._id)
        .eq("accountId", actor.accountId)
        .eq("providerClassId", source.providerClassId!),
    )
    .collect();
  if (
    !selected.some(
      (row) =>
        row.selected &&
        (row.academicPeriodKey ?? "unknown") ===
          (source.academicPeriodKey ?? "unknown"),
    )
  )
    throw new Error(
      "INTEGRATION_RESOURCE_CLASS_NOT_SELECTED: Select this class before importing its resources.",
    );
  return { actor, integration, source };
}

export const beginResourceImport = mutation({
  args: {
    sourceRecordId: v.id("externalRecords"),
    requestKey: v.optional(v.string()),
    refresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { actor, integration, source } = await permissionedResourceImportSource(
      ctx,
      args.sourceRecordId,
    );
    const requestKey =
      args.requestKey?.trim() || `${source._id}:${source.sourceHash}`;
    if (!requestKey || requestKey.length > 240)
      throw new Error("INTEGRATION_RESOURCE_REQUEST_KEY_INVALID");
    const priorForRequest = await ctx.db
      .query("managebacResourceImports")
      .withIndex("by_account_request", (q) =>
        q.eq("accountId", actor.accountId).eq("requestKey", requestKey),
      )
      .unique();
    if (priorForRequest && priorForRequest.sourceRecordId !== source._id)
      throw new Error("INTEGRATION_RESOURCE_REQUEST_REUSED");
    const prior =
      priorForRequest ??
      (
        await ctx.db
          .query("managebacResourceImports")
          .withIndex("by_account_source", (q) =>
            q
              .eq("accountId", actor.accountId)
              .eq("sourceRecordId", source._id)
              .eq("sourceHash", source.sourceHash),
          )
          .collect()
      ).sort((left, right) => right.updatedAt - left.updatedAt)[0];
    const sourceState = source.sourceState ?? (source.tombstone ? "removed" : "available");
    if (["temporarily_unavailable", "missing", "removed"].includes(sourceState)) {
      const retained = (await ctx.db
        .query("managebacResourceImports")
        .withIndex("by_account_source_record", (q) =>
          q.eq("accountId", actor.accountId).eq("sourceRecordId", source._id),
        )
        .collect())
        .find((row) => row.status === "imported" && row.artifactId);
      if (retained)
        return {
          status: "source_unavailable" as const,
          importId: retained._id,
          artifactId: retained.artifactId,
          sourceHash: retained.sourceHash,
          sourceState,
        };
      throw new Error(
        `INTEGRATION_RESOURCE_UNAVAILABLE: This resource is currently ${sourceState.replaceAll("_", " ")}.`,
      );
    }
    if (prior && prior.status === "imported")
      return {
        status: "imported" as const,
        importId: prior._id,
        artifactId: prior.artifactId,
        sourceHash: prior.sourceHash,
        providerRecordId: source.providerRecordId,
        providerClassId: source.providerClassId,
        title: typeof source.normalized?.title === "string" ? source.normalized.title : "School resource",
        normalized: source.normalized,
        replayed: true,
      };
    if (prior && prior.status !== "failed")
      return {
        status: "resume" as const,
        importId: prior._id,
        artifactId: prior.artifactId,
        sourceHash: prior.sourceHash,
        providerRecordId: source.providerRecordId,
        providerClassId: source.providerClassId,
        title: typeof source.normalized?.title === "string" ? source.normalized.title : "School resource",
        normalized: source.normalized,
        replayed: true,
      };
    if (prior && prior.status === "failed") {
      await ctx.db.patch(prior._id, {
        status: "started",
        errorCode: undefined,
        errorSummary: undefined,
        updatedAt: Date.now(),
      });
      return {
        status: "resume" as const,
        importId: prior._id,
        artifactId: prior.artifactId,
        sourceHash: prior.sourceHash,
        providerRecordId: source.providerRecordId,
        providerClassId: source.providerClassId,
        title: typeof source.normalized?.title === "string" ? source.normalized.title : "School resource",
        normalized: source.normalized,
        replayed: true,
      };
    }
    const priorRevision = await ctx.db
      .query("managebacResourceImports")
      .withIndex("by_account_source_record", (q) =>
        q
          .eq("accountId", actor.accountId)
          .eq("sourceRecordId", source._id),
      )
      .collect();
    if (!args.refresh && priorRevision.some((row) => row.status === "imported"))
      return {
        status: "update_available" as const,
        sourceHash: source.sourceHash,
        priorArtifactId: priorRevision.find((row) => row.status === "imported")
          ?.artifactId,
      };
    const now = Date.now();
    const importId = await ctx.db.insert("managebacResourceImports", {
      integrationId: integration._id,
      schoolId: actor.schoolId,
      accountId: actor.accountId,
      sourceRecordId: source._id,
      sourceHash: source.sourceHash,
      requestKey,
      status: "started",
      createdAt: now,
      updatedAt: now,
    });
    return {
      status: "started" as const,
      importId,
      sourceHash: source.sourceHash,
      providerRecordId: source.providerRecordId,
      providerClassId: source.providerClassId,
      title:
        typeof source.normalized?.title === "string"
          ? source.normalized.title
          : "School resource",
      normalized: source.normalized,
    };
  },
});

export const attachResourceImportArtifact = mutation({
  args: {
    importId: v.id("managebacResourceImports"),
    artifactId: v.id("spectraArtifacts"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const row = await ctx.db.get(args.importId);
    const artifact = await ctx.db.get(args.artifactId);
    if (
      !row ||
      row.accountId !== actor.accountId ||
      row.schoolId !== actor.schoolId ||
      !artifact ||
      artifact.ownerAccountId !== actor.accountId ||
      artifact.schoolId !== actor.schoolId
    )
      throw new Error("INTEGRATION_RESOURCE_IMPORT_NOT_ALLOWED");
    if (row.artifactId && row.artifactId !== artifact._id)
      throw new Error("INTEGRATION_RESOURCE_IMPORT_ARTIFACT_CONFLICT");
    await ctx.db.patch(row._id, {
      artifactId: artifact._id,
      status: "importing",
      updatedAt: Date.now(),
    });
    return { importId: row._id, artifactId: artifact._id };
  },
});

export const completeResourceImport = mutation({
  args: {
    importId: v.id("managebacResourceImports"),
    sourceHash: v.string(),
    contentHash: v.string(),
    bytes: v.number(),
    mimeType: v.string(),
    nativeFormat: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const row = await ctx.db.get(args.importId);
    if (!row || row.accountId !== actor.accountId || row.schoolId !== actor.schoolId)
      throw new Error("INTEGRATION_RESOURCE_IMPORT_NOT_ALLOWED");
    if (row.status === "imported")
      return { status: "imported" as const, importId: row._id, artifactId: row.artifactId, replayed: true };
    const { source } = await permissionedResourceImportSource(ctx, row.sourceRecordId);
    if (["temporarily_unavailable", "missing", "removed"].includes(source.sourceState ?? (source.tombstone ? "removed" : "available")))
      throw new Error("INTEGRATION_RESOURCE_UNAVAILABLE: The provider resource is no longer available; the existing Library copy remains retained.");
    if (source.sourceHash !== args.sourceHash || row.sourceHash !== args.sourceHash)
      throw new Error("INTEGRATION_RESOURCE_SOURCE_CHANGED: Refresh the source and import the new revision explicitly.");
    if (!row.artifactId) throw new Error("INTEGRATION_RESOURCE_ARTIFACT_MISSING");
    const artifact = await ctx.db.get(row.artifactId);
    if (!artifact || artifact.ownerAccountId !== actor.accountId || artifact.schoolId !== actor.schoolId)
      throw new Error("INTEGRATION_RESOURCE_ARTIFACT_NOT_OWNED");
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "imported",
      contentHash: args.contentHash,
      bytes: args.bytes,
      mimeType: args.mimeType.slice(0, 160),
      nativeFormat: args.nativeFormat.slice(0, 40),
      errorCode: undefined,
      errorSummary: undefined,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.resource_imported",
      targetType: "spectra_artifact",
      targetId: String(row.artifactId),
      metadata: {
        sourceRecordId: String(row.sourceRecordId),
        sourceHash: args.sourceHash,
        bytes: args.bytes,
      },
      retentionClass: "operational",
    });
    return { status: "imported" as const, importId: row._id, artifactId: row.artifactId };
  },
});

export const failResourceImport = mutation({
  args: {
    importId: v.id("managebacResourceImports"),
    errorCode: v.string(),
    errorSummary: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const row = await ctx.db.get(args.importId);
    if (!row || row.accountId !== actor.accountId || row.schoolId !== actor.schoolId)
      throw new Error("INTEGRATION_RESOURCE_IMPORT_NOT_ALLOWED");
    await ctx.db.patch(row._id, {
      status: "failed",
      artifactId: undefined,
      errorCode: args.errorCode.slice(0, 120),
      errorSummary: args.errorSummary.slice(0, 500),
      updatedAt: Date.now(),
    });
    return { importId: row._id, status: "failed" as const };
  },
});

/** sha256 as Convex storage reports it (base64) to hex. */
function base64ToHex(value: string) {
  return [...decodeBase64Url(value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type SubmissionFile = {
  id: string;
  filename: string;
  mimeType: string;
  bytes?: number;
  downloadPath?: string;
};

/** The files a submission lists, as the route normalized them. */
export function submissionFiles(normalized: unknown): SubmissionFile[] {
  const files = record(normalized).files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((raw) => {
    const file = record(raw);
    const id = String(file.id ?? "").trim();
    if (!id) return [];
    const bytes = Number(file.bytes ?? file.fileSize ?? file.file_size);
    return [{
      id,
      filename: text(file.filename ?? file.name, 240, "File"),
      mimeType: text(file.mimeType ?? file.contentType ?? file.content_type, 160, "application/octet-stream"),
      ...(Number.isFinite(bytes) && bytes >= 0 ? { bytes } : {}),
      ...(typeof (file.downloadPath ?? file.download_path) === "string"
        ? { downloadPath: String(file.downloadPath ?? file.download_path).slice(0, 2_000) }
        : {}),
    }];
  });
}

/** The student's own submission, or nothing: another student's work is never found. */
async function ownSubmission(ctx: MutationCtx, actor: Actor, submissionRecordId: Id<"externalRecords">) {
  const integration = await integrationForSchool(ctx, actor.schoolId);
  const source = await ctx.db.get(submissionRecordId);
  if (
    !integration ||
    !source ||
    source.integrationId !== integration._id ||
    source.schoolId !== actor.schoolId ||
    source.mappedAccountId !== actor.accountId ||
    source.tombstone ||
    recordSyncKind(source.recordType, source.normalized, { classArchived: false, now: 0 }) !== "dropbox_files"
  )
    throw new Error("SCHOOL_RECORD_NOT_FOUND: That submission isn't in your School data.");
  const preferences = await loadSyncPreferences(ctx, actor.accountId, integration._id);
  if (preferences.modeFor("dropbox_files", source.providerClassId) === "off")
    throw new Error("SCHOOL_RECORD_NOT_FOUND: That submission isn't in your School data.");
  return { integration, source };
}

/**
 * Starts fetching one submitted file into the student's storage. A file already cached, or
 * the same bytes kept for another submission, is returned without reading ManageBac again.
 */
export const beginSchoolFileFetch = mutation({
  args: {
    submissionRecordId: v.id("externalRecords"),
    providerFileId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const { integration, source } = await ownSubmission(ctx, actor, args.submissionRecordId);
    const file = submissionFiles(source.normalized).find((item) => item.id === args.providerFileId);
    if (!file)
      throw new Error("SCHOOL_RECORD_NOT_FOUND: That file isn't part of this submission.");
    if (file.bytes !== undefined && file.bytes > SCHOOL_FILE_MAX_BYTES)
      throw new Error("SCHOOL_FILE_TOO_LARGE: This file is larger than Spectra keeps (50 MB).");
    const now = Date.now();
    const rows = await ctx.db
      .query("schoolFiles")
      .withIndex("by_account_source", (q) => q.eq("accountId", actor.accountId).eq("sourceRecordId", source._id))
      .take(100);
    const existing = rows.find((row) => row.providerFileId === file.id);
    if (existing?.state === "cached" && existing.storageId)
      return { status: "cached" as const, schoolFileId: existing._id };
    const schoolFileId = existing?._id ?? await ctx.db.insert("schoolFiles", {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      integrationId: integration._id,
      sourceRecordId: source._id,
      origin: "dropbox",
      providerFileId: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      state: "fetching",
      ...(file.bytes !== undefined ? { bytes: file.bytes } : {}),
      createdAt: now,
      updatedAt: now,
    });
    if (existing)
      await ctx.db.patch(existing._id, { state: "fetching", errorCode: undefined, errorSummary: undefined, updatedAt: now });
    return {
      status: "fetch" as const,
      schoolFileId,
      integrationId: integration._id,
      providerClassId: source.providerClassId,
      taskId: String(record(source.normalized).taskId ?? ""),
      file,
      uploadUrl: await ctx.storage.generateUploadUrl(),
    };
  },
});

/**
 * Keeps the fetched bytes. The upload must match the hash and size the route measured; the
 * same bytes the student already keeps are stored once.
 */
export const attachSchoolFile = mutation({
  args: {
    schoolFileId: v.id("schoolFiles"),
    storageId: v.id("_storage"),
    contentHash: v.string(),
    bytes: v.number(),
    mimeType: v.string(),
    extractedText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const row = await ctx.db.get(args.schoolFileId);
    const stored = await ctx.db.system.get(args.storageId);
    const discard = async () => {
      if (stored && !(await storageHasOtherBinding(ctx, args.storageId, { table: "schoolFiles", id: String(args.schoolFileId) })))
        await ctx.storage.delete(args.storageId);
    };
    if (!row || row.accountId !== actor.accountId || row.schoolId !== actor.schoolId) {
      await discard();
      throw new Error("SCHOOL_RECORD_NOT_FOUND: That file isn't in your School data.");
    }
    const contentHash = args.contentHash.toLowerCase();
    // Only a fresh upload is adopted: bytes something else keeps are never re-bound.
    if (stored && await storageHasOtherBinding(ctx, args.storageId, { table: "schoolFiles", id: String(args.schoolFileId) }))
      throw new Error("SCHOOL_RECORD_NOT_FOUND: That file isn't in your School data.");
    if (!stored || stored.size !== args.bytes || base64ToHex(stored.sha256) !== contentHash || !/^[0-9a-f]{64}$/.test(contentHash)) {
      await discard();
      throw new Error("SCHOOL_FILE_INTEGRITY: The fetched file didn't match what was uploaded.");
    }
    if (args.bytes > SCHOOL_FILE_MAX_BYTES) {
      await discard();
      throw new Error("SCHOOL_FILE_TOO_LARGE: This file is larger than Spectra keeps (50 MB).");
    }
    const twin = (
      await ctx.db
        .query("schoolFiles")
        .withIndex("by_account_hash", (q) => q.eq("accountId", actor.accountId).eq("contentHash", contentHash))
        .take(5)
    ).find((item) => item._id !== row._id && item.storageId);
    let storageId = args.storageId;
    if (twin?.storageId && twin.storageId !== args.storageId) {
      await ctx.storage.delete(args.storageId);
      storageId = twin.storageId;
    }
    const previous = row.storageId;
    const now = Date.now();
    await ctx.db.patch(row._id, {
      state: "cached",
      storageId,
      contentHash,
      bytes: args.bytes,
      mimeType: text(args.mimeType, 160, row.mimeType),
      extractedText: args.extractedText ? args.extractedText.slice(0, SCHOOL_FILE_TEXT_MAX_CHARS) : undefined,
      errorCode: undefined,
      errorSummary: undefined,
      fetchedAt: now,
      updatedAt: now,
    });
    if (previous && previous !== storageId)
      await deleteStorageIfNoOtherBinding(ctx, previous, { table: "schoolFiles", id: String(row._id) });
    return { schoolFileId: row._id, storageId, deduplicated: storageId !== args.storageId };
  },
});

export const failSchoolFileFetch = mutation({
  args: {
    schoolFileId: v.id("schoolFiles"),
    errorCode: v.string(),
    errorSummary: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const row = await ctx.db.get(args.schoolFileId);
    if (!row || row.accountId !== actor.accountId || row.schoolId !== actor.schoolId)
      throw new Error("SCHOOL_RECORD_NOT_FOUND: That file isn't in your School data.");
    if (row.state !== "cached")
      await ctx.db.patch(row._id, {
        state: "failed",
        errorCode: text(args.errorCode, 120),
        errorSummary: text(args.errorSummary, 500),
        updatedAt: Date.now(),
      });
    return { schoolFileId: row._id, state: row.state === "cached" ? "cached" as const : "failed" as const };
  },
});

export const setSelectedClasses = mutation({
  args: {
    recordIds: v.array(v.id("externalRecords")),
    expectedRevision: v.optional(v.number()),
    retention: v.optional(
      v.union(v.literal("keep_in_spectra"), v.literal("archive_projection")),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (!integration || integration.status === "revoked")
      throw new Error("INTEGRATION_NOT_CONNECTED: ManageBac is not connected.");
    const currentRows = await ctx.db
      .query("managebacClassSelections")
      .withIndex("by_account_integration", (q) =>
        q.eq("accountId", actor.accountId).eq("integrationId", integration._id),
      )
      .collect();
    const currentRevision = currentRows.reduce(
      (highest, row) => Math.max(highest, row.selectionRevision),
      0,
    );
    if (
      args.expectedRevision !== undefined &&
      args.expectedRevision !== currentRevision
    )
      throw new Error(
        "INTEGRATION_SELECTION_CONFLICT: Class choices changed. Reload the class list and try again.",
      );
    const membershipRows = (
      await Promise.all(
        ["class", "course", "membership"].map((recordType) =>
          ctx.db
            .query("externalRecords")
            .withIndex("by_account_type", (q) =>
              q.eq("mappedAccountId", actor.accountId).eq("recordType", recordType),
            )
            .take(500),
        ),
      )
    )
      .flat()
      .filter(
        (row) =>
          row.integrationId === integration._id &&
          row.schoolId === actor.schoolId &&
          !row.tombstone &&
          Boolean(row.providerClassId),
      );
    const accessibleClassIds = new Set(
      membershipRows.map((row) => row.providerClassId!),
    );
    const selectedRecords: Array<Doc<"externalRecords">> = [];
    for (const recordId of [...new Set(args.recordIds)].slice(0, 100)) {
      const source = await ctx.db.get(recordId);
      if (
        !source ||
        source.integrationId !== integration._id ||
        source.schoolId !== actor.schoolId ||
        source.recordType !== "class" ||
        source.tombstone ||
        (source.mappedAccountId !== actor.accountId &&
          (!source.providerClassId ||
            !accessibleClassIds.has(source.providerClassId))) ||
        !source.providerClassId
      )
        throw new Error(
          "INTEGRATION_CLASS_SELECTION_INVALID: Choose only current classes from your ManageBac membership.",
        );
      selectedRecords.push(source);
    }
    const selectedKeys = new Set(
      selectedRecords.map(
        (source) =>
          `${source.providerClassId}|${canonicalAcademicPeriodKey(source.academicPeriodKey) ?? "unknown"}`,
      ),
    );
    const currentSelectedKeys = new Set(
      currentRows
        .filter((row) => row.selected)
        .map((row) => `${row.providerClassId}|${row.academicPeriodKey ?? "unknown"}`),
    );
    const deselectedKeys = new Set(
      [...currentSelectedKeys].filter((key) => !selectedKeys.has(key)),
    );
    const deselectedRecordIds = membershipRows
      .filter(
        (source) =>
          source.recordType === "class" &&
          source.providerClassId &&
          deselectedKeys.has(
            `${source.providerClassId}|${canonicalAcademicPeriodKey(source.academicPeriodKey) ?? "unknown"}`,
          ),
      )
      .map((source) => source._id);
    const revision = currentRevision + 1;
    const now = Date.now();
    /* Retention is the deselect policy for rows leaving the selection.
       Do not stamp archive_projection onto classes that remain selected —
       that polluted the onboarding radio (any selected row with archive)
       without changing release behavior for kept shelves. */
    const nextRetention = args.retention ?? "keep_in_spectra";
    for (const row of currentRows) {
      const key = `${row.providerClassId}|${row.academicPeriodKey ?? "unknown"}`;
      const shouldSelect = selectedKeys.has(key);
      if (row.selected === shouldSelect) {
        if (row.selectionRevision === revision) continue;
        if (shouldSelect) {
          await ctx.db.patch(row._id, {
            selectionRevision: revision,
            updatedAt: now,
          });
        }
        continue;
      }
      await ctx.db.patch(row._id, {
        selected: shouldSelect,
        retention: shouldSelect
          ? row.retention ?? "keep_in_spectra"
          : nextRetention,
        selectionRevision: revision,
        ...(shouldSelect
          ? { selectedAt: now, deselectedAt: undefined }
          : { deselectedAt: now }),
        updatedAt: now,
      });
    }
    for (const source of selectedRecords) {
      const periodKey = canonicalAcademicPeriodKey(source.academicPeriodKey);
      const existing = currentRows.find(
        (row) =>
          row.providerClassId === source.providerClassId &&
          (row.academicPeriodKey ?? undefined) === periodKey,
      );
      if (existing) {
        if (!existing.selected)
          await ctx.db.patch(existing._id, {
            selected: true,
            /* Re-select restores follow without inheriting a prior archive
               stamp as the live radio source of truth. */
            retention: "keep_in_spectra",
            selectionRevision: revision,
            selectedAt: now,
            deselectedAt: undefined,
            updatedAt: now,
          });
        else if (existing.selectionRevision !== revision)
          await ctx.db.patch(existing._id, {
            selectionRevision: revision,
            updatedAt: now,
          });
        continue;
      }
      await ctx.db.insert("managebacClassSelections", {
        integrationId: integration._id,
        schoolId: actor.schoolId,
        accountId: actor.accountId,
        providerClassId: source.providerClassId!,
        providerRecordKey: source.providerRecordKey,
        ...(periodKey ? { academicPeriodKey: periodKey } : {}),
        selected: true,
        retention: "keep_in_spectra",
        selectionRevision: revision,
        selectedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.class_selection_changed",
      targetType: "school_integration",
      targetId: integration._id,
      metadata: {
        selectionRevision: revision,
        selectedClassCount: selectedKeys.size,
      },
      retentionClass: "operational",
    });
    // Newly followed classes fill in soon: every class-scoped kind on Auto runs again.
    const preferences = await loadSyncPreferences(ctx, actor.accountId, integration._id);
    for (const kind of SCHOOL_SYNC_KINDS)
      if (kind !== "classes" && SCHOOL_SYNC_KIND_INFO[kind].classScoped && preferences.hasAuto(kind))
        await queueSyncJob(ctx, { accountId: actor.accountId, schoolId: actor.schoolId, integrationId: integration._id, kind }, "schedule", now);
    return {
      selectionRevision: revision,
      selectedClassIds: [...selectedKeys],
      selectedRecordIds: selectedRecords.map((source) => source._id),
      deselectedRecordIds,
      retention: nextRetention,
    };
  },
});

/**
 * Backfill canonical provider identities for records written before account
 * and academic-period scoping existed. This is intentionally bounded and
 * resumable. Collisions are ledgered rather than deleted, preserving the
 * legacy row's overlays/projections for an administrator to review.
 */
export const migrateSourceIdentityKeys = mutation({
  args: {
    integrationId: v.optional(v.id("schoolIntegrations")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const integration = args.integrationId
      ? await requireIntegration(ctx, actor, args.integrationId)
      : await integrationForSchool(ctx, actor.schoolId);
    if (!integration || integration.status === "revoked")
      throw new Error("INTEGRATION_NOT_CONNECTED: ManageBac is not connected.");
    const limit = Math.max(1, Math.min(args.limit ?? 250, 500));
    const rows = await ctx.db
      .query("externalRecords")
      .withIndex("by_school_updated", (q) => q.eq("schoolId", actor.schoolId))
      .order("asc")
      .take(limit * 4);
    const candidates = rows.filter(
      (row) =>
        row.integrationId === integration._id &&
        row.sourceIdentityKey === undefined &&
        (actor.schoolRole === "school_admin" ||
          row.mappedAccountId === actor.accountId),
    ).slice(0, limit);
    let linked = 0;
    let duplicates = 0;
    let skipped = 0;
    const now = Date.now();
    for (const row of candidates) {
      const canonicalKey = sourceIdentityKey(
        integration._id,
        row.mappedAccountId,
        {
          providerRecordKey: row.providerRecordKey,
          audienceScope: row.audienceScope,
          academicPeriodKey: row.academicPeriodKey,
        },
      );
      const priorLedger = await ctx.db
        .query("externalRecordIdentityMigrations")
        .withIndex("by_legacy_record", (q) => q.eq("legacyRecordId", row._id))
        .collect();
      if (priorLedger.some((item) => item.canonicalKey === canonicalKey)) {
        skipped += 1;
        continue;
      }
      const matches = await ctx.db
        .query("externalRecords")
        .withIndex("by_source_identity", (q) =>
          q.eq("integrationId", integration._id).eq("sourceIdentityKey", canonicalKey),
        )
        .collect();
      const survivor = matches.find((item) => item._id !== row._id);
      if (survivor) {
        await ctx.db.insert("externalRecordIdentityMigrations", {
          integrationId: integration._id,
          schoolId: actor.schoolId,
          legacyRecordId: row._id,
          canonicalKey,
          status: "duplicate",
          survivorRecordId: survivor._id,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.patch(row._id, {
          sourceState: "changed",
          sourceStateAt: now,
          sourceStateReason:
            "Legacy provider identity collided with a newer account- or period-scoped record; links were preserved for review.",
          updatedAt: now,
        });
        duplicates += 1;
        continue;
      }
      await ctx.db.patch(row._id, {
        sourceIdentityKey: canonicalKey,
        sourceState: row.tombstone ? "removed" : "available",
        sourceStateAt: now,
        sourceStateReason: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("externalRecordIdentityMigrations", {
        integrationId: integration._id,
        schoolId: actor.schoolId,
        legacyRecordId: row._id,
        canonicalKey,
        status: "linked",
        createdAt: now,
        updatedAt: now,
      });
      linked += 1;
    }
    return {
      scanned: candidates.length,
      linked,
      duplicates,
      skipped,
      hasMore: candidates.length >= limit,
    };
  },
});

export const listMyClassCandidates = query({
  args: {},
  handler: async (ctx) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) return null;
    const integration = await ctx.db
      .query("schoolIntegrations")
      .withIndex("by_school_provider", (q) =>
        q.eq("schoolId", actor.schoolId).eq("provider", "managebac"),
      )
      .unique();
    if (!integration || integration.status === "revoked")
      return { integration: null, classes: [] as Array<Record<string, unknown>>, lastSyncAt: undefined as number | undefined, nextSyncAt: undefined as number | undefined };
    const mapping = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) =>
        q.eq("integrationId", integration._id).eq("accountId", actor.accountId),
      )
      .unique();
    if (!mapping || mapping.status !== "verified")
      return {
        integration: safeIntegration(integration),
        classes: [] as Array<Record<string, unknown>>,
        identityRequired: true,
        identityStatus: mapping?.status ?? "pending",
        identityMatchCount: mapping?.matchCount ?? 0,
        lastSyncAt: integration.lastSyncAt,
        nextSyncAt: integration.nextSyncAt,
      };
    const selectionRows = await ctx.db
      .query("managebacClassSelections")
      .withIndex("by_account_integration", (q) =>
        q.eq("accountId", actor.accountId).eq("integrationId", integration._id),
      )
      .collect();
    const selection = {
      revision: selectionRows.reduce(
        (highest, row) => Math.max(highest, row.selectionRevision),
        0,
      ),
      selectedClassIds: selectionRows
        .filter((row) => row.selected)
        .map((row) => row.providerClassId),
    };
    const selectedKeys = new Set(
      selectionRows
        .filter((row) => row.selected)
        .map((row) => `${row.providerClassId}|${row.academicPeriodKey ?? "unknown"}`),
    );
    const retentionByKey = new Map(
      selectionRows.map((row) => [
        `${row.providerClassId}|${row.academicPeriodKey ?? "unknown"}`,
        row.retention,
      ]),
    );
    const [records, projections, membershipRows] = await Promise.all([
      ctx.db
        .query("externalRecords")
        .withIndex("by_integration_type", (q) =>
          q.eq("integrationId", integration._id).eq("recordType", "class"),
        )
        .order("desc")
        .take(2_000),
      ctx.db
        .query("externalProjections")
        .withIndex("by_account_updated", (q) => q.eq("accountId", actor.accountId))
        .order("desc")
        .take(2_000),
      Promise.all(
        ["class", "course", "membership"].map((recordType) =>
          ctx.db
            .query("externalRecords")
            .withIndex("by_account_type", (q) =>
              q
                .eq("mappedAccountId", actor.accountId)
                .eq("recordType", recordType),
            )
            .take(500)
            .then((rows) =>
              rows.filter((item) => item.mappedAccountId === actor.accountId),
            ),
        ),
      ),
    ]);
    const integrationRecords = records.filter(
      (item) =>
        item.integrationId === integration._id &&
        item.schoolId === actor.schoolId,
    );
    const integrationMemberships = membershipRows
      .flat()
      .filter(
        (item) =>
          item.integrationId === integration._id &&
          item.schoolId === actor.schoolId &&
          !item.tombstone,
      );
    const accessibleClassIds = new Set(
      integrationMemberships.flatMap((item) =>
        item.providerClassId ? [item.providerClassId] : [],
      ),
    );
    const workspaceByProviderKey = new Map(
      projections
        .filter(
          (item) =>
            item.integrationId === integration._id &&
            item.projectionType === "workspace" &&
            item.state === "active",
        )
        .map((item) => [item.providerKey, item.projectionId] as const),
    );
    const eligibleClasses = integrationRecords.filter(
      (item) =>
        item.recordType === "class" &&
        !item.tombstone &&
        (item.mappedAccountId === actor.accountId ||
          Boolean(
            item.providerClassId &&
            accessibleClassIds.has(item.providerClassId),
          )),
    );
    const bestClassByProvider = new Map<
      string,
      (typeof eligibleClasses)[number]
    >();
    const candidateScore = (item: (typeof eligibleClasses)[number]) => {
      const normalized = record(item.normalized);
      const title = text(normalized.name ?? normalized.title, 180);
      return (
        (item.mappedAccountId === actor.accountId ? 10_000 : 0) +
        (title && title !== "ManageBac class" ? 1_000 : 0) +
        item.fetchedAt / 1_000_000_000_000
      );
    };
    for (const item of eligibleClasses) {
      const key = `${item.providerClassId ?? item.providerRecordId}|${item.academicPeriodKey ?? "unknown"}`;
      const current = bestClassByProvider.get(key);
      if (!current || candidateScore(item) > candidateScore(current))
        bestClassByProvider.set(key, item);
    }
    const classes = [...bestClassByProvider.values()]
      .map((item) => {
        const normalized = record(item.normalized);
        const archived =
          normalized.archived === true || normalized.archived === "true";
        const providerKey = `class:${item.providerClassId ?? item.providerRecordId}:${item.academicPeriodKey ?? "current"}`;
        const workspaceId = workspaceByProviderKey.get(providerKey);
        return {
          recordId: item._id,
          providerRecordId: item.providerRecordId,
          providerClassId: item.providerClassId,
          title: text(normalized.name ?? normalized.title, 180, "ManageBac class"),
          program: text(normalized.program ?? normalized.programme, 120),
          grade: text(normalized.grade, 80),
          description: plainText(normalized.description, 400),
          archived,
          workspaceId: workspaceId ?? null,
          selected: selectedKeys.has(
            `${item.providerClassId ?? item.providerRecordId}|${item.academicPeriodKey ?? "unknown"}`,
          ),
          retention: retentionByKey.get(
            `${item.providerClassId ?? item.providerRecordId}|${item.academicPeriodKey ?? "unknown"}`,
          ),
          academicPeriodKey: item.academicPeriodKey,
          fetchedAt: item.fetchedAt,
        };
      })
      .filter((item) => !item.archived)
      .sort((a, b) => a.title.localeCompare(b.title));
    return {
      integration: safeIntegration(integration),
      classes,
      selectionRevision: selection.revision,
      selectedClassIds: [...selectedKeys],
      identityStatus: mapping.status,
      identityMatchCount: mapping.matchCount,
      lastSyncAt: integration.lastSyncAt,
      nextSyncAt: integration.nextSyncAt,
    };
  },
});

/**
 * File a projected school artifact in its class workspace. Returns whether this
 * call is what put it there, so the caller can report honest counts.
 */
async function ensureClassWorkPlacement(
  ctx: MutationCtx,
  workspaceId: Id<"spectraWorkspaces">,
  accountId: Id<"accounts">,
  schoolId: Id<"schools">,
  artifactId: Id<"spectraArtifacts">,
) {
  const artifact = await ctx.db.get(artifactId);
  if (!artifact) return false;
  const before = await findPrimaryNode(ctx, accountId, "work", artifactId);
  await placeSourceNode(ctx, {
    accountId,
    schoolId,
    kind: "work",
    sourceId: artifactId,
    name: artifact.title,
    target: { workspaceId },
    placedByAccountId: accountId,
    accessProjection: true,
  });
  return before === null || before.workspaceContextId !== workspaceId;
}

export const materializeClassWorkspaces = mutation({
  args: {
    recordIds: v.array(v.id("externalRecords")),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error("AUTH_REQUIRED: Sign in to create class workspaces.");
    const integration = await ctx.db
      .query("schoolIntegrations")
      .withIndex("by_school_provider", (q) =>
        q.eq("schoolId", actor.schoolId).eq("provider", "managebac"),
      )
      .unique();
    if (!integration || integration.status === "revoked")
      throw new Error(
        "INTEGRATION_NOT_CONNECTED: ManageBac is not connected for this school.",
      );
    const mapping = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) =>
        q.eq("integrationId", integration._id).eq("accountId", actor.accountId),
      )
      .unique();
    if (!mapping || mapping.status !== "verified")
      throw new Error(
        "INTEGRATION_IDENTITY_REQUIRED: Verify your ManageBac email before creating class workspaces.",
      );
    const membershipRows = (
      await Promise.all(
        ["class", "course", "membership"].map((recordType) =>
          ctx.db
            .query("externalRecords")
            .withIndex("by_account_type", (q) =>
              q
                .eq("mappedAccountId", actor.accountId)
                .eq("recordType", recordType),
            )
            .take(500)
            .then((rows) =>
              rows.filter((item) => item.mappedAccountId === actor.accountId),
            ),
        ),
      )
    )
      .flat()
      .filter(
        (item) =>
          item.integrationId === integration._id &&
          item.schoolId === actor.schoolId &&
          !item.tombstone,
      );
    const accessibleClassIds = new Set(
      membershipRows.flatMap((item) =>
        item.providerClassId ? [item.providerClassId] : [],
      ),
    );
    const selected = args.recordIds.slice(0, 100);
    let created = 0;
    let refreshed = 0;
    let projected = 0;
    let skipped = 0;
    for (const recordId of selected) {
      const source = await ctx.db.get(recordId);
      if (
        !source ||
        source.schoolId !== actor.schoolId ||
        source.integrationId !== integration._id ||
        source.recordType !== "class" ||
        source.tombstone ||
        (source.mappedAccountId !== actor.accountId &&
          (!source.providerClassId ||
            !accessibleClassIds.has(source.providerClassId)))
      ) {
        skipped += 1;
        continue;
      }
      const result = await ensureClassWorkspace(
        ctx,
        integration,
        actor.accountId,
        source,
      );
      if (result.created) created += 1;
      else refreshed += 1;
      const workspaceId = ctx.db.normalizeId(
        "spectraWorkspaces",
        result.projection.projectionId,
      );
      if (!workspaceId || !source.providerClassId) continue;
      const relatedTypes = [
        "assignment",
        "deadline",
        "assessment",
        "resource",
        "file",
        "class_resource",
        "school_resource",
        "discussion",
        "announcement",
      ];
      const related = (
        await Promise.all(
          relatedTypes.map((recordType) =>
            ctx.db
              .query("externalRecords")
              .withIndex("by_class_type", (q) =>
                q
                  .eq("providerClassId", source.providerClassId)
                  .eq("recordType", recordType),
              )
              .take(500),
          ),
        )
      )
        .flat()
        .filter(
          (record) =>
            record.integrationId === integration._id &&
            !record.tombstone &&
            (!source.academicPeriodKey ||
              !record.academicPeriodKey ||
              record.academicPeriodKey === source.academicPeriodKey) &&
            (record.mappedAccountId === undefined ||
              record.mappedAccountId === actor.accountId),
        );
      for (const relatedRecord of related) {
        if (["assignment", "deadline", "assessment"].includes(relatedRecord.recordType)) {
          const task = await ensurePlannerProjection(
            ctx,
            integration,
            actor.accountId,
            relatedRecord,
          );
          const taskId = ctx.db.normalizeId(
            "spectraArtifacts",
            task.projection.projectionId,
          );
          if (
            taskId &&
            (await ensureClassWorkPlacement(
              ctx,
              workspaceId,
              actor.accountId,
              integration.schoolId,
              taskId,
            ))
          )
            projected += 1;
          continue;
        }
        if (["resource", "file", "class_resource", "school_resource"].includes(relatedRecord.recordType)) {
          await ensureResourceProjection(
            ctx,
            integration,
            actor.accountId,
            relatedRecord,
          );
          projected += 1;
          continue;
        }
        /* Discussions and announcements have no local identity, so there is
           nothing to file in the tree. They are counted as skipped rather than
           reported as projected content that a reader cannot open. */
        skipped += 1;
      }
    }
    return { created, refreshed, projected, skipped, requested: selected.length };
  },
});

export const purgeAutoCreatedClassWorkspaces = mutation({
  args: {
    confirmation: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error("AUTH_REQUIRED: Sign in to clean up class workspaces.");
    if (args.confirmation !== "Remove auto-created ManageBac workspaces")
      throw new Error(
        "INTEGRATION_CONFIRMATION_REQUIRED: Type the confirmation phrase to continue.",
      );
    const integration = await ctx.db
      .query("schoolIntegrations")
      .withIndex("by_school_provider", (q) =>
        q.eq("schoolId", actor.schoolId).eq("provider", "managebac"),
      )
      .unique();
    const owned = await ctx.db
      .query("spectraWorkspaces")
      .withIndex("by_account_starter", (q) =>
        q
          .eq("ownerAccountId", actor.accountId)
          .eq("starterKey", "managebac-class"),
      )
      .collect();
    const now = Date.now();
    let removed = 0;
    for (const workspace of owned) {
      /* Removing an auto-created shelf must not remove the work on it: the
         contents move to General (D31). Large shelves continue on a fresh
         mutation budget so aggregate btree writes cannot 16 MB the request. */
      const dissolved = await dissolveWorkspaceNode(ctx, workspace, {
        limit: DISSOLVE_CHILD_BATCH,
      });
      if (dissolved.remaining > 0) {
        await ctx.scheduler.runAfter(
          0,
          internal.managebac.continueDissolveClassWorkspace,
          { workspaceId: workspace._id },
        );
        continue;
      }
      await ctx.db.delete(workspace._id);
      removed += 1;
    }
    if (integration) {
      const projections = await ctx.db
        .query("externalProjections")
        .withIndex("by_account_updated", (q) =>
          q.eq("accountId", actor.accountId),
        )
        .order("desc")
        .take(5_000);
      for (const projection of projections) {
        if (
          projection.integrationId !== integration._id ||
          projection.projectionType !== "workspace"
        )
          continue;
        await ctx.db.patch(projection._id, {
          state: "detached",
          updatedAt: now,
        });
      }
    }
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.class_workspaces_purged",
      targetType: "school_integration",
      targetId: integration?._id ?? actor.schoolId,
      metadata: { removed },
      retentionClass: "security",
    });
    return { removed };
  },
});

export const releaseClassWorkspaces = mutation({
  args: {
    recordIds: v.array(v.id("externalRecords")),
    retention: v.optional(
      v.union(v.literal("keep_in_spectra"), v.literal("archive_projection")),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error("AUTH_REQUIRED: Sign in to update class workspaces.");
    const integration = await ctx.db
      .query("schoolIntegrations")
      .withIndex("by_school_provider", (q) =>
        q.eq("schoolId", actor.schoolId).eq("provider", "managebac"),
      )
      .unique();
    const selected = args.recordIds.slice(0, 100);
    const now = Date.now();
    let removed = 0;
    let skipped = 0;
    let kept = 0;
    for (const recordId of selected) {
      const source = await ctx.db.get(recordId);
      if (
        !source ||
        source.schoolId !== actor.schoolId ||
        source.recordType !== "class" ||
        (integration && source.integrationId !== integration._id)
      ) {
        skipped += 1;
        continue;
      }
      const providerKey = `class:${source.providerClassId ?? source.providerRecordId}:${source.academicPeriodKey ?? "current"}`;
      const projection = integration
        ? await ctx.db
            .query("externalProjections")
            .withIndex("by_provider_key", (q) =>
              q
                .eq("integrationId", integration._id)
                .eq("providerKey", providerKey),
            )
            .collect()
            .then(
              (rows) =>
                rows.find(
                  (item) =>
                    item.schoolId === actor.schoolId &&
                    item.accountId === actor.accountId &&
                    item.projectionType === "workspace",
                ) ?? null,
            )
        : null;
      const workspaceId =
        projection?.projectionType === "workspace"
          ? ctx.db.normalizeId("spectraWorkspaces", projection.projectionId)
          : null;
      const workspace = workspaceId ? await ctx.db.get(workspaceId) : null;
      if (!workspace || workspace.starterKey !== "managebac-class") {
        skipped += 1;
        continue;
      }
      if (workspace.ownerAccountId !== actor.accountId) {
        skipped += 1;
        continue;
      }
      if (args.retention === "archive_projection") {
        const relatedTypes = [
          "assignment",
          "deadline",
          "assessment",
          "timetable",
          "timetable_event",
          "lesson",
          "class_event",
          "calendar_event",
          "resource",
          "file",
          "class_resource",
          "school_resource",
        ];
        const related = (
          await Promise.all(
            relatedTypes.map((recordType) =>
              ctx.db
                .query("externalRecords")
                .withIndex("by_class_type", (q) =>
                  q.eq("providerClassId", source.providerClassId).eq("recordType", recordType),
                )
                .take(500),
            ),
          )
        )
          .flat()
          .filter(
            (record) =>
              record.integrationId === integration?._id &&
              record.schoolId === actor.schoolId &&
              (!source.academicPeriodKey ||
                !record.academicPeriodKey ||
                record.academicPeriodKey === source.academicPeriodKey),
          );
        const sourceIds = [source._id, ...related.map((record) => record._id)];
        const projections = (
          await Promise.all(
            sourceIds.map((recordId) =>
              ctx.db
                .query("externalProjections")
                .withIndex("by_record_type", (q) => q.eq("recordId", recordId))
                .collect(),
            ),
          )
        )
          .flat()
          .filter(
            (projection) =>
              projection.integrationId === integration?._id &&
              projection.schoolId === actor.schoolId &&
              projection.accountId === actor.accountId,
          );
        for (const projection of projections)
          await ctx.db.patch(projection._id, {
            state: "tombstoned",
            updatedAt: now,
          });
        await ctx.db.patch(workspace._id, {
          status: "archived",
          updatedAt: now,
        });
        removed += 1;
        continue;
      }
      /* keep_in_spectra (default): stop school updates only. Leave the class
         workspace, its children, and projections in place. Do not dissolve
         work into General or delete the shelf. ManageBac source records are
         not tombstoned. Selection already dropped this class, so later syncs
         will not fan out to it. Conflict "Keep" (detach) is a different path. */
      kept += 1;
    }
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.class_workspaces_released",
      targetType: "school_integration",
      targetId: integration?._id ?? actor.schoolId,
      metadata: { removed, skipped, kept, requested: selected.length },
      retentionClass: "security",
    });
    return {
      removed,
      skipped,
      kept,
      requested: selected.length,
      remaining: 0,
      done: true,
    };
  },
});

export const continueDissolveClassWorkspace = internalMutation({
  args: { workspaceId: v.id("spectraWorkspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace || workspace.starterKey !== "managebac-class") return;
    const dissolved = await dissolveWorkspaceNode(ctx, workspace, {
      limit: DISSOLVE_CHILD_BATCH,
    });
    if (dissolved.remaining > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.managebac.continueDissolveClassWorkspace,
        { workspaceId: args.workspaceId },
      );
      return;
    }
    await ctx.db.delete(args.workspaceId);
  },
});
