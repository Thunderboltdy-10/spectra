/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "thread-notes-owner", email: "thread-notes-owner@example.test", emailVerified: true };

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

async function seedThread(t: ReturnType<typeof setupTest>, messages: number) {
  return t.run(async (ctx) => {
    const now = 1_000_000;
    const schoolId = await ctx.db.insert("schools", {
      name: "Notes School", slug: `notes-${crypto.randomUUID()}`, verifiedDomains: [],
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
      ownerAccountId: accountId, schoolId, title: "Essay planning", origin: "chat",
      status: "active", messageCount: messages, createdAt: now, updatedAt: now,
    });
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: accountId, schoolId, sourceSurface: "chat", userPrompt: "Plan it",
      status: "running", executionId: "attempt-1", threadId, createdAt: now, updatedAt: now,
    });
    for (let index = 0; index < messages; index += 1)
      await ctx.db.insert("spectraMessages", {
        threadId, schoolId, role: index % 2 ? "assistant" : "user", content: `message ${index}`, createdAt: now + index,
      });
    return { threadId, runId, now };
  });
}

describe("a thread's running notes", () => {
  it("replay only what came after them, and only ever move forward", async () => {
    const t = setupTest();
    const { threadId, runId, now } = await seedThread(t, 30);
    const owner = t.withIdentity(identity);
    const before = await owner.query(api.spectraThreads.agentHistory, { threadId, limit: 80 });
    expect(before.notes).toBeUndefined();
    expect(before.messages).toHaveLength(30);
    expect(before.messages[0]?.content).toBe("message 0");

    await owner.mutation(api.spectraThreads.recordThreadNotes, {
      threadId, runId, executionId: "attempt-1", notes: "## What the user wants\nAn essay plan.", through: now + 19,
    });
    const after = await owner.query(api.spectraThreads.agentHistory, { threadId, limit: 80 });
    expect(after.notes).toMatch(/essay plan/);
    expect(after.messages.map((message) => message.content)).toEqual(
      Array.from({ length: 10 }, (_, index) => `message ${index + 20}`),
    );

    // An older fold arriving late does not take the notes back.
    const stale = await owner.mutation(api.spectraThreads.recordThreadNotes, {
      threadId, runId, executionId: "attempt-1", notes: "Old notes", through: now + 5,
    });
    expect(stale.recorded).toBe(false);
    const thread = await t.run((ctx) => ctx.db.get(threadId));
    expect(thread?.summaryLong).toMatch(/essay plan/);
    // Notes are not the user's activity: the thread keeps its place.
    expect(thread?.updatedAt).toBe(now);
  });

  it("refuse notes from another run attempt", async () => {
    const t = setupTest();
    const { threadId, runId, now } = await seedThread(t, 2);
    await expect(
      t.withIdentity(identity).mutation(api.spectraThreads.recordThreadNotes, {
        threadId, runId, executionId: "attempt-0", notes: "Notes", through: now + 1,
      }),
    ).rejects.toThrow(/older run attempt/);
  });
});
