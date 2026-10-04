import type { FieldLattice } from "./field-sim";
import { resample, strokeColourAt, type Figure } from "./figure";
import type { Rgb } from "./spectrum";

/*
 * A formation: a figure made of dots.
 *
 * Every stroke of the figure is laid with dots a few pixels apart. A dot
 * rises out of the field (or out of something that broke apart), travels to
 * its place with spring physics and a little curl, and once it sits there it
 * "seats": it reaches toward its seated neighbours until the gaps close and
 * the dots have become the line. Breaking runs the same in reverse: lines
 * part into dots, the dots leave, and sink back into the field.
 *
 * Drawing is one path per colour per stroke, so fused segments never double
 * up where they overlap: a fused figure is a clean line.
 */

export const DOT = 1.9;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Distance between the dots of a stroke, CSS px. */
export const BEAD_SPACING = 3.6;

export const Bead = {
  /** Waiting in the field for its turn. */
  Waiting: 0,
  Moving: 1,
  /** Gone: merged into a neighbour or sunk into the field. */
  Gone: 2,
} as const;

export type FormationPhase = "forming" | "formed" | "breaking" | "fading";

export type Exit =
  /** Each dot sinks into the field where it is. */
  | { kind: "field" }
  /** The dots pour into the field at one place, where a signal leaves from. */
  | { kind: "point"; x: number; y: number; radius: number }
  /** The dots flow straight into something close by and are taken in. */
  | { kind: "into"; x: number; y: number; radius: number };

type StrokeRange = {
  start: number;
  count: number;
  closed: boolean;
  width: number;
  alpha: number;
  spacing: number;
  /** One colour along the whole stroke, so a whole stroke draws as one line. */
  single: boolean;
};

export class Formation {
  readonly n: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  readonly seat: Float32Array;
  readonly delay: Float32Array;
  readonly a: Float32Array;
  readonly ta: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly tr: Float32Array;
  readonly tg: Float32Array;
  readonly tb: Float32Array;
  readonly state: Uint8Array;
  /** The field node a dot came from or sinks into, or -1. */
  readonly node: Int32Array;
  readonly seed: Float32Array;
  /** Seconds a dot stays where it is while its line parts, before it moves. */
  readonly part: Float32Array;
  readonly strokes: StrokeRange[];
  readonly fill: Figure["fill"];
  phase: FormationPhase = "forming";
  opacity = 1;
  hold = false;
  /** A held formation breathes light along its strokes (loading). */
  shimmer = false;
  age = 0;
  formedAt = -1;
  private exit: Exit | null = null;
  private fadeRate = 4;
  /** Set once the formed or gone event has been sent. */
  announcedFormed = false;
  done = false;

  constructor(
    public id: number,
    readonly figure: Figure,
  ) {
    const strokes: StrokeRange[] = [];
    const targets: number[] = [];
    const colours: number[] = [];
    const alphas: number[] = [];
    for (const stroke of figure.strokes) {
      const spacing = stroke.width > 3 ? Math.max(BEAD_SPACING, stroke.width * 0.8) : BEAD_SPACING;
      const points = resample(stroke.points, stroke.closed, spacing);
      const count = points.length / 2;
      strokes.push({
        start: targets.length / 2,
        count,
        closed: stroke.closed,
        width: stroke.width,
        alpha: stroke.alpha,
        spacing,
        single: stroke.colour !== "spectrum" && !stroke.colours,
      });
      for (let k = 0; k < count; k += 1) {
        targets.push(points[k * 2], points[k * 2 + 1]);
        const c = strokeColourAt(stroke, count > 1 ? k / count : 0, k, count);
        colours.push(c[0], c[1], c[2]);
        alphas.push(stroke.alpha);
      }
    }
    this.strokes = strokes;
    this.fill = figure.fill;
    const n = targets.length / 2;
    this.n = n;
    const f = () => new Float32Array(n);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.tx = f();
    this.ty = f();
    this.seat = f();
    this.delay = f();
    this.a = f();
    this.ta = f();
    this.r = f();
    this.g = f();
    this.b = f();
    this.tr = f();
    this.tg = f();
    this.tb = f();
    this.state = new Uint8Array(n);
    this.node = new Int32Array(n).fill(-1);
    this.seed = f();
    this.part = f();
    for (let i = 0; i < n; i += 1) {
      this.tx[i] = targets[i * 2];
      this.ty[i] = targets[i * 2 + 1];
      this.x[i] = this.tx[i];
      this.y[i] = this.ty[i];
      this.tr[i] = colours[i * 3];
      this.tg[i] = colours[i * 3 + 1];
      this.tb[i] = colours[i * 3 + 2];
      this.r[i] = this.tr[i];
      this.g[i] = this.tg[i];
      this.b[i] = this.tb[i];
      this.ta[i] = alphas[i];
      this.seed[i] = Math.random() * 1000;
      this.state[i] = Bead.Moving;
    }
  }

