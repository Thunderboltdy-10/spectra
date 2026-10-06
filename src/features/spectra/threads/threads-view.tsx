"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "../components/spectra-view-model";
import { getSpectraThreads, type SpectraThread } from "../data/api";
import { spectraBus } from "../events";
import { useSpectraRouter } from "../hooks/use-spectra-router";
import { isActiveRunStatus, useRunTabs } from "../island/run-tabs";
import { figureOf } from "../life/figure-dom";
import { life } from "../life/life";
import { unformElement } from "../life/use-life";
import { useThreadSearch } from "../semantic/use-semantic";
import { groupThreads, matchThreads, type ThreadGroup } from "./threads-model";

/*
 * The threads view (SHELL.md): how the user finds any conversation. It opens
 * from the rail's Conversations as a closable panel over the Side, forming
 * out of the field from the rail. Choosing a thread sends the row's matter
 * down into the island, and the thread opens in the page's Side (or on the
 * chat page where the route has no Side).
 */

const ROW_BARS = "[data-row-title], [data-row-summary]";

function railPoint(): [number, number] | undefined {
  const item = document.querySelector<HTMLElement>("[data-rail-item='conversations']");
  if (!item) return undefined;
  const r = item.getBoundingClientRect();
  return [r.right, r.y + r.height / 2];
}

export function ThreadsViewHost() {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState("");
  useEffect(() => {
    const offOpen = spectraBus.on("threads.open", ({ query }) => {
      setSeed(query ?? "");
      setOpen(true);
    });
    const offClose = spectraBus.on("threads.close", () => setOpen(false));
    return () => {
      offOpen();
      offClose();
    };
  }, []);
  useEffect(() => {
    spectraBus.setQuery("threads.view", { open });
  }, [open]);
  if (!open) return null;
  return <ThreadsView initialQuery={seed} onClose={() => setOpen(false)} />;
}

