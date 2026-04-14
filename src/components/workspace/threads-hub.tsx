"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import {
  MessageSquare,
  Sparkles,
  ChevronLeft,
  ExternalLink,
  ArrowUpRight,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { WorkspaceItemData } from "@/lib/workspace/contracts";

/* ─── Thread Inline Preview ───────────────────────────── */

function ThreadPreview({
  thread,
  onBack,
  onOpenFullView,
}: {
  thread: WorkspaceItemData;
  onBack: () => void;
  onOpenFullView: (thread: WorkspaceItemData) => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Preview header with back button */}
      <div className="flex items-center gap-2 border-b border-[var(--border-default)]/15 px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
            {thread.title}
          </p>
          {thread.meta && (
            <p className="text-[9px] text-[var(--text-tertiary)]/60">{thread.meta}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onOpenFullView(thread)}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--accent-cyan)]"
          title="Open full thread view"
        >
          <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>

      {/* Thread content preview */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {thread.preview ? (
          <div className="flex flex-col gap-3">
            {/* User message bubble */}
            <div className="rounded-2xl rounded-tl-md border border-[var(--border-default)]/20 bg-[var(--bg-elevated)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[var(--text-primary)]">
              {thread.preview}
            </div>
            {/* AI response placeholder */}
            <div className="rounded-2xl rounded-tl-md bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-elevated))] px-3.5 py-2.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
              <span className="text-[var(--text-tertiary)]/50">
                Thread conversation preview
              </span>
            </div>
          </div>
        ) : (
          <div className="flex h-32 flex-col items-center justify-center text-center">
            <Sparkles className="mb-2 h-5 w-5 text-[var(--accent-cyan)] opacity-30" />
            <span className="text-[11px] text-[var(--text-tertiary)]/60">
              No messages yet
            </span>
            <span className="mt-1 text-[9px] text-[var(--text-tertiary)]/40">
              Use the command bar to start a conversation
            </span>
          </div>
        )}
      </div>

      {/* Footer with open-in-full button */}
      <div className="border-t border-[var(--border-default)]/10 px-3 py-2">
        <button
          type="button"
          onClick={() => onOpenFullView(thread)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--accent-cyan)]/8 px-3 py-2 text-[11px] font-semibold text-[var(--accent-cyan)] transition-colors hover:bg-[var(--accent-cyan)]/15"
        >
          <ExternalLink className="h-3 w-3" />
          Open full thread
        </button>
      </div>
    </div>
  );
}

/* ─── Thread List Item ────────────────────────────────── */

function ThreadListItem({
  thread,
  isActive,
  onClick,
}: {
  thread: WorkspaceItemData;
  isActive: boolean;
  onClick: () => void;
}) {
  const timeAgo = useMemo(() => {
    if (!thread.updatedAt) return null;
    const diffMs = Date.now() - thread.updatedAt;
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }, [thread.updatedAt]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition-all duration-150",
        isActive
          ? "bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-hover))] ring-1 ring-[var(--accent-cyan)]/15"
          : "hover:bg-[var(--bg-hover)]/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn(
          "text-[12px] font-medium leading-tight",
          isActive ? "text-[var(--accent-cyan)]" : "text-[var(--text-primary)]",
        )}>
          {thread.title}
        </span>
        {timeAgo && (
          <span className="shrink-0 flex items-center gap-1 text-[9px] text-[var(--text-tertiary)]/50">
            <Clock className="h-2.5 w-2.5" />
            {timeAgo}
          </span>
        )}
      </div>
      {thread.preview && (
        <span className="line-clamp-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          {thread.preview}
        </span>
      )}
      {thread.meta && (
        <span className="text-[9px] font-medium text-[var(--accent-cyan)]/60">
          {thread.meta}
        </span>
      )}
    </button>
  );
}

/* ─── Main Threads Hub ────────────────────────────────── */

