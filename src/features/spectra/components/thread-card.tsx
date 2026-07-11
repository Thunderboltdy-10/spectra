"use client";

import { Check, MessageSquare, MessagesSquare, Play, Radio } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SpectraThread } from "../data/api";
import { formatRelativeTime } from "./spectra-view-model";

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
      className={cn("spectra-card spectra-card--thread group relative overflow-hidden rounded-[9px] border border-[color-mix(in_oklab,#8b6ff0_18%,var(--border-default))] bg-[color-mix(in_oklab,#8b6ff0_4%,var(--bg-elevated))] text-left shadow-[0_4px_18px_rgba(39,28,74,0.04)]", compact ? "min-h-[82px] p-3" : "min-h-[132px] p-3.5")}
      style={{ "--card-accent": "#8b6ff0" } as CSSProperties}
    >
      {onOpen ? <button type="button" className="absolute inset-0 z-[1] rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color-mix(in_oklab,#8b6ff0_55%,transparent)]" onClick={() => selectionMode && onToggleSelection ? onToggleSelection() : onOpen()} aria-label={selectionMode ? `${selected ? "Remove" : "Add"} ${thread.title} ${selected ? "from" : "to"} selection` : `Open conversation ${thread.title}`} aria-pressed={selectionMode ? selected : undefined} /> : null}
      <div className="pointer-events-none relative z-[2] flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[color-mix(in_oklab,#8b6ff0_22%,var(--border-default))] bg-[color-mix(in_oklab,#8b6ff0_9%,var(--bg-primary))] text-[#7256dc]">
          {selected ? <Check className="h-4 w-4" /> : running ? <Radio className="h-4 w-4 animate-pulse motion-reduce:animate-none" /> : <MessageSquare className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.09em] text-[#7256dc]"><span>Conversation</span>{continued ? <span className="rounded-full bg-[color-mix(in_oklab,#8b6ff0_10%,var(--bg-primary))] px-1.5 py-0.5 normal-case tracking-normal">Continues next</span> : running ? <span className="normal-case tracking-normal">Live</span> : waiting ? <span className="normal-case tracking-normal text-[var(--warning)]">Needs you</span> : null}</span>
          <span className="mt-1.5 block truncate font-display text-[16px] font-semibold text-[var(--text-primary)]">{thread.title}</span>
          {!compact ? <span className="mt-1.5 block line-clamp-2 text-[11px] leading-5 text-[var(--text-secondary)]">{thread.summaryShort?.trim() || "Continue the thinking and work captured in this conversation."}</span> : null}
          <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--text-tertiary)]"><span className="inline-flex items-center gap-1"><MessagesSquare className="h-3 w-3" />{thread.messageCount ?? 0} messages</span><span>{workspaceLabel ?? "Inbox"}</span><span>{formatRelativeTime(thread.lastMessageAt ?? thread.updatedAt)}</span></span>
        </span>
      </div>
      {!selectionMode && (onContinue || actions) ? <div className="relative z-[3] mt-2 flex min-h-8 items-center justify-end gap-1.5 border-t border-[color-mix(in_oklab,#8b6ff0_12%,var(--border-subtle))] pt-2">{actions}{onContinue ? <button type="button" onClick={onContinue} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[10px] font-semibold", continued ? "bg-[color-mix(in_oklab,#8b6ff0_12%,var(--bg-primary))] text-[#7256dc]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]")}><Play className="h-3 w-3" />{continued ? "Continuing" : "Continue"}</button> : null}</div> : null}
    </article>
  );
}
