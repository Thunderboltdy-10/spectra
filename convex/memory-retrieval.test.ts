/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import type { FunctionReturnType } from "convex/server";
import { listMine } from "./memory";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const listMineHandler = Reflect.get(listMine, "_handler") as (
  ctx: QueryCtx, args: Record<string, never>,
) => Promise<FunctionReturnType<typeof api.memory.listMine>>;

async function fixture() {
  const t = convexTest(schema, modules);
  const identities = ["author", "reader"].map((name) => ({
    subject: `memory-${name}-${crypto.randomUUID()}`,
    email: `${name}@memory.example.test`,
    emailVerified: true,
  }));
  const data = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Memory source authority", slug: crypto.randomUUID(),
      verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1,
      createdAt: now, updatedAt: now,
    });
    const accounts: Id<"accounts">[] = [];
    for (const identity of identities) {
      const accountId = await ctx.db.insert("accounts", {
        clerkId: identity.subject, email: identity.email, emailVerified: true,
        name: identity.subject, status: "active", createdAt: now, updatedAt: now,
      });
      accounts.push(accountId);
      await ctx.db.insert("schoolMemberships", {
        accountId, schoolId, role: "student", status: "active",
        joinedAt: now, createdAt: now, updatedAt: now,
      });
    }
    const workspaceId = await ctx.db.insert("spectraWorkspaces", {
      ownerAccountId: accounts[0], schoolId, title: "Shared research",
      status: "active", defaultView: "cards", lastActivityAt: now,
      createdAt: now, updatedAt: now,
    });
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: accounts[0], schoolId, blueprintKey: "document",
      title: "Research source", content: { blocks: [] }, tags: [],
      status: "active", createdAt: now, updatedAt: now,
    });
    const grantId = await ctx.db.insert("accessGrants", {
      schoolId, resourceType: "artifact", resourceId: artifactId,
      principalType: "account", principalId: accounts[1], level: "read",
      capabilities: ["read"], source: "direct", createdByAccountId: accounts[0],
      createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("accessGrants", {
      schoolId, resourceType: "workspace", resourceId: workspaceId,
      principalType: "account", principalId: accounts[1], level: "read",
      capabilities: ["read"], source: "direct", createdByAccountId: accounts[0],
      createdAt: now, updatedAt: now,
    });
    return { schoolId, authorId: accounts[0], readerId: accounts[1], workspaceId, artifactId, grantId };
  });
  return { t, author: t.withIdentity(identities[0]), reader: t.withIdentity(identities[1]), ...data };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function derivedMemory(f: Fixture) {
  return f.reader.mutation(api.memory.remember, {
    proposition: "The heliostat experiment uses a silver reflector.",
    scope: "private_global", claimType: "declared_fact",
    sourceType: "artifact", sourceId: f.artifactId,
  });
}

async function visibleMemory(f: Fixture) {
  const [list, exported, context] = await Promise.all([
    f.reader.query(api.memory.listMine, {}),
    f.reader.query(api.memory.exportMine, {}),
    f.reader.query(internal.memory.contextForRunBase, { queryText: "heliostat reflector" }),
  ]);
  return { list: list.claims, exported: exported.claims, context: context.selectedClaimIds };
}

