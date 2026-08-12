"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  FileText,
  Loader2,
  MessageSquare,
  PauseCircle,
  RotateCcw,
  ShieldCheck,
  Square,
  Unplug,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNow } from "@/hooks/use-now";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { PrismRunMark } from "@/components/spectra-prism-optic";
import { SurfaceField, type FieldInfluence } from "../field/surface-field";
import { targetAttrs } from "../collaboration/target-attributes";
import type { ResultCardStreamView } from "../ai/stream-events";
import type { CommandAttachment } from "./command-bar";
import {
  getSpectraRunTabs,
  invalidateSpectraRunTabsCache,
  postSpectra,
  type SpectraRunTab,
} from "../data/api";
import {
  allocateLiveDockWidths,
  closePreservesRunningJob,
  deriveLiveDockTab,
  selectExpandedInputRun,
  type LiveDockTabSource,
  type LiveDockTruthState,
} from "../runs/live-dock";
import { CrossfadeText, transitionFor, useSpectraMotion } from "../motion";
import { useStreamingReveal } from "../runs/streaming/use-streaming-reveal";

const activeStatuses = new Set([
  "queued",
  "running",
  "awaiting_confirmation",
  "awaiting_resolution",
]);

let sharedTabs: SpectraRunTab[] = [];
let sharedRefresh: Promise<void> | null = null;
let pollTimer: number | null = null;
let pollConsumers = 0;
const listeners = new Set<(tabs: SpectraRunTab[]) => void>();

function refreshRunTabs(force = false) {
  if (sharedRefresh && !force) return sharedRefresh;
  if (force) {
    invalidateSpectraRunTabsCache();
    sharedRefresh = null;
  }
  const pending = getSpectraRunTabs({ limit: 120, force })
    .then((result) => {
      sharedTabs = result.runTabs;
      listeners.forEach((listener) => listener(sharedTabs));
    })
    .catch(() => undefined)
    .finally(() => {
      if (sharedRefresh === pending) sharedRefresh = null;
    });
  sharedRefresh = pending;
  return pending;
}

