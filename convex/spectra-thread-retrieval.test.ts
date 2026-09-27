/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { search, searchMessages } from "./spectraThreads";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
async function fixture() {
  const t = convexTest(schema, modules);
  const identity = { subject: "thread-retrieval", email: "thread-retrieval@example.test", emailVerified: true };
  const data = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Search", slug: "search", verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: identity.subject, email: identity.email, emailVerified: true, name: "Reader", status: "active", createdAt: now, updatedAt: now });
    const membershipId = await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const ids: Id<"spectraThreads">[] = [];
    for (const title of ["Research", "Other discussion"]) ids.push(await ctx.db.insert("spectraThreads", { ownerAccountId: accountId, schoolId, title, origin: "chat", status: "active", createdAt: now, updatedAt: now }));
    return { schoolId, accountId, membershipId, threadId: ids[0], otherThreadId: ids[1], now };
  });
  return { t, actor: t.withIdentity(identity), ...data };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const add = (f: Fixture, content: string, threadId = f.threadId, createdAt = f.now) => f.t.run((ctx) =>
  ctx.db.insert("spectraMessages", { threadId, schoolId: f.schoolId, role: "user", content, createdAt }));

describe("compact owned conversation discovery", () => {
  it("finds old titles with bounded reads and returns no message or related-object payload", async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch(f.threadId, { title: "Heliostat design decisions", summaryShort: "Retain the approved reflector", summaryLong: "PRIVATE LARGE SUMMARY".repeat(1_000) }));
    await add(f, "MESSAGE BODY".repeat(1_000));
    const handler = Reflect.get(search, "_handler") as (ctx: QueryCtx, args: { query: string }) => Promise<unknown>;
    const measure = () => f.actor.run(async (ctx) => {
      const observer = observeDatabase(ctx.db);
      const result = await handler({ ...ctx, db: observer.db }, { query: "Heliostat" });
      return { result, ...observer.snapshot() };
    });
    const before = await measure();
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 300; i += 1) await ctx.db.insert("spectraThreads", {
        ownerAccountId: f.accountId, schoolId: f.schoolId, title: `Ceramics ${i}`, origin: "chat", status: "active",
        createdAt: f.now + i + 1, updatedAt: f.now + i + 1,
      });
    });
    const after = await measure();
    expect(after.result).toEqual(before.result);
    expect(after.documentsReturned).toBe(before.documentsReturned);
    expect(after.serializedDocumentBytes).toBe(before.serializedDocumentBytes);
    expect(after.result).toMatchObject({ results: [{ type: "thread", id: f.threadId, title: "Heliostat design decisions" }], complete: true, searchMode: "title" });
    expect(JSON.stringify(after.result)).not.toMatch(/MESSAGE BODY|PRIVATE LARGE SUMMARY/);
    console.info("S11 thread discovery index ledger", JSON.stringify({ threads: [2, 302], calls: after.calls, documents: after.documentsReturned, bytes: after.serializedDocumentBytes }));
  });

  it("paginates every match while binding query, workspace and archive status", async () => {
    const f = await fixture();
    const { workspaceId, ids } = await f.t.run(async (ctx) => {
      const workspaceId = await ctx.db.insert("spectraWorkspaces", { ownerAccountId: f.accountId, schoolId: f.schoolId, title: "Science", status: "active", defaultView: "cards", lastActivityAt: f.now, createdAt: f.now, updatedAt: f.now });
      const ids: Id<"spectraThreads">[] = [];
      for (let i = 0; i < 5; i += 1) ids.push(await ctx.db.insert("spectraThreads", {
        ownerAccountId: f.accountId, schoolId: f.schoolId, workspaceId, title: `Heliostat research ${i}`, origin: "workspace", status: "active", createdAt: f.now, updatedAt: f.now,
      }));
      await ctx.db.patch(f.otherThreadId, { title: "Heliostat unscoped" });
      await ctx.db.patch(f.threadId, { title: "Heliostat archived", workspaceId, status: "archived" });
      return { workspaceId, ids };
    });
    const first = await f.actor.query(api.spectraThreads.search, { query: "Heliostat", workspaceId, limit: 2 });
    expect(first.nextCursor).not.toBeNull();
    for (const changed of [{ query: "research", workspaceId }, { query: "Heliostat" }, { query: "Heliostat", workspaceId, status: "archived" as const }])
      await expect(f.actor.query(api.spectraThreads.search, { ...changed, cursor: first.nextCursor! })).rejects.toThrow("THREAD_CURSOR_MISMATCH");
    const found = first.results.map((row) => row.id);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await f.actor.query(api.spectraThreads.search, { query: "Heliostat", workspaceId, limit: 2, cursor });
      found.push(...page.results.map((row) => row.id)); cursor = page.nextCursor;
    }
    expect(found).toHaveLength(ids.length);
    expect(new Set(found)).toEqual(new Set(ids));
    const archived = await f.actor.query(api.spectraThreads.search, { query: "Heliostat", workspaceId, status: "archived" });
    expect(archived.results.map((row) => row.id)).toEqual([f.threadId]);
  });

  it("never discovers another account's conversation and rechecks school and lifecycle", async () => {
    const f = await fixture();
    const otherIdentity = { subject: "thread-discovery-other", email: "other@example.test", emailVerified: true };
    await f.t.run(async (ctx) => {
      const accountId = await ctx.db.insert("accounts", { clerkId: otherIdentity.subject, email: otherIdentity.email, emailVerified: true, name: "Other", status: "active", createdAt: f.now, updatedAt: f.now });
      await ctx.db.insert("schoolMemberships", { accountId, schoolId: f.schoolId, role: "student", status: "active", joinedAt: f.now, createdAt: f.now, updatedAt: f.now });
      for (const id of [f.threadId, f.otherThreadId]) await ctx.db.patch(id, { title: "Heliostat design" });
      await ctx.db.insert("spectraThreads", { ownerAccountId: accountId, schoolId: f.schoolId, title: "Heliostat private", origin: "chat", status: "active", createdAt: f.now, updatedAt: f.now });
    });
    const first = await f.actor.query(api.spectraThreads.search, { query: "Heliostat", limit: 1 });
    await expect(f.t.withIdentity(otherIdentity).query(api.spectraThreads.search, { query: "Heliostat", cursor: first.nextCursor! })).rejects.toThrow("THREAD_CURSOR_MISMATCH");
    await f.t.run(async (ctx) => { for (const id of [f.threadId, f.otherThreadId]) await ctx.db.patch(id, { status: "deleted" }); });
    expect((await f.actor.query(api.spectraThreads.search, { query: "Heliostat" })).results).toEqual([]);
    await f.t.run((ctx) => ctx.db.patch(f.membershipId, { status: "suspended" }));
    await expect(f.actor.query(api.spectraThreads.search, { query: "Heliostat" })).rejects.toThrow();
  });
});

