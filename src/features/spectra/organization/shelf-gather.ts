"use client";

import { useRef } from "react";

/*
 * Laying one card on another (LIBRARY.md, "Stacks"). The card itself follows
 * the hand, the card under it lifts to say it will take it, and letting go
 * there gathers the two. A work dragged out of a stack and let go on the open
 * shelf leaves the stack. Pointer events, like the rest of the organiser's
 * dragging (organizer-drag.ts), so every frame is ordinary DOM.
 */

const START_THRESHOLD = 6;

export type GatherDrop = {
  nodeId: string;
  /** The card it was let go on; null for the open shelf. */
  ontoNodeId: string | null;
  /** It was dragged out of a stack. */
  fromStack: boolean;
};

export function useShelfGather(onDrop: (drop: GatherDrop) => void, enabled: boolean) {
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  return function beginGather(event: React.PointerEvent<HTMLElement>, nodeId: string, fromStack: boolean) {
    if (!enabled || event.button !== 0 || event.pointerType === "touch") return;
    if ((event.target as HTMLElement).closest("[data-stack-menu]")) return;
    const item = event.currentTarget.closest<HTMLElement>("[data-shelf-item]") ?? event.currentTarget;
    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let over: HTMLElement | null = null;

    const move = (moved: PointerEvent) => {
      const dx = moved.clientX - start.x;
      const dy = moved.clientY - start.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < START_THRESHOLD) return;
        dragging = true;
        item.dataset.gathering = "true";
        document.documentElement.dataset.shelfGathering = "true";
      }
      item.style.translate = `${dx}px ${dy}px`;
      const under = document
        .elementsFromPoint(moved.clientX, moved.clientY)
        .map((element) => element.closest<HTMLElement>("[data-shelf-item]"))
        .find((element) => element && element !== item) ?? null;
      if (under !== over) {
        over?.removeAttribute("data-gather-over");
        under?.setAttribute("data-gather-over", "true");
        over = under;
      }
    };

    const finish = (cancelled: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape, true);
      over?.removeAttribute("data-gather-over");
      item.style.translate = "";
      delete item.dataset.gathering;
      delete document.documentElement.dataset.shelfGathering;
      if (!dragging) return;
      // The press that ended the drag is not also a click on the card.
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      if (cancelled) return;
      const ontoNodeId = over?.dataset.shelfItem ?? null;
      if (ontoNodeId || fromStack) onDropRef.current({ nodeId, ontoNodeId, fromStack });
    };
    const up = () => finish(false);
    const cancel = () => finish(true);
    const escape = (key: KeyboardEvent) => {
      if (key.key !== "Escape" || !dragging) return;
      key.preventDefault();
      key.stopPropagation();
      finish(true);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape, true);
  };
}
