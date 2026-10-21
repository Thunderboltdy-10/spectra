/**
 * The semantic indexer: debounced queue dispatch, per-item re-index (embedding only changed
 * chunks), purge, and a resumable, rate-limited, idempotent backfill.
 *
 * Mutations here never do network work; `reindexItem` is the only action and it embeds through
 * ./embeddingProvider. A provider outage keeps full-text chunks current and retries vectors later.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { embeddingConfig, embeddingVersion, requestEmbeddings, validEmbeddingVector } from "./embeddingProvider";
import { enqueueClaimEmbedding } from "./memory";
import { lexicalKeysFor, vectorKeysFor, vSemanticKind } from "./semanticKeys";
import { enqueueSemanticItem } from "./semanticQueue";
import { loadSourceDoc, sourceFor, sourceIndexable, type DurableContent, type LoadedSource } from "./semanticSources";
import { chunkDrafts, finalizeChunks, sha256Hex } from "../shared/semantic-chunks";
import { centroid } from "../shared/semantic-ranking";
import { INDEXED_SEMANTIC_KINDS, type IndexedSemanticKind } from "../shared/semantic-types";
import { platformStopped } from "./platformControls";

const CONCURRENCY = 4;
const LEASE_MS = 3 * 60_000;
const APPLY_PAGE = 48;
const MAX_ATTEMPTS = 6;
/** Chunk rows read per item; above MAX_CHUNKS_PER_ITEM so stale rows are always seen. */
const MAX_STORED_CHUNKS = 400;
const BACKFILL_MAX_WAITING = 200;
const BACKFILL_STEP_MS = 2_000;
const BACKFILL_FULL_QUEUE_MS = 30_000;
const RECOVER_PAGE = 25;
const RECOVER_AFTER_MS = 30 * 60_000;
const DISPATCH_SLACK_MS = 1_000;

const vKind = vSemanticKind;

// ---------------------------------------------------------------------------------------------
// Dispatch

export const dispatch = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ started: number }> => {
    const now = Date.now();
    const active = await ctx.db.query("semanticIndexQueue")
      .withIndex("by_status_due", (q) => q.eq("status", "running").gt("dueAt", now)).take(CONCURRENCY);
    let capacity = CONCURRENCY - active.length;
    let started = 0;
    if (capacity > 0) {
      // Expired leases first: their actions died, and the rows are the oldest work.
      const expired = await ctx.db.query("semanticIndexQueue")
        .withIndex("by_status_due", (q) => q.eq("status", "running").lte("dueAt", now)).take(capacity);
      const due = await ctx.db.query("semanticIndexQueue")
        .withIndex("by_status_due", (q) => q.eq("status", "waiting").lte("dueAt", now)).take(capacity);
      for (const row of [...expired, ...due].slice(0, capacity)) {
        const leaseOwner = crypto.randomUUID();
        await ctx.db.patch(row._id, { status: "running", leaseOwner, dueAt: now + LEASE_MS });
        await ctx.scheduler.runAfter(0, internal.semanticIndex.reindexItem, { queueId: row._id, leaseOwner });
        started += 1;
        capacity -= 1;
      }
    }
    const next = await ctx.db.query("semanticIndexQueue")
      .withIndex("by_status_due", (q) => q.eq("status", "waiting")).first();
    const nextRun = next ? Math.max(next.dueAt, now + (capacity > 0 ? 250 : 2_000)) : undefined;
    await scheduleNext(ctx, nextRun);
    return { started };
  },
});

async function scheduleNext(ctx: MutationCtx, at: number | undefined) {
  if (at === undefined) return;
  const now = Date.now();
  const marker = await ctx.db.query("semanticDispatcher").first();
  // Trust the marker only for a dispatch clearly in the future: one due about now may be the
  // dispatch that is running (scheduled functions can start a little before their clock time),
  // and a duplicate dispatch is harmless because jobs are leased.
  if (marker && marker.scheduledFor > now + DISPATCH_SLACK_MS && marker.scheduledFor <= at) return;
  if (marker) await ctx.db.patch(marker._id, { scheduledFor: at });
  else await ctx.db.insert("semanticDispatcher", { scheduledFor: at });
  await ctx.scheduler.runAfter(Math.max(0, at - now), internal.semanticIndex.dispatch, {});
}

