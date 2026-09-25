/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { artifactPage, CATALOG_PLACEMENTS } from "./catalogPages";
import { upsertArtifactSummary } from "./orgTreeShared";
import { observeDatabase, serializedBytes } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "s11-catalog-reader", email: "s11-catalog@example.test", emailVerified: true };
beforeEach(() => vi.stubEnv("SPECTRA_SECRET_BRIDGE_KEY", "s11-catalog-disposable-fixture-key-123456789"));
afterEach(() => vi.unstubAllEnvs());

async function fixture(privateCount: number) {
  const t = convexTest(schema, modules);
  // Certify an empty initial catalog, then maintain every subsequently seeded
  // artifact through the real projection helper as post-migration writers do.
  await t.mutation(internal.spectraArtifacts.backfillSummaries, { cursor: null });
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "S11 catalog fixture", slug: "s11-catalog", verifiedDomains: [], status: "active",
      timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const account = (clerkId: string) => ({
      clerkId, email: `${clerkId}@example.test`, emailVerified: true, name: clerkId,
      status: "active" as const, createdAt: now, updatedAt: now,
    });
    const readerId = await ctx.db.insert("accounts", { ...account(identity.subject), email: identity.email });
    const ownerId = await ctx.db.insert("accounts", account("s11-catalog-owner"));
    await ctx.db.insert("schoolMemberships", {
      accountId: readerId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const workspace = (title: string) => ctx.db.insert("spectraWorkspaces", {
      ownerAccountId: ownerId, schoolId, title, status: "active", defaultView: "cards",
      createdAt: now, updatedAt: now, lastActivityAt: now,
    });
    const privateWorkspaceId = await workspace("Private context");
    const grant = (resourceType: "artifact" | "workspace", resourceId: string) => ctx.db.insert("accessGrants", {
      schoolId, resourceType, resourceId, principalType: "account", principalId: readerId,
      level: "read", capabilities: ["read"], source: "direct", createdByAccountId: ownerId,
      createdAt: now, updatedAt: now,
    });
    const artifact = async (title: string, updatedAt: number, ownerAccountId = ownerId) => {
      const id = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId, schoolId, blueprintKey: "document", title, content: { text: "Private body" },
        status: "active", tags: [], createdAt: 1, updatedAt,
      });
      await upsertArtifactSummary(ctx, (await ctx.db.get(id))!);
      return id;
    };
    const placement = (artifactId: Id<"spectraArtifacts">, workspaceId: Id<"spectraWorkspaces">) => ctx.db.insert("orgNodes", {
      accountId: ownerId, schoolId, parentId: null, kind: "work", sourceId: artifactId,
      name: "Synthetic placement", orderKey: String(artifactId), workspaceContextId: workspaceId,
      accessProjection: true, createdAt: 1, updatedAt: 1,
    });
    // Both private newer work and an inaccessible tail after the final visible
    // result must be traversed. All newer timestamps tie deliberately.
    const tailCount = Math.floor(privateCount / 8);
    for (let index = 0; index < privateCount + tailCount; index++) {
      const id = await artifact("Private work", index < privateCount ? 200 : 10);
      await placement(id, privateWorkspaceId);
    }
    const ownedId = await artifact("Owned unplaced work", 100, readerId);
    const inheritedId = await artifact("Inherited late placement", 90);
    let inheritedGrantId: Id<"accessGrants"> | undefined;
    for (let index = 0; index < 18; index++) {
      const workspaceId = await workspace(`Inherited placement ${index}`);
      await placement(inheritedId, workspaceId);
      if (index === 17) inheritedGrantId = await grant("workspace", workspaceId);
    }
    const directId = await artifact("Direct unplaced share", 80);
    const directGrantId = await grant("artifact", directId);
    return { privateCount, tailCount, readerId, ownedId, inheritedId, directId, inheritedGrantId: inheritedGrantId!, directGrantId };
  });
  const user = t.withIdentity(identity);
  const page = (cursor?: string, limit = 24) => user.run(async ctx => {
    const observer = observeDatabase(ctx.db);
    const result = await artifactPage({ ...ctx, db: observer.db }, { scope: "school", cursor, limit });
    return { result, responseBytes: serializedBytes(result), ...observer.snapshot() };
  });
  return { t, ids, page };
}

