"use client";

import {
  X,
  Sparkles,
  BookOpen,
  Clock,
  Send,
  Lock,
  Unlock,
  Maximize2,
  Minimize2,
  Copy,
  Archive,
  Pin,
  PinOff,
  MoreHorizontal,
  ChevronRight,
  Edit3,
  Check,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HubSurface } from "@/components/workspace/hub-surface";
import type { WorkspaceItemData } from "@/lib/workspace/contracts";
import {
  CANONICAL_WORKSPACE_TYPE_META,
  type CanonicalWorkspaceType,
} from "@/lib/artifact-types";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

type DeepEditSurfaceProps = {
  item: WorkspaceItemData;
  locked?: boolean;
  pinned?: boolean;
  hidden?: boolean;
  onClose: () => void;
  onToggleLock: () => void;
  onTogglePin: () => void;
};

/* u2500u2500u2500 Inline AI Assist Bar u2500u2500u2500 */

function InlineAiBar({ itemTitle, onSend }: { itemTitle: string; onSend?: (query: string) => void }) {
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSending(true);
    onSend?.(trimmed);
    // Reset after brief delay
    setTimeout(() => {
      setQuery("");
      setSending(false);
    }, 300);
  }, [query, onSend]);

  return (
    <div className="border-t border-[var(--border-default)]/20 bg-[color-mix(in_oklab,var(--accent-cyan)_2%,var(--bg-elevated))]">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <Sparkles className={cn("h-3.5 w-3.5 shrink-0 transition-colors duration-200", sending ? "text-[var(--accent-cyan)]" : "text-[var(--accent-cyan)]/40")} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
          placeholder={`Ask about ${itemTitle}u2026`}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]/50"
        />
        <button
          type="button"
          onClick={handleSend}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md transition-all duration-150",
            query.trim()
              ? "bg-[var(--accent-cyan)] text-white shadow-[0_2px_8px_-3px_rgba(14,142,232,0.40)]"
              : "bg-transparent text-[var(--text-tertiary)]/30",
          )}
        >
          <Send className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/* u2500u2500u2500 Thread Conversation View u2500u2500u2500 */

function ThreadView() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-2.5">
          <div className="ml-8 rounded-2xl bg-[var(--bg-secondary)]/70 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[var(--text-primary)]">
            Can you explain centripetal acceleration and how it relates to circular motion?
          </div>
          <div className="flex items-start gap-2">
            <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))]">
              <Sparkles className="h-2.5 w-2.5 text-[var(--accent-cyan)]" />
            </div>
            <div className="rounded-2xl border border-[var(--border-default)]/20 bg-[var(--bg-elevated)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[var(--text-primary)]">
              Centripetal acceleration points toward the center of a circular path and changes the direction of motion rather than the speed.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* u2500u2500u2500 Quick Action Button u2500u2500u2500 */

function QuickAction({
  icon,
  label,
  onClick,
  variant = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-medium transition-all duration-150",
        variant === "primary"
          ? "border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_6%,var(--bg-secondary))] text-[var(--accent-cyan)] hover:bg-[color-mix(in_oklab,var(--accent-cyan)_12%,var(--bg-secondary))]"
          : variant === "danger"
            ? "border-[var(--border-default)]/25 bg-[var(--bg-secondary)]/40 text-[var(--text-tertiary)] hover:border-[color-mix(in_oklab,var(--accent-coral)_20%,var(--border-default))] hover:bg-[color-mix(in_oklab,var(--accent-coral)_6%,var(--bg-secondary))] hover:text-[var(--accent-coral)]"
            : "border-[var(--border-default)]/25 bg-[var(--bg-secondary)]/40 text-[var(--text-tertiary)] hover:border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/* u2500u2500u2500 Editable Title u2500u2500u2500 */

function EditableTitle({
  title,
  onChange,
}: {
  title: string;
  onChange?: (newTitle: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) {
      onChange?.(trimmed);
    } else {
      setDraft(title);
    }
    setEditing(false);
  }, [draft, title, onChange]);

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(title); setEditing(false); }
          }}
          className="min-w-0 flex-1 truncate rounded-md border border-[var(--accent-cyan)]/30 bg-[var(--bg-secondary)]/60 px-1.5 py-0.5 text-[13px] font-semibold text-[var(--text-primary)] outline-none"
        />
        <button
          type="button"
          onClick={commit}
          className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--accent-cyan)] text-white"
        >
          <Check className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  }

  return (
    <span
      className="group/title flex cursor-text items-center gap-1 truncate text-[13px] font-semibold text-[var(--text-primary)]"
      onClick={() => setEditing(true)}
    >
      <span className="truncate">{title}</span>
      <Edit3 className="h-2.5 w-2.5 shrink-0 text-[var(--text-tertiary)]/0 transition-colors group-hover/title:text-[var(--text-tertiary)]/60" />
    </span>
  );
}

