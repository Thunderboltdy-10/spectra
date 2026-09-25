/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { listVersions } from "./spectraArtifacts";
import { snapshotHash } from "./artifactSnapshots";
import { observeDatabase, serializedBytes } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const ownerIdentity = { subject: "history-owner", email: "history-owner@example.test", emailVerified: true };
const readerIdentity = { subject: "history-reader", email: "history-reader@example.test", emailVerified: true };
const listHandler = (listVersions as unknown as {
  _handler: (ctx: QueryCtx, args: FunctionArgs<typeof api.spectraArtifacts.listVersions>) =>
    Promise<FunctionReturnType<typeof api.spectraArtifacts.listVersions>>;
})._handler;

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "History fixture", slug: "history-fixture", verifiedDomains: [],
      status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountIds = [];
    for (const identity of [ownerIdentity, readerIdentity]) {
      const accountId = await ctx.db.insert("accounts", {
        clerkId: identity.subject, email: identity.email, emailVerified: true,
        name: identity.subject, status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
      });
      accountIds.push(accountId);
    }
    const ownerId = accountIds[0]!;
    const readerId = accountIds[1]!;
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: ownerId, schoolId, blueprintKey: "document", title: "History",
      content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now,
    });
    return { now, schoolId, ownerId, readerId, artifactId };
  });
  const owner = t.withIdentity(ownerIdentity);
  const reader = t.withIdentity(readerIdentity);
  const insertVersion = (values: Partial<Omit<Doc<"spectraArtifactVersions">, "_id" | "_creationTime">> = {}) => t.run(ctx => ctx.db.insert("spectraArtifactVersions", {
    artifactId: ids.artifactId, ownerAccountId: ids.ownerId, schoolId: ids.schoolId,
    source: "manual", createdAt: ids.now, after: { title: "Saved", tags: [], content: {} }, ...values,
  }));
  const grantRead = () => t.run(ctx => ctx.db.insert("accessGrants", {
    schoolId: ids.schoolId, resourceType: "artifact", resourceId: ids.artifactId,
    principalType: "account", principalId: ids.readerId, level: "read", capabilities: ["read"],
    source: "direct", createdByAccountId: ids.ownerId, createdAt: ids.now, updatedAt: ids.now,
  }));
  return { t, ids, owner, reader, insertVersion, grantRead };
}

