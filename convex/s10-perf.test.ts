/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { list } from "./spectraArtifacts";
import { personalOverview } from "./analytics";
import { upsertArtifactSummary } from "./orgTreeShared";
import { syncAnalyticsRun } from "./analyticsReadModels";
import { observeDatabase, serializedBytes } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "s10-perf-fixture", email: "s10-perf@example.test", emailVerified: true };
const otherIdentity = { subject: "s10-perf-other", email: "s10-perf-other@example.test", emailVerified: true };
const listHandler = Reflect.get(list, "_handler") as (ctx: QueryCtx, args: { limit: number; search?: string }) => Promise<unknown[]>;
type AnalyticsResult = {
  metrics: Record<"workCreated" | "aiRuns" | "completionRate", { value: number | null; state: { kind: string } }>;
  runOutcomes: { completed: number; failed: number; active: number; cancelled: number };
  recentWork: unknown[];
  recentRuns: unknown[];
};
const analyticsHandler = Reflect.get(personalOverview, "_handler") as (ctx: QueryCtx, args: { from: number; to: number }) => Promise<AnalyticsResult>;

describe("S10 independent database-boundary measurements", () => {
  it("keeps complete Library and migrated analytics independent of canonical body size", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", { name: "Synthetic PERF school", slug: "s10-perf", verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
      const accountId = await ctx.db.insert("accounts", { clerkId: identity.subject, email: identity.email, emailVerified: true, name: "Synthetic PERF actor", status: "active", createdAt: now, updatedAt: now });
      await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
      const otherAccountId = await ctx.db.insert("accounts", { clerkId: otherIdentity.subject, email: otherIdentity.email, emailVerified: true,
        name: "Synthetic other actor", status: "active", createdAt: now, updatedAt: now });
      await ctx.db.insert("schoolMemberships", { accountId: otherAccountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
      const artifacts = [];
      for (let index = 0; index < 12; index++) {
        const id = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", schemaVersion: 1,
          title: `PERF ${String(index).padStart(2, "0")}`, summary: "Metadata stays constant", tags: [], content: { text: "x".repeat(1_000) },
          textIndex: "constant search term", status: "active", createdAt: now - index, updatedAt: now - index });
        artifacts.push(id);
        await upsertArtifactSummary(ctx, (await ctx.db.get(id))!);
      }
      const runs = [];
      for (const [index, status] of (["completed", "failed", "running"] as const).entries()) {
        runs.push(await ctx.db.insert("spectraAiRuns", { ownerAccountId: accountId, schoolId,
          sourceSurface: "artifact", artifactId: artifacts[index], status,
          userPrompt: "PROMPT_PRIVATE".repeat(80), planIntent: { private: "PLAN_PRIVATE".repeat(80) },
          contextSnapshot: { private: "CONTEXT_PRIVATE".repeat(80) },
          finalSummary: `Synthetic outcome ${index}`, executionId: `perf-run-${index}`, createdAt: now - index, updatedAt: now - index }));
      }
      return { artifacts, runs, now, otherAccountId };
    });
    const measured = async <T,>(run: (ctx: QueryCtx) => Promise<T>, actorIdentity = identity) => t.withIdentity(actorIdentity).run(async (ctx) => {
      const observer = observeDatabase(ctx.db);
      const result = await run({ ...ctx, db: observer.db });
      return { result, responseBytes: serializedBytes(result), ...observer.snapshot() };
    });
    const analytics = (ctx: QueryCtx) => analyticsHandler(ctx, { from: seeded.now - 100, to: seeded.now + 100 });
    const unprepared = await measured(analytics);
    expect(unprepared.result.metrics.workCreated).toMatchObject({ value: null, state: { kind: "partial" } });
    expect(unprepared.result.metrics.aiRuns).toMatchObject({ value: null, state: { kind: "partial" } });
    const backfills = [];
    for (const source of ["artifacts", "runs"] as const) {
      let done = false;
      let processed = 0;
      let calls = 0;
      while (!done && calls < 10) {
        const page = await t.mutation(internal.analytics.backfillReadModels, { source, limit: 5 });
        processed += page.processed;
        done = page.done;
        calls++;
      }
      expect(done).toBe(true);
      expect(processed).toBe(source === "artifacts" ? 12 : 3);
      backfills.push({ source, processed, calls, done });
      if (source === "artifacts") {
        const partial = await measured(analytics);
        expect(partial.result.metrics.workCreated.value).toBe(12);
        expect(partial.result.metrics.aiRuns.value).toBeNull();
      }
    }
    const smallLibrary = await measured((ctx) => listHandler(ctx, { limit: 4 }));
    const smallAnalytics = await measured(analytics);
    await t.run(async (ctx) => {
      for (const id of seeded.artifacts) {
        await ctx.db.patch(id, { content: { text: "x".repeat(80_000) }, protectedBaseContent: { text: "x".repeat(80_000) } });
        await upsertArtifactSummary(ctx, (await ctx.db.get(id))!);
      }
      for (const id of seeded.runs) {
        const previous = await ctx.db.get(id);
        await ctx.db.patch(id, { userPrompt: "PROMPT_PRIVATE".repeat(6_000),
          planIntent: { private: "PLAN_PRIVATE".repeat(6_000) }, contextSnapshot: { private: "CONTEXT_PRIVATE".repeat(6_000) } });
        const observer = observeDatabase(ctx.db);
        await syncAnalyticsRun({ db: observer.db }, id, previous, await ctx.db.get(id));
        expect(observer.snapshot()).toMatchObject({ calls: 0, writes: 0 });
      }
    });
    const largeLibrary = await measured((ctx) => listHandler(ctx, { limit: 4 }));
    const search = await measured((ctx) => listHandler(ctx, { limit: 4, search: "constant search term" }));
    const largeAnalytics = await measured(analytics);
    expect(largeLibrary.result).toEqual(smallLibrary.result);
    expect(largeLibrary.documentsReturned).toBe(smallLibrary.documentsReturned);
    expect(largeLibrary.serializedDocumentBytes).toBe(smallLibrary.serializedDocumentBytes);
    expect(search.serializedDocumentBytes).toBeLessThanOrEqual(largeLibrary.serializedDocumentBytes);
    expect(largeLibrary.result).toHaveLength(4);
    for (const sample of [smallAnalytics, largeAnalytics]) {
      expect(sample.result.metrics.workCreated).toMatchObject({ value: 12, state: { kind: "available" } });
      expect(sample.result.metrics.aiRuns).toMatchObject({ value: 3, state: { kind: "available" } });
      expect(sample.result.metrics.completionRate.value).toBe(50);
      expect(sample.result.runOutcomes).toEqual({ completed: 1, failed: 1, active: 1, cancelled: 0 });
      expect(sample.result.recentWork).toHaveLength(8);
      expect(sample.result.recentRuns).toHaveLength(3);
      expect(sample.reads.filter((row) => row.table === "spectraArtifacts" || row.table === "spectraAiRuns")).toEqual([]);
      expect(JSON.stringify(sample.result)).not.toMatch(/PROMPT_PRIVATE|PLAN_PRIVATE|CONTEXT_PRIVATE/);
    }
    expect(largeAnalytics.serializedDocumentBytes).toBe(smallAnalytics.serializedDocumentBytes);
    expect(largeAnalytics.documentsReturned).toBe(smallAnalytics.documentsReturned);
    expect(largeAnalytics.responseBytes).toBe(smallAnalytics.responseBytes);
    for (const sample of [smallLibrary, largeLibrary, search, smallAnalytics, largeAnalytics]) {
      expect(sample.writes).toBe(0);
      expect(sample.responseBytes).toBeLessThan(20_000);
      expect(JSON.stringify(sample.result)).not.toContain("x".repeat(1_000));
    }
    // Require nonempty correct counts above before evaluating the cost budget.
    const analyticsBudget = { name: "body-independent analytics returned-row bytes",
      passed: largeAnalytics.serializedDocumentBytes <= smallAnalytics.serializedDocumentBytes + 512,
      smallBytes: smallAnalytics.serializedDocumentBytes, largeBytes: largeAnalytics.serializedDocumentBytes };
    expect(analyticsBudget.passed).toBe(true);
    const emptyPeer = await measured(analytics, otherIdentity);
    expect(emptyPeer.result.metrics.workCreated.value).toBe(0);
    expect(emptyPeer.result.metrics.aiRuns.value).toBe(0);
    await t.run(async (ctx) => {
      const runId = seeded.runs[2]!;
      const previous = await ctx.db.get(runId);
      await ctx.db.patch(runId, { status: "completed" });
      await syncAnalyticsRun(ctx, runId, previous, await ctx.db.get(runId));
    });
    const updated = await measured(analytics);
    expect(updated.result.runOutcomes).toEqual({ completed: 2, failed: 1, active: 0, cancelled: 0 });
    expect(updated.result.metrics.completionRate.value).toBe(67);
    // Synthetic projection maintenance, not authorization to transfer a real
    // artifact: each authenticated reader must see only its own new index rows.
    await t.run(async (ctx) => {
      const runId = seeded.runs[2]!;
      const previous = await ctx.db.get(runId);
      await ctx.db.patch(runId, { ownerAccountId: seeded.otherAccountId });
      await syncAnalyticsRun(ctx, runId, previous, await ctx.db.get(runId));
      const artifactId = seeded.artifacts[0]!;
      await ctx.db.patch(artifactId, { ownerAccountId: seeded.otherAccountId });
      await upsertArtifactSummary(ctx, (await ctx.db.get(artifactId))!);
    });
    const moved = await measured(analytics);
    const movedPeer = await measured(analytics, otherIdentity);
    expect(moved.result.metrics.workCreated.value).toBe(11);
    expect(moved.result.metrics.aiRuns.value).toBe(2);
    expect(movedPeer.result.metrics.workCreated.value).toBe(1);
    expect(movedPeer.result.metrics.aiRuns.value).toBe(1);
    await t.run(async (ctx) => {
      const runId = seeded.runs[0]!;
      const previous = await ctx.db.get(runId);
      await ctx.db.delete(runId);
      await syncAnalyticsRun(ctx, runId, previous, null);
      const artifactId = seeded.artifacts[1]!;
      await ctx.db.patch(artifactId, { status: "deleted" });
      await upsertArtifactSummary(ctx, (await ctx.db.get(artifactId))!);
    });
    const deleted = await measured(analytics);
    expect(deleted.result.metrics.workCreated.value).toBe(10);
    expect(deleted.result.metrics.aiRuns.value).toBe(1);
    expect(deleted.result.metrics.completionRate.value).toBe(0);
    expect(deleted.result.runOutcomes).toEqual({ completed: 0, failed: 1, active: 0, cancelled: 0 });
    if (process.env.SPECTRA_PERF_EVIDENCE === "1") {
      const directory = ".spectra-local/launch-audit/evidence/S10-PERF";
      mkdirSync(directory, { recursive: true });
      const safe = <T,>({ result: _result, ...sample }: { result: T } & Omit<typeof smallAnalytics, "result">) => sample;
      const previous = `${directory}/database-boundary.json`;
      const before = `${directory}/database-boundary-before-compact-analytics.json`;
      if (existsSync(previous) && !existsSync(before)) {
        const content = readFileSync(previous, "utf8");
        if (JSON.parse(content).analyticsBudget?.passed === false) writeFileSync(before, content);
      }
      const files = ["convex/spectraArtifacts.ts", "convex/analytics.ts", "convex/analyticsReadModels.ts", "convex/authorityShared.ts", "convex/orgTreeShared.ts", "scripts/perf-read-ledger.ts"];
      writeFileSync(`${directory}/database-boundary.json`, JSON.stringify({ evidence: "synthetic actual handlers via convex-test; not deployed engine usage",
        sourceHashes: Object.fromEntries(files.map((file) => [file, createHash("sha256").update(readFileSync(file)).digest("hex")])),
        backfills, expectedCounts: { workCreated: 12, aiRuns: 3, completionRate: 50 },
        projectionMaintenance: { statusUpdate: true, accountMoveIsolated: true, runDelete: true, artifactTombstone: true },
        smallLibrary: safe(smallLibrary), largeLibrary: safe(largeLibrary), search: safe(search), smallAnalytics: safe(smallAnalytics), largeAnalytics: safe(largeAnalytics), analyticsBudget }, null, 2));
      console.log(JSON.stringify({ smallLibrary: safe(smallLibrary), largeLibrary: safe(largeLibrary), analyticsBudget }));
    }
  });
});
