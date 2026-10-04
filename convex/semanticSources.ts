/**
 * The semantic source registry: every kind of thing Spectra can find by meaning is declared here
 * once (no registered functions).
 *
 * To make a new kind searchable:
 *   1. add its name to INDEXED_SEMANTIC_KINDS (shared/semantic-types.ts) and to `semanticIndexedKind`
 *      in convex/schema.ts;
 *   2. add a chunk builder to shared/semantic-chunks.ts, or reuse one;
 *   3. add an entry below: its table, the fields whose change re-indexes it, how it is loaded for
 *      indexing, which partitions a viewer may search, and the authoritative read check.
 * Triggers, the debounced queue, the backfill, search, searchThreads and related pick it up from
 * here. New artifact types and new school record types need no registration at all.
 *
 * Memory is not here: claims keep their own table and embeddings (same provider, ./memory.ts)
 * and join search through `memory.contextForRunBase`, which applies the memory consent rules.
 */
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  evaluateAccessForActor,
  evaluateArtifactAccessForActorWithSummary,
  listDirectlyGrantedResourceIds,
} from "./authorityShared";
import type { AuthenticatedActor } from "./identityShared";
import { createManagebacVisibilityReader } from "./managebacVisibility";
import { artifactSummaryFor, findNodesForSource } from "./orgTreeShared";
import {
  audienceKeys, grantKeyOf, itemKeyOf, MAX_VECTOR_PARTITIONS, ownerKeyOf, ownerWorkspaceKeyOf, workspaceKeyOf,
  type ItemScope, type LexicalScope,
} from "./semanticKeys";
import { enqueueSemanticItem } from "./semanticQueue";
import { isDurableContentRef } from "../shared/durable-content";
import {
  artifactTypeLabel, schoolRecordTimeAt, schoolRecordTitle, schoolRecordTypeIndexed, schoolRecordTypeLabel, type ChunkInput,
} from "../shared/semantic-chunks";
import { INDEXED_SEMANTIC_KINDS, type IndexedSemanticKind, type RelatedReason } from "../shared/semantic-types";

const MAX_DURABLE_BYTES = 8 * 1024 * 1024;
const MAX_THREAD_MESSAGES = 400;
const MAX_LEXICAL_WORKSPACES = 6;
const MAX_LEXICAL_CLASSES = 8;
const MAX_GRANTED_ITEMS = 200;
const MAX_LINKS = 24;

export type DurableContent = { storageId: Id<"_storage">; digest: string; byteLength: number; path: "content" | "value" };

/** What the indexer needs about one item, read in a query and chunked in an action. */
export type LoadedSource = {
  title: string;
  subtype?: string;
  sourceUpdatedAt: number;
  /** When it happens: event start, due date. */
  timeAt?: number;
  /** The workspace it is filed in, for result context. */
  workspaceId?: Id<"spectraWorkspaces">;
  /** Items it came from (copy detection in Related). */
  lineageIds: string[];
  /** Another indexed item this one mirrors (a calendar deadline of a school record): results keep one. */
  mirrors?: string;
  scope: ItemScope;
  input: ChunkInput;
  /** Artifact content stored as a durable payload; the action reads and verifies it. */
  durable?: DurableContent;
};

/** What a viewer may search: plain partition keys (vector) and full-text scopes. */
export type ViewerScope = { keys: string[]; lexical: LexicalScope[]; grantedItemIds?: string[] };
export type SemanticViewer = {
  actor: AuthenticatedActor;
  /** Restrict to one workspace the viewer can open. */
  workspaceId?: Id<"spectraWorkspaces">;
};

/** An item the viewer can open right now, with its current facts. */
export type ReadableItem = {
  kind: IndexedSemanticKind;
  itemId: string;
  title: string;
  typeLabel: string;
  subtype?: string;
  status?: "active" | "archived" | "draft";
  updatedAt?: number;
  timeAt?: number;
  ownership: "mine" | "shared" | "school";
  /** Whether owner-only passages (quiz answers) may be shown. */
  isOwner: boolean;
};

type ReadHelpers = { managebac: ReturnType<typeof createManagebacVisibilityReader> };

/** An explicit connection shown first in Related. Access to the target is checked by the caller. */
export type ExplicitLink = { kind: IndexedSemanticKind; itemId: string; reason: RelatedReason };

