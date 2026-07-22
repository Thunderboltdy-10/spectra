"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  CircleHelp,
  GitCompareArrows,
  Loader2,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import {
  getSpectraRunTabs,
  postSpectra,
  type SpectraRunTab,
} from "../data/api";
import type { ResultCardStreamView } from "../ai/stream-events";

const activeStatuses = new Set(["queued", "running", "awaiting_confirmation", "awaiting_resolution"]);
let sharedTabs: SpectraRunTab[] = [];
let sharedRefresh: Promise<void> | null = null;
let sharedPollTimer: number | null = null;
let sharedPollConsumers = 0;
const sharedTabListeners = new Set<(tabs: SpectraRunTab[]) => void>();

function refreshRunTabs() {
  if (sharedRefresh) return sharedRefresh;
  sharedRefresh = getSpectraRunTabs({ limit: 120 })
    .then((value) => {
      sharedTabs = value.runTabs;
      sharedTabListeners.forEach((listener) => listener(sharedTabs));
    })
    .catch(() => undefined)
    .finally(() => {
      sharedRefresh = null;
    });
  return sharedRefresh;
}

function useSharedActivePolling() {
  sharedPollConsumers += 1;
  if (sharedPollTimer === null)
    sharedPollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshRunTabs();
    }, 4000);
  return () => {
    sharedPollConsumers = Math.max(0, sharedPollConsumers - 1);
    if (sharedPollConsumers === 0 && sharedPollTimer !== null) {
      window.clearInterval(sharedPollTimer);
      sharedPollTimer = null;
    }
  };
}

