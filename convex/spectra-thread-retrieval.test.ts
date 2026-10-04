/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

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

describe("exact message chunks", () => {
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
    await expect(f.actor.query(api.spectraThreads.readMessage, { threadId: f.threadId, messageId })).rejects.toThrow("Thread not found");
  });

  it("does not disclose another owner's message even when the thread identifier is known", async () => {
    const f = await fixture();
    const messageId = await add(f, "A private heliostat note.");
    const other = f.t.withIdentity({ subject: "another-person", email: "other@example.test" });
    await expect(other.query(api.spectraThreads.readMessage, { threadId: f.threadId, messageId })).rejects.toThrow();
  });
});
