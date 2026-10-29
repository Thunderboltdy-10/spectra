"use client";

import { forwardRef, useMemo } from "react";
import { AdaptiveBar, type BarCommand, type CollapseStep } from "@/components/ui/adaptive-bar";
import { cn } from "@/lib/utils";
import { followAiActor, useFollowAi } from "../collaboration/follow-ai";
import { ThreadConversation } from "../components/conversation-surface";
import { spectraBus } from "../events";
import { deriveLiveDockTab } from "../runs/live-dock";
import type { SpectraRunEngine } from "./engine";
import type { IslandTab } from "./island-model";
import { runTabCard, runTabSource } from "./run-tabs";

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

function openWork(workId: string) {
  void spectraBus.command("work.open", { workId, surface: "panel" });
}

const PLAN: CollapseStep[] = [
  { hideLabel: "undo" },
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
  const model = useMemo(() => deriveLiveDockTab(runTabSource(tab.source)), [tab.source]);
  const live = engine?.liveExchange?.runId === tab.runId ? engine.liveExchange : null;
  const moving = tab.status === "working" || tab.state === "needs_input";
  const card = runTabCard(tab.source);
  const canUndo = Boolean(card?.actions?.some((action) => action.key === "revert")) && !model.undone;
  const caption = live?.steps.at(-1)?.title ?? (live?.content?.trim() ? "Writing the answer" : tab.caption);

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
      ...(canUndo && engine && card
        ? [{ id: "undo", icon: "undoSpectra", label: "Undo Spectra's changes", onSelect: () => void engine.onCardAction(card, "revert") } satisfies BarCommand]
        : []),
      { id: "minimise", icon: "close", label: "Minimise", labelPolicy: "never", onSelect: onMinimise },
    ],
    [canUndo, card, engine, followed, moving, onMinimise, onOpenPage, onOpenSide, tab.runId],
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
      style={{ transform: `translateX(${offset}px)` }}
      className={cn(
        "box-border flex max-h-[70vh] w-[min(600px,calc(100vw-var(--spectra-rail-width,0px)-var(--spectra-lead-width,0px)-32px))] flex-col overflow-hidden rounded-surface border border-[var(--card-border)] bg-[var(--card-paper)] shadow-[var(--shadow-lg)]",
        "transition-[opacity,transform] duration-200 ease-[var(--ease-standard)]",
        visible ? "opacity-100 delay-[110ms]" : "pointer-events-none opacity-0",
      )}
    >
      <header className="flex items-center gap-3 border-b border-[var(--card-border-soft)] py-2.5 pl-4 pr-2">
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
      <div key={tab.threadId} className="island-content-in h-[min(560px,58vh)] min-h-0">
        <ThreadConversation threadId={tab.threadId} compact liveExchange={live} onOpenArtifact={openWork} />
      </div>
    </div>
  );
});
