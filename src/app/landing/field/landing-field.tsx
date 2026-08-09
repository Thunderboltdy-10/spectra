"use client";

/**
 * Level 3: the landing as an environment.
 *
 * The whole page sits inside one field. It is the same primitive the product
 * uses on a card or a panel, at its largest scale, with three things allowed to
 * disturb it: the visitor's cursor, the one true prism, and the scene itself.
 *
 * Nothing here goes through React. The field's DOM is written once and then
 * driven by the story clock, because a full-viewport layer that re-rendered
 * sixty times a second is exactly the kind of thing that makes a page feel
 * expensive. Per frame we touch only opacity and transform. The lattice's own
 * geometry — cell size, where the grain gathers — changes at scene boundaries,
 * where a 3% layer changing its spacing is genuinely below the threshold.
 */

import { useEffect, useRef } from "react";
import { onStoryFrame } from "../story/story-clock";
import type { SceneId } from "../story/timeline";
import { heroState } from "../scene/heroState";

/**
 * The emotional arc, one entry per scene.
 *
 * `rest` is how present the field is. `cell` is how open the grain is. `bias`
 * is where the material gathers, which is the field's way of pointing without
 * drawing an arrow.
 */
type Mood = {
  rest: number;
  cell: number;
  bias: [x: number, y: number, spread: number];
};

const MOOD: Record<SceneId, Mood> = {
  /* Barely awake: a held breath, gathered at the centre. */
  wake: { rest: 0.022, cell: 30, bias: [50, 50, 120] },
  /* The signature resting state: denser toward the lower right. */
  hero: { rest: 0.05, cell: 34, bias: [78, 76, 150] },
  /* Drawing toward the work about to happen. */
  prepare: { rest: 0.062, cell: 32, bias: [62, 64, 158] },
  /* Charged. The densest the field ever gets. */
  transform: { rest: 0.085, cell: 28, bias: [52, 56, 178] },
  /* Alive and spread out; the work is running on its own. */
  living: { rest: 0.07, cell: 32, bias: [50, 50, 190] },
  /* Tightened. Two actors want the same thing. */
  contention: { rest: 0.055, cell: 30, bias: [44, 52, 165] },
  /* Back toward the dock's corner. */
  dock: { rest: 0.06, cell: 33, bias: [72, 78, 155] },
  /* Focused on one surface. */
  workbench: { rest: 0.066, cell: 30, bias: [50, 58, 172] },
  /* Leaning left, searching. */
  references: { rest: 0.058, cell: 34, bias: [34, 50, 176] },
  /* Ordered and fine, like the grid it sits under. */
  calendar: { rest: 0.05, cell: 26, bias: [50, 50, 168] },
  /* Generative, lifting. */
  foundry: { rest: 0.078, cell: 30, bias: [50, 46, 186] },
  /* Opening out as the camera starts to leave. */
  scale: { rest: 0.062, cell: 38, bias: [50, 50, 200] },
  /* Resolved. Wide, calm, and quieter than anything before it. */
  reveal: { rest: 0.04, cell: 44, bias: [50, 50, 210] },
};

/** Per-frame damping toward a target, frame-rate independent. */
function damp(current: number, target: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-rate));
}

/** Authored wake box sizes. Movement and growth both happen in `transform`. */
const PRISM_WAKE_R = 380;
const CURSOR_WAKE_R = 300;

