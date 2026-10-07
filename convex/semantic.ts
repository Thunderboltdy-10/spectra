/**
 * The semantic layer's public API: `search`, `searchThreads` and `related`.
 *
 * Flow of a search: the query is embedded (cached per user) while a query computes the viewer's
 * partitions from live grants; vector searches over those partitions run in parallel; one
 * hydrate query adds full-text matches, re-checks access on every candidate, fuses by RRF,
 * groups by item and ranks with the query's type and time cues and the caller's hints. When the
 * embedding provider is down or unconfigured, the same path returns full-text results and says so.
 * See src/features/spectra/semantic/README.md.
 */
import { v, type Validator } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./functions";
import { embedQuery, embeddingInputFits, embeddingVersion, type QueryEmbeddingResult } from "./embeddingProvider";
import { getAuthenticatedActor } from "./identityShared";
import { itemKeyOf, vectorFilterGroups, vSemanticKind, type VectorTerm } from "./semanticKeys";
import { kindOfId, readableItems, sourceFor, viewerPartitions, workspaceReadable, type ReadableItem } from "./semanticSources";
import { parseQueryCues, type QueryCues } from "../shared/semantic-query";
import {
  cosine, fuseAndGroup, hintedItemFits, isCopy, lexicalQuery, lexicalText as lexicalTextOf, rankWithSignals, SEMANTIC_TUNING,
  snippetFor, titleMatches, type CandidateChunk,
} from "../shared/semantic-ranking";
import {
  INDEXED_SEMANTIC_KINDS, SEMANTIC_KINDS, type IndexedSemanticKind, type RelatedReason, type RelatedResponse, type RelatedResult,
  type SemanticAnchor, type SemanticDegradedReason, type SemanticKind, type SemanticMatch, type SemanticResult,
  type SemanticSearchResponse,
} from "../shared/semantic-types";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const MAX_QUERY_CHARS = 1_000;
const VECTOR_LIMIT = 64;
const LEXICAL_PER_SCOPE = 24;
/** Candidates whose access is re-checked; the rest cannot reach the top `limit` anyway. */
const MAX_CHECKED = 60;
const MAX_HINTED = 40;
const MAX_GRANTED_TITLE_CHECKS = 60;
const RELATED_DEFAULT_LIMIT = 8;
const RELATED_NEIGHBORS = 32;
const RELATED_TTL_MS = 30 * 60_000;
/** Passages searched with the item's centroid to find each neighbour's closest one (the item's own come first). */
const RELATED_PASSAGE_HITS = 96;
const CLOCK_SKEW_MS = 86_400_000;

const vSearchKind = v.union(...SEMANTIC_KINDS.map((kind) => v.literal(kind))) as unknown as Validator<SemanticKind, "required", never>;
const vHints = v.object({
  openItemIds: v.optional(v.array(v.string())),
  recentItemIds: v.optional(v.array(v.string())),
  now: v.optional(v.number()),
  timezoneOffsetMinutes: v.optional(v.number()),
});
type Hints = { openItemIds?: string[]; recentItemIds?: string[]; now?: number; timezoneOffsetMinutes?: number };
const vLexicalScope = v.object({
  itemKind: v.optional(vSemanticKind), ownerAccountId: v.optional(v.id("accounts")),
  workspaceKey: v.optional(v.string()), audienceKey: v.optional(v.string()),
});
const vItemRef = v.object({ kind: vSemanticKind, itemId: v.string() });

async function requireActor(ctx: QueryCtx) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return actor;
}

const clampLimit = (limit: number | undefined, fallback: number) =>
  Math.max(1, Math.min(MAX_LIMIT, Math.round(Number.isFinite(limit) ? limit! : fallback)));

/** The client clock is trusted for "yesterday" only within a day of the server's. */
function clientNow(hints?: Hints) {
  const now = Date.now();
  return hints?.now !== undefined && Math.abs(hints.now - now) < CLOCK_SKEW_MS ? hints.now : now;
}
const clientOffset = (hints?: Hints) => {
  const offset = hints?.timezoneOffsetMinutes;
  return offset !== undefined && Number.isFinite(offset) && Math.abs(offset) <= 14 * 60 ? offset : 0;
};

