/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { bridgeKey, calendarFixture } from "../scripts/test-fixtures/managebac-calendar";
import { CHANGE_GROUP_SNAPSHOT_KEEP_MS, CLAIM_HISTORY_MS, RECEIPT_KEEP_MS } from "./collaborationRetention";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", bridgeKey));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("lets go of old claims, receipts and change-group snapshots, and keeps recent ones", async () => {
  const f = await calendarFixture(modules);
  const now = Date.now();
  const ids = await f.t.run(async (ctx) => {
    const { schoolId, accountId } = f.seed;
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: accountId, schoolId, blueprintKey: "document", title: "Essay", content: {}, tags: [],
      status: "active", createdAt: now, updatedAt: now,
    } as never);
    const roomId = await ctx.db.insert("collaborationRooms", {
      artifactId, schoolId, typeKey: "document", provider: "self_hosted_yjs", partitionKey: "main", schemaVersion: 1,
      policyVersion: 1, status: "active", nextSequence: 1, snapshotSequence: 0, uncompactedBytes: 0, createdAt: now, updatedAt: now,
    });
    const claim = (status: "released" | "active", leaseExpiresAt: number) => ctx.db.insert("regionClaims", {
      artifactId, schoolId, actorKind: "human", actorAccountId: accountId, clientId: "client", regionId: "body",
      overlapDomains: [], baseStateVectorHash: "base", status, leaseExpiresAt, createdAt: leaseExpiresAt, updatedAt: leaseExpiresAt,
    });
    const receipt = (createdAt: number, key: string) => ctx.db.insert("collaborationReceipts", {
      roomId, idempotencyKey: key, sequence: 1, actorAccountId: accountId, clientId: "client", stateVectorHash: "sv",
      digest: "d", byteLength: 1, createdAt,
    });
    const group = (committedAt: number) => ctx.db.insert("changeGroups", {
      artifactId, schoolId, source: "ai", actorAccountId: accountId, operationIds: [], regionIds: [], baseStateVectorHash: "base",
      baseSnapshot: { content: "before" }, finalSnapshot: { content: "after" }, status: "committed",
      openedAt: committedAt, lastActivityAt: committedAt, committedAt,
    });
    return {
      oldClaim: await claim("released", now - CLAIM_HISTORY_MS - 1),
      recentClaim: await claim("released", now - 1_000),
      liveClaim: await claim("active", now - CLAIM_HISTORY_MS - 1),
      oldReceipt: await receipt(now - RECEIPT_KEEP_MS - 1, "old"),
      recentReceipt: await receipt(now - 1_000, "recent"),
      oldGroup: await group(now - CHANGE_GROUP_SNAPSHOT_KEEP_MS - 1),
      recentGroup: await group(now - 1_000),
    };
  });

  expect(await f.t.mutation(internal.collaborationRetention.sweep, {}))
    .toEqual({ claims: 1, receipts: 1, changeGroups: 1, more: false });

  await f.t.run(async (ctx) => {
    expect(await ctx.db.get(ids.oldClaim)).toBeNull();
    expect(await ctx.db.get(ids.recentClaim)).not.toBeNull();
    // An unreleased claim is the claims module's to expire, never this sweep's.
    expect(await ctx.db.get(ids.liveClaim)).not.toBeNull();
    expect(await ctx.db.get(ids.oldReceipt)).toBeNull();
    expect(await ctx.db.get(ids.recentReceipt)).not.toBeNull();
    const oldGroup = await ctx.db.get(ids.oldGroup);
    expect(oldGroup?.status).toBe("committed");
    expect(oldGroup?.baseSnapshot).toBeUndefined();
    expect(oldGroup?.finalSnapshot).toBeUndefined();
    expect((await ctx.db.get(ids.recentGroup))?.baseSnapshot).toEqual({ content: "before" });
  });

  // The next day's sweep starts where this one stopped.
  expect(await f.t.mutation(internal.collaborationRetention.sweep, {}))
    .toEqual({ claims: 0, receipts: 0, changeGroups: 0, more: false });
});

it("trims every snapshot across batches sharing a commit time, including a later backdated row", async () => {
  vi.useFakeTimers();
  const f = await calendarFixture(modules);
  const committedAt = Date.now() - CHANGE_GROUP_SNAPSHOT_KEEP_MS - 1;
  const ids = await f.t.run(async (ctx) => {
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: f.seed.accountId, schoolId: f.seed.schoolId, blueprintKey: "document", title: "Essay", content: {}, tags: [],
      status: "active", createdAt: committedAt, updatedAt: committedAt,
    } as never);
    const groups = [];
    for (let index = 0; index < 26; index += 1) {
      groups.push(await ctx.db.insert("changeGroups", {
        artifactId, schoolId: f.seed.schoolId, source: "ai", actorAccountId: f.seed.accountId,
        operationIds: [], regionIds: [], baseStateVectorHash: "base",
        baseSnapshot: { content: "before" }, finalSnapshot: { content: "after" },
        status: index % 2 ? "committed" : "abandoned", openedAt: committedAt, lastActivityAt: committedAt, committedAt,
      }));
    }
    return groups;
  });
  expect(await f.t.mutation(internal.collaborationRetention.sweep, {})).toMatchObject({ changeGroups: 20, more: true });
  expect(await f.t.mutation(internal.collaborationRetention.sweep, {})).toMatchObject({ changeGroups: 6, more: false });
  await f.t.run(async (ctx) => {
    for (const id of ids) expect(await ctx.db.get(id)).toMatchObject({ snapshotsTrimmed: true });
    const { _id, _creationTime, snapshotsTrimmed: _trimmed, ...old } = (await ctx.db.get(ids[0]))!;
    await ctx.db.insert("changeGroups", { ...old, baseSnapshot: { content: "backdated" } });
  });
  expect(await f.t.mutation(internal.collaborationRetention.sweep, {})).toMatchObject({ changeGroups: 1, more: false });
  expect(await f.t.mutation(internal.collaborationRetention.sweep, {})).toMatchObject({ changeGroups: 0, more: false });
});
