/**
 * Pure ranking for hybrid search: reciprocal rank fusion of the vector and full-text lists,
 * grouping by item with the best chunk as the snippet. Constants are tuned by
 * scripts/semantic-eval (see docs/spectra-launch-audit/reports/R-A2A-SEMANTIC.md).
 */
import { foldForSearch } from "./semantic-chunks";
import { inWindow, isUpcoming, matchesTypeCue, type QueryCues } from "./semantic-query";
import type { IndexedSemanticKind, SemanticMatch } from "./semantic-types";

/**
 * The tuned retrieval constants, read at call time. Only scripts/semantic-eval writes them, to
 * sweep candidate values in its own process; the chosen values are recorded in the report.
 */
export const SEMANTIC_TUNING = {
  /** RRF constant. Smaller trusts the top of each list more. Live eval 2026-10-04: k=10 MRR 0.982, k=20 0.964. */
  rrfK: 10,
  /** Cosine similarity below which a vector hit is noise for this model and size. */
  minVectorSimilarity: 0.2,
  /**
   * Centroid similarity for Related and for admitting a hinted item by meaning. Live eval
   * 2026-10-04: labelled related pairs 0.52-0.74, unrelated 0.04-0.21; 0.45 leaves margin below
   * the weakest true pair.
   */
  relatedMinSimilarity: 0.45,
};
/** Near-identical vectors are copies, not related work. */
export const COPY_SIMILARITY = 0.995;
export const LINEAGE_COPY_SIMILARITY = 0.97;

const LIST_WEIGHTS = { vector: 1, words: 1, title: 0.6 } as const;
export type RankedList = "vector" | "words" | "title";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "i", "in", "is", "it", "my", "of", "on",
  "or", "that", "the", "this", "to", "was", "what", "when", "where", "which", "with", "about", "me", "find",
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "y", "o", "en", "con", "por", "para", "que",
  "es", "mi", "mis", "sobre", "al", "se", "lo", "su",
]);

/** Folded, de-duplicated content words of a query. */
export function queryTerms(query: string) {
  return [...new Set(foldForSearch(query).split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 2 && !STOPWORDS.has(term)))];
}

/**
 * The words full-text search looks for: the content words when the query has any, so type words
 * ("notes", "deck") rank through the type cue instead of matching every title that says "Notes".
 */
export function lexicalText(cues: QueryCues) {
  return cues.contentTerms.length ? cues.contentTerms.join(" ") : cues.text;
}

/** The folded query for a full-text index whose text was folded the same way. */
export function lexicalQuery(query: string) {
  const terms = queryTerms(query);
  return (terms.length ? terms : foldForSearch(query).split(/\s+/).filter(Boolean)).join(" ").slice(0, 1_000);
}

export type CandidateChunk = {
  chunkId: string;
  itemKey: string;
  title: string;
  label?: string;
  text: string;
};

export type FusedItem<C extends CandidateChunk> = {
  itemKey: string;
  best: C;
  score: number;
  /** 0..1 against the best possible fused score. */
  normalized: number;
  matchedBy: SemanticMatch[];
  vectorSimilarity?: number;
};

/**
 * Fuses ranked chunk lists by reciprocal rank and groups them by item. An item scores its best
 * chunk plus a small share of its second, so one strong passage beats many weak mentions.
 */