function anchorFor(kind: IndexedSemanticKind, itemId: string, chunk?: { regionId?: string; messageId?: string; label?: string }): SemanticAnchor {
  if (kind === "artifact") return { kind, artifactId: itemId, regionId: chunk?.regionId, label: chunk?.label };
  if (kind === "thread") return { kind, threadId: itemId, messageId: chunk?.messageId };
  if (kind === "event") return { kind, calendarItemId: itemId };
  return { kind, recordId: itemId };
}

async function semanticItemRow(ctx: QueryCtx, kind: IndexedSemanticKind, itemId: string) {
  return ctx.db.query("semanticItems").withIndex("by_item", (q) => q.eq("itemKind", kind).eq("itemId", itemId)).unique();
}

/** Workspace context for results, only for workspaces the viewer can open. */
function workspaceResolver(ctx: QueryCtx, actor: Awaited<ReturnType<typeof requireActor>>) {
  const cache = new Map<string, Promise<{ id: string; title: string } | undefined>>();
  return (workspaceId?: Id<"spectraWorkspaces">) => {
    if (!workspaceId) return Promise.resolve(undefined);
    let entry = cache.get(workspaceId);
    if (!entry) {
      entry = (async () => {
        if (!(await workspaceReadable(ctx, actor, workspaceId))) return undefined;
        const workspace = await ctx.db.get(workspaceId);
        return workspace ? { id: String(workspace._id), title: workspace.title } : undefined;
      })();
      cache.set(workspaceId, entry);
    }
    return entry;
  };
}

// ---------------------------------------------------------------------------------------------
// Search

export const prepare = internalQuery({
  args: { kinds: v.array(vSemanticKind), workspaceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const workspaceId = args.workspaceId === undefined ? undefined : ctx.db.normalizeId("spectraWorkspaces", args.workspaceId);
    if (args.workspaceId !== undefined && !workspaceId)
      return { keys: [], lexical: [], grantedItemIds: [], truncated: false, workspaceId: undefined, workspaceDenied: true };
    const partitions = await viewerPartitions(ctx, { actor, workspaceId: workspaceId ?? undefined }, args.kinds);
    return { ...partitions, workspaceId: workspaceId ?? undefined };
  },
});

type HydrateArgs = {
  query: string;
  kinds: IndexedSemanticKind[];
  lexical: Array<{ itemKind?: IndexedSemanticKind; ownerAccountId?: Id<"accounts">; workspaceKey?: string; audienceKey?: string }>;
  grantedItemIds: Array<{ kind: IndexedSemanticKind; itemId: string }>;
  vectorHits: Array<{ chunkId: Id<"semanticChunks">; similarity: number }>;
  queryVector?: number[];
  hints?: Hints;
  limit: number;
};

type Candidate = CandidateChunk & { doc: Doc<"semanticChunks"> };

export const hydrate = internalQuery({
  args: {
    query: v.string(), kinds: v.array(vSemanticKind), lexical: v.array(vLexicalScope), grantedItemIds: v.array(vItemRef),
    vectorHits: v.array(v.object({ chunkId: v.id("semanticChunks"), similarity: v.number() })),
    queryVector: v.optional(v.array(v.float64())), hints: v.optional(vHints), limit: v.number(),
  },
  handler: async (ctx, args): Promise<SemanticResult[]> => hydrateSearch(ctx, args),
});

