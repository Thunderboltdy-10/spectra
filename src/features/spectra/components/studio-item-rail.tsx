"use client";

import { GripVertical, PanelLeft, Plus } from "@/components/icons/glyph-icons";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type StudioItemRailEntry = {
  id: string;
  title: string;
  subtitle?: string;
  active?: boolean;
  preview?: ReactNode;
};

/**
 * The one fullscreen left column for sequential work: questions, cards,
 * slides, files, pages. Expanded is the quiz list (number, title, caption).
 * Collapsed removes the column entirely so the host can keep a compact
 * show-control inside its own chrome. Types add extras in `tools` and
 * `footer`; they do not grow a second column.
 */
export function StudioItemRail({
  label,
  count,
  collapsed,
  onToggleCollapsed,
  items,
  onSelect,
  onAdd,
  addLabel,
  canEdit = false,
  draggingId,
  onDragStart,
  onDragEnd,
  onMove,
  showIndex = true,
  exportable = false,
  tools,
  footer,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  items: readonly StudioItemRailEntry[];
  onSelect: (id: string) => void;
  onAdd?: () => void;
  addLabel?: string;
  canEdit?: boolean;
  draggingId?: string;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  onMove?: (fromIndex: number, toIndex: number) => void;
  showIndex?: boolean;
  /** Drag items out of the rail, e.g. a Plan onto Calendar. */
  exportable?: boolean;
  tools?: ReactNode;
  footer?: ReactNode;
}) {
  const skipClickRef = useRef(false);
  const canDrag = Boolean(onMove) || exportable;
  if (collapsed) return null;
  return (
    <aside className="spectra-item-rail" aria-label={label}>
      <div className="spectra-item-rail-head">
        <button
          type="button"
          className="spectra-item-rail-toggle"
          onClick={onToggleCollapsed}
          aria-expanded="true"
          aria-label={`Hide ${label.toLowerCase()}`}
        >
          <PanelLeft className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {label} · {count}
          </span>
        </button>
        {canEdit && onAdd ? (
          <button
            type="button"
            className="spectra-item-rail-add"
            onClick={onAdd}
          >
            <Plus className="h-3.5 w-3.5" />
            {addLabel ?? "Add"}
          </button>
        ) : null}
      </div>
      {tools}
      <ul className="spectra-item-rail-list">
        {items.map((item, index) => (
          <li
            key={item.id}
            draggable={canDrag}
            onDragStart={(event) => {
              skipClickRef.current = true;
              onDragStart?.(item.id);
              event.dataTransfer.effectAllowed = onMove ? "move" : "copy";
              event.dataTransfer.setData("text/plain", item.id);
            }}
            onDragEnd={() => {
              onDragEnd?.();
              window.setTimeout(() => {
                skipClickRef.current = false;
              }, 0);
            }}
            onDragOver={(event) => {
              if (!canEdit || !onMove) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const movedId =
                event.dataTransfer.getData("text/plain") || draggingId;
              if (!movedId || !onMove) {
                onDragEnd?.();
                return;
              }
              const from = items.findIndex((entry) => entry.id === movedId);
              if (from >= 0) onMove(from, index);
              // Run this after the move callback. Some consumers use the
              // active drag id to identify the source, and clearing it first
              // turns a valid browser drop into a no-op.
              onDragEnd?.();
            }}
            data-dragging={draggingId === item.id || undefined}
          >
            <div
              role="button"
              tabIndex={0}
              className="spectra-item-rail-row"
              aria-current={item.active ? "true" : undefined}
              data-active={item.active || undefined}
              data-has-preview={item.preview ? true : undefined}
              data-index={showIndex || undefined}
              onClick={() => {
                if (skipClickRef.current) return;
                onSelect(item.id);
              }}
              onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelect(item.id);
              }}
            >
              {item.preview}
              {showIndex ? (
                <span className="spectra-item-rail-number">{index + 1}</span>
              ) : null}
              <span className="spectra-item-rail-copy">
                <span className="spectra-item-rail-title">{item.title}</span>
                {item.subtitle ? (
                  <span className="spectra-item-rail-subtitle">
                    {item.subtitle}
                  </span>
                ) : null}
              </span>
              {canEdit && canDrag ? (
                <GripVertical
                  aria-hidden="true"
                  className="h-3.5 w-3.5 text-[var(--text-tertiary)]"
                />
              ) : (
                <span />
              )}
            </div>
          </li>
        ))}
      </ul>
      {canEdit && onAdd ? (
        <button
          type="button"
          className="spectra-item-rail-add is-block"
          onClick={onAdd}
        >
          <Plus className="h-3.5 w-3.5" />
          {addLabel ?? "Add"}
        </button>
      ) : null}
      {footer}
    </aside>
  );
}