describe("indexed conversation history and exact message chunks", () => {
  it("finds old text beyond the recent window and beyond the old 3000-character prefix", async () => {
    const f = await fixture();
    const original = "Background context. ".repeat(600) + "The heliostat deadline moved to Friday.";
    const messageId = await add(f, original);
    for (let i = 0; i < 40; i += 1) await add(f, `New unrelated discussion ${i}`, f.threadId, f.now + i + 1);
    const result = await f.actor.query(api.spectraThreads.searchMessages, { threadId: f.threadId, query: "heliostat" });
    expect(result.results.map((row) => row.messageId)).toEqual([messageId]);
    const hit = result.results[0];
    expect(hit.start).toBeGreaterThan(3_000);
    expect(hit.excerpt).toContain("deadline moved to Friday");
    const detail = await f.actor.query(api.spectraThreads.readMessage, { threadId: f.threadId, messageId, offset: hit.start, revision: hit.revision });
    expect(detail.ok).toBe(true);
    if (detail.ok) expect(detail.content).toBe(original.slice(hit.start, hit.start + 3_000));
  });

  it("paginates search without gaps and binds cursors to query and thread", async () => {
    const f = await fixture();
    const ids = [];
    for (let i = 0; i < 9; i += 1) ids.push(await add(f, `Needle decision ${i}`));
    const first = await f.actor.query(api.spectraThreads.searchMessages, { threadId: f.threadId, query: "Needle", limit: 2 });
    expect(first.nextCursor).not.toBeNull();
    await expect(f.actor.query(api.spectraThreads.searchMessages, { threadId: f.otherThreadId, query: "Needle", cursor: first.nextCursor! })).rejects.toThrow("THREAD_CURSOR_MISMATCH");
    await expect(f.actor.query(api.spectraThreads.searchMessages, { threadId: f.threadId, query: "decision", cursor: first.nextCursor! })).rejects.toThrow("THREAD_CURSOR_MISMATCH");
    const found = first.results.map((row) => row.messageId);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await f.actor.query(api.spectraThreads.searchMessages, { threadId: f.threadId, query: "Needle", limit: 2, cursor });
      found.push(...page.results.map((row) => row.messageId)); cursor = page.nextCursor;
    }
    expect(new Set(found)).toEqual(new Set(ids));
    expect(found).toHaveLength(9);
  });

  it("reconstructs long text with exact offsets and refuses to mix revisions", async () => {
    const f = await fixture();
    const original = "A complete discussion with equations x² + y². ".repeat(240);
    const messageId = await add(f, original);
    const first = await f.actor.query(api.spectraThreads.readMessage, { threadId: f.threadId, messageId, limit: 1_000 });
    expect(first.ok).toBe(true); if (!first.ok) return;
    await expect(f.actor.query(api.spectraThreads.readMessage, { threadId: f.threadId, messageId, offset: 1_000 })).rejects.toThrow("MESSAGE_REVISION_REQUIRED");
    let text = first.content, offset = first.nextOffset;
    while (offset !== null) {
      const page = await f.actor.query(api.spectraThreads.readMessage, { threadId: f.threadId, messageId, offset, revision: first.revision, limit: 1_000 });
      expect(page.ok).toBe(true); if (!page.ok) return;
      text += page.content; offset = page.nextOffset;
    }
    expect(text).toBe(original);
    await f.t.run((ctx) => ctx.db.patch(messageId, { content: "The assistant retry replaced this message." }));
    const changed = await f.actor.query(api.spectraThreads.readMessage, { threadId: f.threadId, messageId, offset: 1_000, revision: first.revision });
    expect(changed).toMatchObject({ ok: false, code: "message_changed" });
    expect(changed).not.toHaveProperty("content");
  });

  it("rejects foreign message identities and rechecks deleted conversation authority", async () => {
    const f = await fixture();
    const messageId = await add(f, "A private heliostat note.");
    await expect(f.actor.query(api.spectraThreads.readMessage, { threadId: f.otherThreadId, messageId })).rejects.toThrow("Message not found");
    await f.t.run((ctx) => ctx.db.patch(f.threadId, { status: "deleted" }));
    await expect(f.actor.query(api.spectraThreads.searchMessages, { threadId: f.threadId, query: "heliostat" })).rejects.toThrow("Thread not found");
    await expect(f.actor.query(api.spectraThreads.readMessage, { threadId: f.threadId, messageId })).rejects.toThrow("Thread not found");
  });

  it("does not disclose another owner's message even when the thread identifier is known", async () => {
    const f = await fixture();
    const messageId = await add(f, "A private heliostat note.");
    const other = f.t.withIdentity({ subject: "another-person", email: "other@example.test" });
    await expect(other.query(api.spectraThreads.searchMessages, { threadId: f.threadId, query: "heliostat" })).rejects.toThrow();
    await expect(other.query(api.spectraThreads.readMessage, { threadId: f.threadId, messageId })).rejects.toThrow();
  });

  it("keeps returned database rows unchanged as unrelated history grows", async () => {
    const f = await fixture();
    await add(f, "The heliostat deadline is Friday.");
    const handler = Reflect.get(searchMessages, "_handler") as (ctx: QueryCtx, args: { threadId: Id<"spectraThreads">; query: string }) => Promise<unknown>;
    const measure = () => f.actor.run(async (ctx) => { const observer = observeDatabase(ctx.db); const result = await handler({ ...ctx, db: observer.db }, { threadId: f.threadId, query: "heliostat" }); return { result, ...observer.snapshot() }; });
    const before = await measure();
    await f.t.run(async (ctx) => { for (let i = 0; i < 300; i += 1) await ctx.db.insert("spectraMessages", { threadId: f.threadId, schoolId: f.schoolId, role: "assistant", content: `Unrelated ceramics ${i}`, createdAt: f.now + i + 1 }); });
    const after = await measure();
    expect(after.result).toEqual(before.result);
    expect(after.documentsReturned).toBe(before.documentsReturned);
    expect(after.serializedDocumentBytes).toBe(before.serializedDocumentBytes);
    console.info("S11 thread history index ledger", JSON.stringify({ messages: [1, 301], calls: after.calls, documents: after.documentsReturned, bytes: after.serializedDocumentBytes }));
  });
});