export type SourceSpec<T extends TableNames, K extends IndexedSemanticKind = IndexedSemanticKind> = {
  kind: K;
  table: T;
  /** Fields whose change re-indexes the item (after the debounce). */
  watch: ReadonlyArray<keyof Doc<T> & string>;
  /** Whether a row belongs in the index. A row that stops qualifying is purged at once. */
  indexable(doc: Doc<T>): boolean;
  /** Facts outside the row that take it out of the index (a work in Trash). Checked when indexing. */
  present?(ctx: QueryCtx, doc: Doc<T>): Promise<boolean>;
  /** The source generation the backfill compares with the indexed one. */
  updatedAt(doc: Doc<T>): number;
  schoolId(doc: Doc<T>): Id<"schools"> | undefined;
  load(ctx: QueryCtx, doc: Doc<T>): Promise<LoadedSource>;
  /** Partitions this viewer may search for this kind. Reads live grants. */
  viewer(ctx: QueryCtx, viewer: SemanticViewer, options: { workspaceReadable: boolean }): Promise<ViewerScope>;
  /** The authoritative read check, run on every candidate of every response. Loads only what it needs. */
  read(ctx: QueryCtx, actor: AuthenticatedActor, itemId: string, helpers: ReadHelpers): Promise<ReadableItem | null>;
  /** Explicit connections of a readable item (links, the chat it was made in), for Related. */
  links?(ctx: QueryCtx, actor: AuthenticatedActor, itemId: string): Promise<ExplicitLink[]>;
};

const defineSource = <T extends TableNames, K extends IndexedSemanticKind>(spec: SourceSpec<T, K>) => spec;
const ownedBy = (doc: { ownerAccountId?: Id<"accounts">; schoolId?: Id<"schools"> }, actor: AuthenticatedActor) =>
  doc.ownerAccountId === actor.accountId && doc.schoolId === actor.schoolId;

/** Private kinds (threads, events): the owner's keys, or the owner's keys inside one workspace. */
function privateViewer(kind: IndexedSemanticKind) {
  return async (_ctx: QueryCtx, viewer: SemanticViewer, options: { workspaceReadable: boolean }): Promise<ViewerScope> => {
    const { actor, workspaceId } = viewer;
    if (workspaceId) {
      if (!options.workspaceReadable) return { keys: [], lexical: [] };
      const key = ownerWorkspaceKeyOf(kind, workspaceId, actor.accountId);
      return { keys: [key], lexical: [{ itemKind: kind, workspaceKey: key }] };
    }
    return { keys: [ownerKeyOf(kind, actor.accountId)], lexical: [{ itemKind: kind, ownerAccountId: actor.accountId }] };
  };
}

// ---------------------------------------------------------------------------------------------
// Artifacts: every artifact type, chunked by region (shared/semantic-chunks.ts).

/** Workspaces whose audience an artifact is projected to, by the same rule as inherited access. */
async function artifactPlacements(ctx: QueryCtx, artifact: Doc<"spectraArtifacts">) {
  const keys: string[] = [];
  let workspaceId: Id<"spectraWorkspaces"> | undefined;
  for (const placement of await findNodesForSource(ctx, "work", artifact._id)) {
    if (placement.deletedAt !== undefined || !placement.workspaceContextId) continue;
    const workspace = await ctx.db.get(placement.workspaceContextId);
    if (!workspace || workspace.status !== "active") continue;
    workspaceId ??= workspace._id;
    const projects = placement.accessProjection === true ||
      (placement.accessProjection === undefined && artifact.ownerAccountId === workspace.ownerAccountId);
    if (projects) keys.push(workspaceKeyOf("artifact", workspace._id));
  }
  return { workspaceKeys: [...new Set(keys)].sort().slice(0, 2), workspaceId };
}

/** A work is in Trash when every placement of it is: it is gone for search until restored. */
async function artifactTrashed(ctx: QueryCtx, artifactId: Id<"spectraArtifacts">) {
  const placements = await findNodesForSource(ctx, "work", artifactId);
  return placements.length > 0 && placements.every((placement) => placement.deletedAt !== undefined);
}

