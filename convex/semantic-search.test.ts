/// <reference types="vite/client" />
/**
 * The semantic layer end to end in convex-test: indexing through the real queue and triggers,
 * hybrid search, searchThreads and related, and above all the permission model. Embeddings come
 * from the deterministic stand-in (scripts/semantic-eval/embedder.ts) through a fake `fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { deterministicEmbedding, embeddingFetch } from "../scripts/semantic-eval/embedder";
import { createSemanticWorld, drainIndexQueue, indexEverything, insertArtifact, insertEvent, insertSchoolRecord, insertThread,
  type SemanticWorld } from "../scripts/semantic-eval/world";
import { enqueueSemanticItem } from "./semanticQueue";
import type { SemanticSearchResponse } from "../shared/semantic-types";

vi.mock("./env", async (importOriginal) => ({ ...await importOriginal<typeof import("./env")>(), getOpenRouterApiKey: () => "synthetic-test" }));

const fetcher = vi.fn(embeddingFetch((texts) => texts.map(deterministicEmbedding)));
beforeEach(() => { vi.useFakeTimers(); fetcher.mockClear(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const ids = (response: SemanticSearchResponse) => response.results.map((result) => result.itemId);

describe("semantic search over the fixture corpus", () => {
  it("indexes every kind through the backfill and finds work by meaning, words and title", async () => {
    const world = await createSemanticWorld();
    await indexEverything(world);
    const status = await world.t.query(internal.semanticIndex.backfillStatus, {});
    expect(status.backfill?.phase).toBe("done");
    expect(status.waiting + status.running + status.pendingVectors).toBe(0);
    const items = await world.t.run((ctx) => ctx.db.query("semanticItems").collect());
    expect(new Set(items.map((item) => item.itemKind))).toEqual(new Set(["artifact", "thread", "event", "school"]));
    expect(items.every((item) => item.embeddingState === "complete" && item.centroid?.length === 256)).toBe(true);
    // The membership row is not searchable content; everything in the corpus is.
    expect(items).toHaveLength(30);

    const response = await world.ana.action(api.semantic.search, { query: "powerhouse of the cell" });
    expect(response.mode).toBe("hybrid");
    const top = response.results[0]!;
    expect(top.itemId).toBe(world.ids["a-cell-notes"]);
    expect(top).toMatchObject({ kind: "artifact", title: "Cell Biology Notes", typeLabel: "Document", subtype: "document",
      ownership: "mine", workspace: { id: world.workspaces.biology, title: "Biology" } });
    expect(top.anchor).toMatchObject({ kind: "artifact", artifactId: world.ids["a-cell-notes"], regionId: "b1" });
    expect(top.snippet).toContain("powerhouse");
    expect(top.matchedBy).toEqual(expect.arrayContaining(["meaning", "words"]));

    const exact = await world.ana.action(api.semantic.search, { query: "Monthly budget" });
    expect(exact.results[0]).toMatchObject({ itemId: world.ids["a-budget"], matchedBy: expect.arrayContaining(["title"]) });

    const school = await world.ana.action(api.semantic.search, { query: "enzyme lab report due" });
    expect(school.results[0]).toMatchObject({ itemId: world.ids["s-enzyme-report"], kind: "school", typeLabel: "School assignment",
      ownership: "school", timeAt: expect.any(Number) });
  });

  it("resolves short, vague references with type, time and open-item cues", async () => {
    const world = await createSemanticWorld();
    await indexEverything(world);
    const hints = { now: Date.now(), timezoneOffsetMinutes: 0 };
    const yesterday = await world.ana.action(api.semantic.search, { query: "the essay from yesterday", hints });
    expect(yesterday.results[0]).toMatchObject({ itemId: world.ids["a-wwi-essay"], matchedBy: expect.arrayContaining(["type", "when"]) });
    const deck = await world.ana.action(api.semantic.search, { query: "that deck about cells", hints });
    expect(deck.results[0]?.itemId).toBe(world.ids["a-cells-deck"]);
    const open = await world.ana.action(api.semantic.search, { query: "the presentation",
      hints: { ...hints, openItemIds: [world.ids["a-energy-deck"]!] } });
    expect(open.results[0]).toMatchObject({ itemId: world.ids["a-energy-deck"], matchedBy: expect.arrayContaining(["open"]) });
    // Hints rank; they never filter or admit what the viewer cannot open.
    expect(open.results.length).toBeGreaterThan(1);
  });

  it("searches threads with message anchors and filters kinds", async () => {
    const world = await createSemanticWorld();
    await indexEverything(world);
    const threads = await world.ana.action(api.semantic.searchThreads, { query: "concentration of the acid titration" });
    expect(threads.results.every((result) => result.kind === "thread")).toBe(true);
    expect(threads.results[0]).toMatchObject({ itemId: world.ids["t-titration-help"], typeLabel: "Chat",
      anchor: { kind: "thread", threadId: world.ids["t-titration-help"], messageId: expect.any(String) } });
    const events = await world.ana.action(api.semantic.search, { query: "chemistry", kinds: ["event"] });
    expect(ids(events)).toEqual([world.ids["e-chem-test"]]);
  });

  it("lists explicit links first, then similar work, excluding self and copies", async () => {
    const world = await createSemanticWorld();
    const copyId = await world.t.run((ctx) => insertArtifact(ctx, { ownerAccountId: world.anaId, schoolId: world.schoolA,
      blueprintKey: "document", title: "Cell Biology Notes (copy)", sourceArtifactIds: [world.ids["a-cell-notes"] as Id<"spectraArtifacts">],
      content: { blocks: [{ id: "b1", type: "heading", text: "The cell" },
        { id: "b2", type: "paragraph", text: "Mitochondria are the powerhouse of the cell and produce ATP through respiration." },
        { id: "b3", type: "paragraph", text: "The nucleus stores DNA and controls the activities of the cell." },
        { id: "b4", type: "heading", text: "Membranes" },
        { id: "b5", type: "paragraph", text: "The cell membrane is a phospholipid bilayer that controls what enters and leaves." }] } }));
    await world.t.run((ctx) => ctx.db.insert("spectraArtifactLinks", { schoolId: world.schoolA, ownerAccountId: world.anaId,
      sourceArtifactId: world.ids["a-cell-notes"] as Id<"spectraArtifacts">, targetArtifactId: world.ids["a-enzymes-notes"] as Id<"spectraArtifacts">,
      relationType: "related", provenance: { source: "user" }, createdBy: "user", createdAt: Date.now(), updatedAt: Date.now() }));
    await indexEverything(world);
    const related = await world.ana.action(api.semantic.related, { itemId: world.ids["a-cell-notes"]! });
    expect(related.mode).toBe("hybrid");
    expect(related.results[0]).toMatchObject({ itemId: world.ids["a-enzymes-notes"],
      reasons: [expect.objectContaining({ type: "link", direction: "outgoing" })] });
    const relatedIds = related.results.map((result) => result.itemId);
    expect(relatedIds).toContain(world.ids["a-cells-deck"]);
    expect(relatedIds).not.toContain(world.ids["a-cell-notes"]);
    expect(relatedIds).not.toContain(copyId);
    expect(related.results.every((result) => result.reasons.length > 0)).toBe(true);
    expect(relatedIds).not.toContain(world.ids["a-budget"]);
    // A similar work names its passage most like this one, so opening it from Related lands there.
    const deck = related.results.find((result) => result.itemId === world.ids["a-cells-deck"])!;
    expect(deck.anchor).toMatchObject({ kind: "artifact", artifactId: world.ids["a-cells-deck"], regionId: expect.any(String) });
    expect(deck.location).toMatch(/^Slide \d/);
    expect(deck.snippet).toBeTruthy();

    await world.t.finishAllScheduledFunctions(vi.runAllTimers);
    const cached = await world.ana.action(api.semantic.related, { itemId: world.ids["a-cell-notes"]! });
    expect(cached.cached).toBe(true);
    expect(cached.results.map((result) => result.itemId)).toEqual(relatedIds);
    expect(cached.results.find((result) => result.itemId === world.ids["a-cells-deck"])?.anchor).toEqual(deck.anchor);
  });
});

/** Ben's and Carla's work, all about photosynthesis, against Ana's view. */
async function permissionWorld() {
  const world = await createSemanticWorld({ corpus: false });
  const doc = (text: string) => ({ blocks: [{ id: "b1", type: "paragraph", text }] });
  const seeded = await world.t.run(async (ctx) => {
    const now = Date.now();
    const groupWorkspace = await ctx.db.insert("spectraWorkspaces", { schoolId: world.schoolA, ownerAccountId: world.benId,
      title: "Group project", status: "active", defaultView: "cards", lastActivityAt: now, createdAt: now, updatedAt: now });
    const ben = { ownerAccountId: world.benId, schoolId: world.schoolA, blueprintKey: "document" };
    const own = await insertArtifact(ctx, { ownerAccountId: world.anaId, schoolId: world.schoolA, blueprintKey: "document",
      title: "Photosynthesis essay", content: doc("Chlorophyll captures light for photosynthesis.") });
    const trashed = await insertArtifact(ctx, { ownerAccountId: world.anaId, schoolId: world.schoolA, blueprintKey: "document",
      title: "Photosynthesis rough draft", content: doc("An early photosynthesis draft."), workspaceId: world.workspaces.biology });
    const benPrivate = await insertArtifact(ctx, { ...ben, title: "Ben photosynthesis diary", content: doc("Private photosynthesis thoughts.") });
    const benGroup = await insertArtifact(ctx, { ...ben, title: "Group poster on photosynthesis", content: doc("Poster about photosynthesis."),
      workspaceId: groupWorkspace });
    const benShared = await insertArtifact(ctx, { ...ben, title: "Photosynthesis glossary", content: doc("Glossary of photosynthesis terms.") });
    const benQuiz = await insertArtifact(ctx, { ...ben, blueprintKey: "quiz", title: "Plant quiz", content: { questions: [
      { id: "q1", prompt: "What does chlorophyll absorb?", options: ["Light", "Sound"], explanation: "Answer: photosynthesis needs light." }] } });
    const benThread = await insertThread(ctx, { ownerAccountId: world.benId, schoolId: world.schoolA, title: "Ben photosynthesis chat",
      messages: [["user", "Explain photosynthesis to me."], ["assistant", "Plants use light to make glucose."]] });
    const benEvent = await insertEvent(ctx, { ownerAccountId: world.benId, schoolId: world.schoolA, title: "Photosynthesis revision",
      kind: "personal_event", startAt: now + 86_400_000 });
    const carlaWork = await insertArtifact(ctx, { ownerAccountId: world.carlaId, schoolId: world.schoolB, blueprintKey: "document",
      title: "Photosynthesis notes", content: doc("School B photosynthesis notes.") });
    const integrationB = await ctx.db.insert("schoolIntegrations", { ...(await ctx.db.get(world.integrationId))!, schoolId: world.schoolB,
      _id: undefined, _creationTime: undefined } as never);
    const schoolBRecord = await insertSchoolRecord(ctx, { integrationId: integrationB, schoolId: world.schoolB, key: "b-news",
      recordType: "announcement", audience: "school", normalized: { title: "Photosynthesis fair", body: "School B photosynthesis fair." } });
    // Ben's verified ManageBac identity: his own records are his alone.
    await ctx.db.insert("externalIdentityMappings", { integrationId: world.integrationId, schoolId: world.schoolA, accountId: world.benId,
      providerUserId: "ben", verifiedEmailHash: "fixture", status: "verified", matchCount: 1, createdAt: Date.now(), updatedAt: Date.now() });
    const benRecord = await insertSchoolRecord(ctx, { integrationId: world.integrationId, schoolId: world.schoolA, key: "ben-feedback",
      recordType: "feedback", audience: "mine", mappedAccountId: world.benId, normalized: { title: "Photosynthesis garden feedback" } });
    const otherClass = await insertSchoolRecord(ctx, { integrationId: world.integrationId, schoolId: world.schoolA, key: "chem-task",
      recordType: "assignment", audience: "class", providerClassId: "chem-sl", normalized: { title: "Photosynthesis rates lab" } });
    return { groupWorkspace, own, trashed, benPrivate, benGroup, benShared, benQuiz, benThread, benEvent, carlaWork, schoolBRecord, benRecord, otherClass };
  });
  const workspaceGrant = await world.grant({ schoolId: world.schoolA, resourceType: "workspace", resourceId: seeded.groupWorkspace,
    to: world.anaId, by: world.benId });
  const sharedGrant = await world.grant({ schoolId: world.schoolA, resourceType: "artifact", resourceId: seeded.benShared, to: world.anaId, by: world.benId });
  await world.grant({ schoolId: world.schoolA, resourceType: "artifact", resourceId: seeded.benQuiz, to: world.anaId, by: world.benId });
  await indexEverything(world);
  return { ...world, ...seeded, workspaceGrant, sharedGrant };
}
type PermissionWorld = Awaited<ReturnType<typeof permissionWorld>>;

