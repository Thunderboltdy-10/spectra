"use client";

import { useEffect, useRef, useState } from "react";
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
import { pastTenseProgressTitle } from "./progress-title";

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

export function ProgressTrace({
  steps,
  active,
  hasOutput = false,
  summary,
  compact = false,
  persistKey,
  caption,
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
  /** The past-tense caption naming what the finished run did. */
  caption?: string;
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
  const thinking = active && !hasOutput;
  // The steps show while Spectra works, so its thinking is what it is doing, not a light; once the answer
  // comes they fold under their caption. A choice the user made holds.
  const [chosenOpen, setChosenOpen] = useState(() => (persistKey ? groupOpenByKey.get(persistKey) : undefined));
  const groupOpen = chosenOpen ?? thinking;
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [userTouched, setUserTouched] = useState<Set<string>>(() => new Set());
  // Steps seen working here: when one finishes, its light settles into a tick that draws itself.
  const [ranHere, setRanHere] = useState<Set<string>>(() => new Set());
  const [displayOrder, setDisplayOrder] = useState<string[]>(() =>
    steps.map((step) => step.id),
  );
  const completedAtRef = useRef<Map<string, number>>(new Map());
  const pendingReorderRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRunningRef = useRef<string | null>(null);
  const finished = !thinking && (steps.length > 0 || hasOutput);
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
    const running = steps.find((step) => step.status === "running");
    const runningId = running?.id ?? null;
    const previous = prevRunningRef.current;
    if (runningId !== previous) {
      setOpenIds((current) => {
        const next = new Set(current);
        if (previous && !userTouched.has(previous)) next.delete(previous);
        if (runningId && !userTouched.has(runningId)) next.add(runningId);
        return next;
      });
      prevRunningRef.current = runningId;
    }
    const fresh = steps.filter((step) => step.status === "running" && !ranHere.has(step.id));
    if (fresh.length) setRanHere((current) => new Set([...current, ...fresh.map((step) => step.id)]));
    for (const step of steps) {
      if (step.status !== "running" && !completedAtRef.current.has(step.id)) {
        completedAtRef.current.set(step.id, Date.now());
      }
      if (step.status === "running") completedAtRef.current.delete(step.id);
    }
  }, [steps, userTouched, ranHere]);

  useEffect(() => {
    const ids = steps.map((step) => step.id);
    setDisplayOrder((current) => {
      const kept = current.filter((id) => ids.includes(id));
      const missing = ids.filter((id) => !kept.includes(id));
      return missing.length === 0 && kept.length === current.length
        ? current
        : [...kept, ...missing];
    });
  }, [steps]);

  useEffect(() => {
    if (pendingReorderRef.current) {
      clearTimeout(pendingReorderRef.current);
      pendingReorderRef.current = null;
    }
    if (steps.length < 2) return;
    const byId = new Map(steps.map((step) => [step.id, step]));
    pendingReorderRef.current = setTimeout(() => {
      pendingReorderRef.current = null;
      setDisplayOrder((current) => {
        const now = Date.now();
        const ranked = [...current].sort((a, b) => {
          const stepA = byId.get(a);
          const stepB = byId.get(b);
          if (!stepA || !stepB) return 0;
          const doneA =
            stepA.status !== "running" &&
            (completedAtRef.current.get(a) ?? 0) <= now - 1000;
          const doneB =
            stepB.status !== "running" &&
            (completedAtRef.current.get(b) ?? 0) <= now - 1000;
          if (doneA !== doneB) return doneA ? -1 : 1;
          if (doneA && doneB) {
            return (
              (completedAtRef.current.get(a) ?? 0) -
              (completedAtRef.current.get(b) ?? 0)
            );
          }
          return current.indexOf(a) - current.indexOf(b);
        });
        return ranked.every((id, index) => id === current[index])
          ? current
          : ranked;
      });
    }, 1050);
    return () => {
      if (pendingReorderRef.current) {
        clearTimeout(pendingReorderRef.current);
        pendingReorderRef.current = null;
      }
    };
  }, [steps]);

  const settledAt = endedAt ?? sawFinish;
  const timed = startedAt !== undefined && (active || settledAt !== undefined);
  if (!thinking && !timed && steps.length === 0 && !summary?.trim() && !caption?.trim() && !answers?.length) return null;

  const orderedSteps = displayOrder
    .map((id) => steps.find((step) => step.id === id))
    .filter((step): step is (typeof steps)[number] => Boolean(step));

  function toggleStep(id: string) {
    setUserTouched((current) => new Set(current).add(id));
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // A step shows only once a caption or a tool has something true to say;
  // until then the header alone says Spectra is thinking.
  const expandable = steps.length > 0;
  const showTraceToggle = thinking || expandable || timed;
  // The header says what Spectra is doing now, then what it did.
  const runningStep = [...steps].reverse().find((step) => step.status === "running");
  const headline = timed
    ? finished
      ? "Worked for"
      : "Working for"
    : finished
      ? caption?.trim() || (steps.length ? pastTenseProgressTitle(steps.at(-1)!.title, true) : "Done")
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
          disabled={!expandable}
          onClick={() => {
            const next = !groupOpen;
            if (persistKey) groupOpenByKey.set(persistKey, next);
            setChosenOpen(next);
          }}
          className="mb-1.5 flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left"
          aria-expanded={expandable ? groupOpen : undefined}
          title={finished && timed ? caption?.trim() : undefined}
        >
          <span
            className={cn(
              "min-w-0 truncate text-caption font-medium tracking-[-0.01em] text-[var(--text-secondary)] opacity-70",
              // While Spectra works, the skeleton's band of light passes along the caption.
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
              className={cn(
                "relative space-y-1.5",
                compact && "spectra-live-dock-progress max-h-40 overflow-y-auto pr-1",
              )}
            >
              <AnimatePresence initial={false}>
                {orderedSteps.map((step) => {
                  const open = openIds.has(step.id);
                  const hasDetail = Boolean(
                    step.summary?.trim() &&
                    step.summary.trim().toLocaleLowerCase() !==
                      step.title.trim().toLocaleLowerCase(),
                  );
                  return (
                    <motion.div
                      key={step.id}
                      layout={!reduceMotion}
                      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                      transition={{
                        layout: morphTransition,
                        opacity: revealTransition,
                        y: revealTransition,
                      }}
                      className="py-1.5"
                    >
                      <div className="flex w-full items-center gap-2 text-left">
                        {step.status === "running" ? (
                          <WorkingMark />
                        ) : step.status === "error" ? (
                          <AlertCircle className="h-3.5 w-3.5 text-[var(--danger)]" />
                        ) : (
                          <Icon name="check" size={14} animate={ranHere.has(step.id)} className="text-[var(--success)]" />
                        )}
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-micro font-semibold text-[var(--text-secondary)]",
                            step.status === "running" && "thinking-wave",
                          )}
                        >
                          {pastTenseProgressTitle(
                            step.title,
                            step.status !== "running",
                          )}
                        </span>
                        {hasDetail ? (
                          <button
                            type="button"
                            onClick={() => toggleStep(step.id)}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-chip hover:bg-[var(--bg-hover)]"
                            aria-expanded={open}
                            aria-label={`${open ? "Hide" : "Show"} details for ${step.title}`}
                          >
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform duration-[var(--motion-base)] ease-standard",
                                open ? "rotate-180" : "rotate-0",
                              )}
                            />
                          </button>
                        ) : null}
                      </div>
                      <AnimatePresence initial={false}>
                        {open && hasDetail && step.summary ? (
                          <motion.p
                            key={`${step.id}:summary`}
                            initial={
                              reduceMotion ? false : { height: 0, opacity: 0 }
                            }
                            animate={{ height: "auto", opacity: 1 }}
                            exit={
                              reduceMotion
                                ? undefined
                                : { height: 0, opacity: 0 }
                            }
                            transition={revealTransition}
                            className="overflow-hidden"
                          >
                            {/* One line per step behind the caption, never run together. */}
                            {step.summary
                              .split("\n")
                              .map((line) => pastTenseProgressTitle(line, step.status !== "running"))
                              .filter(Boolean)
                              .map((line, index) => (
                                <span
                                  key={index}
                                  className={cn(
                                    "ml-5 block text-micro leading-4 text-[var(--text-tertiary)]",
                                    index === 0 && "mt-1",
                                  )}
                                >
                                  {line}
                                </span>
                              ))}
                          </motion.p>
                        ) : null}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
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
        onClick={onReveal}
        disabled={loading}
        aria-expanded={false}
        className="mb-1.5 flex min-w-0 items-center gap-1.5 py-0.5 text-left"
      >
        <span className={cn("min-w-0 truncate text-caption font-medium tracking-[-0.01em] text-[var(--text-secondary)] opacity-70", loading && "thinking-wave")}>
          {error ? "The steps did not load. Try again" : <>Worked for <span className="tabular-nums">{workedDuration(durationMs)}</span></>}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)] opacity-70" />
      </button>
    </div>
  );
}
