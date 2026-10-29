/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { schoolOverview } from "./administration";
import type { MutationCtx } from "./_generated/server";
import { bridgeKey, calendarFixture, identity } from "../scripts/test-fixtures/managebac-calendar";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", bridgeKey));
afterEach(() => vi.unstubAllEnvs());

describe("school administration launch evidence", () => {
  it("compares a person's actual saved planner and never returns another person's private copy", async () => {
    const f = await calendarFixture(modules, "school_admin");
    await f.sync();
    const planner = await f.plan();
    const conflictId = await f.t.run(async ctx => {
      const source = await ctx.db.query("externalRecords").first();
      await ctx.db.patch(planner!._id, { title: "My own title", content: { ...planner!.content as object, description: "My full local description" } });
      return ctx.db.insert("externalSyncConflicts", {
        integrationId: f.seed.integrationId, schoolId: f.seed.schoolId, syncRunId: f.seed.syncRunId, accountId: f.seed.accountId,
        recordId: source!._id, projectionType: "planner_task", projectionId: planner!._id,
        kind: "customization_overlap", oldSource: {}, newSource: {}, affectedLinks: [], suggestedActions: ["rebase"], status: "open", createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    expect(await f.user.query(api.managebac.conflictComparison, { conflictId })).toMatchObject({ state: "available", fields: { title: "My own title", description: "My full local description" } });
    const otherId = await f.t.run(ctx => ctx.db.insert("accounts", { clerkId: "other", email: "other@example.test", emailVerified: true, name: "Other", status: "active", createdAt: Date.now(), updatedAt: Date.now() }));
    await f.t.run(ctx => ctx.db.patch(conflictId, { accountId: otherId }));
    expect(await f.user.query(api.managebac.conflictComparison, { conflictId })).toEqual({ state: "private" });
    await f.t.run(async ctx => {
      const membership = await ctx.db.query("schoolMemberships").first();
      await ctx.db.patch(membership!._id, { role: "student" });
    });
    await expect(f.user.query(api.managebac.conflictComparison, { conflictId })).rejects.toThrow("INTEGRATION_CONFLICT_FORBIDDEN");
  });

  it("reports conflicts with a single indexed row and derives freshness from the configured SLA", async () => {
    const f = await calendarFixture(modules, "school_admin");
    await f.sync();
    const { task } = await f.items();
    await f.t.run(async ctx => {
      await ctx.db.patch(f.seed.integrationId, { lastSyncAt: Date.now() - 61 * 60_000 });
      const record = await ctx.db.query("externalRecords").first();
      for (let i = 0; i < 120; i++) await ctx.db.insert("externalSyncConflicts", {
        integrationId: f.seed.integrationId, schoolId: f.seed.schoolId, syncRunId: f.seed.syncRunId,
        recordId: record!._id, projectionType: "planner_task", projectionId: task._id,
        kind: "source_changed", oldSource: {}, newSource: {}, affectedLinks: [], suggestedActions: ["rebase"],
        status: "open", createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    const handler = Reflect.get(schoolOverview, "_handler") as (ctx: MutationCtx, args: { fromDay: string; toDay: string }) => Promise<unknown>;
    const measured = await f.t.run(async ctx => {
      const observed = observeDatabase(ctx.db);
      const auth = { getUserIdentity: async () => ({ ...identity, tokenIdentifier: "fixture|" + identity.subject, issuer: "fixture" }) };
      const result = await handler({ ...ctx, db: observed.db, auth }, { fromDay: "2026-10-01", toDay: "2026-10-31" });
      return { result, ...observed.snapshot() };
    });
    expect(measured.result).toMatchObject({ integration: { status: "connected", hasOpenConflicts: true, syncFreshness: "stale" } });
    expect(measured.reads.filter(r => r.table === "externalSyncConflicts").reduce((sum, r) => sum + r.documentsReturned, 0)).toBe(1);
    await f.t.run(async ctx => {
      for (const conflict of await ctx.db.query("externalSyncConflicts").collect()) await ctx.db.delete(conflict._id);
      await ctx.db.patch(f.seed.integrationId, { lastSyncAt: Date.now() });
    });
    expect(await f.user.mutation(api.administration.schoolOverview, { fromDay: "2026-10-01", toDay: "2026-10-31" })).toMatchObject({ integration: { hasOpenConflicts: false, syncFreshness: "current" } });
  });

  it("serves school feedback evidence only to the report's school admin", async () => {
    const f = await calendarFixture(modules, "school_admin");
    const feedbackId = await f.t.run(ctx => ctx.db.insert("feedbackReports", {
      schoolId: f.seed.schoolId, reporterAccountId: f.seed.accountId, category: "issue", sentiment: "negative",
      subject: "A broken page", message: "See the attached files", status: "new", visibility: "reporter_and_responders",
      pagePath: "/library", createdAt: Date.now(), updatedAt: Date.now(),
    }));
    expect(await f.user.query(api.administration.feedbackEvidence, { feedbackId })).toEqual({ feedbackId, pagePath: "/library", screenshotUrl: null, attachments: [] });
    const storageId = await f.t.run(ctx => ctx.storage.store(new Blob(["fixture evidence"], { type: "image/png" })));
    await f.t.run(ctx => ctx.db.patch(feedbackId, { screenshotStorageId: storageId, attachments: [{ storageId, name: "evidence.png", mediaType: "image/png", bytes: 16 }] }));
    expect(await f.user.query(api.administration.feedbackEvidence, { feedbackId })).toMatchObject({ screenshotUrl: expect.any(String), attachments: [{ name: "evidence.png", url: expect.any(String) }] });
    await f.t.run(ctx => ctx.db.patch(feedbackId, { schoolId: undefined }));
    await expect(f.user.query(api.administration.feedbackEvidence, { feedbackId })).rejects.toThrow("FEEDBACK_NOT_FOUND");
    await f.t.run(async ctx => {
      const membership = await ctx.db.query("schoolMemberships").first();
      await ctx.db.patch(membership!._id, { role: "student" });
    });
    await expect(f.user.query(api.administration.feedbackEvidence, { feedbackId })).rejects.toThrow("AUTH_SCHOOL_ADMIN_REQUIRED");
  });
});
