/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const members = [];
    for (const name of ["publisher", "victim"]) {
      const schoolId = await ctx.db.insert("schools", {
        name, slug: name, verifiedDomains: [], status: "active", timezone: "Europe/Madrid",
        policyVersion: 1, createdAt: now, updatedAt: now,
      });
      const accountId = await ctx.db.insert("accounts", {
        clerkId: name, email: `${name}@example.test`, emailVerified: true, name, status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        schoolId, accountId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
      });
      members.push({ accountId, schoolId });
    }
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      schoolId: members[0].schoolId, ownerAccountId: members[0].accountId, blueprintKey: "code",
      title: "Fixture runtime", content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now,
    });
    const artifactVersionId = await ctx.db.insert("spectraArtifactVersions", {
      artifactId, ownerAccountId: members[0].accountId, schoolId: members[0].schoolId, source: "manual", after: {}, createdAt: now,
    });
    await ctx.db.patch(artifactId, { currentVersionId: artifactVersionId });
    return { artifactId, artifactVersionId, expectedArtifactUpdatedAt: now, victimId: members[1].accountId };
  });
  const actor = t.withIdentity({ subject: "publisher", email: "publisher@example.test", emailVerified: true });
  const victim = t.withIdentity({ subject: "victim", email: "victim@example.test", emailVerified: true });
  const upload = await actor.mutation(api.spectraRuntimeBuilds.beginUpload, {
    artifactId: ids.artifactId, artifactVersionId: ids.artifactVersionId, expectedArtifactUpdatedAt: ids.expectedArtifactUpdatedAt,
    runtime: "browser", runtimeVersion: "1", sourceHash: "a".repeat(64), sdkVersion: "1", entryFileId: "index.js",
    dependencies: {}, assetIds: [], sourceBytes: 2, outputBytes: 2,
  });
  const bytes = JSON.stringify({ fixture: "independent retained bytes" });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob([bytes], { type: "application/json" })));
  const args = { buildId: upload.buildId, storageId, payloadHash: createHash("sha256").update(bytes).digest("hex"), payloadBytes: Buffer.byteLength(bytes) };
  return { t, actor, victim, ids, bytes, args };
}

async function bindVictimPayload(f: Awaited<ReturnType<typeof fixture>>) {
  return f.t.run(ctx => ctx.db.insert("payloadObjects", {
    accountId: f.ids.victimId, hash: f.args.payloadHash, storageId: f.args.storageId, bytes: f.args.payloadBytes,
    mediaType: "application/json", refCount: 1, state: "active", createdAt: Date.now(), verifiedAt: Date.now(),
  }));
}

it.each([false, true])("failed publication cannot delete another upload (retained: %s)", async retained => {
  const f = await fixture();
  if (retained) await bindVictimPayload(f);
  expect(await f.actor.mutation(api.spectraRuntimeBuilds.fail, {
    buildId: f.args.buildId, storageId: f.args.storageId, reason: "Fixture failure",
  })).toEqual({ failed: true });
  expect(await f.t.run(async ctx => (await ctx.storage.get(f.args.storageId))?.text())).toBe(f.bytes);
});

it("rejects rebinding a different school's retained payload as a published runtime", async () => {
  const f = await fixture();
  await bindVictimPayload(f);
  await expect(f.actor.mutation(api.spectraRuntimeBuilds.finalize, f.args)).rejects.toThrow("RUNTIME_STORAGE_OWNERSHIP");
  expect(await f.t.run(ctx => ctx.db.get(f.args.buildId))).toMatchObject({ status: "uploading" });
  expect(await f.t.run(async ctx => (await ctx.storage.get(f.args.storageId))?.text())).toBe(f.bytes);
});

it("publishes genuine unbound bytes using the storage digest and preserves retrieval authorization", async () => {
  const f = await fixture();
  expect(await f.actor.mutation(api.spectraRuntimeBuilds.finalize, f.args)).toMatchObject({ buildId: f.args.buildId });
  expect(await f.actor.query(api.spectraRuntimeBuilds.getPublished, { artifactId: f.ids.artifactId }))
    .toMatchObject({ buildId: f.args.buildId, payloadHash: f.args.payloadHash, payloadBytes: f.args.payloadBytes });
  await expect(f.victim.query(api.spectraRuntimeBuilds.getPublished, { artifactId: f.ids.artifactId })).rejects.toThrow();
  expect(await f.actor.mutation(api.spectraRuntimeBuilds.fail, { buildId: f.args.buildId, storageId: f.args.storageId, reason: "late" }))
    .toEqual({ failed: false });
  expect(await f.t.run(ctx => ctx.db.system.get(f.args.storageId))).not.toBeNull();
});

it("rejects false publication integrity without deleting the caller-specified object", async () => {
  const f = await fixture();
  await expect(f.actor.mutation(api.spectraRuntimeBuilds.finalize, { ...f.args, payloadHash: "0".repeat(64) }))
    .rejects.toThrow("RUNTIME_UPLOAD_INTEGRITY_FAILED");
  expect(await f.t.run(async ctx => (await ctx.storage.get(f.args.storageId))?.text())).toBe(f.bytes);
});