describe("memory source authority across retrieval and user projections", () => {
  it("hides source-derived content immediately on revocation and recovers on regrant", async () => {
    const f = await fixture();
    const { claimId } = await derivedMemory(f);
    const before = await visibleMemory(f);
    expect(before.list.map((claim) => claim._id)).toContain(claimId);
    expect(before.exported.map((claim) => claim._id)).toContain(claimId);
    expect(before.context).toContain(claimId);

    await f.t.run((ctx) => ctx.db.patch(f.grantId, { revokedAt: Date.now() }));
    const revoked = await visibleMemory(f);
    expect(revoked.list).toEqual([]);
    expect(revoked.exported).toEqual([]);
    expect(revoked.context).toEqual([]);
    // Revocation does not destroy memory or rely on an asynchronous index sweep.
    const stored = await f.t.run(async (ctx) => ({
      claim: await ctx.db.get(claimId),
      evidence: await ctx.db.query("memoryEvidence").withIndex("by_claim_created", (q) => q.eq("claimId", claimId)).first(),
    }));
    expect(stored.claim?.status).toBe("active");
    expect(stored.evidence?.accessStatus).toBe("available");

    await f.t.run((ctx) => ctx.db.patch(f.grantId, { revokedAt: undefined }));
    const restored = await visibleMemory(f);
    expect(restored.list.map((claim) => claim._id)).toContain(claimId);
    expect(restored.exported.map((claim) => claim._id)).toContain(claimId);
    expect(restored.context).toContain(claimId);
  });

  it.each(["deleted", "expired"] as const)("excludes evidence when its source is %s without an index update", async (reason) => {
    const f = await fixture();
    await derivedMemory(f);
    await f.t.run(async (ctx) => {
      if (reason === "deleted") await ctx.db.patch(f.artifactId, { status: "deleted" });
      else await ctx.db.patch(f.grantId, { expiresAt: Date.now() - 1 });
    });
    expect(await visibleMemory(f)).toEqual({ list: [], exported: [], context: [] });
  });

  it("preserves explicitly authored memory when an additional source becomes unavailable", async () => {
    const f = await fixture();
    const { claimId } = await derivedMemory(f);
    const authored = await f.reader.mutation(api.memory.remember, {
      proposition: "The heliostat experiment uses a silver reflector.",
      scope: "private_global", claimType: "declared_fact",
    });
    expect(authored.claimId).toBe(claimId);
    await f.t.run((ctx) => ctx.db.patch(f.grantId, { revokedAt: Date.now() }));
    const result = await visibleMemory(f);
    expect(result.list.map((claim) => claim._id)).toEqual([claimId]);
    expect(result.exported.map((claim) => claim._id)).toEqual([claimId]);
    expect(result.context).toContain(claimId);
    for (const claim of [...result.list, ...result.exported]) {
      expect(claim.evidence.map((evidence) => evidence.sourceType)).toEqual(["user_statement"]);
      expect(JSON.stringify(claim)).not.toContain(f.artifactId);
    }
  });

  it("does not disclose private source previews through a shared workspace claim", async () => {
    const f = await fixture();
    const { claimId } = await f.author.mutation(api.memory.remember, {
      proposition: "The research workspace uses concise source summaries.",
      scope: "workspace", workspaceId: f.workspaceId, claimType: "workspace_convention",
    });
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.grantId, { revokedAt: Date.now() });
      await ctx.db.insert("memoryEvidence", {
        claimId, accountId: f.authorId, schoolId: f.schoolId,
        sourceType: "artifact", sourceId: f.artifactId, sourceVersionId: "private-version",
        excerptHash: "fixture-hash", excerptPreview: "CONFIDENTIAL source excerpt",
        captureReason: "Private supporting source", accessStatus: "available",
        observedAt: Date.now(), createdAt: Date.now(),
      });
    });
    const list = await f.reader.query(api.memory.listMine, { scope: "workspace" });
    expect(list.claims.map((claim) => claim._id)).toEqual([claimId]);
    expect(list.claims[0].evidence.map((item) => item.sourceType)).toEqual(["user_statement"]);
    expect(JSON.stringify(list)).not.toContain("CONFIDENTIAL");
    expect(JSON.stringify(list)).not.toContain(f.artifactId);
  });

  it("keeps an explicit correction after the earlier supporting source is revoked", async () => {
    const f = await fixture();
    const original = await derivedMemory(f);
    const corrected = await f.reader.mutation(api.memory.correct, {
      claimId: original.claimId, proposition: "The heliostat experiment uses an aluminium reflector.",
    });
    await f.t.run((ctx) => ctx.db.patch(f.grantId, { revokedAt: Date.now() }));
    const result = await visibleMemory(f);
    expect(result.list.map((claim) => claim._id)).toEqual([corrected.claimId]);
    expect(result.exported.map((claim) => claim._id)).toEqual([corrected.claimId]);
    expect(result.context).toEqual([corrected.claimId]);
  });

  it("preserves an authored statement behind more than twelve stale source records", async () => {
    const f = await fixture();
    const { claimId } = await f.reader.mutation(api.memory.remember, {
      proposition: "The heliostat experiment uses a silver reflector.",
      scope: "private_global", claimType: "declared_fact",
    });
    await f.t.run(async (ctx) => {
      const now = Date.now();
      for (let index = 0; index < 20; index += 1) {
        await ctx.db.insert("memoryEvidence", {
          claimId, accountId: f.readerId, schoolId: f.schoolId,
          sourceType: "artifact", sourceId: f.artifactId,
          excerptHash: `stale-${index}`, accessStatus: "available",
          captureReason: "Repeated source confirmation", observedAt: now,
          createdAt: now + index + 1,
        });
      }
      await ctx.db.patch(f.grantId, { revokedAt: now });
    });
    const result = await visibleMemory(f);
    expect(result.list.map((claim) => claim._id)).toEqual([claimId]);
    expect(result.exported.map((claim) => claim._id)).toEqual([claimId]);
    expect(result.context).toEqual([claimId]);
    expect(result.list[0].evidence.map((item) => item.sourceType)).toEqual(["user_statement"]);
  });

  it("keeps source authorization reads bounded when evidence history grows", async () => {
    const f = await fixture();
    const { claimId } = await f.reader.mutation(api.memory.remember, {
      proposition: "The heliostat experiment uses a silver reflector.",
      scope: "private_global", claimType: "declared_fact",
    });
    const append = (count: number, createdAt: number) => f.t.run(async (ctx) => {
      for (let index = 0; index < count; index += 1) await ctx.db.insert("memoryEvidence", {
        claimId, accountId: f.readerId, schoolId: f.schoolId, sourceType: "artifact",
        sourceId: f.artifactId, excerptHash: "source", accessStatus: "available",
        captureReason: "Source confirmation", observedAt: createdAt, createdAt,
      });
    });
    const now = Date.now();
    await append(20, now + 100);
    await f.t.run((ctx) => ctx.db.patch(f.grantId, { revokedAt: now }));
    const measure = () => f.reader.run(async (ctx) => {
      const observer = observeDatabase(ctx.db);
      const result = await listMineHandler({ ...ctx, db: observer.db }, {});
      const reads = observer.snapshot();
      return { result, ...reads, evidenceReads: reads.reads.filter((row) => row.table === "memoryEvidence") };
    });
    const small = await measure();
    await append(200, now + 50);
    const large = await measure();
    expect(large.result.claims.map((claim) => claim._id)).toEqual([claimId]);
    expect(large.result.claims[0].evidence.map((item) => item.sourceType)).toEqual(["user_statement"]);
    expect(large.result).toEqual(small.result);
    expect(large.evidenceReads).toEqual(small.evidenceReads);
    expect(large.documentsReturned).toEqual(small.documentsReturned);
    expect(large.serializedDocumentBytes).toEqual(small.serializedDocumentBytes);
    expect(large.writes).toBe(0);
    expect(large.evidenceReads.every((read) => !read.postIndexFilter)).toBe(true);
    console.info("S11 memory evidence read ledger", JSON.stringify({
      smallEvidenceHistory: 21, largeEvidenceHistory: 221,
      calls: large.calls, documentsReturned: large.documentsReturned,
      serializedDocumentBytes: large.serializedDocumentBytes, evidenceReads: large.evidenceReads,
    }));
  });

  it("fails closed for malformed source IDs without breaking other memory reads", async () => {
    const f = await fixture();
    await f.reader.mutation(api.memory.remember, {
      proposition: "A malformed heliostat source must not become context.",
      scope: "private_global", claimType: "declared_fact", sourceType: "workspace",
      sourceId: "not-a-workspace-id",
    });
    expect(await visibleMemory(f)).toEqual({ list: [], exported: [], context: [] });
  });

  it("rechecks inherited artifact access after a workspace placement is removed", async () => {
    const f = await fixture();
    const { claimId } = await derivedMemory(f);
    const nodeId = await f.t.run(async (ctx) => {
      await ctx.db.patch(f.grantId, { revokedAt: Date.now() });
      return ctx.db.insert("orgNodes", {
        accountId: f.authorId, schoolId: f.schoolId, parentId: null, kind: "work",
        name: "Inherited source", sourceId: f.artifactId, orderKey: "a0", typeKey: "document",
        workspaceContextId: f.workspaceId, placedByAccountId: f.authorId,
        accessProjection: true, createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    expect((await visibleMemory(f)).context).toEqual([claimId]);
    await f.t.run((ctx) => ctx.db.patch(nodeId, { deletedAt: Date.now() }));
    expect(await visibleMemory(f)).toEqual({ list: [], exported: [], context: [] });
  });

  it("excludes another author's private thread evidence despite shared claim scope", async () => {
    const f = await fixture();
    const threadId = await f.t.run((ctx) => ctx.db.insert("spectraThreads", {
      ownerAccountId: f.authorId, schoolId: f.schoolId, title: "Private deliberation",
      origin: "chat", status: "active", createdAt: Date.now(), updatedAt: Date.now(),
    }));
    const { claimId } = await f.author.mutation(api.memory.remember, {
      proposition: "The heliostat experiment uses a silver reflector.",
      scope: "workspace", workspaceId: f.workspaceId, claimType: "declared_fact",
      sourceType: "thread", sourceId: threadId,
    });
    const author = await f.author.query(api.memory.listMine, {});
    expect(author.claims.map((claim) => claim._id)).toContain(claimId);
    expect((await f.reader.query(api.memory.listMine, {})).claims).toEqual([]);
    const retrieved = await f.reader.query(internal.memory.contextForRunBase, {
      queryText: "heliostat", workspaceId: f.workspaceId, semanticMatches: [{ claimId, score: 1 }],
    });
    expect(retrieved.selectedClaimIds).toEqual([]);
  });

  it("does not trust a stale semantic candidate after claim reclassification", async () => {
    const f = await fixture();
    const { claimId } = await f.author.mutation(api.memory.remember, {
      proposition: "The heliostat experiment uses a silver reflector.",
      scope: "workspace", workspaceId: f.workspaceId, claimType: "declared_fact",
    });
    const context = () => f.reader.query(internal.memory.contextForRunBase, {
      queryText: "heliostat", workspaceId: f.workspaceId, semanticMatches: [{ claimId, score: 1 }],
    });
    expect((await context()).selectedClaimIds).toEqual([claimId]);
    await f.t.run((ctx) => ctx.db.patch(claimId, { scope: "private_global", workspaceId: undefined }));
    expect((await context()).selectedClaimIds).toEqual([]);
    expect((await f.reader.query(api.memory.listMine, {})).claims).toEqual([]);
  });

  it.each(["user_statement", "product_event"] as const)("cannot use %s provenance to bypass shared-scope write authority", async (sourceType) => {
    const f = await fixture();
    await expect(f.reader.mutation(api.memory.remember, {
      proposition: "This heliostat claim must not be published to the workspace.",
      scope: "workspace", workspaceId: f.workspaceId, claimType: "declared_fact", sourceType,
    })).rejects.toThrow("MEMORY_SCOPE_FORBIDDEN");
    expect((await f.reader.query(api.memory.listMine, {})).claims).toEqual([]);
  });

  it("does not revive a forgotten claim from a stale semantic match", async () => {
    const f = await fixture();
    const { claimId } = await derivedMemory(f);
    await f.reader.mutation(api.memory.forget, { claimId });
    const context = await f.reader.query(internal.memory.contextForRunBase, {
      queryText: "heliostat", semanticMatches: [{ claimId, score: 1 }],
    });
    expect(context.selectedClaimIds).toEqual([]);
    expect(context.exclusions.stale).toBe(1);
  });

  it("rejects a stale retrieval receipt after forgetting a claim with older authored evidence", async () => {
    const f = await fixture();
    const { claimId } = await f.reader.mutation(api.memory.remember, {
      proposition: "The heliostat experiment uses a silver reflector.",
      scope: "private_global", claimType: "declared_fact",
    });
    await f.t.run(async (ctx) => {
      for (let index = 0; index < 20; index += 1) await ctx.db.insert("memoryEvidence", {
        claimId, accountId: f.readerId, schoolId: f.schoolId, sourceType: "artifact",
        sourceId: f.artifactId, excerptHash: "recent-source", accessStatus: "available",
        captureReason: "Source confirmation", observedAt: Date.now(), createdAt: Date.now() + index + 1,
      });
    });
    await f.reader.mutation(api.memory.forget, { claimId });
    await expect(f.reader.mutation(api.memory.recordRetrieval, {
      purpose: "run_context", queryHash: "fixture-query", candidateClaimIds: [claimId],
      selectedClaimIds: [claimId], exclusionCounts: { scope: 0, permission: 0, stale: 0, disputed: 0, budget: 0 },
      estimatedTokens: 10,
    })).rejects.toThrow("MEMORY_RETRIEVAL_STALE");
    expect(await f.t.run((ctx) => ctx.db.query("memoryRetrievalEvents").collect())).toEqual([]);
  });
});
