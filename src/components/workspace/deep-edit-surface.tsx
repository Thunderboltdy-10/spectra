"use client";

import {
  X,
  Sparkles,
  BookOpen,
  Clock,
  Send,
  Lock,
  Unlock,
  MoreHorizontal,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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

function InlineAiBar({ itemTitle }: { itemTitle: string }) {
  const [query, setQuery] = useState("");

  return (
    <div className="border-t border-[var(--border-default)]/25 bg-[color-mix(in_oklab,var(--accent-cyan)_2%,var(--bg-elevated))]">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--accent-cyan)]/50" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Ask about ${itemTitle}...`}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]/60"
        />
        <button
          type="button"
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md transition-all duration-150",
            query.trim()
              ? "bg-[var(--accent-cyan)] text-white"
              : "bg-transparent text-[var(--text-tertiary)]/30",
          )}
        >
          <Send className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/* u2500u2500u2500 Thread Conversation View (de-emphasized, not full chat) u2500u2500u2500 */

function ThreadView() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-2.5">
          {/* User message */}
          <div className="ml-8 rounded-2xl bg-[var(--bg-secondary)]/70 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[var(--text-primary)]">
            Can you explain centripetal acceleration and how it relates to circular motion?
          </div>
          {/* AI response u2014 rendered as compact result, not chat bubble */}
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

/* u2500u2500u2500 Artifact Content View (primary surface) u2500u2500u2500 */

function ArtifactView({ item }: { item: WorkspaceItemData }) {
  const meta =
    CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4">
        {/* Item identity header */}
        <div className="mb-4 flex items-start gap-3">
          {meta?.icon ? (
            <div
              className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl"
              style={{
                backgroundColor: `color-mix(in oklab, ${meta.color} 10%, var(--bg-secondary))`,
              }}
            >
              <meta.icon
                className="h-4 w-4"
                style={{ color: meta.color }}
              />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
              {item.title}
            </h3>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
              <span
                className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
                style={{
                  backgroundColor: `color-mix(in oklab, ${meta?.color ?? "var(--text-tertiary)"} 8%, transparent)`,
                  color: meta?.color ?? "var(--text-tertiary)",
                }}
              >
                {meta?.label ?? item.itemType}
              </span>
              {item.updatedAt ? (
                <span className="flex items-center gap-1 text-[var(--text-tertiary)]/60">
                  <Clock className="h-2.5 w-2.5" />
                  updated
                </span>
              ) : null}
              {item.meta && (
                <span className="font-medium text-[var(--text-secondary)]">
                  {item.meta}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Content preview */}
        {item.preview ? (
          <p className="mb-4 text-[13px] leading-relaxed text-[var(--text-secondary)]">
            {item.preview}
          </p>
        ) : null}

        {/* Skeleton content area */}
        <div className="rounded-2xl border border-[var(--border-default)]/20 bg-[var(--bg-secondary)]/30 p-4">
          <div className="flex flex-col gap-2">
            <div className="h-3 w-[82%] rounded bg-[var(--text-primary)]/[0.05]" />
            <div className="h-3 w-[68%] rounded bg-[var(--text-primary)]/[0.05]" />
            <div className="h-3 w-[88%] rounded bg-[var(--text-primary)]/[0.05]" />
            <div className="h-3 w-[58%] rounded bg-[var(--text-primary)]/[0.05]" />
            <div className="h-3 w-[74%] rounded bg-[var(--text-primary)]/[0.05]" />
          </div>
        </div>

        {/* Quick actions u2014 action-first, not thread-first */}
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { label: "Edit", icon: "u270fu0327" },
            { label: "Summarize", icon: "u2728" },
            { label: "Expand", icon: "u2197u0327" },
          ].map((action) => (
            <button
              key={action.label}
              type="button"
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border-default)]/30 bg-[var(--bg-secondary)]/50 px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-all duration-150 hover:border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <span>{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
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
  const isThread = item.itemType === "thread";

  const collapsed = (
    <button
      type="button"
      className={cn(
        "flex flex-col items-center gap-2 rounded-l-[20px] border border-r-0 py-5 pl-2 pr-1.5 backdrop-blur-xl transition-all duration-200",
        isFocused
          ? "border-[color-mix(in_oklab,var(--accent-cyan)_25%,var(--border-default))] bg-[var(--bg-elevated)]/98 shadow-[0_10px_24px_-16px_rgba(14,142,232,0.18)]"
          : "border-[var(--border-default)]/45 bg-[var(--bg-elevated)]/95 shadow-[0_10px_24px_-16px_rgba(8,22,40,0.14)]",
      )}
    >
      {/* Focus connection indicator */}
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
        {/* Surface header u2014 shared for all item types */}
        <div
          className={cn(
            "flex h-11 shrink-0 items-center justify-between border-b px-4 transition-colors duration-200",
            isFocused
              ? "border-[color-mix(in_oklab,var(--accent-cyan)_15%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_2%,transparent)]"
              : "border-[var(--border-default)]/30",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            {/* Focus dot */}
            {isFocused && (
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)] shadow-[0_0_6px_2px_rgba(14,142,232,0.3)]" />
            )}
            {meta?.icon ? (
              <meta.icon
                className="h-3.5 w-3.5 text-[var(--text-tertiary)]"
                style={{ color: meta.color }}
              />
            ) : null}
            <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
              {item.title}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
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
                "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
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
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="More actions"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Content body u2014 context-appropriate, not thread-first */}
        {isThread ? <ThreadView /> : <ArtifactView item={item} />}

        {/* Inline AI bar u2014 action surface, not "continue conversation" */}
        <InlineAiBar itemTitle={item.title} />
      </div>
    </HubSurface>
  );
}
