/*
 * Free particles: dots that have left the lattice to travel, flow or form a
 * shape. They follow targets with spring physics plus a little curl noise, so
 * paths are organic, never straight lines, and they return to the lattice as
 * light when they are done.
 */

export const Mode = {
  Dead: 0,
  /** Loose: damped motion with curl noise, fading out. */
  Drift: 1,
  /** Following a fixed target point, then holding there. */
  Seek: 2,
  /** Travelling along a curve to a destination. */
  Stream: 3,
  /** Drawn into a target and taken in at its edge (`life` holds the radius). */
  Absorb: 4,
} as const;

export type ParticleColour = readonly [number, number, number];

/** A formation or a set of dissolved points: x, y, r, g, b, a per point (CSS px, 0..255, 0..1). */
export type PointSet = Float32Array;
export const POINT_STRIDE = 6;

export type Landing = (x: number, y: number, r: number, g: number, b: number) => void;

export class Particles {
  readonly capacity: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  /** Colour the particle is turning into. */
  readonly tr: Float32Array;
  readonly tg: Float32Array;
  readonly tb: Float32Array;
  /** Current and target opacity. */
  readonly a: Float32Array;
  readonly ta: Float32Array;
  /** Dot size in CSS px. */
  readonly size: Float32Array;
  /** Seconds left (drift) or seconds before starting (stream, seek). */
  readonly life: Float32Array;
  readonly delay: Float32Array;
  readonly mode: Uint8Array;
  readonly group: Int32Array;
  readonly seed: Float32Array;
  /** Stream curves: start, control and end points, progress and duration. */
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  readonly cx: Float32Array;
  readonly cy: Float32Array;
  readonly ex: Float32Array;
  readonly ey: Float32Array;
  readonly progress: Float32Array;
  readonly duration: Float32Array;
  live = 0;
  private free: number[] = [];
  private noiseTime = 0;
  /** Called where a particle returns to the field, so the lattice can take its light. */
  onReturn: Landing | null = null;
  /** Called when a streaming particle arrives. */
  onArrive: ((group: number, x: number, y: number) => void) | null = null;
  /** Called when a particle is taken in by its target. */
  onAbsorb: ((group: number, x: number, y: number) => void) | null = null;

  constructor(capacity: number) {
    this.capacity = capacity;
    const f = () => new Float32Array(capacity);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.tx = f();
    this.ty = f();
    this.r = f();
    this.g = f();
    this.b = f();
    this.tr = f();
    this.tg = f();
    this.tb = f();
    this.a = f();
    this.ta = f();
    this.size = f();
    this.life = f();
    this.delay = f();
    this.mode = new Uint8Array(capacity);
    this.group = new Int32Array(capacity);
    this.seed = f();
    this.sx = f();
    this.sy = f();
    this.cx = f();
    this.cy = f();
    this.ex = f();
    this.ey = f();
    this.progress = f();
    this.duration = f();
    for (let i = capacity - 1; i >= 0; i -= 1) this.free.push(i);
  }

  spawn(x: number, y: number, colour: ParticleColour, alpha: number, group = 0): number {
    const index = this.free.pop();
    if (index === undefined) return -1;
    this.live += 1;
    this.x[index] = x;
    this.y[index] = y;
    this.vx[index] = 0;
    this.vy[index] = 0;
    this.tx[index] = x;
    this.ty[index] = y;
    this.r[index] = colour[0];
    this.g[index] = colour[1];
    this.b[index] = colour[2];
    this.tr[index] = colour[0];
    this.tg[index] = colour[1];
    this.tb[index] = colour[2];
    this.a[index] = 0;
    this.ta[index] = alpha;
    this.size[index] = 1.5;
    this.life[index] = 1;
    this.delay[index] = 0;
    this.mode[index] = Mode.Drift;
    this.group[index] = group;
    this.seed[index] = Math.random() * 1000;
    return index;
  }

  kill(index: number) {
    if (this.mode[index] === Mode.Dead) return;
    this.mode[index] = Mode.Dead;
    this.a[index] = 0;
    this.live -= 1;
    this.free.push(index);
  }

  /** Lets a particle go: it drifts, fades and returns its light to the field. */
  release(index: number, life = 0.9 + Math.random() * 0.6) {
    if (this.mode[index] === Mode.Dead) return;
    this.mode[index] = Mode.Drift;
    this.life[index] = life;
    this.ta[index] = 0;
    this.group[index] = 0;
  }

