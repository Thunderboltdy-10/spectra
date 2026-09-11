import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "m01-boundary", email: "m01-boundary@example.test", emailVerified: true };

async function fixture(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "M01", slug: crypto.randomUUID(), verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: identity.subject, email: identity.email, emailVerified: true, name: "M01", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", schemaVersion: 2, title: "Disposable", content: { blocks: [] }, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
    return { schoolId, accountId, artifactId, now };
  });
}

describe("M01 parent boundary regressions", () => {
  it("does not lose equal-timestamp messages", async () => {
    const t = convexTest(schema, modules); const f = await fixture(t);
    const threadId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("spectraThreads", { ownerAccountId: f.accountId, schoolId: f.schoolId, title: "Same time", origin: "chat", status: "active", messageCount: 40, createdAt: f.now, updatedAt: f.now });
      for (let i = 0; i < 40; i += 1) await ctx.db.insert("spectraMessages", { threadId: id, schoolId: f.schoolId, role: "user", content: `message-${i}`, createdAt: f.now });
      return id;
    });
    const initial = await t.withIdentity(identity).query(api.spectraThreads.get, { threadId });
    const older = await t.withIdentity(identity).query(api.spectraThreads.listMessages, { threadId, before: initial.messagePage.olderBefore, limit: 48 });
    expect(new Set([...initial.messages, ...older.messages].map((row) => row._id)).size).toBe(40);
  });

  it("advances resumable metadata backfill", async () => {
    const t = convexTest(schema, modules); const f = await fixture(t);
    for (let i = 0; i < 21; i += 1) await t.run((ctx) => ctx.db.insert("spectraThreads", { ownerAccountId: f.accountId, schoolId: f.schoolId, title: `Legacy ${i}`, origin: "chat", status: "active", createdAt: f.now + i, updatedAt: f.now + i }));
    let cursor: string | null = null;
    for (let i = 0; i < 4; i += 1) { const page: { nextCursor?: string | null } = await t.mutation(internal.spectraThreads.backfillReadMetadata, { limit: 10, ...(cursor ? { cursor } : {}) }); cursor = page.nextCursor ?? null; }
    const remaining = await t.run(async (ctx) => (await ctx.db.query("spectraThreads").collect()).filter((row) => row.readSchemaVersion !== 1).length);
    expect(remaining).toBe(0);
  });

  it("hides a deletion job from a different account", async () => {
    const t = convexTest(schema, modules); const f = await fixture(t);
    const jobId = await t.run(async (ctx) => ctx.db.insert("artifactDeletionJobs", { artifactId: f.artifactId, ownerAccountId: f.accountId, schoolId: f.schoolId, generation: 1, phase: "failed", lastError: "private", deletedRows: 0, releasedBytes: 0, createdAt: f.now, updatedAt: f.now }));
    const peer = { subject: "m01-peer", email: "m01-peer@example.test", emailVerified: true };
    await t.run(async (ctx) => { const accountId = await ctx.db.insert("accounts", { clerkId: peer.subject, email: peer.email, emailVerified: true, name: "Peer", status: "active", createdAt: f.now, updatedAt: f.now }); await ctx.db.insert("schoolMemberships", { accountId, schoolId: f.schoolId, role: "student", status: "active", joinedAt: f.now, createdAt: f.now, updatedAt: f.now }); });
    const status = (api as unknown as { spectraArtifactDeletion: { status: typeof api.spectraThreads.get } }).spectraArtifactDeletion.status;
    await expect(t.withIdentity(peer).query(status, { jobId } as never)).rejects.toThrow("DELETION_NOT_FOUND");
  });

  it("confirms a provisional embed only from matching canonical content", async () => {
    const t = convexTest(schema, modules); const f = await fixture(t);
    const setup = await t.run(async (ctx) => {
      const now = Date.now();
      const sourceArtifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: f.accountId, schoolId: f.schoolId, blueprintKey: "document", schemaVersion: 2, title: "Source", content: { blocks: [] }, textIndex: "Source", tags: [], status: "active", createdAt: now, updatedAt: now });
      const embedId = await ctx.db.insert("artifactEmbeds", { containerType: "artifact", containerId: String(f.artifactId), containerRegionId: "artifact:root", sourceArtifactId, schoolId: f.schoolId, mode: "compact", interaction: "read", versionPolicy: "live", contextPolicy: "summary", createdByAccountId: f.accountId, placementOperationId: "m01-placement", placementState: "provisional", createdAt: now, updatedAt: now });
      const invalidVersionId = await ctx.db.insert("spectraArtifactVersions", { artifactId: f.artifactId, ownerAccountId: f.accountId, schoolId: f.schoolId, source: "manual", schemaVersion: 2, after: { blocks: [{ embedId: String(embedId), placementOperationId: "wrong", containerRegionId: "artifact:root" }] }, createdAt: now });
      return { embedId, invalidVersionId };
    });
    await expect(t.withIdentity(identity).mutation(api.artifactEmbeds.confirmPlacement, { embedId: setup.embedId, placementOperationId: "m01-placement", canonicalVersionId: setup.invalidVersionId })).rejects.toThrow("EMBED_CANONICAL_RECEIPT_INVALID");
    const validVersionId = await t.run(async (ctx) => ctx.db.insert("spectraArtifactVersions", { artifactId: f.artifactId, ownerAccountId: f.accountId, schoolId: f.schoolId, source: "manual", schemaVersion: 2, after: { blocks: [{ embedId: String(setup.embedId), placementOperationId: "m01-placement", containerRegionId: "artifact:root" }] }, createdAt: Date.now() }));
    await t.withIdentity(identity).mutation(api.artifactEmbeds.confirmPlacement, { embedId: setup.embedId, placementOperationId: "m01-placement", canonicalVersionId: validVersionId });
    const embed = await t.run((ctx) => ctx.db.get(setup.embedId));
    expect(embed?.placementState).toBe("confirmed");
    expect(embed?.placementReceipt).toBe(`canonical-version:${String(validVersionId)}`);
  });

  it("drains paginated terminal Bridge requests without looping", async () => {
    const t = convexTest(schema, modules); const f = await fixture(t);
    const jobId = await t.run(async (ctx) => {
      const deviceId = await ctx.db.insert("bridgeDevices", { accountId: f.accountId, name: "M01 device", platform: "test", credentialHash: "m01-credential", protocolVersion: "1", appVersion: "1", pairedAt: f.now, lastSeenAt: f.now, state: "active" });
      const mountId = await ctx.db.insert("bridgeMounts", { accountId: f.accountId, deviceId, rootLabel: "M01", grantId: "m01-grant", state: "active", fileCount: 0, doubleSyncRisk: false, createdAt: f.now, updatedAt: f.now });
      const replicaId = await ctx.db.insert("workReplicas", { accountId: f.accountId, workId: f.artifactId, kind: "local", deviceId, mountId, localResourceId: "m01-resource", relativePath: "disposable.md", nativeFormat: "markdown", revision: "r1", state: "current", updatedAt: f.now });
      for (let i = 0; i < 65; i += 1) await ctx.db.insert("bridgeWriteRequests", { accountId: f.accountId, workId: f.artifactId, replicaId, deviceId, mountId, localResourceId: `m01-resource-${i}`, relativePath: `disposable-${i}.md`, payloadRef: `payload:m01-terminal-${i}`, baseRevision: "r0", targetRevision: "r1", contentHash: "hash", idempotencyKey: `m01-terminal-${i}`, regionIds: [], partNames: [], state: "failed", createdAt: f.now + i, updatedAt: f.now + i });
      await ctx.db.patch(f.artifactId, { status: "deleted", deletionGeneration: 1 });
      return ctx.db.insert("artifactDeletionJobs", { artifactId: f.artifactId, ownerAccountId: f.accountId, schoolId: f.schoolId, generation: 1, phase: "children", deletedRows: 0, releasedBytes: 0, createdAt: f.now, updatedAt: f.now, cursor: Buffer.from(JSON.stringify({ family: "requests" }), "utf8").toString("base64url") });
    });
    const process = (internal as unknown as { spectraArtifactDeletion: { process: unknown } }).spectraArtifactDeletion.process as never;
    const runInternal = (t as unknown as { mutation: (fn: unknown, args: unknown) => Promise<unknown> }).mutation.bind(t);
    for (let i = 0; i < 40; i += 1) await runInternal(process, { jobId, generation: 1 });
    const result = await t.run(async (ctx) => ({ job: await ctx.db.get(jobId), requests: await ctx.db.query("bridgeWriteRequests").collect() }));
    const job = result.job;
    expect(job?.phase).toBe("complete");
    expect(result.requests).toHaveLength(65);
    expect(result.requests.every((request) => request.state === "failed")).toBe(true);
  });
});