export function LandingField() {
  const rootRef = useRef<HTMLSpanElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const prismRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const cursorNode = cursorRef.current;
    const prismNode = prismRef.current;
    if (!root || !cursorNode || !prismNode) return;

    /* The cursor influence is a fine-pointer detail. On touch it never exists:
       there is no hover, and a wake pinned under a finger reads as a bug. */
    const fine = window.matchMedia?.("(pointer: fine)").matches ?? false;

    /* Shared temporal phase, so this field drifts with every other field in the
       document rather than starting its own cycle. */
    root.style.setProperty(
      "--field-phase",
      `${-Math.round(performance.now() % 58_000)}ms`,
    );

    const cursor = { x: 0, y: 0, tx: 0, ty: 0, strength: 0, live: false };
    const prism = { tx: 0, ty: 0, r: 1, strength: 0 };
    let rest = MOOD.wake.rest;
    let scene: SceneId | null = null;

    const onMove = (event: PointerEvent) => {
      cursor.x = event.clientX;
      cursor.y = event.clientY;
      cursor.live = true;
    };
    const onOut = (event: PointerEvent) => {
      if (!event.relatedTarget) cursor.live = false;
    };

    if (fine) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerout", onOut, { passive: true });
    }

    const stop = onStoryFrame((frame) => {
      const mood = MOOD[frame.scene];

      /* Geometry changes at the boundary, not per frame: cell size and the mask
         bias both force a repaint of a viewport-sized layer. */
      if (scene !== frame.scene) {
        scene = frame.scene;
        root.style.setProperty("--field-cell", `${mood.cell}px`);
        root.style.setProperty("--field-bias-x", `${mood.bias[0]}%`);
        root.style.setProperty("--field-bias-y", `${mood.bias[1]}%`);
        root.style.setProperty("--field-bias-spread", `${mood.bias[2]}%`);
      }

      /* Presence is damped every frame, so a scene handoff is a swell rather
         than a step, and scrubbing backwards reads identically. */
      rest = damp(rest, mood.rest, 0.06);
      root.style.setProperty("--field-rest", rest.toFixed(4));

      /* The prism disturbs the field it sits in. Its slot is already in
         viewport pixels, which is the space this layer lives in. */
      const slot = heroState.slot;
      const prismTarget = slot.w > 12 ? (heroState.owned ? 0.92 : 0.6) : 0;
      if (slot.w > 12) {
        prism.tx = damp(prism.tx, slot.x, 0.22);
        prism.ty = damp(prism.ty, slot.y, 0.22);
        /* Size travels as scale, never as width: the wake is a composited
           layer and changing its box would repaint it every frame. */
        prism.r = damp(prism.r, Math.max(220, slot.w * 2.1) / PRISM_WAKE_R, 0.12);
      }
      prism.strength = damp(prism.strength, prismTarget, 0.08);
      prismNode.style.setProperty("--wake-scale", prism.r.toFixed(3));
      prismNode.style.setProperty(
        "--wake-tx",
        `${Math.round(prism.tx * 10) / 10}px`,
      );
      prismNode.style.setProperty(
        "--wake-ty",
        `${Math.round(prism.ty * 10) / 10}px`,
      );
      prismNode.style.setProperty("--wake-strength", prism.strength.toFixed(3));

      if (!fine) return;

      /* The cursor influence trails the pointer rather than tracking it. The
         field is a material with weight; it should never feel welded on. */
      cursor.tx = damp(cursor.tx, cursor.x, 0.16);
      cursor.ty = damp(cursor.ty, cursor.y, 0.16);
      cursor.strength = damp(cursor.strength, cursor.live ? 0.5 : 0, 0.07);
      cursorNode.style.setProperty(
        "--wake-tx",
        `${Math.round(cursor.tx * 10) / 10}px`,
      );
      cursorNode.style.setProperty(
        "--wake-ty",
        `${Math.round(cursor.ty * 10) / 10}px`,
      );
      cursorNode.style.setProperty(
        "--wake-strength",
        cursor.strength.toFixed(3),
      );
    });

    return () => {
      stop();
      if (fine) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerout", onOut);
      }
    };
  }, []);

  return (
    <span
      ref={rootRef}
      className="spectra-field landing-field"
      data-scale="stage"
      data-grain="wave"
      data-depth="true"
      aria-hidden="true"
    >
      <span className="spectra-field-rest" />
      <span
        ref={prismRef}
        className="spectra-field-wake"
        data-drive="frame"
        data-state="active"
        style={
          {
            "--wake-hue": "var(--brand-primary)",
            "--wake-strength": 0,
            "--wake-r": `${PRISM_WAKE_R}px`,
          } as React.CSSProperties
        }
      />
      <span
        ref={cursorRef}
        className="spectra-field-wake"
        data-drive="frame"
        data-state="active"
        style={
          {
            "--wake-hue": "var(--text-primary)",
            "--wake-strength": 0,
            "--wake-r": `${CURSOR_WAKE_R}px`,
          } as React.CSSProperties
        }
      />
    </span>
  );
}
