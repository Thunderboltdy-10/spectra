"use client";

import { AlertCircle, Bot, Check, CheckCircle2, ChevronDown, Clock3, ExternalLink, FolderPlus, Loader2, MessageSquarePlus, RotateCcw, ShieldCheck, Undo2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RichText } from "@/components/chat/rich-text";
import { cn } from "@/lib/utils";
import { IconAction, type SpectraCardState } from "./card-system";
import type { ResultCardStreamView } from "../ai/stream-events";
import { clearSpectraRunAgent, postSpectra } from "../data/api";
import { spectraBus } from "../events";

export type ResultCardView = ResultCardStreamView;

function tone(card: ResultCardView) {
  if (card.status === "failed") return "var(--danger)";
  if (card.status === "cancelled") return "var(--warning)";
  if (card.status === "completed") return "var(--success)";
  if (card.actions.some((action) => action.key === "confirm")) return "var(--accent-gold)";
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
  const [clearingAgent, setClearingAgent] = useState(false);
  const [ordinaryNext, setOrdinaryNext] = useState(false);
  const provenance = card.provenance;
  if (!provenance) return null;
  const artifactCount = provenance.artifactIds?.length ?? 0;
  const threadCount = provenance.threadId ? 1 : 0;
  const attachmentCount = provenance.attachmentNames?.length ?? 0;
  const parts = [artifactCount ? `${artifactCount} work item${artifactCount === 1 ? "" : "s"}` : "", threadCount ? "1 thread" : "", attachmentCount ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}` : ""].filter(Boolean);
  const hasSources = parts.length > 0 || Boolean(provenance.workspaceTitle);
  const hasAgent = Boolean(provenance.agentId && provenance.agentTitle);
  if (!hasSources && !hasAgent) return null;

  async function switchToOrdinarySpectra() {
    if (clearingAgent || ordinaryNext) return;
    setClearingAgent(true);
    try {
      await clearSpectraRunAgent(card.runId);
      setOrdinaryNext(true);
      spectraBus.emit("threads.changed", {});
      toast.success("This thread will use ordinary Spectra next.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the thread agent.");
    } finally {
      setClearingAgent(false);
    }
  }

  return <div className="col-start-2 col-end-[-1] -mt-1 mb-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-[var(--text-tertiary)]">
    {hasAgent ? <span className="inline-flex min-w-0 items-center gap-1 rounded-chip bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-secondary))] px-1.5 py-0.5 text-[var(--text-secondary)]" title={provenance.agentRoutingReason}>
      <Bot className="h-3 w-3 shrink-0 text-[var(--accent-cyan)]" />
      <span className="truncate">Using {provenance.agentTitle}</span>
      <span className="text-micro text-[var(--text-tertiary)]">{provenance.agentRoutingSource === "continued" ? "retained" : provenance.agentRoutingSource === "explicit" ? "selected" : "auto"}</span>
      <button type="button" disabled={clearingAgent || ordinaryNext} className="ml-0.5 inline-flex items-center gap-0.5 rounded-chip px-1 py-0.5 font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-65" onClick={(event) => { event.stopPropagation(); void switchToOrdinarySpectra(); }} title="Stop retaining this agent for the thread">
        {clearingAgent ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : ordinaryNext ? <Check className="h-2.5 w-2.5" /> : <Undo2 className="h-2.5 w-2.5" />}
        {ordinaryNext ? "Ordinary next" : "Use ordinary Spectra"}
      </button>
    </span> : null}
    {hasSources ? <button type="button" className="inline-flex items-center gap-1 rounded-chip px-1 py-0.5 hover:bg-[var(--bg-secondary)] hover:text-[var(--text-secondary)]" onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}>
      Based on {parts.join(" and ") || provenance.workspaceTitle}
      <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
    </button> : null}
    {open ? <div className="mt-1 flex flex-wrap gap-1.5 px-1 animate-[spectra-fade-up_180ms_ease-out]">
      {provenance.artifactTitles?.map((title) => <span key={title} className="rounded-chip bg-[var(--bg-secondary)] px-1.5 py-0.5">{title}</span>)}
      {provenance.workspaceTitle ? <span className="rounded-chip bg-[var(--bg-secondary)] px-1.5 py-0.5">{provenance.workspaceTitle}</span> : null}
      {provenance.attachmentNames?.map((name) => <span key={name} className="rounded-chip bg-[var(--bg-secondary)] px-1.5 py-0.5">{name}</span>)}
      {provenance.threadId ? <span className="rounded-chip bg-[var(--bg-secondary)] px-1.5 py-0.5">Continued conversation</span> : null}
    </div> : null}
  </div>;
}

export function ResultCardStack({
  cards,
  className,
  onAction,
  onRevise,
  onOpen,
  activeThreadId,
  activeRunId,
  onContinue,
}: {
  cards?: ResultCardView[];
  className?: string;
  onAction?: (card: ResultCardView, actionKey: string, targetId?: string) => void;
  onRevise?: (card: ResultCardView, revision: string) => Promise<boolean | void> | boolean | void;
  onOpen?: (card: ResultCardView) => void;
  activeThreadId?: string | null;
  activeRunId?: string | null;
  onContinue?: (thread: { threadId: string; title: string; runId: string } | null) => void;
}) {
  const [revisingCardId, setRevisingCardId] = useState<string | null>(null);
  const [revision, setRevision] = useState("");
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
            className="group grid min-h-[40px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 px-2.5 py-1 text-left text-caption animate-[spectra-fade-up_180ms_ease-out]"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,currentColor_10%,var(--bg-elevated))]" style={{ color: tone(card) }}>
              {card.status === "running" && !awaitingApproval ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : awaitingApproval ? <ShieldCheck className="h-3.5 w-3.5" /> : card.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : card.status === "failed" || card.status === "cancelled" ? <AlertCircle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                {opensDetails ? <button type="button" onClick={() => onOpen?.(card)} className="shrink-0 rounded-chip font-semibold text-[var(--text-primary)] outline-none hover:text-[var(--accent-cyan)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]" aria-label={`Open details for ${card.title}`}>{card.title}</button> : <span className="shrink-0 font-semibold text-[var(--text-primary)]">{card.title}</span>}
                {card.summary ? <RichText content={card.summary} className="line-clamp-1 min-w-0 flex-1 overflow-hidden text-[var(--text-secondary)] [&_*]:inline [&_a_svg]:hidden [&_code]:px-1 [&_p]:m-0 [&_p]:leading-normal" /> : null}
              </div>
              {awaitingApproval ? (
                <div
                  className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-control border border-[color-mix(in_oklab,var(--warning)_22%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_5%,var(--bg-primary))] px-2 py-1"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="mr-1 text-micro font-medium text-[var(--text-secondary)]">
                    Review these changes before they are saved.
                  </span>
                  <button
                    type="button"
                    className="rounded-chip bg-[var(--text-primary)] px-2 py-1 text-micro font-semibold text-[var(--bg-primary)] hover:opacity-90"
                    onClick={() => onAction?.(card, "confirm", card.runId)}
                  >
                    Apply changes
                  </button>
                  {onRevise || onAction ? <button
                    type="button"
                    className="rounded-chip px-2 py-1 text-micro font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    onClick={() => setRevisingCardId((current) => current === card.id ? null : card.id)}
                  >
                    Ask for changes
                  </button> : null}
                  <button
                    type="button"
                    className="rounded-chip px-2 py-1 text-micro font-semibold text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]"
                    onClick={() => onAction?.(card, "cancel", card.runId)}
                  >
                    Reject
                  </button>
                  {(onRevise || onAction) && revisingCardId === card.id ? <form className="mt-1 flex w-full gap-1.5" onSubmit={(event) => {
                    event.preventDefault();
                    const clean = revision.trim();
                    if (!clean) return;
                    Promise.resolve(onRevise ? onRevise(card, clean) : onAction?.(card, "revise", clean)).then((accepted) => {
                      if (accepted === false) return;
                      setRevision("");
                      setRevisingCardId(null);
                    });
                  }}><input autoFocus value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="What should Spectra change?" className="h-8 min-w-0 flex-1 rounded-chip bg-[var(--bg-elevated)] px-2.5 text-micro text-[var(--text-primary)] outline-none" /><button type="submit" disabled={!revision.trim()} className="h-8 rounded-chip bg-[var(--text-primary)] px-2.5 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-35">Send</button></form> : null}
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
      <span className="pointer-events-none sticky bottom-0 z-chrome block h-3 -mt-3 bg-[linear-gradient(to_bottom,transparent,var(--bg-primary))]" aria-hidden="true" />
    </div>
  );
}