function beginPolling() {
  pollConsumers += 1;
  if (pollTimer === null)
    pollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshRunTabs();
    }, 4000);
  return () => {
    pollConsumers = Math.max(0, pollConsumers - 1);
    if (pollConsumers === 0 && pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

function tabSource(tab: SpectraRunTab): LiveDockTabSource {
  return {
    runId: tab.runId,
    threadId: tab.threadId,
    threadTitle: tab.thread.title,
    run: tab.run,
    card: tab.card,
    checkpointSummary: tab.checkpointSummary,
    recentSteps: tab.recentSteps,
    inputRequest: tab.inputRequest,
  };
}

function streamCard(tab: SpectraRunTab): ResultCardStreamView | null {
  if (!tab.card) return null;
  return {
    id: tab.card._id,
    runId: tab.card.runId,
    status: tab.card.status,
    title: tab.card.title,
    summary: tab.card.summary,
    variant: tab.card.variant,
    actions: tab.card.actions,
    provenance: tab.card.provenance,
    updatedAt: tab.card.updatedAt,
  };
}

const stateCopy: Record<LiveDockTruthState, string> = {
  working: "Working",
  waiting: "Waiting",
  needs_input: "Needs input",
  completing: "Checking",
  completed: "Completed",
  completed_limited: "Completed with limits",
  paused: "Paused",
  reconnecting: "Reconnecting",
  cancelled: "Cancelled",
  failed_terminal: "Could not complete",
};

function StateIcon({ state }: { state: LiveDockTruthState }) {
  const className = "h-3.5 w-3.5 shrink-0";
  /* Working and checking are the run's own optical state, so they use the
     product prism: the same silhouette the landing's real glass docks into. */
  if (state === "working")
    return <PrismRunMark size={14} optics="working" />;
  if (state === "completing")
    return <PrismRunMark size={14} optics="working" />;
  if (state === "needs_input")
    return <CircleHelp className={`${className} text-[var(--warning)]`} />;
  if (state === "waiting") return <PrismRunMark size={14} optics="waiting" />;
  if (state === "reconnecting")
    return <Unplug className={`${className} text-[var(--warning)]`} />;
  if (state === "paused")
    return <PauseCircle className={`${className} text-[var(--danger)]`} />;
  if (state === "failed_terminal")
    return <AlertCircle className={`${className} text-[var(--danger)]`} />;
  if (state === "cancelled")
    return <Square className={`${className} text-[var(--text-tertiary)]`} />;
  return <CheckCircle2 className={`${className} text-[var(--success)]`} />;
}

/**
 * State icons crossfade on transition (completion grammar) so a run resolving
 * from working → completed feels like a material state change, not a swap.
 */
function AnimatedStateIcon({ state }: { state: LiveDockTruthState }) {
  const motionLevel = useSpectraMotion();
  if (motionLevel.disabled) return <StateIcon state={state} />;
  return (
    <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <AnimatePresence initial={false} mode="sync">
        <motion.span
          key={state}
          className="absolute inset-0 inline-flex items-center justify-center"
          initial={{ opacity: 0, scale: motionLevel.reduced ? 1 : 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: motionLevel.reduced ? 1 : 0.7 }}
          transition={transitionFor("completion", motionLevel.level)}
        >
          <StateIcon state={state} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * Run title with one-time controlled reveal (Run-010 / POLISH-004). Titles
 * that were already established before this render cycle render complete;
 * only freshly generated titles stream left-to-right.
 */
function DockTitle({
  runId,
  title,
  pending,
}: {
  runId: string;
  title: string;
  pending: boolean;
}) {
  const [revealComplete, setRevealComplete] = useState(false);
  const revealStarted = useRef(false);
  const shouldReveal = !pending && !revealComplete;
  const { visibleText, active } = useStreamingReveal(title, {
    profile: "dock",
    enabled: shouldReveal,
  });
  useEffect(() => {
    if (active) revealStarted.current = true;
    if (
      revealStarted.current &&
      !active &&
      visibleText === title &&
      !revealComplete
    )
      setRevealComplete(true);
  }, [active, revealComplete, title, visibleText]);
  return (
    <span
      data-title-run={runId}
      data-title-streaming={active || undefined}
      className={`min-w-0 truncate text-caption font-semibold ${active ? "spectra-title-reveal" : ""} ${pending ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)]"}`}
    >
      {shouldReveal ? visibleText || " " : title}
    </span>
  );
}

function attachmentFromFile(file: File) {
  return new Promise<CommandAttachment>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const extension = file.name.split(".").at(-1)?.toLowerCase();
      const handling: CommandAttachment["handling"] = file.type.startsWith(
        "image/",
      )
        ? "image"
        : extension === "pdf"
          ? "pdf"
          : extension === "docx"
            ? "docx"
            : extension === "xlsx"
              ? "xlsx"
              : extension === "pptx"
                ? "pptx"
                : "text";
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        handling,
        data: String(reader.result ?? ""),
      });
    };
    if (
      file.type.startsWith("text/") ||
      /\.(md|txt|csv|json)$/i.test(file.name)
    )
      reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

export type LiveDockProps = {
  workspaceId?: string;
  optimistic?: {
    id: string;
    prompt: string;
    runId?: string;
    status: string;
    steps?: Array<{ title: string; status: string }>;
  } | null;
  onOpen?: (
    runId: string,
    threadId: string,
    title: string,
    workId?: string,
  ) => void;
  onDeselect?: () => void;
  onStop?: (runId: string) => void | Promise<void>;
  onRetry?: (runId: string) => void;
  onAction?: (
    card: ResultCardStreamView,
    action: "confirm" | "cancel",
  ) => void | Promise<void>;
  onRevise?: (
    card: ResultCardStreamView,
    revision: string,
  ) => void | Promise<void>;
  onInput?: (
    threadId: string,
    response: string,
    attachments?: CommandAttachment[],
  ) => void | Promise<unknown>;
  onSteer?: (
    runId: string,
    mode:
      | "refine_current_goal"
      | "redirect_next_step"
      | "replace_goal"
      | "cancel_current_action",
    text: string,
  ) => void | Promise<unknown>;
  openThreadId?: string;
  /**
   * Deterministic tabs for story mode (the landing page).
   *
   * When provided the dock renders exactly these runs and performs no fetching,
   * polling or mutation. Markup, styling, animation and semantics stay
   * identical: this is the same component, reading a different truth.
   */
  storyTabs?: SpectraRunTab[];
};

/** How a run's truth state reads in the surface field beneath its tab. */
const FIELD_STATE_FOR_RUN: Partial<
  Record<LiveDockTruthState, FieldInfluence["state"]>
> = {
  working: "typing",
  completing: "typing",
  waiting: "waiting",
  needs_input: "waiting",
  reconnecting: "waiting",
  completed: "success",
  completed_limited: "success",
  failed_terminal: "failure",
};

/**
 * The field under one run tab.
 *
 * A dock tab is a bounded surface like any other, so it carries the same
 * ambient field. The influence sits low and right, where the run's work is
 * conceptually accumulating, and takes the state's own colour rather than a
 * decorative one.
 */
function DockTabField({ state }: { state: LiveDockTruthState }) {
  const influences = useMemo<FieldInfluence[]>(() => {
    const fieldState = FIELD_STATE_FOR_RUN[state];
    if (!fieldState) return [];
    const hue =
      fieldState === "success"
        ? "var(--success)"
        : fieldState === "failure"
          ? "var(--danger)"
          : fieldState === "waiting"
            ? "var(--warning)"
            : "var(--accent-cyan)";
    return [
      {
        id: state,
        x: 0.28,
        y: 0.62,
        radius: 0.72,
        strength: fieldState === "typing" ? 0.85 : 0.6,
        hue,
        state: fieldState,
      },
    ];
  }, [state]);
  return <SurfaceField influences={influences} scale="panel" grain="wave" />;
}

export function LiveDock({
  workspaceId,
  optimistic,
  onOpen,
  onDeselect,
  onStop,
  onRetry,
  onAction,
  onRevise,
  onInput,
  onSteer,
  openThreadId,
  storyTabs,
}: LiveDockProps) {
  const [fetchedTabs, setFetchedTabs] = useState(sharedTabs);
  /* Story mode is a state source, not a second dock. */
  const story = storyTabs !== undefined;
  const tabs = storyTabs ?? fetchedTabs;
  const [disclosedRunId, setDisclosedRunId] = useState<string | null>(null);
  const [expandedInputRunId, setExpandedInputRunId] = useState<string | null>(
    null,
  );
  const [collapsedInputRuns, setCollapsedInputRuns] = useState<Set<string>>(
    new Set(),
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revisionRunId, setRevisionRunId] = useState<string | null>(null);
  const [revision, setRevision] = useState("");
  const [steeringRunId, setSteeringRunId] = useState<string | null>(null);
  const [steerText, setSteerText] = useState("");
  const [steerFeedback, setSteerFeedback] = useState<Record<string, string>>(
    {},
  );
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const now = useNow(60_000);
  const motionLevel = useSpectraMotion();
  /* Titles that have already been established (and revealed) — a run title
     must only stream once, on first arrival (RUN-010). */
  const continuation = useSpectraContextStore((state) => state.continuation);
  const setContinuation = useSpectraContextStore(
    (state) => state.setContinuation,
  );
  const refresh = useCallback(
    (force = false) => (story ? Promise.resolve() : refreshRunTabs(force)),
    [story],
  );

  useEffect(() => {
    if (story) return;
    listeners.add(setFetchedTabs);
    void refresh();
    const changed = () => void refresh(true);
    window.addEventListener("spectra:threads-changed", changed);
    return () => {
      listeners.delete(setFetchedTabs);
      window.removeEventListener("spectra:threads-changed", changed);
    };
  }, [refresh, story]);

  useEffect(() => {
    if (
      story ||
      !optimistic ||
      !["starting", "streaming"].includes(optimistic.status)
    )
      return;
    void refresh(true);
    const timer = window.setInterval(() => void refresh(true), 900);
    return () => window.clearInterval(timer);
  }, [optimistic, optimistic?.runId, optimistic?.status, refresh, story]);

  const visible = useMemo(() => {
    /* Story mode shows exactly the runs the story declares, in the order it
       declares them: recency filtering would quietly drop fixture tabs. */
    if (story) return tabs;
    return tabs
      .filter(
        (tab) =>
          !workspaceId || tab.workspaceId === workspaceId || !tab.workspaceId,
      )
      .filter((tab) => {
        if (activeStatuses.has(tab.run.status)) return true;
        if (continuation?.id === tab.threadId || openThreadId === tab.threadId)
          return true;
        return now - tab.run.updatedAt < 30 * 60_000;
      })
      .filter(
        (tab, index, all) =>
          all.findIndex((candidate) => candidate.runId === tab.runId) === index,
      )
      .sort((a, b) => {
        const aPinned =
          continuation?.id === a.threadId || openThreadId === a.threadId;
        const bPinned =
          continuation?.id === b.threadId || openThreadId === b.threadId;
        return aPinned === bPinned
          ? b.updatedAt - a.updatedAt
          : bPinned
            ? 1
            : -1;
      });
  }, [continuation?.id, now, openThreadId, story, tabs, workspaceId]);

  const sources = useMemo(() => visible.map(tabSource), [visible]);
  const expandableSources = useMemo(
    () => sources.filter((source) => !collapsedInputRuns.has(source.runId)),
    [collapsedInputRuns, sources],
  );
  const selectedInputRunId = selectExpandedInputRun(
    expandableSources,
    expandedInputRunId,
  );
  useEffect(
    () => setExpandedInputRunId(selectedInputRunId),
    [selectedInputRunId],
  );
  const layouts = useMemo(
    () =>
      new Map(
        allocateLiveDockWidths(sources, selectedInputRunId).map((layout) => [
          layout.runId,
          layout,
        ]),
      ),
    [selectedInputRunId, sources],
  );

  const hasActive = visible.some((tab) => activeStatuses.has(tab.run.status));
  useEffect(
    () => (hasActive && !story ? beginPolling() : undefined),
    [hasActive, story],
  );

  const durableHasOptimistic = Boolean(
    optimistic?.runId && visible.some((tab) => tab.runId === optimistic.runId),
  );
  const showOptimistic = Boolean(
    optimistic &&
    ["starting", "streaming"].includes(optimistic.status) &&
    !durableHasOptimistic,
  );
  if (!showOptimistic && visible.length === 0) return null;

  async function selectTab(tab: SpectraRunTab) {
    if (story) {
      /* The story owns navigation. Opening is still a real call the host can
         answer; it simply never mutates a run that does not exist. */
      onOpen?.(
        tab.runId,
        tab.threadId,
        tab.thread.title,
        tab.run.artifactId ?? tab.card?.provenance?.artifactIds?.[0],
      );
      return;
    }
    setContinuation({
      id: tab.threadId,
      title: tab.thread.title,
      runId: tab.runId,
      workspaceId: tab.workspaceId,
    });
    void postSpectra({ action: "selectRunTab", runId: tab.runId }).then(() =>
      refresh(),
    );
    onOpen?.(
      tab.runId,
      tab.threadId,
      tab.thread.title,
      tab.run.artifactId ?? tab.card?.provenance?.artifactIds?.[0],
    );
  }

  async function hideTab(tab: SpectraRunTab) {
    /* Story runs are required by later scenes, so closing one is refused the
       same way the product refuses to destroy required work. */
    if (story) return;
    await postSpectra({ action: "hideRunTab", runId: tab.runId });
    if (continuation?.id === tab.threadId) {
      setContinuation(null);
      onDeselect?.();
    }
    await refresh(true);
  }

  return (
    <section
      className="mb-2 w-full"
      aria-label="Live Dock"
      data-live-dock-version="2"
    >
      <div
        className="spectra-run-tab-strip flex w-full items-start gap-1.5 overflow-x-auto overflow-y-visible px-0.5 pb-1 pt-0.5 [scrollbar-width:thin] max-sm:snap-x"
        aria-live="polite"
      >
        {showOptimistic ? (
          <article
            className="flex h-12 min-w-[224px] basis-[260px] items-center gap-2 rounded-[9px] border border-[color-mix(in_oklab,var(--accent-cyan)_28%,var(--border-default))] bg-[var(--bg-elevated)] px-3 shadow-[inset_3px_0_var(--accent-cyan)]"
            data-run-status="starting"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)] motion-reduce:animate-none" />
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold text-[var(--text-primary)]">
                Starting run
              </span>
              <span className="block truncate text-micro text-[var(--text-tertiary)]">
                {optimistic?.steps?.at(-1)?.title || "Preparing your context"}
              </span>
            </span>
          </article>
        ) : null}

        <AnimatePresence initial={false}>
          {visible.map((tab) => {
            const source = tabSource(tab);
            const model = deriveLiveDockTab(source);
            const layout = layouts.get(tab.runId);
            const expanded = selectedInputRunId === tab.runId;
            const disclosed = disclosedRunId === tab.runId;
            const active = continuation?.id === tab.threadId;
            const card = streamCard(tab);
            const canRetry =
              (model.state === "paused" || model.state === "cancelled") &&
              tab.run.retryable;
            const isSteerable =
              model.state === "working" ||
              model.state === "waiting" ||
              model.state === "completing";
            /* A title reveals exactly once: re-renders with the same title
               render it complete (RUN-010). */
            return (
              <motion.article
                layout
                key={tab.runId}
                className={`group relative max-w-full shrink-0 snap-start overflow-visible rounded-[9px] border bg-[var(--bg-elevated)] shadow-[0_7px_22px_-20px_rgba(20,26,32,.5)] ${active ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] shadow-[inset_3px_0_var(--accent-cyan)]" : "border-[var(--border-default)]"} ${expanded ? "max-sm:fixed max-sm:inset-x-3 max-sm:bottom-3 max-sm:z-50 max-sm:max-h-[70dvh] max-sm:overflow-y-auto max-sm:shadow-[0_24px_80px_rgba(0,0,0,.32)]" : ""}`}
                style={{ width: layout?.preferredWidth }}
                initial={
                  motionLevel.disabled
                    ? false
                    : { opacity: 0, y: 6, scale: 0.98 }
                }
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  ...(layout?.minWidth !== undefined
                    ? { minWidth: layout.minWidth }
                    : {}),
                }}
                exit={{
                  opacity: 0,
                  scale: 0.96,
                  transition: transitionFor("completion", motionLevel.level),
                }}
                transition={transitionFor("morph", motionLevel.level)}
                data-run-status={model.state}
                data-input-expanded={expanded || undefined}
                data-mobile-sheet={expanded || undefined}
                {...targetAttrs(`live-dock/tab/${tab.runId}`)}
              >
                <DockTabField state={model.state} />
                <div className="relative flex h-12 min-w-0 items-center gap-1 pl-3 pr-1">
                  <AnimatedStateIcon state={model.state} />
                  <button
                    type="button"
                    onClick={() => void selectTab(tab)}
                    className="min-w-0 flex-1 py-1 text-left"
                    title={`Open ${model.title}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <DockTitle
                        runId={tab.runId}
                        title={model.title}
                        pending={model.titlePending}
                      />
                      {model.attachmentNames.length ? (
                        <span
                          className="inline-flex shrink-0 items-center gap-0.5 text-micro text-[var(--text-tertiary)]"
                          title={`${model.attachmentNames.length} attachment${model.attachmentNames.length === 1 ? "" : "s"}`}
                        >
                          <FileText className="h-2.5 w-2.5" />
                          {model.attachmentNames.length}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex min-w-0 items-baseline text-micro text-[var(--text-tertiary)]">
                      <span className="shrink-0 font-medium text-[var(--text-secondary)]">
                        <CrossfadeText value={stateCopy[model.state]} />
                      </span>
                      <span aria-hidden="true" className="shrink-0">
                        {" "}
                        ·{" "}
                      </span>
                      <span className="min-w-0 truncate">
                        <CrossfadeText value={model.semanticStep} />
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDisclosedRunId((current) =>
                        current === tab.runId ? null : tab.runId,
                      )
                    }
                    className="flex h-8 w-7 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    aria-expanded={disclosed}
                    aria-label={`Show details for ${model.title}`}
                  >
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${disclosed ? "rotate-180" : ""}`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => void hideTab(tab)}
                    className="flex h-8 w-7 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
                    aria-label={`Close ${model.title}`}
                    title={
                      closePreservesRunningJob(source)
                        ? "Close tab — the run keeps working"
                        : "Close tab"
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                {!expanded ? (
                  <div
                    className={`${disclosed ? "block" : "hidden group-hover:block group-focus-within:block"} absolute bottom-[calc(100%+6px)] left-0 z-30 w-[min(320px,calc(100vw-24px))] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[0_16px_45px_-18px_rgba(20,26,32,.45)]`}
                    role="status"
                  >
                    <p className="line-clamp-4 text-[11px] leading-[1.55] text-[var(--text-secondary)]">
                      {model.hoverSummary}
                    </p>
                    {model.recentSteps.length ? (
                      <ul className="mt-2 space-y-0.5 text-micro text-[var(--text-tertiary)]">
                        {model.recentSteps.map((step) => (
                          <li key={step} className="truncate">
                            ✓ {step}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-micro text-[var(--text-tertiary)]">
                      {model.targetNames.length ? (
                        <span>{model.targetNames.slice(0, 2).join(" · ")}</span>
                      ) : null}
                      {model.attachmentNames.length ? (
                        <span>{model.attachmentNames.length} attached</span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--border-subtle)] pt-2">
                      <button
                        type="button"
                        onClick={() => void selectTab(tab)}
                        className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-micro font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                      >
                        <MessageSquare className="h-3 w-3" /> Open conversation
                      </button>
                      {isSteerable && onSteer ? (
                        <button
                          type="button"
                          onClick={() =>
                            setSteeringRunId((current) =>
                              current === tab.runId ? null : tab.runId,
                            )
                          }
                          className="h-7 rounded-[6px] px-2 text-micro font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                          Steer
                        </button>
                      ) : null}
                      {canRetry ? (
                        <button
                          type="button"
                          onClick={() => onRetry?.(tab.runId)}
                          className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-micro font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                          <RotateCcw className="h-3 w-3" /> Retry
                        </button>
                      ) : null}
                      {activeStatuses.has(tab.run.status) && onStop ? (
                        <button
                          type="button"
                          disabled={stopping.has(tab.runId)}
                          onClick={async () => {
                            setStopping((current) =>
                              new Set(current).add(tab.runId),
                            );
                            try {
                              await onStop(tab.runId);
                            } finally {
                              setStopping((current) => {
                                const next = new Set(current);
                                next.delete(tab.runId);
                                return next;
                              });
                            }
                          }}
                          className="ml-auto inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-micro font-semibold text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]"
                        >
                          <Square className="h-3 w-3" /> Stop
                        </button>
                      ) : null}
                    </div>
                    {steeringRunId === tab.runId && onSteer ? (
                      <div className="mt-2 flex gap-1.5">
                        <input
                          autoFocus
                          value={steerText}
                          onChange={(event) => setSteerText(event.target.value)}
                          placeholder="Refine the current goal…"
                          className="h-8 min-w-0 flex-1 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-micro outline-none focus:border-[var(--accent-cyan)]"
                        />
                        <button
                          type="button"
                          disabled={!steerText.trim()}
                          onClick={async () => {
                            const text = steerText.trim();
                            if (!text) return;
                            await onSteer(
                              tab.runId,
                              "refine_current_goal",
                              text,
                            );
                            setSteerText("");
                            setSteerFeedback((current) => ({
                              ...current,
                              [tab.runId]: "Will apply after the current step",
                            }));
                          }}
                          className="h-8 rounded-[6px] bg-[var(--text-primary)] px-2 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-40"
                        >
                          Queue
                        </button>
                      </div>
                    ) : null}
                    {steerFeedback[tab.runId] ? (
                      <p className="mt-1.5 text-micro text-[var(--accent-cyan)]">
                        {steerFeedback[tab.runId]}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {expanded ? (
                  <motion.div
                    className="overflow-hidden border-t border-[var(--border-subtle)]"
                    initial={
                      motionLevel.disabled ? false : { height: 0, opacity: 0 }
                    }
                    animate={{ height: "auto", opacity: 1 }}
                    exit={
                      motionLevel.disabled
                        ? undefined
                        : { height: 0, opacity: 0 }
                    }
                    transition={transitionFor("morph", motionLevel.level)}
                  >
                    <div
                      className="px-3 pb-3 pt-2"
                      aria-label={`${model.title} requires input`}
                    >
                      <div className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
                        <p className="line-clamp-3 text-[11px] leading-4 text-[var(--text-secondary)]">
                          {model.inputRequest?.prompt}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setCollapsedInputRuns((current) =>
                              new Set(current).add(tab.runId),
                            );
                            setExpandedInputRunId(null);
                          }}
                          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                          aria-label="Collapse required input"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </div>
                      {model.inputRequest?.kind === "choice" ? (
                        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                          {model.inputRequest.options.map((option) => (
                            <button
                              key={option.title}
                              type="button"
                              onClick={() => {
                                setCollapsedInputRuns((current) =>
                                  new Set(current).add(tab.runId),
                                );
                                void onInput?.(tab.threadId, option.title);
                              }}
                              className="rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-2 text-left hover:border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))]"
                            >
                              <span className="block text-micro font-semibold text-[var(--text-primary)]">
                                {option.title}
                              </span>
                              {option.description ? (
                                <span className="mt-0.5 block line-clamp-2 text-micro leading-3.5 text-[var(--text-tertiary)]">
                                  {option.description}
                                </span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      ) : model.inputRequest?.kind === "short_answer" ? (
                        <div className="mt-2 flex gap-1.5">
                          <input
                            value={answers[tab.runId] ?? ""}
                            onChange={(event) =>
                              setAnswers((current) => ({
                                ...current,
                                [tab.runId]: event.target.value,
                              }))
                            }
                            placeholder="Your answer…"
                            className="h-8 min-w-0 flex-1 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-micro outline-none focus:border-[var(--accent-cyan)]"
                          />
                          <button
                            type="button"
                            disabled={!answers[tab.runId]?.trim()}
                            onClick={() => {
                              const answer = answers[tab.runId]?.trim();
                              if (!answer) return;
                              setCollapsedInputRuns((current) =>
                                new Set(current).add(tab.runId),
                              );
                              void onInput?.(tab.threadId, answer);
                            }}
                            className="h-8 rounded-[6px] bg-[var(--text-primary)] px-2.5 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-40"
                          >
                            Continue
                          </button>
                        </div>
                      ) : model.inputRequest?.kind === "file" ? (
                        <label className="mt-2 flex min-h-10 cursor-pointer items-center justify-center rounded-[7px] border border-dashed border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-micro font-semibold text-[var(--text-secondary)] hover:border-[var(--accent-cyan)]">
                          <FileText className="mr-1.5 h-3.5 w-3.5" /> Attach the
                          requested file
                          <input
                            type="file"
                            accept={model.inputRequest.accept}
                            className="sr-only"
                            onChange={async (event) => {
                              const file = event.target.files?.[0];
                              if (!file) return;
                              const attachment = await attachmentFromFile(file);
                              setCollapsedInputRuns((current) =>
                                new Set(current).add(tab.runId),
                              );
                              await onInput?.(
                                tab.threadId,
                                `Attached ${file.name}.`,
                                [attachment],
                              );
                            }}
                          />
                        </label>
                      ) : card ? (
                        <>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => void onAction?.(card, "confirm")}
                              className="h-8 rounded-[7px] bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)]"
                            >
                              Apply changes
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setRevisionRunId((current) =>
                                  current === tab.runId ? null : tab.runId,
                                )
                              }
                              className="h-8 rounded-[7px] px-2.5 text-micro font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                            >
                              Ask for changes
                            </button>
                            <button
                              type="button"
                              onClick={() => void onAction?.(card, "cancel")}
                              className="h-8 rounded-[7px] px-2.5 text-micro font-semibold text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]"
                            >
                              Reject
                            </button>
                          </div>
                          {revisionRunId === tab.runId ? (
                            <div className="mt-2 flex gap-1.5">
                              <input
                                autoFocus
                                value={revision}
                                onChange={(event) =>
                                  setRevision(event.target.value)
                                }
                                placeholder="What should change?"
                                className="h-8 min-w-0 flex-1 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-micro outline-none focus:border-[var(--accent-cyan)]"
                              />
                              <button
                                type="button"
                                disabled={!revision.trim()}
                                onClick={() => {
                                  if (!card || !revision.trim()) return;
                                  void onRevise?.(card, revision.trim());
                                  setRevision("");
                                  setRevisionRunId(null);
                                }}
                                className="h-8 rounded-[6px] bg-[var(--accent-cyan)] px-2.5 text-micro font-semibold text-white disabled:opacity-40"
                              >
                                Revise
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </motion.div>
                ) : null}
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
