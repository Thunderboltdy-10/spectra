/*
 * What a run read, so its reply can cite it. A work's source id is its own id;
 * a web page's is a short hash of its address, stable across a paused or
 * resumed run. The model writes `[[cite:SOURCE:WHERE|Label]]`, and the saved
 * reply keeps only the sources it actually cited, which is what makes a
 * citation verified: it names something the run really read.
 */

export type RunSource = { id: string; title: string } & ({ workId: string } | { url: string });

/** At most this many sources are kept per run. */
export const MAX_RUN_SOURCES = 60;

/** "web-1k3j9x": the same address always gets the same id. */
export function webSourceId(url: string) {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `web-${(hash >>> 0).toString(36)}`;
}

/** Later reads of the same source update its title; order is first read first. */
export function mergeSources(current: readonly RunSource[] = [], next: readonly RunSource[] = []): RunSource[] {
  if (!next.length) return current as RunSource[];
  const byId = new Map(current.map((source) => [source.id, source]));
  for (const source of next) byId.set(source.id, source);
  return [...byId.values()].slice(-MAX_RUN_SOURCES);
}

const CITE = /\[\[cite:([^:\]|]+):/g;

/** For plain-text places (run summaries, notifications): citations drop out, a reference reads as its label. */
export function withoutCitations(text: string) {
  return text
    .replace(/\s?\[\[cite:[^\]]*\]\]/g, "")
    .replace(/\[\[ref:[^\]|]+(?:\|([^\]]+))?\]\]/g, (_match, label: string | undefined) => label ?? "");
}

/** The sources `text` cites, in the order they were read. */
export function citedSources(text: string, sources: readonly RunSource[] = []): RunSource[] {
  const cited = new Set([...text.matchAll(CITE)].map((match) => match[1]!.trim()));
  return cited.size ? sources.filter((source) => cited.has(source.id)) : [];
}
