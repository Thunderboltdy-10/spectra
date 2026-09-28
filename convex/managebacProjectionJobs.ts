import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./orgNodeMutation";
import type { Doc, Id } from "./_generated/dataModel";
import { getActorForAccountId } from "./identityShared";
import { canApplyManagebacSourceRemoval, canReadManagebacRecord } from "./managebacVisibility";
import type { ProviderProjectionIntent } from "./managebacProjectionContract";
import { appendRoomUpdate, parseGatewayProjection } from "./collaborationGatewayStore";
import { commitChangeGroup, commitDirectHumanChange, commitHumanCheckpoint } from "./changeGroups";
import { buildArtifactTextIndex } from "./spectraShared";
import { decomposeArtifactContent } from "../src/features/spectra/collaboration/artifact-yjs-model";
import {
  plannerProviderArtifactIdentity, plannerProviderDigest, plannerProviderText, preparePlannerProviderValue,
  type PlannerProviderMode, type PlannerProviderText, type PlannerProviderValue,
} from "../shared/planner-provider-refresh";

/**
 * ManageBac provider updates to personal planners.
 *
 * A planner without a canonical collaboration room is updated directly, with
 * its import history, in the transaction that admits the provider page: the
 * room's absence is part of that transaction's read set, so a concurrent
 * `ensureRoom` forces a retry into the canonical path. A planner with a room
 * is staged on its projection and applied by the internal replay action; the
 * admitting mutation appends the exact update through the canonical appender
 * and commits the import history in the same transaction. The owning sync
 * run (or explicit conflict resolution) stays pending until that work drains.
 */

type Ctx = QueryCtx | MutationCtx;
type Actor = NonNullable<Awaited<ReturnType<typeof getActorForAccountId>>>;
type JobArgs = { projectionId: Id<"externalProjections">; operationId: string };
export type ProviderUpdateInput = {
  mode: PlannerProviderMode;
  syncRunId: Id<"externalSyncRuns">;
  conflictId?: Id<"externalSyncConflicts">;
  importerAccountId: Id<"accounts">;
  previousSourceHash: string;
  previousNormalized?: unknown;
};
export type ProviderUpdateOutcome = "applied" | "unchanged" | "staged" | "conflict" | "unavailable";

const runAction = makeFunctionReference<"action", JobArgs>("managebacProjectionAction:run");
const fanoutMutation = makeFunctionReference<"mutation", FanoutArgs>("managebacProjectionJobs:fanout");
const watchdogMutation = makeFunctionReference<"mutation", JobArgs & { attempts: number }>("managebacProjectionJobs:watchdog");
/** Planner projections handled in the admitting transaction; more fan out. */
export const PROVIDER_INLINE_PLANNERS = 16;
const FANOUT_BATCH = 16;
const MAX_ATTEMPTS = 4;
/** Scheduled actions run at most once and a Convex action cannot outlive ten
 * minutes. An attempt that reports neither a commit nor a failure by then was
 * lost; without this its run or resolution would stay pending forever. */
const ATTEMPT_WATCHDOG_MS = 11 * 60_000;
const HISTORY_SUMMARY = "ManageBac updated the official source";
const explicitMode = (mode: PlannerProviderMode) => mode === "rebase" || mode === "keep_overlay";

function plannerValue(artifact: Doc<"spectraArtifacts">): PlannerProviderValue {
  return { title: artifact.title, summary: artifact.summary, tags: artifact.tags, content: artifact.content };
}

function sourceFacts(source: Doc<"externalRecords">) {
  return {
    normalized: source.normalized, providerRecordId: source.providerRecordId,
    payloadVersion: source.payloadVersion, sourceHash: source.sourceHash,
  };
}

/** The canonical value a room would store for a planner, ignoring encoding. */
export function samePlannerProviderValue(left: PlannerProviderValue, right: PlannerProviderValue) {
  if (left.title !== right.title || (left.summary ?? "") !== (right.summary ?? "") ||
      JSON.stringify(left.tags) !== JSON.stringify(right.tags)) return false;
  const a = decomposeArtifactContent("planner_task", left.content);
  const b = decomposeArtifactContent("planner_task", right.content);
  if (a.rootTemplate !== b.rootTemplate || a.regionValues.size !== b.regionValues.size) return false;
  for (const [regionId, encoded] of a.regionValues) if (b.regionValues.get(regionId) !== encoded) return false;
  return true;
}

type Target = {
  importer: Actor; recipient: Actor; artifact: Doc<"spectraArtifacts">;
  room: Doc<"collaborationRooms"> | null; policyVersion: number;
};

