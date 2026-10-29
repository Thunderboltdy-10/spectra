/**
 * Seeded randomness for the hand. Every viewer of one performance draws the
 * same numbers from the same seed, so two people watching the AI see the same
 * path and the same rhythm, and a replay is exact.
 */

export type Random = {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  between(min: number, max: number): number;
  /** Standard normal. */
  normal(): number;
  /** Log-normal around `median`, spread `sigma` (0.25 is a steady hand). */
  around(median: number, sigma: number): number;
  chance(probability: number): boolean;
};

export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: tiny, fast and good enough for motion. */
export function seededRandom(seed: number | string): Random {
  let state = (typeof seed === "string" ? hashSeed(seed) : seed) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    const u = Math.max(1e-9, next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return {
    next,
    between: (min, max) => min + (max - min) * next(),
    normal,
    around: (median, sigma) => median * Math.exp(sigma * Math.max(-2.5, Math.min(2.5, normal()))),
    chance: (probability) => next() < probability,
  };
}
