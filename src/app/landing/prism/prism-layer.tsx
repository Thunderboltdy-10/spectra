"use client";

import { useEffect, useMemo, useRef } from "react";
import { PrismStage } from "./prism-stage";
import { PRISM_SCENES, type PrismSceneState } from "./prism-scene";
import { prismOptics } from "./prism-slot";
import { heroState } from "../scene/heroState";

/**
 * The page-level home of the one true prism.
 *
 * A single fixed layer spans the viewport for the whole document, so the
 * object is mounted once and never re-created. Sections do not own it; they
 * *claim* it (see `prism-slot`), and it travels between their compositions.
 *
 * The layer is inert to the pointer by default — a full-screen canvas that
 * swallowed clicks would break every real control underneath it. Interactivity
 * is granted only while the pointer is genuinely over the glass, which is also
 * the only time it means anything.
 */
export function PrismLayer({
  active = true,
  interactive = true,
}: {
  /** Render gate. When false the GPU rests. */
  active?: boolean;
  /** Allow the visitor to grab and spin the glass. */
  interactive?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

  /* The stage reads optical progress through a ref, so the director can drive
     the glass every frame without ever re-rendering React. */
  const scratch = useRef<PrismSceneState>({ ...PRISM_SCENES.hero });
  const sceneRef = useMemo(
    () => ({
      get current(): PrismSceneState {
        scratch.current.progress = prismOptics.progress;
        return scratch.current;
      },
      set current(_next: PrismSceneState) {
        /* read-only channel */
      },
    }),
    [],
  );

  /* Depth is a story decision, not a stylesheet one: the slot says whether the
     object is behind the work or in the visitor's hand. */
  useEffect(() => {
    let raf = 0;
    let front: boolean | null = null;
    const tick = () => {
      const node = hostRef.current;
      if (node && heroState.front !== front) {
        front = heroState.front;
        /* Behind the work it sits between the ground and the canvas, seen
           through the gaps between objects. In hand it is above everything. */
        node.style.zIndex = front ? "70" : "1";
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  /* Grant hit-testing only over the glass. On coarse pointers the object stays
     inert — a drag-to-rotate would only ever fight the scroll. */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fine = window.matchMedia?.("(pointer: fine)").matches ?? true;
    if (!fine) return;

    let canvas: HTMLCanvasElement | null = null;
    let granted = false;

    const onMove = (event: PointerEvent) => {
      canvas ??= host.querySelector("canvas");
      if (!canvas) return;
      const slot = heroState.slot;
      const live =
        interactiveRef.current && slot.w > 24 && !heroState.owned;
      const reach = slot.w * 0.66;
      const inside =
        live &&
        Math.abs(event.clientX - slot.x) < reach &&
        Math.abs(event.clientY - slot.y) < reach;
      if (inside === granted) return;
      granted = inside;
      canvas.style.pointerEvents = inside ? "auto" : "none";
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <div
      ref={hostRef}
      data-prism-layer
      className="pointer-events-none fixed inset-0 z-0"
      style={{ contain: "strict" }}
    >
      <PrismStage
        scene={PRISM_SCENES.hero}
        sceneRef={sceneRef}
        staged
        active={active}
        className="absolute inset-0"
      />
    </div>
  );
}
