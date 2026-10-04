"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { uniqueToken } from "@/lib/unique-token";
import {
  parseSpectraStreamEvent,
  type ResultCardStreamView,
  type SpectraStreamEvent,
} from "./stream-events";
import { applyHarnessEvent, isHarnessExchangeEvent, type HarnessExchangeFields, type HarnessAnswerValue } from "./harness-exchange";
import {
  getSpectraRunEvents,
  getSpectraRunDetail,
  getSpectraRunTabs,
  postSpectra,
  type SpectraResultCard,
  type SpectraRunTab,
} from "../data/api";
import { requestSpectra, spectraFailureMessage } from "../data/request";
import type { CommandAttachment } from "../components/command-bar";
import { getRunLedger, recordRunEvent } from "../collaboration/run-ledger";
import { noteAiLocation } from "../collaboration/follow-ai";
import {
  handleSpectraAiUiEvent,
  rememberCommittedArtifactResult,
} from "../collaboration/ai-ui-events";
import { publishArtifactAiActivity } from "../collaboration/artifact-ai-activity";
import { useSpectraPreferences } from "../settings/preference-store";
import { spectraBus } from "../events";
import { isRetryableRunStatus } from "./run-lifecycle";
import { observeUiRun, stopObservingUiRun, uiObserverForRun } from "../collaboration/settings-observation-client";

/**
 * Artifact ids the run feed has published coarse activity for, per run, so a
 * terminal event clears exactly the cards it lit. An open studio publishes
 * richer, actor-named activity over the same store and always wins.
 */
const runFeedArtifacts = new Map<string, Set<string>>();
const RUN_FEED_SOURCE = "run-feed";
const RUN_BEGIN_TIMEOUT_MS = 90_000;

/** An item named by id, type and title only: what the run's environment block lists. Never content. */
export type SpectraRunPointer = { id: string; type: string; title: string };

function clearRunFeedActivity(runId: string): void {
  const artifactIds = runFeedArtifacts.get(runId);
  if (!artifactIds) return;
  for (const artifactId of artifactIds) {
    publishArtifactAiActivity(artifactId, RUN_FEED_SOURCE, null);
  }
  runFeedArtifacts.delete(runId);
}

/**
 * Every parsed run event feeds the client ledger, whichever path delivered it
 * (the live SSE stream or the durable event poll). The ledger is what lets
 * Quick Chat, cards and follow mode tell one story about the run.
 */
function feedLedger(event: ReturnType<typeof parseSpectraStreamEvent>): void {
  const runId = "runId" in event ? event.runId : undefined;
  if (!runId) return;
  switch (event.type) {
    case "run_created":
    case "confirmation_required":
    case "stopped":
    case "interrupted":
    case "final":
      recordRunEvent({
        type: event.type,
        runId,
        ...(event.type === "stopped" ? { partial: event.partial } : {}),
      });
      if (
        event.type !== "run_created" &&
        event.type !== "confirmation_required"
      ) {
        clearRunFeedActivity(runId);
        stopObservingUiRun(runId, true);
      }
      break;
    case "operation_preview":
      recordRunEvent({
        type: event.type,
        runId,
        operationId: event.operationId,
        operationType: event.operationType,
        ...(event.preview ? { preview: event.preview } : {}),
      });
      // Existing targets are already readable; pending create shells are not.
      // Keep their activity visible in cards, but wait for operation_result
      // before trying to open a newly created artifact in Follow AI.
      if (event.preview?.targetId) {
        noteAiLocation({
          actorId: runId,
          artifactId: event.preview.targetId,
          ...(event.preview.title ? { note: event.preview.title } : {}),
        });
      }
      const activityArtifactId =
        event.preview?.pendingArtifactId ?? event.preview?.targetId;
      if (activityArtifactId && event.preview?.title) {
        let published = runFeedArtifacts.get(runId);
        if (!published) {
          published = new Set();
          runFeedArtifacts.set(runId, published);
        }
        published.add(activityArtifactId);
        publishArtifactAiActivity(activityArtifactId, RUN_FEED_SOURCE, {
          phase: "editing",
          detail: event.preview.title,
        });
      }
      break;
    case "ui_event":
      handleSpectraAiUiEvent({ ...event, runId });
      break;
    case "operation_commit":
    case "operation_result":
      recordRunEvent({
        type: event.type,
        runId,
        operationId: event.operationId,
        ...(event.type === "operation_result"
          ? { affected: event.affected }
          : {}),
      });
      if (event.type === "operation_result")
        rememberCommittedArtifactResult(event);
      break;
    case "status":
      recordRunEvent({ type: event.type, runId, message: event.message });
      break;
    case "error":
      recordRunEvent({ type: event.type, runId, message: event.message });
      clearRunFeedActivity(runId);
      stopObservingUiRun(runId, true);
      break;
    default:
      break;
  }
  spectraBus.emit("run.changed", { runId });
}

export type SpectraRunSurface = "chat" | "workspace" | "artifacts" | "artifact";
export type SpectraLiveExchange = Omit<HarnessExchangeFields, "steps"> & {
  id: string;
  runId?: string;
  threadId?: string;
  prompt: string;
  content: string;
  steps: Array<{
    id: string;
    title: string;
    summary?: string;
    status: "running" | "done" | "error";
    createdAt: number;
  }>;
  /** "waiting": the run asked a question or for approval and is paused. */
  status: "starting" | "streaming" | "waiting" | "failed";
  startedAt: number;
};

const userTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

/** Harness events that change what the live exchange shows. */
function applyExchangeEvent(exchange: SpectraLiveExchange, event: SpectraStreamEvent): SpectraLiveExchange {
  if (isHarnessExchangeEvent(event)) {
    const next = applyHarnessEvent(exchange, event);
    if (event.type === "input_required") return { ...next, status: "waiting" };
    if (event.type === "input_answered") return { ...next, status: "streaming" };
    return next.status === "starting" ? { ...next, status: "streaming" } : next;
  }
  return exchange;
}

const isExchangeEvent = isHarnessExchangeEvent;

const EMPTY_INITIAL_CARDS: SpectraResultCard[] = [];

function persistedToStream(card: SpectraResultCard): ResultCardStreamView {
  return {
    id: card._id,
    runId: card.runId,
    status: card.status,
    title: card.title,
    summary: card.summary,
    variant: card.variant,
    actions: card.actions,
    provenance: card.provenance,
    updatedAt: card.updatedAt,
  };
}

function mergeCards(
  current: ResultCardStreamView[],
  incoming: ResultCardStreamView[],
) {
  const byId = new Map(current.map((card) => [card.id, card]));
  incoming.forEach((card) => {
    const existing = byId.get(card.id);
    if (!existing || card.updatedAt >= existing.updatedAt)
      byId.set(card.id, card);
  });
  const merged = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const unchanged =
    current.length === merged.length &&
    current.every((card, index) => {
      const next = merged[index];
      return (
        next &&
        card.id === next.id &&
        card.runId === next.runId &&
        card.status === next.status &&
        card.title === next.title &&
        card.summary === next.summary &&
        card.variant === next.variant &&
        card.updatedAt === next.updatedAt &&
        card.actions.length === next.actions.length &&
        card.actions.every((action, actionIndex) => {
          const nextAction = next.actions[actionIndex];
          return (
            nextAction &&
            action.key === nextAction.key &&
            action.label === nextAction.label &&
            action.targetType === nextAction.targetType &&
            action.targetId === nextAction.targetId
          );
        })
      );
    });
  return unchanged ? current : merged;
}