  /** Shows the figure already whole: something on screen that is about to change. */
  showWhole() {
    for (let i = 0; i < this.n; i += 1) {
      this.seat[i] = 1;
      this.a[i] = this.ta[i];
    }
    this.fillLevel = 1;
    this.phase = "formed";
    this.announcedFormed = true;
    this.formedAt = this.age;
  }

  /**
   * Starts every dot in the field and sends it to its place. Dots rise from
   * nodes between their place and `from`, and leave in order of distance
   * from it, so the figure draws itself outward from where its matter arrived.
   */
  riseFrom(lattice: FieldLattice, fromX: number, fromY: number, colour: Rgb, { reach = 0.45, speed = 900, maxReach = 90 } = {}) {
    for (let i = 0; i < this.n; i += 1) {
      const dx = fromX - this.tx[i];
      const dy = fromY - this.ty[i];
      const d = Math.hypot(dx, dy);
      const pull = Math.min(maxReach, d * reach) / (d || 1);
      const ox = this.tx[i] + dx * pull + (Math.random() - 0.5) * 8;
      const oy = this.ty[i] + dy * pull + (Math.random() - 0.5) * 8;
      const node = lattice.nearest(ox, oy);
      const [nx, ny] = lattice.positionOf(node);
      this.x[i] = nx;
      this.y[i] = ny;
      this.vx[i] = 0;
      this.vy[i] = 0;
      this.node[i] = node;
      this.r[i] = colour[0];
      this.g[i] = colour[1];
      this.b[i] = colour[2];
      this.a[i] = 0;
      this.seat[i] = 0;
      this.state[i] = Bead.Waiting;
      this.delay[i] = d / speed + Math.random() * 0.05;
    }
    this.phase = "forming";
  }

  /**
   * Takes its dots from another formation (a morph): each dot of this figure
   * starts where the matching dot of the old one is, so one shape flows into
   * the next. Closed outlines are matched by turning the new one round until
   * the paths line up best.
   */
  takeFrom(source: Formation): Set<number> {
    const pairs = this.matchStrokes(source);
    const used = new Set(pairs.map((pair) => pair[1]));
    for (const [target, from, offset, reverse] of pairs) {
      const t = this.strokes[target];
      const s = source.strokes[from];
      for (let k = 0; k < t.count; k += 1) {
        const i = t.start + k;
        let u = (k / t.count) * s.count;
        if (reverse) u = s.count - 1 - u;
        let m = Math.floor(u + offset * s.count) % s.count;
        if (m < 0) m += s.count;
        const j = s.start + m;
        this.x[i] = source.x[j] + (Math.random() - 0.5) * 0.6;
        this.y[i] = source.y[j] + (Math.random() - 0.5) * 0.6;
        this.vx[i] = source.vx[j];
        this.vy[i] = source.vy[j];
        this.r[i] = source.r[j];
        this.g[i] = source.g[j];
        this.b[i] = source.b[j];
        this.a[i] = source.a[j] * source.opacity;
        this.seat[i] = source.seat[j];
        this.state[i] = Bead.Moving;
        this.delay[i] = 0;
        // Lines part into dots where they are, then the dots fly.
        this.part[i] = source.seat[j] > 0.1 ? 0.07 + Math.random() * 0.05 : 0;
      }
    }
    this.fillLevel = 0;
    this.phase = "forming";
    return used;
  }

