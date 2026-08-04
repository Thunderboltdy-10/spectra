import * as THREE from "three";

/**
 * Shared light-field state for the landing prism (Phase 15).
 *
 * This module is the single source of truth the prism, the wavelength
 * currents and the output beam all read every frame. Scroll position never
 * writes React state: it writes one number (`heroState.progress`) through a
 * ref, and every renderer damps toward it — movement is a transition, not a
 * replacement.
 *
 * Everything is deterministic for a given progress + time, so the reduced
 * motion and no-WebGL renderers tell the same optical story.
 */

/** Narrative thresholds over progress (0 → 1). Exported for tests. */
export const T = {
  /** First wavelengths touch the glass. */
  contact: 0.08,
  /** All six currents have landed; interior ignition completes. */
  ignite: 0.24,
  /** Separated wavelengths begin refracted routing. */
  route: 0.44,
  /** The contained field becomes alive (live work). */
  alive: 0.64,
  /** The field compresses toward the lower output channel. */
  output: 0.86,
} as const;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential approach (THREE's damp, re-exported). */
export function damp(
  current: number,
  target: number,
  lambda: number,
  dt: number,
): number {
  return THREE.MathUtils.damp(current, target, lambda, dt);
}

export type HeroPhases = {
  dormant: number;
  ignition: number;
  routing: number;
  consolidate: number;
  alive: number;
  compression: number;
  release: number;
};

/**
 * Decompose raw progress into the optical engine's phase weights. The bands
 * overlap deliberately: ignition hands energy to routing, routing pools into
 * a living field, and the field compresses toward release without hard cuts.
 */
export function phases(p: number): HeroPhases {
  const dormant = 1 - smoothstep(0.015, T.contact + 0.05, p);
  const ignition =
    smoothstep(T.contact - 0.04, T.ignite, p) *
    (1 - smoothstep(T.route - 0.1, T.route + 0.08, p));
  const routing =
    smoothstep(T.ignite - 0.06, T.route, p) *
    (1 - smoothstep(T.alive - 0.1, T.alive + 0.03, p));
  const consolidate = smoothstep(T.route - 0.04, (T.route + T.alive) * 0.5, p);
  const alive =
    smoothstep(T.alive - 0.14, T.alive + 0.05, p) *
    (1 - smoothstep(T.output - 0.07, T.output + 0.04, p));
  const compression = smoothstep(
    (T.alive + T.output) * 0.5 - 0.05,
    T.output,
    p,
  );
  const release = smoothstep(T.output - 0.02, 0.995, p);
  return {
    dormant,
    ignition,
    routing,
    consolidate,
    alive,
    compression,
    release,
  };
}

/** Mutable per-frame light-field state. Written imperatively, never via React. */
export const heroState = {
  /** Narrative progress 0..1 (damped toward the scroll target). */
  progress: 0,
  /** When set, freezes the narrative clock (reduced-motion static compose). */
  fixedTime: null as number | null,
  /** Pointer parallax, normalized -1..1, already smoothed. */
  px: 0,
  py: 0,
  hover: 0,
  /** One-shot energy pulse (click without drag). */
  pulse: 0,
  /** Sustained charge — how much energy the glass currently holds. */
  charge: 0,
  compression: 0,
  emission: 0,
  dragging: false,
  reducedMotion: false,
  /** Live ingestion weight per wavelength, written by the currents. */
  entryPower: [0, 0, 0, 0, 0, 0] as number[],
  /** Current world orientation / center of the prism, for the currents. */
  quat: new THREE.Quaternion(),
  center: new THREE.Vector3(),
};
