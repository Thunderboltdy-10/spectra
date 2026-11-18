"use client";

/**
 * Search fields that list work by name also find it by meaning: the literal matches keep their
 * place first (a title someone typed is what they want), then the semantic layer's hits that the
 * words missed, in its order. See ./README.md.
 */
import type { SemanticKind, SemanticResult } from "./types";
import { useSemanticSearch, type SemanticSearchOptions } from "./use-semantic";

/** The work (artifact) or thread a result opens. */
export function semanticTargetId(result: Pick<SemanticResult, "itemId" | "anchor">) {
  return result.anchor.kind === "artifact" ? result.anchor.artifactId : result.itemId;
}

/** Every word of the query appears in the text (case-insensitive). */
export function matchesAllWords(text: string, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = text.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * `literal` first, then the semantic hits not already listed (deduplicated by id), capped at
 * `limit`. `extra` turns a hit into a row when it is not among the known rows.
 */
export function mergeMeaningMatches<T>({
  literal,
  hits,
  known = [],
  idOf,
  extra,
  limit = Infinity,
}: {
  literal: readonly T[];
  hits: readonly SemanticResult[];
  known?: readonly T[];
  idOf: (row: T) => string | null | undefined;
  extra?: (hit: SemanticResult) => T | null;
  limit?: number;
}): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  const push = (row: T) => {
    const id = idOf(row);
    if (id) {
      if (seen.has(id)) return;
      seen.add(id);
    }
    out.push(row);
  };
  for (const row of literal) push(row);
  const byId = new Map<string, T>();
  for (const row of known) {
    const id = idOf(row);
    if (id && !byId.has(id)) byId.set(id, row);
  }
  for (const hit of hits) {
    if (out.length >= limit) break;
    const id = semanticTargetId(hit);
    if (seen.has(id)) continue;
    const row = byId.get(id) ?? extra?.(hit) ?? null;
    if (row) push(row);
  }
  return out.slice(0, limit);
}

/**
 * Semantic hits for a name search over `kinds`, ready for `mergeMeaningMatches`. Stays idle for
 * queries shorter than two characters.
 */
export function useMeaningHits(query: string, kinds: SemanticKind[], options: Omit<SemanticSearchOptions, "kinds"> = {}) {
  // The request is compared by value, so a fresh `kinds` array per render is fine.
  const search = useSemanticSearch(query, { limit: 20, ...options, kinds });
  return { hits: search.results, loading: search.status === "loading" };
}
