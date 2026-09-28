/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { artifactGraphPage, workspaceGraphPage, agentGraphPage, GRAPH_READ_ROWS, type ArtifactGraphArgs, type WorkspaceGraphArgs } from "./catalogGraph";
import { list as legacyWorkspaceList } from "./spectraWorkspaces";
import { syncSourceNodes, upsertArtifactSummary } from "./orgTreeShared";
import { evaluateArtifactAccessForActor } from "./authorityShared";
import { requireSpectraActor } from "./spectraShared";
import { observeDatabase, serializedBytes } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "graph-reader", email: "graph-reader@example.test", emailVerified: true };
beforeEach(() => vi.stubEnv("SPECTRA_SECRET_BRIDGE_KEY", "s11-graph-disposable-cursor-key-123456789"));
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.spectraArtifacts.backfillSummaries, { cursor: null });
  const ids = await t.run(async ctx => {
    const school = (slug: string) => ctx.db.insert("schools", { name: slug, slug, verifiedDomains: [], status: "active",
      timezone: "UTC", policyVersion: 1, createdAt: 1, updatedAt: 1 });
    const schoolId = await school("graph-school");
    const foreignSchoolId = await school("foreign-school");
    const account = (clerkId: string) => ctx.db.insert("accounts", { clerkId, email: `${clerkId}@example.test`,
      emailVerified: true, name: clerkId, status: "active", createdAt: 1, updatedAt: 1 });
    const readerId = await account(identity.subject);
    const ownerId = await account("graph-owner");
    const membershipId = await ctx.db.insert("schoolMemberships", { accountId: readerId, schoolId, role: "student",
      status: "active", joinedAt: 1, createdAt: 1, updatedAt: 1 });
    return { schoolId, foreignSchoolId, readerId, ownerId, membershipId };
  });
  const artifact = async (ctx: MutationCtx, title: string, updatedAt: number, options: Partial<Doc<"spectraArtifacts">> = {}) => {
    const id = await ctx.db.insert("spectraArtifacts", { ownerAccountId: ids.ownerId, schoolId: ids.schoolId,
      blueprintKey: "document", title, content: { text: "canonical body must not be hydrated" },
      status: "active", tags: [], createdAt: 1, updatedAt, ...options });
    await upsertArtifactSummary(ctx, (await ctx.db.get(id))!);
    return id;
  };
  const grant = (ctx: MutationCtx, resourceType: "artifact" | "agent" | "workspace", resourceId: string,
    options: Partial<Doc<"accessGrants">> = {}) => ctx.db.insert("accessGrants", { schoolId: ids.schoolId,
      resourceType, resourceId, principalType: "account", principalId: ids.readerId, level: "read", capabilities: ["read"],
      source: "direct", createdByAccountId: ids.ownerId, createdAt: 1, updatedAt: 1, ...options });
  const workspace = (ctx: MutationCtx, title: string, options: Partial<Doc<"spectraWorkspaces">> = {}) =>
    ctx.db.insert("spectraWorkspaces", { ownerAccountId: ids.ownerId, schoolId: ids.schoolId, title, status: "active",
      defaultView: "cards", createdAt: 1, updatedAt: 1, lastActivityAt: 10, ...options });
  const placement = (ctx: MutationCtx, sourceId: string, workspaceContextId?: Id<"spectraWorkspaces">,
    options: Partial<Doc<"orgNodes">> = {}) => ctx.db.insert("orgNodes", { accountId: ids.ownerId, schoolId: ids.schoolId,
      kind: "work", sourceId, workspaceContextId, parentId: null, orderKey: sourceId, name: "placement", accessProjection: true,
      activityAt: 1, createdAt: 1, updatedAt: 1, ...options });
  const user = t.withIdentity(identity);
  const page = (args: ArtifactGraphArgs = {}) => user.run(async ctx => {
    const observer = observeDatabase(ctx.db);
    const result = await artifactGraphPage({ ...ctx, db: observer.db }, args);
    return { result, ...observer.snapshot(), responseBytes: serializedBytes(result) };
  });
  const workspacePage = (args: WorkspaceGraphArgs = {}) => user.run(async ctx => {
    const observer = observeDatabase(ctx.db);
    const result = await workspaceGraphPage({ ...ctx, db: observer.db }, args);
    return { result, ...observer.snapshot(), responseBytes: serializedBytes(result) };
  });
  return { t, user, ids, artifact, grant, workspace, placement, page, workspacePage };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Measurement = Awaited<ReturnType<Fixture["page"]>>;

