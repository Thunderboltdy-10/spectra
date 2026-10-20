"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { life } from "../life/life";
import { unformElement } from "../life/use-life";
import { previewTabs, type IslandSide, type IslandTab } from "./island-model";

/*
 * Arranging the island's tabs by hand (ISLAND.md, "Arranging tabs"). The tab
 * lifts into a ghost that follows the pointer; its slot stays behind, empty,
 * and moves through the row as the pointer crosses neighbours, so the others
 * part to make room (FLIP). Crossing the divider ripples it and changes the side.
 * Flicking a done tab to the right throws it into history.
 */

const START_DISTANCE = 4;
const FLICK_SPEED = 0.7; // px per ms
const FLICK_DISTANCE = 28;
const SETTLE_MS = 200;
const FLICK_MS = 340;

export type TabGhost = { runId: string; left: number; top: number; width: number; height: number };

type Drag = {
  tab: IslandTab;
  pointerId: number;
  startX: number;
  startY: number;
  grab: number;
  rect: DOMRect;
  started: boolean;
  side: IslandSide;
  index: number;
  samples: Array<{ x: number; t: number }>;
};

export function useTabDrag({
  play,
  done,
  tabRefs,
  dividerRef,
  onStart,
  onPlace,
  onDismiss,
}: {
  play: readonly IslandTab[];
  done: readonly IslandTab[];
  tabRefs: RefObject<Map<string, HTMLButtonElement>>;
  dividerRef: RefObject<HTMLElement | null>;
  onStart: () => void;
  onPlace: (tab: IslandTab, side: IslandSide, index: number) => void;
  onDismiss: (tab: IslandTab) => void;
}) {
  const [slot, setSlot] = useState<{ runId: string; side: IslandSide; index: number } | null>(null);
  const [ghost, setGhost] = useState<TabGhost | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef({ play, done, onStart, onPlace, onDismiss });
  latest.current = { play, done, onStart, onPlace, onDismiss };

  const preview = useMemo(() => (slot ? previewTabs(play, done, slot.runId, slot.side, slot.index) : { play: [...play], done: [...done] }), [done, play, slot]);
  const previewRef = useRef(preview);
  previewRef.current = preview;

  const moveGhost = useCallback((dx: number, lift: number, scale: number) => {
    const element = ghostRef.current;
    if (element) element.style.transform = `translate3d(${dx}px, ${-lift}px, 0) scale(${scale})`;
  }, []);

  const finish = useCallback(() => {
    drag.current = null;
    setSlot(null);
    setGhost(null);
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const dx = event.clientX - current.startX;
      if (!current.started) {
        if (Math.hypot(dx, event.clientY - current.startY) < START_DISTANCE) return;
        current.started = true;
        latest.current.onStart();
        const r = current.rect;
        setGhost({ runId: current.tab.runId, left: r.left, top: r.top, width: r.width, height: r.height });
        const sideTabs = current.tab.side === "play" ? latest.current.play : latest.current.done;
        setSlot({ runId: current.tab.runId, side: current.tab.side, index: sideTabs.findIndex((tab) => tab.runId === current.tab.runId) });
      }
      const now = performance.now();
      current.samples.push({ x: event.clientX, t: now });
      while (current.samples.length > 2 && now - current.samples[0].t > 90) current.samples.shift();
      moveGhost(dx, 3, 1.04);

      // The field feels it move.
      const first = current.samples[0];
      const speed = now > first.t ? ((event.clientX - first.x) / (now - first.t)) * 1000 : 0;
      if (life.on && Math.abs(speed) > 40) life.wake(event.clientX, current.rect.top + current.rect.height / 2, speed, 0);

      // Which side, and where in it.
      const divider = dividerRef.current?.getBoundingClientRect();
      const side: IslandSide = divider && event.clientX > divider.left + divider.width / 2 ? "done" : "play";
      const others = previewRef.current[side].filter((tab) => tab.runId !== current.tab.runId);
      let index = 0;
      for (const tab of others) {
        const element = tabRefs.current?.get(tab.runId);
        if (!element) continue;
        const r = element.getBoundingClientRect();
        if (event.clientX > r.left + r.width / 2) index += 1;
      }
      if (side !== current.side && divider && life.on) life.pulse(divider.left + divider.width / 2, divider.top + divider.height / 2, 0.8, "spectrum");
      if (side !== current.side || index !== current.index) {
        current.side = side;
        current.index = index;
        setSlot({ runId: current.tab.runId, side, index });
      }
    };

    const onUp = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (!current.started) {
        drag.current = null;
        return;
      }
      // The click that follows this release is not an open; a later one is.
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      const now = performance.now();
      const first = current.samples[0];
      const velocity = first && now > first.t ? (event.clientX - first.x) / (now - first.t) : 0;
      const dx = event.clientX - current.startX;
      const ghostElement = ghostRef.current;

      if (event.type === "pointerup" && current.tab.side === "done" && current.side === "done" && velocity > FLICK_SPEED && dx > FLICK_DISTANCE) {
        // Thrown into history: it keeps its speed, thins out and parts into the field.
        const carry = Math.min(260, velocity * 220);
        if (ghostElement) {
          ghostElement.style.transition = `transform ${FLICK_MS}ms cubic-bezier(0.15, 0.7, 0.3, 1), opacity ${FLICK_MS}ms ease-out`;
          moveGhost(dx + carry, 3, 0.96);
          ghostElement.style.opacity = "0";
          if (life.on) {
            const r = ghostElement.getBoundingClientRect();
            life.wake(r.right, r.top + r.height / 2, velocity * 1000, 0);
            void unformElement(ghostElement, { bars: "[data-tab-title]" });
          }
        }
        latest.current.onDismiss(current.tab);
        drag.current = null;
        window.setTimeout(finish, FLICK_MS);
        return;
      }

      // Settles into its slot.
      const { side, index } = current;
      latest.current.onPlace(current.tab, side, index);
      const target = tabRefs.current?.get(current.tab.runId)?.getBoundingClientRect();
      if (ghostElement && target) {
        ghostElement.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
        moveGhost(target.left - current.rect.left, 0, 1);
        if (life.on) life.pulse(target.left + target.width / 2, target.top + target.height / 2, 0.35);
      }
      drag.current = null;
      window.setTimeout(finish, target ? SETTLE_MS : 0);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [finish, moveGhost, dividerRef, tabRefs]);

  const onPointerDown = useCallback((tab: IslandTab, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || drag.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = {
      tab,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grab: event.clientX - rect.left,
      rect,
      started: false,
      side: tab.side,
      index: 0,
      samples: [{ x: event.clientX, t: performance.now() }],
    };
  }, []);

  /** A drag ends in a click on the tab; that click is not an open. */
  const consumeClick = useCallback(() => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  return { preview, dragging: slot?.runId ?? null, ghost, ghostRef, onPointerDown, consumeClick };
}

/**
 * The tabs slide to their new places instead of jumping (FLIP): each is drawn
 * where it was, then eased to where it is now. "Where it was" is read as drawn
 * just before the change, so a slide interrupted by another starts from where
 * the tab really is.
 */
export function useFlip<T extends HTMLElement>(elements: RefObject<Map<string, T>>, signature: string, reduced: boolean) {
  const seenSignature = useRef(signature);
  const before = useRef<Map<string, number> | null>(null);
  // Read during render, before React touches the DOM: the old positions, as drawn.
  if (seenSignature.current !== signature) {
    seenSignature.current = signature;
    if (!reduced && typeof window !== "undefined" && elements.current) {
      before.current = new Map([...elements.current].map(([id, element]) => [id, element.getBoundingClientRect().left]));
    }
  }
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    const map = elements.current;
    if (!was || !map) return;
    for (const [id, element] of map) {
      const from = was.get(id);
      if (from === undefined) continue;
      element.style.transition = "none";
      element.style.transform = "";
      const to = element.getBoundingClientRect().left;
      if (Math.abs(from - to) < 0.5) continue;
      element.style.transform = `translateX(${from - to}px)`;
      // Read once so the inverted position is committed before easing back.
      void element.offsetWidth;
      element.style.transition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      element.style.transform = "";
    }
  }, [elements, signature]);
}