const artifactSource = defineSource({
  kind: "artifact",
  table: "spectraArtifacts",
  // updatedAt moves on every save, whatever the content shape; unchanged chunks are not re-embedded.
  watch: ["title", "summary", "tags", "status", "updatedAt", "contentHash", "textIndex", "projectionPayloadDigest",
    "ownerAccountId", "schoolId", "blueprintKey", "resourceClass"],
  indexable: (doc) => doc.status !== "deleted" && doc.resourceClass !== "thread_reference" && doc.blueprintKey !== "thread_reference",
  present: async (ctx, doc) => !(await artifactTrashed(ctx, doc._id)),
  updatedAt: (doc) => doc.updatedAt,
  schoolId: (doc) => doc.schoolId,
  async load(ctx, artifact) {
    let durable: DurableContent | undefined;
    let content: unknown;
    if (isDurableContentRef(artifact.content)) {
      const ref = artifact.content.spectraContentRef;
      const payloadId = ctx.db.normalizeId("collaborationDurablePayloads", ref.payloadRef);
      const payload = payloadId ? await ctx.db.get(payloadId) : null;
      if (payload && payload.status === "active" && payload.artifactId === artifact._id && payload.digest === ref.digest &&
        payload.byteLength === ref.byteLength && payload.kind === "projection" && payload.byteLength <= MAX_DURABLE_BYTES)
        durable = { storageId: payload.storageId, digest: payload.digest, byteLength: payload.byteLength, path: ref.path };
    } else content = artifact.content;
    const placements = await artifactPlacements(ctx, artifact);
    return {
      title: artifact.title, subtype: artifact.blueprintKey, sourceUpdatedAt: artifact.updatedAt, workspaceId: placements.workspaceId,
      lineageIds: (artifact.createdFrom?.sourceArtifactIds ?? []).map(String),
      scope: { ownerAccountId: artifact.ownerAccountId, schoolId: artifact.schoolId, workspaceKeys: placements.workspaceKeys, grantable: true },
      input: { builder: "artifact", blueprintKey: artifact.blueprintKey, title: artifact.title, summary: artifact.summary,
        tags: artifact.tags, content, textIndex: artifact.textIndex },
      durable,
    };
  },
  async viewer(ctx, { actor, workspaceId }, { workspaceReadable }) {
    if (workspaceId) {
      if (!workspaceReadable) return { keys: [], lexical: [] };
      const key = workspaceKeyOf("artifact", workspaceId);
      return { keys: [key], lexical: [{ itemKind: "artifact", workspaceKey: key }] };
    }
    const [owned, grantedWorkspaces, grantedArtifacts, grantedAgents] = await Promise.all([
      ctx.db.query("spectraWorkspaces").withIndex("by_account_activity", (q) => q.eq("ownerAccountId", actor.accountId))
        .order("desc").take(40),
      listDirectlyGrantedResourceIds(ctx, actor, "workspace"),
      listDirectlyGrantedResourceIds(ctx, actor, "artifact"),
      listDirectlyGrantedResourceIds(ctx, actor, "agent"),
    ]);
    const workspaceIds = [...new Set([...owned.filter((row) => row.status === "active" && row.schoolId === actor.schoolId)
      .map((row) => String(row._id)), ...grantedWorkspaces])];
    const grantedItemIds = [...new Set([...grantedArtifacts, ...grantedAgents])].slice(0, MAX_GRANTED_ITEMS);
    return {
      keys: [ownerKeyOf("artifact", actor.accountId), ...workspaceIds.map((id) => workspaceKeyOf("artifact", id)),
        ...grantedItemIds.map((id) => grantKeyOf("artifact", id))],
      lexical: [{ itemKind: "artifact", ownerAccountId: actor.accountId },
        ...workspaceIds.slice(0, MAX_LEXICAL_WORKSPACES).map((id) => ({ itemKind: "artifact" as const, workspaceKey: workspaceKeyOf("artifact", id) }))],
      grantedItemIds,
    };
  },
  async read(ctx, actor, itemId) {
    const id = ctx.db.normalizeId("spectraArtifacts", itemId);
    if (!id) return null;
    // The compact summary row carries the authority facts and title, so the payload is never loaded.
    const summary = await artifactSummaryFor(ctx, id);
    const access = await evaluateArtifactAccessForActorWithSummary(ctx, actor, id, undefined, summary);
    if (!access.allowed || !access.capabilities.includes("read")) return null;
    const projection = (summary?.projection ?? null) as { title?: string; status?: string; resourceClass?: string } | null;
    const facts = summary && projection?.title !== undefined
      ? { title: projection.title, status: summary.status, blueprintKey: summary.blueprintKey, resourceClass: projection.resourceClass,
          updatedAt: summary.updatedAt, ownerAccountId: summary.ownerAccountId, schoolId: summary.schoolId }
      : await ctx.db.get(id);
    if (!facts || facts.status === "deleted" || facts.resourceClass === "thread_reference" || facts.blueprintKey === "thread_reference" ||
      await artifactTrashed(ctx, id)) return null;
    const isOwner = ownedBy(facts, actor);
    return { kind: "artifact", itemId, title: facts.title, typeLabel: artifactTypeLabel(facts.blueprintKey), subtype: facts.blueprintKey,
      status: facts.status, updatedAt: facts.updatedAt, ownership: isOwner ? "mine" : "shared", isOwner };
  },
  async links(ctx, actor, itemId) {
    const id = ctx.db.normalizeId("spectraArtifacts", itemId);
    if (!id) return [];
    const [outgoing, incoming, threads, summary] = await Promise.all([
      ctx.db.query("spectraArtifactLinks").withIndex("by_source", (q) => q.eq("sourceArtifactId", id)).order("desc").take(MAX_LINKS),
      ctx.db.query("spectraArtifactLinks").withIndex("by_target", (q) => q.eq("targetArtifactId", id)).order("desc").take(MAX_LINKS),
      ctx.db.query("spectraThreads").withIndex("by_artifact", (q) => q.eq("artifactId", id)).take(MAX_LINKS),
      artifactSummaryFor(ctx, id),
    ]);
    return [
      ...outgoing.map((link) => ({ kind: "artifact" as const, itemId: String(link.targetArtifactId),
        reason: { type: "link" as const, relation: link.relationType, direction: "outgoing" as const, label: link.label } })),
      ...incoming.map((link) => ({ kind: "artifact" as const, itemId: String(link.sourceArtifactId),
        reason: { type: "link" as const, relation: link.relationType, direction: "incoming" as const, label: link.label } })),
      ...(summary?.createdFromThreadId ? [{ kind: "thread" as const, itemId: String(summary.createdFromThreadId), reason: { type: "made_in_thread" as const } }] : []),
      ...threads.filter((thread) => ownedBy(thread, actor) && thread.status !== "deleted")
        .map((thread) => ({ kind: "thread" as const, itemId: String(thread._id), reason: { type: "thread_about" as const } })),
    ];
  },
});

