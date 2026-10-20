"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, Check, MoreHorizontal, Share2, Star } from "@/components/icons/glyph-icons";
import { StatusBadge, type StatusTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MOTION_DURATIONS, MOTION_EASINGS } from "../motion/tokens";
import { getSpectraMotionSnapshot } from "../motion/motion-level";
import { useLifeArrival } from "../life/use-life";
import type { TreeNode } from "./tree-client";
import { nodeIdentity, relativeTime } from "./node-identity";

export const ROW_HEIGHT = 42;

export type RowCallbacks = {
  onPointerDown: (event: React.PointerEvent, node: TreeNode) => void;
  onClick: (event: React.MouseEvent, node: TreeNode) => void;
  onDoubleClick: (event: React.MouseEvent, node: TreeNode) => void;
  onOpen: (node: TreeNode) => void;
  onContextMenu: (event: React.MouseEvent, node: TreeNode) => void;
  onMenuButton: (event: React.MouseEvent, node: TreeNode) => void;
  onTogglePin: (node: TreeNode) => void;
  onCommitRename: (node: TreeNode, name: string) => void;
  onCancelRename: () => void;
};

/**
 * One row. Memoized on the handful of things that change its appearance,
 * because a 2,000-item folder re-renders its window on every scroll frame and
 * a row that re-renders for an unrelated reason is a dropped frame.
 */
