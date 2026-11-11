/// <reference types="vite/client" />
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import schema from "./schema";
import type { QueryCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { containersPage, listChildren, searchPage, quickViewPage, recentWorks } from "./orgTree";
import { upsertArtifactSummary } from "./orgTreeShared";
import { sharedByActor } from "./orgTreeViews";
import { forArtifact } from "./sharingPeople";
import { evaluateAccess } from "./authorityShared";
import { observeDatabase, serializedBytes } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "perf-pages", email: "perf-pages@example.test", emailVerified: true };
function queryHandler<Reference extends FunctionReference<"query">>(registered: object) {
  return Reflect.get(registered, "_handler") as (
    ctx: QueryCtx, args: FunctionArgs<Reference>,
  ) => Promise<FunctionReturnType<Reference>>;
}
const listChildrenHandler = queryHandler<typeof api.orgTree.listChildren>(listChildren);
const containersPageHandler = queryHandler<typeof api.orgTree.containersPage>(containersPage);
const searchPageHandler = queryHandler<typeof api.orgTree.searchPage>(searchPage);
const quickViewPageHandler = queryHandler<typeof api.orgTree.quickViewPage>(quickViewPage);
const recentWorksHandler = queryHandler<typeof api.orgTree.recentWorks>(recentWorks);
const sharingPeopleHandler = queryHandler<typeof api.sharingPeople.forArtifact>(forArtifact);
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "PERF pages", slug: "perf-pages", verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: identity.subject, email: identity.email, emailVerified: true, name: "PERF reader", status: "active", createdAt: now, updatedAt: now });
    const ownerId = await ctx.db.insert("accounts", { clerkId: "perf-pages-owner", email: "perf-pages-owner@example.test", emailVerified: true, name: "PERF owner", status: "active", createdAt: now, updatedAt: now });
    for (const id of [accountId, ownerId]) await ctx.db.insert("schoolMemberships", { accountId: id, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const folderId = await ctx.db.insert("orgNodes", { accountId, schoolId, parentId: null, kind: "folder", name: "Reader folder", orderKey: "a", createdAt: now, updatedAt: now });
    return { now, schoolId, accountId, ownerId, folderId };
  });
  const user = t.withIdentity(identity);
  const measure = <T,>(handler: (ctx: QueryCtx) => Promise<T>) => user.run(async (ctx) => {
    const observer = observeDatabase(ctx.db);
    const result = await handler({ ...ctx, db: observer.db });
    return { result, responseBytes: serializedBytes(result), ...observer.snapshot() };
  });
  return { t, ids, user, measure };
}