async function traverse(f: Awaited<ReturnType<typeof fixture>>) {
  const start = performance.now();
  let cursor: string | undefined;
  let firstVisible: { request: number; elapsedMs: number } | null = null;
  const found: string[] = [];
  const stats = { requests: 0, calls: 0, documents: 0, rowBytes: 0, responseBytes: 0, maxPlacementRows: 0, maxPaginations: 0 };
  let done = false;
  while (!done && stats.requests < f.ids.privateCount + f.ids.tailCount + 20) {
    const measurement = await f.page(cursor);
    stats.requests++;
    stats.calls += measurement.calls;
    stats.documents += measurement.documentsReturned;
    stats.rowBytes += measurement.serializedDocumentBytes;
    stats.responseBytes += measurement.responseBytes;
    stats.maxPlacementRows = Math.max(stats.maxPlacementRows, measurement.reads
      .filter(read => read.table === "orgNodes").reduce((sum, read) => sum + read.documentsReturned, 0));
    stats.maxPaginations = Math.max(stats.maxPaginations, measurement.reads.filter(read => read.operation === "paginate").length);
    expect(measurement.writes).toBe(0);
    if (measurement.result.items.length && !firstVisible) firstVisible = { request: stats.requests, elapsedMs: performance.now() - start };
    found.push(...measurement.result.items.map(item => String(item._id)));
    done = measurement.result.isDone;
    if (!done) {
      expect(measurement.result.continueCursor).toBeTruthy();
      expect(measurement.result.continueCursor).not.toBe(cursor);
      cursor = measurement.result.continueCursor!;
    }
  }
  expect(done).toBe(true);
  expect(found).toEqual([f.ids.ownedId, f.ids.inheritedId, f.ids.directId]);
  expect(new Set(found).size).toBe(3);
  expect(stats.maxPlacementRows).toBeLessThanOrEqual(CATALOG_PLACEMENTS);
  expect(stats.maxPaginations).toBeLessThanOrEqual(1);
  return { ...stats, firstVisible, elapsedMs: performance.now() - start, visibleCount: found.length };
}

describe("S11 complete sparse catalog traversal", () => {
  it("measures first-visible and complete traversal, retaining direct and late inherited shares", async () => {
    const samples = [];
    for (const privateCount of [128, 1_024]) {
      const f = await fixture(privateCount);
      samples.push({ privateCount, tailCount: f.ids.tailCount, ...await traverse(f) });
    }
    const label = process.env.SPECTRA_S11_CATALOG_EVIDENCE;
    if (label === "before" || label === "after") {
      const directory = ".spectra-local/launch-s11/data";
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${directory}/catalog-traversal-${label}.json`, JSON.stringify({
        evidence: "Complete actual-handler traversal in convex-test; returned-row JSON bytes and local timings, not hosted scans, billing, or browser latency.",
        sourceSha256: createHash("sha256").update(readFileSync("convex/catalogPages.ts")).digest("hex"), samples,
      }, null, 2));
    }
    // A full result with fewer requests matters; a cheap empty prefix does not.
    // This budget deliberately allows variation in page packing instead of
    // requiring the implementation's exact candidate/placement loop shape.
    for (const sample of samples) {
      expect(sample.firstVisible!.request).toBeLessThan(sample.privateCount / 2);
      expect(sample.requests).toBeLessThan((sample.privateCount + sample.tailCount) / 2);
    }
  }, 120_000);

  it("replays and resumes a pending inherited lookup with current permission and source truth", async () => {
    const f = await fixture(6);
    let cursor: string | undefined;
    let pendingCursor: string | undefined;
    for (let request = 0; request < 12; request++) {
      const measurement = await f.page(cursor);
      // Find the actual native placement continuation without decoding or
      // depending on private cursor structure. The inherited item is not yet
      // visible, but its placement query has returned a nonfinal page.
      if (measurement.reads.some(read => read.table === "orgNodes" && read.operation === "paginate") &&
          !measurement.result.items.some(item => item._id === f.ids.inheritedId)) {
        pendingCursor = measurement.result.continueCursor!;
        break;
      }
      cursor = measurement.result.continueCursor!;
    }
    expect(pendingCursor).toBeTruthy();
    const first = await f.page(pendingCursor);
    const replay = await f.page(pendingCursor);
    expect(replay.result).toEqual(first.result);
    await f.t.run(ctx => ctx.db.patch(f.ids.inheritedGrantId, { revokedAt: Date.now() }));
    const found: string[] = [];
    cursor = pendingCursor;
    for (let request = 0; request < 10; request++) {
      const next = await f.page(cursor);
      found.push(...next.result.items.map(item => String(item._id)));
      if (next.result.isDone) break;
      cursor = next.result.continueCursor!;
    }
    expect(found).not.toContain(f.ids.inheritedId);
    expect(found).toContain(f.ids.directId);
    // A pending source can also disappear. Continue past it rather than
    // returning stale metadata or keeping the cursor stuck on that source.
    await f.t.run(async ctx => {
      const row = await ctx.db.query("spectraArtifactSummaries").withIndex("by_artifact", q => q.eq("artifactId", f.ids.inheritedId)).unique();
      await ctx.db.delete(row!._id);
      await ctx.db.delete(f.ids.inheritedId);
    });
    const missing = await f.page(pendingCursor);
    expect(missing.result.items.some(item => item._id === f.ids.inheritedId)).toBe(false);
    if (!missing.result.isDone) expect(missing.result.continueCursor).not.toBe(pendingCursor);
    await f.t.run(ctx => ctx.db.patch(f.ids.readerId, { status: "deactivated" }));
    await expect(f.page(pendingCursor)).rejects.toThrow();
  });
});
