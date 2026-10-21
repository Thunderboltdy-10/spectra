/**
 * A seeded Convex world for the semantic tests and evals (convex-test, in-process).
 *
 * School A: Ana (the viewer, with the fixture corpus and ManageBac access), Ben (a classmate with
 * private work, a shared workspace and a directly shared artifact). School B: Carla, whose work
 * uses the same words. Everything is indexed through the real pipeline: the backfill enqueues,
 * the queue dispatches, `reindexItem` chunks and embeds through `fetch`.
 */
/// <reference types="vite/client" />
import { vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "../../convex/schema";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import { daysFromNow, EVAL_NOW, FIXTURE_ITEMS, type FixtureItem } from "./fixtures";

const modules = import.meta.glob("../../convex/**/*.ts");
const DAY = 86_400_000;

export const IDENTITIES = {
  ana: { subject: "semantic-ana", email: "ana@a.example.test", emailVerified: true },
  ben: { subject: "semantic-ben", email: "ben@a.example.test", emailVerified: true },
  carla: { subject: "semantic-carla", email: "carla@b.example.test", emailVerified: true },
} as const;

type ArtifactInput = { ownerAccountId: Id<"accounts">; schoolId: Id<"schools">; blueprintKey: string; title: string; content: unknown;
  summary?: string; tags?: string[]; updatedAt?: number; workspaceId?: Id<"spectraWorkspaces">; sourceArtifactIds?: Id<"spectraArtifacts">[] };

export async function insertArtifact(ctx: MutationCtx, input: ArtifactInput) {
  const updatedAt = input.updatedAt ?? Date.now();
  const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: input.ownerAccountId, schoolId: input.schoolId,
    blueprintKey: input.blueprintKey, title: input.title, summary: input.summary, content: input.content, tags: input.tags ?? [],
    status: "active", createdAt: updatedAt, updatedAt,
    ...(input.sourceArtifactIds ? { createdFrom: { source: "artifact" as const, sourceArtifactIds: input.sourceArtifactIds } } : {}) });
  if (input.workspaceId)
    await ctx.db.insert("orgNodes", { accountId: input.ownerAccountId, schoolId: input.schoolId, parentId: null, kind: "work",
      name: input.title, sourceId: artifactId, orderKey: "a0", typeKey: input.blueprintKey, workspaceContextId: input.workspaceId,
      // Filed and shared with the workspace's people, as the fixture's authors chose.
      accessProjection: true, createdAt: updatedAt, updatedAt });
  return artifactId;
}

export async function insertThread(ctx: MutationCtx, input: { ownerAccountId: Id<"accounts">; schoolId: Id<"schools">; title: string;
  messages: Array<["user" | "assistant", string]>; updatedAt?: number; artifactId?: Id<"spectraArtifacts">; workspaceId?: Id<"spectraWorkspaces"> }) {
  const updatedAt = input.updatedAt ?? Date.now();
  const threadId = await ctx.db.insert("spectraThreads", { ownerAccountId: input.ownerAccountId, schoolId: input.schoolId, title: input.title,
    origin: "chat", status: "active", messageCount: input.messages.length, artifactId: input.artifactId, workspaceId: input.workspaceId,
    createdAt: updatedAt, updatedAt, lastMessageAt: updatedAt });
  for (const [index, [role, content]] of input.messages.entries())
    await ctx.db.insert("spectraMessages", { threadId, schoolId: input.schoolId, role, content, createdAt: updatedAt - 1_000 + index });
  return threadId;
}

export async function insertEvent(ctx: MutationCtx, input: { ownerAccountId: Id<"accounts">; schoolId: Id<"schools">; title: string;
  kind: "official_event" | "personal_event" | "task"; startAt: number; notes?: string; location?: string; sourceRecordId?: Id<"externalRecords"> }) {
  return ctx.db.insert("calendarItems", { ownerAccountId: input.ownerAccountId, schoolId: input.schoolId, kind: input.kind, title: input.title,
    notes: input.notes, location: input.location, startAt: input.startAt, endAt: input.startAt + 3_600_000, allDay: false, timezone: "UTC",
    timePrecision: "exact", status: "active", sourceLocked: false, linkedArtifactIds: [], revision: 1, createdBy: "human",
    sourceRecordId: input.sourceRecordId, createdAt: Date.now() - DAY, updatedAt: Date.now() - DAY });
}

