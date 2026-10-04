/**
 * Public contract of the semantic layer, shared by Convex, the client hooks and the eval script.
 * See src/features/spectra/semantic/README.md.
 */

/** Kinds stored as chunks in `semanticChunks`. To add one, see convex/semanticSources.ts. */
export const INDEXED_SEMANTIC_KINDS = ["artifact", "thread", "event", "school"] as const;
export type IndexedSemanticKind = (typeof INDEXED_SEMANTIC_KINDS)[number];
/** Memory keeps its own table (memoryClaims, same embedding provider) and joins at search time. */
export const SEMANTIC_KINDS = [...INDEXED_SEMANTIC_KINDS, "memory"] as const;
export type SemanticKind = (typeof SEMANTIC_KINDS)[number];

/** Where a result points. `regionId` and `messageId` are stable ids the editors and threads can jump to. */
export type SemanticAnchor =
  | { kind: "artifact"; artifactId: string; regionId?: string; label?: string }
  | { kind: "thread"; threadId: string; messageId?: string }
  | { kind: "event"; calendarItemId: string }
  | { kind: "school"; recordId: string }
  | { kind: "memory"; claimId: string };

/**
 * Why a result ranks where it does. `meaning` (vectors) and `words` (full-text, `title` for a
 * title match) find candidates; the rest are ranking signals from the query and the hints.
 */
export type SemanticMatch = "meaning" | "words" | "title" | "open" | "recent" | "when" | "type";

/**
 * Optional ranking hints. They reorder results and may surface a hinted item that fits the
 * query; they never filter. The client hooks fill `now` and `timezoneOffsetMinutes`.
 */
export type SemanticSearchHints = {
  /** Items open on screen now, most important first (artifact, thread, ... ids). */
  openItemIds?: string[];
  /** Items the user touched recently, most recent first. */
  recentItemIds?: string[];
  /** Client clock, for "yesterday" and "this week". Defaults to the server clock. */
  now?: number;
  /** `Date.prototype.getTimezoneOffset()` of the client, so "yesterday" is the user's yesterday. */
  timezoneOffsetMinutes?: number;
};

export type SemanticSearchArgs = {
  query: string;
  kinds?: SemanticKind[];
  workspaceId?: string;
  limit?: number;
  hints?: SemanticSearchHints;
};

export type SemanticResult = {
  kind: SemanticKind;
  itemId: string;
  title: string;
  /** "Slides", "Document", "Chat", "Calendar event", "School assignment", "Memory". */
  typeLabel: string;
  /** Artifact type (document, presentation, ...), calendar kind, or school record type. */
  subtype?: string;
  /** The best matching passage, trimmed around the query words. */
  snippet: string;
  /** Where in the item the snippet is: "Slide 3: Results", "Heading: Methods". */
  location?: string;
  anchor: SemanticAnchor;
  /** 0..1, comparable within one response only. */
  score: number;
  matchedBy: SemanticMatch[];
  status?: "active" | "archived" | "draft";
  /** Last change to the item. */
  updatedAt?: number;
  /** When it happens: event start, or a school item's due date. */
  timeAt?: number;
  /** The workspace the item lives in, when the viewer can open that workspace. */
  workspace?: { id: string; title: string };
  /** `mine`: the viewer owns it; `shared`: someone shared it; `school`: school data. */
  ownership: "mine" | "shared" | "school";
};

export type SemanticDegradedReason =
  | "embeddings_not_configured" | "embeddings_unavailable" | "query_too_large" | "index_partial";

export type SemanticSearchResponse = {
  results: SemanticResult[];
  /** `words_only` when the query could not be embedded; results are full-text matches. */
  mode: "hybrid" | "words_only";
  degraded?: { reason: SemanticDegradedReason };
  tookMs: number;
};

export type RelatedReason =
  | { type: "link"; relation: string; direction: "outgoing" | "incoming"; label?: string }
  | { type: "similar"; similarity: number }
  | { type: "thread_about" }
  | { type: "made_in_thread" };

export type RelatedResult = Omit<SemanticResult, "matchedBy" | "snippet" | "location"> & {
  snippet?: string;
  /** Why the item is listed. Explicit links come first. */
  reasons: RelatedReason[];
};

export type RelatedResponse = {
  results: RelatedResult[];
  mode: "hybrid" | "links_only";
  degraded?: { reason: SemanticDegradedReason };
  cached: boolean;
  tookMs: number;
};