async function leasedRow(ctx: { db: MutationCtx["db"] } | { db: QueryCtx["db"] },
  queueId: Id<"semanticIndexQueue">, leaseOwner: string) {
  const row = await ctx.db.get(queueId);
  return row && row.status === "running" && row.leaseOwner === leaseOwner ? row : null;
}

// ---------------------------------------------------------------------------------------------
// Source loading (through the registry in ./semanticSources)

type ExistingChunk = { chunkKey: string; contentHash: string; embeddingVersion?: string; hasEmbedding: boolean };
type SourcePayload =
  | { exists: false }
  | (LoadedSource & { exists: true; existing: ExistingChunk[] });

export const leasedJob = internalQuery({
  args: { queueId: v.id("semanticIndexQueue"), leaseOwner: v.string() },
  handler: async (ctx, args) => {
    const row = await leasedRow(ctx, args.queueId, args.leaseOwner);
    return row ? { kind: row.itemKind, itemId: row.itemId } : null;
  },
});

export const loadSource = internalQuery({
  args: { kind: vKind, itemId: v.string() },
  handler: async (ctx, { kind, itemId }): Promise<SourcePayload> => {
    const source = sourceFor(kind);
    const doc = await loadSourceDoc(ctx, kind, itemId);
    if (!doc || !(await sourceIndexable(ctx, kind, doc))) return { exists: false };
    const loaded = await source.load(ctx, doc);
    const existing = (await ctx.db.query("semanticChunks")
      .withIndex("by_item", (q) => q.eq("itemKind", kind).eq("itemId", itemId)).take(MAX_STORED_CHUNKS))
      .map((chunk) => ({ chunkKey: chunk.chunkKey, contentHash: chunk.contentHash, embeddingVersion: chunk.embeddingVersion,
        hasEmbedding: Boolean(chunk.embedding) }));
    return { ...loaded, exists: true, existing };
  },
});

async function resolveDurable(ctx: ActionCtx, durable: DurableContent) {
  const blob = await ctx.storage.get(durable.storageId);
  if (!blob || blob.size !== durable.byteLength) return undefined;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== durable.digest) return undefined;
  const body = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  return durable.path === "content" ? body.content : body;
}

// ---------------------------------------------------------------------------------------------
// Re-index one item

const vChunk = v.object({
  chunkKey: v.string(), ordinal: v.number(), label: v.optional(v.string()), regionId: v.optional(v.string()),
  messageId: v.optional(v.string()), ownerOnly: v.optional(v.boolean()), text: v.string(), searchText: v.string(), contentHash: v.string(),
  /** New vector for a changed chunk; absent keeps the stored vector when the hash is unchanged. */
  embedding: v.optional(v.array(v.float64())),
});
const vScope = v.object({
  ownerAccountId: v.optional(v.id("accounts")), schoolId: v.optional(v.id("schools")),
  workspaceKeys: v.array(v.string()), audienceKey: v.optional(v.string()), grantable: v.optional(v.boolean()),
});

