"use client";

/**
 * Client hooks for the semantic layer: debounced, stale-safe, and returning their state as data
 * (no UI). See ./README.md.
 */
import { useAction } from "convex/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { readConvexError } from "../../../../shared/convex-error.mjs";
import type {
  RelatedResponse, RelatedResult, SemanticDegradedReason, SemanticKind, SemanticResult, SemanticSearchHints, SemanticSearchResponse,
} from "./types";

export type SemanticStatus = "idle" | "loading" | "results" | "empty" | "error";

type Common = {
  /**
   * `idle`: nothing to ask (empty or too short query, no item, or disabled). `loading`: a
   * request is debouncing or in flight; search keeps the previous `results` meanwhile, so lists
   * do not flash. `results` / `empty`: the answer is current. `error`: the request failed, and
   * `error` says why in words a person can read.
   */
  status: SemanticStatus;
  /** Set when the answer came back degraded, for example words only while embeddings are down. */
  degraded: SemanticDegradedReason | null;
  error: string | null;
  /** Server time for the answer, in ms. */
  tookMs: number | null;
  /** Ask again now, skipping the debounce. */
  refresh: () => void;
};

export type SemanticSearchState = Common & {
  /** The query `results` answer (it lags the typed query while loading). */
  answered: string | null;
  results: SemanticResult[];
  mode: SemanticSearchResponse["mode"] | null;
};

export type RelatedState = Common & {
  results: RelatedResult[];
  mode: RelatedResponse["mode"] | null;
  /** Whether the similar items came from the per-item cache. */
  cached: boolean;
};

export type SemanticSearchOptions = {
  kinds?: SemanticKind[];
  workspaceId?: string;
  limit?: number;
  /** Items open on screen, most important first. A ranking hint, never a filter. */
  openItemIds?: string[];
  /** Items the user touched recently, most recent first. A ranking hint, never a filter. */
  recentItemIds?: string[];
  /** Default 200 ms. */
  debounceMs?: number;
  /** Queries shorter than this (after trimming) stay idle. Default 2. */
  minLength?: number;
  /** Default true. */
  enabled?: boolean;
};

export const SEMANTIC_DEBOUNCE_MS = 200;

/** An answer (or failure) is current when it is for this key and the latest refresh. */
type Answer<R> = { key: string; round: number; response: R };
type Failure = { key: string; round: number; message: string };

/**
 * The shared engine: runs `call` for `key` after `delay`, ignores answers to keys that are no
 * longer current, and keeps the last answer while the next one loads.
 */
function useDebouncedAnswer<R>(key: string | null, call: () => Promise<R>, delay: number) {
  const [answer, setAnswer] = useState<Answer<R> | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [round, setRound] = useState(0);
  const callRef = useRef(call);
  useLayoutEffect(() => { callRef.current = call; });
  const skipDelay = useRef(false);

  useEffect(() => {
    if (key === null) return;
    let live = true;
    const wait = skipDelay.current ? 0 : delay;
    skipDelay.current = false;
    const timer = setTimeout(() => {
      callRef.current().then(
        (response) => { if (live) setAnswer({ key, round, response }); },
        (error: unknown) => { if (live) setFailure({ key, round, message: readConvexError(error).message || "Search failed." }); },
      );
    }, wait);
    return () => { live = false; clearTimeout(timer); };
  }, [key, delay, round]);

  const refresh = useCallback(() => { skipDelay.current = true; setRound((value) => value + 1); }, []);
  const answered = key !== null && answer?.key === key && answer.round === round;
  const failed = key !== null && !answered && failure?.key === key && failure.round === round;
  return { answer: key === null ? null : answer, answered, error: failed ? failure!.message : null, refresh };
}

/** Status from the engine: idle, loading (debouncing or in flight), error, or results / empty. */
function statusOf(key: string | null, engine: { answered: boolean; error: string | null }, count: number | undefined): SemanticStatus {
  if (key === null) return "idle";
  if (engine.error !== null) return "error";
  if (!engine.answered) return "loading";
  return count ? "results" : "empty";
}

const hintsNow = (openItemIds?: string[], recentItemIds?: string[]): SemanticSearchHints => ({
  now: Date.now(), timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  ...(openItemIds?.length ? { openItemIds } : {}), ...(recentItemIds?.length ? { recentItemIds } : {}),
});

function useSearchLike(query: string, options: SemanticSearchOptions, threadsOnly: boolean): SemanticSearchState {
  const runSearch = useAction(api.semantic.search);
  const runThreads = useAction(api.semantic.searchThreads);
  const trimmed = query.trim();
  const enabled = (options.enabled ?? true) && trimmed.length >= (options.minLength ?? 2);
  // The request is compared by value, so callers may pass fresh arrays on every render.
  const request = { query: trimmed, kinds: threadsOnly ? undefined : options.kinds, workspaceId: options.workspaceId,
    limit: options.limit, openItemIds: options.openItemIds, recentItemIds: options.recentItemIds };
  const key = enabled ? JSON.stringify(request) : null;
  const engine = useDebouncedAnswer<SemanticSearchResponse>(key, () => {
    const hints = hintsNow(request.openItemIds, request.recentItemIds);
    const common = { query: request.query, workspaceId: request.workspaceId, limit: request.limit, hints };
    return threadsOnly ? runThreads(common) : runSearch({ ...common, kinds: request.kinds });
  }, options.debounceMs ?? SEMANTIC_DEBOUNCE_MS);
  const shown = engine.answer;
  return {
    status: statusOf(key, engine, shown?.response.results.length),
    answered: shown ? (JSON.parse(shown.key) as { query: string }).query : null,
    results: shown?.response.results ?? [],
    mode: shown?.response.mode ?? null,
    degraded: shown?.response.degraded?.reason ?? null,
    error: engine.error,
    tookMs: shown?.response.tookMs ?? null,
    refresh: engine.refresh,
  };
}

/** Search everything the user can open. Memory is included only when `kinds` asks for it. */
export function useSemanticSearch(query: string, options: SemanticSearchOptions = {}): SemanticSearchState {
  return useSearchLike(query, options, false);
}

/** Search the user's chats; each result's anchor points at the best matching message. */
export function useThreadSearch(query: string, options: Omit<SemanticSearchOptions, "kinds"> = {}): SemanticSearchState {
  return useSearchLike(query, options, true);
}

/**
 * Related items for an open item (artifact, thread, event or school record id). Explicit links
 * come first and every result says why it is listed. Not debounced: the item id changes on
 * navigation, not on keystrokes.
 */
export function useRelated(itemId: string | null | undefined, options: { limit?: number; enabled?: boolean } = {}): RelatedState {
  const run = useAction(api.semantic.related);
  const key = itemId && (options.enabled ?? true) ? JSON.stringify([itemId, options.limit ?? null]) : null;
  const engine = useDebouncedAnswer<RelatedResponse>(key, () => run({ itemId: itemId!, limit: options.limit }), 0);
  // Unlike search, never show another item's related list while this one loads.
  const shown = engine.answer?.key === key ? engine.answer : null;
  return {
    status: statusOf(key, engine, shown?.response.results.length),
    results: shown?.response.results ?? [],
    mode: shown?.response.mode ?? null,
    cached: shown?.response.cached ?? false,
    degraded: shown?.response.degraded?.reason ?? null,
    error: engine.error,
    tookMs: shown?.response.tookMs ?? null,
    refresh: engine.refresh,
  };
}
