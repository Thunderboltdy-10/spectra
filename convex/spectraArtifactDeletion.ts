import { query } from "./_generated/server";
import { internalMutation, mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import { requireArtifactCapability } from "./spectraShared";
import { tombstoneArtifactEmbeds } from "./orgTreeShared";
import { releaseSnapshotObject, releaseVersionIfUnpinned } from "./artifactSnapshots";
import { releaseArtifactIntakePage } from "./artifactIntakeLifecycle";
import { releasePayloadIfUnreferenced } from "./payloadLifecycle";
import { recordMeterEvent } from "./metering";
import {
  DELETION_CURSOR_VERSION,
  DELETION_PAGE_TIMEOUT_MS,
  queueDeletionDispatch,
  queueDeletionProcess,
  queueDeletionRecovery,
} from "./artifactDeletionScheduling";
import {
  isSurvivingPinnedEmbed,
} from "./artifactEmbedOwnership";
import { normalizeMediaType, normalizeSha256 } from "../shared/intake-integrity";

const PAGE = 40;
const CURSOR_VERSION = DELETION_CURSOR_VERSION;
type Job = Doc<"artifactDeletionJobs">;
type EmbedScope = "source" | "container";
type LinkDirection = "source" | "target";
type RunChild = "cards" | "operations" | "events" | "attachments" | "jobs" | "tabs";
type State = {
  version: string; artifactId: string; generation: number; family: string; cursor?: string | null;
  embedScope?: EmbedScope; embedId?: string; embedParentCursor?: string | null; linkDirection?: LinkDirection; nodeId?: string; nodeParentCursor?: string | null;
  commentId?: string; commentParentCursor?: string | null; claimCursor?: string | null; claimId?: string;
  child?: "capsules" | "evidence" | "relations" | "relationsTo"; capsuleCursor?: string | null; regionClaimCursor?: string | null; claimsDrained?: boolean; roomId?: string; roomParentCursor?: string | null;
  roomChild?: "updates" | "snapshots"; roomCursor?: string | null; runId?: string; runParentCursor?: string | null;
  runChild?: RunChild; runRetained?: boolean;
};
type PageResult = { state: State; done: boolean; scanned: number; changed: number; retained: number; terminal: number; released: number };
type PageOptions = { testFailAfter?: number };

function encode(value: State) { return Buffer.from(JSON.stringify(value), "utf8").toString("base64url"); }
function stateFor(job: Pick<Job, "artifactId" | "generation">, family: string, cursor: string | null, extra: Partial<State> = {}): State {
  return { version: CURSOR_VERSION, artifactId: String(job.artifactId), generation: job.generation, family, cursor, ...extra };
}
function decode(value: string | undefined, job: Job): State {
  if (!value) return stateFor(job, "embeds", null, { embedScope: "source" });
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as State;
    if (!parsed.version && parsed.family === "requests") return stateFor(job, "requestsWrite", null);
    if (parsed.version !== CURSOR_VERSION || parsed.artifactId !== String(job.artifactId) || parsed.generation !== job.generation || typeof parsed.family !== "string" || (parsed.cursor !== undefined && parsed.cursor !== null && typeof parsed.cursor !== "string")) throw new Error("DELETION_CURSOR_INVALID");
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message === "DELETION_CURSOR_INVALID") throw error;
    throw new Error("DELETION_CURSOR_INVALID");
  }
}
function resultBase(state: State, values: Omit<PageResult, "state">): PageResult { return { state, ...values }; }

async function schedule(ctx: MutationCtx, jobId: Id<"artifactDeletionJobs">, generation: number, delay = 0, expected?: { phase: string; cursor?: string }) {
  await queueDeletionDispatch(ctx, jobId, generation, delay, expected);
}
async function actor(ctx: QueryCtx | MutationCtx) {
  const value = await getAuthenticatedActor(ctx);
  if (!value) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return value;
}

export const request = mutation({
  args: { artifactId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const current = await actor(ctx);
    const existingArtifact = await ctx.db.get(args.artifactId);
    if (!existingArtifact) throw new Error("DELETION_NOT_FOUND");
    if (existingArtifact.status === "deleted") {
      if (existingArtifact.ownerAccountId !== current.accountId || existingArtifact.schoolId !== current.schoolId) throw new Error("AUTH_RESOURCE_FORBIDDEN: You do not have permission for this action.");
      const latest = await ctx.db.query("artifactDeletionJobs").withIndex("by_artifact_generation", (q) => q.eq("artifactId", args.artifactId)).order("desc").first();
      if (latest?.phase === "complete") return { artifactId: args.artifactId, jobId: latest._id, scheduled: false, complete: true };
      return scheduleDeletion(ctx, args.artifactId, existingArtifact, current.accountId);
    }
    const { actor: owner, artifact } = await requireArtifactCapability(ctx, args.artifactId, "delete");
    return scheduleDeletion(ctx, args.artifactId, artifact, owner.accountId);
  },
});