/** Current authority for one provider write, rechecked at every effect. The
 * sync principal and the planner's owner are distinct: an administrator's
 * reconciliation imports as that administrator into each current recipient. */
async function authorizePlannerProvider(
  ctx: Ctx, projection: Doc<"externalProjections">, source: Doc<"externalRecords">,
  input: { mode: PlannerProviderMode; syncRunId: Id<"externalSyncRuns">; conflictId?: Id<"externalSyncConflicts">;
    importerAccountId: Id<"accounts">; stagedResolution: boolean },
): Promise<Target | null> {
  if (projection.projectionType !== "planner_task" || projection.state === "detached" || !projection.accountId ||
      source._id !== projection.recordId || source.integrationId !== projection.integrationId ||
      source.schoolId !== projection.schoolId || source.tombstone !== (input.mode === "removed")) return null;
  const [integration, run, importer, recipient] = await Promise.all([
    ctx.db.get(projection.integrationId), ctx.db.get(input.syncRunId),
    getActorForAccountId(ctx, input.importerAccountId), getActorForAccountId(ctx, projection.accountId),
  ]);
  if (!integration || integration.schoolId !== projection.schoolId ||
      (integration.status !== "connected" && integration.status !== "degraded") ||
      !run || run.integrationId !== integration._id || !importer || !recipient ||
      importer.schoolId !== projection.schoolId || recipient.schoolId !== projection.schoolId) return null;
  let scopeAccountId = run.accountId;
  if (explicitMode(input.mode)) {
    const conflict = input.conflictId ? await ctx.db.get(input.conflictId) : null;
    if (!conflict || conflict.recordId !== source._id || conflict.integrationId !== integration._id || conflict.status !== "open" ||
        (input.stagedResolution && (conflict.projectionResolution !== input.mode || conflict.resolvedByAccountId !== importer.accountId)))
      return null;
    scopeAccountId = conflict.accountId;
  }
  if (scopeAccountId ? scopeAccountId !== recipient.accountId ||
      (importer.accountId !== recipient.accountId && importer.schoolRole !== "school_admin")
    : importer.schoolRole !== "school_admin") return null;
  const visible = input.mode === "removed"
    ? await canApplyManagebacSourceRemoval(ctx, recipient, source)
    : await canReadManagebacRecord(ctx, recipient, source);
  if (!visible) return null;
  const artifactId = ctx.db.normalizeId("spectraArtifacts", projection.projectionId);
  const artifact = artifactId ? await ctx.db.get(artifactId) : null;
  if (!artifact || artifact.ownerAccountId !== recipient.accountId || artifact.schoolId !== recipient.schoolId ||
      artifact.blueprintKey !== "planner_task" || (artifact.status !== "active" && artifact.status !== "draft")) return null;
  const [room, policy] = await Promise.all([
    ctx.db.query("collaborationRooms").withIndex("by_artifact_partition", q => q.eq("artifactId", artifact._id).eq("partitionKey", "root")).unique(),
    ctx.db.query("resourcePolicies").withIndex("by_resource", q => q.eq("resourceType", "artifact").eq("resourceId", artifact._id)).unique(),
  ]);
  return { importer, recipient, artifact, room, policyVersion: policy?.version ?? 0 };
}

/** The review list shows this many open conflicts; the run count stops there. */
export const OPEN_CONFLICT_COUNT_LIMIT = 100;

/** Terminal status for a run from its current errors and open conflicts. The
 * read is bounded: conflicts carry full old/new source payloads, and a school
 * run otherwise read every open conflict of every student in one mutation. */
export async function syncRunOutcome(ctx: MutationCtx, run: Doc<"externalSyncRuns">) {
  const conflicts = run.accountId
    ? (await ctx.db.query("externalSyncConflicts")
        .withIndex("by_account_status", q => q.eq("accountId", run.accountId!).eq("status", "open")).take(OPEN_CONFLICT_COUNT_LIMIT))
        .filter(item => item.integrationId === run.integrationId && item.schoolId === run.schoolId)
    : await ctx.db.query("externalSyncConflicts")
        .withIndex("by_integration_status", q => q.eq("integrationId", run.integrationId).eq("status", "open")).take(OPEN_CONFLICT_COUNT_LIMIT);
  const status = run.counts.errors > 0 ? "partial" as const
    : conflicts.length > 0 ? "awaiting_review" as const : "completed" as const;
  return { status, conflicts: conflicts.length };
}

type WorkOwner = { syncRunId: Id<"externalSyncRuns">; conflictId?: Id<"externalSyncConflicts"> };

