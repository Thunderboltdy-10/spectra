/// <reference types="vite/client" />
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { forWork, payloadForWork, presentationsForAccount, resolveExternalConflict, sweepReplicaTruth } from "./replicas";
import { completeWrite, commitPayloadUpload } from "./bridgeSync";
import { observeDatabase } from "../scripts/perf-read-ledger";
import {
  encodeArtifactContentForStorage,
  sheetCellEntries,
} from "../shared/sheet-cells";
import { BRIDGE_CLAIM_REDRIVE_MS, BRIDGE_WRITE_EXPIRES_MS } from "../shared/replica-truth";
import { POLICY_PRESETS } from "../shared/sync-policy";
import { shouldActivateExternalNativeRevision } from "../src/features/spectra/lenses/native-reconciliation";
import type { QueueMaterializationArgs, CloudMaterializationArgs, queueMaterializationInTransaction,
  commitCloudMaterializationInTransaction } from "./replicaMaterialization";

const nativeBridgeKey = "native-materialization-test-key-0000000001";
beforeEach(() => vi.stubEnv("SPECTRA_COLLAB_BRIDGE_KEY", nativeBridgeKey));
afterEach(() => vi.unstubAllEnvs());
type NativeTestClient = Pick<ReturnType<typeof convexTest>, "query" | "action">;
async function signedNative(client: NativeTestClient, candidate:
  { destination: "bridge"; queue: QueueMaterializationArgs } | { destination: "cloud"; cloud: CloudMaterializationArgs }) {
  const workId = candidate.destination === "bridge" ? candidate.queue.workId : candidate.cloud.workId;
  const { accountId } = await client.query(api.nativeMaterialization.head, { workId });
  const operation = "materializeNative" as const;
  const payloadJson = JSON.stringify({ artifactId: workId, accountId, partitionKey: "root", candidate });
  const timestamp = Date.now(), nonce = "native-materialization-fixture-nonce";
  const digest = createHash("sha256").update(payloadJson).digest("base64url");
  const signature = createHmac("sha256", nativeBridgeKey).update([operation,timestamp,nonce,digest].join("|")).digest("base64url");
  return client.action(api.collaborationGatewayBridge.exchange, { operation, payloadJson, timestamp, nonce, signature });
}
const queueNative = (client: NativeTestClient, queue: QueueMaterializationArgs) =>
  signedNative(client, { destination: "bridge", queue }) as Promise<Awaited<ReturnType<typeof queueMaterializationInTransaction>>>;
const cloudNative = (client: NativeTestClient, cloud: CloudMaterializationArgs) =>
  signedNative(client, { destination: "cloud", cloud }) as Promise<Awaited<ReturnType<typeof commitCloudMaterializationInTransaction>>>;

const modules = import.meta.glob("./**/*.ts");
// School-scoped work maintains org-node aggregates, as it does in production.
function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}
const identity = {
  subject: "clerk_replica_truth",
  email: "replica-truth@example.test",
  emailVerified: true,
};
const payloadHash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const baseHash = payloadHash("base");
const nextHash = payloadHash("next");
const bridgeCredential = "bridge-test-credential-000000000001";

describe("account-private conflict writes", () => {
  async function foreignConflicts(t: ReturnType<typeof convexTest>, fixture: Awaited<ReturnType<typeof seedWork>>, count = 1) {
    return t.run(async ctx => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", { clerkId: "conflict-peer", email: "conflict-peer@example.test",
        emailVerified: true, name: "Conflict peer", status: "active", createdAt: now, updatedAt: now });
      const replicaId = await ctx.db.insert("workReplicas", { accountId, workId: fixture.workId, kind: "local",
        nativeFormat: "docx", revision: baseHash, contentHash: baseHash, state: "current", updatedAt: now });
      const ids = [];
      for (let i = 0; i < count; i++) ids.push(await ctx.db.insert("syncConflicts", {
        accountId, workId: fixture.workId, replicaIds: [replicaId, fixture.cloudId], regionIds: ["private"], partNames: [],
        localRevision: nextHash, spectraRevision: baseHash, state: "open", createdAt: now,
        previews: [{ regionId: "private", spectra: "Shared", external: "Private peer words" }],
      }));
      return Promise.all(ids.map(id => ctx.db.get(id)));
    });
  }

  it.each(["preview", "portable"] as const)("records its own %s conflict without reusing another account's matching revisions", async kind => {
    const t = setupTest(), fixture = await seedWork(t), user = t.withIdentity(identity);
    const foreign = await foreignConflicts(t, fixture);
    const previews = [{ regionId: "body", spectra: "Shared words", external: "My desktop words" }];
    if (kind === "preview") await t.run(async ctx => {
      await ctx.db.patch(fixture.localId, { payloadRef: String(fixture.nextPayloadId), revision: nextHash, contentHash: nextHash, state: "ahead" });
      await ctx.db.insert("syncOperations", { accountId: fixture.accountId, workId: fixture.workId, replicaId: fixture.localId,
        idempotencyKey: "own-external-preview", direction: "external", state: "applied", actorKind: "external-edit",
        revisionBefore: baseHash, revisionAfter: nextHash, createdAt: Date.now(), updatedAt: Date.now() });
    });
    const record = () => kind === "preview"
      ? user.mutation(api.replicas.recordExternalReconciliation, {
        workId: fixture.workId, localReplicaId: fixture.localId, localPayloadRef: String(fixture.nextPayloadId), localRevision: nextHash,
        content: { blocks: [] }, fidelityMap: {}, regionIds: ["body"], partNames: ["word/document.xml"], conflictRegionIds: ["body"], previews,
      })
      : user.mutation(api.replicas.attachPortablePayload, {
        workId: fixture.workId, payloadRef: String(fixture.nextPayloadId), contentHash: nextHash, nativeFormat: "docx",
      });
    await record();
    const rows = await t.run(ctx => ctx.db.query("syncConflicts").collect());
    expect.soft(rows.filter(row => row.accountId !== fixture.accountId)).toEqual(foreign);
    const own = rows.filter(row => row.accountId === fixture.accountId);
    expect.soft(own).toHaveLength(1);
    if (kind === "preview") expect.soft(own[0]?.previews).toEqual(previews);
    await record();
    expect((await t.run(ctx => ctx.db.query("syncConflicts").collect())).map(row => row._id)).toEqual(rows.map(row => row._id));
    expect((await t.run(ctx => ctx.db.get(fixture.localId)))?.state).toBe(kind === "preview" ? "diverged" : "current");
  });

  it.each(["local", "spectra"] as const)("keeps %s resolution within this account under foreign conflict density", async resolution => {
    const t = setupTest(), fixture = await seedWork(t), user = t.withIdentity(identity);
    const foreign = await foreignConflicts(t, fixture, 100);
    const ownId = await t.run(ctx => ctx.db.insert("syncConflicts", {
      accountId: fixture.accountId, workId: fixture.workId, replicaIds: [fixture.localId, fixture.cloudId],
      regionIds: ["body"], partNames: [], localRevision: nextHash, spectraRevision: baseHash, state: "open", createdAt: Date.now(),
    }));
    const handler = Reflect.get(resolveExternalConflict, "_handler") as (ctx: MutationCtx, input: { workId: typeof fixture.workId; resolution: typeof resolution }) => Promise<unknown>;
    const measure = () => user.run(async ctx => {
      const observed = observeDatabase(ctx.db);
      return { result: await handler({ ...ctx, db: observed.db }, { workId: fixture.workId, resolution }), ...observed.snapshot() };
    });
    const actual = await measure();
    expect.soft(actual.result).toEqual({ resolved: 1, workId: null });
    expect.soft(await t.run(ctx => Promise.all(foreign.map(row => ctx.db.get(row!._id))))).toEqual(foreign);
    expect.soft(await t.run(ctx => ctx.db.get(ownId))).toMatchObject({ state: `resolved-${resolution}` });
    const rangeReads = actual.reads.filter(read => read.table === "syncConflicts" && read.index !== null);
    expect(rangeReads).toHaveLength(1);
    expect(rangeReads[0]).toMatchObject({ documentsReturned: 1, postIndexFilter: false });
    await t.run(async ctx => {
      await ctx.db.patch(ownId, { state: "open", resolvedAt: undefined, updatedAt: undefined });
      for (const row of foreign.slice(1)) await ctx.db.delete(row!._id);
    });
    const sparse = await measure();
    expect(sparse.result).toEqual(actual.result);
    expect(sparse.calls).toBe(actual.calls);
    expect(sparse.writes).toBe(actual.writes);
    // The trigger also reads the row it patches; include that real cost.
    const rows = (sample: typeof actual) => sample.reads.filter(read => read.table === "syncConflicts")
      .reduce((count, read) => count + read.documentsReturned, 0);
    expect(rows(actual)).toBe(2);
    expect(rows(sparse)).toBe(rows(actual));
  });

  it("allows protected-original apply past a foreign conflict while retaining its own conflict guard", async () => {
    const t = setupTest(), fixture = await seedWork(t), user = t.withIdentity(identity);
    const foreign = await foreignConflicts(t, fixture);
    const ownId = await t.run(async ctx => {
      await ctx.db.patch(fixture.workId, { protectedBaseContent: { blocks: [] }, protectedBaseContentHash: baseHash });
      await ctx.db.patch(fixture.localId, { pendingPayloadRef: String(fixture.nextPayloadId), pendingContentHash: nextHash, pendingBaseRevision: baseHash });
      return ctx.db.insert("syncConflicts", { accountId: fixture.accountId, workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId], regionIds: ["body"], partNames: [], localRevision: nextHash,
        spectraRevision: baseHash, state: "open", createdAt: Date.now() });
    });
    await expect(user.mutation(api.replicas.applyProtectedPending, { workId: fixture.workId })).rejects.toThrow("PROTECTED_ORIGINAL_CONFLICT");
    expect(await t.run(ctx => ctx.db.query("bridgeWriteRequests").collect())).toEqual([]);
    await t.run(ctx => ctx.db.delete(ownId));
    await expect(user.mutation(api.replicas.applyProtectedPending, { workId: fixture.workId })).resolves.toMatchObject({ state: "pending" });
    expect(await t.run(ctx => Promise.all(foreign.map(row => ctx.db.get(row!._id))))).toEqual(foreign);
    const [write] = await t.run(ctx => ctx.db.query("bridgeWriteRequests").collect());
    expect(write).toMatchObject({ accountId: fixture.accountId, replicaId: fixture.localId, deviceId: fixture.deviceId });
  });
});

