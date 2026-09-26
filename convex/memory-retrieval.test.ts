/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import type { FunctionReturnType } from "convex/server";
import { listMine } from "./memory";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
// These are source-authority tests; embedding jobs run under their own controlled tests.
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
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

async function managebacMemory(f: Fixture) {
  const source = await f.t.run(async (ctx) => {
    const now = Date.now();
    const integrationId = await ctx.db.insert("schoolIntegrations", {
      schoolId: f.schoolId, provider: "managebac", baseUrl: "https://memory.example.test", authHeaderName: "X-API-Key",
      authScheme: "raw", status: "connected", tokenMode: "read_only", secretPurpose: "test",
      manifestVersion: 1, capabilityCoverage: { discovered: 1, verifiedReadable: 1, unverified: 0, failed: 0, quarantined: 0 },
      syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: true, autoApplySafeUpdates: true, conflictMode: "review" },
      freshnessSlaMinutes: 60, requestBudgetPerMinute: 30, bootstrapVersion: 1,
      createdByAccountId: f.readerId, updatedByAccountId: f.readerId, createdAt: now, updatedAt: now,
    });
    const mappingId = await ctx.db.insert("externalIdentityMappings", {
      integrationId, schoolId: f.schoolId, accountId: f.readerId, providerUserId: "reader", verifiedEmailHash: "fixture",
      status: "verified", matchCount: 1, createdAt: now, updatedAt: now,
    });
    const membershipId = await ctx.db.insert("externalRecords", {
      integrationId, schoolId: f.schoolId, providerRecordId: "class", providerRecordKey: "class:class",
      recordType: "membership", classification: "personal", audienceScope: "mapped_user", mappedAccountId: f.readerId,
      providerClassId: "class", academicPeriodKey: "2026", normalized: { title: "My class" },
      payloadVersion: "1", sourceHash: "member", tombstone: false, sourceState: "available", fetchedAt: now, createdAt: now, updatedAt: now,
    });
    const selectionId = await ctx.db.insert("managebacClassSelections", {
      integrationId, schoolId: f.schoolId, accountId: f.readerId, providerClassId: "class", providerRecordKey: "class:class",
      academicPeriodKey: "2026", selected: true, retention: "keep_in_spectra", selectionRevision: 1, createdAt: now, updatedAt: now,
    });
    const recordId = await ctx.db.insert("externalRecords", {
      integrationId, schoolId: f.schoolId, providerRecordId: "reading", providerRecordKey: "resource:reading",
      recordType: "class_resource", classification: "class", audienceScope: "class_members",
      providerClassId: "class", academicPeriodKey: "2026", normalized: { title: "Heliostat reading" },
      payloadVersion: "1", sourceHash: "resource", tombstone: false, sourceState: "available", fetchedAt: now, createdAt: now, updatedAt: now,
    });
    return { integrationId, mappingId, membershipId, selectionId, recordId };
  });
  const { claimId } = await derivedMemory(f);
  const evidenceId = await f.t.run(async (ctx) => {
    const evidence = (await ctx.db.query("memoryEvidence").withIndex("by_claim_created", (q) => q.eq("claimId", claimId)).first())!;
    await ctx.db.patch(evidence._id, { sourceType: "managebac", sourceId: `managebac:${source.recordId}` });
    return evidence._id;
  });
  return { ...source, claimId, evidenceId };
}