export async function scheduleDeletion(ctx: MutationCtx, artifactId: Id<"spectraArtifacts">, artifact: Doc<"spectraArtifacts">, ownerAccountId: Id<"accounts">) {
  const now = Date.now();
  const existing = await ctx.db.query("artifactDeletionJobs").withIndex("by_artifact_generation", (q) => q.eq("artifactId", artifactId)).order("desc").first();
  if (existing && !["complete", "failed"].includes(existing.phase)) {
    await schedule(ctx, existing._id, existing.generation, 0, { phase: existing.phase, cursor: existing.cursor });
    return { artifactId, jobId: existing._id, scheduled: true, complete: false };
  }
  const generation = Math.max(existing?.generation ?? 0, artifact.deletionGeneration ?? 0) + 1;
  await ctx.db.patch(artifactId, { status: "deleted", deletionGeneration: generation, deletionRequestedAt: artifact.deletionRequestedAt ?? now, updatedAt: now });
  await tombstoneArtifactEmbeds(ctx, artifactId, ownerAccountId, now);
  const initial = stateFor({ artifactId, generation }, "embeds", null, { embedScope: "source" });
  const initialCursor = encode(initial);
  const jobId = await ctx.db.insert("artifactDeletionJobs", { artifactId, ownerAccountId, schoolId: artifact.schoolId, generation, phase: "placements", cursor: initialCursor, deletedRows: 0, releasedBytes: 0, scannedRows: 0, retainedRows: 0, terminalRows: 0, attemptCount: 0, createdAt: now, updatedAt: now });
  await schedule(ctx, jobId, generation, 0, { phase: "placements", cursor: initialCursor });
  return { artifactId, jobId, scheduled: true, complete: false };
}

async function processEmbedPage(ctx: MutationCtx, job: Job, state: State): Promise<PageResult> {
  if (state.embedId) {
    const embedId = ctx.db.normalizeId("artifactEmbeds", state.embedId);
    if (!embedId) throw new Error("DELETION_CURSOR_INVALID");
    const requests = await ctx.db.query("artifactAccessRequests").withIndex("by_embed_status", (q) => q.eq("embedId", embedId).eq("status", "pending")).paginate({ numItems: PAGE, cursor: state.cursor ?? null });
    for (const request of requests.page) { const now = Date.now(); await ctx.db.patch(request._id, { status: "cancelled", updatedAt: now, resolvedAt: now, resolvedByAccountId: job.ownerAccountId }); }
    if (!requests.isDone) return resultBase(stateFor(job, "embeds", requests.continueCursor, { embedScope: state.embedScope ?? "source", embedId: state.embedId, embedParentCursor: state.embedParentCursor }), { done: false, scanned: requests.page.length, changed: requests.page.length, retained: 0, terminal: 0, released: 0 });
    const embed = await ctx.db.get(embedId);
    if (state.embedScope === "container" && embed?.pinnedVersionId) await releaseVersionIfUnpinned(ctx, embed.pinnedVersionId, embed._id);
    return resultBase(stateFor(job, "embeds", state.embedParentCursor ?? null, { embedScope: state.embedScope ?? "source" }), { done: false, scanned: requests.page.length, changed: requests.page.length, retained: 0, terminal: 0, released: 0 });
  }
  const scope = state.embedScope ?? "source";
  const result = scope === "source"
    ? await ctx.db.query("artifactEmbeds").withIndex("by_source", (q) => q.eq("sourceArtifactId", job.artifactId)).paginate({ numItems: 1, cursor: state.cursor ?? null })
    : await ctx.db.query("artifactEmbeds").withIndex("by_container", (q) => q.eq("containerType", "artifact").eq("containerId", String(job.artifactId))).paginate({ numItems: 1, cursor: state.cursor ?? null });
  const embed = result.page[0];
  const changed = 0;
  if (embed) {
    let embedChanged = 0;
    const now = Date.now();
    if (scope === "source") {
      if (embed.sourceUnavailableAt === undefined) {
        await ctx.db.patch(embed._id, { sourceUnavailableAt: now, updatedAt: now });
        embedChanged++;
      }
    } else if (!embed.removedAt || embed.placementState !== "removed") {
      await ctx.db.patch(embed._id, { removedAt: embed.removedAt ?? now, placementState: "removed", updatedAt: now });
      embedChanged++;
    }
    return resultBase(stateFor(job, "embeds", null, { embedScope: scope, embedId: String(embed._id), embedParentCursor: result.continueCursor }), { done: false, scanned: 1, changed: embedChanged, retained: 0, terminal: 0, released: 0 });
  }
  if (!result.isDone) return resultBase(stateFor(job, "embeds", result.continueCursor, { embedScope: scope }), { done: false, scanned: result.page.length, changed, retained: 0, terminal: 0, released: 0 });
  if (scope === "source") return resultBase(stateFor(job, "embeds", null, { embedScope: "container" }), { done: false, scanned: result.page.length, changed, retained: 0, terminal: 0, released: 0 });
  return resultBase(stateFor(job, "placements", null), { done: false, scanned: result.page.length, changed, retained: 0, terminal: 0, released: 0 });
}

async function processPlacementPage(ctx: MutationCtx, job: Job, state: State): Promise<PageResult> {
  if (state.nodeId) {
    const nodeId = ctx.db.normalizeId("orgNodes", state.nodeId);
    if (!nodeId) throw new Error("DELETION_CURSOR_INVALID");
    const links = await ctx.db.query("orgNodes").withIndex("by_kind_source", (q) => q.eq("kind", "link").eq("sourceId", state.nodeId!)).paginate({ numItems: PAGE, cursor: state.cursor ?? null });
    for (const link of links.page) await ctx.db.delete(link._id);
    if (!links.isDone) return resultBase(stateFor(job, "placements", links.continueCursor, { nodeId: state.nodeId, nodeParentCursor: state.nodeParentCursor }), { done: false, scanned: links.page.length, changed: links.page.length, retained: 0, terminal: 0, released: 0 });
    await ctx.db.delete(nodeId);
    return resultBase(stateFor(job, "placements", state.nodeParentCursor ?? null), { done: false, scanned: links.page.length + 1, changed: links.page.length + 1, retained: 0, terminal: 0, released: 0 });
  }
  const rows = await ctx.db.query("orgNodes").withIndex("by_kind_source", (q) => q.eq("kind", "work").eq("sourceId", String(job.artifactId))).paginate({ numItems: 1, cursor: state.cursor ?? null });
  const node = rows.page[0];
  if (!node) return resultBase(stateFor(job, "versions", null), { done: false, scanned: 0, changed: 0, retained: 0, terminal: 0, released: 0 });
  return resultBase(stateFor(job, "placements", null, { nodeId: String(node._id), nodeParentCursor: rows.continueCursor }), { done: false, scanned: 1, changed: 0, retained: 0, terminal: 0, released: 0 });
}

