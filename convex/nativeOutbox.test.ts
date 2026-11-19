/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { enqueueNativeOutbox, OUTBOX_IDLE_MS } from "./nativeOutbox";

const modules = import.meta.glob("./**/*.ts");
const make = () => convexTest(schema, modules);
type T = ReturnType<typeof make>;

async function seed(t: T, local: { state?: "current" | "ahead" | "pending" | "diverged"; nativeFormat?: string; protectedOriginal?: boolean } = {}) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Outbox", slug: `outbox-${crypto.randomUUID()}`, verifiedDomains: [],
      status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: "clerk_outbox", email: "outbox@example.test", emailVerified: true,
      name: "Outbox", status: "active", createdAt: now, updatedAt: now });
    const workId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "resource",
      resourceClass: "resource", nativeFormat: local.nativeFormat ?? "docx", title: "Essay", content: { blocks: [] },
      contentHash: "a", tags: [], status: "active", createdAt: now, updatedAt: now });
    const replicaId = await ctx.db.insert("workReplicas", { accountId, workId, kind: "local", nativeFormat: local.nativeFormat ?? "docx",
      revision: "r1", contentHash: "r1", state: local.state ?? "current", protectedOriginal: local.protectedOriginal, updatedAt: now });
    return { accountId, workId, replicaId };
  });
}

/** Moves the clock without running what is scheduled: each test drives claim and finish itself. */
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
const row = (t: T, workId: Id<"spectraArtifacts">) =>
  t.run((ctx) => ctx.db.query("nativeOutbox").withIndex("by_work", (q) => q.eq("workId", workId)).unique());
const enqueue = (t: T, workId: Id<"spectraArtifacts">, action: "materialize" | "reconcile") =>
  t.run((ctx) => enqueueNativeOutbox(ctx, workId, action));

