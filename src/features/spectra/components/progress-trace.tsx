"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, ChevronDown } from "@/components/icons/glyph-icons";
import { WorkingMark } from "@/components/ui/skeleton";
import { Icon } from "@/components/icons";
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
export function workedDuration(milliseconds: number) {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** What a part of the reasoning is about, when it opens with a bold title, and the rest. */
function thinkingParts(text: string) {
  const titled = /^\s*\*\*([^*\n]{2,100})\*\*\s*/.exec(text);
  // Further headings arrive with nothing between them: keep each on its own line.
  const body = (titled ? text.slice(titled[0].length) : text).replace(/\*\*\s*\*\*/g, "\n").replace(/\*\*/g, "").trim();
  // A heading about the machinery (a guide being loaded, an escaped quote) says nothing to the reader.
  const title = titled?.[1]?.trim();
  return { title: title && !/\\|guidance|\bskills?\b|\btools?\b|system prompt/i.test(title) ? title : "Thinking", body };
}

/**
 * What the list shows of the steps: a run of the same action is one line with a
 * count, and a look at something that failed on the way to a good result is left
 * out, since nothing about the result depends on it.
 */
export function visibleTraceSteps<T extends { id: string; kind?: string; title?: string; status?: string }>(steps: T[], active: boolean) {
  const shown: Array<T & { repeats?: number }> = [];
  steps.forEach((step, index) => {
    const recovered = step.status === "error" && (active || index < steps.length - 1)
      && /^(read|reading|search|searching|check|checking|look|looking|find|finding|list|listing)\b/i.test(step.title ?? "");
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

/** One stretch of reasoning: a few lines tall, following the words as they come. */
function ThinkingPart({
  step,
  streaming,
}: {
  step: SpectraLiveExchange["steps"][number];
  streaming: boolean;
}) {
  const { title, body } = thinkingParts(step.summary ?? "");
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (streaming && element) element.scrollTop = element.scrollHeight;
  }, [body, streaming]);
  return (
    <>
      <div className="flex w-full items-center gap-2 text-left">
        {streaming ? <WorkingMark /> : <span aria-hidden className="spectra-thinking-mark" />}
        <span className={cn("min-w-0 flex-1 truncate text-micro font-semibold text-[var(--text-secondary)]", streaming && "thinking-wave")}>
          {title}
        </span>
      </div>
      {body ? (
        <div ref={bodyRef} tabIndex={0} data-streaming={streaming || undefined} className="spectra-thinking-body">
          {body}
        </div>
      ) : null}
    </>
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
  const groupOpen = chosenOpen ?? active;
  // Steps seen working here: when one finishes, its light settles into a tick that draws itself.
  const [ranHere, setRanHere] = useState<Set<string>>(() => new Set());
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

  useEffect(() => {
    const fresh = steps.filter((step) => step.status === "running" && !ranHere.has(step.id));
    if (fresh.length) setRanHere((current) => new Set([...current, ...fresh.map((step) => step.id)]));
  }, [steps, ranHere]);

  // The list follows the newest step unless the reader has scrolled back.
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useLayoutEffect(() => {
    const element = listRef.current;
    if (active && element && followRef.current) element.scrollTop = element.scrollHeight;
  }, [active, steps]);

  const settledAt = endedAt ?? sawFinish;
  const timed = startedAt !== undefined && (active || settledAt !== undefined);
  if (!active && !timed && steps.length === 0 && !summary?.trim() && !answers?.length) return null;

  const visibleSteps = visibleTraceSteps(steps, active);
  const expandable = steps.length > 0;
  const showTraceToggle = active || expandable || timed;
  // The header says what Spectra is doing now, then what it did.
  const runningStep = [...steps].reverse().find((step) => step.status === "running");
  const headline = timed
    ? finished
      ? "Worked for"
      : "Working for"
    : finished
      ? steps.length ? pastTenseProgressTitle(steps.at(-1)!.title, true) : "Done"
      : runningStep?.title || steps.at(-1)?.title || "Thinking";
  const elapsed = timed ? workedDuration((active ? Math.max(now, startedAt!) : settledAt!) - startedAt!) : null;

  return (
    <div
      className={cn(compact ? "py-0.5" : "mb-3 py-1")}
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
              !finished && "thinking-wave",
            )}
          >
            {/* Present tense becomes past tense with a quick cross-fade. */}
            <CrossfadeText value={headline} primitive="completion" />
            {elapsed ? <span className="tabular-nums"> {elapsed}</span> : null}
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
              onScroll={(event) => {
                const element = event.currentTarget;
                followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
              }}
              className={cn(
                "spectra-trace-list relative overflow-y-auto pr-1",
                compact ? "spectra-live-dock-progress max-h-40" : "max-h-80",
              )}
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
                    <div className="flex w-full items-center gap-2 text-left">
                      {active && step.status === "running" ? (
                        <WorkingMark />
                      ) : step.status === "error" ? (
                        <AlertCircle className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                      ) : (
                        <Icon name="check" size={14} animate={ranHere.has(step.id)} className="text-[var(--success)]" />
                      )}
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-micro font-semibold text-[var(--text-secondary)]",
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
            <li key={answer.toolCallId} className="flex min-w-0 items-center gap-2 text-micro text-[var(--text-secondary)]">
              <Check className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" />
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
  loading,
  error,
  onReveal,
}: {
  durationMs: number;
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
          {error ? "The steps did not load. Try again" : <>Worked for <span className="tabular-nums">{workedDuration(durationMs)}</span></>}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)] opacity-70" />
      </button>
    </div>
  );
}
