"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { uniqueToken } from "@/lib/unique-token";
import {
  parseSpectraStreamEvent,
  type ResultCardStreamView,
} from "./stream-events";
import {
  getSpectraRunEvents,
  getSpectraRunTabs,
  postSpectra,
  type SpectraResultCard,
} from "../data/api";
import type { CommandAttachment } from "../components/command-bar";
import { getRunLedger, recordRunEvent } from "../collaboration/run-ledger";
import { noteAiLocation } from "../collaboration/follow-ai";
import { publishArtifactAiActivity } from "../collaboration/artifact-ai-activity";

/**
 * Artifact ids the run feed has published coarse activity for, per run, so a
 * terminal event clears exactly the cards it lit. An open studio publishes
 * richer, actor-named activity over the same store and always wins.
 */
const runFeedArtifacts = new Map<string, Set<string>>();
const RUN_FEED_SOURCE = "run-feed";

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
      // Follow AI: work may be happening in an artifact that is not open.
      {
        const artifactId =
          event.preview?.pendingArtifactId ?? event.preview?.targetId;
        if (artifactId) {
          noteAiLocation({
            artifactId,
            ...(event.preview?.title ? { note: event.preview.title } : {}),
          });
          // Artifact cards tell the same story even while the editor is closed.
          if (event.preview?.title) {
            let published = runFeedArtifacts.get(runId);
            if (!published) {
              published = new Set();
              runFeedArtifacts.set(runId, published);
            }
            published.add(artifactId);
            publishArtifactAiActivity(artifactId, RUN_FEED_SOURCE, {
              phase: "editing",
              detail: event.preview.title,
            });
          }
        }
      }
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
      break;
    case "status":
      recordRunEvent({ type: event.type, runId, message: event.message });
      break;
    case "error":
      recordRunEvent({ type: event.type, runId, message: event.message });
      clearRunFeedActivity(runId);
      break;
    default:
      break;
  }
}

export type SpectraRunSurface = "chat" | "workspace" | "artifacts" | "artifact";
export type SpectraLiveExchange = {
  id: string;
  runId?: string;
  prompt: string;
  content: string;
  steps: Array<{
    id: string;
    title: string;
    summary?: string;
    status: "running" | "done" | "error";
    createdAt: number;
  }>;
  status: "starting" | "streaming" | "failed";
  startedAt: number;
};

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