function checkBudget(m: Measurement) {
  expect(m.calls).toBe(m.result.budget.readCalls);
  expect(m.documentsReturned).toBeLessThanOrEqual(m.result.budget.reservedRows);
  expect(m.result.budget.reservedRows).toBeLessThanOrEqual(GRAPH_READ_ROWS);
  expect(m.reads.filter(r => r.operation === "paginate").length).toBe(m.result.budget.nativePaginations);
  expect(m.result.budget.nativePaginations).toBeLessThanOrEqual(1);
  expect(m.reads.every(r => !r.postIndexFilter && r.operation !== "collect")).toBe(true);
  expect(m.reads.some(r => r.table === "spectraArtifacts" || r.index?.startsWith("by_school_status_updated"))).toBe(false);
  expect(m.writes).toBe(0);
  if (m.result.phase !== "ready") { expect(m.result.items).toEqual([]); expect(m.result.isDone).toBe(false); }
  if (!m.result.isDone) expect(m.result.continueCursor!.length).toBeLessThanOrEqual(16_384);
}
async function traverse(page: (cursor?: string) => Promise<Measurement>) {
  const start = performance.now();
  const stats = { requests: 0, readCalls: 0, rows: 0, rowBytes: 0, responseBytes: 0, firstVisibleRequest: 0, maxReservedRows: 0, maxRequestRowBytes: 0, maxCursorBytes: 0, resultPages: 0 };
  const found: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  while (stats.requests < 10_000) {
    const m = await page(cursor);
    checkBudget(m);
    stats.requests++;
    stats.readCalls += m.calls;
    stats.rows += m.documentsReturned;
    stats.rowBytes += m.serializedDocumentBytes;
    stats.responseBytes += m.responseBytes;
    stats.maxReservedRows = Math.max(stats.maxReservedRows, m.result.budget.reservedRows);
    stats.maxRequestRowBytes = Math.max(stats.maxRequestRowBytes, m.serializedDocumentBytes);
    stats.maxCursorBytes = Math.max(stats.maxCursorBytes, m.result.continueCursor?.length ?? 0);
    if (m.result.items.length && !stats.firstVisibleRequest) stats.firstVisibleRequest = stats.requests;
    if (m.result.phase === "ready") stats.resultPages++;
    found.push(...m.result.items);
    if (m.result.isDone) return { found, ...stats, elapsedMs: performance.now() - start };
    expect(m.result.continueCursor).not.toBe(cursor);
    cursor = m.result.continueCursor!;
  }
  throw new Error("Traversal did not complete");
}

async function assemble(f: Fixture, startingCursor?: string) {
  let cursor = startingCursor;
  for (let i = 0; i < 100; i++) {
    const m = await f.page({ cursor });
    checkBudget(m);
    expect(m.result.items).toEqual([]);
    cursor = m.result.continueCursor!;
    if (m.result.phase === "revalidating") return cursor;
  }
  throw new Error("Page assembly did not complete");
}

async function basicGraph(f: Fixture) {
  return f.t.run(async ctx => {
    const owned = await f.artifact(ctx, "Owned", 100, { ownerAccountId: f.ids.readerId });
    const direct = await f.artifact(ctx, "Direct", 90);
    const directGrant = await f.grant(ctx, "artifact", direct);
    const inherited = await f.artifact(ctx, "Inherited", 110);
    let inheritedGrant: Id<"accessGrants"> | undefined;
    for (let i = 0; i < 18; i++) {
      const w = await f.workspace(ctx, `Context ${i}`);
      await f.placement(ctx, inherited, w);
      if (i === 17) inheritedGrant = await f.grant(ctx, "workspace", w);
    }
    return { owned, direct, inherited, directGrant, inheritedGrant: inheritedGrant! };
  });
}