async function addProviderWork(ctx: MutationCtx, owner: WorkOwner) {
  const now = Date.now();
  if (owner.conflictId) {
    const conflict = await ctx.db.get(owner.conflictId);
    if (conflict) await ctx.db.patch(conflict._id, { projectionWorkRemaining: (conflict.projectionWorkRemaining ?? 0) + 1, updatedAt: now });
    return;
  }
  const run = await ctx.db.get(owner.syncRunId);
  if (run) await ctx.db.patch(run._id, { projectionWorkRemaining: (run.projectionWorkRemaining ?? 0) + 1, updatedAt: now });
}

/** Settle one unit of staged provider work. A run finishes only after its
 * ingestion completed and every staged unit drained; an explicit resolution
 * resolves its conflict only when all of its effects committed. */
async function settleProviderWork(ctx: MutationCtx, owner: WorkOwner, committed: boolean) {
  const now = Date.now();
  if (owner.conflictId) {
    const conflict = await ctx.db.get(owner.conflictId);
    if (!conflict) return;
    const remaining = Math.max(0, (conflict.projectionWorkRemaining ?? 0) - 1);
    const resolution = committed ? conflict.projectionResolution : undefined;
    if (remaining === 0 && resolution && conflict.status === "open") {
      await ctx.db.patch(conflict._id, { projectionWorkRemaining: 0, projectionResolution: undefined,
        status: "resolved", resolution, resolvedAt: now, updatedAt: now });
      const [source, overlay] = await Promise.all([
        ctx.db.get(conflict.recordId),
        conflict.accountId ? ctx.db.query("externalRecordOverlays")
          .withIndex("by_record_account", q => q.eq("recordId", conflict.recordId).eq("accountId", conflict.accountId!)).unique() : null,
      ]);
      if (overlay && source) await ctx.db.patch(overlay._id, { sourceHashAtEdit: source.sourceHash, updatedAt: now });
    } else {
      await ctx.db.patch(conflict._id, { projectionWorkRemaining: remaining, projectionResolution: resolution, updatedAt: now });
    }
    return;
  }
  const run = await ctx.db.get(owner.syncRunId);
  if (!run) return;
  const remaining = Math.max(0, (run.projectionWorkRemaining ?? 0) - 1);
  if (remaining === 0 && run.projectionIngestionComplete && run.status === "running") {
    const outcome = await syncRunOutcome(ctx, run);
    await ctx.db.patch(run._id, {
      projectionWorkRemaining: 0, status: outcome.status,
      stage: outcome.status === "awaiting_review" ? "review_conflicts" : "complete",
      counts: { ...run.counts, conflicts: outcome.conflicts }, completedAt: now, updatedAt: now,
    });
    // Sync completion already reported the connection before this staged
    // work drained; a failure recorded since then must not stay "connected".
    if (outcome.status === "partial") {
      const integration = await ctx.db.get(run.integrationId);
      if (integration?.status === "connected") await ctx.db.patch(integration._id, { status: "degraded", updatedAt: now });
    }
  } else {
    await ctx.db.patch(run._id, { projectionWorkRemaining: remaining, updatedAt: now });
  }
}

async function recordProviderReceipt(
  ctx: MutationCtx, projection: Doc<"externalProjections">, source: Doc<"externalRecords">, mode: PlannerProviderMode,
  receipt: Omit<NonNullable<Doc<"externalProjections">["providerReceipt"]>, "completedAt">,
) {
  const now = Date.now();
  await ctx.db.patch(projection._id, {
    pendingProvider: undefined,
    providerReceipt: { ...receipt, completedAt: now },
    ...(mode === "removed" ? { state: "tombstoned" as const } : { state: "active" as const, sourceHash: source.sourceHash }),
    updatedAt: now,
  });
}

function nextGeneration(projection: Doc<"externalProjections">) {
  return Math.max(projection.pendingProvider?.generation ?? 0, projection.providerReceipt?.generation ?? 0) + 1;
}

/** Direct effect for a planner with no canonical room: content and its
 * import history commit in this transaction, or not at all. */
