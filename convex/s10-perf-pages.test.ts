/// <reference types="vite/client" />
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import type { QueryCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { containersPage, listChildren, searchPage, quickViewPage } from "./orgTree";
import { upsertArtifactSummary } from "./orgTreeShared";
import { evaluateAccess } from "./authorityShared";
import { observeDatabase, serializedBytes } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "perf-pages", email: "perf-pages@example.test", emailVerified: true };
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
  it("reaches visible rows on the first request despite unrelated school density", async () => {
    const { t, ids, measure } = await fixture();
    await t.run(async (ctx) => {
      for (let i = 0; i < 6; i++) await ctx.db.insert("orgNodes", { accountId: ids.accountId, schoolId: ids.schoolId, parentId: ids.folderId,
        kind: "folder", name: `Needle owned ${i}`, orderKey: String(i), activityAt: ids.now - i, createdAt: ids.now, updatedAt: ids.now });
    });
    const options = { cursor: null, numItems: 2 };
    const handlers = {
      folder: (ctx: QueryCtx) => listChildren._handler(ctx, { parentId: ids.folderId, paginationOpts: options }),
      containers: (ctx: QueryCtx) => containersPage._handler(ctx, { parentId: ids.folderId, paginationOpts: options }),
      search: (ctx: QueryCtx) => searchPage._handler(ctx, { term: "Needle", scopeNodeId: ids.folderId, paginationOpts: options }),
      recent: (ctx: QueryCtx) => quickViewPage._handler(ctx, { view: "recent", scopeNodeId: ids.folderId, paginationOpts: options }),
    };
    const before = Object.fromEntries(await Promise.all(Object.entries(handlers).map(async ([key, handler]) => [key, await measure(handler)])));
    await t.run(async (ctx) => {
      for (let i = 0; i < 2_000; i++) await ctx.db.insert("orgNodes", { accountId: ids.ownerId, schoolId: ids.schoolId, parentId: null,
        kind: "folder", name: `Needle unrelated ${i}`, orderKey: String(i), activityAt: ids.now + i, createdAt: ids.now, updatedAt: ids.now });
    });
    const after = Object.fromEntries(await Promise.all(Object.entries(handlers).map(async ([key, handler]) => [key, await measure(handler)])));
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
    const before = await user.run((ctx) => evaluateAccess(ctx, "artifact", shared.artifactId));
    expect(before.allowed).toBe(true);
    await t.run((ctx) => ctx.db.patch(shared.grantId, { expiresAt: ids.now - 1 }));
    const denied = await user.run((ctx) => evaluateAccess(ctx, "artifact", shared.artifactId));
    expect(denied.allowed).toBe(false);
    const after = await read();
    expect(after.page.some((row) => row.sourceId === shared.artifactId && row.source?.available)).toBe(false);
    expect(JSON.stringify(after)).not.toContain("Fresh private summary");
  });
});
