"use client";

import { AlertCircle, Check, CheckCircle2, ChevronDown, Clock3, ExternalLink, FolderPlus, Loader2, MessageSquarePlus, RotateCcw, ShieldCheck, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RichText } from "@/components/chat/rich-text";
import { cn } from "@/lib/utils";
import { IconAction, type SpectraCardState } from "./card-system";
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
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [threadIds, setThreadIds] = useState<Record<string, string>>({});
  const visibleCards = cards?.slice(0, 12) ?? [];
  if (visibleCards.length === 0) return null;

	  async function toggleContinuation(card: ResultCardView) {
	    const knownThreadId = card.provenance?.threadId ?? threadIds[card.runId];
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
    <div className={cn("relative max-h-[132px] space-y-1 overflow-y-auto [scrollbar-width:thin]", className)} aria-label="Spectra run results" aria-live="polite">
      {visibleCards.map((card) => {
        const awaitingApproval = card.actions.some((action) => action.key === "confirm");
        const optimistic = card.id.startsWith("optimistic:") || card.runId.startsWith("pending:");
        const opensDetails = !optimistic && Boolean(onOpen);
	        const cardThreadId = card.provenance?.threadId ?? threadIds[card.runId];
	        const continued = activeRunId === card.runId || Boolean(cardThreadId && cardThreadId === activeThreadId);
        const cardState: SpectraCardState = continued
          ? "continued"
          : card.status === "failed" || card.status === "cancelled"
            ? "failed"
            : awaitingApproval
              ? "confirmation"
              : card.status === "running"
                ? "updating"
                : card.status === "completed"
                  ? "completed"
                  : "normal";
        return (
          <div
            key={card.id}
            role="group"
            data-spectra-card="result"
            data-card-state={cardState}
            className="group grid min-h-[40px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 px-2.5 py-1 text-left text-[12px] animate-[spectra-fade-up_180ms_ease-out]"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,currentColor_10%,var(--bg-elevated))]" style={{ color: tone(card) }}>
              {card.status === "running" && !awaitingApproval ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : awaitingApproval ? <ShieldCheck className="h-3.5 w-3.5" /> : card.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : card.status === "failed" || card.status === "cancelled" ? <AlertCircle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                {opensDetails ? <button type="button" onClick={() => onOpen?.(card)} className="shrink-0 rounded-[4px] font-semibold text-[var(--text-primary)] outline-none hover:text-[var(--accent-cyan)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]" aria-label={`Open details for ${card.title}`}>{card.title}</button> : <span className="shrink-0 font-semibold text-[var(--text-primary)]">{card.title}</span>}
                {card.summary ? <RichText content={card.summary} className="line-clamp-1 min-w-0 flex-1 overflow-hidden text-[var(--text-secondary)] [&_*]:inline [&_a_svg]:hidden [&_code]:px-1 [&_p]:m-0 [&_p]:leading-normal" /> : null}
              </div>
              {awaitingApproval ? (
                <div
                  className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-[7px] border border-[color-mix(in_oklab,var(--warning)_22%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_5%,var(--bg-primary))] px-2 py-1"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="mr-1 text-[10px] font-medium text-[var(--text-secondary)]">
                    Review before Spectra mutates objects.
                  </span>
                  <button
                    type="button"
                    className="rounded-[6px] bg-[var(--text-primary)] px-2 py-1 text-[10px] font-semibold text-[var(--bg-primary)] hover:opacity-90"
                    onClick={() => onAction?.(card, "confirm", card.runId)}
                  >
                    Apply changes
                  </button>
                  <button
                    type="button"
                    className="rounded-[6px] px-2 py-1 text-[10px] font-semibold text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]"
                    onClick={() => onAction?.(card, "cancel", card.runId)}
                  >
                    Reject proposal
                  </button>
                </div>
              ) : null}
            </div>
            <div className="flex items-center">{card.actions.filter((action) => !awaitingApproval || (action.key !== "confirm" && action.key !== "cancel" && action.key !== "reject")).map((action) => {
              const ActionIcon = actionIcon(action.key);
              return <IconAction
                key={`${card.id}-${action.key}`}
                icon={ActionIcon}
                label={action.label}
                active={action.key === "confirm" || action.key === "continue" || action.key === "continue_thread"}
                danger={action.key === "cancel" || action.key === "reject"}
                onClick={(event) => { event.stopPropagation(); onAction?.(card, action.key, action.targetId); }}
              />;
            })}
            {onContinue && !optimistic ? <IconAction
              icon={busyRunId === card.runId ? Loader2 : MessageSquarePlus}
              label={continued ? "Stop continuing chat" : "Continue chat"}
              active={continued}
              disabled={busyRunId === card.runId}
              className={busyRunId === card.runId ? "animate-spin" : undefined}
              onClick={(event) => { event.stopPropagation(); void toggleContinuation(card); }}
              aria-pressed={continued}
            /> : null}
            {!optimistic ? <IconAction icon={X} label="Hide result" className="opacity-55 group-hover:opacity-100" onClick={(event) => { event.stopPropagation(); onAction?.(card, "hide"); }} /> : null}
            </div>
            <ProvenanceLine card={card} />
          </div>
        );
      })}
      <span className="pointer-events-none sticky bottom-0 z-10 block h-3 -mt-3 bg-[linear-gradient(to_bottom,transparent,var(--bg-primary))]" aria-hidden="true" />
    </div>
  );
}
