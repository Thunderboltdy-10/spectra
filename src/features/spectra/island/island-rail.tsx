"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { Icon } from "@/components/icons";
import { WorkingMark } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { tabTitle, type IslandTab } from "./island-model";
import type { TabGhost as TabGhostRect } from "./use-tab-drag";

/*
 * The island's threads (ISLAND.md, "The rail"): folder tabs standing on the
 * top edge of the field, in its own paper. About four fit across it; the rest
 * run on to the right and scroll, with Threads, every thread, at the end.
 * Hovering a tab shows its thread; pressing it keeps the thread open and
 * turns the field to it, the tab standing joined to the field.
 */

/** Seen threads the rail keeps in reach at most; the rest are in Threads. */
export const RAIL_DONE = 8;

export type RailHandlers = {
  onHover: (tab: IslandTab, point: { x: number; y: number }) => void;
  onMove: (tab: IslandTab, point: { x: number; y: number }) => void;
  onLeave: (tab: IslandTab) => void;
  onPress: (tab: IslandTab) => void;
  onMenu: (tab: IslandTab, x: number, y: number) => void;
  onPointerDown: (tab: IslandTab, event: ReactPointerEvent<HTMLButtonElement>) => void;
};

export function IslandRail({
  play,
  done,
  raised,
  settled = false,
  current,
  focusTitle,
  dragging,
  tabRefs,
  dividerRef,
  bottom,
  maxWidth,
  handlers,
  waiting,
  onKeyDown,
  threadsOpen,
  onThreads,
  onNew,
}: {
  play: readonly IslandTab[];
  done: readonly IslandTab[];
  raised: boolean;
  /** Raised with the hand away: only the tabs that want attention stand. */
  settled?: boolean;
  /** The tab in hand: its card is open, or the composer writes into its thread. */
  current: string | null;
  /** The thread the composer writes into when it has no tab here. */
  focusTitle: string | null;
  dragging: string | null;
  tabRefs: RefObject<Map<string, HTMLButtonElement>>;
  dividerRef: RefObject<HTMLSpanElement | null>;
  /** Where the bar's top edge is, from the bottom of the island. */
  bottom: number;
  maxWidth: number;
  handlers: RailHandlers;
  /** Questions put aside, by thread: the tab counts them until they are answered. */
  waiting: ReadonlyMap<string, number>;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  threadsOpen: boolean;
  /** Every thread, past what the rail holds. */
  onThreads: () => void;
  /** The tab for a new thread, in hand when nothing else is. */
  onNew: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLSpanElement>(null);
  const overflow = useOverflow(scrollerRef, `${play.length}:${done.length}`);
  // The tab in hand, or a thread the page has open without a tab, is always in sight on the rail.
  useEffect(() => {
    const element = current ? tabRefs.current.get(current) : focusTitle ? focusRef.current : null;
    const scroller = scrollerRef.current;
    if (!element || !scroller) return;
    const r = element.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    if (r.left < box.left) scroller.scrollBy({ left: r.left - box.left - 12, behavior: "smooth" });
    else if (r.right > box.right) scroller.scrollBy({ left: r.right - box.right + 12, behavior: "smooth" });
  }, [current, focusTitle, tabRefs]);
  const fresh = !current && !focusTitle;
  let order = 0;
  const tab = (item: IslandTab) => (
    <RailTab
      key={item.runId}
      tab={item}
      order={order++}
      current={current === item.runId}
      settled={settled}
      lifted={dragging === item.runId}
      tabRefs={tabRefs}
      handlers={handlers}
      waiting={waiting.get(item.threadId) ?? 0}
    />
  );
  return (
    <div
      role="toolbar"
      aria-label="Spectra threads"
      data-island-rail
      data-band-overhang
      data-raised={raised || undefined}
      data-settled={settled || undefined}
      inert={!raised}
      onKeyDown={onKeyDown}
      // Never more than three threads across: each takes at least a third of the room between the two ends.
      style={{ bottom, maxWidth, "--rail-tab-min": `${Math.max(76, Math.floor((maxWidth - 96) / 3))}px` } as CSSProperties}
      className="island-rail"
    >
      {/* New thread and every thread hold the two ends; the threads in hand run between them. */}
      <Tooltip label="New thread" side="top">
        <button
          type="button"
          data-rail-tab
          data-new
          data-current={fresh || undefined}
          aria-pressed={fresh}
          aria-label="New thread"
          onClick={onNew}
          style={{ "--order": order++ } as CSSProperties}
          className="island-rail-tab island-rail-end"
        >
          <Icon name="add" size={15} />
        </button>
      </Tooltip>
      <div
        ref={scrollerRef}
        data-overflow-start={overflow.start || undefined}
        data-overflow-end={overflow.end || undefined}
        onWheel={(event) => {
          // A wheel turned over the rail runs it sideways.
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
        }}
        className="island-rail-scroller"
      >
      {focusTitle ? (
        <span ref={focusRef} data-rail-tab data-current style={{ "--order": order++ } as CSSProperties} className="island-rail-tab">
          <Icon name="conversations" size={13} className="text-[var(--text-tertiary)]" />
          <span className="min-w-0 truncate">{tabTitle(focusTitle)}</span>
        </span>
      ) : null}
      {play.map(tab)}
      <span ref={dividerRef} aria-hidden data-rail-divider data-empty={!play.length || !done.length || undefined} className="island-rail-divider" />
      {done.map(tab)}
      </div>
      <Tooltip label="All threads" shortcut="Ctrl Shift F" side="top">
        <button
          type="button"
          data-rail-tab
          data-island-threads
          aria-label="All threads"
          aria-expanded={threadsOpen}
          aria-haspopup="dialog"
          aria-keyshortcuts="Control+Shift+F"
          onClick={onThreads}
          style={{ "--order": order++ } as CSSProperties}
          className="island-rail-tab island-rail-end island-rail-threads"
        >
          <Icon name="conversations" size={15} />
        </button>
      </Tooltip>
    </div>
  );
}

/** Whether a row scrolls past either edge, so the edge can fade into what is beyond. */
function useOverflow(ref: RefObject<HTMLElement | null>, contents: string) {
  const [overflow, setOverflow] = useState({ start: false, end: false });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const start = element.scrollLeft > 1;
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setOverflow((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [ref, contents]);
  return overflow;
}

function RailTab({
  tab,
  order,
  current,
  settled,
  lifted,
  tabRefs,
  handlers,
  waiting,
}: {
  tab: IslandTab;
  order: number;
  current: boolean;
  /** The hand is away: a tab still standing has the room for its whole title. */
  settled: boolean;
  lifted: boolean;
  tabRefs: RefObject<Map<string, HTMLButtonElement>>;
  handlers: RailHandlers;
  waiting: number;
}) {
  const state = railState(tab);
  const finished = useJustFinished(state);
  return (
    <button
      ref={(node) => {
        if (node) tabRefs.current.set(tab.runId, node);
        else tabRefs.current.delete(tab.runId);
      }}
      type="button"
      data-island-tab
      data-rail-tab
      data-run-id={tab.runId}
      data-side={tab.side}
      data-state={state}
      data-finished={finished || undefined}
      data-current={current || undefined}
      data-life-working={tab.status === "working" ? "" : undefined}
      aria-label={`${tab.title}: ${waiting ? `${waiting} question${waiting === 1 ? "" : "s"} waiting` : tab.caption}`}
      aria-pressed={current}
      aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Delete"
      style={{ "--order": order } as CSSProperties}
      onPointerEnter={(event) => handlers.onHover(tab, { x: event.clientX, y: event.clientY })}
      onPointerMove={(event) => handlers.onMove(tab, { x: event.clientX, y: event.clientY })}
      onPointerLeave={() => handlers.onLeave(tab)}
      onPointerDown={(event) => handlers.onPointerDown(tab, event)}
      onClick={() => handlers.onPress(tab)}
      onContextMenu={(event) => {
        event.preventDefault();
        handlers.onMenu(tab, event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        handlers.onPress(tab);
      }}
      className={cn("island-rail-tab", lifted && "opacity-0")}
    >
      <TabCue tab={tab} />
      <span data-tab-title className="min-w-0 truncate">
        {settled && (current || state !== "seen") ? tab.title : tabTitle(tab.title)}
      </span>
      {waiting ? (
        <span data-tab-waiting aria-hidden className="island-tab-waiting">
          {waiting}
        </span>
      ) : null}
    </button>
  );
}

/** True for a moment after a thread finishes working, while its tab pulses once. */
function useJustFinished(state: string) {
  const previous = useRef(state);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    const was = previous.current;
    previous.current = state;
    if (was !== "working" || (state !== "fresh" && state !== "needs")) return;
    setFinished(true);
    const timer = window.setTimeout(() => setFinished(false), 1200);
    return () => window.clearTimeout(timer);
  }, [state]);
  return finished;
}

/** The one word of state a tab's lip and cue are drawn from. */
function railState(tab: IslandTab) {
  if (tab.status === "working" || tab.status === "needs" || tab.status === "problem") return tab.status;
  return tab.seen ? "seen" : "fresh";
}

/** A tab lifted off the rail and following the pointer. */
export function RailGhost({ ghost, tab, ghostRef }: { ghost: TabGhostRect; tab: IslandTab | undefined; ghostRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={ghostRef}
      aria-hidden
      data-state={tab ? railState(tab) : undefined}
      style={{ left: ghost.left, top: ghost.top, width: ghost.width, height: ghost.height }}
      className="island-rail-tab island-rail-ghost pointer-events-none fixed z-composer-dock will-change-transform"
    >
      {tab ? <TabCue tab={tab} /> : null}
      <span data-tab-title className="min-w-0 truncate">
        {tab ? tabTitle(tab.title) : ""}
      </span>
    </div>
  );
}

export type RailSeat = { height: number; width: number; radius: number };

/**
 * Where the rail stands: on the top edge of the island's shape, within its
 * straight part. It follows the shape as it changes and grows.
 */
export function useRailSeat(shape: string | null, find: () => HTMLElement | null | undefined) {
  const [seat, setSeat] = useState<(RailSeat & { shape: string }) | null>(null);
  useLayoutEffect(() => {
    const element = shape ? find() : null;
    if (!shape || !element || typeof ResizeObserver === "undefined") return;
    // Delivered after layout and before paint, so the rail is never a frame behind its shape.
    const observer = new ResizeObserver(() => {
      const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
      setSeat({ shape, height: element.offsetHeight, width: element.offsetWidth, radius: Math.min(radius, element.offsetHeight / 2) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [find, shape]);
  return seat?.shape === shape ? seat : null;
}

export function TabCue({ tab }: { tab: IslandTab }) {
  if (tab.status === "working") return <WorkingMark />;
  if (tab.status === "needs") return <span aria-hidden className="island-needs-glint size-2 shrink-0 rounded-full" />;
  if (tab.status === "problem") return <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--danger)]" />;
  if (tab.state === "cancelled") return <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--text-tertiary)]" />;
  return <Icon name="done" size={14} className={tab.seen ? "text-[var(--text-tertiary)]" : "text-[var(--success)]"} />;
}