async function writeDirectProviderValue(
  ctx: MutationCtx, projection: Doc<"externalProjections">, source: Doc<"externalRecords">, target: Target,
  intent: { mode: PlannerProviderMode; operationId: string; generation: number; previousSourceHash: string; previousText?: PlannerProviderText },
): Promise<"applied" | "unchanged"> {
  const before = plannerValue(target.artifact);
  const next = preparePlannerProviderValue(before, sourceFacts(source), intent);
  if (await plannerProviderDigest(before) === await plannerProviderDigest(next)) {
    await recordProviderReceipt(ctx, projection, source, intent.mode,
      { operationId: intent.operationId, generation: intent.generation, state: "unchanged" });
    return "unchanged";
  }
  await ctx.db.patch(target.artifact._id, {
    title: next.title, summary: next.summary, content: next.content,
    textIndex: buildArtifactTextIndex({ title: next.title, summary: next.summary, content: next.content, tags: next.tags }),
    updatedAt: Date.now(),
  });
  const history = await commitDirectHumanChange(ctx, {
    artifactId: target.artifact._id, actorAccountId: target.importer.accountId, before,
    regionIds: ["artifact:structure"], summary: HISTORY_SUMMARY,
    origin: { source: "import", provenance: { kind: "managebac_provider", operationId: intent.operationId,
      mode: intent.mode, recordId: source._id, sourceHash: source.sourceHash } },
  });
  if (history.status !== "committed") throw new Error("MANAGEBAC_PROJECTION_RECEIPT_MISSING");
  await recordProviderReceipt(ctx, projection, source, intent.mode,
    { operationId: intent.operationId, generation: intent.generation, state: "committed", versionId: history.versionId });
  return "applied";
}

async function stageProviderJob(
  ctx: MutationCtx, projection: Doc<"externalProjections">, source: Doc<"externalRecords">,
  input: ProviderUpdateInput, previousText: PlannerProviderText | undefined,
) {
  const earlier = projection.pendingProvider;
  const generation = nextGeneration(projection);
  const now = Date.now();
  const intent: ProviderProjectionIntent = {
    operationId: `managebac:${projection._id}:${generation}`, generation, mode: input.mode,
    syncRunId: input.syncRunId, ...(input.conflictId ? { conflictId: input.conflictId } : {}),
    importerAccountId: input.importerAccountId, sourceHash: source.sourceHash,
    // A->B->C before B commits must still compare personal text against A.
    // An uncommitted earlier baseline is still the planner's actual baseline.
    previousSourceHash: earlier?.previousSourceHash ?? input.previousSourceHash,
    ...(earlier ? (earlier.previousText ? { previousText: earlier.previousText } : {}) : previousText ? { previousText } : {}),
    attempts: 0, nextAttemptAt: now, state: "pending",
  };
  await addProviderWork(ctx, intent);
  if (earlier?.state === "pending") await settleProviderWork(ctx, earlier, false);
  await ctx.db.patch(projection._id, { pendingProvider: intent, updatedAt: now });
  await scheduleAttempt(ctx, projection._id, intent, 0);
}

/** One replay attempt plus its watchdog. Overlapping attempts are safe: the
 * commit is fenced by operation, exact head and the room idempotency key. */
async function scheduleAttempt(
  ctx: MutationCtx, projectionId: Id<"externalProjections">, intent: ProviderProjectionIntent, delay: number,
) {
  const args = { projectionId, operationId: intent.operationId };
  await ctx.scheduler.runAfter(delay, runAction, args);
  await ctx.scheduler.runAfter(delay + ATTEMPT_WATCHDOG_MS, watchdogMutation, { ...args, attempts: intent.attempts });
}

