/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { BRIDGE_CLAIM_REDRIVE_MS } from "../shared/replica-truth";
import { syncRetryAt } from "../shared/sync-retry-policy";
import { nativeOperationId, type NativeSaveReceipt } from "../shared/native-office-contract";
import { enqueueStructureRequest } from "./bridgeStructure";
import { findPrimaryNode } from "./orgTreeShared";

const modules = import.meta.glob("./**/*.ts");
const credential = "bridge-batch-test-credential-00000001";

describe("individual file mounts", () => {
  const selection = (overrides = {}) => ({
    credential, rootLabel: "Chosen.docx", selectedFile: "Chosen.docx", grantId: "grant_f1", rootKey: "f".repeat(64),
    scanId: crypto.randomUUID(), fileCount: 1, doubleSyncRisk: false, ownerLockPaths: [], ...overrides,
  });
  it("puts each file in General and removing one preserves General and other mounts", async () => {
    const t = setupTest();
    await seedBridge(t);
    const args = selection();
    const a = await t.mutation(api.bridgeSync.registerMount, args);
    const b = await t.mutation(api.bridgeSync.registerMount, selection({ rootLabel: "Other.docx", selectedFile: "Other.docx", grantId: "grant_f2", rootKey: "e".repeat(64) }));
    expect(await t.mutation(api.bridgeSync.registerMount, { ...args, scanId: crypto.randomUUID() })).toBe(a);
    const first = await t.run(ctx => ctx.db.get(a));
    const second = await t.run(ctx => ctx.db.get(b));
    expect(first?.selectedFile).toBe("Chosen.docx");
    expect(first?.rootOrgNodeId).toBe(second?.rootOrgNodeId);
    const general = await t.run(ctx => ctx.db.get(first!.rootOrgNodeId!));
    expect(general?.name).toBe("General");
    await t.mutation(api.bridgeSync.detachGrant, { credential, grantId: "grant_f1" });
    expect((await t.run(ctx => ctx.db.get(general!._id)))?.deletedAt).toBeUndefined();
    expect((await t.run(ctx => ctx.db.get(b)))?.state).toBe("active");
    expect((await t.run(ctx => ctx.db.get(a)))?.state).toBe("detached");
  });
  it("rejects sibling discovery, invalid basenames and attempts to widen a persisted grant", async () => {
    const t = setupTest();
    await seedBridge(t);
    const args = selection();
    const mountId = await t.mutation(api.bridgeSync.registerMount, args);
    const resource = { localResourceId: "lr_" + "f".repeat(16), relativePath: "Private.docx", size: 12, contentHash: "a".repeat(64), nativeFormat: "docx" as const };
    await expect(t.mutation(api.bridgeSync.discoverResourcesPage, { credential, mountId, resources: [resource] })).rejects.toThrow("BRIDGE_FILE_SELECTION_PATH_NOT_ALLOWED");
    const good = await t.mutation(api.bridgeSync.discoverResourcesPage, { credential, mountId, resources: [{ ...resource, relativePath: "Chosen.docx" }] });
    expect(good.registrations).toHaveLength(1);
    expect(good.registrations[0]).toHaveProperty("replicaId");
    const reported = await t.mutation(api.bridgeSync.reportChanges, { credential, mountId, changes: [{ journalId: "op_" + "c".repeat(32), resourceId: resource.localResourceId, op: "locked", relativePath: "Private.docx" }] });
    expect(reported.results[0]).toMatchObject({ state: "rejected", errorCode: "file-selection-path-not-allowed" });
    await expect(t.mutation(api.bridgeSync.registerMount, { ...args, selectedFile: undefined })).rejects.toThrow("BRIDGE_SELECTION_SCOPE_CHANGED");
    for (const selectedFile of ["../private.docx", "sub/private.docx", "C:\\private.docx", "~$Chosen.docx"]) {
      await expect(t.mutation(api.bridgeSync.registerMount, selection({ selectedFile, rootLabel: selectedFile }))).rejects.toThrow();
    }
    await expect(t.mutation(api.bridgeSync.registerMount, selection({ fileCount: 2 }))).rejects.toThrow("BRIDGE_FILE_SELECTION_INVALID");
  });
  it("carries a file chosen alone into a folder that later covers it, as one work", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const fileMount = await t.mutation(api.bridgeSync.registerMount, selection());
    const resource = { localResourceId: "lr_" + "f".repeat(16), relativePath: "Chosen.docx", size: 12, contentHash: "a".repeat(64), nativeFormat: "docx" };
    const original = (await t.mutation(api.bridgeSync.discoverResourcesPage, { credential, mountId: fileMount, resources: [resource] })).registrations[0];
    if (!("workId" in original) || !original.workId) throw new Error("Expected selected file work");
    const folderMount = await t.mutation(api.bridgeSync.registerMount, {
      credential, rootLabel: "Unit 1", grantId: "grant_b1", rootKey: "1".repeat(64),
      scanId: crypto.randomUUID(), fileCount: 1, doubleSyncRisk: false, ownerLockPaths: [],
    });
    const again = (await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential, mountId: folderMount, resources: [{ ...resource, relativePath: "essays/Chosen.docx" }],
    })).registrations[0];
    expect(again).toHaveProperty("workId", original.workId);

    const state = await t.run(async (ctx) => {
      const replica = await ctx.db.get(original.replicaId!);
      const folder = await ctx.db.get(folderMount);
      const node = await ctx.db.query("orgNodes").withIndex("by_account_parent_live_name", (q) => q.eq("accountId", fixture.accountId).eq("parentId", folder!.rootOrgNodeId!)).collect();
      const account = await ctx.db.get(fixture.accountId);
      return { replica, retired: await ctx.db.get(fileMount), children: node.map((row) => row.name), account };
    });
    expect(state.replica).toMatchObject({ mountId: folderMount, relativePath: "essays/Chosen.docx" });
    expect(state.retired?.state).toBe("revoked");
    expect(state.children).toContain("essays");

    const asUser = t.withIdentity({ subject: state.account!.clerkId, email: state.account!.email, emailVerified: true });
    const [found, missing] = await asUser.query(api.bridge.syncedNodes, {
      items: [
        { grantId: "grant_b1", relativePath: "essays/Chosen.docx" },
        { grantId: "grant_b1", relativePath: "essays/Later.docx" },
      ],
    });
    expect(found).toMatchObject({ name: "Chosen.docx" });
    expect(missing).toBeNull();
    const [root] = await asUser.query(api.bridge.syncedNodes, { items: [{ grantId: "grant_b1", relativePath: "" }] });
    expect(root).toMatchObject({ name: "Unit 1" });

    // Placing it where it already is, or twice, simply holds.
    const parentOfWork = await t.run(async (ctx) => (await ctx.db.get(found!.nodeId as Id<"orgNodes">))!.parentId);
    const same = await asUser.mutation(api.orgTree.createReference, { targetNodeId: found!.nodeId as Id<"orgNodes">, parentId: parentOfWork });
    expect(same.nodeId).toBe(found!.nodeId);
    const first = await asUser.mutation(api.orgTree.createReference, { targetNodeId: found!.nodeId as Id<"orgNodes">, parentId: root!.nodeId });
    const second = await asUser.mutation(api.orgTree.createReference, { targetNodeId: found!.nodeId as Id<"orgNodes">, parentId: root!.nodeId });
    expect(second.nodeId).toBe(first.nodeId);
  });
  it("leaves work filed elsewhere where its owner put it when a folder takes it over", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const fileMount = await t.mutation(api.bridgeSync.registerMount, selection());
    const resource = { localResourceId: "lr_" + "e".repeat(16), relativePath: "Chosen.docx", size: 12, contentHash: "b".repeat(64), nativeFormat: "docx" };
    const original = (await t.mutation(api.bridgeSync.discoverResourcesPage, { credential, mountId: fileMount, resources: [resource] })).registrations[0];
    if (!("workId" in original) || !original.workId) throw new Error("Expected selected file work");
    const filed = await t.run(async (ctx) => {
      const node = await findPrimaryNode(ctx, fixture.accountId, "work", String(original.workId));
      await ctx.db.patch(node!._id, { parentId: null });
      return node!._id;
    });
    const folderMount = await t.mutation(api.bridgeSync.registerMount, {
      credential, rootLabel: "Unit 2", grantId: "grant_b2", rootKey: "2".repeat(64),
      scanId: crypto.randomUUID(), fileCount: 1, doubleSyncRisk: false, ownerLockPaths: [],
    });
    await t.mutation(api.bridgeSync.discoverResourcesPage, { credential, mountId: folderMount, resources: [{ ...resource, relativePath: "Chosen.docx" }] });
    expect((await t.run((ctx) => ctx.db.get(filed)))?.parentId).toBeNull();
  });
  it("keeps Library renames independent and preserves the work after re-pairing a retired device", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const args = selection();
    const mountId = await t.mutation(api.bridgeSync.registerMount, args);
    const resource = { localResourceId: "lr_" + "f".repeat(16), relativePath: "Chosen.docx", size: 12, contentHash: "a".repeat(64), nativeFormat: "docx" };
    const original = (await t.mutation(api.bridgeSync.discoverResourcesPage, { credential, mountId, resources: [resource] })).registrations[0];
    if (!("workId" in original) || !original.workId) throw new Error("Expected selected file work");
    const workId = original.workId;
    const requestId = await t.run(ctx => enqueueStructureRequest(ctx, fixture.accountId, workId, "rename", "Chosen.docx", "Renamed.docx"));
    expect(await t.run(ctx => ctx.db.get(requestId!))).toMatchObject({ state: "ignored", explanation: "This file was selected on its own. Its name and location on disk stay the same." });
    const newDeviceId = await t.run(async ctx => {
      const { _id, _creationTime, ...old } = (await ctx.db.get(fixture.deviceId))!;
      await ctx.db.patch(_id, { state: "revoked", credentialHash: "b".repeat(64) });
      return ctx.db.insert("bridgeDevices", { ...old, name: "Re-paired Bridge" });
    });
    const newMountId = await t.mutation(api.bridgeSync.registerMount, { ...args, grantId: "grant_f3", scanId: crypto.randomUUID() });
    const again = (await t.mutation(api.bridgeSync.discoverResourcesPage, { credential, mountId: newMountId, resources: [resource] })).registrations[0];
    expect(again).toHaveProperty("workId", workId);
    expect(await t.run(ctx => ctx.db.get(original.replicaId!))).toMatchObject({ mountId: newMountId, deviceId: newDeviceId });
  });
});

