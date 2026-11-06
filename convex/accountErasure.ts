import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { writeAuditEvent } from "./auditShared";
import { deleteStorageIfNoOtherBinding } from "./durableStorageBindings";
import { internalMutation } from "./orgNodeMutation";
import { purgeNode, purgeSourceNodes, sharesWithWorkspace } from "./orgTreeShared";
import { releasePayloadIfUnreferenced } from "./payloadLifecycle";
import { scheduleDeletion } from "./spectraArtifactDeletion";
import { enqueueSemanticItem } from "./semanticQueue";

/**
 * Erasure of one account after its identity was deleted at the IdP.
 *
 * The job runs as a chain of small mutations, one page each, and every page
 * records where it stopped, so a crash or deploy resumes at the same step.
 * Stages:
 *   works        private works enter the ordinary artifact deletion job;
 *                works someone else can reach are kept under the tombstone
 *   await_works  wait until those deletion jobs are terminal
 *   account_rows delete the account's own rows (runs, threads, memory,
 *                calendar, reminders, ManageBac imports, Bridge, study data,
 *                preferences, grants, invitations) and release their blobs
 *   placements   remove the account's tree, except inside kept workspaces
 *   workspaces   delete private workspaces, keep shared ones
 *   finalize     end memberships and tombstone the account row
 * The account row stays (as "Former member") so kept works, comments and
 * audit history keep a valid author reference; its Clerk subject stays as the
 * guard against a stale session re-registering the erased identity.
 */

export const FORMER_MEMBER_NAME = "Former member";

type Job = Doc<"accountErasureJobs">;
type Row = { _id: Id<TableNames> };
type Stage = Job["stage"];
type Counts = { deletedRows: number; deletedStorageObjects: number };
type Advance = Partial<Pick<Job, "stage" | "tableIndex" | "keptWorks" | "deletedWorks" | "retainedWorks">> & {
  cursor: string | undefined;
  counts?: Counts;
  delayMs?: number;
};

const WORK_PAGE = 5;
const ROW_PAGE = 40;
const CHILD_PAGE = 32;
// Deletes per page before yielding, well under a mutation's write limit.
const WRITE_BUDGET = 1_500;
const NODE_PAGE = 50;
const WAIT_FOR_WORKS_MS = 30_000;
const WAIT_FOR_RUN_MS = 60_000;
const STALLED_AFTER_MS = 10 * 60_000;
// Restarts without progress before the job is parked for an operator. With
// the doubling backoff below the job is parked about ten hours after its
// last progress.
const MAX_STALLED_RESTARTS = 5;
const NONE: Counts = { deletedRows: 0, deletedStorageObjects: 0 };

function add(a: Counts, b: Counts): Counts {
  return {
    deletedRows: a.deletedRows + b.deletedRows,
    deletedStorageObjects: a.deletedStorageObjects + b.deletedStorageObjects,
  };
}

function activeGrant(grant: Doc<"accessGrants">, now: number) {
  return !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now);
}

/** Someone other than the erased account holds a live direct grant. */
async function grantedBeyond(
  ctx: MutationCtx,
  resourceType: Doc<"accessGrants">["resourceType"],
  resourceId: string,
  accountId: Id<"accounts">,
) {
  const now = Date.now();
  const grants = await ctx.db
    .query("accessGrants")
    .withIndex("by_resource", (q) => q.eq("resourceType", resourceType).eq("resourceId", resourceId))
    .take(100);
  return grants.some(
    (grant) =>
      grant.source === "direct" &&
      activeGrant(grant, now) &&
      !(grant.principalType === "account" && grant.principalId === String(accountId)),
  );
}

type WorkspaceFacts = { ownerAccountId: Id<"accounts">; shared: boolean } | null;

async function workspaceFacts(
  ctx: MutationCtx,
  cache: Map<string, WorkspaceFacts>,
  workspaceId: Id<"spectraWorkspaces">,
  accountId: Id<"accounts">,
) {
  const key = String(workspaceId);
  if (cache.has(key)) return cache.get(key)!;
  const workspace = await ctx.db.get(workspaceId);
  const facts =
    workspace && workspace.status === "active"
      ? {
          ownerAccountId: workspace.ownerAccountId,
          shared: await grantedBeyond(ctx, "workspace", key, accountId),
        }
      : null;
  cache.set(key, facts);
  return facts;
}

/**
 * A work is shared when another person can still reach it: a live direct
 * grant on it, or a live placement that projects access into a workspace
 * shared with someone else (the rule authorityShared applies on read).
 * Public links alone do not keep a work: they close with their creator.
 */
async function workIsShared(
  ctx: MutationCtx,
  cache: Map<string, WorkspaceFacts>,
  artifact: Doc<"spectraArtifacts">,
  accountId: Id<"accounts">,
) {
  const id = String(artifact._id);
  if ((await grantedBeyond(ctx, "artifact", id, accountId)) || (await grantedBeyond(ctx, "agent", id, accountId)))
    return true;
  const placements = await ctx.db
    .query("orgNodes")
    .withIndex("by_kind_source_live", (q) => q.eq("kind", "work").eq("sourceId", id).eq("deletedAt", undefined))
    .take(50);
  for (const placement of placements) {
    if (!placement.workspaceContextId) continue;
    const facts = await workspaceFacts(ctx, cache, placement.workspaceContextId, accountId);
    if (!facts?.shared) continue;
    const projects = sharesWithWorkspace(placement);
    if (projects) return true;
  }
  return false;
}