// ---------------------------------------------------------------------------------------------
// Threads: title, summaries and messages. Owner only.

const threadSource = defineSource({
  kind: "thread",
  table: "spectraThreads",
  watch: ["title", "summaryShort", "summaryLong", "status", "workspaceId", "messageCount", "lastMessageAt", "ownerAccountId", "schoolId"],
  indexable: (doc) => doc.status !== "deleted",
  updatedAt: (doc) => doc.lastMessageAt ?? doc.updatedAt,
  schoolId: (doc) => doc.schoolId,
  async load(ctx, thread) {
    const messages = (await ctx.db.query("spectraMessages").withIndex("by_thread_created", (q) => q.eq("threadId", thread._id))
      .order("desc").take(MAX_THREAD_MESSAGES)).reverse();
    return {
      title: thread.title, sourceUpdatedAt: thread.lastMessageAt ?? thread.updatedAt, workspaceId: thread.workspaceId,
      lineageIds: [...new Set([thread.artifactId, ...(thread.contextArtifactIds ?? [])].filter(Boolean).map(String))],
      scope: { ownerAccountId: thread.ownerAccountId, schoolId: thread.schoolId,
        workspaceKeys: thread.workspaceId ? [ownerWorkspaceKeyOf("thread", thread.workspaceId, thread.ownerAccountId)] : [] },
      input: { builder: "thread", title: thread.title, summaryShort: thread.summaryShort, summaryLong: thread.summaryLong,
        messages: messages.map((message) => ({ id: String(message._id), role: message.role, content: message.content.slice(0, 8_000) })) },
    };
  },
  viewer: privateViewer("thread"),
  async read(ctx, actor, itemId) {
    const id = ctx.db.normalizeId("spectraThreads", itemId);
    const thread = id ? await ctx.db.get(id) : null;
    if (!thread || !ownedBy(thread, actor) || thread.status === "deleted") return null;
    return { kind: "thread", itemId: thread._id, title: thread.title, typeLabel: "Chat", status: thread.status,
      updatedAt: thread.lastMessageAt ?? thread.updatedAt, ownership: "mine", isOwner: true };
  },
  async links(ctx, _actor, itemId) {
    const id = ctx.db.normalizeId("spectraThreads", itemId);
    const thread = id ? await ctx.db.get(id) : null;
    if (!id || !thread) return [];
    const made = await ctx.db.query("spectraArtifactSummaries").withIndex("by_created_thread", (q) => q.eq("createdFromThreadId", id))
      .order("desc").take(MAX_LINKS);
    const about = [...new Set([thread.artifactId, ...(thread.contextArtifactIds ?? [])].filter(Boolean).map(String))];
    return [
      ...made.map((row) => ({ kind: "artifact" as const, itemId: String(row.artifactId), reason: { type: "made_in_thread" as const } })),
      ...about.map((artifactId) => ({ kind: "artifact" as const, itemId: artifactId, reason: { type: "thread_about" as const } })),
    ];
  },
});