describe("S11 actor graph prototype", () => {
  it("registers current workspace metadata and bounded agent cards without native bodies or release-history scans", async () => {
    const f = await fixture();
    const ids = await f.t.run(async ctx => {
      const workspaceId = await f.workspace(ctx, "Selected outside the first page", { ownerAccountId: f.ids.readerId });
      const agentId = await f.artifact(ctx, "Agent", 1, { blueprintKey: "agent", ownerAccountId: f.ids.readerId });
      const versionId = await ctx.db.insert("spectraArtifactVersions", { artifactId: agentId, ownerAccountId: f.ids.readerId, source: "manual", createdAt: 1 });
      for (const [releaseNumber, rollout] of [[10, undefined], [7, "published"], [99, "internal_test"], [100, "limited"]] as const) {
        await ctx.db.insert("agentReleases", { agentId, schoolId: f.ids.schoolId, versionId, releaseNumber, rollout,
          status: "published", publishedByAccountId: f.ids.readerId, publishedAt: releaseNumber });
      }
      return { workspaceId, agentId };
    });
    const identity = await f.user.query(api.catalogGraph.identity, {});
    expect(identity?.membershipId).toBe(f.ids.membershipId);
    const selected = await f.user.query(api.catalogGraph.workspaceMetadata, { workspaceId: ids.workspaceId });
    expect(selected.workspace?._id).toBe(ids.workspaceId);
    const result = await traverse(cursor => f.user.run(async ctx => {
      const observer = observeDatabase(ctx.db);
      const result = await agentGraphPage({ ...ctx, db: observer.db }, { cursor });
      return { result, ...observer.snapshot(), responseBytes: serializedBytes(result) };
    }));
    expect(result.found).toMatchObject([{ _id: ids.agentId, owner: { name: "graph-reader" }, agentRelease: { releaseNumber: 10 }, placementsComplete: false }]);
    expect(result.found[0]).not.toHaveProperty("content");
    const registered = await f.user.query(api.catalogGraph.listAgents, {});
    expect(registered.isDone).toBe(false);
    expect(registered.continueCursor).toBeTruthy();
    await f.t.run(ctx => ctx.db.patch(f.ids.membershipId, { status: "ended" }));
    expect(await f.user.query(api.catalogGraph.identity, {})).toBeNull();
    await expect(f.user.query(api.catalogGraph.workspaceMetadata, { workspaceId: ids.workspaceId })).rejects.toThrow();
  });

  it("compares the real workspace caller read with compact traversal in a bounded invitation-history fixture", async () => {
    const f = await fixture();
    const workspaceId = await f.t.run(async ctx => {
      const id = await f.workspace(ctx, "Workspace", { ownerAccountId: f.ids.readerId });
      for (let i = 0; i < 64; i++) await ctx.db.insert("shareInvitations", { schoolId: f.ids.schoolId, resourceType: "workspace",
        resourceId: id, inviterAccountId: f.ids.readerId, inviteeAccountId: f.ids.ownerId, level: "read", status: "expired",
        message: "historical invitation ".repeat(200), createdAt: i, updatedAt: i });
      return id;
    });
    const before = await f.user.run(async ctx => {
      const observer = observeDatabase(ctx.db);
      const handler = (legacyWorkspaceList as unknown as { _handler: (ctx: QueryCtx, args: Record<string, never>) => Promise<Array<{ _id: string }>> })._handler;
      const result = await handler({ ...ctx, db: observer.db }, {});
      return { ids: result.map(row => row._id), ...observer.snapshot(), responseBytes: serializedBytes(result) };
    });
    const after = await traverse(cursor => f.workspacePage({ cursor }));
    expect(before.ids).toEqual([workspaceId]);
    expect(after.found.map(row => row._id)).toEqual(before.ids);
    expect(after.rowBytes).toBeLessThan(before.serializedDocumentBytes / 10);
    if (process.env.SPECTRA_S11_GRAPH_EVIDENCE === "write") writeFileSync(".spectra-local/launch-s11/data/workspace-caller-comparison.json",
      JSON.stringify({ kind: "Actual old handler versus complete graph traversal, fixed64expired invitations; convex-test returned-row bytes, not hosted engine or billing.", before, after }, null, 2));
  });
  it("marks the reader's own workspaces they have shared, with one bounded read per status", async () => {
    const f = await fixture();
    const ids = await f.t.run(async ctx => {
      const invite = (resourceId: string, status: Doc<"shareInvitations">["status"], expiresAt?: number) =>
        ctx.db.insert("shareInvitations", { schoolId: f.ids.schoolId, resourceType: "workspace", resourceId,
          inviterAccountId: f.ids.readerId, inviteeAccountId: f.ids.ownerId, level: "read", status,
          ...(expiresAt ? { expiresAt } : {}), createdAt: 1, updatedAt: 1 });
      const accepted = await f.workspace(ctx, "Accepted", { ownerAccountId: f.ids.readerId, lastActivityAt: 4 });
      await invite(accepted, "revoked");
      await invite(accepted, "accepted");
      const pending = await f.workspace(ctx, "Pending", { ownerAccountId: f.ids.readerId, lastActivityAt: 3 });
      await invite(pending, "pending", Date.now() + 60_000);
      const lapsed = await f.workspace(ctx, "Lapsed", { ownerAccountId: f.ids.readerId, lastActivityAt: 2 });
      await invite(lapsed, "pending", 1);
      await invite(lapsed, "revoked");
      const privateOne = await f.workspace(ctx, "Private", { ownerAccountId: f.ids.readerId, lastActivityAt: 1 });
      return { accepted, pending, lapsed, privateOne };
    });
    const { found } = await traverse(cursor => f.workspacePage({ cursor }));
    const shared = Object.fromEntries(found.map(item => [item._id, item.isShared === true]));
    expect(shared).toEqual({ [ids.accepted]: true, [ids.pending]: true, [ids.lapsed]: false, [ids.privateOne]: false });
    const selected = await f.user.query(api.catalogGraph.workspaceMetadata, { workspaceId: ids.accepted });
    expect(selected.workspace).toMatchObject({ ownership: "owned", isShared: true });
  });

  it("keeps complete traversal independent of unrelated private density", async () => {
    const f = await fixture();
    const ids = await basicGraph(f);
    const samples = [];
    let inserted = 0;
    // Fixture insertion, not traversal, dominates at 10,000 rows (~150 s in
    // convex-test), so the default run stops at 2,048; evidence mode adds it.
    const densities = process.env.SPECTRA_S11_GRAPH_EVIDENCE === "write" ? [0, 128, 1_024, 10_000] : [0, 128, 2_048];
    for (const unrelated of densities) {
      await f.t.run(async ctx => {
        for (; inserted < unrelated; inserted++) {
          const id = await f.artifact(ctx, "Unrelated private", 10_000 + inserted);
          await f.placement(ctx, id);
        }
      });
      const sample = await traverse(cursor => f.page({ cursor, limit: 2 }));
      expect(sample.found.map(r => r._id)).toEqual([ids.inherited, ids.owned, ids.direct]);
      samples.push({ unrelated, ...sample, found: undefined });
    }
    for (const sample of samples.slice(1)) {
      for (const key of ["requests", "readCalls", "rows", "rowBytes", "firstVisibleRequest"] as const)
        expect(sample[key]).toBe(samples[0]![key]);
    }
    if (process.env.SPECTRA_S11_GRAPH_EVIDENCE === "write") {
      const path = ".spectra-local/launch-s11/data";
      mkdirSync(path, { recursive: true });
      writeFileSync(`${path}/graph-density.json`, JSON.stringify({ semantics: "Actual kernel, convex-test returned-row bytes; not hosted billing/engine scans",
        sha256: createHash("sha256").update(readFileSync("convex/catalogGraph.ts")).digest("hex"), samples }, null, 2));
    }
  }, process.env.SPECTRA_S11_GRAPH_EVIDENCE === "write" ? 900_000 : 180_000);

  it("matches actual source authority across principals, types, inheritance and school boundaries", async () => {
    const f = await fixture();
    const { candidates, expected } = await f.t.run(async ctx => {
      const candidates: Id<"spectraArtifacts">[] = [];
      const expected: Id<"spectraArtifacts">[] = [];
      const add = async (title: string, allowed: boolean, options: Partial<Doc<"spectraArtifacts">> = {}) => {
        const id = await f.artifact(ctx, title, 100, options); candidates.push(id); if (allowed) expected.push(id); return id;
      };
      await add("owner", true, { ownerAccountId: f.ids.readerId });
      await f.grant(ctx, "artifact", await add("direct", true));
      await f.grant(ctx, "agent", await add("agent", true, { blueprintKey: "agent" }));
      await f.grant(ctx, "artifact", await add("wrong agent grant", false, { blueprintKey: "agent" }));
      await f.grant(ctx, "agent", await add("wrong artifact grant", false));
      await f.grant(ctx, "artifact", await add("school", true), { principalType: "school", principalId: f.ids.schoolId });
      await f.grant(ctx, "artifact", await add("public alone", false), { principalType: "public", principalId: undefined });
      await f.grant(ctx, "artifact", await add("expired", false), { expiresAt: 1 });
      await f.grant(ctx, "artifact", await add("revoked", false), { revokedAt: 1 });
      await f.grant(ctx, "artifact", await add("zero timestamps", true), { revokedAt: 0, expiresAt: 0 });
      await f.grant(ctx, "artifact", await add("cached inheritance", false), { source: "workspace_inheritance" });
      await f.grant(ctx, "artifact", await add("foreign direct", true, { schoolId: f.ids.foreignSchoolId }));
      await f.grant(ctx, "artifact", await add("foreign school", false, { schoolId: f.ids.foreignSchoolId }), { principalType: "school", principalId: f.ids.schoolId });
      await add("foreign nominal owner", false, { schoolId: f.ids.foreignSchoolId, ownerAccountId: f.ids.readerId });
      await f.grant(ctx, "artifact", await add("school-less direct", true, { schoolId: undefined }));
      const w = await f.workspace(ctx, "Granted");
      await f.grant(ctx, "workspace", w, { principalType: "school", principalId: f.ids.schoolId });
      await f.placement(ctx, await add("inherited", true), w);
      await f.placement(ctx, await add("legacy owner match", true), w, { accessProjection: undefined });
      await f.placement(ctx, await add("no projection", false), w, { accessProjection: false });
      await f.placement(ctx, await add("deleted placement", false), w, { deletedAt: 0 });
      await f.placement(ctx, await add("legacy mismatch", false, { ownerAccountId: f.ids.readerId, schoolId: undefined }), w, { accessProjection: undefined });
      for (const effect of ["deny", "restrict"] as const) {
        const id = await add(effect, effect === "restrict");
        await f.placement(ctx, id, w);
        await ctx.db.insert("artifactAccessOverrides", { artifactId: id, accountId: f.ids.readerId, schoolId: f.ids.schoolId,
          effect, maxLevel: "read", createdByAccountId: f.ids.ownerId, createdAt: 1, updatedAt: 1 });
      }
      const directDeny = await add("direct survives deny", true);
      await f.grant(ctx, "artifact", directDeny);
      await ctx.db.insert("artifactAccessOverrides", { artifactId: directDeny, accountId: f.ids.readerId, schoolId: f.ids.schoolId,
        effect: "deny", createdByAccountId: f.ids.ownerId, createdAt: 1, updatedAt: 1 });
      const ownWorkspace = await f.workspace(ctx, "Personal", { ownerAccountId: f.ids.readerId });
      await f.placement(ctx, await add("personal placement not authority", false), ownWorkspace, { accountId: f.ids.readerId });
      const foreignWorkspace = await f.workspace(ctx, "Foreign", { schoolId: f.ids.foreignSchoolId });
      await f.grant(ctx, "workspace", foreignWorkspace);
      await f.placement(ctx, await add("foreign workspace not inheritance", false), foreignWorkspace);
      const archived = await f.workspace(ctx, "Archived", { status: "archived" });
      await f.grant(ctx, "workspace", archived);
      await f.placement(ctx, await add("inactive workspace", false), archived);
      return { candidates, expected: expected.sort().reverse() };
    });
    // Full central authority is a separately executed oracle, never hidden
    // inside the measured kernel request or its reported cost.
    const oracle = await f.user.run(async ctx => {
      const actor = await requireSpectraActor(ctx);
      const result = [];
      for (const id of candidates) if ((await evaluateArtifactAccessForActor(ctx, actor, id)).allowed) result.push(id);
      return result.sort().reverse();
    });
    expect(oracle).toEqual(expected);
    const result = await traverse(cursor => f.page({ cursor, limit: 3 }));
    expect(result.found.map(r => r._id)).toEqual(expected);
    // Shared-only discovery is the same authority minus owned rows, and it
    // never reads the owner's artifact stream.
    const owned = new Set(result.found.filter(r => r.ownership === "owned").map(r => r._id));
    expect(owned.size).toBe(1);
    const shared = await traverse(cursor => f.page({ cursor, limit: 3, placement: "shared" }));
    expect(shared.found.map(r => r._id)).toEqual(expected.filter(id => !owned.has(id)));
  });

  it("finishes unsorted grant and node streams, dedupes tied keys, and searches late matches", async () => {
    const f = await fixture();
    const ids = await f.t.run(async ctx => {
      const w = await f.workspace(ctx, "Unsorted nodes");
      await f.grant(ctx, "workspace", w);
      const ids: Array<{ id: Id<"spectraArtifacts">; time: number }> = [];
      for (let i = 0; i < 28; i++) {
        const time = i < 20 ? i : 200;
        const id = await f.artifact(ctx, i === 27 ? "Needle late match" : `Work ${i}`, time);
        await f.grant(ctx, "artifact", id);
        await f.placement(ctx, id, w, { activityAt: 1000 - i });
        await f.placement(ctx, id, w, { activityAt: i });
        ids.push({ id, time });
      }
      return ids.sort((a, b) => b.time - a.time || (a.id > b.id ? -1 : 1));
    });
    const all = await traverse(cursor => f.page({ cursor, limit: 4 }));
    expect(all.found.map(r => r._id)).toEqual(ids.map(r => r.id));
    const search = await traverse(cursor => f.page({ cursor, search: "needle", limit: 1 }));
    expect(search.found).toHaveLength(1);
    expect(search.found[0]!.title).toBe("Needle late match");
  });

  it("revalidates revoke, source mutation and cursor retry without stale emissions", async () => {
    const f = await fixture();
    const ids = await basicGraph(f);
    // Reach the final proof query without emitting the assembled buffer.
    const cursor = await assemble(f);
    const retryA = await f.page({ cursor });
    const retryB = await f.page({ cursor });
    expect(retryA.result).toEqual(retryB.result);
    await f.t.run(async ctx => {
      await ctx.db.patch(ids.directGrant, { revokedAt: Date.now() });
      await ctx.db.patch(ids.inherited, { updatedAt: 120 });
      await upsertArtifactSummary(ctx, (await ctx.db.get(ids.inherited))!);
    });
    const result = await traverse(next => f.page({ cursor: next ?? cursor }));
    expect(result.found.map(r => r._id)).toEqual([ids.inherited, ids.owned]);
    await expect(f.page({ cursor, search: "different" })).rejects.toThrow("CATALOG_CURSOR_INVALID");
    await expect(f.page({ cursor, limit: 2 })).rejects.toThrow("CATALOG_CURSOR_INVALID");
    await expect(f.page({ cursor: `${cursor!.slice(0, -4)}xxxx` })).rejects.toThrow("CATALOG_CURSOR_INVALID");
    await f.t.run(ctx => ctx.db.patch(f.ids.readerId, { status: "deactivated" }));
    await expect(f.page({ cursor })).rejects.toThrow("AUTH_NO_SCHOOL");
  });

  it("orders workspaces including tied owner rows, direct cross-school shares and complete search", async () => {
    const f = await fixture();
    const expected = await f.t.run(async ctx => {
      const visible: string[] = [];
      for (let i = 0; i < 12; i++) visible.push(await f.workspace(ctx, `Owned ${i}`, { ownerAccountId: f.ids.readerId }));
      const shared = await f.workspace(ctx, "Late shared match", { schoolId: f.ids.foreignSchoolId });
      await f.grant(ctx, "workspace", shared);
      visible.push(shared);
      await f.workspace(ctx, "Unrelated newest", { lastActivityAt: 1000 });
      const archived = await f.workspace(ctx, "Archive", { ownerAccountId: f.ids.readerId, status: "archived" });
      return { visible: visible.sort().reverse(), archived };
    });
    const result = await traverse(cursor => f.workspacePage({ cursor, limit: 3 }));
    expect(result.found.map(r => r._id)).toEqual(expected.visible);
    const search = await traverse(cursor => f.workspacePage({ cursor, search: "late shared" }));
    expect(search.found).toHaveLength(1);
    const archived = await traverse(cursor => f.workspacePage({ cursor, includeArchived: true }));
    expect(archived.found.map(r => r._id)).toEqual([...expected.visible, expected.archived].sort().reverse());
  });

  it.each(["grant", "expiry", "workspace", "placement", "override", "source"] as const)("rechecks inherited %s before emission", async change => {
    const f = await fixture();
    const ids = await f.t.run(async ctx => {
      const source = await f.artifact(ctx, "Inherited", 100);
      const workspace = await f.workspace(ctx, "Shared");
      const grant = await f.grant(ctx, "workspace", workspace);
      const node = await f.placement(ctx, source, workspace);
      return { source, workspace, grant, node };
    });
    const cursor = await assemble(f);
    await f.t.run(async ctx => {
      if (change === "grant") await ctx.db.patch(ids.grant, { revokedAt: 1 });
      if (change === "expiry") await ctx.db.patch(ids.grant, { expiresAt: 1 });
      if (change === "workspace") await ctx.db.patch(ids.workspace, { status: "archived" });
      if (change === "placement") await ctx.db.patch(ids.node, { accessProjection: false });
      if (change === "override") await ctx.db.insert("artifactAccessOverrides", { artifactId: ids.source,
        accountId: f.ids.readerId, effect: "deny", createdByAccountId: f.ids.ownerId, createdAt: 1, updatedAt: 1 });
      if (change === "source") {
        await ctx.db.patch(ids.source, { status: "deleted" });
        await upsertArtifactSummary(ctx, (await ctx.db.get(ids.source))!);
      }
    });
    const result = await traverse(next => f.page({ cursor: next ?? cursor }));
    expect(result.found).toEqual([]);
  });

  it("keeps search from probing shared quiz answers or timetable internals", async () => {
    const f = await fixture();
    const owned = await f.t.run(async ctx => {
      const owned = await f.artifact(ctx, "Owned quiz", 1, { ownerAccountId: f.ids.readerId, blueprintKey: "quiz" });
      const shared = await f.artifact(ctx, "Shared quiz", 2, { blueprintKey: "quiz" });
      const timetable = await f.artifact(ctx, "Timetable", 3, { ownerAccountId: f.ids.readerId, blueprintKey: "timetable" });
      await f.grant(ctx, "artifact", shared);
      for (const id of [owned, shared, timetable]) {
        const row = await ctx.db.query("spectraArtifactSummaries").withIndex("by_artifact", q => q.eq("artifactId", id)).unique();
        await ctx.db.patch(row!._id, { searchText: "SECRET ANSWER" });
      }
      return owned;
    });
    const result = await traverse(cursor => f.page({ cursor, search: "secret answer" }));
    expect(result.found.map(r => r._id)).toEqual([owned]);
  });

  it("binds cursors to current school and detects the complete membership invariant", async () => {
    const f = await fixture();
    const cursor = (await f.page()).result.continueCursor!;
    await f.t.run(ctx => ctx.db.patch(f.ids.membershipId, { schoolId: f.ids.foreignSchoolId }));
    await expect(f.page({ cursor })).rejects.toThrow("CATALOG_CURSOR_INVALID");
    await f.t.run(ctx => ctx.db.insert("schoolMemberships", { accountId: f.ids.readerId, schoolId: f.ids.schoolId,
      role: "student", status: "active", joinedAt: 1, createdAt: 1, updatedAt: 1 }));
    await expect(f.page()).rejects.toThrow("IDENTITY_INVARIANT");
  });

  it("bounds repeated mutation restarts instead of looping indefinitely", async () => {
    const f = await fixture();
    const id = await f.t.run(async ctx => {
      const id = await f.artifact(ctx, "Changing", 1);
      await f.grant(ctx, "artifact", id);
      return id;
    });
    let cursor: string | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      cursor = await assemble(f, cursor);
      await f.t.run(async ctx => {
        await ctx.db.patch(id, { updatedAt: 2 + attempt });
        await upsertArtifactSummary(ctx, (await ctx.db.get(id))!);
      });
      if (attempt === 3) await expect(f.page({ cursor })).rejects.toThrow("CATALOG_CHANGED_RESTART");
      else {
        const m = await f.page({ cursor });
        checkBudget(m);
        expect(m.result.phase).toBe("restarted");
        cursor = m.result.continueCursor!;
      }
    }
  });

  it("measures actual graph size, revoked history, duplicate workspaces and result-page rescans separately", async () => {
    const samples = [];
    for (const shape of [
      { direct: 8, history: 0, workspaces: 1, duplicateGrants: 1, limit: 24 },
      { direct: 64, history: 0, workspaces: 1, duplicateGrants: 1, limit: 24 },
      { direct: 8, history: 128, workspaces: 1, duplicateGrants: 1, limit: 24 },
      { direct: 8, history: 0, workspaces: 8, duplicateGrants: 1, limit: 24 },
      { direct: 8, history: 0, workspaces: 1, duplicateGrants: 16, limit: 24 },
      { direct: 8, history: 0, workspaces: 1, duplicateGrants: 1, limit: 2 },
    ]) {
      const f = await fixture();
      const count = await f.t.run(async ctx => {
        let count = 0;
        for (let i = 0; i < shape.direct; i++) { const id = await f.artifact(ctx, "Direct", ++count); await f.grant(ctx, "artifact", id); }
        for (let i = 0; i < shape.history; i++) await f.grant(ctx, "artifact", `unavailable-${i}`, { revokedAt: 1 });
        for (let w = 0; w < shape.workspaces; w++) {
          const workspace = await f.workspace(ctx, "Shared");
          for (let g = 0; g < shape.duplicateGrants; g++) await f.grant(ctx, "workspace", workspace);
          for (let i = 0; i < 8; i++) await f.placement(ctx, await f.artifact(ctx, "Inherited", ++count), workspace);
        }
        return count;
      });
      const sample = await traverse(cursor => f.page({ cursor, limit: shape.limit }));
      expect(sample.found).toHaveLength(count);
      samples.push({ shape, ...sample, found: undefined });
    }
    if (process.env.SPECTRA_S11_GRAPH_EVIDENCE === "write") {
      mkdirSync(".spectra-local/launch-s11/data", { recursive: true });
      writeFileSync(".spectra-local/launch-s11/data/graph-scaling.json", JSON.stringify({ samples }, null, 2));
    }
  }, 120_000);

  it("accounts for existing source-update fanout and estimates incremental mirrored-grant storage separately", async () => {
    const samples = [];
    for (const shape of [{ grants: 0, placements: 0 }, { grants: 32, placements: 8 }, { grants: 128, placements: 32 }]) {
      const f = await fixture();
      const id = await f.t.run(async ctx => {
        const id = await f.artifact(ctx, "Fanout source", 100);
        for (let i = 0; i < shape.grants; i++) await f.grant(ctx, "artifact", id, { principalId: `recipient-${i}` });
        for (let i = 0; i < shape.placements; i++) {
          const node = await f.placement(ctx, id);
          for (let j = 0; j < 2; j++) await f.placement(ctx, node, undefined, { kind: "link" });
        }
        return id;
      });
      const measured = await f.t.run(async ctx => {
        const observer = observeDatabase(ctx.db);
        await syncSourceNodes({ ...ctx, db: observer.db }, "work", id, "Fanout source");
        return observer.snapshot();
      });
      expect(measured.writes).toBe(shape.placements * 3);
      const estimate = await f.t.run(async ctx => {
        const grants = await ctx.db.query("accessGrants").withIndex("by_resource", q => q.eq("resourceType", "artifact").eq("resourceId", id)).collect();
        return { grantRowsRequiringBackfill: grants.length, extraGrantWritesPerSourceUpdate: grants.length,
          illustrativeAddedGrantJsonBytes: grants.reduce((sum, grant) => sum + serializedBytes({ ...grant,
            catalogUpdatedAt: 100, catalogStatus: "active" }) - serializedBytes(grant), 0) };
      });
      samples.push({ shape, existingSourceNodeMaintenance: measured, mirroredGrantEstimate: estimate });
    }
    if (process.env.SPECTRA_S11_GRAPH_EVIDENCE === "write") {
      mkdirSync(".spectra-local/launch-s11/data", { recursive: true });
      writeFileSync(".spectra-local/launch-s11/data/graph-maintenance.json", JSON.stringify({
        semantics: "Measured existing syncSourceNodes helper; mirrored-grant fields/write and backfill counts are a labeled estimate, no index/storage migration implemented. JSON bytes exclude physical index storage.", samples }, null, 2));
    }
  });
});