// ---------------------------------------------------------------- works

async function worksPage(ctx: MutationCtx, job: Job): Promise<Advance> {
  const page = await ctx.db
    .query("spectraArtifacts")
    .withIndex("by_account_created", (q) => q.eq("ownerAccountId", job.accountId))
    .paginate({ cursor: job.cursor ?? null, numItems: WORK_PAGE });
  const cache = new Map<string, WorkspaceFacts>();
  let kept = 0;
  let deleted = 0;
  for (const artifact of page.page) {
    if (artifact.status === "deleted") {
      // Already on its way out; a retained job is kept on purpose (a pinned
      // embed elsewhere) and re-entering it would only loop.
      const latest = await ctx.db
        .query("artifactDeletionJobs")
        .withIndex("by_artifact_generation", (q) => q.eq("artifactId", artifact._id))
        .order("desc")
        .first();
      if (latest?.phase === "retained") continue;
    } else if (await workIsShared(ctx, cache, artifact, job.accountId)) {
      kept += 1;
      continue;
    }
    await scheduleDeletion(ctx, artifact._id, artifact, job.accountId);
    deleted += 1;
  }
  return {
    stage: page.isDone ? "await_works" : "works",
    cursor: page.isDone ? undefined : page.continueCursor,
    keptWorks: job.keptWorks + kept,
    deletedWorks: job.deletedWorks + deleted,
  };
}

const TERMINAL_DELETION_PHASES = new Set(["complete", "failed", "retained"]);

async function awaitWorksPage(ctx: MutationCtx, job: Job): Promise<Advance> {
  const page = await ctx.db
    .query("artifactDeletionJobs")
    .withIndex("by_owner_updated", (q) => q.eq("ownerAccountId", job.accountId))
    .paginate({ cursor: job.cursor ?? null, numItems: 100 });
  // Runs, comments and placements of a work are removed by its own deletion
  // job. Touching them concurrently would race that job's cursors.
  if (page.page.some((row) => !TERMINAL_DELETION_PHASES.has(row.phase)))
    return { cursor: undefined, retainedWorks: 0, delayMs: WAIT_FOR_WORKS_MS };
  const retained = page.page.filter((row) => row.phase !== "complete").length;
  return {
    stage: page.isDone ? "account_rows" : "await_works",
    tableIndex: 0,
    cursor: page.isDone ? undefined : page.continueCursor,
    retainedWorks: job.retainedWorks + retained,
  };
}

// ---------------------------------------------------------- account rows

/** `pending`: children remain, keep the row for the next page. `wait`: a live
 * lease holds the row. `keep`: the hook moved the row out of the index. */
type RowOutcome = Counts & { wait?: number; pending?: boolean; keep?: boolean };
type TableStep = (ctx: MutationCtx, job: Job, account: Doc<"accounts">) => Promise<{
  done: boolean;
  cursor?: string;
  counts: Counts;
  delayMs?: number;
}>;

/**
 * Delete every row an index yields for the account. The rows leave the index
 * as they are deleted, so a fresh `take` is the cursor. `before` may drain a
 * row's children first (`pending` keeps the parent for the next page) or ask
 * to wait for a live lease (`wait`).
 */
function drain<R extends Row>(
  read: (ctx: MutationCtx, accountId: Id<"accounts">, limit: number, account: Doc<"accounts">) => Promise<R[]>,
  before?: (ctx: MutationCtx, row: R, job: Job) => Promise<RowOutcome>,
  after?: (ctx: MutationCtx, row: R, job: Job) => Promise<number>,
): TableStep {
  return async (ctx, job, account) => {
    const rows = await read(ctx, job.accountId, ROW_PAGE, account);
    let counts = NONE;
    for (const row of rows) {
      if (counts.deletedRows >= WRITE_BUDGET) return { done: false, counts };
      const outcome: RowOutcome = before ? await before(ctx, row, job) : NONE;
      counts = add(counts, outcome);
      if (outcome.wait) return { done: false, counts, delayMs: outcome.wait };
      if (outcome.pending) return { done: false, counts };
      if (outcome.keep) continue;
      await ctx.db.delete(row._id);
      counts = add(counts, { deletedRows: 1, deletedStorageObjects: after ? await after(ctx, row, job) : 0 });
    }
    return { done: rows.length < ROW_PAGE, counts };
  };
}

/** Visit rows that stay in the index (patched or kept), with a cursor. */
function sweep<R extends Row>(
  read: (
    ctx: MutationCtx,
    accountId: Id<"accounts">,
    cursor: string | null,
  ) => Promise<{ page: R[]; isDone: boolean; continueCursor: string }>,
  visit: (ctx: MutationCtx, row: R, job: Job) => Promise<Counts>,
): TableStep {
  return async (ctx, job) => {
    const page = await read(ctx, job.accountId, job.cursor ?? null);
    let counts = NONE;
    for (const row of page.page) counts = add(counts, await visit(ctx, row, job));
    return { done: page.isDone, cursor: page.isDone ? undefined : page.continueCursor, counts };
  };
}

/** Delete up to CHILD_PAGE rows; report whether more may remain. */
async function drainChildren<R extends Row>(
  ctx: MutationCtx,
  rows: Promise<R[]>,
  onDelete?: (row: R) => Promise<number>,
) {
  const page = await rows;
  let storage = 0;
  for (const row of page) {
    if (onDelete) storage += await onDelete(row);
    await ctx.db.delete(row._id);
  }
  return { deleted: page.length, storage, more: page.length >= CHILD_PAGE };
}

