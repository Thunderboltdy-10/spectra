"use client";

import { BookmarkPlus, Check, ExternalLink, Loader2, Maximize2, MessageSquare, MessageSquarePlus, RotateCcw, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConversationSurface } from "./conversation-surface";
import { StudioSplitShell } from "./artifact-studio";
import { useSpectraSession } from "@/context/spectra-session-context";
import { getSpectraRunDetail, postSpectra, type SpectraRunDetail, type SpectraThreadDetail } from "../data/api";
import type { ResultCardStreamView } from "../ai/stream-events";

function temporaryDetail(detail: SpectraRunDetail): SpectraThreadDetail {
  const run = detail.run;
  const assistantContent = run.finalSummary ?? run.error ?? detail.cards[0]?.summary ?? "Spectra is working on this request.";
  return {
    thread: {
      _id: `temporary:${run._id}`,
      title: run.userPrompt.split(/\s+/).slice(0, 8).join(" "),
      origin: run.sourceSurface,
      workspaceId: run.workspaceId,
      artifactId: run.artifactId,
      status: "active",
      messageCount: 2,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    messages: [
      { _id: `temporary:user:${run._id}`, threadId: `temporary:${run._id}`, role: "user", content: run.userPrompt, runId: run._id, createdAt: run.createdAt },
      { _id: `temporary:assistant:${run._id}`, threadId: `temporary:${run._id}`, role: "assistant", content: assistantContent, runId: run._id, createdAt: run.updatedAt },
    ],
    traces: [{ run, operations: detail.operations, cards: detail.cards, artifacts: [] }],
    viewerName: "You",
  };
}

export function RunDetailPanel({ runId, card, onClose, onAction, onUseThread, onSaved }: {
  runId: string;
  card?: ResultCardStreamView;
  onClose: () => void;
  onAction?: (card: ResultCardStreamView, actionKey: string, targetId?: string) => void;
  onUseThread?: (threadId: string, title: string) => void;
  onSaved?: (threadId: string) => void;
}) {
  const router = useRouter();
  const spectraSession = useSpectraSession();
  const [detail, setDetail] = useState<SpectraRunDetail | null>(null);
  const [busy, setBusy] = useState<"keep" | "continue" | null>(null);
  const [width, setWidth] = useState(680);
  useEffect(() => {
    let active = true;
    void getSpectraRunDetail(runId).then((value) => { if (active) setDetail(value); }).catch((error) => toast.error(error instanceof Error ? error.message : "Could not load run."));
    return () => { active = false; };
  }, [runId, card?.updatedAt]);
  const localArtifact = spectraSession.localThreads.find((thread) => thread.runId === runId);
  const conversation = useMemo(() => {
    if (!detail) return null;
    const base = temporaryDetail(detail);
    return { ...base, messages: [...base.messages, ...(localArtifact?.messages ?? []).map((message) => ({ _id: message.id, threadId: `temporary:${runId}`, role: message.role, content: message.content, runId: message.runId, createdAt: message.createdAt }))] } satisfies SpectraThreadDetail;
  }, [detail, localArtifact?.messages, runId]);
  const persistedCard = detail?.cards[0];
  const isPermanent = Boolean(detail?.run.threadId);
  const displayCard: ResultCardStreamView | undefined = card ?? (persistedCard ? { id: persistedCard._id, runId: persistedCard.runId, status: persistedCard.status, title: persistedCard.title, summary: persistedCard.summary, variant: persistedCard.variant, actions: persistedCard.actions, updatedAt: persistedCard.updatedAt } : undefined);

  async function keep(placeInWorkspace: boolean, navigate: boolean, createReference = true) {
    setBusy(navigate ? "continue" : "keep");
    try {
      const result = await postSpectra<{ threadId: string }>({ action: "keepRunAsThread", runId, placeInWorkspace, createReference, localMessages: localArtifact?.messages ?? [] });
      window.dispatchEvent(new Event("spectra:threads-changed"));
      if (navigate) router.push(`/chat?threadId=${encodeURIComponent(result.threadId)}`);
      else toast.success(placeInWorkspace ? "Thread kept and placed in this workspace." : "Thread kept.");
      onSaved?.(result.threadId);
      return result.threadId;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not keep thread.");
    } finally { setBusy(null); }
    return null;
  }

  function runActionIcon(key: string): LucideIcon {
    if (key === "retry") return RotateCcw;
    if (key === "confirm") return Check;
    if (key === "cancel" || key === "reject") return X;
    return ExternalLink;
  }

  return <StudioSplitShell width={width} onWidthChange={setWidth} ariaLabel="Temporary conversation" cssWidthVariable="--spectra-run-panel-width"><div className="flex h-full min-h-0 flex-col">
    <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3">
      <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_oklab,#8b6ff0_10%,var(--bg-elevated))] text-[#8b6ff0]"><MessageSquare className="h-4 w-4" /></span><div className="min-w-0"><div className="truncate font-display text-[17px] font-semibold">{conversation?.thread.title ?? "Conversation"}</div><div className="text-[10px] uppercase tracking-[0.11em] text-[var(--text-tertiary)]">Temporary conversation · {displayCard?.status.replaceAll("_", " ") ?? "loading"}</div></div></div>
      <div className="flex items-center gap-1"><button type="button" disabled={busy !== null} onClick={() => { if (detail?.run.threadId) router.push(`/chat?threadId=${encodeURIComponent(detail.run.threadId)}`); else void keep(false, true, false); }} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] disabled:opacity-45" aria-label="Open in Chat" title="Open in Chat">{busy === "continue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Maximize2 className="h-4 w-4" />}</button><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]" aria-label="Close" title="Close"><X className="h-4 w-4" /></button></div>
    </header>
    <div className="min-h-0 flex-1">{conversation ? <ConversationSurface detail={conversation} compact /> : <div className="flex h-full items-center justify-center gap-2 text-[12px] text-[var(--text-tertiary)]"><Loader2 className="h-4 w-4 animate-spin" />Loading conversation</div>}</div>
    <footer className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
      <div className="flex items-center justify-end gap-2">
        {displayCard?.actions.map((action) => { const Icon = runActionIcon(action.key); return <button key={action.key} type="button" onClick={() => onAction?.(displayCard, action.key, action.targetId)} className="flex h-9 w-9 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]" aria-label={action.label} title={action.label}><Icon className="h-4 w-4" /></button>; })}
        {!isPermanent ? <button type="button" disabled={busy !== null} onClick={() => { const place = Boolean(detail?.run.workspaceId); void keep(place, false, place); }} className="flex h-9 w-9 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50" aria-label="Keep permanently" title="Keep permanently">{busy === "keep" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookmarkPlus className="h-4 w-4" />}</button> : null}
        {!isPermanent && onUseThread ? <button type="button" disabled={busy !== null} onClick={() => void keep(false, false, false).then((threadId) => { if (!threadId) return; onUseThread(threadId, conversation?.thread.title ?? "Conversation"); onClose(); })} className="flex h-9 w-9 items-center justify-center rounded-[7px] text-[#7256dc] hover:bg-[color-mix(in_oklab,#8b6ff0_12%,var(--bg-secondary))] disabled:opacity-50" aria-label="Continue chat" title="Continue chat">{busy === "keep" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}</button> : null}
      </div>
    </footer>
  </div></StudioSplitShell>;
}
