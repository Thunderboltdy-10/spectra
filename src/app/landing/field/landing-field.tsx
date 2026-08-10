"use client";

/**
 * Level 3: the landing as an environment.
 *
 * The whole page sits inside one field. It is the same primitive the product
 * uses on a card or a panel, at the one scale where CSS cannot draw it: the
 * grain here is a few pixels across, tens of thousands of dots, each displaced
 * by what is happening near it. So this hands the field to the GPU and drives
 * it from the story clock.
 *
 * Nothing here goes through React after mount. Mood and influences live in
 * refs, and the renderer reads them at frame cadence, because a full-viewport
 * layer that re-rendered sixty times a second is exactly the kind of thing that
 * makes a page feel expensive.
 *
 * Three things are allowed to disturb the field: the visitor's cursor, the one
 * true prism, and the scene itself.
 */

import { useEffect, useMemo, useRef } from "react";
import { onStoryFrame } from "../story/story-clock";
import type { SceneId } from "../story/timeline";
import { heroState } from "../scene/heroState";
import { storyActor } from "./story-actor";
import { GrainField } from "@/features/spectra/field/grain-field";
import {
  resolveVar,
  type GrainInfluence,
  type GrainMood,
} from "@/features/spectra/field/grain-renderer";

/**
 * The emotional arc, one entry per scene.
 *
 * `rest` is how present the field is. `spacing` is how fine the grain is, in
 * CSS pixels. `bias` is where the material gathers and how far it reaches:
 * the field is a pool in one corner of the room, not a wallpaper. It lives
 * lower-right by default — the same place it gathers on every card in the
 * product — and moves only when a scene has a reason to pull it. `wash` is the
 * atmospheric ground the grain sits on.
 */
type Mood = {
  rest: number;
  spacing: number;
  bias: [x: number, y: number, spread: number];
  wash: number;
};

const MOOD: Record<SceneId, Mood> = {
  /* Barely awake: a held breath in the corner, almost nothing. */
  wake: { rest: 0.14, spacing: 6.2, bias: [0.84, 0.86, 0.34], wash: 0.03 },
  /* The signature resting state: gathered lower-right, behind the headline. */
  hero: { rest: 0.26, spacing: 5.8, bias: [0.8, 0.78, 0.42], wash: 0.06 },
  /* Drawing in toward the work about to happen. */
  prepare: { rest: 0.3, spacing: 5.6, bias: [0.72, 0.72, 0.44], wash: 0.07 },
  /* Charged. The densest the field ever gets, tightened around the glass. */
  transform: { rest: 0.42, spacing: 5.0, bias: [0.6, 0.62, 0.48], wash: 0.1 },
  /* Alive: the work is running on its own, so the pool loosens. */
  living: { rest: 0.32, spacing: 5.6, bias: [0.68, 0.7, 0.5], wash: 0.075 },
  /* Tightened. Two actors want the same thing. */
  contention: { rest: 0.28, spacing: 5.3, bias: [0.58, 0.66, 0.4], wash: 0.055 },
  /* Back toward the dock's corner, where the work is being handed over. */
  dock: { rest: 0.3, spacing: 5.8, bias: [0.82, 0.8, 0.44], wash: 0.065 },
  /* Focused on one surface. */
  workbench: { rest: 0.28, spacing: 5.6, bias: [0.74, 0.74, 0.46], wash: 0.06 },
  /* Leaning toward the sources on the left. */
  references: { rest: 0.26, spacing: 5.9, bias: [0.3, 0.7, 0.46], wash: 0.055 },
  /* Ordered and fine, like the grid it sits under. */
  calendar: { rest: 0.24, spacing: 5.2, bias: [0.78, 0.76, 0.44], wash: 0.048 },
  /* Generative, lifting up out of the corner. */
  foundry: { rest: 0.38, spacing: 5.4, bias: [0.66, 0.56, 0.52], wash: 0.09 },
  /* Opening out as the camera starts to leave. */
  scale: { rest: 0.28, spacing: 6.4, bias: [0.72, 0.72, 0.6], wash: 0.06 },
  /* Resolved. Settled back into the corner it started in, and quieter. */
  reveal: { rest: 0.2, spacing: 6.8, bias: [0.84, 0.84, 0.5], wash: 0.042 },
};

/** Per-frame damping toward a target, frame-rate independent. */
function damp(current: number, target: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-rate));
}

/** Write a custom property only when it actually changed. */
function write(node: HTMLElement, name: string, value: string) {
  if (node.style.getPropertyValue(name) !== value) {
    node.style.setProperty(name, value);
  }
}

/** Fallback wake box size. Movement and growth both happen in `transform`. */
const PRISM_WAKE_R = 300;

const NEUTRAL: readonly [number, number, number] = [0.55, 0.57, 0.62];

