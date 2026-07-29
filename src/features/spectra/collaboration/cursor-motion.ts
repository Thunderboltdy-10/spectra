/**
 * Cursor travel physics.
 *
 * One actor has one visible body. When that body moves between two controls it
 * must read as a *journey with intent*, not a teleport and not a linear slide:
 * nearby hops feel instant, long sweeps take slightly longer and ease out onto
 * the target the way a real pointer decelerates onto a control.
 *
 * The motion model is a retargetable exponential-out tween. Durations scale
 * with distance and are capped so a fast AI never feels hesitant — the point
 * is legibility of intent, not simulated human slowness. Reduced-motion
 * collapses every journey to its destination immediately; a cross-scope jump
 * (another slide, another sheet) is expressed as a calm fade rather than a
 * false physical flight across unrelated canvas.
 */

export type TravelKind =
  /** Pointer stays on the same control: no visible travel. */
  | "stay"
  /** A short move between neighbouring controls. */
  | "hop"
  /** A longer sweep across the surface. */
  | "journey"
  /** A move that crosses a scope boundary; shown as a restrained fade. */
  | "fade";

export type TravelSample = {
  x: number;
  y: number;
  /** 0..1 through the current journey; 1 when settled. */
  progress: number;
  /** True while a journey is in flight. */
  travelling: boolean;
  kind: TravelKind;
  /** Pixels-per-millisecond at the last sample, for trail tuning. */
  speed: number;
};

const MIN_JOURNEY_MS = 120;
const MAX_JOURNEY_MS = 460;
const HOP_DISTANCE_PX = 96;

/** Distance-scaled travel time. Short hops stay under 180ms; even a full-pane
 * sweep completes in under half a second so the AI never feels slow. */
export function travelDuration(distancePx: number): number {
  if (!Number.isFinite(distancePx) || distancePx <= 0) return MIN_JOURNEY_MS;
  const scaled = 70 + distancePx * 0.42;
  return Math.round(Math.max(MIN_JOURNEY_MS, Math.min(MAX_JOURNEY_MS, scaled)));
}

export function travelKindFor(
  distancePx: number,
  crossesScope: boolean,
): TravelKind {
  if (crossesScope) return "fade";
  if (distancePx < 2) return "stay";
  if (distancePx <= HOP_DISTANCE_PX) return "hop";
  return "journey";
}

/** Exponential-out easing: fast launch, soft landing on the exact glyph. */
export function easeOutExpo(t: number): number {
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -10 * t);
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

type Journey = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: number;
  duration: number;
  kind: TravelKind;
};

/**
 * The travelling body of one actor. Pure: the renderer samples it every frame
 * and paints whatever it reports. Retargeting mid-flight keeps the current
 * interpolated position, so a fast stream of frames never produces a
 * stuttering restart — the body bends toward the new target from wherever it
 * actually is.
 */
export class CursorTravel {
  private x = 0;
  private y = 0;
  private journey: Journey | null = null;
  private placed = false;
  private lastSampleAt = 0;
  private lastX = 0;
  private lastY = 0;
  private speed = 0;

  constructor(private readonly reducedMotion: () => boolean) {}

  /** Current settled position, or null when nothing has been placed yet. */
  get position(): { x: number; y: number } | null {
    return this.placed ? { x: this.x, y: this.y } : null;
  }

  get travelling(): boolean {
    return this.journey !== null;
  }

  get kind(): TravelKind {
    return this.journey?.kind ?? "stay";
  }

