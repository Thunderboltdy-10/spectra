"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TreeNode } from "./tree-client";
import { canDrop } from "./tree-model";

/**
 * Dragging, on pointer events rather than HTML5 drag-and-drop.
 *
 * Two reasons, in order. A pointer drag can show a real insertion line and a
 * real drop ring on the row under the cursor, because the surface still knows
 * where the pointer is; native DnD hands that to the browser and takes the
 * drag image with it. And a pointer drag is inspectable — every frame of it is
 * ordinary DOM, so a mid-drag state can be looked at and screenshotted.
 *
 * Drop targets announce themselves in the DOM with `data-drop-node` and
 * `data-drop-kind`, so a new place that can accept a drop (a rail branch, a
 * breadcrumb, the empty surface) needs no registration here.
 */

export type DropTarget =
  | {
      type: "into";
      parentId: string | null;
      /** The row or rail branch to ring. Null means the surface itself. */
      highlightNodeId: string | null;
    }
  | {
      type: "between";
      parentId: string | null;
      afterSiblingId?: string;
      beforeSiblingId?: string;
      /** The row the insertion line is drawn against. */
      indicatorNodeId: string;
      edge: "top" | "bottom";
    };

export type DragState = {
  nodeIds: string[];
  label: string;
  x: number;
  y: number;
  /** Alt/Option leaves the original in place and files a reference instead. */
  mode: "move" | "reference";
  target: DropTarget | null;
  reason: string | null;
};

export type DragContext = {
  /** Every node the surface currently knows, by id. */
  nodesById: Map<string, TreeNode>;
  /** Rows in the order they are displayed, for insertion-point maths. */
  rows: readonly TreeNode[];
  /** The folder the row surface is showing; null at the root. */
  currentParentId: string | null;
  /** Reordering is only meaningful while the reader's own order is shown. */
  allowReorder: boolean;
  onMove: (
    nodeIds: string[],
    parentId: string | null,
    neighbours?: { beforeSiblingId?: string; afterSiblingId?: string },
  ) => void;
  onReference: (nodeIds: string[], parentId: string | null) => void;
  onRejected: (reason: string) => void;
};

const START_THRESHOLD = 5;
const EDGE_BAND = 7;
const AUTOSCROLL_BAND = 52;
const AUTOSCROLL_MAX = 18;

