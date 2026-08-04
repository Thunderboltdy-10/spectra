/**
 * Prism scene state machine (Phase 15.3/15.4).
 *
 * One pure function drives the WebGL prism through the landing narrative:
 * fragmented context narrows to a single beam, passes through the prism, and
 * resolves into connected, spectral work. The same state feeds the reduced
 * motion and no-WebGL fallbacks, so every renderer tells the same story.
 *
 * Everything here is deterministic and time-free: identical scroll input must
 * produce identical optical state (exit-criteria: deterministic timeline).
 */

export type PrismSceneId =
  "hero" | "fragments" | "transformation" | "live" | "converge";

/**
 * The optical contract of a scene. All values are unitless 0..1 blends.
 */
export type PrismSceneState = {
  /** 0 = collapsed white beam; 1 = full spectral fan. */
  dispersion: number;
  /** Input beam intensity. */
  beam: number;
  /** Fan spread. */
  fan: number;
  /** Prism counter-tilt in radians (parallax-independent). */
  tilt: number;
  /** Interior shimmer. */
  shimmer: number;
  /**
   * Primary narrative driver: 0 = dormant glass → 1 = released, coherent
   * output. Maps onto the prism engine's phases (contact → ignite → route →
   * alive → compress → release). Monotonic along the track.
   */
  progress: number;
};

/**
 * The ordered narrative track. Not every scene uses a strict before/after;
 * the prism tell is: narrow → bent → open → resolved.
 */
export const PRISM_TRACK: PrismSceneId[] = [
  "hero",
  "fragments",
  "transformation",
  "live",
  "converge",
];

export const PRISM_SCENES: Record<PrismSceneId, PrismSceneState> = {
  // Arrival: dormant glass, the first current already on its way in.
  hero: {
    dispersion: 0.42,
    beam: 0.85,
    fan: 0.5,
    tilt: 0,
    shimmer: 0.6,
    progress: 0.1,
  },
  // Fragmentation: six separated wavelengths land on the live contact points.
  fragments: {
    dispersion: 0.1,
    beam: 0.55,
    fan: 0.12,
    tilt: -0.09,
    shimmer: 0.3,
    progress: 0.24,
  },
  // Transformation: separated paths refract, pool and consolidate.
  transformation: {
    dispersion: 0.68,
    beam: 1,
    fan: 0.58,
    tilt: 0.06,
    shimmer: 0.9,
    progress: 0.52,
  },
  // Live work: the contained field is alive — buoyant, irregular, breathing.
  live: {
    dispersion: 0.92,
    beam: 0.8,
    fan: 1,
    tilt: 0.04,
    shimmer: 0.5,
    progress: 0.74,
  },
  // Convergence: the field compresses and releases as one coherent light.
  converge: {
    dispersion: 0.5,
    beam: 0.6,
    fan: 0.42,
    tilt: 0,
    shimmer: 0.35,
    progress: 0.97,
  },
};

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeInOut(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function lerpScene(
  from: PrismSceneState,
  to: PrismSceneState,
  t: number,
): PrismSceneState {
  const k = clamp01(t);
  const mix = (a: number, b: number) => a + (b - a) * k;
  return {
    dispersion: mix(from.dispersion, to.dispersion),
    beam: mix(from.beam, to.beam),
    fan: mix(from.fan, to.fan),
    tilt: mix(from.tilt, to.tilt),
    shimmer: mix(from.shimmer, to.shimmer),
    progress: mix(from.progress, to.progress),
  };
}

/**
 * Map scroll progress through the whole track (0 → first scene's start,
 * 1 → last scene's end) to a continuous optical state. Between named scenes
 * the prism interpolates smoothly — movement is a transition, not a jump.
 */
export function sceneForProgress(trackProgress: number): PrismSceneState {
  const last = PRISM_TRACK.length - 1;
  const scaled = clamp01(trackProgress) * last;
  const index = Math.min(Math.floor(scaled), last - 1);
  const local = scaled - index;
  return lerpScene(
    PRISM_SCENES[PRISM_TRACK[index]!]!,
    PRISM_SCENES[PRISM_TRACK[index + 1]!]!,
    easeInOut(local),
  );
}

/**
 * Which named scene owns the copy panel at this progress (nearest boundary at
 * the midpoint of each transition).
 */
export function sceneIndexForProgress(trackProgress: number): number {
  const last = PRISM_TRACK.length - 1;
  const scaled = clamp01(trackProgress) * last;
  return Math.min(Math.round(scaled), last);
}

/** Static state for reduced motion / no-WebGL renderers: one composed frame. */
export function staticSceneFor(sceneId: PrismSceneId): PrismSceneState {
  return PRISM_SCENES[sceneId];
}
