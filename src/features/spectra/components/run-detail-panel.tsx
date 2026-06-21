"use client";

import { ArrowUpRight, Loader2, MessageSquare, MessageSquarePlus, Pin, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConversationSurface } from "./conversation-surface";
import { CommandBar } from "./command-bar";
import { useSpectraRun } from "../ai/use-spectra-run";
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
  const pendingPrompt = useRef("");
  const localRun = useSpectraRun({
    surface: detail?.run.sourceSurface === "chat" ? "chat" : detail?.run.sourceSurface ?? "workspace",
    workspaceId: detail?.run.workspaceId,
    artifactId: detail?.run.artifactId,
    localConversation: conversation?.messages.filter((message) => message.role === "user" || message.role === "assistant").map((message) => ({ role: message.role as "user" | "assistant", content: message.content })),
    onFinal: ({ runId: childRunId, summary }) => {
      if (pendingPrompt.current) spectraSession.appendLocalExchange(runId, pendingPrompt.current, summary, childRunId);
      pendingPrompt.current = "";
    },
  });
  const persistedCard = detail?.cards[0];
  const displayCard: ResultCardStreamView | undefined = card ?? (persistedCard ? { id: persistedCard._id, runId: persistedCard.runId, status: persistedCard.status, title: persistedCard.title, summary: persistedCard.summary, variant: persistedCard.variant, actions: persistedCard.actions, updatedAt: persistedCard.updatedAt } : undefined);

  async function keep(placeInWorkspace: boolean, navigate: boolean) {
    setBusy(navigate ? "continue" : "keep");
    try {
      const result = await postSpectra<{ threadId: string }>({ action: "keepRunAsThread", runId, placeInWorkspace, createReference: true, localMessages: localArtifact?.messages ?? [] });
      window.dispatchEvent(new Event("spectra:threads-changed"));
      if (navigate) router.push(`/chat?threadId=${encodeURIComponent(result.threadId)}`);
      else toast.success(placeInWorkspace ? "Thread kept and pinned to this workspace." : "Thread kept.");
      onSaved?.(result.threadId);
      return result.threadId;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not keep thread.");
    } finally { setBusy(null); }
    return null;
  }

  return <aside className="absolute inset-y-0 right-0 z-50 flex w-[min(620px,94vw)] flex-col border-l border-[var(--border-default)] bg-[var(--bg-primary)] shadow-[-16px_0_40px_rgba(22,18,13,0.10)]" aria-label="Local thread artifact">
    <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3">
      <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_oklab,#8b6ff0_10%,var(--bg-elevated))] text-[#8b6ff0]"><MessageSquare className="h-4 w-4" /></span><div className="min-w-0"><div className="truncate font-display text-[17px] font-semibold">{conversation?.thread.title ?? "Conversation"}</div><div className="text-[10px] uppercase tracking-[0.11em] text-[var(--text-tertiary)]">Local thread · {displayCard?.status.replaceAll("_", " ") ?? "loading"} · not saved</div></div></div>
      <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]" aria-label="Close"><X className="h-4 w-4" /></button>
    </header>
    <div className="min-h-0 flex-1">{conversation ? <ConversationSurface detail={conversation} compact liveExchange={localRun.liveExchange} composer={<CommandBar placeholder="Continue locally…" busy={localRun.submitting} allowAttachments onStop={localRun.stop} onSubmit={(prompt, attachments) => { pendingPrompt.current = prompt; void localRun.run(prompt, attachments); return true; }} context={<span className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"><MessageSquare className="h-3.5 w-3.5" />Local thread</span>} />} /> : <div className="flex h-full items-center justify-center gap-2 text-[12px] text-[var(--text-tertiary)]"><Loader2 className="h-4 w-4 animate-spin" />Loading conversation</div>}</div>
    <footer className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
      <div className="grid grid-cols-2 gap-2">
        {displayCard?.actions.map((action) => <button key={action.key} type="button" onClick={() => onAction?.(displayCard, action.key, action.targetId)} className="flex h-9 items-center justify-center gap-1.5 rounded-[7px] text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"><ArrowUpRight className="h-3.5 w-3.5" />{action.label}</button>)}
        <button type="button" disabled={busy !== null} onClick={() => void keep(Boolean(detail?.run.workspaceId), false)} className="flex h-9 items-center justify-center gap-1.5 rounded-[7px] border border-[var(--border-default)] text-[11px] font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50">{busy === "keep" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />}Keep as thread</button>
        {onUseThread ? <button type="button" disabled={busy !== null} onClick={() => void keep(false, false).then((threadId) => { if (!threadId) return; onUseThread(threadId, conversation?.thread.title ?? "Conversation"); onClose(); })} className="flex h-9 items-center justify-center gap-1.5 rounded-[7px] text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"><MessageSquarePlus className="h-3.5 w-3.5" />Use in composer</button> : null}
        <button type="button" disabled={busy !== null} onClick={() => void keep(false, true)} className="flex h-9 items-center justify-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] text-[11px] font-medium text-[var(--bg-primary)] disabled:opacity-50">{busy === "continue" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquarePlus className="h-3.5 w-3.5" />}Continue in chat</button>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-[var(--text-tertiary)]">The workspace command bar remains the composer here. Keep explicitly creates a durable thread reference; ordinary runs remain compact.</p>
    </footer>
  </aside>;
}