export function useOrganizerDrag(context: DragContext) {
  const [drag, setDrag] = useState<DragState | null>(null);
  /* Listeners are bound once for the life of a drag, so they read live data
     through a ref instead of closing over a render's copy. */
  const contextRef = useRef(context);
  contextRef.current = context;
  const pendingRef = useRef<{
    nodeIds: string[];
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const suppressClickRef = useRef(false);
  const scrollRef = useRef<{ frame: number; speed: number } | null>(null);

  const ancestorIdsOf = useCallback((nodeId: string) => {
    const { nodesById } = contextRef.current;
    const chain: string[] = [];
    let current = nodesById.get(nodeId)?.parentId ?? null;
    for (let depth = 0; depth < 64 && current; depth += 1) {
      chain.push(current);
      current = nodesById.get(current)?.parentId ?? null;
    }
    return chain;
  }, []);

  const resolveTarget = useCallback(
    (x: number, y: number): { target: DropTarget | null; reason: string | null } => {
      const { nodesById, rows, currentParentId, allowReorder } =
        contextRef.current;
      const dragged = (dragRef.current?.nodeIds ?? pendingRef.current?.nodeIds ?? [])
        .map((id) => nodesById.get(id))
        .filter((node): node is TreeNode => Boolean(node));
      const element = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-drop-node]");
      if (!element) return { target: null, reason: null };

      const raw = element.dataset.dropNode ?? "";
      const kind = element.dataset.dropKind ?? "container";
      const nodeId = raw === "root" ? null : raw;
      const node = nodeId ? (nodesById.get(nodeId) ?? null) : null;

      /* An insertion line only makes sense inside the list the reader is
         looking at, and only while it is showing their own arrangement. */
      if (allowReorder && node && (kind === "container" || kind === "item")) {
        const rect = element.getBoundingClientRect();
        const nearTop = y - rect.top <= EDGE_BAND;
        const nearBottom = rect.bottom - y <= EDGE_BAND;
        if (nearTop || nearBottom) {
          const index = rows.findIndex((row) => row.nodeId === node.nodeId);
          if (index !== -1) {
            const edge = nearTop ? "top" : "bottom";
            const neighbour =
              edge === "top" ? rows[index - 1] : rows[index + 1];
            const verdict = canDrop(dragged, null, ancestorIdsOf);
            /* `canDrop` refuses a same-parent move as "Already here", which is
               wrong for a reorder: the parent is the same on purpose. */
            const blocked =
              !verdict.allowed && verdict.reason !== "Already here."
                ? verdict.reason
                : null;
            if (blocked) return { target: null, reason: blocked };
            return {
              target: {
                type: "between",
                parentId: currentParentId,
                afterSiblingId:
                  edge === "top" ? neighbour?.nodeId : node.nodeId,
                beforeSiblingId:
                  edge === "top" ? node.nodeId : neighbour?.nodeId,
                indicatorNodeId: node.nodeId,
                edge,
              },
              reason: null,
            };
          }
        }
      }

      if (kind === "item") return { target: null, reason: null };

      const verdict = canDrop(dragged, node, ancestorIdsOf);
      if (!verdict.allowed) return { target: null, reason: verdict.reason };
      return {
        target: {
          type: "into",
          parentId: nodeId,
          highlightNodeId: kind === "surface" ? null : nodeId,
        },
        reason: null,
      };
    },
    [ancestorIdsOf],
  );

  const stopAutoscroll = useCallback(() => {
    if (scrollRef.current) cancelAnimationFrame(scrollRef.current.frame);
    scrollRef.current = null;
  }, []);

  const updateAutoscroll = useCallback(
    (y: number) => {
      const container = document.querySelector<HTMLElement>(
        "[data-organizer-scroll]",
      );
      if (!container) return stopAutoscroll();
      const rect = container.getBoundingClientRect();
      const above = y - rect.top;
      const below = rect.bottom - y;
      let speed = 0;
      if (above < AUTOSCROLL_BAND)
        speed = -Math.ceil(((AUTOSCROLL_BAND - above) / AUTOSCROLL_BAND) * AUTOSCROLL_MAX);
      else if (below < AUTOSCROLL_BAND)
        speed = Math.ceil(((AUTOSCROLL_BAND - below) / AUTOSCROLL_BAND) * AUTOSCROLL_MAX);
      if (speed === 0) return stopAutoscroll();
      if (scrollRef.current) {
        scrollRef.current.speed = speed;
        return;
      }
      const step = () => {
        const state = scrollRef.current;
        if (!state) return;
        container.scrollTop += state.speed;
        state.frame = requestAnimationFrame(step);
      };
      scrollRef.current = { frame: requestAnimationFrame(step), speed };
    },
    [stopAutoscroll],
  );

  /** Call from a row's `onPointerDown`. Nothing starts until the pointer moves. */
  const beginDrag = useCallback(
    (event: React.PointerEvent, nodeIds: string[], label: string) => {
      if (event.button !== 0 || nodeIds.length === 0) return;
      pendingRef.current = {
        nodeIds,
        label,
        x: event.clientX,
        y: event.clientY,
      };
    },
    [],
  );

  const cancelPending = useCallback(() => {
    pendingRef.current = null;
  }, []);

  const consumeSuppressedClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  useEffect(() => {
    if (!drag) return;
    const root = document.documentElement;
    const previousCursor = root.style.cursor;
    const previousUserSelect = root.style.userSelect;
    root.style.cursor = "grabbing";
    root.style.userSelect = "none";
    return () => {
      root.style.cursor = previousCursor;
      root.style.userSelect = previousUserSelect;
    };
  }, [drag]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const pending = pendingRef.current;
      if (!dragRef.current && pending) {
        const travelled =
          Math.abs(event.clientX - pending.x) + Math.abs(event.clientY - pending.y);
        if (travelled < START_THRESHOLD) return;
        const next: DragState = {
          nodeIds: pending.nodeIds,
          label: pending.label,
          x: event.clientX,
          y: event.clientY,
          mode: event.altKey ? "reference" : "move",
          target: null,
          reason: null,
        };
        dragRef.current = next;
        setDrag(next);
      }
      if (!dragRef.current) return;
      event.preventDefault();
      const { target, reason } = resolveTarget(event.clientX, event.clientY);
      updateAutoscroll(event.clientY);
      setDrag((current) =>
        current
          ? {
              ...current,
              x: event.clientX,
              y: event.clientY,
              mode: event.altKey ? "reference" : "move",
              target,
              reason,
            }
          : current,
      );
    }

    function finish() {
      stopAutoscroll();
      const state = dragRef.current;
      pendingRef.current = null;
      dragRef.current = null;
      setDrag(null);
      if (!state) return;
      suppressClickRef.current = true;
      const { onMove, onReference, onRejected } = contextRef.current;
      if (!state.target) {
        if (state.reason && state.reason !== "Already here.")
          onRejected(state.reason);
        return;
      }
      if (state.mode === "reference") {
        onReference(state.nodeIds, state.target.parentId);
        return;
      }
      if (state.target.type === "between")
        onMove(state.nodeIds, state.target.parentId, {
          beforeSiblingId: state.target.beforeSiblingId,
          afterSiblingId: state.target.afterSiblingId,
        });
      else onMove(state.nodeIds, state.target.parentId);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && dragRef.current) {
        stopAutoscroll();
        pendingRef.current = null;
        dragRef.current = null;
        setDrag(null);
      }
      /* Holding Alt mid-drag switches the gesture, so the proxy has to relabel
         itself without waiting for the pointer to move again. */
      if (event.key === "Alt" && dragRef.current)
        setDrag((current) => (current ? { ...current, mode: "reference" } : current));
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key === "Alt" && dragRef.current)
        setDrag((current) => (current ? { ...current, mode: "move" } : current));
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      stopAutoscroll();
    };
  }, [resolveTarget, stopAutoscroll, updateAutoscroll]);

  return { drag, beginDrag, cancelPending, consumeSuppressedClick };
}
