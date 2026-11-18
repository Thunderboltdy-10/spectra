import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";

/**
 * A replica's projection base (the Spectra content its native file was last
 * matched against) is ~20 KB, and every replica read used to carry it. It
 * lives in `replicaProjectionBases`, read only where a base is needed; the
 * replica keeps the small fields (hash, revision, payload ref). Rows written
 * before this keep the base inline until they are next written or the
 * backfill moves them; `readProjectionBase` reads both.
 */
export const HEAVY_BASE_FIELDS = ["projectionBaseContent", "projectionBaseTextIndex", "projectionBaseFidelityMap"] as const;
type HeavyField = (typeof HEAVY_BASE_FIELDS)[number];

export type ProjectionBaseBody = {
  projectionBaseContent?: unknown;
  projectionBaseTextIndex?: string;
  projectionBaseFidelityMap?: unknown;
};

const INLINE_CLEARED = {
  projectionBaseContent: undefined,
  projectionBaseTextIndex: undefined,
  projectionBaseFidelityMap: undefined,
};

type ReplicaFields = Partial<Omit<Doc<"workReplicas">, "_id" | "_creationTime">>;
type ReplicaInsert = Omit<Doc<"workReplicas">, "_id" | "_creationTime">;

function hasInline(replica: ProjectionBaseBody) {
  return HEAVY_BASE_FIELDS.some((field) => replica[field] !== undefined);
}

function split<T extends ProjectionBaseBody>(fields: T) {
  const light = { ...fields } as T;
  const body: ProjectionBaseBody = {};
  let touched = false;
  for (const field of HEAVY_BASE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
    touched = true;
    (body as Record<HeavyField, unknown>)[field] = fields[field];
    delete (light as Record<string, unknown>)[field];
  }
  return { light, body, touched };
}

async function sidecarOf(db: DatabaseReader, replicaId: Id<"workReplicas">) {
  return await db
    .query("replicaProjectionBases")
    .withIndex("by_replica", (q) => q.eq("replicaId", replicaId))
    .unique();
}

/** The replica's projection base: inline on rows not yet moved, else from its sidecar. */
export async function readProjectionBase(
  db: DatabaseReader,
  replica: Doc<"workReplicas">,
): Promise<ProjectionBaseBody> {
  if (hasInline(replica)) {
    return {
      projectionBaseContent: replica.projectionBaseContent,
      projectionBaseTextIndex: replica.projectionBaseTextIndex,
      projectionBaseFidelityMap: replica.projectionBaseFidelityMap,
    };
  }
  const row = await sidecarOf(db, replica._id);
  return row
    ? { projectionBaseContent: row.content, projectionBaseTextIndex: row.textIndex, projectionBaseFidelityMap: row.fidelityMap }
    : {};
}

async function storeBody(
  db: DatabaseWriter,
  replica: Pick<Doc<"workReplicas">, "_id" | "accountId" | "workId">,
  body: ProjectionBaseBody,
  existing: Doc<"replicaProjectionBases"> | null,
) {
  const empty = !hasInline(body);
  if (empty) {
    if (existing) await db.delete(existing._id);
    return;
  }
  const row = {
    content: body.projectionBaseContent,
    textIndex: body.projectionBaseTextIndex,
    fidelityMap: body.projectionBaseFidelityMap,
    updatedAt: Date.now(),
  };
  if (existing) await db.replace(existing._id, { ...row, replicaId: replica._id, accountId: replica.accountId, workId: replica.workId });
  else await db.insert("replicaProjectionBases", { ...row, replicaId: replica._id, accountId: replica.accountId, workId: replica.workId });
}

/** `db.insert("workReplicas", …)` with the projection base kept beside the row. */
export async function insertReplica(db: DatabaseWriter, fields: ReplicaInsert): Promise<Id<"workReplicas">> {
  const { light, body, touched } = split(fields);
  const id = await db.insert("workReplicas", light);
  if (touched) await storeBody(db, { _id: id, accountId: fields.accountId, workId: fields.workId }, body, null);
  return id;
}

/**
 * `db.patch(replicaId, …)` with the projection base kept beside the row. Base
 * fields the patch leaves out keep their value, as a patch would; a row that
 * still holds its base inline has it moved out.
 */
export async function patchReplica(db: DatabaseWriter, replicaId: Id<"workReplicas">, fields: ReplicaFields) {
  const { light, body, touched } = split(fields);
  if (!touched) return await db.patch(replicaId, light);
  const replica = await db.get(replicaId);
  if (!replica) return await db.patch(replicaId, light);
  const existing = await sidecarOf(db, replicaId);
  const before: ProjectionBaseBody = hasInline(replica)
    ? { projectionBaseContent: replica.projectionBaseContent, projectionBaseTextIndex: replica.projectionBaseTextIndex, projectionBaseFidelityMap: replica.projectionBaseFidelityMap }
    : existing
      ? { projectionBaseContent: existing.content, projectionBaseTextIndex: existing.textIndex, projectionBaseFidelityMap: existing.fidelityMap }
      : {};
  await storeBody(db, replica, { ...before, ...body }, existing);
  await db.patch(replicaId, hasInline(replica) ? { ...light, ...INLINE_CLEARED } : light);
}

/** Deletes a replica and its projection base. */
export async function deleteReplica(db: DatabaseWriter, replicaId: Id<"workReplicas">) {
  const existing = await sidecarOf(db, replicaId);
  if (existing) await db.delete(existing._id);
  await db.delete(replicaId);
}

/** Moves an inline base out of a row written before the sidecar. Returns whether it moved one. */
export async function moveInlineBase(db: DatabaseWriter, replica: Doc<"workReplicas">) {
  if (!hasInline(replica)) return false;
  const existing = await sidecarOf(db, replica._id);
  await storeBody(db, replica, {
    projectionBaseContent: replica.projectionBaseContent,
    projectionBaseTextIndex: replica.projectionBaseTextIndex,
    projectionBaseFidelityMap: replica.projectionBaseFidelityMap,
  }, existing);
  await db.patch(replica._id, INLINE_CLEARED);
  return true;
}