function authoredStepTitle(message: string) {
  const authoredTitle = message.split(" · ")[0]?.trim();
  if (message.includes(" · ") && authoredTitle) return authoredTitle;
  return message.trim().slice(0, 88);
}

function operationPreviewMessage(preview: {
  action:
    "create" | "update" | "archive" | "link" | "place" | "remove" | "workspace";
  title: string;
}) {
  const verb =
    preview.action === "create"
      ? "Creating"
      : preview.action === "update"
        ? "Updating"
        : preview.action === "archive"
          ? "Archiving"
          : preview.action === "remove"
            ? "Removing"
            : preview.action === "workspace"
              ? "Organizing"
              : preview.action === "place"
                ? "Placing"
                : "Connecting";
  // A preview title can already describe an earlier phase of the same
  // operation ("Preparing the focused artifact"). Prefixing that with the
  // operation verb produced claims such as "Updating Preparing..." and, once
  // the next step arrived, "Updated Preparing...". Preserve any authored
  // present-progressive title so the trace says what is actually happening.
  return /^(?:preparing|opening|reviewing|reading|inspecting|planning|validating|checking|rewriting|editing|updating|creating|building|placing|removing|connecting|organizing)\b/i.test(
    preview.title,
  ) || new RegExp(`^${verb}\\b`, "i").test(preview.title)
    ? preview.title
    : `${verb} ${preview.title}`;
}

function appendStep(
  exchange: SpectraLiveExchange,
  message: string,
): SpectraLiveExchange {
  const title = authoredStepTitle(message);
  // Filler pipeline labels belong elsewhere — keep only authored work bars.
  if (
    /^(preparing response|responding|getting started|queued)$/i.test(
      title.trim(),
    )
  )
    return exchange;
  const last = exchange.steps.at(-1);
  if (last?.summary === message && last.status === "running") return exchange;
  const summary = message.includes(" · ")
    ? message.slice(message.indexOf(" · ") + 3).trim()
    : message;
  const existingIndex = exchange.steps.findIndex(
    (step) => step.title === title,
  );
  if (existingIndex >= 0) {
    return {
      ...exchange,
      steps: exchange.steps.map((step, index) =>
        index === existingIndex
          ? { ...step, summary, status: "running" as const }
          : step.status === "running"
            ? { ...step, status: "done" as const }
            : step,
      ),
    };
  }
  if (
    last &&
    last.status === "running" &&
    (title.toLocaleLowerCase().startsWith(last.title.toLocaleLowerCase()) ||
      last.title.toLocaleLowerCase().startsWith(title.toLocaleLowerCase()))
  ) {
    return {
      ...exchange,
      steps: exchange.steps.map((step, index) =>
        index === exchange.steps.length - 1
          ? { ...step, title, summary, createdAt: Date.now() }
          : step,
      ),
    };
  }
  return {
    ...exchange,
    steps: [
      ...exchange.steps.map((step, index) =>
        index === exchange.steps.length - 1 && step.status === "running"
          ? { ...step, status: "done" as const }
          : step,
      ),
      // Never use bare runId as the React key — live + durable progress can
      // collide when multiple steps share a run. exchange.id is stable per UI
      // session and uniqueToken() distinguishes concurrent appends.
      {
        id: `${exchange.id}:step:${uniqueToken()}`,
        title,
        summary,
        status: "running" as const,
        createdAt: Date.now(),
      },
    ].slice(-8),
  };
}

/** A failed Stop says what happened and what to do, never a raw body. */
const STOP_FAILURE_COPY = {
  fallback: "This run can no longer be stopped safely.",
  signedOut: "Sign in again to stop this run.",
};

