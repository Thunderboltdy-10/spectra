import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";

/**
 * A ManageBac sync page reads every record it carries. Most are unchanged, yet
 * each cost a full record read (with its provider payload), class and relation
 * lookups and the student's projections. A head is the record's small part: its
 * hash, state and expiry, kept by a trigger on every record write, plus which
 * accounts a sync already settled at that hash (relations and projections in
 * place). A record whose head says unchanged and settled for this student is
 * counted and skipped without reading the record.
 */
export const SETTLED_MAX = 24;

type Settled = { account: string; sourceHash: string; at: number };

export function settledAccountKey(accountId: Id<"accounts"> | undefined) {
  return accountId ? String(accountId) : "school";
}

function headFields(record: Doc<"externalRecords">) {
  return {
    recordId: record._id,
    integrationId: record.integrationId,
    schoolId: record.schoolId,
    sourceIdentityKey: record.sourceIdentityKey,
    sourceHash: record.sourceHash,
    tombstone: record.tombstone,
    syncKind: record.syncKind,
    sourceState: record.sourceState,
    sourceStateAt: record.sourceStateAt,
    sourceStateReason: record.sourceStateReason,
    expiresAt: record.expiresAt,
  };
}

async function headOf(db: DatabaseReader, recordId: Id<"externalRecords">) {
  return await db.query("externalRecordHeads").withIndex("by_record", (q) => q.eq("recordId", recordId)).unique();
}

/** Keeps the head in step with its record (the `externalRecords` trigger). */
export async function syncExternalRecordHead(
  db: DatabaseWriter,
  recordId: Id<"externalRecords">,
  before: Doc<"externalRecords"> | null,
  after: Doc<"externalRecords"> | null,
) {
  const head = await headOf(db, recordId);
  if (!after) {
    if (head) await db.delete(head._id);
    return;
  }
  const fields = headFields(after);
  // A new hash or a tombstone means nothing has been settled for what the record now says.
  const unsettle = !head || !before || before.sourceHash !== after.sourceHash || before.tombstone !== after.tombstone;
  const settled = unsettle ? [] : head.settled;
  if (head) {
    const next = { ...fields, settled };
    const changed = (Object.keys(next) as (keyof typeof next)[]).some(
      (key) => JSON.stringify(head[key]) !== JSON.stringify(next[key]),
    );
    if (changed) await db.replace(head._id, next);
  } else await db.insert("externalRecordHeads", { ...fields, settled });
}

/** A projection gone or changed for an account: the next sync re-checks that account's copy. */
export async function unsettleForProjection(
  db: DatabaseWriter,
  before: Doc<"externalProjections"> | null,
  after: Doc<"externalProjections"> | null,
) {
  if (!before) return;
  if (after && after.state === before.state && after.recordId === before.recordId) return;
  const head = await headOf(db, before.recordId);
  if (!head?.settled.length) return;
  const account = settledAccountKey(before.accountId);
  const settled = head.settled.filter((entry: Settled) => entry.account !== account);
  if (settled.length !== head.settled.length) await db.patch(head._id, { settled });
}

/** After a sync fully handled a record for an account: later identical pages may skip it. */
export async function settleExternalRecord(
  db: DatabaseWriter,
  record: Doc<"externalRecords">,
  accountId: Id<"accounts"> | undefined,
  now: number,
) {
  const head = await headOf(db, record._id);
  const account = settledAccountKey(accountId);
  const kept = (head?.settled ?? []).filter((entry: Settled) => entry.account !== account && entry.sourceHash === record.sourceHash);
  const settled = [{ account, sourceHash: record.sourceHash, at: now }, ...kept].slice(0, SETTLED_MAX);
  if (head) await db.patch(head._id, { ...headFields(record), settled });
  else await db.insert("externalRecordHeads", { ...headFields(record), settled });
}

/** The head for a record identity in this school, if one is kept. */
export async function headForIdentity(
  db: DatabaseReader,
  integrationId: Id<"schoolIntegrations">,
  schoolId: Id<"schools">,
  sourceIdentityKey: string,
) {
  const heads = await db
    .query("externalRecordHeads")
    .withIndex("by_source_identity", (q) => q.eq("integrationId", integrationId).eq("sourceIdentityKey", sourceIdentityKey))
    .take(4);
  return heads.find((head) => head.schoolId === schoolId) ?? null;
}

export function settledAt(head: Doc<"externalRecordHeads">, accountId: Id<"accounts"> | undefined, sourceHash: string) {
  const account = settledAccountKey(accountId);
  return head.settled.find((entry: Settled) => entry.account === account && entry.sourceHash === sourceHash)?.at;
}
