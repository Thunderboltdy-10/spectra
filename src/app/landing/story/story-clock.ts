"use client";

/**
 * The story clock.
 *
 * One requestAnimationFrame loop reads the scroll position, resolves the
 * camera, and publishes the result to whoever is listening. Nothing here goes
 * through React state, because the camera moves every frame and the page has
 * real product interfaces mounted inside it: re-rendering that tree sixty
 * times a second would be the one thing guaranteed to make the page feel
 * cheap.
 *
 * Components that need per-frame values (typed text, the field, the prism)
 * subscribe imperatively and write to their own DOM. Components that need
 * discrete values (which scene is mounted, whether a panel is open) use
 * `useStoryValue`, which re-renders only when that specific value changes.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  cameraFor,
  fitFor,
  zoomFor,
  type CameraState,
  type SceneId,
} from "./timeline";

export type StoryFrame = CameraState & {
  /** Viewport size at this frame. */
  viewport: { width: number; height: number };
  /** fit-to-width scale before the scene's own zoom. */
  fit: number;
  /** Total scale actually applied to the canvas. */
  scale: number;
  /** How fast the visitor is scrolling, px per frame, smoothed. */
  velocity: number;
};

const INITIAL: StoryFrame = {
  y: 0,
  zoom: 1,
  scene: "wake",
  t: 0,
  arrive: 1,
  span: 0,
  index: 0,
  overall: 0,
  viewport: { width: 1440, height: 900 },
  fit: 1,
  scale: 1,
  velocity: 0,
};

/** Live state. Mutated in place every frame; never treated as immutable. */
export const storyFrame: StoryFrame = { ...INITIAL };

type Listener = (frame: StoryFrame) => void;

/**
 * Two phases per frame, because order matters exactly once.
 *
 * `measure` reads layout: where the objects on the canvas actually are this
 * frame. `write` consumes those measurements and paints. Keeping them apart is
 * what lets the prism's slot, the field's wake and the camera agree about the
 * same frame instead of trailing each other by one.
 */
const measureListeners = new Set<Listener>();
const frameListeners = new Set<Listener>();

/** Subscribe to every frame. For imperative consumers only. */
export function onStoryFrame(
  listener: Listener,
  phase: "measure" | "write" = "write",
): () => void {
  const set = phase === "measure" ? measureListeners : frameListeners;
  set.add(listener);
  listener(storyFrame);
  return () => set.delete(listener);
}

/**
 * Run one listener set.
 *
 * Each listener is isolated. A single throwing subscriber used to take the
 * whole rAF loop down with it — the camera, the prism, every authored line —
 * and freeze the page mid-scene for the rest of the visit. One bad measurement
 * now costs one listener, and says so in development.
 */
function emit(set: Set<Listener>) {
  for (const listener of set) {
    try {
      listener(storyFrame);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") console.error(error);
      set.delete(listener);
    }
  }
}

export function emitStoryFrame() {
  emit(measureListeners);
  emit(frameListeners);
}

/* ------------------------------------------------------------------ *
 * Discrete values
 * ------------------------------------------------------------------ */

const stepListeners = new Set<() => void>();
let stepVersion = 0;

/**
 * Discrete story values, updated only when they actually change.
 *
 * `step` is the scene-local progress quantised to a coarse grid. Structural
 * decisions ("has the workbench arrived yet") read this rather than raw `t`,
 * so a scene re-renders a handful of times per traversal instead of every
 * frame.
 */
export const storyStep = {
  scene: "wake" as SceneId,
  index: 0,
  /** Scene-local progress in 1/24ths. */
  step: 0,
  /** Whole-story progress in 1/64ths. */
  overallStep: 0,
};

const STEPS_PER_SCENE = 24;
const STEPS_OVERALL = 64;

export function commitStoryStep(frame: StoryFrame) {
  const step = Math.round(frame.t * STEPS_PER_SCENE);
  const overallStep = Math.round(frame.overall * STEPS_OVERALL);
  if (
    storyStep.scene === frame.scene &&
    storyStep.step === step &&
    storyStep.overallStep === overallStep
  )
    return;
  storyStep.scene = frame.scene;
  storyStep.index = frame.index;
  storyStep.step = step;
  storyStep.overallStep = overallStep;
  stepVersion += 1;
  for (const listener of stepListeners) listener();
}

