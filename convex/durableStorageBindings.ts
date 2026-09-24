import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Context = MutationCtx | QueryCtx;

async function intakeBinding(ctx: Context, storageId: Id<"_storage">) {
  const rows = await Promise.all([
    ctx.db.query("artifactAssets").withIndex("by_storage", q => q.eq("storageId", storageId)).first(),
    ctx.db.query("artifactAssets").withIndex("by_candidate_storage", q => q.eq("candidateStorageId", storageId)).first(),
    ctx.db.query("artifactImportJobs").withIndex("by_storage", q => q.eq("originalStorageId", storageId)).first(),
    ctx.db.query("artifactImportJobs").withIndex("by_candidate_storage", q => q.eq("candidateStorageId", storageId)).first(),
  ]);
  return rows.some(Boolean);
}

/** New durable bodies must be server-created, separate from native/intake blobs.
 * Permit an exact same-owner retry; never rebind another artifact's bytes. */
export async function assertExclusiveDurableStorage(ctx: Context, storageId: Id<"_storage">,
  artifactId: Id<"spectraArtifacts">, accountId: Id<"accounts">) {
  const foreign = await ctx.db.query("collaborationDurablePayloads")
    .withIndex("by_storage", q => q.eq("storageId", storageId))
    .filter(q => q.or(q.neq(q.field("artifactId"), artifactId), q.neq(q.field("accountId"), accountId))).first();
  const native = await ctx.db.query("payloadObjects").withIndex("by_storage", q => q.eq("storageId", storageId)).first();
  if (foreign || native || await intakeBinding(ctx, storageId) ||
    await ctx.db.query("spectraRuntimeBuilds").withIndex("by_storage", q => q.eq("storageId", storageId)).first() ||
    await ctx.db.query("spectraRunAttachments").withIndex("by_storage", q => q.eq("storageId", storageId)).first()) throw new Error("COLLABORATION_DURABLE_STORAGE_OWNERSHIP");
}

/** Protect older cross-table aliases while each storage family releases its
 * own row. The caller's row is ignored, but every other binding is retained. */
export async function storageHasOtherBinding(ctx: Context, storageId: Id<"_storage">,
  current: {table: "artifactAssets" | "artifactImportJobs" | "payloadObjects" | "collaborationDurablePayloads" | "spectraRuntimeBuilds" | "spectraRunAttachments"; id: string}) {
  // Apply live-state constraints in the index before taking a bounded prefix.
  // Older released aliases must never hide a later binding that owns the bytes.
  const [durable, native, quarantined, asset, candidateAsset, original, candidateOriginal, build, attachment] = await Promise.all([
    ctx.db.query("collaborationDurablePayloads").withIndex("by_storage_status", q => q.eq("storageId", storageId).eq("status", "active")).take(2),
    ctx.db.query("payloadObjects").withIndex("by_storage_state", q => q.eq("storageId", storageId).eq("state", "active")).take(2),
    ctx.db.query("payloadObjects").withIndex("by_storage_state", q => q.eq("storageId", storageId).eq("state", "quarantined")).take(2),
    ctx.db.query("artifactAssets").withIndex("by_storage", q => q.eq("storageId", storageId)).take(2),
    ctx.db.query("artifactAssets").withIndex("by_candidate_storage", q => q.eq("candidateStorageId", storageId)).take(2),
    ctx.db.query("artifactImportJobs").withIndex("by_storage", q => q.eq("originalStorageId", storageId)).take(2),
    ctx.db.query("artifactImportJobs").withIndex("by_candidate_storage", q => q.eq("candidateStorageId", storageId)).take(2),
    ctx.db.query("spectraRuntimeBuilds").withIndex("by_storage", q => q.eq("storageId", storageId)).take(2),
    ctx.db.query("spectraRunAttachments").withIndex("by_storage", q => q.eq("storageId", storageId)).take(2),
  ]);
  const groups = [
    ["collaborationDurablePayloads", durable],
    ["payloadObjects", [...native, ...quarantined]],
    ["artifactAssets", [...asset, ...candidateAsset]],
    ["artifactImportJobs", [...original, ...candidateOriginal]],
    ["spectraRuntimeBuilds", build], ["spectraRunAttachments", attachment],
  ] as const;
  return groups.some(([table, rows]) => rows.some(row => table !== current.table || String(row._id) !== current.id));
}

export async function deleteStorageIfNoOtherBinding(ctx: MutationCtx, storageId: Id<"_storage">,
  current: Parameters<typeof storageHasOtherBinding>[2]) {
  if (await storageHasOtherBinding(ctx, storageId, current)) return false;
  if (!await ctx.db.system.get(storageId)) return false;
  await ctx.storage.delete(storageId);
  return true;
}

/** Called after releasing the current row, or before deleting a proven fresh
 * redundant upload. Indexed probes also protect legacy aliases across owners. */
export async function deleteUnboundDurableStorage(ctx: MutationCtx, storageId: Id<"_storage">) {
  const [durable, native, quarantined] = await Promise.all([
    ctx.db.query("collaborationDurablePayloads").withIndex("by_storage_status", q => q.eq("storageId", storageId).eq("status", "active")).first(),
    ctx.db.query("payloadObjects").withIndex("by_storage_state", q => q.eq("storageId", storageId).eq("state", "active")).first(),
    ctx.db.query("payloadObjects").withIndex("by_storage_state", q => q.eq("storageId", storageId).eq("state", "quarantined")).first(),
  ]);
  if (durable || native || quarantined || await intakeBinding(ctx, storageId) ||
    await ctx.db.query("spectraRuntimeBuilds").withIndex("by_storage", q => q.eq("storageId", storageId)).first() ||
    await ctx.db.query("spectraRunAttachments").withIndex("by_storage", q => q.eq("storageId", storageId)).first()) return false;
  if (!await ctx.db.system.get(storageId)) return false;
  await ctx.storage.delete(storageId);
  return true;
}