async function processVersionPage(ctx: MutationCtx, job: Job, state: State): Promise<PageResult> {
  const rows = await ctx.db.query("spectraArtifactVersions").withIndex("by_artifact_created", (q) => q.eq("artifactId", job.artifactId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null });
  let changed = 0; let retained = 0;
  for (const row of rows.page) {
    const pinned = await ctx.db.query("artifactEmbeds").withIndex("by_pinned_version", (q) => q.eq("pinnedVersionId", row._id)).filter((q) => q.eq(q.field("removedAt"), undefined)).first();
    if (pinned && isSurvivingPinnedEmbed(pinned)) { retained++; continue; }
    await ctx.db.delete(row._id);
    if (row.snapshotRef) await releaseSnapshotObject(ctx, job.schoolId, row.snapshotRef);
    if (row.beforeSnapshotRef) await releaseSnapshotObject(ctx, job.schoolId, row.beforeSnapshotRef);
    changed++;
  }
  return resultBase(stateFor(job, rows.isDone ? "intake" : "versions", rows.isDone ? null : rows.continueCursor), { done: false, scanned: rows.page.length, changed, retained, terminal: 0, released: 0 });
}

async function processRuntimePage(ctx: MutationCtx, job: Job, state: State): Promise<PageResult> {
  const rows = await ctx.db.query("spectraRuntimeBuilds").withIndex("by_artifact_status", (q) => q.eq("artifactId", job.artifactId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null });
  let released = 0; let changed = 0; let retained = 0;
  for (const row of rows.page) {
    const pinned = await ctx.db.query("artifactEmbeds").withIndex("by_pinned_version", (q) => q.eq("pinnedVersionId", row.artifactVersionId)).filter((q) => q.eq(q.field("removedAt"), undefined)).first();
    if (pinned && isSurvivingPinnedEmbed(pinned)) { retained++; continue; }
    if (row.storageId) {
      const metadata = await ctx.db.system.get("_storage", row.storageId);
      const safe = metadata !== null && row.payloadBytes !== undefined && row.payloadHash !== undefined && metadata.size === row.payloadBytes && normalizeSha256(metadata.sha256) === normalizeSha256(row.payloadHash);
      if (!safe) { retained++; continue; }
      await ctx.storage.delete(row.storageId);
      const bytes = metadata.size;
      released += bytes;
      if (job.schoolId) await recordMeterEvent(ctx, { schoolId: job.schoolId, accountId: job.ownerAccountId, category: "storage_bytes", quantity: -bytes, sourceType: "runtime_build_release", sourceId: String(row._id), idempotencyKey: `runtime-release:${String(row._id)}`, dimensions: { runtime: row.runtime }, occurredAt: Date.now() });
    }
    await ctx.db.delete(row._id);
    changed++;
  }
  return resultBase(stateFor(job, rows.isDone ? "userStates" : "runtime", rows.isDone ? null : rows.continueCursor), { done: false, scanned: rows.page.length, changed, retained, terminal: 0, released });
}