export function useSpectraRun({
  surface,
  workspaceId,
  artifactId,
  threadId,
  initialCards = EMPTY_INITIAL_CARDS,
  onDataChanged,
  onArtifactPatch,
  onOpenArtifact,
  onThreadReady,
  onFinal,
  onContinuationConflict,
  focusMode,
  selectedArtifactIds = [],
  explicitContextObjects = [],
  currentView,
  observeDurableRuns = true,
}: {
  surface: SpectraRunSurface;
  workspaceId?: string;
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
  focusMode?: "global" | "workspace" | "artifact" | "selection" | "thread";
  selectedArtifactIds?: string[];
  explicitContextObjects?: Array<{
    type: "artifact" | "workspace" | "thread";
    id: string;
    label?: string;
    workspaceId?: string;
    semanticTargetId?: string;
    semanticAnchor?: Record<string, unknown>;
    contextSummary?: string;
  }>;
  currentView?: string;
  observeDurableRuns?: boolean;
}) {
  const [cards, setCards] = useState<ResultCardStreamView[]>(() =>
    initialCards.map(persistedToStream),
  );
  const [activeRequestCount, setActiveRequestCount] = useState(0);
  const [stopSuppressed, setStopSuppressed] = useState(false);
  const [observedContinuationRunId, setObservedContinuationRunId] = useState<
    string | null
  >(null);
  const [liveExchange, setLiveExchange] = useState<SpectraLiveExchange | null>(
    null,
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const promptByRun = useRef(new Map<string, string>());
  const dismissedCardIds = useRef(new Set<string>());
  const activeRequests = useRef(new Map<AbortController, string | null>());
  const activeRunIds = useRef(new Set<string>());
  const eventCursors = useRef(new Map<string, number>());
  // A streamed patch can arrive while the user is inside another artifact or
  // a thread panel, before the newly-created shell exists in this view's
  // overview snapshot. Bootstrap that canonical shell once, then serialize
  // its real patches behind the refresh. Without this boundary every patch is
  // correctly persisted by the backend but silently dropped by the client
  // reducer until the terminal full refresh.
  const artifactPatchQueues = useRef(new Map<string, Promise<unknown>>());
  const durableThreadId = useRef(threadId);
  const selectedKey = selectedArtifactIds.join(",");
  const scopeKey = `${surface}:${workspaceId ?? ""}:${artifactId ?? ""}:${threadId ?? ""}:${focusMode ?? ""}:${selectedKey}`;
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
      setCards((current) =>
        current.length === 0 && sanitized.length === 0 ? current : sanitized,
      );
    } else {
      setCards((current) => mergeCards(current, sanitized));
    }
    initialCards.forEach((card) => {
      if (card.run?.userPrompt)
        promptByRun.current.set(card.runId, card.run.userPrompt);
    });
  }, [initialCards, scopeKey]);

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
    const poll = async () => {
      let observedActive = false;
      try {
        const { runTabs } = await getSpectraRunTabs({ limit: 120 });
        if (disposed) return;
        const relevant = runTabs.filter((tab) => {
          if (threadId) return tab.threadId === threadId;
          if (artifactId) return tab.run.artifactId === artifactId;
          if (workspaceId) return tab.workspaceId === workspaceId;
          return (
            tab.surface === (surface === "artifacts" ? "artifact" : surface)
          );
        });
        const active = relevant.filter(
          (tab) =>
            tab.run.status === "queued" ||
            tab.run.status === "running" ||
            tab.run.status === "awaiting_confirmation" ||
            tab.run.status === "awaiting_resolution",
        );
        observedActive = active.length > 0;
        setObservedContinuationRunId(
          threadId ? (active[0]?.runId ?? null) : null,
        );
        const observed = relevant.filter(
          (tab) =>
            active.some((row) => row.runId === tab.runId) ||
            eventCursors.current.has(tab.runId),
        );
        for (const tab of observed) {
          if (activeRunIds.current.has(tab.runId)) continue;
          const after = eventCursors.current.get(tab.runId) ?? 0;
          const { events } = await getSpectraRunEvents(tab.runId, after);
          if (disposed) return;
          let reachedTerminalEvent = false;
          for (const row of events.sort((a, b) => a.sequence - b.sequence)) {
            if (row.sequence <= (eventCursors.current.get(tab.runId) ?? 0))
              continue;
            eventCursors.current.set(tab.runId, row.sequence);
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
            if (
              event.type === "text_delta" ||
              event.type === "text_replace" ||
              event.type === "progress" ||
              event.type === "operation_preview" ||
              event.type === "status"
            ) {
              setLiveExchange((current) => {
                const base =
                  current?.runId === tab.runId
                    ? current
                    : {
                        id: `durable:${tab.runId}`,
                        runId: tab.runId,
                        prompt: tab.run.userPrompt,
                        content: "",
                        steps: [],
                        status: "streaming" as const,
                        startedAt: tab.run.createdAt,
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
                return base;
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
            )
              reachedTerminalEvent = true;
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
                  promptByRun.current.get(tab.runId) ?? tab.run.userPrompt,
              });
            }
          }
          if (reachedTerminalEvent) eventCursors.current.delete(tab.runId);
        }
      } catch {
        // A transient observer failure must not interrupt the authoritative run.
      } finally {
        if (!disposed)
          // Active runs poll aggressively so first progress meets the <5s
          // budget; idle tabs stay quiet. Hidden tabs keep a slow heartbeat.
          timer = window.setTimeout(
            poll,
            document.visibilityState === "visible"
              ? observedActive
                ? 750
                : 12_000
              : 20_000,
          );
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
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
    ) => {
      const controller = new AbortController();
      let requestRunId: string | null = null;
      activeRequests.current.set(controller, null);
      const response = await fetch("/api/spectra/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error(
          (await response.text().catch(() => "")) ||
            `Spectra run failed (${response.status}).`,
        );
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let changed = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = parseSpectraStreamEvent(JSON.parse(line));
          feedLedger(event);
          if (event.type === "run_created") {
            if (optimisticCardId)
              setCards((current) =>
                current.filter((card) => card.id !== optimisticCardId),
              );
            if (typeof body.prompt === "string")
              promptByRun.current.set(event.runId, body.prompt);
            setLiveExchange((current) =>
              current && (!liveExchangeId || current.id === liveExchangeId)
                ? { ...current, runId: event.runId }
                : current,
            );
            activeRunIds.current.add(event.runId);
            requestRunId = event.runId;
            activeRequests.current.set(controller, event.runId);
            onAcknowledged?.(event.runId);
            window.dispatchEvent(new Event("spectra:threads-changed"));
          }
          if (event.type === "thread_ready") {
            durableThreadId.current = event.threadId;
            void onThreadReady?.(event.threadId);
          }
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
            changed = true;
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
            window.dispatchEvent(new Event("spectra:threads-changed"));
            void onFinal?.({
              runId: event.runId,
              summary: event.summary,
              prompt: promptByRun.current.get(event.runId) ?? "",
            });
          }
          if (event.type === "final" || event.type === "confirmation_required")
            changed = true;
        }
        if (done) break;
      }
      if (changed) await onDataChanged?.();
      activeRequests.current.delete(controller);
      if (requestRunId) activeRunIds.current.delete(requestRunId);
    },
    [dispatchArtifactPatch, onDataChanged, onFinal, onThreadReady, upsert],
  );

  const run = useCallback(
    (
      prompt: string,
      attachments: CommandAttachment[] = [],
      options?: { threadId?: string },
    ): Promise<boolean> => {
      const clean = prompt.trim();
      if (!clean) return Promise.resolve(false);
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
        setLiveExchange({
          id: exchangeId,
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
        // If the route never acknowledges the run (gateway hang / stuck worker),
        // fail closed so QC is not glued on "Starting…" forever.
        const beginTimeout = window.setTimeout(() => {
          if (beginSettled) return;
          for (const [controller, requestRunId] of activeRequests.current) {
            if (!requestRunId || requestRunId.startsWith("pending:")) {
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
            "Spectra could not start that run. Check the collaboration gateway and try again.",
          );
          settleBegin(false);
        }, 20_000);
        void consume(
          {
            action: "run",
            submissionKey: exchangeId,
            prompt: clean,
            surface,
            workspaceId,
            artifactId,
            threadId: options?.threadId ?? durableThreadId.current,
            focusMode,
            selectedArtifactIds,
            explicitContextObjects,
            currentView,
            attachments,
          },
          optimisticCardId,
          exchangeId,
          () => {
            window.clearTimeout(beginTimeout);
            settleBegin(true);
          },
        )
          .catch((error) => {
            window.clearTimeout(beginTimeout);
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
            setLiveExchange((current) =>
              current?.id === exchangeId ? null : current,
            );
          });
      });
    },
    [
      artifactId,
      consume,
      currentView,
      explicitContextObjects,
      focusMode,
      onContinuationConflict,
      selectedArtifactIds,
      surface,
      upsert,
      workspaceId,
    ],
  );

  const queuedSteering = useRef(new Set<string>());
  const steer = useCallback(
    async (
      runId: string,
      mode:
        | "refine_current_goal"
        | "redirect_next_step"
        | "replace_goal"
        | "cancel_current_action",
      text: string,
    ) => {
      const clean = text.trim();
      if (!clean || queuedSteering.current.has(runId)) return false;
      queuedSteering.current.add(runId);
      try {
        await consume({
          action: "steer",
          runId,
          steerMode: mode,
          steerText: clean,
        });
        toast.message("Will apply after the current step.");
        if (mode === "cancel_current_action") {
          await consume({ action: "stop", runId });
          queuedSteering.current.delete(runId);
          return true;
        }
        void (async () => {
          for (let attempt = 0; attempt < 400; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 1_500));
            const { runTabs } = await getSpectraRunTabs({ limit: 120, force: true }).catch(() => ({ runTabs: [] }));
            const target = runTabs.find((tab) => tab.runId === runId);
            if (!target) continue;
            if (["queued", "running", "awaiting_confirmation", "awaiting_resolution"].includes(target.run.status)) continue;
            await run(clean, [], { threadId: target.threadId });
            break;
          }
          queuedSteering.current.delete(runId);
        })();
        return true;
      } catch (error) {
        queuedSteering.current.delete(runId);
        toast.error(error instanceof Error ? error.message : "Could not queue steering.");
        return false;
      }
    },
    [consume, run],
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
          await consume({ action: actionKey, runId: card.runId });
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
          await consume({
            action: "revise",
            runId: card.runId,
            revision: clean,
          });
          await run(`Revise the pending proposal with this feedback: ${clean}`);
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
      if (actionKey === "retry") {
        toast.dismiss();
        setActiveRequestCount((count) => count + 1);
        try {
          await consume({
            action: "retry",
            runId: card.runId,
            submissionKey: crypto.randomUUID(),
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
    [consume, onOpenArtifact, run],
  );

  const revise = useCallback(
    async (card: ResultCardStreamView, revision: string) => {
      const clean = revision.trim();
      if (!clean) return false;
      setActiveRequestCount((count) => count + 1);
      try {
        await consume({ action: "revise", runId: card.runId, revision: clean });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not return the proposal for revision.",
        );
        return false;
      } finally {
        setActiveRequestCount((count) => Math.max(0, count - 1));
      }
      return run(`Revise the pending proposal with this feedback: ${clean}`);
    },
    [consume, run],
  );

  const openDetails = useCallback(
    (card: ResultCardStreamView) => setSelectedRunId(card.runId),
    [],
  );
  const closeDetails = useCallback(() => setSelectedRunId(null), []);

  const stop = useCallback(
    async (runId?: string) => {
      const targetRunId =
        runId ?? liveExchange?.runId ?? observedContinuationRunId;
      const submissionKey = liveExchange?.id;
      if (!targetRunId && !submissionKey) return;
      setStopSuppressed(true);

      // Stop is locally immediate. Durable cancellation follows with either the
      // acknowledged run id or the idempotent submission key used to create it.
      // This prevents a slow provider/request stream from leaving the red stop
      // control visibly stuck while the server settles the same execution.
      activeRequests.current.forEach((requestRunId, controller) => {
        if (
          (targetRunId && requestRunId === targetRunId) ||
          (!targetRunId && requestRunId === null)
        ) {
          controller.abort();
          activeRequests.current.delete(controller);
        }
      });
      if (targetRunId) activeRunIds.current.delete(targetRunId);
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
                  actions: [
                    {
                      key: "retry",
                      label: "Retry",
                      targetType: "run",
                      targetId: targetRunId,
                    },
                  ],
                  updatedAt: Date.now(),
                }
              : card,
          ),
        );
      else
        setCards((current) =>
          current.filter(
            (card) => card.runId !== `pending:${submissionKey}`,
          ),
        );
      try {
        const response = await fetch("/api/spectra/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "stop",
            runId: targetRunId,
            submissionKey,
          }),
        });
        if (!response.ok) {
          // The durable worker may have settled while this browser still owns
          // a buffered SSE request. A conflict means there is nothing left to
          // cancel remotely; do not let that obsolete request mask the durable
          // terminal state forever.
          if (response.status === 409) {
            window.dispatchEvent(new Event("spectra:threads-changed"));
            await onDataChanged?.();
            return;
          }
          throw new Error(
            (await response.text().catch(() => "")) ||
              "This run can no longer be stopped safely.",
          );
        }
        window.dispatchEvent(new Event("spectra:threads-changed"));
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
      liveExchange?.id,
      liveExchange?.runId,
      observedContinuationRunId,
      onDataChanged,
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
        await consume(
          { action: "retry", runId, submissionKey: crypto.randomUUID() },
          undefined,
          exchangeId,
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not retry run.",
        );
      } finally {
        setActiveRequestCount((count) => Math.max(0, count - 1));
        setLiveExchange((current) =>
          current?.id === exchangeId ? null : current,
        );
      }
    },
    [consume],
  );

  const submitting =
    !stopSuppressed &&
    (activeRequestCount > 0 || Boolean(observedContinuationRunId));
  return useMemo(
    () => ({
      cards,
      submitting,
      liveExchange,
      run,
      stop,
      retry,
      revise,
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
      onCardAction,
      openDetails,
      retry,
      revise,
      steer,
      run,
      selectedRunId,
      stop,
      submitting,
    ],
  );
}
