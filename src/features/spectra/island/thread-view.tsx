"use client";

import { forwardRef, useLayoutEffect, useMemo, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { AdaptiveBar, type BarCommand, type CollapseStep } from "@/components/ui/adaptive-bar";
import { GhostLines } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { SpectraLiveExchange } from "../ai/use-spectra-run";
import { followAiActor, useFollowAi } from "../collaboration/follow-ai";
import { ProgressTrace } from "../components/progress-trace";
import { SpectraRichContent } from "../components/spectra-rich-content";
import { deriveLiveDockTab } from "../runs/live-dock";
import type { SpectraRunEngine } from "./engine";
import type { IslandTab } from "./island-model";
import { runTabCard, runTabSource } from "./run-tabs";
import { useKeptStream, useRunReply } from "./use-run-reply";

/*
 * The thread view (ISLAND.md): hovering a tab raises its thread above the
 * island, the main way to follow Spectra's work before any side panel. The
 * header has the title, the live caption and the quick actions (follow it,
 * open it in the panel or as a page); the body the steps and the reply.
 * There is no field of its own: pressing the card turns the island's field
 * to the thread, so the reply is written where everything is written.
 */

const PLAN: CollapseStep[] = [
  { hideLabel: "copy" },
  { hideLabel: "undo" },
  { hideLabel: "page" },
  { hideLabel: "side" },
  { hideLabel: "follow" },
  { toMenu: "copy" },
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
    onDismiss: () => void;
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
  }
>(function ThreadView({ tab, engine, visible, offset, onOpenSide, onOpenPage, onReply, onDismiss, onPointerEnter, onPointerLeave }, ref) {
  const model = useMemo(() => deriveLiveDockTab(runTabSource(tab.source)), [tab.source]);
  const live = engine?.liveExchange?.runId === tab.runId ? engine.liveExchange : null;
  const moving = tab.status === "working" || tab.state === "needs_input";
  const card = runTabCard(tab.source);
  const canUndo = Boolean(card?.actions?.some((action) => action.key === "revert")) && !model.undone;
  // The reply as written (its lists and paragraphs), not the compact caption the tab shows: as it streams,
  // then whole once the run is done. While the run moves, its summary is still a status line the header
  // caption already says.
  const streamed = useKeptStream(tab.runId, live?.content?.trim() ?? "");
  const written = useRunReply(tab.threadId, tab.runId, !moving);
  const answerText = written || streamed || (moving ? "" : tab.source.run.finalSummary?.trim() || model.finalSummary);
  // What was asked stays over its answer after the run ends, so the card always answers something.
  const asked = live?.prompt || tab.source.run.userPrompt?.trim();
  const caption = live?.steps.at(-1)?.title ?? (live?.content?.trim() ? "Writing the answer" : tab.caption);
  // The same trace the thread shows everywhere: what Spectra is doing, step by step.
  const steps = useMemo<SpectraLiveExchange["steps"]>(
    () =>
      live?.steps.length
        ? live.steps
        : model.recentSteps.map((title, index, all) => ({
            id: `${tab.runId}:${index}`,
            title,
            status: moving && index === all.length - 1 ? ("running" as const) : ("done" as const),
            createdAt: 0,
          })),
    [live?.steps, model.recentSteps, moving, tab.runId],
  );

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
      { id: "side", icon: "openSide", label: "Open in panel", onSelect: onOpenSide },
      { id: "page", icon: "openFull", label: "Open as page", onSelect: onOpenPage },
      ...(moving && engine
        ? [{ id: "stop", icon: "stop", label: "Stop", onSelect: () => void engine.stop(tab.runId) } satisfies BarCommand]
        : []),
      ...(canUndo && engine && card
        ? [{ id: "undo", icon: "undoSpectra", label: "Undo Spectra's changes", onSelect: () => void engine.onCardAction(card, "revert") } satisfies BarCommand]
        : []),
      // There is a reply to copy only once there is one.
      ...(answerText && !moving
        ? [
            {
              id: "copy",
              icon: "copy",
              label: "Copy reply",
              onSelect: () =>
                void navigator.clipboard
                  .writeText(answerText)
                  .then(() => toast.success("Copied"))
                  .catch(() => toast.error("Could not copy")),
            } satisfies BarCommand,
          ]
        : []),
      { id: "dismiss", icon: "close", label: "Dismiss", labelPolicy: "never", onSelect: onDismiss },
    ],
    [answerText, canUndo, card, engine, followed, moving, onDismiss, onOpenPage, onOpenSide, tab.runId],
  );

  // While the reply is written the card follows its end, unless the reader has scrolled up to read.
  const bodyRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (moving && body && following.current) body.scrollTop = body.scrollHeight;
  }, [answerText, moving, steps.length]);

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
        // A press on the card, not on one of its controls or a selection of its words.
        if ((event.target as Element).closest("button, a, [role='menuitem']") || window.getSelection()?.toString()) return;
        onReply();
      }}
      style={{ transform: `translateX(${offset}px)` }}
      className={cn(
        "box-border flex max-h-[70vh] w-[min(600px,calc(100vw-32px))] flex-col rounded-surface border border-[var(--card-border)] bg-[var(--card-paper)] shadow-[var(--shadow-lg)]",
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
      <div
        key={tab.runId}
        ref={bodyRef}
        onScroll={(event) => {
          const body = event.currentTarget;
          following.current = body.scrollHeight - body.scrollTop - body.clientHeight < 32;
        }}
        className="min-h-0 flex-1 island-content-in overflow-y-auto px-4 py-3 text-caption leading-5"
      >
        {asked ? (
          <p className="mb-3 ml-auto w-fit max-w-[85%] rounded-surface bg-[var(--bg-secondary)] px-3 py-1.5 text-ui leading-6 text-[var(--text-primary)]">{asked}</p>
        ) : null}
        <ProgressTrace steps={steps} active={moving} hasOutput={Boolean(answerText)} answers={live?.answers} persistKey={tab.runId} compact />
        {answerText ? (
          <SpectraRichContent content={answerText} className="text-ui leading-6 text-[var(--text-primary)]" />
        ) : !moving && !steps.length && !asked ? (
          <p className="text-[var(--text-tertiary)]">{tab.caption}</p>
        ) : null}
        {/* The reply still being written: the lines it will take, as a skeleton, until it is all there. */}
        {moving && tab.state !== "needs_input" ? <GhostLines count={answerText ? 1 : 3} className={answerText ? "mt-2" : undefined} /> : null}
      </div>
    </div>
  );
});
