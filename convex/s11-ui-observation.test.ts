/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { applicationOperationScope } from "./spectraApplicationWriteScope";
import { uiObservationSnapshotSchema } from "../src/features/spectra/actions/protocol/semantic-action";

const modules = import.meta.glob("./**/*.ts");
async function fixture(modes: Array<"ordinary" | "follow"> = ["follow"]) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Observer", slug: "observer", verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: "observer", email: "observer@example.test", emailVerified: true, name: "Observer", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { schoolId, accountId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const runId = await ctx.db.insert("spectraAiRuns", { ownerAccountId: accountId, schoolId, sourceSurface: "chat", userPrompt: "Turn Smart completion off", status: "running", executionId: "attempt", createdAt: now, updatedAt: now, uiObserverInterests: { executionId: "attempt", clients: modes.map((mode, index) => ({ clientId: `tab-${index}`, mode })) } });
    const operationId = await ctx.db.insert("spectraOperations", { runId, executionId: "attempt", actorType: "ai", type: "app.command", status: "executing", input: { command: "change_spectra_settings", args: { patch: { writing: { smartCompletion: false } } } }, affected: [], createdAt: now });
    return { runId, operationId, executionId: "attempt" };
  });
  const actor = t.withIdentity({ subject: "observer", email: "observer@example.test", emailVerified: true });
  const prepare = async () => uiObservationSnapshotSchema.parse(await actor.mutation(api.spectraOperations.prepareUiAction, ids));
  const ack = async (clientId: string, mode: "ordinary" | "follow", outcome: "target_ready" | "invisible" | "released", epoch = 1) => {
    const row = await t.run(ctx => ctx.db.get(ids.operationId));
    return actor.mutation(api.spectraOperations.acknowledgeUiAction, { ...ids, observer: { clientId, mode }, outcome, fence: { epoch, sequence: 0, operationDigest: row!.uiObservation!.operationDigest } });
  };
  return { t, ids, actor, prepare, ack };
}
afterEach(() => vi.useRealTimers());