async function seedUploadCandidates(
  t: ReturnType<typeof convexTest>, fixture: Awaited<ReturnType<typeof seedBridge>>, count: number,
) {
  return t.run(async (ctx) => {
    const workId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: fixture.accountId, schoolId: fixture.schoolId, blueprintKey: "resource", title: "Upload candidate",
      content: {}, tags: [], status: "active", createdAt: Date.now(), updatedAt: Date.now(),
    });
    const replicaIds = [];
    for (let i = 0; i < count; i++) replicaIds.push(await ctx.db.insert("workReplicas", {
      accountId: fixture.accountId, workId, kind: "local", deviceId: fixture.deviceId,
      mountId: fixture.mountId, localResourceId: `lr_${i.toString(16).padStart(16, "0")}`,
      relativePath: `candidate-${i}.docx`, nativeFormat: "docx", revision: "a".repeat(64),
      contentHash: "a".repeat(64), state: "current", updatedAt: Date.now(),
    }));
    return { workId, replicaIds };
  });
}

describe("Bridge pending upload discovery pages", () => {
  it("keeps an idle device unchanged even with a large current replica set", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    await seedUploadCandidates(t, fixture, 75);
    const before = await t.run(ctx => ctx.db.get(fixture.deviceId));
    expect(await t.mutation(api.bridgeSync.claimPendingPayloadUpload, { credential }))
      .toEqual({ request: null, hasMore: false });
    expect(await t.run(ctx => ctx.db.get(fixture.deviceId))).toEqual(before);
  });

  it("finds a requested source beyond the old first twenty current replicas", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const { workId, replicaIds } = await seedUploadCandidates(t, fixture, 75);
    await t.run(ctx => ctx.db.insert("storageStrategyTransitions", {
      accountId: fixture.accountId, workId, idempotencyKey: "upload-last", fromPreset: "device",
      toPreset: "spectra", state: "pending", before: { localReplicaIds: [replicaIds[74]] },
      createdAt: Date.now(), updatedAt: Date.now(),
    }));
    const result = await t.mutation(api.bridgeSync.claimPendingPayloadUpload, { credential });
    expect(result.request).toMatchObject({ replicaId: replicaIds[74], relativePath: "candidate-74.docx" });
  });

  it("resumes cursorless clients past more than one page of irrelevant transitions", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const { workId, replicaIds } = await seedUploadCandidates(t, fixture, 1);
    await t.run(async ctx => {
      for (let i = 0; i < 26; i++) await ctx.db.insert("storageStrategyTransitions", {
        accountId: fixture.accountId, workId, idempotencyKey: `transition-${i}`, fromPreset: "device",
        toPreset: i === 25 ? "spectra" : "device", state: "pending", before: { localReplicaIds: replicaIds },
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    for (let i = 0; i < 25; i++) {
      const page = await t.mutation(api.bridgeSync.claimPendingPayloadUpload, { credential });
      expect(page).toEqual({ request: null, hasMore: true });
    }
    expect((await t.mutation(api.bridgeSync.claimPendingPayloadUpload, { credential })).request)
      .toMatchObject({ replicaId: replicaIds[0] });
    expect((await t.run(ctx => ctx.db.get(fixture.deviceId)))?.payloadUploadCursor).toBeUndefined();
  });

  it("pages legacy transitions without a source snapshot and rechecks replica state", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const { workId, replicaIds } = await seedUploadCandidates(t, fixture, 26);
    await t.run(async ctx => {
      for (const replicaId of replicaIds.slice(0, 25)) await ctx.db.patch(replicaId, { state: "unavailable" });
      await ctx.db.insert("storageStrategyTransitions", {
        accountId: fixture.accountId, workId, idempotencyKey: "legacy-upload", fromPreset: "device",
        toPreset: "spectra", state: "pending", before: {}, createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    expect(await t.mutation(api.bridgeSync.claimPendingPayloadUpload, { credential })).toEqual({ request: null, hasMore: true });
    expect(await t.mutation(api.bridgeSync.claimPendingPayloadUpload, { credential })).toEqual({ request: null, hasMore: true });
    expect((await t.mutation(api.bridgeSync.claimPendingPayloadUpload, { credential })).request)
      .toMatchObject({ replicaId: replicaIds[25] });
  });

  it("does not treat a cached transition ID as current authorization or pending work", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const { workId, replicaIds } = await seedUploadCandidates(t, fixture, 1);
    const transitionId = await t.run(async ctx => {
      await ctx.db.insert("storageStrategyTransitions", {
        accountId: fixture.accountId, workId, idempotencyKey: "skip-first", fromPreset: "device",
        toPreset: "device", state: "pending", before: {}, createdAt: Date.now(), updatedAt: Date.now(),
      });
      return ctx.db.insert("storageStrategyTransitions", {
        accountId: fixture.accountId, workId, idempotencyKey: "cached-target", fromPreset: "device",
        toPreset: "spectra", state: "pending", before: { localReplicaIds: replicaIds },
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    expect((await t.mutation(api.bridgeSync.claimPendingPayloadUpload, { credential })).hasMore).toBe(true);
    await t.run(ctx => ctx.db.patch(transitionId, { state: "cancelled" }));
    expect(await t.mutation(api.bridgeSync.claimPendingPayloadUpload, { credential })).toEqual({ request: null, hasMore: false });
  });

  it("resets a malformed saved cursor without blocking a valid pending upload", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const { workId, replicaIds } = await seedUploadCandidates(t, fixture, 1);
    await t.run(async ctx => {
      await ctx.db.patch(fixture.deviceId, { payloadUploadCursor: "old-unsupported-cursor" });
      await ctx.db.insert("storageStrategyTransitions", {
        accountId: fixture.accountId, workId, idempotencyKey: "new-upload", fromPreset: "device",
        toPreset: "spectra", state: "pending", before: { localReplicaIds: replicaIds },
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    expect((await t.mutation(api.bridgeSync.claimPendingPayloadUpload, { credential })).request)
      .toMatchObject({ replicaId: replicaIds[0] });
  });
});

describe("Bridge structure receipts", () => {
  afterEach(() => vi.restoreAllMocks());

  async function seedStructure(t: ReturnType<typeof convexTest>) {
    const fixture = await seedBridge(t);
    const { workId, replicaIds } = await seedUploadCandidates(t, fixture, 1);
    const requestId = await t.run(ctx => ctx.db.insert("bridgeFsRequests", {
      accountId: fixture.accountId, deviceId: fixture.deviceId, mountId: fixture.mountId,
      workId, replicaId: replicaIds[0], localResourceId: "lr_0000000000000000",
      direction: "spectra-to-disk", kind: "rename", sourceRelativePath: "candidate-0.docx",
      targetRelativePath: "renamed.docx", idempotencyKey: "rename-receipt", state: "pending", baseRevision: "a".repeat(64),
      explanation: "Disposable rename", createdAt: Date.now(), updatedAt: Date.now(),
    }));
    return { ...fixture, workId, replicaId: replicaIds[0], requestId };
  }

  async function claimStructure(t: ReturnType<typeof convexTest>) {
    const { request } = await t.mutation(api.bridgeStructure.claim, { credential, supportsFencing: true });
    if (!request) throw new Error("Expected a fenced structure claim");
    return { credential, requestId: request.requestId, claimGeneration: request.claimGeneration, claimToken: request.claimToken };
  }

  it("withholds structural mutations from workers without fencing support", async () => {
    const t = setupTest();
    const fixture = await seedStructure(t);
    const before = await t.run(ctx => ctx.db.get(fixture.requestId));
    expect(await t.mutation(api.bridgeStructure.claim, { credential })).toEqual({ request: null, upgradeRequired: true });
    expect(await t.run(ctx => ctx.db.get(fixture.requestId))).toEqual(before);
    expect((await claimStructure(t)).claimGeneration).toBe(1);
  });

  it("parks Office locks until retry time and rotates the lease on retry", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const t = setupTest();
    const fixture = await seedStructure(t);
    const first = await claimStructure(t);
    const waiting = await t.mutation(api.bridgeStructure.complete, {
      ...first, outcome: "waiting", errorCode: "office-locked", errorMessage: "Close the file to retry.",
    });
    const retryAt = syncRetryAt(Date.now(), 1, "rename-receipt");
    expect(waiting).toEqual({ state: "pending", retryAt });
    expect(retryAt).toBeGreaterThan(Date.now());
    const parked = await t.run(ctx => ctx.db.get(fixture.requestId));
    expect(parked).toMatchObject({ state: "pending", retryAt, attemptCount: 1, errorCode: "office-locked" });
    expect(parked?.claimedAt).toBeUndefined();
    expect(await t.mutation(api.bridgeStructure.claim, { credential, supportsFencing: true })).toEqual({ request: null });
    // A delayed duplicate cannot clear backoff or change the queued outcome.
    expect(await t.mutation(api.bridgeStructure.complete, { ...first, outcome: "verified" }))
      .toMatchObject({ state: "pending", ignored: true });
    expect(await t.run(ctx => ctx.db.get(fixture.requestId))).toEqual(parked);
    clock.mockReturnValue(retryAt);
    const next = await claimStructure(t);
    expect(next.claimGeneration).toBe(first.claimGeneration + 1);
    expect(next.claimToken).not.toBe(first.claimToken);
    expect(await t.run(ctx => ctx.db.get(fixture.requestId))).toMatchObject({ state: "claimed", attemptCount: 2 });
  });

  it.each(["claim", "sweeper"] as const)("ignores every old receipt and refresh after %s redrive", async (redrive) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const t = setupTest();
    const fixture = await seedStructure(t);
    const first = await claimStructure(t);
    clock.mockReturnValue(Date.now() + BRIDGE_CLAIM_REDRIVE_MS + 1);
    if (redrive === "sweeper") {
      expect(await t.mutation(internal.bridgeSync.sweepStaleBridgeWork, {})).toEqual({ redriven: 1 });
      expect(await t.mutation(api.bridgeStructure.refreshClaim, first)).toEqual({ valid: false });
    }
    const current = await claimStructure(t);
    expect(current.claimGeneration).toBe(first.claimGeneration + 1);
    expect(current.claimToken).not.toBe(first.claimToken);
    const before = await t.run(ctx => ctx.db.get(fixture.requestId));
    for (const outcome of ["waiting", "failed", "conflicted", "verified"] as const) {
      expect(await t.mutation(api.bridgeStructure.complete, { ...first, outcome, actualRelativePath: "stale.docx" }))
        .toEqual({ state: "claimed", ignored: true, reason: "stale-claim" });
    }
    expect(await t.mutation(api.bridgeStructure.refreshClaim, first)).toEqual({ valid: false });
    expect(await t.run(ctx => ctx.db.get(fixture.requestId))).toEqual(before);
    expect(await t.mutation(api.bridgeStructure.refreshClaim, current)).toEqual({ valid: true });
    expect(await t.mutation(api.bridgeStructure.complete, { ...current, outcome: "verified", actualRelativePath: "renamed.docx" }))
      .toEqual({ state: "verified" });
    expect((await t.run(ctx => ctx.db.get(fixture.replicaId)))?.relativePath).toBe("renamed.docx");
  });

  it("refreshes the active lease so the sweeper leaves a delayed worker alone", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const t = setupTest();
    await seedStructure(t);
    const claim = await claimStructure(t);
    clock.mockReturnValue(Date.now() + BRIDGE_CLAIM_REDRIVE_MS - 1);
    expect(await t.mutation(api.bridgeStructure.refreshClaim, claim)).toEqual({ valid: true });
    clock.mockReturnValue(Date.now() + 2);
    expect(await t.mutation(internal.bridgeSync.sweepStaleBridgeWork, {})).toEqual({ redriven: 0 });
    expect(await t.mutation(api.bridgeStructure.claim, { credential, supportsFencing: true })).toEqual({ request: null });
  });

  it.each(["missing base", "changed base", "reassigned resource", "unavailable replica"])("rejects a queued structure request with %s", async (change) => {
    const t = setupTest();
    const fixture = await seedStructure(t);
    await t.run(async ctx => {
      if (change === "missing base") await ctx.db.patch(fixture.requestId, { baseRevision: undefined });
      if (change === "changed base") await ctx.db.patch(fixture.replicaId, { revision: "b".repeat(64) });
      if (change === "reassigned resource") await ctx.db.patch(fixture.replicaId, { localResourceId: "lr_1111111111111111" });
      if (change === "unavailable replica") await ctx.db.patch(fixture.replicaId, { state: "unavailable" });
    });
    expect(await t.mutation(api.bridgeStructure.claim, { credential, supportsFencing: true })).toEqual({ request: null });
    expect(await t.run(ctx => ctx.db.get(fixture.requestId))).toMatchObject({
      state: "conflicted", errorCode: change === "missing base" ? "structure-base-unavailable" : "stale-revision",
    });
  });

  it.each(["deleted work", "revoked permission", "detached mount", "changed base", "reassigned resource"])("rejects refresh and completion after %s", async (change) => {
    const t = setupTest();
    const fixture = await seedStructure(t);
    const claim = await claimStructure(t);
    await t.run(async ctx => {
      if (change === "deleted work") await ctx.db.patch(fixture.workId, { status: "deleted" });
      if (change === "revoked permission") {
        const ownerAccountId = await ctx.db.insert("accounts", {
          clerkId: "new-structure-owner", email: "other@example.test", emailVerified: true,
          name: "Other", status: "active", createdAt: Date.now(), updatedAt: Date.now(),
        });
        await ctx.db.patch(fixture.workId, { ownerAccountId });
      }
      if (change === "detached mount") await ctx.db.patch(fixture.mountId, { state: "detached" });
      if (change === "changed base") await ctx.db.patch(fixture.replicaId, { revision: "b".repeat(64) });
      if (change === "reassigned resource") await ctx.db.patch(fixture.replicaId, { localResourceId: "lr_1111111111111111" });
    });
    const before = await t.run(ctx => ctx.db.get(fixture.requestId));
    expect(await t.mutation(api.bridgeStructure.refreshClaim, claim)).toEqual({ valid: false });
    expect(await t.run(ctx => ctx.db.get(fixture.requestId))).toEqual(before);
    expect(await t.mutation(api.bridgeStructure.complete, { ...claim, outcome: "verified", actualRelativePath: "renamed.docx" }))
      .toEqual({ state: ["deleted work", "revoked permission"].includes(change) ? "failed" : "conflicted" });
    expect((await t.run(ctx => ctx.db.get(fixture.replicaId)))?.relativePath).toBe("candidate-0.docx");
  });

  it("allows an already claimed legacy operation to report its terminal result", async () => {
    const t = setupTest();
    const fixture = await seedStructure(t);
    await t.run(ctx => ctx.db.patch(fixture.requestId, { state: "claimed", baseRevision: undefined, claimedAt: Date.now() }));
    expect(await t.mutation(api.bridgeStructure.complete, { credential, requestId: fixture.requestId, outcome: "verified", actualRelativePath: "renamed.docx" }))
      .toEqual({ state: "verified" });
  });

  it.each(["pending", "ahead", "diverged"] as const)("preserves %s content state when a rename is verified", async (state) => {
    const t = setupTest();
    const fixture = await seedStructure(t);
    await t.run(ctx => ctx.db.patch(fixture.replicaId, { state, pendingContentHash: "b".repeat(64), pendingPayloadRef: "newer-payload" }));
    const claim = await claimStructure(t);
    await t.mutation(api.bridgeStructure.complete, { ...claim, outcome: "verified", actualRelativePath: "renamed.docx" });
    expect(await t.run(ctx => ctx.db.get(fixture.replicaId))).toMatchObject({
      relativePath: "renamed.docx", state, revision: "a".repeat(64), pendingContentHash: "b".repeat(64), pendingPayloadRef: "newer-payload",
    });
  });

  it("rejects an escaping actual path without consuming the current claim", async () => {
    const t = setupTest();
    const fixture = await seedStructure(t);
    const claim = await claimStructure(t);
    await expect(t.mutation(api.bridgeStructure.complete, { ...claim, outcome: "verified", actualRelativePath: "../outside.docx" })).rejects.toThrow();
    expect(await t.run(ctx => ctx.db.get(fixture.requestId))).toMatchObject({ state: "claimed" });
    expect((await t.run(ctx => ctx.db.get(fixture.replicaId)))?.relativePath).toBe("candidate-0.docx");
  });

  it("keeps a terminal receipt immutable after a newer replica move", async () => {
    const t = setupTest();
    const fixture = await seedStructure(t);
    const { request: claim } = await t.mutation(api.bridgeStructure.claim, { credential, supportsFencing: true });
    expect(claim?.requestId).toBe(fixture.requestId);
    await t.mutation(api.bridgeStructure.complete, {
      credential, requestId: fixture.requestId, outcome: "verified", actualRelativePath: "renamed.docx",
      claimGeneration: claim!.claimGeneration, claimToken: claim!.claimToken,
    });
    await t.run(ctx => ctx.db.patch(fixture.replicaId, { relativePath: "newer-move.docx" }));
    const before = await t.run(ctx => ctx.db.get(fixture.replicaId));
    expect(await t.mutation(api.bridgeStructure.complete, {
      credential, requestId: fixture.requestId, outcome: "failed", errorCode: "old-failure",
    })).toEqual({ state: "verified" });
    expect(await t.run(ctx => ctx.db.get(fixture.replicaId))).toEqual(before);
  });

  it("does not let a delayed first receipt roll back a newer move of the same bytes", async () => {
    const t = setupTest();
    const fixture = await seedStructure(t);
    const claim = await claimStructure(t);
    await t.run(ctx => ctx.db.patch(fixture.replicaId, { relativePath: "newer-move.docx" }));
    const before = await t.run(ctx => ctx.db.get(fixture.replicaId));
    expect(await t.mutation(api.bridgeStructure.complete, { ...claim, outcome: "verified", actualRelativePath: "renamed.docx" }))
      .toEqual({ state: "conflicted" });
    expect(await t.run(ctx => ctx.db.get(fixture.replicaId))).toEqual(before);
  });

  it("accepts a lost move receipt after discovery already observed its collision destination", async () => {
    const t = setupTest();
    const fixture = await seedStructure(t);
    const claim = await claimStructure(t);
    await t.run(ctx => ctx.db.patch(fixture.replicaId, { relativePath: "renamed (2).docx" }));
    expect(await t.mutation(api.bridgeStructure.complete, { ...claim, outcome: "verified", actualRelativePath: "renamed (2).docx" }))
      .toEqual({ state: "verified" });
  });

  it("captures the queued base and rejects a replica belonging to another work", async () => {
    const t = setupTest();
    const fixture = await seedStructure(t);
    const account = await t.run(ctx => ctx.db.get(fixture.accountId));
    const asUser = t.withIdentity({ subject: account!.clerkId, email: account!.email, emailVerified: true });
    const request = await asUser.mutation(api.bridgeStructure.request, {
      workId: fixture.workId, replicaId: fixture.replicaId, kind: "rename",
      sourceRelativePath: "candidate-0.docx", targetRelativePath: "new.docx", idempotencyKey: "new-intent",
    });
    expect(request?.baseRevision).toBe("a".repeat(64));
    const other = await seedUploadCandidates(t, fixture, 1);
    await expect(asUser.mutation(api.bridgeStructure.request, {
      workId: fixture.workId, replicaId: other.replicaIds[0], kind: "rename",
      sourceRelativePath: "candidate-0.docx", targetRelativePath: "new.docx", idempotencyKey: "wrong-replica",
    })).rejects.toThrow("LOCAL_REPLICA_REQUIRED");
  });

  it.each(["before claim", "before completion"])("rechecks artifact permission %s", async (phase) => {
    const t = setupTest();
    const fixture = await seedStructure(t);
    const claim = phase === "before completion"
      ? (await t.mutation(api.bridgeStructure.claim, { credential, supportsFencing: true })).request
      : null;
    await t.run(async ctx => {
      const ownerAccountId = await ctx.db.insert("accounts", {
        clerkId: "other-structure-owner", email: "other@example.test", emailVerified: true,
        name: "Other", status: "active", createdAt: Date.now(), updatedAt: Date.now(),
      });
      await ctx.db.patch(fixture.workId, { ownerAccountId });
    });
    if (phase === "before claim") {
      expect((await t.mutation(api.bridgeStructure.claim, { credential, supportsFencing: true })).request).toBeNull();
    } else {
      expect(await t.mutation(api.bridgeStructure.complete, {
        credential, requestId: fixture.requestId, outcome: "verified", actualRelativePath: "renamed.docx",
        claimGeneration: claim!.claimGeneration, claimToken: claim!.claimToken,
      })).toEqual({ state: "failed" });
    }
    expect(await t.run(ctx => ctx.db.get(fixture.requestId))).toMatchObject({ state: "failed", errorCode: "permission-revoked" });
    expect((await t.run(ctx => ctx.db.get(fixture.replicaId)))?.relativePath).toBe("candidate-0.docx");
  });
});

describe("Bridge write acknowledgement after native observation", () => {
  afterEach(() => vi.restoreAllMocks());

  async function seedWrite(observation: "upload" | "metadata", withReceipt = true) {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const hash = async (bytes: string) => Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bytes))),
      byte => byte.toString(16).padStart(2, "0"),
    ).join("");
    const baseHash = await hash("native base");
    const targetBytes = "native result";
    const targetHash = await hash(targetBytes);
    const resource = {
      localResourceId: "lr_eeeeeeeeeeeeeeee", relativePath: "Essay.docm",
      nativeFormat: "docm", size: targetBytes.length, contentHash: baseHash,
    };
    const { registrations } = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential, mountId: fixture.mountId, resources: [resource],
    });
    const registration = registrations[0];
    if (!("replicaId" in registration) || !registration.replicaId || !registration.workId)
      throw new Error("Expected a discovered replica");
    const { replicaId, workId } = registration;
    const projection = { type: "doc", content: [{ type: "paragraph", content: [] }] };
    const projectionHash = await hash(JSON.stringify(projection));
    const seeded = await t.run(async ctx => {
      const now = Date.now();
      const payloadId = await ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId, hash: targetHash,
        storageId: await ctx.storage.store(new Blob([targetBytes])), bytes: targetBytes.length,
        mediaType: "application/octet-stream", refCount: 1, state: "active", createdAt: now, verifiedAt: now,
      });
      const basePayloadId = await ctx.db.insert("payloadObjects", {
        accountId: fixture.accountId, hash: baseHash,
        storageId: await ctx.storage.store(new Blob(["native base"])), bytes: 11,
        mediaType: "application/octet-stream", refCount: 2, state: "active", createdAt: now, verifiedAt: now,
      });
      const cloudId = await ctx.db.insert("workReplicas", {
        accountId: fixture.accountId, workId, kind: "cloud", nativeFormat: "docm",
        payloadRef: String(basePayloadId), revision: baseHash, contentHash: baseHash,
        baseRevision: baseHash, state: "current", updatedAt: now,
      });
      await ctx.db.patch(replicaId, { revision: baseHash, contentHash: baseHash, baseRevision: baseHash, state: "pending" });
      if (observation === "metadata") await ctx.db.insert("syncPolicies", {
        accountId: fixture.accountId, scopeKind: "item", scopeId: String(workId),
        preset: "device", contentDirection: "local-to-spectra", discovery: "auto", structure: "independent",
        cloudContent: "metadata-only", includeGlobs: [], excludeGlobs: [], timing: "continuous",
        protectedOriginal: false, createdAt: now, updatedAt: now,
      });
      const nativeReceipt: NativeSaveReceipt = {
        kind: "native-office-save", format: "docx", artifactId: String(workId),
        operationId: nativeOperationId(String(workId), baseHash, targetHash),
        basePayloadHash: baseHash, resultPayloadHash: targetHash, baseRevision: baseHash, resultRevision: targetHash,
        targets: { regionIds: [], partNames: [] }, semantic: { resultDigest: projectionHash, readbackDigest: projectionHash },
        preservedPartNames: ["word/vbaProject.bin"], state: "pending",
      };
      const requestId = await ctx.db.insert("bridgeWriteRequests", {
        accountId: fixture.accountId, deviceId: fixture.deviceId, mountId: fixture.mountId,
        workId, replicaId, localResourceId: resource.localResourceId, relativePath: resource.relativePath,
        payloadRef: String(payloadId), baseRevision: baseHash, targetRevision: targetHash, contentHash: targetHash,
        projectionBaseContent: projection, projectionBaseContentHash: projectionHash, projectionBaseTextIndex: "result",
        idempotencyKey: "observed-native-write", nativeReceipt: withReceipt ? nativeReceipt : undefined,
        regionIds: [], partNames: [], state: "pending", expiresAt: now + 86_400_000,
        createdAt: now, updatedAt: now,
      });
      const operationId = await ctx.db.insert("syncOperations", {
        accountId: fixture.accountId, workId, replicaId, idempotencyKey: "observed-native-write",
        direction: "cloud-to-local", revisionBefore: baseHash, revisionAfter: targetHash,
        state: "pending", actorKind: "user", createdAt: now, updatedAt: now,
      });
      return { payloadId, cloudId, requestId, operationId };
    });
    const claim = async () => {
      const { request } = await t.mutation(api.bridgeSync.claimWrite, { credential });
      if (!request) throw new Error("Expected write claim");
      return { credential, requestId: request.requestId, claimGeneration: request.claimGeneration, claimToken: request.claimToken };
    };
    const firstClaim = await claim();
    const observe = async () => {
      await t.mutation(api.bridgeSync.discoverResourcesPage, {
        credential, mountId: fixture.mountId, resources: [{ ...resource, contentHash: targetHash }],
      });
      if (observation === "upload") await t.mutation(api.bridgeSync.commitPayloadUpload, {
        credential, replicaId, hash: targetHash, bytes: targetBytes.length,
        mediaType: "application/octet-stream", payloadRef: String(seeded.payloadId),
      });
    };
    return { t, ...fixture, ...seeded, replicaId, workId, projection, projectionHash, baseHash, targetHash, firstClaim, claim, observe };
  }

  it.each(["upload", "metadata"] as const)("accepts a lost receipt after %s observed its exact native result", async observation => {
    const f = await seedWrite(observation);
    await f.observe();
    expect((await f.t.run(ctx => ctx.db.get(f.replicaId)))?.revision).toBe(f.targetHash);
    expect(await f.t.mutation(api.bridgeSync.completeWrite, {
      ...f.firstClaim, outcome: "verified", actualRevision: f.targetHash,
    })).toEqual({ state: "verified" });
    const after = await f.t.run(async ctx => ({
      local: await ctx.db.get(f.replicaId), request: await ctx.db.get(f.requestId), operation: await ctx.db.get(f.operationId),
    }));
    expect(after.local).toMatchObject({
      revision: f.targetHash, projectionBaseRevision: f.targetHash, projectionBaseContent: f.projection,
      projectionBaseContentHash: f.projectionHash,
      relativePath: "Essay.docm", nativeFormat: "docm", state: "current",
    });
    expect(after.request?.nativeReceipt).toMatchObject({ basePayloadHash: f.baseHash, state: "applied", preservedPartNames: ["word/vbaProject.bin"] });
    expect(after.operation?.state).toBe("verified");
    await f.t.mutation(api.bridgeSync.completeWrite, { ...f.firstClaim, outcome: "waiting", errorCode: "office-locked" });
    expect(await f.t.run(ctx => ctx.db.get(f.replicaId))).toEqual(after.local);
  });

  it("recovers a legacy write without an Office receipt after its upload echo", async () => {
    const f = await seedWrite("upload", false);
    await f.observe();
    expect(await f.t.mutation(api.bridgeSync.completeWrite, {
      ...f.firstClaim, outcome: "verified", actualRevision: f.targetHash,
    })).toEqual({ state: "verified" });
  });

  it("redrives a lost native receipt after observation while rejecting the expired claim", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const f = await seedWrite("upload");
    await f.observe();
    clock.mockReturnValue(Date.now() + BRIDGE_CLAIM_REDRIVE_MS + 1);
    const recovered = await f.claim();
    expect(recovered.claimGeneration).toBe(f.firstClaim.claimGeneration + 1);
    expect(await f.t.mutation(api.bridgeSync.refreshWriteClaim, recovered)).toEqual({ valid: true });
    expect(await f.t.mutation(api.bridgeSync.refreshWriteClaim, f.firstClaim)).toEqual({ valid: false });
    for (const outcome of ["verified", "waiting", "failed", "conflicted"] as const) {
      expect(await f.t.mutation(api.bridgeSync.completeWrite, { ...f.firstClaim, outcome, actualRevision: f.targetHash }))
        .toMatchObject({ ignored: true, reason: "stale-claim" });
    }
    expect(await f.t.mutation(api.bridgeSync.completeWrite, { ...recovered, outcome: "verified", actualRevision: f.targetHash }))
      .toEqual({ state: "verified" });
  });

  it.each(["newer-native", "wrong-hash", "unavailable-payload", "wrong-payload"] as const)(
    "does not treat %s as a recoverable native result", async reason => {
      const f = await seedWrite("upload");
      await f.observe();
      await f.t.run(async ctx => {
        if (reason === "newer-native") await ctx.db.patch(f.replicaId, { revision: "c".repeat(64), contentHash: "c".repeat(64) });
        if (reason === "wrong-hash") await ctx.db.patch(f.replicaId, { contentHash: "c".repeat(64) });
        if (reason === "unavailable-payload") await ctx.db.patch(f.payloadId, { state: "quarantined" });
        if (reason === "wrong-payload") await ctx.db.patch(f.payloadId, { hash: "c".repeat(64) });
      });
      const before = await f.t.run(async ctx => ({ local: await ctx.db.get(f.replicaId), cloud: await ctx.db.get(f.cloudId) }));
      expect(await f.t.mutation(api.bridgeSync.refreshWriteClaim, f.firstClaim)).toEqual({ valid: false });
      expect(await f.t.mutation(api.bridgeSync.completeWrite, {
        ...f.firstClaim, outcome: "verified", actualRevision: f.targetHash,
      })).toMatchObject({ state: "failed", ignored: true, reason: "superseded-by-newer-write" });
      expect(await f.t.run(async ctx => ({ local: await ctx.db.get(f.replicaId), cloud: await ctx.db.get(f.cloudId) }))).toEqual(before);
    },
  );

  it("rejects a receipt rebased to the observed result instead of its queued base", async () => {
    const f = await seedWrite("upload");
    await f.observe();
    await f.t.run(async ctx => {
      const request = await ctx.db.get(f.requestId);
      await ctx.db.patch(f.requestId, { nativeReceipt: { ...(request!.nativeReceipt as NativeSaveReceipt), basePayloadHash: f.targetHash } });
    });
    const before = await f.t.run(ctx => ctx.db.get(f.replicaId));
    expect(await f.t.mutation(api.bridgeSync.completeWrite, {
      ...f.firstClaim, outcome: "verified", actualRevision: f.targetHash,
    })).toMatchObject({ state: "failed", errorCode: "NATIVE_RECEIPT_BASE_MISMATCH" });
    expect(await f.t.run(ctx => ctx.db.get(f.replicaId))).toEqual(before);
  });

  it("preserves a different cloud head when an old native acknowledgement arrives", async () => {
    const f = await seedWrite("upload");
    await f.observe();
    await f.t.run(ctx => ctx.db.patch(f.cloudId, {
      revision: "c".repeat(64), contentHash: "c".repeat(64), state: "ahead",
      projectionBaseContent: { newer: "cloud edit" },
    }));
    const before = await f.t.run(async ctx => ({ local: await ctx.db.get(f.replicaId), cloud: await ctx.db.get(f.cloudId) }));
    expect(await f.t.mutation(api.bridgeSync.completeWrite, {
      ...f.firstClaim, outcome: "verified", actualRevision: f.targetHash,
    })).toMatchObject({ state: "failed", ignored: true, reason: "superseded-by-newer-write" });
    expect(await f.t.run(async ctx => ({ local: await ctx.db.get(f.replicaId), cloud: await ctx.db.get(f.cloudId) }))).toEqual(before);
  });

  it("rechecks permission after the native result was observed", async () => {
    const f = await seedWrite("upload");
    await f.observe();
    await f.t.run(async ctx => {
      const accountId = await ctx.db.insert("accounts", {
        clerkId: "reassigned-native-owner", email: "reassigned@example.test", emailVerified: true,
        name: "Reassigned", status: "active", createdAt: Date.now(), updatedAt: Date.now(),
      });
      await ctx.db.patch(f.workId, { ownerAccountId: accountId });
    });
    expect(await f.t.mutation(api.bridgeSync.refreshWriteClaim, f.firstClaim)).toEqual({ valid: false });
    expect(await f.t.mutation(api.bridgeSync.completeWrite, {
      ...f.firstClaim, outcome: "verified", actualRevision: f.targetHash,
    })).toEqual({ state: "failed" });
    expect(await f.t.run(ctx => ctx.db.get(f.requestId))).toMatchObject({ errorCode: "permission-revoked" });
  });
});

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

