"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { transitionFor, useSpectraMotion } from "../motion";
import type { SpectraLiveExchange } from "../ai/use-spectra-run";
import { pastTenseProgressTitle } from "./progress-title";

const groupOpenByKey = new Map<string, boolean>();

export function ProgressTrace({
  steps,
  active,
  hasOutput = false,
  summary,
  compact = false,
  persistKey,
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
}) {
  /* The trace is run feedback, so it runs on the completion/reveal grammar:
     steps entering are `reveal`, the group opening is `morph`, and the whole
     thing honours the product motion preference, not just the OS one. */
  const motionLevel = useSpectraMotion();
  const reduceMotion = motionLevel.reduced;
  const revealTransition = transitionFor("reveal", motionLevel.level);
  const morphTransition = transitionFor("morph", motionLevel.level);
  const thinking = active && !hasOutput;
  const [groupOpen, setGroupOpen] = useState(() => {
    if (persistKey && groupOpenByKey.has(persistKey)) {
      return groupOpenByKey.get(persistKey)!;
    }
    return thinking;
  });
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [userTouched, setUserTouched] = useState<Set<string>>(() => new Set());
  const [displayOrder, setDisplayOrder] = useState<string[]>(() =>
    steps.map((step) => step.id),
  );
  const completedAtRef = useRef<Map<string, number>>(new Map());
  const pendingReorderRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRunningRef = useRef<string | null>(null);
  const finished = !thinking && (steps.length > 0 || hasOutput);

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
    for (const step of steps) {
      if (step.status !== "running" && !completedAtRef.current.has(step.id)) {
        completedAtRef.current.set(step.id, Date.now());
      }
      if (step.status === "running") completedAtRef.current.delete(step.id);
    }
  }, [steps, userTouched]);

  useEffect(() => {
    if (persistKey && groupOpenByKey.has(persistKey)) return;
    setGroupOpen(thinking);
  }, [thinking, persistKey]);

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

  if (!thinking && steps.length === 0 && !summary?.trim()) return null;

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

  const showTraceToggle = thinking || steps.length > 0;

  return (
    <div
      className={cn(compact ? "py-0.5" : "mb-3 py-1")}
      aria-label="Spectra progress"
    >
      {showTraceToggle ? (
        <button
          type="button"
          onClick={() =>
            setGroupOpen((open) => {
              const next = !open;
              if (persistKey) groupOpenByKey.set(persistKey, next);
              return next;
            })
          }
          className="mb-1.5 flex w-full items-center gap-1.5 py-0.5 text-left"
          aria-expanded={groupOpen}
        >
          <span
            className={cn(
              "text-caption font-medium tracking-[-0.01em] text-[var(--text-secondary)] opacity-70",
              thinking && "thinking-wave",
            )}
          >
            {finished ? "Thought" : "Thinking"}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-[var(--text-tertiary)] opacity-70 transition-transform duration-[var(--motion-base)] ease-standard",
              groupOpen ? "rotate-180" : "rotate-0",
            )}
          />
        </button>
      ) : null}
      <AnimatePresence initial={false}>
        {groupOpen && showTraceToggle ? (
          <motion.div
            key="thinking-children"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={morphTransition}
            className="overflow-hidden"
          >
            {orderedSteps.length === 0 && thinking ? (
              <div className="flex items-center gap-2 py-1 text-caption text-[var(--text-tertiary)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" />
                <span className="thinking-wave opacity-80">Getting ready</span>
              </div>
            ) : (
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
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" />
                          ) : step.status === "error" ? (
                            <AlertCircle className="h-3.5 w-3.5 text-[var(--danger)]" />
                          ) : (
                            <Check className="h-3.5 w-3.5 text-[var(--success)]" />
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
                              <span className="ml-5 mt-1 block text-micro leading-4 text-[var(--text-tertiary)]">
                                {pastTenseProgressTitle(
                                  step.summary,
                                  step.status !== "running",
                                )}
                              </span>
                            </motion.p>
                          ) : null}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
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
