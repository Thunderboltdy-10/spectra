/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

it("purges a school's calendars, native replicas, file payloads and runtime blobs", async () => {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"])
    aggregateTest.register(t, name);
  const nativeBytes = "a student's original Word file";
  const runtimeBytes = "<!doctype html><p>built code</p>";
  const nativeStorageId = await t.run(ctx => ctx.storage.store(new Blob([nativeBytes], { type: DOCX })));
  const runtimeStorageId = await t.run(ctx => ctx.storage.store(new Blob([runtimeBytes], { type: "text/html" })));
  const candidateStorageId = await t.run(ctx => ctx.storage.store(new Blob(["candidate"], { type: "image/png" })));
  const sha = (value: string) => createHash("sha256").update(value).digest("hex");

  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Purged", slug: "purged-fixture", verifiedDomains: [], status: "suspended",
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const otherSchoolId = await ctx.db.insert("schools", {
      name: "Kept", slug: "kept-fixture", verifiedDomains: [], status: "active",
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: "purge-student", email: "student@purged.test", emailVerified: true,
      name: "Student", status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      schoolId, accountId, role: "student", status: "suspended", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      schoolId, ownerAccountId: accountId, blueprintKey: "document", title: "Essay",
      content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now,
    });
    const keptArtifactId = await ctx.db.insert("spectraArtifacts", {
      schoolId: otherSchoolId, ownerAccountId: accountId, blueprintKey: "document", title: "Kept",
      content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now,
    });
    const payloadRef = await ctx.db.insert("payloadObjects", {
      accountId, storageId: nativeStorageId, hash: sha(nativeBytes), bytes: Buffer.byteLength(nativeBytes),
      mediaType: DOCX, refCount: 1, state: "active", createdAt: now, verifiedAt: now,
    });
    await ctx.db.insert("workReplicas", {
      workId: artifactId, accountId, kind: "cloud", nativeFormat: "docx", payloadRef: String(payloadRef),
      revision: "r1", state: "current", updatedAt: now,
    });
    const keptReplicaId = await ctx.db.insert("workReplicas", {
      workId: keptArtifactId, accountId, kind: "cloud", nativeFormat: "docx", revision: "r1",
      state: "current", updatedAt: now,
    });
    const versionId = await ctx.db.insert("spectraArtifactVersions", {
      artifactId, ownerAccountId: accountId, schoolId, source: "manual", schemaVersion: 2, after: {}, createdAt: now,
    });
    await ctx.db.insert("spectraRuntimeBuilds", {
      artifactId, artifactVersionId: versionId, schoolId, createdByAccountId: accountId,
      runtime: "browser", status: "published", sourceHash: sha(runtimeBytes), payloadHash: sha(runtimeBytes),
      sdkVersion: "fixture", entryFileId: "index.html", dependencies: {}, storageId: runtimeStorageId,
      sourceBytes: 1, outputBytes: 1, payloadBytes: Buffer.byteLength(runtimeBytes), createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("artifactAssets", {
      artifactId, schoolId, uploadedByAccountId: accountId, path: "img.png", name: "img.png", candidateStorageId,
      mediaType: "image/png", bytes: 9, sha256: sha("candidate"), status: "uploading", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("calendarItems", {
      ownerAccountId: accountId, schoolId, kind: "personal_event", title: "Therapy appointment",
      allDay: true, timezone: "Europe/Madrid", timePrecision: "date_only", status: "active",
      sourceLocked: false, linkedArtifactIds: [], revision: 1, createdBy: "human", createdAt: now, updatedAt: now,
    });
    const roomId = await ctx.db.insert("collaborationRooms", {
      artifactId, schoolId, typeKey: "document", provider: "self_hosted_yjs", partitionKey: "root",
      schemaVersion: 1, policyVersion: 1, status: "active", nextSequence: 2, snapshotSequence: 0,
      uncompactedBytes: 0, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("collaborationReceipts", {
      roomId, idempotencyKey: "k", sequence: 1, actorAccountId: accountId, clientId: "c",
      stateVectorHash: "h", digest: "d", byteLength: 1, createdAt: now,
    });
    const exportJobId = await ctx.db.insert("schoolLifecycleJobs", {
      schoolId, type: "export", status: "completed", requestedByAccountId: accountId, approvedByAccountIds: [],
      reason: "export", impact: { activeMembers: 0, artifacts: 1, workspaces: 0, integrations: 0 },
      createdAt: now, updatedAt: now,
    });
    const jobId = await ctx.db.insert("schoolLifecycleJobs", {
      schoolId, type: "purge", status: "running", requestedByAccountId: accountId, approvedByAccountIds: [],
      reason: "purge", impact: { activeMembers: 0, artifacts: 1, workspaces: 0, integrations: 0 },
      prerequisiteExportJobId: exportJobId, reversibleUntil: now - 1, startedAt: now, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolPurgeProgress", {
      jobId, schoolId, stage: "dependent_rows", tableIndex: 0, deletedRows: 0, deletedStorageObjects: 0,
      createdAt: now, updatedAt: now,
    });
    return { schoolId, jobId, payloadRef, keptReplicaId };
  });

  for (let step = 0; step < 500; step++) {
    const job = await t.run(ctx => ctx.db.get(ids.jobId));
    if (job?.status === "completed") break;
    await t.mutation(internal.administration.processLifecycleJobs, {});
  }

  const after = await t.run(async ctx => ({
    job: await ctx.db.get(ids.jobId),
    replicas: await ctx.db.query("workReplicas").collect(),
    payload: await ctx.db.get(ids.payloadRef),
    builds: await ctx.db.query("spectraRuntimeBuilds").collect(),
    assets: await ctx.db.query("artifactAssets").collect(),
    calendar: await ctx.db.query("calendarItems").collect(),
    receipts: await ctx.db.query("collaborationReceipts").collect(),
    nativeBlob: await ctx.db.system.get(nativeStorageId),
    runtimeBlob: await ctx.db.system.get(runtimeStorageId),
    candidateBlob: await ctx.db.system.get(candidateStorageId),
  }));
  expect(after.job?.status).toBe("completed");
  expect(after.replicas.map(row => row._id)).toEqual([ids.keptReplicaId]);
  expect(after.payload?.state).toBe("released");
  expect(after.nativeBlob).toBeNull();
  expect(after.builds).toEqual([]);
  expect(after.runtimeBlob).toBeNull();
  expect(after.assets).toEqual([]);
  expect(after.candidateBlob).toBeNull();
  expect(after.calendar).toEqual([]);
  expect(after.receipts).toEqual([]);
});
