/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { personalOverview } from "./analytics";
import type { QueryCtx } from "./_generated/server";
import { observeDatabase } from "../scripts/perf-read-ledger";
import { upsertAnalyticsRun } from "./analyticsReadModels";
import { internalMutation as triggeredMutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { FunctionReturnType } from "convex/server";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "analytics-fixture", email: "analytics@example.test", emailVerified: true };
const analyticsHandler = Reflect.get(personalOverview, "_handler") as (
  ctx: QueryCtx, args: { from: number; to: number },
) => Promise<FunctionReturnType<typeof api.analytics.personalOverview>>;

async function setup() {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Analytics fixture", slug: "analytics-fixture", verifiedDomains: [], status: "active",
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true, name: "Fixture",
      status: "active", createdAt: now, updatedAt: now,
    });
    const foreignAccountId = await ctx.db.insert("accounts", {
      clerkId: "analytics-foreign", email: "foreign@example.test", emailVerified: true, name: "Foreign",
      status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    return { now, schoolId, accountId, foreignAccountId };
  });
  return { t, ...fixture };
}

async function backfill(t: Awaited<ReturnType<typeof setup>>["t"]) {
  for (const source of ["artifacts", "runs"] as const) {
    let pages = 0;
    for (;;) {
      const result = await t.mutation(internal.analytics.backfillReadModels, { source });
      expect(result.processed).toBeLessThanOrEqual(25);
      expect(++pages).toBeLessThan(100);
      if (result.done) break;
    }
  }
}

describe("personal analytics semantics", () => {
  it("excludes legacy timetables and deleted work consistently, preserving account and date scope", async () => {
    const { t, now, schoolId, accountId, foreignAccountId } = await setup();
    await t.run(async ctx => {
      for (const [title, blueprintKey, status, ownerAccountId, createdAt] of [
        ["Document", "document", "active", accountId, now],
        ["Archived sheet", "sheets", "archived", accountId, now + 1],
        ["Legacy calendar", "timetable", "active", accountId, now + 2],
        ["Deleted", "document", "deleted", accountId, now + 3],
        ["Foreign", "document", "active", foreignAccountId, now + 4],
        ["Outside range", "document", "active", accountId, now - 1],
      ] as const) {
        await ctx.db.insert("spectraArtifacts", {
          ownerAccountId, schoolId, title, blueprintKey, status, createdAt, updatedAt: createdAt,
          content: { text: "PRIVATE_BODY" }, textIndex: "PRIVATE_TEXT_INDEX", tags: [],
        });
      }
    });
    await backfill(t);
    const result = await t.withIdentity(identity).query(api.analytics.personalOverview, { from: now, to: now + 100 });
    expect(result.metrics.workCreated).toMatchObject({ value: 2, state: { kind: "available" } });
    expect(result.byType.reduce((sum, row) => sum + row.value, 0)).toBe(2);
    expect(result.recentWork.map(row => row.title)).toEqual(["Archived sheet", "Document"]);
    expect(result.metrics.modelTokens.value).toBeNull();
    expect(result.metrics.modelTokens.state.kind).toBe("partial");
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_BODY|PRIVATE_TEXT_INDEX|Foreign|Legacy calendar/);
  });

  it("keeps recent work and run lists current when aggregation is explicitly partial", async () => {
    const { t, now, schoolId, accountId } = await setup();
    await t.run(async ctx => {
      for (let index = 0; index < 2_010; index++) {
        const createdAt = now + index;
        await ctx.db.insert("spectraArtifacts", {
          ownerAccountId: accountId, schoolId, blueprintKey: "document", title: `Work ${index}`,
          status: "active", content: {}, textIndex: "", tags: [], createdAt, updatedAt: createdAt,
        });
        await ctx.db.insert("spectraAiRuns", {
          ownerAccountId: accountId, schoolId, sourceSurface: "chat", status: "completed",
          userPrompt: "PRIVATE_PROMPT", suggestedThreadTitle: `Run ${index}`, createdAt, updatedAt: createdAt,
        });
      }
    });
    await backfill(t);
    const result = await t.withIdentity(identity).query(api.analytics.personalOverview, { from: now, to: now + 3_000 });
    expect(result.metrics.workCreated).toMatchObject({ value: 2_000, state: { kind: "partial" } });
    expect(result.metrics.aiRuns).toMatchObject({ value: 2_000, state: { kind: "partial" } });
    expect(result.recentWork.map(row => row.title)).toEqual(Array.from({ length: 8 }, (_, index) => `Work ${2009 - index}`));
    expect(result.recentRuns.map(row => row.title)).toEqual(Array.from({ length: 8 }, (_, index) => `Run ${2009 - index}`));
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PROMPT");
  });
});

