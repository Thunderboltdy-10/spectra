"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { parseSpectraStreamEvent, type ResultCardStreamView } from "./stream-events";
import { postSpectra, type SpectraResultCard } from "../data/api";
import type { CommandAttachment } from "../components/command-bar";

export type SpectraRunSurface = "chat" | "workspace" | "artifacts" | "artifact";
export type SpectraLiveExchange = {
  id: string;
  runId?: string;
  prompt: string;
  content: string;
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

export function useSpectraRun({
  surface,
  workspaceId,
  artifactId,
  threadId,
  initialCards = EMPTY_INITIAL_CARDS,
  onDataChanged,
  onOpenArtifact,
  onThreadReady,
  localConversation,
  onFinal,
}: {
  surface: SpectraRunSurface;
  workspaceId?: string;
  artifactId?: string;
  threadId?: string;
  initialCards?: SpectraResultCard[];
  onDataChanged?: () => Promise<unknown> | unknown;
  onOpenArtifact?: (artifactId: string) => Promise<unknown> | unknown;
  onThreadReady?: (threadId: string) => Promise<unknown> | unknown;
  localConversation?: Array<{ role: "user" | "assistant"; content: string }>;
  onFinal?: (result: { runId: string; summary: string }) => Promise<unknown> | unknown;
}) {
  const [cards, setCards] = useState<ResultCardStreamView[]>(() => initialCards.map(persistedToStream));
  const [submitting, setSubmitting] = useState(false);
  const [liveExchange, setLiveExchange] = useState<SpectraLiveExchange | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const promptByRun = useRef(new Map<string, string>());
  const activeRequest = useRef<AbortController | null>(null);
  const activeRunId = useRef<string | null>(null);
  const scopeKey = `${surface}:${workspaceId ?? ""}:${artifactId ?? ""}:${threadId ?? ""}`;
  const previousScopeKey = useRef(scopeKey);

  useEffect(() => {
    const incoming = initialCards.filter((card) => !card.hiddenAt).map(persistedToStream);
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
    setCards((current) => mergeCards(current, [card]));
  }, []);

  const consume = useCallback(async (body: Record<string, unknown>) => {
    const controller = new AbortController();
    activeRequest.current = controller;
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
          promptByRun.current.set(event.runId, body.prompt);
          setLiveExchange((current) => current ? { ...current, runId: event.runId } : current);
          activeRunId.current = event.runId;
        }
        if (event.type === "thread_ready") void onThreadReady?.(event.threadId);
        if (event.type === "text_delta") setLiveExchange((current) => current ? { ...current, runId: event.runId, content: current.content + event.content, status: "streaming" } : current);
        if (event.type === "run_created" || event.type === "result_card" || event.type === "confirmation_required" || event.type === "final") upsert(event.card);
        if (event.type === "error") {
          if (event.card) upsert(event.card);
          toast.error(event.message);
          setLiveExchange((current) => current ? { ...current, status: "failed" } : current);
        }
        if (event.type === "status") {
          setCards((current) => current.map((card) => card.runId === event.runId ? {
            ...card,
            status: "running",
            title: event.message.startsWith("Saving") ? "Saving" : event.message.startsWith("Validating") ? "Creating" : "Thinking",
            summary: event.message,
            updatedAt: Date.now(),
          } : card));
        }
        if (event.type === "operation_result") changed = true;
        if (event.type === "final") void onFinal?.({ runId: event.runId, summary: event.summary });
        if (event.type === "final" || event.type === "confirmation_required") changed = true;
      }
      if (done) break;
    }
    if (changed) await onDataChanged?.();
    activeRequest.current = null;
    activeRunId.current = null;
  }, [onDataChanged, onFinal, onThreadReady, upsert]);

  const run = useCallback(async (prompt: string, attachments: CommandAttachment[] = []) => {
    const clean = prompt.trim();
    if (!clean || submitting) return;
    setSubmitting(true);
    setLiveExchange({ id: crypto.randomUUID(), prompt: clean, content: "", status: "starting", startedAt: Date.now() });
    try {
      await consume({ action: "run", prompt: clean, surface, workspaceId, artifactId, threadId, attachments, localConversation });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error(error instanceof Error ? error.message : "Could not start Spectra run.");
      }
    } finally {
      setSubmitting(false);
      setLiveExchange(null);
    }
  }, [artifactId, consume, localConversation, submitting, surface, threadId, workspaceId]);

  const keepAsThread = useCallback(async (runId: string, placeInWorkspace = false) => {
    const result = await postSpectra<{ threadId: string }>({ action: "keepRunAsThread", runId, placeInWorkspace, createReference: true });
    await onThreadReady?.(result.threadId);
    await onDataChanged?.();
    return result.threadId;
  }, [onDataChanged, onThreadReady]);

  const onCardAction = useCallback(async (card: ResultCardStreamView, actionKey: string, targetId?: string) => {
    if (actionKey === "hide") {
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
      setSubmitting(true);
      try { await consume({ action: actionKey, runId: card.runId }); }
      catch (error) { toast.error(error instanceof Error ? error.message : `Could not ${actionKey} run.`); }
      finally { setSubmitting(false); }
      return;
    }
    if (actionKey === "retry") {
      setSubmitting(true);
      try { await consume({ action: "retry", runId: card.runId }); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Could not retry run."); }
      finally { setSubmitting(false); }
      return;
    }
    if (actionKey === "keep") {
      await postSpectra({ action: "keepResultCard", resultCardId: card.id })
        .then(() => toast.success("Kept in activity history."))
        .catch((error) => toast.error(error instanceof Error ? error.message : "Could not keep run."));
    }
  }, [consume, onOpenArtifact]);

  const openDetails = useCallback((card: ResultCardStreamView) => setSelectedRunId(card.runId), []);
  const closeDetails = useCallback(() => setSelectedRunId(null), []);

  const stop = useCallback(() => {
    const runId = activeRunId.current;
    activeRequest.current?.abort();
    activeRequest.current = null;
    activeRunId.current = null;
    if (runId) void fetch("/api/spectra/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop", runId }) });
    setSubmitting(false);
    setLiveExchange((current) => current ? { ...current, status: "failed" } : null);
    toast.message("Generation stopped. No incomplete assistant message was saved.");
  }, []);

  return useMemo(() => ({ cards, submitting, liveExchange, run, stop, onCardAction, selectedRunId, openDetails, closeDetails, keepAsThread }), [cards, closeDetails, keepAsThread, liveExchange, onCardAction, openDetails, run, selectedRunId, stop, submitting]);
}