async function hydrateSearch(ctx: QueryCtx, args: HydrateArgs): Promise<SemanticResult[]> {
  const actor = await requireActor(ctx);
  const now = clientNow(args.hints);
  const cues = parseQueryCues(args.query, { now, timezoneOffsetMinutes: clientOffset(args.hints) });
  const kinds = new Set(args.kinds);
  const chunks = new Map<string, Candidate>();
  // Defence in depth: an owner-only passage never reaches anyone but its owner.
  const admit = (doc: Doc<"semanticChunks"> | null): doc is Doc<"semanticChunks"> =>
    Boolean(doc && kinds.has(doc.itemKind) && (!doc.ownerOnly || doc.ownerAccountId === actor.accountId));
  const remember = (doc: Doc<"semanticChunks">) => {
    const chunkId = String(doc._id);
    if (!chunks.has(chunkId))
      chunks.set(chunkId, { chunkId, itemKey: itemKeyOf(doc.itemKind, doc.itemId), title: doc.title, label: doc.label, text: doc.text, doc });
    return chunkId;
  };

  // Full-text, one search per partition scope, interleaved so no scope crowds out the others.
  const lexicalText = lexicalQuery(lexicalTextOf(cues));
  const lexicalLists = lexicalText ? await Promise.all(args.lexical.map((scope) =>
    ctx.db.query("semanticChunks").withSearchIndex("search_text", (q) => {
      let search = q.search("searchText", lexicalText);
      if (scope.itemKind) search = search.eq("itemKind", scope.itemKind);
      if (scope.ownerAccountId) search = search.eq("ownerAccountId", scope.ownerAccountId);
      if (scope.workspaceKey) search = search.eq("workspaceKey", scope.workspaceKey);
      if (scope.audienceKey) search = search.eq("audienceKey", scope.audienceKey);
      return search;
    }).take(LEXICAL_PER_SCOPE))) : [];
  const words: string[] = [];
  for (let rank = 0; rank < LEXICAL_PER_SCOPE; rank += 1)
    for (const list of lexicalLists) { const doc = list[rank]; if (admit(doc ?? null)) words.push(remember(doc!)); }
  const title = words.filter((chunkId) => titleMatches(chunks.get(chunkId)!.title, cues.text));

  // Items shared directly with the viewer have no full-text partition; match their titles here.
  if (lexicalText)
    for (const ref of args.grantedItemIds.slice(0, MAX_GRANTED_TITLE_CHECKS)) {
      const item = await semanticItemRow(ctx, ref.kind, ref.itemId);
      if (!item || !kinds.has(item.itemKind) || !titleMatches(item.title, cues.text)) continue;
      const doc = await ctx.db.query("semanticChunks")
        .withIndex("by_item", (q) => q.eq("itemKind", ref.kind).eq("itemId", ref.itemId).eq("chunkKey", "title")).unique();
      if (admit(doc)) title.push(remember(doc));
    }

  const vectorDocs = await Promise.all(args.vectorHits.map((hit) => ctx.db.get(hit.chunkId)));
  const vector = args.vectorHits.flatMap((hit, index) => {
    const doc = vectorDocs[index] ?? null;
    return admit(doc) ? [{ chunkId: remember(doc), similarity: hit.similarity }] : [];
  });

  const fused = fuseAndGroup({ chunks, vector, words, title }).slice(0, MAX_CHECKED);
  const candidates = new Map(fused.map((item) => [item.itemKey, { best: item.best, base: item.normalized, matchedBy: item.matchedBy }]));

  // Hinted and recent items the query's cues point at, even when retrieval missed them.
  const hinted: Array<{ kind: IndexedSemanticKind; itemId: string }> = [];
  for (const itemId of [...(args.hints?.openItemIds ?? []).slice(0, 20), ...(args.hints?.recentItemIds ?? []).slice(0, 30)]) {
    const kind = kindOfId(ctx, itemId);
    if (kind && kinds.has(kind)) hinted.push({ kind, itemId });
  }
  if (cues.window || cues.recency || cues.types.length) {
    const recent = await ctx.db.query("semanticItems")
      .withIndex("by_owner_updated", (q) => q.eq("ownerAccountId", actor.accountId)).order("desc").take(MAX_HINTED);
    hinted.push(...recent.filter((row) => kinds.has(row.itemKind)).map((row) => ({ kind: row.itemKind, itemId: row.itemId })));
  }
  for (const ref of hinted.slice(0, MAX_HINTED * 2)) {
    const key = itemKeyOf(ref.kind, ref.itemId);
    if (candidates.has(key)) continue;
    const row = await semanticItemRow(ctx, ref.kind, ref.itemId);
    if (!row) continue;
    const similarity = args.queryVector && row.centroid ? cosine(args.queryVector, row.centroid) : undefined;
    if (!hintedItemFits(cues, { kind: row.itemKind, subtype: row.subtype, title: row.title, updatedAt: row.sourceUpdatedAt,
      timeAt: row.timeAt, similarity })) continue;
    const doc = await ctx.db.query("semanticChunks")
      .withIndex("by_item", (q) => q.eq("itemKind", ref.kind).eq("itemId", ref.itemId)).first();
    if (!admit(doc)) continue;
    const best = chunks.get(remember(doc))!;
    const base = similarity === undefined ? 0.05 : Math.max(0.05, Math.min(0.3, (similarity - SEMANTIC_TUNING.minVectorSimilarity) * 0.8));
    candidates.set(key, { best, base, matchedBy: similarity !== undefined && similarity >= SEMANTIC_TUNING.relatedMinSimilarity ? ["meaning"] : [] });
  }

  // The mandatory read-time check on every candidate.
  const refs = [...candidates.values()].map((candidate) => ({ kind: candidate.best.doc.itemKind, itemId: candidate.best.doc.itemId }));
  const readable = await readableItems(ctx, actor, refs);
  const rows = new Map<string, Doc<"semanticItems"> | null>();
  await Promise.all([...readable.keys()].map(async (key) => {
    const item = readable.get(key)!;
    rows.set(key, await semanticItemRow(ctx, item.kind, item.itemId));
  }));
  const mirrored = new Set([...rows.values()].flatMap((row) => row?.mirrors ? [row.mirrors] : []));
  const ranked = rankWithSignals([...candidates.entries()].flatMap(([key, candidate]) => {
    const item = readable.get(key);
    if (!item || mirrored.has(key)) return [];
    return [{ key, item, best: candidate.best, itemId: item.itemId, kind: item.kind, subtype: item.subtype, updatedAt: item.updatedAt,
      timeAt: item.timeAt ?? rows.get(key)?.timeAt, base: candidate.base, matchedBy: candidate.matchedBy }];
  }), cues, { openItemIds: args.hints?.openItemIds, recentItemIds: args.hints?.recentItemIds, now }).slice(0, args.limit);

  const top = ranked[0]?.score ?? 1;
  const workspaceOf = workspaceResolver(ctx, actor);
  return Promise.all(ranked.map(async (entry): Promise<SemanticResult> => resultFor(entry.item, {
    snippet: snippetFor(entry.best.text, cues.text), location: entry.best.label, anchor: anchorFor(entry.kind, entry.itemId, entry.best.doc),
    score: Math.round((entry.score / top) * 1_000) / 1_000, matchedBy: entry.matchedBy, timeAt: entry.timeAt,
    workspace: await workspaceOf(rows.get(entry.key)?.workspaceId),
  })));
}