  /**
   * Keeps only the given strokes (the rest are gone): what is left of a
   * figure after a morph took some of its lines, about to sink.
   */
  keepOnly(strokes: Set<number>) {
    this.strokes.forEach((range, index) => {
      if (strokes.has(index)) return;
      for (let k = 0; k < range.count; k += 1) this.state[range.start + k] = Bead.Gone;
    });
    // The surface went with the outline.
    this.fillGone = true;
  }

  private fillGone = false;

  /** How much of the fill shows: it comes in only as the outline closes, and goes as it opens. */
  fillLevel = 0;

  private matchStrokes(source: Formation): [number, number, number, boolean][] {
    const pairs: [number, number, number, boolean][] = [];
    this.strokes.forEach((t, index) => {
      // Stroke k takes stroke k's dots; strokes the source lacks take its first (outer) stroke's.
      const from = index < source.strokes.length ? index : 0;
      const s = source.strokes[from];
      let best = { cost: Infinity, offset: 0, reverse: false };
      const offsets = t.closed && s.closed ? 24 : 1;
      for (const reverse of t.closed && s.closed ? [false, true] : [false]) {
        for (let o = 0; o < offsets; o += 1) {
          const offset = o / offsets;
          let cost = 0;
          for (let k = 0; k < t.count; k += Math.max(1, Math.floor(t.count / 24))) {
            let u = (k / t.count) * s.count;
            if (reverse) u = s.count - 1 - u;
            let m = Math.floor(u + offset * s.count) % s.count;
            if (m < 0) m += s.count;
            const j = s.start + m;
            const i = t.start + k;
            cost += (source.x[j] - this.tx[i]) ** 2 + (source.y[j] - this.ty[i]) ** 2;
          }
          if (cost < best.cost) best = { cost, offset, reverse };
        }
      }
      pairs.push([index, from, best.offset, best.reverse]);
    });
    return pairs;
  }

  /** Breaks the figure into dots that leave for `exit`, starting nearest `fromX, fromY`. */
  breakUp(lattice: FieldLattice, exit: Exit, fromX: number, fromY: number, speed = 900) {
    this.exit = exit;
    this.phase = "breaking";
    for (let i = 0; i < this.n; i += 1) {
      if (this.state[i] === Bead.Gone) continue;
      if (this.state[i] === Bead.Waiting) {
        this.state[i] = Bead.Gone;
        continue;
      }
      if (exit.kind === "into") {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * exit.radius;
        this.node[i] = -1;
        this.tx[i] = exit.x + Math.cos(angle) * radius;
        this.ty[i] = exit.y + Math.sin(angle) * radius;
        this.delay[i] = Math.hypot(this.x[i] - fromX, this.y[i] - fromY) / speed + Math.random() * 0.04;
        continue;
      }
      let node: number;
      if (exit.kind === "field") node = lattice.nearest(this.x[i] + (Math.random() - 0.5) * 10, this.y[i] + (Math.random() - 0.5) * 10);
      else {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * exit.radius;
        node = lattice.nearest(exit.x + Math.cos(angle) * radius, exit.y + Math.sin(angle) * radius);
      }
      const [nx, ny] = lattice.positionOf(node);
      this.node[i] = node;
      this.tx[i] = nx;
      this.ty[i] = ny;
      this.delay[i] = Math.hypot(this.x[i] - fromX, this.y[i] - fromY) / speed + Math.random() * 0.04;
    }
  }

