/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const credential = "bridge-batch-test-credential-00000001";

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
    return { accountId, deviceId, mountId };
  });
}

describe("Bridge incremental cloud seam", () => {
  it("isolates a malformed discovery entry while registering the rest of the page", async () => {
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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
    if (!("replicaId" in registration)) {
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
});
