"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { parseSpectraStreamEvent, type ResultCardStreamView } from "./stream-events";
import { postSpectra, type SpectraResultCard } from "../data/api";

export type SpectraRunSurface = "chat" | "workspace" | "artifacts" | "artifact";

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
  initialCards = EMPTY_INITIAL_CARDS,
  onDataChanged,
  onOpenArtifact,
}: {
  surface: SpectraRunSurface;
  workspaceId?: string;
  artifactId?: string;
  initialCards?: SpectraResultCard[];
  onDataChanged?: () => Promise<unknown> | unknown;
  onOpenArtifact?: (artifactId: string) => Promise<unknown> | unknown;
}) {
  const [cards, setCards] = useState<ResultCardStreamView[]>(() => initialCards.map(persistedToStream));
  const [submitting, setSubmitting] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const promptByRun = useRef(new Map<string, string>());
  const scopeKey = `${surface}:${workspaceId ?? ""}:${artifactId ?? ""}`;
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
    const response = await fetch("/api/spectra/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
        if (event.type === "run_created" && typeof body.prompt === "string") promptByRun.current.set(event.runId, body.prompt);
        if (event.type === "run_created" || event.type === "result_card" || event.type === "confirmation_required" || event.type === "final") upsert(event.card);
        if (event.type === "error") {
          if (event.card) upsert(event.card);
          toast.error(event.message);
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
      }
      if (done) break;
    }
    if (changed) await onDataChanged?.();
  }, [onDataChanged, upsert]);

  const run = useCallback(async (prompt: string) => {
    const clean = prompt.trim();
    if (!clean || submitting) return;
    setSubmitting(true);
    try {
      await consume({ action: "run", prompt: clean, surface, workspaceId, artifactId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start Spectra run.");
    } finally {
      setSubmitting(false);
    }
  }, [artifactId, consume, submitting, surface, workspaceId]);

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
  }, [consume, onOpenArtifact, run]);

  const openDetails = useCallback((card: ResultCardStreamView) => setSelectedRunId(card.runId), []);
  const closeDetails = useCallback(() => setSelectedRunId(null), []);

  return useMemo(() => ({ cards, submitting, run, onCardAction, selectedRunId, openDetails, closeDetails }), [cards, closeDetails, onCardAction, openDetails, run, selectedRunId, submitting]);
}