describe("reactive artifact metadata availability", () => {
  it.each(["artifact metadata", "Library summary", "cloud payload", "local payload"] as const)("keeps %s available independently of other accounts' replica density", async (kind) => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const user = t.withIdentity(identity);
    const foreignIds = await t.run(async ctx => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", {
        clerkId: "replica-dense-local-peer", email: "dense-local-peer@example.test", emailVerified: true,
        name: "Other desktop owner", status: "active", createdAt: now, updatedAt: now,
      });
      const ids = [];
      for (let i = 0; i < 100; i++) ids.push(await ctx.db.insert("workReplicas", {
        accountId, workId: fixture.workId, kind: "local", nativeFormat: "docx", revision: baseHash,
        state: "pending", projectionBaseContent: { body: "private".repeat(1500) }, updatedAt: now,
      }));
      // Reinsert the valid pair after the foreign rows, keeping the same real
      // device, mount and stored payload. Cloud truth remains shared.
      for (const id of [fixture.cloudId, fixture.localId]) {
        const original = await ctx.db.get(id);
        assert(original);
        const { _id, _creationTime, ...row } = original;
        expect(_creationTime).toBeGreaterThan(0);
        await ctx.db.insert("workReplicas", row.kind === "cloud" ? { ...row, accountId } : { ...row, state: "pending" });
        await ctx.db.delete(_id);
      }
      return ids;
    });
    const endpoint = kind === "artifact metadata" ? forWork : kind === "Library summary" ? presentationsForAccount : payloadForWork;
    const args = kind === "Library summary" ? {} : { workId: fixture.workId,
      ...(kind.endsWith("payload") ? { prefer: kind === "local payload" ? "local-latest" : "cloud" } : {}) };
    const handler = Reflect.get(endpoint, "_handler") as (ctx: QueryCtx, input: typeof args) => Promise<unknown>;
    const measure = () => user.run(async ctx => {
      const observed = observeDatabase(ctx.db);
      return { result: await handler({ ...ctx, db: observed.db }, args), ...observed.snapshot() };
    });
    const dense = await measure();
    await t.run(async ctx => { for (const id of foreignIds.slice(1)) await ctx.db.delete(id); });
    const sparse = await measure();
    if (kind === "artifact metadata") expect(sparse.result).toMatchObject({ replicas: [
      expect.objectContaining({ kind: "cloud", state: "current" }), expect.objectContaining({ kind: "local", state: "pending" }),
    ] });
    else if (kind === "Library summary") expect(sparse.result).toMatchObject([{ pendingCount: 1, replicas: [
      expect.objectContaining({ kind: "cloud", state: "current" }), expect.objectContaining({ kind: "local", state: "pending" }),
    ] }]);
    else expect(sparse.result).toMatchObject({ replicaKind: kind === "local payload" ? "local" : "cloud", hash: baseHash });
    expect.soft(dense.result).toEqual(sparse.result);
    expect.soft(dense.calls).toBe(sparse.calls);
    expect(dense.writes + sparse.writes).toBe(0);
    const rows = (sample: typeof dense) => sample.reads.filter(r => r.table === "workReplicas");
    expect(rows(dense).every(r => !r.postIndexFilter)).toBe(true);
    expect(rows(sparse).reduce((n, r) => n + r.documentsReturned, 0)).toBe(kind === "Library summary" ? 3 : 2);
    expect.soft(rows(dense).reduce((n, r) => n + r.documentsReturned, 0)).toBe(rows(sparse).reduce((n, r) => n + r.documentsReturned, 0));
    expect.soft(rows(dense).reduce((n, r) => n + r.serializedDocumentBytes, 0)).toBe(rows(sparse).reduce((n, r) => n + r.serializedDocumentBytes, 0));
  });

  it.each([true, false])("retains the 20-row replica ceiling with cloud present=%s", async (withCloud) => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async ctx => {
      if (!withCloud) await ctx.db.delete(fixture.cloudId);
      for (let i = 0; i < 25; i++) await ctx.db.insert("workReplicas", {
        accountId: fixture.accountId, workId: fixture.workId, kind: "local", nativeFormat: "docx",
        revision: baseHash, state: "current", updatedAt: Date.now(),
      });
    });
    const args = { workId: fixture.workId };
    const handler = Reflect.get(forWork, "_handler") as (ctx: QueryCtx, input: typeof args) => Promise<{ replicas: Array<{ kind: string; _creationTime: number }> }>;
    const sample = await t.withIdentity(identity).run(async ctx => {
      const observed = observeDatabase(ctx.db);
      return { result: await handler({ ...ctx, db: observed.db }, args), ...observed.snapshot() };
    });
    expect(sample.result.replicas).toHaveLength(20);
    expect(sample.result.replicas.filter(r => r.kind === "cloud")).toHaveLength(withCloud ? 1 : 0);
    const times = sample.result.replicas.map(r => r._creationTime);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(sample.reads.filter(r => r.table === "workReplicas").reduce((n, r) => n + r.documentsReturned, 0)).toBe(20);
    expect(sample.writes).toBe(0);
  });

  it.each(["conflict", "operation"] as const)("bounds own %s reads independently of other accounts' history", async (kind) => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const user = t.withIdentity(identity);
    const foreignIds = await t.run(async ctx => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, { state: "ahead", revision: nextHash });
      const accountId = await ctx.db.insert("accounts", {
        clerkId: "replica-dense-peer", email: "dense-peer@example.test", emailVerified: true,
        name: "Dense peer", status: "active", createdAt: now, updatedAt: now,
      });
      const rows = [];
      for (let i = 0; i < 100; i++) rows.push(kind === "conflict"
        ? await ctx.db.insert("syncConflicts", { accountId, workId: fixture.workId, replicaIds: [],
          regionIds: ["body"], partNames: [], localRevision: nextHash, spectraRevision: baseHash, state: "open", createdAt: now })
        : await ctx.db.insert("syncOperations", { accountId, workId: fixture.workId, idempotencyKey: `foreign-${i}`,
          direction: "cloud-to-local", state: "pending", actorKind: "user", createdAt: now, updatedAt: now }));
      if (kind === "conflict") await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId, workId: fixture.workId, replicaIds: [fixture.localId], regionIds: ["body"], partNames: [],
        localRevision: nextHash, spectraRevision: baseHash, state: "open", createdAt: now,
      });
      else await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId, workId: fixture.workId, replicaId: fixture.localId, idempotencyKey: "own-pending",
        direction: "cloud-to-local", state: "pending", actorKind: "user", createdAt: now - 1000, updatedAt: now,
      });
      return rows;
    });
    const args = { workId: fixture.workId };
    const handler = Reflect.get(forWork, "_handler") as (ctx: QueryCtx, input: typeof args) => Promise<unknown>;
    const measure = () => user.run(async ctx => {
      const observed = observeDatabase(ctx.db);
      return { result: await handler({ ...ctx, db: observed.db }, args), ...observed.snapshot() };
    });
    const dense = await measure();
    await t.run(async ctx => { for (const id of foreignIds.slice(1)) await ctx.db.delete(id); });
    const sparse = await measure();
    expect(sparse.result).toMatchObject(kind === "conflict" ? { openConflictCount: 1 } : { pendingCount: 1 });
    expect(dense.calls).toBe(sparse.calls);
    expect(dense.writes + sparse.writes).toBe(0);
    expect.soft(dense.result).toEqual(sparse.result);
    const table = kind === "conflict" ? "syncConflicts" : "syncOperations";
    const rows = (sample: typeof dense) => sample.reads.filter(r => r.table === table).reduce((n, r) => n + r.documentsReturned, 0);
    expect(rows(sparse)).toBe(1);
    expect(rows(dense)).toBe(rows(sparse));
  });

  it.each(["conflict", "operation"] as const)("keeps another account's %s out of open-work sync metadata", async (kind) => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const user = t.withIdentity(identity);
    await t.run(ctx => ctx.db.patch(fixture.localId, { state: "ahead", revision: nextHash, contentHash: nextHash }));
    const args = { workId: fixture.workId };
    const expected = await user.query(api.replicas.forWork, args);
    const handler = Reflect.get(forWork, "_handler") as (ctx: QueryCtx, input: typeof args) => Promise<typeof expected>;
    const measure = () => user.run(async ctx => {
      const observed = observeDatabase(ctx.db);
      return { result: await handler({ ...ctx, db: observed.db }, args), ...observed.snapshot() };
    });
    const before = await measure();
    const id = await t.run(async ctx => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", {
        clerkId: "replica-private-sync", email: "private-sync@example.test", emailVerified: true,
        name: "Other computer", status: "active", createdAt: now, updatedAt: now,
      });
      const replicaId = await ctx.db.insert("workReplicas", {
        accountId, workId: fixture.workId, kind: "local", nativeFormat: "docx", revision: nextHash,
        state: "pending", updatedAt: now,
      });
      return kind === "conflict"
        ? ctx.db.insert("syncConflicts", {
          accountId, workId: fixture.workId, replicaIds: [replicaId], regionIds: ["body"], partNames: ["word/document.xml"],
          previews: [{ regionId: "body", spectra: "Shared words", external: "Private unshared desktop words" }],
          localRevision: nextHash, spectraRevision: baseHash, localPayloadRef: "private-local-payload", state: "open", createdAt: now,
        })
        : ctx.db.insert("syncOperations", {
          accountId, workId: fixture.workId, replicaId, idempotencyKey: "private-computer-write",
          direction: "cloud-to-local", state: "pending", actorKind: "user", createdAt: now, updatedAt: now,
        });
    });
    const after = await measure();
    expect(after.calls).toBe(before.calls);
    expect(after.writes).toBe(0);
    assert(after.result);
    expect(shouldActivateExternalNativeRevision({ operations: after.result.recentOperations,
      localHash: nextHash, cloudHash: baseHash, localState: "ahead" })).toBe(true);
    expect(after.result).toEqual(expected);
    await t.run(async ctx => {
      if (kind === "conflict") await ctx.db.patch(id as Id<"syncConflicts">, { accountId: fixture.accountId, replicaIds: [fixture.localId] });
      else await ctx.db.patch(id as Id<"syncOperations">, { accountId: fixture.accountId, replicaId: fixture.localId });
    });
    const own = await user.query(api.replicas.forWork, args);
    assert(own);
    if (kind === "conflict") {
      expect(own.openConflictCount).toBe(1);
      expect(own.conflicts[0]?.previews?.[0].external).toBe("Private unshared desktop words");
    } else {
      expect(own.pendingCount).toBe(1);
      expect(own.recentOperations[0]?._id).toBe(id);
      expect(shouldActivateExternalNativeRevision({ operations: own.recentOperations,
        localHash: nextHash, cloudHash: baseHash, localState: "ahead" })).toBe(false);
    }
  });

  it.each(["pending", "error"] as const)("keeps another account's %s computer state out of Library summaries", async (state) => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const user = t.withIdentity(identity);
    await t.run(ctx => ctx.db.patch(fixture.localId, { state: "unavailable", unavailableReason: "unlinked-by-user" }));
    const handler = Reflect.get(presentationsForAccount, "_handler") as (ctx: QueryCtx, args: object) => Promise<unknown>;
    const measure = () => user.run(async ctx => {
      const observed = observeDatabase(ctx.db);
      return { result: await handler({ ...ctx, db: observed.db }, {}), ...observed.snapshot() };
    });
    const before = await measure();
    const foreignAccountId = await t.run(async ctx => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", {
        clerkId: "replica-other-computer", email: "other-computer@example.test", emailVerified: true,
        name: "Other computer owner", status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("workReplicas", {
        accountId, workId: fixture.workId, kind: "local", nativeFormat: "docx", revision: baseHash,
        state, errorCode: state === "error" ? "office-locked" : undefined, updatedAt: now,
      });
      return accountId;
    });
    const rowsBefore = await t.run(ctx => ctx.db.query("workReplicas").collect());
    const after = await measure();
    expect(after.calls).toBe(before.calls);
    expect(after.writes).toBe(0);
    expect(await t.run(ctx => ctx.db.query("workReplicas").collect())).toEqual(rowsBefore);
    expect(after.result).toEqual(before.result);
    await t.run(async ctx => {
      await ctx.db.patch(fixture.localId, { state, errorCode: state === "error" ? "office-locked" : undefined });
      await ctx.db.patch(fixture.cloudId, { accountId: foreignAccountId });
    });
    const [own] = await user.query(api.replicas.presentationsForAccount, {});
    expect(own.replicas).toHaveLength(2);
    expect(own.replicas).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "cloud", state: "current" }),
      expect.objectContaining({ kind: "local", state }),
    ]));
    expect(own.pendingCount).toBe(state === "pending" ? 1 : 0);
  });

  it("reads owner replica metadata without an unused wall-clock dependency", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const user = t.withIdentity(identity);
    const args = { workId: fixture.workId };
    const expected = await user.query(api.replicas.forWork, args);
    const handler = Reflect.get(forWork, "_handler") as (ctx: QueryCtx, input: typeof args) => Promise<typeof expected>;
    const actual = await user.run(async (ctx) => {
      const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Owner metadata does not need the wall clock"); });
      try { return await handler(ctx, args); } finally { clock.mockRestore(); }
    });
    expect(actual).toEqual(expected);
  });

  it("cannot create a new file in a file-only grant while retaining the existing replica", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(ctx => ctx.db.patch(fixture.mountId, { selectedFile: "Truth.docx", rootLabel: "Truth.docx" }));
    const user = t.withIdentity(identity);
    const args = { workId: fixture.workId, mountId: fixture.mountId, relativePath: "Truth.docx", payloadRef: String(fixture.basePayloadId), contentHash: baseHash, nativeFormat: "docx", fidelityMap: {} };
    await expect(user.mutation(api.replicas.createLocalReplica, { ...args, relativePath: "Private.docx" })).rejects.toThrow("Choose a synced folder");
    expect(await user.mutation(api.replicas.createLocalReplica, args)).toMatchObject({ state: "existing", replicaId: fixture.localId });
    expect(await t.run(ctx => ctx.db.query("bridgeWriteRequests").collect())).toEqual([]);
  });
  it("reports unavailable metadata after an open artifact is permanently deleted", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const user = t.withIdentity(identity);
    expect(await user.query(api.replicas.forWork, { workId: fixture.workId })).not.toBeNull();
    await t.run(ctx => ctx.db.patch(fixture.workId, { status: "deleted" }));
    expect(await user.query(api.replicas.forWork, { workId: fixture.workId })).toBeNull();
    expect(await user.query(api.replicas.strategyTransitionForWork, { workId: fixture.workId })).toBeNull();
  });

  it("returns no reactive metadata when the artifact record is gone", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const user = t.withIdentity(identity);
    await t.run(ctx => ctx.db.delete(fixture.workId));
    expect(await user.query(api.replicas.strategyTransitionForWork, { workId: fixture.workId })).toBeNull();
    expect(await user.query(api.replicas.forWork, { workId: fixture.workId })).toBeNull();
  });
});

describe("Bridge materialization receipt replay", () => {
  it("refuses desktop write admission after policy changes to Never", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async ctx => {
      const policies = await ctx.db.query("syncPolicies").withIndex("by_account_scope", q => q.eq("accountId", fixture.accountId)).collect();
      for (const policy of policies) await ctx.db.delete(policy._id);
    });
    await expect(queueNative(t.withIdentity(identity), {
      workId: fixture.workId, payloadRef: String(fixture.nextPayloadId), contentHash: nextHash,
      baseRevision: baseHash, fidelityMap: {}, regionIds: [], partNames: [],
    })).rejects.toThrow("NATIVE_WRITES_DISABLED");
    expect(await t.run(ctx => ctx.db.query("bridgeWriteRequests").collect())).toEqual([]);
  });
  it("refreshes only the current authorized claim before the native write", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const queued = await queueNative(t.withIdentity(identity), {
      workId: fixture.workId, payloadRef: String(fixture.nextPayloadId), contentHash: nextHash,
      baseRevision: baseHash, fidelityMap: {}, regionIds: [], partNames: [],
    });
    const requestId = requireWriteRequestId(queued.requestId);
    const first = (await t.mutation(api.bridgeSync.claimWrite, { credential: bridgeCredential })).request!;
    await t.run(ctx => ctx.db.patch(requestId, { claimedAt: Date.now() - BRIDGE_CLAIM_REDRIVE_MS - 1 }));
    const current = (await t.mutation(api.bridgeSync.claimWrite, { credential: bridgeCredential })).request!;
    const before = await t.run(ctx => ctx.db.get(requestId));
    expect(await t.mutation(api.bridgeSync.refreshWriteClaim, {
      credential: bridgeCredential, requestId, claimGeneration: first.claimGeneration, claimToken: first.claimToken,
    })).toEqual({ valid: false });
    expect(await t.run(ctx => ctx.db.get(requestId))).toEqual(before);
    const refresh = { credential: bridgeCredential, requestId, claimGeneration: current.claimGeneration, claimToken: current.claimToken };
    expect(await t.mutation(api.bridgeSync.refreshWriteClaim, refresh)).toEqual({ valid: true });
    await t.run(ctx => ctx.db.patch(fixture.mountId, { state: "detached" }));
    expect(await t.mutation(api.bridgeSync.refreshWriteClaim, refresh)).toEqual({ valid: false });
    await t.run(ctx => ctx.db.patch(fixture.mountId, { state: "active" }));
    await t.run(ctx => ctx.db.patch(fixture.workId, { status: "deleted" }));
    expect(await t.mutation(api.bridgeSync.refreshWriteClaim, refresh)).toEqual({ valid: false });
  });

  it.each(["pending", "claimed", "verified"] as const)(
    "keeps the newer canonical head and immutable request when replaying %s A",
    async (state) => {
      const t = setupTest();
      const fixture = await seedWork(t);
      const asUser = t.withIdentity(identity);
      const input = {
        workId: fixture.workId, localReplicaId: fixture.localId,
        payloadRef: String(fixture.nextPayloadId), contentHash: nextHash, baseRevision: baseHash,
        fidelityMap: { entries: [] }, regionIds: ["body"], partNames: ["word/document.xml"],
        projectionContent: { blocks: [{ id: "body", text: "older A" }] },
        projectionContentHash: nextHash, promotionMode: "immediate-projection" as const,
      };
      const a = await queueNative(asUser, input);
      if (state !== "pending") {
        const claimed = (await t.mutation(api.bridgeSync.claimWrite, { credential: bridgeCredential })).request;
        expect(claimed?.requestId).toBe(a.requestId);
        if (state === "verified") await t.mutation(api.bridgeSync.completeWrite, {
          credential: bridgeCredential, requestId: requireWriteRequestId(a.requestId),
          outcome: "verified", actualRevision: nextHash,
          claimGeneration: claimed!.claimGeneration, claimToken: claimed!.claimToken,
        });
      }
      const newer = { blocks: [{ id: "body", text: "newer B" }] };
      if (state === "verified") {
        const b = await queueNative(asUser, {
          ...input, payloadRef: String(fixture.basePayloadId), contentHash: baseHash, baseRevision: nextHash,
          projectionContent: newer, projectionContentHash: "c".repeat(64),
        });
        const claimed = (await t.mutation(api.bridgeSync.claimWrite, { credential: bridgeCredential })).request;
        expect(claimed?.requestId).toBe(b.requestId);
        await t.mutation(api.bridgeSync.completeWrite, {
          credential: bridgeCredential, requestId: requireWriteRequestId(b.requestId),
          outcome: "verified", actualRevision: baseHash,
          claimGeneration: claimed!.claimGeneration, claimToken: claimed!.claimToken,
        });
      } else {
        // A later collaborative canonical save need not wait for native A.
        await t.run(async (ctx) => ctx.db.patch(fixture.workId, {
          content: newer, contentHash: "c".repeat(64), textIndex: "newer B",
        }));
      }
      const snapshot = () => t.run(async (ctx) => ({
        work: await ctx.db.get(fixture.workId), local: await ctx.db.get(fixture.localId),
        cloud: await ctx.db.get(fixture.cloudId),
        request: await ctx.db.get(requireWriteRequestId(a.requestId)),
      }));
      const before = await snapshot();
      const replay = await queueNative(asUser, input);
      expect(replay).toMatchObject({ requestId: a.requestId, state });
      expect(await snapshot()).toEqual(before);
      expect(before.work?.content).toEqual(newer);
    },
  );
});

