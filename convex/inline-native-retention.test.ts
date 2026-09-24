/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

it.each(["current", "advanced", "legacy"] as const)("preserves a %s native base of an inline saved version until its final pin is removed", async state => {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"]) aggregateTest.register(t, name);
  const bytes = new Uint8Array([80, 75, 3, 4, 5]);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { artifactId, containerId, accountId, schoolId, storageId } = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Probe", slug: "inline-native-probe", verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: "inline-probe", email: "probe@example.test", emailVerified: true, name: "Probe", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const content = { blocks: [{ id: "p", type: "paragraph", text: "Pinned inline projection" }], nativeBinding: { sourcePayloadHash: hash } };
    const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", title: "Source", content, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
    const containerId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", title: "Pin owner", content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
    const storageId = await ctx.storage.store(new Blob([bytes], { type: "application/octet-stream" }));
    return { artifactId, containerId, accountId, schoolId, storageId };
  });
  const actor = t.withIdentity({ subject: "inline-probe", email: "probe@example.test", emailVerified: true });
  const { payloadRef } = await actor.mutation(api.payloads.put, { workId: artifactId, storageId, hash, bytes: bytes.length, mediaType: "application/octet-stream" });
  const replicaId = await t.run(ctx => ctx.db.insert("workReplicas", { accountId, workId: artifactId, kind: "cloud", payloadRef, nativeFormat: "docx", revision: hash, contentHash: hash, state: "current", updatedAt: Date.now() }));
  const version = await actor.mutation(api.changeGroups.createNamedCheckpoint, { artifactId, name: "Pinned inline native" });
  const owners = await t.run(ctx => ctx.db.query("collaborationPayloadOwners").withIndex("by_owner", q => q.eq("ownerId", String(version.versionId))).collect());
  expect(owners.map(owner => owner.payloadRef)).toContain(payloadRef);
  if (state === "legacy") {
    // Historical inline versions predate native ownership. The deletion
    // coordinator repairs their binding before it removes current replicas.
    await t.run(async ctx => { for (const owner of owners) await ctx.db.delete(owner._id); });
  }
  if (state === "advanced") {
    const nextBytes = new Uint8Array([80, 75, 3, 4, 6]);
    const nextHash = createHash("sha256").update(nextBytes).digest("hex");
    const nextStorageId = await t.run(ctx => ctx.storage.store(new Blob([nextBytes], { type: "application/octet-stream" })));
    const next = await actor.mutation(api.payloads.put, { workId: artifactId, storageId: nextStorageId, hash: nextHash, bytes: nextBytes.length, mediaType: "application/octet-stream" });
    await t.run(ctx => ctx.db.patch(replicaId, { payloadRef: next.payloadRef, revision: nextHash, contentHash: nextHash }));
  }
  const pinIds = await t.run(async ctx => {
    const pins = [];
    for (const region of ["first", "second"]) pins.push(await ctx.db.insert("artifactEmbeds", { containerType: "artifact", containerId: String(containerId), containerRegionId: `document:${region}`, sourceArtifactId: artifactId, schoolId, mode: "compact", interaction: "read", versionPolicy: "pinned", pinnedVersionId: version.versionId, contextPolicy: "summary", createdByAccountId: accountId, createdAt: Date.now(), updatedAt: Date.now() }));
    return pins;
  });
  const deletion = await actor.mutation(api.spectraArtifacts.permanentlyDelete, { artifactId });
  for (let step = 0; step < 100; step++) {
    const job = await t.run(ctx => ctx.db.get(deletion.jobId));
    if (job?.phase === "complete") break;
    expect(job?.phase).not.toBe("failed");
    await t.mutation(internal.spectraArtifactDeletion.process, { jobId: deletion.jobId, generation: 1 });
  }
  expect(await t.run(ctx => ctx.db.get(deletion.jobId))).toMatchObject({ phase: "complete" });
  expect(await t.run(ctx => ctx.db.get(version.versionId))).not.toBeNull();
  expect(await t.run(ctx => ctx.db.system.get(storageId))).not.toBeNull();
  expect(await actor.query(api.payloads.get, { workId: artifactId, hash })).toMatchObject({ hash });
  const otherAccountId = await t.run(async ctx => {
    const now = Date.now();
    const otherId = await ctx.db.insert("accounts", { clerkId: "unrelated-reader", email: "unrelated@example.test", emailVerified: true, name: "Other", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId: otherId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    return otherId;
  });
  const other = t.withIdentity({ subject: "unrelated-reader", email: "unrelated@example.test", emailVerified: true });
  await expect(other.query(api.payloads.get, { workId: artifactId, hash })).rejects.toThrow();
  const grantId = await t.run(ctx => ctx.db.insert("accessGrants", { schoolId, resourceType: "artifact", resourceId: containerId, principalType: "account", principalId: otherAccountId, level: "read", capabilities: ["read", "use", "comment"], source: "direct", createdByAccountId: accountId, createdAt: Date.now(), updatedAt: Date.now() }));
  expect(await other.query(api.payloads.get, { workId: artifactId, hash })).toMatchObject({ hash });
  await t.run(ctx => ctx.db.delete(grantId));
  await expect(other.query(api.payloads.get, { workId: artifactId, hash })).rejects.toThrow();
  await actor.mutation(api.artifactEmbeds.remove, { embedId: pinIds[0] });
  expect(await t.mutation(internal.durablePayloadOwnership.release, { payloadRef })).toBe(false);
  expect(await actor.query(api.payloads.get, { workId: artifactId, hash })).toMatchObject({ hash });
  await actor.mutation(api.artifactEmbeds.remove, { embedId: pinIds[1] });
  expect(await t.mutation(internal.durablePayloadOwnership.release, { payloadRef })).toBe(true);
  expect(await t.run(ctx => ctx.db.system.get(storageId))).toBeNull();
});