// ---------------------------------------------------------------------------------------------
// Calendar: events, deadlines, tasks, work blocks, reminders. Owner only.

const EVENT_LABELS: Record<string, string> = {
  official_event: "School event", official_deadline: "Deadline", task: "Task", scheduled_work_block: "Work block",
  personal_event: "Event", milestone: "Milestone", reminder: "Reminder",
};

const eventIndexable = (doc: Doc<"calendarItems">) => doc.status !== "removed" && doc.sourceCapabilityState !== "permission_denied";

const eventSource = defineSource({
  kind: "event",
  table: "calendarItems",
  watch: ["title", "notes", "location", "teacher", "startAt", "endAt", "kind", "status", "workspaceId", "sourceCapabilityState",
    "ownerAccountId", "schoolId"],
  indexable: eventIndexable,
  updatedAt: (doc) => doc.updatedAt,
  schoolId: (doc) => doc.schoolId,
  async load(_ctx, event) {
    return {
      title: event.title, subtype: event.kind, sourceUpdatedAt: event.updatedAt, timeAt: event.startAt, workspaceId: event.workspaceId,
      lineageIds: event.linkedArtifactIds.map(String), mirrors: event.sourceRecordId ? itemKeyOf("school", event.sourceRecordId) : undefined,
      scope: { ownerAccountId: event.ownerAccountId, schoolId: event.schoolId,
        workspaceKeys: event.workspaceId ? [ownerWorkspaceKeyOf("event", event.workspaceId, event.ownerAccountId)] : [] },
      input: { builder: "event", title: event.title, kind: event.kind, startAt: event.startAt, endAt: event.endAt, allDay: event.allDay,
        location: event.location, teacher: event.teacher, notes: event.notes },
    };
  },
  viewer: privateViewer("event"),
  async read(ctx, actor, itemId) {
    const id = ctx.db.normalizeId("calendarItems", itemId);
    const event = id ? await ctx.db.get(id) : null;
    if (!event || !ownedBy(event, actor) || !eventIndexable(event)) return null;
    return { kind: "event", itemId: event._id, title: event.title, typeLabel: EVENT_LABELS[event.kind] ?? "Event", subtype: event.kind,
      updatedAt: event.updatedAt, timeAt: event.startAt, ownership: "mine", isOwner: true };
  },
  async links(ctx, _actor, itemId) {
    const id = ctx.db.normalizeId("calendarItems", itemId);
    const event = id ? await ctx.db.get(id) : null;
    if (!event) return [];
    return [
      ...event.linkedArtifactIds.map((artifactId) => ({ kind: "artifact" as const, itemId: String(artifactId),
        reason: { type: "link" as const, relation: "related", direction: "outgoing" as const } })),
      ...(event.planArtifactId ? [{ kind: "artifact" as const, itemId: String(event.planArtifactId),
        reason: { type: "link" as const, relation: "belongs_with", direction: "outgoing" as const } }] : []),
      ...(event.sourceRecordId ? [{ kind: "school" as const, itemId: String(event.sourceRecordId),
        reason: { type: "link" as const, relation: "source_for", direction: "incoming" as const } }] : []),
    ];
  },
});