/** Apply one provider fact change to one planner projection. */
export async function applyPlannerProviderUpdate(
  ctx: MutationCtx, projection: Doc<"externalProjections">, source: Doc<"externalRecords">, input: ProviderUpdateInput,
): Promise<ProviderUpdateOutcome> {
  const target = await authorizePlannerProvider(ctx, projection, source, { ...input, stagedResolution: false });
  if (!target) return "unavailable";
  const previousText = input.previousNormalized === undefined ? undefined : plannerProviderText(input.previousNormalized);
  const earlier = projection.pendingProvider;
  if (target.room) {
    await stageProviderJob(ctx, projection, source, input, previousText);
    return "staged";
  }
  // No canonical room: an uncommitted earlier intent is superseded here and
  // its baseline, not this page's, describes the planner's copied text.
  if (earlier?.state === "pending") await settleProviderWork(ctx, earlier, false);
  const generation = nextGeneration(projection);
  try {
    return await writeDirectProviderValue(ctx, projection, source, target, {
      mode: input.mode, operationId: `managebac:${projection._id}:${generation}`, generation,
      previousSourceHash: earlier?.previousSourceHash ?? input.previousSourceHash,
      previousText: earlier ? earlier.previousText : previousText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("MANAGEBAC_PROJECTION_BASE_CONFLICT")) {
      if (earlier) await ctx.db.patch(projection._id, { pendingProvider: undefined });
      return "conflict";
    }
    if (message.includes("MANAGEBAC_PROJECTION_RELINKED")) return "unavailable";
    throw error;
  }
}

type FanoutArgs = {
  recordId: Id<"externalRecords">; expectedSourceHash: string; mode: PlannerProviderMode;
  syncRunId: Id<"externalSyncRuns">; conflictId?: Id<"externalSyncConflicts">;
  importerAccountId: Id<"accounts">; accountId?: Id<"accounts">;
  previousSourceHash?: string; previousNormalized?: unknown; cursor: string | null;
};

/** Many planner projections for one source continue as a bounded chain on
 * the same run or resolution; the owner stays pending until it ends. */
export async function scheduleProviderFanout(ctx: MutationCtx, args: Omit<FanoutArgs, "cursor">) {
  await addProviderWork(ctx, args);
  await ctx.scheduler.runAfter(0, fanoutMutation, { ...args, cursor: null });
}

/** Planner projections for one source, bounded for the admitting transaction.
 * Returns null when the caller must fan out instead. */
export async function inlinePlannerProjections(ctx: MutationCtx, recordId: Id<"externalRecords">) {
  const rows = await ctx.db.query("externalProjections")
    .withIndex("by_record_type", q => q.eq("recordId", recordId).eq("projectionType", "planner_task"))
    .take(PROVIDER_INLINE_PLANNERS + 1);
  return rows.length > PROVIDER_INLINE_PLANNERS ? null : rows;
}

export async function recordProviderConflict(
  ctx: MutationCtx, run: Doc<"externalSyncRuns">, source: Doc<"externalRecords">,
  projections: Doc<"externalProjections">[], oldSource: unknown, overlay?: unknown,
) {
  if (!projections.length) return;
  const now = Date.now();
  await ctx.db.insert("externalSyncConflicts", {
    syncRunId: run._id, integrationId: run.integrationId, schoolId: run.schoolId, accountId: run.accountId,
    recordId: source._id, projectionType: projections[0]!.projectionType, projectionId: projections[0]!.projectionId,
    kind: "customization_overlap", oldSource, newSource: source.normalized,
    overlay: overlay ?? { reason: "A source-controlled field no longer matches the last synchronized value." },
    affectedLinks: projections.map(item => item.projectionId),
    suggestedActions: ["rebase", "keep_overlay", "detach"], status: "open", createdAt: now, updatedAt: now,
  });
  for (const projection of projections) await ctx.db.patch(projection._id, { state: "conflicted", updatedAt: now });
}

export const fanout = internalMutation({
  args: {
    recordId: v.id("externalRecords"), expectedSourceHash: v.string(),
    mode: v.union(v.literal("refresh"), v.literal("removed"), v.literal("rebase"), v.literal("keep_overlay")),
    syncRunId: v.id("externalSyncRuns"), conflictId: v.optional(v.id("externalSyncConflicts")),
    importerAccountId: v.id("accounts"), accountId: v.optional(v.id("accounts")),
    previousSourceHash: v.optional(v.string()), previousNormalized: v.optional(v.any()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const [source, run] = await Promise.all([ctx.db.get(args.recordId), ctx.db.get(args.syncRunId)]);
    // A newer provider generation owns its own fanout; never apply this one.
    if (!source || !run || source.sourceHash !== args.expectedSourceHash || source.tombstone !== (args.mode === "removed"))
      return settleProviderWork(ctx, args, false);
    const page = await ctx.db.query("externalProjections")
      .withIndex("by_record_type", q => q.eq("recordId", args.recordId).eq("projectionType", "planner_task"))
      .paginate({ cursor: args.cursor, numItems: FANOUT_BATCH });
    const conflicted: Doc<"externalProjections">[] = [];
    for (const projection of page.page) {
      if (args.accountId && projection.accountId !== args.accountId) continue;
      const outcome = await applyPlannerProviderUpdate(ctx, projection, source, {
        mode: args.mode, syncRunId: args.syncRunId, conflictId: args.conflictId, importerAccountId: args.importerAccountId,
        previousSourceHash: args.previousSourceHash ?? projection.sourceHash, previousNormalized: args.previousNormalized,
      });
      if (outcome === "conflict") conflicted.push(projection);
    }
    if (!explicitMode(args.mode)) await recordProviderConflict(ctx, run, source, conflicted, args.previousNormalized);
    if (!page.isDone) await ctx.scheduler.runAfter(0, fanoutMutation, { ...args, cursor: page.continueCursor });
    else await settleProviderWork(ctx, args, true);
  },
});

type JobState =
  | { kind: "missing" }
  | { kind: "unavailable"; projection: Doc<"externalProjections">; intent: ProviderProjectionIntent }
  | { kind: "ready"; projection: Doc<"externalProjections">; intent: ProviderProjectionIntent;
      source: Doc<"externalRecords">; target: Target };

async function currentJob(ctx: Ctx, args: JobArgs): Promise<JobState> {
  const projection = await ctx.db.get(args.projectionId);
  const intent = projection?.pendingProvider;
  if (!projection || !intent || intent.operationId !== args.operationId || intent.state !== "pending") return { kind: "missing" };
  const source = await ctx.db.get(projection.recordId);
  if (!source || source.sourceHash !== intent.sourceHash) return { kind: "unavailable", projection, intent };
  const target = await authorizePlannerProvider(ctx, projection, source, { ...intent, stagedResolution: true });
  return target ? { kind: "ready", projection, intent, source, target } : { kind: "unavailable", projection, intent };
}

/** Trusted preparation input for the internal replay action only. */
export const head = internalQuery({
  args: { projectionId: v.id("externalProjections"), operationId: v.string() },
  handler: async (ctx, args) => {
    const job = await currentJob(ctx, args);
    if (job.kind !== "ready") return { status: job.kind };
    const { artifact, room } = job.target;
    return {
      status: "ready" as const,
      artifactId: artifact._id,
      artifactDigest: await plannerProviderDigest(plannerProviderArtifactIdentity(artifact)),
      value: plannerValue(artifact),
      schemaVersion: artifact.schemaVersion ?? 1,
      room: room ? { id: room._id, nextSequence: room.nextSequence, schemaVersion: room.schemaVersion,
        status: room.status } : null,
      source: sourceFacts(job.source),
      intent: { mode: job.intent.mode, previousSourceHash: job.intent.previousSourceHash, previousText: job.intent.previousText },
    };
  },
});

/** A covering verified snapshot and keyset pages of the current room log. */
export const roomPage = internalQuery({
  args: {
    projectionId: v.id("externalProjections"), operationId: v.string(), roomId: v.id("collaborationRooms"),
    nextSequence: v.number(), afterSequence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const [projection, room] = await Promise.all([ctx.db.get(args.projectionId), ctx.db.get(args.roomId)]);
    if (projection?.pendingProvider?.operationId !== args.operationId || projection.pendingProvider.state !== "pending" ||
        !room || room.status === "closed" || room.nextSequence !== args.nextSequence ||
        String(room.artifactId) !== projection.projectionId) return null;
    const snapshot = args.afterSequence === undefined
      ? await ctx.db.query("collaborationSnapshots").withIndex("by_room_status_sequence", q =>
        q.eq("roomId", room._id).eq("status", "verified").lte("throughSequence", room.nextSequence - 1))
        .order("desc").first() : null;
    const after = args.afterSequence ?? snapshot?.throughSequence ?? 0;
    const result = await ctx.db.query("collaborationUpdates").withIndex("by_room_sequence", q =>
      q.eq("roomId", room._id).gt("sequence", after).lt("sequence", room.nextSequence)).order("asc")
      .paginate({ cursor: null, numItems: 100, maximumRowsRead: 100, maximumBytesRead: 1_400_000 });
    return {
      afterSequence: after,
      snapshot: snapshot ? {
        throughSequence: snapshot.throughSequence, update: snapshot.update, contentHash: snapshot.contentHash,
        byteLength: snapshot.byteLength ?? snapshot.update.byteLength, stateVector: snapshot.stateVector,
        payloadRef: snapshot.payloadRef ?? null, payloadDigest: snapshot.payloadDigest ?? null,
      } : null,
      updates: result.page.map(update => ({
        sequence: update.sequence, update: update.update, byteLength: update.byteLength,
        stateVectorHash: update.stateVectorHash,
        payloadRef: update.payloadRef ?? null, payloadDigest: update.payloadDigest ?? null,
      })),
    };
  },
});

function classifyFailure(error: string) {
  if (/MANAGEBAC_PROJECTION_BASE_CONFLICT/.test(error)) return "conflict" as const;
  if (/MANAGEBAC_PROJECTION_(FORBIDDEN|RELINKED|SUPERSEDED)/.test(error)) return "unavailable" as const;
  if (/MANAGEBAC_PROJECTION_(RESULT_CHANGED|INVALID|TOO_LARGE|DIGEST_INVALID)|COLLABORATION_(PROJECTION|PROVIDER)/.test(error))
    return "invalid" as const;
  return "retry" as const;
}

async function finishFailedJob(
  ctx: MutationCtx, projection: Doc<"externalProjections">, intent: ProviderProjectionIntent,
  kind: ReturnType<typeof classifyFailure>, error: string,
) {
  const now = Date.now();
  await ctx.db.patch(projection._id, { pendingProvider: { ...intent, state: "failed", error: error.slice(0, 500) }, updatedAt: now });
  const [run, source] = await Promise.all([ctx.db.get(intent.syncRunId), ctx.db.get(projection.recordId)]);
  if (run && source && !intent.conflictId && intent.mode === "refresh" && kind !== "unavailable") {
    // The person keeps an explicit, recoverable choice instead of a silently
    // stale planner; the source record has already advanced.
    await recordProviderConflict(ctx, run, source, [projection], intent.previousText);
  }
  if (run && !intent.conflictId && (kind === "invalid" || kind === "retry"))
    await ctx.db.patch(run._id, { counts: { ...run.counts, errors: run.counts.errors + 1 },
      errorCode: "MANAGEBAC_PROJECTION_FAILED", errorSummary: "A source update could not be applied to a personal planner.", updatedAt: now });
  await settleProviderWork(ctx, intent, false);
}

async function recordAttemptFailure(
  ctx: MutationCtx, args: JobArgs, error: string, expectedAttempts?: number,
) {
  const projection = await ctx.db.get(args.projectionId);
  const intent = projection?.pendingProvider;
  if (!projection || !intent || intent.operationId !== args.operationId || intent.state !== "pending" ||
      (expectedAttempts !== undefined && intent.attempts !== expectedAttempts)) return;
  const kind = classifyFailure(error);
  const attempts = intent.attempts + 1;
  if (kind === "retry" && attempts < MAX_ATTEMPTS) {
    const delay = Math.min(30_000, 1000 * 2 ** attempts);
    const next = { ...intent, attempts, nextAttemptAt: Date.now() + delay, error: error.slice(0, 500) };
    await ctx.db.patch(projection._id, { pendingProvider: next, updatedAt: Date.now() });
    await scheduleAttempt(ctx, projection._id, next, delay);
    return;
  }
  await finishFailedJob(ctx, projection, { ...intent, attempts }, kind, error);
}

export const failed = internalMutation({
  args: { projectionId: v.id("externalProjections"), operationId: v.string(), error: v.string() },
  handler: (ctx, args) => recordAttemptFailure(ctx, args, args.error),
});

/** Only an attempt that made no progress since it was scheduled is lost. */
export const watchdog = internalMutation({
  args: { projectionId: v.id("externalProjections"), operationId: v.string(), attempts: v.number() },
  handler: (ctx, args) => recordAttemptFailure(ctx, args, "MANAGEBAC_PROJECTION_ATTEMPT_LOST", args.attempts),
});

async function sha256Base64Url(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Only the internal replay action supplies this prepared update. The effect
 * repeats current authority, the exact artifact/room head fences and the
 * permitted provider merge, then appends and commits history atomically. */
export const commit = internalMutation({
  args: {
    projectionId: v.id("externalProjections"), operationId: v.string(), artifactDigest: v.string(),
    roomId: v.union(v.id("collaborationRooms"), v.null()), nextSequence: v.number(),
    prepared: v.optional(v.object({
      beforeJson: v.string(), afterJson: v.string(),
      change: v.optional(v.object({
        baseStateVectorHash: v.string(), stateVectorHash: v.string(), update: v.bytes(), regionIds: v.array(v.string()),
      })),
    })),
  },
  handler: async (ctx, args) => {
    const job = await currentJob(ctx, args);
    if (job.kind === "missing") {
      const projection = await ctx.db.get(args.projectionId);
      return { status: projection?.providerReceipt?.operationId === args.operationId ? "committed" as const : "superseded" as const };
    }
    if (job.kind === "unavailable") {
      await finishFailedJob(ctx, job.projection, job.intent, "unavailable", "MANAGEBAC_PROJECTION_FORBIDDEN");
      return { status: "unavailable" as const };
    }
    const { projection, intent, source, target } = job;
    const { artifact, room, importer, policyVersion } = target;
    if (await plannerProviderDigest(plannerProviderArtifactIdentity(artifact)) !== args.artifactDigest ||
        (room?._id ?? null) !== args.roomId || (room?.nextSequence ?? 1) !== args.nextSequence)
      throw new Error("MANAGEBAC_PROJECTION_HEAD_STALE");
    if (!room) {
      // The room was retired without a successor: the stored artifact is the
      // canonical head again, so the ordinary direct effect applies.
      try {
        await writeDirectProviderValue(ctx, projection, source, target, intent);
      } catch (error) {
        if (!String(error).includes("MANAGEBAC_PROJECTION_BASE_CONFLICT")) throw error;
        await finishFailedJob(ctx, projection, intent, "conflict", "MANAGEBAC_PROJECTION_BASE_CONFLICT");
        return { status: "conflict" as const };
      }
      await settleProviderWork(ctx, intent, true);
      return { status: "committed" as const };
    }
    const prepared = args.prepared;
    if (!prepared) throw new Error("MANAGEBAC_PROJECTION_INVALID");
    const [beforeHash, afterHash] = await Promise.all([sha256Base64Url(prepared.beforeJson), sha256Base64Url(prepared.afterJson)]);
    const authority = { accountId: importer.accountId, policyVersion };
    const before = await parseGatewayProjection(ctx, prepared.beforeJson, beforeHash, artifact, authority, { preserveSummary: true });
    const after = await parseGatewayProjection(ctx, prepared.afterJson, afterHash, artifact, authority, { preserveSummary: true });
    if (!before || !after) throw new Error("MANAGEBAC_PROJECTION_INVALID");
    let expected: PlannerProviderValue;
    try {
      expected = preparePlannerProviderValue(before, sourceFacts(source), intent);
    } catch (error) {
      if (!String(error).includes("MANAGEBAC_PROJECTION_BASE_CONFLICT")) throw error;
      await finishFailedJob(ctx, projection, intent, "conflict", "MANAGEBAC_PROJECTION_BASE_CONFLICT");
      return { status: "conflict" as const };
    }
    if (!samePlannerProviderValue(expected, after)) throw new Error("MANAGEBAC_PROJECTION_RESULT_CHANGED");
    if (samePlannerProviderValue(before, after) && !prepared.change) {
      await recordProviderReceipt(ctx, projection, source, intent.mode,
        { operationId: intent.operationId, generation: intent.generation, state: "unchanged", roomId: room._id });
      await settleProviderWork(ctx, intent, true);
      return { status: "unchanged" as const };
    }
    const change = prepared.change;
    if (!change || change.regionIds.length === 0 || change.regionIds.length > 128)
      throw new Error("MANAGEBAC_PROJECTION_INVALID");
    const now = Date.now();
    if (room.nextSequence > 1 && (room.lastProjectionSequence ?? 0) < room.nextSequence - 1) {
      // Materialize the replayed head before closing earlier human groups;
      // any failure below rolls this back with the rest of the effect.
      await ctx.db.patch(artifact._id, { title: before.title, summary: before.summary, tags: before.tags,
        content: before.content, contentHash: beforeHash,
        textIndex: buildArtifactTextIndex({ title: before.title, summary: before.summary, content: before.content, tags: before.tags }) });
      await ctx.db.patch(room._id, { lastProjectionSequence: room.nextSequence - 1, lastProjectionAt: now });
    } else if (room.nextSequence === 1 && artifact.liveStateVectorHash && artifact.liveStateVectorHash !== change.baseStateVectorHash) {
      // An empty successor room starts from the empty document.
      await ctx.db.patch(artifact._id, { liveStateVectorHash: change.baseStateVectorHash });
    }
    await commitHumanCheckpoint(ctx, artifact._id, "Your work before the school source changed");
    const appended = await appendRoomUpdate(ctx, {
      artifactId: artifact._id, accountId: importer.accountId, actorKind: "human", partitionKey: "root",
      clientId: "managebac-provider", policyVersion, idempotencyKey: intent.operationId,
      expectedRoomId: room._id, expectedNextSequence: room.nextSequence,
      baseStateVectorHash: change.baseStateVectorHash, stateVectorHash: change.stateVectorHash,
      update: change.update, regionIds: change.regionIds,
      projectionJson: prepared.afterJson, projectionHash: afterHash,
    }, { provider: {
      source: "import", operationId: intent.operationId,
      authorize: async (current) => {
        if (current.actor.accountId !== importer.accountId || current.artifact._id !== artifact._id || current.room._id !== room._id)
          throw new Error("MANAGEBAC_PROJECTION_FORBIDDEN");
      },
      validateProjection: async (projected) => {
        if (!samePlannerProviderValue(expected, projected)) throw new Error("MANAGEBAC_PROJECTION_RESULT_CHANGED");
      },
    } });
    if (appended.duplicate || !("changeGroupId" in appended) || !appended.changeGroupId)
      throw new Error("MANAGEBAC_PROJECTION_RECEIPT_MISSING");
    const history = await commitChangeGroup(ctx, appended.changeGroupId, { source: "import", summary: HISTORY_SUMMARY,
      provenance: { kind: "managebac_provider", operationId: intent.operationId, mode: intent.mode,
        recordId: source._id, sourceHash: source.sourceHash } });
    if (history.status !== "committed") throw new Error("MANAGEBAC_PROJECTION_RECEIPT_MISSING");
    await recordProviderReceipt(ctx, projection, source, intent.mode, { operationId: intent.operationId,
      generation: intent.generation, state: "committed", roomId: room._id, sequence: appended.sequence, versionId: history.versionId });
    await settleProviderWork(ctx, intent, true);
    return { status: "committed" as const, sequence: appended.sequence };
  },
});