/* u2500u2500u2500 Artifact Content View u2500u2500u2500 */

function ArtifactView({ item }: { item: WorkspaceItemData }) {
  const meta = CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {/* Content preview */}
        {item.preview ? (
          <div className="px-5 pt-4 pb-2">
            <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
              {item.preview}
            </p>
          </div>
        ) : null}

        {/* Content body u2014 editable area feel instead of skeleton */}
        <div className="px-5 pb-4">
          <div
            className={cn(
              "group/content min-h-[120px] rounded-2xl border border-[var(--border-default)]/15 p-5 transition-all duration-200",
              "bg-[var(--bg-secondary)]/20 hover:border-[var(--border-default)]/30 hover:bg-[var(--bg-secondary)]/30",
              "cursor-text",
            )}
          >
            <div
              className="min-h-[80px] text-[13px] leading-relaxed text-[var(--text-secondary)]/80 outline-none"
              contentEditable
              suppressContentEditableWarning
            >
              {item.preview
                ? `${item.preview}\n\nStart editing here to expand this contentu2026`
                : "Start writing hereu2026"}
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]/40 opacity-0 transition-opacity duration-200 group-hover/content:opacity-100">
              {meta?.icon && (
                <meta.icon className="h-2.5 w-2.5" style={{ color: meta.color }} />
              )}
              <span>{meta?.label ?? item.itemType} u00b7 Click to edit</span>
            </div>
          </div>
        </div>

        {/* Item metadata section */}
        <div className="border-t border-[var(--border-default)]/10 px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-[var(--text-tertiary)]/60">
            <span className="flex items-center gap-1">
              <span className="font-semibold uppercase tracking-[0.1em]" style={{ color: meta?.color }}>Type:</span>
              {meta?.label ?? item.itemType}
            </span>
            <span className="flex items-center gap-1">
              <span className="font-semibold uppercase tracking-[0.1em]">Status:</span>
              {item.status}
            </span>
            {item.meta && (
              <span className="flex items-center gap-1">
                <span className="font-semibold uppercase tracking-[0.1em]">Info:</span>
                {item.meta}
              </span>
            )}
            {item.updatedAt && (
              <span className="flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                {new Date(item.updatedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {/* Quick actions u2014 contextual, actionable */}
        <div className="px-5 pb-4">
          <div className="flex flex-wrap gap-2">
            <QuickAction
              icon={<Sparkles className="h-3 w-3" />}
              label="Summarize"
              variant="primary"
            />
            <QuickAction
              icon={<ChevronRight className="h-3 w-3" />}
              label="Expand"
            />
            <QuickAction
              icon={<Copy className="h-3 w-3" />}
              label="Duplicate"
            />
            <QuickAction
              icon={<Archive className="h-3 w-3" />}
              label="Archive"
              variant="danger"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* u2500u2500u2500 Context Menu u2500u2500u2500 */

function SurfaceContextMenu({
  open,
  onClose,
  onDuplicate,
  onArchive,
  onPin,
  isPinned,
}: {
  open: boolean;
  onClose: () => void;
  onDuplicate?: () => void;
  onArchive?: () => void;
  onPin?: () => void;
  isPinned?: boolean;
}) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[160px] rounded-xl border border-[var(--border-default)]/50 bg-[var(--bg-elevated)]/98 p-1 shadow-[0_12px_32px_-12px_rgba(8,22,40,0.28)] backdrop-blur-xl">
        {onPin && (
          <button
            type="button"
            onClick={() => { onPin(); onClose(); }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {isPinned ? "Unpin" : "Pin to workspace"}
          </button>
        )}
        {onDuplicate && (
          <button
            type="button"
            onClick={() => { onDuplicate(); onClose(); }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </button>
        )}
        <div className="my-0.5 h-px bg-[var(--border-default)]/20" />
        {onArchive && (
          <button
            type="button"
            onClick={() => { onArchive(); onClose(); }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent-coral)_6%,var(--bg-hover))] hover:text-[var(--accent-coral)]"
          >
            <Archive className="h-3.5 w-3.5" />
            Archive
          </button>
        )}
      </div>
    </>
  );
}

/* u2500u2500u2500 Main Deep Edit Surface u2500u2500u2500 */