  /**
   * Breathes: the figure parts into dots that swell outward from its centre,
   * hold a moment, and come back together. Something received, or a state change.
   */
  scatter(amount: number, hold = 0.14) {
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < this.n; i += 1) {
      cx += this.tx[i];
      cy += this.ty[i];
    }
    cx /= this.n || 1;
    cy /= this.n || 1;
    this.home = Float32Array.from(this.tx);
    this.homeY = Float32Array.from(this.ty);
    for (let i = 0; i < this.n; i += 1) {
      const dx = this.tx[i] - cx;
      const dy = this.ty[i] - cy;
      const d = Math.hypot(dx, dy) || 1;
      const push = amount * (0.55 + Math.random() * 0.9);
      this.tx[i] += (dx / d) * push + (Math.random() - 0.5) * amount * 0.4;
      this.ty[i] += (dy / d) * push + (Math.random() - 0.5) * amount * 0.4;
      this.delay[i] = 0;
    }
    this.scatterLeft = hold + 0.12;
    for (let i = 0; i < this.n; i += 1) this.part[i] = 0.05 + Math.random() * 0.04;
    this.phase = "forming";
    this.announcedFormed = false;
  }

  private home: Float32Array | null = null;
  private homeY: Float32Array | null = null;
  private scatterLeft = 0;

  /** The colour the dots take on as they leave: the light they become. */
  tintTo(colourAt: (x: number, y: number) => Rgb) {
    for (let i = 0; i < this.n; i += 1) {
      const [r, g, b] = colourAt(this.x[i], this.y[i]);
      this.tr[i] = r;
      this.tg[i] = g;
      this.tb[i] = b;
    }
  }

  /** Fades the whole figure out (the real element has taken over). */
  fade(rate = 4) {
    if (this.phase === "breaking") return;
    this.phase = "fading";
    this.fadeRate = rate;
  }

  /** Sinks into the field. Returns the number of dots that sank this step. */
  step(dt: number, time: number, lattice: FieldLattice): number {
    this.age += dt;
    let sank = 0;
    if (this.phase === "fading") {
      this.opacity -= dt * this.fadeRate;
      if (this.opacity <= 0) {
        this.opacity = 0;
        this.done = true;
      }
      return 0;
    }
    if (this.scatterLeft > 0) {
      this.scatterLeft -= dt;
      if (this.scatterLeft <= 0 && this.home && this.homeY) {
        this.tx.set(this.home);
        this.ty.set(this.homeY);
        this.home = null;
        this.homeY = null;
      }
    }
    const breaking = this.phase === "breaking";
    let pending = 0;
    let seated = 0;
    let live = 0;
    for (let i = 0; i < this.n; i += 1) {
      const state = this.state[i];
      if (state === Bead.Gone) continue;
      live += 1;
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        pending += 1;
        if (!breaking) continue;
        // Still whole while it waits its turn to break.
        seated += 1;
        continue;
      }
      if (state === Bead.Waiting) {
        // Its turn: the dot lifts out of the field.
        this.state[i] = Bead.Moving;
        if (this.node[i] >= 0) lattice.lend(this.node[i], this.r[i] / 255, this.g[i] / 255, this.b[i] / 255, 0.16);
      }
      if (!breaking && this.part[i] > 0) {
        this.part[i] -= dt;
        this.seat[i] = Math.max(0, this.seat[i] - dt * 12);
        pending += 1;
        continue;
      }
      const dx = this.tx[i] - this.x[i];
      const dy = this.ty[i] - this.y[i];
      const distance = Math.hypot(dx, dy);
      if (breaking) {
        // Lines part first, then the dot leaves.
        this.seat[i] = Math.max(0, this.seat[i] - dt * 9);
        if (this.seat[i] > 0.15) {
          seated += 1;
          continue;
        }
        if (distance < (this.exit?.kind === "into" ? 3 : 1.6)) {
          this.state[i] = Bead.Gone;
          sank += 1;
          if (this.node[i] < 0) continue;
          lattice.receive(this.node[i], this.r[i] / 255, this.g[i] / 255, this.b[i] / 255, 0.2 * this.a[i] + 0.04, 6);
          continue;
        }
        this.ta[i] = Math.max(this.ta[i], 0.5);
      }
      // Curl-like noise so paths are organic; it fades as the dot nears its place.
      const s = this.seed[i];
      const nx = Math.sin(this.y[i] * 0.02 + time * 1.3 + s) + Math.sin(this.y[i] * 0.007 - time * 0.6 + s * 0.3) * 0.6;
      const ny = Math.cos(this.x[i] * 0.018 - time * 1.1 + s) + Math.cos(this.x[i] * 0.008 + time * 0.5 + s * 0.7) * 0.6;
      const wander = Math.min(1, distance / 40) * (breaking ? 60 : 120);
      const stiffness = breaking ? 110 : 130;
      const damping = 2 * 0.86 * Math.sqrt(stiffness);
      this.vx[i] += (dx * stiffness - this.vx[i] * damping + nx * wander) * dt;
      this.vy[i] += (dy * stiffness - this.vy[i] * damping + ny * wander) * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      if (!breaking) {
        // A dot reaches for its neighbours as it arrives, so the line grows
        // out of the dots continuously rather than appearing once they stop.
        const speed = Math.hypot(this.vx[i], this.vy[i]);
        const near = 1 - smooth(1, 7, distance);
        const goal = near * (1 - smooth(60, 220, speed));
        const cap = distance < 1.5 ? 1 : goal;
        if (cap > this.seat[i]) this.seat[i] = Math.min(cap, this.seat[i] + dt * 7);
        else this.seat[i] = Math.max(goal, this.seat[i] - dt * 10);
        if (this.seat[i] > 0.4) {
          // Seated dots lock onto their place, so fused lines are exact.
          const lock = Math.min(1, this.seat[i] * 14 * dt);
          this.x[i] += (this.tx[i] - this.x[i]) * lock;
          this.y[i] += (this.ty[i] - this.y[i]) * lock;
        }
        if (this.seat[i] >= 0.999) seated += 1;
      }
      const tint = Math.min(1, dt * (breaking ? 6 : 2.5 + 9 * this.seat[i]));
      this.r[i] += (this.tr[i] - this.r[i]) * tint;
      this.g[i] += (this.tg[i] - this.g[i]) * tint;
      this.b[i] += (this.tb[i] - this.b[i]) * tint;
      this.a[i] += (this.ta[i] - this.a[i]) * Math.min(1, 7 * dt);
    }
    const whole = this.wholeness();
    const fillGoal = this.fillGone ? 0 : !breaking && pending === 0 && this.scatterLeft <= 0 ? smooth(0.5, 1, whole) : breaking ? Math.min(this.fillLevel, whole) : 0;
    this.fillLevel += (fillGoal - this.fillLevel) * Math.min(1, dt * 10);
    if (breaking) {
      if (live === 0) this.done = true;
      return sank;
    }
    if (this.phase === "forming" && pending === 0 && seated >= live && this.scatterLeft <= 0) {
      this.phase = "formed";
      this.formedAt = this.age;
      for (let i = 0; i < this.n; i += 1) {
        this.x[i] = this.tx[i];
        this.y[i] = this.ty[i];
      }
    }
    return sank;
  }

  /** How whole the figure is, 0..1: the fill and line width follow it. */
  wholeness() {
    let total = 0;
    let count = 0;
    for (let i = 0; i < this.n; i += 1) {
      if (this.state[i] === Bead.Gone) continue;
      count += 1;
      if (this.delay[i] > 0 && this.phase !== "breaking") continue;
      total += this.seat[i];
    }
    return count ? total / count : 0;
  }

  /** Where the dots are, for drawing: visits each stroke's visible dots with their seated neighbours. */
  forEachStroke(visit: (range: StrokeRange) => void) {
    for (const range of this.strokes) visit(range);
  }

  visible(i: number) {
    return this.state[i] !== Bead.Gone && !(this.state[i] === Bead.Waiting) && !(this.delay[i] > 0 && this.phase === "forming");
  }
}