export function fuseAndGroup<C extends CandidateChunk>(input: {
  chunks: Map<string, C>;
  vector: Array<{ chunkId: string; similarity: number }>;
  words: string[];
  title?: string[];
  k?: number;
  minVectorSimilarity?: number;
}): Array<FusedItem<C>> {
  const k = input.k ?? SEMANTIC_TUNING.rrfK;
  const chunkScores = new Map<string, { score: number; lists: Set<RankedList>; similarity?: number }>();
  const add = (list: RankedList, chunkId: string, rank: number, similarity?: number) => {
    if (!input.chunks.has(chunkId)) return;
    const entry = chunkScores.get(chunkId) ?? { score: 0, lists: new Set<RankedList>() };
    if (entry.lists.has(list)) return;
    entry.lists.add(list);
    entry.score += LIST_WEIGHTS[list] / (k + rank);
    if (similarity !== undefined) entry.similarity = Math.max(entry.similarity ?? -1, similarity);
    chunkScores.set(chunkId, entry);
  };
  const vector = input.vector.filter((hit) => hit.similarity >= (input.minVectorSimilarity ?? SEMANTIC_TUNING.minVectorSimilarity))
    .sort((a, b) => b.similarity - a.similarity);
  vector.forEach((hit, index) => add("vector", hit.chunkId, index + 1, hit.similarity));
  [...new Set(input.words)].forEach((chunkId, index) => add("words", chunkId, index + 1));
  [...new Set(input.title ?? [])].forEach((chunkId, index) => add("title", chunkId, index + 1));

  const items = new Map<string, { scores: Array<{ chunk: C; score: number }>; lists: Set<RankedList>; similarity?: number }>();
  for (const [chunkId, entry] of chunkScores) {
    const chunk = input.chunks.get(chunkId)!;
    const item = items.get(chunk.itemKey) ?? { scores: [], lists: new Set<RankedList>() };
    item.scores.push({ chunk, score: entry.score });
    entry.lists.forEach((list) => item.lists.add(list));
    if (entry.similarity !== undefined) item.similarity = Math.max(item.similarity ?? -1, entry.similarity);
    items.set(chunk.itemKey, item);
  }
  const ceiling = (LIST_WEIGHTS.vector + LIST_WEIGHTS.words + LIST_WEIGHTS.title) / (k + 1);
  return [...items.entries()].map(([itemKey, item]) => {
    const sorted = item.scores.sort((a, b) => b.score - a.score);
    const score = sorted[0]!.score + 0.15 * (sorted[1]?.score ?? 0);
    const matchedBy: SemanticMatch[] = [];
    if (item.lists.has("vector")) matchedBy.push("meaning");
    if (item.lists.has("words")) matchedBy.push("words");
    if (item.lists.has("title")) matchedBy.push("title");
    return { itemKey, best: sorted[0]!.chunk, score, normalized: Math.min(1, score / ceiling), matchedBy,
      vectorSimilarity: item.similarity };
  }).sort((a, b) => b.score - a.score || a.itemKey.localeCompare(b.itemKey));
}

/** Character-aligned fold, so an index in the folded text is the same index in the original. */
function alignedFold(text: string) {
  let folded = "";
  for (const character of text) {
    const value = foldForSearch(character);
    folded += value.length === character.length ? value : character.toLowerCase().slice(0, character.length).padEnd(character.length, " ");
  }
  return folded;
}

/** About `size` characters around the first query word, on word boundaries. */
export function snippetFor(text: string, query: string, size = 220) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= size) return clean;
  const folded = alignedFold(clean);
  let at = -1;
  for (const term of queryTerms(query)) {
    const index = folded.indexOf(term);
    if (index >= 0 && (at < 0 || index < at)) at = index;
  }
  if (at < 0) return `${clean.slice(0, size).replace(/\s+\S*$/, "")}…`;
  let start = Math.max(0, at - Math.floor(size / 3));
  if (start > 0) { const space = clean.indexOf(" ", start); start = space >= 0 && space < at ? space + 1 : start; }
  let end = Math.min(clean.length, start + size);
  if (end < clean.length) { const space = clean.lastIndexOf(" ", end); end = space > at ? space : end; }
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

/** Whether every query word is in the title (exact or near-exact title searches). */
export function titleMatches(title: string, query: string) {
  const terms = queryTerms(query);
  if (!terms.length) return false;
  const folded = foldForSearch(title);
  return terms.every((term) => folded.includes(term));
}

export function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let index = 0; index < a.length; index += 1) { dot += a[index]! * b[index]!; na += a[index]! ** 2; nb += b[index]! ** 2; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Mean of unit-normalised vectors, normalised again: an item's centroid for Related. */
export function centroid(vectors: number[][]) {
  if (!vectors.length) return undefined;
  const sum = new Array<number>(vectors[0]!.length).fill(0);
  for (const vector of vectors) {
    const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0)) || 1;
    vector.forEach((value, index) => { sum[index]! += value / norm; });
  }
  const norm = Math.sqrt(sum.reduce((total, value) => total + value * value, 0));
  return norm ? sum.map((value) => value / norm) : undefined;
}