function subscribeStep(listener: () => void) {
  stepListeners.add(listener);
  return () => stepListeners.delete(listener);
}

/**
 * Read a discrete story value. Re-renders only when the selected value
 * changes, which is what keeps mounted product surfaces still.
 */
export function useStoryValue<T>(select: (step: typeof storyStep) => T): T {
  const snapshot = useCallback(() => select(storyStep), [select]);
  return useSyncExternalStore(
    subscribeStep,
    snapshot,
    /* Server render: the story has not started. */
    () => select(storyStep),
  );
}

/** Scene-local progress as a number 0..1, at step resolution. */
export function useSceneProgress(scene: SceneId): number {
  return useStoryValue((step) =>
    step.scene === scene
      ? step.step / STEPS_PER_SCENE
      : step.index > sceneIndex(scene)
        ? 1
        : 0,
  );
}

function sceneIndex(scene: SceneId): number {
  return SCENE_ORDER.indexOf(scene);
}

const SCENE_ORDER: SceneId[] = [
  "wake",
  "hero",
  "prepare",
  "transform",
  "living",
  "contention",
  "dock",
  "workbench",
  "references",
  "calendar",
  "foundry",
  "scale",
  "reveal",
];

/** Version counter, exported for tests. */
export function storyStepVersion(): number {
  return stepVersion;
}

/* ------------------------------------------------------------------ *
 * The loop
 * ------------------------------------------------------------------ */

/**
 * Advance the clock. Called once per animation frame by the story root.
 *
 * Scroll is read directly rather than through a scroll listener: one read per
 * frame, no event storm, and the value is always the one this frame will
 * actually paint with.
 */
/**
 * Frames still emitted after the page went still.
 *
 * Motion on this page does not all come from scroll: damped values settle,
 * wakes relax, carets blink out. So the clock does not stop the instant the
 * scroll does — it keeps running for a couple of seconds, then idles. Any real
 * input wakes it immediately, and the idle state is invisible because by then
 * nothing was moving anyway.
 */
const COAST_FRAMES = 150;
let coast = COAST_FRAMES;

/** Force the next frames to run: pointer movement, resize, a scene handoff. */
export function wakeStory(frames = COAST_FRAMES) {
  if (coast < frames) coast = frames;
}

/**
 * Advance the clock one frame.
 *
 * Returns `false` when the page is still and the coast frames have run out —
 * the caller should stop scheduling frames at that point and wake the loop on
 * the next real input instead. Idle costs no rAF at all.
 */
export function advanceStory(
  scrollY: number,
  width: number,
  height: number,
): boolean {
  const camera = cameraFor(scrollY, height);
  const still =
    camera.y === storyFrame.y &&
    camera.scene === storyFrame.scene &&
    camera.t === storyFrame.t &&
    camera.arrive === storyFrame.arrive &&
    width === storyFrame.viewport.width &&
    height === storyFrame.viewport.height;
  if (still) {
    if (coast <= 0) return false;
    coast -= 1;
  } else {
    coast = COAST_FRAMES;
  }
  const previousY = storyFrame.y;
  storyFrame.y = camera.y;
  storyFrame.scene = camera.scene;
  storyFrame.t = camera.t;
  storyFrame.arrive = camera.arrive;
  storyFrame.span = camera.span;
  storyFrame.index = camera.index;
  storyFrame.overall = camera.overall;
  storyFrame.viewport.width = width;
  storyFrame.viewport.height = height;
  /* Fitted to both axes, so a held scene is exactly the frame rather than a
     crop of one. */
  storyFrame.fit = fitFor(storyFrame.viewport);
  /* The final zoom is a measurement rather than an authored number: it is
     whatever makes the surface exactly one panel wide in this window. */
  storyFrame.zoom = zoomFor(camera, storyFrame.viewport, storyFrame.fit);
  storyFrame.scale = storyFrame.fit * storyFrame.zoom;
  storyFrame.velocity =
    storyFrame.velocity * 0.82 + (camera.y - previousY) * 0.18;
  emitStoryFrame();
  commitStoryStep(storyFrame);
  return true;
}