async function seedBridge(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Bridge Batch School",
      slug: `bridge-batch-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: `clerk_bridge_batch_${crypto.randomUUID()}`,
      email: "bridge-batch@example.test",
      emailVerified: true,
      name: "Bridge Batch",
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
    const credentialHash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const deviceId = await ctx.db.insert("bridgeDevices", {
      accountId,
      name: "Batch Bridge",
      platform: "windows",
      credentialHash,
      protocolVersion: "1",
      appVersion: "1",
      pairedAt: now,
      lastSeenAt: now,
      state: "active",
    });
    const rootOrgNodeId = await ctx.db.insert("orgNodes", {
      accountId,
      schoolId,
      parentId: null,
      kind: "folder",
      name: "Mounted",
      orderKey: "a",
      createdAt: now,
      updatedAt: now,
    });
    const mountId = await ctx.db.insert("bridgeMounts", {
      accountId,
      deviceId,
      rootLabel: "Mounted",
      grantId: "grant_deadbeef",
      rootKey: "a".repeat(64),
      rootOrgNodeId,
      state: "active",
      fileCount: 2,
      doubleSyncRisk: false,
      lastScanId: crypto.randomUUID(),
      lastScanAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, schoolId, deviceId, mountId };
  });
}

async function seedDeletedWrite(t: ReturnType<typeof convexTest>, state: "pending" | "claimed") {
  const fixture = await seedBridge(t);
  const discovery = await t.mutation(api.bridgeSync.discoverResourcesPage, {
    credential,
    mountId: fixture.mountId,
    resources: [{
      localResourceId: `lr_${state === "pending" ? "f".repeat(16) : "e".repeat(16)}`,
      relativePath: "Deleted/Essay.docx",
      size: 42,
      contentHash: "a".repeat(64),
      nativeFormat: "docx",
    }],
  });
  const registration = discovery.registrations[0];
  if (!("replicaId" in registration) || !registration.replicaId) throw new Error("Expected a discovered replica");
  const replicaId: Id<"workReplicas"> = registration.replicaId;
  const seeded = await t.run(async (ctx) => {
    const replica = await ctx.db.get(replicaId);
    if (!replica) throw new Error("Expected replica row");
    const now = Date.now();
    const idempotencyKey = `deleted-work-${state}-${crypto.randomUUID()}`;
    await ctx.db.patch(replica._id, {
      state: "pending",
      payloadRef: "payload-orphan",
      pendingPayloadRef: "payload-pending",
      projectionBasePayloadRef: "payload-base",
      updatedAt: now,
    });
    const operationId = await ctx.db.insert("syncOperations", {
      accountId: fixture.accountId,
      workId: replica.workId,
      replicaId: replica._id,
      idempotencyKey,
      direction: "cloud-to-local",
      actorKind: "reconciliation",
      state: "pending",
      createdAt: now,
      updatedAt: now,
    });
    const requestId = await ctx.db.insert("bridgeWriteRequests", {
      accountId: fixture.accountId,
      workId: replica.workId,
      replicaId: replica._id,
      deviceId: fixture.deviceId,
      mountId: fixture.mountId,
      localResourceId: replica.localResourceId ?? "lr_deleted-work",
      relativePath: replica.relativePath ?? "Deleted/Essay.docx",
      payloadRef: "payload-orphan",
      baseRevision: "a".repeat(64),
      targetRevision: "b".repeat(64),
      contentHash: "b".repeat(64),
      idempotencyKey,
      regionIds: [],
      partNames: [],
      state,
      ...(state === "claimed" ? { claimedAt: now, attemptCount: 1 } : { retryAt: now - 1 }),
      expiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.delete(replica.workId);
    return { operationId, requestId, replicaId: replica._id };
  });
  return { fixture, ...seeded };
}

async function seedOfficeLockedWrite(
  t: ReturnType<typeof convexTest>,
  fixture: Awaited<ReturnType<typeof seedBridge>>,
  workId: Id<"spectraArtifacts">,
  replicaId: Id<"workReplicas">,
  state: "pending" | "claimed" = "pending",
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const retryAt = now + 60_000;
    const idempotencyKey = `office-locked-${state}-${crypto.randomUUID()}`;
    const baseRevision = "a".repeat(64);
    const targetRevision = "b".repeat(64);
    await ctx.db.patch(replicaId, {
      state: "pending",
      retryAt: state === "pending" ? retryAt : undefined,
      errorCode: "office-locked",
      errorMessage: "Waiting for Office to finish saving",
      errorAt: now,
      updatedAt: now,
    });
    const operationId = await ctx.db.insert("syncOperations", {
      accountId: fixture.accountId,
      workId,
      replicaId,
      idempotencyKey,
      direction: "cloud-to-local",
      revisionBefore: baseRevision,
      revisionAfter: targetRevision,
      state: "pending",
      actorKind: "user",
      errorCode: "office-locked",
      createdAt: now,
      updatedAt: now,
    });
    const requestId = await ctx.db.insert("bridgeWriteRequests", {
      accountId: fixture.accountId,
      workId,
      replicaId,
      deviceId: fixture.deviceId,
      mountId: fixture.mountId,
      localResourceId: "lr_eeeeeeeeeeeeeeee",
      relativePath: "Essay.docx",
      payloadRef: "office-locked-payload",
      baseRevision,
      targetRevision,
      contentHash: targetRevision,
      idempotencyKey,
      regionIds: [],
      partNames: [],
      state,
      ...(state === "pending"
        ? { retryAt, attemptCount: 7, errorCode: "office-locked" }
        : { claimedAt: now - 1_000, attemptCount: 7, claimGeneration: 1, claimToken: "office-locked-claim" }),
      expiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    return { requestId, operationId, claimedAt: state === "claimed" ? now - 1_000 : undefined };
  });
}

describe("Bridge incremental cloud seam", () => {
  it("fails pending native writes after the work is deleted and releases replica payload refs", async () => {
    const t = setupTest();
    const seeded = await seedDeletedWrite(t, "pending");

    const result = await t.mutation(api.bridgeSync.claimWrite, { credential });
    expect(result).toEqual({ request: null });
    const state = await t.run(async (ctx) => ({
      request: await ctx.db.get(seeded.requestId),
      operation: await ctx.db.get(seeded.operationId),
      replica: await ctx.db.get(seeded.replicaId),
    }));
    const replica = state.replica as Doc<"workReplicas"> | null;
    expect(state.request).toMatchObject({ state: "failed", errorCode: "work-no-longer-exists" });
    expect(state.operation).toMatchObject({ state: "failed", errorCode: "work-no-longer-exists" });
    expect(state.replica).toMatchObject({
      state: "unavailable",
      unavailableReason: "work-no-longer-exists",
      errorCode: "work-no-longer-exists",
    });
    expect(replica?.payloadRef).toBeUndefined();
    expect(replica?.pendingPayloadRef).toBeUndefined();
    expect(replica?.projectionBasePayloadRef).toBeUndefined();
  });

  it("fails an in-flight native write completion after the work is deleted", async () => {
    const t = setupTest();
    const seeded = await seedDeletedWrite(t, "claimed");

    const result = await t.mutation(api.bridgeSync.completeWrite, {
      credential,
      requestId: seeded.requestId,
      outcome: "waiting",
    });
    expect(result).toEqual({ state: "failed" });
    const state = await t.run(async (ctx) => ({
      request: await ctx.db.get(seeded.requestId),
      operation: await ctx.db.get(seeded.operationId),
      replica: await ctx.db.get(seeded.replicaId),
    }));
    const replica = state.replica as Doc<"workReplicas"> | null;
    expect(state.request).toMatchObject({ state: "failed", errorCode: "work-no-longer-exists" });
    expect(state.operation).toMatchObject({ state: "failed", errorCode: "work-no-longer-exists" });
    expect(state.replica).toMatchObject({ state: "unavailable", unavailableReason: "work-no-longer-exists" });
    expect(replica?.payloadRef).toBeUndefined();
  });

  it("does not claim a pending native structure operation after the work is deleted", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const discovery = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [{
        localResourceId: `lr_${"d".repeat(16)}`,
        relativePath: "Deleted/Essay.docx",
        size: 42,
        contentHash: "a".repeat(64),
        nativeFormat: "docx",
      }],
    });
    const registration = discovery.registrations[0];
    if (!("replicaId" in registration) || !registration.replicaId) throw new Error("Expected a discovered replica");
    const replicaId: Id<"workReplicas"> = registration.replicaId;
    const seeded = await t.run(async (ctx) => {
      const replica = await ctx.db.get(replicaId);
      if (!replica) throw new Error("Expected replica row");
      const now = Date.now();
      const requestId = await ctx.db.insert("bridgeFsRequests", {
        accountId: fixture.accountId,
        workId: replica.workId,
        replicaId: replica._id,
        deviceId: fixture.deviceId,
        mountId: fixture.mountId,
        localResourceId: replica.localResourceId ?? `lr_${"d".repeat(16)}`,
        direction: "spectra-to-disk",
        kind: "delete",
        sourceRelativePath: "Deleted/Essay.docx",
        idempotencyKey: `structure-deleted-${crypto.randomUUID()}`,
        state: "pending",
        explanation: "Delete the file after deleting the work.",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.delete(replica.workId);
      return { requestId, replicaId: replica._id };
    });

    const result = await t.mutation(api.bridgeStructure.claim, { credential, supportsFencing: true });
    expect(result).toEqual({ request: null });
    const state = await t.run(async (ctx) => ({
      request: await ctx.db.get(seeded.requestId),
      replica: await ctx.db.get(seeded.replicaId),
    }));
    expect(state.request).toMatchObject({ state: "failed", errorCode: "work-no-longer-exists" });
    expect(state.replica).toMatchObject({ state: "unavailable", unavailableReason: "work-no-longer-exists" });
  });

  it("isolates a malformed discovery entry while registering the rest of the page", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const result = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [
        {
          localResourceId: "lr_aaaaaaaaaaaaaaaa",
          relativePath: "Reports/Essay.docx",
          size: 42,
          contentHash: "a".repeat(64),
          nativeFormat: "docx",
        },
        {
          localResourceId: "not-a-stable-id",
          relativePath: "Reports/Broken.docx",
          size: 1,
          contentHash: "b".repeat(64),
          nativeFormat: "docx",
        },
      ],
    });

    expect(result.registrations).toHaveLength(2);
    expect(result.registrations[0]).toMatchObject({ needsPayload: true });
    expect(result.registrations[1]).toMatchObject({ skipped: true });
    const truth = await t.run(async (ctx) => ({
      works: await ctx.db.query("spectraArtifacts").collect(),
      replicas: await ctx.db.query("workReplicas").collect(),
    }));
    expect(truth.works).toHaveLength(1);
    expect(truth.replicas).toHaveLength(1);
  });

  it("preserves one work identity through rename and reports disappearance as unavailable", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const discovery = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [{
        localResourceId: "lr_bbbbbbbbbbbbbbbb",
        relativePath: "Before/Essay.docx",
        size: 42,
        contentHash: "a".repeat(64),
        nativeFormat: "docx",
      }],
    });
    const originalRegistration = discovery.registrations[0];
    if (!("replicaId" in originalRegistration)) {
      throw new Error(`Expected resource registration, got ${originalRegistration.reason}`);
    }
    const originalReplicaId = originalRegistration.replicaId;

    const renameChange = {
      journalId: `op_${"1".repeat(32)}`,
      resourceId: "lr_bbbbbbbbbbbbbbbb",
      op: "upsert" as const,
      relativePath: "After/Essay.docx",
      previousRelativePath: "Before/Essay.docx",
      hash: "b".repeat(64),
      revisionBefore: "a".repeat(64),
      size: 43,
      nativeFormat: "docx",
    };
    const renamed = await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [renameChange],
    });
    expect(renamed.results[0]).toMatchObject({
      state: "payload-required",
      replicaId: String(originalReplicaId),
      needsPayload: true,
    });
    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [renameChange],
    });

    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"2".repeat(32)}`,
        resourceId: "lr_bbbbbbbbbbbbbbbb",
        op: "unavailable",
        relativePath: "After/Essay.docx",
      }],
    });
    const truth = await t.run(async (ctx) => ({
      works: await ctx.db.query("spectraArtifacts").collect(),
      replicas: await ctx.db.query("workReplicas").collect(),
    }));
    expect(truth.works).toHaveLength(1);
    expect(truth.works[0].status).toBe("active");
    expect(truth.replicas).toHaveLength(1);
    expect(truth.replicas[0]).toMatchObject({
      _id: originalReplicaId,
      relativePath: "After/Essay.docx",
      state: "unavailable",
      unavailableReason: "missing-on-disk",
    });

    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"3".repeat(32)}`,
        resourceId: "lr_cccccccccccccccc",
        op: "upsert",
        relativePath: "After/Essay.docx",
        hash: "c".repeat(64),
        size: 44,
        nativeFormat: "docx",
      }],
    });
    const recreated = await t.run(async (ctx) => ({
      works: await ctx.db.query("spectraArtifacts").collect(),
      replicas: await ctx.db.query("workReplicas").collect(),
    }));
    expect(recreated.works).toHaveLength(2);
    expect(recreated.replicas).toHaveLength(2);
    expect(recreated.replicas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _id: originalReplicaId,
        localResourceId: "lr_bbbbbbbbbbbbbbbb",
        state: "unavailable",
      }),
      expect.objectContaining({
        localResourceId: "lr_cccccccccccccccc",
        relativePath: "After/Essay.docx",
      }),
    ]));
  });

  it("records a writer lock without claiming the file is up to date", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const discovered = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [{
        localResourceId: "lr_dddddddddddddddd",
        relativePath: "Essay.docx",
        size: 42,
        contentHash: "a".repeat(64),
        nativeFormat: "docx",
      }],
    });
    const registration = discovered.registrations[0];
    if (!("replicaId" in registration) || !registration.replicaId) {
      throw new Error(`Expected resource registration, got ${"reason" in registration ? registration.reason : "unknown"}`);
    }
    const replicaId = registration.replicaId;
    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"4".repeat(32)}`,
        resourceId: "lr_dddddddddddddddd",
        op: "locked",
      }],
    });
    const locked = await t.run(async (ctx) => ctx.db.get(replicaId));
    expect(locked).toMatchObject({ errorCode: "office-locked" });
    expect(locked?.state).not.toBe("error");
    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"5".repeat(32)}`,
        resourceId: "lr_dddddddddddddddd",
        op: "upsert",
        relativePath: "Essay.docx",
        hash: "b".repeat(64),
        size: 44,
        nativeFormat: "docx",
      }],
    });
    const verified = await t.run(async (ctx) => ctx.db.get(replicaId));
    expect(verified?.errorCode).toBeUndefined();
  });

  it("clears a writer lock when Word finishes without a new revision", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const discovered = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [{
        localResourceId: "lr_eeeeeeeeeeeeeeee",
        relativePath: "Essay.docx",
        size: 42,
        contentHash: "a".repeat(64),
        nativeFormat: "docx",
      }],
    });
    const registration = discovered.registrations[0];
    if (!("replicaId" in registration) || !registration.replicaId || !registration.workId) {
      throw new Error(`Expected resource registration, got ${"reason" in registration ? registration.reason : "unknown"}`);
    }
    const replicaId = registration.replicaId;
    const write = await seedOfficeLockedWrite(t, fixture, registration.workId, replicaId);
    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"6".repeat(32)}`,
        resourceId: "lr_eeeeeeeeeeeeeeee",
        op: "locked",
      }],
    });
    const unlockObservedAt = Date.now();
    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"7".repeat(32)}`,
        resourceId: "lr_eeeeeeeeeeeeeeee",
        op: "unlocked",
      }],
    });
    const released = await t.run(async (ctx) => ctx.db.get(replicaId));
    expect(released?.errorCode).toBeUndefined();
    expect(released?.state).not.toBe("error");
    const requeued = await t.run(async (ctx) => ({
      request: await ctx.db.get(write.requestId),
      operation: await ctx.db.get(write.operationId),
    }));
    const measuredAt = Date.now();
    expect(requeued.request?.state).toBe("pending");
    expect(requeued.request?.errorCode).toBeUndefined();
    expect(requeued.request?.errorMessage).toBeUndefined();
    expect(requeued.request?.retryAt).toBeGreaterThanOrEqual(unlockObservedAt + 800);
    expect(requeued.request?.retryAt).toBeLessThanOrEqual(measuredAt + 1_200);
    expect(requeued.operation?.state).toBe("pending");
    expect(requeued.operation?.errorCode).toBeUndefined();
    const firstRetryAt = requeued.request?.retryAt;
    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"8".repeat(32)}`,
        resourceId: "lr_eeeeeeeeeeeeeeee",
        op: "unlocked",
      }],
    });
    const duplicateUnlock = await t.run(async (ctx) => ctx.db.get(write.requestId));
    expect(duplicateUnlock?.retryAt).toBe(firstRetryAt);
  });

  it("uses the short retry window when Office unlock races with a claimed write acknowledgement", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const discovered = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [{
        localResourceId: "lr_ffffffffffffffff",
        relativePath: "Essay.docx",
        size: 42,
        contentHash: "a".repeat(64),
        nativeFormat: "docx",
      }],
    });
    const registration = discovered.registrations[0];
    if (!("replicaId" in registration) || !registration.replicaId || !registration.workId)
      throw new Error("Expected a discovered replica");
    const write = await seedOfficeLockedWrite(t, fixture, registration.workId, registration.replicaId, "claimed");
    await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"9".repeat(32)}`,
        resourceId: "lr_ffffffffffffffff",
        op: "unlocked",
      }],
    });
    const unlockedClaim = await t.run(async (ctx) => ctx.db.get(write.requestId));
    expect(unlockedClaim?.officeUnlockedAt).toBeGreaterThan(write.claimedAt ?? 0);

    await t.mutation(api.bridgeSync.completeWrite, {
      credential,
      requestId: write.requestId,
      outcome: "waiting",
      claimGeneration: 1,
      claimToken: "office-locked-claim",
      errorCode: "office-locked",
    });
    const state = await t.run(async (ctx) => ({
      request: await ctx.db.get(write.requestId),
      operation: await ctx.db.get(write.operationId),
      replica: await ctx.db.get(registration.replicaId!),
    }));
    const measuredAt = Date.now();
    expect(state.request?.state).toBe("pending");
    expect(state.request?.errorCode).toBeUndefined();
    expect(state.request?.officeUnlockedAt).toBeUndefined();
    expect(state.request?.retryAt).toBeGreaterThanOrEqual(measuredAt - 100);
    expect(state.request?.retryAt).toBeLessThanOrEqual(measuredAt + 1_200);
    expect(state.operation?.state).toBe("pending");
    expect(state.operation?.errorCode).toBeUndefined();
    expect(state.replica?.state).toBe("pending");
    expect(state.replica?.errorCode).toBeUndefined();
    expect(state.replica?.errorMessage).toBeUndefined();
  });

  it("clears a stale Office lock from the operation when the native write verifies", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const discovered = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [{
        localResourceId: "lr_aaaaaaaaaaaaaaaa",
        relativePath: "Essay.docx",
        size: 42,
        contentHash: "a".repeat(64),
        nativeFormat: "docx",
      }],
    });
    const registration = discovered.registrations[0];
    if (!("replicaId" in registration) || !registration.replicaId || !registration.workId)
      throw new Error("Expected a discovered replica");
    const write = await seedOfficeLockedWrite(t, fixture, registration.workId, registration.replicaId, "claimed");

    const result = await t.mutation(api.bridgeSync.completeWrite, {
      credential,
      requestId: write.requestId,
      outcome: "verified",
      actualRevision: "b".repeat(64),
      claimGeneration: 1,
      claimToken: "office-locked-claim",
    });

    expect(result).toEqual({ state: "verified" });
    const operation = await t.run(async (ctx) => ctx.db.get(write.operationId));
    expect(operation?.state).toBe("verified");
    expect(operation?.errorCode).toBeUndefined();
  });

  it("verifies a watcher echo when the native write already converged cloud and disk", async () => {
    const t = setupTest();
    const fixture = await seedBridge(t);
    const hash = "a".repeat(64);
    const discovered = await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [{
        localResourceId: "lr_eeeeeeeeeeeeeeee",
        relativePath: "Essay.docx",
        size: 42,
        contentHash: hash,
        nativeFormat: "docx",
      }],
    });
    const registration = discovered.registrations[0];
    if (!("replicaId" in registration) || !registration.replicaId || !registration.workId)
      throw new Error("Expected a discovered replica");

    await t.run(async (ctx) => {
      const now = Date.now();
      const local = await ctx.db.get(registration.replicaId!);
      if (!local) throw new Error("Expected local replica");
      await ctx.db.patch(local._id, {
        payloadRef: "local-payload",
        state: "current",
        revision: hash,
        contentHash: hash,
        lastVerifiedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("workReplicas", {
        accountId: fixture.accountId,
        workId: registration.workId!,
        kind: "cloud",
        nativeFormat: "docx",
        payloadRef: "cloud-payload",
        revision: hash,
        baseRevision: hash,
        contentHash: hash,
        state: "current",
        lastVerifiedAt: now,
        updatedAt: now,
      });
    });

    const result = await t.mutation(api.bridgeSync.reportChanges, {
      credential,
      mountId: fixture.mountId,
      changes: [{
        journalId: `op_${"8".repeat(32)}`,
        resourceId: "lr_eeeeeeeeeeeeeeee",
        op: "upsert",
        relativePath: "Essay.docx",
        hash,
        revisionBefore: "b".repeat(64),
        size: 42,
        nativeFormat: "docx",
      }],
    });
    expect(result.results[0]).toMatchObject({ state: "applied", needsPayload: false });

    const operations = await t.run(async (ctx) =>
      ctx.db.query("syncOperations").collect(),
    );
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        direction: "external",
        revisionBefore: "b".repeat(64),
        revisionAfter: hash,
        actorKind: "external-edit",
        state: "verified",
      }),
    ]));

    const lateOperationId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("syncOperations", {
        accountId: fixture.accountId,
        workId: registration.workId!,
        replicaId: registration.replicaId!,
        idempotencyKey: `late-watcher-echo-${crypto.randomUUID()}`,
        direction: "external",
        revisionBefore: "c".repeat(64),
        revisionAfter: hash,
        state: "applied",
        actorKind: "external-edit",
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(api.bridgeSync.discoverResourcesPage, {
      credential,
      mountId: fixture.mountId,
      resources: [{
        localResourceId: "lr_eeeeeeeeeeeeeeee",
        relativePath: "Essay.docx",
        size: 42,
        contentHash: hash,
        nativeFormat: "docx",
      }],
    });
    expect(await t.run(async (ctx) => ctx.db.get(lateOperationId))).toMatchObject({
      state: "verified",
    });
  });
});
