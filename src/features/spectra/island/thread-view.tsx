"use client";

import { forwardRef, useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AdaptiveBar, type BarCommand, type CollapseStep } from "@/components/ui/adaptive-bar";
import { cn } from "@/lib/utils";
import { followAiActor, useFollowAi } from "../collaboration/follow-ai";
import { ThreadConversation } from "../components/conversation-surface";
import { spectraBus } from "../events";
import type { SpectraRunEngine } from "./engine";
import type { IslandTab } from "./island-model";

/*
 * The thread view (ISLAND.md): hovering a tab raises its thread above the
 * island, the main way to follow Spectra's work before any side panel. The
 * header has the title, the live caption and the quick actions (follow it,
 * open it in the panel or as a page, put the card away); the body is the
 * thread itself, as the chat page shows it: the earlier conversation, the
 * thinking, the work cards and embeds. There is no field of its own:
 * pressing the card turns the island's field to the thread, so the reply is
 * written where everything is written.
 */

/** What a press inside the card uses rather than turning the field to the thread. */
const CARD_CONTROLS =
  "button, a, input, textarea, select, iframe, [contenteditable='true'], [role='button'], [role='menuitem'], [role='radio'], [role='checkbox'], section[aria-label], figure";

function openWork(workId: string, regionId?: string) {
  void spectraBus.command("work.open", { workId, surface: "panel", ...(regionId ? { region: { id: regionId } } : {}) });
}

/* The card's size: smaller than a page by default, and the reader's own once
   they drag an edge (top, left, right or a top corner; the bottom sits on the
   island). Kept in this browser. */
const SIZE_KEY = "spectra:island-thread-size";
const DEFAULT_SIZE = { width: 560, height: 420 };
const MIN_SIZE = { width: 380, height: 220 };

function readSize() {
  try {
    const value = JSON.parse(window.localStorage.getItem(SIZE_KEY) ?? "null") as { width?: number; height?: number } | null;
    if (value && Number.isFinite(value.width) && Number.isFinite(value.height))
      return { width: Math.max(MIN_SIZE.width, value.width!), height: Math.max(MIN_SIZE.height, value.height!) };
  } catch {
    // Blocked storage: the default size.
  }
  return DEFAULT_SIZE;
}

type Edge = "top" | "left" | "right" | "top-left" | "top-right";
const EDGES: Array<{ edge: Edge; className: string; cursor: string }> = [
  { edge: "top", className: "inset-x-3 -top-1 h-2", cursor: "ns-resize" },
  { edge: "left", className: "-left-1 top-3 bottom-3 w-2", cursor: "ew-resize" },
  { edge: "right", className: "-right-1 top-3 bottom-3 w-2", cursor: "ew-resize" },
  { edge: "top-left", className: "-left-1 -top-1 size-3.5", cursor: "nwse-resize" },
  { edge: "top-right", className: "-right-1 -top-1 size-3.5", cursor: "nesw-resize" },
];

function useCardSize() {
  const [size, setSize] = useState(DEFAULT_SIZE);
  useEffect(() => setSize(readSize()), []);
  const startResize = useCallback(
    (edge: Edge, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      const start = { x: event.clientX, y: event.clientY, ...size };
      // The card is centred over the island, so a side edge grows both sides.
      const horizontal = edge === "top" ? 0 : edge.endsWith("left") ? -2 : 2;
      const vertical = edge.startsWith("top") ? -1 : 0;
      let latest = size;
      const move = (next: PointerEvent) => {
        latest = {
          width: Math.round(Math.min(window.innerWidth - 32, Math.max(MIN_SIZE.width, start.width + (next.clientX - start.x) * horizontal))),
          height: Math.round(Math.min(window.innerHeight * 0.8, Math.max(MIN_SIZE.height, start.height + (next.clientY - start.y) * vertical))),
        };
        setSize(latest);
      };
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        try {
          window.localStorage.setItem(SIZE_KEY, JSON.stringify(latest));
        } catch {
          // Kept for this visit only.
        }
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    },
    [size],
  );
  const reset = useCallback(() => {
    setSize(DEFAULT_SIZE);
    try {
      window.localStorage.removeItem(SIZE_KEY);
    } catch {
      // Nothing kept.
    }
  }, []);
  return { size, startResize, reset };
}

const PLAN: CollapseStep[] = [
  { hideLabel: "follow" },
  { toMenu: "undo" },
];

export const ThreadView = forwardRef<
  HTMLDivElement,
  {
    tab: IslandTab;
    engine: SpectraRunEngine | null;
    visible: boolean;
    offset: number;
    onOpenSide: () => void;
    /** Opens the thread as a page of its own, at full size. */
    onOpenPage: () => void;
    /** The card was pressed: the island's field turns to this thread. */
    onReply: () => void;
    /** Puts the card away; the thread stays on the rail. */
    onMinimise: () => void;
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
  }
