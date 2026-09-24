/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { treePagination } from "./orgTreePagination";

const modules = import.meta.glob("./**/*.ts");
async function fixture() {
  const t = convexTest(schema, modules);
  const accountId = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Library test", slug: crypto.randomUUID(), verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const id = await ctx.db.insert("accounts", { clerkId: "library-pages", email: "library@example.test", emailVerified: true, name: "Library", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId: id, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    return id;
  });
  return { t, accountId, reader: t.withIdentity({ subject: "library-pages", email: "library@example.test", emailVerified: true }) };
}

describe("Library page continuation", () => {
  it("reaches folders after a full page of noncontainers without pretending the rail is empty", async () => {
    const { t, accountId, reader } = await fixture();
    await t.run(async (ctx) => {
      for (let i = 0; i < 55; i++) await ctx.db.insert("orgNodes", { accountId, parentId: null, name: `Item ${i}`, kind: i < 50 ? "work" : "folder", orderKey: String(i).padStart(4, "0"), createdAt: i, updatedAt: i });
    });
    const first = await reader.query(api.orgTree.containersPage, { paginationOpts: { cursor: null, numItems: 50 } });
    expect(first.page).toEqual([]);
    expect(first.isDone).toBe(false);
    const next = await reader.query(api.orgTree.containersPage, { paginationOpts: { cursor: first.continueCursor, numItems: 50 } });
    expect(next.page.map((node) => node.name)).toEqual(["Item 50", "Item 51", "Item 52", "Item 53", "Item 54"]);
    expect(next.isDone).toBe(true);
  });

  it("continues a sparse scoped quick view and rejects a cursor reused for another filter", async () => {
    const { t, accountId, reader } = await fixture();
    const scopeNodeId = await t.run(async (ctx) => {
      const scope = await ctx.db.insert("orgNodes", { accountId, parentId: null, kind: "folder", name: "Scope", orderKey: "a", createdAt: 0, updatedAt: 0 });
      for (let i = 0; i < 55; i++) await ctx.db.insert("orgNodes", { accountId, parentId: i < 50 ? null : scope, name: `Item ${i}`, kind: "folder", orderKey: String(i), activityAt: 100 - i, createdAt: i, updatedAt: i });
      return scope;
    });
    const first = await reader.query(api.orgTree.quickViewPage, { view: "recent", scopeNodeId, paginationOpts: { cursor: null, numItems: 50 } });
    expect(first.page).toHaveLength(0);
    expect(first.isDone).toBe(false);
    const next = await reader.query(api.orgTree.quickViewPage, { view: "recent", scopeNodeId, paginationOpts: { cursor: first.continueCursor, numItems: 50 } });
    expect(next.page).toHaveLength(5);
    await expect(reader.query(api.orgTree.quickViewPage, { view: "favorites", scopeNodeId, paginationOpts: { cursor: first.continueCursor, numItems: 50 } })).rejects.toThrow("listing changed");
    await expect(reader.query(api.orgTree.searchPage, { term: "Item", scopeNodeId: "bad-id", paginationOpts: { cursor: null, numItems: 50 } })).rejects.toThrow("folder is no longer available");
  });

  it("retains split/end cursor semantics and refuses another account's cursor", () => {
    const pager = treePagination({ cursor: null, numItems: 500 }, ["search", "a", "term"]);
    expect(pager.options.numItems).toBe(50);
    const result = pager.result({ page: [], continueCursor: "next", isDone: false, splitCursor: "middle", pageStatus: "SplitRequired" });
    const resumed = treePagination({ cursor: result.splitCursor!, endCursor: result.continueCursor, numItems: 50 }, ["search", "a", "term"]);
    expect(resumed.options).toMatchObject({ cursor: "middle", endCursor: "next" });
    expect(() => treePagination({ cursor: result.continueCursor, numItems: 50 }, ["search", "b", "term"])).toThrow("listing changed");
  });
});