async function processCommentsPage(ctx: MutationCtx, job: Job, state: State): Promise<PageResult> {
  if (state.commentId) {
    const commentId = ctx.db.normalizeId("artifactComments", state.commentId); if (!commentId) throw new Error("DELETION_CURSOR_INVALID");
    const rows = await ctx.db.query("artifactCommentNotifications").withIndex("by_comment_recipient", (q) => q.eq("commentId", commentId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null });
    for (const row of rows.page) await ctx.db.delete(row._id);
    if (!rows.isDone) return resultBase(stateFor(job, "comments", rows.continueCursor, { commentId: state.commentId, commentParentCursor: state.commentParentCursor }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
    await ctx.db.delete(commentId);
    return resultBase(stateFor(job, "comments", state.commentParentCursor ?? null), { done: false, scanned: rows.page.length + 1, changed: rows.page.length + 1, retained: 0, terminal: 0, released: 0 });
  }
  const rows = await ctx.db.query("artifactComments").withIndex("by_artifact_status", (q) => q.eq("artifactId", job.artifactId)).paginate({ numItems: 1, cursor: state.cursor ?? null });
  const comment = rows.page[0];
  if (!comment) return resultBase(stateFor(job, "commentPreferences", null), { done: false, scanned: 0, changed: 0, retained: 0, terminal: 0, released: 0 });
  return resultBase(stateFor(job, "comments", null, { commentId: String(comment._id), commentParentCursor: rows.continueCursor }), { done: false, scanned: 1, changed: 0, retained: 0, terminal: 0, released: 0 });
}

async function processMemoryPage(ctx: MutationCtx, job: Job, state: State): Promise<PageResult> {
  if (state.claimId && state.child) {
    const claimId = ctx.db.normalizeId("memoryClaims", state.claimId); if (!claimId) throw new Error("DELETION_CURSOR_INVALID");
    if (state.child === "capsules") {
      const claim = await ctx.db.get(claimId); if (!claim) return resultBase(stateFor(job, "memory", state.claimCursor ?? null), { done: false, scanned: 0, changed: 0, retained: 0, terminal: 0, released: 0 });
      const rows = await ctx.db.query("memoryCapsules").withIndex("by_account_scope", (q) => q.eq("accountId", claim.accountId)).paginate({ numItems: PAGE, cursor: state.capsuleCursor ?? null });
      let changed = 0;
      for (const capsule of rows.page) if (capsule.claimIds.some((id) => id === claimId)) { await ctx.db.patch(capsule._id, { text: "[redacted]", claimIds: [], tokenCount: 0, stale: true, updatedAt: Date.now() }); changed++; }
      if (!rows.isDone) return resultBase(stateFor(job, "memory", null, { claimId: state.claimId, child: "capsules", capsuleCursor: rows.continueCursor, claimCursor: state.claimCursor }), { done: false, scanned: rows.page.length, changed, retained: 0, terminal: 0, released: 0 });
      await ctx.db.patch(claimId, { proposition: "[redacted]", normalizedProposition: "[redacted]", embedding: undefined, confidence: 0, status: "deleted", deletionRequestedAt: Date.now(), updatedAt: Date.now() });
      return resultBase(stateFor(job, "memory", null, { claimId: state.claimId, child: "evidence", claimCursor: state.claimCursor }), { done: false, scanned: rows.page.length, changed: changed + 1, retained: 0, terminal: 0, released: 0 });
    }
    if (state.child === "evidence") {
      const rows = await ctx.db.query("memoryEvidence").withIndex("by_claim_created", (q) => q.eq("claimId", claimId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null });
      for (const row of rows.page) await ctx.db.delete(row._id);
      return resultBase(stateFor(job, "memory", rows.isDone ? null : rows.continueCursor, rows.isDone ? { claimId: state.claimId, child: "relations", claimCursor: state.claimCursor } : { claimId: state.claimId, child: "evidence", claimCursor: state.claimCursor }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
    }
    const rows = state.child === "relations"
      ? await ctx.db.query("memoryRelations").withIndex("by_from_claim", (q) => q.eq("fromClaimId", claimId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null })
      : await ctx.db.query("memoryRelations").withIndex("by_to_claim", (q) => q.eq("toClaimId", claimId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null });
    for (const row of rows.page) await ctx.db.delete(row._id);
    if (!rows.isDone) return resultBase(stateFor(job, "memory", rows.continueCursor, { claimId: state.claimId, child: state.child, claimCursor: state.claimCursor }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
    if (state.child === "relations") return resultBase(stateFor(job, "memory", null, { claimId: state.claimId, child: "relationsTo", claimCursor: state.claimCursor }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
    return resultBase(stateFor(job, "memory", state.claimCursor ?? null), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
  }
  const rows = await ctx.db.query("memoryClaims").withIndex("by_artifact_status", (q) => q.eq("artifactId", job.artifactId)).paginate({ numItems: 1, cursor: state.claimCursor ?? state.cursor ?? null });
  const claim = rows.page[0];
  if (!claim) return resultBase(stateFor(job, "links", null, { linkDirection: "source" }), { done: false, scanned: 0, changed: 0, retained: 0, terminal: 0, released: 0 });
  return resultBase(stateFor(job, "memory", null, { claimId: String(claim._id), child: "capsules", capsuleCursor: null, claimCursor: rows.continueCursor }), { done: false, scanned: 1, changed: 0, retained: 0, terminal: 0, released: 0 });
}

async function processLinksPage(ctx: MutationCtx, job: Job, state: State): Promise<PageResult> {
  const direction = state.linkDirection ?? "source";
  const rows = direction === "source"
    ? await ctx.db.query("spectraArtifactLinks").withIndex("by_source", (q) => q.eq("sourceArtifactId", job.artifactId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null })
    : await ctx.db.query("spectraArtifactLinks").withIndex("by_target", (q) => q.eq("targetArtifactId", job.artifactId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null });
  for (const row of rows.page) await ctx.db.delete(row._id);
  if (!rows.isDone) return resultBase(stateFor(job, "links", rows.continueCursor, { linkDirection: direction }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
  if (direction === "source") return resultBase(stateFor(job, "links", null, { linkDirection: "target" }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
  return resultBase(stateFor(job, "replicas", null), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
}

async function processReplicasPage(ctx: MutationCtx, job: Job, state: State): Promise<PageResult> {
  const rows = await ctx.db.query("workReplicas").withIndex("by_work", (q) => q.eq("workId", job.artifactId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null });
  let released = 0;
  for (const row of rows.page) { const refs = [...new Set([row.payloadRef, row.pendingPayloadRef, row.projectionBasePayloadRef].filter((ref): ref is string => Boolean(ref)))]; await ctx.db.delete(row._id); for (const ref of refs) released += await releasePayloadIfUnreferenced(ctx, ref, { schoolId: job.schoolId, accountId: job.ownerAccountId, sourceId: String(row._id) }); }
  return resultBase(stateFor(job, rows.isDone ? "syncOperations" : "replicas", rows.isDone ? null : rows.continueCursor), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released });
}

async function processSyncOperationsPage(ctx: MutationCtx, job: Job, state: State): Promise<PageResult> {
  const rows = await ctx.db.query("syncOperations").withIndex("by_work_created", (q) => q.eq("workId", job.artifactId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null });
  for (const row of rows.page) await ctx.db.delete(row._id);
  return resultBase(stateFor(job, rows.isDone ? "syncConflicts" : "syncOperations", rows.isDone ? null : rows.continueCursor), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
}

async function processSyncConflictsPage(ctx: MutationCtx, job: Job, state: State): Promise<PageResult> {
  const rows = await ctx.db.query("syncConflicts").withIndex("by_work_state", (q) => q.eq("workId", job.artifactId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null });
  let released = 0;
  for (const row of rows.page) { const refs = [...new Set([row.localPayloadRef, row.spectraPayloadRef].filter((ref): ref is string => Boolean(ref)))]; await ctx.db.delete(row._id); for (const ref of refs) released += await releasePayloadIfUnreferenced(ctx, ref, { schoolId: job.schoolId, accountId: job.ownerAccountId, sourceId: String(row._id) }); }
  return resultBase(stateFor(job, rows.isDone ? "requestsWrite" : "syncConflicts", rows.isDone ? null : rows.continueCursor), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released });
}

async function processWriteRequestsPage(ctx: MutationCtx, job: Job, state: State, family: "requestsWrite" | "requestsFs", options: PageOptions): Promise<PageResult> {
  if (family === "requestsWrite") {
    const rows = await ctx.db.query("bridgeWriteRequests").withIndex("by_work_created", (q) => q.eq("workId", job.artifactId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null }); let changed = 0; let terminal = 0; let released = 0;
    for (const row of rows.page) { if (["failed", "verified", "conflicted", "ignored"].includes(row.state)) { terminal++; released += await releasePayloadIfUnreferenced(ctx, row.payloadRef, { schoolId: job.schoolId, accountId: job.ownerAccountId, sourceId: String(row._id) }); continue; } await ctx.db.patch(row._id, { state: "failed", errorCode: "work-deleted", errorMessage: "The work was deleted.", retryAt: undefined, updatedAt: Date.now() }); changed++; if (options.testFailAfter !== undefined && changed >= options.testFailAfter) throw new Error("DELETION_TEST_PAGE_FAILURE"); released += await releasePayloadIfUnreferenced(ctx, row.payloadRef, { schoolId: job.schoolId, accountId: job.ownerAccountId, sourceId: String(row._id) }); }
    return resultBase(stateFor(job, rows.isDone ? "requestsFs" : family, rows.isDone ? null : rows.continueCursor), { done: false, scanned: rows.page.length, changed, retained: 0, terminal, released });
  }
  const rows = await ctx.db.query("bridgeFsRequests").withIndex("by_work_created", (q) => q.eq("workId", job.artifactId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null }); let changed = 0; let terminal = 0;
  for (const row of rows.page) { if (["failed", "verified", "conflicted", "ignored"].includes(row.state)) { terminal++; continue; } await ctx.db.patch(row._id, { state: "failed", errorCode: "work-deleted", errorMessage: "The work was deleted.", updatedAt: Date.now() }); changed++; }
  return resultBase(stateFor(job, rows.isDone ? "collaboration" : family, rows.isDone ? null : rows.continueCursor), { done: false, scanned: rows.page.length, changed, retained: 0, terminal, released: 0 });
}

async function processCollaborationPage(ctx: MutationCtx, job: Job, state: State): Promise<PageResult> {
  if (!state.claimsDrained) {
    const claims = await ctx.db.query("regionClaims").withIndex("by_artifact_status", (q) => q.eq("artifactId", job.artifactId)).paginate({ numItems: PAGE, cursor: state.regionClaimCursor ?? null });
    for (const claim of claims.page) await ctx.db.delete(claim._id);
    const extra: Partial<State> = { claimsDrained: claims.isDone, regionClaimCursor: claims.isDone ? undefined : claims.continueCursor };
    if (state.roomId && state.roomChild) Object.assign(extra, { roomId: state.roomId, roomChild: state.roomChild, roomParentCursor: state.roomParentCursor, roomCursor: state.roomCursor });
    return resultBase(stateFor(job, "collaboration", state.cursor ?? null, extra), { done: false, scanned: claims.page.length, changed: claims.page.length, retained: 0, terminal: 0, released: 0 });
  }
  const changed = 0;
  if (state.roomId && state.roomChild) {
    const roomId = ctx.db.normalizeId("collaborationRooms", state.roomId); if (!roomId) throw new Error("DELETION_CURSOR_INVALID");
    if (state.roomChild === "updates") {
      const rows = await ctx.db.query("collaborationUpdates").withIndex("by_room_sequence", (q) => q.eq("roomId", roomId)).paginate({ numItems: PAGE, cursor: state.roomCursor ?? null }); for (const row of rows.page) await ctx.db.delete(row._id);
      if (!rows.isDone) return resultBase(stateFor(job, "collaboration", state.cursor ?? null, { claimsDrained: true, roomId: state.roomId, roomChild: "updates", roomParentCursor: state.roomParentCursor, roomCursor: rows.continueCursor }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
      return resultBase(stateFor(job, "collaboration", state.cursor ?? null, { claimsDrained: true, roomId: state.roomId, roomChild: "snapshots", roomParentCursor: state.roomParentCursor, roomCursor: null }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
    }
    const rows = await ctx.db.query("collaborationSnapshots").withIndex("by_room_sequence", (q) => q.eq("roomId", roomId)).paginate({ numItems: PAGE, cursor: state.roomCursor ?? null }); for (const row of rows.page) await ctx.db.delete(row._id);
    if (!rows.isDone) return resultBase(stateFor(job, "collaboration", state.cursor ?? null, { claimsDrained: true, roomId: state.roomId, roomChild: "snapshots", roomParentCursor: state.roomParentCursor, roomCursor: rows.continueCursor }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
    await ctx.db.delete(roomId); return resultBase(stateFor(job, "collaboration", state.roomParentCursor ?? null, { claimsDrained: true }), { done: false, scanned: rows.page.length + 1, changed: rows.page.length + 1, retained: 0, terminal: 0, released: 0 });
  }
  const rows = await ctx.db.query("collaborationRooms").withIndex("by_artifact_partition", (q) => q.eq("artifactId", job.artifactId)).paginate({ numItems: 1, cursor: state.cursor ?? null }); const room = rows.page[0];
  if (!room) return resultBase(stateFor(job, "runs", null), { done: false, scanned: 0, changed, retained: 0, terminal: 0, released: 0 });
  return resultBase(stateFor(job, "collaboration", null, { claimsDrained: true, roomId: String(room._id), roomChild: "updates", roomParentCursor: rows.continueCursor, roomCursor: null }), { done: false, scanned: 1, changed, retained: 0, terminal: 0, released: 0 });
}

async function processRunPage(ctx: MutationCtx, job: Job, state: State): Promise<PageResult> {
  if (!state.runId || !state.runChild) {
    const rows = await ctx.db.query("spectraAiRuns").withIndex("by_artifact", (q) => q.eq("artifactId", job.artifactId)).paginate({ numItems: 1, cursor: state.cursor ?? null }); const run = rows.page[0];
    if (!run) return resultBase(stateFor(job, "artifact", null), { done: false, scanned: 0, changed: 0, retained: 0, terminal: 0, released: 0 });
    return resultBase(stateFor(job, "runChildren", null, { runId: String(run._id), runChild: "cards", runParentCursor: rows.continueCursor, runRetained: false }), { done: false, scanned: 1, changed: 0, retained: 0, terminal: 0, released: 0 });
  }
  const runId = ctx.db.normalizeId("spectraAiRuns", state.runId); if (!runId) throw new Error("DELETION_CURSOR_INVALID");
  if (state.runChild === "cards") {
    const rows = await ctx.db.query("spectraResultCards").withIndex("by_run", (q) => q.eq("runId", runId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null }); let retained = state.runRetained ?? false;
    for (const row of rows.page) { const survivor = row.artifactId !== undefined && row.artifactId !== job.artifactId; retained ||= survivor; if (!survivor) await ctx.db.delete(row._id); }
    if (!rows.isDone) return resultBase(stateFor(job, "runChildren", rows.continueCursor, { runId: state.runId, runChild: "cards", runParentCursor: state.runParentCursor, runRetained: retained }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: retained ? 1 : 0, terminal: 0, released: 0 });
    if (retained) return resultBase(stateFor(job, "runs", state.runParentCursor ?? null), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 1, terminal: 0, released: 0 });
    return resultBase(stateFor(job, "runChildren", null, { runId: state.runId, runChild: "operations", runParentCursor: state.runParentCursor }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
  }
  const child = state.runChild;
  if (child === "operations") { const rows = await ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", runId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null }); for (const row of rows.page) await ctx.db.delete(row._id); return resultBase(stateFor(job, "runChildren", rows.isDone ? null : rows.continueCursor, { runId: state.runId, runChild: rows.isDone ? "events" : "operations", runParentCursor: state.runParentCursor }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 }); }
  if (child === "events") { const rows = await ctx.db.query("spectraRunEvents").withIndex("by_run_sequence", (q) => q.eq("runId", runId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null }); for (const row of rows.page) await ctx.db.delete(row._id); return resultBase(stateFor(job, "runChildren", rows.isDone ? null : rows.continueCursor, { runId: state.runId, runChild: rows.isDone ? "attachments" : "events", runParentCursor: state.runParentCursor }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 }); }
  if (child === "attachments") { const rows = await ctx.db.query("spectraRunAttachments").withIndex("by_run_execution", (q) => q.eq("runId", runId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null }); let changed = 0; let retained = state.runRetained ? 1 : 0; let released = 0; for (const row of rows.page) { if (row.storageId) { const metadata = await ctx.db.system.get("_storage", row.storageId); const safe = metadata !== null && row.sha256 !== undefined && metadata.size === row.size && normalizeSha256(metadata.sha256) === normalizeSha256(row.sha256) && (!metadata.contentType || normalizeMediaType(metadata.contentType) === normalizeMediaType(row.mimeType)); if (!safe) { retained = 1; continue; } await ctx.storage.delete(row.storageId); released += metadata.size; if (job.schoolId) await recordMeterEvent(ctx, { schoolId: job.schoolId, accountId: job.ownerAccountId, category: "storage_bytes", quantity: -metadata.size, sourceType: "run_attachment_release", sourceId: String(row._id), idempotencyKey: `run-attachment-release:${String(row._id)}`, dimensions: { handling: row.handling }, occurredAt: Date.now() }); } await ctx.db.delete(row._id); changed++; } return resultBase(stateFor(job, "runChildren", rows.isDone ? null : rows.continueCursor, { runId: state.runId, runChild: rows.isDone ? "jobs" : "attachments", runParentCursor: state.runParentCursor, runRetained: retained > 0 }), { done: false, scanned: rows.page.length, changed, retained, terminal: 0, released }); }
  if (child === "jobs") { const rows = await ctx.db.query("spectraRunJobs").withIndex("by_run_execution", (q) => q.eq("runId", runId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null }); for (const row of rows.page) await ctx.db.delete(row._id); return resultBase(stateFor(job, "runChildren", rows.isDone ? null : rows.continueCursor, { runId: state.runId, runChild: rows.isDone ? "tabs" : "jobs", runParentCursor: state.runParentCursor }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 }); }
  const rows = await ctx.db.query("spectraRunTabs").withIndex("by_run", (q) => q.eq("runId", runId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null }); for (const row of rows.page) await ctx.db.delete(row._id);
  if (!rows.isDone) return resultBase(stateFor(job, "runChildren", rows.continueCursor, { runId: state.runId, runChild: "tabs", runParentCursor: state.runParentCursor }), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 });
  if (state.runRetained) return resultBase(stateFor(job, "runs", state.runParentCursor ?? null), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 1, terminal: 0, released: 0 });
  await ctx.db.delete(runId); return resultBase(stateFor(job, "runs", state.runParentCursor ?? null), { done: false, scanned: rows.page.length + 1, changed: rows.page.length + 1, retained: 0, terminal: 0, released: 0 });
}

async function processArtifactPage(ctx: MutationCtx, job: Job): Promise<PageResult> {
  const [pinnedEmbed, retainedAsset, retainedImport, retainedRuntime] = await Promise.all([
    ctx.db.query("artifactEmbeds").withIndex("by_source", (q) => q.eq("sourceArtifactId", job.artifactId)).filter((q) => q.and(q.eq(q.field("removedAt"), undefined), q.neq(q.field("pinnedVersionId"), undefined))).take(1),
    ctx.db.query("artifactAssets").withIndex("by_artifact_path", (q) => q.eq("artifactId", job.artifactId)).filter((q) => q.eq(q.field("retentionReason"), "legacy-reconciliation-required")).take(1),
    ctx.db.query("artifactImportJobs").withIndex("by_artifact", (q) => q.eq("artifactId", job.artifactId)).filter((q) => q.eq(q.field("retentionReason"), "legacy-reconciliation-required")).take(1),
    ctx.db.query("spectraRuntimeBuilds").withIndex("by_artifact_status", (q) => q.eq("artifactId", job.artifactId)).filter((q) => q.neq(q.field("storageId"), undefined)).take(1),
  ]);
  if (pinnedEmbed.length > 0 || retainedAsset.length > 0 || retainedImport.length > 0 || retainedRuntime.length > 0) {
    return resultBase(stateFor(job, "artifact", null), { done: true, scanned: 1, changed: 0, retained: 1, terminal: 0, released: 0 });
  }
  await ctx.db.delete(job.artifactId);
  return resultBase(stateFor(job, "complete", null), { done: true, scanned: 1, changed: 1, retained: 0, terminal: 0, released: 0 });
}

async function page(ctx: MutationCtx, job: Job, options: PageOptions = {}): Promise<PageResult> {
  const state = decode(job.cursor, job);
  switch (state.family) {
    case "embeds": return processEmbedPage(ctx, job, state);
    case "placements": return processPlacementPage(ctx, job, state);
    case "versions": return processVersionPage(ctx, job, state);
    case "intake": { const intake = await releaseArtifactIntakePage(ctx, { artifactId: job.artifactId, ownerAccountId: job.ownerAccountId, cursor: state.cursor ?? null }); return resultBase(stateFor(job, intake.done ? "runtime" : "intake", intake.done ? null : intake.cursor), { done: false, scanned: intake.deletedRows + intake.retainedRows, changed: intake.deletedRows, retained: intake.retainedRows, terminal: 0, released: intake.releasedBytes }); }
    case "runtime": return processRuntimePage(ctx, job, state);
    case "userStates": { const rows = await ctx.db.query("artifactUserStates").withIndex("by_artifact_updated", (q) => q.eq("artifactId", job.artifactId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null }); for (const row of rows.page) await ctx.db.delete(row._id); return resultBase(stateFor(job, rows.isDone ? "comments" : "userStates", rows.isDone ? null : rows.continueCursor), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 }); }
    case "comments": return processCommentsPage(ctx, job, state);
    case "commentPreferences": { const rows = await ctx.db.query("artifactCommentPreferences").withIndex("by_artifact_account", (q) => q.eq("artifactId", job.artifactId)).paginate({ numItems: PAGE, cursor: state.cursor ?? null }); for (const row of rows.page) await ctx.db.delete(row._id); return resultBase(stateFor(job, rows.isDone ? "memory" : "commentPreferences", rows.isDone ? null : rows.continueCursor), { done: false, scanned: rows.page.length, changed: rows.page.length, retained: 0, terminal: 0, released: 0 }); }
    case "memory": return processMemoryPage(ctx, job, state);
    case "links": return processLinksPage(ctx, job, state);
    case "replicas": return processReplicasPage(ctx, job, state);
    case "syncOperations": return processSyncOperationsPage(ctx, job, state);
    case "syncConflicts": return processSyncConflictsPage(ctx, job, state);
    case "requestsWrite": case "requestsFs": return processWriteRequestsPage(ctx, job, state, state.family, options);
    case "collaboration": return processCollaborationPage(ctx, job, state);
    case "runs": case "runChildren": return processRunPage(ctx, job, state);
    case "artifact": return processArtifactPage(ctx, job);
    default: return resultBase(stateFor(job, "complete", null), { done: true, scanned: 0, changed: 0, retained: 0, terminal: 0, released: 0 });
  }
}

export const dispatch = internalMutation({
  args: { jobId: v.id("artifactDeletionJobs"), generation: v.optional(v.number()), expectedPhase: v.optional(v.string()), expectedCursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.phase === "complete" || job.phase === "failed") return { started: false, terminal: true };
    if (args.generation !== undefined && args.generation !== job.generation) return { started: false, stale: true };
    if (args.expectedPhase !== undefined && args.expectedPhase !== job.phase) return { started: false, stale: true };
    if (args.expectedCursor !== undefined && args.expectedCursor !== job.cursor) return { started: false, stale: true };
    const artifact = await ctx.db.get(job.artifactId);
    if (!artifact || artifact.status !== "deleted" || artifact.deletionGeneration !== job.generation) return { started: false, stale: true };
    const now = Date.now();
    if (job.activeAttemptId && job.activeAttemptAt !== undefined && job.activeAttemptAt + DELETION_PAGE_TIMEOUT_MS > now) return { started: false, active: true };
    if (job.nextAttemptAt && job.nextAttemptAt > now) {
      await schedule(ctx, job._id, job.generation, job.nextAttemptAt - now, { phase: job.phase, cursor: job.cursor });
      return { started: false, deferred: true };
    }
    const attemptId = crypto.randomUUID();
    const attemptCount = (job.attemptCount ?? 0) + 1;
    await ctx.db.patch(job._id, { activeAttemptId: attemptId, activeAttemptAt: now, attemptCount, nextAttemptAt: now + DELETION_PAGE_TIMEOUT_MS, updatedAt: now });
    await queueDeletionProcess(ctx, job._id, job.generation, attemptId, { phase: job.phase, cursor: job.cursor });
    await queueDeletionRecovery(ctx, job._id, job.generation, attemptId, { phase: job.phase, cursor: job.cursor });
    return { started: true, attemptId };
  },
});

export const process = internalMutation({
  args: { jobId: v.id("artifactDeletionJobs"), generation: v.optional(v.number()), expectedPhase: v.optional(v.string()), expectedCursor: v.optional(v.string()), attemptId: v.optional(v.string()), testFailAfter: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.phase === "complete" || job.phase === "failed") return { complete: job?.phase === "complete", phase: job?.phase, terminal: true };
    if (args.generation !== undefined && args.generation !== job.generation) return { complete: false, stale: true };
    if (args.expectedPhase !== undefined && args.expectedPhase !== job.phase) return { complete: false, stale: true };
    if (args.expectedCursor !== undefined && args.expectedCursor !== job.cursor) return { complete: false, stale: true };
    if (args.attemptId !== undefined && job.activeAttemptId !== args.attemptId) return { complete: false, stale: true };
    const artifact = await ctx.db.get(job.artifactId);
    if (!artifact || artifact.status !== "deleted" || artifact.deletionGeneration !== job.generation) return { complete: false, stale: true };
    if (job.nextAttemptAt && job.nextAttemptAt > Date.now() && args.attemptId === undefined) return { complete: false, deferred: true };

    // This mutation deliberately has no catch block. Convex rolls back every
    // page write when a child operation fails; recover owns retry accounting.
    const result = await page(ctx, job, { testFailAfter: args.testFailAfter });
    const complete = result.done || result.state.family === "complete";
    const now = Date.now();
    const nextCursor = complete ? undefined : encode(result.state);
    const nextPhase = complete ? "complete" : result.state.family === "placements" ? "placements" : result.state.family === "artifact" ? "artifact" : "children";
    await ctx.db.patch(job._id, {
      phase: nextPhase,
      cursor: nextCursor,
      deletedRows: job.deletedRows + result.changed,
      releasedBytes: job.releasedBytes + result.released,
      scannedRows: (job.scannedRows ?? 0) + result.scanned,
      retainedRows: (job.retainedRows ?? 0) + result.retained,
      terminalRows: (job.terminalRows ?? 0) + result.terminal,
      attemptCount: 0,
      updatedAt: now,
      completedAt: complete ? now : undefined,
      nextAttemptAt: undefined,
      lastError: undefined,
      ...(args.attemptId !== undefined && job.activeAttemptId === args.attemptId ? { activeAttemptId: undefined, activeAttemptAt: undefined } : {}),
    });
    if (!complete) await schedule(ctx, job._id, job.generation, 25, { phase: nextPhase, cursor: nextCursor });
    return { complete, deletedRows: job.deletedRows + result.changed };
  },
});

export const recover = internalMutation({
  args: { jobId: v.id("artifactDeletionJobs"), generation: v.optional(v.number()), attemptId: v.string(), expectedPhase: v.optional(v.string()), expectedCursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.phase === "complete" || job.phase === "failed") return { recovered: false, terminal: true };
    if (args.generation !== undefined && args.generation !== job.generation) return { recovered: false, stale: true };
    if (args.expectedPhase !== undefined && args.expectedPhase !== job.phase) return { recovered: false, stale: true };
    if (args.expectedCursor !== undefined && args.expectedCursor !== job.cursor) return { recovered: false, stale: true };
    if (job.activeAttemptId !== args.attemptId) return { recovered: false, stale: true };
    if (job.activeAttemptAt !== undefined && job.activeAttemptAt + DELETION_PAGE_TIMEOUT_MS > Date.now()) {
      await queueDeletionRecovery(ctx, job._id, job.generation, args.attemptId, { phase: job.phase, cursor: job.cursor }, job.activeAttemptAt + DELETION_PAGE_TIMEOUT_MS - Date.now() + 1);
      return { recovered: false, deferred: true };
    }
    const attempts = job.attemptCount ?? 1;
    const retry = attempts < 6;
    const now = Date.now();
    const nextAttemptAt = retry ? now + Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 5)) : undefined;
    await ctx.db.patch(job._id, { activeAttemptId: undefined, activeAttemptAt: undefined, attemptCount: attempts, nextAttemptAt, lastError: "Deletion page timed out before commit.", phase: retry ? job.phase : "failed", updatedAt: now });
    if (retry) await schedule(ctx, job._id, job.generation, Math.max(0, nextAttemptAt! - Date.now()), { phase: job.phase, cursor: job.cursor });
    return { recovered: true, retry, retryAt: nextAttemptAt };
  },
});

export const retry = mutation({
  args: { jobId: v.id("artifactDeletionJobs") },
  handler: async (ctx, args) => { const current = await actor(ctx); const job = await ctx.db.get(args.jobId); if (!job || job.ownerAccountId !== current.accountId || job.schoolId !== current.schoolId) throw new Error("DELETION_NOT_FOUND"); if (job.phase !== "failed") return { scheduled: false, jobId: job._id }; const phase = job.cursor ? decode(job.cursor, job).family === "placements" ? "placements" : decode(job.cursor, job).family === "artifact" ? "artifact" : "children" : job.phase; await ctx.db.patch(job._id, { phase, nextAttemptAt: undefined, attemptCount: 0, activeAttemptId: undefined, activeAttemptAt: undefined, updatedAt: Date.now() }); await schedule(ctx, job._id, job.generation, 0, { phase, cursor: job.cursor }); return { scheduled: true, jobId: job._id }; },
});

export const status = query({
  args: { jobId: v.id("artifactDeletionJobs") },
  handler: async (ctx, args) => { const current = await actor(ctx); const job = await ctx.db.get(args.jobId); if (!job || job.ownerAccountId !== current.accountId || job.schoolId !== current.schoolId) throw new Error("DELETION_NOT_FOUND"); return job; },
});