function resultFor(item: ReadableItem, extra: { snippet: string; location?: string; anchor: SemanticAnchor; score: number;
  matchedBy: SemanticMatch[]; timeAt?: number; workspace?: { id: string; title: string } }): SemanticResult {
  return { kind: item.kind, itemId: item.itemId, title: item.title, typeLabel: item.typeLabel, subtype: item.subtype,
    snippet: extra.snippet, location: extra.location, anchor: extra.anchor, score: extra.score, matchedBy: extra.matchedBy,
    status: item.status, updatedAt: item.updatedAt, timeAt: extra.timeAt, workspace: extra.workspace, ownership: item.ownership };
}

function degradedFor(embedded: QueryEmbeddingResult | null): SemanticDegradedReason | undefined {
  if (!embedded) return "query_too_large";
  if (embedded.ok) return undefined;
  return embedded.code === "not_configured" ? "embeddings_not_configured" : "embeddings_unavailable";
}

/** Vector search over the viewer's partitions, one call per filter group, best score per row. */
async function vectorHits(ctx: ActionCtx, table: "semanticChunks" | "semanticItems", vector: number[], version: string, keys: string[],
  limit: number) {
  const search = (terms: VectorTerm[]) => table === "semanticChunks"
    ? ctx.vectorSearch("semanticChunks", "by_embedding", { vector, limit,
        filter: (q) => q.or(...terms.map((term) => q.eq(term.field, term.value))) })
    : ctx.vectorSearch("semanticItems", "by_centroid", { vector, limit,
        filter: (q) => q.or(...terms.map((term) => q.eq(term.field, term.value))) });
  const results = await Promise.all(vectorFilterGroups(version, keys).map(search));
  const best = new Map<string, number>();
  for (const hit of results.flat()) best.set(String(hit._id), Math.max(best.get(String(hit._id)) ?? -1, hit._score));
  return [...best.entries()].map(([id, similarity]) => ({ id, similarity })).sort((a, b) => b.similarity - a.similarity);
}

type SearchInput = { query: string; kinds?: SemanticKind[]; workspaceId?: string; limit?: number; hints?: Hints };

