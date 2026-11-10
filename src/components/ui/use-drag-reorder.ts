"use client";

import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/*
 * Picking something up and putting it elsewhere in its list, in a column or a
 * grid. The item follows the pointer, its neighbours slide out of its way, and
 * a press that never travelled is still a press. Alt with the arrows does the
 * same from the keyboard.
 */

const TRAVEL = 6;
const SETTLE_MS = 200;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

type Drag = { id: string; element: HTMLElement; grabX: number; grabY: number; x: number; y: number };

export function reordered<T extends string>(order: readonly T[], id: T, toIndex: number): T[] {
  const without = order.filter((item) => item !== id);
  without.splice(Math.max(0, Math.min(toIndex, without.length)), 0, id);
  return without;
}

/** What is stored, applied to what exists: known items in that order, anything new where it already was, after them. */
export function applyOrder<T>(items: readonly T[], keyOf: (item: T) => string, order: readonly string[]): T[] {
  if (!order.length) return [...items];
  const rank = new Map(order.map((key, index) => [key, index]));
  return items
    .map((item, index) => ({ item, index, rank: rank.get(keyOf(item)) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
    .map(({ item }) => item);
}

export function useDragReorder({
  ids,
  onReorder,
  disabled = false,
  attribute = "data-reorder-item",
}: {
  ids: readonly string[];
  onReorder: (next: string[]) => void;
  disabled?: boolean;
  attribute?: string;
}) {
  const [preview, setPreview] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const container = useRef<HTMLElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const before = useRef<Map<string, DOMRect> | null>(null);
  const order = preview ?? ids;
  const orderRef = useRef(order);
  orderRef.current = order;

  const itemsNow = useCallback(() => {
    const found = new Map<string, HTMLElement>();
    container.current?.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach((element) => {
      const id = element.getAttribute(attribute);
      if (id) found.set(id, element);
    });
    return found;
  }, [attribute]);

  const place = () => {
    const current = drag.current;
    if (!current) return;
    current.element.style.transform = "";
    const slot = current.element.getBoundingClientRect();
    current.element.style.transform = `translate(${current.x - current.grabX - slot.left}px, ${current.y - current.grabY - slot.top}px) scale(1.02)`;
  };

  // The neighbours slide from where they were to where the new order puts them.
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    if (!was) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    itemsNow().forEach((element, id) => {
      if (id === drag.current?.id || reduce) return;
      const from = was.get(id);
      if (!from) return;
      const to = element.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (!dx && !dy) return;
      const animation = element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: SETTLE_MS, easing: EASE });
      animation.id = "spectra-reorder";
    });
    place();
  });

  const changeTo = useCallback((next: string[]) => {
    const rects = new Map<string, DOMRect>();
    itemsNow().forEach((element, id) => rects.set(id, element.getBoundingClientRect()));
    before.current = rects;
    setPreview(next);
  }, [itemsNow]);

  const begin = useCallback(
    (event: PointerEvent<HTMLElement>, id: string) => {
      if (disabled || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const element = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      const startOrder = [...orderRef.current];
      let travelling = false;

      const move = (moved: globalThis.PointerEvent) => {
        if (moved.pointerId !== pointerId) return;
        if (!travelling) {
          if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < TRAVEL) return;
          travelling = true;
          const box = element.getBoundingClientRect();
          drag.current = { id, element, grabX: startX - box.left, grabY: startY - box.top, x: moved.clientX, y: moved.clientY };
          element.style.zIndex = "30";
          element.style.position = element.style.position || "relative";
          element.style.pointerEvents = "none";
          element.style.boxShadow = "var(--shadow-lg)";
          document.documentElement.style.cursor = "grabbing";
          document.body.style.userSelect = "none";
          setDraggingId(id);
          setPreview(startOrder);
        }
        const current = drag.current;
        if (!current) return;
        current.x = moved.clientX;
        current.y = moved.clientY;
        place();
        for (const [otherId, other] of itemsNow()) {
          if (otherId === id) continue;
          // Still sliding: its box is not where it is going, and the pointer would pull it straight back.
          if (other.getAnimations?.().some((animation) => animation.id === "spectra-reorder" && animation.playState === "running")) continue;
          const rect = other.getBoundingClientRect();
          if (moved.clientX < rect.left || moved.clientX > rect.right || moved.clientY < rect.top || moved.clientY > rect.bottom) continue;
          const to = orderRef.current.indexOf(otherId);
          if (to >= 0) changeTo(reordered(orderRef.current, id, to));
          break;
        }
      };

      const finish = (commit: boolean) => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", cancel, true);
        window.removeEventListener("keydown", key, true);
        if (!travelling) return;
        const finalOrder = commit ? [...orderRef.current] : startOrder;
        const moved = finalOrder.some((item, index) => item !== startOrder[index]);
        const current = drag.current;
        drag.current = null;
        document.documentElement.style.cursor = "";
        document.body.style.userSelect = "";
        // A drag ends in a click on what it started from; that click is not a press.
        const swallow = (click: MouseEvent) => {
          click.preventDefault();
          click.stopPropagation();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", swallow, true), 80);
        if (current) {
          const start = current.element.style.transform;
          current.element.style.transform = "";
          current.element.style.zIndex = "";
          current.element.style.pointerEvents = "";
          current.element.style.boxShadow = "";
          if (start && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
            current.element.animate([{ transform: start }, { transform: "none" }], { duration: SETTLE_MS, easing: EASE });
        }
        setDraggingId(null);
        if (moved) onReorder(finalOrder);
        setPreview(null);
      };
      const up = (released: globalThis.PointerEvent) => released.pointerId === pointerId && finish(true);
      const cancel = (released: globalThis.PointerEvent) => released.pointerId === pointerId && finish(false);
      const key = (pressed: globalThis.KeyboardEvent) => {
        if (pressed.key === "Escape") finish(false);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", cancel, true);
      window.addEventListener("keydown", key, true);
    },
    [changeTo, disabled, itemsNow, onReorder],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, id: string) => {
      if (disabled || !event.altKey) return;
      const step = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : 0;
      if (!step) return;
      const at = ids.indexOf(id);
      const to = at + step;
      if (at < 0 || to < 0 || to >= ids.length) return;
      event.preventDefault();
      onReorder(reordered(ids, id, to));
    },
    [disabled, ids, onReorder],
  );

  return {
    /** The order to draw, which is the pending one during a drag. */
    order,
    draggingId,
    containerRef: container,
    /** Spread on each item. */
    itemProps: (id: string) => ({
      [attribute]: id,
      draggable: false,
      onPointerDown: (event: PointerEvent<HTMLElement>) => begin(event, id),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(event, id),
    }),
  };
}
