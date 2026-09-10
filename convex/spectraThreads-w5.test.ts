import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "w5-history-results",
  email: "w5-history-results@example.test",
  emailVerified: true,
};

async function fixture(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "W5",
      slug: `w5-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "UTC",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject,
      email: identity.email,
      emailVerified: true,
      name: "W5",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, schoolId, now };
  });
}

describe("W5-01 lossless history and bounded result reads", () => {
  it("walks more than 1,000 equal-timestamp messages without gaps or duplicates", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    const threadId = await t.run(async (ctx) => {
      const threadId = await ctx.db.insert("spectraThreads", {
        ownerAccountId: f.accountId,
        schoolId: f.schoolId,
        title: "Long equal-time history",
        origin: "chat",
        status: "active",
        messageCount: 1_101,
        createdAt: f.now,
        updatedAt: f.now,
      });
      for (let index = 0; index < 1_101; index += 1)
        await ctx.db.insert("spectraMessages", {
          threadId,
          schoolId: f.schoolId,
          role: index % 2 === 0 ? "user" : "assistant",
          content: `message-${index}`,
          createdAt: f.now,
        });
      return threadId;
    });

    const detail = await t.withIdentity(identity).query(api.spectraThreads.get, {
      threadId,
    });
    const seen = new Set(detail.messages.map((message) => message._id));
    let before = detail.messagePage?.olderBefore;
    let pageCount = 0;
    while (before) {
      const page = await t.withIdentity(identity).query(
        api.spectraThreads.listMessages,
        { threadId, before, limit: 80 },
      );
      for (const message of page.messages) seen.add(message._id);
      before = page.olderBefore;
      pageCount += 1;
      expect(pageCount).toBeLessThan(20);
    }
    expect(seen).toHaveLength(1_101);
  });

  it("resumes metadata maintenance across more than 700 legacy threads", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 701; index += 1)
        await ctx.db.insert("spectraThreads", {
          ownerAccountId: f.accountId,
          schoolId: f.schoolId,
          title: `Legacy ${index}`,
          origin: "chat",
          status: "active",
          createdAt: f.now + index,
          updatedAt: f.now + index,
        });
    });

    let cursor: string | undefined;
    let scanned = 0;
    for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
      const page = await t.mutation(internal.spectraThreads.backfillReadMetadata, {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      scanned += page.scanned;
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(cursor).toBeUndefined();
    expect(scanned).toBe(701);
    const remaining = await t.run(async (ctx) =>
      (await ctx.db.query("spectraThreads").collect()).filter(
        (thread) => thread.readSchemaVersion !== 1,
      ).length,
    );
    expect(remaining).toBe(0);
  });

  it("keeps every allowed thread when context projections are revoked", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    const artifactId = await t.run(async (ctx) => {
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: f.accountId,
        schoolId: f.schoolId,
        blueprintKey: "document",
        schemaVersion: 2,
        title: "Revoked context",
        content: { blocks: [] },
        textIndex: "",
        tags: [],
        status: "deleted",
        createdAt: f.now,
        updatedAt: f.now,
      });
      for (let index = 0; index < 401; index += 1)
        await ctx.db.insert("spectraThreads", {
          ownerAccountId: f.accountId,
          schoolId: f.schoolId,
          title: `Thread ${index}`,
          origin: "chat",
          contextArtifactIds: [artifactId],
          status: "active",
          createdAt: f.now + index,
          updatedAt: f.now + index,
        });
      return artifactId;
    });
    expect(artifactId).toBeTruthy();

    const rows: Array<{ contexts?: { artifacts?: unknown[] } }> = [];
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
      const page = await t.withIdentity(identity).query(api.spectraThreads.list, {
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      rows.push(...page.threads);
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(rows).toHaveLength(401);
    expect(rows.every((thread) => thread.contexts?.artifacts?.length === 0)).toBe(
      true,
    );
  });

  it("paginates operations, result cards, and events independently", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    const ids = await t.run(async (ctx) => {
      const threadId = await ctx.db.insert("spectraThreads", {
        ownerAccountId: f.accountId,
        schoolId: f.schoolId,
        title: "Trace history",
        origin: "chat",
        status: "active",
        createdAt: f.now,
        updatedAt: f.now,
      });
      const runId = await ctx.db.insert("spectraAiRuns", {
        ownerAccountId: f.accountId,
        schoolId: f.schoolId,
        sourceSurface: "chat",
        threadId,
        status: "completed",
        userPrompt: "trace",
        executionId: "w5-execution",
        eventSequence: 125,
        createdAt: f.now,
        updatedAt: f.now,
      });
      for (let index = 0; index < 125; index += 1) {
        await ctx.db.insert("spectraOperations", {
          runId,
          executionId: "w5-execution",
          actorType: "ai",
          type: `operation.${index}`,
          status: "executed",
          input: { index },
          affected: [],
          createdAt: f.now + index,
        });
        await ctx.db.insert("spectraResultCards", {
          runId,
          surface: "chat",
          status: "completed",
          variant: "operation",
          title: `Result ${index}`,
          actions: [],
          createdAt: f.now + index,
          updatedAt: f.now + index,
        });
        await ctx.db.insert("spectraRunEvents", {
          runId,
          executionId: "w5-execution",
          sequence: index + 1,
          type: `event.${index}`,
          payload: { index },
          createdAt: f.now + index,
        });
      }
      await ctx.db.patch(threadId, { lastRunId: runId });
      return { threadId, runId };
    });

    const firstOperations = await t.withIdentity(identity).query(
      api.spectraThreads.getRunTrace,
      { threadId: ids.threadId, runId: ids.runId, family: "operations", limit: 40 },
    );
    const firstCards = await t.withIdentity(identity).query(
      api.spectraThreads.getRunTrace,
      { threadId: ids.threadId, runId: ids.runId, family: "cards", limit: 40 },
    );
    const firstEvents = await t.withIdentity(identity).query(
      api.spectraThreads.getRunTrace,
      { threadId: ids.threadId, runId: ids.runId, family: "events", limit: 40 },
    );
    const operationIds = new Set(
      firstOperations.operations.map((operation) => operation._id),
    );
    const cardIds = new Set(firstCards.cards.map((card) => card._id));
    const eventSequences = new Set(firstEvents.events.map((event) => event.sequence));
    let operationCursor = firstOperations.operationPage?.before ?? null;
    let cardCursor = firstCards.cardPage?.before ?? null;
    let eventCursor = firstEvents.eventPage?.nextCursor ?? null;
    for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
      if (operationCursor) {
        const page = await t.withIdentity(identity).query(
          api.spectraThreads.getRunTrace,
          {
            threadId: ids.threadId,
            runId: ids.runId,
            family: "operations",
            operationsBefore: operationCursor,
            skipCards: true,
            skipEvents: true,
            limit: 40,
          },
        );
        for (const operation of page.operations) operationIds.add(operation._id);
        operationCursor = page.operationPage?.before ?? null;
      }
      if (cardCursor) {
        const page = await t.withIdentity(identity).query(
          api.spectraThreads.getRunTrace,
          {
            threadId: ids.threadId,
            runId: ids.runId,
            family: "cards",
            cardsBefore: cardCursor,
            skipOperations: true,
            skipEvents: true,
            limit: 40,
          },
        );
        for (const card of page.cards) cardIds.add(card._id);
        cardCursor = page.cardPage?.before ?? null;
      }
      if (eventCursor) {
        const page = await t.withIdentity(identity).query(
          api.spectraThreads.getRunTrace,
          {
            threadId: ids.threadId,
            runId: ids.runId,
            family: "events",
            eventsCursor: eventCursor,
            skipOperations: true,
            skipCards: true,
            limit: 40,
          },
        );
        for (const event of page.events) eventSequences.add(event.sequence);
        eventCursor = page.eventPage?.nextCursor ?? null;
      }
      if (!operationCursor && !cardCursor && !eventCursor) break;
    }
    expect(operationIds).toHaveLength(125);
    expect(cardIds).toHaveLength(125);
    expect(eventSequences).toHaveLength(125);
  });
});