async function visibleTo(world: SemanticWorld, viewer: "ana" | "ben" | "carla", query = "photosynthesis") {
  const [search, threads] = await Promise.all([
    world[viewer].action(api.semantic.search, { query, limit: 30 }),
    world[viewer].action(api.semantic.searchThreads, { query, limit: 30 }),
  ]);
  return new Set([...ids(search), ...ids(threads)]);
}

describe("semantic permissions", () => {
  let world: PermissionWorld;
  beforeEach(async () => { world = await permissionWorld(); });

  it("shows Ana her own work, her shared workspace and direct shares, and nothing else", async () => {
    const seen = await visibleTo(world, "ana");
    // The shared quiz's only mention is in its answers, which only Ben may search.
    expect(seen).toEqual(new Set([world.own, world.trashed, world.benGroup, world.benShared]));
    // Another account's private work, chats, calendar and mapped school data.
    for (const hidden of [world.benPrivate, world.benThread, world.benEvent, world.benRecord]) expect(seen).not.toContain(hidden);
    // Another school's work and data, and a class Ana has not selected.
    for (const hidden of [world.carlaWork, world.schoolBRecord, world.otherClass]) expect(seen).not.toContain(hidden);
    expect(await visibleTo(world, "carla")).toEqual(new Set([world.carlaWork]));
    const ben = await visibleTo(world, "ben");
    for (const item of [world.benPrivate, world.benGroup, world.benShared, world.benQuiz, world.benThread, world.benEvent, world.benRecord])
      expect(ben).toContain(item);
    expect(ben).not.toContain(world.own);
  });

  it("never lets a quiz's answers reach anyone but its owner", async () => {
    const query = "answer needs light";
    const anaResults = await world.ana.action(api.semantic.search, { query, limit: 30 });
    expect(anaResults.results.some((result) => result.snippet.includes("Answer"))).toBe(false);
    // The quiz itself stays findable for Ana by its title, without its answers.
    const byTitle = await world.ana.action(api.semantic.search, { query: "Plant quiz" });
    expect(byTitle.results[0]).toMatchObject({ itemId: world.benQuiz, ownership: "shared", typeLabel: "Quiz" });
    expect(byTitle.results[0]?.snippet).not.toContain("Answer");
    const benResults = await world.ben.action(api.semantic.search, { query, limit: 30 });
    expect(benResults.results.find((result) => result.itemId === world.benQuiz)?.snippet).toContain("Answer");
    const chunks = await world.t.run((ctx) => ctx.db.query("semanticChunks")
      .withIndex("by_item", (q) => q.eq("itemKind", "artifact").eq("itemId", world.benQuiz)).collect());
    for (const chunk of chunks.filter((row) => row.ownerOnly)) {
      expect([chunk.vWorkspaceKey, chunk.vWorkspaceKey2, chunk.vItemKey, chunk.vAudienceKey, chunk.workspaceKey, chunk.audienceKey])
        .toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    }
  });

  it("drops a left workspace, a revoked share and a deleted or trashed item at once, before any re-index", async () => {
    await world.t.run(async (ctx) => {
      await ctx.db.delete(world.workspaceGrant);
      await ctx.db.patch(world.sharedGrant, { revokedAt: Date.now() });
      await ctx.db.patch(world.own, { status: "deleted" });
      const [placement] = await ctx.db.query("orgNodes").withIndex("by_kind_source", (q) => q.eq("kind", "work").eq("sourceId", world.trashed)).collect();
      await ctx.db.patch(placement!._id, { deletedAt: Date.now() });
    });
    expect(await visibleTo(world, "ana")).toEqual(new Set());
    const related = await world.ana.action(api.semantic.related, { itemId: world.benQuiz });
    for (const hidden of [world.benGroup, world.benShared, world.own, world.trashed, world.benPrivate])
      expect(related.results.map((result) => result.itemId)).not.toContain(hidden);
    expect(await world.ana.action(api.semantic.related, { itemId: world.own })).toMatchObject({ results: [] });
    expect(await world.ana.action(api.semantic.related, { itemId: world.benPrivate })).toMatchObject({ results: [] });
  });

  it("purges deleted items from the index through the triggers, without network work in the mutation", async () => {
    await world.t.run((ctx) => ctx.db.patch(world.own, { status: "deleted" }));
    await world.t.run((ctx) => enqueueSemanticItem(ctx, "artifact", world.own, { immediate: true }));
    fetcher.mockClear();
    await drainIndexQueue(world);
    expect(fetcher).not.toHaveBeenCalled();
    const left = await world.t.run((ctx) => ctx.db.query("semanticChunks")
      .withIndex("by_item", (q) => q.eq("itemKind", "artifact").eq("itemId", world.own)).collect());
    expect(left).toEqual([]);
  });

  it("refuses a workspace filter for a workspace the viewer cannot open", async () => {
    await world.t.run((ctx) => ctx.db.delete(world.workspaceGrant));
    const response = await world.ana.action(api.semantic.search, { query: "photosynthesis", workspaceId: world.groupWorkspace });
    expect(response.results).toEqual([]);
    const own = await world.ana.action(api.semantic.search, { query: "photosynthesis", workspaceId: world.workspaces.biology });
    expect(ids(own)).toEqual([world.trashed]);
  });

  it("does not admit unreadable items through hints", async () => {
    const response = await world.ana.action(api.semantic.search, { query: "photosynthesis",
      hints: { openItemIds: [world.benPrivate, world.carlaWork, world.benThread], recentItemIds: [world.benEvent] } });
    for (const hidden of [world.benPrivate, world.carlaWork, world.benThread, world.benEvent]) expect(ids(response)).not.toContain(hidden);
  });
});