export function ThreadsView({ initialQuery = "", onClose }: { initialQuery?: string; onClose: () => void }) {
  const router = useSpectraRouter();
  const panelRef = useRef<HTMLElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [threads, setThreads] = useState<SpectraThread[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [formed, setFormed] = useState(!life.on);
  const tabs = useRunTabs();
  const search = useThreadSearch(query, { limit: 30 });

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

  // The panel forms out of the field from the rail's Conversations.
  useEffect(() => {
    const panel = panelRef.current;
    fieldRef.current?.focus({ preventScroll: true });
    if (!panel || !life.on) return;
    const formation = life.form(figureOf(panel, { bars: "[data-threads-title], [data-threads-search]" }), { from: railPoint() });
    const fallback = window.setTimeout(() => setFormed(true), 900);
    void formation.formed.then(() => setFormed(true));
    return () => window.clearTimeout(fallback);
  }, []);

  const close = useCallback(() => {
    const panel = panelRef.current;
    if (panel && life.on) void unformElement(panel, { bars: "[data-threads-title]", from: railPoint() });
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

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

  const choose = useCallback(
    (thread: SpectraThread, row: HTMLElement) => {
      // The row's lines part and pour into the island, where the thread's tab forms.
      spectraBus.emit("island.arrive", { threadId: thread._id, ...(life.on ? { from: figureOf(row, { bars: ROW_BARS }) } : {}) });
      onClose();
      const handled = spectraBus.command("run.openConversation", { runId: thread.lastRunId ?? thread._id, threadId: thread._id });
      if (!handled) router.push(`/chat?threadId=${encodeURIComponent(thread._id)}`);
    },
    [onClose, router],
  );

  const shown = found ? [found] : groups;

  return (
    <aside
      ref={panelRef}
      aria-label="Conversations"
      className={cn(
        "fixed inset-y-0 right-0 z-panel flex w-[min(420px,calc(100vw-56px))] flex-col border-l border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]",
        "transition-opacity duration-200 ease-[var(--ease-standard)]",
        formed ? "opacity-100" : "opacity-0",
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] pl-4 pr-2">
        <h2 data-threads-title className="min-w-0 flex-1 truncate text-ui font-semibold text-[var(--text-primary)]">
          Conversations
        </h2>
        <IconButton icon="close" label="Close" shortcut="Esc" onClick={close} tooltipSide="bottom" />
      </header>
      <label data-threads-search className="mx-3 mt-3 flex h-9 shrink-0 items-center gap-2 rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-[var(--text-tertiary)] focus-within:border-[var(--border-strong)]">
        <Icon name="search" size={15} />
        <input
          ref={fieldRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a conversation"
          aria-label="Find a conversation"
          className="min-w-0 flex-1 bg-transparent text-caption text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
        {search.degraded && searching ? (
          <Tooltip label="Matching words only right now">
            <span className="size-1.5 rounded-full bg-[var(--warning)]" />
          </Tooltip>
        ) : null}
      </label>
      <div className="spectra-thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-[var(--spectra-composer-safe-area,88px)] pt-2">
        {failed ? (
          <div className="px-3 py-8 text-center text-caption text-[var(--text-secondary)]">
            Couldn&apos;t load your conversations.{" "}
            <button type="button" onClick={load} className="font-medium text-[var(--text-primary)] underline underline-offset-2">
              Try again
            </button>
          </div>
        ) : !loaded ? (
          <div data-life-ghost className="space-y-2 px-2 py-2" aria-label="Loading conversations">
            {Array.from({ length: 6 }, (_, index) => (
              <div data-life-ghost-bar key={index} className="h-12 animate-pulse rounded-control bg-[var(--bg-secondary)]" style={{ animationDelay: `${index * 60}ms` }} />
            ))}
          </div>
        ) : shown.every((group) => !group.threads.length) ? (
          <p className="px-3 py-10 text-center text-caption text-[var(--text-tertiary)]">
            {searching ? `Nothing matches “${query.trim()}”.` : "Your conversations will appear here. Start one from the island."}
          </p>
        ) : (
          shown.map((group) =>
            group.threads.length ? (
              <section key={group.key} className="mb-3">
                <h3 className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-micro font-semibold text-[var(--text-tertiary)]">
                  {group.key.startsWith("artifact:") ? <Icon name="document" size={12} /> : null}
                  <span className="truncate">{group.title}</span>
                </h3>
                <ul>
                  {group.threads.map((thread) => (
                    <li key={`${group.key}:${thread._id}`}>
                      <ThreadRow thread={thread} active={activeIds.has(thread._id)} onChoose={choose} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )
        )}
      </div>
    </aside>
  );
}

function ThreadRow({ thread, active, onChoose }: { thread: SpectraThread; active: boolean; onChoose: (thread: SpectraThread, row: HTMLElement) => void }) {
  const artifacts = thread.contexts?.artifacts ?? [];
  const summary = thread.summaryShort || thread.previewText;
  return (
    <button
      type="button"
      data-thread-row
      onClick={(event) => onChoose(thread, event.currentTarget)}
      className="group flex w-full items-start gap-2.5 rounded-control px-2 py-2 text-left outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
    >
      <span className="mt-1 grid size-4 shrink-0 place-items-center">
        {active ? <span className="island-working-light size-3 rounded-full" /> : <Icon name="conversations" size={14} className="text-[var(--text-tertiary)]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span data-row-title className="min-w-0 flex-1 truncate text-caption font-medium text-[var(--text-primary)]">
            {thread.title}
          </span>
          <span className="shrink-0 text-micro tabular-nums text-[var(--text-tertiary)]">{formatRelativeTime(thread.lastMessageAt ?? thread.updatedAt)}</span>
        </span>
        {summary ? (
          <span data-row-summary className="mt-0.5 block truncate text-micro text-[var(--text-secondary)]">
            {summary}
          </span>
        ) : null}
        {artifacts.length ? (
          <span className="mt-1 flex items-center gap-1 text-micro text-[var(--text-tertiary)]">
            <Icon name="document" size={12} />
            <span className="truncate">{artifacts.slice(0, 2).map((artifact) => artifact.title).join(" · ")}</span>
            {artifacts.length > 2 ? <span className="shrink-0">+{artifacts.length - 2}</span> : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}