describe("current ManageBac source authority in memory", () => {
  it("retains inherited class memory and removes it on deselection without deleting the claim", async () => {
    const f = await fixture();
    const source = await managebacMemory(f);
    expect((await visibleMemory(f)).context).toEqual([source.claimId]);
    await f.t.run((ctx) => ctx.db.patch(source.selectionId, { selected: false }));
    expect(await visibleMemory(f)).toEqual({ list: [], exported: [], context: [] });
    expect((await f.t.run((ctx) => ctx.db.get(source.claimId)))?.status).toBe("active");
    await f.t.run((ctx) => ctx.db.patch(source.selectionId, { selected: true }));
    const restored = await visibleMemory(f);
    expect(restored.context).toEqual([source.claimId]);
    expect(restored.list).toHaveLength(1);
    expect(restored.exported).toHaveLength(1);
  });

  it.each(["mapping", "membership", "integration", "period", "tombstone", "other user"])(
    "does not treat same-school provenance as authority after %s changes", async (change) => {
      const f = await fixture();
      const source = await managebacMemory(f);
      await f.t.run(async (ctx) => {
        if (change === "mapping") await ctx.db.patch(source.mappingId, { status: "revoked" });
        if (change === "membership") await ctx.db.patch(source.membershipId, { tombstone: true });
        if (change === "integration") await ctx.db.patch(source.integrationId, { status: "revoked" });
        if (change === "period") await ctx.db.patch(source.membershipId, { academicPeriodKey: "2025" });
        if (change === "tombstone") await ctx.db.patch(source.recordId, { tombstone: true });
        if (change === "other user") await ctx.db.patch(source.recordId, { audienceScope: "mapped_user", mappedAccountId: f.authorId });
      });
      expect(await visibleMemory(f)).toEqual({ list: [], exported: [], context: [] });
    },
  );

  it.each([undefined, "managebac:legacy-provider-key", "managebac:a:b", "not-a-record"])(
    "rejects unresolvable provenance %s without breaking memory reads", async (sourceId) => {
      const f = await fixture();
      const source = await managebacMemory(f);
      await f.t.run((ctx) => ctx.db.patch(source.evidenceId, { sourceId }));
      expect(await visibleMemory(f)).toEqual({ list: [], exported: [], context: [] });
    },
  );

  it("keeps separately authored memory while omitting a revoked ManageBac preview", async () => {
    const f = await fixture();
    const source = await managebacMemory(f);
    await f.reader.mutation(api.memory.remember, {
      proposition: "The heliostat experiment uses a silver reflector.", scope: "private_global", claimType: "declared_fact",
    });
    await f.t.run((ctx) => ctx.db.patch(source.mappingId, { status: "revoked" }));
    const visible = await visibleMemory(f);
    expect(visible.context).toEqual([source.claimId]);
    expect(visible.list[0]?.evidence.map((row) => row.sourceType)).toEqual(["user_statement"]);
    expect(JSON.stringify(visible)).not.toContain(`managebac:${source.recordId}`);
  });

  it("shares current class authority across distinct ManageBac sources within a memory read", async () => {
    const f = await fixture();
    const source = await managebacMemory(f);
    await f.t.run(async (ctx) => {
      const { _id: recordId, _creationTime: recordCreated, ...record } = (await ctx.db.get(source.recordId))!;
      const { _id: evidenceId, _creationTime: evidenceCreated, ...evidence } = (await ctx.db.get(source.evidenceId))!;
      void recordId; void recordCreated; void evidenceId; void evidenceCreated;
      for (let i = 0; i < 3; i += 1) {
        const id = await ctx.db.insert("externalRecords", { ...record, providerRecordId: `reading-${i}` });
        await ctx.db.insert("memoryEvidence", { ...evidence, sourceId: `managebac:${id}` });
      }
    });
    const measured = await f.reader.run(async (ctx) => {
      const observer = observeDatabase(ctx.db);
      const result = await listMineHandler({ ...ctx, db: observer.db }, {});
      return { result, ...observer.snapshot() };
    });
    expect(measured.result.claims[0]?.evidence).toHaveLength(4);
    for (const table of ["schoolIntegrations", "externalIdentityMappings", "managebacClassSelections"])
      expect(measured.reads.filter((row) => row.table === table)).toHaveLength(1);
    expect(measured.reads.filter((row) => row.index === "by_visibility_membership")).toHaveLength(3);
    await f.t.run((ctx) => ctx.db.patch(source.mappingId, { status: "revoked" }));
    expect(await visibleMemory(f)).toEqual({ list: [], exported: [], context: [] });
  });
});

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

  it.each([
    { sourceType: "user_statement", error: "MEMORY_SCOPE_FORBIDDEN" },
    { sourceType: "product_event", error: "MEMORY_SOURCE_UNSUPPORTED" },
  ] as const)("cannot use $sourceType provenance to bypass shared-scope write authority", async ({ sourceType, error }) => {
    const f = await fixture();
    await expect(f.reader.mutation(api.memory.remember, {
      proposition: "This heliostat claim must not be published to the workspace.",
      scope: "workspace", workspaceId: f.workspaceId, claimType: "declared_fact", sourceType,
    })).rejects.toThrow(error);
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

describe("unverifiable product-event provenance", () => {
  it("rejects new public event provenance even in the author's own memory", async () => {
    const f = await fixture();
    await expect(f.reader.mutation(api.memory.remember, {
      proposition: "The heliostat experiment uses a silver reflector.", scope: "private_global",
      claimType: "declared_fact", sourceType: "product_event", sourceId: f.artifactId,
    })).rejects.toThrow("MEMORY_SOURCE_UNSUPPORTED");
    expect(await visibleMemory(f)).toEqual({ list: [], exported: [], context: [] });
  });

  it("hides historical event-only claims without deleting them and preserves explicit authorship", async () => {
    const f = await fixture();
    const { claimId } = await derivedMemory(f);
    await f.t.run(async (ctx) => {
      const evidence = (await ctx.db.query("memoryEvidence").withIndex("by_claim_created", (q) => q.eq("claimId", claimId)).first())!;
      await ctx.db.patch(evidence._id, { sourceType: "product_event", sourceId: "unverifiable-event" });
    });
    expect(await visibleMemory(f)).toEqual({ list: [], exported: [], context: [] });
    expect((await f.t.run((ctx) => ctx.db.get(claimId)))?.status).toBe("active");
    await f.reader.mutation(api.memory.remember, {
      proposition: "The heliostat experiment uses a silver reflector.", scope: "private_global", claimType: "declared_fact",
    });
    const visible = await visibleMemory(f);
    expect(visible.context).toEqual([claimId]);
    expect(visible.list[0]?.evidence.map((row) => row.sourceType)).toEqual(["user_statement"]);
    expect(JSON.stringify(visible)).not.toContain("unverifiable-event");
  });
});