async function deleteAttachmentBlob(ctx: MutationCtx, row: Doc<"spectraRunAttachments">) {
  if (!row.storageId) return 0;
  return (await deleteStorageIfNoOtherBinding(ctx, row.storageId, {
    table: "spectraRunAttachments",
    id: String(row._id),
  }))
    ? 1
    : 0;
}

async function releaseRefs(ctx: MutationCtx, refs: Array<string | undefined>, accountId: Id<"accounts">, sourceId: string) {
  let released = 0;
  for (const ref of new Set(refs.filter((value): value is string => !!value)))
    if ((await releasePayloadIfUnreferenced(ctx, ref, { accountId, sourceId })) > 0) released += 1;
  return released;
}

async function drainRun(ctx: MutationCtx, run: Doc<"spectraAiRuns">): Promise<RowOutcome> {
  const live = (run.status === "queued" || run.status === "running") && (run.leaseExpiresAt ?? 0) > Date.now();
  if (live) return { ...NONE, wait: WAIT_FOR_RUN_MS };
  const id = run._id;
  const results = [
    await drainChildren(ctx, ctx.db.query("spectraRunJobs").withIndex("by_run_execution", (q) => q.eq("runId", id)).take(CHILD_PAGE)),
    await drainChildren(ctx, ctx.db.query("spectraRunEvents").withIndex("by_run_sequence", (q) => q.eq("runId", id)).take(CHILD_PAGE)),
    await drainChildren(ctx, ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", id)).take(CHILD_PAGE)),
    await drainChildren(ctx, ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", id)).take(CHILD_PAGE)),
    await drainChildren(ctx, ctx.db.query("spectraRunTabs").withIndex("by_run", (q) => q.eq("runId", id)).take(CHILD_PAGE)),
    await drainChildren(ctx, ctx.db.query("memoryRetrievalEvents").withIndex("by_run", (q) => q.eq("runId", id)).take(CHILD_PAGE)),
    await drainChildren(
      ctx,
      ctx.db.query("spectraRunAttachments").withIndex("by_run_execution", (q) => q.eq("runId", id)).take(CHILD_PAGE),
      (row) => deleteAttachmentBlob(ctx, row),
    ),
  ];
  return {
    deletedRows: results.reduce((sum, result) => sum + result.deleted, 0),
    deletedStorageObjects: results.reduce((sum, result) => sum + result.storage, 0),
    pending: results.some((result) => result.more),
  };
}

async function drainThread(ctx: MutationCtx, thread: Doc<"spectraThreads">): Promise<RowOutcome> {
  const messages = await drainChildren(
    ctx,
    ctx.db.query("spectraMessages").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).take(CHILD_PAGE),
  );
  if (messages.more) return { deletedRows: messages.deleted, deletedStorageObjects: 0, pending: true };
  const nodes = await purgeSourceNodes(ctx, "thread", thread._id);
  return { deletedRows: messages.deleted + nodes, deletedStorageObjects: 0 };
}

async function cancelReminder(
  ctx: MutationCtx,
  row: Doc<"plannerReminderDeliveries"> | Doc<"timetableReminderDeliveries">,
): Promise<RowOutcome> {
  // The delivery must not fire for an erased person.
  if (row.scheduledFunctionId) await ctx.scheduler.cancel(row.scheduledFunctionId);
  return NONE;
}

/** The account's devices, for rows keyed only by device. */
async function accountDevices(ctx: MutationCtx, accountId: Id<"accounts">) {
  return ctx.db.query("bridgeDevices").withIndex("by_account_state", (q) => q.eq("accountId", accountId)).take(50);
}

/** The account's schools' integrations, for identity mappings keyed by integration. */
async function accountIntegrations(ctx: MutationCtx, accountId: Id<"accounts">) {
  const memberships = await ctx.db.query("schoolMemberships").withIndex("by_account", (q) => q.eq("accountId", accountId)).take(20);
  const integrations: Array<Id<"schoolIntegrations">> = [];
  for (const membership of memberships)
    for (const integration of await ctx.db
      .query("schoolIntegrations")
      .withIndex("by_school_provider", (q) => q.eq("schoolId", membership.schoolId))
      .take(10))
      integrations.push(integration._id);
  return integrations;
}

/**
 * Ordered so a source row goes before the rows derived from it: triggers on
 * runs, result cards, calendar items and migrations maintain their read
 * models on delete, and a derived row deleted first would be re-created.
 */
const ACCOUNT_TABLES: TableStep[] = [
  // AI runs and threads (prompts, outputs, traces, attachments).
  drain((ctx, id, n) => ctx.db.query("spectraAiRuns").withIndex("by_account_created", (q) => q.eq("ownerAccountId", id)).take(n), (ctx, row) => drainRun(ctx, row)),
  drain((ctx, id, n) => ctx.db.query("spectraRunAttachments").withIndex("by_owner_created", (q) => q.eq("ownerAccountId", id)).take(n), async (ctx, row) => ({ ...NONE, deletedStorageObjects: await deleteAttachmentBlob(ctx, row) })),
  drain((ctx, id, n) => ctx.db.query("spectraResultCards").withIndex("by_owner_updated", (q) => q.eq("ownerAccountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("spectraResultCardSummaries").withIndex("by_owner_updated", (q) => q.eq("ownerAccountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("spectraRunTabs").withIndex("by_account_updated", (q) => q.eq("ownerAccountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("spectraAnalyticsRunSummaries").withIndex("by_account_created", (q) => q.eq("ownerAccountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("spectraThreads").withIndex("by_account_status", (q) => q.eq("ownerAccountId", id)).take(n), (ctx, row) => drainThread(ctx, row)),
  // Memory, including claim embeddings.
  drain((ctx, id, n) => ctx.db.query("spectraMemoryHeads").withIndex("by_account", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("spectraMemoryTopics").withIndex("by_account_slug", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("memoryRelations").withIndex("by_account_from", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("memoryEvidence").withIndex("by_account_created", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("memoryClaims").withIndex("by_account_status_updated", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("memoryCapsules").withIndex("by_account_scope", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("memoryRetrievalEvents").withIndex("by_account_created", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("memoryJobs").withIndex("by_account_created", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("memoryPreferences").withIndex("by_account", (q) => q.eq("accountId", id)).take(n)),
  // Home's daily brief (its recap is written from the account's work) and when it is written.
  drain((ctx, id, n) => ctx.db.query("dailyBriefs").withIndex("by_account", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("briefSchedules").withIndex("by_account", (q) => q.eq("accountId", id)).take(n)),
  // Calendar and reminders.
  drain((ctx, id, n) => ctx.db.query("plannerReminderDeliveries").withIndex("by_recipient_created", (q) => q.eq("recipientAccountId", id)).take(n), (ctx, row) => cancelReminder(ctx, row)),
  drain((ctx, id, n) => ctx.db.query("timetableReminderDeliveries").withIndex("by_recipient_created", (q) => q.eq("recipientAccountId", id)).take(n), (ctx, row) => cancelReminder(ctx, row)),
  drain((ctx, id, n) => ctx.db.query("calendarItems").withIndex("by_account_start", (q) => q.eq("ownerAccountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("calendarItemReadModels").withIndex("by_account_updated", (q) => q.eq("ownerAccountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("calendarItemRangeBuckets").withIndex("by_account_status_bucket", (q) => q.eq("ownerAccountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("calendarPlanTaskReadModels").withIndex("by_account_updated", (q) => q.eq("ownerAccountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("calendarMigrations").withIndex("by_account_status", (q) => q.eq("ownerAccountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("calendarMigrationReadModels").withIndex("by_account_updated", (q) => q.eq("ownerAccountId", id)).take(n)),
  // ManageBac and other school-system imports.
  drain(
    (ctx, id, n) => ctx.db.query("externalSyncRuns").withIndex("by_account_created", (q) => q.eq("accountId", id)).take(n),
    async (ctx, row) => {
      const capabilities = await drainChildren(ctx, ctx.db.query("externalSyncCapabilityRuns").withIndex("by_sync_run", (q) => q.eq("syncRunId", row._id)).take(CHILD_PAGE));
      const quarantined = await drainChildren(ctx, ctx.db.query("externalQuarantineRecords").withIndex("by_sync_run", (q) => q.eq("syncRunId", row._id)).take(CHILD_PAGE));
      const seen = await drainChildren(ctx, ctx.db.query("externalSyncSeenKeys").withIndex("by_run_identity", (q) => q.eq("syncRunId", row._id)).take(CHILD_PAGE));
      return { deletedRows: capabilities.deleted + quarantined.deleted + seen.deleted, deletedStorageObjects: 0, pending: capabilities.more || quarantined.more || seen.more };
    },
  ),
  drain((ctx, id, n) => ctx.db.query("externalSyncConflicts").withIndex("by_account_status", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("externalProjections").withIndex("by_account_updated", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("externalRecordOverlays").withIndex("by_account_updated", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("managebacClassSelections").withIndex("by_account_integration", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("managebacResourceImports").withIndex("by_account_source", (q) => q.eq("accountId", id)).take(n)),
  // School: kept files (their bytes too), CAS work and sync preferences.
  drain(
    (ctx, id, n) => ctx.db.query("schoolFiles").withIndex("by_account_updated", (q) => q.eq("accountId", id)).take(n),
    undefined,
    async (ctx, row) => row.storageId && await deleteStorageIfNoOtherBinding(ctx, row.storageId, { table: "schoolFiles", id: String(row._id) }) ? 1 : 0,
  ),
  drain((ctx, id, n) => ctx.db.query("casReflections").withIndex("by_account_experience", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("casOutcomeTags").withIndex("by_account_experience", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("schoolSyncStates").withIndex("by_account_integration_kind", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("schoolSyncClassOverrides").withIndex("by_account_integration_kind_class", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("schoolSyncPreferences").withIndex("by_account_integration_kind", (q) => q.eq("accountId", id)).take(n)),
  // A personal record is the account's own mirrored data; a class or school
  // record belongs to the school and only loses its link to the account.
  drain(
    (ctx, id, n) => ctx.db.query("externalRecords").withIndex("by_account_type", (q) => q.eq("mappedAccountId", id)).take(n),
    async (ctx, row) => {
      if (row.classification === "personal") return NONE;
      await ctx.db.patch(row._id, { mappedAccountId: undefined, updatedAt: Date.now() });
      return { ...NONE, keep: true };
    },
  ),
  drain(async (ctx, id, n) => {
    const rows: Array<Doc<"externalIdentityMappings">> = [];
    for (const integrationId of await accountIntegrations(ctx, id))
      rows.push(
        ...(await ctx.db
          .query("externalIdentityMappings")
          .withIndex("by_integration_account", (q) => q.eq("integrationId", integrationId).eq("accountId", id))
          .take(n - rows.length)),
      );
    return rows.slice(0, n);
  }),
  // Bridge: requests and replicas first (they hold payload references),
  // then policy and device rows, then the account's payload blobs.
  drain(async (ctx, id, n) => {
    const rows: Array<Doc<"syncDiscoveryRequests">> = [];
    for (const device of await accountDevices(ctx, id))
      if (rows.length < n)
        rows.push(...(await ctx.db.query("syncDiscoveryRequests").withIndex("by_device_resource", (q) => q.eq("deviceId", device._id)).take(n - rows.length)));
    return rows;
  }),
  drain(
    (ctx, id, n) => ctx.db.query("bridgeWriteRequests").withIndex("by_account_key", (q) => q.eq("accountId", id)).take(n),
    undefined,
    (ctx, row, job) => releaseRefs(ctx, [row.payloadRef], job.accountId, String(row._id)),
  ),
  drain((ctx, id, n) => ctx.db.query("bridgeFsRequests").withIndex("by_account_state", (q) => q.eq("accountId", id)).take(n)),
  sweep(
    (ctx, id, cursor) => ctx.db.query("workReplicas").withIndex("by_account_state", (q) => q.eq("accountId", id)).paginate({ cursor, numItems: ROW_PAGE }),
    // A cloud replica is the work's own Spectra copy and stays with a kept
    // work; the device copy is the account's.
    async (ctx, row, job) => {
      if (row.kind !== "local") return NONE;
      await ctx.db.delete(row._id);
      const released = await releaseRefs(ctx, [row.payloadRef, row.pendingPayloadRef, row.projectionBasePayloadRef], job.accountId, String(row._id));
      return { deletedRows: 1, deletedStorageObjects: released };
    },
  ),
  drain(
    (ctx, id, n) => ctx.db.query("syncConflicts").withIndex("by_account_state", (q) => q.eq("accountId", id)).take(n),
    undefined,
    (ctx, row, job) => releaseRefs(ctx, [row.localPayloadRef, row.spectraPayloadRef], job.accountId, String(row._id)),
  ),
  drain((ctx, id, n) => ctx.db.query("storageStrategyTransitions").withIndex("by_account_state", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("syncStructureDecisions").withIndex("by_account_scope_direction", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("syncPolicyChanges").withIndex("by_account_key", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("syncPolicies").withIndex("by_account_scope", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("bridgeMounts").withIndex("by_account_state", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("bridgePairingChallenges").withIndex("by_account_expiry", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("bridgeDevices").withIndex("by_account_state", (q) => q.eq("accountId", id)).take(n)),
  sweep(
    (ctx, id, cursor) => ctx.db.query("payloadObjects").withIndex("by_account_hash", (q) => q.eq("accountId", id)).paginate({ cursor, numItems: ROW_PAGE }),
    // A payload still referenced by a kept work's history stays; the
    // release helper checks every reference before deleting bytes.
    async (ctx, row, job) => ({ ...NONE, deletedStorageObjects: await releaseRefs(ctx, [String(row._id)], job.accountId, String(row._id)) }),
  ),
  // Study data.
  drain((ctx, id, n) => ctx.db.query("flashcardStudyStates").withIndex("by_account_artifact", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("flashcardStudyReviews").withIndex("by_account_client", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("quizPracticeResponses").withIndex("by_account_mutation", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("quizPracticeAttempts").withIndex("by_account_client", (q) => q.eq("accountId", id)).take(n)),
  // Preferences, social rows, grants and invitations.
  drain((ctx, id, n) => ctx.db.query("accountPreferences").withIndex("by_account", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("artifactUserStates").withIndex("by_account_updated", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("agentFollows").withIndex("by_account_status", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("agentUserUsage").withIndex("by_account", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("artifactCommentNotifications").withIndex("by_recipient_created", (q) => q.eq("recipientAccountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("schoolAnnouncementDeliveries").withIndex("by_account_status", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("schoolGroupMembers").withIndex("by_account", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("artifactAccessOverrides").withIndex("by_account", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("artifactAccessRequests").withIndex("by_requester_status", (q) => q.eq("requesterAccountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("shareInvitations").withIndex("by_invitee_status", (q) => q.eq("inviteeAccountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("shareInvitations").withIndex("by_inviter_status", (q) => q.eq("inviterAccountId", id).eq("status", "pending")).take(n)),
  drain((ctx, id, n) => ctx.db.query("accessGrants").withIndex("by_principal", (q) => q.eq("principalType", "account").eq("principalId", String(id))).take(n)),
  drain((ctx, id, n) => ctx.db.query("workspaceImportJobs").withIndex("by_account_created", (q) => q.eq("accountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("feedbackReports").withIndex("by_reporter_created", (q) => q.eq("reporterAccountId", id)).take(n)),
  // Accepted, revoked and expired invitations record this person's email.
  // A pending invitation is the school's open offer and stays its to revoke.
  drain(async (ctx, _id, n, account) => {
    const email = account.email.trim().toLowerCase();
    if (!email) return [];
    const rows: Array<Doc<"membershipInvitations">> = [];
    for (const status of ["accepted", "revoked", "expired"] as const)
      if (rows.length < n)
        rows.push(...(await ctx.db.query("membershipInvitations").withIndex("by_email_status", (q) => q.eq("email", email).eq("status", status)).take(n - rows.length)));
    return rows;
  }),
  // Comments on other people's works stay as the discussion's history; the
  // author resolves to the tombstone. An AI comment carries a copied name.
  sweep(
    (ctx, id, cursor) => ctx.db.query("artifactComments").withIndex("by_author", (q) => q.eq("authorAccountId", id)).paginate({ cursor, numItems: ROW_PAGE }),
    async (ctx, row) => {
      if (row.authorKind === "ai" && row.authorDisplayName !== `${FORMER_MEMBER_NAME}'s AI`)
        await ctx.db.patch(row._id, { authorDisplayName: `${FORMER_MEMBER_NAME}'s AI` });
      return NONE;
    },
  ),
  // Search passages and Related caches built from the account's items. A work that stays
  // (kept for others) is queued and indexed again from its source.
  drain((ctx, id, n) => ctx.db.query("semanticChunks").withIndex("by_owner_kind", (q) => q.eq("ownerAccountId", id)).take(n)),
  drain((ctx, id, n) => ctx.db.query("semanticItems").withIndex("by_owner_kind", (q) => q.eq("ownerAccountId", id)).take(n), async (ctx, row) => {
    await enqueueSemanticItem(ctx, row.itemKind, row.itemId, { schoolId: row.schoolId, immediate: true });
    return NONE;
  }),
  drain((ctx, id, n) => ctx.db.query("semanticRelatedCache").withIndex("by_account_item", (q) => q.eq("accountId", id)).take(n)),
];

async function accountRowsPage(ctx: MutationCtx, job: Job, account: Doc<"accounts">): Promise<Advance> {
  const step = ACCOUNT_TABLES[job.tableIndex];
  if (!step) return { stage: "placements", tableIndex: 0, cursor: undefined };
  const result = await step(ctx, job, account);
  return {
    tableIndex: result.done ? job.tableIndex + 1 : job.tableIndex,
    cursor: result.done ? undefined : result.cursor,
    counts: result.counts,
    delayMs: result.delayMs,
  };
}

// ------------------------------------------------------------ placements

async function placementsPage(ctx: MutationCtx, job: Job): Promise<Advance> {
  const page = await ctx.db
    .query("orgNodes")
    .withIndex("by_account_parent_order", (q) => q.eq("accountId", job.accountId))
    .paginate({ cursor: job.cursor ?? null, numItems: NODE_PAGE });
  const cache = new Map<string, WorkspaceFacts>();
  const keptWorkspace = async (id: Id<"spectraWorkspaces"> | null | undefined) =>
    !!id && (await workspaceFacts(ctx, cache, id, job.accountId))?.shared === true;
  let deletedRows = 0;
  for (const listed of page.page) {
    // A link removed with its target earlier in this page is already gone.
    const node = await ctx.db.get(listed._id);
    if (!node) continue;
    const ownWorkspace = node.kind === "workspace" && node.sourceId ? ctx.db.normalizeId("spectraWorkspaces", node.sourceId) : null;
    if ((await keptWorkspace(ownWorkspace)) || (await keptWorkspace(node.workspaceContextId))) continue;
    deletedRows += await purgeNode(ctx, node);
  }
  return {
    stage: page.isDone ? "workspaces" : "placements",
    cursor: page.isDone ? undefined : page.continueCursor,
    counts: { deletedRows, deletedStorageObjects: 0 },
  };
}

// ------------------------------------------------------------ workspaces

async function deleteAll(ctx: MutationCtx, rows: Promise<Row[]>) {
  const page = await rows;
  for (const row of page) await ctx.db.delete(row._id);
  return page.length;
}

/** Remove one private workspace a bounded slice at a time; false = call again. */
async function deleteWorkspace(ctx: MutationCtx, workspace: Doc<"spectraWorkspaces">) {
  const id = workspace._id;
  // Kept works created here lose the pointer, as permanent deletion does.
  const created = await ctx.db.query("spectraArtifacts").withIndex("by_created_workspace", (q) => q.eq("createdFrom.workspaceId", id)).take(ROW_PAGE);
  for (const artifact of created)
    if (artifact.createdFrom) await ctx.db.patch(artifact._id, { createdFrom: { ...artifact.createdFrom, workspaceId: undefined } });
  const deleted =
    (await deleteAll(ctx, ctx.db.query("spectraFocusSpaces").withIndex("by_workspace", (q) => q.eq("workspaceId", id)).take(ROW_PAGE))) +
    (await deleteAll(ctx, ctx.db.query("accessGrants").withIndex("by_resource", (q) => q.eq("resourceType", "workspace").eq("resourceId", String(id))).take(ROW_PAGE))) +
    (await deleteAll(ctx, ctx.db.query("accessGrants").withIndex("by_inherited_workspace", (q) => q.eq("inheritedFromWorkspaceId", id)).take(ROW_PAGE))) +
    (await deleteAll(ctx, ctx.db.query("resourcePolicies").withIndex("by_resource", (q) => q.eq("resourceType", "workspace").eq("resourceId", String(id))).take(ROW_PAGE))) +
    (await deleteAll(ctx, ctx.db.query("workspaceDeletionJobs").withIndex("by_workspace", (q) => q.eq("workspaceId", id)).take(ROW_PAGE)));
  if (created.length > 0 || deleted > 0) return { done: false, deletedRows: deleted };
  const nodes = await purgeSourceNodes(ctx, "workspace", id);
  await ctx.db.delete(id);
  return { done: true, deletedRows: nodes + 1 };
}

async function workspacesPage(ctx: MutationCtx, job: Job): Promise<Advance> {
  const page = await ctx.db
    .query("spectraWorkspaces")
    .withIndex("by_account_activity", (q) => q.eq("ownerAccountId", job.accountId))
    .paginate({ cursor: job.cursor ?? null, numItems: 1 });
  const workspace = page.page[0];
  if (workspace && !(await grantedBeyond(ctx, "workspace", String(workspace._id), job.accountId))) {
    const result = await deleteWorkspace(ctx, workspace);
    // Not finished: stay on this cursor so the same workspace comes back.
    if (!result.done) return { cursor: job.cursor, counts: { deletedRows: result.deletedRows, deletedStorageObjects: 0 } };
    return {
      stage: page.isDone ? "finalize" : "workspaces",
      cursor: page.isDone ? undefined : page.continueCursor,
      counts: { deletedRows: result.deletedRows, deletedStorageObjects: 0 },
    };
  }
  return { stage: page.isDone ? "finalize" : "workspaces", cursor: page.isDone ? undefined : page.continueCursor };
}

// -------------------------------------------------------------- finalize

async function finalize(ctx: MutationCtx, job: Job, account: Doc<"accounts">): Promise<Advance> {
  const memberships = await ctx.db.query("schoolMemberships").withIndex("by_account", (q) => q.eq("accountId", job.accountId)).take(ROW_PAGE);
  for (const membership of memberships) await ctx.db.delete(membership._id);
  if (memberships.length === ROW_PAGE) return { cursor: undefined, counts: { deletedRows: memberships.length, deletedStorageObjects: 0 } };
  const now = Date.now();
  await ctx.db.patch(account._id, {
    name: FORMER_MEMBER_NAME,
    email: "",
    emailVerified: false,
    avatarUrl: undefined,
    lastSeenAt: undefined,
    status: "deactivated",
    updatedAt: now,
  });
  await writeAuditEvent(ctx, {
    actorAccountId: job.accountId,
    action: "account.erasure.completed",
    targetType: "account",
    targetId: job.accountId,
    metadata: {
      keptWorks: job.keptWorks,
      deletedWorks: job.deletedWorks,
      retainedWorks: job.retainedWorks,
      deletedRows: job.deletedRows + memberships.length,
      deletedStorageObjects: job.deletedStorageObjects,
    },
    retentionClass: "legal",
  });
  return { stage: "completed", cursor: undefined, counts: { deletedRows: memberships.length, deletedStorageObjects: 0 } };
}

// ----------------------------------------------------------------- driver

async function runStage(ctx: MutationCtx, job: Job, account: Doc<"accounts">): Promise<Advance> {
  switch (job.stage) {
    case "works":
      return worksPage(ctx, job);
    case "await_works":
      return awaitWorksPage(ctx, job);
    case "account_rows":
      return accountRowsPage(ctx, job, account);
    case "placements":
      return placementsPage(ctx, job);
    case "workspaces":
      return workspacesPage(ctx, job);
    case "finalize":
      return finalize(ctx, job, account);
    case "completed":
    case "failed_needs_attention":
      return { cursor: undefined };
  }
}

/**
 * One page of one stage. `step` makes duplicate schedules harmless: only the
 * call carrying the job's current step does work, then it schedules the next.
 */
export const process = internalMutation({
  args: { jobId: v.id("accountErasureJobs"), step: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.stage === "completed" || job.stage === "failed_needs_attention" || job.step !== args.step)
      return null;
    const account = await ctx.db.get(job.accountId);
    if (!account) throw new Error("ACCOUNT_ERASURE_ACCOUNT_MISSING");
    const advance = await runStage(ctx, job, account);
    const counts = advance.counts ?? NONE;
    const stage: Stage = advance.stage ?? job.stage;
    const now = Date.now();
    await ctx.db.patch(job._id, {
      stage,
      step: job.step + 1,
      tableIndex: advance.tableIndex ?? job.tableIndex,
      cursor: advance.cursor,
      keptWorks: advance.keptWorks ?? job.keptWorks,
      deletedWorks: advance.deletedWorks ?? job.deletedWorks,
      retainedWorks: advance.retainedWorks ?? job.retainedWorks,
      deletedRows: job.deletedRows + counts.deletedRows,
      deletedStorageObjects: job.deletedStorageObjects + counts.deletedStorageObjects,
      updatedAt: now,
      // A page committed: the job is making progress again.
      ...(job.stalledRestarts ? { stalledRestarts: 0 } : {}),
      ...(stage === "completed" ? { completedAt: now } : {}),
    });
    if (stage !== "completed")
      await ctx.scheduler.runAfter(advance.delayMs ?? 0, internal.accountErasure.process, { jobId: job._id, step: job.step + 1 });
    return { stage, step: job.step + 1 };
  },
});

/**
 * Called for the IdP's `user.deleted` event. Freezes the account at once
 * (no session, no membership, no operator session) and starts the job. A
 * repeated event returns the same job and nudges it; an event for a subject
 * that never registered leaves an erased tombstone so a still-valid session
 * token cannot register the deleted identity afterwards.
 */
export const requestForDeletedIdentity = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    const now = Date.now();
    const account = await ctx.db.query("accounts").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique();
    if (!account) {
      const accountId = await ctx.db.insert("accounts", {
        clerkId,
        email: "",
        emailVerified: false,
        name: FORMER_MEMBER_NAME,
        status: "deactivated",
        createdAt: now,
        updatedAt: now,
      });
      const jobId = await ctx.db.insert("accountErasureJobs", {
        ...emptyJob(accountId, now),
        stage: "completed",
        completedAt: now,
      });
      return { status: "completed" as const, jobId };
    }
    const existing = await ctx.db.query("accountErasureJobs").withIndex("by_account", (q) => q.eq("accountId", account._id)).unique();
    if (existing) {
      // A parked job waits for an operator; a redelivered event cannot unpark it.
      if (existing.stage !== "completed" && existing.stage !== "failed_needs_attention")
        await ctx.scheduler.runAfter(0, internal.accountErasure.process, { jobId: existing._id, step: existing.step });
      return { status: existing.stage === "completed" ? ("completed" as const) : ("running" as const), jobId: existing._id };
    }
    await ctx.db.patch(account._id, { status: "deactivated", updatedAt: now });
    for (const membership of await ctx.db.query("schoolMemberships").withIndex("by_account", (q) => q.eq("accountId", account._id)).take(50))
      if (membership.status !== "ended") await ctx.db.patch(membership._id, { status: "ended", endedAt: now, updatedAt: now });
    for (const session of await ctx.db.query("operatorSchoolSessions").withIndex("by_operator_active", (q) => q.eq("operatorAccountId", account._id).gt("expiresAt", now)).take(50))
      if (!session.revokedAt) await ctx.db.patch(session._id, { revokedAt: now });
    const jobId = await ctx.db.insert("accountErasureJobs", emptyJob(account._id, now));
    await writeAuditEvent(ctx, {
      actorAccountId: account._id,
      action: "account.erasure.requested",
      targetType: "account",
      targetId: account._id,
      metadata: { trigger: "identity_deleted" },
      retentionClass: "legal",
    });
    await ctx.scheduler.runAfter(0, internal.accountErasure.process, { jobId, step: 0 });
    return { status: "running" as const, jobId };
  },
});

function emptyJob(accountId: Id<"accounts">, now: number) {
  return {
    accountId,
    trigger: "identity_deleted" as const,
    stage: "works" as Stage,
    step: 0,
    tableIndex: 0,
    keptWorks: 0,
    deletedWorks: 0,
    retainedWorks: 0,
    deletedRows: 0,
    deletedStorageObjects: 0,
    createdAt: now,
    updatedAt: now,
  };
}

const ACTIVE_STAGES = ["works", "await_works", "account_rows", "placements", "workspaces", "finalize"] as const;

/**
 * Cron: restart any job whose chain stopped (a failed page, a lost schedule).
 * A page that fails every time (say, schema drift in a drained table) never
 * commits, so the job stops making progress. Each restart without progress
 * doubles the wait before the next one; after MAX_STALLED_RESTARTS the job is
 * parked as `failed_needs_attention` with an audit record the platform
 * security log shows, instead of retrying forever unseen.
 */
export const resumeStalled = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - STALLED_AFTER_MS;
    let resumed = 0;
    let parked = 0;
    for (const stage of ACTIVE_STAGES)
      for (const job of await ctx.db
        .query("accountErasureJobs")
        .withIndex("by_stage_updated", (q) => q.eq("stage", stage).lt("updatedAt", cutoff))
        .take(25)) {
        const restarts = job.stalledRestarts ?? 0;
        if (now - job.updatedAt < STALLED_AFTER_MS * 2 ** restarts) continue;
        if (restarts >= MAX_STALLED_RESTARTS) {
          await ctx.db.patch(job._id, {
            stage: "failed_needs_attention",
            resumeStage: stage,
            needsAttentionAt: now,
            updatedAt: now,
          });
          await writeAuditEvent(ctx, {
            actorAccountId: job.accountId,
            action: "account.erasure.needs_attention",
            targetType: "account",
            targetId: job.accountId,
            metadata: { jobId: job._id, stage, step: job.step, restarts },
            retentionClass: "legal",
          });
          console.error("[account-erasure] parked for an operator", { jobId: job._id, stage, restarts });
          parked += 1;
          continue;
        }
        await ctx.db.patch(job._id, { updatedAt: now, stalledRestarts: restarts + 1 });
        await ctx.scheduler.runAfter(0, internal.accountErasure.process, { jobId: job._id, step: job.step });
        resumed += 1;
      }
    return { resumed, parked };
  },
});

/**
 * Operator: after fixing the cause, resume a parked job where it stopped.
 * `npx convex run accountErasure:resumeNeedsAttention '{"jobId":"..."}'`
 */
export const resumeNeedsAttention = internalMutation({
  args: { jobId: v.id("accountErasureJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("ACCOUNT_ERASURE_JOB_MISSING");
    if (job.stage !== "failed_needs_attention") return { stage: job.stage, resumed: false };
    const stage = job.resumeStage ?? "works";
    await ctx.db.patch(job._id, {
      stage,
      resumeStage: undefined,
      needsAttentionAt: undefined,
      stalledRestarts: 0,
      updatedAt: Date.now(),
    });
    await writeAuditEvent(ctx, {
      actorAccountId: job.accountId,
      action: "account.erasure.resumed",
      targetType: "account",
      targetId: job.accountId,
      metadata: { jobId: job._id, stage, step: job.step, by: "operator" },
      retentionClass: "legal",
    });
    await ctx.scheduler.runAfter(0, internal.accountErasure.process, { jobId: job._id, step: job.step });
    return { stage, resumed: true };
  },
});