export function ThreadsHub({ className, forceExpanded }: { className?: string; forceExpanded?: boolean }) {
  const [locked, setLocked] = useState(false);
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const committedWorkspaceId = useWorkspaceStore((s) => s.committedWorkspaceId);
  const setFocusedItem = useWorkspaceStore((s) => s.setFocusedItem);
  const openDeepEdit = useWorkspaceStore((s) => s.openDeepEdit);
  const activeThreadId = useWorkspaceStore((s) => s.activeThreadId);
  const openThreadInHub = useWorkspaceStore((s) => s.openThreadInHub);
  const closeThreadInHub = useWorkspaceStore((s) => s.closeThreadInHub);

  const threads = useMemo(() => {
    let items = workspaces.flatMap((w) => w.items);
    if (committedWorkspaceId) {
      items = workspaces.find((w) => w.id === committedWorkspaceId)?.items ?? [];
    }
    return items.filter((i) => i.itemType === "thread").sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [workspaces, committedWorkspaceId]);

  // The effective selected thread — can be set from the hub itself or externally via store
  const effectiveSelectedId = localSelectedId ?? activeThreadId;
  const selectedThread = useMemo(
    () => threads.find((t) => t.id === effectiveSelectedId) ?? null,
    [threads, effectiveSelectedId],
  );

  // When external activeThreadId changes, clear local selection to follow it
  useEffect(() => {
    if (activeThreadId && activeThreadId !== localSelectedId) {
      setLocalSelectedId(activeThreadId);
    }
  }, [activeThreadId, localSelectedId]);

  const handleThreadClick = useCallback((thread: WorkspaceItemData) => {
    setLocalSelectedId(thread.id);
    openThreadInHub(thread.id);
    setFocusedItem(thread.id);
  }, [openThreadInHub, setFocusedItem]);

  const handleBackToList = useCallback(() => {
    setLocalSelectedId(null);
    closeThreadInHub();
  }, [closeThreadInHub]);

  const handleOpenFullView = useCallback((thread: WorkspaceItemData) => {
    setFocusedItem(thread.id);
    openDeepEdit(thread);
  }, [setFocusedItem, openDeepEdit]);

  const collapsed = (
    <button
      type="button"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-[14px] border border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
        "shadow-[0_10px_24px_-16px_rgba(8,22,40,0.14)] transition-all duration-200",
        "w-[36px] min-h-[100px] py-3.5 cursor-pointer hover:bg-[var(--bg-hover)]",
        // Highlight when a thread is active
        effectiveSelectedId && "border-[color-mix(in_oklab,var(--accent-cyan)_22%,var(--border-default))]",
        className,
      )}
    >
      <MessageSquare className="h-4 w-4 shrink-0 text-[var(--accent-cyan)]" />
      <span
        className="text-[10px] font-semibold text-[var(--text-secondary)]"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        Threads
      </span>
      {threads.length > 0 && (
        <span className="flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[var(--accent-cyan)] px-1 text-[8px] font-bold text-white">
          {threads.length}
        </span>
      )}
    </button>
  );

  return (
    <HubSurface
      id="threads-hub"
      edge="right"
      collapsed={collapsed}
      locked={locked}
      forceExpanded={forceExpanded}
      onToggleLock={() => setLocked((l) => !l)}
      className="!top-[140px] !-translate-y-0"
      expandedClassName="right-4 top-[120px]"
    >
      <div className="flex h-[min(72vh,620px)] w-[360px] flex-col overflow-hidden rounded-[28px]">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-[var(--border-default)]/10">
          <MessageSquare className="h-4 w-4 text-[var(--accent-cyan)]" />
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            Threads
          </span>
          {threads.length > 0 && (
            <span className="text-[10px] font-medium text-[var(--text-tertiary)]">
              {threads.length} active
            </span>
          )}
        </div>

        {/* Content: either list view or inline preview */}
        {selectedThread ? (
          <ThreadPreview
            thread={selectedThread}
            onBack={handleBackToList}
            onOpenFullView={handleOpenFullView}
          />
        ) : (
          <div className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
            {threads.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center text-center">
                <Sparkles className="mb-2 h-5 w-5 text-[var(--accent-cyan)] opacity-30" />
                <span className="text-[11px] text-[var(--text-tertiary)]/60">
                  No threads here yet.
                </span>
                <span className="mt-1 text-[9px] text-[var(--text-tertiary)]/40">
                  Start a conversation using the command bar.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {threads.map((thread) => (
                  <ThreadListItem
                    key={thread.id}
                    thread={thread}
                    isActive={thread.id === effectiveSelectedId}
                    onClick={() => handleThreadClick(thread)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </HubSurface>
  );
}
