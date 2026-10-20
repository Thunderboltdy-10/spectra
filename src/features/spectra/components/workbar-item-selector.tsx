"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useFloatingLayer } from "@/components/ui/layer-context";
import { LAYER_CLASS } from "@/components/ui/layers";
import { cn } from "@/lib/utils";

export type WorkbarItem = { value: string; label: string; disabled?: boolean };

/** Lists longer than this get a filter at the top of the picker. */
const FILTER_FROM = 8;
const LIST_MAX_HEIGHT = 380;

type Placement = {
  top: number;
  left: number;
  width: number;
  above: boolean;
  /** The work's ink, carried across the portal so the open part wears it. */
  ink: string;
  maxHeight: number;
};

/**
 * The item picker for every type with a list of parts: slides, cards,
 * questions, files, pages and sheets. Previous and next step through them;
 * the title between opens the whole list, numbered because the parts are a
 * sequence, with the open one marked in the work's ink and a filter once the
 * list is long.
 *
 * The list is Spectra's own, not Radix Select: pickers sit in studios sized by
 * ResizeObserver, where Radix SelectValue looped `setState` as the trigger's
 * width fluttered. This one renders only on the user's action and portals to
 * the body, so the bar's overflow never clips it and a panel never covers it.
 */
export function WorkbarItemSelector({
  ariaLabel,
  items,
  value,
  onChange,
  itemNoun = "item",
  className,
}: {
  ariaLabel: string;
  items: ReadonlyArray<WorkbarItem>;
  value: string;
  onChange: (value: string) => void;
  /** Used in "3 of 12" and in the previous/next accessible names. */
  itemNoun?: string;
  className?: string;
}) {
  const index = items.findIndex((item) => item.value === value);
  const current = index >= 0 ? items[index] : items[0];
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (!items.length || !current) return null;
  const step = (delta: number) => {
    const next = items[Math.min(items.length - 1, Math.max(0, index + delta))];
    if (next && next.value !== value) onChange(next.value);
  };

  return (
    <div className={cn("spectra-workbar-item-selector", className)}>
      <button
        type="button"
        className="spectra-workbar-step"
        aria-label={`Previous ${itemNoun}`}
        title={`Previous ${itemNoun}`}
        disabled={index <= 0}
        onClick={() => step(-1)}
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        ref={triggerRef}
        type="button"
        className="spectra-workbar-item-trigger"
        aria-label={`${ariaLabel}: ${current.label}, ${index + 1} of ${items.length}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-open={open || undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="spectra-workbar-item-label">{current.label}</span>
        <span className="spectra-workbar-item-position">
          {index + 1}/{items.length}
        </span>
        <ChevronDown className="size-3.5 shrink-0" />
      </button>
      <button
        type="button"
        className="spectra-workbar-step"
        aria-label={`Next ${itemNoun}`}
        title={`Next ${itemNoun}`}
        disabled={index < 0 || index >= items.length - 1}
        onClick={() => step(1)}
      >
        <ChevronRight className="size-4" />
      </button>
      {open ? (
        <ItemList
          anchor={triggerRef}
          ariaLabel={ariaLabel}
          items={items}
          value={current.value}
          itemNoun={itemNoun}
          onPick={(next) => {
            setOpen(false);
            triggerRef.current?.focus({ preventScroll: true });
            if (next !== value) onChange(next);
          }}
          onDismiss={(returnFocus) => {
            setOpen(false);
            if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
          }}
        />
      ) : null}
    </div>
  );
}

function ItemList({
  anchor,
  ariaLabel,
  items,
  value,
  itemNoun,
  onPick,
  onDismiss,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  ariaLabel: string;
  items: ReadonlyArray<WorkbarItem>;
  value: string;
  itemNoun: string;
  onPick: (value: string) => void;
  onDismiss: (returnFocus: boolean) => void;
}) {
  const layer = useFloatingLayer();
  const listId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [query, setQuery] = useState("");
  const showFilter = items.length >= FILTER_FROM;

  // Positions are kept with the item so the numbers stay true while filtering.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .map((item, position) => ({ ...item, position }))
      .filter((item) => !needle || item.label.toLowerCase().includes(needle));
  }, [items, query]);
  const [cursor, setCursor] = useState(() =>
    Math.max(0, items.findIndex((item) => item.value === value)),
  );
  const activeCursor = Math.min(cursor, Math.max(0, shown.length - 1));

  useLayoutEffect(() => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width + 56, 300);
    // The island's band at the bottom is not room: a list under it is hidden.
    const island =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--spectra-composer-safe-area"),
      ) || 0;
    const roomBelow = window.innerHeight - rect.bottom - island;
    const above = roomBelow < Math.min(LIST_MAX_HEIGHT, 240) && rect.top > roomBelow;
    const ink = anchor.current
      ? getComputedStyle(anchor.current).getPropertyValue("--editor-ink").trim()
      : "";
    setPlacement({
      ink,
      maxHeight: Math.max(160, Math.min(LIST_MAX_HEIGHT, (above ? rect.top : roomBelow) - 24)),
      top: above ? rect.top - 6 : rect.bottom + 6,
      left: Math.min(Math.max(8, rect.left - 28), window.innerWidth - width - 8),
      width,
      above,
    });
  }, [anchor]);

  useEffect(() => {
    if (!placement) return;
    if (showFilter) filterRef.current?.focus({ preventScroll: true });
    else surfaceRef.current?.focus({ preventScroll: true });
    surfaceRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "center" });
  }, [placement, showFilter]);

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (surfaceRef.current?.contains(target)) return;
      if (anchor.current?.contains(target)) return;
      onDismiss(false);
    };
    const dismissOnResize = () => onDismiss(false);
    document.addEventListener("pointerdown", dismissOutside, true);
    window.addEventListener("resize", dismissOnResize);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      window.removeEventListener("resize", dismissOnResize);
    };
  }, [anchor, onDismiss]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    // The studio closes on Escape; here Escape only closes the list.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onDismiss(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = Math.min(shown.length - 1, Math.max(0, activeCursor + delta));
      setCursor(next);
      surfaceRef.current
        ?.querySelector<HTMLElement>(`[data-cursor-index="${next}"]`)
        ?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const picked = shown[activeCursor];
      if (picked && !picked.disabled) onPick(picked.value);
      return;
    }
    if (event.key === "Tab") onDismiss(false);
    event.stopPropagation();
  };

  if (!placement) return null;
  return createPortal(
    <div
      ref={surfaceRef}
      tabIndex={-1}
      className={cn("spectra-item-picker", LAYER_CLASS[layer])}
      data-above={placement.above || undefined}
      style={{
        ...(placement.ink ? { "--editor-ink": placement.ink } : null),
        top: placement.above ? undefined : placement.top,
        bottom: placement.above ? window.innerHeight - placement.top : undefined,
        left: placement.left,
        width: placement.width,
      } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      {showFilter ? (
        <input
          ref={filterRef}
          className="spectra-item-picker-filter"
          value={query}
          placeholder={`Find a ${itemNoun}`}
          aria-label={`Find a ${itemNoun}`}
          aria-controls={listId}
          aria-activedescendant={
            shown[activeCursor] ? `${listId}-${shown[activeCursor].position}` : undefined
          }
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
        />
      ) : null}
      <div
        id={listId}
        role="listbox"
        aria-label={ariaLabel}
        className="spectra-item-picker-list"
        style={{ maxHeight: placement.maxHeight }}
      >
        {shown.map((item, cursorIndex) => (
          <div
            key={item.value}
            id={`${listId}-${item.position}`}
            role="option"
            aria-selected={item.value === value}
            aria-disabled={item.disabled || undefined}
            data-cursor={cursorIndex === activeCursor || undefined}
            data-cursor-index={cursorIndex}
            className="spectra-item-picker-option"
            onPointerMove={() => setCursor(cursorIndex)}
            onClick={() => {
              if (!item.disabled) onPick(item.value);
            }}
          >
            <span className="spectra-item-picker-number">{item.position + 1}</span>
            <span className="spectra-item-picker-label">{item.label}</span>
          </div>
        ))}
        {shown.length === 0 ? (
          <p className="spectra-item-picker-none">No {itemNoun} matches “{query}”.</p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