// ---------------------------------------------------------------------------------------------
// School data: ManageBac classes, resources, tasks, assignments, assessments, CAS entries and
// any record type that syncs later. Visibility follows ./managebacVisibility exactly.

const MEMBERSHIP_TYPES = new Set(["class", "course", "membership"]);
function schoolRecordScope(record: Doc<"externalRecords">): ItemScope {
  if (record.mappedAccountId) return { ownerAccountId: record.mappedAccountId, schoolId: record.schoolId, workspaceKeys: [] };
  const classId = record.providerClassId?.trim();
  if (classId && (!MEMBERSHIP_TYPES.has(record.recordType) || record.audienceScope === "class_members"))
    return { schoolId: record.schoolId, workspaceKeys: [], audienceKey: audienceKeys.klass(record.integrationId, classId, record.academicPeriodKey) };
  if (record.audienceScope === "authorized_staff") return { schoolId: record.schoolId, workspaceKeys: [], audienceKey: audienceKeys.staff(record.schoolId) };
  if (record.audienceScope === "school") return { schoolId: record.schoolId, workspaceKeys: [], audienceKey: audienceKeys.school(record.schoolId) };
  return { schoolId: record.schoolId, workspaceKeys: [] };
}

const schoolIndexable = (doc: Doc<"externalRecords">) => !doc.tombstone &&
  (doc.sourceState === undefined || doc.sourceState === "available" || doc.sourceState === "changed") && schoolRecordTypeIndexed(doc.recordType);

const schoolSource = defineSource({
  kind: "school",
  table: "externalRecords",
  watch: ["sourceHash", "normalized", "tombstone", "sourceState", "audienceScope", "mappedAccountId", "providerClassId",
    "academicPeriodKey", "recordType", "schoolId"],
  indexable: schoolIndexable,
  updatedAt: (doc) => doc.sourceModifiedAt ?? doc.updatedAt,
  schoolId: (doc) => doc.schoolId,
  async load(_ctx, record) {
    return {
      title: schoolRecordTitle(record.normalized, record.recordType), subtype: record.recordType,
      sourceUpdatedAt: record.sourceModifiedAt ?? record.updatedAt, timeAt: schoolRecordTimeAt(record.normalized),
      lineageIds: [], scope: schoolRecordScope(record),
      input: { builder: "school", recordType: record.recordType, normalized: record.normalized },
    };
  },
  async viewer(ctx, { actor, workspaceId }) {
    if (workspaceId) return { keys: [], lexical: [] };
    const keys = [ownerKeyOf("school", actor.accountId), audienceKeys.school(actor.schoolId)];
    const lexical: LexicalScope[] = [{ itemKind: "school", ownerAccountId: actor.accountId },
      { itemKind: "school", audienceKey: audienceKeys.school(actor.schoolId) }];
    if (actor.schoolRole === "teacher" || actor.schoolRole === "school_admin") {
      keys.push(audienceKeys.staff(actor.schoolId));
      lexical.push({ itemKind: "school", audienceKey: audienceKeys.staff(actor.schoolId) });
    }
    const integrations = await ctx.db.query("schoolIntegrations")
      .withIndex("by_school_provider", (q) => q.eq("schoolId", actor.schoolId).eq("provider", "managebac")).take(2);
    if (integrations.length === 1) {
      const selections = await ctx.db.query("managebacClassSelections")
        .withIndex("by_account_integration", (q) => q.eq("accountId", actor.accountId).eq("integrationId", integrations[0]!._id))
        .take(100);
      const classKeys = selections.filter((row) => row.selected && row.schoolId === actor.schoolId)
        .map((row) => audienceKeys.klass(row.integrationId, row.providerClassId, row.academicPeriodKey));
      keys.push(...classKeys);
      lexical.push(...classKeys.slice(0, MAX_LEXICAL_CLASSES).map((key) => ({ itemKind: "school" as const, audienceKey: key })));
    }
    return { keys, lexical };
  },
  async read(ctx, actor, itemId, { managebac }) {
    const id = ctx.db.normalizeId("externalRecords", itemId);
    const record = id ? await ctx.db.get(id) : null;
    if (!record || record.schoolId !== actor.schoolId || !schoolIndexable(record) || !(await managebac.canReadRecord(record))) return null;
    return { kind: "school", itemId: record._id, title: schoolRecordTitle(record.normalized, record.recordType),
      typeLabel: `School ${schoolRecordTypeLabel(record.recordType).toLowerCase()}`, subtype: record.recordType,
      updatedAt: record.sourceModifiedAt ?? record.updatedAt, timeAt: schoolRecordTimeAt(record.normalized),
      ownership: record.mappedAccountId === actor.accountId ? "mine" : "school", isOwner: record.mappedAccountId === actor.accountId };
  },
});