describe("S11 persisted settings observation", () => {
  it("keeps a headless operation immediate without storing an observation", async () => {
    const f = await fixture([]);
    expect(await f.prepare()).toEqual({ phase: "headless" });
    expect((await f.t.run(ctx => ctx.db.get(f.ids.operationId)))?.uiObservation).toBeUndefined();
  });

  it("retains both Follow tabs but only one durable owner and one sealed action", async () => {
    const f = await fixture(["follow", "follow"]);
    const offered = await f.prepare();
    expect(offered.participants).toHaveLength(2);
    expect(await f.ack("tab-0", "follow", "target_ready")).toMatchObject({ phase: "waiting" });
    expect(await f.ack("tab-1", "follow", "target_ready")).toMatchObject({ phase: "sealed", ownerClientId: "tab-0" });
    expect(await f.ack("tab-1", "follow", "target_ready")).toMatchObject({ phase: "sealed" });
    const operation = await f.t.run(ctx => ctx.db.get(f.ids.operationId));
    expect(operation?.status).toBe("executing");
    expect(operation?.output).toBeUndefined();
  });

  it("rejects an implicit Follow downgrade, foreign owner and stale epoch", async () => {
    const f = await fixture();
    await f.prepare();
    await expect(f.ack("tab-0", "ordinary", "invisible")).rejects.toThrow("UI_OBSERVER_MODE_MISMATCH");
    await expect(f.ack("tab-0", "follow", "invisible")).rejects.toThrow("UI_FOLLOW_REQUIRES_VISIBLE_TARGET");
    await expect(f.ack("another-tab", "follow", "target_ready")).rejects.toThrow("UI_OBSERVER_NOT_PARTICIPATING");
    await expect(f.ack("tab-0", "follow", "target_ready", 2)).rejects.toThrow("UI_OBSERVATION_STALE");
    expect(await f.ack("tab-0", "ordinary", "released")).toMatchObject({ phase: "headless" });
  });

  it("uses one ordinary observer instead of a barrier across every open tab", async () => {
    const f = await fixture(["ordinary", "ordinary"]);
    expect((await f.prepare()).participants).toHaveLength(1);
    expect(await f.ack("tab-1", "ordinary", "invisible")).toMatchObject({ phase: "headless" });
  });

  it("lets a second Follow join before seal without extending the deadline, then rejects preemption after seal", async () => {
    const f = await fixture();
    const offered = await f.prepare();
    const join = { ...f.ids, clientId: "tab-new", mode: "follow" as const };
    const joined = await f.actor.mutation(api.spectraOperations.setUiObserverInterest, join);
    expect(joined.observation).toMatchObject({ phase: "waiting", action: { expiresAt: offered.action!.expiresAt, epoch: 1 } });
    expect(await f.ack("tab-0", "follow", "target_ready")).toMatchObject({ phase: "waiting" });
    expect(await f.ack("tab-new", "follow", "target_ready")).toMatchObject({ phase: "sealed" });
    const late = await f.actor.mutation(api.spectraOperations.setUiObserverInterest, { ...join, clientId: "tab-late" });
    expect(late.observation).toMatchObject({ phase: "sealed", action: { epoch: 1 } });
    const current = uiObservationSnapshotSchema.parse(late.observation);
    expect(current.participants?.map(entry => entry.clientId)).toEqual(["tab-0", "tab-new"]);
  });

  it("expires a clamped/crashed Follow once, removes its interest, and journals ending before later outcomes", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const offered = await f.prepare();
    vi.setSystemTime(offered.action!.expiresAt + 1);
    const expired = await f.actor.mutation(api.spectraOperations.expireUiAction, { ...f.ids, epoch: 1 });
    expect(expired).toMatchObject({ phase: "headless", action: { epoch: 2 } });
    const state = await f.t.run(async (ctx) => ({ run: await ctx.db.get(f.ids.runId), events: await ctx.db.query("spectraRunEvents").withIndex("by_run_sequence", q => q.eq("runId", f.ids.runId)).collect() }));
    expect(state.run?.uiObserverInterests?.clients).toEqual([]);
    expect(state.events.map(event => event.payload.key)).toEqual(["settings_toggle_prepared", "settings_observer_ended"]);
    expect(await f.prepare()).toMatchObject({ phase: "headless", action: { epoch: 2 } });
    await expect(f.ack("tab-0", "follow", "target_ready")).rejects.toThrow("UI_OBSERVATION_STALE");
  });

  it("cannot revive a stopped or superseded operation", async () => {
    const f = await fixture();
    await f.prepare();
    await f.t.run(ctx => ctx.db.patch(f.ids.runId, { status: "cancelled" }));
    await expect(f.ack("tab-0", "follow", "target_ready")).rejects.toThrow("UI_OBSERVATION_INACTIVE");
    await f.t.run(ctx => ctx.db.patch(f.ids.runId, { status: "running", executionId: "new-attempt" }));
    await expect(f.prepare()).rejects.toThrow("UI_OBSERVATION_STALE");
  });

  it("checks the canonical receipt before timeout or late acknowledgement and does not replay an offer", async () => {
    const f = await fixture();
    await f.prepare();
    await f.t.run(async ctx => {
      const operation = (await ctx.db.get(f.ids.operationId))!;
      await ctx.db.patch(operation._id, { status: "executed", output: { applicationWriteReceipt: { scope: applicationOperationScope(operation), result: { saved: true } } } });
    });
    expect(await f.prepare()).toEqual({ phase: "committed", result: { saved: true } });
    expect(await f.ack("tab-0", "follow", "target_ready", 999)).toEqual({ phase: "committed", result: { saved: true } });
    const events = await f.t.run(ctx => ctx.db.query("spectraRunEvents").collect());
    expect(events).toHaveLength(1);
  });
});