export const reindexItem = internalAction({
  args: { queueId: v.id("semanticIndexQueue"), leaseOwner: v.string() },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const job = await ctx.runQuery(internal.semanticIndex.leasedJob, args);
    if (!job) return { status: "lease_lost" };
    const source = await ctx.runQuery(internal.semanticIndex.loadSource, job);
    if (!source.exists) {
      await ctx.runMutation(internal.semanticIndex.purgeItem, { ...args, kind: job.kind, itemId: job.itemId });
      return { status: "purged" };
    }
    let input = source.input;
    if (source.durable && input.builder === "artifact")
      input = { ...input, content: await resolveDurable(ctx, source.durable).catch(() => undefined) };
    const chunks = await finalizeChunks(source.title, chunkDrafts(input));
    const config = embeddingConfig();
    const existing = new Map(source.existing.map((chunk) => [chunk.chunkKey, chunk]));
    const stale = chunks.filter((chunk) => {
      const stored = existing.get(chunk.chunkKey);
      return !config || !stored || stored.contentHash !== chunk.contentHash || stored.embeddingVersion !== config.version || !stored.hasEmbedding;
    });
    const vectors = new Map<string, number[]>();
    let failure: { code: string; retryable: boolean } | undefined;
    if (config && stale.length) {
      const result = await requestEmbeddings(stale.map((chunk) => chunk.embedText), { attempts: 2, retryTimeouts: true, timeoutMs: 20_000 });
      if (result.ok) stale.forEach((chunk, index) => vectors.set(chunk.chunkKey, result.vectors[index]!));
      else failure = { code: result.code, retryable: result.retryable };
    }
    for (let start = 0; start < chunks.length; start += APPLY_PAGE) {
      const page = chunks.slice(start, start + APPLY_PAGE).map((chunk) => ({
        chunkKey: chunk.chunkKey, ordinal: chunk.ordinal, label: chunk.label, regionId: chunk.regionId, messageId: chunk.messageId,
        ownerOnly: chunk.ownerOnly, text: chunk.text, searchText: chunk.searchText, contentHash: chunk.contentHash,
        embedding: vectors.get(chunk.chunkKey),
      }));
      const applied = await ctx.runMutation(internal.semanticIndex.applyChunks, { ...args, kind: job.kind, itemId: job.itemId,
        title: source.title, scope: source.scope, embeddingVersion: config?.version, chunks: page });
      if (!applied) return { status: "lease_lost" };
    }
    await ctx.runMutation(internal.semanticIndex.finalizeItem, { ...args, kind: job.kind, itemId: job.itemId,
      title: source.title, subtype: source.subtype, scope: source.scope, lineageIds: source.lineageIds.slice(0, 50),
      workspaceId: source.workspaceId, timeAt: source.timeAt, mirrors: source.mirrors,
      sourceUpdatedAt: source.sourceUpdatedAt, keepKeys: chunks.map((chunk) => chunk.chunkKey),
      // The body without the title, so a renamed copy ("Notes (copy)") is still recognised as a copy.
      contentDigest: (await sha256Hex(chunks.map((chunk) => `${chunk.label ?? ""}\n${chunk.text}`).join("\u0000"))).slice(0, 32),
      embeddingState: !config ? "disabled" : failure ? "pending" : "complete", failure });
    return { status: failure ? `embedding_${failure.code}` : "indexed" };
  },
});

export const applyChunks = internalMutation({
  args: { queueId: v.id("semanticIndexQueue"), leaseOwner: v.string(), kind: vKind, itemId: v.string(), title: v.string(),
    scope: vScope, embeddingVersion: v.optional(v.string()), chunks: v.array(vChunk) },
  handler: async (ctx, args): Promise<boolean> => {
    if (!(await leasedRow(ctx, args.queueId, args.leaseOwner))) return false;
    const now = Date.now();
    const title = args.title.slice(0, 300);
    for (const chunk of args.chunks) {
      const stored = await ctx.db.query("semanticChunks")
        .withIndex("by_item", (q) => q.eq("itemKind", args.kind).eq("itemId", args.itemId).eq("chunkKey", chunk.chunkKey)).unique();
      const freshVector = chunk.embedding && validEmbeddingVector(chunk.embedding) ? chunk.embedding : undefined;
      const keepVector = !freshVector && stored?.contentHash === chunk.contentHash && stored.embedding && stored.embeddingVersion === args.embeddingVersion
        ? stored.embedding : undefined;
      const embedding = freshVector ?? keepVector;
      const version = embedding ? args.embeddingVersion : undefined;
      const ownerOnly = chunk.ownerOnly ? true : undefined;
      const fields = { title, ...lexicalKeysFor(args.scope, ownerOnly), ownerOnly, ordinal: chunk.ordinal, label: chunk.label,
        regionId: chunk.regionId, messageId: chunk.messageId, text: chunk.text, searchText: chunk.searchText,
        contentHash: chunk.contentHash, embedding, embeddingVersion: version,
        ...vectorKeysFor(version, args.kind, args.itemId, args.scope, ownerOnly) };
      if (!stored) {
        await ctx.db.insert("semanticChunks", { itemKind: args.kind, itemId: args.itemId, chunkKey: chunk.chunkKey, ...fields, updatedAt: now });
        continue;
      }
      const { embedding: storedEmbedding, ...storedRest } = stored;
      const { embedding: nextEmbedding, ...nextRest } = fields;
      const same = storedEmbedding === nextEmbedding &&
        (Object.keys(nextRest) as Array<keyof typeof nextRest>).every((key) => storedRest[key] === nextRest[key]);
      if (!same) await ctx.db.patch(stored._id, { ...fields, updatedAt: now });
    }
    return true;
  },
});

