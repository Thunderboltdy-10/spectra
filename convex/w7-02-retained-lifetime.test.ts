import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const owner = {
  subject: "w7-02-owner",
  email: "w7-02-owner@example.test",
  emailVerified: true,
};

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

async function drainDeletion(
  t: ReturnType<typeof convexTest>,
  jobId: Id<"artifactDeletionJobs">,
  generation: number,
) {
  const process = (internal as unknown as { spectraArtifactDeletion: { process: unknown } }).spectraArtifactDeletion.process as never;
  const runInternal = (t as unknown as { mutation: (fn: unknown, args: unknown) => Promise<unknown> }).mutation.bind(t);
  for (let i = 0; i < 100; i += 1) {
    const job = await t.run((ctx) => ctx.db.get(jobId));
    if (!job || job.phase === "complete" || job.phase === "failed") return;
    await runInternal(process, { jobId, generation });
  }
  throw new Error("deletion did not drain");
}

async function retainedFixture(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "W7 retained lifetime",
      slug: crypto.randomUUID(),
      verifiedDomains: [],
      status: "active",
      timezone: "UTC",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: owner.subject,
      email: owner.email,
      emailVerified: true,
      name: "W7 owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "school_admin",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const createArtifact = (title: string) =>
      ctx.db.insert("spectraArtifacts", {
        ownerAccountId: accountId,
        schoolId,
        blueprintKey: "document",
        schemaVersion: 2,
        title,
        content: { blocks: [] },
        textIndex: title,
        tags: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    const sourceArtifactId = await createArtifact("Retained source");
    const firstContainerId = await createArtifact("First container");
    const secondContainerId = await createArtifact("Second container");

    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
    ]);
    const digestBytes = new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes),
    );
    const digest = Array.from(digestBytes, (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    const storageSha = btoa(String.fromCharCode(...digestBytes));
    const storageId = await ctx.storage.store(
      new Blob([bytes], { type: "image/png" }),
      { sha256: storageSha },
    );
    const assetId = await ctx.db.insert("artifactAssets", {
      artifactId: sourceArtifactId,
      schoolId,
      uploadedByAccountId: accountId,
      storageId,
      uploadReceipt: "w7-asset-receipt",
      path: "images/shared.png",
      name: "shared.png",
      mediaType: "image/png",
      bytes: bytes.byteLength,
      sha256: digest,
      status: "active",
      createdAt: now,
      updatedAt: now,
      activatedAt: now,
    });
    const content = {
      blocks: [{ type: "image", attrs: { assetId: String(assetId) } }],
    };
    const sharedSnapshotRef = "w7-shared-snapshot";
    await ctx.db.insert("artifactSnapshotObjects", {
      schoolId,
      hash: sharedSnapshotRef,
      strategy: "normalized",
      payload: content,
      byteLength: 1,
      refCount: 2,
      state: "hot",
      createdAt: now,
      lastReferencedAt: now,
      verifiedAt: now,
    });
    const pinnedVersionId = await ctx.db.insert("spectraArtifactVersions", {
      artifactId: sourceArtifactId,
      ownerAccountId: accountId,
      schoolId,
      source: "manual",
      schemaVersion: 2,
      snapshotRef: sharedSnapshotRef,
      after: content,
      createdAt: now + 1,
    });
    const unpinnedVersionId = await ctx.db.insert("spectraArtifactVersions", {
      artifactId: sourceArtifactId,
      ownerAccountId: accountId,
      schoolId,
      source: "manual",
      schemaVersion: 2,
      snapshotRef: sharedSnapshotRef,
      after: { blocks: [{ type: "paragraph", text: "unpublished" }] },
      createdAt: now + 2,
    });
    const firstEmbedId = await ctx.db.insert("artifactEmbeds", {
      containerType: "artifact",
      containerId: String(firstContainerId),
      containerRegionId: "document:body:first",
      sourceArtifactId,
      schoolId,
      mode: "compact",
      interaction: "read",
      versionPolicy: "pinned",
      pinnedVersionId,
      contextPolicy: "summary",
      createdByAccountId: accountId,
      placementState: "confirmed",
      createdAt: now,
      updatedAt: now,
    });
    const secondEmbedId = await ctx.db.insert("artifactEmbeds", {
      containerType: "artifact",
      containerId: String(secondContainerId),
      containerRegionId: "document:body:second",
      sourceArtifactId,
      schoolId,
      mode: "expanded",
      interaction: "read",
      versionPolicy: "pinned",
      pinnedVersionId,
      contextPolicy: "visible_region",
      createdByAccountId: accountId,
      placementState: "confirmed",
      createdAt: now,
      updatedAt: now,
    });
    const mixedRunId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: accountId,
      schoolId,
      sourceSurface: "artifact",
      artifactId: sourceArtifactId,
      status: "completed",
      userPrompt: "Create a mixed result",
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    const mixedCardId = await ctx.db.insert("spectraResultCards", {
      runId: mixedRunId,
      surface: "artifact",
      artifactId: firstContainerId,
      status: "completed",
      variant: "artifact",
      title: "Retained result",
      actions: [],
      createdAt: now,
      updatedAt: now,
    });

    // Both nested deletion families are deliberately larger than one page.
    const workNodeId = await ctx.db.insert("orgNodes", {
      accountId,
      schoolId,
      parentId: null,
      kind: "work",
      name: "Retained source",
      sourceId: String(sourceArtifactId),
      orderKey: "a",
      typeKey: "document",
      createdAt: now,
      updatedAt: now,
    });
    for (let i = 0; i < 65; i += 1) {
      await ctx.db.insert("orgNodes", {
        accountId,
        schoolId,
        parentId: workNodeId,
        kind: "link",
        name: `Link ${i}`,
        sourceId: String(workNodeId),
        orderKey: `a${String(i).padStart(2, "0")}`,
        typeKey: "link",
        createdAt: now + i,
        updatedAt: now + i,
      });
    }
    for (let i = 0; i < 65; i += 1) {
      await ctx.db.insert("artifactAccessRequests", {
        embedId: firstEmbedId,
        sourceArtifactId,
        schoolId,
        requesterAccountId: accountId,
        ownerAccountId: accountId,
        requestedLevel: "read",
        status: "pending",
        createdAt: now + i,
        updatedAt: now + i,
      });
    }
    return {
      accountId,
      schoolId,
      sourceArtifactId,
      firstContainerId,
      firstEmbedId,
      secondEmbedId,
      workNodeId,
      pinnedVersionId,
      unpinnedVersionId,
      assetId,
      storageId,
      sharedSnapshotRef,
      mixedRunId,
      mixedCardId,
    };
  });
}

