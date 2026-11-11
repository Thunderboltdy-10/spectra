"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "@/components/icons/glyph-icons";
import { WorkingMark } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { transitionFor, useSpectraMotion } from "../motion";
import { CrossfadeText } from "../motion/motion-primitives";
import type { SpectraLiveExchange } from "../ai/use-spectra-run";
import type { AnsweredInput } from "../ai/harness-exchange";
import { InlineEmphasis } from "./inline-emphasis";
import { failedProgressTitle, pastTenseProgressTitle } from "./progress-title";

const groupOpenByKey = new Map<string, boolean>();
// When a trace saw its run finish, so a remount still says how long it worked.
const finishedAtByKey = new Map<string, number>();

/** Opens a trace's step list when it next mounts: the reader asked to see it. */
export function openTraceWhenShown(persistKey: string) {
  groupOpenByKey.set(persistKey, true);
}

/** "8s", "1m 20s", "1h 4m": how long Spectra has been at it. */
/** "Finished with Claude Code" when the run moved off the person's runtime; the last one is named. */
export function finishedWithLabel(steps: ReadonlyArray<{ id: string; title: string }>) {
  const moved = [...steps].reverse().find((step) => step.id.startsWith("runtime-move:"));
  return moved ? moved.title.replace(/^Continued with /, "Finished with ") : undefined;
}

export function workedDuration(milliseconds: number) {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * The thinking as it was written, block by block: a bold line is what the next
 * paragraphs are about. A heading about the machinery (a guide being loaded, an
 * escaped quote) says nothing to the reader, so only its paragraphs stay.
 */
export function thinkingBlocks(text: string) {
  const blocks: Array<{ heading: boolean; text: string }> = [];
  // Headings can arrive with nothing between them: each still starts a block.
  for (const raw of text.replace(/\*\*\s*\*\*/g, "\n\n").replace(/\*\*([^*\n]{2,100})\*\*\s*(?=\S)/g, "**$1**\n\n").split(/\n\s*\n/)) {
    const block = raw.trim();
    if (!block) continue;
    const heading = /^\*\*([^*\n]{2,100})\*\*$/.exec(block)?.[1]?.trim();
    if (heading) {
      if (!/\\|guidance|\bskills?\b|\btools?\b|system prompt/i.test(heading)) blocks.push({ heading: true, text: heading });
      continue;
    }
    blocks.push({ heading: false, text: block.replace(/\*\*/g, "") });
  }
  return blocks;
}

/**
 * What the list shows of the steps: a run of the same action is one line with a
 * count, and something that failed on the way to a later success is left out: the
 * work went on past it, and the reply says if anything is still not done.
 */
export function visibleTraceSteps<T extends { id: string; kind?: string; title?: string; status?: string }>(steps: T[], active: boolean) {
  const shown: Array<T & { repeats?: number }> = [];
  steps.forEach((step, index) => {
    const recovered = step.status === "error"
      && (active || steps.slice(index + 1).some((later) => later.kind !== "thinking" && later.status !== "error"));
    if (recovered) return;
    const last = shown[shown.length - 1];
    if (last && step.kind !== "thinking" && last.kind !== "thinking" && last.title === step.title && last.status === step.status) {
      shown[shown.length - 1] = { ...last, id: step.id, repeats: (last.repeats ?? 1) + 1 };
      return;
    }
    shown.push(step);
  });
  return shown;
}

/** A paragraph of thinking: as tall as it needs up to a limit, following the words as they come. */
function ThinkingParagraph({ text, streaming }: { text: string; streaming: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [tall, setTall] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setTall(element.scrollHeight > element.clientHeight + 1);
    if (streaming) element.scrollTop = element.scrollHeight;
  }, [text, streaming]);
  return (
    <p ref={ref} tabIndex={tall ? 0 : undefined} data-following={(streaming && tall) || undefined} className="spectra-thinking-body">
      {text}
    </p>
  );
}

/** One stretch of the model's thinking, written out as it comes. */
function ThinkingPart({
  step,
  streaming,
}: {
  step: SpectraLiveExchange["steps"][number];
  streaming: boolean;
}) {
  const blocks = thinkingBlocks(step.summary ?? "");
  if (!blocks.length) return null;
  return (
    <div className="space-y-1">
      {blocks.map((block, index) => {
        const last = index === blocks.length - 1;
        if (block.heading)
          return (
            <div key={index} className="spectra-trace-line">
              <span aria-hidden className="spectra-thinking-mark" />
              <span className={cn("min-w-0 flex-1 text-caption font-medium text-[var(--text-secondary)]", streaming && last && "thinking-wave")}>
                {block.text}
              </span>
            </div>
          );
        return (
          <div key={index} className="spectra-trace-line">
            {index === 0 ? <span aria-hidden className="spectra-thinking-mark" /> : <span aria-hidden className="spectra-thinking-indent" />}
            <ThinkingParagraph text={block.text} streaming={streaming && last} />
          </div>
        );
      })}
    </div>
  );
}

