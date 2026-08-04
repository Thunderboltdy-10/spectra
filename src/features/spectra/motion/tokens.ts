/**
 * Spectra motion tokens (Phase 14.1).
 *
 * These mirror the CSS custom properties in globals.css
 * (`--motion-fast`, `--motion-base`, `--motion-slow`, `--ease-standard`,
 * `--ease-out-expo`, `--ease-in-out`) so JavaScript animation code and CSS
 * share one grammar. Durations are expressed in seconds because the motion
 * runtime (framer-motion) consumes seconds.
 */

export const MOTION_DURATIONS = {
  instant: 0.08,
  fast: 0.12,
  base: 0.22,
  slow: 0.36,
  deliberate: 0.48,
} as const;

export const MOTION_EASINGS = {
  /** Default emphasized ease — fast attack, long soft tail. */
  standard: [0.22, 1, 0.36, 1] as const,
  /** Exponential-out — pointer travel, presence settling. */
  outExpo: [0.16, 1, 0.3, 1] as const,
  /** Symmetric in-out — state morphs that reverse direction. */
  inOut: [0.65, 0, 0.35, 1] as const,
} as const;

export type MotionDurationKey = keyof typeof MOTION_DURATIONS;
export type MotionEasingKey = keyof typeof MOTION_EASINGS;
