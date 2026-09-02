"use client";

import { Check, MessageSquare, MessagesSquare, Play, Radio } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SpectraThread } from "../data/api";
import { formatRelativeTime } from "./spectra-view-model";
import { previewText } from "./preview-text";

export function ThreadCard({
  thread,
  workspaceLabel,
  pinned = false,
  continued = false,
  running = false,
  waiting = false,
  selected = false,
  selectionMode = false,
  compact = false,
  onOpen,
  onContinue,
  onToggleSelection,
  actions,
}: {
  thread: SpectraThread;
  workspaceLabel?: string;
  pinned?: boolean;
  continued?: boolean;
  running?: boolean;
  waiting?: boolean;
  selected?: boolean;
  selectionMode?: boolean;
  compact?: boolean;
  onOpen?: () => void;
  onContinue?: () => void;
  onToggleSelection?: () => void;
  actions?: ReactNode;
}) {
  const state = selected ? "multi-selected" : continued ? "continued" : waiting ? "confirmation" : running ? "updating" : pinned ? "pinned" : "normal";
  return (
    <article
      data-spectra-card="thread"
      data-card-state={state}
      data-interactive={onOpen ? "true" : undefined}
      className={cn("spectra-card spectra-card--thread group relative overflow-hidden rounded-card border border-[color-mix(in_oklab,var(--brand-primary)_18%,var(--border-default))] bg-[color-mix(in_oklab,var(--brand-primary)_4%,var(--bg-elevated))] text-left shadow-soft", compact ? "min-h-[82px] p-3" : "min-h-[132px] p-3.5")}
      style={{ "--card-accent": "var(--brand-primary)" } as CSSProperties}
    >
      {onOpen ? <button type="button" className="absolute inset-0 z-base rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color-mix(in_oklab,var(--brand-primary)_55%,transparent)]" onClick={() => selectionMode && onToggleSelection ? onToggleSelection() : onOpen()} aria-label={selectionMode ? `${selected ? "Remove" : "Add"} ${thread.title} ${selected ? "from" : "to"} selection` : `Open conversation ${thread.title}`} aria-pressed={selectionMode ? selected : undefined} /> : null}
      <div className="pointer-events-none relative z-chrome flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-[color-mix(in_oklab,var(--brand-primary)_22%,var(--border-default))] bg-[color-mix(in_oklab,var(--brand-primary)_9%,var(--bg-primary))] text-[var(--brand-primary)]">
          {selected ? <Check className="h-4 w-4" /> : running ? <Radio className="h-4 w-4 animate-pulse motion-reduce:animate-none" /> : <MessageSquare className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.09em] text-[var(--brand-primary)]"><span>Conversation</span>{continued ? <span className="rounded-full bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--bg-primary))] px-1.5 py-0.5 normal-case tracking-normal">Continues next</span> : running ? <span className="normal-case tracking-normal">Live</span> : waiting ? <span className="normal-case tracking-normal text-[var(--warning)]">Needs you</span> : null}</span>
          <span className="mt-1.5 block truncate font-display text-editor font-semibold text-[var(--text-primary)]" title={thread.title}>{thread.title}</span>
          {!compact ? <span className="mt-1.5 block line-clamp-2 text-micro leading-5 text-[var(--text-secondary)]">{previewText(thread.summaryShort, "Continue the thinking and work captured in this conversation.")}</span> : null}
          <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-[var(--text-tertiary)]"><span className="inline-flex items-center gap-1"><MessagesSquare className="h-3 w-3" />{thread.messageCount ?? 0} messages</span><span>{workspaceLabel ?? "Inbox"}</span><span>{formatRelativeTime(thread.lastMessageAt ?? thread.updatedAt)}</span></span>
        </span>
      </div>
      {!selectionMode && (onContinue || actions) ? <div className="relative z-dropdown mt-2 flex min-h-8 items-center justify-end gap-1.5 border-t border-[color-mix(in_oklab,var(--brand-primary)_12%,var(--border-subtle))] pt-2">{actions}{onContinue ? <button type="button" onClick={onContinue} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-control px-2.5 text-micro font-semibold", continued ? "bg-[color-mix(in_oklab,var(--brand-primary)_12%,var(--bg-primary))] text-[var(--brand-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]")}><Play className="h-3 w-3" />{continued ? "Continuing" : "Continue"}</button> : null}</div> : null}
    </article>
  );
}
