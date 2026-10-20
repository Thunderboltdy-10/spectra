"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "../components/spectra-view-model";
import { getSpectraThreads, type SpectraThread } from "../data/api";
import { spectraBus } from "../events";
import { isActiveRunStatus, useRunTabs } from "../island/run-tabs";
import { useLifeArrival, useLifeDeparture } from "../life/use-life";
import { plainTextFromStored } from "../rich-content/adapters";
import { useThreadSearch } from "../semantic/use-semantic";
import type { ClassIdentity } from "../../../../shared/class-identity";
import { inkStyle, useClassBook } from "../school/use-class-book";
import { groupThreads, matchThreads, threadClass, threadHeading, type ThreadGroup } from "./threads-model";
import { WorkingMark } from "@/components/ui/skeleton";

/*
 * Every conversation, findable (SHELL.md, "The threads view"). One browser
 * serves the places a thread is looked for: the chat page's column and the
 * island's thread switcher. Search reads meaning first (the semantic layer)
 * and falls back to the words, so "that chat about cell energy" finds the
 * photosynthesis thread. Without a query the threads group by what is moving,
 * what is pinned and when they were last touched.
 */

export const THREAD_ROW_BARS = "[data-row-title], [data-row-summary]";
const ROW_FIGURE = { bars: THREAD_ROW_BARS };

/** `focusSearch` can hand over a query, e.g. from a "search threads" command. */
export type ThreadsBrowserHandle = { focusSearch: (query?: string) => void };

export const ThreadsBrowser = forwardRef<
  ThreadsBrowserHandle,
  {
    /** The thread open beside the browser, drawn as chosen. */
    selectedId?: string | null;
    onChoose: (thread: SpectraThread, row: HTMLElement) => void;
    /** The thread the pointer or the keyboard is on, for a preview beside the list. */
    onPoint?: (thread: SpectraThread) => void;
    /** What the search starts with (a query handed over from elsewhere). */
    initialQuery?: string;
    autoFocus?: boolean;
    /** Room under the list, e.g. to scroll clear of the island. */
    listClassName?: string;
    className?: string;
  }
