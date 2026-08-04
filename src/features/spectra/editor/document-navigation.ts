import type { JSONContent } from "@tiptap/core";
// Type-only: the source-record module reaches for node:crypto, which has no
// place in a browser bundle. Nothing here needs its runtime.
import type { SourceRecord } from "../sources/records/source-record";

/**
 * Document outline, source navigator and bibliography (§11A).
 *
 * A long document is navigated by its structure and defended by its sources.
 * Both are derived from the document itself rather than kept in a parallel
 * store, so they cannot drift from what is actually written.
 */

// ---------------------------------------------------------------- outline

export type DocumentOutlineEntry = {
  /**
   * The heading node's own position. Selecting inside it means `position + 1`,
   * following ProseMirror's convention that a node's content starts one past it.
   */
  position: number;
  level: number;
  title: string;
  /** Stable block id where the heading has one, for anchors and comments. */
  blockId?: string;
  /** Words between this heading and the next, so long sections are visible. */
  wordCount: number;
};

function nodeText(node: JSONContent): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(nodeText).join("");
}

/**
 * Reads the heading structure with each heading's position and the weight of
 * the section under it. Positions follow ProseMirror's own accounting so the
 * outline can drive selection without a second traversal in the component.
 */
export function documentOutline(
  doc: JSONContent,
): readonly DocumentOutlineEntry[] {
  const entries: DocumentOutlineEntry[] = [];
  const wordsAfter: number[] = [];
  let position = 0;

  const walk = (node: JSONContent, isRoot: boolean) => {
    if (!isRoot) position += 1;
    if (node.type === "heading") {
      const title = nodeText(node).trim();
      entries.push({
        position: position - 1,
        level: Number(node.attrs?.level ?? 1),
        title: title || "Untitled section",
        ...(typeof node.attrs?.blockId === "string"
          ? { blockId: node.attrs.blockId }
          : {}),
        wordCount: 0,
      });
      wordsAfter.push(0);
    } else if (typeof node.text === "string") {
      const words = node.text.trim() ? node.text.trim().split(/\s+/).length : 0;
      if (wordsAfter.length) wordsAfter[wordsAfter.length - 1]! += words;
      position += node.text.length;
      return;
    }
    for (const child of node.content ?? []) walk(child, false);
    if (!isRoot) position += 1;
  };

  walk(doc, true);
  return entries.map((entry, index) => ({
    ...entry,
    wordCount: wordsAfter[index] ?? 0,
  }));
}

/** The heading a position sits under, for "you are here" in a long document. */
export function outlineEntryAt(
  outline: readonly DocumentOutlineEntry[],
  position: number,
) {
  let current: DocumentOutlineEntry | undefined;
  for (const entry of outline) {
    if (entry.position > position) break;
    current = entry;
  }
  return current;
}

// ----------------------------------------------------------- find/replace

export type DocumentMatch = {
  from: number;
  to: number;
  /** A little text either side, so a result list reads as prose. */
  preview: string;
};

export type FindOptions = {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** Treat the query as a regular expression. Invalid patterns find nothing. */
  regex?: boolean;
};

/**
 * The regular expression a find query becomes. Exported so a live editor can
 * scan its own document with exactly the same matching rules this module uses.
 * An invalid user-written pattern finds nothing rather than throwing.
 */
export function documentFindPattern(
  query: string,
  options?: FindOptions,
): RegExp | null {
  const flags = options?.caseSensitive ? "g" : "gi";
  if (options?.regex) {
    try {
      return new RegExp(query, flags);
    } catch {
      return null;
    }
  }
  const escaped = query.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(options?.wholeWord ? `\\b${escaped}\\b` : escaped, flags);
}

/**
 * Finds matches across the document's text, carrying editor positions so a
 * result can be selected without re-searching the document in the component.
 */
