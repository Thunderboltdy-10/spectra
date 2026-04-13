"use client";

import {
  Sparkles,
  BookOpen,
  Lock,
  Unlock,
  Copy,
  Archive,
  MoreHorizontal,
  Edit3,
  Check,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
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
};

/* --- Thread Conversation View --- */

function ThreadView({ item }: { item: WorkspaceItemData }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-5">
        {item.preview ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border border-[var(--border-default)]/20 bg-[var(--bg-elevated)] px-4 py-3 text-[13px] leading-relaxed text-[var(--text-primary)]">
              {item.preview}
            </div>
          </div>
        ) : (
          <div className="flex h-40 flex-col items-center justify-center text-center">
            <Sparkles className="mb-2 h-5 w-5 text-[var(--accent-cyan)] opacity-30" />
            <span className="text-[12px] text-[var(--text-tertiary)]">No messages yet</span>
            <span className="mt-1 text-[10px] text-[var(--text-tertiary)]/50">Use the command bar to start a conversation</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* --- Editable Title --- */

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
          className="min-w-0 flex-1 truncate rounded-md border border-[var(--accent-cyan)]/30 bg-[var(--bg-secondary)]/60 px-1.5 py-0.5 text-[14px] font-semibold text-[var(--text-primary)] outline-none"
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
      className="group/title flex cursor-text items-center gap-1 truncate text-[14px] font-semibold text-[var(--text-primary)]"
      onClick={() => setEditing(true)}
    >
      <span className="truncate">{title}</span>
      <Edit3 className="h-2.5 w-2.5 shrink-0 text-[var(--text-tertiary)]/0 transition-colors group-hover/title:text-[var(--text-tertiary)]/60" />
    </span>
  );
}

/* --- Artifact Content View --- */

function ArtifactView({ item }: { item: WorkspaceItemData }) {
  const isEditable = ["note", "code", "export"].includes(item.itemType);
  const isCode = item.itemType === "code";
  const [content, setContent] = useState(item.preview ?? "");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-4 h-full">
          {isEditable ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={isCode ? "// Start coding here\u2026" : "Start writing here\u2026"}
              className={cn(
                "w-full h-full min-h-[280px] resize-none rounded-2xl p-5 transition-all duration-200",
                "bg-[var(--bg-secondary)]/10 hover:bg-[var(--bg-secondary)]/20",
                "focus:bg-[var(--bg-secondary)]/25 focus:ring-1 focus:ring-[var(--accent-cyan)]/15",
                "text-[14px] leading-[1.7] text-[var(--text-primary)] outline-none",
                "placeholder:text-[var(--text-tertiary)]/40",
                isCode && "font-mono text-[13px] leading-[1.6]",
              )}
            />
          ) : (
            <div className="min-h-[240px] rounded-2xl bg-[var(--bg-secondary)]/10 p-5">
              <p className="text-[14px] leading-[1.7] text-[var(--text-primary)]">
                {item.preview || (
                  <span className="text-[var(--text-tertiary)]/50">No content yet</span>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- Context Menu --- */

function SurfaceContextMenu({
  open,
  onClose,
  onDuplicate,
  onArchive,
}: {
  open: boolean;
  onClose: () => void;
  onDuplicate?: () => void;
  onArchive?: () => void;
}) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[160px] rounded-xl border border-[var(--border-default)]/50 bg-[var(--bg-elevated)]/98 p-1 shadow-[0_12px_32px_-12px_rgba(8,22,40,0.28)] backdrop-blur-xl">
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

/* --- Main Deep Edit Surface --- */

export function DeepEditSurface({
  item,
  locked = false,
  pinned = false,
  hidden = false,
  onClose,
  onToggleLock,
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
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const isThread = item.itemType === "thread";

  const collapsed = (
    <button
      type="button"
      className={cn(
        "flex items-center gap-3 rounded-l-[22px] border border-r-0 py-3 pl-3 pr-3 backdrop-blur-xl transition-all duration-200",
        isFocused
          ? "border-[color-mix(in_oklab,var(--accent-cyan)_25%,var(--border-default))] bg-[var(--bg-elevated)]/98 shadow-[0_10px_24px_-16px_rgba(14,142,232,0.18)]"
          : "border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 shadow-[0_10px_24px_-16px_rgba(8,22,40,0.14)]",
      )}
    >
      {isFocused && (
        <div className="absolute -left-0.5 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-full bg-[var(--accent-cyan)]/60" />
      )}
      {meta?.icon ? (
        <meta.icon
          className="h-4.5 w-4.5 shrink-0"
          style={{ color: meta.color }}
        />
      ) : (
        <BookOpen className="h-4.5 w-4.5 text-[var(--text-secondary)]" />
      )}
      <span className="max-w-[100px] truncate text-[11px] font-semibold text-[var(--text-secondary)]">
        {item.title}
      </span>
    </button>
  );

  const handleTitleChange = useCallback((newTitle: string) => {
    console.log("[deep-edit] Title changed:", newTitle);
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
      expandedClassName="right-0 top-1/2 -translate-y-1/2"
    >
      <div className="flex h-[620px] w-[460px] flex-col overflow-hidden">
        {/* Surface header u2014 clean, minimal: type icon + title + single lock */}
        <div
          className={cn(
            "flex h-11 shrink-0 items-center justify-between border-b px-4 transition-colors duration-200",
            isFocused
              ? "border-[color-mix(in_oklab,var(--accent-cyan)_15%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_2%,transparent)]"
              : "border-[var(--border-default)]/20",
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
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
                <meta.icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <EditableTitle title={item.title} onChange={handleTitleChange} />
              <span
                className="text-[9px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: `color-mix(in oklab, ${meta?.color ?? "var(--text-tertiary)"} 60%, transparent)` }}
              >
                {meta?.label ?? item.itemType}
              </span>
            </div>
          </div>

          {/* Controls u2014 only lock + more menu */}
          <div className="relative flex items-center gap-0.5">
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
              {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
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
              onDuplicate={() => console.log("[deep-edit] Duplicate", item.id)}
              onArchive={() => console.log("[deep-edit] Archive", item.id)}
            />
          </div>
        </div>

        {/* Content body u2014 maximum space for actual content */}
        {isThread ? <ThreadView item={item} /> : <ArtifactView item={item} />}
        <button type="button" className="sr-only" onClick={onClose}>Close</button>
      </div>
    </HubSurface>
  );
}
