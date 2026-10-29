import type { Random } from "./random";

/**
 * One pointer movement, as a hand makes it.
 *
 * A person never moves a mouse in a straight line at constant speed. The path
 * bows to one side (the wrist pivots), speed rises and falls smoothly
 * (minimum jerk), a long sweep slightly overshoots and corrects back, and the
 * hand is never perfectly still. Duration follows Fitts's law, scaled down so
 * the AI reads as a quick, sure collaborator rather than a slow one.
 */

export type Point = { x: number; y: number };

export type Stroke = {
  from: Point;
  to: Point;
  durationMs: number;
  /** Position at `elapsedMs` into the stroke. */
  at(elapsedMs: number): Point;
};

/** Minimum-jerk position profile: the shape of a reaching movement. */
export function minimumJerk(t: number) {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * clamped * (10 - 15 * clamped + 6 * clamped * clamped);
}

/** Fitts's law with a human constant, times `speed` (0.45 ≈ twice as quick as a person). */
export function strokeDuration(distancePx: number, targetPx = 18, speed = 0.45) {
  if (!Number.isFinite(distancePx) || distancePx < 1) return 0;
  const human = 90 + 150 * Math.log2(1 + distancePx / Math.max(4, targetPx));
  return Math.round(Math.max(110, Math.min(900, human * speed)));
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Plan a stroke. `random` makes each stroke a little different; the same seed
 * gives the same stroke.
 */
export function planStroke(
  from: Point,
  to: Point,
  random: Random,
  options: { targetPx?: number; speed?: number } = {},
): Stroke {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const base = strokeDuration(distance, options.targetPx, options.speed);
  if (distance < 2 || base === 0)
    return { from, to, durationMs: 0, at: () => to };
  const durationMs = Math.round(base * random.around(1, 0.12));
  // Perpendicular unit vector; the bow is a share of the distance, either side,
  // smaller for short hops so a nudge never swings.
  const nx = -dy / distance;
  const ny = dx / distance;
  const bow = (random.chance(0.5) ? 1 : -1) * distance * random.between(0.04, 0.16) * Math.min(1, distance / 140);
  const lean = random.between(0.25, 0.42);
  const c1 = { x: from.x + dx * lean + nx * bow, y: from.y + dy * lean + ny * bow };
  const c2 = { x: from.x + dx * (1 - lean * 0.6) + nx * bow * 0.45, y: from.y + dy * (1 - lean * 0.6) + ny * bow * 0.45 };
  // A long sweep lands a little past the target, then corrects back.
  const overshoot = distance > 180 && random.chance(0.6) ? random.between(0.025, 0.06) : 0;
  const landing = { x: to.x + (dx / distance) * distance * overshoot, y: to.y + (dy / distance) * distance * overshoot };
  const correctionMs = overshoot ? Math.round(random.between(70, 120)) : 0;
  const travelMs = durationMs - correctionMs;
  // Tremor: two slow sines with seeded phase, under a pixel, fading out on arrival.
  const phaseA = random.between(0, Math.PI * 2);
  const phaseB = random.between(0, Math.PI * 2);
  const tremor = (elapsed: number, fade: number) => ({
    x: Math.sin(elapsed / 37 + phaseA) * 0.6 * fade,
    y: Math.cos(elapsed / 43 + phaseB) * 0.6 * fade,
  });
  const end = overshoot ? landing : to;
  return {
    from,
    to,
    durationMs,
    at(elapsedMs) {
      if (elapsedMs <= 0) return from;
      if (elapsedMs >= durationMs) return to;
      if (elapsedMs > travelMs) {
        const t = minimumJerk((elapsedMs - travelMs) / Math.max(1, correctionMs));
        return { x: landing.x + (to.x - landing.x) * t, y: landing.y + (to.y - landing.y) * t };
      }
      const t = minimumJerk(elapsedMs / travelMs);
      const shake = tremor(elapsedMs, Math.sin(Math.PI * t));
      return {
        x: cubic(from.x, c1.x + (end.x - to.x), c2.x + (end.x - to.x), end.x, t) + shake.x,
        y: cubic(from.y, c1.y + (end.y - to.y), c2.y + (end.y - to.y), end.y, t) + shake.y,
      };
    },
  };
}
