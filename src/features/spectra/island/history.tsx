"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getSpectraThreads, type SpectraThread } from "../data/api";
import { spectraBus } from "../events";
import { life } from "../life/life";
import { tabTitle } from "./island-model";

/*
 * Beyond the done tabs: history (ISLAND.md, "Beyond them: history").
 * Dismissed and older threads continue to the right behind the fade and a
 * "›". It loads a page at a time as the user scrolls toward its end, and
 * keeps at most HISTORY_LIMIT rows drawn.
 */

const PAGE = 16;
export const HISTORY_LIMIT = 64;

export function IslandHistory({
  exclude,
  onOpen,
}: {
  /** Threads already on the pill. */
  exclude: ReadonlySet<string>;
  onOpen: (thread: SpectraThread) => void;
}) {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<SpectraThread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const end = useRef<HTMLSpanElement>(null);
  const hint = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    if (loading || !more) return;
    setLoading(true);
    try {
      const page = await getSpectraThreads({ limit: PAGE, ...(cursor ? { cursor } : {}) });
      setThreads((current) => {
        const known = new Set(current.map((thread) => thread._id));
        return [...current, ...page.threads.filter((thread) => !known.has(thread._id))].slice(0, HISTORY_LIMIT);
      });
      setCursor(page.nextCursor ?? null);
      setMore(Boolean(page.hasMore && page.nextCursor));
    } catch {
      setMore(false);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, more]);

  // A page more each time the end comes into view.
  useEffect(() => {
    const marker = end.current;
    if (!open || !marker || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load();
    });
    observer.observe(marker);
    return () => observer.disconnect();
  }, [load, open]);

  // The history resets when threads change, so it never shows a stale list.
  useEffect(
    () =>
      spectraBus.on("threads.changed", () => {
        setThreads([]);
        setCursor(null);
        setMore(true);
      }),
    [],
  );

  const reveal = () => {
    const r = hint.current?.getBoundingClientRect();
    const scroller = hint.current?.closest("[data-island-done]");
    if (r && life.on) life.pulse(r.left + r.width / 2, r.top + r.height / 2, 0.5);
    setOpen(true);
    void load();
    // Bring the history into view.
    requestAnimationFrame(() => scroller?.scrollBy({ left: 160, behavior: "smooth" }));
  };

  const rows = threads.filter((thread) => !exclude.has(thread._id) && thread.status !== "deleted" && thread.status !== "archived");

  return (
    <>
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-[var(--border-default)]" />
      {open ? (
        <span role="group" aria-label="History" className="contents">
          {rows.map((thread, index) => (
            <button
              key={thread._id}
              type="button"
              data-island-history
              onClick={() => onOpen(thread)}
              style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
              className="island-content-in inline-flex h-8 max-w-[160px] shrink-0 items-center rounded-full px-2.5 text-caption text-[var(--text-tertiary)] outline-none transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            >
              <span className="min-w-0 truncate">{tabTitle(thread.title || "Untitled conversation")}</span>
            </button>
          ))}
          {loading ? <span aria-hidden className="island-working-light mx-2 size-1.5 shrink-0 rounded-full" /> : null}
          {!loading && !rows.length && !more ? <span className="shrink-0 px-2 text-caption text-[var(--text-tertiary)]">Nothing older</span> : null}
          <span ref={end} aria-hidden className="h-1 w-1 shrink-0" />
        </span>
      ) : (
        <Tooltip label="History">
          <button
            ref={hint}
            type="button"
            aria-label="Show history"
            onClick={reveal}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full text-[var(--text-tertiary)] outline-none",
              "transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
            )}
          >
            <Icon name="chevronRight" size={14} />
          </button>
        </Tooltip>
      )}
    </>
  );
}