describe("bounded history and exact retained detail", () => {
  it("paginates beyond 100 versions including timestamp ties without overlaps or newer inserts leaking into older pages", async () => {
    const { ids, owner, insertVersion } = await fixture();
    const original: Id<"spectraArtifactVersions">[] = [];
    for (let i = 0; i < 125; i++) original.push(await insertVersion({ createdAt: ids.now + Math.floor(i / 3) }));
    let page = await owner.query(api.spectraArtifacts.listVersions, { artifactId: ids.artifactId, limit: 17 });
    expect(page.versions).toHaveLength(17);
    const seen = page.versions.map(version => version._id);
    const inserted = await insertVersion({ createdAt: ids.now + 1_000 });
    for (let step = 0; !page.isDone && step < 20; step++) {
      expect(page.continueCursor).toBeTruthy();
      page = await owner.query(api.spectraArtifacts.listVersions, {
        artifactId: ids.artifactId, limit: 17, cursor: page.continueCursor!,
      });
      expect(page.versions.length).toBeLessThanOrEqual(17);
      seen.push(...page.versions.map(version => version._id));
    }
    expect(page.isDone).toBe(true);
    expect(page.continueCursor).toBeNull();
    expect(new Set(seen).size).toBe(125);
    expect(new Set(seen)).toEqual(new Set(original));
    expect(seen).not.toContain(inserted);
  });

  it("does not read snapshot objects or older history to produce metadata, and accounts for legacy inline database bytes", async () => {
    const { t, ids, owner, insertVersion } = await fixture();
    const body = { title: "Large inline", tags: [], content: { text: "LEGACY_BODY".repeat(2_000) } };
    for (let i = 0; i < 8; i++) await insertVersion({ before: body, after: body, createdAt: ids.now + i, provenance: { internalBody: "PROVENANCE_BODY" } });
    const measure = () => owner.run(async ctx => {
      const observer = observeDatabase(ctx.db);
      const result = await listHandler({ ...ctx, db: observer.db }, { artifactId: ids.artifactId, limit: 4 });
      return { result, ...observer.snapshot() };
    });
    const before = await measure();
    await t.run(async ctx => {
      for (let i = 0; i < 200; i++) await ctx.db.insert("spectraArtifactVersions", {
        artifactId: ids.artifactId, ownerAccountId: ids.ownerId, schoolId: ids.schoolId,
        source: "manual", createdAt: ids.now - i - 1, before: body, after: body,
      });
    });
    const after = await measure();
    expect(after.result).toEqual(before.result);
    expect(after.serializedDocumentBytes).toBe(before.serializedDocumentBytes);
    const historyReads = after.reads.filter(read => read.table === "spectraArtifactVersions");
    expect(historyReads.reduce((count, read) => count + read.documentsReturned, 0)).toBe(4);
    expect(after.reads.some(read => read.table === "artifactSnapshotObjects")).toBe(false);
    expect(after.writes).toBe(0);
    expect(serializedBytes(after.result)).toBeLessThan(5_000);
    expect(historyReads.reduce((bytes, read) => bytes + read.serializedDocumentBytes, 0)).toBeGreaterThan(100_000);
    expect(JSON.stringify(after.result)).not.toMatch(/LEGACY_BODY|PROVENANCE_BODY/);
    for (const version of after.result.versions) {
      expect(version).not.toHaveProperty("before");
      expect(version).not.toHaveProperty("after");
      expect(version).not.toHaveProperty("versionNumber");
    }
  });

  it("preserves exact native provenance and spill references in selected detail without mutating history", async () => {
    const { t, ids, owner, insertVersion } = await fixture();
    const snapshot = {
      title: "Retained native", tags: [],
      content: { spectraContentRef: { version: 1, artifactId: ids.artifactId, payloadRef: "retained-body", digest: "b".repeat(64), byteLength: 900_000, path: "value" } },
      nativeSources: [{ sourcePayloadHash: "a".repeat(64) }],
    };
    const hash = await snapshotHash(snapshot);
    await t.run(ctx => ctx.db.insert("artifactSnapshotObjects", {
      schoolId: ids.schoolId, hash: hash.hash, strategy: "content_addressed", payload: snapshot,
      byteLength: hash.byteLength, refCount: 2, state: "hot", createdAt: ids.now, lastReferencedAt: ids.now,
    }));
    const provenance = { kind: "native_reconciliation", nativeBefore: ["c".repeat(64)], nativeAfter: "a".repeat(64), regionIds: ["document:p"] };
    const versionId = await insertVersion({ source: "import", after: undefined, snapshotStrategy: "content_addressed", snapshotRef: hash.hash, beforeSnapshotRef: hash.hash, provenance });
    const original = await t.run(ctx => ctx.db.get(versionId));
    const detail = await owner.query(api.spectraArtifacts.getVersion, { artifactId: ids.artifactId, versionId });
    expect(detail).toMatchObject({ _id: versionId, source: "import", snapshotState: "ready", before: snapshot, after: snapshot, provenance });
    expect(await t.run(ctx => ctx.db.get(versionId))).toEqual(original);
  });

  it.each(["missing", "corrupt"] as const)("keeps a %s snapshot visible in the list and marks only selected detail unavailable", async state => {
    const { t, ids, owner, insertVersion } = await fixture();
    const hash = "d".repeat(64);
    if (state === "corrupt") await t.run(ctx => ctx.db.insert("artifactSnapshotObjects", {
      schoolId: ids.schoolId, hash, strategy: "content_addressed", payload: {}, byteLength: 2,
      refCount: 1, state: "corrupt", createdAt: ids.now, lastReferencedAt: ids.now,
    }));
    const versionId = await insertVersion({ after: undefined, snapshotRef: hash });
    const page = await owner.query(api.spectraArtifacts.listVersions, { artifactId: ids.artifactId });
    expect(page.versions.map(version => version._id)).toEqual([versionId]);
    expect(page.versions[0]).not.toHaveProperty("snapshotState");
    const detail = await owner.query(api.spectraArtifacts.getVersion, { artifactId: ids.artifactId, versionId });
    expect(detail?.snapshotState).toBe(state === "corrupt" ? "corrupt" : "unavailable");
    expect(detail?.after).toBeUndefined();
  });

  it("checks current source authority for both endpoints and rejects a foreign version under an authorized artifact", async () => {
    const { t, ids, owner, reader, insertVersion, grantRead } = await fixture();
    const versionId = await insertVersion();
    const list = () => reader.query(api.spectraArtifacts.listVersions, { artifactId: ids.artifactId });
    const detail = () => reader.query(api.spectraArtifacts.getVersion, { artifactId: ids.artifactId, versionId });
    await expect(list()).rejects.toThrow("AUTH_RESOURCE_FORBIDDEN");
    await expect(detail()).rejects.toThrow("AUTH_RESOURCE_FORBIDDEN");
    const grantId = await grantRead();
    expect((await list()).versions).toHaveLength(1);
    expect(await detail()).toMatchObject({ _id: versionId });
    const foreignArtifactId = await t.run(ctx => ctx.db.insert("spectraArtifacts", {
      ownerAccountId: ids.readerId, schoolId: ids.schoolId, blueprintKey: "document", title: "Other source", content: {}, textIndex: "", tags: [], status: "active", createdAt: ids.now, updatedAt: ids.now,
    }));
    const foreignVersionId = await insertVersion({ artifactId: foreignArtifactId, ownerAccountId: ids.readerId });
    await expect(owner.query(api.spectraArtifacts.getVersion, { artifactId: ids.artifactId, versionId: foreignVersionId })).rejects.toThrow("ARTIFACT_VERSION_NOT_FOUND");
    await t.run(ctx => ctx.db.patch(grantId, { expiresAt: ids.now - 1 }));
    await expect(list()).rejects.toThrow("AUTH_RESOURCE_FORBIDDEN");
    await expect(detail()).rejects.toThrow("AUTH_RESOURCE_FORBIDDEN");
    await t.run(ctx => ctx.db.patch(ids.artifactId, { status: "deleted" }));
    await expect(owner.query(api.spectraArtifacts.listVersions, { artifactId: ids.artifactId })).rejects.toThrow("AUTH_RESOURCE_FORBIDDEN");
    await expect(owner.query(api.spectraArtifacts.getVersion, { artifactId: ids.artifactId, versionId })).rejects.toThrow("AUTH_RESOURCE_FORBIDDEN");
  });

  it("keeps quiz history hidden from read-only users and projects both timetable snapshots", async () => {
    const { t, ids, reader, owner, insertVersion, grantRead } = await fixture();
    await grantRead();
    const content = { timezone: "UTC", preferences: { secret: true }, layers: [
      { id: "school", authority: "school" }, { id: "personal", authority: "user" },
    ], events: [ { id: "shared", layerId: "school", overlay: { privateNote: true } }, { id: "private", layerId: "personal" } ] };
    const snapshot = { title: "Timetable", tags: [], content };
    const versionId = await insertVersion({ before: snapshot, after: snapshot });
    await t.run(ctx => ctx.db.patch(ids.artifactId, { blueprintKey: "quiz" }));
    expect(await reader.query(api.spectraArtifacts.listVersions, { artifactId: ids.artifactId })).toEqual({ versions: [], continueCursor: null, isDone: true });
    expect(await reader.query(api.spectraArtifacts.getVersion, { artifactId: ids.artifactId, versionId })).toBeNull();
    expect(await owner.query(api.spectraArtifacts.getVersion, { artifactId: ids.artifactId, versionId })).toMatchObject({ after: snapshot });
    await t.run(ctx => ctx.db.patch(ids.artifactId, { blueprintKey: "timetable" }));
    const detail = await reader.query(api.spectraArtifacts.getVersion, { artifactId: ids.artifactId, versionId });
    for (const projected of [detail?.before, detail?.after]) {
      expect(projected).toMatchObject({ content: { timezone: "UTC", events: [{ id: "shared", layerId: "school" }] } });
      expect(JSON.stringify(projected)).not.toMatch(/preferences|privateNote|personal|overlay/);
    }
  });
});