/** The registry. A kind missing here is a type error. */
export const SEMANTIC_SOURCES = {
  artifact: artifactSource,
  thread: threadSource,
  event: eventSource,
  school: schoolSource,
} satisfies { [K in IndexedSemanticKind]: { kind: K } };

type AnySource = SourceSpec<TableNames>;
export const sourceFor = (kind: IndexedSemanticKind) => SEMANTIC_SOURCES[kind] as unknown as AnySource;

/** The registered kind whose table an id belongs to (Convex ids name their table). */
export function kindOfId(ctx: QueryCtx, itemId: string): IndexedSemanticKind | null {
  return INDEXED_SEMANTIC_KINDS.find((kind) => ctx.db.normalizeId(sourceFor(kind).table, itemId) !== null) ?? null;
}

export async function loadSourceDoc(ctx: QueryCtx, kind: IndexedSemanticKind, itemId: string) {
  const source = sourceFor(kind);
  const id = ctx.db.normalizeId(source.table, itemId);
  return id ? await ctx.db.get(id) : null;
}

// ---------------------------------------------------------------------------------------------
// Triggers (registered by ./orgNodeMutation): a save touches one queue row, never the network.

type TriggerTarget = { kind: IndexedSemanticKind; itemId: string; schoolId?: Id<"schools">; immediate: boolean };
type TriggerSpec<T extends TableNames> = { table: T; target(previous: Doc<T> | null, next: Doc<T> | null): TriggerTarget | null };

const changed = <T,>(previous: T | null, next: T | null, fields: ReadonlyArray<keyof T>) =>
  !previous || !next || fields.some((field) => JSON.stringify(previous[field]) !== JSON.stringify(next[field]));

function sourceTrigger<T extends TableNames>(source: SourceSpec<T>): TriggerSpec<T> {
  return {
    table: source.table,
    target(previous, next) {
      const doc = next ?? previous;
      if (!doc || !changed(previous, next, source.watch)) return null;
      const wasIn = previous ? source.indexable(previous) : false;
      const isIn = next ? source.indexable(next) : false;
      if (!wasIn && !isIn) return null;
      // Leaving the index (deleted, removed, tombstoned) is purged at once; reads already exclude it.
      return { kind: source.kind, itemId: String(doc._id), schoolId: source.schoolId(doc), immediate: wasIn && !isIn };
    },
  };
}

/** Whether a source row belongs in the index now. */
export async function sourceIndexable(ctx: QueryCtx, kind: IndexedSemanticKind, doc: Doc<TableNames>) {
  const source = sourceFor(kind);
  return source.indexable(doc) && (!source.present || await source.present(ctx, doc));
}

/** Rows of other tables that change an indexed item. */
const DEPENDENT_TRIGGERS = [
  {
    table: "spectraMessages",
    target: (previous, next) => {
      const doc = next ?? previous;
      return doc && changed(previous, next, ["content", "role"]) ?
        { kind: "thread", itemId: String(doc.threadId), schoolId: doc.schoolId, immediate: false } : null;
    },
  } satisfies TriggerSpec<"spectraMessages">,
  {
    // A placement moves an artifact between workspace audiences.
    table: "orgNodes",
    target: (previous, next) => {
      const node = next ?? previous;
      if (node?.kind !== "work" || !node.sourceId || !changed(previous, next, ["workspaceContextId", "accessProjection", "deletedAt", "sourceId"]))
        return null;
      // Moving to Trash leaves search at once; reads already exclude a trashed work.
      return { kind: "artifact", itemId: node.sourceId, immediate: previous?.deletedAt === undefined && next?.deletedAt !== undefined };
    },
  } satisfies TriggerSpec<"orgNodes">,
];

