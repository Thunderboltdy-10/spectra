/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getArtifact } from "./spectraContext";
import { upsertArtifactSummary } from "./orgTreeShared";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const artifactQuery = makeFunctionReference<"query">("spectraContext:getArtifact");
const workspaceQuery = makeFunctionReference<"query">("spectraContext:getWorkspace");
const artifactHandler = Reflect.get(getArtifact, "_handler") as (
  ctx: QueryCtx, args: { artifactId: Id<"spectraArtifacts"> },
) => Promise<unknown>;

async function fixture() {
  const t = convexTest(schema, modules);
  const identity = { subject: crypto.randomUUID(), email: "reader@orientation.test", emailVerified: true };
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Orientation", slug: crypto.randomUUID(), verifiedDomains: [], status: "active",
      timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const ownerId = await ctx.db.insert("accounts", {
      clerkId: crypto.randomUUID(), email: "owner@orientation.test", emailVerified: true,
      name: "Owner", status: "active", createdAt: now, updatedAt: now,
    });
    const readerId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true,
      name: "Reader", status: "active", createdAt: now, updatedAt: now,
    });
    for (const accountId of [ownerId, readerId]) await ctx.db.insert("schoolMemberships", {
      accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const workspaceId = await ctx.db.insert("spectraWorkspaces", {
      ownerAccountId: ownerId, schoolId, title: "Research", status: "active", defaultView: "cards",
      lastActivityAt: now, createdAt: now, updatedAt: now,
    });
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: ownerId, schoolId, blueprintKey: "document", title: "Research notes",
      summary: "Fieldwork observations", content: { text: "private editor body" }, tags: [],
      status: "active", createdAt: now, updatedAt: now,
    });
    const grantId = await ctx.db.insert("accessGrants", {
      schoolId, resourceType: "workspace", resourceId: workspaceId,
      principalType: "account", principalId: readerId, level: "read", capabilities: ["read"],
      source: "direct", createdByAccountId: ownerId, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("orgNodes", {
      accountId: ownerId, schoolId, parentId: null, kind: "work", name: "Research notes",
      sourceId: artifactId, orderKey: "a0", typeKey: "document", workspaceContextId: workspaceId,
      placedByAccountId: ownerId, accessProjection: true, createdAt: now, updatedAt: now,
    });
    await upsertArtifactSummary(ctx, (await ctx.db.get(artifactId))!);
    return { artifactId, workspaceId, grantId, ownerId, readerId, schoolId };
  });
  return { t, reader: t.withIdentity(identity), ...ids };
}

