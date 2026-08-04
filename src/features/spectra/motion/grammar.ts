/**
 * Spectra motion grammar (Phase 14.1).
 *
 * Seven shared primitives. Each animation in the product should name the
 * primitive it belongs to — motion communicates *why* something moved:
 *
 *   reveal     — content, titles and summaries enter.
 *   morph      — one surface becomes another (panel→fullscreen,
 *                collapsed→expanded reference, run input expansion).
 *   focus      — a semantic target is highlighted once (comment, source,
 *                AI target). One restrained pulse, then settles.
 *   ownership  — an actor holds a control/object; material/outline appears.
 *   completion — save, sync, submit, run completion resolves.
 *   recovery   — reconnect, wait, retry, resume continues without alarm.
 *   presence   — cursors arrive, selections settle, labels decay.
 *
 * `grammarFor` maps a primitive + effective motion level to concrete
 * framer-motion values. Reduced motion keeps *state* legible (opacity and
 * short fades) but removes travel and scale; "none" returns instant.
 */

import { MOTION_DURATIONS, MOTION_EASINGS } from "./tokens";
import type { SpectraMotionLevel } from "./motion-level";

export type MotionPrimitive =
  | "reveal"
  | "morph"
  | "focus"
  | "ownership"
  | "completion"
  | "recovery"
  | "presence";

export interface PrimitiveConfig {
  /** spring definitions take precedence over duration/ease when present */
  type: "tween" | "spring";
  duration: number;
  ease: readonly [number, number, number, number];
  stiffness?: number;
  damping?: number;
  /** travel distance in px for enter/exit offsets (0 removes travel) */
  distance: number;
}

const FULL: Record<MotionPrimitive, PrimitiveConfig> = {
  reveal: {
    type: "tween",
    duration: MOTION_DURATIONS.base,
    ease: MOTION_EASINGS.standard,
    distance: 6,
  },
  morph: {
    type: "spring",
    duration: MOTION_DURATIONS.slow,
    ease: MOTION_EASINGS.standard,
    stiffness: 300,
    damping: 32,
    distance: 0,
  },
  focus: {
    type: "tween",
    duration: 0.9,
    ease: MOTION_EASINGS.standard,
    distance: 0,
  },
  ownership: {
    type: "tween",
    duration: MOTION_DURATIONS.fast,
    ease: MOTION_EASINGS.outExpo,
    distance: 2,
  },
  completion: {
    type: "tween",
    duration: 0.3,
    ease: MOTION_EASINGS.standard,
    distance: 3,
  },
  recovery: {
    type: "tween",
    duration: 0.26,
    ease: MOTION_EASINGS.inOut,
    distance: 0,
  },
  presence: {
    type: "tween",
    duration: 0.35,
    ease: MOTION_EASINGS.outExpo,
    distance: 4,
  },
};

const REDUCED_MULTIPLIER = 0.4;
const REDUCED_DISTANCE_CAP = 1;

export function grammarFor(
  primitive: MotionPrimitive,
  level: SpectraMotionLevel,
): PrimitiveConfig {
  const base = FULL[primitive];
  if (level === "none") {
    return { ...base, type: "tween", duration: 0.001, distance: 0 };
  }
  if (level === "reduced") {
    return {
      ...base,
      type: "tween",
      duration: Math.max(
        MOTION_DURATIONS.instant,
        base.duration * REDUCED_MULTIPLIER,
      ),
      distance: Math.min(base.distance, REDUCED_DISTANCE_CAP),
      stiffness: undefined,
      damping: undefined,
    };
  }
  return base;
}

/** framer-motion transition for a primitive at a motion level. */
export function transitionFor(
  primitive: MotionPrimitive,
  level: SpectraMotionLevel,
) {
  const config = grammarFor(primitive, level);
  if (config.type === "spring" && config.stiffness && config.damping) {
    return {
      type: "spring" as const,
      stiffness: config.stiffness,
      damping: config.damping,
    };
  }
  return { duration: config.duration, ease: config.ease };
}
