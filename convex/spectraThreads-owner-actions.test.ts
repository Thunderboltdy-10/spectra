/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "chat-rename-owner",
  email: "chat-rename-owner@example.test",
  emailVerified: true,
};

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

async function seedThread(t: ReturnType<typeof setupTest>, messageCount = 1) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Rename School", slug: `rename-${crypto.randomUUID()}`, verifiedDomains: [],
      status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true, name: "Owner",
      status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const threadId = await ctx.db.insert("spectraThreads", {
      ownerAccountId: accountId, schoolId, title: "Photosynthesis basics", origin: "chat",
      status: "active", messageCount, createdAt: now, updatedAt: now,
    });
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: accountId, schoolId, sourceSurface: "chat", userPrompt: "Explain it",
      status: "running", executionId: "attempt-1", threadId, createdAt: now, updatedAt: now,
    });
    return { threadId, runId };
  });
}

describe("renaming a chat", () => {
  it("keeps the words the owner typed", async () => {
    const t = setupTest();
    const { threadId } = await seedThread(t);
    await t.withIdentity(identity).mutation(api.spectraThreads.update, {
      threadId,
      title: "  The French Revolution   for my essay ",
    });
    const thread = await t.run((ctx) => ctx.db.get(threadId));
    expect(thread?.title).toBe("The French Revolution for my essay");
  });

  it("refuses an empty name instead of inventing one", async () => {
    const t = setupTest();
    const { threadId } = await seedThread(t);
    await expect(
      t.withIdentity(identity).mutation(api.spectraThreads.update, { threadId, title: "   " }),
    ).rejects.toThrow(/name/i);
    const thread = await t.run((ctx) => ctx.db.get(threadId));
    expect(thread?.title).toBe("Photosynthesis basics");
  });

  it("is not overwritten by a later generated title", async () => {
    const t = setupTest();
    const { threadId, runId } = await seedThread(t, 1);
    await t.withIdentity(identity).mutation(api.spectraThreads.update, {
      threadId,
      title: "Biology revision",
    });
    await t.withIdentity(identity).mutation(api.spectraThreads.applyGeneratedMetadata, {
      threadId,
      runId,
      executionId: "attempt-1",
      title: "Light reactions in chloroplasts",
      summary: "How plants turn light into sugar.",
    });
    const thread = await t.run((ctx) => ctx.db.get(threadId));
    expect(thread?.title).toBe("Biology revision");
    expect(thread?.summaryShort).toBe("How plants turn light into sugar.");
  });

  it("is not overwritten after a rename in the Library either", async () => {
    const t = setupTest();
    const { threadId, runId } = await seedThread(t, 1);
    const nodeId = await t.run(async (ctx) => {
      const thread = (await ctx.db.get(threadId))!;
      return ctx.db.insert("orgNodes", {
        accountId: thread.ownerAccountId, schoolId: thread.schoolId, parentId: null, kind: "thread",
        name: thread.title, sourceId: String(threadId), orderKey: "a", createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    await t.withIdentity(identity).mutation(api.orgTree.rename, { nodeId, name: "Exam prep" });
    await t.withIdentity(identity).mutation(api.spectraThreads.applyGeneratedMetadata, {
      threadId,
      runId,
      executionId: "attempt-1",
      title: "Light reactions in chloroplasts",
    });
    const thread = await t.run((ctx) => ctx.db.get(threadId));
    expect(thread?.title).toBe("Exam prep");
  });
});

describe("a chat moved to the Library Trash", () => {
  it("leaves the chat list until it is restored", async () => {
    const t = setupTest();
    const { threadId } = await seedThread(t);
    const nodeId = await t.run(async (ctx) => {
      const thread = (await ctx.db.get(threadId))!;
      return ctx.db.insert("orgNodes", {
        accountId: thread.ownerAccountId, schoolId: thread.schoolId, parentId: null, kind: "thread",
        name: thread.title, sourceId: String(threadId), orderKey: "a", createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    const owner = t.withIdentity(identity);
    const listed = async () =>
      (await owner.query(api.spectraThreads.list, {})).threads.map((thread) => thread._id);

    expect(await listed()).toEqual([threadId]);
    await owner.mutation(api.orgTree.trash, { nodeIds: [nodeId] });
    expect(await listed()).toEqual([]);
    await owner.mutation(api.orgTree.restore, { nodeIds: [nodeId] });
    expect(await listed()).toEqual([threadId]);
  });
});
