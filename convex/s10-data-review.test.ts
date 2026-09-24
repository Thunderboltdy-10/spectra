/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { get, getActiveExecution } from "./spectraThreads";
import { projectRunTabSummary, RUN_TAB_PROJECTION_VERSION } from "./spectraRunProjection";
import { observeDatabase, serializedBytes } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const emitEvidence = process.env.SPECTRA_DATA_REVIEW_EVIDENCE === "1";
const identity = { subject: "s10-data-review", email: "s10-data-review@example.test", emailVerified: true };
const getHandler = Reflect.get(get, "_handler") as (
  ctx: QueryCtx, args: FunctionArgs<typeof api.spectraThreads.get>,
) => Promise<FunctionReturnType<typeof api.spectraThreads.get>>;
const activeHandler = Reflect.get(getActiveExecution, "_handler") as (
  ctx: QueryCtx, args: FunctionArgs<typeof api.spectraThreads.getActiveExecution>,
) => Promise<FunctionReturnType<typeof api.spectraThreads.getActiveExecution>>;

async function fixture(history = 0) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = 1_800_000_000_000;
    const schoolId = await ctx.db.insert("schools", {
      name: "Synthetic DATA review school", slug: "s10-data-review", verifiedDomains: [],
      status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true,
      name: "Synthetic reader", status: "active", createdAt: now, updatedAt: now,
    });
    const membershipId = await ctx.db.insert("schoolMemberships", {
      accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: accountId, schoolId, blueprintKey: "document", title: "Selected context",
      content: { blocks: [] }, tags: [], status: "active", createdAt: now, updatedAt: now,
    });
    const threadId = await ctx.db.insert("spectraThreads", {
      ownerAccountId: accountId, schoolId, artifactId, title: "Measured thread", origin: "chat",
      status: "active", messageCount: 0, createdAt: now, updatedAt: now,
    });
    for (let index = 0; index < history; index++) {
      const runId = await ctx.db.insert("spectraAiRuns", {
        ownerAccountId: accountId, schoolId, threadId, sourceSurface: "chat", status: "completed",
        userPrompt: "Past prompt ".repeat(150), finalSummary: "Past result ".repeat(95),
        contextSnapshot: { text: "H".repeat(20_000) }, createdAt: now + index, updatedAt: now + index,
      });
      const run = (await ctx.db.get(runId))!;
      await ctx.db.insert("spectraRunTabs", {
        ownerAccountId: accountId, schoolId, threadId, runId, surface: "chat",
        projectionVersion: RUN_TAB_PROJECTION_VERSION, runSummary: projectRunTabSummary(run),
        createdAt: now + index, updatedAt: now + index,
      });
    }
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: accountId, schoolId, threadId, sourceSurface: "chat", status: "running",
      phase: "streaming", userPrompt: "Active prompt", contextSnapshot: { text: "ACTIVE-BODY".repeat(20_000) },
      createdAt: now + history, updatedAt: now + history,
    });
    const run = (await ctx.db.get(runId))!;
    const tabId = await ctx.db.insert("spectraRunTabs", {
      ownerAccountId: accountId, schoolId, threadId, runId, surface: "chat",
      projectionVersion: RUN_TAB_PROJECTION_VERSION, runSummary: projectRunTabSummary(run),
      createdAt: now + history, updatedAt: now + history,
    });
    await ctx.db.patch(threadId, { lastRunId: runId });
    return { accountId, schoolId, membershipId, threadId, artifactId, runId, tabId };
  });
  return { t, ids, user: t.withIdentity(identity) };
}

async function measure<T>(user: Awaited<ReturnType<typeof fixture>>["user"], run: (ctx: QueryCtx) => Promise<T>) {
  return user.run(async (ctx) => {
    const fetchedIds: string[] = [];
    const observer = observeDatabase(new Proxy(ctx.db, {
      get(target, property) {
        const member = Reflect.get(target, property, target);
        if (property === "get") return (...args: unknown[]) => {
          fetchedIds.push(String(args.at(-1)));
          return Reflect.apply(member, target, args);
        };
        return typeof member === "function" ? member.bind(target) : member;
      },
    }));
    const result = await run({ ...ctx, db: observer.db });
    return { result, fetchedIds, responseBytes: serializedBytes(result), ...observer.snapshot() };
  });
}