async function runSearch(ctx: ActionCtx, args: SearchInput): Promise<SemanticSearchResponse> {
  const started = Date.now();
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  const query = args.query.trim().slice(0, MAX_QUERY_CHARS);
  const kinds = [...new Set(args.kinds?.length ? args.kinds : INDEXED_SEMANTIC_KINDS)];
  const indexedKinds = kinds.filter((kind): kind is IndexedSemanticKind => kind !== "memory");
  const limit = clampLimit(args.limit, DEFAULT_LIMIT);
  if (!query) return { results: [], mode: "hybrid", tookMs: Date.now() - started };
  const cues: QueryCues = parseQueryCues(query, { now: clientNow(args.hints), timezoneOffsetMinutes: clientOffset(args.hints) });
  const embedText = cues.text;
  const [prepared, embedded] = await Promise.all([
    ctx.runQuery(internal.semantic.prepare, { kinds: indexedKinds, workspaceId: args.workspaceId }),
    embeddingInputFits(embedText)
      ? embedQuery(identity.tokenIdentifier, embedText).catch((): QueryEmbeddingResult => ({ ok: false, code: "network", retryable: true, cacheHit: false }))
      : Promise.resolve(null),
  ]);
  if (prepared.workspaceDenied) return { results: [], mode: embedded?.ok ? "hybrid" : "words_only", tookMs: Date.now() - started };
  const hits = embedded?.ok && prepared.keys.length
    ? await vectorHits(ctx, "semanticChunks", embedded.vector, embedded.version, prepared.keys, VECTOR_LIMIT) : [];
  const [results, memory] = await Promise.all([
    indexedKinds.length ? ctx.runQuery(internal.semantic.hydrate, {
      query, kinds: indexedKinds, lexical: prepared.lexical, grantedItemIds: prepared.grantedItemIds,
      vectorHits: hits.map((hit) => ({ chunkId: hit.id as Id<"semanticChunks">, similarity: hit.similarity })),
      queryVector: embedded?.ok ? embedded.vector : undefined, hints: args.hints, limit,
    }) : Promise.resolve([] as SemanticResult[]),
    kinds.includes("memory") ? memoryResults(ctx, query, embedded, prepared.workspaceId) : Promise.resolve([] as SemanticResult[]),
  ]);
  const merged = memory.length ? [...results, ...memory].sort((a, b) => b.score - a.score).slice(0, limit) : results;
  const reason = degradedFor(embedded) ?? (prepared.truncated ? "index_partial" : undefined);
  return { results: merged, mode: embedded?.ok ? "hybrid" : "words_only", ...(reason ? { degraded: { reason } } : {}),
    tookMs: Date.now() - started };
}

/** Memory joins through its own consent-aware retrieval (convex/memory.ts), embedded by the same provider. */
async function memoryResults(ctx: ActionCtx, query: string, embedded: QueryEmbeddingResult | null,
  workspaceId?: Id<"spectraWorkspaces">): Promise<SemanticResult[]> {
  const identity = await ctx.runQuery(internal.memory.retrievalIdentity, { workspaceId });
  if (!identity.enabled) return [];
  let semanticMatches: Array<{ claimId: Id<"memoryClaims">; score: number }> = [];
  if (embedded?.ok && identity.partitions.length) {
    const matches = await ctx.vectorSearch("memoryClaims", "by_embedding", { vector: embedded.vector, limit: 40,
      filter: (q) => q.or(...identity.partitions.map((partition) => q.eq("embeddingPartition", partition.key))) });
    semanticMatches = matches.map((match) => ({ claimId: match._id, score: match._score }));
  }
  const context = await ctx.runQuery(internal.memory.contextForRunBase, { queryText: query, workspaceId, semanticMatches,
    retrievalStatus: embedded?.ok ? "semantic_and_literal" : embedded ? embedded.code : "query_too_large", targetTokens: 600 });
  if (!context.enabled) return [];
  const scores = new Map(semanticMatches.map((match) => [String(match.claimId), match.score]));
  return (context.claims ?? []).map((claim, index): SemanticResult => {
    const similarity = scores.get(String(claim.claimId));
    return {
      kind: "memory", itemId: String(claim.claimId), title: claim.proposition.slice(0, 120), typeLabel: "Memory",
      snippet: claim.proposition, anchor: { kind: "memory", claimId: String(claim.claimId) },
      // Memory is context about the user, not a work item: it ranks below a strong item match.
      score: Math.round(0.85 * (similarity !== undefined ? Math.min(1, Math.max(0, (similarity - SEMANTIC_TUNING.minVectorSimilarity) / 0.5))
        : 0.4 / (1 + index)) * 1_000) / 1_000,
      matchedBy: similarity !== undefined ? ["meaning"] : ["words"], ownership: "mine",
    };
  });
}

