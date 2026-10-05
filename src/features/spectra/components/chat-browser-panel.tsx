"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, MessageSquare, MessagesSquare, Search, X } from "lucide-react";
import type { SpectraThread } from "../data/api";
import { getSpectraThread, getSpectraThreads } from "../data/api";
import { formatRelativeTime } from "./spectra-view-model";
import { ProductErrorState } from "./product-state";

type ChatBrowserScope = "library" | "workspace" | "artifact";

function dayLabel(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((start(today) - start(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

export function ChatBrowserButton({
  onClick,
  label = "Browse chats",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid size-8 place-items-center rounded-control text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      aria-label={label}
      title={label}
    >
      <MessagesSquare className="size-4" />
    </button>
  );
}

export function ChatBrowserPanel({
  scope,
  workspaceId,
  artifactId,
  title,
  width,
  onWidthChange,
  onOpenChat,
  onClose,
  overlay = false,
}: {
  scope: ChatBrowserScope;
  workspaceId?: string;
  artifactId?: string;
  title?: string;
  width?: number;
  onWidthChange?: (width: number) => void;
  onOpenChat: (thread: SpectraThread) => void;
  onClose: () => void;
  /** Workbench allocation promotes the browser over the canvas when crowded. */
  overlay?: boolean;
}) {
  const [threads, setThreads] = useState<SpectraThread[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "pinned" | "recent">("all");
  const [visibleCount, setVisibleCount] = useState(24);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [resizing, setResizing] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    void getSpectraThreads({ limit: 120 })
      .then((result) => {
        if (!alive) return;
        setThreads(result.threads);
      })
      .catch(() => {
        if (!alive) return;
        setThreads([]);
        setLoadError(true);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (!hoveredId) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void getSpectraThread(hoveredId).then((detail) => {
        if (!alive) return;
        const first = detail.messages.find((message) => message.role === "user" || message.role === "assistant");
        const text = first?.content?.trim() || detail.thread.summaryShort || "No summary available.";
        setPreview({ id: hoveredId, text: text.slice(0, 220) });
      }).catch(() => alive && setPreview(null));
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [hoveredId]);

  useEffect(() => {
    if (!resizing || !onWidthChange) return;
    const move = (event: PointerEvent) => onWidthChange(Math.max(340, Math.min(760, Math.round(window.innerWidth - event.clientX))));
    const up = () => setResizing(false);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up, { once: true });
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [onWidthChange, resizing]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    restoreFocusRef.current = previous;
    update();
    media.addEventListener("change", update);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !media.matches || !panelRef.current) return;
      const focusable = [
        ...panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    if (media.matches) {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    }
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("keydown", onKeyDown);
      if (media.matches) restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const scoped = threads.filter((thread) => {
      if (scope === "workspace" && workspaceId) {
        return thread.workspaceId === workspaceId || thread.contexts?.workspaces?.some((item) => item.id === workspaceId);
      }
      if (scope === "artifact" && artifactId) {
        return thread.artifactId === artifactId || thread.contexts?.artifacts?.some((item) => item.id === artifactId);
      }
      return true;
    });
    return scoped
      .filter((thread) => !needle || `${thread.title} ${thread.summaryShort ?? ""}`.toLowerCase().includes(needle))
      .filter((thread) =>
        filter === "all"
          ? true
          : filter === "pinned"
            ? Boolean(thread.pinned)
            : Date.now() - (thread.lastMessageAt ?? thread.updatedAt) < 7 * 86_400_000,
      )
      .sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt));
  }, [artifactId, filter, query, scope, threads, workspaceId]);

  const groups = useMemo(() => {
    const map = new Map<string, SpectraThread[]>();
    for (const thread of filtered.slice(0, visibleCount)) {
      const key = dayLabel(thread.lastMessageAt ?? thread.updatedAt);
      const bucket = map.get(key) ?? [];
      bucket.push(thread);
      map.set(key, bucket);
    }
    return [...map.entries()];
  }, [filtered, visibleCount]);

  return (
    <>
      {isMobile ? (
        <button
          type="button"
          className="fixed inset-0 z-modal bg-[var(--bg-overlay)]"
          onClick={onClose}
          aria-label="Close chat browser"
        />
      ) : null}
      <aside
        ref={panelRef}
        data-studio-panel={!isMobile ? "" : undefined}
        data-split-overlay={!isMobile && overlay ? "" : undefined}
        role={isMobile ? "dialog" : undefined}
        aria-modal={isMobile ? true : undefined}
        aria-label="Chat browser"
        className={`${isMobile ? "fixed inset-0 z-modal w-full" : overlay ? "absolute inset-y-0 right-0 z-panel" : "relative z-chrome h-full shrink-0"} flex min-w-0 flex-col overflow-hidden border-[var(--border-default)] bg-[var(--bg-primary)] shadow-hover ${isMobile ? "border-t" : "border-l"}`}
        style={isMobile ? undefined : { width: `min(${width ?? 440}px, calc(100vw - 24px))` }}
      >
      {onWidthChange && !isMobile ? <button type="button" aria-label="Resize chat browser" title="Resize" className="absolute inset-y-0 left-0 z-chrome w-2 -translate-x-1/2 cursor-ew-resize bg-transparent transition-colors hover:bg-[color-mix(in_oklab,var(--brand-primary)_24%,transparent)]" onPointerDown={(event) => { event.preventDefault(); setResizing(true); }} /> : null}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-4">
        <span className="grid size-8 place-items-center rounded-control bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--bg-elevated))] text-[var(--brand-primary)]"><MessagesSquare className="size-4" /></span>
        <div className="min-w-0 flex-1"><h2 className="truncate text-ui font-semibold text-[var(--text-primary)]">{title ?? "Chats"}</h2><p className="text-micro text-[var(--text-tertiary)]">Search conversations connected to this view</p></div>
        <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" aria-label="Close chat browser" title="Close"><X className="size-4" /></button>
      </div>
      <div className="shrink-0 space-y-2 border-b border-[var(--border-subtle)] p-3">
        <label className="flex h-9 items-center gap-2 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-[var(--text-tertiary)]"><Search className="size-3.5" /><input ref={searchInputRef} value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(24); }} placeholder="Search chats" className="min-w-0 flex-1 bg-transparent text-caption text-[var(--text-primary)] outline-none" aria-label="Search chats" /></label>
        <div className="flex items-center gap-1" role="tablist" aria-label="Chat filters">
          {(["all", "recent", "pinned"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)} className={`rounded-chip px-2.5 py-1 text-micro font-medium capitalize ${filter === key ? "bg-[var(--text-primary)] text-[var(--bg-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}>{key}</button>)}
          <span className="ml-auto text-micro text-[var(--text-tertiary)]">{filtered.length} chats</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loading ? <div className="space-y-2" aria-label="Loading chats">{[1, 2, 3, 4].map((item) => <div key={item} data-life-ghost className="h-12 animate-pulse bg-[var(--bg-secondary)]" />)}</div> : loadError ? <ProductErrorState title="Chats couldn’t load" detail="Check your connection, then try again." action={<button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)} className="inline-flex h-8 items-center rounded-control bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)]">Try again</button>} /> : groups.length === 0 ? <div className="flex min-h-52 flex-col items-center justify-center px-8 text-center"><MessageSquare className="size-6 text-[var(--text-tertiary)]" /><p className="mt-3 text-caption font-medium text-[var(--text-primary)]">No chats found</p><p className="mt-1 text-micro leading-5 text-[var(--text-secondary)]">Try a different search or filter.</p></div> : groups.map(([label, rows]) => <section key={label} className="mb-4"><h3 className="mb-1.5 flex items-center gap-1.5 px-1 text-micro font-semibold uppercase tracking-[.1em] text-[var(--text-tertiary)]"><CalendarDays className="size-3" />{label}</h3><div className="">{rows.map((thread) => <button key={thread._id} type="button" onMouseEnter={() => setHoveredId(thread._id)} onMouseLeave={() => { setHoveredId(null); setPreview(null); }} onClick={() => onOpenChat(thread)} className="group relative w-full border-b border-[var(--border-subtle)] px-2 py-2 text-left transition last:border-b-0 hover:bg-[var(--bg-hover)]"><span className="flex items-start gap-2"><span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-control bg-[color-mix(in_oklab,var(--brand-primary)_8%,var(--bg-elevated))] text-[var(--brand-primary)]"><MessageSquare className="size-3" /></span><span className="min-w-0 flex-1"><span className="block truncate text-caption font-semibold text-[var(--text-primary)]">{thread.title}</span><span className="mt-0.5 block line-clamp-1 text-micro leading-4 text-[var(--text-secondary)]">{thread.summaryShort || "No summary available."}</span><span className="mt-0.5 block text-micro text-[var(--text-tertiary)]">{thread.messageCount ?? 0} messages · {formatRelativeTime(thread.lastMessageAt ?? thread.updatedAt)}</span></span></span>{preview?.id === thread._id ? <span className="pointer-events-none absolute right-3 top-full z-tooltip mt-1 w-[min(320px,calc(100vw-44px))] rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-micro leading-5 text-[var(--text-secondary)] shadow-hover">{preview.text}</span> : null}</button>)}</div></section>)}
          {visibleCount < filtered.length ? <button type="button" onClick={() => setVisibleCount((count) => count + 24)} className="flex w-full items-center justify-center rounded-control border border-dashed border-[var(--border-default)] py-2 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">Load more chats</button> : null}
      </div>
      </aside>
    </>
  );
}