async function seedSchool(ctx: MutationCtx, slug: string) {
  const now = Date.now();
  return ctx.db.insert("schools", { name: `School ${slug}`, slug, verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1,
    createdAt: now, updatedAt: now });
}

async function seedAccount(ctx: MutationCtx, identity: { subject: string; email: string }, schoolId: Id<"schools">) {
  const now = Date.now();
  const accountId = await ctx.db.insert("accounts", { clerkId: identity.subject, email: identity.email, emailVerified: true,
    name: identity.subject, status: "active", createdAt: now, updatedAt: now });
  await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
  return accountId;
}

function grant(ctx: MutationCtx, input: { schoolId: Id<"schools">; resourceType: "artifact" | "workspace"; resourceId: string;
  to: Id<"accounts">; by: Id<"accounts"> }) {
  const now = Date.now();
  return ctx.db.insert("accessGrants", { schoolId: input.schoolId, resourceType: input.resourceType, resourceId: input.resourceId,
    principalType: "account", principalId: input.to, level: "read", capabilities: ["read"], source: "direct", createdByAccountId: input.by,
    createdAt: now, updatedAt: now });
}

/** ManageBac for school A with Ana mapped, a member of Biology HL and with that class selected. */
async function seedManagebac(ctx: MutationCtx, schoolId: Id<"schools">, anaId: Id<"accounts">) {
  const now = Date.now();
  const integrationId = await ctx.db.insert("schoolIntegrations", {
    schoolId, provider: "managebac", baseUrl: "https://managebac.example.test", authHeaderName: "X-API-Key", authScheme: "raw",
    status: "connected", tokenMode: "read_only", secretPurpose: "test", manifestVersion: 1,
    capabilityCoverage: { discovered: 1, verifiedReadable: 1, unverified: 0, failed: 0, quarantined: 0 },
    syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: true, autoApplySafeUpdates: true, conflictMode: "review" },
    freshnessSlaMinutes: 60, requestBudgetPerMinute: 30, bootstrapVersion: 1, createdByAccountId: anaId, updatedByAccountId: anaId,
    createdAt: now, updatedAt: now });
  await ctx.db.insert("externalIdentityMappings", { integrationId, schoolId, accountId: anaId, providerUserId: "ana", verifiedEmailHash: "fixture",
    status: "verified", matchCount: 1, createdAt: now, updatedAt: now });
  await ctx.db.insert("externalRecords", { integrationId, schoolId, providerRecordId: "bio-member", providerRecordKey: "membership:bio",
    recordType: "membership", classification: "personal", audienceScope: "mapped_user", mappedAccountId: anaId, providerClassId: "bio-hl",
    academicPeriodKey: "2026", normalized: { title: "Biology HL" }, payloadVersion: "1", sourceHash: "member", tombstone: false,
    sourceState: "available", fetchedAt: now, createdAt: now, updatedAt: now });
  await ctx.db.insert("managebacClassSelections", { integrationId, schoolId, accountId: anaId, providerClassId: "bio-hl",
    providerRecordKey: "class:bio-hl", academicPeriodKey: "2026", selected: true, retention: "keep_in_spectra", selectionRevision: 1,
    createdAt: now, updatedAt: now });
  return integrationId;
}

export async function insertSchoolRecord(ctx: MutationCtx, input: { integrationId: Id<"schoolIntegrations">; schoolId: Id<"schools">;
  key: string; recordType: string; audience: "class" | "mine" | "school"; normalized: Record<string, unknown>; mappedAccountId?: Id<"accounts">;
  providerClassId?: string; updatedAt?: number }) {
  const updatedAt = input.updatedAt ?? Date.now();
  return ctx.db.insert("externalRecords", { integrationId: input.integrationId, schoolId: input.schoolId, providerRecordId: input.key,
    providerRecordKey: `${input.recordType}:${input.key}`, recordType: input.recordType,
    classification: input.audience === "mine" ? "personal" : input.audience === "class" ? "class" : "school",
    audienceScope: input.audience === "mine" ? "mapped_user" : input.audience === "class" ? "class_members" : "school",
    mappedAccountId: input.audience === "mine" ? input.mappedAccountId : undefined,
    providerClassId: input.audience === "class" ? input.providerClassId ?? "bio-hl" : undefined,
    academicPeriodKey: input.audience === "class" ? "2026" : undefined, normalized: input.normalized, payloadVersion: "1",
    sourceHash: `${input.key}:${JSON.stringify(input.normalized).length}`, tombstone: false, sourceState: "available",
    sourceModifiedAt: updatedAt, fetchedAt: updatedAt, createdAt: updatedAt, updatedAt });
}

