/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const execute = makeFunctionReference<"mutation">("spectraApplicationWrites:execute");
const patch = { writing: { smartCompletion: false } };
afterEach(() => vi.useRealTimers());

async function fixture(observed = true, approve = true) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Writer fence", slug: "writer-fence", verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: "writer-fence", email: "writer-fence@example.test", emailVerified: true, name: "Writer fence", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { schoolId, accountId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: accountId, schoolId, sourceSurface: "chat", userPrompt: "Turn Smart completion off",
      status: "running", executionId: "attempt", createdAt: now, updatedAt: now,
      ...(observed ? { uiObserverInterests: { executionId: "attempt", clients: [{ clientId: "tab", mode: "follow" as const }] } } : {}),
    });
    const operationId = await ctx.db.insert("spectraOperations", {
      runId, executionId: "attempt", actorType: "ai", type: "app.command", status: "proposed",
      input: { command: "change_spectra_settings", args: { patch } }, requiresConfirmation: true, affected: [], createdAt: now,
    });
    return { runId, operationId, executionId: "attempt" };
  });
  const actor = t.withIdentity({ subject: "writer-fence", email: "writer-fence@example.test", emailVerified: true });
  if (approve) {
    await actor.mutation(api.spectraRuns.updateStatus, { runId: ids.runId, executionId: ids.executionId, status: "awaiting_confirmation", approvalReasons: ["Change account preferences"] });
    await actor.mutation(api.spectraRuns.claimConfirmation, { runId: ids.runId, executionId: ids.executionId });
  }
  await t.run(ctx => ctx.db.patch(ids.runId, { status: "running" }));
  await actor.mutation(api.spectraOperations.claim, { operationId: ids.operationId, executionId: ids.executionId });
  const args = { ...ids, expectedCommand: "change_spectra_settings", expectedArgs: { patch } };
  const operation = () => t.run(ctx => ctx.db.get(ids.operationId));
  const preferences = () => t.run(ctx => ctx.db.query("accountPreferences").collect());
  const prepare = () => actor.mutation(api.spectraOperations.prepareUiAction, ids);
  const fence = async () => {
    const observation = (await operation())!.uiObservation!;
    return { epoch: observation.epoch, sequence: observation.sequence, operationDigest: observation.operationDigest };
  };
  const ready = async () => actor.mutation(api.spectraOperations.acknowledgeUiAction, {
    ...ids, fence: await fence(), observer: { clientId: "tab", mode: "follow" }, outcome: "target_ready",
  });
  return { t, ids, actor, args, operation, preferences, prepare, fence, ready };
}

describe("application writer enforces persisted UI observation", () => {
  it("keeps approved unobserved settings writes immediate", async () => {
    const f = await fixture(false);
    expect(await f.prepare()).toEqual({ phase: "headless" });
    await f.actor.mutation(execute, f.args);
    expect(await f.preferences()).toMatchObject([{ values: patch }]);
  });

  it("cannot omit a stored waiting fence or submit it before the target is ready", async () => {
    const f = await fixture();
    await f.prepare();
    await expect(f.actor.mutation(execute, f.args)).rejects.toThrow("UI_OBSERVATION_STALE");
    await expect(f.actor.mutation(execute, { ...f.args, uiObservation: await f.fence() })).rejects.toThrow("UI_OBSERVATION_STALE");
    expect(await f.preferences()).toEqual([]);
    expect((await f.operation())?.output?.applicationWriteReceipt).toBeUndefined();
  });

  it("requires the exact sealed fence, then replays its receipt before rechecking observation", async () => {
    const f = await fixture();
    await f.prepare();
    await f.ready();
    const fence = await f.fence();
    await expect(f.actor.mutation(execute, { ...f.args, uiObservation: { ...fence, epoch: fence.epoch + 1 } })).rejects.toThrow("UI_OBSERVATION_STALE");
    const result = await f.actor.mutation(execute, { ...f.args, uiObservation: fence });
    await f.actor.mutation(api.accountPreferences.writeLayer, { scope: "account", scopeKey: "account", values: { writing: { smartCompletion: true } } });
    await f.t.run(ctx => ctx.db.patch(f.ids.runId, { status: "completed" }));
    expect(await f.actor.mutation(execute, f.args)).toEqual(result);
    expect(await f.actor.mutation(execute, { ...f.args, uiObservation: { ...fence, epoch: 999 } })).toEqual(result);
    expect(await f.preferences()).toMatchObject([{ values: { writing: { smartCompletion: true } } }]);
  });

  it("requires explicit expiry recovery before accepting the new headless epoch", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    await f.prepare();
    await f.ready();
    const stale = await f.fence();
    vi.setSystemTime((await f.operation())!.uiObservation!.expiresAt + 1);
    await expect(f.actor.mutation(execute, { ...f.args, uiObservation: stale })).rejects.toThrow("UI_OBSERVATION_STALE");
    expect(await f.preferences()).toEqual([]);
    await f.actor.mutation(api.spectraOperations.expireUiAction, { ...f.ids, epoch: stale.epoch });
    await expect(f.actor.mutation(execute, { ...f.args, uiObservation: stale })).rejects.toThrow("UI_OBSERVATION_STALE");
    await f.actor.mutation(execute, { ...f.args, uiObservation: await f.fence() });
    expect(await f.preferences()).toMatchObject([{ values: patch }]);
  });

  it("never substitutes target readiness for user approval", async () => {
    const f = await fixture(true, false);
    await f.prepare();
    await f.ready();
    await expect(f.actor.mutation(execute, { ...f.args, uiObservation: await f.fence() })).rejects.toThrow("APPROVAL_SCOPE_REQUIRED");
    expect(await f.preferences()).toEqual([]);
  });

  it("does not use a sealed fence to revive a cancelled attempt", async () => {
    const f = await fixture();
    await f.prepare();
    await f.ready();
    await f.t.run(ctx => ctx.db.patch(f.ids.runId, { status: "cancelled" }));
    await expect(f.actor.mutation(execute, { ...f.args, uiObservation: await f.fence() })).rejects.toThrow("NOT_ACTIVE");
    expect(await f.preferences()).toEqual([]);
  });

  it("rejects a supplied observation fence when no observation exists", async () => {
    const f = await fixture(false);
    await expect(f.actor.mutation(execute, { ...f.args, uiObservation: { epoch: 1, sequence: 0, operationDigest: "unrecorded" } })).rejects.toThrow("UI_OBSERVATION_STALE");
    expect(await f.preferences()).toEqual([]);
  });
});
