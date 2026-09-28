import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type BridgeWriteRequest = Doc<"bridgeWriteRequests">;
type SyncOperation = Doc<"syncOperations">;
type ReplicaTruthCtx = MutationCtx | QueryCtx;

/** Resolve legacy writes by their concrete replica when old keys collide. */
export async function syncOperationForBridgeWrite(
  ctx: ReplicaTruthCtx,
  request: BridgeWriteRequest,
): Promise<SyncOperation | null> {
  const candidates = await ctx.db
    .query("syncOperations")
    .withIndex("by_account_key_replica", (q) =>
      q
        .eq("accountId", request.accountId)
        .eq("idempotencyKey", request.idempotencyKey)
        .eq("replicaId", request.replicaId),
    )
    .order("desc")
    .take(20);
  const sameWrite = (operation: SyncOperation) =>
    operation.workId === request.workId &&
    operation.direction === "cloud-to-local";
  const exact = candidates.filter(
    (operation) =>
      sameWrite(operation) &&
      operation.revisionBefore === request.baseRevision &&
      operation.revisionAfter === request.targetRevision,
  );
  // Older operations predate revision tracking. Match those only when both
  // revisions are absent; partially populated or conflicting revisions must
  // never be treated as this write.
  const legacy = candidates.filter(
    (operation) =>
      sameWrite(operation) &&
      operation.revisionBefore === undefined &&
      operation.revisionAfter === undefined,
  );
  const active = (matches: SyncOperation[]) => matches.find((operation) =>
    operation.state === "pending" || operation.state === "applied",
  );
  return active(exact) ?? exact[0] ?? active(legacy) ?? legacy[0] ?? null;
}

export async function bridgeWriteForSyncOperation(
  ctx: ReplicaTruthCtx,
  operation: SyncOperation,
): Promise<BridgeWriteRequest | null> {
  if (!operation.replicaId) return null;
  const candidates = await ctx.db
    .query("bridgeWriteRequests")
    .withIndex("by_account_key_replica", (q) =>
      q
        .eq("accountId", operation.accountId)
        .eq("idempotencyKey", operation.idempotencyKey)
        .eq("replicaId", operation.replicaId!),
    )
    .order("desc")
    .take(20);
  return candidates.find(
    (request) =>
      request.workId === operation.workId &&
      request.baseRevision === operation.revisionBefore &&
      request.targetRevision === operation.revisionAfter,
  ) ?? null;
}

export async function bridgeWriteForTarget(
  ctx: ReplicaTruthCtx,
  target: {
    accountId: BridgeWriteRequest["accountId"];
    idempotencyKey: string;
    replicaId: BridgeWriteRequest["replicaId"];
    workId: BridgeWriteRequest["workId"];
    baseRevision: string;
    targetRevision: string;
  },
): Promise<BridgeWriteRequest | null> {
  const candidates = await ctx.db
    .query("bridgeWriteRequests")
    .withIndex("by_account_key_replica", (q) =>
      q
        .eq("accountId", target.accountId)
        .eq("idempotencyKey", target.idempotencyKey)
        .eq("replicaId", target.replicaId),
    )
    .order("desc")
    .take(20);
  return candidates.find(
    (request) =>
      request.workId === target.workId &&
      request.baseRevision === target.baseRevision &&
      request.targetRevision === target.targetRevision,
  ) ?? null;
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key] : undefined;
}

/** The local-file write an AI operation queued for the Bridge, read from its
 * admission receipt. Cloud-only native saves and unchanged files queue none. */
export function queuedLocalWrite(output: unknown): { requestId: string; state: string } | null {
  const native = field(field(field(field(output, "artifactWriteReceipt"), "result"), "receipt"), "nativeResult");
  const requestId = field(native, "requestId");
  const state = field(native, "state");
  return typeof requestId === "string" && requestId !== "protected-original" && typeof state === "string"
    ? { requestId, state } : null;
}

export type RunNativeSyncOutcome = "native_pending" | "native_verified" | "native_superseded";

/** Error codes the Bridge write paths use when a newer edit retired a queued
 * write before read-back. The retired write will never be verified. */
export const SUPERSEDED_WRITE_CODES: ReadonlySet<string> = new Set([
  "superseded-by-newer-cloud-revision",
  "external-save-during-write",
  "superseded-by-newer-write",
]);

function supersededWrite(request: BridgeWriteRequest | null) {
  return request?.state === "failed" && SUPERSEDED_WRITE_CODES.has(request.errorCode ?? "");
}

/** Native truth for a run: verified only once Bridge read-back verified the
 * newest write this run queued for every local file; queued otherwise. A later
 * write from the same run supersedes an earlier one because it contains it.
 * When a newer edit from elsewhere retired the run's newest write before
 * read-back, nothing will ever confirm it: that is settled, not queued. */
export async function runNativeSyncOutcome(
  ctx: ReplicaTruthCtx,
  runId: Id<"spectraAiRuns">,
): Promise<RunNativeSyncOutcome | undefined> {
  const operations = await ctx.db.query("spectraOperations")
    .withIndex("by_run", (q) => q.eq("runId", runId)).collect();
  const newestByFile = new Map<string, BridgeWriteRequest | null>();
  for (const operation of operations) {
    const queued = queuedLocalWrite(operation.output);
    if (!queued) continue;
    const requestId = ctx.db.normalizeId("bridgeWriteRequests", queued.requestId);
    const request = requestId ? await ctx.db.get(requestId) : null;
    const file = request ? String(request.replicaId) : `missing:${queued.requestId}`;
    const prior = newestByFile.get(file);
    if (prior === undefined || (request && prior && request.createdAt > prior.createdAt)) newestByFile.set(file, request);
  }
  if (!newestByFile.size) return undefined;
  const newest = [...newestByFile.values()];
  if (newest.every((request) => request?.state === "verified")) return "native_verified";
  if (newest.every((request) => request?.state === "verified" || supersededWrite(request))) return "native_superseded";
  return "native_pending";
}

/** Bridge read-back (or a newer edit retiring the write) can finish after the
 * run did. Move a completed run off queued only once every file it wrote is
 * verified or retired. */
export async function settleRunNativeOutcome(ctx: MutationCtx, runId: Id<"spectraAiRuns">) {
  const run = await ctx.db.get(runId);
  if (run?.status !== "completed" || run.outcome !== "native_pending") return;
  const outcome = await runNativeSyncOutcome(ctx, runId);
  if (outcome && outcome !== run.outcome) await ctx.db.patch(runId, { outcome });
}