/**
 * Search everything the user can open: artifacts of every type, chats, calendar items, school
 * data and (when asked) memory. Hints rank, never filter.
 */
export const search = action({
  args: { query: v.string(), kinds: v.optional(v.array(vSearchKind)), workspaceId: v.optional(v.string()), limit: v.optional(v.number()),
    hints: v.optional(vHints) },
  handler: (ctx, args): Promise<SemanticSearchResponse> => runSearch(ctx, args),
});

/** Search the user's chats: titles, summaries and messages. Anchors point at the best message. */
export const searchThreads = action({
  args: { query: v.string(), workspaceId: v.optional(v.string()), limit: v.optional(v.number()), hints: v.optional(vHints) },
  handler: (ctx, args): Promise<SemanticSearchResponse> => runSearch(ctx, { ...args, kinds: ["thread"] }),
});

// ---------------------------------------------------------------------------------------------
// Related

export const relatedPrepare = internalQuery({
  args: { itemId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const kind = kindOfId(ctx, args.itemId);
    if (!kind) return null;
    const self = (await readableItems(ctx, actor, [{ kind, itemId: args.itemId }])).get(itemKeyOf(kind, args.itemId));
    if (!self) return null;
    const source = sourceFor(kind);
    const links = source.links ? await source.links(ctx, actor, args.itemId) : [];
    const row = await semanticItemRow(ctx, kind, args.itemId);
    const version = embeddingVersion();
    const cache = await ctx.db.query("semanticRelatedCache")
      .withIndex("by_account_item", (q) => q.eq("accountId", actor.accountId).eq("itemKind", kind).eq("itemId", args.itemId)).unique();
    const fresh = Boolean(cache && row && version && cache.generation === row.indexedAt && cache.embeddingVersion === version &&
      cache.expiresAt > Date.now());
    const partitions = fresh || !row?.centroid ? null : await viewerPartitions(ctx, { actor }, INDEXED_SEMANTIC_KINDS);
    return {
      kind, links, version, generation: row?.indexedAt, accountId: actor.accountId, schoolId: actor.schoolId,
      cachedNeighbors: fresh ? cache!.neighbors : undefined,
      centroid: !fresh && row?.centroid && row.embeddingVersion === version ? row.centroid : undefined,
      keys: partitions?.keys ?? [],
      embeddingState: row?.embeddingState,
    };
  },
});

const vNeighbor = v.object({ itemKind: vSemanticKind, itemId: v.string(), similarity: v.number(), chunkKey: v.optional(v.string()) });

/** Scheduled by `related` (no auth in scheduled functions, so the viewer comes from relatedPrepare). */
export const storeRelated = internalMutation({
  args: { accountId: v.id("accounts"), schoolId: v.id("schools"), itemKind: vSemanticKind, itemId: v.string(), generation: v.number(),
    embeddingVersion: v.string(), neighbors: v.array(vNeighbor) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("semanticRelatedCache")
      .withIndex("by_account_item", (q) => q.eq("accountId", args.accountId).eq("itemKind", args.itemKind).eq("itemId", args.itemId)).unique();
    const fields = { schoolId: args.schoolId, generation: args.generation, embeddingVersion: args.embeddingVersion,
      neighbors: args.neighbors.slice(0, RELATED_NEIGHBORS), expiresAt: Date.now() + RELATED_TTL_MS };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("semanticRelatedCache", { accountId: args.accountId, itemKind: args.itemKind, itemId: args.itemId, ...fields });
  },
});