describe("exact-reference context orientation", () => {
  it("uses inherited read authority and reacts to revocation without stale metadata", async () => {
    const f = await fixture();
    const artifact = await f.reader.query(artifactQuery, { artifactId: f.artifactId });
    expect(artifact).toMatchObject({ _id: f.artifactId, title: "Research notes", contentAvailable: false });
    expect(JSON.stringify(artifact)).not.toContain("private editor body");
    expect(await f.reader.query(workspaceQuery, { workspaceId: f.workspaceId })).toMatchObject({
      workspace: { _id: f.workspaceId, title: "Research" }, items: [], contentAvailable: false,
    });
    await f.t.run((ctx) => ctx.db.patch(f.grantId, { revokedAt: Date.now() }));
    expect(await f.reader.query(artifactQuery, { artifactId: f.artifactId })).toBeNull();
    expect(await f.reader.query(workspaceQuery, { workspaceId: f.workspaceId })).toBeNull();
    await f.t.run((ctx) => ctx.db.patch(f.grantId, { revokedAt: undefined }));
    expect(await f.reader.query(artifactQuery, { artifactId: f.artifactId })).toMatchObject({ _id: f.artifactId });
  });

  it("authorizes exact unplaced references and denies expired grants and deleted artifacts", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const nodes = await ctx.db.query("orgNodes").collect();
      for (const node of nodes) await ctx.db.delete(node._id);
      await ctx.db.patch(f.grantId, { resourceType: "artifact", resourceId: f.artifactId });
    });
    expect(await f.reader.query(artifactQuery, { artifactId: f.artifactId })).toMatchObject({ _id: f.artifactId });
    await f.t.run((ctx) => ctx.db.patch(f.grantId, { expiresAt: Date.now() - 1 }));
    expect(await f.reader.query(artifactQuery, { artifactId: f.artifactId })).toBeNull();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.grantId, { expiresAt: undefined });
      await ctx.db.patch(f.artifactId, { status: "deleted" });
      await upsertArtifactSummary(ctx, (await ctx.db.get(f.artifactId))!);
    });
    expect(await f.reader.query(artifactQuery, { artifactId: f.artifactId })).toBeNull();
  });

  it("preserves centralized cross-school direct-grant authority without inheriting it", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "External collaborators", slug: crypto.randomUUID(), verifiedDomains: [], status: "active",
        timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now,
      });
      const membership = await ctx.db.query("schoolMemberships").filter((q) => q.eq(q.field("accountId"), f.readerId)).unique();
      await ctx.db.patch(membership!._id, { schoolId });
    });
    // Cross-school workspace access is an exact direct invitation, but cannot
    // project that grant to the workspace's artifacts.
    expect(await f.reader.query(workspaceQuery, { workspaceId: f.workspaceId })).not.toBeNull();
    expect(await f.reader.query(artifactQuery, { artifactId: f.artifactId })).toBeNull();
    await f.t.run((ctx) => ctx.db.patch(f.grantId, { resourceType: "artifact", resourceId: f.artifactId }));
    expect(await f.reader.query(artifactQuery, { artifactId: f.artifactId })).toMatchObject({ _id: f.artifactId });
  });

  it("keeps database row bytes independent of a large editor body", async () => {
    const f = await fixture();
    const measure = () => f.reader.run(async (ctx) => {
      const observer = observeDatabase(ctx.db);
      const result = await artifactHandler({ ...ctx, db: observer.db }, { artifactId: f.artifactId });
      return { result, ...observer.snapshot() };
    });
    const small = await measure();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.artifactId, { content: { text: "large body ".repeat(20_000) } });
      await upsertArtifactSummary(ctx, (await ctx.db.get(f.artifactId))!);
    });
    const large = await measure();
    expect(large.result).toEqual(small.result);
    expect(large.serializedDocumentBytes).toBe(small.serializedDocumentBytes);
    expect(large.documentsReturned).toBe(small.documentsReturned);
    expect(large.writes).toBe(0);
    console.info("S11 orientation read ledger", JSON.stringify({
      calls: large.calls, documentsReturned: large.documentsReturned,
      smallBytes: small.serializedDocumentBytes, largeBytes: large.serializedDocumentBytes,
    }));
  });

  it("keeps legacy objects readable while reporting absent metadata honestly", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const summary = await ctx.db.query("spectraArtifactSummaries").withIndex("by_artifact", (q) => q.eq("artifactId", f.artifactId)).unique();
      await ctx.db.delete(summary!._id);
    });
    expect(await f.reader.query(artifactQuery, { artifactId: f.artifactId })).toMatchObject({
      _id: f.artifactId, title: "Research notes", contentAvailable: false,
    });
    await f.t.run(async (ctx) => {
      await upsertArtifactSummary(ctx, (await ctx.db.get(f.artifactId))!);
      const summary = await ctx.db.query("spectraArtifactSummaries").withIndex("by_artifact", (q) => q.eq("artifactId", f.artifactId)).unique();
      await ctx.db.patch(summary!._id, { projection: {} });
    });
    expect(await f.reader.query(artifactQuery, { artifactId: f.artifactId })).toMatchObject({
      _id: f.artifactId, title: "", metadataIncomplete: true, contentAvailable: false,
    });
  });
});
