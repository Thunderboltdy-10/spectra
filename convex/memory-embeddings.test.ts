/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import type { QueryCtx } from "./_generated/server";
import { contextForRunBase } from "./memory";
import { memoryEmbeddingPartition, memoryInputHash } from "./memoryEmbeddingPolicy";
import { embeddingVersion } from "./embeddingProvider";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
vi.mock("./env", async (importOriginal) => ({ ...await importOriginal<typeof import("./env")>(), getOpenRouterApiKey: () => "synthetic-test" }));
const MEMORY_EMBEDDING_VERSION = embeddingVersion()!;
const vector = Array.from({ length: 256 }, (_, index) => index === 0 ? 1 : 0);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-25T12:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function fixture() {
  const t = convexTest(schema, modules);
  const identities = ["author", "reader"].map((name) => ({ subject: `embedding-${name}`, email: `${name}@example.test`, emailVerified: true }));
  const data = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Embeddings", slug: "embedding", verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accounts: Id<"accounts">[] = [];
    for (const identity of identities) {
      const accountId = await ctx.db.insert("accounts", { clerkId: identity.subject, email: identity.email, emailVerified: true, name: identity.subject, status: "active", createdAt: now, updatedAt: now });
      accounts.push(accountId);
      await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    }
    const workspaceId = await ctx.db.insert("spectraWorkspaces", { schoolId, ownerAccountId: accounts[0], title: "Research", status: "active", defaultView: "cards", lastActivityAt: now, createdAt: now, updatedAt: now });
    const artifactId = await ctx.db.insert("spectraArtifacts", { schoolId, ownerAccountId: accounts[0], title: "Source", blueprintKey: "document", content: { blocks: [] }, tags: [], status: "active", createdAt: now, updatedAt: now });
    const grantId = await ctx.db.insert("accessGrants", { schoolId, resourceType: "artifact", resourceId: artifactId, principalType: "account", principalId: accounts[1], level: "read", capabilities: ["read"], source: "direct", createdByAccountId: accounts[0], createdAt: now, updatedAt: now });
    await ctx.db.insert("accessGrants", { schoolId, resourceType: "workspace", resourceId: workspaceId, principalType: "account", principalId: accounts[1], level: "read", capabilities: ["read"], source: "direct", createdByAccountId: accounts[0], createdAt: now, updatedAt: now });
    return { schoolId, authorId: accounts[0], readerId: accounts[1], workspaceId, artifactId, grantId };
  });
  return { t, author: t.withIdentity(identities[0]), reader: t.withIdentity(identities[1]), ...data };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const remember = (f: Fixture, proposition = "My preferred physics explanation uses concrete experiments.") => f.reader.mutation(api.memory.remember, { proposition, scope: "private_global", claimType: "declared_fact" });
const jobs = (f: Fixture) => f.t.run((ctx) => ctx.db.query("memoryJobs").withIndex("by_kind_status_available", (q) => q.eq("kind", "embed")).collect());
async function lease(f: Fixture, claimId: Id<"memoryClaims">) {
  await f.t.mutation(internal.memory.dispatchEmbeddings, {});
  const job = (await jobs(f)).find((row) => row.payload.claimId === claimId)!;
  expect(job.status).toBe("leased");
  return { jobId: job._id, leaseOwner: job.leaseOwner! };
}
async function stamp(f: Fixture, claimId: Id<"memoryClaims">) {
  await f.t.run(async (ctx) => {
    const claim = (await ctx.db.get(claimId))!;
    await ctx.db.patch(claimId, { embedding: vector, embeddingVersion: MEMORY_EMBEDDING_VERSION, embeddingInputHash: await memoryInputHash(claim.proposition), embeddingPartition: memoryEmbeddingPartition(claim), embeddingUpdatedAt: Date.now() });
  });
}