export const relatedHydrate = internalQuery({
  args: {
    item: vItemRef,
    links: v.array(v.object({ kind: vSemanticKind, itemId: v.string(), reason: v.any() })),
    neighbors: v.array(vNeighbor),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<RelatedResult[]> => {
    const actor = await requireActor(ctx);
    const selfKey = itemKeyOf(args.item.kind, args.item.itemId);
    const self = await semanticItemRow(ctx, args.item.kind, args.item.itemId);
    const similar = args.neighbors.filter((neighbor) => neighbor.similarity >= SEMANTIC_TUNING.relatedMinSimilarity);
    const passages = new Map(similar.flatMap((neighbor) =>
      neighbor.chunkKey ? [[itemKeyOf(neighbor.itemKind, neighbor.itemId), neighbor.chunkKey] as const] : []));
    const refs = [...args.links.map((link) => ({ kind: link.kind, itemId: link.itemId })),
      ...similar.map((neighbor) => ({ kind: neighbor.itemKind, itemId: neighbor.itemId }))];
    const readable = await readableItems(ctx, actor, refs);
    const rows = new Map<string, Doc<"semanticItems"> | null>();
    await Promise.all([...readable.values()].map(async (item) =>
      rows.set(itemKeyOf(item.kind, item.itemId), await semanticItemRow(ctx, item.kind, item.itemId))));
    const lineage = new Set([...(self?.lineageIds ?? [])]);
    const sameContent = (key: string) => {
      const row = rows.get(key);
      return Boolean(self && row && row.contentDigest === self.contentDigest);
    };
    const entries = new Map<string, { item: ReadableItem; reasons: RelatedReason[]; similarity?: number; explicit: boolean }>();
    for (const link of args.links) {
      const key = itemKeyOf(link.kind, link.itemId);
      const item = readable.get(key);
      if (!item || key === selfKey || sameContent(key)) continue;
      const entry = entries.get(key) ?? { item, reasons: [], explicit: true };
      entry.reasons.push(link.reason as RelatedReason);
      entries.set(key, entry);
    }
    for (const neighbor of similar) {
      const key = itemKeyOf(neighbor.itemKind, neighbor.itemId);
      const item = readable.get(key);
      if (!item || key === selfKey) continue;
      const row = rows.get(key);
      const isLineage = lineage.has(neighbor.itemId) || Boolean(row?.lineageIds.includes(args.item.itemId));
      if (isCopy({ sameDigest: sameContent(key), lineage: isLineage, similarity: neighbor.similarity })) continue;
      const entry = entries.get(key) ?? { item, reasons: [], explicit: false };
      entry.similarity = neighbor.similarity;
      entry.reasons.push({ type: "similar", similarity: Math.round(neighbor.similarity * 1_000) / 1_000 });
      entries.set(key, entry);
    }
    const ordered = [...entries.entries()].sort(([, a], [, b]) =>
      Number(b.explicit) - Number(a.explicit) || (b.similarity ?? 0) - (a.similarity ?? 0) || (b.item.updatedAt ?? 0) - (a.item.updatedAt ?? 0))
      .slice(0, args.limit);
    const workspaceOf = workspaceResolver(ctx, actor);
    return Promise.all(ordered.map(async ([key, entry]): Promise<RelatedResult> => {
      const row = rows.get(key);
      const readableChunk = async (chunkKey: string) => {
        const chunk = await ctx.db.query("semanticChunks")
          .withIndex("by_item", (q) => q.eq("itemKind", entry.item.kind).eq("itemId", entry.item.itemId).eq("chunkKey", chunkKey)).unique();
        return chunk && (!chunk.ownerOnly || chunk.ownerAccountId === actor.accountId) ? chunk : null;
      };
      // The neighbour's passage most like this item, when one was found: its place and words.
      const passageKey = passages.get(key);
      const passage = passageKey ? await readableChunk(passageKey) : null;
      const placed = passage?.regionId ? passage : null;
      const best = placed ?? await readableChunk("title");
      const snippet = best ? snippetFor(best.text, "", 160) : undefined;
      return { kind: entry.item.kind, itemId: entry.item.itemId, title: entry.item.title, typeLabel: entry.item.typeLabel,
        subtype: entry.item.subtype, snippet, ...(placed?.label ? { location: placed.label } : {}),
        anchor: anchorFor(entry.item.kind, entry.item.itemId, placed ?? undefined), reasons: entry.reasons,
        score: entry.explicit ? 1 : Math.round((entry.similarity ?? 0) * 1_000) / 1_000, status: entry.item.status,
        updatedAt: entry.item.updatedAt, timeAt: entry.item.timeAt ?? row?.timeAt, workspace: await workspaceOf(row?.workspaceId),
        ownership: entry.item.ownership };
    }));
  },
});

/**
 * Items related to one item: explicit links first (artifact links, the chat it was made in,
 * chats about it), then items close in meaning above a tuned threshold. Self and copies are
 * excluded. Similar candidates are cached per viewer and item until the item is re-indexed.
 */
export const related = action({
  args: { itemId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<RelatedResponse> => {
    const started = Date.now();
    const limit = clampLimit(args.limit, RELATED_DEFAULT_LIMIT);
    const prepared = await ctx.runQuery(internal.semantic.relatedPrepare, { itemId: args.itemId });
    if (!prepared) return { results: [], mode: "links_only", cached: false, tookMs: Date.now() - started };
    let neighbors = prepared.cachedNeighbors;
    let degraded: SemanticDegradedReason | undefined;
    if (!neighbors && prepared.centroid && prepared.version && prepared.keys.length) {
      const hits = await vectorHits(ctx, "semanticItems", prepared.centroid, prepared.version, prepared.keys, RELATED_NEIGHBORS + 1);
      const rows = hits.length ? await ctx.runQuery(internal.semantic.itemRefs, { ids: hits.map((hit) => hit.id as Id<"semanticItems">) }) : [];
      const refs = new Map(rows.map((row) => [row.id, row]));
      neighbors = hits.flatMap((hit) => {
        const row = refs.get(hit.id);
        return row && !(row.itemKind === prepared.kind && row.itemId === args.itemId)
          ? [{ itemKind: row.itemKind, itemId: row.itemId, similarity: hit.similarity }] : [];
      }).slice(0, RELATED_NEIGHBORS);
      neighbors = await withPassages(ctx, neighbors, prepared.centroid, prepared.version, prepared.keys);
      if (prepared.generation !== undefined)
        await ctx.scheduler.runAfter(0, internal.semantic.storeRelated, { accountId: prepared.accountId, schoolId: prepared.schoolId,
          itemKind: prepared.kind, itemId: args.itemId,
          generation: prepared.generation, embeddingVersion: prepared.version, neighbors });
    } else if (!neighbors) {
      degraded = !prepared.version ? "embeddings_not_configured" : prepared.embeddingState === "complete" ? undefined : "index_partial";
    }
    const results = await ctx.runQuery(internal.semantic.relatedHydrate, { item: { kind: prepared.kind, itemId: args.itemId },
      links: prepared.links, neighbors: neighbors ?? [], limit });
    return { results, mode: neighbors ? "hybrid" : "links_only", ...(degraded ? { degraded: { reason: degraded } } : {}),
      cached: Boolean(prepared.cachedNeighbors), tookMs: Date.now() - started };
  },
});

/**
 * Each neighbour's passage closest to the item: one search over passages with
 * the item's centroid, keeping per neighbour its best passage that names a
 * place (a block, slide, range, card). Readability is checked when it is shown.
 */
async function withPassages(ctx: ActionCtx, neighbors: Array<{ itemKind: IndexedSemanticKind; itemId: string; similarity: number }>,
  centroid: number[], version: string, keys: string[]) {
  if (!neighbors.some((neighbor) => neighbor.itemKind === "artifact")) return neighbors;
  const hits = await vectorHits(ctx, "semanticChunks", centroid, version, keys, RELATED_PASSAGE_HITS);
  const refs = hits.length ? await ctx.runQuery(internal.semantic.chunkRefs, { ids: hits.map((hit) => hit.id as Id<"semanticChunks">) }) : [];
  const byId = new Map(refs.map((ref) => [ref.id, ref]));
  const best = new Map<string, string>();
  for (const hit of hits) {
    const ref = byId.get(hit.id);
    if (!ref?.placed) continue;
    const key = itemKeyOf(ref.itemKind, ref.itemId);
    if (!best.has(key)) best.set(key, ref.chunkKey);
  }
  return neighbors.map((neighbor) => {
    const chunkKey = neighbor.itemKind === "artifact" ? best.get(itemKeyOf(neighbor.itemKind, neighbor.itemId)) : undefined;
    return chunkKey ? { ...neighbor, chunkKey } : neighbor;
  });
}

/** Item and passage of chunk hits, and whether the passage names a place. */
export const chunkRefs = internalQuery({
  args: { ids: v.array(v.id("semanticChunks")) },
  handler: async (ctx, args) => {
    const rows = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    return rows.flatMap((row) => row ? [{ id: String(row._id), itemKind: row.itemKind, itemId: row.itemId, chunkKey: row.chunkKey,
      placed: Boolean(row.regionId) }] : []);
  },
});

/** Item kind and id of centroid hits (vector search returns only ids and scores). */
export const itemRefs = internalQuery({
  args: { ids: v.array(v.id("semanticItems")) },
  handler: async (ctx, args) => {
    const rows = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    return rows.flatMap((row) => row ? [{ id: String(row._id), itemKind: row.itemKind, itemId: row.itemId }] : []);
  },
});
