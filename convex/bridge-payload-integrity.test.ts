/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const credential = "security-bridge-fixture-credential-0001";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Security fixture", slug: "security-bridge", verifiedDomains: [],
      status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: "security-bridge", email: "security@example.test", emailVerified: true,
      name: "Security fixture", status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      schoolId, accountId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const deviceId = await ctx.db.insert("bridgeDevices", {
      accountId, name: "Fixture Bridge", platform: "windows", credentialHash: sha256(credential),
      protocolVersion: "1.0", appVersion: "1.0", pairedAt: now, lastSeenAt: now, state: "active",
    });
    const workId = await ctx.db.insert("spectraArtifacts", {
      schoolId, ownerAccountId: accountId, blueprintKey: "resource", title: "Fixture.bin",
      nativeFormat: "bin", content: null, tags: [], status: "active", createdAt: now, updatedAt: now,
    });
    const replicaId = await ctx.db.insert("workReplicas", {
      accountId, deviceId, workId, kind: "local", nativeFormat: "bin", revision: "discovered", state: "ahead", updatedAt: now,
    });
    return { accountId, deviceId, workId, replicaId };
  });
  const bytes = "genuine fixture bytes";
  const storageId = await t.run(ctx => ctx.storage.store(new Blob([bytes])));
  const args = { credential, replicaId: ids.replicaId, hash: sha256(bytes), bytes: Buffer.byteLength(bytes), mediaType: "application/octet-stream" };
  const actor = t.withIdentity({ subject: "security-bridge", email: "security@example.test", emailVerified: true });
  return { t, ids, bytes, storageId, args, actor };
}

async function poisonedSlot(f: Awaited<ReturnType<typeof fixture>>) {
  const corruptStorage = await f.t.run(ctx => ctx.storage.store(new Blob(["x".repeat(f.args.bytes)])));
  return f.t.run(ctx => ctx.db.insert("payloadObjects", {
    accountId: f.ids.accountId, storageId: corruptStorage, hash: f.args.hash, bytes: f.args.bytes,
    mediaType: f.args.mediaType, refCount: 0, state: "active", createdAt: Date.now(), verifiedAt: Date.now(),
  }));
}