export function LandingField() {
  const rootRef = useRef<HTMLSpanElement>(null);
  const prismRef = useRef<HTMLSpanElement>(null);

  /* The renderer reads these every frame and React never sees them change. */
  const source = useMemo(() => {
    const mood: GrainMood = {
      rest: MOOD.wake.rest,
      spacing: MOOD.wake.spacing,
      bias: [MOOD.wake.bias[0], MOOD.wake.bias[1], MOOD.wake.bias[2]],
      ink: NEUTRAL,
      tint: NEUTRAL,
      wash: MOOD.wake.wash,
    };
    /* Two slots: the prism, and whichever actor is working. Nothing follows the
       pointer — a wake welded to the cursor turns the whole field into a hover
       effect, which is the opposite of a material reacting to real work. */
    const influences: GrainInfluence[] = [
      { x: 0, y: 0, radius: 0, strength: 0, color: NEUTRAL },
      { x: 0, y: 0, radius: 0, strength: 0, color: NEUTRAL },
    ];
    return {
      mood: { current: mood },
      influences: { current: influences as readonly GrainInfluence[] },
      /* Kept mutable for the driver below; the renderer only ever reads. */
      write: { mood, influences },
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const prismNode = prismRef.current;
    if (!root || !prismNode) return;
    const { mood, influences } = source.write;
    const prismWake = influences[0]!;
    const actorWake = influences[1]!;

    /* Shared temporal phase, so the fallback lattice drifts with every other
       field in the document rather than starting its own cycle. */
    root.style.setProperty(
      "--field-phase",
      `${-Math.round(performance.now() % 58_000)}ms`,
    );

    /* Colours come from the stylesheet, not from constants here: the field must
       follow the theme, including a theme that does not exist yet. Re-read when
       the colour scheme changes rather than caching them for the visit. */
    const readColors = () => {
      mood.ink = resolveVar(root, "--text-primary", NEUTRAL);
      mood.tint = resolveVar(root, "--brand-primary", NEUTRAL);
      prismWake.color = mood.tint;
    };
    readColors();
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener?.("change", readColors);
    /* The product's own theme toggle writes a class on the document, which no
       media query reports. Watching the attribute is the honest signal. */
    const themes = new MutationObserver(readColors);
    themes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    let scene: SceneId | null = null;

    const stop = onStoryFrame((frame) => {
      const target = MOOD[frame.scene];

      /* Every mood value is damped, so a scene handoff is a swell rather than a
         step and scrubbing backwards reads identically. Spacing included: the
         grain opening up is one of the few things on this page that a visitor
         can feel without being able to name. */
      mood.rest = damp(mood.rest, target.rest, 0.05);
      mood.spacing = damp(mood.spacing, target.spacing, 0.04);
      mood.wash = damp(mood.wash, target.wash, 0.05);
      mood.bias = [
        damp(mood.bias[0], target.bias[0], 0.045),
        damp(mood.bias[1], target.bias[1], 0.045),
        damp(mood.bias[2], target.bias[2], 0.045),
      ];

      /* The prism disturbs the field it sits in. Its slot is already in
         viewport pixels, which is the space this layer lives in. */
      const slot = heroState.slot;
      const held = slot.w > 12;
      prismWake.x = damp(prismWake.x, held ? slot.x : prismWake.x, 0.22);
      prismWake.y = damp(prismWake.y, held ? slot.y : prismWake.y, 0.22);
      prismWake.radius = damp(
        prismWake.radius,
        held ? Math.max(200, slot.w * 1.5) : prismWake.radius,
        0.12,
      );
      prismWake.strength = damp(
        prismWake.strength,
        held ? (heroState.owned ? 0.46 : 0.3) : 0,
        0.07,
      );

      /* The other slot belongs to whoever is working. `storyActor` is written
         by the presence layer as actors take and release the page, so the field
         colours itself after the person or agent actually acting. */
      const acting = storyActor.strength > 0.01;
      actorWake.x = damp(actorWake.x, acting ? storyActor.x : actorWake.x, 0.18);
      actorWake.y = damp(actorWake.y, acting ? storyActor.y : actorWake.y, 0.18);
      actorWake.radius = damp(
        actorWake.radius,
        acting ? storyActor.radius : actorWake.radius,
        0.12,
      );
      actorWake.strength = damp(actorWake.strength, storyActor.strength, 0.08);
      if (acting) actorWake.color = storyActor.color;

      /* Everything past here only matters on a machine drawing the field in
         CSS. Once the GPU field has painted, these nodes are invisible and
         writing to them every frame would be pure cost. */
      if (root.dataset.gpu === "true") return;

      if (scene !== frame.scene) {
        scene = frame.scene;
        /* The lattice cannot be as fine as the real field without turning into
           a flat wash, so it tracks the arc a couple of pixels opener. */
        root.style.setProperty("--field-cell", `${target.spacing + 2.4}px`);
        root.style.setProperty("--field-bias-x", `${target.bias[0] * 100}%`);
        root.style.setProperty("--field-bias-y", `${target.bias[1] * 100}%`);
        root.style.setProperty(
          "--field-bias-spread",
          `${Math.round(target.bias[2] * 240)}%`,
        );
      }
      write(root, "--field-rest", (mood.rest * 0.6).toFixed(4));
      write(prismNode, "--wake-tx", `${Math.round(prismWake.x)}px`);
      write(prismNode, "--wake-ty", `${Math.round(prismWake.y)}px`);
      write(prismNode, "--wake-scale", (prismWake.radius / PRISM_WAKE_R).toFixed(3));
      write(prismNode, "--wake-strength", (prismWake.strength * 1.6).toFixed(3));
    });

    return () => {
      stop();
      themes.disconnect();
      scheme?.removeEventListener?.("change", readColors);
    };
  }, [source]);

  return (
    <span
      ref={rootRef}
      className="spectra-field landing-field"
      data-scale="stage"
      data-grain="wave"
      data-depth="true"
      aria-hidden="true"
    >
      <GrainField source={source} subscribe={onStoryFrame} maxDpr={1.75}>
        {/* The CSS field. Drawn until the GPU field's first real frame lands,
            and kept as the whole field on a machine that cannot run one. */}
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
      </GrainField>
    </span>
  );
}