export function findInDocument(
  doc: JSONContent,
  query: string,
  options?: FindOptions,
): readonly DocumentMatch[] {
  if (!query) return [];
  const pattern = documentFindPattern(query, options);
  if (!pattern) return [];

  // One flat pass, recording where each text run starts in editor coordinates.
  const runs: { text: string; start: number }[] = [];
  let position = 0;
  const walk = (node: JSONContent, isRoot: boolean) => {
    if (!isRoot) position += 1;
    if (typeof node.text === "string") {
      runs.push({ text: node.text, start: position - 1 });
      position += node.text.length;
      return;
    }
    for (const child of node.content ?? []) walk(child, false);
    if (!isRoot) position += 1;
  };
  walk(doc, true);

  const matches: DocumentMatch[] = [];
  for (const run of runs) {
    pattern.lastIndex = 0;
    let match = pattern.exec(run.text);
    while (match) {
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      } else {
        const from = run.start + match.index;
        matches.push({
          from,
          to: from + match[0].length,
          preview: run.text
            .slice(
              Math.max(0, match.index - 24),
              Math.min(run.text.length, match.index + match[0].length + 24),
            )
            .trim(),
        });
      }
      match = pattern.exec(run.text);
    }
  }
  return matches;
}

// -------------------------------------------------------- source navigator

export type DocumentCitationUse = {
  citationId: string;
  sourceId: string;
  evidenceSpanId?: string;
  label: string;
  /** Editor position, so clicking a source moves the caret to where it is used. */
  position: number;
  /** The heading this citation sits under, for a source navigator that reads well. */
  section?: string;
};

/**
 * Every citation in the document, in reading order, tied to the section it
 * supports. This is what the source navigator lists — the document's own claims
 * about its sources, not a separate bibliography someone maintains by hand.
 */
export function documentCitations(
  doc: JSONContent,
): readonly DocumentCitationUse[] {
  const outline = documentOutline(doc);
  const uses: DocumentCitationUse[] = [];
  let position = 0;

  const walk = (node: JSONContent, isRoot: boolean) => {
    if (!isRoot) position += 1;
    if (node.type === "spectraCitation") {
      const attrs = node.attrs ?? {};
      if (typeof attrs.sourceId === "string" && attrs.sourceId) {
        const at = position - 1;
        uses.push({
          citationId:
            typeof attrs.id === "string" && attrs.id
              ? attrs.id
              : `citation:${at}`,
          sourceId: attrs.sourceId,
          ...(typeof attrs.evidenceSpanId === "string" && attrs.evidenceSpanId
            ? { evidenceSpanId: attrs.evidenceSpanId }
            : {}),
          label:
            typeof attrs.label === "string" && attrs.label
              ? attrs.label
              : "Citation",
          position: at,
          ...(outlineEntryAt(outline, at)
            ? { section: outlineEntryAt(outline, at)!.title }
            : {}),
        });
      }
    }
    if (typeof node.text === "string") {
      position += node.text.length;
      return;
    }
    for (const child of node.content ?? []) walk(child, false);
    if (!isRoot) position += 1;
  };

  walk(doc, true);
  return uses;
}

export type SourceNavigatorEntry = {
  source: SourceRecord;
  uses: readonly DocumentCitationUse[];
  /** Sections this source is cited in, deduplicated and in reading order. */
  sections: readonly string[];
};

export type SourceNavigator = {
  entries: readonly SourceNavigatorEntry[];
  /**
   * Citations whose source record is missing. They are named rather than
   * hidden, because an unresolvable citation is a problem to fix, not a
   * decoration to drop (INV-09).
   */
  unresolved: readonly DocumentCitationUse[];
  /** Sources attached to the document that nothing cites yet. */
  uncited: readonly SourceRecord[];
};

/**
 * Groups citation uses by source. Takes the uses rather than the document so a
 * live editor can supply exact ProseMirror positions from its own traversal
 * instead of this module re-deriving them from JSON.
 */