describe("Bridge payload security", () => {
  it("rejects a same-size forged digest without advancing replicas or creating receipts", async () => {
    const { t, args, ids, storageId } = await fixture();
    await expect(t.mutation(api.bridgeSync.commitPayloadUpload, { ...args, storageId, hash: "0".repeat(64) }))
      .rejects.toThrow("PAYLOAD_HASH_MISMATCH");
    expect(await t.run(ctx => ctx.db.query("payloadObjects").collect())).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("syncOperations").collect())).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.get(ids.replicaId))).toMatchObject({ revision: "discovered", state: "ahead" });
    expect(await t.run(ctx => ctx.db.system.get(storageId))).not.toBeNull();
  });

  it("rejects a poisoned existing hash slot before issuing a deduplicated begin result", async () => {
    const f = await fixture();
    await poisonedSlot(f);
    await expect(f.t.mutation(api.bridgeSync.beginPayloadUpload, f.args)).rejects.toThrow("PAYLOAD_HASH_MISMATCH");
  });

  it.each([false, true])("rejects poisoned dedup on commit (new upload: %s)", async withUpload => {
    const f = await fixture();
    const payloadRef = await poisonedSlot(f);
    await expect(f.t.mutation(api.bridgeSync.commitPayloadUpload, {
      ...f.args, payloadRef, ...(withUpload ? { storageId: f.storageId } : {}),
    })).rejects.toThrow("PAYLOAD_HASH_MISMATCH");
    expect(await f.t.run(ctx => ctx.db.query("syncOperations").collect())).toHaveLength(0);
    expect(await f.t.run(ctx => ctx.db.system.get(f.storageId))).not.toBeNull();
  });

  it("adopts genuine bytes, deduplicates retries, and preserves an independent redundant upload", async () => {
    const { t, args, storageId, bytes, ids } = await fixture();
    await t.run(ctx => ctx.db.patch(ids.replicaId, { baseRevision: args.hash }));
    const first = await t.mutation(api.bridgeSync.commitPayloadUpload, { ...args, storageId });
    expect(await t.mutation(api.bridgeSync.beginPayloadUpload, args)).toEqual({ deduplicated: true, payloadRef: first.payloadRef });
    expect(await t.mutation(api.bridgeSync.commitPayloadUpload, { ...args, payloadRef: first.payloadRef })).toEqual(first);
    expect(await t.mutation(api.bridgeSync.commitPayloadUpload, { ...args, storageId })).toEqual(first);
    const independentUpload = await t.run(ctx => ctx.storage.store(new Blob([bytes])));
    expect(await t.mutation(api.bridgeSync.commitPayloadUpload, { ...args, storageId: independentUpload })).toEqual(first);
    // An unbound ID is not proof this device owns that in-flight upload.
    expect(await t.run(ctx => ctx.db.system.get(independentUpload))).not.toBeNull();
    expect(await t.run(ctx => ctx.db.query("payloadObjects").collect())).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("syncOperations").collect())).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("workReplicas").collect())).toEqual([
      expect.objectContaining({ kind: "local", revision: args.hash, state: "current" }),
      expect.objectContaining({ kind: "cloud", revision: args.hash, state: "current" }),
    ]);
  });

  it.each(["begin", "commit"] as const)("rejects an inconsistent size for a genuine dedup at %s", async phase => {
    const { t, args, storageId } = await fixture();
    await t.mutation(api.bridgeSync.commitPayloadUpload, { ...args, storageId });
    await expect(t.mutation(phase === "begin" ? api.bridgeSync.beginPayloadUpload : api.bridgeSync.commitPayloadUpload, {
      ...args, bytes: args.bytes + 1,
    })).rejects.toThrow("PAYLOAD_SIZE_MISMATCH");
  });

  it.each(["begin", "commit"] as const)("rejects a deactivated device owner at %s", async phase => {
    const { t, args, ids, storageId } = await fixture();
    await t.run(ctx => ctx.db.patch(ids.accountId, { status: "deactivated" }));
    await expect(t.mutation(phase === "begin" ? api.bridgeSync.beginPayloadUpload : api.bridgeSync.commitPayloadUpload, args))
      .rejects.toThrow("BRIDGE_ACCOUNT_UNAVAILABLE");
    expect(await t.run(ctx => ctx.db.system.get(storageId))).not.toBeNull();
  });

  it.each(["begin", "commit"] as const)("rejects revoked credentials at %s", async phase => {
    const { t, args, ids } = await fixture();
    await t.run(ctx => ctx.db.patch(ids.deviceId, { state: "revoked" }));
    await expect(t.mutation(phase === "begin" ? api.bridgeSync.beginPayloadUpload : api.bridgeSync.commitPayloadUpload, args))
      .rejects.toThrow("BRIDGE_CREDENTIAL_INVALID");
  });

  it.each(["begin", "commit"] as const)("rejects another device's replica at %s", async phase => {
    const { t, args, ids } = await fixture();
    await t.run(async ctx => {
      const device = (await ctx.db.get(ids.deviceId))!;
      const { _id: _deviceId, _creationTime: _created, ...fields } = device;
      const otherDeviceId = await ctx.db.insert("bridgeDevices", { ...fields, credentialHash: sha256("other fixture device") });
      await ctx.db.patch(ids.replicaId, { deviceId: otherDeviceId });
    });
    await expect(t.mutation(phase === "begin" ? api.bridgeSync.beginPayloadUpload : api.bridgeSync.commitPayloadUpload, args))
      .rejects.toThrow("REPLICA_NOT_OWNED_BY_DEVICE");
  });

  it("rejects adoption of another account's retained bytes even with their correct digest", async () => {
    const { t, args, storageId, bytes } = await fixture();
    await t.run(async ctx => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", {
        clerkId: "foreign", email: "foreign@example.test", emailVerified: true, name: "Foreign",
        status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("payloadObjects", {
        accountId, storageId, hash: args.hash, bytes: args.bytes, mediaType: args.mediaType,
        refCount: 1, state: "active", createdAt: now, verifiedAt: now,
      });
    });
    await expect(t.mutation(api.bridgeSync.commitPayloadUpload, { ...args, storageId })).rejects.toThrow("PAYLOAD_STORAGE_OWNERSHIP");
    expect(await t.run(ctx => ctx.db.query("payloadObjects").collect())).toHaveLength(1);
    expect(await t.run(async ctx => (await ctx.storage.get(storageId))?.text())).toBe(bytes);
  });

  it("does not expose the stored credential verifier in a device listing", async () => {
    const { actor, ids } = await fixture();
    const devices = await actor.query(api.bridge.devices, {});
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ _id: ids.deviceId, name: "Fixture Bridge" });
    expect(devices[0]).not.toHaveProperty("credentialHash");
  });
});