describe("the native outbox brings Word and Spectra together with no studio open", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("waits for the work to go quiet, then sends one materialize for many edits", async () => {
    const t = make();
    const { workId } = await seed(t);
    await enqueue(t, workId, "materialize");
    later(2_000);
    await enqueue(t, workId, "materialize");
    later(4_000);
    await enqueue(t, workId, "materialize");
    const waiting = await row(t, workId);
    expect(waiting).toMatchObject({ materialize: true, reconcile: false, state: "waiting", generation: 2 });
    expect(await t.mutation(internal.nativeOutbox.claim, { workId })).toMatchObject({ state: "early" });
    later(OUTBOX_IDLE_MS);
    expect(await t.mutation(internal.nativeOutbox.claim, { workId })).toMatchObject({ state: "sending", action: "materialize" });
    expect(await t.mutation(internal.nativeOutbox.finish, { workId, action: "materialize", generation: 2, ok: true, state: "applied" }))
      .toMatchObject({ state: "done" });
    expect(await row(t, workId)).toBeNull();
  });

  it("works without a local Office file cost one read and leave nothing behind", async () => {
    const t = make();
    const { workId } = await seed(t, { nativeFormat: "spectra-pkg" });
    await enqueue(t, workId, "materialize");
    expect(await row(t, workId)).toBeNull();
    const isProtected = await seed(t, { protectedOriginal: true });
    await enqueue(t, isProtected.workId, "materialize");
    expect(await row(t, isProtected.workId)).toBeNull();
  });

  it("takes in a Word save before sending Spectra's own edits", async () => {
    const t = make();
    const { workId, replicaId } = await seed(t, { state: "ahead" });
    await enqueue(t, workId, "materialize");
    later(OUTBOX_IDLE_MS + 1);
    expect(await t.mutation(internal.nativeOutbox.claim, { workId })).toMatchObject({ action: "reconcile" });
    // The reconcile lands, Word and Spectra agree on the file, and Spectra's edit goes next.
    await t.run((ctx) => ctx.db.patch(replicaId, { state: "current" }));
    expect(await t.mutation(internal.nativeOutbox.finish, { workId, action: "reconcile", generation: 1, ok: true, state: "applied" }))
      .toMatchObject({ state: "continuing" });
    expect(await row(t, workId)).toMatchObject({ reconcile: false, materialize: true, state: "waiting" });
    later(OUTBOX_IDLE_MS + 1);
    expect(await t.mutation(internal.nativeOutbox.claim, { workId })).toMatchObject({ action: "materialize" });
  });

  it("an edit that lands mid-send runs again instead of being lost", async () => {
    const t = make();
    const { workId } = await seed(t);
    await enqueue(t, workId, "materialize");
    later(OUTBOX_IDLE_MS + 1);
    await t.mutation(internal.nativeOutbox.claim, { workId });
    await enqueue(t, workId, "materialize");
    expect(await t.mutation(internal.nativeOutbox.finish, { workId, action: "materialize", generation: 1, ok: true }))
      .toMatchObject({ state: "continuing" });
    expect(await row(t, workId)).toMatchObject({ materialize: true, state: "waiting", generation: 2 });
  });

  it("an open studio that already wrote the file settles the row", async () => {
    const t = make();
    const { workId, accountId, replicaId } = await seed(t);
    await enqueue(t, workId, "materialize");
    later(1_000);
    await t.run((ctx) => ctx.db.insert("syncOperations", { accountId, workId, replicaId, idempotencyKey: "studio",
      direction: "cloud-to-local", state: "pending", actorKind: "user", createdAt: Date.now(), updatedAt: Date.now() }));
    later(OUTBOX_IDLE_MS);
    expect(await t.mutation(internal.nativeOutbox.claim, { workId })).toMatchObject({ state: "settled" });
    expect(await row(t, workId)).toBeNull();
  });

  it("a Bridge write in flight waits; failures back off, then give up; refusals stop at once", async () => {
    const t = make();
    const { workId, replicaId } = await seed(t, { state: "pending" });
    await enqueue(t, workId, "materialize");
    later(OUTBOX_IDLE_MS + 1);
    expect(await t.mutation(internal.nativeOutbox.claim, { workId })).toMatchObject({ state: "pending" });
    await t.run((ctx) => ctx.db.patch(replicaId, { state: "current" }));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      later(7 * 60 * 60_000);
      expect(await t.mutation(internal.nativeOutbox.claim, { workId })).toMatchObject({ state: "sending" });
      const generation = (await row(t, workId))!.generation;
      expect(await t.mutation(internal.nativeOutbox.finish, { workId, action: "materialize", generation, ok: false, error: "HTTP_502" }))
        .toMatchObject({ state: "retrying" });
    }
    later(7 * 60 * 60_000);
    await t.mutation(internal.nativeOutbox.claim, { workId });
    const generation = (await row(t, workId))!.generation;
    expect(await t.mutation(internal.nativeOutbox.finish, { workId, action: "materialize", generation, ok: false, error: "HTTP_502" }))
      .toMatchObject({ state: "given-up" });

    const refused = await seed(t);
    await enqueue(t, refused.workId, "materialize");
    later(OUTBOX_IDLE_MS + 1);
    await t.mutation(internal.nativeOutbox.claim, { workId: refused.workId });
    expect(await t.mutation(internal.nativeOutbox.finish, { workId: refused.workId, action: "materialize", generation: 1, ok: false,
      error: "DOCX_LENS_FAILED: NATIVE_WRITES_DISABLED" })).toMatchObject({ state: "given-up" });
  });

  it("a send that never answered is picked up by the sweep", async () => {
    const t = make();
    const { workId } = await seed(t);
    await enqueue(t, workId, "materialize");
    later(OUTBOX_IDLE_MS + 1);
    await t.mutation(internal.nativeOutbox.claim, { workId });
    expect(await t.mutation(internal.nativeOutbox.sweep, {})).toEqual({ woken: 0 });
    later(11 * 60_000);
    expect(await t.mutation(internal.nativeOutbox.sweep, {})).toEqual({ woken: 1 });
    expect(await t.mutation(internal.nativeOutbox.claim, { workId })).toMatchObject({ state: "sending" });
  });
});