export function groupCitationUses(
  uses: readonly DocumentCitationUse[],
  sources: readonly SourceRecord[],
): SourceNavigator {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const grouped = new Map<string, DocumentCitationUse[]>();
  const unresolved: DocumentCitationUse[] = [];

  for (const use of uses) {
    if (!byId.has(use.sourceId)) {
      unresolved.push(use);
      continue;
    }
    const list = grouped.get(use.sourceId);
    if (list) list.push(use);
    else grouped.set(use.sourceId, [use]);
  }

  const entries: SourceNavigatorEntry[] = [...grouped.entries()]
    .map(([sourceId, list]) => ({
      source: byId.get(sourceId)!,
      uses: list,
      sections: [
        ...new Set(list.map((use) => use.section).filter(Boolean)),
      ] as string[],
    }))
    .sort((left, right) => left.uses[0]!.position - right.uses[0]!.position);

  return {
    entries,
    unresolved,
    uncited: sources.filter((source) => !grouped.has(source.id)),
  };
}

export function buildSourceNavigator(
  doc: JSONContent,
  sources: readonly SourceRecord[],
): SourceNavigator {
  return groupCitationUses(documentCitations(doc), sources);
}

// ------------------------------------------------------------ bibliography

export type BibliographyStyle = "numeric" | "author_date";

export type BibliographyEntry = {
  sourceId: string;
  /** What appears inline: "[3]" or "(Author, 2024)". */
  marker: string;
  /** The full entry, ready to render as a line in the bibliography. */
  text: string;
  verified: boolean;
};

function sourceYear(source: SourceRecord) {
  const stamp = source.publishedAt ?? source.accessedAt;
  if (!stamp) return undefined;
  const parsed = new Date(stamp);
  return Number.isFinite(parsed.getTime()) ? parsed.getFullYear() : undefined;
}

function sourceAuthor(source: SourceRecord) {
  const named = source.authors?.filter((entry) => entry.trim()) ?? [];
  if (named.length === 1) return named[0]!.trim();
  if (named.length === 2) return `${named[0]!.trim()} and ${named[1]!.trim()}`;
  if (named.length > 2) return `${named[0]!.trim()} et al.`;
  // With no named author, the publisher is the next most useful attribution.
  try {
    return source.canonicalUrl ? new URL(source.canonicalUrl).hostname : "";
  } catch {
    return "";
  }
}

/**
 * Builds the bibliography from the citations the document actually contains, in
 * reading order. Unverified sources are marked rather than dropped: a reader
 * needs to know a reference has not been checked, and hiding it would leave a
 * claim in the text with nothing behind it (§7.9, INV-09).
 */
export function bibliographyFromNavigator(
  navigator: SourceNavigator,
  style: BibliographyStyle = "numeric",
): readonly BibliographyEntry[] {
  return navigator.entries.map((entry, index) => {
    const author = sourceAuthor(entry.source);
    const year = sourceYear(entry.source);
    const title =
      entry.source.title?.trim() ||
      entry.source.canonicalUrl ||
      "Untitled source";
    const marker =
      style === "numeric"
        ? `[${index + 1}]`
        : `(${author || "Unknown"}${year ? `, ${year}` : ""})`;
    const parts = [
      author,
      year ? `(${year})` : "",
      title,
      entry.source.canonicalUrl ?? "",
    ].filter(Boolean);
    return {
      sourceId: entry.source.id,
      marker,
      text: parts.join(". "),
      verified: entry.source.verified === true,
    };
  });
}

export function buildBibliography(
  doc: JSONContent,
  sources: readonly SourceRecord[],
  style: BibliographyStyle = "numeric",
): readonly BibliographyEntry[] {
  return bibliographyFromNavigator(buildSourceNavigator(doc, sources), style);
}

/**
 * The bibliography as a block that can be appended to the document. It is
 * regenerated rather than edited in place, so it always matches the citations
 * currently in the text.
 */
export function bibliographyNode(
  entries: readonly BibliographyEntry[],
): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "References" }],
      },
      ...(entries.length
        ? entries.map((entry) => ({
            type: "paragraph",
            content: [
              { type: "text", text: `${entry.marker} ${entry.text}` },
            ],
          }))
        : [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Cite a source in the document and it appears here.",
                },
              ],
            },
          ]),
    ],
  };
}