/** A 503 from the provider. Real-time timers let its short retry backoff elapse. */
function outage() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
}

describe("incremental indexing and degraded modes", () => {
  it("re-indexes after a save through the real mutation triggers, re-embedding only changed chunks", async () => {
    const world = await createSemanticWorld({ corpus: false });
    const threadId = await world.ana.mutation(api.spectraThreads.create, { title: "Revision plan", origin: "chat" });
    await world.ana.mutation(api.spectraThreads.appendMessage, { threadId, role: "user",
      content: "Plan my revision for the mitochondria and respiration topic over the next two weeks, please." });
    // Debounced: nothing is indexed until the quiet period passes.
    expect(await world.t.run((ctx) => ctx.db.query("semanticChunks").collect())).toEqual([]);
    await drainIndexQueue(world);
    const first = await world.ana.action(api.semantic.searchThreads, { query: "mitochondria respiration" });
    expect(ids(first)).toEqual([threadId]);

    fetcher.mockClear();
    await world.ana.mutation(api.spectraThreads.appendMessage, { threadId, role: "assistant",
      content: "Week one covers glycolysis and the Krebs cycle; week two covers the electron transport chain and practice questions." });
    await drainIndexQueue(world);
    const embedded = fetcher.mock.calls.flatMap((call) => {
      const input = JSON.parse(String((call[1] as RequestInit).body)).input as string | string[];
      return Array.isArray(input) ? input : [input];
    });
    expect(embedded).toHaveLength(1);
    expect(embedded[0]).toContain("Krebs");
    const second = await world.ana.action(api.semantic.searchThreads, { query: "Krebs cycle" });
    expect(second.results[0]).toMatchObject({ itemId: threadId, anchor: { kind: "thread", messageId: expect.any(String) } });
  });

  it("falls back to full-text when the provider is down and says so", async () => {
    const world = await createSemanticWorld();
    await indexEverything(world);
    outage();
    const response = await world.ana.action(api.semantic.search, { query: "Newton laws inertia" });
    expect(response.mode).toBe("words_only");
    expect(response.degraded).toEqual({ reason: "embeddings_unavailable" });
    expect(response.results[0]?.itemId).toBe(world.ids["a-newton"]);
    const related = await world.ana.action(api.semantic.related, { itemId: world.ids["a-newton"]! });
    expect(related.mode).toBe("hybrid");
  }, 30_000);

  it("keeps full-text current and vectors pending through an outage, then recovers", async () => {
    const world = await createSemanticWorld({ corpus: false });
    outage();
    const { artifactId, queueId } = await world.t.run(async (ctx) => {
      const id = await insertArtifact(ctx, { ownerAccountId: world.anaId, schoolId: world.schoolA, blueprintKey: "document",
        title: "Glacier field notes", content: { blocks: [{ id: "b1", type: "paragraph", text: "Moraines and crevasses." }] } });
      await enqueueSemanticItem(ctx, "artifact", id, { immediate: true });
      const row = (await ctx.db.query("semanticIndexQueue").withIndex("by_item", (q) => q.eq("itemKind", "artifact").eq("itemId", id)).unique())!;
      await ctx.db.patch(row._id, { status: "running", leaseOwner: "test-lease", dueAt: Date.now() + 60_000 });
      return { artifactId: id, queueId: row._id };
    });
    expect(await world.t.action(internal.semanticIndex.reindexItem, { queueId, leaseOwner: "test-lease" }))
      .toEqual({ status: "embedding_provider_unavailable" });
    const state = await world.t.run(async (ctx) => ({
      item: await ctx.db.query("semanticItems").withIndex("by_item", (q) => q.eq("itemKind", "artifact").eq("itemId", artifactId)).unique(),
      queue: await ctx.db.get(queueId),
    }));
    expect(state.item?.embeddingState).toBe("pending");
    expect(state.queue).toMatchObject({ status: "waiting", attempts: 1 });
    const response = await world.ana.action(api.semantic.search, { query: "crevasses" });
    expect(ids(response)).toEqual([artifactId]);

    // The provider is back: the retry fills the vectors.
    vi.stubGlobal("fetch", fetcher);
    await drainIndexQueue(world);
    const item = await world.t.run((ctx) => ctx.db.query("semanticItems").withIndex("by_item", (q) => q.eq("itemKind", "artifact").eq("itemId", artifactId)).unique());
    expect(item?.embeddingState).toBe("complete");
  }, 30_000);
});

