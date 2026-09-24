/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

it.each([
  ["nativePayloadRefs", false, false],
  ["payloadRef", false, false],
  ["nativePayloadRefs", true, false],
  ["payloadRef", true, false],
  ["payloadRef", false, true],
] as const)("rejects authored %s (shared source: %s, historical owner: %s)", async (shape, sharedSource, historicalOwner) => {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"]) aggregateTest.register(t, name);
  const bytes = "private fixture native bytes";
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { victimId, attackerId, schoolId, privateArtifactId, storageId } = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Authority probe", slug: "pin-authority", verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    let victimId;
    let attackerId;
    for (const name of ["victim", "attacker"]) {
      const accountId = await ctx.db.insert("accounts", { clerkId: name, email: `${name}@example.test`, emailVerified: true, name, status: "active", createdAt: now, updatedAt: now });
      await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
      if (name === "victim") victimId = accountId;
      else attackerId = accountId;
    }
    const privateArtifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: victimId!, schoolId, blueprintKey: "document", title: "Private native source", content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
    return { victimId: victimId!, attackerId: attackerId!, schoolId, privateArtifactId, storageId: await ctx.storage.store(new Blob([bytes], { type: "application/octet-stream" })) };
  });
  const victim = t.withIdentity({ subject: "victim", email: "victim@example.test", emailVerified: true });
  const attacker = t.withIdentity({ subject: "attacker", email: "attacker@example.test", emailVerified: true });
  const { payloadRef } = await victim.mutation(api.payloads.put, { workId: privateArtifactId, storageId, hash, bytes: Buffer.byteLength(bytes), mediaType: "application/octet-stream" });
  await t.run(ctx => ctx.db.insert("workReplicas", { accountId: victimId, workId: privateArtifactId, kind: "cloud", payloadRef, nativeFormat: "docx", revision: hash, contentHash: hash, state: "current", updatedAt: Date.now() }));
  await expect(attacker.query(api.payloads.get, { workId: privateArtifactId, hash })).rejects.toThrow();
  const content = {
    blocks: [{ id: "p", type: "paragraph", text: "Owned ordinary document" }],
    ...(historicalOwner ? { nativeBinding: { sourcePayloadHash: hash } } : shape === "nativePayloadRefs"
      ? { nativePayloadHashes: [hash], nativePayloadRefs: [payloadRef] }
      : { nativeBinding: { sourcePayloadHash: hash }, extra: { payloadRef } }),
  };
  const sourceOwner = sharedSource ? victim : attacker;
  const forged = await sourceOwner.mutation(api.spectraArtifacts.create, { blueprintKey: "document", title: "Forged native reference", ...(sharedSource ? {} : { content }), parentNodeId: "root" });
  if (sharedSource) {
    const runId = await t.run(async ctx => {
      const now = Date.now();
      await ctx.db.insert("accessGrants", { schoolId, resourceType: "artifact", resourceId: forged.artifactId, principalType: "account", principalId: attackerId, level: "modify", capabilities: ["read", "modify", "restore", "use", "comment"], source: "direct", createdByAccountId: victimId, createdAt: now, updatedAt: now });
      return ctx.db.insert("spectraAiRuns", { ownerAccountId: attackerId, schoolId, sourceSurface: "artifact", artifactId: forged.artifactId, executionId: "authority-fixture", status: "running", userPrompt: "Fixture content edit", createdAt: now, updatedAt: now });
    });
    // The shared source and private native file have the same owner. An
    // account-equality check alone would leak that owner's unrelated bytes.
    await attacker.mutation(api.spectraArtifacts.stageAiPatch, { artifactId: forged.artifactId, runId, executionId: "authority-fixture", content, commit: true });
  }
  const container = await attacker.mutation(api.spectraArtifacts.create, { blueprintKey: "document", title: "Pin owner", parentNodeId: "root" });
  const version = await attacker.mutation(api.changeGroups.createNamedCheckpoint, { artifactId: forged.artifactId, name: "Forged native pin" });
  if (historicalOwner) await t.run(ctx => ctx.db.insert("collaborationPayloadOwners", { ownerId: String(version.versionId), ownerTable: "spectraArtifactVersions", payloadRef }));
  const versionOwners = await t.run(ctx => ctx.db.query("collaborationPayloadOwners").withIndex("by_owner", q => q.eq("ownerId", String(version.versionId))).collect());
  expect(versionOwners.filter(owner => owner.ownerTable === "spectraArtifactVersions:native").map(owner => owner.payloadRef)).not.toContain(payloadRef);
  await attacker.mutation(api.artifactEmbeds.create, { containerType: "artifact", containerId: String(container.artifactId), containerRegionId: "document:pin", sourceArtifactId: forged.artifactId, mode: "compact", interaction: "read", versionPolicy: "pinned", pinnedVersionId: version.versionId, contextPolicy: "summary" });
  const deletion = await sourceOwner.mutation(api.spectraArtifacts.permanentlyDelete, { artifactId: forged.artifactId });
  for (let step = 0; step < 100; step++) {
    const job = await t.run(ctx => ctx.db.get(deletion.jobId));
    if (job?.phase === "complete") break;
    expect(job?.phase).not.toBe("failed");
    await t.mutation(internal.spectraArtifactDeletion.process, { jobId: deletion.jobId, generation: 1 });
  }
  expect(await t.run(ctx => ctx.db.get(deletion.jobId))).toMatchObject({ phase: "complete" });
  expect(await attacker.query(api.payloads.get, { workId: forged.artifactId, hash })).toBeNull();
  expect(await victim.query(api.payloads.get, { workId: privateArtifactId, hash })).toMatchObject({ hash });
  expect(await t.run(async ctx => (await ctx.storage.get(storageId))?.text())).toBe(bytes);
});
