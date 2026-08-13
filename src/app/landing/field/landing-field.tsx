"use client";

/**
 * Level 3: the landing as an environment.
 *
 * The whole page sits inside one field. It is the same primitive the product
 * uses on a card or a panel, at the one scale where CSS cannot draw it: a fine
 * halftone lattice across the entire viewport, flowing, displaced by whatever
 * is happening in front of it. So this hands the field to the GPU and drives it
 * from the story clock.
 *
 * Nothing here goes through React after mount. Mood and influences live in
 * refs, and the renderer reads them at frame cadence, because a full-viewport
 * layer that re-rendered sixty times a second is exactly the kind of thing that
 * makes a page feel expensive.
 *
 * Two things are allowed to disturb the field: the one true prism, which has a
 * body and therefore casts a shadow into the lattice, and whoever is currently
 * working, who does not.
 */

import { useEffect, useMemo, useRef } from "react";
import { onStoryFrame } from "../story/story-clock";
import { channelFor, type SceneId } from "../story/timeline";
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
 * `rest` is how present the field is. `spacing` is the lattice pitch in CSS
 * pixels. `bias` is where the material gathers and how far it reaches: the
 * field is a pool in one corner of the room, not a wallpaper. It lives
 * lower-right by default — the same place it gathers on every card in the
 * product — and moves only when a scene has a reason to pull it. `wave` and
 * `speed` are how liquid the flow is, and `wash` is the atmospheric ground.
 */
type Mood = {
  rest: number;
  spacing: number;
  bias: [x: number, y: number, spread: number];
  wave: number;
  speed: number;
  wash: number;
};