>(function ThreadsBrowser({ selectedId, onChoose, onPoint, initialQuery = "", autoFocus, listClassName, className }, ref) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [threads, setThreads] = useState<SpectraThread[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const tabs = useRunTabs();
  const book = useClassBook();
  const search = useThreadSearch(query, { limit: 30 });

  useImperativeHandle(
    ref,
    () => ({
      focusSearch: (next) => {
        if (next !== undefined) setQuery(next);
        fieldRef.current?.focus({ preventScroll: true });
      },
    }),
    [],
  );

  const load = useCallback(() => {
    setFailed(false);
    void getSpectraThreads()
      .then(({ threads: rows }) => {
        setThreads(rows);
        setLoaded(true);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
    return spectraBus.on("threads.changed", load);
  }, [load]);

  useEffect(() => {
    if (autoFocus) fieldRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const activeIds = useMemo(() => new Set(tabs.filter((tab) => isActiveRunStatus(tab.run.status)).map((tab) => tab.threadId)), [tabs]);
  const groups = useMemo(() => groupThreads(threads, { activeIds }), [activeIds, threads]);
  const byId = useMemo(() => new Map(threads.map((thread) => [thread._id, thread])), [threads]);

  const searching = query.trim().length > 0;
  const found: ThreadGroup | null = useMemo(() => {
    if (!searching) return null;
    const semantic = search.results
      .map((result) => (result.anchor.kind === "thread" ? { thread: byId.get(result.anchor.threadId), snippet: result.snippet } : null))
      .filter((hit): hit is { thread: SpectraThread; snippet: string } => Boolean(hit?.thread));
    const rows = semantic.length ? semantic.map((hit) => ({ ...hit.thread, previewText: hit.snippet || hit.thread.previewText })) : matchThreads(threads, query);
    return { key: "found", title: search.status === "loading" && !rows.length ? "Searching" : "Best matches", threads: rows };
  }, [byId, query, search.results, search.status, searching, threads]);

  const shown = found ? [found] : groups;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <label className="mx-3 flex h-9 shrink-0 items-center gap-2 rounded-control bg-[var(--bg-secondary)] px-2.5 text-[var(--text-tertiary)] transition-colors focus-within:bg-[var(--bg-elevated)] focus-within:shadow-[inset_0_0_0_1px_var(--border-strong)]">
        <Icon name="search" size={15} />
        <input
          ref={fieldRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }
          }}
          placeholder="Search threads by topic or words"
          aria-label="Search threads"
          className="min-w-0 flex-1 bg-transparent text-caption text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
        {search.degraded && searching ? (
          <Tooltip label="Matching words only right now">
            <span className="size-1.5 rounded-full bg-[var(--warning)]" />
          </Tooltip>
        ) : null}
      </label>
      <div className={cn("spectra-thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pt-2", listClassName)}>
        {failed ? (
          <div className="px-3 py-8 text-center text-caption text-[var(--text-secondary)]">
            Couldn&apos;t load your threads.{" "}
            <button type="button" onClick={load} className="font-medium text-[var(--text-primary)] underline underline-offset-2">
              Try again
            </button>
          </div>
        ) : !loaded || (searching && search.status === "loading" && !found?.threads.length) ? (
          // A ghost of what is coming, never "nothing matches" before the answer is in.
          <div data-life-ghost className="space-y-1 px-1 py-1" role="status" aria-label={loaded ? "Searching threads" : "Loading threads"}>
            {Array.from({ length: loaded ? 3 : 7 }, (_, index) => (
              <ThreadRowGhost key={index} index={index} />
            ))}
          </div>
        ) : shown.every((group) => !group.threads.length) ? (
          <p className="px-3 py-10 text-center text-caption text-[var(--text-tertiary)]">
            {searching ? `No thread matches “${query.trim()}”.` : "Your threads will appear here."}
          </p>
        ) : (
          shown.map((group) =>
            group.threads.length ? (
              <section key={group.key} className="mb-2">
                <h3 className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-micro font-medium text-[var(--text-tertiary)]">
                  {group.key.startsWith("artifact:") ? <Icon name="document" size={12} /> : null}
                  <span className="truncate">{group.title}</span>
                </h3>
                <ul>
                  {group.threads.map((thread) => (
                    <li key={`${group.key}:${thread._id}`}>
                      <ThreadRow
                        thread={thread}
                        active={activeIds.has(thread._id)}
                        selected={thread._id === selectedId}
                        identity={threadClass(thread, book.named)}
                        onChoose={onChoose}
                        onPoint={onPoint}
                        departs={!searching}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )
        )}
      </div>
    </div>
  );
});

/** The shape a row will have, so the list never jumps when it arrives. */
function ThreadRowGhost({ index }: { index: number }) {
  return (
    <div className="flex items-start gap-2.5 rounded-control px-2 py-2" style={{ animationDelay: `${index * 60}ms` }}>
      <span data-life-ghost-bar className="mt-0.5 size-4 shrink-0 animate-pulse rounded-full bg-[var(--bg-tertiary)]" />
      <span className="min-w-0 flex-1 space-y-1.5">
        <span data-life-ghost-bar className="block h-3 animate-pulse rounded-full bg-[var(--bg-tertiary)]" style={{ width: `${62 + ((index * 17) % 30)}%` }} />
        <span data-life-ghost-bar className="block h-2.5 animate-pulse rounded-full bg-[var(--bg-secondary)]" style={{ width: `${48 + ((index * 23) % 40)}%` }} />
      </span>
    </div>
  );
}

/**
 * A conversation that moves to another group (a new message brings it to
 * Today) travels there (LIFE.md, Move); one removed while the list is plain
 * parts where it was. Narrowing a search is a filter, not a removal: it stays
 * quiet.
 */
function ThreadRow({
  thread,
  active,
  selected,
  identity,
  onChoose,
  onPoint,
  departs,
}: {
  thread: SpectraThread;
  active: boolean;
  selected: boolean;
  /** The class it worked in, drawn as the row's mark. */
  identity: ClassIdentity | null;
  onChoose: (thread: SpectraThread, row: HTMLElement) => void;
  onPoint?: (thread: SpectraThread) => void;
  departs: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const lifeKey = `thread:${thread._id}`;
  useLifeArrival(ref, lifeKey, undefined, ROW_FIGURE);
  useLifeDeparture(ref, departs, ROW_FIGURE, lifeKey);
  const artifacts = thread.contexts?.artifacts ?? [];
  const heading = threadHeading(thread.title, plainTextFromStored(thread.summaryShort || thread.previewText || ""));
  return (
    <button
      ref={ref}
      type="button"
      data-thread-row
      aria-current={selected ? "page" : undefined}
      title={thread.title}
      onClick={(event) => onChoose(thread, event.currentTarget)}
      onPointerEnter={onPoint ? () => onPoint(thread) : undefined}
      onFocus={onPoint ? () => onPoint(thread) : undefined}
      style={identity ? inkStyle(identity) : undefined}
      className="thread-row group"
    >
      <span className="mt-[3px] grid size-4 shrink-0 place-items-center">
        {active ? (
          <WorkingMark />
        ) : thread.pinned ? (
          <Icon name="pin" size={13} className="text-[var(--text-tertiary)]" />
        ) : (
          <span aria-hidden className="thread-row-mark" data-class={identity ? "" : undefined} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span data-row-title className="thread-row-title">
            {heading.title}
          </span>
          <span className="shrink-0 text-micro tabular-nums text-[var(--text-tertiary)]">{formatRelativeTime(thread.lastMessageAt ?? thread.updatedAt)}</span>
        </span>
        {heading.summary ? (
          <span data-row-summary className="thread-row-summary">
            {heading.summary}
          </span>
        ) : null}
        {identity ? <span className="thread-row-class">{identity.name}</span> : null}
        {artifacts.length ? (
          <span className="mt-1.5 flex min-w-0 items-center gap-1">
            {artifacts.slice(0, 2).map((artifact) => (
              <span key={artifact.id} className="inline-flex min-w-0 max-w-[60%] items-center gap-1 rounded-chip bg-[var(--bg-secondary)] px-1.5 py-0.5 text-micro text-[var(--text-secondary)]">
                <Icon name="document" size={11} className="shrink-0 text-[var(--type-document)]" />
                <span className="truncate">{artifact.title}</span>
              </span>
            ))}
            {artifacts.length > 2 ? <span className="shrink-0 text-micro text-[var(--text-tertiary)]">+{artifacts.length - 2}</span> : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}