  /**
   * Move to a new point. `crossesScope` marks a jump the eye should not follow
   * (another slide/sheet/file): the body fades out and reappears instead of
   * drawing a meaningless straight line across the canvas.
   */
  moveTo(x: number, y: number, now: number, crossesScope = false): void {
    if (this.reducedMotion()) {
      this.journey = null;
      this.x = x;
      this.y = y;
      this.placed = true;
      return;
    }
    if (!this.placed) {
      this.x = x;
      this.y = y;
      this.placed = true;
      return;
    }
    const current = this.sample(now);
    const distance = Math.hypot(x - current.x, y - current.y);
    const kind = travelKindFor(distance, crossesScope);
    if (kind === "stay") {
      // Sub-pixel corrections must not start a visible journey.
      this.x = x;
      this.y = y;
      this.journey = null;
      return;
    }
    this.journey = {
      fromX: current.x,
      fromY: current.y,
      toX: x,
      toY: y,
      startedAt: now,
      duration:
        kind === "fade"
          ? Math.min(300, travelDuration(distance))
          : travelDuration(distance),
      kind,
    };
  }

  /** Interrupt any journey and settle exactly where told. */
  snapTo(x: number, y: number): void {
    this.journey = null;
    this.x = x;
    this.y = y;
    this.placed = true;
  }

  sample(now: number): TravelSample {
    let kind: TravelKind = "stay";
    let progress = 1;
    if (this.journey) {
      const elapsed = now - this.journey.startedAt;
      progress = Math.max(0, Math.min(1, elapsed / this.journey.duration));
      const eased =
        this.journey.kind === "fade"
          ? easeInOutQuad(progress)
          : easeOutExpo(progress);
      this.x =
        this.journey.fromX + (this.journey.toX - this.journey.fromX) * eased;
      this.y =
        this.journey.fromY + (this.journey.toY - this.journey.fromY) * eased;
      kind = this.journey.kind;
      if (progress >= 1) {
        this.x = this.journey.toX;
        this.y = this.journey.toY;
        this.journey = null;
        kind = "stay";
      }
    }
    const dt = this.lastSampleAt ? Math.max(1, now - this.lastSampleAt) : 16;
    const instantaneous =
      Math.hypot(this.x - this.lastX, this.y - this.lastY) / dt;
    // Smooth the speed reading so the trail does not flicker on and off.
    this.speed = this.speed * 0.6 + instantaneous * 0.4;
    this.lastSampleAt = now;
    this.lastX = this.x;
    this.lastY = this.y;
    return {
      x: this.x,
      y: this.y,
      progress,
      travelling: this.journey !== null,
      kind,
      speed: this.speed,
    };
  }

  /** Opacity for a fade journey: dips through the middle of the move. */
  fadeOpacity(sample: TravelSample): number {
    if (sample.kind !== "fade" || !this.journey) return 1;
    const t = sample.progress;
    if (t <= 0 || t >= 1) return 1;
    return Math.max(0, 1 - Math.sin(t * Math.PI) * 1.35);
  }
}

/* ------------------------------------------------------------------ *
 * Comet trail
 * ------------------------------------------------------------------ */

export type TrailPoint = {
  x: number;
  y: number;
  /** 0..1, where 1 is the freshest point. */
  strength: number;
};

/**
 * A short positional memory used to draw the faint comet tail behind a fast
 * journey. It only accrues while the body is genuinely moving quickly, so a
 * working cursor never leaves a permanent smear across the editor.
 */
export class CometTrail {
  private points: Array<{ x: number; y: number; at: number }> = [];

  constructor(
    private readonly maxPoints = 5,
    private readonly lifetimeMs = 260,
  ) {}

  push(x: number, y: number, now: number, active: boolean): void {
    if (!active) {
      if (this.points.length) this.points = [];
      return;
    }
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < 6) return;
    this.points.push({ x, y, at: now });
    if (this.points.length > this.maxPoints) this.points.shift();
  }

  sample(now: number): TrailPoint[] {
    this.points = this.points.filter(
      (point) => now - point.at <= this.lifetimeMs,
    );
    const count = this.points.length;
    return this.points.map((point, index) => ({
      x: point.x,
      y: point.y,
      strength:
        ((index + 1) / Math.max(1, count)) *
        Math.max(0, 1 - (now - point.at) / this.lifetimeMs),
    }));
  }
}