function requireWriteRequestId(
  requestId: Id<"bridgeWriteRequests"> | "protected-original",
): Id<"bridgeWriteRequests"> {
  if (requestId === "protected-original") {
    throw new Error(
      "expected a Bridge write request, not a protected-original park",
    );
  }
  return requestId;
}

async function seedActor(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Replica Truth School",
      slug: `replica-truth-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject,
      email: identity.email,
      emailVerified: true,
      name: "Replica Truth",
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
    return { accountId, schoolId };
  });
}

async function seedWork(t: ReturnType<typeof convexTest>) {
  const actor = await seedActor(t);
  return t.run(async (ctx) => {
    const now = Date.now();
    const policyId = await ctx.db.insert("syncPolicies", { accountId: actor.accountId,
      scopeKind: "account", scopeId: String(actor.accountId), ...POLICY_PRESETS.both, createdAt: now, updatedAt: now });
    const workId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: actor.accountId,
      schoolId: actor.schoolId,
      blueprintKey: "resource",
      resourceClass: "resource",
      nativeFormat: "docx",
      compatibilityProfile: "strict-native",
      title: "Truth fixture",
      content: { blocks: [] },
      contentHash: baseHash,
      textIndex: "",
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const deviceId = await ctx.db.insert("bridgeDevices", {
      accountId: actor.accountId,
      name: "Test Bridge",
      platform: "windows",
      credentialHash: Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(bridgeCredential),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join(""),
      protocolVersion: "1",
      appVersion: "1",
      pairedAt: now,
      lastSeenAt: now,
      state: "active",
    });
    const mountId = await ctx.db.insert("bridgeMounts", {
      accountId: actor.accountId,
      deviceId,
      rootLabel: "Test",
      grantId: "grant_deadbeef",
      state: "active",
      fileCount: 1,
      doubleSyncRisk: false,
      createdAt: now,
      updatedAt: now,
    });
    const baseStorageId = await ctx.storage.store(new Blob(["base"]));
    const nextStorageId = await ctx.storage.store(new Blob(["next"]));
    const basePayloadId = await ctx.db.insert("payloadObjects", {
      accountId: actor.accountId,
      hash: baseHash,
      storageId: baseStorageId,
      bytes: 4,
      mediaType: "application/test",
      refCount: 2,
      state: "active",
      createdAt: now,
      verifiedAt: now,
    });
    const nextPayloadId = await ctx.db.insert("payloadObjects", {
      accountId: actor.accountId,
      hash: nextHash,
      storageId: nextStorageId,
      bytes: 4,
      mediaType: "application/test",
      refCount: 0,
      state: "active",
      createdAt: now,
      verifiedAt: now,
    });
    const cloudId = await ctx.db.insert("workReplicas", {
      accountId: actor.accountId,
      workId,
      kind: "cloud",
      nativeFormat: "docx",
      payloadRef: String(basePayloadId),
      revision: baseHash,
      baseRevision: baseHash,
      contentHash: baseHash,
      state: "current",
      lastVerifiedAt: now,
      updatedAt: now,
    });
    const localId = await ctx.db.insert("workReplicas", {
      accountId: actor.accountId,
      workId,
      kind: "local",
      deviceId,
      mountId,
      localResourceId: "resource-1",
      relativePath: "Truth.docx",
      nativeFormat: "docx",
      payloadRef: String(basePayloadId),
      revision: baseHash,
      baseRevision: baseHash,
      contentHash: baseHash,
      state: "current",
      lastVerifiedAt: now,
      updatedAt: now,
    });
    return {
      ...actor,
      policyId,
      workId,
      deviceId,
      mountId,
      basePayloadId,
      nextPayloadId,
      cloudId,
      localId,
    };
  });
}

describe("replica truth machine", () => {
  it("uses compact ownership for retained payloads and still checks legacy replica references", async () => {
    const t = setupTest();
    const f = await seedWork(t);
    const ownerId = await t.run(async ctx => {
      await ctx.db.patch(f.basePayloadId, { verifiedAt: Date.now() - 25 * 60 * 60_000 });
      await ctx.db.patch(f.cloudId, { projectionBaseContent: { body: "x".repeat(100_000) } });
      return ctx.db.insert("collaborationPayloadOwners", {
        payloadRef: String(f.basePayloadId), ownerId: String(f.cloudId), ownerTable: "workReplicas",
      });
    });
    const handler = Reflect.get(sweepReplicaTruth, "_handler") as (ctx: MutationCtx, args: object) => Promise<{ releasedPayloads: number }>;
    const measure = () => t.run(async ctx => {
      const observed = observeDatabase(ctx.db);
      const result = await handler({ ...ctx, db: observed.db }, {});
      return { result, bytes: observed.snapshot().serializedDocumentBytes };
    });
    const compact = await measure();
    expect(compact.result.releasedPayloads).toBe(0);
    expect(compact.bytes).toBeLessThan(10_000);
    await t.run(ctx => ctx.db.delete(ownerId));
    const legacy = await measure();
    expect(legacy.result.releasedPayloads).toBe(0);
    expect(legacy.bytes - compact.bytes).toBeGreaterThan(100_000);
    expect((await t.run(ctx => ctx.db.get(f.basePayloadId)))?.state).toBe("active");
  });

  it("does not reactivate an original package over a durable authored head", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const content = { blocks: [{ id: "edited", text: "saved edit" }] };
    await t.run(ctx => ctx.db.patch(fixture.workId, { blueprintKey: "document", content, liveStateVectorHash: "durable-head" }));
    expect(await t.withIdentity(identity).mutation(api.replicas.activateLens, {
      workId: fixture.workId, payloadHash: baseHash, content: { blocks: [] }, fidelityMap: {},
      semanticDigest: baseHash, nativeFormat: "docx", blueprintKey: "document",
    })).toMatchObject({ activated: false });
    expect((await t.run(ctx => ctx.db.get(fixture.workId)))?.content).toEqual(content);
  });

  it("commits cloud native bytes once and fences stale materializations without replacing authored content", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const actor = t.withIdentity(identity);
    const semantic = "c".repeat(64);
    const input = {
      workId: fixture.workId, payloadRef: String(fixture.nextPayloadId), contentHash: nextHash,
      baseRevision: baseHash, projectionContent: { blocks: [{ text: "native result" }] },
      projectionContentHash: semantic, fidelityMap: { entries: [] },
      nativeReceipt: {
        kind: "native-office-save" as const, format: "docx" as const,
        operationId: `native:${fixture.workId}:${baseHash}:${nextHash}`, artifactId: String(fixture.workId),
        basePayloadHash: baseHash, resultPayloadHash: nextHash, baseRevision: baseHash, resultRevision: nextHash,
        targets: { regionIds: ["docx:p:1"], partNames: ["/word/document.xml"] },
        semantic: { resultDigest: semantic, readbackDigest: semantic }, preservedPartNames: [], state: "cloud_saved" as const,
      },
    };
    const before = await t.run(ctx => ctx.db.get(fixture.workId));
    const first = await cloudNative(actor, input);
    expect(await cloudNative(actor, input)).toEqual(first);
    expect(await t.run(ctx => ctx.db.get(fixture.cloudId))).toMatchObject({ revision: nextHash, payloadRef: String(fixture.nextPayloadId) });
    expect(await t.run(ctx => ctx.db.get(fixture.localId))).toMatchObject({ state: "behind", revision: baseHash, contentHash: baseHash });
    const folder = await actor.mutation(api.orgTree.createFolder, { name: "Native rescan fixture" });
    await t.run(async ctx => {
      await ctx.db.patch(fixture.mountId, { rootOrgNodeId: folder.nodeId });
      await ctx.db.patch(fixture.localId, { localResourceId: "lr_deadbeef" });
    });
    await t.mutation(api.bridgeSync.discoverResourcesPage, { credential: bridgeCredential, mountId: fixture.mountId,
      resources: [{ localResourceId: "lr_deadbeef", relativePath: "Truth.docx", size: 4, contentHash: baseHash, nativeFormat: "docx" }] });
    expect(await t.run(ctx => ctx.db.get(fixture.localId))).toMatchObject({ state: "behind", contentHash: baseHash });
    expect(await t.run(ctx => ctx.db.query("syncConflicts").collect())).toEqual([]);
    await cloudNative(actor, { ...input, payloadRef: String(fixture.basePayloadId), contentHash: baseHash, baseRevision: nextHash,
      nativeReceipt: { ...input.nativeReceipt, baseRevision: nextHash, basePayloadHash: nextHash,
        resultRevision: baseHash, resultPayloadHash: baseHash, operationId: `native:${fixture.workId}:${nextHash}:${baseHash}` } });
    expect(await t.run(ctx => ctx.db.get(fixture.localId))).toMatchObject({ state: "current", contentHash: baseHash });
    expect((await t.run(ctx => ctx.db.get(fixture.workId)))?.content).toEqual(before?.content);
    const newer = "d".repeat(64);
    await t.run(ctx => ctx.db.patch(fixture.cloudId, { revision: newer, contentHash: newer }));
    expect(await cloudNative(actor, input)).toEqual(first);
    expect((await t.run(ctx => ctx.db.get(fixture.cloudId)))?.revision).toBe(newer);
    await expect(cloudNative(actor, {
      ...input, baseRevision: nextHash,
      nativeReceipt: { ...input.nativeReceipt, baseRevision: nextHash, basePayloadHash: nextHash, operationId: `native:${fixture.workId}:${nextHash}:${nextHash}` },
    })).rejects.toThrow("MATERIALIZATION_BASE_STALE");
    await t.run(ctx => ctx.db.patch(fixture.workId, { status: "deleted" }));
    await expect(cloudNative(actor, input)).rejects.toThrow();
  });

  it("activates and materializes a workbook beyond Convex's object-field limit", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const cells = Object.fromEntries(
      Array.from({ length: 1_322 }, (_, index) => [
        `A${index + 1}`,
        { value: index + 1 },
      ]),
    );
    const workbook = {
      workbook: { calculationMode: "automatic", locale: "en-US" },
      sheets: [
        {
          id: "xlsx:sheet:1",
          name: "Data",
          cells,
          tables: [],
          charts: [],
        },
      ],
      activeSheetId: "xlsx:sheet:1",
    };
    const storedWorkbook = encodeArtifactContentForStorage("sheets", workbook);
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.cloudId, { nativeFormat: "xlsx" });
      await ctx.db.patch(fixture.localId, {
        nativeFormat: "xlsx",
        relativePath: "Truth.xlsx",
      });
    });

    await t.withIdentity(identity).mutation(api.replicas.activateLens, {
      workId: fixture.workId,
      payloadHash: baseHash,
      content: storedWorkbook,
      fidelityMap: { entries: [] },
      semanticDigest: "c".repeat(64),
      nativeFormat: "xlsx",
      blueprintKey: "sheets",
      textIndex: "bounded workbook",
    });
    const activated = await t.run(async (ctx) => ctx.db.get(fixture.workId));
    const activatedSheet = (
      activated?.content as { sheets?: Array<{ cells?: unknown }> }
    )?.sheets?.[0];
    expect(sheetCellEntries(activatedSheet?.cells)).toHaveLength(1_322);

    const queued = await queueNative(t
      .withIdentity(identity), {
        workId: fixture.workId,
        payloadRef: String(fixture.nextPayloadId),
        contentHash: nextHash,
        baseRevision: baseHash,
        fidelityMap: { entries: [] },
        regionIds: ["xlsx:sheet:1:A1322"],
        partNames: ["/xl/worksheets/sheet1.xml"],
        baseContent: storedWorkbook,
        baseContentHash: "c".repeat(64),
        projectionContent: storedWorkbook,
        projectionContentHash: "d".repeat(64),
      });
    const requestId = requireWriteRequestId(queued.requestId);
    const request = await t.run(async (ctx) => ctx.db.get(requestId));
    const projectedSheet = (
      request?.projectionBaseContent as {
        sheets?: Array<{ cells?: unknown }>;
      }
    )?.sheets?.[0];
    expect(sheetCellEntries(projectedSheet?.cells)).toHaveLength(1_322);
  });

  it("derives one replay-safe request without optimistic current stamps", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const input = {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    };

    const first = await queueNative(asUser, input);
    const replay = await queueNative(asUser, input);

    expect(replay.requestId).toBe(first.requestId);
    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      requests: await ctx.db.query("bridgeWriteRequests").collect(),
      operations: await ctx.db.query("syncOperations").collect(),
    }));
    expect(truth.requests).toHaveLength(1);
    expect(truth.operations).toHaveLength(1);
    expect(truth.cloud).toMatchObject({
      state: "current",
      revision: baseHash,
      contentHash: baseHash,
    });
    expect(truth.local).toMatchObject({ state: "pending", revision: baseHash });
    expect(truth.local?.state).not.toBe("current");
  });

  it("retargets materialization onto the live Bridge replica of the same path", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const staleLocalId = await t.run(async (ctx) => {
      const now = Date.now();
      const staleDeviceId = await ctx.db.insert("bridgeDevices", {
        accountId: fixture.accountId,
        name: "Silent Bridge",
        platform: "windows",
        credentialHash: "c".repeat(64),
        protocolVersion: "1",
        appVersion: "1",
        pairedAt: now - 60 * 60_000,
        lastSeenAt: now - 60 * 60_000,
        state: "active",
      });
      const staleMountId = await ctx.db.insert("bridgeMounts", {
        accountId: fixture.accountId,
        deviceId: staleDeviceId,
        rootLabel: "Old",
        grantId: "grant_stale",
        state: "active",
        fileCount: 1,
        doubleSyncRisk: false,
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("workReplicas", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        kind: "local",
        deviceId: staleDeviceId,
        mountId: staleMountId,
        localResourceId: "resource-stale",
        relativePath: "Truth.docx",
        nativeFormat: "docx",
        payloadRef: String(fixture.basePayloadId),
        revision: baseHash,
        baseRevision: baseHash,
        contentHash: baseHash,
        state: "current",
        lastVerifiedAt: now,
        updatedAt: now + 10,
      });
    });

    const queued = await queueNative(t.withIdentity(identity), {
        workId: fixture.workId,
        payloadRef: String(fixture.nextPayloadId),
        contentHash: nextHash,
        baseRevision: baseHash,
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localReplicaId: staleLocalId,
      });
    const request = await t.run(async (ctx) =>
      ctx.db.get(requireWriteRequestId(queued.requestId)),
    );
    expect(request?.localResourceId).toBe("resource-1");
    expect(request?.deviceId).toBe(fixture.deviceId);

    const truth = await t
      .withIdentity(identity)
      .query(api.replicas.forWork, { workId: fixture.workId });
    assert(truth, "Authorized artifact must have replica metadata");
    expect(
      truth.replicas.find((replica) => replica._id === staleLocalId),
    ).toMatchObject({
      state: "unavailable",
      unavailableReason: "not-on-this-computer",
    });
    expect(truth.pendingCount).toBe(1);
  });

  it("rejects a second materialization until the first write is verified", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const thirdHash = "c".repeat(64);
    const thirdPayloadId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["third"]));
      return ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: thirdHash,
        storageId,
        bytes: 5,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: Date.now(),
        verifiedAt: Date.now(),
      });
    });
    await expect(
      queueNative(asUser, {
        workId: fixture.workId,
        payloadRef: String(thirdPayloadId),
        contentHash: thirdHash,
        baseRevision: nextHash,
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
      }),
    ).rejects.toThrow("MATERIALIZATION_BASE_STALE");
  });

  it("advances the stored semantic base to the projection represented by verified bytes", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const projection = { blocks: [{ id: "body", text: "Saved projection" }] };
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: projection,
      projectionContentHash: nextHash,
      projectionTextIndex: "Saved projection",
    });
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: requireWriteRequestId(queued.requestId),
      outcome: "verified",
      actualRevision: nextHash,
    });
    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.cloud).toMatchObject({
      projectionBaseRevision: nextHash,
      projectionBaseContent: projection,
      projectionBaseContentHash: nextHash,
      projectionBaseTextIndex: "Saved projection",
    });
    expect(truth.local).toMatchObject({
      projectionBaseRevision: nextHash,
      projectionBaseContent: projection,
    });
  });

  it("keeps an external upload and its exact replay on the same replica truth", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const input = {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: nextHash,
      bytes: 4,
      mediaType: "application/test",
      payloadRef: String(fixture.nextPayloadId),
    };

    const first = await t.mutation(api.bridgeSync.commitPayloadUpload, input);
    const afterFirst = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      operations: await ctx.db.query("syncOperations").collect(),
      conflicts: await ctx.db.query("syncConflicts").collect(),
    }));
    const replay = await t.mutation(api.bridgeSync.commitPayloadUpload, input);
    const afterReplay = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      operations: await ctx.db.query("syncOperations").collect(),
      conflicts: await ctx.db.query("syncConflicts").collect(),
    }));

    expect(first).toMatchObject({ externalChange: true });
    expect(replay).toEqual(first);
    expect(afterFirst.local).toMatchObject({
      state: "ahead",
      revision: nextHash,
      baseRevision: baseHash,
      contentHash: nextHash,
    });
    expect(afterFirst.cloud).toMatchObject({
      state: "behind",
      revision: baseHash,
      baseRevision: baseHash,
      contentHash: baseHash,
    });
    expect(afterFirst.operations).toHaveLength(1);
    expect(afterFirst.operations[0]).toMatchObject({
      direction: "external",
      revisionBefore: baseHash,
      revisionAfter: nextHash,
      state: "applied",
    });
    expect(afterFirst.conflicts).toEqual([]);
    expect(afterReplay).toEqual(afterFirst);
  });

  it("retains the verified common base across successive external saves", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const thirdHash = payloadHash("third");
    const thirdPayloadId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["third"]));
      return ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: thirdHash,
        storageId,
        bytes: 5,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: Date.now(),
        verifiedAt: Date.now(),
      });
    });

    await t.mutation(api.bridgeSync.commitPayloadUpload, {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: nextHash,
      bytes: 4,
      mediaType: "application/test",
      payloadRef: String(fixture.nextPayloadId),
    });
    await t.mutation(api.bridgeSync.commitPayloadUpload, {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: thirdHash,
      bytes: 5,
      mediaType: "application/test",
      payloadRef: String(thirdPayloadId),
    });

    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      operations: await ctx.db.query("syncOperations").collect(),
      conflicts: await ctx.db.query("syncConflicts").collect(),
    }));
    expect(truth.local).toMatchObject({
      state: "ahead",
      revision: thirdHash,
      baseRevision: baseHash,
      contentHash: thirdHash,
    });
    expect(truth.cloud).toMatchObject({
      state: "behind",
      revision: baseHash,
      contentHash: baseHash,
    });
    expect(truth.operations).toHaveLength(2);
    expect(
      new Set(truth.operations.map((operation) => operation.idempotencyKey))
        .size,
    ).toBe(2);
    expect(truth.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revisionAfter: nextHash,
          state: "failed",
          errorCode: "external-revision-superseded",
        }),
        expect.objectContaining({ revisionAfter: thirdHash, state: "applied" }),
      ]),
    );
    expect(truth.conflicts).toEqual([]);
  });

  it("does not present a superseded external revision as still syncing", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "superseded-external",
        direction: "external",
        revisionBefore: "0".repeat(64),
        revisionAfter: nextHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
    });

    const truth = await t.withIdentity(identity).query(api.replicas.forWork, {
      workId: fixture.workId,
    });
    assert(truth, "Authorized artifact must have replica metadata");
    expect(truth.pendingCount).toBe(0);
  });

  it("lets a modify collaborator read replica truth without crashing", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const collaboratorIdentity = {
      subject: "clerk_replica_collaborator",
      email: "replica-collab@example.test",
      emailVerified: true,
    };
    const strangerIdentity = {
      subject: "clerk_replica_stranger",
      email: "replica-stranger@example.test",
      emailVerified: true,
    };
    const collaboratorGrantId = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.workId, { schoolId: fixture.schoolId });
      const collaboratorAccountId = await ctx.db.insert("accounts", {
        clerkId: collaboratorIdentity.subject,
        email: collaboratorIdentity.email,
        emailVerified: true,
        name: "Replica Collaborator",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId: collaboratorAccountId,
        schoolId: fixture.schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const grantId = await ctx.db.insert("accessGrants", {
        schoolId: fixture.schoolId,
        resourceType: "artifact",
        resourceId: fixture.workId,
        principalType: "account",
        principalId: collaboratorAccountId,
        level: "modify",
        capabilities: ["read", "modify", "restore", "use", "comment"],
        source: "direct",
        createdByAccountId: fixture.accountId,
        createdAt: now,
        updatedAt: now,
      });
      const strangerAccountId = await ctx.db.insert("accounts", {
        clerkId: strangerIdentity.subject,
        email: strangerIdentity.email,
        emailVerified: true,
        name: "Replica Stranger",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId: strangerAccountId,
        schoolId: fixture.schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return grantId;
    });
    const ownerTruth = await t.withIdentity(identity).query(api.replicas.forWork, {
      workId: fixture.workId,
    });
    assert(ownerTruth, "Authorized artifact must have replica metadata");
    expect(ownerTruth.replicas.length).toBeGreaterThan(0);
    const collaboratorTruth = await t
      .withIdentity(collaboratorIdentity)
      .query(api.replicas.forWork, { workId: fixture.workId });
    assert(collaboratorTruth, "Authorized artifact must have replica metadata");
    expect(collaboratorTruth.replicas.map((replica) => replica._id)).toEqual(
      ownerTruth.replicas
        .filter((replica) => replica.kind === "cloud")
        .map((replica) => replica._id),
    );
    expect(collaboratorTruth.replicas.every((replica) => replica.kind === "cloud")).toBe(true);
    expect(collaboratorTruth.replicas.some((replica) => "relativePath" in replica)).toBe(false);
    await expect(t.withIdentity(collaboratorIdentity).query(api.replicas.localEffectCount, { workIds: [fixture.workId] })).rejects.toThrow("WORK_NOT_FOUND");
    expect(await t.withIdentity(collaboratorIdentity).query(api.replicas.undoNeedsLocalApproval, { workIds: [fixture.workId] })).toBe(false);
    expect(await t.withIdentity(identity).query(api.replicas.undoNeedsLocalApproval, { workIds: [fixture.workId] })).toBe(true);
    await t.run(ctx => ctx.db.patch(fixture.policyId, { contentDirection: "manual" }));
    expect(await t.withIdentity(identity).query(api.replicas.undoNeedsLocalApproval, { workIds: [fixture.workId] })).toBe(false);
    await t.run(ctx => ctx.db.patch(fixture.policyId, { contentDirection: "bidirectional" }));
    await expect(t.withIdentity(strangerIdentity).query(api.replicas.undoNeedsLocalApproval, { workIds: [fixture.workId] })).rejects.toThrow("WORK_NOT_FOUND");
    expect(await t.withIdentity(strangerIdentity).query(api.replicas.forWork, {
      workId: fixture.workId,
    })).toBeNull();
    await t.run(async (ctx) => ctx.db.patch(collaboratorGrantId, { level: "read", capabilities: ["read", "use", "comment"] }));
    await expect(t.withIdentity(collaboratorIdentity).query(api.replicas.undoNeedsLocalApproval, { workIds: [fixture.workId] })).rejects.toThrow("WORK_NOT_FOUND");
  });

  it("forwards shared Office capability to cloud payloads and lens activation without exposing owner Bridge state", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const collaboratorIdentity = {
      subject: "clerk_replica_native_collaborator",
      email: "native-collaborator@example.test",
      emailVerified: true,
    };
    const readerIdentity = {
      subject: "clerk_replica_native_reader",
      email: "native-reader@example.test",
      emailVerified: true,
    };
    const revokedIdentity = {
      subject: "clerk_replica_native_revoked",
      email: "native-revoked@example.test",
      emailVerified: true,
    };
    const foreignIdentity = {
      subject: "clerk_replica_native_foreign",
      email: "native-foreign@example.test",
      emailVerified: true,
    };
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.workId, { schoolId: fixture.schoolId });
      const foreignSchoolId = await ctx.db.insert("schools", {
        name: "Foreign Replica School",
        slug: `foreign-replica-${crypto.randomUUID()}`,
        verifiedDomains: [],
        status: "active",
        timezone: "Europe/Madrid",
        policyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const identities = [
        [collaboratorIdentity, fixture.schoolId],
        [readerIdentity, fixture.schoolId],
        [revokedIdentity, fixture.schoolId],
        [foreignIdentity, foreignSchoolId],
      ] as const;
      const accountIds = new Map<string, Id<"accounts">>();
      for (const [candidate, schoolId] of identities) {
        const accountId = await ctx.db.insert("accounts", {
          clerkId: candidate.subject,
          email: candidate.email,
          emailVerified: true,
          name: candidate.email,
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
        accountIds.set(candidate.subject, accountId);
        await ctx.db.insert("schoolMemberships", {
          accountId,
          schoolId,
          role: "student",
          status: "active",
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      const grant = async (candidate: typeof collaboratorIdentity, level: "read" | "modify") =>
        ctx.db.insert("accessGrants", {
          schoolId: fixture.schoolId,
          resourceType: "artifact",
          resourceId: fixture.workId,
          principalType: "account",
          principalId: accountIds.get(candidate.subject)!,
          level,
          capabilities: level === "modify"
            ? ["read", "modify", "restore", "use", "comment"]
            : ["read", "use", "comment"],
          source: "direct",
          createdByAccountId: fixture.accountId,
          createdAt: now,
          updatedAt: now,
        });
      const collaboratorGrantId = await grant(collaboratorIdentity, "modify");
      await grant(readerIdentity, "read");
      const revokedGrantId = await grant(revokedIdentity, "modify");
      return { collaboratorGrantId, revokedGrantId };
    });

    expect(
      (await t.withIdentity(identity).query(api.spectraArtifacts.get, {
        artifactId: fixture.workId,
      })).accessLevel,
    ).toBe("modify");
    expect(
      (await t.withIdentity(collaboratorIdentity).query(api.spectraArtifacts.get, {
        artifactId: fixture.workId,
      })).accessLevel,
    ).toBe("modify");
    expect(
      (await t.withIdentity(readerIdentity).query(api.spectraArtifacts.get, {
        artifactId: fixture.workId,
      })).accessLevel,
    ).toBe("read");

    const cloudForOwner = await t.withIdentity(identity).query(api.replicas.payloadForWork, {
      workId: fixture.workId,
      prefer: "cloud",
    });
    const cloudForCollaborator = await t.withIdentity(collaboratorIdentity).query(api.replicas.payloadForWork, {
      workId: fixture.workId,
      prefer: "cloud",
    });
    const cloudForReader = await t.withIdentity(readerIdentity).query(api.replicas.payloadForWork, {
      workId: fixture.workId,
      prefer: "cloud",
    });
    expect(cloudForCollaborator).toMatchObject({
      payloadRef: String(fixture.basePayloadId),
      replicaKind: "cloud",
      hash: baseHash,
    });
    expect(cloudForReader?.payloadRef).toBe(String(fixture.basePayloadId));
    expect(cloudForOwner?.url).toBeTruthy();
    expect(cloudForCollaborator?.url).toBeTruthy();
    expect(cloudForCollaborator?.url).toBe(cloudForOwner?.url);
    expect(
      await t.withIdentity(collaboratorIdentity).query(api.replicas.payloadForWork, {
        workId: fixture.workId,
        prefer: "local-latest",
      }),
    ).toMatchObject({ replicaKind: "cloud", payloadRef: String(fixture.basePayloadId) });
    expect(
      await t.withIdentity(collaboratorIdentity).query(api.payloads.get, {
        hash: baseHash,
      }),
    ).toBeNull();
    expect(
      await t.withIdentity(collaboratorIdentity).query(api.payloads.get, {
        hash: baseHash,
        workId: fixture.workId,
      }),
    ).toMatchObject({ hash: baseHash, bytes: 4 });
    await t.run(async (ctx) => ctx.db.patch(ids.revokedGrantId, { revokedAt: Date.now() }));
    await expect(
      t.withIdentity(revokedIdentity).query(api.spectraArtifacts.get, {
        artifactId: fixture.workId,
      }),
    ).rejects.toThrow(/Artifact not found|WORK_NOT_FOUND|AUTH_RESOURCE_FORBIDDEN/);
    await expect(
      t.withIdentity(revokedIdentity).query(api.replicas.payloadForWork, {
        workId: fixture.workId,
        prefer: "cloud",
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);

    await expect(
      t.withIdentity(readerIdentity).mutation(api.replicas.activateLens, {
        workId: fixture.workId,
        payloadHash: baseHash,
        content: { blocks: [] },
        fidelityMap: { entries: [] },
        semanticDigest: "c".repeat(64),
        nativeFormat: "docx",
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);
    await expect(
      t.withIdentity(foreignIdentity).query(api.replicas.payloadForWork, {
        workId: fixture.workId,
        prefer: "cloud",
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);
    await expect(
      t.withIdentity(foreignIdentity).query(api.payloads.get, {
        hash: baseHash,
        workId: fixture.workId,
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);

    await t.withIdentity(collaboratorIdentity).mutation(api.replicas.activateLens, {
      workId: fixture.workId,
      payloadHash: baseHash,
      content: { blocks: [] },
      fidelityMap: { entries: [] },
      semanticDigest: "c".repeat(64),
      nativeFormat: "docx",
    });
    await t.run(async (ctx) => ctx.db.patch(ids.collaboratorGrantId, { revokedAt: Date.now() }));
    expect(await t.withIdentity(collaboratorIdentity).query(api.replicas.forWork, {
      workId: fixture.workId,
    })).toBeNull();
    await expect(
      t.withIdentity(collaboratorIdentity).query(api.replicas.payloadForWork, {
        workId: fixture.workId,
        prefer: "cloud",
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);
    await expect(
      t.withIdentity(collaboratorIdentity).mutation(api.replicas.activateLens, {
        workId: fixture.workId,
        payloadHash: baseHash,
        content: { blocks: [] },
        fidelityMap: { entries: [] },
        semanticDigest: "d".repeat(64),
        nativeFormat: "docx",
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);

  });

  it("lets a modify collaborator queue materialization only onto their own local replica", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const collaboratorCredential = "bridge-collaborator-credential-000001";
    const collaboratorIdentity = {
      subject: "clerk_replica_writer",
      email: "replica-writer@example.test",
      emailVerified: true,
    };
    const readerIdentity = {
      subject: "clerk_replica_reader",
      email: "replica-reader@example.test",
      emailVerified: true,
    };
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.workId, { schoolId: fixture.schoolId });
      const collaboratorAccountId = await ctx.db.insert("accounts", {
        clerkId: collaboratorIdentity.subject,
        email: collaboratorIdentity.email,
        emailVerified: true,
        name: "Replica Writer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const readerAccountId = await ctx.db.insert("accounts", {
        clerkId: readerIdentity.subject,
        email: readerIdentity.email,
        emailVerified: true,
        name: "Replica Reader",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      for (const accountId of [collaboratorAccountId, readerAccountId]) {
        await ctx.db.insert("syncPolicies", { accountId, scopeKind: "account", scopeId: String(accountId),
          ...POLICY_PRESETS.both, createdAt: now, updatedAt: now });
        await ctx.db.insert("schoolMemberships", {
          accountId,
          schoolId: fixture.schoolId,
          role: "student",
          status: "active",
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      const collaboratorGrantId = await ctx.db.insert("accessGrants", {
        schoolId: fixture.schoolId,
        resourceType: "artifact",
        resourceId: fixture.workId,
        principalType: "account",
        principalId: collaboratorAccountId,
        level: "modify",
        capabilities: ["read", "modify", "restore", "use", "comment"],
        source: "direct",
        createdByAccountId: fixture.accountId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("accessGrants", {
        schoolId: fixture.schoolId,
        resourceType: "artifact",
        resourceId: fixture.workId,
        principalType: "account",
        principalId: readerAccountId,
        level: "read",
        capabilities: ["read", "use", "comment"],
        source: "direct",
        createdByAccountId: fixture.accountId,
        createdAt: now,
        updatedAt: now,
      });
      const deviceId = await ctx.db.insert("bridgeDevices", {
        accountId: collaboratorAccountId,
        name: "Collaborator Bridge",
        platform: "windows",
        credentialHash: Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(collaboratorCredential),
            ),
          ),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join(""),
        protocolVersion: "1",
        appVersion: "1",
        pairedAt: now,
        lastSeenAt: now,
        state: "active",
      });
      const mountId = await ctx.db.insert("bridgeMounts", {
        accountId: collaboratorAccountId,
        deviceId,
        rootLabel: "Collab",
        grantId: "grant_collaborator",
        state: "active",
        fileCount: 1,
        doubleSyncRisk: false,
        createdAt: now,
        updatedAt: now,
      });
      const storageId = await ctx.storage.store(new Blob(["collab"]));
      const payloadId = await ctx.db.insert("payloadObjects", {
        accountId: collaboratorAccountId,
        hash: nextHash,
        storageId,
        bytes: 6,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: now,
        verifiedAt: now,
      });
      const localId = await ctx.db.insert("workReplicas", {
        accountId: collaboratorAccountId,
        workId: fixture.workId,
        kind: "local",
        deviceId,
        mountId,
        localResourceId: "resource-collab",
        relativePath: "Shared.docx",
        nativeFormat: "docx",
        payloadRef: String(fixture.basePayloadId),
        revision: baseHash,
        baseRevision: baseHash,
        contentHash: baseHash,
        state: "current",
        lastVerifiedAt: now,
        updatedAt: now,
      });
      return { localId, payloadId, deviceId, mountId, collaboratorGrantId };
    });

    const queued = await queueNative(t
      .withIdentity(collaboratorIdentity), {
        workId: fixture.workId,
        payloadRef: String(seeded.payloadId),
        contentHash: nextHash,
        baseRevision: baseHash,
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
      });
    expect(queued.state).toBe("pending");

    await expect(
      queueNative(t.withIdentity(collaboratorIdentity), {
        workId: fixture.workId,
        payloadRef: String(seeded.payloadId),
        contentHash: nextHash,
        baseRevision: baseHash,
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localReplicaId: fixture.localId,
      }),
    ).rejects.toThrow(/LOCAL_REPLICA_UNAVAILABLE/);

    await expect(
      queueNative(t.withIdentity(readerIdentity), {
        workId: fixture.workId,
        payloadRef: String(seeded.payloadId),
        contentHash: nextHash,
        baseRevision: baseHash,
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);

    const uploadUrl = await t
      .withIdentity(collaboratorIdentity)
      .mutation(api.payloads.issueUpload, {
        workId: fixture.workId,
      });
    expect(typeof uploadUrl).toBe("string");
    expect(String(uploadUrl).length).toBeGreaterThan(8);

    const claimed = await t.mutation(api.bridgeSync.claimWrite, {
      credential: collaboratorCredential,
    });
    const requestId = requireWriteRequestId(queued.requestId);
    expect(claimed.request?.requestId).toBe(requestId);
    await t.run(async (ctx) =>
      ctx.db.patch(seeded.collaboratorGrantId, { revokedAt: Date.now() }),
    );
    await expect(
      t.mutation(api.bridgeSync.beginPayloadUpload, {
        credential: collaboratorCredential,
        replicaId: seeded.localId,
        hash: nextHash,
        bytes: 6,
        mediaType: "application/test",
      }),
    ).rejects.toThrow(/WORK_NOT_FOUND/);
    const completed = await t.mutation(api.bridgeSync.completeWrite, {
      credential: collaboratorCredential,
      requestId,
      outcome: "verified",
      actualRevision: nextHash,
      claimGeneration: claimed.request?.claimGeneration,
      claimToken: claimed.request?.claimToken,
    });
    expect(completed.state).toBe("failed");
    const afterRevocation = await t.run(async (ctx) => ({
      request: await ctx.db.get(requestId),
      local: await ctx.db.get(seeded.localId),
      cloud: await ctx.db.get(fixture.cloudId),
    }));
    expect(afterRevocation.request).toMatchObject({
      state: "failed",
      errorCode: "permission-revoked",
    });
    expect(afterRevocation.local).toMatchObject({
      state: "error",
      errorCode: "permission-revoked",
    });
    expect(afterRevocation.cloud).toMatchObject({
      payloadRef: String(fixture.basePayloadId),
      contentHash: baseHash,
    });
  });

  it("does not keep Syncing after an applied Spectra write", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "applied-spectra-write",
        direction: "cloud-to-local",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "applied",
        actorKind: "user",
        createdAt: now,
        updatedAt: now,
      });
    });
    const truth = await t.withIdentity(identity).query(api.replicas.forWork, {
      workId: fixture.workId,
    });
    assert(truth, "Authorized artifact must have replica metadata");
    expect(truth.pendingCount).toBe(0);
  });

  it("does not treat a Keep Spectra write as an open conflict", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        state: "resolving-spectra",
        createdAt: now,
        updatedAt: now,
      });
    });
    const truth = await t.withIdentity(identity).query(api.replicas.forWork, {
      workId: fixture.workId,
    });
    assert(truth, "Authorized artifact must have replica metadata");
    expect(truth.openConflictCount).toBe(0);
    expect(truth.conflicts).toEqual([]);
  });

  it("expires an external revision that never reaches reconciliation", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const operationId = await t.run(async (ctx) => {
      const stalledAt = Date.now() - BRIDGE_WRITE_EXPIRES_MS - 1;
      return ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "stalled-external",
        direction: "external",
        revisionBefore: baseHash,
        revisionAfter: baseHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: stalledAt,
        updatedAt: stalledAt,
      });
    });

    const result = await t.mutation(internal.replicas.sweepReplicaTruth, {});
    expect(result.documentsRead).toBeLessThanOrEqual(100);
    expect(result.expiredExternalOperations).toBe(1);
    const operation = await t.run(async (ctx) => ctx.db.get(operationId));
    expect(operation).toMatchObject({
      state: "failed",
      errorCode: "external-reconciliation-expired",
    });
  });

  it("compensates an expired claimed write and its dependent rows", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const ids = await t.run(async (ctx) => {
      const then = Date.now() - 60 * 60_000;
      await ctx.db.patch(fixture.localId, {
        state: "pending",
        updatedAt: then,
      });
      const requestId = await ctx.db.insert("bridgeWriteRequests", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        deviceId: fixture.deviceId,
        mountId: fixture.mountId,
        localResourceId: "resource-1",
        relativePath: "Truth.docx",
        payloadRef: String(fixture.nextPayloadId),
        baseRevision: baseHash,
        targetRevision: nextHash,
        contentHash: nextHash,
        idempotencyKey: "expired-write",
        regionIds: [],
        partNames: [],
        state: "claimed",
        claimedAt: then,
        attemptCount: 1,
        expiresAt: then + 1,
        createdAt: then,
        updatedAt: then,
      });
      const operationId = await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "expired-write",
        direction: "cloud-to-local",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "pending",
        actorKind: "user",
        createdAt: then,
        updatedAt: then,
      });
      return { requestId, operationId };
    });

    const result = await t.mutation(internal.replicas.sweepReplicaTruth, {});
    expect(result.failedWrites).toBe(1);
    const truth = await t.run(async (ctx) => ({
      request: await ctx.db.get(ids.requestId),
      operation: await ctx.db.get(ids.operationId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.request).toMatchObject({
      state: "failed",
      errorCode: "write-expired",
    });
    expect(truth.operation).toMatchObject({
      state: "failed",
      errorCode: "write-expired",
    });
    expect(truth.local).toMatchObject({
      state: "error",
      errorCode: "write-expired",
    });
  });

  it("releases only payload bytes with no live references", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) =>
      ctx.db.patch(fixture.nextPayloadId, {
        verifiedAt: Date.now() - 25 * 60 * 60_000,
      }),
    );

    const result = await t.mutation(internal.replicas.sweepReplicaTruth, {});
    expect(result.releasedPayloads).toBe(1);
    const truth = await t.run(async (ctx) => ({
      released: await ctx.db.get(fixture.nextPayloadId),
      retained: await ctx.db.get(fixture.basePayloadId),
    }));
    expect(truth.released).toMatchObject({ state: "released", refCount: 0 });
    expect(truth.retained).toMatchObject({ state: "active" });
  });

  it("finishes cloud-to-device storage only after Bridge read-back", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => ctx.db.delete(fixture.localId));
    const asUser = t.withIdentity(identity);

    const transition = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "device",
        mountId: fixture.mountId,
        relativePath: "Truth.docx",
      },
    );
    expect(transition.state).toBe("pending");
    expect(transition.materializationRequestId).not.toBeNull();
    expect(transition.operationId).not.toBeNull();
    expect(transition.preview).toMatchObject({
      before: { locations: { cloud: expect.objectContaining({ kind: "cloud" }) } },
      after: { physicalLocalAction: "write-retained-payload-to-existing-local-resource" },
    });
    expect(transition.transitionReceipt).toMatchObject({
      state: "pending",
      operationId: String(transition.operationId),
    });
    const replay = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "device",
        mountId: fixture.mountId,
        relativePath: "Truth.docx",
      },
    );
    expect(replay.transitionId).toBe(transition.transitionId);
    expect(replay.materializationRequestId).toBe(
      transition.materializationRequestId,
    );
    expect(replay.operationId).toBe(transition.operationId);
    const status = await asUser.query(api.replicas.strategyTransitionForWork, {
      workId: fixture.workId,
    });
    expect(status).toMatchObject({
      requestId: transition.materializationRequestId,
      operationId: transition.operationId,
      requestState: "pending",
      operationState: "pending",
      preview: {
        pendingWork: {
          localResourceId: expect.any(String),
          relativePath: "Truth.docx",
        },
      },
    });

    const completed = await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: transition.materializationRequestId!,
      outcome: "verified",
      actualRevision: baseHash,
    });
    expect(completed.state).toBe("verified");
    const truth = await t.run(async (ctx) => ({
      transition: await ctx.db.get(transition.transitionId),
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db
        .query("workReplicas")
        .withIndex("by_work_kind", (q) =>
          q.eq("workId", fixture.workId).eq("kind", "local"),
        )
        .unique(),
    }));
    expect(truth.transition).toMatchObject({
      state: "verified",
      toPreset: "device",
    });
    expect(truth.cloud).toMatchObject({
      state: "unavailable",
      unavailableReason: "metadata-only",
    });
    expect(truth.cloud?.payloadRef).toBeUndefined();
    expect(truth.local).toMatchObject({ state: "current", revision: baseHash });
    expect(truth.local?.payloadRef).toBeUndefined();
    await expect(
      asUser.mutation(api.payloads.issueUpload, { workId: fixture.workId }),
    ).rejects.toThrow("CLOUD_CONTENT_METADATA_ONLY");
  });

  it("finishes Keep in Spectra by attaching a retained payload without waiting on Bridge", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
    });
    const afterDevice = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      payload: await ctx.db.get(fixture.basePayloadId),
    }));
    expect(afterDevice.cloud).toMatchObject({
      state: "unavailable",
      unavailableReason: "metadata-only",
    });
    expect(afterDevice.cloud?.payloadRef).toBeUndefined();
    expect(afterDevice.local?.payloadRef).toBeUndefined();
    expect(afterDevice.payload).toMatchObject({
      state: "active",
      hash: baseHash,
    });

    const transition = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "spectra",
      },
    );
    expect(transition.state).toBe("verified");
    const truth = await t.run(async (ctx) => ({
      transition: await ctx.db.get(transition.transitionId),
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.transition).toMatchObject({
      state: "verified",
      toPreset: "spectra",
    });
    expect(truth.cloud).toMatchObject({
      state: "current",
      payloadRef: String(fixture.basePayloadId),
      contentHash: baseHash,
    });
    expect(truth.local).toMatchObject({
      state: "unavailable",
      unavailableReason: "unlinked-by-user",
    });
  });

  it("completes Keep in Spectra from disk-only bytes after Bridge uploads them", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.basePayloadId, { state: "released" });
    });
    const transition = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "spectra",
      },
    );
    expect(transition.state).toBe("pending");
    const claimed = await t.mutation(api.bridgeSync.claimPendingPayloadUpload, {
      credential: bridgeCredential,
    });
    expect(claimed.request).toMatchObject({
      replicaId: fixture.localId,
      relativePath: "Truth.docx",
    });
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["base"])),
    );
    await t.mutation(api.bridgeSync.commitPayloadUpload, {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: baseHash,
      bytes: 4,
      mediaType: "application/test",
      storageId,
    });
    const truth = await t.run(async (ctx) => ({
      transition: await ctx.db.get(transition.transitionId),
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.transition).toMatchObject({
      state: "verified",
      toPreset: "spectra",
    });
    expect(truth.cloud).toMatchObject({
      state: "current",
      contentHash: baseHash,
    });
    expect(truth.cloud?.payloadRef).toBeTruthy();
    expect(truth.local).toMatchObject({
      state: "unavailable",
      unavailableReason: "unlinked-by-user",
    });
  });

  it("claims a Keep in Spectra upload when the cloud payload hash does not match disk", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.basePayloadId, { state: "released" });
      await ctx.db.patch(fixture.cloudId, {
        payloadRef: String(fixture.nextPayloadId),
        contentHash: undefined,
        state: "unavailable",
        unavailableReason: "metadata-only",
      });
    });
    const transition = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "spectra",
      },
    );
    expect(transition.state).toBe("pending");
    const claimed = await t.mutation(api.bridgeSync.claimPendingPayloadUpload, {
      credential: bridgeCredential,
    });
    expect(claimed.request).toMatchObject({
      replicaId: fixture.localId,
      relativePath: "Truth.docx",
    });
  });

  it("gives Library the full replica set so a This-PC file is not Unavailable", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await asUser.mutation(api.replicas.transitionStorageStrategy, {
      workId: fixture.workId,
      toPreset: "device",
    });
    const rows = await asUser.query(api.replicas.presentationsForAccount, {});
    const row = rows.find((candidate) => candidate.workId === fixture.workId);
    expect(row?.replicas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "local", state: "current" }),
        expect.objectContaining({ kind: "cloud", state: "unavailable" }),
      ]),
    );
    expect(
      row?.replicas.some(
        (replica) => replica.kind === "local" && replica.state === "current",
      ),
    ).toBe(true);
  });

  it("sweeps a stalled pending storage transition so the radios can exit", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const stalledAt = Date.now() - 3 * 60_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.cloudId, {
        payloadRef: undefined,
        contentHash: undefined,
        state: "unavailable",
        unavailableReason: "metadata-only",
      });
    });
    const transitionId = await t.run(async (ctx) =>
      ctx.db.insert("storageStrategyTransitions", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        idempotencyKey: "strategy_stall_test",
        fromPreset: "both",
        toPreset: "spectra",
        state: "pending",
        before: { hadItemPolicy: false, preset: "both" },
        createdAt: stalledAt,
        updatedAt: stalledAt,
      }),
    );
    const result = await t.mutation(internal.replicas.sweepReplicaTruth, {});
    expect(result.failedTransitions).toBe(1);
    const transition = await t.run(async (ctx) => ctx.db.get(transitionId));
    expect(transition).toMatchObject({
      state: "failed",
      errorCode: "strategy-transition-failed",
    });
  });

  it("makes linked storage metadata-only without losing the verified local revision", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);

    const transition = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "linked",
      },
    );
    expect(transition.state).toBe("verified");
    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.cloud).toMatchObject({
      state: "unavailable",
      unavailableReason: "metadata-only",
    });
    expect(truth.cloud?.payloadRef).toBeUndefined();
    expect(truth.local).toMatchObject({
      state: "current",
      contentHash: baseHash,
      protectedOriginal: true,
    });
    expect(truth.local?.payloadRef).toBeUndefined();
  });

  it("rolls a storage strategy back when Bridge read-back disagrees", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(ctx => ctx.db.delete(fixture.policyId));
    await t.run(async (ctx) => ctx.db.delete(fixture.localId));
    const asUser = t.withIdentity(identity);
    const transition = await asUser.mutation(
      api.replicas.transitionStorageStrategy,
      {
        workId: fixture.workId,
        toPreset: "device",
        mountId: fixture.mountId,
        relativePath: "Truth.docx",
      },
    );

    const completed = await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: transition.materializationRequestId!,
      outcome: "verified",
      actualRevision: nextHash,
    });
    expect(completed.state).toBe("failed");
    const [truth, policy] = await Promise.all([
      t.run(async (ctx) => ({
        transition: await ctx.db.get(transition.transitionId),
        cloud: await ctx.db.get(fixture.cloudId),
      })),
      asUser.query(api.syncPolicy.effective, {
        itemId: String(fixture.workId),
      }),
    ]);
    expect(truth.transition).toMatchObject({
      state: "failed",
      errorCode: "readback-revision-mismatch",
    });
    expect(truth.cloud).toMatchObject({
      state: "current",
      payloadRef: String(fixture.basePayloadId),
    });
    if (!policy) throw new Error("expected an effective sync policy");
    expect(policy.preset).toBe("spectra");
  });

  it("parks a locked write outside the eligible claim window", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const claimed = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    const requestId = requireWriteRequestId(queued.requestId);
    expect(claimed.request?.requestId).toBe(requestId);
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId,
      outcome: "waiting",
      errorCode: "office-locked",
      errorMessage: "Waiting for Office",
      claimGeneration: claimed.request?.claimGeneration,
      claimToken: claimed.request?.claimToken,
    });

    const immediate = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    expect(immediate.request).toBeNull();
    const request = await t.run(async (ctx) => ctx.db.get(requestId));
    expect(request).toMatchObject({
      state: "pending",
      errorCode: "office-locked",
    });
    expect(request?.retryAt).toBeGreaterThan(Date.now());
  });

  it("reconciles legacy labels from retained payload hashes", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        contentHash: nextHash,
        revision: "legacy-current",
        state: "current",
      });
    });

    const result = await t.mutation(
      internal.replicas.reconcileReplicaTruthMigration,
      {},
    );
    expect(result.state).toBe("complete");
    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      conflicts: await ctx.db.query("syncConflicts").collect(),
    }));
    expect(truth.cloud).toMatchObject({
      state: "diverged",
      revision: baseHash,
    });
    expect(truth.local).toMatchObject({
      state: "diverged",
      revision: nextHash,
    });
    expect(truth.conflicts).toHaveLength(1);
    expect(truth.conflicts[0]).toMatchObject({
      state: "open",
      localPayloadRef: String(fixture.nextPayloadId),
      spectraPayloadRef: String(fixture.basePayloadId),
    });
  });

  it("migrates a local-only full-cloud artifact to ahead, never false current", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => ctx.db.delete(fixture.cloudId));

    await t.mutation(internal.replicas.reconcileReplicaTruthMigration, {});
    const local = await t.run(async (ctx) => ctx.db.get(fixture.localId));
    expect(local).toMatchObject({
      state: "ahead",
      revision: baseHash,
      contentHash: baseHash,
    });
  });

  it("keeps both byte versions by moving the local identity to a real fork", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        contentHash: nextHash,
        revision: nextHash,
        state: "diverged",
        updatedAt: now,
      });
      await ctx.db.patch(fixture.cloudId, {
        state: "diverged",
        updatedAt: now,
      });
      await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: String(fixture.nextPayloadId),
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t
      .withIdentity(identity)
      .mutation(api.replicas.resolveExternalConflict, {
        workId: fixture.workId,
        resolution: "keep-both",
      });
    expect(result.resolved).toBe(1);
    expect(result.workId).not.toBeNull();
    const truth = await t.run(async (ctx) => {
      const forkId = result.workId as Id<"spectraArtifacts">;
      return {
        fork: await ctx.db.get(forkId),
        local: await ctx.db.get(fixture.localId),
        forkCloud: await ctx.db
          .query("workReplicas")
          .withIndex("by_work_kind", (q) =>
            q.eq("workId", forkId).eq("kind", "cloud"),
          )
          .unique(),
        originalCloud: await ctx.db.get(fixture.cloudId),
        conflict: (await ctx.db.query("syncConflicts").collect())[0],
      };
    });
    expect(truth.fork).toMatchObject({
      resourceClass: "resource",
      contentHash: nextHash,
    });
    expect(truth.local).toMatchObject({
      workId: result.workId,
      payloadRef: String(fixture.nextPayloadId),
      state: "current",
    });
    expect(truth.forkCloud).toMatchObject({
      payloadRef: String(fixture.nextPayloadId),
      state: "current",
    });
    expect(truth.originalCloud).toMatchObject({
      payloadRef: String(fixture.basePayloadId),
      state: "current",
    });
    expect(truth.conflict).toMatchObject({
      state: "forked",
      forkedWorkId: result.workId,
    });
  });

  it("refuses legacy conflict resolution outside the durable reconciliation commit", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const conflicts = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        revision: nextHash,
        contentHash: nextHash,
        state: "ahead",
        updatedAt: now,
      });
      await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "external-next",
        direction: "external",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
      const relevant = await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: String(fixture.nextPayloadId),
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
      const unrelated = await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["header"],
        partNames: ["word/header1.xml"],
        localRevision: "c".repeat(64),
        spectraRevision: baseHash,
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
      return { relevant, unrelated };
    });

    const result = t
      .withIdentity(identity)
      .mutation(api.replicas.recordExternalReconciliation, {
        workId: fixture.workId,
        localReplicaId: fixture.localId,
        localPayloadRef: String(fixture.nextPayloadId),
        localRevision: nextHash,
        content: { blocks: [{ id: "body", text: "external" }] },
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        conflictRegionIds: [],
        resolution: "local",
      });
    // Applying and resolving now happen only in the durable Yjs/history
    // transaction (nativeReconciliation.commit, covered in
    // s11-native-history-boundaries). The legacy public path must not resolve.
    await expect(result).rejects.toThrow("EXTERNAL_DURABLE_COMMIT_REQUIRED");
    const truth = await t.run(async (ctx) => ({
      relevant: await ctx.db.get(conflicts.relevant),
      unrelated: await ctx.db.get(conflicts.unrelated),
      cloud: await ctx.db.get(fixture.cloudId),
    }));
    expect(truth.relevant).toMatchObject({ state: "open" });
    expect(truth.unrelated).toMatchObject({ state: "open" });
    expect(truth.cloud).toMatchObject({ revision: baseHash, payloadRef: String(fixture.basePayloadId) });
  });

  it("keeps overlapping Keep Office conflicts open without the durable reconciliation commit", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const conflictId = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        revision: nextHash,
        contentHash: nextHash,
        state: "ahead",
        updatedAt: now,
      });
      await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "external-overlap",
        direction: "external",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["pptx:slide:/ppt/slides/slide1.xml", "pptx:slide:/ppt/slides/slide31.xml"],
        partNames: ["ppt/slides/slide1.xml", "ppt/slides/slide31.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: String(fixture.nextPayloadId),
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = t
      .withIdentity(identity)
      .mutation(api.replicas.recordExternalReconciliation, {
        workId: fixture.workId,
        localReplicaId: fixture.localId,
        localPayloadRef: String(fixture.nextPayloadId),
        localRevision: nextHash,
        content: { slides: [{ id: "slide-1", speakerNotes: "native" }] },
        fidelityMap: { entries: [] },
        regionIds: ["pptx:slide:/ppt/slides/slide1.xml"],
        partNames: ["ppt/notesSlides/notesSlide1.xml"],
        conflictRegionIds: [],
        resolution: "local",
      });
    // Keep Office resolution is part of the durable reconciliation commit.
    await expect(result).rejects.toThrow("EXTERNAL_DURABLE_COMMIT_REQUIRED");
    const truth = await t.run(async (ctx) => ctx.db.get(conflictId));
    expect(truth).toMatchObject({ state: "open" });
  });

  it("persists precise conflict previews for reload", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        revision: nextHash,
        contentHash: nextHash,
        state: "ahead",
        updatedAt: now,
      });
      await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "external-preview",
        direction: "external",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
    });
    const previews = [
      {
        regionId: "body",
        spectra: "Spectra version",
        external: "Word version",
      },
    ];
    await t
      .withIdentity(identity)
      .mutation(api.replicas.recordExternalReconciliation, {
        workId: fixture.workId,
        localReplicaId: fixture.localId,
        localPayloadRef: String(fixture.nextPayloadId),
        localRevision: nextHash,
        content: { blocks: [{ id: "body", text: "Spectra version" }] },
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        conflictRegionIds: ["body"],
        previews,
      });
    const truth = await t.withIdentity(identity).query(api.replicas.forWork, {
      workId: fixture.workId,
    });
    assert(truth, "Authorized artifact must have replica metadata");
    expect(truth.conflicts[0]?.previews).toEqual(previews);
  });

  it("does not blob-conflict a Word save against an unverified Spectra write", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const wordHash = payloadHash("word");
    const wordPayloadId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["word"]));
      return ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: wordHash,
        storageId,
        bytes: 4,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: Date.now(),
        verifiedAt: Date.now(),
      });
    });
    await t.mutation(api.bridgeSync.commitPayloadUpload, {
      credential: bridgeCredential,
      replicaId: fixture.localId,
      hash: wordHash,
      bytes: 4,
      mediaType: "application/test",
      payloadRef: String(wordPayloadId),
    });
    const truth = await t.run(async (ctx) => ({
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      conflicts: await ctx.db.query("syncConflicts").collect(),
      requests: await ctx.db.query("bridgeWriteRequests").collect(),
    }));
    expect(truth.cloud).toMatchObject({
      revision: baseHash,
      contentHash: baseHash,
    });
    expect(truth.local).toMatchObject({
      revision: wordHash,
      contentHash: wordHash,
    });
    expect(truth.conflicts).toEqual([]);
    expect(
      truth.requests.some(
        (request) =>
          request.state === "failed" &&
          request.errorCode === "external-save-during-write",
      ),
    ).toBe(true);
  });

  it("supersedes an in-flight write when the disk revision moved", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const first = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const wordHash = "d".repeat(64);
    const keepHash = "e".repeat(64);
    const payloads = await t.run(async (ctx) => {
      const now = Date.now();
      const wordStorage = await ctx.storage.store(new Blob(["word"]));
      const keepStorage = await ctx.storage.store(new Blob(["keep"]));
      const wordPayloadId = await ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: wordHash,
        storageId: wordStorage,
        bytes: 4,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: now,
        verifiedAt: now,
      });
      const keepPayloadId = await ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: keepHash,
        storageId: keepStorage,
        bytes: 4,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: now,
        verifiedAt: now,
      });
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(wordPayloadId),
        revision: wordHash,
        contentHash: wordHash,
        updatedAt: now,
      });
      return { keepPayloadId };
    });
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(payloads.keepPayloadId),
      contentHash: keepHash,
      baseRevision: wordHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: { blocks: [{ id: "body", text: "LOOPHOLD-27" }] },
      projectionContentHash: keepHash,
    });
    const truth = await t.run(async (ctx) => ({
      first: await ctx.db.get(requireWriteRequestId(first.requestId)),
      next: await ctx.db.get(requireWriteRequestId(queued.requestId)),
      local: await ctx.db.get(fixture.localId),
      work: await ctx.db.get(fixture.workId),
    }));
    expect(truth.first).toMatchObject({
      state: "failed",
      errorCode: "external-save-during-write",
    });
    expect(queued.state).toBe("pending");
    expect(truth.local).toMatchObject({ state: "pending", revision: wordHash });
    expect(truth.work?.content).toEqual({
      blocks: [{ id: "body", text: "LOOPHOLD-27" }],
    });
  });

  async function seedKeepSpectraConflict(
    t: ReturnType<typeof convexTest>,
    fixture: Awaited<ReturnType<typeof seedWork>>,
  ) {
    const keepHash = "c".repeat(64);
    const keepPayloadId = await t.run(async (ctx) => {
      const now = Date.now();
      const storageId = await ctx.storage.store(new Blob(["keep"]));
      const payloadId = await ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: keepHash,
        storageId,
        bytes: 4,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: now,
        verifiedAt: now,
      });
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        revision: nextHash,
        contentHash: nextHash,
        state: "diverged",
        updatedAt: now,
      });
      await ctx.db.patch(fixture.cloudId, {
        state: "diverged",
        updatedAt: now,
      });
      await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["body", "heading-quality", "heading-resiliency"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: String(fixture.nextPayloadId),
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
      return payloadId;
    });
    return { keepHash, keepPayloadId };
  }

  async function secondLocalCopy(t: ReturnType<typeof convexTest>, f: Awaited<ReturnType<typeof seedWork>>) {
    return t.run(ctx => ctx.db.insert("workReplicas", {
      accountId: f.accountId, workId: f.workId, kind: "local", deviceId: f.deviceId, mountId: f.mountId,
      localResourceId: "second-copy", relativePath: "Second.docx", nativeFormat: "docx", payloadRef: String(f.basePayloadId),
      revision: baseHash, baseRevision: baseHash, contentHash: baseHash, state: "current", updatedAt: Date.now(),
    }));
  }

  it.each(["pending", "claimed"] as const)("binds the exact %s resolution write beyond another copy's failed history", async state => {
    const t = setupTest(), f = await seedWork(t), user = t.withIdentity(identity);
    const seeded = await seedKeepSpectraConflict(t, f);
    const queued = await queueNative(user, { workId: f.workId, localReplicaId: f.localId,
      payloadRef: String(seeded.keepPayloadId), contentHash: seeded.keepHash, baseRevision: nextHash,
      fidelityMap: {}, regionIds: ["body"], partNames: ["word/document.xml"] });
    const requestId = requireWriteRequestId(queued.requestId), otherId = await secondLocalCopy(t, f);
    const history = await t.run(async ctx => {
      await ctx.db.patch(requestId, { state, claimedAt: state === "claimed" ? Date.now() : undefined });
      const ids = [], now = Date.now() + 1000;
      for (let i = 0; i < 100; i++) ids.push(await ctx.db.insert("bridgeWriteRequests", {
        accountId: f.accountId, workId: f.workId, replicaId: otherId, deviceId: f.deviceId, mountId: f.mountId,
        localResourceId: "second-copy", relativePath: "Second.docx", payloadRef: String(f.nextPayloadId),
        baseRevision: baseHash, targetRevision: nextHash, contentHash: nextHash, idempotencyKey: `failed-history-${i}`,
        regionIds: ["body"], partNames: [], state: "failed", errorCode: "write-failed", createdAt: now + i, updatedAt: now + i,
      }));
      return { ids, conflicts: await ctx.db.query("syncConflicts").collect() };
    });
    const args = { workId: f.workId, resolution: "spectra" as const, requestId };
    const handler = Reflect.get(resolveExternalConflict, "_handler") as (ctx: MutationCtx, input: typeof args) => Promise<unknown>;
    const measure = () => user.run(async ctx => {
      const observed = observeDatabase(ctx.db);
      const result = await handler({ ...ctx, db: observed.db }, args).catch(error => ({ error: String(error) }));
      return { result, ...observed.snapshot() };
    });
    const dense = await measure();
    await t.run(async ctx => {
      for (const row of history.conflicts) await ctx.db.patch(row._id, { state: row.state, resolutionRequestId: row.resolutionRequestId, updatedAt: row.updatedAt });
      for (const id of history.ids.slice(1)) await ctx.db.delete(id);
    });
    const sparse = await measure();
    expect(sparse.result).toMatchObject({ requestId });
    expect.soft(dense.result).toEqual(sparse.result);
    expect.soft(dense.calls).toBe(sparse.calls);
    expect.soft(dense.documentsReturned).toBe(sparse.documentsReturned);
    expect(dense.reads.filter(read => read.table === "bridgeWriteRequests" && read.operation === "take")).toEqual([]);
    expect(dense.writes).toBe(sparse.writes);
    expect(await t.run(ctx => ctx.db.get(requestId))).toMatchObject({ state, replicaId: f.localId });
  });

  it.each(["foreign", "other-work", "inactive", "missing"] as const)("never substitutes a different write for an explicit %s request", async kind => {
    const t = setupTest(), f = await seedWork(t), user = t.withIdentity(identity);
    const seeded = await seedKeepSpectraConflict(t, f);
    await queueNative(user, { workId: f.workId, payloadRef: String(seeded.keepPayloadId), contentHash: seeded.keepHash,
      baseRevision: nextHash, fidelityMap: {}, regionIds: ["body"], partNames: ["word/document.xml"] });
    const requestId = await t.run(async ctx => {
      const now = Date.now();
      const accountId = kind === "foreign" ? await ctx.db.insert("accounts", { clerkId: "wrong-write-peer", email: "wrong-write@example.test",
        emailVerified: true, name: "Wrong write peer", status: "active", createdAt: now, updatedAt: now }) : f.accountId;
      const workId = kind === "other-work" ? await ctx.db.insert("spectraArtifacts", { ownerAccountId: f.accountId, schoolId: f.schoolId,
        title: "Other artifact", blueprintKey: "document", content: { blocks: [] }, tags: [], status: "active", createdAt: now, updatedAt: now }) : f.workId;
      const id = await ctx.db.insert("bridgeWriteRequests", { accountId, workId, replicaId: f.localId, deviceId: f.deviceId, mountId: f.mountId,
        localResourceId: "wrong-target", relativePath: "Wrong.docx", payloadRef: String(f.nextPayloadId), baseRevision: baseHash,
        targetRevision: nextHash, contentHash: nextHash, idempotencyKey: "wrong-target", regionIds: ["body"], partNames: [],
        state: kind === "inactive" ? "failed" : "pending", createdAt: now + 1000, updatedAt: now });
      if (kind === "missing") await ctx.db.delete(id);
      return id;
    });
    const before = await t.run(ctx => ctx.db.query("syncConflicts").collect());
    await expect(user.mutation(api.replicas.resolveExternalConflict, { workId: f.workId, resolution: "spectra", requestId }))
      .rejects.toThrow("CONFLICT_RESOLUTION_WRITE_REQUIRED");
    expect(await t.run(ctx => ctx.db.query("syncConflicts").collect())).toEqual(before);
  });

  it.each(["verified", "failed", "conflicted", "superseded", "external"] as const)("settles only the bound conflict on %s despite other-request density", async outcome => {
    const samples = [];
    for (const count of [1, 100]) {
      const t = setupTest(), f = await seedWork(t), user = t.withIdentity(identity), otherId = await secondLocalCopy(t, f);
      const queue = { workId: f.workId, payloadRef: String(f.nextPayloadId), contentHash: nextHash, baseRevision: baseHash,
        fidelityMap: {}, regionIds: ["body"], partNames: ["word/document.xml"] };
      const other = await queueNative(user, { ...queue, localReplicaId: otherId });
      const own = await queueNative(user, { ...queue, localReplicaId: f.localId });
      const requestId = requireWriteRequestId(own.requestId), otherRequestId = requireWriteRequestId(other.requestId);
      const seeded = await t.run(async ctx => {
        const now = Date.now(), ids = [];
        for (let i = 0; i < count; i++) ids.push(await ctx.db.insert("syncConflicts", { accountId: f.accountId, workId: f.workId,
          replicaIds: [otherId, f.cloudId], regionIds: ["body"], partNames: [], localRevision: baseHash, spectraRevision: nextHash,
          state: "resolving-spectra", resolutionRequestId: otherRequestId, createdAt: now }));
        const ownId = await ctx.db.insert("syncConflicts", { accountId: f.accountId, workId: f.workId, replicaIds: [f.localId, f.cloudId],
          regionIds: ["body"], partNames: [], localRevision: baseHash, spectraRevision: nextHash,
          state: "resolving-spectra", resolutionRequestId: requestId, createdAt: now });
        const thirdHash = payloadHash("third"), storageId = await ctx.storage.store(new Blob(["third"]));
        const thirdPayloadId = await ctx.db.insert("payloadObjects", { accountId: f.accountId, hash: thirdHash, storageId, bytes: 5,
          mediaType: "application/test", refCount: 0, state: "active", createdAt: now, verifiedAt: now });
        return { ownId, unrelated: await Promise.all(ids.map(id => ctx.db.get(id))), thirdHash, thirdPayloadId };
      });
      if (outcome === "superseded") {
        await queueNative(user, { ...queue, localReplicaId: f.localId, payloadRef: String(seeded.thirdPayloadId), contentHash: seeded.thirdHash });
      } else {
        const args = outcome === "external" ? { credential: bridgeCredential, replicaId: f.localId, hash: seeded.thirdHash,
          bytes: 5, mediaType: "application/test", payloadRef: String(seeded.thirdPayloadId) }
          : { credential: bridgeCredential, requestId, outcome, actualRevision: nextHash, errorCode: outcome === "verified" ? undefined : "write-failed" };
        const target = outcome === "external" ? commitPayloadUpload : completeWrite;
        const handler = Reflect.get(target, "_handler") as (ctx: MutationCtx, input: typeof args) => Promise<unknown>;
        samples.push(await t.run(async ctx => {
          const observed = observeDatabase(ctx.db);
          await handler({ ...ctx, db: observed.db }, args);
          return observed.snapshot();
        }));
      }
      expect.soft(await t.run(ctx => ctx.db.get(seeded.ownId))).toMatchObject({ state: outcome === "verified" ? "resolved-spectra" : "open" });
      expect.soft(await t.run(ctx => Promise.all(seeded.unrelated.map(row => ctx.db.get(row!._id))))).toEqual(seeded.unrelated);
      expect(await t.run(ctx => ctx.db.get(otherRequestId))).toMatchObject({ state: "pending", replicaId: otherId });
    }
    if (samples.length) {
      const [sparse, dense] = samples;
      expect.soft(dense.calls).toBe(sparse.calls);
      expect.soft(dense.documentsReturned).toBe(sparse.documentsReturned);
      const range = dense.reads.filter(read => read.table === "syncConflicts" && read.operation === "take");
      expect(range).toHaveLength(1);
      expect(range[0]).toMatchObject({ documentsReturned: 1, postIndexFilter: false });
    }
  });

  it("refuses a desktop write that was not built on the unread Word save", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const seeded = await seedKeepSpectraConflict(t, fixture);
    await expect(queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(seeded.keepPayloadId),
      contentHash: seeded.keepHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    })).rejects.toThrow("MATERIALIZATION_BASE_STALE");
  });

  it("binds Keep Spectra to the queued write even when open conflict regions are a unioned superset", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const seeded = await seedKeepSpectraConflict(t, fixture);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(seeded.keepPayloadId),
      contentHash: seeded.keepHash,
      baseRevision: nextHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const resolved = await asUser.mutation(
      api.replicas.resolveExternalConflict,
      {
        workId: fixture.workId,
        resolution: "spectra",
        requestId: requireWriteRequestId(queued.requestId),
      },
    );
    expect(resolved.requestId).toBe(queued.requestId);
    const conflict = await t.run(
      async (ctx) => (await ctx.db.query("syncConflicts").collect())[0],
    );
    expect(conflict).toMatchObject({
      state: "resolving-spectra",
      resolutionRequestId: queued.requestId,
    });
  });

  it("still binds Keep Spectra when the write overlaps any open conflict region", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const seeded = await seedKeepSpectraConflict(t, fixture);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(seeded.keepPayloadId),
      contentHash: seeded.keepHash,
      baseRevision: nextHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    await expect(
      asUser.mutation(api.replicas.resolveExternalConflict, {
        workId: fixture.workId,
        resolution: "spectra",
      }),
    ).resolves.toMatchObject({ requestId: queued.requestId });
  });

  it("refuses Keep Spectra when no pending write exists", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: String(fixture.nextPayloadId),
        revision: nextHash,
        contentHash: nextHash,
        state: "diverged",
        updatedAt: now,
      });
      await ctx.db.patch(fixture.cloudId, {
        state: "diverged",
        updatedAt: now,
      });
      await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [fixture.localId, fixture.cloudId],
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: String(fixture.nextPayloadId),
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
    });
    await expect(
      t.withIdentity(identity).mutation(api.replicas.resolveExternalConflict, {
        workId: fixture.workId,
        resolution: "spectra",
      }),
    ).rejects.toThrow(/CONFLICT_RESOLUTION_WRITE_REQUIRED/);
  });

  it("resolves Keep Spectra when the active local copy and cloud agree", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(fixture.localId, {
        payloadRef: undefined,
        contentHash: undefined,
        state: "current",
        updatedAt: now,
      });
      const missingReplicaId = await ctx.db.insert("workReplicas", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        kind: "local",
        deviceId: fixture.deviceId,
        mountId: fixture.mountId,
        localResourceId: "missing-copy",
        relativePath: "missing.docx",
        nativeFormat: "docx",
        revision: nextHash,
        state: "unavailable",
        unavailableReason: "missing-on-disk",
        errorCode: "externally-deleted",
        updatedAt: now,
      });
      const matchingReplicaId = await ctx.db.insert("workReplicas", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        kind: "local",
        deviceId: fixture.deviceId,
        mountId: fixture.mountId,
        localResourceId: "verified-copy",
        relativePath: "verified-copy.docx",
        nativeFormat: "docx",
        payloadRef: String(fixture.basePayloadId),
        revision: baseHash,
        baseRevision: baseHash,
        contentHash: baseHash,
        state: "current",
        lastVerifiedAt: now,
        updatedAt: now,
      });
      const externalOperationId = await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: matchingReplicaId,
        idempotencyKey: "external-save-reconciled-with-cloud",
        direction: "external",
        revisionBefore: baseHash,
        revisionAfter: baseHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("syncConflicts", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaIds: [missingReplicaId, fixture.cloudId],
        regionIds: ["body", "heading-quality"],
        partNames: ["word/document.xml"],
        localRevision: nextHash,
        spectraRevision: baseHash,
        localPayloadRef: undefined,
        spectraPayloadRef: String(fixture.basePayloadId),
        state: "open",
        createdAt: now,
        updatedAt: now,
      });
      return { externalOperationId };
    });
    const resolved = await t
      .withIdentity(identity)
      .mutation(api.replicas.resolveExternalConflict, {
        workId: fixture.workId,
        resolution: "spectra",
      });
    expect(resolved.resolved).toBe(1);
    const truth = await t.run(async (ctx) => ({
      conflict: (await ctx.db.query("syncConflicts").collect())[0],
      externalOperation: await ctx.db.get(seeded.externalOperationId),
    }));
    expect(truth.conflict).toMatchObject({ state: "resolved-spectra" });
    expect(truth.externalOperation).toMatchObject({ state: "verified" });
  });

  it("leaves artifact content unchanged while a verified-first materialization is pending", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: { blocks: [{ id: "body", text: "P5V1-NATIVE-AI-2301" }] },
      projectionContentHash: nextHash,
      promotionMode: "verified-first",
    });
    const truth = await t.run(async (ctx) => ({
      work: await ctx.db.get(fixture.workId),
      request: await ctx.db.get(requireWriteRequestId(queued.requestId)),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(queued.state).toBe("pending");
    expect(truth.work?.content).toEqual({ blocks: [] });
    expect(truth.request).toMatchObject({
      state: "pending",
      projectionBaseContent: { blocks: [{ id: "body", text: "P5V1-NATIVE-AI-2301" }] },
    });
    expect(truth.local?.state).toBe("pending");
  });

  it("projects an immediately accepted native edit while Bridge sync is pending", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const projection = {
      blocks: [{ id: "body", text: "Spectra owns the accepted revision" }],
    };
    const queued = await queueNative(t.withIdentity(identity), {
        workId: fixture.workId,
        payloadRef: String(fixture.nextPayloadId),
        contentHash: nextHash,
        baseRevision: baseHash,
        fidelityMap: { entries: [] },
        regionIds: ["body"],
        partNames: ["word/document.xml"],
        projectionContent: projection,
        projectionContentHash: nextHash,
        promotionMode: "immediate-projection",
      });
    const truth = await t.run(async (ctx) => ({
      work: await ctx.db.get(fixture.workId),
      request: await ctx.db.get(requireWriteRequestId(queued.requestId)),
      local: await ctx.db.get(fixture.localId),
      cloud: await ctx.db.get(fixture.cloudId),
    }));

    expect(queued.state).toBe("pending");
    expect(truth.work?.content).toEqual(projection);
    expect(truth.request).toMatchObject({
      state: "pending",
      projectionBaseContent: projection,
      projectionBaseContentHash: nextHash,
    });
    expect(truth.local?.state).toBe("pending");
    expect(truth.cloud?.revision).toBe(baseHash);
  });

  it("coalesces a newer Spectra edit over an unclaimed Office-locked write", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const thirdHash = "c".repeat(64);
    const thirdPayloadId = await t.run(async (ctx) => {
      const now = Date.now();
      const storageId = await ctx.storage.store(new Blob(["third"]));
      return ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: thirdHash,
        storageId,
        bytes: 5,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: now,
        verifiedAt: now,
      });
    });
    const first = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: { blocks: [{ id: "body", text: "first edit" }] },
      projectionContentHash: nextHash,
      promotionMode: "immediate-projection",
    });
    const firstRequestId = requireWriteRequestId(first.requestId);
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: firstRequestId,
      outcome: "waiting",
      errorCode: "office-locked",
    });

    const latestProjection = {
      blocks: [{ id: "body", text: "first edit plus second edit" }],
    };
    const second = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(thirdPayloadId),
      contentHash: thirdHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: latestProjection,
      projectionContentHash: thirdHash,
      promotionMode: "immediate-projection",
    });
    const truth = await t.run(async (ctx) => ({
      work: await ctx.db.get(fixture.workId),
      first: await ctx.db.get(firstRequestId),
      firstOperation: (await ctx.db.query("syncOperations").collect()).find(
        (operation) => operation.revisionAfter === nextHash,
      ),
      second: await ctx.db.get(requireWriteRequestId(second.requestId)),
      local: await ctx.db.get(fixture.localId),
    }));

    expect(second.requestId).not.toBe(first.requestId);
    expect(truth.work?.content).toEqual(latestProjection);
    expect(truth.first).toMatchObject({
      state: "failed",
      errorCode: "superseded-by-newer-cloud-revision",
    });
    expect(truth.firstOperation).toMatchObject({
      state: "failed",
      errorCode: "superseded-by-newer-cloud-revision",
    });
    expect(truth.second).toMatchObject({
      state: "pending",
      baseRevision: baseHash,
      targetRevision: thirdHash,
      projectionBaseContent: latestProjection,
    });
    expect(truth.local?.state).toBe("pending");
  });

  it("advances replica byte and projection bases on verified-first without rewriting artifact content", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const externalOperationId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: fixture.workId,
        replicaId: fixture.localId,
        idempotencyKey: "external-save-awaiting-convergence",
        direction: "external",
        revisionBefore: baseHash,
        revisionAfter: nextHash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
    });
    const asUser = t.withIdentity(identity);
    const projection = { blocks: [{ id: "body", text: "P5V1-NATIVE-AI-2301" }] };
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: projection,
      projectionContentHash: nextHash,
      promotionMode: "verified-first",
    });
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: requireWriteRequestId(queued.requestId),
      outcome: "verified",
      actualRevision: nextHash,
    });
    const truth = await t.run(async (ctx) => ({
      work: await ctx.db.get(fixture.workId),
      cloud: await ctx.db.get(fixture.cloudId),
      local: await ctx.db.get(fixture.localId),
      request: await ctx.db.get(requireWriteRequestId(queued.requestId)),
      externalOperation: await ctx.db.get(externalOperationId),
    }));
    expect(truth.work?.content).toEqual({ blocks: [] });
    expect(truth.request?.state).toBe("verified");
    expect(truth.local).toMatchObject({
      revision: nextHash,
      projectionBaseContent: projection,
      state: "current",
    });
    expect(truth.cloud).toMatchObject({
      projectionBaseContent: projection,
      projectionBaseRevision: nextHash,
    });
    expect(truth.externalOperation).toMatchObject({ state: "verified" });
  });

  it("reports authorized materialization status and hides requests from strangers", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      promotionMode: "verified-first",
    });
    const requestId = requireWriteRequestId(queued.requestId);
    const status = await asUser.query(api.replicas.materializationStatus, {
      requestId,
    });
    expect(status).toMatchObject({
      requestId,
      state: "pending",
      retryAt: expect.any(Number),
    });
    const strangerIdentity = {
      subject: "clerk_materialization_stranger",
      email: "materialization-stranger@example.test",
      emailVerified: true,
    };
    await t.run(async (ctx) => {
      const now = Date.now();
      const strangerAccountId = await ctx.db.insert("accounts", {
        clerkId: strangerIdentity.subject,
        email: strangerIdentity.email,
        emailVerified: true,
        name: "Stranger",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId: strangerAccountId,
        schoolId: fixture.schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });
    await expect(
      t.withIdentity(strangerIdentity).query(api.replicas.materializationStatus, {
        requestId,
      }),
    ).rejects.toThrow(/WRITE_REQUEST_NOT_FOUND/);
  });

  it("cancels pending verified-first writes without overwriting a newer projection", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
      projectionContent: { blocks: [{ id: "body", text: "AI phantom" }] },
      projectionContentHash: nextHash,
      promotionMode: "verified-first",
    });
    const requestId = requireWriteRequestId(queued.requestId);
    const newer = { blocks: [{ id: "body", text: "human later" }] };
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.workId, { content: newer, updatedAt: Date.now() });
    });
    const cancelled = await asUser.mutation(api.replicas.cancelMaterialization, {
      requestId,
    });
    expect(cancelled).toMatchObject({ cancelled: true, state: "failed" });
    const truth = await t.run(async (ctx) => ({
      work: await ctx.db.get(fixture.workId),
      request: await ctx.db.get(requestId),
      local: await ctx.db.get(fixture.localId),
    }));
    expect(truth.work?.content).toEqual(newer);
    expect(truth.request).toMatchObject({
      state: "failed",
      errorCode: "cancelled-before-claim",
    });
    expect(truth.local).toMatchObject({ state: "current" });
    await t.run(async (ctx) => {
      await ctx.db.patch(requestId, {
        state: "claimed",
        claimedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const refused = await asUser.mutation(api.replicas.cancelMaterialization, {
      requestId,
    });
    expect(refused).toMatchObject({
      cancelled: false,
      state: "claimed",
      mustConverge: true,
    });
  });

  it("fences late A acknowledgements after B has verified on the same replica", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const thirdHash = "c".repeat(64);
    const thirdPayloadId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["third"]));
      return ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId,
        hash: thirdHash,
        storageId,
        bytes: 5,
        mediaType: "application/test",
        refCount: 0,
        state: "active",
        createdAt: Date.now(),
        verifiedAt: Date.now(),
      });
    });
    const first = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const firstRequestId = requireWriteRequestId(first.requestId);
    const firstClaim = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    if (!firstClaim.request) throw new Error("expected A to be claimable");
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: firstRequestId,
      outcome: "verified",
      actualRevision: nextHash,
      claimGeneration: firstClaim.request.claimGeneration,
      claimToken: firstClaim.request.claimToken,
    });

    const second = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(thirdPayloadId),
      contentHash: thirdHash,
      baseRevision: nextHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const secondRequestId = requireWriteRequestId(second.requestId);
    const secondClaim = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    if (!secondClaim.request) throw new Error("expected B to be claimable");
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId: secondRequestId,
      outcome: "verified",
      actualRevision: thirdHash,
      claimGeneration: secondClaim.request.claimGeneration,
      claimToken: secondClaim.request.claimToken,
    });

    const beforeLateAcks = await t.run(async (ctx) => ({
      request: await ctx.db.get(secondRequestId),
      local: await ctx.db.get(fixture.localId),
      cloud: await ctx.db.get(fixture.cloudId),
    }));
    for (const outcome of ["waiting", "failed", "verified"] as const) {
      const late = await t.mutation(api.bridgeSync.completeWrite, {
        credential: bridgeCredential,
        requestId: firstRequestId,
        outcome,
        actualRevision: outcome === "verified" ? nextHash : undefined,
        claimGeneration: firstClaim.request.claimGeneration,
        claimToken: firstClaim.request.claimToken,
        errorCode: outcome === "waiting" ? "office-locked" : undefined,
      });
      expect(late.state).toBe("verified");
    }
    const afterLateAcks = await t.run(async (ctx) => ({
      request: await ctx.db.get(secondRequestId),
      local: await ctx.db.get(fixture.localId),
      cloud: await ctx.db.get(fixture.cloudId),
    }));
    expect(afterLateAcks.request).toMatchObject({ state: "verified", targetRevision: thirdHash });
    expect(afterLateAcks.local).toMatchObject({ state: "current", revision: thirdHash, contentHash: thirdHash });
    expect(afterLateAcks.cloud).toMatchObject({ state: "current", revision: thirdHash, contentHash: thirdHash });
    expect(afterLateAcks).toEqual(beforeLateAcks);
  });

  it("ignores an acknowledgement from a reclaimed claim generation", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const asUser = t.withIdentity(identity);
    const queued = await queueNative(asUser, {
      workId: fixture.workId,
      payloadRef: String(fixture.nextPayloadId),
      contentHash: nextHash,
      baseRevision: baseHash,
      fidelityMap: { entries: [] },
      regionIds: ["body"],
      partNames: ["word/document.xml"],
    });
    const requestId = requireWriteRequestId(queued.requestId);
    const firstClaim = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    if (!firstClaim.request) throw new Error("expected first claim");
    await t.run(async (ctx) => {
      await ctx.db.patch(requestId, {
        claimedAt: Date.now() - BRIDGE_CLAIM_REDRIVE_MS - 1,
        updatedAt: Date.now() - BRIDGE_CLAIM_REDRIVE_MS - 1,
      });
    });
    const secondClaim = await t.mutation(api.bridgeSync.claimWrite, {
      credential: bridgeCredential,
    });
    if (!secondClaim.request) throw new Error("expected reclaimed claim");
    const before = await t.run(async (ctx) => ({
      request: await ctx.db.get(requestId),
      local: await ctx.db.get(fixture.localId),
      cloud: await ctx.db.get(fixture.cloudId),
    }));
    const stale = await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId,
      outcome: "verified",
      actualRevision: nextHash,
      claimGeneration: firstClaim.request.claimGeneration,
      claimToken: firstClaim.request.claimToken,
    });
    expect(stale).toMatchObject({ state: "pending", ignored: true, reason: "stale-claim" });
    const after = await t.run(async (ctx) => ({
      request: await ctx.db.get(requestId),
      local: await ctx.db.get(fixture.localId),
      cloud: await ctx.db.get(fixture.cloudId),
    }));
    expect(after).toEqual(before);
    expect(after.request).toMatchObject({
      state: "claimed",
      claimGeneration: secondClaim.request.claimGeneration,
      claimToken: secondClaim.request.claimToken,
    });
    await t.mutation(api.bridgeSync.completeWrite, {
      credential: bridgeCredential,
      requestId,
      outcome: "verified",
      actualRevision: nextHash,
      claimGeneration: secondClaim.request.claimGeneration,
      claimToken: secondClaim.request.claimToken,
    });
    const completed = await t.run(async (ctx) => ctx.db.get(requestId));
    expect(completed).toMatchObject({ state: "verified", claimGeneration: secondClaim.request.claimGeneration });
  });
});

describe("an open artifact in another tab (F17)", () => {
  it("tells the editor when the artifact went to Trash, and stops once it is back", async () => {
    const t = setupTest();
    const fixture = await seedWork(t);
    const user = t.withIdentity(identity);
    const nodeId = await t.run((ctx) => ctx.db.insert("orgNodes", {
      accountId: fixture.accountId, parentId: null, kind: "work", sourceId: fixture.workId,
      name: "Truth fixture", orderKey: "a", createdAt: Date.now(), updatedAt: Date.now(),
    }));
    expect((await user.query(api.replicas.forWork, { workId: fixture.workId }))?.trashedNodeId).toBeUndefined();
    await t.run((ctx) => ctx.db.patch(nodeId, { deletedAt: Date.now(), trashedRootId: nodeId, isTrashRoot: true }));
    expect((await user.query(api.replicas.forWork, { workId: fixture.workId }))?.trashedNodeId).toBe(nodeId);
    await t.run((ctx) => ctx.db.patch(nodeId, { deletedAt: undefined, trashedRootId: undefined, isTrashRoot: undefined }));
    expect((await user.query(api.replicas.forWork, { workId: fixture.workId }))?.trashedNodeId).toBeUndefined();
  });
});
