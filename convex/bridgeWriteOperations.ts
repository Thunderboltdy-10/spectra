import type { Doc } from "./_generated/dataModel";
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
