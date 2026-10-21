"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CircleHelp, Loader2, MessageSquarePlus, SquareArrowOutUpRight, RotateCcw, ShieldCheck, Square, AlertCircle, CheckCircle2, ChevronDown, FileText, X, PauseCircle, Undo2, Unplug, Crosshair } from "@/components/icons/glyph-icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useNow } from "@/hooks/use-now";
import { toast } from "@/components/ui/toast";
import { buttonVariants } from "@/components/ui/button";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { OverflowMenu } from "@/components/ui/dropdown-menu";
import { LAYER_CLASS } from "@/components/ui/layers";
import { PrismRunMark } from "@/components/spectra-prism-optic";
import { SurfaceField, type FieldInfluence } from "../field/surface-field";
import { spectraBus } from "../events";
import { useSpectraPreferences } from "../settings/preference-store";
import { targetAttrs } from "../collaboration/target-attributes";
import { confirmationDiffSummary } from "../ai/authority-execution";
import type { ResultCardStreamView } from "../ai/stream-events";
import type { SpectraLiveExchange } from "../ai/use-spectra-run";
import type { CommandAttachment } from "./command-bar";
import { ProgressTrace } from "./progress-trace";
import { postSpectra, type SpectraRunTab } from "../data/api";
import {
  beginRunTabsPolling as beginPolling,
  getRunTabs,
  isActiveRunStatus,
  refreshRunTabs,
  runTabCard as streamCard,
  runTabSource as tabSource,
  subscribeRunTabs,
} from "../island/run-tabs";
import {
  closePreservesRunningJob,
  deriveLiveDockTab,
  liveDockStateCopy,
  selectExpandedInputRun,
    type LiveDockTruthState,
} from "../runs/live-dock";
import { CrossfadeText, transitionFor, useSpectraMotion } from "../motion";
import { useStreamingReveal } from "../runs/streaming/use-streaming-reveal";
import { followAiActor, useFollowAi } from "../collaboration/follow-ai";

function displayChoiceTitle(value: string) {
  const limit = 160;
  if (value.length <= limit) return value;
  const suffixLength = Math.min(40, Math.floor((limit - 1) / 3));
  const prefixLength = limit - 1 - suffixLength;
  return `${value.slice(0, prefixLength)}…${value.slice(-suffixLength)}`;
}


function asDockTraceSteps(
  runId: string,
  steps: Array<{ title: string; status: string }> | undefined,
): SpectraLiveExchange["steps"] {
  return (steps ?? []).map((step, index) => ({
    id: `${runId}:dock-step:${index}`,
    title: step.title,
    status:
      step.status === "error" || step.status === "running"
        ? step.status
        : "done",
    createdAt: 0,
  }));
}

function dockTraceSteps(
  tab: SpectraRunTab,
  optimistic:
    | {
        runId?: string;
        steps?: Array<{ title: string; status: string }>;
      }
    | null
    | undefined,
  cached: SpectraLiveExchange["steps"] | undefined,
): SpectraLiveExchange["steps"] {
  if (optimistic?.runId === tab.runId && (optimistic.steps?.length ?? 0) > 0) {
    return asDockTraceSteps(optimistic.runId, optimistic.steps);
  }
  if (cached && cached.length > 0) return cached;
  return (tab.recentSteps ?? []).map((title, index) => ({
    id: `${tab.runId}:dock-step:${index}`,
    title,
    summary: title,
    status: "done" as const,
    createdAt: 0,
  }));
}

