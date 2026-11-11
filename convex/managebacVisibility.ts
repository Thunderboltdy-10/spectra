import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getActorForAccountId } from "./identityShared";
import { hiddenByPreferences, loadSyncPreferences, type SyncPreferences } from "./schoolSyncShared";

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
async function currentAuthority(ctx: Ctx, actor: Actor) {
  const currentActor = await getActorForAccountId(ctx, actor.accountId);
  if (!currentActor || currentActor.schoolId !== actor.schoolId) return null;
  const integrations = await ctx.db.query("schoolIntegrations")
    .withIndex("by_school_provider", q => q.eq("schoolId", currentActor.schoolId).eq("provider", "managebac"))
    .take(2);
  const integration = integrations.length === 1 ? integrations[0] : undefined;
  if (!integration || (integration.status !== "connected" && integration.status !== "degraded")) return null;
  const mappings = await ctx.db.query("externalIdentityMappings")
    .withIndex("by_integration_account", q => q.eq("integrationId", integration._id).eq("accountId", currentActor.accountId))
    .take(2);
  const mapping = mappings.length === 1 ? mappings[0] : undefined;
  if (!mapping || mapping.schoolId !== currentActor.schoolId || mapping.status !== "verified" ||
      mapping.revokedAt !== undefined || mapping.matchCount !== 1 || !mapping.providerUserId?.trim()) return null;
  return { currentActor, integration };
}

/**
 * Instantiate once per query/unchanged-authority transaction, never globally.
 * Do not reuse this reader after writing membership, integration or selection
 * state in the same mutation; use a fresh wrapper/reader for the later check.
 */
function visibilityReader(ctx: Ctx, actor: Actor, removal: boolean, reuseLoadedSource = false) {
  let authority: ReturnType<typeof currentAuthority> | undefined;
  const memberships = new Map<string, Promise<boolean>>();
  const selections = new Map<string, Promise<boolean>>();
  let preferences: Promise<SyncPreferences> | undefined;
  const canReadRecord = async (record: Doc<"externalRecords">): Promise<boolean> => {
    const current = await (authority ??= currentAuthority(ctx, actor));
    if (!current) return false;
    const { currentActor, integration } = current;
    // Source snapshots are never memoized: callers may hold an earlier row.
    const source = reuseLoadedSource ? record : await ctx.db.get(record._id);
    if (!source || source.schoolId !== currentActor.schoolId || source.integrationId !== integration._id ||
        (removal ? !source.tombstone : !sourceAvailable(source))) return false;

    // Missing periods only match other missing periods. They are not a wildcard
    // for another year's use of the same provider class ID.
    const period = source.academicPeriodKey;
    if (period !== undefined && (!period.trim() || period !== period.trim())) return false;
    const classId = source.providerClassId;
    if (classId !== undefined && !classId.trim()) return false;
    if (source.mappedAccountId !== undefined) {
      if (source.mappedAccountId !== currentActor.accountId || source.audienceScope !== "mapped_user") return false;
      // A kind (or a class's kind) the student turned Off shows nothing, even a row a purge hasn't reached yet.
      preferences ??= loadSyncPreferences(ctx, currentActor.accountId, integration._id);
      // Only legacy records without a stored kind need time-based classification.
      if (hiddenByPreferences(await preferences, source, source.syncKind ? 0 : Date.now())) return false;
    } else if (source.audienceScope === "mapped_user") {
      return false;
    } else if (source.audienceScope === "authorized_staff") {
      if (currentActor.schoolRole !== "teacher" && currentActor.schoolRole !== "school_admin") return false;
    } else if (source.audienceScope === "class_members") {
      if (!classId) return false;
      const key = JSON.stringify([classId, period ?? null]);
      let membership = memberships.get(key);
      if (!membership) {
        membership = (async () => {
          for (const recordType of membershipTypes) {
            const match = await ctx.db.query("externalRecords")
              .withIndex("by_visibility_membership", q => q.eq("integrationId", integration._id)
                .eq("providerClassId", classId).eq("academicPeriodKey", period)
                .eq("mappedAccountId", currentActor.accountId).eq("recordType", recordType))
              .filter(q => q.and(
                q.eq(q.field("schoolId"), currentActor.schoolId),
                q.eq(q.field("audienceScope"), "mapped_user"),
                q.eq(q.field("tombstone"), false),
                q.or(q.eq(q.field("sourceState"), undefined), q.eq(q.field("sourceState"), "available"), q.eq(q.field("sourceState"), "changed")),
              ))
              .first();
            if (match) return true;
          }
          return false;
        })();
        memberships.set(key, membership);
      }
      if (!await membership) return false;
    } else if (source.audienceScope !== "school") {
      return false;
    }

    // Class discovery must work before selection. Actual class material follows
    // the user's explicit selection for this same class and academic period.
    if (!classId || membershipTypes.some(type => type === source.recordType)) return true;
    const key = JSON.stringify([classId, period ?? null]);
    let selected = selections.get(key);
    if (!selected) {
      selected = ctx.db.query("managebacClassSelections")
        .withIndex("by_integration_account_class", q => q.eq("integrationId", integration._id).eq("accountId", currentActor.accountId).eq("providerClassId", classId))
        .filter(q => q.and(
          q.eq(q.field("schoolId"), currentActor.schoolId),
          q.eq(q.field("academicPeriodKey"), period),
          q.eq(q.field("selected"), true),
        ))
        .first().then(selection => selection !== null);
      selections.set(key, selected);
    }
    return selected;
  };
  const readSource = async (sourceId: string) => {
    const match = /^managebac:([^:]+)$/.exec(sourceId);
    const id = match ? ctx.db.normalizeId("externalRecords", match[1]) : null;
    const record = id ? await ctx.db.get(id) : null;
    return record && await canReadRecord(record) ? record : null;
  };
  return { canReadRecord, readSource };
}

export function createManagebacVisibilityReader(ctx: Ctx, actor: Actor) {
  return visibilityReader(ctx, actor, false);
}

/** For rows loaded by this query's own database read. Mutations and callers
 * holding earlier snapshots must use the default reader, which reloads them. */
export function createManagebacQueryVisibilityReader(ctx: QueryCtx, actor: Actor) {
  return visibilityReader(ctx, actor, false, true);
}

/** A removal notice carries no withdrawn source body, but still requires the
 * recipient's current identity, membership, audience and class selection. */
export async function canApplyManagebacSourceRemoval(ctx: Ctx, actor: Actor, record: Doc<"externalRecords">) {
  return visibilityReader(ctx, actor, true).canReadRecord(record);
}

export async function canReadManagebacRecord(ctx: Ctx, actor: Actor, record: Doc<"externalRecords">) {
  return createManagebacVisibilityReader(ctx, actor).canReadRecord(record);
}

/** Actual imported memory provenance is managebac:<externalRecords ID>. */
export async function getReadableManagebacSourceRecord(ctx: Ctx, actor: Actor, sourceId: string) {
  return createManagebacVisibilityReader(ctx, actor).readSource(sourceId);
}