describe("W7-02 retained lifetime and deletion coordinator", () => {
  it("separates source tombstones from placement removal and retains shared bytes until the last pin", async () => {
    const t = setupTest();
    const fixture = await retainedFixture(t);
    const deletion = await t
      .withIdentity(owner)
      .mutation(api.spectraArtifacts.permanentlyDelete, {
        artifactId: fixture.sourceArtifactId,
      });

    const sourceBeforeDrain = await t.run((ctx) =>
      ctx.db.get(fixture.sourceArtifactId),
    );
    expect(sourceBeforeDrain?.status).toBe("deleted");
    await drainDeletion(t, deletion.jobId, 1);

    const retained = await t.run(async (ctx) => ({
      source: await ctx.db.get(fixture.sourceArtifactId),
      embeds: await ctx.db.query("artifactEmbeds").collect(),
      requests: await ctx.db.query("artifactAccessRequests").collect(),
      links: await ctx.db.query("orgNodes").withIndex("by_kind_source", (q) => q.eq("kind", "link").eq("sourceId", String(fixture.workNodeId))).collect(),
      pinnedVersion: await ctx.db.get(fixture.pinnedVersionId),
      unpinnedVersion: await ctx.db.get(fixture.unpinnedVersionId),
      snapshot: await ctx.db.query("artifactSnapshotObjects").withIndex("by_school_hash", (q) => q.eq("schoolId", fixture.schoolId).eq("hash", fixture.sharedSnapshotRef)).unique(),
      asset: await ctx.db.get(fixture.assetId),
      stored: Boolean(await ctx.storage.get(fixture.storageId)),
      mixedRun: await ctx.db.get(fixture.mixedRunId),
      mixedCard: await ctx.db.get(fixture.mixedCardId),
    }));
    expect(retained.source?.status).toBe("deleted");
    expect(retained.embeds).toHaveLength(2);
    expect(retained.embeds.every((embed) => embed.removedAt === undefined)).toBe(true);
    expect(retained.embeds.every((embed) => embed.sourceUnavailableAt !== undefined)).toBe(true);
    expect(retained.requests).toHaveLength(65);
    expect(retained.requests.every((request) => request.status === "cancelled")).toBe(true);
    expect(retained.links).toHaveLength(0);
    expect(retained.pinnedVersion).toBeDefined();
    expect(retained.unpinnedVersion).toBeNull();
    expect(retained.snapshot).toMatchObject({ refCount: 1, state: "hot" });
    expect(retained.asset).toMatchObject({ status: "active", storageId: fixture.storageId });
    expect(retained.stored).toBe(true);
    expect(retained.mixedRun).toBeDefined();
    expect(retained.mixedCard).toBeDefined();
    await expect(t.withIdentity(owner).query(api.artifactEmbeds.getProjection, { embedId: fixture.firstEmbedId })).resolves.toMatchObject({ state: "ready", sourceUnavailable: true, source: { snapshot: { blocks: [{ type: "image", attrs: { assetId: String(fixture.assetId) } }] } } });

    await t.withIdentity(owner).mutation(api.artifactEmbeds.remove, {
      embedId: fixture.firstEmbedId,
    });
    expect(await t.run((ctx) => ctx.db.get(fixture.pinnedVersionId))).toBeDefined();

    await t.withIdentity(owner).mutation(api.artifactEmbeds.remove, {
      embedId: fixture.secondEmbedId,
    });
    const lastJob = await t.run((ctx) =>
      ctx.db
        .query("artifactDeletionJobs")
        .withIndex("by_artifact_generation", (q) => q.eq("artifactId", fixture.sourceArtifactId))
        .order("desc")
        .first(),
    );
    expect(lastJob?.generation).toBe(2);
    await drainDeletion(t, lastJob!._id, 2);

    const released = await t.run(async (ctx) => ({
      source: await ctx.db.get(fixture.sourceArtifactId),
      version: await ctx.db.get(fixture.pinnedVersionId),
      asset: await ctx.db.get(fixture.assetId),
      snapshot: await ctx.db.query("artifactSnapshotObjects").withIndex("by_school_hash", (q) => q.eq("schoolId", fixture.schoolId).eq("hash", fixture.sharedSnapshotRef)).unique(),
      stored: Boolean(await ctx.storage.get(fixture.storageId)),
      receipts: await ctx.db.query("artifactIntakeReleaseReceipts").withIndex("by_storage", (q) => q.eq("storageId", fixture.storageId)).collect(),
      job: await ctx.db.get(lastJob!._id),
      mixedRun: await ctx.db.get(fixture.mixedRunId),
      mixedCard: await ctx.db.get(fixture.mixedCardId),
    }));
    expect(released.source).toBeNull();
    expect(released.version).toBeNull();
    expect(released.asset).toMatchObject({ status: "revoked" });
    expect(released.asset?.storageId).toBeUndefined();
    expect(released.snapshot).toMatchObject({ refCount: 0, state: "cold" });
    expect(released.stored).toBe(false);
    expect(released.receipts).toHaveLength(1);
    expect(released.job?.phase).toBe("complete");
    expect(released.mixedRun).toBeDefined();
    expect(released.mixedCard).toBeDefined();
  });

  it("rolls back a mid-page failure, fences duplicate dispatch, and resumes beyond 40 requests", async () => {
    const t = setupTest();
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", { name: "W7 rollback", slug: crypto.randomUUID(), verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
      const accountId = await ctx.db.insert("accounts", { clerkId: `${owner.subject}-rollback`, email: `rollback-${owner.email}`, emailVerified: true, name: "Rollback", status: "active", createdAt: now, updatedAt: now });
      await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "school_admin", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
      const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", schemaVersion: 2, title: "Rollback", content: { blocks: [] }, textIndex: "Rollback", tags: [], status: "deleted", deletionGeneration: 1, createdAt: now, updatedAt: now });
      const deviceId = await ctx.db.insert("bridgeDevices", { accountId, name: "Rollback device", platform: "test", credentialHash: "rollback", protocolVersion: "1", appVersion: "1", pairedAt: now, lastSeenAt: now, state: "active" });
      const mountId = await ctx.db.insert("bridgeMounts", { accountId, deviceId, rootLabel: "Rollback", grantId: "rollback-grant", state: "active", fileCount: 0, doubleSyncRisk: false, createdAt: now, updatedAt: now });
      const replicaId = await ctx.db.insert("workReplicas", { accountId, workId: artifactId, kind: "local", deviceId, mountId, localResourceId: "rollback-resource", relativePath: "rollback.md", nativeFormat: "markdown", revision: "r1", state: "current", updatedAt: now });
      for (let i = 0; i < 65; i += 1) await ctx.db.insert("bridgeWriteRequests", { accountId, workId: artifactId, replicaId, deviceId, mountId, localResourceId: `rollback-resource-${i}`, relativePath: `rollback-${i}.md`, payloadRef: `missing-payload-${i}`, baseRevision: "r0", targetRevision: "r1", contentHash: "hash", idempotencyKey: `rollback-${i}`, regionIds: [], partNames: [], state: "pending", createdAt: now + i, updatedAt: now + i });
      const cursor = Buffer.from(JSON.stringify({ family: "requests" }), "utf8").toString("base64url");
      const jobId = await ctx.db.insert("artifactDeletionJobs", { artifactId, ownerAccountId: accountId, schoolId, generation: 1, phase: "children", cursor, deletedRows: 0, releasedBytes: 0, createdAt: now, updatedAt: now });
      return { artifactId, jobId, cursor };
    });
    const process = (internal as unknown as { spectraArtifactDeletion: { process: unknown } }).spectraArtifactDeletion.process as never;
    const runInternal = (t as unknown as { mutation: (fn: unknown, args: unknown) => Promise<unknown> }).mutation.bind(t);
    await expect(runInternal(process, { jobId: fixture.jobId, generation: 1, testFailAfter: 1 })).rejects.toThrow("DELETION_TEST_PAGE_FAILURE");
    const rolledBack = await t.run(async (ctx) => ({
      job: await ctx.db.get(fixture.jobId),
      firstPage: await ctx.db.query("bridgeWriteRequests").withIndex("by_work_created", (q) => q.eq("workId", fixture.artifactId)).paginate({ numItems: 40, cursor: null }),
    }));
    expect(rolledBack.job?.cursor).toBe(fixture.cursor);
    expect(rolledBack.job?.deletedRows).toBe(0);
    expect(rolledBack.firstPage.page.every((row) => row.state === "pending")).toBe(true);

    const dispatch = (internal as unknown as { spectraArtifactDeletion: { dispatch: unknown } }).spectraArtifactDeletion.dispatch as never;
    const first = await runInternal(dispatch, { jobId: fixture.jobId, generation: 1 }) as { started?: boolean; attemptId?: string };
    const duplicate = await runInternal(dispatch, { jobId: fixture.jobId, generation: 1 }) as { active?: boolean };
    expect(first.started).toBe(true);
    expect(duplicate.active).toBe(true);
    await runInternal(process, { jobId: fixture.jobId, generation: 1, attemptId: first.attemptId, expectedPhase: "children", expectedCursor: fixture.cursor });
    await drainDeletion(t, fixture.jobId, 1);
    const complete = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(fixture.artifactId),
      job: await ctx.db.get(fixture.jobId),
      requests: await ctx.db.query("bridgeWriteRequests").withIndex("by_work_created", (q) => q.eq("workId", fixture.artifactId)).collect(),
    }));
    expect(complete.artifact).toBeNull();
    expect(complete.job?.phase).toBe("complete");
    expect(complete.requests).toHaveLength(65);
    expect(complete.requests.every((row) => row.state === "failed")).toBe(true);
  });

  it("keeps a same-sized legacy storage candidate when its digest binding is unknown", async () => {
    const t = setupTest();
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", { name: "W7 binding", slug: crypto.randomUUID(), verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
      const accountId = await ctx.db.insert("accounts", { clerkId: `${owner.subject}-binding`, email: `binding-${owner.email}`, emailVerified: true, name: "Binding", status: "active", createdAt: now, updatedAt: now });
      await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "school_admin", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
      const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", schemaVersion: 2, title: "Unknown binding", content: { blocks: [] }, textIndex: "Unknown", tags: [], status: "active", createdAt: now, updatedAt: now });
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const storageId = await ctx.storage.store(new Blob([bytes], { type: "text/plain" }));
      const assetId = await ctx.db.insert("artifactAssets", { artifactId, schoolId, uploadedByAccountId: accountId, storageId, path: "legacy.txt", name: "legacy.txt", mediaType: "text/plain", bytes: bytes.byteLength, sha256: "0".repeat(64), status: "active", createdAt: now, updatedAt: now });
      return { artifactId, assetId, storageId };
    });
    const deletion = await t.withIdentity({ ...owner, subject: `${owner.subject}-binding`, email: `binding-${owner.email}` }).mutation(api.spectraArtifacts.permanentlyDelete, { artifactId: fixture.artifactId });
    await drainDeletion(t, deletion.jobId, 1);
    const result = await t.run(async (ctx) => ({ artifact: await ctx.db.get(fixture.artifactId), asset: await ctx.db.get(fixture.assetId), stored: Boolean(await ctx.storage.get(fixture.storageId)), job: await ctx.db.get(deletion.jobId) }));
    expect(result.artifact?.status).toBe("deleted");
    expect(result.asset).toMatchObject({ status: "active", storageId: fixture.storageId, retentionReason: "legacy-reconciliation-required" });
    expect(result.stored).toBe(true);
    expect(result.job?.phase).toBe("complete");
    expect(result.job?.retainedRows).toBeGreaterThan(0);
  });

  it("confirms a real document placement by operation and region, then fences expiry races", async () => {
    const t = setupTest();
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", { name: "W7 canonical", slug: crypto.randomUUID(), verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
      const accountId = await ctx.db.insert("accounts", { clerkId: `${owner.subject}-canonical`, email: `canonical-${owner.email}`, emailVerified: true, name: "Canonical", status: "active", createdAt: now, updatedAt: now });
      await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "school_admin", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
      const sourceArtifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", schemaVersion: 2, title: "Canonical source", content: { blocks: [] }, textIndex: "Canonical source", tags: [], status: "active", createdAt: now, updatedAt: now });
      const containerArtifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", schemaVersion: 2, title: "Canonical container", content: { blocks: [] }, textIndex: "Canonical container", tags: [], status: "active", createdAt: now, updatedAt: now });
      return { schoolId, accountId, sourceArtifactId, containerArtifactId };
    });
    const action = t.withIdentity({ subject: `${owner.subject}-canonical`, email: `canonical-${owner.email}`, emailVerified: true });
    const created = await action.mutation(api.artifactEmbeds.create, { containerType: "artifact", containerId: String(fixture.containerArtifactId), containerRegionId: "document:body:canonical", sourceArtifactId: fixture.sourceArtifactId, mode: "compact", interaction: "read", versionPolicy: "live", contextPolicy: "summary", placementOperationId: "w7-canonical-operation" });
    expect(await t.run((ctx) => ctx.db.get(created.embedId))).toMatchObject({ placementState: "provisional", placementOperationId: "w7-canonical-operation" });
    const canonicalVersionId = await t.run((ctx) => ctx.db.insert("spectraArtifactVersions", { artifactId: fixture.containerArtifactId, ownerAccountId: fixture.accountId, schoolId: fixture.schoolId, source: "manual", schemaVersion: 2, after: { blocks: [{ embedId: String(created.embedId), operationId: "w7-canonical-operation", regionId: "document:body:canonical" }] }, createdAt: Date.now() }));
    await action.mutation(api.artifactEmbeds.confirmPlacement, { embedId: created.embedId, placementOperationId: "w7-canonical-operation", canonicalVersionId });
    await expect(t.run((ctx) => ctx.db.get(created.embedId))).resolves.toMatchObject({ placementState: "confirmed", placementReceipt: `canonical-version:${String(canonicalVersionId)}` });
    expect((await t.run((ctx) => ctx.db.get(created.embedId)))?.placementExpiresAt).toBeUndefined();
    await expect(action.query(api.artifactEmbeds.getProjection, { embedId: created.embedId })).resolves.toMatchObject({ state: "ready", sourceArtifactId: fixture.sourceArtifactId });

    const expire = (internal as unknown as { artifactEmbeds: { expireProvisional: unknown } }).artifactEmbeds.expireProvisional as never;
    const runInternal = (t as unknown as { mutation: (fn: unknown, args: unknown) => Promise<unknown> }).mutation.bind(t);
    await expect(runInternal(expire, { embedId: created.embedId, placementOperationId: "w7-canonical-operation" })).resolves.toMatchObject({ expired: false });
    const racing = await action.mutation(api.artifactEmbeds.create, { containerType: "artifact", containerId: String(fixture.containerArtifactId), containerRegionId: "document:body:racing", sourceArtifactId: fixture.sourceArtifactId, mode: "compact", interaction: "read", versionPolicy: "live", contextPolicy: "summary", placementOperationId: "w7-racing-operation" });
    await t.run((ctx) => ctx.db.patch(racing.embedId, { placementExpiresAt: Date.now() - 1 }));
    await expect(runInternal(expire, { embedId: racing.embedId, placementOperationId: "w7-racing-operation" })).resolves.toMatchObject({ expired: true });
    expect(await t.run((ctx) => ctx.db.get(racing.embedId))).toBeNull();
  });
});