export const SEMANTIC_TRIGGERS = [
  ...INDEXED_SEMANTIC_KINDS.map((kind) => sourceTrigger(sourceFor(kind))),
  ...DEPENDENT_TRIGGERS,
] as unknown as Array<TriggerSpec<TableNames>>;

export async function applySemanticTrigger(ctx: { db: MutationCtx["db"]; scheduler: MutationCtx["scheduler"] },
  trigger: TriggerSpec<TableNames>, previous: Doc<TableNames> | null, next: Doc<TableNames> | null) {
  const target = trigger.target(previous, next);
  if (target) await enqueueSemanticItem(ctx, target.kind, target.itemId, { schoolId: target.schoolId, immediate: target.immediate });
}

// ---------------------------------------------------------------------------------------------
// Read side: the viewer's partitions and the mandatory read-time check.

export type ViewerPartitions = {
  /** Plain keys; prefix with the vector version for vector filters. */
  keys: string[];
  lexical: LexicalScope[];
  grantedItemIds: Array<{ kind: IndexedSemanticKind; itemId: string }>;
  truncated: boolean;
  /** Set when a workspace filter names a workspace the viewer cannot open. */
  workspaceDenied?: boolean;
};

export async function workspaceReadable(ctx: QueryCtx, actor: AuthenticatedActor, workspaceId: Id<"spectraWorkspaces">) {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.status !== "active") return false;
  if (workspace.ownerAccountId === actor.accountId && workspace.schoolId === actor.schoolId) return true;
  const access = await evaluateAccessForActor(ctx, actor, "workspace", workspaceId);
  return Boolean(access.allowed && access.capabilities.includes("read"));
}

export async function viewerPartitions(ctx: QueryCtx, viewer: SemanticViewer, kinds: readonly IndexedSemanticKind[]): Promise<ViewerPartitions> {
  const readable = viewer.workspaceId ? await workspaceReadable(ctx, viewer.actor, viewer.workspaceId) : true;
  const scopes = await Promise.all(kinds.map((kind) => sourceFor(kind).viewer(ctx, viewer, { workspaceReadable: readable })));
  const keys = [...new Set(scopes.flatMap((scope) => scope.keys))];
  let lexical = scopes.flatMap((scope) => scope.lexical);
  // The viewer's own items of every kind share one owner filter: one search instead of one per kind.
  const ownerScopes = lexical.filter((scope) => scope.ownerAccountId && !scope.workspaceKey && !scope.audienceKey);
  if (!viewer.workspaceId && ownerScopes.length === INDEXED_SEMANTIC_KINDS.length)
    lexical = [{ ownerAccountId: viewer.actor.accountId }, ...lexical.filter((scope) => !ownerScopes.includes(scope))];
  return {
    keys: keys.slice(0, MAX_VECTOR_PARTITIONS),
    lexical,
    grantedItemIds: scopes.flatMap((scope, index) => (scope.grantedItemIds ?? []).map((itemId) => ({ kind: kinds[index]!, itemId }))),
    truncated: keys.length > MAX_VECTOR_PARTITIONS,
    workspaceDenied: viewer.workspaceId ? !readable : undefined,
  };
}

/**
 * The mandatory read-time check. Returns only items the viewer can open right now, with their
 * current titles; anything deleted, unshared, out of school or otherwise unreadable is absent.
 */
export async function readableItems(ctx: QueryCtx, actor: AuthenticatedActor,
  refs: Array<{ kind: IndexedSemanticKind; itemId: string }>): Promise<Map<string, ReadableItem>> {
  const result = new Map<string, ReadableItem>();
  const unique = [...new Map(refs.map((ref) => [itemKeyOf(ref.kind, ref.itemId), ref])).values()];
  const helpers: ReadHelpers = { managebac: createManagebacVisibilityReader(ctx, actor) };
  await Promise.all(unique.map(async ({ kind, itemId }) => {
    const item = await sourceFor(kind).read(ctx, actor, itemId, helpers);
    if (item) result.set(itemKeyOf(kind, itemId), item);
  }));
  return result;
}