export function useSpectraRun({
  surface,
  workspaceId,
  scopeNodeId,
  artifactId,
  threadId,
  initialCards = EMPTY_INITIAL_CARDS,
  onDataChanged,
  onArtifactPatch,
  onOpenArtifact,
  onThreadReady,
  onFinal,
  onContinuationConflict,
  open,
  selection,
  currentView,
  observeDurableRuns = true,
}: {
  surface: SpectraRunSurface;
  workspaceId?: string;
  scopeNodeId?: string;
  artifactId?: string;
  threadId?: string;
  initialCards?: SpectraResultCard[];
  onDataChanged?: () => Promise<unknown> | unknown;
  onArtifactPatch?: (
    artifactId: string,
    patch: Record<string, unknown>,
  ) => Promise<unknown> | unknown;
  onOpenArtifact?: (artifactId: string) => Promise<unknown> | unknown;
  onThreadReady?: (threadId: string) => Promise<unknown> | unknown;
  onFinal?: (result: {
    runId: string;
    summary: string;
    prompt: string;
  }) => Promise<unknown> | unknown;
  onContinuationConflict?: () => void;
  /** What is open on screen, named for the run (never its content). */
  open?: SpectraRunPointer[];
  /** The user's current selection, only when there is one. */
  selection?: { text: string; in?: SpectraRunPointer };
  currentView?: string;
  observeDurableRuns?: boolean;
}) {
  const { preferences } = useSpectraPreferences();
  const [cards, setCards] = useState<ResultCardStreamView[]>(() =>
    initialCards.map(persistedToStream),
  );
  const [activeRequestCount, setActiveRequestCount] = useState(0);
  const [stopSuppressed, setStopSuppressed] = useState(false);
  const [observedContinuationRunId, setObservedContinuationRunId] = useState<
    string | null
  >(null);
  const liveExchangeRef = useRef<SpectraLiveExchange | null>(null);
  const [liveExchange, setLiveExchange] = useState<SpectraLiveExchange | null>(
    null,
  );
  useEffect(() => {
    liveExchangeRef.current = liveExchange;
  }, [liveExchange]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const promptByRun = useRef(new Map<string, string>());
  const streamCoveredRuns = useRef(new Set<string>());
  const dismissedCardIds = useRef(new Set<string>());
  const activeRequests = useRef(
    new Map<AbortController, { runId: string | null; exchangeId?: string }>(),
  );
  const activeRunIds = useRef(new Set<string>());
  /* Publish the live-run set as a typed bus query so ambient surfaces (the
     favicon, shell fields) can reflect activity without polling. */
  const publishActiveRuns = useCallback(() => {
    spectraBus.setQuery("run.active", { runIds: [...activeRunIds.current] });
  }, []);
  const eventCursors = useRef(new Map<string, { sequence: number; settledExecutionId?: string }>());
  const displayedRunTabs = useRef(new Map<string, SpectraRunTab>());
  const displayedRunVersions = useRef(
    new Map<string, { executionId?: string; attemptId?: string }>(),
  );
  const resolveDisplayedRunVersion = useCallback(async (runId: string, fresh = false) => {
    const displayed = displayedRunVersions.current.get(runId);
    if (!fresh && displayed?.executionId)
      return {
        executionId: displayed.executionId,
        attemptId: displayed.attemptId ?? displayed.executionId,
      };
    const detail = await getSpectraRunDetail(runId);
    const executionId = detail.run.executionId?.trim();
    if (!executionId)
      throw new Error(
        "This run control is missing the displayed attempt. Refresh it and try again.",
      );
    const version = {
      executionId,
      attemptId: detail.run.attemptId ?? executionId,
    };
    displayedRunVersions.current.set(runId, version);
    return version;
  }, []);
  // A streamed patch can arrive while the user is inside another artifact or
  // a thread panel, before the newly-created shell exists in this view's
  // overview snapshot. Bootstrap that canonical shell once, then serialize
  // its real patches behind the refresh. Without this boundary every patch is
  // correctly persisted by the backend but silently dropped by the client
  // reducer until the terminal full refresh.
  const artifactPatchQueues = useRef(new Map<string, Promise<unknown>>());
  const durableThreadId = useRef(threadId);
  const scopeKey = `${surface}:${workspaceId ?? ""}:${artifactId ?? ""}:${threadId ?? ""}`;
  const previousScopeKey = useRef(scopeKey);

  useEffect(() => {
    durableThreadId.current = threadId;
  }, [threadId]);

  useEffect(() => {
    const incoming = initialCards
      .filter(
        (card) => !card.hiddenAt && !dismissedCardIds.current.has(card._id),
      )
      .map(persistedToStream);
    // While this client still owns the live SSE stream, ignore lagging failed
    // snapshots from overview polls so a quiet retry never flashes Failed /
    // error result cards before the stream ends.
    const sanitized = incoming.map((card) =>
      card.status === "failed" && activeRunIds.current.has(card.runId)
        ? {
            ...card,
            status: "running" as const,
            variant: card.variant === "error" ? "status" : card.variant,
          }
        : card,
    );
    if (previousScopeKey.current !== scopeKey) {
      previousScopeKey.current = scopeKey;
      if (surface === "chat") {
        setObservedContinuationRunId(null);
        setLiveExchange((current) =>
          current?.threadId && current.threadId !== threadId ? null : current,
        );
      }
      setCards((current) =>
        current.length === 0 && sanitized.length === 0 ? current : sanitized,
      );
    } else {
      setCards((current) => mergeCards(current, sanitized));
    }
    initialCards.forEach((card) => {
      if (card.run?.userPrompt)
        promptByRun.current.set(card.runId, card.run.userPrompt);
      if (card.run?.executionId)
        displayedRunVersions.current.set(card.runId, {
          executionId: card.run.executionId,
          attemptId: card.run.attemptId ?? card.run.executionId,
        });
    });
  }, [initialCards, scopeKey, surface, threadId]);

  const upsert = useCallback((card: ResultCardStreamView) => {
    dismissedCardIds.current.delete(card.id);
    setCards((current) => mergeCards(current, [card]));
  }, []);

  const dispatchArtifactPatch = useCallback(
    (nextArtifactId: string, patch: Record<string, unknown>) => {
      const existing = artifactPatchQueues.current.get(nextArtifactId);
      const bootstrap = existing ?? Promise.resolve(onDataChanged?.());
      const next = bootstrap
        .catch(() => undefined)
        .then(() => onArtifactPatch?.(nextArtifactId, patch))
        .catch(() => undefined);
      artifactPatchQueues.current.set(nextArtifactId, next);
    },
    [onArtifactPatch, onDataChanged],
  );

  useEffect(() => {
    if (!observeDurableRuns) return;
    let disposed = false;
    let timer: number | undefined;
    let polling = false;
    let pollAgain = false;
    let tabSnapshot: SpectraRunTab[] = [];
    let tabsFetchedAt = 0;
    let forceTabRefresh = false;
    const hasSettledExecution = (tab: SpectraRunTab) => Boolean(
      tab.run.executionId &&
      eventCursors.current.get(tab.runId)?.settledExecutionId === tab.run.executionId,
    );
    const poll = async () => {
      if (polling) {
        pollAgain = true;
        return;
      }
      polling = true;
      let observedActive = false;
      try {
        // The cursor endpoint is the live transport. Refresh the tab index only
        // for discovery/recovery; polling the full tab projection per cursor
        // tick re-reads every run's summary while progress is streaming.
        // A conversation owns its runs. Artifact/workspace context and the
        // shared chat surface are not substitutes for a conversation id.
        // thread_ready supplies this identity before the parent adopts it.
        const observedThreadId = threadId ?? (surface === "chat" ? durableThreadId.current : undefined);
        if (surface === "chat" && !observedThreadId) return;
        const isRelevantTab = (tab: SpectraRunTab) => {
          if (observedThreadId) return tab.threadId === observedThreadId;
          if (artifactId) return tab.run.artifactId === artifactId;
          if (workspaceId) return tab.workspaceId === workspaceId;
          return tab.surface === (surface === "artifacts" ? "artifact" : surface);
        };
        const hasActiveTabs = tabSnapshot.some(
          (tab) =>
            tab.run.status === "queued" ||
            tab.run.status === "running" ||
            tab.run.status === "awaiting_confirmation" ||
            tab.run.status === "awaiting_resolution",
        );
        if (
          forceTabRefresh ||
          !tabSnapshot.length ||
          Date.now() - tabsFetchedAt >= (hasActiveTabs ? 60_000 : 180_000)
        ) {
          const force = forceTabRefresh;
          forceTabRefresh = false;
          const result = await getSpectraRunTabs({
            force,
            limit: 120,
            threadId: observedThreadId,
            artifactId: observedThreadId ? undefined : artifactId,
            workspaceId: observedThreadId || artifactId ? undefined : workspaceId,
            surface:
              surface === "artifacts"
                ? "artifact"
                : (surface as "chat" | "workspace" | "artifact"),
          });
          if (disposed) return;
          tabSnapshot = result.runTabs.filter(isRelevantTab);
          for (const tab of tabSnapshot) {
            if (["queued", "running", "awaiting_confirmation", "awaiting_resolution"].includes(tab.run.status) &&
              !hasSettledExecution(tab))
              observeUiRun(tab.runId, tab.run.executionId);
            displayedRunTabs.current.set(tab.runId, tab);
            displayedRunVersions.current.set(tab.runId, {
              executionId: tab.run.executionId,
              attemptId: tab.run.attemptId ?? tab.run.executionId,
            });
          }
          tabsFetchedAt = Date.now();
        }
        const runTabs = tabSnapshot;
        if (disposed) return;
        const relevant = runTabs.filter(isRelevantTab);
        // A failed first cursor read leaves no event cursor. Reconcile the
        // acknowledged run from its saved terminal snapshot so a lost worker
        // cannot leave its provisional exchange spinning indefinitely.
        // A locally owned stream can still be retrying; it retains authority.
        for (const tab of relevant) {
          if (
            (tab.run.status !== "failed" && tab.run.status !== "cancelled") ||
            !tab.run.executionId ||
            activeRunIds.current.has(tab.runId) ||
            hasSettledExecution(tab) ||
            (!promptByRun.current.has(tab.runId) && !eventCursors.current.has(tab.runId))
          ) continue;
          if (tab.card && !tab.card.hiddenAt && !dismissedCardIds.current.has(tab.card._id))
            upsert(persistedToStream(tab.card));
          setLiveExchange((current) => current?.runId === tab.runId ? null : current);
          setObservedContinuationRunId((current) => current === tab.runId ? null : current);
          eventCursors.current.set(tab.runId, {
            sequence: eventCursors.current.get(tab.runId)?.sequence ?? 0,
            settledExecutionId: tab.run.executionId,
          });
          stopObservingUiRun(tab.runId, true);
          clearRunFeedActivity(tab.runId);
          void onDataChanged?.();
        }
        const active = relevant.filter(
          (tab) => !hasSettledExecution(tab) && (
            tab.run.status === "queued" ||
            tab.run.status === "running" ||
            tab.run.status === "awaiting_confirmation" ||
            tab.run.status === "awaiting_resolution"
          ),
        );
        observedActive = active.length > 0;
        setObservedContinuationRunId(
          observedThreadId ? (active[0]?.runId ?? null) : null,
        );
        const observed = relevant.filter(
          (tab) =>
            active.some((row) => row.runId === tab.runId) ||
            (eventCursors.current.has(tab.runId) &&
              !hasSettledExecution(tab)),
        );
        for (const tab of observed) {
          // The initial POST is only an acknowledgement; the worker may finish
          // after that response closes. Let durable polling take over as soon
          // as a run reaches a user-input state even if the initiating request
          // is still unwinding, otherwise a clarification can look like an
          // endless "Thinking" strip with no choice card.
          if (
            activeRunIds.current.has(tab.runId) &&
            (tab.run.status === "queued" || tab.run.status === "running")
          )
            continue;
          const after = eventCursors.current.get(tab.runId)?.sequence ?? 0;
          const { events } = await getSpectraRunEvents(tab.runId, after);
          if (disposed) return;
          // Clarification resumes and retries retain earlier attempt events.
          // A cached tab may also lag a new attempt's first event. Resolve the
          // current execution once for a mixed batch before advancing its cursor.
          let observedRun = tab.run;
          if (events.some((row) => row.executionId !== observedRun.executionId)) {
            const detail = await getSpectraRunDetail(tab.runId);
            if (disposed) return;
            observedRun = detail.run;
            const refreshedTab = { ...tab, run: observedRun };
            tabSnapshot = tabSnapshot.map((candidate) => candidate.runId === tab.runId ? refreshedTab : candidate);
            displayedRunTabs.current.set(tab.runId, refreshedTab);
            displayedRunVersions.current.set(tab.runId, {
              executionId: observedRun.executionId,
              attemptId: observedRun.attemptId ?? observedRun.executionId,
            });
            if (["queued", "running", "awaiting_confirmation", "awaiting_resolution"].includes(observedRun.status))
              observeUiRun(tab.runId, observedRun.executionId);
          }
          if (streamCoveredRuns.current.has(tab.runId)) {
            streamCoveredRuns.current.delete(tab.runId);
            const last = Math.max(after, ...events.map((row) => row.sequence));
            eventCursors.current.set(tab.runId, { ...eventCursors.current.get(tab.runId), sequence: last });
            continue;
          }
          for (const row of events.sort((a, b) => a.sequence - b.sequence)) {
            if (row.sequence <= (eventCursors.current.get(tab.runId)?.sequence ?? 0))
              continue;
            eventCursors.current.set(tab.runId, { ...eventCursors.current.get(tab.runId), sequence: row.sequence });
            if (observedRun.executionId && row.executionId !== observedRun.executionId)
              continue;
            let event: ReturnType<typeof parseSpectraStreamEvent>;
            try {
              event = parseSpectraStreamEvent(row.payload);
            } catch {
              continue;
            }
            feedLedger(event);
            if (
              event.type === "run_created" ||
              event.type === "result_card" ||
              event.type === "confirmation_required" ||
              event.type === "final"
            )
              upsert(event.card);
            if (event.type === "input_required" && event.card) upsert(event.card);
            if (event.type === "thread_title") spectraBus.emit("threads.changed", {});
            if (event.type === "artifact_touched") void onDataChanged?.();
            if (
              event.type === "text_delta" ||
              event.type === "text_replace" ||
              event.type === "progress" ||
              event.type === "operation_preview" ||
              event.type === "status" ||
              isExchangeEvent(event)
            ) {
              setLiveExchange((current) => {
                const base =
                  current?.runId === tab.runId
                    ? current
                    : {
                        id: `durable:${tab.runId}`,
                        runId: tab.runId,
                        threadId: tab.threadId,
                        prompt: observedRun.userPrompt,
                        content: "",
                        steps: [],
                        status: "streaming" as const,
                        startedAt: observedRun.createdAt,
                      };
                if (event.type === "text_delta")
                  return {
                    ...base,
                    content: base.content + event.content,
                    status: "streaming",
                  };
                if (event.type === "text_replace")
                  return {
                    ...base,
                    content: event.content,
                    status: "streaming",
                  };
                if (event.type === "progress")
                  return appendStep(
                    base,
                    event.detail
                      ? `${event.title} · ${event.detail}`
                      : event.title,
                  );
                if (event.type === "status")
                  return appendStep(
                    { ...base, status: "streaming" },
                    event.message,
                  );
                if (event.type === "operation_preview" && event.preview)
                  return appendStep(
                    base,
                    operationPreviewMessage(event.preview),
                  );
                return applyExchangeEvent(base, event);
              });
            }
            if (event.type === "artifact_patch")
              dispatchArtifactPatch(event.artifactId, event.patch);
            if (
              event.type === "run_created" ||
              event.type === "thread_ready" ||
              event.type === "agent_routed" ||
              event.type === "operation_preview" ||
              event.type === "operation_result" ||
              event.type === "confirmation_required" ||
              event.type === "approval_accepted" ||
              event.type === "approval_rejected" ||
              event.type === "choice_selected" ||
              event.type === "interrupted" ||
              event.type === "final"
            )
              void onDataChanged?.();
            // Durable history can replay an older attempt's terminal event
            // while a retry is already active. Its card keeps the history;
            // only the live request path raises a toast for a current failure.
            if (
              event.type === "error" ||
              event.type === "stopped" ||
              event.type === "interrupted"
            )
              setLiveExchange((current) =>
                current?.runId === tab.runId ? null : current,
              );
            if (
              event.type === "error" ||
              event.type === "stopped" ||
              event.type === "interrupted" ||
              event.type === "final"
            ) {
              eventCursors.current.set(tab.runId, { sequence: row.sequence, settledExecutionId: observedRun.executionId });
              setObservedContinuationRunId((current) =>
                current === tab.runId ? null : current,
              );
            }
            if (event.type === "confirmation_required")
              setLiveExchange((current) =>
                current?.runId === tab.runId ? null : current,
              );
            if (event.type === "final") {
              setLiveExchange((current) =>
                current?.runId === tab.runId ? null : current,
              );
              void onFinal?.({
                runId: tab.runId,
                summary: event.summary,
                prompt:
                  promptByRun.current.get(tab.runId) ?? observedRun.userPrompt,
              });
            }
          }
          // Retain the sequence and settled execution through refreshes. The
          // next attempt resumes after this cursor; this one is no longer polled.
        }
      } catch {
        // A transient observer failure must not interrupt the authoritative run.
      } finally {
        polling = false;
        if (!disposed && pollAgain) {
          pollAgain = false;
          timer = window.setTimeout(() => void poll(), 0);
        } else if (!disposed)
          // Active runs use the cursor stream aggressively; the tab index above
          // is deliberately slower. Hidden tabs keep a slow heartbeat.
          timer = window.setTimeout(
            poll,
            document.visibilityState === "visible"
              ? observedActive
                ? 750
                : 180_000
              : 60_000,
          );
      }
    };
    const requestDurablePoll = () => {
      if (disposed) return;
      forceTabRefresh = true;
      tabsFetchedAt = 0;
      if (timer) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      void poll();
    };
    const removeThreadsChanged = spectraBus.on(
      "threads.changed",
      requestDurablePoll,
    );
    void poll();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      removeThreadsChanged();
    };
  }, [
    artifactId,
    dispatchArtifactPatch,
    observeDurableRuns,
    onDataChanged,
    onFinal,
    surface,
    threadId,
    upsert,
    workspaceId,
  ]);

  const consume = useCallback(
    async (
      body: Record<string, unknown>,
      optimisticCardId?: string,
      liveExchangeId?: string,
      onAcknowledged?: (runId: string) => void,
      joinedRun?: (runId: string, prompt: string) => void,
    ) => {
      const controller = new AbortController();
      let requestRunId: string | null = null;
      let requestReachedTerminal = false;
      const requestExchangeId =
        liveExchangeId ??
        (typeof body.submissionKey === "string"
          ? body.submissionKey
          : undefined);
      activeRequests.current.set(controller, {
        runId: null,
        exchangeId: requestExchangeId,
      });
      const response = await requestSpectra("/api/spectra/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error(
          await spectraFailureMessage(response, {
            fallback:
              "Spectra could not start this run. Check your connection, then try again.",
            signedOut: "Sign in again to run Spectra.",
          }),
        );
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let changed = false;
      let sawInput = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        // Process a final NDJSON event even when the response closes without a
        // trailing newline; otherwise the terminal card/final event is lost.
        buffer = done ? "" : lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = parseSpectraStreamEvent(JSON.parse(line));
          feedLedger(event);
          if (
            event.type === "error" ||
            event.type === "stopped" ||
            event.type === "interrupted" ||
            event.type === "final" ||
            event.type === "confirmation_required"
          )
            setObservedContinuationRunId((current) =>
              current === event.runId ? null : current,
            );
          if (event.type === "run_created") {
            if (optimisticCardId)
              setCards((current) =>
                current.filter((card) => card.id !== optimisticCardId),
              );
            if (typeof body.prompt === "string")
              promptByRun.current.set(event.runId, body.prompt);
            setLiveExchange((current) =>
              current && (!liveExchangeId || current.id === liveExchangeId)
                ? { ...current, runId: event.runId, status: "streaming" }
                : current,
            );
            activeRunIds.current.add(event.runId);
            publishActiveRuns();
            requestRunId = event.runId;
            activeRequests.current.set(controller, {
              runId: event.runId,
              exchangeId: requestExchangeId,
            });
            onAcknowledged?.(event.runId);
            spectraBus.emit("threads.changed", {});
          }
          if (event.type === "thread_ready") {
            durableThreadId.current = event.threadId;
            setLiveExchange((current) =>
              current && (!liveExchangeId || current.id === liveExchangeId)
                ? { ...current, threadId: event.threadId }
                : current,
            );
            void onThreadReady?.(event.threadId);
          }
          if (event.type === "steer_queued") {
            // The message joined a run that is working; it reads it at its
            // next turn. Nothing new starts here: the optimistic card goes
            // and the joined run stays the live exchange.
            if (optimisticCardId)
              setCards((current) =>
                current.filter((card) => card.id !== optimisticCardId),
              );
            joinedRun?.(event.runId, typeof body.prompt === "string" ? body.prompt : "");
            onAcknowledged?.(event.runId);
            spectraBus.emit("threads.changed", {});
          }
          if (isExchangeEvent(event))
            setLiveExchange((current) =>
              current && (!liveExchangeId || current.id === liveExchangeId)
                ? applyExchangeEvent({ ...current, runId: event.runId ?? current.runId }, event)
                : current,
            );
          if (event.type === "input_required") {
            if (event.card) upsert(event.card);
            changed = sawInput = true;
          }
          if (event.type === "artifact_touched") changed = true;
          if (event.type === "thread_title") spectraBus.emit("threads.changed", {});
          if (event.type === "text_delta")
            setLiveExchange((current) =>
              current && (!liveExchangeId || current.id === liveExchangeId)
                ? {
                    ...current,
                    runId: event.runId,
                    content: current.content + event.content,
                    status: "streaming",
                  }
                : current,
            );
          if (event.type === "text_replace")
            setLiveExchange((current) =>
              current && (!liveExchangeId || current.id === liveExchangeId)
                ? {
                    ...current,
                    runId: event.runId,
                    content: event.content,
                    status: "streaming",
                  }
                : current,
            );
          if (
            event.type === "run_created" ||
            event.type === "result_card" ||
            event.type === "confirmation_required" ||
            event.type === "final"
          )
            upsert(event.card);
          if (event.type === "error") {
            if (event.card) upsert(event.card);
            changed = true;
            // A run that saved work is a partial completion, not a disaster:
            // the thread's own note tells that story calmly. Reserve the red
            // toast for failures where nothing landed.
            const ledgerEntry = event.runId ? getRunLedger(event.runId) : null;
            if (ledgerEntry?.phase === "partial") {
              toast.message(
                "Some of that could not be finished. Completed work stays saved.",
              );
            }
            setLiveExchange((current) =>
              current && (!liveExchangeId || current.id === liveExchangeId)
                ? { ...current, status: "failed" }
                : current,
            );
            // Keep a short grace window for the route's one quiet continuation.
            // A following progress event revives this same exchange without any
            // red flash; a genuinely terminal stream is then removed and its
            // compact durable failure/retry state becomes authoritative.
            window.setTimeout(() => {
              setLiveExchange((current) =>
                current &&
                (!liveExchangeId || current.id === liveExchangeId) &&
                current.status === "failed"
                  ? null
                  : current,
              );
            }, 450);
          }
          if (event.type === "stopped" || event.type === "interrupted")
            changed = requestReachedTerminal = true;
          if (event.type === "operation_preview" && event.preview) {
            const operationTitle = operationPreviewMessage(event.preview);
            setCards((current) =>
              current.map((card) =>
                card.runId === event.runId
                  ? {
                      ...card,
                      title: operationTitle,
                      summary: event.preview!.title,
                      updatedAt: Date.now(),
                    }
                  : card,
              ),
            );
            if (event.preview.pendingArtifactId) {
              changed = true;
              void onDataChanged?.();
            }
          }
          if (event.type === "operation_result") {
            changed = true;
            void onDataChanged?.();
          }
          if (event.type === "artifact_patch") {
            changed = true;
            dispatchArtifactPatch(event.artifactId, event.patch);
          }
          if (event.type === "operation_preview" && event.preview) {
            const title = operationPreviewMessage(event.preview);
            setLiveExchange((current) =>
              current && (!liveExchangeId || current.id === liveExchangeId)
                ? appendStep(
                    { ...current, runId: event.runId, status: "streaming" },
                    title,
                  )
                : current,
            );
          }
          if (event.type === "progress") {
            const message = event.detail
              ? `${event.title} · ${event.detail}`
              : event.title;
            setLiveExchange((current) =>
              current && (!liveExchangeId || current.id === liveExchangeId)
                ? appendStep(
                    { ...current, runId: event.runId, status: "streaming" },
                    message,
                  )
                : current,
            );
            setCards((current) =>
              current.map((card) =>
                card.runId === event.runId
                  ? {
                      ...card,
                      status: "running",
                      title: event.title,
                      summary: event.detail ?? event.regionHint ?? event.title,
                      updatedAt: Date.now(),
                    }
                  : card,
              ),
            );
          }
          if (event.type === "status") {
            // Quiet repair/apply retries publish calm status copy. Keep the strip
            // streaming — never treat a first-pass recovery as a terminal failure.
            setLiveExchange((current) =>
              current && (!liveExchangeId || current.id === liveExchangeId)
                ? appendStep(
                    { ...current, runId: event.runId, status: "streaming" },
                    event.message,
                  )
                : current,
            );
            setCards((current) =>
              current.map((card) =>
                card.runId === event.runId &&
                card.status !== "failed" &&
                card.status !== "completed" &&
                card.status !== "cancelled"
                  ? {
                      ...card,
                      status: "running",
                      title: event.message.includes("·")
                        ? event.message.split("·")[0]!.trim()
                        : event.message,
                      summary: event.message.includes("·")
                        ? event.message.split("·").slice(1).join("·").trim()
                        : event.message,
                      updatedAt: Date.now(),
                    }
                  : card,
              ),
            );
          }
          if (event.type === "agent_routed") {
            setCards((current) =>
              current.map((card) =>
                card.runId === event.runId
                  ? {
                      ...card,
                      provenance: {
                        ...(card.provenance ?? {}),
                        agentId: event.agentId,
                        agentVersionId: event.agentVersionId,
                        agentTitle: event.title,
                        agentRoutingReason: event.reason,
                        agentRoutingSource: event.source,
                      },
                      updatedAt: Date.now(),
                    }
                  : card,
              ),
            );
          }
          if (event.type === "final") {
            requestReachedTerminal = true;
            setLiveExchange((current) =>
              current && (!liveExchangeId || current.id === liveExchangeId)
                ? {
                    ...current,
                    runId: event.runId,
                    steps: current.steps.map((step) =>
                      step.status === "running"
                        ? { ...step, status: "done" }
                        : step,
                    ),
                    status: "streaming",
                  }
                : current,
            );
            spectraBus.emit("threads.changed", {});
            void onFinal?.({
              runId: event.runId,
              summary: event.summary,
              prompt: promptByRun.current.get(event.runId) ?? "",
            });
          }
          if (event.type === "final" || event.type === "confirmation_required")
            changed = requestReachedTerminal = true;
        }
        if (done) break;
      }
      if (changed) await onDataChanged?.();
      if (requestReachedTerminal)
        setLiveExchange((current) =>
          current && (!liveExchangeId || current.id === liveExchangeId)
            ? null
            : current,
        );
      activeRequests.current.delete(controller);
      // This stream already showed everything up to the open question; the
      // durable poll must not replay it into the same exchange.
      if (requestRunId && sawInput) streamCoveredRuns.current.add(requestRunId);
      if (requestRunId) {
        activeRunIds.current.delete(requestRunId);
        publishActiveRuns();
      }
      // The POST acknowledges a durable worker. Refresh after releasing local
      // stream ownership so polling can consume its events immediately.
      if (requestRunId && !requestReachedTerminal)
        spectraBus.emit("threads.changed", {});
    },
    [
      dispatchArtifactPatch,
      onDataChanged,
      onFinal,
      onThreadReady,
      publishActiveRuns,
      upsert,
    ],
  );

  const run = useCallback(
    (
      prompt: string,
      attachments: CommandAttachment[] = [],
      options?: {
        threadId?: string | null;
        /** The run this message joins; by default the thread's active run. */
        steerRunId?: string;
        /** Items the user referenced with @ in this message. */
        references?: SpectraRunPointer[];
        /**
         * The agent for this message: a string chooses it (and keeps it for
         * the thread), null switches back to Auto, omitted keeps the thread's
         * choice.
         */
        agentId?: string | null;
        clarificationId?: string;
        choiceKey?: string;
        choiceMessageId?: string;
        executionId?: string;
        batchSelections?: Array<{
          questionId: string;
          choiceKey: string;
          choiceTitle: string;
        }>;
      },
    ): Promise<boolean> => {
      const clean = prompt.trim();
      if (!clean) return Promise.resolve(false);
      const continuedThreadId =
        options?.threadId === null
          ? undefined
          : (options?.threadId ??
            (preferences.ai.continueCurrentConversation
              ? durableThreadId.current
              : undefined));
      toast.dismiss();
      return new Promise<boolean>((resolve) => {
        const exchangeId = crypto.randomUUID();
        const optimisticCardId = `optimistic:${exchangeId}`;
        let beginSettled = false;
        const settleBegin = (accepted: boolean) => {
          if (beginSettled) return;
          beginSettled = true;
          resolve(accepted);
        };
        setStopSuppressed(false);
        setActiveRequestCount((count) => count + 1);
        // A message that joins a working run keeps that run's exchange.
        const previousExchange = liveExchangeRef.current;
        setLiveExchange({
          id: exchangeId,
          threadId: continuedThreadId,
          prompt: clean,
          content: "",
          steps: [],
          status: "starting",
          startedAt: Date.now(),
        });
        upsert({
          id: optimisticCardId,
          runId: `pending:${exchangeId}`,
          status: "running",
          title: "Starting run",
          summary: clean,
          variant: "status",
          actions: [],
          updatedAt: Date.now(),
        });
        // A first development request can include a cold route compilation on
        // constrained hardware. Keep this guard generous enough that a healthy
        // run is never misreported as an infrastructure failure while still
        // preventing an unbounded optimistic "Starting" state.
        const beginTimeout = window.setTimeout(() => {
          if (beginSettled) return;
          for (const [controller, request] of activeRequests.current) {
            if (
              request.exchangeId === exchangeId &&
              (!request.runId || request.runId.startsWith("pending:"))
            ) {
              controller.abort();
              activeRequests.current.delete(controller);
            }
          }
          setCards((current) =>
            current.filter((card) => card.id !== optimisticCardId),
          );
          setLiveExchange((current) =>
            current?.id === exchangeId ? null : current,
          );
          toast.error(
            "Spectra is still preparing this run. Try again; your work and conversation are safe.",
          );
          settleBegin(false);
        }, RUN_BEGIN_TIMEOUT_MS);
        void consume(
          {
            action: "run",
            submissionKey: exchangeId,
            prompt: clean,
            surface,
            workspaceId,
            scopeNodeId,
            artifactId,
            // `null` is an explicit new-conversation boundary. It must not fall
            // through to the last durable thread ref: a user can deselect an
            // open thread and submit before React's synchronization effect has
            // run, and that message still belongs to a fresh thread.
            threadId: continuedThreadId,
            clarificationId: options?.clarificationId,
            choiceKey: options?.choiceKey,
            choiceMessageId: options?.choiceMessageId,
            executionId: options?.executionId,
            batchSelections: options?.batchSelections,
            ...(options?.steerRunId ? { steerRunId: options.steerRunId } : {}),
            ...(options?.agentId !== undefined ? { agentId: options.agentId } : {}),
            ...(open?.length ? { open } : {}),
            ...(selection?.text.trim() ? { selection } : {}),
            ...(options?.references?.length ? { references: options.references } : {}),
            currentView,
            timeZone: userTimeZone(),
            attachments,
          },
          optimisticCardId,
          exchangeId,
          () => {
            window.clearTimeout(beginTimeout);
            settleBegin(true);
          },
          (joinedRunId, joinedPrompt) =>
            setLiveExchange((current) => {
              if (current?.id !== exchangeId) return current;
              const step = { id: `steer:${uniqueToken()}`, title: "Noted your message", summary: joinedPrompt, status: "done" as const, createdAt: Date.now() };
              return previousExchange?.runId === joinedRunId
                ? { ...previousExchange, steps: [...previousExchange.steps, step].slice(-12) }
                : null;
            }),
        )
          .catch((error) => {
            window.clearTimeout(beginTimeout);
            if (!beginSettled)
              setLiveExchange((current) => current?.id === exchangeId ? null : current);
            setCards((current) =>
              current.filter((card) => card.id !== optimisticCardId),
            );
            if (!(
              error instanceof DOMException && error.name === "AbortError"
            )) {
              const message =
                error instanceof Error
                  ? error.message
                  : "Could not start Spectra run.";
              if (message.includes("still responding"))
                toast.error(message, {
                  action: onContinuationConflict
                    ? {
                        label: "Start new thread",
                        onClick: onContinuationConflict,
                      }
                    : undefined,
                });
              else toast.error(message);
            }
            settleBegin(false);
          })
          .finally(() => {
            window.clearTimeout(beginTimeout);
            settleBegin(false);
            setActiveRequestCount((count) => Math.max(0, count - 1));
          });
      });
    },
    [
      artifactId,
      consume,
      currentView,
      onContinuationConflict,
      open,
      selection,
      surface,
      upsert,
      preferences.ai.continueCurrentConversation,
      workspaceId,
      scopeNodeId,
    ],
  );

  const queuedSteering = useRef(new Set<string>());
  /**
   * A message (and files) typed while a run works. It joins that run's next
   * turn. A run that is waiting on a question or approval, or has finished,
   * answers 409; the message then goes to the run as a new turn, where the
   * server lets it answer the question or starts the next run in the thread.
   */
  const steer = useCallback(
    async (
      runId: string,
      text: string,
      nextAttachments: CommandAttachment[] = [],
    ) => {
      const clean = text.trim();
      if ((!clean && !nextAttachments.length) || queuedSteering.current.has(runId)) return false;
      queuedSteering.current.add(runId);
      try {
        const version = await resolveDisplayedRunVersion(runId, true);
        const queued = await requestSpectra("/api/spectra/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "steer",
            runId,
            executionId: version.executionId,
            text: clean,
            submissionKey: crypto.randomUUID(),
            ...(nextAttachments.length ? { attachments: nextAttachments } : {}),
          }),
        });
        if (queued.ok) {
          setLiveExchange((current) =>
            current?.runId === runId
              ? {
                  ...current,
                  steps: [
                    ...current.steps,
                    { id: `steer:${uniqueToken()}`, title: "Noted your message", summary: clean || nextAttachments.map((file) => file.name).join(", "), status: "done" as const, createdAt: Date.now() },
                  ].slice(-12),
                }
              : current,
          );
          return true;
        }
        if (queued.status !== 409)
          throw new Error(
            await spectraFailureMessage(queued, {
              fallback: "Spectra could not take that message just now. Try again.",
              signedOut: "Sign in again to message Spectra.",
            }),
          );
        const threadOfRun =
          displayedRunTabs.current.get(runId)?.threadId ??
          (await getSpectraRunDetail(runId)).run.threadId;
        if (!threadOfRun?.trim())
          throw new Error(
            "This response is not attached to a saved conversation, so it cannot be continued here. Open the conversation and continue there.",
          );
        return await run(clean, nextAttachments, { threadId: threadOfRun, steerRunId: runId });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Spectra could not take that message just now. Try again.",
        );
        return false;
      } finally {
        queuedSteering.current.delete(runId);
      }
    },
    [resolveDisplayedRunVersion, run],
  );

  const keepAsThread = useCallback(
    async (runId: string, placeInWorkspace = false) => {
      const result = await postSpectra<{ threadId: string }>({
        action: "keepRunAsThread",
        runId,
        placeInWorkspace,
        createReference: true,
      });
      await onThreadReady?.(result.threadId);
      await onDataChanged?.();
      return result.threadId;
    },
    [onDataChanged, onThreadReady],
  );

  const onCardAction = useCallback(
    async (
      card: ResultCardStreamView,
      actionKey: string,
      targetId?: string,
    ) => {
      if (actionKey === "hide") {
        dismissedCardIds.current.add(card.id);
        setCards((current) => current.filter((item) => item.id !== card.id));
        setSelectedRunId((current) =>
          current === card.runId ? null : current,
        );
        await postSpectra({
          action: "hideResultCard",
          resultCardId: card.id,
        }).catch((error) =>
          toast.error(
            error instanceof Error ? error.message : "Could not hide result.",
          ),
        );
        return;
      }
      if (actionKey === "open" && targetId) {
        await onOpenArtifact?.(targetId);
        return;
      }
      if (actionKey === "confirm" || actionKey === "cancel") {
        setActiveRequestCount((count) => count + 1);
        try {
          const version = await resolveDisplayedRunVersion(card.runId);
          if (actionKey === "confirm") observeUiRun(card.runId, version.executionId, false);
          await consume({
            action: actionKey,
            runId: card.runId,
            executionId: version.executionId,
            attemptId: version.attemptId,
            ...(actionKey === "confirm" ? { uiObserver: uiObserverForRun(card.runId) } : {}),
          });
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : `Could not ${actionKey} run.`,
          );
        } finally {
          setActiveRequestCount((count) => Math.max(0, count - 1));
        }
        return;
      }
      if (actionKey === "revise" && targetId?.trim()) {
        const clean = targetId.trim();
        setActiveRequestCount((count) => count + 1);
        try {
          const version = await resolveDisplayedRunVersion(card.runId);
          await consume({
            action: "answer",
            runId: card.runId,
            executionId: version.executionId,
            answer: { kind: "approval", allowed: false },
            text: clean,
            timeZone: userTimeZone(),
          });
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not return the proposal for revision.",
          );
        } finally {
          setActiveRequestCount((count) => Math.max(0, count - 1));
        }
        return;
      }
      if (actionKey === "revert") {
        setActiveRequestCount((count) => count + 1);
        try {
          const version = await resolveDisplayedRunVersion(card.runId, true);
          const response = await requestSpectra("/api/spectra/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "revert",
              runId: card.runId,
              executionId: version.executionId,
              attemptId: version.attemptId,
            }),
          });
          if (!response.ok)
            throw new Error(
              await spectraFailureMessage(response, {
                fallback: "Could not undo this run. Try again in a moment.",
                signedOut: "Sign in again to undo this run.",
              }),
            );
          toast.success("Restored the earlier copy of this work.");
          spectraBus.emit("threads.changed", {});
          await onDataChanged?.();
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Could not undo this run.",
          );
        } finally {
          setActiveRequestCount((count) => Math.max(0, count - 1));
        }
        return;
      }
      if (actionKey === "retry") {
        if (!isRetryableRunStatus(card.status)) {
          toast.info("This run is waiting for your reply in this conversation.");
          return;
        }
        toast.dismiss();
        setActiveRequestCount((count) => count + 1);
        try {
          const version = await resolveDisplayedRunVersion(card.runId);
          await consume({
            action: "retry",
            runId: card.runId,
            submissionKey: crypto.randomUUID(),
            executionId: version.executionId,
            attemptId: version.attemptId,
          });
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Could not retry run.",
          );
        } finally {
          setActiveRequestCount((count) => Math.max(0, count - 1));
        }
        return;
      }
      if (actionKey === "keep") {
        await postSpectra({ action: "keepResultCard", resultCardId: card.id })
          .then(() => toast.success("Kept in activity history."))
          .catch((error) =>
            toast.error(
              error instanceof Error ? error.message : "Could not keep run.",
            ),
          );
      }
    },
    [consume, onDataChanged, onOpenArtifact, resolveDisplayedRunVersion],
  );

  /** The user's answer to the run's open question or approval. */
  const answer = useCallback(
    async (runId: string, toolCallId: string, value: HarnessAnswerValue) => {
      setActiveRequestCount((count) => count + 1);
      try {
        const version = await resolveDisplayedRunVersion(runId);
        const allowed = value.kind === "approval" && value.allowed;
        if (allowed) observeUiRun(runId, version.executionId, false);
        const shown = liveExchangeRef.current;
        const exchangeId = shown?.runId === runId ? shown.id : `answer:${uniqueToken()}`;
        setLiveExchange((current) =>
          current?.runId === runId
            ? { ...current, id: exchangeId, status: "streaming" }
            : {
                id: exchangeId,
                runId,
                threadId: durableThreadId.current,
                prompt: promptByRun.current.get(runId) ?? "",
                content: "",
                steps: [],
                status: "streaming",
                startedAt: Date.now(),
              },
        );
        await consume(
          {
            action: "answer",
            runId,
            executionId: version.executionId,
            toolCallId,
            answer: value,
            timeZone: userTimeZone(),
            ...(allowed ? { uiObserver: uiObserverForRun(runId) } : {}),
          },
          undefined,
          exchangeId,
        );
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Spectra could not take that answer. Try again.");
        spectraBus.emit("threads.changed", {});
        return false;
      } finally {
        setActiveRequestCount((count) => Math.max(0, count - 1));
      }
    },
    [consume, resolveDisplayedRunVersion],
  );

  /** "Suggest changes" on an approval: not this, and here is what to do instead. */
  const revise = useCallback(
    async (card: ResultCardStreamView, revision: string) => {
      const clean = revision.trim();
      if (!clean) return false;
      setActiveRequestCount((count) => count + 1);
      try {
        const version = await resolveDisplayedRunVersion(card.runId);
        await consume({
          action: "answer",
          runId: card.runId,
          executionId: version.executionId,
          answer: { kind: "approval", allowed: false },
          text: clean,
          timeZone: userTimeZone(),
        });
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Spectra could not take that suggestion. Try again.",
        );
        return false;
      } finally {
        setActiveRequestCount((count) => Math.max(0, count - 1));
      }
    },
    [consume, resolveDisplayedRunVersion],
  );

  const openDetails = useCallback(
    (card: ResultCardStreamView) => setSelectedRunId(card.runId),
    [],
  );
  const closeDetails = useCallback(() => setSelectedRunId(null), []);

  const liveExchangeId = liveExchange?.id;
  const liveExchangeRunId = liveExchange?.runId;
  const stop = useCallback(
    async (runId?: string) => {
      const targetRunId =
        runId ?? liveExchangeRunId ?? observedContinuationRunId;
      const submissionKey = liveExchangeId;
      if (!targetRunId && !submissionKey) return;
      setStopSuppressed(true);

      // Stop is locally immediate. Durable cancellation follows with either the
      // acknowledged run id or the idempotent submission key used to create it.
      // This prevents a slow provider/request stream from leaving the red stop
      // control visibly stuck while the server settles the same execution.
      activeRequests.current.forEach((request, controller) => {
        if (
          (targetRunId && request.runId === targetRunId) ||
          (!targetRunId &&
            request.runId === null &&
            request.exchangeId === submissionKey)
        ) {
          controller.abort();
          activeRequests.current.delete(controller);
        }
      });
      if (targetRunId) {
        activeRunIds.current.delete(targetRunId);
        publishActiveRuns();
      }
      setActiveRequestCount((count) => Math.max(0, count - 1));
      setLiveExchange((current) =>
        current &&
        ((!targetRunId && current.id === submissionKey) ||
          current.runId === targetRunId)
          ? null
          : current,
      );
      if (targetRunId)
        setCards((current) =>
          current.map((card) =>
            card.runId === targetRunId
              ? {
                  ...card,
                  status: "cancelled",
                  title: "Stopped",
                  summary:
                    "Stopped by you. Any completed work remains available.",
                   actions: [],
                  updatedAt: Date.now(),
                }
              : card,
          ),
        );
      else
        setCards((current) =>
          current.filter((card) => card.runId !== `pending:${submissionKey}`),
        );
      try {
        let executionId: string | undefined;
        let attemptId: string | undefined;
        const pendingSubmissionKey =
          !targetRunId || liveExchangeRunId === targetRunId
            ? submissionKey
            : undefined;
        if (targetRunId) {
          const displayed = await resolveDisplayedRunVersion(targetRunId);
          executionId = displayed.executionId;
          attemptId = displayed.attemptId;
        }
        const response = await requestSpectra("/api/spectra/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "stop",
            ...(targetRunId && executionId ? { runId: targetRunId } : {}),
            ...(pendingSubmissionKey
              ? { submissionKey: pendingSubmissionKey }
              : {}),
            ...(executionId ? { executionId } : {}),
            ...(attemptId ? { attemptId } : {}),
          }),
        });
        if (!response.ok) {
          // The durable worker may have settled while this browser still owns
          // a buffered SSE request. A conflict means there is nothing left to
          // cancel remotely; do not let that obsolete request mask the durable
          // terminal state forever.
          if (response.status === 409) {
            spectraBus.emit("threads.changed", {});
            await onDataChanged?.();
            return;
          }
          throw new Error(
            await spectraFailureMessage(response, STOP_FAILURE_COPY),
          );
        }
        spectraBus.emit("threads.changed", {});
        await onDataChanged?.();
      } catch (error) {
        setStopSuppressed(false);
        toast.error(
          error instanceof Error
            ? error.message
            : "This run can no longer be stopped safely.",
        );
      }
    },
    [
      liveExchangeId,
      liveExchangeRunId,
      observedContinuationRunId,
      onDataChanged,
      publishActiveRuns,
      resolveDisplayedRunVersion,
    ],
  );

  const retry = useCallback(
    async (runId: string) => {
      toast.dismiss();
      const exchangeId = crypto.randomUUID();
      setStopSuppressed(false);
      setActiveRequestCount((count) => count + 1);
      setLiveExchange({
        id: exchangeId,
        runId,
        threadId: durableThreadId.current,
        prompt:
          promptByRun.current.get(runId) ?? "Continue from the last safe point",
        content: "",
        steps: [
          {
            id: `retry:${exchangeId}`,
            title: "Resuming from the last safe point",
            status: "running",
            createdAt: Date.now(),
          },
        ],
        status: "starting",
        startedAt: Date.now(),
      });
      try {
        const version = await resolveDisplayedRunVersion(runId);
        await consume(
          {
            action: "retry",
            runId,
            submissionKey: crypto.randomUUID(),
            executionId: version.executionId,
            attemptId: version.attemptId,
            timeZone: userTimeZone(),
          },
          undefined,
          exchangeId,
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not retry run.",
        );
      } finally {
        setActiveRequestCount((count) => Math.max(0, count - 1));
      }
    },
    [consume, resolveDisplayedRunVersion],
  );

  const submitting =
    !stopSuppressed &&
    (activeRequestCount > 0 || Boolean(observedContinuationRunId) ||
      liveExchange?.status === "streaming");
  return useMemo(
    () => ({
      cards,
      submitting,
      liveExchange,
      activeRunId:
        observedContinuationRunId ??
        (submitting ? liveExchange?.runId : undefined),
      run,
      stop,
      retry,
      revise,
      answer,
      steer,
      onCardAction,
      selectedRunId,
      openDetails,
      closeDetails,
      keepAsThread,
    }),
    [
      cards,
      closeDetails,
      keepAsThread,
      liveExchange,
      observedContinuationRunId,
      onCardAction,
      openDetails,
      retry,
      revise,
      answer,
      steer,
      run,
      selectedRunId,
      stop,
      submitting,
    ],
  );
}