async function seedFixtureItem(ctx: MutationCtx, item: FixtureItem, base: { anaId: Id<"accounts">; schoolId: Id<"schools">;
  integrationId: Id<"schoolIntegrations">; workspaces: Record<"biology" | "history", Id<"spectraWorkspaces">>; ids: Record<string, string> }) {
  const owner = { ownerAccountId: base.anaId, schoolId: base.schoolId };
  switch (item.kind) {
    case "artifact":
      return insertArtifact(ctx, { ...owner, blueprintKey: item.blueprintKey, title: item.title, content: item.content, summary: item.summary,
        tags: item.tags, updatedAt: daysFromNow(-item.updatedDaysAgo), workspaceId: item.workspace ? base.workspaces[item.workspace] : undefined });
    case "thread":
      return insertThread(ctx, { ...owner, title: item.title, messages: item.messages, updatedAt: daysFromNow(-item.updatedDaysAgo),
        artifactId: item.about ? base.ids[item.about] as Id<"spectraArtifacts"> : undefined });
    case "event":
      return insertEvent(ctx, { ...owner, title: item.title, kind: item.eventKind, startAt: daysFromNow(item.startInDays) - 3 * 3_600_000,
        notes: item.notes, location: item.location });
    case "school":
      return insertSchoolRecord(ctx, { integrationId: base.integrationId, schoolId: base.schoolId, key: item.key, recordType: item.recordType,
        audience: item.audience, normalized: { title: item.title, ...item.normalized }, mappedAccountId: base.anaId,
        updatedAt: daysFromNow(-item.updatedDaysAgo) });
  }
}

export type SemanticWorld = Awaited<ReturnType<typeof createSemanticWorld>>;

/** Seeds the world at EVAL_NOW (fake timers must be on). The fixture corpus is optional. */
export async function createSemanticWorld(options: { corpus?: boolean } = {}) {
  vi.setSystemTime(new Date(EVAL_NOW));
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"]) aggregateTest.register(t, name);
  const seeded = await t.run(async (ctx) => {
    const schoolA = await seedSchool(ctx, "a");
    const schoolB = await seedSchool(ctx, "b");
    const anaId = await seedAccount(ctx, IDENTITIES.ana, schoolA);
    const benId = await seedAccount(ctx, IDENTITIES.ben, schoolA);
    const carlaId = await seedAccount(ctx, IDENTITIES.carla, schoolB);
    const now = Date.now();
    const workspace = (ownerAccountId: Id<"accounts">, schoolId: Id<"schools">, title: string) => ctx.db.insert("spectraWorkspaces",
      { schoolId, ownerAccountId, title, status: "active", defaultView: "cards", lastActivityAt: now, createdAt: now, updatedAt: now });
    const workspaces = { biology: await workspace(anaId, schoolA, "Biology"), history: await workspace(anaId, schoolA, "History") };
    const integrationId = await seedManagebac(ctx, schoolA, anaId);
    const ids: Record<string, string> = {};
    if (options.corpus !== false)
      for (const item of FIXTURE_ITEMS)
        ids[item.key] = await seedFixtureItem(ctx, item, { anaId, schoolId: schoolA, integrationId, workspaces, ids });
    return { schoolA, schoolB, anaId, benId, carlaId, workspaces, integrationId, ids };
  });
  return { t, ...seeded, ana: t.withIdentity(IDENTITIES.ana), ben: t.withIdentity(IDENTITIES.ben), carla: t.withIdentity(IDENTITIES.carla),
    grant: (input: Parameters<typeof grant>[1]) => t.run((ctx) => grant(ctx, input)) };
}

/** Indexes everything through the real pipeline: backfill, queue, dispatch, reindex. */
export async function indexEverything(world: { t: SemanticWorld["t"] }, restart = true) {
  await world.t.mutation(internal.semanticIndex.startBackfill, { restart });
  await world.t.finishAllScheduledFunctions(vi.runAllTimers);
}

/** Lets pending trigger-driven re-index work finish (debounce, dispatch, reindex). */
export async function drainIndexQueue(world: { t: SemanticWorld["t"] }) {
  await world.t.finishAllScheduledFunctions(vi.runAllTimers);
}
