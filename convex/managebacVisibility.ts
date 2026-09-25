import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getActorForAccountId } from "./identityShared";

type Ctx = QueryCtx | MutationCtx;
type Actor = { accountId: Id<"accounts">; schoolId: Id<"schools"> };
const membershipTypes = ["class", "course", "membership"] as const;

function sourceAvailable(source: Doc<"externalRecords">) {
  return !source.tombstone &&
    (source.sourceState === undefined || source.sourceState === "available" || source.sourceState === "changed");
}

/**
 * Current access to one provider record, not inclusion in a capped discovery
 * response. Call inside the transaction that returns/uses the source content.
 * A selected class is a planning choice, never proof of class membership.
 */
export async function canReadManagebacRecord(
  ctx: Ctx,
  actor: Actor,
  record: Doc<"externalRecords">,
): Promise<boolean> {
  const currentActor = await getActorForAccountId(ctx, actor.accountId);
  if (!currentActor || currentActor.schoolId !== actor.schoolId) return false;

  // Re-read both the record and the current connector. An old row/snapshot or
  // an old integration ID must not become authority after replacement/revocation.
  const source = await ctx.db.get(record._id);
  if (!source || source.schoolId !== currentActor.schoolId || !sourceAvailable(source)) return false;
  const integrations = await ctx.db.query("schoolIntegrations")
    .withIndex("by_school_provider", q => q.eq("schoolId", currentActor.schoolId).eq("provider", "managebac"))
    .take(2);
  const integration = integrations.length === 1 ? integrations[0] : undefined;
  if (!integration || integration._id !== source.integrationId ||
      (integration.status !== "connected" && integration.status !== "degraded")) return false;
  const mappings = await ctx.db.query("externalIdentityMappings")
    .withIndex("by_integration_account", q => q.eq("integrationId", integration._id).eq("accountId", currentActor.accountId))
    .take(2);
  const mapping = mappings.length === 1 ? mappings[0] : undefined;
  if (!mapping || mapping.schoolId !== currentActor.schoolId || mapping.status !== "verified" ||
      mapping.revokedAt !== undefined || mapping.matchCount !== 1 || !mapping.providerUserId?.trim()) return false;

  // Missing periods only match other missing periods. They are not a wildcard
  // for another year's use of the same provider class ID.
  const period = source.academicPeriodKey;
  if (period !== undefined && (!period.trim() || period !== period.trim())) return false;
  const classId = source.providerClassId;
  if (classId !== undefined && !classId.trim()) return false;
  if (source.mappedAccountId !== undefined) {
    if (source.mappedAccountId !== currentActor.accountId || source.audienceScope !== "mapped_user") return false;
  } else if (source.audienceScope === "mapped_user") {
    return false;
  } else if (source.audienceScope === "authorized_staff") {
    if (currentActor.schoolRole !== "teacher" && currentActor.schoolRole !== "school_admin") return false;
  } else if (source.audienceScope === "class_members") {
    if (!classId) return false;
    let member = false;
    for (const recordType of membershipTypes) {
      // Filter before first(): no arbitrary 500-row list can admit or suppress
      // an otherwise exact membership. The existing index scopes the account/type.
      const membership = await ctx.db.query("externalRecords")
        .withIndex("by_account_type", q => q.eq("mappedAccountId", currentActor.accountId).eq("recordType", recordType))
        .filter(q => q.and(
          q.eq(q.field("integrationId"), integration._id),
          q.eq(q.field("schoolId"), currentActor.schoolId),
          q.eq(q.field("audienceScope"), "mapped_user"),
          q.eq(q.field("providerClassId"), classId),
          q.eq(q.field("academicPeriodKey"), period),
          q.eq(q.field("tombstone"), false),
          q.or(q.eq(q.field("sourceState"), undefined), q.eq(q.field("sourceState"), "available"), q.eq(q.field("sourceState"), "changed")),
        ))
        .first();
      if (membership) { member = true; break; }
    }
    if (!member) return false;
  } else if (source.audienceScope !== "school") {
    return false;
  }

  // Class discovery must work before selection. Actual class material follows
  // the user's explicit selection for this same class and academic period.
  if (!classId || membershipTypes.some(type => type === source.recordType)) return true;
  const selection = await ctx.db.query("managebacClassSelections")
    .withIndex("by_integration_account_class", q => q.eq("integrationId", integration._id).eq("accountId", currentActor.accountId).eq("providerClassId", classId))
    .filter(q => q.and(
      q.eq(q.field("schoolId"), currentActor.schoolId),
      q.eq(q.field("academicPeriodKey"), period),
      q.eq(q.field("selected"), true),
    ))
    .first();
  return selection !== null;
}

/** Actual imported memory provenance is managebac:<externalRecords ID>. */
export async function getReadableManagebacSourceRecord(ctx: Ctx, actor: Actor, sourceId: string) {
  const match = /^managebac:([^:]+)$/.exec(sourceId);
  const id = match ? ctx.db.normalizeId("externalRecords", match[1]) : null;
  const record = id ? await ctx.db.get(id) : null;
  return record && await canReadManagebacRecord(ctx, actor, record) ? record : null;
}