describe("PERF independent actor-scoped pagination", () => {
  async function peopleFixture(mode: "none" | "direct" | "workspace" | "revoked", expiresAt?: number) {
    const f = await fixture();
    const artifactId = await f.t.run(async ctx => {
      const id = await ctx.db.insert("spectraArtifacts", { ownerAccountId: f.ids.accountId, schoolId: f.ids.schoolId,
        blueprintKey: "document", title: "People clock", content: {}, tags: [], status: "active", createdAt: f.ids.now, updatedAt: f.ids.now });
      let resourceId: string = id;
      if (mode === "workspace") {
        resourceId = await ctx.db.insert("spectraWorkspaces", { ownerAccountId: f.ids.accountId, schoolId: f.ids.schoolId,
          title: "People workspace", status: "active", defaultView: "cards", createdAt: f.ids.now, updatedAt: f.ids.now, lastActivityAt: f.ids.now });
        await ctx.db.insert("orgNodes", { accountId: f.ids.accountId, schoolId: f.ids.schoolId, parentId: null,
          kind: "work", sourceId: id, name: "People clock", orderKey: "p", workspaceContextId: ctx.db.normalizeId("spectraWorkspaces", resourceId)!,
          accessProjection: true, createdAt: f.ids.now, updatedAt: f.ids.now });
      }
      if (mode !== "none") await ctx.db.insert("accessGrants", { schoolId: f.ids.schoolId,
        resourceType: mode === "workspace" ? "workspace" : "artifact", resourceId, principalType: "account", principalId: f.ids.ownerId,
        level: "read", capabilities: ["read"], source: "direct", createdByAccountId: f.ids.accountId,
        expiresAt, ...(mode === "revoked" ? { revokedAt: f.ids.now } : {}), createdAt: f.ids.now, updatedAt: f.ids.now });
      return id;
    });
    return { ...f, artifactId };
  }

  it.each(["none", "direct", "workspace", "revoked"] as const)("keeps %s people metadata independent of the clock when no grant can expire", async mode => {
    const f = await peopleFixture(mode);
    const reading = await f.measure(async ctx => {
      const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw Error("People metadata has no live expiring grant"); });
      try { return await sharingPeopleHandler(ctx, { artifactId: f.artifactId }); } finally { clock.mockRestore(); }
    });
    expect(reading.result?.people.map(p => p.accountId)).toEqual(mode === "direct" || mode === "workspace"
      ? [f.ids.accountId, f.ids.ownerId] : [f.ids.accountId]);
    expect(reading.writes).toBe(0);
  });

  it.each(["direct", "workspace"] as const)("keeps exact expiry for %s people grants", async mode => {
    const f = await peopleFixture(mode, 2_000_000_000_000);
    for (const [now, shared] of [[1_999_999_999_999, true], [2_000_000_000_000, false]] as const) {
      const reading = await f.measure(async ctx => {
        const clock = vi.spyOn(Date, "now").mockReturnValue(now);
        try { return await sharingPeopleHandler(ctx, { artifactId: f.artifactId }); } finally { clock.mockRestore(); }
      });
      expect(reading.result?.shared).toBe(shared);
      expect(reading.writes).toBe(0);
    }
  });

  it("avoids a clock dependency when outgoing invitations cannot expire", async () => {
    const { t, ids, user, measure } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("shareInvitations", { schoolId: ids.schoolId, resourceType: "artifact", resourceId: "permanent",
        inviterAccountId: ids.accountId, inviteeAccountId: ids.ownerId, level: "read", status: "accepted", createdAt: ids.now, updatedAt: ids.now });
    });
    await user.run(async (ctx) => {
      const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("No invitation needs expiry evaluation"); });
      try { expect(await sharedByActor(ctx, ids.accountId, ["unshared", "permanent"])).toEqual(new Set(["permanent"])); }
      finally { clock.mockRestore(); }
    });
    const reading = await measure(async (ctx) => [...await sharedByActor(ctx, ids.accountId, ["unshared", "permanent", "permanent"])]);
    expect(reading.documentsReturned).toBe(1);
    expect(reading.writes).toBe(0);
  });

  it("stops sharing reads at the first live invitation and respects exact expiry", async () => {
    const { t, ids, measure } = await fixture();
    await t.run(async (ctx) => {
      for (const [resourceId, status, expiresAt] of [
        ["later-live", "pending", ids.now - 1], ["later-live", "pending", ids.now + 1], ["later-live", "pending", ids.now + 2],
        ["expired", "accepted", ids.now], ["unrelated", "pending", undefined],
      ] as const) await ctx.db.insert("shareInvitations", { schoolId: ids.schoolId, resourceType: "artifact", resourceId,
        inviterAccountId: ids.accountId, inviteeAccountId: ids.ownerId, level: "read", status, expiresAt, createdAt: ids.now, updatedAt: ids.now });
    });
    const reading = await measure(async (ctx) => {
      const clock = vi.spyOn(Date, "now").mockReturnValue(ids.now);
      try { return [...await sharedByActor(ctx, ids.accountId, ["later-live", "expired"])]; }
      finally { clock.mockRestore(); }
    });
    expect(reading.result).toEqual(["later-live"]);
    expect(reading.documentsReturned).toBe(3);
    expect(reading.writes).toBe(0);
  });

  it("pages one-kind quick views without reading newer unrelated node kinds", async () => {
    const { t, ids, measure, user } = await fixture();
    await t.run(async ctx => {
      for (let i = 0; i < 3; i++) await ctx.db.insert("orgNodes", { accountId: ids.accountId, schoolId: ids.schoolId,
        parentId: ids.folderId, kind: "folder", name: `Visible folder ${i}`, orderKey: String(i), activityAt: ids.now - i, createdAt: ids.now, updatedAt: ids.now - i });
    });
    const args = { view: "recent" as const, kinds: ["folder" as const], paginationOpts: { cursor: null, numItems: 2 } };
    const read = () => measure(ctx => quickViewPageHandler(ctx, args));
    const before = await read();
    await t.run(async ctx => {
      for (let i = 0; i < 16; i++) await ctx.db.insert("orgNodes", { accountId: ids.accountId, schoolId: ids.schoolId,
        parentId: null, kind: "thread", name: `Unrelated thread ${i}`, orderKey: String(i), activityAt: ids.now + i + 1, createdAt: ids.now, updatedAt: ids.now + i + 1 });
    });
    const after = await read();
    expect.soft(after.result.page).toEqual(before.result.page);
    expect.soft(after.documentsReturned).toBe(before.documentsReturned);
    expect.soft(after.serializedDocumentBytes).toBe(before.serializedDocumentBytes);
    expect(after.writes).toBe(0);
    const next = await user.query(api.orgTree.quickViewPage, { ...args, paginationOpts: { cursor: after.result.continueCursor, numItems: 2 } });
    const all = [...after.result.page, ...next.page];
    expect(all).toHaveLength(4);
    expect(new Set(all.map(row => row.nodeId)).size).toBe(4);
  });

  it("keeps recent artifact visible and its read cost independent of newer threads", async () => {
    const { t, ids, measure } = await fixture();
    const expected = await t.run(async (ctx) => {
      const works = [];
      for (let i = 0; i < 4; i++) {
        const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: ids.accountId, schoolId: ids.schoolId,
          blueprintKey: i === 2 ? "planner_task" : "document", schemaVersion: 1, title: `Recent artifact ${i}`, content: {},
          tags: [], status: i === 3 ? "deleted" : "active", createdAt: ids.now, updatedAt: ids.now - i });
        await upsertArtifactSummary(ctx, (await ctx.db.get(artifactId))!);
        await ctx.db.insert("orgNodes", { accountId: ids.accountId, schoolId: ids.schoolId, parentId: null,
          kind: "work", sourceId: artifactId, name: `Recent artifact ${i}`, typeKey: i === 2 ? "planner_task" : "document",
          orderKey: String(i), activityAt: ids.now - i, createdAt: ids.now, updatedAt: ids.now - i });
        if (i < 2) works.push({ workId: artifactId, title: `Recent artifact ${i}`, typeKey: "document", activityAt: ids.now - i });
      }
      await ctx.db.insert("orgNodes", { accountId: ids.accountId, schoolId: ids.schoolId, parentId: ids.folderId,
        kind: "work", sourceId: works[0]!.workId, name: "Duplicate placement", typeKey: "document", orderKey: "z",
        activityAt: ids.now - 10, createdAt: ids.now, updatedAt: ids.now - 10 });
      return works;
    });
    const read = () => measure((ctx) => recentWorksHandler(ctx, { limit: 12 }));
    const before = await read();
    expect(before.result).toEqual(expected);
    const addThreads = (from: number, count: number) => t.run(async (ctx) => {
      for (let i = from; i < from + count; i++) await ctx.db.insert("orgNodes", { accountId: ids.accountId,
        schoolId: ids.schoolId, parentId: null, kind: "thread", name: `Newer thread ${i}`, orderKey: String(i),
        activityAt: ids.now + i + 1, createdAt: ids.now, updatedAt: ids.now + i + 1 });
    });
    await addThreads(0, 16);
    const after = await read();
    expect(after.result).toEqual(expected);
    expect.soft(after.documentsReturned).toBe(before.documentsReturned);
    expect.soft(after.serializedDocumentBytes).toBe(before.serializedDocumentBytes);
    await addThreads(16, 48);
    const dense = await read();
    expect.soft(dense.result).toEqual(expected);
    expect.soft(dense.documentsReturned).toBe(before.documentsReturned);
    expect(dense.writes).toBe(0);
    const withoutClock = await measure(async (ctx) => {
      const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Recent owner artifact must not read the clock"); });
      try { return await recentWorksHandler(ctx, { limit: 12 }); }
      finally { clock.mockRestore(); }
    });
    expect(withoutClock.result).toEqual(expected);
    expect(withoutClock.reads.filter((read) => read.table === "shareInvitations")).toEqual([]);
    expect(withoutClock.writes).toBe(0);
    if (process.env.SPECTRA_PERF_EVIDENCE === "1") {
      const directory = ".spectra-local/launch-audit/evidence/S10-PERF";
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${directory}/recent-work-density.json`, JSON.stringify({ before, after, dense }, null, 2));
    }
  });

  it("reaches visible rows on the first request despite unrelated school density", async () => {
    const { t, ids, measure } = await fixture();
    await t.run(async (ctx) => {
      for (let i = 0; i < 6; i++) await ctx.db.insert("orgNodes", { accountId: ids.accountId, schoolId: ids.schoolId, parentId: ids.folderId,
        kind: "folder", name: `Needle owned ${i}`, orderKey: String(i), activityAt: ids.now - i, createdAt: ids.now, updatedAt: ids.now });
    });
    const options = { cursor: null, numItems: 2 };
    const handlers: Record<string, (ctx: QueryCtx) => Promise<{ page: unknown[] }>> = {
      folder: (ctx) => listChildrenHandler(ctx, { parentId: ids.folderId, paginationOpts: options }),
      containers: (ctx) => containersPageHandler(ctx, { parentId: ids.folderId, paginationOpts: options }),
      search: (ctx) => searchPageHandler(ctx, { term: "Needle", scopeNodeId: ids.folderId, paginationOpts: options }),
      recent: (ctx) => quickViewPageHandler(ctx, { view: "recent", scopeNodeId: ids.folderId, paginationOpts: options }),
    };
    type PageMeasurement = Awaited<ReturnType<typeof measure<{ page: unknown[] }>>>;
    const readPages = async (): Promise<Record<string, PageMeasurement>> => Object.fromEntries(
      await Promise.all(Object.entries(handlers).map(async ([key, handler]) => [key, await measure(handler)] as const)),
    );
    const before = await readPages();
    await t.run(async (ctx) => {
      for (let i = 0; i < 2_000; i++) await ctx.db.insert("orgNodes", { accountId: ids.ownerId, schoolId: ids.schoolId, parentId: null,
        kind: "folder", name: `Needle unrelated ${i}`, orderKey: String(i), activityAt: ids.now + i, createdAt: ids.now, updatedAt: ids.now });
    });
    const after = await readPages();
    for (const key of Object.keys(handlers)) {
      const small = before[key]!;
      const large = after[key]!;
      expect(small.result.page).toHaveLength(2);
      expect(large.result.page).toEqual(small.result.page);
      expect(large.documentsReturned).toBe(small.documentsReturned);
      expect(large.calls).toBe(small.calls);
      expect(large.serializedDocumentBytes).toBe(small.serializedDocumentBytes);
      expect(large.writes).toBe(0);
    }
    if (process.env.SPECTRA_PERF_EVIDENCE === "1") {
      const directory = ".spectra-local/launch-audit/evidence/S10-PERF";
      mkdirSync(directory, { recursive: true });
      const safe = (samples: typeof after) => Object.fromEntries(Object.entries(samples).map(([key, { result, ...stats }]) => [key, { ...stats, visible: result.page.length, requestsToFirstVisible: 1 }]));
      writeFileSync(`${directory}/actor-page-density.json`, JSON.stringify({ evidence: "actual handlers in convex-test; returned-row bytes, not physical engine I/O", foreignNodes: 2_000, before: safe(before), after: safe(after) }, null, 2));
    }
  });

  it("keeps inherited discovery complete while refusing expired cached authority", async () => {
    const { t, ids, user } = await fixture();
    const shared = await t.run(async (ctx) => {
      const workspaceId = await ctx.db.insert("spectraWorkspaces", { ownerAccountId: ids.ownerId, schoolId: ids.schoolId, title: "Shared workspace", status: "active", defaultView: "library", createdAt: ids.now, updatedAt: ids.now, lastActivityAt: ids.now });
      const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: ids.ownerId, schoolId: ids.schoolId, blueprintKey: "document", schemaVersion: 1, title: "Inherited Needle", summary: "Fresh private summary", content: { text: "PRIVATE_BODY".repeat(10_000) }, tags: [], status: "active", createdAt: ids.now, updatedAt: ids.now });
      await upsertArtifactSummary(ctx, (await ctx.db.get(artifactId))!);
      await ctx.db.insert("orgNodes", { accountId: ids.ownerId, schoolId: ids.schoolId, parentId: null, kind: "work", sourceId: artifactId, workspaceContextId: workspaceId, accessProjection: true, name: "Inherited Needle", typeKey: "document", orderKey: "a", activityAt: ids.now, createdAt: ids.now, updatedAt: ids.now });
      await ctx.db.insert("orgNodes", { accountId: ids.accountId, schoolId: ids.schoolId, parentId: ids.folderId, kind: "work", sourceId: artifactId, name: "Cached permitted title", typeKey: "document", orderKey: "a", activityAt: ids.now, createdAt: ids.now, updatedAt: ids.now });
      const grantId = await ctx.db.insert("accessGrants", { schoolId: ids.schoolId, resourceType: "workspace", resourceId: workspaceId,
        principalType: "account", principalId: ids.accountId, level: "read", capabilities: ["read"], source: "direct", expiresAt: ids.now + 60_000,
        createdByAccountId: ids.ownerId, createdAt: ids.now, updatedAt: ids.now });
      return { artifactId, grantId };
    });
    const read = () => user.query(api.orgTree.quickViewPage, { view: "shared", paginationOpts: { cursor: null, numItems: 50 } });
    const allowed = await read();
    expect(allowed.page.some((row) => row.sourceId === shared.artifactId && row.source?.available)).toBe(true);
    expect((await user.query(api.orgTree.recentWorks, {})).some((row) => row.workId === shared.artifactId)).toBe(true);
    const before = await user.run((ctx) => evaluateAccess(ctx, "artifact", shared.artifactId));
    expect(before.allowed).toBe(true);
    await t.run((ctx) => ctx.db.patch(shared.grantId, { expiresAt: ids.now - 1 }));
    const denied = await user.run((ctx) => evaluateAccess(ctx, "artifact", shared.artifactId));
    expect(denied.allowed).toBe(false);
    const after = await read();
    expect(after.page.some((row) => row.sourceId === shared.artifactId && row.source?.available)).toBe(false);
    expect(JSON.stringify(after)).not.toContain("Fresh private summary");
    expect((await user.query(api.orgTree.recentWorks, {})).some((row) => row.workId === shared.artifactId)).toBe(false);
  });
});
