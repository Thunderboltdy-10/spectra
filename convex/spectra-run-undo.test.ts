/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Undo", slug: "undo", verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: "undo-owner", email: "undo@example.test", emailVerified: true, name: "Undo", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { schoolId, accountId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const threadId = await ctx.db.insert("spectraThreads", { ownerAccountId: accountId, schoolId, title: "Undo", origin: "chat", status: "active", messageCount: 2, createdAt: now, updatedAt: now });
    const previousId = await ctx.db.insert("spectraAiRuns", { ownerAccountId: accountId, schoolId, threadId, sourceSurface: "chat", userPrompt: "Edit", status: "completed", phase: "completed", executionId: "prior-exec", createdAt: now + 1000, updatedAt: now });
    return { accountId, schoolId, threadId, previousId };
  });
  const currentId = await t.run(async (ctx) => ctx.db.insert("spectraAiRuns", { ownerAccountId: ids.accountId, schoolId: ids.schoolId, threadId: ids.threadId, sourceSurface: "chat", userPrompt: "Undo", status: "running", phase: "applying", executionId: "current-exec", createdAt: 1, updatedAt: Date.now() }));
  const actor = t.withIdentity({ subject: "undo-owner", email: "undo@example.test", emailVerified: true });
  return { t, actor, ...ids, currentId };
}

describe("run Undo lookup and receipt fences", () => {
  it("keeps the saved-outcome guard and admits a completed reversal with its own receipt", async () => {
    const f = await fixture();
    const request = { runId: f.currentId, executionId: "current-exec", previousRunId: f.previousId, previousExecutionId: "prior-exec" };
    await expect(f.actor.mutation(api.spectraRuns.updateStatus, { runId: f.currentId, executionId: "current-exec", status: "completed", outcome: "canonical_saved" })).rejects.toThrow("without a committed operation");
    await expect(f.actor.mutation(api.spectraRunUndo.recordReversal, request)).rejects.toThrow("no committed reversal");
    await f.t.run(async (ctx) => ctx.db.insert("spectraResultCards", { runId: f.previousId, surface: "chat", status: "completed", variant: "status", title: "Done", summary: "Undone: restored 1 work.", actions: [{ key: "undone", label: "Undone" }], provenance: { undoneByRunId: f.currentId }, createdAt: Date.now(), updatedAt: Date.now() }));
    const receipt = await f.actor.mutation(api.spectraRunUndo.recordReversal, request);
    expect(await f.actor.mutation(api.spectraRunUndo.recordReversal, request)).toEqual(receipt);
    await expect(f.actor.mutation(api.spectraRunUndo.recordReversal, { ...request, previousExecutionId: "stale" })).rejects.toThrow("no longer active");
    await f.actor.mutation(api.spectraRuns.updateStatus, { runId: f.currentId, executionId: "current-exec", status: "completed", outcome: "canonical_saved" });
    expect(await f.t.run(async (ctx) => (await ctx.db.get(f.currentId))?.status)).toBe("completed");
  });
  it("returns only the immediate predecessor metadata, excluding newer runs", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => { const current = (await ctx.db.get(f.currentId))!; const { _id, _creationTime, ...row } = current; void _id; void _creationTime; await ctx.db.insert("spectraAiRuns", row); });
    expect(await f.actor.query(api.spectraRuns.previousForUndo, { runId: f.currentId, executionId: "current-exec" })).toEqual({ runId: f.previousId, executionId: "prior-exec" });
  });
  it("does not skip over an active predecessor or cross threads", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => ctx.db.patch(f.previousId, { status: "running" }));
    expect(await f.actor.query(api.spectraRuns.previousForUndo, { runId: f.currentId, executionId: "current-exec" })).toBeNull();
    await f.t.run(async (ctx) => ctx.db.patch(f.currentId, { threadId: undefined }));
    expect(await f.actor.query(api.spectraRuns.previousForUndo, { runId: f.currentId, executionId: "current-exec" })).toBeNull();
  });
  it("rejects stale/inactive current attempts and foreign ownership", async () => {
    const f = await fixture();
    await expect(f.actor.query(api.spectraRuns.previousForUndo, { runId: f.currentId, executionId: "old" })).rejects.toThrow("no longer active");
    await expect(f.t.withIdentity({ subject: "other" }).query(api.spectraRuns.previousForUndo, { runId: f.currentId, executionId: "current-exec" })).rejects.toThrow();
    await f.t.run(async (ctx) => ctx.db.patch(f.currentId, { status: "completed" }));
    await expect(f.actor.query(api.spectraRuns.previousForUndo, { runId: f.currentId, executionId: "current-exec" })).rejects.toThrow("NOT_ACTIVE");
  });
  it("preserves settings for stale/active attempts and reverses each executed receipt once", async () => {
    const f = await fixture();
    const preferenceId = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("accountPreferences", { accountId: f.accountId, scope: "account", scopeKey: "account", schemaVersion: 1, values: { appearance: { theme: "dark" } }, updatedAt: Date.now() });
      await ctx.db.insert("spectraOperations", { runId: f.previousId, executionId: "prior-exec", actorType: "ai", type: "app.command", status: "executed", input: { command: "change_spectra_settings", args: { patch: { appearance: { theme: "dark" } } } }, output: { applicationWriteReceipt: { result: {} }, undoState: { values: { appearance: { theme: "light" } } } }, affected: [], requiresConfirmation: true, createdAt: Date.now() });
      return id;
    });
    await expect(f.actor.mutation(api.spectraRunUndo.reverseWrites, { runId: f.previousId, executionId: "stale" })).rejects.toThrow("no longer active");
    await expect(f.actor.mutation(api.spectraRunUndo.reverseWrites, { runId: f.currentId, executionId: "current-exec" })).rejects.toThrow("after Spectra finishes");
    expect(await f.t.run(async (ctx) => (await ctx.db.get(preferenceId))?.values)).toEqual({ appearance: { theme: "dark" } });
    expect((await f.actor.mutation(api.spectraRunUndo.reverseWrites, { runId: f.previousId, executionId: "prior-exec" })).counts).toEqual({ settings: 1 });
    expect(await f.t.run(async (ctx) => (await ctx.db.get(preferenceId))?.values)).toEqual({ appearance: { theme: "light" } });
    expect((await f.actor.mutation(api.spectraRunUndo.reverseWrites, { runId: f.previousId, executionId: "prior-exec" })).counts).toEqual({});
  });
});