describe("analytics compact read boundary", () => {
  it("keeps real nonempty analytics independent of artifact and run body size", async () => {
    const { t, now, schoolId, accountId, foreignAccountId } = await setup();
    const ids = await t.run(async ctx => {
      const artifacts: Id<"spectraArtifacts">[] = [];
      const runs: Id<"spectraAiRuns">[] = [];
      for (let index = 0; index < 12; index++) {
        artifacts.push(await ctx.db.insert("spectraArtifacts", {
          ownerAccountId: accountId, schoolId, blueprintKey: "document", title: `Artifact ${index}`,
          content: { text: "x".repeat(1_000) }, textIndex: "stable", status: "active", tags: [],
          createdAt: now + index, updatedAt: now + index,
        }));
        runs.push(await ctx.db.insert("spectraAiRuns", {
          ownerAccountId: accountId, schoolId, sourceSurface: "chat", status: "completed",
          userPrompt: "x".repeat(1_000), suggestedThreadTitle: `Run ${index}`,
          createdAt: now + index, updatedAt: now + index,
        }));
      }
      return { artifacts, runs };
    });
    await backfill(t);
    const measure = () => t.withIdentity(identity).run(async ctx => {
      const observer = observeDatabase(ctx.db);
      const result = await analyticsHandler({ ...ctx, db: observer.db }, { from: now, to: now + 100 });
      return { result, ...observer.snapshot() };
    });
    const small = await measure();
    await t.run(async ctx => {
      for (const id of ids.artifacts) await ctx.db.patch(id, {
        content: { text: "x".repeat(80_000) }, protectedBaseContent: { text: "x".repeat(80_000) },
      });
      for (const id of ids.runs) await ctx.db.patch(id, {
        userPrompt: "x".repeat(80_000), planIntent: { plan: "x".repeat(80_000) }, contextSnapshot: { context: "x".repeat(80_000) },
      });
      // Out-of-scope compact history must not grow this indexed range.
      for (let index = 0; index < 120; index++) {
        const id = await ctx.db.insert("spectraAiRuns", {
          ownerAccountId: foreignAccountId, schoolId, sourceSurface: "chat", status: "completed",
          userPrompt: "foreign", createdAt: now, updatedAt: now,
        });
        await upsertAnalyticsRun(ctx, (await ctx.db.get(id))!);
      }
    });
    const large = await measure();
    expect(large.result.metrics.workCreated.value).toBe(12);
    expect(large.result.metrics.aiRuns.value).toBe(12);
    expect(large.result.recentWork).toEqual(small.result.recentWork);
    expect(large.result.recentRuns).toEqual(small.result.recentRuns);
    expect(large.serializedDocumentBytes).toBe(small.serializedDocumentBytes);
    expect(large.documentsReturned).toBe(small.documentsReturned);
    expect(large.calls).toBe(small.calls);
    expect(large.writes).toBe(0);
    expect(large.reads.some(row => ["spectraArtifacts", "spectraAiRuns"].includes(row.table))).toBe(false);
    expect(large.reads.filter(row => row.table.endsWith("Summaries")).every(row => row.index === "by_account_created")).toBe(true);
    console.log("S10 compact analytics row ledger", JSON.stringify({ smallBytes: small.serializedDocumentBytes, largeBytes: large.serializedDocumentBytes, calls: large.calls, documentsReturned: large.documentsReturned }));
  });

  it("requires explicit complete migration, resumes bounded pages, and rejects arbitrary tail cursors", async () => {
    const { t, now, schoolId, accountId } = await setup();
    await t.run(async ctx => {
      for (let index = 0; index < 30; index++) await ctx.db.insert("spectraAiRuns", {
        ownerAccountId: accountId, schoolId, sourceSurface: "chat", status: "completed",
        userPrompt: "private", createdAt: now, updatedAt: now,
      });
    });
    const overview = () => t.withIdentity(identity).query(api.analytics.personalOverview, { from: now - 1, to: now + 1 });
    expect((await overview()).metrics.aiRuns).toMatchObject({ value: null, state: { kind: "partial" } });
    await expect(t.mutation(internal.analytics.backfillReadModels, { source: "runs", cursor: "arbitrary-tail" })).rejects.toThrow("ANALYTICS_BACKFILL_CURSOR_STALE");
    const first = await t.mutation(internal.analytics.backfillReadModels, { source: "runs", limit: 100 });
    expect(first).toMatchObject({ processed: 25, done: false });
    expect((await overview()).metrics.aiRuns.value).toBeNull();
    const last = await t.mutation(internal.analytics.backfillReadModels, { source: "runs", cursor: first.cursor });
    expect(last).toEqual({ processed: 5, cursor: null, done: true });
    expect((await overview()).metrics.aiRuns).toMatchObject({ value: 30, state: { kind: "available" } });
    expect((await overview()).metrics.workCreated.value).toBeNull();
    expect(await t.mutation(internal.analytics.backfillReadModels, { source: "runs" })).toEqual({ processed: 0, cursor: null, done: true });
    await t.mutation(internal.analytics.backfillReadModels, { source: "artifacts" });
    expect((await overview()).metrics.workCreated).toMatchObject({ value: 0, state: { kind: "available" } });
    await t.run(async ctx => { await ctx.db.patch(accountId, { status: "deactivated" }); });
    await expect(overview()).rejects.toThrow("AUTH_REQUIRED");
  });

  it("avoids every summary I/O on heartbeat but maintains status, ownership and deletion atomically", async () => {
    const { t, now, schoolId, accountId, foreignAccountId } = await setup();
    await backfill(t);
    const fixtureMutation = triggeredMutation({
      args: { runId: v.optional(v.id("spectraAiRuns")), fields: v.any(), remove: v.optional(v.boolean()) },
      handler: async (ctx, args) => {
        if (!args.runId) return ctx.db.insert("spectraAiRuns", args.fields);
        if (args.remove) await ctx.db.delete(args.runId);
        else await ctx.db.patch(args.runId, args.fields);
        return args.runId;
      },
    });
    const mutate = Reflect.get(fixtureMutation, "_handler") as (ctx: MutationCtx, args: { runId?: Id<"spectraAiRuns">; fields: object; remove?: boolean }) => Promise<Id<"spectraAiRuns">>;
    const runId = await t.run(ctx => mutate(ctx, { fields: {
      ownerAccountId: accountId, schoolId, sourceSurface: "chat", status: "running",
      userPrompt: "private", createdAt: now, updatedAt: now,
    } }));
    const readSummary = () => t.run(ctx => ctx.db.query("spectraAnalyticsRunSummaries").withIndex("by_run", q => q.eq("runId", runId)).unique());
    expect(await readSummary()).toMatchObject({ status: "running", ownerAccountId: accountId });
    const overview = () => t.withIdentity(identity).query(api.analytics.personalOverview, { from: now - 1, to: now + 1 });
    expect((await overview()).metrics.aiRuns.value).toBe(1);
    const heartbeat = await t.run(async ctx => {
      const observer = observeDatabase(ctx.db);
      await mutate({ ...ctx, db: observer.db }, { runId, fields: { updatedAt: now + 1, heartbeatAt: now + 1 } });
      return observer.snapshot();
    });
    expect(heartbeat.reads.some(row => row.table === "spectraAnalyticsRunSummaries")).toBe(false);
    await t.run(ctx => mutate(ctx, { runId, fields: { status: "completed", suggestedThreadTitle: "t".repeat(1_000) } }));
    expect(await readSummary()).toMatchObject({ status: "completed", title: "t".repeat(240) });
    await t.run(ctx => mutate(ctx, { runId, fields: { ownerAccountId: foreignAccountId } }));
    expect(await readSummary()).toMatchObject({ ownerAccountId: foreignAccountId });
    expect((await overview()).metrics.aiRuns.value).toBe(0);
    await t.run(ctx => mutate(ctx, { runId, fields: {}, remove: true }));
    expect(await readSummary()).toBeNull();
  });

  it("leaves dependent tabs untouched for message count changes but updates a changed displayed title", async () => {
    const { t, now, schoolId, accountId } = await setup();
    const ids = await t.run(async ctx => {
      const threadId = await ctx.db.insert("spectraThreads", {
        ownerAccountId: accountId, schoolId, title: "Thread title", origin: "chat", status: "active",
        messageCount: 0, createdAt: now, updatedAt: now,
      });
      const runId = await ctx.db.insert("spectraAiRuns", {
        ownerAccountId: accountId, schoolId, sourceSurface: "chat", status: "completed",
        userPrompt: "private", threadId, createdAt: now, updatedAt: now,
      });
      const tabId = await ctx.db.insert("spectraRunTabs", {
        ownerAccountId: accountId, schoolId, runId, threadId, surface: "chat",
        threadTitle: "Deliberately stale", createdAt: now, updatedAt: now,
      });
      return { threadId, tabId };
    });
    const patchThread = triggeredMutation({
      args: { title: v.string(), messageCount: v.number() },
      handler: async (ctx, args) => ctx.db.patch(ids.threadId, { ...args, updatedAt: now + 1 }),
    });
    const mutate = Reflect.get(patchThread, "_handler") as (ctx: MutationCtx, args: { title: string; messageCount: number }) => Promise<void>;
    const unchanged = await t.run(async ctx => {
      const observer = observeDatabase(ctx.db);
      await mutate({ ...ctx, db: observer.db }, { title: "Thread title", messageCount: 10 });
      return observer.snapshot();
    });
    expect(unchanged.reads.some(row => row.table === "spectraRunTabs")).toBe(false);
    expect((await t.run(ctx => ctx.db.get(ids.tabId)))?.threadTitle).toBe("Deliberately stale");
    await t.run(ctx => mutate(ctx, { title: "New displayed title", messageCount: 10 }));
    expect((await t.run(ctx => ctx.db.get(ids.tabId)))?.threadTitle).toBe("New displayed title");
  });
});