function StateIcon({ state }: { state: LiveDockTruthState }) {
  const className = "h-3.5 w-3.5 shrink-0";
  /* Working and checking are the run's own optical state, so they use the
     product prism: the same silhouette the landing's real glass docks into. */
  if (state === "working") return <PrismRunMark size={14} optics="working" />;
  if (state === "completing")
    return <PrismRunMark size={14} optics="working" />;
  if (state === "needs_input")
    return <CircleHelp className={`${className} text-[var(--warning)]`} />;
  if (state === "waiting") return <PrismRunMark size={14} optics="waiting" />;
  if (state === "reconnecting")
    return <Unplug className={`${className} text-[var(--warning)]`} />;
  if (state === "paused")
    return <PauseCircle className={`${className} text-[var(--warning)]`} />;
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
    threadId?: string;
    status: string;
    steps?: Array<{ title: string; status: string }>;
  } | null;
  onOpen?: (
    runId: string,
    threadId: string,
    title: string,
    workId?: string,
  ) => void;
  onContinue?: (
    runId: string,
    threadId: string,
    title: string,
    workId?: string,
  ) => void;
  onDeselect?: () => void;
  onStartNewThread?: () => void;
  onStop?: (runId: string) => void | Promise<void>;
  onRetry?: (runId: string) => void;
  onAction?: (
    card: ResultCardStreamView,
    action: "confirm" | "cancel" | "revert",
  ) => void | Promise<void>;
  onRevise?: (
    card: ResultCardStreamView,
    revision: string,
  ) => void | Promise<void>;
  onInput?: (
    threadId: string,
    response: string,
    attachments?: CommandAttachment[],
    continuation?: { clarificationId?: string; choiceKey?: string; choiceMessageId?: string; executionId?: string; batchSelections?: Array<{ questionId: string; choiceKey: string; choiceTitle: string }> },
  ) => void | Promise<unknown>;
  openThreadId?: string;
  openChat?: { id: string; title: string };
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
  onContinue,
  onDeselect,
  onStartNewThread,
  onStop,
  onRetry,
  onAction,
  onRevise,
  onInput,
  openThreadId,
  openChat,
  storyTabs,
}: LiveDockProps) {
  const [fetchedTabs, setFetchedTabs] = useState(getRunTabs);
  /* Story mode is a state source, not a second dock. */
  const story = storyTabs !== undefined;
  const tabs = storyTabs ?? fetchedTabs;
  const [expandedInputRunId, setExpandedInputRunId] = useState<string | null>(
    null,
  );
  const [collapsedInputRuns, setCollapsedInputRuns] = useState<Set<string>>(
    new Set(),
  );
  const [respondingInputRuns, setRespondingInputRuns] = useState<Set<string>>(
    new Set(),
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [batchAnswers, setBatchAnswers] = useState<
    Record<string, Record<string, string>>
  >({});
  const [revisionRunId, setRevisionRunId] = useState<string | null>(null);
  const [revision, setRevision] = useState("");
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const now = useNow(60_000);
  const { preferences } = useSpectraPreferences();
  const motionLevel = useSpectraMotion();
  const follow = useFollowAi();
  const [hoveredRunId, setHoveredRunId] = useState<string | null>(null);
  const hoverCloseTimer = useRef<number | null>(null);
  const traceCacheRef = useRef<Map<string, SpectraLiveExchange["steps"]>>(
    new Map(),
  );
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
    const unsubscribe = subscribeRunTabs(setFetchedTabs);
    void refresh();
    const changed = () => void refresh(true);
    const runChanged = () => void refresh();
    const removeChanged = spectraBus.on("threads.changed", changed);
    const removeRunChanged = spectraBus.on("run.changed", runChanged);
    return () => {
      unsubscribe();
      removeChanged();
      removeRunChanged();
    };
  }, [refresh, story]);

  const optimisticPollingKey = !story && optimistic && ["starting", "streaming"].includes(optimistic.status)
    ? `optimistic:${optimistic.runId ?? optimistic.threadId ?? "pending"}:${optimistic.status}`
    : null;
  useEffect(() => {
    if (!optimisticPollingKey) return;
    return beginPolling(optimisticPollingKey);
  }, [optimisticPollingKey]);

  useEffect(() => {
    if (!optimistic?.runId || !(optimistic.steps?.length ?? 0)) return;
    traceCacheRef.current.set(
      optimistic.runId,
      asDockTraceSteps(optimistic.runId, optimistic.steps),
    );
  }, [optimistic?.runId, optimistic?.steps]);

  const openTabHover = useCallback((runId: string) => {
    if (hoverCloseTimer.current) {
      window.clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
    setHoveredRunId(runId);
  }, []);
  const closeTabHover = useCallback(() => {
    if (hoverCloseTimer.current) window.clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = window.setTimeout(() => {
      setHoveredRunId(null);
      hoverCloseTimer.current = null;
    }, 180);
  }, []);
  useEffect(
    () => () => {
      if (hoverCloseTimer.current) window.clearTimeout(hoverCloseTimer.current);
    },
    [],
  );

  const visible = useMemo(() => {
    /* Story mode shows exactly the runs the story declares, in the order it
       declares them: recency filtering would quietly drop fixture tabs. */
    if (story) return tabs;
    return tabs
      .filter((tab) => !respondingInputRuns.has(tab.runId))
      .filter((tab) => {
        if (isActiveRunStatus(tab.run.status)) return true;
        if (continuation?.id === tab.threadId || openThreadId === tab.threadId)
          return true;
        if (!preferences.ai.retainCompletedRunTabs) return false;
        return (
          now - tab.run.updatedAt <
          preferences.ai.completedRunRetentionMinutes * 60_000
        );
      })
      .filter(
        (tab, index, all) =>
          all.findIndex((candidate) => candidate.runId === tab.runId) === index,
      )
      .filter((tab, _index, all) => {
        const sameThread = all.filter(
          (candidate) => candidate.threadId === tab.threadId,
        );
        if (sameThread.length <= 1) return true;
        const preferred =
          sameThread.find((candidate) =>
            isActiveRunStatus(candidate.run.status),
          ) ??
          sameThread.find(
            (candidate) => candidate.runId === continuation?.runId,
          ) ??
          [...sameThread].sort(
            (left, right) => right.run.updatedAt - left.run.updatedAt,
          )[0];
        return preferred?.runId === tab.runId;
      })
      .sort((a, b) => {
        const aSending = isActiveRunStatus(a.run.status);
        const bSending = isActiveRunStatus(b.run.status);
        if (aSending !== bSending) return aSending ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
  }, [
    continuation?.id,
    continuation?.runId,
    now,
    openThreadId,
    preferences.ai.completedRunRetentionMinutes,
    preferences.ai.retainCompletedRunTabs,
    respondingInputRuns,
    story,
    tabs,
  ]);

  const sources = useMemo(() => visible.map(tabSource), [visible]);
  const expandableSources = useMemo(
    () => sources.filter((source) => !collapsedInputRuns.has(source.runId)),
    [collapsedInputRuns, sources],
  );
  const selectedInputRunId = preferences.ai.expandRequiredInput
    ? selectExpandedInputRun(expandableSources, expandedInputRunId)
    : expandedInputRunId &&
        expandableSources.some((source) => source.runId === expandedInputRunId)
      ? expandedInputRunId
      : null;
  useEffect(
    () => setExpandedInputRunId(selectedInputRunId),
    [selectedInputRunId],
  );

  const hasActive = visible.some((tab) => isActiveRunStatus(tab.run.status));
  useEffect(
    () => (hasActive && !story ? beginPolling() : undefined),
    [hasActive, story],
  );

  const durableHasOptimistic = Boolean(
    optimistic &&
    visible.some(
      (tab) =>
        (optimistic.runId && tab.runId === optimistic.runId) ||
        (optimistic.threadId && tab.threadId === optimistic.threadId),
    ),
  );
  const showOptimistic = Boolean(
    optimistic &&
    ["starting", "streaming"].includes(optimistic.status) &&
    !durableHasOptimistic,
  );
  const openedChatAlreadyVisible = Boolean(openChat && visible.some((tab) => tab.threadId === openChat.id));
  // The rail is a collection of actual runs. A standalone new-thread button
  // reads like a second composer action, so an empty dock renders nothing.
  if (!showOptimistic && visible.length === 0 && !openChat) return null;

  function openQuickChat(tab: SpectraRunTab) {
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
    onOpen?.(
      tab.runId,
      tab.threadId,
      tab.thread.title,
      tab.run.artifactId ?? tab.card?.provenance?.artifactIds?.[0],
    );
  }

  function continueThread(tab: SpectraRunTab) {
    if (story) return;
    setContinuation({
      id: tab.threadId,
      title: tab.thread.title,
      runId: tab.runId,
      workspaceId: tab.workspaceId,
    });
    onContinue?.(tab.runId, tab.threadId, tab.thread.title, tab.run.artifactId);
    void postSpectra({ action: "selectRunTab", runId: tab.runId }).then(() =>
      refresh(true),
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

  async function stopTab(runId: string) {
    if (!onStop) return;
    setStopping((current) => new Set(current).add(runId));
    try {
      await onStop(runId);
    } finally {
      setStopping((current) => {
        const next = new Set(current);
        next.delete(runId);
        return next;
      });
    }
  }

  async function respondToInput(
    tab: SpectraRunTab,
    response: string,
    attachments?: CommandAttachment[],
    choiceKeyOverride?: string,
  ) {
    if (!onInput) return;
    const model = deriveLiveDockTab(tabSource(tab));
    const selectedOptionIndex = model.inputRequest?.kind === "choice"
      ? model.inputRequest.options.findIndex((option) => option.title === response)
      : -1;
    const selectedOptionKey = model.inputRequest?.kind === "choice"
      ? choiceKeyOverride ?? model.inputRequest.options[selectedOptionIndex]?.key
      : undefined;
    const batchSelections = model.inputRequest?.kind === "choice_batch"
      ? model.inputRequest.questions.map((question) => {
          const choiceKey = batchAnswers[tab.runId]?.[question.id] ?? "skip";
          const option = question.options.find((candidate) => candidate.key === choiceKey);
          return {
            questionId: question.id,
            choiceKey,
            choiceTitle: option?.title ?? "Skipped",
          };
        })
      : undefined;
    if (
      model.inputRequest?.kind === "choice" &&
      response !== "Skipped" &&
      !selectedOptionKey
    ) {
      toast.error("This clarification is no longer available. Reload the conversation and try again.");
      return;
    }
    setRespondingInputRuns((current) => new Set(current).add(tab.runId));
    setExpandedInputRunId(null);
    try {
      if (
        (model.inputRequest?.kind === "choice" ||
          model.inputRequest?.kind === "choice_batch") &&
        model.inputRequest.messageId
      ) {
        await postSpectra({
            action: "selectMessageChoice",
            messageId: model.inputRequest.messageId,
            ...(model.inputRequest.clarificationId ? { clarificationId: model.inputRequest.clarificationId } : {}),
            ...(model.inputRequest.executionId ?? tab.run.executionId
              ? { executionId: model.inputRequest.executionId ?? tab.run.executionId }
              : {}),
            choiceKey:
              response === "Skipped"
                ? "skip"
                : model.inputRequest.kind === "choice_batch"
                  ? "batch"
                  : selectedOptionKey ?? "",
            choiceTitle: response,
            ...(batchSelections ? { batchSelections } : {}),
        });
      }
      const accepted = await onInput(
        tab.threadId,
        response === "Skipped"
          ? "Skip that question and continue with reasonable defaults."
          : response,
        attachments,
        model.inputRequest &&
        (model.inputRequest.kind === "choice" || model.inputRequest.kind === "choice_batch")
          ? {
              clarificationId: model.inputRequest.clarificationId,
              choiceKey:
                response === "Skipped"
                  ? "skip"
                  : model.inputRequest.kind === "choice_batch"
                    ? "batch"
                : selectedOptionKey,
              choiceMessageId: model.inputRequest.messageId,
              executionId: model.inputRequest.executionId ?? tab.run.executionId,
              ...(batchSelections ? { batchSelections } : {}),
            }
          : undefined,
      );
      if (accepted === false) throw new Error("Input was not accepted");
      setCollapsedInputRuns((current) => new Set(current).add(tab.runId));
      if (!story) {
        await postSpectra({ action: "hideRunTab", runId: tab.runId });
        await refresh(true);
      }
    } catch {
      setRespondingInputRuns((current) => {
        const next = new Set(current);
        next.delete(tab.runId);
        return next;
      });
    }
  }

  return (
    <section
      className="spectra-live-dock-root pointer-events-none mb-1.5 w-full"
      aria-label="Island"
      data-live-dock-version="2"
    >
      <div className="spectra-live-dock-row pointer-events-none grid w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-2">
        {onStartNewThread && (showOptimistic || visible.length > 0) ? (
          <button
            type="button"
            onClick={onStartNewThread}
            className="spectra-live-dock-slot pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-hover hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="Start a new chat"
            title="New chat"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
        ) : null}
        <div
          className="spectra-run-tab-strip pointer-events-none col-start-2 flex min-w-0 w-full items-center gap-1.5 overflow-x-auto overflow-y-visible px-0.5 pb-0.5 pt-0.5 max-sm:snap-x"
          aria-live="polite"
        >
        {showOptimistic ? (
          <article
            className="spectra-live-dock-tab pointer-events-auto flex h-11 flex-1 items-center gap-2 rounded-card border border-[color-mix(in_oklab,var(--accent-cyan)_28%,var(--border-default))] bg-[var(--bg-elevated)] px-3"
            data-run-status="starting"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)] motion-reduce:animate-none" />
            <span className="min-w-0">
              <span className="block truncate text-micro font-semibold text-[var(--text-primary)]">
                Starting run
              </span>
              <span className="block truncate text-micro text-[var(--text-tertiary)]">
                {optimistic?.steps?.at(-1)?.title || "Preparing your context"}
              </span>
            </span>
          </article>
        ) : null}

        {openChat && !openedChatAlreadyVisible ? (
          <article className="spectra-live-dock-tab pointer-events-auto flex h-11 min-w-[220px] flex-1 items-center gap-2 rounded-card border border-[color-mix(in_oklab,var(--brand-primary)_28%,var(--border-default))] bg-[var(--bg-elevated)] px-3" data-open-chat="true">
            <button type="button" className="dock-tab-identity min-w-0 flex-1 py-1 text-left" onClick={() => onOpen?.("", openChat.id, openChat.title)} aria-label={`Open chat for ${openChat.title}`}>
              <span className="block truncate text-caption font-semibold text-[var(--text-primary)]">{openChat.title}</span>
              <span className="block truncate text-micro text-[var(--text-tertiary)]">Chat</span>
            </button>
          </article>
        ) : null}
        <AnimatePresence initial={false}>
          {visible.map((tab) => {
            const source = tabSource(tab);
            const model = deriveLiveDockTab(source);
            const stateLabel = model.undone
              ? "Undone"
              : ["working", "completing", "completed"].includes(model.state)
                ? null
                : liveDockStateCopy[model.state];
            const expanded = selectedInputRunId === tab.runId;
            const disclosureAnchor = `--live-dock-${tab.runId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
            const active = continuation?.id === tab.threadId;
            const card = streamCard(tab);
            const canRetry =
              (model.state === "paused" || model.state === "cancelled") &&
              tab.run.retryable;
            const canUndo = Boolean(
              card?.actions.some((action) => action.key === "revert") &&
              !model.undone,
            );
            const isSteerable =
              model.state === "working" ||
              model.state === "waiting" ||
              model.state === "completing";
            const followingThis =
              follow.following && follow.followedActorId === tab.runId;
              const outsideCurrentWorkspace = Boolean(
                workspaceId &&
                tab.workspaceId &&
                tab.workspaceId !== workspaceId,
              );
              const workspaceLabel =
                tab.card?.provenance?.workspaceTitle ?? "Other workspace";
            const hoverOpen = hoveredRunId === tab.runId;
            const traceSteps = dockTraceSteps(
              tab,
              optimistic,
              traceCacheRef.current.get(tab.runId),
            );
            /* A title reveals exactly once: re-renders with the same title
               render it complete (RUN-010). */
            return (
              <motion.article
                layout
                key={tab.runId}
                className={`spectra-live-dock-tab pointer-events-auto group relative max-w-full snap-start overflow-visible rounded-card border bg-[var(--bg-elevated)] shadow-hover ${active ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))]" : "border-[var(--border-default)]"} ${expanded ? "max-sm:fixed max-sm:inset-x-3 max-sm:bottom-3 max-sm:z-composer-dock max-sm:max-h-[70dvh] max-sm:overflow-y-auto max-sm:shadow-[0_24px_80px_rgba(0,0,0,.32)]" : ""}`}
                data-continued={active || undefined}
                style={
                  {
                    anchorName: disclosureAnchor,
                  } as CSSProperties
                }
                initial={
                  motionLevel.disabled
                    ? false
                    : { opacity: 0, y: 6, scale: 0.98 }
                }
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1,
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
                <div className="relative flex h-11 min-w-0 items-center gap-1 pl-3 pr-1">
                  <AnimatedStateIcon state={model.state} />
                  <button
                    type="button"
                    onClick={() => {
                      // Opening a saved chat is a navigation action. Continuation
                      // remains explicit in the resume button and composer.
                      if (model.state === "needs_input") {
                        setCollapsedInputRuns((current) => {
                          const next = new Set(current);
                          next.delete(tab.runId);
                          return next;
                        });
                        setExpandedInputRunId(tab.runId);
                      }
                    }}
                    className="dock-tab-identity min-w-0 flex-1 py-1 text-left"
                    title={model.title}
                    onPointerEnter={() => openTabHover(tab.runId)}
                    onPointerLeave={closeTabHover}
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
                        {outsideCurrentWorkspace ? (
                          <span
                            className="max-w-24 shrink-0 truncate rounded-control bg-[var(--bg-secondary)] px-1.5 py-0.5 text-micro font-medium text-[var(--text-secondary)]"
                            title={`Running in ${workspaceLabel}`}
                          >
                            {workspaceLabel}
                          </span>
                        ) : null}
                    </span>
                    <span className="flex min-w-0 items-baseline text-micro text-[var(--text-tertiary)]">
                      <span
                        className={`${stateLabel ? "" : "hidden"} shrink-0 font-semibold text-[var(--text-secondary)]`}
                      >
                        <CrossfadeText value={stateLabel ?? ""} />
                      </span>
                      <span
                        aria-hidden="true"
                        className={`${stateLabel ? "" : "hidden"} shrink-0`}
                      >
                        {" "}
                        ·{" "}
                      </span>
                      <span className="min-w-0 truncate">
                        {preferences.ai.showLiveDockProgress ? (
                          <CrossfadeText value={model.semanticStep} />
                        ) : (
                            (stateLabel ?? "Ready")
                        )}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openQuickChat(tab)}
                    className="dock-tab-icon ml-auto flex h-8 w-7 shrink-0 items-center justify-center rounded-chip text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    aria-label={`Open chat for ${model.title}`}
                    title="Open chat"
                  >
                    <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                  </button>
                  {canRetry && onRetry ? (
                    <button
                      type="button"
                      onClick={() => onRetry(tab.runId)}
                      className="dock-tab-icon flex h-8 w-7 shrink-0 items-center justify-center rounded-chip text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      aria-label={`Retry ${model.title}`}
                      title="Retry"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  {isActiveRunStatus(tab.run.status) && onStop ? (
                    <button
                      type="button"
                      disabled={stopping.has(tab.runId)}
                      onClick={() => void stopTab(tab.runId)}
                      className="dock-tab-icon flex h-8 w-7 shrink-0 items-center justify-center rounded-chip text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]"
                      aria-label={`Stop ${model.title}`}
                      title="Stop"
                    >
                      <Square className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <span data-spectra-follow-control="" className="contents">
                  <OverflowMenu
                    label={`More actions for ${model.title}`}
                    size={28}
                    side="top"
                    layer="toast"
                    avoidCollisions={false}
                    followSafe
                    triggerClassName="dock-tab-icon text-[var(--text-tertiary)]"
                    items={[
                      {
                        key: "follow" as const,
                            label: followingThis
                              ? "Stop following"
                              : "Follow AI",
                        icon: Crosshair,
                      },
                      ...(canUndo && card
                        ? [
                            {
                              key: "undo" as const,
                              label: "Undo this run",
                              icon: Undo2,
                            },
                          ]
                        : []),
                      {
                        key: "close",
                        label: closePreservesRunningJob(source)
                          ? "Close tab. The run keeps working"
                          : "Close tab",
                        icon: X,
                      },
                    ]}
                    onSelect={(key) => {
                      if (key === "follow") {
                        if (followingThis) followAiActor(null);
                        else followAiActor(tab.runId);
                      } else if (key === "undo" && card)
                        void onAction?.(card, "revert");
                      else if (key === "close") void hideTab(tab);
                    }}
                  />
                  </span>
                </div>

                {!expanded && hoverOpen ? (
                  <div
                    className={`spectra-live-dock-hover ${LAYER_CLASS.toast} fixed w-[min(360px,calc(100vw-24px))] rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3.5 shadow-hover`}
                    style={
                      {
                        positionAnchor: disclosureAnchor,
                        bottom: "anchor(top)",
                        left: "max(12px, anchor(left))",
                      } as CSSProperties
                    }
                    role="status"
                    onPointerEnter={() => openTabHover(tab.runId)}
                    onPointerLeave={closeTabHover}
                  >
                    <p className="text-ui font-semibold leading-5 text-[var(--text-primary)]">
                      {model.title}
                    </p>
                    <ProgressTrace
                      steps={traceSteps}
                      active={isSteerable}
                      hasOutput={!isSteerable}
                      summary={
                        isSteerable
                          ? undefined
                          : model.finalSummary || model.hoverSummary
                      }
                      compact
                      persistKey={tab.runId}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-micro text-[var(--text-tertiary)]">
                      {model.targetNames.length ? (
                          <span>
                            {model.targetNames.slice(0, 2).join(" · ")}
                          </span>
                      ) : null}
                      {model.attachmentNames.length ? (
                        <span>{model.attachmentNames.length} attached</span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--border-subtle)] pt-2">
                      <button
                        type="button"
                        onClick={() => openQuickChat(tab)}
                        className="inline-flex h-7 items-center gap-1 rounded-chip px-2 text-micro font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                      >
                          <SquareArrowOutUpRight className="h-3 w-3" /> Open
                          conversation
                      </button>
                      {!active ? (
                        <button
                          type="button"
                          onClick={() => continueThread(tab)}
                          className="inline-flex h-7 items-center gap-1 rounded-chip px-2 text-micro font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                          Continue here
                        </button>
                      ) : null}
                      {model.state === "needs_input" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setCollapsedInputRuns((current) => {
                              const next = new Set(current);
                              next.delete(tab.runId);
                              return next;
                            });
                            setExpandedInputRunId(tab.runId);
                          }}
                          className="inline-flex h-7 items-center gap-1 rounded-chip px-2 text-micro font-semibold text-[var(--accent-cyan)] hover:bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)]"
                        >
                          <CircleHelp className="h-3 w-3" /> Respond
                        </button>
                      ) : null}
                      {canRetry ? (
                        <button
                          type="button"
                          onClick={() => onRetry?.(tab.runId)}
                          className="inline-flex h-7 items-center gap-1 rounded-chip px-2 text-micro font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                          <RotateCcw className="h-3 w-3" /> Retry
                        </button>
                      ) : null}
                      {canUndo && card ? (
                        <button
                          type="button"
                          onClick={() => void onAction?.(card, "revert")}
                          className="inline-flex h-7 items-center gap-1 rounded-chip px-2 text-micro font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                          <Undo2 className="h-3 w-3" /> Undo this run
                        </button>
                      ) : null}
                      {isActiveRunStatus(tab.run.status) && onStop ? (
                        <button
                          type="button"
                          disabled={stopping.has(tab.runId)}
                          onClick={() => void stopTab(tab.runId)}
                          className="ml-auto inline-flex h-7 items-center gap-1 rounded-chip px-2 text-micro font-semibold text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]"
                        >
                          <Square className="h-3 w-3" /> Stop
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {expanded ? (
                  <motion.div
                    className="fixed z-chrome w-[min(480px,calc(100vw-24px))] rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
                    style={
                      {
                        positionAnchor: disclosureAnchor,
                        bottom: "calc(anchor(top) - 6px)",
                        left: "max(12px, anchor(left))",
                      } as CSSProperties
                    }
                    initial={
                      motionLevel.disabled ? false : { y: 6, opacity: 0 }
                    }
                    animate={{ y: 0, opacity: 1 }}
                    exit={
                      motionLevel.disabled ? undefined : { y: 4, opacity: 0 }
                    }
                    transition={transitionFor("morph", motionLevel.level)}
                  >
                    <div
                      className="px-3 pb-3 pt-2"
                      aria-label={`${model.title} requires input`}
                    >
                      <div className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
                        <p className="line-clamp-4 text-xs font-medium leading-5 text-[var(--text-primary)]">
                          {model.inputRequest?.kind === "choice_batch"
                            ? "A few quick questions"
                            : model.inputRequest?.prompt}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setCollapsedInputRuns((current) =>
                              new Set(current).add(tab.runId),
                            );
                            setExpandedInputRunId(null);
                          }}
                          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-chip text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                          aria-label="Collapse required input"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </div>
                      {model.inputRequest?.kind === "choice_batch" ? (
                        <div className="mt-2 max-h-64 space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin]">
                          {model.inputRequest.questions.map(
                            (question, questionIndex) => {
                              const selected =
                                batchAnswers[tab.runId]?.[question.id];
                              return (
                                <fieldset key={question.id}>
                                  <legend className="text-micro font-semibold leading-4 text-[var(--text-primary)]">
                                    {questionIndex + 1}. {question.prompt}
                                  </legend>
                                  <div className="mt-1 grid gap-1 sm:grid-cols-2">
                                    {question.options.map((option) => (
                                      <button
                                        key={option.key ?? option.title}
                                        type="button"
                                          aria-pressed={
                                          selected === option.key
                                          }
                                        onClick={() =>
                                          setBatchAnswers((current) => ({
                                            ...current,
                                            [tab.runId]: {
                                              ...current[tab.runId],
                                            [question.id]: option.key ?? "",
                                            },
                                          }))
                                        }
                                        className={`rounded-chip border px-2 py-1.5 text-left text-micro font-semibold ${selected === option.key ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-primary))]" : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:border-[var(--accent-cyan)]"}`}
                                      >
                                        {option.displayTitle ?? displayChoiceTitle(option.title)}
                                      </button>
                                    ))}
                                    <button
                                      type="button"
                                      aria-pressed={selected === "skip"}
                                      onClick={() =>
                                        setBatchAnswers((current) => ({
                                          ...current,
                                          [tab.runId]: {
                                            ...current[tab.runId],
                                            [question.id]: "skip",
                                          },
                                        }))
                                      }
                                      className="rounded-chip px-2 py-1.5 text-left text-micro text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                                    >
                                      Skip this question
                                    </button>
                                  </div>
                                </fieldset>
                              );
                            },
                          )}
                          <button
                            type="button"
                            disabled={model.inputRequest.questions.some(
                              (question) =>
                                !batchAnswers[tab.runId]?.[question.id],
                            )}
                            onClick={() => {
                              const response =
                                model.inputRequest?.kind === "choice_batch"
                                  ? model.inputRequest.questions
                                      .map((question, index) => {
                                        const key = batchAnswers[tab.runId]?.[question.id] ?? "skip";
                                        const option = question.options.find((candidate) => candidate.key === key);
                                        return `${index + 1}) ${option?.title ?? "Skipped"}`;
                                      })
                                      .join("; ")
                                  : "";
                                if (response)
                                  void respondToInput(tab, response);
                            }}
                            className={buttonVariants({ variant: "primary", className: "sticky bottom-0 w-full bg-[var(--bg-elevated)]" })}
                          >
                            Continue with these answers
                          </button>
                        </div>
                      ) : model.inputRequest?.kind === "choice" ? (
                        <>
                          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                            {model.inputRequest.options.map((option) => (
                              <button
                                key={option.key ?? option.title}
                                type="button"
                                onClick={() =>
                                  void respondToInput(tab, option.title, undefined, option.key)
                                }
                                className="rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-2 text-left hover:border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))]"
                              >
                                <span className="block text-micro font-semibold text-[var(--text-primary)]">
                                  {option.displayTitle ?? displayChoiceTitle(option.title)}
                                </span>
                                {option.description ? (
                                  <span className="mt-0.5 block line-clamp-2 text-micro leading-3.5 text-[var(--text-tertiary)]">
                                    {option.description}
                                  </span>
                                ) : null}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                              onClick={() =>
                                void respondToInput(tab, "Skipped")
                              }
                            className="mt-1.5 h-7 rounded-chip px-2 text-micro font-semibold text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
                          >
                            Skip for now
                          </button>
                        </>
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
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" || event.shiftKey)
                                return;
                              event.preventDefault();
                              const answer = answers[tab.runId]?.trim();
                              if (answer) void respondToInput(tab, answer);
                            }}
                            placeholder="Your answer…"
                            className="h-9 min-w-0 flex-1 rounded-chip border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-0 text-micro leading-9 outline-none focus:border-[var(--accent-cyan)]"
                          />
                          <button
                            type="button"
                            disabled={!answers[tab.runId]?.trim()}
                            onClick={() => {
                              const answer = answers[tab.runId]?.trim();
                              if (!answer) return;
                              void respondToInput(tab, answer);
                            }}
                            className={buttonVariants({ variant: "primary" })}
                          >
                            Continue
                          </button>
                          <button
                            type="button"
                              onClick={() =>
                                void respondToInput(tab, "Skipped")
                              }
                            className="h-9 rounded-chip px-2 text-micro font-semibold text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                          >
                            Skip
                          </button>
                        </div>
                      ) : model.inputRequest?.kind === "file" ? (
                        <label className="mt-2 flex min-h-10 cursor-pointer items-center justify-center rounded-control border border-dashed border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-micro font-semibold text-[var(--text-secondary)] hover:border-[var(--accent-cyan)]">
                            <FileText className="mr-1.5 h-3.5 w-3.5" /> Attach
                            the requested file
                          <input
                            type="file"
                            accept={model.inputRequest.accept}
                            className="sr-only"
                            onChange={async (event) => {
                              const file = event.target.files?.[0];
                              if (!file) return;
                                const attachment =
                                  await attachmentFromFile(file);
                              await respondToInput(
                                tab,
                                `Attached ${file.name}.`,
                                [attachment],
                              );
                            }}
                          />
                        </label>
                      ) : card ? (
                        <>
                          {model.targetNames.length ? (
                            <p className="mt-2 text-micro leading-5 text-[var(--text-secondary)]">
                              {confirmationDiffSummary({
                                targetTitles: model.targetNames,
                                reasons: [],
                              })}
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => void onAction?.(card, "confirm")}
                              className={buttonVariants({ variant: "primary" })}
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
                              className="h-8 rounded-control px-2.5 text-micro font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                            >
                              Ask for changes
                            </button>
                            <button
                              type="button"
                              onClick={() => void onAction?.(card, "cancel")}
                              className="h-8 rounded-control px-2.5 text-micro font-semibold text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]"
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
                                className="h-9 min-w-0 flex-1 rounded-chip border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-0 text-micro leading-9 outline-none focus:border-[var(--accent-cyan)]"
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
                                className="h-8 rounded-chip bg-[var(--accent-cyan)] px-2.5 text-micro font-semibold text-white disabled:opacity-40"
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
      </div>
    </section>
  );
}