describe("versioned asynchronous memory embeddings", () => {
  it("deduplicates unchanged text before and after completed-job retention without changing confirmation time", async () => {
    const f = await fixture();
    const { claimId } = await remember(f);
    await remember(f);
    expect(await jobs(f)).toHaveLength(1);
    const before = (await f.t.run((ctx) => ctx.db.get(claimId)))!;
    expect(before.embedding).toBeUndefined();
    const attempt = await lease(f, claimId);
    vi.setSystemTime(Date.now() + 1_000);
    expect(await f.t.mutation(internal.memory.completeEmbedding, { ...attempt, vector })).toEqual({ committed: true });
    const saved = (await f.t.run((ctx) => ctx.db.get(claimId)))!;
    expect(saved.updatedAt).toBe(before.updatedAt);
    expect(saved.embeddingVersion).toBe(MEMORY_EMBEDDING_VERSION);
    await f.t.run((ctx) => ctx.db.delete(attempt.jobId));
    await remember(f);
    expect(await jobs(f)).toHaveLength(0);
    expect((await f.t.run((ctx) => ctx.db.get(claimId)))?.embeddingUpdatedAt).toBe(saved.embeddingUpdatedAt);
  });

  it("uses retained proposition identity when a near-duplicate confirmation arrives", async () => {
    const f = await fixture();
    const original = "The research launch checklist includes scope review source validation delivery ownership and final approval.";
    const { claimId } = await remember(f, original);
    expect((await remember(f, original.replace("final", "final final"))).claimId).toBe(claimId);
    expect((await jobs(f))[0].payload.inputHash).toBe(await memoryInputHash(original));
    expect((await f.t.run((ctx) => ctx.db.get(claimId)))?.proposition).toBe(original);
  });

  it.each(["forget", "correct", "revoke", "disable", "dispute", "reclassify", "content"])("rejects delayed completion after %s", async (change) => {
    const f = await fixture();
    const { claimId } = await f.reader.mutation(api.memory.remember, { proposition: "The heliostat assembly uses a silver reflector.", scope: "private_global", claimType: "declared_fact", sourceType: "artifact", sourceId: f.artifactId });
    const attempt = await lease(f, claimId);
    expect(await f.t.query(internal.memory.embeddingInput, attempt)).not.toBeNull();
    if (change === "forget") await f.reader.mutation(api.memory.forget, { claimId });
    if (change === "correct") await f.reader.mutation(api.memory.correct, { claimId, proposition: "The heliostat assembly uses a copper reflector." });
    if (change === "revoke") await f.t.run((ctx) => ctx.db.patch(f.grantId, { revokedAt: Date.now() }));
    if (change === "disable") await f.reader.mutation(api.memory.updatePreferences, { enabled: false });
    if (change === "dispute") await f.reader.mutation(api.memory.setDisputed, { claimId, disputed: true });
    if (change === "reclassify") await f.t.run((ctx) => ctx.db.patch(claimId, { scope: "private_school" }));
    if (change === "content") await f.t.run((ctx) => ctx.db.patch(claimId, { proposition: "The assembly design has changed." }));
    expect(await f.t.query(internal.memory.embeddingInput, attempt)).toBeNull();
    expect(await f.t.mutation(internal.memory.completeEmbedding, { ...attempt, vector })).toEqual({ committed: false });
    expect((await f.t.run((ctx) => ctx.db.get(claimId)))?.embeddingPartition).toBeUndefined();
  });

  it("rejects an expired attempt after a newer lease commits", async () => {
    const f = await fixture();
    const { claimId } = await remember(f);
    const first = await lease(f, claimId);
    vi.setSystemTime(Date.now() + 31_000);
    const second = await lease(f, claimId);
    expect(second.leaseOwner).not.toBe(first.leaseOwner);
    expect(await f.t.mutation(internal.memory.completeEmbedding, { ...second, vector })).toEqual({ committed: true });
    expect(await f.t.mutation(internal.memory.completeEmbedding, { ...first, vector: vector.map((n) => -n) })).toEqual({ committed: false });
    expect((await f.t.run((ctx) => ctx.db.get(claimId)))?.embedding).toEqual(vector);
  });

  it("bounds retries and admits the next job immediately when a slot is released", async () => {
    const f = await fixture();
    const { claimId } = await remember(f);
    for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
      const attempt = await lease(f, claimId);
      await f.t.mutation(internal.memory.completeEmbedding, { ...attempt, error: "rate_limited", retryable: true });
      const [job] = await jobs(f);
      expect(job.attemptCount).toBe(attemptNumber);
      expect(job.status).toBe(attemptNumber === 3 ? "failed" : "queued");
      vi.setSystemTime(job.availableAt);
    }
    await f.t.mutation(internal.memory.dispatchEmbeddings, {});
    expect((await jobs(f))[0].status).toBe("failed");
  });

  it("keeps two global leases and never rebuilds capsules for embedding-only work", async () => {
    const f = await fixture();
    for (const text of ["The heliostat reflector is silver.", "I prefer explanations in Spanish.", "My office hours begin at noon."]) await remember(f, text);
    expect(await f.t.mutation(internal.memory.dispatchEmbeddings, {})).toEqual({ dispatched: 2 });
    expect(await f.t.mutation(internal.memory.dispatchEmbeddings, {})).toEqual({ dispatched: 0 });
    const first = (await jobs(f)).find((job) => job.status === "leased")!;
    await f.t.mutation(internal.memory.completeEmbedding, { jobId: first._id, leaseOwner: first.leaseOwner!, vector });
    expect(await f.t.mutation(internal.memory.dispatchEmbeddings, {})).toEqual({ dispatched: 1 });
    expect(await f.t.run((ctx) => ctx.db.query("memoryCapsules").collect())).toEqual([]);
  });

  it("keeps capture and deletion work admissible behind an embedding backlog", async () => {
    const f = await fixture();
    const { claimId } = await remember(f);
    await f.t.run(async (ctx) => {
      const [original] = await ctx.db.query("memoryJobs").collect();
      const { _id, _creationTime, ...fields } = original; void _id; void _creationTime;
      for (let i = 0; i < 25; i += 1) await ctx.db.insert("memoryJobs", { ...fields, idempotencyKey: `backlog-${i}` });
    });
    await f.reader.mutation(api.memory.forget, { claimId });
    await f.t.mutation(internal.memory.maintain, {});
    const deletion = await f.t.run((ctx) => ctx.db.query("memoryJobs").withIndex("by_kind_status_available", (q) => q.eq("kind", "delete")).first());
    expect(deletion?.status).toBe("completed");
    expect((await jobs(f)).every((job) => job.status === "queued")).toBe(true);
  });

  it("backfills only an explicit bounded page and retries failed jobs only when requested", async () => {
    const f = await fixture();
    const { claimId } = await remember(f);
    const attempt = await lease(f, claimId);
    await f.t.mutation(internal.memory.completeEmbedding, { ...attempt, error: "missing_key", retryable: false });
    expect((await f.t.mutation(internal.memory.backfillEmbeddings, { limit: 1 })).enqueued).toBe(0);
    const retry = await f.t.mutation(internal.memory.backfillEmbeddings, { limit: 1, retryFailed: true });
    expect(retry).toMatchObject({ scanned: 1, enqueued: 1 });
    expect((await jobs(f))[0]).toMatchObject({ status: "queued", attemptCount: 0 });
  });
});