export const finalizeItem = internalMutation({
  args: { queueId: v.id("semanticIndexQueue"), leaseOwner: v.string(), kind: vKind, itemId: v.string(), title: v.string(),
    subtype: v.optional(v.string()), scope: vScope, lineageIds: v.array(v.string()), sourceUpdatedAt: v.number(),
    workspaceId: v.optional(v.id("spectraWorkspaces")), timeAt: v.optional(v.number()), mirrors: v.optional(v.string()),
    keepKeys: v.array(v.string()), contentDigest: v.string(),
    embeddingState: v.union(v.literal("complete"), v.literal("pending"), v.literal("disabled")),
    failure: v.optional(v.object({ code: v.string(), retryable: v.boolean() })) },
  handler: async (ctx, args): Promise<void> => {
    const row = await leasedRow(ctx, args.queueId, args.leaseOwner);
    if (!row) return;
    const now = Date.now();
    const keep = new Set(args.keepKeys);
    const chunks = await ctx.db.query("semanticChunks").withIndex("by_item", (q) => q.eq("itemKind", args.kind).eq("itemId", args.itemId))
      .take(MAX_STORED_CHUNKS);
    const version = embeddingVersion();
    const vectors: number[][] = [];
    for (const chunk of chunks) {
      if (!keep.has(chunk.chunkKey)) await ctx.db.delete(chunk._id);
      else if (chunk.embedding && chunk.embeddingVersion === version) vectors.push(chunk.embedding);
    }
    const complete = args.embeddingState === "complete" && vectors.length === args.keepKeys.length;
    const itemCentroid = version && vectors.length ? centroid(vectors) : undefined;
    const fields = { schoolId: args.scope.schoolId, ownerAccountId: args.scope.ownerAccountId, title: args.title.slice(0, 300),
      subtype: args.subtype, contentDigest: args.contentDigest, lineageIds: args.lineageIds, sourceUpdatedAt: args.sourceUpdatedAt,
      workspaceId: args.workspaceId, timeAt: args.timeAt, mirrors: args.mirrors,
      indexedAt: now, chunkCount: args.keepKeys.length, embeddingVersion: itemCentroid ? version! : undefined,
      embeddingState: args.embeddingState === "disabled" ? "disabled" as const : complete ? "complete" as const : "pending" as const,
      centroid: itemCentroid, ...vectorKeysFor(itemCentroid ? version! : undefined, args.kind, args.itemId, args.scope) };
    const item = await ctx.db.query("semanticItems").withIndex("by_item", (q) => q.eq("itemKind", args.kind).eq("itemId", args.itemId)).unique();
    if (item) await ctx.db.patch(item._id, fields);
    else await ctx.db.insert("semanticItems", { itemKind: args.kind, itemId: args.itemId, ...fields });
    if (row.rerun) {
      await ctx.db.patch(row._id, { status: "waiting", rerun: false, leaseOwner: undefined, attempts: 0, dueAt: now + 2_000,
        firstQueuedAt: now, lastTouchedAt: now });
    } else if (args.failure?.retryable && row.attempts + 1 < MAX_ATTEMPTS) {
      const backoff = Math.min(30 * 60_000, 30_000 * 2 ** row.attempts);
      await ctx.db.patch(row._id, { status: "waiting", leaseOwner: undefined, attempts: row.attempts + 1, dueAt: now + backoff,
        firstQueuedAt: now, lastTouchedAt: now });
    } else await ctx.db.delete(row._id);
    await scheduleNext(ctx, now);
  },
});

export const purgeItem = internalMutation({
  args: { queueId: v.id("semanticIndexQueue"), leaseOwner: v.string(), kind: vKind, itemId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const row = await leasedRow(ctx, args.queueId, args.leaseOwner);
    if (!row) return;
    await purgeItemRows(ctx, args.kind, args.itemId);
    if (row.rerun) await ctx.db.patch(row._id, { status: "waiting", rerun: false, leaseOwner: undefined, dueAt: Date.now() });
    else await ctx.db.delete(row._id);
    await scheduleNext(ctx, Date.now());
  },
});

