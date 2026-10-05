import type { SpectraArtifact } from "../data/api";
import { isArtifactTypeKey } from "../artifacts/registry";

export const EMBED_CANDIDATE_LIMIT = 40;

export type EmbedCandidateInput = {
  artifacts: readonly SpectraArtifact[];
  /** The work being embedded into: never a candidate for itself. */
  containerId: string;
  query: string;
  /** Semantic search hits for the query, best first. */
  searchIds?: readonly string[];
  /** Work related to the container (links first, then similar), best first. */
  relatedIds?: readonly string[];
};

/**
 * The embed picker's list (EDITORS.md, Embeds: "Recent and related items come
 * first"). It used to be the work list in whatever order it arrived, filtered
 * by one substring of the whole query, so "biology cell" missed "Cell
 * biology" and a search could not find work by what it says inside.
 *
 * Without a query: related work first, then the most recently changed.
 * With one: semantic hits in their order, then the work whose title, summary,
 * tags or type contain every word, related and recent first.
 */
export function rankEmbedCandidates({
  artifacts,
  containerId,
  query,
  searchIds = [],
  relatedIds = [],
}: EmbedCandidateInput): SpectraArtifact[] {
  const eligible = artifacts.filter(
    (artifact) =>
      isArtifactTypeKey(artifact.blueprintKey) &&
      artifact._id !== containerId &&
      artifact.status !== "deleted",
  );
  const related = rankOf(relatedIds);
  const searched = rankOf(searchIds);
  const byRelatedThenRecent = (a: SpectraArtifact, b: SpectraArtifact) =>
    (related.get(a._id) ?? Infinity) - (related.get(b._id) ?? Infinity) ||
    (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length)
    return [...eligible].sort(byRelatedThenRecent).slice(0, EMBED_CANDIDATE_LIMIT);
  const matches = (artifact: SpectraArtifact) => {
    const haystack = `${artifact.title} ${artifact.summary ?? ""} ${(artifact.tags ?? []).join(" ")} ${artifact.blueprintKey}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  };
  const hits = eligible
    .filter((artifact) => searched.has(artifact._id))
    .sort((a, b) => searched.get(a._id)! - searched.get(b._id)!);
  const lexical = eligible
    .filter((artifact) => !searched.has(artifact._id) && matches(artifact))
    .sort(byRelatedThenRecent);
  return [...hits, ...lexical].slice(0, EMBED_CANDIDATE_LIMIT);
}

function rankOf(ids: readonly string[]) {
  const rank = new Map<string, number>();
  ids.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  return rank;
}