  /** All live particles in a group. */
  members(group: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.capacity; i += 1) if (this.mode[i] !== Mode.Dead && this.group[i] === group) out.push(i);
    return out;
  }

  step(dt: number) {
    this.noiseTime += dt;
    const t = this.noiseTime;
    for (let i = 0; i < this.capacity; i += 1) {
      const mode = this.mode[i];
      if (mode === Mode.Dead) continue;
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        continue;
      }
      // Curl-like noise from two rotated sine fields: cheap and divergence-light.
      const s = this.seed[i];
      const px = this.x[i] * 0.012;
      const py = this.y[i] * 0.012;
      const nx = Math.sin(py * 1.7 + t * 0.9 + s) + Math.sin(py * 0.6 - t * 0.5 + s * 0.3) * 0.6;
      const ny = Math.cos(px * 1.5 - t * 0.8 + s) + Math.cos(px * 0.7 + t * 0.4 + s * 0.7) * 0.6;

      if (mode === Mode.Drift) {
        this.vx[i] += nx * 28 * dt;
        this.vy[i] += ny * 28 * dt;
        const keep = Math.exp(-2.4 * dt);
        this.vx[i] *= keep;
        this.vy[i] *= keep;
        this.life[i] -= dt;
        if (this.life[i] <= 0) {
          this.onReturn?.(this.x[i], this.y[i], this.r[i], this.g[i], this.b[i]);
          this.kill(i);
          continue;
        }
        this.ta[i] = 0;
      } else if (mode === Mode.Seek) {
        const ddx = this.tx[i] - this.x[i];
        const ddy = this.ty[i] - this.y[i];
        const distance = Math.hypot(ddx, ddy);
        const wander = Math.min(1, distance / 60);
        const stiffness = 42;
        const damping = 2 * 0.82 * Math.sqrt(stiffness);
        this.vx[i] += (ddx * stiffness - this.vx[i] * damping + nx * 90 * wander) * dt;
        this.vy[i] += (ddy * stiffness - this.vy[i] * damping + ny * 90 * wander) * dt;
      } else if (mode === Mode.Absorb) {
        const ddx = this.tx[i] - this.x[i];
        const ddy = this.ty[i] - this.y[i];
        const distance = Math.hypot(ddx, ddy);
        if (distance < this.life[i]) {
          this.onAbsorb?.(this.group[i], this.x[i], this.y[i]);
          this.kill(i);
          continue;
        }
        // Accelerates inward, like falling in.
        const pull = 900 + 26000 / (distance + 20);
        this.vx[i] += ((ddx / distance) * pull - this.vx[i] * 4 + nx * 40) * dt;
        this.vy[i] += ((ddy / distance) * pull - this.vy[i] * 4 + ny * 40) * dt;
      } else if (mode === Mode.Stream) {
        const duration = this.duration[i];
        const p = Math.min(1, this.progress[i] + dt / duration);
        this.progress[i] = p;
        // Ease in and out along the curve; the particle chases a point on it.
        const e = p * p * (3 - 2 * p);
        const u = 1 - e;
        const qx = u * u * this.sx[i] + 2 * u * e * this.cx[i] + e * e * this.ex[i];
        const qy = u * u * this.sy[i] + 2 * u * e * this.cy[i] + e * e * this.ey[i];
        const sway = Math.sin(p * Math.PI) * 10;
        const tx = qx + nx * sway;
        const ty = qy + ny * sway;
        const stiffness = 160;
        const damping = 2 * 0.9 * Math.sqrt(stiffness);
        this.vx[i] += ((tx - this.x[i]) * stiffness - this.vx[i] * damping) * dt;
        this.vy[i] += ((ty - this.y[i]) * stiffness - this.vy[i] * damping) * dt;
        if (p >= 1) {
          this.onArrive?.(this.group[i], this.ex[i], this.ey[i]);
          this.release(i, 0.25 + Math.random() * 0.25);
          this.vx[i] *= 0.2;
          this.vy[i] *= 0.2;
        }
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      const tint = Math.min(1, 4 * dt);
      this.r[i] += (this.tr[i] - this.r[i]) * tint;
      this.g[i] += (this.tg[i] - this.g[i]) * tint;
      this.b[i] += (this.tb[i] - this.b[i]) * tint;
      const fade = this.ta[i] > this.a[i] ? 7 : mode === Mode.Drift ? 2.6 : 5;
      this.a[i] += (this.ta[i] - this.a[i]) * Math.min(1, fade * dt);
    }
  }

  /** Starts a particle travelling along a curve from where it is to a point. */
  streamTo(index: number, ex: number, ey: number, bend: number, duration: number, delay: number) {
    const sx = this.x[index];
    const sy = this.y[index];
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;
    const dx = ex - sx;
    const dy = ey - sy;
    const length = Math.hypot(dx, dy) || 1;
    // The control point bends the path to one side, like something thrown.
    this.cx[index] = mx - (dy / length) * bend;
    this.cy[index] = my + (dx / length) * bend;
    this.sx[index] = sx;
    this.sy[index] = sy;
    this.ex[index] = ex;
    this.ey[index] = ey;
    this.progress[index] = 0;
    this.duration[index] = duration;
    this.delay[index] = delay;
    this.mode[index] = Mode.Stream;
  }

  /** Draws a particle into a point; it is taken in once within `radius`. */
  absorbInto(index: number, tx: number, ty: number, radius: number, delay = 0) {
    this.tx[index] = tx;
    this.ty[index] = ty;
    this.life[index] = radius;
    this.delay[index] = delay;
    this.mode[index] = Mode.Absorb;
  }

  seek(index: number, tx: number, ty: number, alpha: number, delay = 0) {
    this.tx[index] = tx;
    this.ty[index] = ty;
    this.ta[index] = alpha;
    this.delay[index] = delay;
    this.mode[index] = Mode.Seek;
  }

  /** How many of a group's seeking particles have reached their targets, 0..1. */
  arrival(group: number) {
    let total = 0;
    let arrived = 0;
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.mode[i] !== Mode.Seek || this.group[i] !== group) continue;
      total += 1;
      if (Math.abs(this.tx[i] - this.x[i]) + Math.abs(this.ty[i] - this.y[i]) < 1.5) arrived += 1;
    }
    return total === 0 ? 1 : arrived / total;
  }
}