export async function purgeItemRows(ctx: MutationCtx, kind: IndexedSemanticKind, itemId: string) {
  for (const chunk of await ctx.db.query("semanticChunks").withIndex("by_item", (q) => q.eq("itemKind", kind).eq("itemId", itemId)).take(MAX_STORED_CHUNKS))
    await ctx.db.delete(chunk._id);
  const item = await ctx.db.query("semanticItems").withIndex("by_item", (q) => q.eq("itemKind", kind).eq("itemId", itemId)).unique();
  if (item) await ctx.db.delete(item._id);
}

// ---------------------------------------------------------------------------------------------
// Backfill: `npx convex run semanticIndex:startBackfill` (resumable, rate-limited, idempotent).
// Phases: every registered kind, then a sweep of index rows whose source vanished, then memory
// claims that lack a current-version vector.

const PHASES = [...INDEXED_SEMANTIC_KINDS, "sweep", "memory", "done"] as const;
type Phase = (typeof PHASES)[number];
const MEMORY_PAGE = 40;

export const startBackfill = internalMutation({
  args: { pageSize: v.optional(v.number()), restart: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ backfillId: Id<"semanticBackfills">; resumed: boolean }> => {
    const now = Date.now();
    const current = await ctx.db.query("semanticBackfills").withIndex("by_started").order("desc").first();
    if (current && current.phase !== "done" && !args.restart) {
      await ctx.scheduler.runAfter(0, internal.semanticIndex.backfillStep, { backfillId: current._id });
      return { backfillId: current._id, resumed: true };
    }
    const backfillId = await ctx.db.insert("semanticBackfills", { phase: PHASES[0], pageSize: Math.max(10, Math.min(200, args.pageSize ?? 100)),
      scanned: 0, enqueued: 0, startedAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.semanticIndex.backfillStep, { backfillId });
    return { backfillId, resumed: false };
  },
});

/** `npx convex run semanticIndex:backfillStatus` */
export const backfillStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const current = await ctx.db.query("semanticBackfills").withIndex("by_started").order("desc").first();
    const waiting = await ctx.db.query("semanticIndexQueue").withIndex("by_status_due", (q) => q.eq("status", "waiting")).take(1_000);
    const running = await ctx.db.query("semanticIndexQueue").withIndex("by_status_due", (q) => q.eq("status", "running")).take(100);
    const pending = await ctx.db.query("semanticItems").withIndex("by_state", (q) => q.eq("embeddingState", "pending")).take(1_000);
    return { backfill: current, waiting: waiting.length, running: running.length, pendingVectors: pending.length,
      embeddingVersion: embeddingVersion() };
  },
});

function upToDate(item: Doc<"semanticItems"> | null, sourceUpdatedAt: number, version: string | null) {
  return Boolean(item && item.sourceUpdatedAt >= sourceUpdatedAt &&
    (version ? item.embeddingState === "complete" && item.embeddingVersion === version : item.embeddingState === "disabled"));
}

