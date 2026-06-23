"use client";

import { AlertCircle, Check, CheckCircle2, ChevronDown, Clock3, ExternalLink, FolderPlus, Loader2, MessageSquarePlus, RotateCcw, ShieldCheck, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSpectraSession } from "@/context/spectra-session-context";
import { cn } from "@/lib/utils";
import type { ResultCardStreamView } from "../ai/stream-events";
import { postSpectra } from "../data/api";

export type ResultCardView = ResultCardStreamView;

function tone(card: ResultCardView) {
  if (card.status === "failed" || card.status === "cancelled") return "var(--danger)";
  if (card.status === "completed") return "var(--success)";
  if (card.actions.some((action) => action.key === "confirm")) return "#d88922";
  return "var(--accent-cyan)";
}

function actionIcon(key: string): LucideIcon {
  if (key === "retry") return RotateCcw;
  if (key === "confirm") return Check;
  if (key === "cancel" || key === "reject") return X;
  if (key === "continue" || key === "continue_thread") return MessageSquarePlus;
  if (key === "add_to_workspace") return FolderPlus;
  return ExternalLink;
}

function ProvenanceLine({ card }: { card: ResultCardView }) {
  const [open, setOpen] = useState(false);
  const provenance = card.provenance;
  if (!provenance) return null;
  const artifactCount = provenance.artifactIds?.length ?? 0;
  const threadCount = provenance.threadId ? 1 : 0;
  const attachmentCount = provenance.attachmentNames?.length ?? 0;
  const parts = [artifactCount ? `${artifactCount} artifact${artifactCount === 1 ? "" : "s"}` : "", threadCount ? "1 thread" : "", attachmentCount ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}` : ""].filter(Boolean);
  if (parts.length === 0 && !provenance.workspaceTitle) return null;
  return <div className="col-start-2 col-end-[-1] -mt-1 mb-1 text-[10px] text-[var(--text-tertiary)]">
    <button type="button" className="inline-flex items-center gap-1 rounded-[5px] px-1 py-0.5 hover:bg-[var(--bg-secondary)] hover:text-[var(--text-secondary)]" onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}>
      Based on {parts.join(" and ") || provenance.workspaceTitle}
      <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
    </button>
    {open ? <div className="mt-1 flex flex-wrap gap-1.5 px-1 animate-[spectra-fade-up_180ms_ease-out]">
      {provenance.artifactTitles?.map((title) => <span key={title} className="rounded-[5px] bg-[var(--bg-secondary)] px-1.5 py-0.5">{title}</span>)}
      {provenance.workspaceTitle ? <span className="rounded-[5px] bg-[var(--bg-secondary)] px-1.5 py-0.5">{provenance.workspaceTitle}</span> : null}
      {provenance.attachmentNames?.map((name) => <span key={name} className="rounded-[5px] bg-[var(--bg-secondary)] px-1.5 py-0.5">{name}</span>)}
      {provenance.threadId ? <span className="rounded-[5px] bg-[var(--bg-secondary)] px-1.5 py-0.5">Continued conversation</span> : null}
    </div> : null}
  </div>;
}

export function ResultCardStack({
  cards,
  className,
  onAction,
  onOpen,
  activeThreadId,
  activeRunId,
  onContinue,
}: {
  cards?: ResultCardView[];
  className?: string;
  onAction?: (card: ResultCardView, actionKey: string, targetId?: string) => void;
  onOpen?: (card: ResultCardView) => void;
  activeThreadId?: string | null;
  activeRunId?: string | null;
  onContinue?: (thread: { threadId: string; title: string; runId: string } | null) => void;
}) {
  const session = useSpectraSession();
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [threadIds, setThreadIds] = useState<Record<string, string>>({});
  const visibleCards = cards?.slice(0, 12) ?? [];
  if (visibleCards.length === 0) return null;

  async function toggleContinuation(card: ResultCardView) {
    const knownThreadId = threadIds[card.runId];
    if (activeRunId === card.runId || (knownThreadId && activeThreadId === knownThreadId)) {
      onContinue?.(null);
      return;
    }
    setBusyRunId(card.runId);
    try {
      const threadId = knownThreadId ?? (await postSpectra<{ threadId: string }>({
        action: "keepRunAsThread",
        runId: card.runId,
        placeInWorkspace: false,
        createReference: false,
        localMessages: session.localThreads.find((thread) => thread.runId === card.runId)?.messages ?? [],
      })).threadId;
      setThreadIds((current) => ({ ...current, [card.runId]: threadId }));
      onContinue?.({ threadId, title: card.summary || card.title || "Conversation", runId: card.runId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not continue this chat.");
    } finally {
      setBusyRunId(null);
    }
  }

  return (
    <div className={cn("relative max-h-[76px] overflow-y-auto rounded-[9px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_96%,var(--bg-primary))] shadow-[0_2px_9px_rgba(27,20,12,0.05)] [scrollbar-width:thin]", className)}>
      {visibleCards.map((card) => {
        const awaitingApproval = card.actions.some((action) => action.key === "confirm");
        const optimistic = card.id.startsWith("optimistic:") || card.runId.startsWith("pending:");
        const continued = activeRunId === card.runId || Boolean(threadIds[card.runId] && threadIds[card.runId] === activeThreadId);
        return (
          <div
            key={card.id}
            role="button"
            tabIndex={0}
            className={cn("group my-0.5 grid min-h-[35px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[7px] px-2.5 py-1 text-left text-[12px] transition animate-[spectra-fade-up_180ms_ease-out] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-cyan)]", optimistic ? "cursor-default" : "cursor-pointer hover:bg-[var(--bg-hover)]", continued && "bg-[color-mix(in_oklab,#8b6ff0_9%,var(--bg-elevated))] shadow-[inset_3px_0_0_#8b6ff0]")}
            onClick={() => { if (!optimistic) onOpen?.(card); }}
            onKeyDown={(event) => { if (!optimistic && (event.key === "Enter" || event.key === " ")) onOpen?.(card); }}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,currentColor_10%,var(--bg-elevated))]" style={{ color: tone(card) }}>
              {card.status === "running" && !awaitingApproval ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : awaitingApproval ? <ShieldCheck className="h-3.5 w-3.5" /> : card.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : card.status === "failed" || card.status === "cancelled" ? <AlertCircle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="shrink-0 font-semibold text-[var(--text-primary)]">{card.title}</span>
                {card.summary ? <span className="truncate text-[var(--text-secondary)]">{card.summary}</span> : null}
              </span>
            </span>
            <div className="flex items-center">{card.actions.map((action) => {
              const ActionIcon = actionIcon(action.key);
              return <button
                key={`${card.id}-${action.key}`}
                type="button"
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  action.key === "confirm" && "bg-[var(--text-primary)] text-[var(--bg-primary)] hover:bg-[var(--text-primary)] hover:text-[var(--bg-primary)]",
                )}
                onClick={(event) => { event.stopPropagation(); onAction?.(card, action.key, action.targetId); }}
                aria-label={action.label}
                title={action.label}
              >
                <ActionIcon className="h-3.5 w-3.5" />
              </button>;
            })}
            {onContinue && !optimistic ? <button
              type="button"
              disabled={busyRunId === card.runId}
              className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50", continued && "bg-[color-mix(in_oklab,#8b6ff0_12%,transparent)] text-[#7256dc]")}
              onClick={(event) => { event.stopPropagation(); void toggleContinuation(card); }}
              aria-label={continued ? "Stop continuing this chat" : "Continue chat"}
              aria-pressed={continued}
              title={continued ? "Stop continuing chat" : "Continue chat"}
            >
              {busyRunId === card.runId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquarePlus className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{continued ? "Continuing" : "Continue chat"}</span>
            </button> : null}
            {!optimistic ? <button type="button" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-[var(--text-tertiary)] opacity-55 hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] group-hover:opacity-100" aria-label="Hide result" onClick={(event) => { event.stopPropagation(); onAction?.(card, "hide"); }}>
              <X className="h-3.5 w-3.5" />
            </button> : null}
            </div>
            <ProvenanceLine card={card} />
          </div>
        );
      })}
    </div>
  );
}
