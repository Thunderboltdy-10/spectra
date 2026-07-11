"use client";

import { MessageSquare, X } from "lucide-react";
import type { CSSProperties } from "react";
import { ThreadConversation } from "./conversation-surface";
import { StudioSplitShell } from "./artifact-studio";

export function LiveThreadPanel({
  threadId,
  title,
  width,
  onWidthChange,
  onClose,
  onOpenArtifact,
  onOpenWorkspace,
}: {
  threadId: string;
  title: string;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
}) {
  return (
    <StudioSplitShell width={width} onWidthChange={onWidthChange} ariaLabel="Live thread">
      <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border-default)] px-4">
          <span className="spectra-card-type-icon !h-8 !w-8 text-[var(--accent-orange)]" style={{ "--card-accent": "var(--accent-orange)" } as CSSProperties}>
            <MessageSquare className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[16px] font-semibold text-[var(--text-primary)]">{title || "Live thread"}</div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Live conversation</div>
          </div>
          <button type="button" onClick={onClose} className="spectra-icon-action" aria-label="Close live thread" data-tooltip="Close thread">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1">
          <ThreadConversation threadId={threadId} compact showComposer={false} onOpenArtifact={onOpenArtifact} onOpenWorkspace={onOpenWorkspace} />
        </div>
      </div>
    </StudioSplitShell>
  );
}