>(function ThreadView({ tab, engine, visible, offset, onOpenSide, onOpenPage, onReply, onMinimise, onPointerEnter, onPointerLeave }, ref) {
  const live = engine?.liveExchange?.runId === tab.runId ? engine.liveExchange : null;
  const { size, startResize, reset } = useCardSize();
  const moving = tab.status === "working" || tab.state === "needs_input";
  const caption = live?.steps.at(-1)?.title.replace(/\*/g, "") ?? (live?.content?.trim() ? "Writing the answer" : tab.caption);

  // Following this run: the app opens and shows whatever Spectra works on, until the user does something themselves.
  const follow = useFollowAi();
  const followed = follow.following && (follow.followedActorId === null || follow.followedActorId === tab.runId);

  const commands = useMemo<BarCommand[]>(
    () => [
      ...(moving
        ? [
            {
              id: "follow",
              icon: "target",
              label: followed ? "Following" : "Follow AI",
              active: followed,
              onSelect: () => followAiActor(followed ? null : tab.runId),
            } satisfies BarCommand,
          ]
        : []),
      // Where to take the thread: two quiet symbols, named on hover.
      { id: "side", icon: "openSide", label: "Open in panel", labelPolicy: "never", onSelect: onOpenSide },
      { id: "page", icon: "openFull", label: "Open as page", labelPolicy: "never", onSelect: onOpenPage },
      ...(moving && engine
        ? [{ id: "stop", icon: "stop", label: "Stop", onSelect: () => void engine.stop(tab.runId) } satisfies BarCommand]
        : []),
      // Undo lives once, under the reply beside the work it changed (ReplyWork), not here as well.
      { id: "minimise", icon: "close", label: "Minimise", labelPolicy: "never", onSelect: onMinimise },
    ],
    [engine, followed, moving, onMinimise, onOpenPage, onOpenSide, tab.runId],
  );

  return (
    <div
      ref={ref}
      data-island-thread
      // Watching the run from its card is not taking the view back from Spectra.
      data-spectra-follow-control=""
      role="region"
      aria-label={`Thread: ${tab.title}`}
      inert={!visible}
      aria-hidden={!visible}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onClick={(event) => {
        // A press on the card, not on one of its controls, a work used in it or a selection of its words.
        if ((event.target as Element).closest(CARD_CONTROLS) || window.getSelection()?.toString()) return;
        onReply();
      }}
      style={{ transform: `translateX(${offset}px)`, "--island-thread-w": `${size.width}px`, "--island-thread-h": `${size.height}px` } as React.CSSProperties}
      className={cn(
        "relative box-border flex max-h-[80vh] w-[min(var(--island-thread-w),calc(100vw-var(--spectra-rail-width,0px)-var(--spectra-lead-width,0px)-var(--spectra-side-width,0px)-32px))] flex-col rounded-surface border border-[var(--card-border)] bg-[var(--card-paper)] shadow-[var(--shadow-lg)]",
        "transition-[opacity,transform] duration-200 ease-[var(--ease-standard)]",
        visible ? "opacity-100 delay-[110ms]" : "pointer-events-none opacity-0",
      )}
    >
      {EDGES.map(({ edge, className, cursor }) => (
        <span
          key={edge}
          aria-hidden
          data-island-thread-resize={edge}
          className={cn("absolute z-10 touch-none", className)}
          style={{ cursor }}
          onPointerDown={(event) => startResize(edge, event)}
          onDoubleClick={(event) => {
            event.stopPropagation();
            reset();
          }}
          onClick={(event) => event.stopPropagation()}
        />
      ))}
      <header className="flex items-center gap-3 rounded-t-[inherit] border-b border-[var(--card-border-soft)] py-2.5 pl-4 pr-2">
        <div key={tab.runId} className="min-w-0 flex-1 island-content-in">
          <div data-thread-title className="truncate font-display text-title font-medium leading-6 text-[var(--text-primary)]">
            {tab.title}
          </div>
          {moving ? (
            <div data-thread-caption className="truncate text-micro text-[var(--text-tertiary)]">
              {caption}
            </div>
          ) : null}
        </div>
        <AdaptiveBar commands={commands} plan={PLAN} label="Thread commands" layer="toast" className="max-w-[60%] flex-none" />
      </header>
      <div key={tab.threadId} className="island-content-in h-[min(var(--island-thread-h),72vh)] min-h-0 overflow-hidden rounded-b-[inherit]">
        <ThreadConversation threadId={tab.threadId} compact liveExchange={live} onOpenArtifact={openWork} />
      </div>
    </div>
  );
});