describe("S10 DATA independent conversation reads", () => {
  it.each([0, 240])("reads only the selected tab with %i historical runs", async (history) => {
    const { ids, user } = await fixture(history);
    const detail = await measure(user, (ctx) => getHandler(ctx, { threadId: ids.threadId }));
    const active = await measure(user, (ctx) => activeHandler(ctx, { threadId: ids.threadId }));
    expect(detail.result.activeExecution?.run).toMatchObject({ _id: ids.runId, status: "running" });
    expect(active.result?.run).toMatchObject({ _id: ids.runId, status: "running" });
    if (emitEvidence) {
      const safe = ({ result: _result, fetchedIds: _ids, ...sample }: typeof detail | typeof active) => sample;
      console.log(JSON.stringify({ history, detail: safe(detail), active: safe(active) }));
    }
    for (const sample of [detail, active]) {
      expect(sample.reads.filter((read) => read.table === "spectraRunTabs")).toEqual([
        expect.objectContaining({ index: "by_account_run", operation: "first", documentsReturned: 1, postIndexFilter: false }),
      ]);
      expect(sample.fetchedIds).not.toContain(ids.runId);
      expect(sample.serializedDocumentBytes).toBeLessThan(10_000);
      expect(sample.responseBytes).toBeLessThan(2_000);
      expect(sample.writes).toBe(0);
    }
  });

  it.each(["missing", "stale", "missing-summary", "wrong-run", "wrong-summary-run", "wrong-thread", "wrong-summary-thread", "wrong-school", "foreign-owner"] as const)(
    "uses one canonical fallback for a %s selected tab", async (mode) => {
      const { t, ids, user } = await fixture(0);
      await t.run(async (ctx) => {
        if (mode === "missing") return ctx.db.delete(ids.tabId);
        if (mode === "stale") return ctx.db.patch(ids.tabId, { projectionVersion: 0 });
        if (mode === "missing-summary") return ctx.db.patch(ids.tabId, { runSummary: undefined });
        if (mode === "wrong-run" || mode === "wrong-summary-run") {
          const runId = await ctx.db.insert("spectraAiRuns", {
            ownerAccountId: ids.accountId, schoolId: ids.schoolId, threadId: ids.threadId,
            sourceSurface: "chat", status: "completed", userPrompt: "Other run", createdAt: 1, updatedAt: 1,
          });
          const tab = (await ctx.db.get(ids.tabId))!;
          return ctx.db.patch(ids.tabId, mode === "wrong-run"
            ? { runId }
            : { runSummary: { ...tab.runSummary!, _id: runId } });
        }
        if (mode === "wrong-thread" || mode === "wrong-summary-thread") {
          const threadId = await ctx.db.insert("spectraThreads", {
            ownerAccountId: ids.accountId, schoolId: ids.schoolId, title: "Other thread", origin: "chat",
            status: "active", createdAt: 1, updatedAt: 1,
          });
          const tab = (await ctx.db.get(ids.tabId))!;
          return ctx.db.patch(ids.tabId, mode === "wrong-thread"
            ? { threadId }
            : { runSummary: { ...tab.runSummary!, threadId } });
        }
        if (mode === "wrong-school") return ctx.db.patch(ids.tabId, { schoolId: undefined });
        const accountId = await ctx.db.insert("accounts", {
          clerkId: "s10-other", email: "s10-other@example.test", emailVerified: true,
          name: "Other reader", status: "active", createdAt: 1, updatedAt: 1,
        });
        await ctx.db.patch(ids.tabId, { ownerAccountId: accountId });
      });
      for (const read of [
        (ctx: QueryCtx) => getHandler(ctx, { threadId: ids.threadId }).then((value) => value.activeExecution),
        (ctx: QueryCtx) => activeHandler(ctx, { threadId: ids.threadId }),
      ]) {
        const sample = await measure(user, read);
        expect(sample.result?.run).toMatchObject({ _id: ids.runId, status: "running" });
        expect(sample.fetchedIds.filter((id) => id === ids.runId)).toHaveLength(1);
        expect(sample.reads.filter((row) => row.table === "spectraRunTabs")).toEqual([
          expect.objectContaining({ index: "by_account_run", operation: "first", postIndexFilter: false }),
        ]);
        expect(sample.writes).toBe(0);
      }
    },
  );

  it.each(["missing", "wrong-school", "foreign-owner"] as const)(
    "rejects a %s canonical selected run when the projection is invalid", async (mode) => {
      const { t, ids, user } = await fixture();
      await t.run(async (ctx) => {
        await ctx.db.patch(ids.tabId, { projectionVersion: 0 });
        if (mode === "missing") return ctx.db.delete(ids.runId);
        if (mode === "wrong-school") return ctx.db.patch(ids.runId, { schoolId: undefined });
        const ownerAccountId = await ctx.db.insert("accounts", {
          clerkId: "s10-other", email: "s10-other@example.test", emailVerified: true,
          name: "Other reader", status: "active", createdAt: 1, updatedAt: 1,
        });
        await ctx.db.patch(ids.runId, { ownerAccountId });
      });
      expect((await user.query(api.spectraThreads.get, { threadId: ids.threadId })).activeExecution).toBeNull();
      expect(await user.query(api.spectraThreads.getActiveExecution, { threadId: ids.threadId })).toBeNull();
    },
  );

  it("does not look up a tab or run when the thread has no selected run", async () => {
    const { t, ids, user } = await fixture(240);
    await t.run((ctx) => ctx.db.patch(ids.threadId, { lastRunId: undefined }));
    for (const read of [
      (ctx: QueryCtx) => getHandler(ctx, { threadId: ids.threadId }).then((value) => value.activeExecution),
      (ctx: QueryCtx) => activeHandler(ctx, { threadId: ids.threadId }),
    ]) {
      const sample = await measure(user, read);
      expect(sample.result).toBeNull();
      expect(sample.reads.filter((read) => read.table === "spectraRunTabs")).toHaveLength(0);
      expect(sample.fetchedIds).not.toContain(ids.runId);
    }
  });

  it("rejects a lastRunId belonging to another conversation with or without a projected tab", async () => {
    const { t, ids, user } = await fixture();
    await t.run(async (ctx) => {
      const otherThreadId = await ctx.db.insert("spectraThreads", {
        ownerAccountId: ids.accountId, schoolId: ids.schoolId, title: "Other thread", origin: "chat",
        status: "active", createdAt: 1, updatedAt: 1,
      });
      await ctx.db.patch(ids.runId, { threadId: otherThreadId });
      const run = (await ctx.db.get(ids.runId))!;
      await ctx.db.patch(ids.tabId, { runSummary: projectRunTabSummary(run) });
    });
    for (const projected of [true, false]) {
      if (!projected) await t.run((ctx) => ctx.db.delete(ids.tabId));
      expect((await user.query(api.spectraThreads.get, { threadId: ids.threadId })).activeExecution).toBeNull();
      expect(await user.query(api.spectraThreads.getActiveExecution, { threadId: ids.threadId })).toBeNull();
    }
  });

  it("rechecks thread and school authority on every refresh and permits archived threads", async () => {
    const { t, ids, user } = await fixture();
    await t.run((ctx) => ctx.db.patch(ids.threadId, { status: "archived" }));
    expect((await user.query(api.spectraThreads.getActiveExecution, { threadId: ids.threadId }))?.run._id).toBe(ids.runId);
    await t.run((ctx) => ctx.db.patch(ids.schoolId, { status: "suspended" }));
    await expect(user.query(api.spectraThreads.getActiveExecution, { threadId: ids.threadId })).rejects.toThrow("AUTH_NO_SCHOOL");
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.schoolId, { status: "active" });
      await ctx.db.patch(ids.threadId, { status: "deleted" });
    });
    await expect(user.query(api.spectraThreads.get, { threadId: ids.threadId })).rejects.toThrow("Thread not found");
  });
});
