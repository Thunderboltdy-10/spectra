"use client";

import { forwardRef, useMemo, useState } from "react";
import { toast } from "@/components/ui/toast";
import { Icon } from "@/components/icons";
import { AdaptiveBar, type BarCommand, type CollapseStep } from "@/components/ui/adaptive-bar";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { InlineEmphasis } from "../components/inline-emphasis";
import { deriveLiveDockTab } from "../runs/live-dock";
import type { SpectraRunEngine } from "./engine";
import type { IslandTab } from "./island-model";
import { runTabCard, runTabSource } from "./run-tabs";

/*
 * The thread view (ISLAND.md): hovering a tab raises its thread above the
 * island, the main way to follow Spectra's work before any side panel. The
 * header has the title, the live caption and the quick actions; the body
 * the steps and the reply; the footer a reply field bound to the thread.
 */

const PLAN: CollapseStep[] = [{ hideLabel: "copy" }, { hideLabel: "undo" }, { hideLabel: "side" }, { toMenu: "copy" }, { toMenu: "undo" }];

export const ThreadView = forwardRef<
  HTMLDivElement,
  {
    tab: IslandTab;
    engine: SpectraRunEngine | null;
    visible: boolean;
    offset: number;
    onOpenSide: () => void;
    onDismiss: () => void;
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
  }
>(function ThreadView({ tab, engine, visible, offset, onOpenSide, onDismiss, onPointerEnter, onPointerLeave }, ref) {
  const [reply, setReply] = useState("");
  const model = useMemo(() => deriveLiveDockTab(runTabSource(tab.source)), [tab.source]);
  const live = engine?.liveExchange?.runId === tab.runId ? engine.liveExchange : null;
  const moving = tab.status === "working" || tab.state === "needs_input";
  const card = runTabCard(tab.source);
  const canUndo = Boolean(card?.actions?.some((action) => action.key === "revert")) && !model.undone;
  const answerText = live?.content?.trim() || model.finalSummary;
  const steps = live?.steps.length
    ? live.steps.map((step) => ({ title: step.title, done: step.status !== "running", failed: step.status === "error" }))
    : model.recentSteps.map((title, index, all) => ({ title, done: !moving || index < all.length - 1, failed: false }));

  const commands = useMemo<BarCommand[]>(
    () => [
      { id: "side", icon: "openSide", label: "Open in side", onSelect: onOpenSide },
      ...(moving && engine
        ? [{ id: "stop", icon: <span className="size-2.5 rounded-sm bg-current" />, label: "Stop", onSelect: () => void engine.stop(tab.runId) } satisfies BarCommand]
        : []),
      ...(canUndo && engine && card
        ? [{ id: "undo", icon: "undoSpectra", label: "Undo Spectra's changes", onSelect: () => void engine.onCardAction(card, "revert") } satisfies BarCommand]
        : []),
      {
        id: "copy",
        icon: "document",
        label: "Copy reply",
        disabled: !answerText,
        onSelect: () =>
          void navigator.clipboard
            .writeText(answerText)
            .then(() => toast.success("Copied"))
            .catch(() => toast.error("Could not copy")),
      },
      { id: "dismiss", icon: "close", label: "Dismiss", labelPolicy: "never", onSelect: onDismiss },
    ],
    [answerText, canUndo, card, engine, moving, onDismiss, onOpenSide, tab.runId],
  );

  const sendReply = () => {
    const clean = reply.trim();
    if (!clean || !engine) return;
    setReply("");
    void engine.run(clean, [], { threadId: tab.threadId });
  };

  return (
    <div
      ref={ref}
      data-island-thread
      role="region"
      aria-label={`Thread: ${tab.title}`}
      inert={!visible}
      aria-hidden={!visible}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{ transform: `translateX(${offset}px)` }}
      className={cn(
        "box-border flex max-h-[70vh] w-[min(600px,calc(100vw-32px))] flex-col rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]",
        "transition-[opacity,transform] duration-200 ease-[var(--ease-standard)]",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] py-2 pl-4 pr-2">
        <div key={tab.runId} className="min-w-0 flex-1 island-content-in">
          <div data-thread-title className="truncate text-ui font-semibold text-[var(--text-primary)]">
            {tab.title}
          </div>
          <div data-thread-caption className="truncate text-caption text-[var(--text-secondary)]">
            {live?.steps.at(-1)?.title ?? tab.caption}
          </div>
        </div>
        <AdaptiveBar commands={commands} plan={PLAN} label="Thread commands" layer="toast" className="max-w-[60%] flex-none" />
      </header>
      <div key={tab.runId} className="min-h-0 flex-1 island-content-in overflow-y-auto px-4 py-3 text-caption leading-5">
        {steps.length ? (
          <ol className="mb-3 space-y-1.5">
            {steps.map((step, index) => (
              <li key={`${index}:${step.title}`} className="flex items-start gap-2 text-[var(--text-secondary)]">
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
                  {step.failed ? (
                    <span className="size-1.5 rounded-full bg-[var(--danger)]" />
                  ) : step.done ? (
                    <Icon name="check" size={14} className="text-[var(--text-tertiary)]" />
                  ) : (
                    <span className="size-1.5 animate-pulse rounded-full bg-[var(--brand-primary)]" />
                  )}
                </span>
                <span className="min-w-0 flex-1">{step.title}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {answerText && !moving ? (
          <p className="whitespace-pre-wrap text-ui leading-6 text-[var(--text-primary)]">
            <InlineEmphasis text={answerText} />
          </p>
        ) : live?.content ? (
          <p className="whitespace-pre-wrap text-ui leading-6 text-[var(--text-primary)]">{live.content}</p>
        ) : !steps.length ? (
          <p className="text-[var(--text-tertiary)]">{tab.caption}</p>
        ) : null}
      </div>
      <form
        className="flex items-center gap-1.5 border-t border-[var(--border-subtle)] p-2"
        onSubmit={(event) => {
          event.preventDefault();
          sendReply();
        }}
      >
        <input
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder={`Reply to ${tab.title}`}
          aria-label={`Reply to ${tab.title}`}
          className="h-9 min-w-0 flex-1 bg-transparent px-2 text-ui text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
        <IconButton icon="send" label="Send reply" type="submit" disabled={!reply.trim() || !engine} />
      </form>
    </div>
  );
});
