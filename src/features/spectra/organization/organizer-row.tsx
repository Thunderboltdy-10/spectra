"use client";

import { memo, useEffect, useRef, useState } from "react";
import { ChevronRight, MoreHorizontal, Share2, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TreeNode } from "./tree-client";
import { nodeIdentity, relativeTime } from "./node-identity";

export const ROW_HEIGHT = 36;

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
  cursor,
  renaming,
  dropRing,
  insertion,
  inContext,
  showLocation,
  now,
  callbacks,
}: {
  node: TreeNode;
  top: number;
  selected: boolean;
  cursor: boolean;
  renaming: boolean;
  dropRing: boolean;
  insertion: "top" | "bottom" | null;
  inContext: boolean;
  showLocation: boolean;
  now: number;
  callbacks: RowCallbacks;
}) {
  const identity = nodeIdentity(node);
  const Icon = identity.icon;
  const working =
    node.source?.aiState === "creating" || node.source?.aiState === "updating";
  const missing = node.source?.available === false || node.target?.available === false;

  return (
    <div
      role="row"
      aria-selected={selected}
      data-drop-node={node.nodeId}
      data-drop-kind={node.isContainer ? "container" : "item"}
      data-node-row={node.nodeId}
      style={{ top, height: ROW_HEIGHT }}
      className={cn(
        "group absolute inset-x-0 flex cursor-default items-center gap-2 rounded-[6px] pl-2 pr-1.5 text-[13px] transition-colors",
        selected
          ? "bg-[color-mix(in_oklab,var(--brand-primary)_9%,var(--bg-elevated))] text-[var(--text-primary)]"
          : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
        cursor &&
          "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--brand-primary)_45%,transparent)]",
        dropRing &&
          "bg-[color-mix(in_oklab,var(--brand-primary)_12%,var(--bg-elevated))] shadow-[inset_0_0_0_2px_var(--brand-primary)]",
      )}
      onPointerDown={(event) => callbacks.onPointerDown(event, node)}
      onClick={(event) => callbacks.onClick(event, node)}
      onDoubleClick={(event) => callbacks.onDoubleClick(event, node)}
      onContextMenu={(event) => callbacks.onContextMenu(event, node)}
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

      <span
        aria-hidden
        className="flex size-[22px] shrink-0 items-center justify-center rounded-[5px]"
        style={{ backgroundColor: identity.soft }}
      >
        <Icon className="size-[13px]" style={{ color: identity.color }} strokeWidth={1.9} />
      </span>

      {renaming ? (
        <RenameField
          initial={node.name}
          onCommit={(name) => callbacks.onCommitRename(node, name)}
          onCancel={callbacks.onCancelRename}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">
          <span className={cn(missing && "text-[var(--text-tertiary)] line-through")}>
            {node.name}
          </span>
          {node.kind === "link" ? (
            <span className="ml-1.5 text-[11px] text-[var(--text-tertiary)]">
              reference
            </span>
          ) : null}
          {node.source?.shared ? (
            <Share2
              className="ml-1.5 inline size-3 -translate-y-px text-[var(--text-tertiary)]"
              aria-label={node.source.owned ? "Shared by you" : "Shared with you"}
            />
          ) : null}
          {working ? (
            <span
              className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-[var(--brand-primary)] align-middle"
              aria-label="Spectra is working on this"
            />
          ) : null}
        </span>
      )}

      {inContext ? (
        <span className="shrink-0 rounded-[4px] bg-[color-mix(in_oklab,var(--accent-mint)_14%,var(--bg-elevated))] px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--accent-mint)]">
          Context
        </span>
      ) : null}

      {showLocation ? (
        <span className="hidden w-[190px] shrink-0 truncate text-[12px] text-[var(--text-tertiary)] @3xl/rows:block">
          {node.parentPath?.length ? node.parentPath.join(" / ") : "Library"}
        </span>
      ) : null}

      <span className="hidden w-[104px] shrink-0 truncate text-[12px] text-[var(--text-secondary)] @xl/rows:block">
        {identity.label}
      </span>

      <span className="hidden w-[76px] shrink-0 text-right text-[12px] text-[var(--text-tertiary)] tabular-nums @lg/rows:block">
        {node.isContainer && node.kind !== "workspace"
          ? `${node.childCount ?? 0}`
          : relativeTime(node.source?.updatedAt ?? node.updatedAt, now)}
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
            "grid size-6 place-items-center rounded-[5px] text-[var(--text-tertiary)] transition-opacity hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]",
            node.pinned
              ? "text-[var(--accent-gold)] opacity-100"
              : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
          )}
        >
          <Star className="size-3.5" fill={node.pinned ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          aria-label={`Actions for ${node.name}`}
          onClick={(event) => {
            event.stopPropagation();
            callbacks.onMenuButton(event, node);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className="grid size-6 place-items-center rounded-[5px] text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
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
      className="min-w-0 flex-1 rounded-[5px] border border-[var(--brand-primary)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[13px] text-[var(--text-primary)] outline-none"
    />
  );
}