describe("bounded, currently authorized candidate retrieval", () => {
  it("does not traverse or rank through an inaccessible intermediary", async () => {
    const f = await fixture();
    const a = await remember(f, "Physics explanations work best with concrete experiments.");
    const b = await f.reader.mutation(api.memory.remember, { proposition: "The private workshop requires a special reflector.", scope: "private_global", claimType: "declared_fact", sourceType: "artifact", sourceId: f.artifactId });
    const c = await remember(f, "Workshops need chalk and coloured paper.");
    await stamp(f, a.claimId); await stamp(f, c.claimId);
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.grantId, { revokedAt: Date.now() });
      for (const [from, to, confidence] of [[a.claimId, b.claimId, 0], [b.claimId, c.claimId, 1]] as const)
        await ctx.db.insert("memoryRelations", { accountId: f.readerId, schoolId: f.schoolId, fromClaimId: from, toClaimId: to, fromSubject: `claim:${from}`, toSubject: `claim:${to}`, relationType: "related_to", confidence, createdAt: Date.now(), updatedAt: Date.now() });
    });
    const result = await f.reader.query(internal.memory.contextForRunBase, { queryText: "nonce", semanticMatches: [{ claimId: a.claimId, score: 1 }, { claimId: c.claimId, score: 0.99 }] });
    expect(result.selectedClaimIds).toEqual([a.claimId, c.claimId]);
  });

  it("preserves global authored memory when the account changes schools", async () => {
    const f = await fixture();
    const { claimId } = await remember(f, "Physics explanations work best with experiments.");
    await stamp(f, claimId);
    const before = await f.reader.query(internal.memory.retrievalIdentity, {});
    await f.t.run(async (ctx) => {
      const school = (await ctx.db.get(f.schoolId))!;
      const { _id, _creationTime, ...fields } = school; void _id; void _creationTime;
      const otherSchool = await ctx.db.insert("schools", { ...fields, slug: "new-school" });
      const membership = (await ctx.db.query("schoolMemberships").collect()).find((row) => row.accountId === f.readerId)!;
      await ctx.db.patch(membership._id, { schoolId: otherSchool });
    });
    const after = await f.reader.query(internal.memory.retrievalIdentity, {});
    expect(after.partitions.find((p) => p.scope === "private_global")?.key).toBe(before.partitions.find((p) => p.scope === "private_global")?.key);
    expect((await f.reader.query(internal.memory.contextForRunBase, { queryText: "physics" })).selectedClaimIds).toEqual([claimId]);
  });
  it("uses exact OR partitions in the real action and returns literal fallback on provider failure", async () => {
    const f = await fixture();
    const { claimId } = await remember(f, "The heliostat reflector is silver.");
    await stamp(f, claimId);
    const fetcher = vi.fn(async () => Response.json({ model: "text-embedding-3-small", provider: "OpenAI", data: [{ index: 0, embedding: vector }] }));
    vi.stubGlobal("fetch", fetcher);
    const semantic = await f.reader.action(api.memory.contextForRun, { queryText: "sunlight redirector alloy" }) as FunctionReturnType<typeof internal.memory.contextForRunBase>;
    expect(semantic.retrieval.status).toBe("semantic_and_literal");
    expect(semantic.selectedClaimIds).toEqual([claimId]);
    fetcher.mockImplementation(async () => new Response("not available", { status: 503 }));
    const pending = f.reader.action(api.memory.contextForRun, { queryText: "heliostat material" });
    await vi.advanceTimersByTimeAsync(1_000); // the interactive query retries a 503 once after a short backoff
    const fallback = await pending as FunctionReturnType<typeof internal.memory.contextForRunBase>;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fallback.retrieval.status).toBe("provider_unavailable");
    expect(fallback.selectedClaimIds).toEqual([claimId]);
  });

  it("sends no provider request for disabled memory, empty queries or oversized query tails", async () => {
    const f = await fixture();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const empty = await f.reader.action(api.memory.contextForRun, { queryText: "" }) as FunctionReturnType<typeof internal.memory.contextForRunBase>;
    expect(empty.selectedClaimIds).toEqual([]);
    const oversized = await f.reader.action(api.memory.contextForRun, { queryText: "x".repeat(9_000) + " semantically decisive tail" }) as FunctionReturnType<typeof internal.memory.contextForRunBase>;
    expect(oversized.retrieval.status).toBe("query_too_large");
    await f.reader.mutation(api.memory.updatePreferences, { enabled: false });
    const disabled = await f.reader.action(api.memory.contextForRun, { queryText: "find my experiment" }) as FunctionReturnType<typeof internal.memory.contextForRunBase>;
    expect(disabled.enabled).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never mixes fingerprint or old-version vectors into semantic candidates", async () => {
    const f = await fixture();
    const { claimId } = await remember(f);
    const read = () => f.reader.query(internal.memory.contextForRunBase, { queryText: "unrelated nonce", semanticMatches: [{ claimId, score: 1 }] });
    await f.t.run((ctx) => ctx.db.patch(claimId, { embedding: vector }));
    expect((await read()).selectedClaimIds).toEqual([]);
    await stamp(f, claimId);
    expect((await read()).selectedClaimIds).toEqual([claimId]);
    await f.t.run((ctx) => ctx.db.patch(claimId, { embeddingVersion: "previous-model" }));
    expect((await read()).selectedClaimIds).toEqual([]);
  });

  it("finds shared evidence by another author while excluding that author's private claims", async () => {
    const f = await fixture();
    const shared = await f.author.mutation(api.memory.remember, { proposition: "The observatory diagram uses circles.", scope: "workspace", workspaceId: f.workspaceId, claimType: "declared_fact" });
    const privateClaim = await f.author.mutation(api.memory.remember, { proposition: "The observatory password reminder is private.", scope: "private_global", claimType: "declared_fact" });
    await stamp(f, shared.claimId); await stamp(f, privateClaim.claimId);
    const identity = await f.reader.query(internal.memory.retrievalIdentity, { workspaceId: f.workspaceId });
    const stored = (await f.t.run((ctx) => ctx.db.get(shared.claimId)))!;
    expect(identity.partitions.map((p) => p.key)).toContain(stored.embeddingPartition);
    const result = await f.reader.query(internal.memory.contextForRunBase, { queryText: "observatory", workspaceId: f.workspaceId, semanticMatches: [{ claimId: shared.claimId, score: 1 }, { claimId: privateClaim.claimId, score: 1 }] });
    expect(result.selectedClaimIds).toEqual([shared.claimId]);
  });

  it("keeps literal service without vectors and does not fill unrelated or empty requests", async () => {
    const f = await fixture();
    const { claimId } = await remember(f, "The heliostat reflector is silver.");
    expect((await f.reader.query(internal.memory.contextForRunBase, { queryText: "heliostat" })).selectedClaimIds).toEqual([claimId]);
    expect((await f.reader.query(internal.memory.contextForRunBase, { queryText: "medieval pottery" })).selectedClaimIds).toEqual([]);
    expect((await f.reader.query(internal.memory.contextForRunBase, { queryText: "" })).selectedClaimIds).toEqual([]);
  });

  it("charges the full rendered citation and scope against the requested budget", async () => {
    const f = await fixture();
    const { claimId } = await remember(f, "The heliostat reflector is silver.");
    const result = await f.reader.query(internal.memory.contextForRunBase, { queryText: "heliostat", targetTokens: 15 });
    expect(result.selectedClaimIds).toEqual([]);
    expect(result.exclusions.budget).toBe(1);
    const enough = await f.reader.query(internal.memory.contextForRunBase, { queryText: "heliostat", targetTokens: 40 });
    expect(enough.selectedClaimIds).toEqual([claimId]);
    expect(enough.estimatedTokens).toBe(Math.ceil(enough.text.length / 4));
    expect(enough.estimatedTokens).toBeLessThanOrEqual(40);
  });

  it("bounds returned rows even when the account has hundreds of unrelated claims", async () => {
    const f = await fixture();
    const { claimId } = await remember(f, "The heliostat reflector is silver.");
    const handler = Reflect.get(contextForRunBase, "_handler") as (ctx: QueryCtx, args: { queryText: string }) => Promise<unknown>;
    const measure = () => f.reader.run(async (ctx) => { const observer = observeDatabase(ctx.db); const result = await handler({ ...ctx, db: observer.db }, { queryText: "heliostat" }); return { result, ...observer.snapshot() }; });
    const small = await measure();
    await f.t.run(async (ctx) => {
      const original = (await ctx.db.get(claimId))!;
      const { _id, _creationTime, ...fields } = original; void _id; void _creationTime;
      for (let index = 0; index < 300; index += 1) await ctx.db.insert("memoryClaims", { ...fields, proposition: `Unrelated pottery ${index}`, normalizedProposition: `unrelated pottery ${index}`, propositionHash: `unrelated-${index}` });
    });
    const large = await measure();
    expect(large.result).toEqual(small.result);
    expect(large.documentsReturned).toBe(small.documentsReturned);
    expect(large.serializedDocumentBytes).toBe(small.serializedDocumentBytes);
    console.info("S11 bounded memory candidate ledger", JSON.stringify({ claims: [1, 301], documents: large.documentsReturned, bytes: large.serializedDocumentBytes, calls: large.calls }));
  });
});