export const backfillStep = internalMutation({
  args: { backfillId: v.id("semanticBackfills") },
  handler: async (ctx, args): Promise<{ phase: string; scanned: number; enqueued: number }> => {
    const state = await ctx.db.get(args.backfillId);
    if (!state || state.phase === "done") return { phase: "done", scanned: 0, enqueued: 0 };
    const phase = state.phase as Phase;
    const now = Date.now();
    const waiting = await ctx.db.query("semanticIndexQueue").withIndex("by_status_due", (q) => q.eq("status", "waiting")).take(BACKFILL_MAX_WAITING);
    if (waiting.length >= BACKFILL_MAX_WAITING) {
      await ctx.scheduler.runAfter(BACKFILL_FULL_QUEUE_MS, internal.semanticIndex.backfillStep, args);
      return { phase, scanned: 0, enqueued: 0 };
    }
    const version = embeddingVersion();
    const page = { cursor: state.cursor ?? null, numItems: phase === "memory" ? MEMORY_PAGE : state.pageSize };
    let scanned = 0;
    let enqueued = 0;
    let result: { continueCursor: string; isDone: boolean };
    if (phase === "sweep") {
      // Index rows whose source vanished without a trigger (physical deletes, retention).
      const rows = await ctx.db.query("semanticItems").paginate(page);
      for (const item of rows.page) {
        scanned += 1;
        const doc = await loadSourceDoc(ctx, item.itemKind, item.itemId);
        if (!doc || !(await sourceIndexable(ctx, item.itemKind, doc))) {
          await enqueueSemanticItem(ctx, item.itemKind, item.itemId, { immediate: true });
          enqueued += 1;
        }
      }
      result = rows;
    } else if (phase === "memory") {
      const rows = await ctx.db.query("memoryClaims").withIndex("by_status_updated", (q) => q.eq("status", "active")).paginate(page);
      for (const claim of rows.page) {
        scanned += 1;
        if (await enqueueClaimEmbedding(ctx, claim, false, false)) enqueued += 1;
      }
      if (enqueued) await ctx.scheduler.runAfter(0, internal.memory.dispatchEmbeddings, {});
      result = rows;
    } else if (phase === "done") {
      return { phase, scanned: 0, enqueued: 0 };
    } else {
      const source = sourceFor(phase);
      const rows = await ctx.db.query(source.table).paginate(page);
      for (const doc of rows.page) {
        scanned += 1;
        const itemId = String(doc._id);
        const item = await ctx.db.query("semanticItems").withIndex("by_item", (q) => q.eq("itemKind", phase).eq("itemId", itemId)).unique();
        if (source.indexable(doc) ? upToDate(item, source.updatedAt(doc), version) : !item) continue;
        await enqueueSemanticItem(ctx, phase, itemId, { schoolId: source.schoolId(doc) });
        enqueued += 1;
      }
      result = rows;
    }
    const nextPhase = result.isDone ? PHASES[PHASES.indexOf(phase) + 1]! : phase;
    await ctx.db.patch(state._id, { phase: nextPhase, cursor: result.isDone ? undefined : result.continueCursor,
      scanned: state.scanned + scanned, enqueued: state.enqueued + enqueued, updatedAt: now,
      ...(nextPhase === "done" ? { finishedAt: now } : {}) });
    if (nextPhase !== "done") await ctx.scheduler.runAfter(BACKFILL_STEP_MS, internal.semanticIndex.backfillStep, args);
    return { phase: nextPhase, scanned, enqueued };
  },
});

// ---------------------------------------------------------------------------------------------
// Maintenance cron: recover lost dispatches and expired leases, drop expired Related rows.

export const maintain = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ expiredRelated: number; recovered: number }> => {
    if (await platformStopped(ctx, "background")) return { expiredRelated: 0, recovered: 0 };
    const now = Date.now();
    const expired = await ctx.db.query("semanticRelatedCache").withIndex("by_expires", (q) => q.lte("expiresAt", now)).take(256);
    for (const row of expired) await ctx.db.delete(row._id);
    const due = await ctx.db.query("semanticIndexQueue").withIndex("by_status_due", (q) => q.eq("status", "waiting").lte("dueAt", now)).first() ??
      await ctx.db.query("semanticIndexQueue").withIndex("by_status_due", (q) => q.eq("status", "running").lte("dueAt", now)).first();
    if (due) await ctx.scheduler.runAfter(0, internal.semanticIndex.dispatch, {});
    // Items whose vectors failed through every retry (a long outage) try again, a page at a time.
    const stalled = await ctx.db.query("semanticItems")
      .withIndex("by_state", (q) => q.eq("embeddingState", "pending").lte("indexedAt", now - RECOVER_AFTER_MS)).take(RECOVER_PAGE);
    let recovered = 0;
    for (const item of stalled) {
      const queued = await ctx.db.query("semanticIndexQueue")
        .withIndex("by_item", (q) => q.eq("itemKind", item.itemKind).eq("itemId", item.itemId)).unique();
      if (queued) continue;
      await enqueueSemanticItem(ctx, item.itemKind, item.itemId, { schoolId: item.schoolId });
      recovered += 1;
    }
    return { expiredRelated: expired.length, recovered };
  },
});