export const OrganizerRow = memo(function OrganizerRow({
  node,
  top,
  selected,
  active,
  cursor,
  renaming,
  dropRing,
  insertion,
  inContext,
  showLocation,
  now,
  callbacks,
  picking = false,
  syncLabel,
  searchMatch,
  syncTone = "attention",
  ink,
}: {
  node: TreeNode;
  top: number;
  selected: boolean;
  active: boolean;
  cursor: boolean;
  renaming: boolean;
  dropRing: boolean;
  insertion: "top" | "bottom" | null;
  inContext: boolean;
  showLocation: boolean;
  now: number;
  callbacks: RowCallbacks;
  picking?: boolean;
  syncLabel?: string;
  searchMatch?: "Exact title match" | "Partial match";
  syncTone?: StatusTone;
  /** A class's ink (School), which a class workspace wears instead of its own colour. */
  ink?: string;
}) {
  const type = nodeIdentity(node);
  const identity = ink
    ? { ...type, color: ink, soft: `color-mix(in oklab, ${ink} 14%, var(--bg-elevated))` }
    : type;
  const Icon = identity.icon;
  const working =
    node.source?.aiState === "creating" || node.source?.aiState === "updating";
  const missing =
    node.source?.available === false || node.target?.available === false;

  /* Reorder settle (the org-tree motion grammar). Rows are absolutely
     positioned by their index, so a drop, expand/collapse or filter change
     would otherwise teleport them. When the measured position of a row that
     stays mounted changes, it travels from where it was — one transform
     animation on the compositor, on the shared motion tokens, skipped under
     reduced motion. WAAPI keeps this off inline styles, so the row's own
     color transitions are untouched. */
  const rowRef = useRef<HTMLDivElement | null>(null);
  const previousTop = useRef(top);
  useLayoutEffect(() => {
    const delta = previousTop.current - top;
    previousTop.current = top;
    const row = rowRef.current;
    if (!row || delta === 0) return;
    if (getSpectraMotionSnapshot().reduced) return;
    const animation = row.animate(
      [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
      {
        duration: MOTION_DURATIONS.base * 1000,
        easing: `cubic-bezier(${MOTION_EASINGS.standard.join(",")})`,
      },
    );
    return () => animation.cancel();
  }, [top]);

  /* A row new to the tree (LIFE.md): what Spectra is creating arrives from the
     prism, and a folder just made here (it opens in rename) forms where the
     user acted. The tree is virtualised, so rows mounting as it scrolls are
     plain content, and rows leaving it never part. */
  useLifeArrival(
    rowRef,
    `node:${node.nodeId}`,
    node.source?.aiState === "creating" ? "ai" : renaming ? "human" : undefined,
    { bars: "[data-node-title]" },
  );

  return (
    <div
      ref={rowRef}
      role="row"
      tabIndex={cursor ? 0 : -1}
      aria-selected={selected}
      aria-current={active ? "true" : undefined}
      data-active-work={active ? "true" : undefined}
      data-drop-node={node.nodeId}
      data-drop-kind={node.isContainer ? "container" : "item"}
      data-life-receive={node.isContainer || undefined}
      data-life-launch
      data-node-row={node.nodeId}
      style={{ top, height: ROW_HEIGHT }}
      className={cn(
        "spectra-organizer-row group absolute inset-x-0 flex cursor-default items-center gap-2.5 rounded-chip pl-2 pr-1.5 text-body transition-colors",
        active
          ? "bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--bg-elevated))] text-[var(--text-primary)]"
          : selected
            ? "bg-[color-mix(in_oklab,var(--brand-primary)_9%,var(--bg-elevated))] text-[var(--text-primary)]"
            : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
        cursor &&
          "ring-1 ring-[color-mix(in_oklab,var(--brand-primary)_45%,transparent)]",
        dropRing &&
          "bg-[color-mix(in_oklab,var(--brand-primary)_12%,var(--bg-elevated))] ring-2 ring-brand",
      )}
      onPointerDown={(event) => callbacks.onPointerDown(event, node)}
      onClick={(event) => callbacks.onClick(event, node)}
      onDoubleClick={(event) => callbacks.onDoubleClick(event, node)}
      onContextMenu={(event) => callbacks.onContextMenu(event, node)}
      onKeyDown={(event) => {
        if (renaming) return;
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        callbacks.onOpen(node);
      }}
    >
      {insertion ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-[var(--brand-primary)]",
            insertion === "top" ? "-top-px" : "-bottom-px",
          )}
        >
          <span className="absolute -left-0.5 -top-[3px] size-2 rounded-full bg-[var(--brand-primary)]" />
        </span>
      ) : null}

      {picking ? (
        <span
          aria-hidden
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-chip border",
            selected
              ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]"
              : "border-[var(--border-default)] text-transparent",
          )}
        >
          <Check className="size-3" />
        </span>
      ) : null}

      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-chip"
        style={{ backgroundColor: identity.soft }}
      >
        <Icon
          className="size-4"
          style={{ color: identity.color }}
          strokeWidth={1.9}
        />
      </span>

      {renaming ? (
        <RenameField
          initial={node.name}
          onCommit={(name) => callbacks.onCommitRename(node, name)}
          onCancel={callbacks.onCancelRename}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">
          <span
            data-node-title
            className={cn(
              missing && "text-[var(--text-tertiary)] line-through",
            )}
          >
            {node.name}
          </span>
          {node.kind === "link" ? (
            <span className="ml-1.5 text-micro text-[var(--text-tertiary)]">
              reference
            </span>
          ) : null}
          {node.isContainer && node.kind !== "workspace" ? (
            <span className="ml-2 text-caption text-[var(--text-tertiary)] tabular-nums">
              {node.childCount ?? 0} {node.childCount === 1 ? "item" : "items"}
            </span>
          ) : null}
          {node.source?.shared ? (
            <Share2
              className="ml-1.5 inline size-3 -translate-y-px text-[var(--text-tertiary)]"
              aria-label={
                node.source.owned ? "Shared by you" : "Shared with you"
              }
            />
          ) : null}
          {working ? (
            <span
              className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-[var(--brand-primary)] align-middle"
              aria-label="Spectra is working on this"
            />
          ) : null}
          {syncLabel ? (
            <StatusBadge
              tone={syncTone === "unknown" ? "neutral" : syncTone}
              className="ml-1.5 align-middle"
            >
              {syncLabel}
            </StatusBadge>
          ) : null}
        </span>
      )}

      {searchMatch && !renaming ? (
        <StatusBadge tone="neutral" className="shrink-0">
          {searchMatch}
        </StatusBadge>
      ) : null}

      {inContext ? (
        <span className="shrink-0 rounded-chip bg-[color-mix(in_oklab,var(--accent-mint)_14%,var(--bg-elevated))] px-1.5 py-px text-micro font-medium text-[var(--accent-mint)]">
          Context
        </span>
      ) : null}

      {showLocation ? (
        <span className="hidden w-[190px] shrink-0 truncate text-caption text-[var(--text-tertiary)] @3xl/rows:block">
          {node.parentPath?.length ? node.parentPath.join(" / ") : "Library"}
        </span>
      ) : null}

      <span className="hidden w-[104px] shrink-0 truncate text-caption text-[var(--text-secondary)] @xl/rows:block">
        {identity.label}
      </span>

      <span className="hidden w-[76px] shrink-0 text-right text-caption text-[var(--text-tertiary)] tabular-nums @lg/rows:block">
        {relativeTime(node.source?.updatedAt ?? node.updatedAt, now)}
      </span>

      <span className="flex w-[52px] shrink-0 items-center justify-end gap-0.5">
        <button
          type="button"
          aria-label={node.pinned ? `Unpin ${node.name}` : `Pin ${node.name}`}
          aria-pressed={node.pinned}
          onClick={(event) => {
            event.stopPropagation();
            callbacks.onTogglePin(node);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            "grid size-6 place-items-center rounded-chip text-[var(--text-tertiary)] transition-opacity hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]",
            node.pinned
              ? "text-[var(--accent-gold)] opacity-100"
              : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
          )}
        >
          <Star
            className="size-3.5"
            fill={node.pinned ? "currentColor" : "none"}
          />
        </button>
        <button
          type="button"
          aria-label={`Actions for ${node.name}`}
          onClick={(event) => {
            event.stopPropagation();
            callbacks.onMenuButton(event, node);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className="grid size-6 place-items-center rounded-chip text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </button>
        {node.isContainer ? (
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 text-[var(--text-tertiary)]"
          />
        ) : (
          <span aria-hidden className="size-3.5 shrink-0" />
        )}
      </span>
    </div>
  );
});

/** Rename in place: the row keeps its position, only the name becomes editable. */
function RenameField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    /* Select the stem, not the whole name: renaming usually means changing a
       word, and a full selection makes the reader retype what they kept. */
    input.setSelectionRange(0, initial.length);
  }, [initial]);

  return (
    <input
      ref={ref}
      value={value}
      aria-label="Name"
      onChange={(event) => setValue(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          settledRef.current = true;
          onCommit(value.trim());
        }
        if (event.key === "Escape") {
          settledRef.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (settledRef.current) return;
        settledRef.current = true;
        onCommit(value.trim());
      }}
      className="min-w-0 flex-1 rounded-chip border border-[var(--brand-primary)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-ui text-[var(--text-primary)] outline-none"
    />
  );
}