export function DurableRunTabs({
  workspaceId,
  optimistic,
  onOpen,
  onStop,
  onRetry,
  onAction,
  onRevise,
  openThreadId,
}: {
  workspaceId?: string;
  optimistic?: {
    id: string;
    prompt: string;
    runId?: string;
    status: string;
  } | null;
  onOpen?: (runId: string, threadId: string, title: string) => void;
  onStop?: (runId: string) => void | Promise<void>;
  onRetry?: (runId: string) => void;
  onAction?: (card: ResultCardStreamView, action: "confirm" | "cancel") => void | Promise<void>;
  onRevise?: (card: ResultCardStreamView, revision: string) => void | Promise<void>;
  openThreadId?: string;
}) {
  const [tabs, setTabs] = useState<SpectraRunTab[]>(sharedTabs);
  const [stoppingRunIds, setStoppingRunIds] = useState<Set<string>>(new Set());
  const [revisingRunId, setRevisingRunId] = useState<string | null>(null);
  const [revision, setRevision] = useState("");
  const reduceMotion = useReducedMotion();
  const continuation = useSpectraContextStore((state) => state.continuation);
  const setContinuation = useSpectraContextStore(
    (state) => state.setContinuation,
  );
  const hydratedSelection = useRef(false);
  const metadataSyncedRuns = useRef(new Set<string>());
  const refresh = useCallback(() => refreshRunTabs(), []);
  useEffect(() => {
    sharedTabListeners.add(setTabs);
    void refresh();
    const handler = () => void refresh();
    window.addEventListener("spectra:threads-changed", handler);
    return () => {
      sharedTabListeners.delete(setTabs);
      window.removeEventListener("spectra:threads-changed", handler);
    };
  }, [refresh]);
  useEffect(() => {
    if (hydratedSelection.current || tabs.length === 0) return;
    hydratedSelection.current = true;
    if (continuation) return;
    const selected = tabs.find(
      (tab) => tab.selected && !tab.hiddenAt && activeStatuses.has(tab.run.status),
    );
    if (selected)
      setContinuation({
        id: selected.threadId,
        title: selected.thread.title,
        runId: selected.runId,
        workspaceId: selected.workspaceId,
      });
  }, [continuation, setContinuation, tabs]);
  useEffect(() => {
    if (!continuation) return;
    const canonical = tabs.find((tab) => tab.threadId === continuation.id);
    if (
      !canonical ||
      canonical.run.status !== "completed" ||
      canonical.thread.title === continuation.title ||
      metadataSyncedRuns.current.has(canonical.runId)
    )
      return;
    metadataSyncedRuns.current.add(canonical.runId);
    setContinuation({ ...continuation, title: canonical.thread.title });
  }, [continuation, setContinuation, tabs]);
  const visible = useMemo(() => {
    const scoped = tabs.filter(
      (tab) =>
        !workspaceId || tab.workspaceId === workspaceId || !tab.workspaceId,
    );
    const live = scoped.filter((tab) => activeStatuses.has(tab.run.status));
    return live
      .filter(
        (tab, index, all) =>
          all.findIndex((candidate) => candidate.threadId === tab.threadId) ===
          index,
      )
      .slice(0, 6);
  }, [tabs, workspaceId]);
  const hasActive = visible.some(
    (tab) =>
      activeStatuses.has(tab.run.status) &&
      Date.now() - tab.run.updatedAt < 10 * 60_000,
  );
  useEffect(() => {
    if (!hasActive) return;
    return useSharedActivePolling();
  }, [hasActive]);
  const showOptimistic = Boolean(
    optimistic && optimistic.status === "starting" && !optimistic.runId,
  );
  if (visible.length === 0 && !showOptimistic) return null;
  const pendingDecision = visible.find((tab) => tab.run.status === "awaiting_confirmation" && tab.threadId !== openThreadId && tab.card);
  const decisionCard: ResultCardStreamView | null = pendingDecision?.card ? {
    id: pendingDecision.card._id,
    runId: pendingDecision.card.runId,
    status: pendingDecision.card.status,
    title: pendingDecision.card.title,
    summary: pendingDecision.card.summary,
    variant: pendingDecision.card.variant,
    actions: pendingDecision.card.actions,
    provenance: pendingDecision.card.provenance,
    updatedAt: pendingDecision.card.updatedAt,
  } : null;
  return (
    <div className="mb-2 w-full">
      {decisionCard && pendingDecision ? <section className="mb-2 rounded-[11px] border border-[color-mix(in_oklab,var(--warning)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_5%,var(--bg-elevated))] px-3.5 py-3 shadow-[0_10px_30px_-24px_rgba(27,20,12,.35)]" aria-label="Spectra needs your decision">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--warning)_12%,var(--bg-primary))] text-[var(--warning)]"><ShieldCheck className="h-3.5 w-3.5" /></span>
          <div className="min-w-0 flex-1"><div className="text-[12px] font-semibold text-[var(--text-primary)]">Review {pendingDecision.thread.title}</div><p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[var(--text-secondary)]">{decisionCard.summary || "Spectra has prepared changes and is waiting for you before applying them."}</p></div>
          <div className="flex shrink-0 items-center gap-1.5"><button type="button" onClick={() => void onAction?.(decisionCard, "confirm")} className="h-8 rounded-[7px] bg-[var(--text-primary)] px-3 text-[10px] font-semibold text-[var(--bg-primary)]">Apply changes</button><button type="button" onClick={() => setRevisingRunId((current) => current === decisionCard.runId ? null : decisionCard.runId)} className="h-8 rounded-[7px] px-2.5 text-[10px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">Ask for changes</button><button type="button" onClick={() => void onAction?.(decisionCard, "cancel")} className="h-8 rounded-[7px] px-2.5 text-[10px] font-semibold text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]">Reject</button></div>
        </div>
        {revisingRunId === decisionCard.runId ? <div className="mt-2.5 flex gap-2 pl-10"><input autoFocus value={revision} onChange={(event) => setRevision(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && revision.trim()) { void onRevise?.(decisionCard, revision.trim()); setRevision(""); setRevisingRunId(null); } }} placeholder="What should Spectra change?" className="h-9 min-w-0 flex-1 rounded-[8px] bg-[var(--bg-primary)] px-3 text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]" /><button type="button" disabled={!revision.trim()} onClick={() => { void onRevise?.(decisionCard, revision.trim()); setRevision(""); setRevisingRunId(null); }} className="h-9 rounded-[8px] bg-[var(--accent-cyan)] px-3 text-[10px] font-semibold text-white disabled:opacity-40">Revise</button></div> : null}
      </section> : null}
    <div
      className="spectra-run-tab-strip flex w-full gap-1.5 overflow-x-auto overflow-y-hidden px-0.5 py-0.5"
      aria-label="Live Spectra threads"
      aria-live="polite"
    >
      {showOptimistic ? (
        <div
          className="relative flex h-11 min-w-[260px] flex-1 items-center overflow-hidden rounded-[9px] border border-[color-mix(in_oklab,var(--accent-cyan)_28%,var(--border-default))] bg-[var(--bg-primary)] shadow-[inset_3px_0_var(--accent-cyan)]"
          data-run-status="starting"
        >
          <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 animate-[spectra-tab-sweep_1.8s_ease-in-out_infinite] bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--accent-cyan)_12%,transparent),transparent)] motion-reduce:hidden" />
          <div className="relative flex min-w-0 flex-1 items-center gap-2.5 px-3">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent-cyan)] motion-reduce:animate-none" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold text-[var(--text-primary)]">
                Starting with your context
              </span>
              <span className="block truncate text-[9px] text-[var(--text-tertiary)]">
                Keeping your workspace ready
              </span>
            </span>
          </div>
        </div>
      ) : null}
      <AnimatePresence initial={false}>
        {visible.map((tab) => {
          const active = continuation?.id === tab.threadId;
          const running =
            tab.run.status === "queued" || tab.run.status === "running";
          const approval = tab.run.status === "awaiting_confirmation";
          const conflict = tab.run.status === "awaiting_resolution";
          const cancelled = tab.run.status === "cancelled";
          const failed = tab.run.status === "failed";
          const needsAnswer =
            tab.run.status === "completed" && tab.run.decision === "clarify";
          const stopping = stoppingRunIds.has(tab.runId);
          const Icon = running
            ? Loader2
            : approval
              ? ShieldCheck
              : conflict
                ? GitCompareArrows
              : needsAnswer
                ? CircleHelp
              : cancelled
                ? Square
                : failed
                  ? AlertCircle
                  : CheckCircle2;
          const publicPhase = stopping
            ? "stopping"
            : conflict
              ? "review edit conflict"
            : needsAnswer
              ? "needs your answer"
            : cancelled
              ? "stopped"
              : running && tab.card?.summary
                ? tab.card.summary
                : (tab.run.phase ?? tab.run.status).replaceAll("_", " ");
          return (
            <motion.div
              key={tab.threadId}
              layout={!reduceMotion}
              initial={
                reduceMotion ? false : { opacity: 0, y: 5, scale: 0.985 }
              }
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.97 }}
              transition={reduceMotion ? { duration: 0 } : undefined}
              className={`group relative flex h-11 min-w-[260px] flex-1 items-center overflow-hidden rounded-[9px] border bg-[var(--bg-elevated)] shadow-[0_6px_20px_-18px_rgba(20,26,32,0.36)] ${active ? "border-[color-mix(in_oklab,var(--accent-cyan)_42%,var(--border-default))] shadow-[inset_3px_0_var(--accent-cyan),0_6px_20px_-18px_rgba(20,26,32,0.36)]" : "border-[var(--border-default)] hover:bg-[var(--bg-hover)]"}`}
              data-run-status={tab.run.status}
            >
              {running ? (
                <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 animate-[spectra-tab-sweep_1.8s_ease-in-out_infinite] bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--accent-cyan)_12%,transparent),transparent)] motion-reduce:hidden" />
              ) : null}
              <button
                type="button"
                onClick={() => {
                  const next = active
                    ? null
                    : {
                        id: tab.threadId,
                        title: tab.thread.title,
                        runId: tab.runId,
                        workspaceId: tab.workspaceId,
                      };
                  setContinuation(next);
                  void postSpectra({
                    action: "selectRunTab",
                    runId: next?.runId,
                  }).then(refresh);
                  onOpen?.(tab.runId, tab.threadId, tab.thread.title);
                }}
                className="relative flex min-w-0 flex-1 items-center gap-2.5 px-3 text-left"
                aria-pressed={active}
                title={
                  active
                    ? `Deselect ${tab.thread.title}; the next message will start a new thread`
                    : `Open and continue ${tab.thread.title}`
                }
              >
                <Icon
                  className={`h-3.5 w-3.5 shrink-0 ${running ? "animate-spin text-[var(--accent-cyan)]" : approval || cancelled || needsAnswer ? "text-[var(--warning)]" : failed ? "text-[var(--danger)]" : "text-[var(--success)]"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold text-[var(--text-primary)]">
                    {tab.thread.title || "New thread"}
                  </span>
                  <span className="block truncate text-[9px] capitalize text-[var(--text-tertiary)]">
                    {active ? "Continuing · " : running ? "Live · " : ""}
                    {publicPhase}
                  </span>
                </span>
                <MessageSquare
                  className={`h-3.5 w-3.5 shrink-0 ${active ? "text-[var(--accent-cyan)]" : "text-[var(--text-tertiary)]"}`}
                />
              </button>
              {running && onStop ? (
                <button
                  type="button"
                  disabled={stopping}
                  onClick={() => {
                    setStoppingRunIds((current) =>
                      new Set(current).add(tab.runId),
                    );
                    void Promise.resolve(onStop(tab.runId)).finally(() =>
                      setStoppingRunIds((current) => {
                        const next = new Set(current);
                        next.delete(tab.runId);
                        return next;
                      }),
                    );
                  }}
                  className="flex h-9 w-9 items-center justify-center text-[var(--danger)] opacity-70 hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] hover:opacity-100 focus-visible:opacity-100 disabled:cursor-wait disabled:opacity-45"
                  aria-label={
                    stopping
                      ? `Stopping ${tab.thread.title}`
                      : `Stop ${tab.thread.title}`
                  }
                >
                  {stopping ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Square className="h-3 w-3" />
                  )}
                </button>
              ) : null}
              {(failed || cancelled) && onRetry ? (
                <button
                  type="button"
                  onClick={() => onRetry(tab.runId)}
                  className="flex h-9 w-9 items-center justify-center text-[var(--danger)] opacity-70 hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Retry ${tab.thread.title}`}
                  title="Retry run"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (active) setContinuation(null);
                  void postSpectra({
                    action: "hideRunTab",
                    runId: tab.runId,
                  }).then(refresh);
                }}
                className="flex h-9 w-9 items-center justify-center text-[var(--text-tertiary)] opacity-60 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Close ${tab.thread.title} tab`}
              >
                <X className="h-3 w-3" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
    </div>
  );
}
