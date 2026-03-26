"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MoreHorizontal,
  Pin,
  PinOff,
  Archive,
  ArchiveRestore,
  Trash2,
  ExternalLink,
  Clock,
} from "lucide-react";
import { getArtifactMeta } from "@/lib/artifact-types";
import { cn } from "@/lib/utils";

export type ArtifactItem = {
  _id: string;
  type: string;
  title: string;
  content: unknown;
  tags?: string[];
  status: string;
  pinnedAt?: number;
  linkedAgentId?: string;
  linkedChatId?: string;
  createdAt: number;
  updatedAt: number;
};

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function getContentPreview(type: string, content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as Record<string, unknown>;

  switch (type) {
    case "note":
      return typeof c.text === "string" ? c.text.slice(0, 120) : "";
    case "study_plan":
      if (Array.isArray(c.milestones)) return `${c.milestones.length} milestones`;
      return typeof c.description === "string" ? c.description.slice(0, 100) : "";
    case "flashcard_deck":
      if (Array.isArray(c.cards)) return `${c.cards.length} cards`;
      return "";
    case "timetable":
      if (Array.isArray(c.slots)) return `${c.slots.length} time slots`;
      return "";
    case "document":
      return typeof c.title === "string" ? c.title : "";
    case "code_project":
      return typeof c.language === "string" ? c.language : "";
    case "image":
      return typeof c.prompt === "string" ? c.prompt.slice(0, 100) : "";
    case "bookmark":
      return typeof c.note === "string" ? c.note.slice(0, 100) : "";
    case "collection":
      if (Array.isArray(c.items)) return `${c.items.length} items`;
      return "";
    default:
      return "";
  }
}

export function ArtifactCard({
  artifact,
  onClick,
  onPin,
  onArchive,
  onDelete,
  compact = false,
}: {
  artifact: ArtifactItem;
  onClick: () => void;
  onPin?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  compact?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const meta = getArtifactMeta(artifact.type);
  const Icon = meta.icon;
  const preview = getContentPreview(artifact.type, artifact.content);

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer flex-col rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] transition-all duration-200",
        "hover:border-[color-mix(in_oklab,var(--brand-primary)_40%,var(--border-default))] hover:shadow-[var(--shadow-hover)]",
        compact ? "p-3" : "p-4 pb-3",
        artifact.pinnedAt && "ring-1 ring-[color-mix(in_oklab,var(--brand-primary)_25%,transparent)]",
      )}
      onClick={onClick}
    >
      {/* Pin indicator */}
      {artifact.pinnedAt ? (
        <div className="absolute right-2.5 top-2.5 text-[var(--brand-primary)]">
          <Pin className="h-3 w-3 fill-current" />
        </div>
      ) : null}

      {/* Top accent bar */}
      <div
        className="mb-3.5 h-0.5 w-8 rounded-full"
        style={{ backgroundColor: `color-mix(in oklab, ${meta.color} 60%, transparent)` }}
      />

      {/* Type icon + badge */}
      <div className="mb-3 flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: `color-mix(in oklab, ${meta.color} 14%, var(--bg-primary))`,
            color: meta.color,
          }}
        >
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold leading-snug text-[var(--text-primary)]">
            {artifact.title}
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
            {meta.label}
          </p>
        </div>
      </div>

      {/* Preview */}
      {preview && !compact ? (
        <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          {preview}
        </p>
      ) : null}

      {/* Tags */}
      {artifact.tags && artifact.tags.length > 0 && !compact ? (
        <div className="mb-3 flex flex-wrap gap-1">
          {artifact.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]"
            >
              {tag}
            </span>
          ))}
          {artifact.tags.length > 3 ? (
            <span className="text-[10px] text-[var(--text-tertiary)]">
              +{artifact.tags.length - 3}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between border-t border-[var(--border-default)] pt-2.5">
        <span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
          <Clock className="h-3 w-3" />
          {timeAgo(artifact.updatedAt)}
        </span>

        {/* Context menu trigger */}
        <div className="relative z-10">
          <button
            ref={menuBtnRef}
            type="button"
            className="rounded-md p-1 text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((prev) => !prev);
            }}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>

          {menuOpen && typeof document !== "undefined" ? createPortal(
            <>
              <div
                className="fixed inset-0 z-[60]"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                }}
              />
              <div
                className="fixed z-[70] w-40 overflow-hidden rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-card)]"
                style={(() => {
                  const rect = menuBtnRef.current?.getBoundingClientRect();
                  if (!rect) return {};
                  return { top: rect.bottom + 4, left: rect.right - 160 };
                })()}
              >
                {onPin ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onPin();
                    }}
                  >
                    {artifact.pinnedAt ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    {artifact.pinnedAt ? "Unpin" : "Pin"}
                  </button>
                ) : null}
                {onArchive ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onArchive();
                    }}
                  >
                    {artifact.status === "archived" ? (
                      <ArchiveRestore className="h-3.5 w-3.5" />
                    ) : (
                      <Archive className="h-3.5 w-3.5" />
                    )}
                    {artifact.status === "archived" ? "Restore" : "Archive"}
                  </button>
                ) : null}
                {onDelete ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-primary))]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onDelete();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                ) : null}
              </div>
            </>,
            document.body,
          ) : null}
        </div>
      </div>
    </div>
  );
}

// A simpler inline card for timeline / list views
export function ArtifactRow({
  artifact,
  onClick,
}: {
  artifact: ArtifactItem;
  onClick: () => void;
}) {
  const meta = getArtifactMeta(artifact.type);
  const Icon = meta.icon;
  const preview = getContentPreview(artifact.type, artifact.content);

  return (
    <button
      type="button"
      className="group flex w-full items-center gap-3 border-b border-[var(--border-default)] px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
      onClick={onClick}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: `color-mix(in oklab, ${meta.color} 12%, var(--bg-primary))`,
          color: meta.color,
        }}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--text-primary)]">
            {artifact.title}
          </span>
          {artifact.pinnedAt ? <Pin className="h-3 w-3 shrink-0 fill-[var(--brand-primary)] text-[var(--brand-primary)]" /> : null}
        </div>
        {preview ? (
          <p className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">{preview}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {artifact.tags && artifact.tags.length > 0 ? (
          <span className="hidden rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)] sm:inline">
            {artifact.tags[0]}
            {artifact.tags.length > 1 ? ` +${artifact.tags.length - 1}` : ""}
          </span>
        ) : null}
        <span className="text-[10px] text-[var(--text-tertiary)]">
          {timeAgo(artifact.updatedAt)}
        </span>
        <ExternalLink className="h-3.5 w-3.5 text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </button>
  );
}
