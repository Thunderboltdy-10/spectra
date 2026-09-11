import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { recordMeterEvent } from "./metering";

const LIVE_REQUEST_STATES = ["pending", "claimed"] as const;
const LIVE_CONFLICT_STATES = ["open", "resolving-spectra"] as const;

/**
 * Release a payload only after the row that held the caller's reference has
 * been removed. Every remaining-reference probe is indexed and bounded. The
 * helper is intentionally idempotent: a retry sees either another reference
 * or the terminal `released` state and performs no second storage delete.
 */
export async function releasePayloadIfUnreferenced(
  ctx: MutationCtx,
  payloadRef: string | undefined,
  options: {
    schoolId?: Id<"schools">;
    accountId?: Id<"accounts">;
    sourceId?: string;
  } = {},
) {
  if (!payloadRef) return 0;
  const payloadId = ctx.db.normalizeId("payloadObjects", payloadRef);
  if (!payloadId) return 0;
  const payload = await ctx.db.get(payloadId);
  if (!payload || payload.state !== "active") return 0;

  const [replica, pendingReplica, projectionReplica, pendingWork, writeRefs, fsRefs, localConflicts, spectraConflicts] = await Promise.all([
    ctx.db.query("workReplicas").withIndex("by_payload_ref", (q) => q.eq("payloadRef", payloadRef)).take(1),
    ctx.db.query("workReplicas").withIndex("by_pending_payload_ref", (q) => q.eq("pendingPayloadRef", payloadRef)).take(1),
    ctx.db.query("workReplicas").withIndex("by_projection_base_payload_ref", (q) => q.eq("projectionBasePayloadRef", payloadRef)).take(1),
    ctx.db.query("spectraArtifacts").withIndex("by_pending_payload_ref", (q) => q.eq("pendingPayloadRef", payloadRef)).take(1),
    ctx.db.query("bridgeWriteRequests").withIndex("by_payload_state", (q) => q.eq("payloadRef", payloadRef).eq("state", LIVE_REQUEST_STATES[0])).take(1),
    ctx.db.query("bridgeWriteRequests").withIndex("by_payload_state", (q) => q.eq("payloadRef", payloadRef).eq("state", LIVE_REQUEST_STATES[1])).take(1),
    ctx.db.query("syncConflicts").withIndex("by_local_payload_ref", (q) => q.eq("localPayloadRef", payloadRef)).filter((q) => q.or(q.eq(q.field("state"), LIVE_CONFLICT_STATES[0]), q.eq(q.field("state"), LIVE_CONFLICT_STATES[1]))).take(1),
    ctx.db.query("syncConflicts").withIndex("by_spectra_payload_ref", (q) => q.eq("spectraPayloadRef", payloadRef)).filter((q) => q.or(q.eq(q.field("state"), LIVE_CONFLICT_STATES[0]), q.eq(q.field("state"), LIVE_CONFLICT_STATES[1]))).take(1),
  ]);
  if ([replica, pendingReplica, projectionReplica, pendingWork, writeRefs, fsRefs, localConflicts, spectraConflicts].some((rows) => rows.length > 0)) return 0;

  const now = Date.now();
  await ctx.storage.delete(payload.storageId);
  await ctx.db.patch(payload._id, { refCount: 0, state: "released", releasedAt: now });
  if (options.schoolId && payload.bytes > 0) {
    await recordMeterEvent(ctx, {
      schoolId: options.schoolId,
      accountId: options.accountId ?? payload.accountId,
      category: "storage_bytes",
      quantity: -payload.bytes,
      sourceType: "payload_release",
      sourceId: options.sourceId ?? String(payload._id),
      idempotencyKey: `payload-release:${String(payload._id)}`,
      dimensions: { reason: "artifact-deletion" },
      occurredAt: now,
    });
  }
  return payload.bytes;
}
