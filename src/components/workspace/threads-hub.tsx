"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import {
  MessageSquare,
  Sparkles,
  ChevronLeft,
  ArrowUpRight,
  Clock,
  Send,
  User,
  Bot,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { WorkspaceItemData } from "@/lib/workspace/contracts";

/* ─── Thread Message (full conversation view) ─────────── */

type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

function ThreadMessageBubble({ message }: { message: ThreadMessage }) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "flex gap-2.5",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))]"
            : "bg-[color-mix(in_oklab,var(--accent-orange,#f59f0a)_8%,var(--bg-secondary))]",
        )}
      >
        {isUser ? (
          <User className="h-3 w-3 text-[var(--accent-cyan)]" />
        ) : (
          <Bot className="h-3 w-3 text-[var(--accent-orange,#f59f0a)]" />
        )}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-relaxed",
          isUser
            ? "rounded-tr-md bg-[color-mix(in_oklab,var(--accent-cyan)_6%,var(--bg-elevated))] border border-[color-mix(in_oklab,var(--accent-cyan)_12%,var(--border-default))] text-[var(--text-primary)]"
            : "rounded-tl-md bg-[var(--bg-elevated)] border border-[var(--border-default)]/20 text-[var(--text-primary)]",
        )}
      >
        {message.content}
      </div>
    </motion.div>
  );
}

/* ─── Full Thread View (entire conversation) ──────────── */

function FullThreadView({
  thread,
  onBack,
  onOpenDeepEdit,
}: {
  thread: WorkspaceItemData;
  onBack: () => void;
  onOpenDeepEdit: (thread: WorkspaceItemData) => void;
}) {
  const [inputValue, setInputValue] = useState("");

  // Parse thread preview into simulated messages for demo purposes.
  // In a real app, these would come from the thread's message array.
  const messages: ThreadMessage[] = useMemo(() => {
    const baseTimestamp = thread.updatedAt ?? 0;
    const base: ThreadMessage[] = [];

    if (thread.preview) {
      // Split preview on sentence boundaries to simulate user/AI exchange
      const sentences = thread.preview.split(/(?<=[.!?])\s+/);
      if (sentences.length >= 2) {
        base.push({
          id: `${thread.id}-u1`,
          role: "user",
          content: sentences.slice(0, Math.ceil(sentences.length / 2)).join(" "),
          timestamp: baseTimestamp - 120_000,
        });
        base.push({
          id: `${thread.id}-a1`,
          role: "assistant",
          content: sentences.slice(Math.ceil(sentences.length / 2)).join(" "),
          timestamp: baseTimestamp - 90_000,
        });
      } else {
        base.push({
          id: `${thread.id}-u1`,
          role: "user",
          content: thread.preview,
          timestamp: baseTimestamp - 120_000,
        });
        base.push({
          id: `${thread.id}-a1`,
          role: "assistant",
          content: "I'd be happy to help with that. Let me think about it...",
          timestamp: baseTimestamp - 90_000,
        });
      }
    }

    // Add a contextual AI response based on the title
    if (thread.title && base.length > 0) {
      base.push({
        id: `${thread.id}-a2`,
        role: "assistant",
        content: `Based on our discussion about "${thread.title}", here are the key points to consider. Would you like me to elaborate on any specific aspect?`,
        timestamp: baseTimestamp - 30_000,
      });
    }

    return base;
  }, [thread.id, thread.preview, thread.title, thread.updatedAt]);

  const handleSubmit = useCallback(() => {
    if (!inputValue.trim()) return;
    // In a real app, this would send the message to the chat API
    setInputValue("");
  }, [inputValue]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Thread header */}
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
          onClick={() => onOpenDeepEdit(thread)}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--accent-cyan)]"
          title="Open in deep edit"
        >
          <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>

      {/* Full message thread */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length > 0 ? (
          <div className="flex flex-col gap-3">
            <AnimatePresence>
              {messages.map((msg) => (
                <ThreadMessageBubble key={msg.id} message={msg} />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <div className="flex h-32 flex-col items-center justify-center text-center">
            <Sparkles className="mb-2 h-5 w-5 text-[var(--accent-cyan)] opacity-30" />
            <span className="text-[11px] text-[var(--text-tertiary)]/60">
              No messages yet
            </span>
            <span className="mt-1 text-[9px] text-[var(--text-tertiary)]/40">
              Use the input below to start a conversation
            </span>
          </div>
        )}
      </div>

      {/* Inline reply input */}
      <div className="border-t border-[var(--border-default)]/10 px-3 py-2">
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border-default)]/25 bg-[var(--bg-secondary)]/40 px-2.5 py-1.5">
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Reply\u2026"
            className="min-w-0 flex-1 border-none bg-transparent text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]/50"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!inputValue.trim()}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/10"
          >
            <Send className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Thread List Item ────────────────────────────────── */

function ThreadListItem({
  thread,
  isActive,
  onClick,
  now,
}: {
  thread: WorkspaceItemData;
  isActive: boolean;
  onClick: () => void;
  now: number;
}) {
  const timeAgo = useMemo(() => {
    if (!thread.updatedAt) return null;
    const diffMs = now - thread.updatedAt;
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }, [now, thread.updatedAt]);

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
  const [renderNow, setRenderNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setRenderNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

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

  const effectiveSelectedId = localSelectedId ?? activeThreadId;
  const selectedThread = useMemo(
    () => threads.find((t) => t.id === effectiveSelectedId) ?? null,
    [threads, effectiveSelectedId],
  );

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

  const handleOpenDeepEdit = useCallback((thread: WorkspaceItemData) => {
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
      expandedClassName=""
    >
      <div className="flex h-[min(72vh,620px)] w-[380px] flex-col overflow-hidden rounded-[28px]">
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

        {/* Content: full thread view or thread list */}
        {selectedThread ? (
          <FullThreadView
            thread={selectedThread}
            onBack={handleBackToList}
            onOpenDeepEdit={handleOpenDeepEdit}
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
                    now={renderNow}
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