/** A copy is the same content, or a lineage relative that barely changed. Copies are never "related". */
export function isCopy(input: { sameDigest: boolean; lineage: boolean; similarity: number }) {
  return input.sameDigest || input.similarity >= COPY_SIMILARITY || (input.lineage && input.similarity >= LINEAGE_COPY_SIMILARITY);
}

/**
 * Ranking signals added to the fused 0..1 score. Retrieval decides what is a candidate; these
 * decide the order among candidates, which is what makes "my chemistry notes" or "the deck from
 * yesterday" land on the right item. Tuned by scripts/semantic-eval.
 */
export const SIGNAL_WEIGHTS = { type: 0.25, when: 0.3, upcoming: 0.2, recency: 0.2, freshness: 0.05, open: 0.2, recent: 0.12 } as const;
const FRESHNESS_HALF_LIFE_MS = 14 * 86_400_000;

export type SignalCandidate = {
  itemId: string;
  kind: IndexedSemanticKind;
  subtype?: string;
  updatedAt?: number;
  timeAt?: number;
  /** Fused retrieval score, 0..1. */
  base: number;
  matchedBy: SemanticMatch[];
};

export function rankWithSignals<T extends SignalCandidate>(candidates: T[], cues: QueryCues,
  hints: { openItemIds?: string[]; recentItemIds?: string[]; now: number }): Array<T & { score: number }> {
  const open = new Map((hints.openItemIds ?? []).slice(0, 20).map((id, index) => [id, index]));
  const recent = new Map((hints.recentItemIds ?? []).slice(0, 50).map((id, index) => [id, index]));
  const scored = candidates.map((candidate) => {
    const matchedBy = new Set(candidate.matchedBy);
    let score = candidate.base;
    if (cues.types.length && matchesTypeCue(cues, candidate)) { score += SIGNAL_WEIGHTS.type; matchedBy.add("type"); }
    if (inWindow(cues, candidate)) { score += SIGNAL_WEIGHTS.when; matchedBy.add("when"); }
    else if (isUpcoming(cues, candidate, hints.now)) { score += SIGNAL_WEIGHTS.upcoming; matchedBy.add("when"); }
    const changed = candidate.updatedAt;
    if (changed !== undefined) {
      const freshness = 0.5 ** (Math.max(0, hints.now - changed) / FRESHNESS_HALF_LIFE_MS);
      score += (cues.recency ? SIGNAL_WEIGHTS.recency : SIGNAL_WEIGHTS.freshness) * freshness;
    }
    const openRank = open.get(candidate.itemId);
    if (openRank !== undefined) { score += SIGNAL_WEIGHTS.open / (1 + openRank * 0.5); matchedBy.add("open"); }
    const recentRank = recent.get(candidate.itemId);
    if (recentRank !== undefined) { score += SIGNAL_WEIGHTS.recent * (1 - recentRank / 50); matchedBy.add("recent"); }
    return { ...candidate, score, matchedBy: [...matchedBy] };
  });
  return scored.sort((a, b) => b.score - a.score || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.itemId.localeCompare(b.itemId));
}

/**
 * Whether an item that retrieval did not return should still be considered because a hint or
 * the query's cues point at it. A query with content words ("my chemistry notes") needs the
 * item to share a word of its title or its meaning; a query of only type and time words ("the
 * deck from yesterday") needs the item to fit that type or time.
 */
export function hintedItemFits(cues: QueryCues, item: { kind: IndexedSemanticKind; subtype?: string; title: string;
  updatedAt?: number; timeAt?: number; similarity?: number }) {
  if (cues.contentTerms.length) {
    const title = foldForSearch(item.title);
    return cues.contentTerms.some((term) => title.includes(term)) || (item.similarity ?? 0) >= SEMANTIC_TUNING.relatedMinSimilarity;
  }
  return (cues.types.length > 0 && matchesTypeCue(cues, item)) || (cues.window !== undefined && inWindow(cues, item));
}