export function DeepEditSurface({
  item,
  locked = false,
  pinned = false,
  hidden = false,
  onClose,
  onToggleLock,
  onTogglePin,
}: DeepEditSurfaceProps) {
  const meta = useMemo(
    () =>
      CANONICAL_WORKSPACE_TYPE_META[
        item.itemType as CanonicalWorkspaceType
      ],
    [item.itemType],
  );
  const focusedItemId = useWorkspaceStore((s) => s.focusedItemId);
  const isFocused = focusedItemId === item.id;
  const [expanded, setExpanded] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const isThread = item.itemType === "thread";

  const collapsed = (
    <button
      type="button"
      className={cn(
        "flex flex-col items-center gap-2 rounded-l-[32px] border border-r-0 py-5 pl-2 pr-1.5 backdrop-blur-xl transition-all duration-200",
        isFocused
          ? "border-[color-mix(in_oklab,var(--accent-cyan)_25%,var(--border-default))] bg-[var(--bg-elevated)]/98 shadow-[0_10px_24px_-16px_rgba(14,142,232,0.18)]"
          : "border-[var(--border-default)]/45 bg-[var(--bg-elevated)]/95 shadow-[0_10px_24px_-16px_rgba(8,22,40,0.14)]",
      )}
    >
      {isFocused && (
        <div
          className="absolute -left-0.5 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-full bg-[var(--accent-cyan)]/60"
        />
      )}
      {meta?.icon ? (
        <meta.icon
          className="h-4 w-4 text-[var(--text-secondary)]"
          style={{ color: meta.color }}
        />
      ) : (
        <BookOpen className="h-4 w-4 text-[var(--text-secondary)]" />
      )}
      <span
        className="max-h-[120px] text-[10px] font-semibold text-[var(--text-secondary)]"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        {item.title}
      </span>
    </button>
  );

  const handleClose = useCallback(() => onClose(), [onClose]);

  const handleTitleChange = useCallback((newTitle: string) => {
    // Title change u2014 would fire backend mutation when wired
    console.log("[deep-edit] Title changed:", newTitle);
  }, []);

  const handleAiSend = useCallback((query: string) => {
    console.log("[deep-edit] AI query:", query);
  }, []);

  return (
    <HubSurface
      id={`deep-edit-${item.id}`}
      edge="right"
      collapsed={collapsed}
      locked={locked}
      pinned={pinned}
      hidden={hidden}
      onToggleLock={onToggleLock}
      onTogglePin={onTogglePin}
      expandedClassName="right-0 top-1/2 -translate-y-1/2"
    >
      <div
        className={cn(
          "flex flex-col transition-all duration-300",
          expanded ? "h-[680px] w-[520px]" : "h-[560px] w-[420px]",
        )}
      >
        {/* Surface header u2014 clean, minimal controls */}
        <div
          className={cn(
            "flex h-12 shrink-0 items-center justify-between border-b px-4 transition-colors duration-200",
            isFocused
              ? "border-[color-mix(in_oklab,var(--accent-cyan)_15%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_2%,transparent)]"
              : "border-[var(--border-default)]/25",
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {/* Type icon + focus indicator */}
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200",
                isFocused && "ring-1 ring-[var(--accent-cyan)]/20",
              )}
              style={{
                backgroundColor: `color-mix(in oklab, ${meta?.color ?? "#637083"} ${isFocused ? "12" : "8"}%, var(--bg-secondary))`,
              }}
            >
              {meta?.icon ? (
                <meta.icon
                  className="h-3.5 w-3.5"
                  style={{ color: meta.color }}
                />
              ) : null}
            </div>
            <div className="min-w-0">
              <EditableTitle title={item.title} onChange={handleTitleChange} />
              <div className="flex items-center gap-1.5">
                <span
                  className="text-[9px] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: `color-mix(in oklab, ${meta?.color ?? "var(--text-tertiary)"} 60%, transparent)` }}
                >
                  {meta?.label ?? item.itemType}
                </span>
                {item.updatedAt ? (
                  <span className="flex items-center gap-0.5 text-[9px] text-[var(--text-tertiary)]/50">
                    <Clock className="h-2 w-2" />
                    updated
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Controls u2014 expand, lock, more, close */}
          <div className="relative flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label={expanded ? "Minimize" : "Expand"}
            >
              {expanded ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={onToggleLock}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
                locked
                  ? "text-[var(--accent-cyan)] hover:bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)]"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
              )}
              aria-label={locked ? "Unlock" : "Lock open"}
            >
              {locked ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <Unlock className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setContextMenuOpen((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="More actions"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            <SurfaceContextMenu
              open={contextMenuOpen}
              onClose={() => setContextMenuOpen(false)}
              onPin={onTogglePin}
              isPinned={pinned}
              onDuplicate={() => console.log("[deep-edit] Duplicate", item.id)}
              onArchive={() => console.log("[deep-edit] Archive", item.id)}
            />
            <button
              type="button"
              onClick={handleClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Content body */}
        {isThread ? <ThreadView /> : <ArtifactView item={item} />}

        {/* Inline AI bar */}
        <InlineAiBar itemTitle={item.title} onSend={handleAiSend} />
      </div>
    </HubSurface>
  );
}