const MOOD: Record<SceneId, Mood> = {
  /* Barely awake: a held breath in the corner, almost nothing moving. */
  wake: { rest: 0.2, spacing: 10, bias: [0.84, 0.86, 0.36], wave: 0.5, speed: 0.55, wash: 0.03 },
  /* The signature resting state: gathered lower-right, behind the headline. */
  hero: { rest: 0.34, spacing: 9.2, bias: [0.8, 0.78, 0.44], wave: 0.8, speed: 0.8, wash: 0.055 },
  /* Drawing in toward the work about to happen. */
  prepare: { rest: 0.4, spacing: 8.6, bias: [0.7, 0.72, 0.46], wave: 0.95, speed: 0.95, wash: 0.07 },
  /* Charged. The densest and most liquid the field ever gets. */
  transform: { rest: 0.54, spacing: 7.6, bias: [0.56, 0.6, 0.52], wave: 1.35, speed: 1.25, wash: 0.1 },
  /* Alive: the work runs on its own, so the pool loosens and slows. */
  living: { rest: 0.42, spacing: 8.4, bias: [0.66, 0.7, 0.52], wave: 1, speed: 0.9, wash: 0.075 },
  /* Tightened. Two actors want the same thing. */
  contention: { rest: 0.38, spacing: 8, bias: [0.56, 0.66, 0.42], wave: 0.7, speed: 0.7, wash: 0.05 },
  /* Back toward the dock's corner, where the work is handed over. */
  dock: { rest: 0.4, spacing: 8.8, bias: [0.82, 0.8, 0.44], wave: 0.9, speed: 0.85, wash: 0.065 },
  /* Focused on one surface. */
  workbench: { rest: 0.36, spacing: 8.6, bias: [0.74, 0.74, 0.46], wave: 0.85, speed: 0.8, wash: 0.055 },
  /* Leaning toward the sources on the left. */
  references: { rest: 0.34, spacing: 9, bias: [0.28, 0.7, 0.46], wave: 0.8, speed: 0.75, wash: 0.05 },
  /* Ordered and fine, like the grid it sits under. */
  calendar: { rest: 0.32, spacing: 8, bias: [0.78, 0.76, 0.44], wave: 0.55, speed: 0.6, wash: 0.045 },
  /* Generative, lifting up out of the corner. */
  foundry: { rest: 0.48, spacing: 8.2, bias: [0.64, 0.54, 0.54], wave: 1.15, speed: 1.05, wash: 0.088 },
  /* Opening out as the camera starts to leave. */
  scale: { rest: 0.36, spacing: 10.4, bias: [0.72, 0.72, 0.62], wave: 0.9, speed: 0.8, wash: 0.055 },
  /* Resolved. Settled back into the corner it started in, and quieter. */
  reveal: { rest: 0.26, spacing: 11.4, bias: [0.84, 0.84, 0.52], wave: 0.6, speed: 0.6, wash: 0.04 },
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
const FULL_RECT: [number, number, number, number] = [0, 0, 1, 1];

export function LandingField() {
  const rootRef = useRef<HTMLSpanElement>(null);
  const prismRef = useRef<HTMLSpanElement>(null);

  /* The renderer reads these every frame and React never sees them change. */
  const source = useMemo(() => {
    const first = MOOD.wake;
    const mood: GrainMood = {
      rest: first.rest,
      spacing: first.spacing,
      bias: [first.bias[0], first.bias[1], first.bias[2]],
      ink: NEUTRAL,
      tint: NEUTRAL,
      wave: first.wave,
      speed: first.speed,
      pulse: 0,
      wash: first.wash,
      clip: 0,
      clipRect: FULL_RECT,
    };
    /* Two slots: the prism, and whichever actor is working. Nothing follows the
       pointer — a wake welded to the cursor turns the whole field into a hover
       effect, which is the opposite of a material reacting to real work. */
    const influences: GrainInfluence[] = [
      { x: 0, y: 0, radius: 0, strength: 0, color: NEUTRAL, occludes: true },
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
    const clipRect: [number, number, number, number] = [0, 0, 1, 1];
    mood.clipRect = clipRect;

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
      mood.ink = resolveVar(root, "--text-tertiary", NEUTRAL);
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
      mood.wave = damp(mood.wave, target.wave, 0.04);
      mood.speed = damp(mood.speed, target.speed, 0.04);
      mood.wash = damp(mood.wash, target.wash, 0.05);
      mood.bias = [
        damp(mood.bias[0], target.bias[0], 0.045),
        damp(mood.bias[1], target.bias[1], 0.045),
        damp(mood.bias[2], target.bias[2], 0.045),
      ];

      /* A travel is the one moment the field is allowed to be loud: the swell
         is what carries the eye from one composition to the next, and it is
         gone by the time the next scene starts playing. */
      const travelling = frame.arrive < 1;
      mood.pulse = damp(
        mood.pulse,
        travelling ? Math.sin(frame.arrive * Math.PI) * 0.7 : 0,
        0.14,
      );

      /* The reveal's clip, read from the same box that clips the canvas: the
         field discovers it was inside a panel at exactly the moment the page
         does. */
      const box = channelFor(frame, frame.viewport);
      mood.clip = damp(mood.clip, box.open, 0.1);
      if (box.open > 0.002) {
        const { width, height } = frame.viewport;
        clipRect[0] = box.left / width;
        clipRect[1] = box.top / height;
        clipRect[2] = 1 - box.right / width;
        clipRect[3] = 1 - box.bottom / height;
      }

      /* The prism disturbs the field it sits in, and shades it underneath. Its
         slot is already in viewport pixels, which is the space this layer lives
         in. */
      const slot = heroState.slot;
      const held = slot.w > 12;
      prismWake.x = damp(prismWake.x, held ? slot.x : prismWake.x, 0.22);
      prismWake.y = damp(prismWake.y, held ? slot.y : prismWake.y, 0.22);
      prismWake.radius = damp(
        prismWake.radius,
        held ? Math.max(200, slot.w * 0.85) : prismWake.radius,
        0.12,
      );
      prismWake.strength = damp(
        prismWake.strength,
        held ? (heroState.owned ? 0.85 : 0.6) : 0,
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
        root.style.setProperty("--field-cell", `${target.spacing}px`);
        root.style.setProperty("--field-bias-x", `${target.bias[0] * 100}%`);
        root.style.setProperty("--field-bias-y", `${target.bias[1] * 100}%`);
        root.style.setProperty(
          "--field-bias-spread",
          `${Math.round(target.bias[2] * 240)}%`,
        );
      }
      write(root, "--field-rest", (mood.rest * 0.42).toFixed(4));
      write(prismNode, "--wake-tx", `${Math.round(prismWake.x)}px`);
      write(prismNode, "--wake-ty", `${Math.round(prismWake.y)}px`);
      write(
        prismNode,
        "--wake-scale",
        (prismWake.radius / PRISM_WAKE_R).toFixed(3),
      );
      write(prismNode, "--wake-strength", prismWake.strength.toFixed(3));
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
      <GrainField source={source} subscribe={onStoryFrame} maxDpr={1.5}>
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