export function ProgressTrace({
  steps,
  active,
  hasOutput = false,
  summary,
  compact = false,
  persistKey,
  answers,
  startedAt,
  endedAt,
  workedMs,
  finishedWith = finishedWithLabel(steps),
  continuation = false,
  current = true,
}: {
  steps: SpectraLiveExchange["steps"];
  active: boolean;
  /** True once assistant text (or terminal failure UI) has started. */
  hasOutput?: boolean;
  summary?: string;
  /** Dock hover: tighter chrome and a scrollable trace list. */
  compact?: boolean;
  /** Remember open/closed across remounts (dock hover, thread traces). */
  persistKey?: string;
  /** Questions and approvals already answered: one line each. */
  answers?: AnsweredInput[];
  /** When the run began; with it the header reads "Working for 12s", then "Worked for 1m 20s". */
  startedAt?: number;
  /** When the run settled, if known; otherwise the moment this trace saw it finish. */
  endedAt?: number;
  /** The time it actually worked, waits for the person left out, once the run has saved it. */
  workedMs?: number;
  /** "Finished with Claude Code" when the run moved to another runtime. */
  finishedWith?: string;
  /** Work done after the reply began: sits among the words and carries no clock. */
  continuation?: boolean;
  /** False once the reply has moved on past this work, so it folds where it is. */
  current?: boolean;
}) {
  /* The trace is run feedback, so it runs on the completion/reveal grammar:
     steps entering are `reveal`, the group opening is `morph`, and the whole
     thing honours the product motion preference, not just the OS one. */
  const motionLevel = useSpectraMotion();
  const reduceMotion = motionLevel.reduced;
  const revealTransition = transitionFor("reveal", motionLevel.level);
  const morphTransition = transitionFor("morph", motionLevel.level);
  // The steps and the thinking show for as long as Spectra works, written
  // replies between them included, then fold away. A choice the user made holds.
  const [chosenOpen, setChosenOpen] = useState(() => (persistKey ? groupOpenByKey.get(persistKey) : undefined));
  const groupOpen = chosenOpen ?? (active && current);
  const finished = !active && (steps.length > 0 || hasOutput);
  const [now, setNow] = useState(() => Date.now());
  // The clock runs for the whole turn, writing included, so a long silent
  // stretch still visibly moves and the total matches the saved reply's.
  useEffect(() => {
    if (!active || startedAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, startedAt]);
  const [sawFinish, setSawFinish] = useState(() => (persistKey ? finishedAtByKey.get(persistKey) : undefined));
  useEffect(() => {
    if (active) {
      // A run that resumes after a question is working again.
      if (sawFinish !== undefined) {
        if (persistKey) finishedAtByKey.delete(persistKey);
        setSawFinish(undefined);
      }
      return;
    }
    if (!finished || endedAt !== undefined || sawFinish !== undefined) return;
    const at = Date.now();
    if (persistKey) finishedAtByKey.set(persistKey, at);
    setSawFinish(at);
  }, [active, finished, persistKey, endedAt, sawFinish]);

  // Only the small hover preview is short enough to need its own scrolling.
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useLayoutEffect(() => {
    const element = listRef.current;
    if (compact && active && element && followRef.current) element.scrollTop = element.scrollHeight;
  }, [active, compact, steps]);

  const settledAt = endedAt ?? sawFinish;
  const timed = !continuation && startedAt !== undefined && (active || settledAt !== undefined);
  if (!active && !timed && steps.length === 0 && !summary?.trim() && !answers?.length) return null;

  const visibleSteps = visibleTraceSteps(steps, active);
  if (continuation && !visibleSteps.length) return null;
  const expandable = steps.length > 0;
  const showTraceToggle = active || expandable || timed;
  // The header says what Spectra is doing now, then what it did.
  const runningStep = [...steps].reverse().find((step) => step.status === "running");
  const headline = continuation
    ? active && current && runningStep
      ? runningStep.title
      : visibleSteps.every((step) => step.kind === "thinking")
        ? "Thought"
        : visibleSteps.length === 1
          ? pastTenseProgressTitle(visibleSteps[0]!.title, true)
          : `${visibleSteps.length} steps`
    : timed
    ? finished
      ? "Worked for"
      : "Working for"
    : finished
      ? steps.length ? pastTenseProgressTitle(steps.at(-1)!.title, true) : "Done"
      : runningStep?.title || steps.at(-1)?.title || "Thinking";
  const elapsed = timed
    ? workedDuration(!active && workedMs !== undefined ? workedMs : (active ? Math.max(now, startedAt!) : settledAt!) - startedAt!)
    : null;

  return (
    <div
      className={cn(compact ? "py-0.5" : continuation ? "my-3 py-0.5" : "mb-3 py-1")}
      aria-label="Spectra progress"
    >
      {showTraceToggle ? (
        <button
          type="button"
          onClick={() => {
            if (!expandable) return;
            const next = !groupOpen;
            if (persistKey) groupOpenByKey.set(persistKey, next);
            setChosenOpen(next);
          }}
          className={cn("mb-1.5 flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left", expandable ? "cursor-pointer" : "cursor-default")}
          aria-expanded={expandable ? groupOpen : undefined}
        >
          <span
            className={cn(
              "min-w-0 truncate text-caption font-medium tracking-[-0.01em] text-[var(--text-secondary)] opacity-70",
              // While Spectra works, the skeleton's band of light passes along the header.
              !finished && current && "thinking-wave",
            )}
          >
            {/* Present tense becomes past tense with a quick cross-fade. */}
            <CrossfadeText value={headline} primitive="completion" />
            {elapsed ? <span className="tabular-nums"> {elapsed}</span> : null}
            {finished && timed && finishedWith ? <span> · {finishedWith}</span> : null}
          </span>
          {expandable ? (
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-[var(--text-tertiary)] opacity-70 transition-transform duration-[var(--motion-base)] ease-standard",
                groupOpen ? "rotate-180" : "rotate-0",
              )}
            />
          ) : null}
        </button>
      ) : null}
      <AnimatePresence initial={false}>
        {groupOpen && expandable ? (
          <motion.div
            key="thinking-children"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={morphTransition}
            className="overflow-hidden"
          >
            <div
              ref={listRef}
              onScroll={
                compact
                  ? (event) => {
                      const element = event.currentTarget;
                      followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
                    }
                  : undefined
              }
              className={cn("relative pr-1", compact && "spectra-trace-list spectra-live-dock-progress max-h-40 overflow-y-auto")}
            >
              {visibleSteps.map((step, index) => (
                <motion.div
                  key={step.id}
                  initial={reduceMotion || !active ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={revealTransition}
                  className="py-1"
                >
                  {step.kind === "thinking" ? (
                    <ThinkingPart step={step} streaming={active && step.status === "running" && index === visibleSteps.length - 1} />
                  ) : (
                    <div className="spectra-trace-line">
                      {active && step.status === "running" ? <WorkingMark /> : <span aria-hidden className="spectra-thinking-mark" />}
                      <span
                        title={step.summary}
                        className={cn(
                          "min-w-0 flex-1 truncate text-caption font-medium text-[var(--text-secondary)]",
                          active && step.status === "running" && "thinking-wave",
                        )}
                      >
                        {step.status === "error" ? failedProgressTitle(step.title) : pastTenseProgressTitle(step.title, step.status !== "running")}
                        {step.repeats ? <span className="ml-1 font-normal text-[var(--text-tertiary)]">{step.repeats} times</span> : null}
                      </span>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {answers?.length ? (
        <ul className="mb-1.5 space-y-1" aria-label="Your answers">
          {answers.map((answer) => (
            <li key={answer.toolCallId} className="flex min-w-0 items-center gap-2 text-caption text-[var(--text-secondary)]">
              <span aria-hidden className="spectra-thinking-mark" />
              <span className="min-w-0 truncate">
                {answer.question ? (
                  <span className="text-[var(--text-tertiary)]">
                    <InlineEmphasis text={answer.question} /> ·{" "}
                  </span>
                ) : null}
                <span className="font-semibold">{answer.label}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {finished && summary?.trim() ? (
        <p
          className={cn(
            "text-caption leading-5 text-[var(--text-secondary)]",
            showTraceToggle && "mt-2",
          )}
        >
          {summary.trim()}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A finished reply's "Worked for 12s" before its trace is loaded: the same
 * header the live trace settles into, and pressing it brings the steps back.
 */
export function WorkedForReveal({
  durationMs,
  finishedWith,
  loading,
  error,
  onReveal,
}: {
  durationMs: number;
  finishedWith?: string;
  loading: boolean;
  error?: string;
  onReveal: () => void;
}) {
  return (
    <div className="mb-3 py-1">
      <button
        type="button"
        onClick={() => {
          if (!loading) onReveal();
        }}
        aria-busy={loading}
        aria-expanded={false}
        className="mb-1.5 flex min-w-0 cursor-pointer items-center gap-1.5 py-0.5 text-left"
      >
        <span className={cn("min-w-0 truncate text-caption font-medium tracking-[-0.01em] text-[var(--text-secondary)] opacity-70", loading && "thinking-wave")}>
          {error ? "The steps did not load. Try again" : <>Worked for <span className="tabular-nums">{workedDuration(durationMs)}</span>{finishedWith ? ` · ${finishedWith}` : null}</>}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)] opacity-70" />
      </button>
    </div>
  );
}
