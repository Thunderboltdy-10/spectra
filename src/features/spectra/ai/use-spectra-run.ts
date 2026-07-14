"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { parseSpectraStreamEvent, type ResultCardStreamView } from "./stream-events";
import { getSpectraRunEvents, getSpectraRunTabs, postSpectra, type SpectraResultCard } from "../data/api";
import type { CommandAttachment } from "../components/command-bar";

export type SpectraRunSurface = "chat" | "workspace" | "artifacts" | "artifact";
export type SpectraLiveExchange = {
  id: string;
  runId?: string;
  prompt: string;
  content: string;
  steps: Array<{ id: string; title: string; summary?: string; status: "running" | "done" | "error"; createdAt: number }>;
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

function mergeCards(current: ResultCardStreamView[], incoming: ResultCardStreamView[]) {
  const byId = new Map(current.map((card) => [card.id, card]));
  incoming.forEach((card) => {
    const existing = byId.get(card.id);
    if (!existing || card.updatedAt >= existing.updatedAt) byId.set(card.id, card);
  });
  const merged = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const unchanged = current.length === merged.length && current.every((card, index) => {
    const next = merged[index];
    return next
      && card.id === next.id
      && card.runId === next.runId
      && card.status === next.status
      && card.title === next.title
      && card.summary === next.summary
      && card.variant === next.variant
      && card.updatedAt === next.updatedAt
      && card.actions.length === next.actions.length
      && card.actions.every((action, actionIndex) => {
        const nextAction = next.actions[actionIndex];
        return nextAction
          && action.key === nextAction.key
          && action.label === nextAction.label
          && action.targetType === nextAction.targetType
          && action.targetId === nextAction.targetId;
      });
  });
  return unchanged ? current : merged;
}

function statusTitle(message: string) {
  const authoredTitle = message.split(" · ")[0]?.trim();
  if (message.includes(" · ") && authoredTitle) return authoredTitle;
  if (/review|reading|context/i.test(message)) return "Reading context";
  if (/validating|analys|resolving|loading|sending/i.test(message)) return "Resolving the request";
  if (/saving|creating|updating|adding|removing/i.test(message)) return "Updating workspace";
  return "Preparing the result";
}

function appendStep(exchange: SpectraLiveExchange, message: string): SpectraLiveExchange {
  const last = exchange.steps.at(-1);
  if (last?.summary === message && last.status === "running") return exchange;
  const title = statusTitle(message);
  const summary = message.includes(" · ") ? message.slice(message.indexOf(" · ") + 3).trim() : message;
  const existingIndex = exchange.steps.findIndex((step) => step.title === title);
  if (existingIndex >= 0) {
    return {
      ...exchange,
      steps: exchange.steps.map((step, index) => index === existingIndex
        ? { ...step, summary, status: "running" as const }
        : step.status === "running" ? { ...step, status: "done" as const } : step),
    };
  }
  return {
    ...exchange,
    steps: [
      ...exchange.steps.map((step, index) => index === exchange.steps.length - 1 && step.status === "running" ? { ...step, status: "done" as const } : step),
      { id: `${exchange.runId ?? exchange.id}:${exchange.steps.length}:${Date.now()}`, title, summary, status: "running" as const, createdAt: Date.now() },
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
  onArtifactPatch?: (artifactId: string, patch: Record<string, unknown>) => Promise<unknown> | unknown;
  onOpenArtifact?: (artifactId: string) => Promise<unknown> | unknown;
  onThreadReady?: (threadId: string) => Promise<unknown> | unknown;
  onFinal?: (result: { runId: string; summary: string; prompt: string }) => Promise<unknown> | unknown;
  onContinuationConflict?: () => void;
  focusMode?: "global" | "workspace" | "artifact" | "selection" | "thread";
  selectedArtifactIds?: string[];
  explicitContextObjects?: Array<{ type: "artifact" | "workspace" | "thread"; id: string; label?: string; workspaceId?: string }>;
  currentView?: string;
  observeDurableRuns?: boolean;
}) {
  const [cards, setCards] = useState<ResultCardStreamView[]>(() => initialCards.map(persistedToStream));
  const [activeRequestCount, setActiveRequestCount] = useState(0);
  const [observedContinuationRunId, setObservedContinuationRunId] = useState<string | null>(null);
  const [liveExchange, setLiveExchange] = useState<SpectraLiveExchange | null>(null);
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

  useEffect(() => { durableThreadId.current = threadId; }, [threadId]);

  useEffect(() => {
    const incoming = initialCards.filter((card) => !card.hiddenAt && !dismissedCardIds.current.has(card._id)).map(persistedToStream);
    if (previousScopeKey.current !== scopeKey) {
      previousScopeKey.current = scopeKey;
      setCards((current) => current.length === 0 && incoming.length === 0 ? current : incoming);
    } else {
      setCards((current) => mergeCards(current, incoming));
    }
    initialCards.forEach((card) => {
      if (card.run?.userPrompt) promptByRun.current.set(card.runId, card.run.userPrompt);
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
          return tab.surface === (surface === "artifacts" ? "artifact" : surface);
        });
        const active = relevant.filter((tab) => tab.run.status === "queued" || tab.run.status === "running" || tab.run.status === "awaiting_confirmation");
        observedActive = active.length > 0;
        setObservedContinuationRunId(threadId ? active[0]?.runId ?? null : null);
        const observed = relevant.filter((tab) => active.some((row) => row.runId === tab.runId) || eventCursors.current.has(tab.runId));
        for (const tab of observed) {
          if (activeRunIds.current.has(tab.runId)) continue;
          const after = eventCursors.current.get(tab.runId) ?? 0;
          const { events } = await getSpectraRunEvents(tab.runId, after);
          if (disposed) return;
          let reachedTerminalEvent = false;
          for (const row of events.sort((a, b) => a.sequence - b.sequence)) {
            if (row.sequence <= (eventCursors.current.get(tab.runId) ?? 0)) continue;
            eventCursors.current.set(tab.runId, row.sequence);
            let event: ReturnType<typeof parseSpectraStreamEvent>;
            try { event = parseSpectraStreamEvent(row.payload); } catch { continue; }
            if (event.type === "run_created" || event.type === "result_card" || event.type === "confirmation_required" || event.type === "final") upsert(event.card);
            if (event.type === "text_delta" || event.type === "text_replace" || event.type === "status" || event.type === "operation_preview" || event.type === "operation_result") {
              setLiveExchange((current) => {
                const base = current?.runId === tab.runId ? current : {
                  id: `durable:${tab.runId}`,
                  runId: tab.runId,
                  prompt: tab.run.userPrompt,
                  content: "",
                  steps: [],
                  status: "streaming" as const,
                  startedAt: tab.run.createdAt,
                };
                if (event.type === "text_delta") return { ...base, content: base.content + event.content, status: "streaming" };
                if (event.type === "text_replace") return { ...base, content: event.content, status: "streaming" };
                if (event.type === "status") return appendStep(base, event.message);
                if (event.type === "operation_preview" && event.preview) return appendStep(base, event.preview.title);
                if (event.type === "operation_result") return appendStep(base, "Checking result");
                return base;
              });
            }
            if (event.type === "artifact_patch") dispatchArtifactPatch(event.artifactId, event.patch);
            if (event.type === "run_created" || event.type === "thread_ready" || event.type === "operation_preview" || event.type === "operation_result" || event.type === "confirmation_required" || event.type === "approval_accepted" || event.type === "approval_rejected" || event.type === "choice_selected" || event.type === "interrupted" || event.type === "final") void onDataChanged?.();
            // Durable history can replay an older attempt's terminal event
            // while a retry is already active. Its card keeps the history;
            // only the live request path raises a toast for a current failure.
            if (event.type === "error" || event.type === "stopped" || event.type === "interrupted") setLiveExchange((current) => current?.runId === tab.runId ? null : current);
            if (event.type === "error" || event.type === "stopped" || event.type === "interrupted" || event.type === "final") reachedTerminalEvent = true;
            if (event.type === "confirmation_required") setLiveExchange((current) => current?.runId === tab.runId ? null : current);
            if (event.type === "final") {
              setLiveExchange((current) => current?.runId === tab.runId ? null : current);
              void onFinal?.({ runId: tab.runId, summary: event.summary, prompt: promptByRun.current.get(tab.runId) ?? tab.run.userPrompt });
            }
          }
          if (reachedTerminalEvent) eventCursors.current.delete(tab.runId);
        }
      } catch {
        // A transient observer failure must not interrupt the authoritative run.
      } finally {
        if (!disposed)
          timer = window.setTimeout(
            poll,
            document.visibilityState === "visible"
              ? observedActive
                ? 2_500
                : 12_000
              : 20_000,
          );
      }
    };
    void poll();
    return () => { disposed = true; if (timer) window.clearTimeout(timer); };
  }, [artifactId, dispatchArtifactPatch, observeDurableRuns, onDataChanged, onFinal, surface, threadId, upsert, workspaceId]);

  const consume = useCallback(async (body: Record<string, unknown>, optimisticCardId?: string, liveExchangeId?: string, onAcknowledged?: (runId: string) => void) => {
    const controller = new AbortController();
    let requestRunId: string | null = null;
    activeRequests.current.set(controller, null);
    const response = await fetch("/api/spectra/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error((await response.text().catch(() => "")) || `Spectra run failed (${response.status}).`);
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
        if (event.type === "run_created" && typeof body.prompt === "string") {
          if (optimisticCardId) setCards((current) => current.filter((card) => card.id !== optimisticCardId));
          promptByRun.current.set(event.runId, body.prompt);
          setLiveExchange((current) => current && (!liveExchangeId || current.id === liveExchangeId) ? { ...current, runId: event.runId } : current);
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
        if (event.type === "text_delta") setLiveExchange((current) => current && (!liveExchangeId || current.id === liveExchangeId) ? { ...current, runId: event.runId, content: current.content + event.content, status: "streaming" } : current);
        if (event.type === "text_replace") setLiveExchange((current) => current && (!liveExchangeId || current.id === liveExchangeId) ? { ...current, runId: event.runId, content: event.content, status: "streaming" } : current);
        if (event.type === "run_created" || event.type === "result_card" || event.type === "confirmation_required" || event.type === "final") upsert(event.card);
        if (event.type === "error") {
          if (event.card) upsert(event.card);
          changed = true;
          toast.error(event.message);
          setLiveExchange((current) => current && (!liveExchangeId || current.id === liveExchangeId) ? { ...current, status: "failed" } : current);
        }
        if (event.type === "stopped" || event.type === "interrupted") changed = true;
        if (event.type === "status") {
          setLiveExchange((current) => current && (!liveExchangeId || current.id === liveExchangeId) ? appendStep({ ...current, runId: event.runId, status: "streaming" }, event.message) : current);
          setCards((current) => current.map((card) => card.runId === event.runId ? {
            ...card,
            status: "running",
            title: event.message.startsWith("Saving") ? "Saving changes" : event.message.startsWith("Validating") ? "Validating changes" : statusTitle(event.message),
            summary: event.message,
            updatedAt: Date.now(),
          } : card));
        }
        if (event.type === "operation_preview" && event.preview) {
          setCards((current) => current.map((card) => card.runId === event.runId ? { ...card, title: event.preview!.action === "create" ? "Creating" : event.preview!.action === "update" ? "Updating" : "Working", summary: event.preview!.title, updatedAt: Date.now() } : card));
          if (event.preview.pendingArtifactId) { changed = true; void onDataChanged?.(); }
        }
        if (event.type === "operation_result") { changed = true; void onDataChanged?.(); }
        if (event.type === "artifact_patch") { changed = true; dispatchArtifactPatch(event.artifactId, event.patch); }
        if (event.type === "operation_preview" && event.preview) {
          const action = event.preview.action === "create" ? "Creating" : event.preview.action === "update" ? "Updating" : event.preview.action === "archive" ? "Preparing archive" : event.preview.action === "workspace" ? "Organizing" : "Connecting";
          const title = /^(creating|updating|organizing|connecting|preparing)\b/i.test(event.preview.title) ? event.preview.title.replace(/^Preparing\b/i, action) : `${action} ${event.preview.title}`;
          setLiveExchange((current) => current && (!liveExchangeId || current.id === liveExchangeId) ? appendStep({ ...current, runId: event.runId, status: "streaming" }, `${title} · Applying the validated change to the visible workspace`) : current);
        }
        if (event.type === "operation_result") {
          setLiveExchange((current) => current && (!liveExchangeId || current.id === liveExchangeId) ? appendStep({ ...current, runId: event.runId, status: "streaming" }, "Checking result") : current);
        }
        if (event.type === "final") {
          setLiveExchange((current) => current && (!liveExchangeId || current.id === liveExchangeId) ? { ...current, runId: event.runId, steps: current.steps.map((step) => step.status === "running" ? { ...step, status: "done" } : step), status: "streaming" } : current);
          window.dispatchEvent(new Event("spectra:threads-changed"));
          void onFinal?.({ runId: event.runId, summary: event.summary, prompt: promptByRun.current.get(event.runId) ?? "" });
        }
        if (event.type === "final" || event.type === "confirmation_required") changed = true;
      }
      if (done) break;
    }
    if (changed) await onDataChanged?.();
    activeRequests.current.delete(controller);
    if (requestRunId) activeRunIds.current.delete(requestRunId);
  }, [dispatchArtifactPatch, onDataChanged, onFinal, onThreadReady, upsert]);

  const run = useCallback((prompt: string, attachments: CommandAttachment[] = []): Promise<boolean> => {
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
      setActiveRequestCount((count) => count + 1);
      setLiveExchange({ id: exchangeId, prompt: clean, content: "", steps: [{ id: `${exchangeId}:start`, title: "Starting with your context", summary: "Keeping your workspace ready", status: "running", createdAt: Date.now() }], status: "starting", startedAt: Date.now() });
      upsert({ id: optimisticCardId, runId: `pending:${exchangeId}`, status: "running", title: "Resolving the request", summary: clean, variant: "status", actions: [], updatedAt: Date.now() });
      void consume(
        { action: "run", submissionKey: exchangeId, prompt: clean, surface, workspaceId, artifactId, threadId: durableThreadId.current, focusMode, selectedArtifactIds, explicitContextObjects, currentView, attachments },
        optimisticCardId,
        exchangeId,
        () => settleBegin(true),
      ).catch((error) => {
        setCards((current) => current.filter((card) => card.id !== optimisticCardId));
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          const message = error instanceof Error ? error.message : "Could not start Spectra run.";
          if (message.includes("still responding")) toast.error(message, { action: onContinuationConflict ? { label: "Start new thread", onClick: onContinuationConflict } : undefined });
          else toast.error(message);
        }
        settleBegin(false);
      }).finally(() => {
        settleBegin(false);
        setActiveRequestCount((count) => Math.max(0, count - 1));
        setLiveExchange((current) => current?.id === exchangeId ? null : current);
      });
    });
  }, [artifactId, consume, currentView, explicitContextObjects, focusMode, onContinuationConflict, selectedArtifactIds, surface, upsert, workspaceId]);

  const keepAsThread = useCallback(async (runId: string, placeInWorkspace = false) => {
    const result = await postSpectra<{ threadId: string }>({ action: "keepRunAsThread", runId, placeInWorkspace, createReference: true });
    await onThreadReady?.(result.threadId);
    await onDataChanged?.();
    return result.threadId;
  }, [onDataChanged, onThreadReady]);

  const onCardAction = useCallback(async (card: ResultCardStreamView, actionKey: string, targetId?: string) => {
    if (actionKey === "hide") {
      dismissedCardIds.current.add(card.id);
      setCards((current) => current.filter((item) => item.id !== card.id));
      setSelectedRunId((current) => current === card.runId ? null : current);
      await postSpectra({ action: "hideResultCard", resultCardId: card.id }).catch((error) => toast.error(error instanceof Error ? error.message : "Could not hide result."));
      return;
    }
    if (actionKey === "open" && targetId) {
      await onOpenArtifact?.(targetId);
      return;
    }
    if (actionKey === "confirm" || actionKey === "cancel") {
      setActiveRequestCount((count) => count + 1);
      try { await consume({ action: actionKey, runId: card.runId }); }
      catch (error) { toast.error(error instanceof Error ? error.message : `Could not ${actionKey} run.`); }
      finally { setActiveRequestCount((count) => Math.max(0, count - 1)); }
      return;
    }
    if (actionKey === "revise" && targetId?.trim()) {
      const clean = targetId.trim();
      setActiveRequestCount((count) => count + 1);
      try {
        await consume({ action: "revise", runId: card.runId, revision: clean });
        await run(`Revise the pending proposal with this feedback: ${clean}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not return the proposal for revision.");
      } finally {
        setActiveRequestCount((count) => Math.max(0, count - 1));
      }
      return;
    }
    if (actionKey === "retry") {
      toast.dismiss();
      setActiveRequestCount((count) => count + 1);
      try { await consume({ action: "retry", runId: card.runId, submissionKey: crypto.randomUUID() }); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Could not retry run."); }
      finally { setActiveRequestCount((count) => Math.max(0, count - 1)); }
      return;
    }
    if (actionKey === "keep") {
      await postSpectra({ action: "keepResultCard", resultCardId: card.id })
        .then(() => toast.success("Kept in activity history."))
        .catch((error) => toast.error(error instanceof Error ? error.message : "Could not keep run."));
    }
  }, [consume, onOpenArtifact, run]);

  const revise = useCallback(async (card: ResultCardStreamView, revision: string) => {
    const clean = revision.trim();
    if (!clean) return false;
    setActiveRequestCount((count) => count + 1);
    try {
      await consume({ action: "revise", runId: card.runId, revision: clean });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not return the proposal for revision.");
      return false;
    } finally {
      setActiveRequestCount((count) => Math.max(0, count - 1));
    }
    return run(`Revise the pending proposal with this feedback: ${clean}`);
  }, [consume, run]);

  const openDetails = useCallback((card: ResultCardStreamView) => setSelectedRunId(card.runId), []);
  const closeDetails = useCallback(() => setSelectedRunId(null), []);

  const stop = useCallback(async (runId?: string) => {
    const targetRunId = runId ?? liveExchange?.runId ?? observedContinuationRunId;
    if (!targetRunId) {
      toast.message("Spectra is still starting this run. Stop will be available in a moment.");
      return;
    }
    try {
      const response = await fetch("/api/spectra/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop", runId: targetRunId }) });
      if (!response.ok) throw new Error((await response.text().catch(() => "")) || "This run can no longer be stopped safely.");
      activeRequests.current.forEach((requestRunId, controller) => { if (requestRunId === targetRunId) { controller.abort(); activeRequests.current.delete(controller); } });
      activeRunIds.current.delete(targetRunId);
      setActiveRequestCount((count) => Math.max(0, count - 1));
      // Cancellation is an intentional terminal state, not a failed exchange.
      // Clear the optimistic stream immediately so buffered response chunks
      // cannot keep painting a live/failed state over the durable stopped run.
      setLiveExchange((current) => current?.runId === targetRunId ? null : current);
      setCards((current) => current.map((card) => card.runId === targetRunId ? {
        ...card,
        status: "cancelled",
        title: "Stopped",
        summary: "Stopped by you. Any partial response remains available in the thread.",
        actions: [{ key: "retry", label: "Retry", targetType: "run", targetId: targetRunId }],
        updatedAt: Date.now(),
      } : card));
      window.dispatchEvent(new Event("spectra:threads-changed"));
      await onDataChanged?.();
      toast.message("Stopped. Any partial response remains saved in the thread.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "This run can no longer be stopped safely.");
    }
  }, [liveExchange?.runId, observedContinuationRunId, onDataChanged]);

  const retry = useCallback(async (runId: string) => {
    toast.dismiss();
    setActiveRequestCount((count) => count + 1);
    try { await consume({ action: "retry", runId, submissionKey: crypto.randomUUID() }); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not retry run."); }
    finally { setActiveRequestCount((count) => Math.max(0, count - 1)); }
  }, [consume]);

  const submitting = activeRequestCount > 0 || Boolean(observedContinuationRunId);
  return useMemo(() => ({ cards, submitting, liveExchange, run, stop, retry, revise, onCardAction, selectedRunId, openDetails, closeDetails, keepAsThread }), [cards, closeDetails, keepAsThread, liveExchange, onCardAction, openDetails, retry, revise, run, selectedRunId, stop, submitting]);
}
