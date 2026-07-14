"use client";

import { BookmarkPlus, Check, ExternalLink, Loader2, Maximize2, MessageSquare, MessageSquarePlus, RotateCcw, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConversationSurface, ThreadConversation } from "./conversation-surface";
import { StudioSplitShell } from "./artifact-studio";
import { getSpectraRunDetail, postSpectra, type SpectraRunDetail, type SpectraThreadDetail } from "../data/api";
import type { ResultCardStreamView } from "../ai/stream-events";
import { IconAction } from "./card-system";

function legacyRunDetail(detail: SpectraRunDetail): SpectraThreadDetail {
  const run = detail.run;
  const assistantContent = run.finalSummary ?? run.error ?? detail.cards[0]?.summary ?? "Spectra is working on this request.";
  const threadId = `run:${run._id}`;
  return {
    thread: {
      _id: threadId,
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
      { _id: `run:user:${run._id}`, threadId, role: "user", content: run.userPrompt, runId: run._id, createdAt: run.createdAt },
      { _id: `run:assistant:${run._id}`, threadId, role: "assistant", content: assistantContent, runId: run._id, createdAt: run.updatedAt },
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
  const [detail, setDetail] = useState<SpectraRunDetail | null>(null);
  const [busy, setBusy] = useState<"keep" | "continue" | null>(null);
  const [width, setWidth] = useState(680);
  useEffect(() => {
    let active = true;
    void getSpectraRunDetail(runId).then((value) => { if (active) setDetail(value); }).catch((error) => toast.error(error instanceof Error ? error.message : "Could not load run."));
    return () => { active = false; };
  }, [runId, card?.updatedAt]);
  const conversation = useMemo(() => {
    if (!detail) return null;
    return legacyRunDetail(detail);
  }, [detail]);
  const persistedCard = detail?.cards[0];
  const isPermanent = Boolean(detail?.run.threadId);
  const displayCard: ResultCardStreamView | undefined = card ?? (persistedCard ? { id: persistedCard._id, runId: persistedCard.runId, status: persistedCard.status, title: persistedCard.title, summary: persistedCard.summary, variant: persistedCard.variant, actions: persistedCard.actions, provenance: persistedCard.provenance, updatedAt: persistedCard.updatedAt } : undefined);

  async function keep(placeInWorkspace: boolean, navigate: boolean, createReference = true) {
    setBusy(navigate ? "continue" : "keep");
    try {
      const result = await postSpectra<{ threadId: string }>({ action: "keepRunAsThread", runId, placeInWorkspace, createReference });
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

  return <StudioSplitShell width={width} onWidthChange={setWidth} ariaLabel="Thread panel" cssWidthVariable="--spectra-run-panel-width"><div className="flex h-full min-h-0 flex-col">
    <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3">
      <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_oklab,#8b6ff0_10%,var(--bg-elevated))] text-[#8b6ff0]"><MessageSquare className="h-4 w-4" /></span><div className="min-w-0"><div className="truncate font-display text-[17px] font-semibold">{conversation?.thread.title ?? "Conversation"}</div><div className="text-[10px] uppercase tracking-[0.11em] text-[var(--text-tertiary)]">Thread · {displayCard?.status.replaceAll("_", " ") ?? "loading"}</div></div></div>
      <div className="flex items-center gap-1"><IconAction icon={busy === "continue" ? Loader2 : Maximize2} label="Open in Chat" disabled={busy !== null} className={busy === "continue" ? "animate-spin" : undefined} onClick={() => { if (detail?.run.threadId) router.push(`/chat?threadId=${encodeURIComponent(detail.run.threadId)}`); else void keep(false, true, false); }} /><IconAction icon={X} label="Close" onClick={onClose} /></div>
    </header>
    <div className="min-h-0 flex-1">{detail?.run.threadId ? <ThreadConversation threadId={detail.run.threadId} compact showComposer={false} /> : conversation ? <ConversationSurface detail={conversation} compact /> : <div className="flex h-full items-center justify-center gap-2 text-[12px] text-[var(--text-tertiary)]"><Loader2 className="h-4 w-4 animate-spin" />Loading conversation</div>}</div>
    <footer className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
      {displayCard?.actions.some((action) => action.key === "confirm") ? (
        <div
          data-spectra-card="result"
          data-card-state="confirmation"
          className="mb-2 px-3 py-2"
        >
          <div className="text-[11px] font-semibold text-[var(--text-primary)]">
            Proposed changes need approval
          </div>
          <p className="mt-1 text-[10px] leading-4 text-[var(--text-secondary)]">
            Accept only if the affected objects and workspace placement look right.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="h-8 rounded-[7px] bg-[var(--text-primary)] px-3 text-[11px] font-semibold text-[var(--bg-primary)]"
              onClick={() => onAction?.(displayCard, "confirm", displayCard.runId)}
            >
              Apply changes
            </button>
            <button
              type="button"
              className="h-8 rounded-[7px] px-3 text-[11px] font-semibold text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]"
              onClick={() => onAction?.(displayCard, "cancel", displayCard.runId)}
            >
              Reject proposal
            </button>
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {displayCard?.actions.map((action) => { const Icon = runActionIcon(action.key); return <IconAction key={action.key} icon={Icon} label={action.label} active={action.key === "confirm"} danger={action.key === "cancel" || action.key === "reject"} onClick={() => onAction?.(displayCard, action.key, action.targetId)} />; })}
        {!isPermanent ? <button type="button" disabled={busy !== null} onClick={() => { const place = Boolean(detail?.run.workspaceId); void keep(place, false, place); }} className="flex h-9 items-center gap-2 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[11px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50" aria-label={detail?.run.workspaceId ? "Save conversation to workspace" : "Save conversation"}>{busy === "keep" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookmarkPlus className="h-4 w-4" />}{detail?.run.workspaceId ? "Save to workspace" : "Save conversation"}</button> : null}
        {!isPermanent && onUseThread ? <IconAction icon={busy === "keep" ? Loader2 : MessageSquarePlus} label="Continue chat" active disabled={busy !== null} className={busy === "keep" ? "animate-spin" : undefined} onClick={() => void keep(false, false, false).then((threadId) => { if (!threadId) return; onUseThread(threadId, conversation?.thread.title ?? "Conversation"); onClose(); })} /> : null}
      </div>
    </footer>
  </div></StudioSplitShell>;
}
