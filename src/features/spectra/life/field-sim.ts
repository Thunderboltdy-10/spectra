/*
 * The field's lattice: a membrane of dots.
 *
 * Every node sits on a staggered (hex-packed) grid, is pulled home by a spring
 * and is coupled to its six neighbours, so a disturbance travels outward as a
 * ripple, rings, and settles, instead of one dot twitching. Light is a second
 * quantity on the same lattice: it spreads to neighbours and decays.
 *
 * Only an active window of the lattice is simulated: the bounding box of nodes
 * that still carry energy, plus a margin for the wave to travel into. When the
 * window is empty the field is asleep and costs nothing.
 */

export type FieldTuning = {
  /** Distance between neighbouring dots, in CSS px. */
  spacing: number;
  /** Spring pulling each node home (1/s²). */
  home: number;
  /** Coupling to neighbours (1/s²). Sets how fast ripples travel. */
  coupling: number;
  /** Velocity damping (1/s). Sets how long ripples ring. */
  damping: number;
  /** How fast light spreads to neighbours (1/s). */
  diffusion: number;
  /** How fast light fades (1/s). */
  decay: number;
};

export const FULL_TUNING: FieldTuning = {
  spacing: 16,
  home: 34,
  coupling: 760,
  damping: 3.4,
  diffusion: 7,
  decay: 2.1,
};

export const LIGHT_TUNING: FieldTuning = { ...FULL_TUNING, spacing: 22, coupling: 560 };

const SLEEP_ENERGY = 0.02;
const SLEEP_LIGHT = 0.004;

export class FieldLattice {
  readonly cols: number;
  readonly rows: number;
  readonly count: number;
  readonly spacing: number;
  readonly rowHeight: number;
  /** Displacement and velocity, CSS px and px/s. */
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** External force for this step, cleared after each step. */
  readonly fx: Float32Array;
  readonly fy: Float32Array;
  /** Light energy per channel, roughly 0..1. */
  readonly lr: Float32Array;
  readonly lg: Float32Array;
  readonly lb: Float32Array;
  private readonly scratch: Float32Array;
  /** The active window, in grid cells, inclusive. Empty when i0 > i1. */
  i0 = 1;
  i1 = 0;
  j0 = 1;
  j1 = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly tuning: FieldTuning = FULL_TUNING,
  ) {
    this.spacing = tuning.spacing;
    this.rowHeight = (tuning.spacing * Math.sqrt(3)) / 2;
    this.cols = Math.ceil(width / this.spacing) + 2;
    this.rows = Math.ceil(height / this.rowHeight) + 2;
    this.count = this.cols * this.rows;
    const make = () => new Float32Array(this.count);
    this.dx = make();
    this.dy = make();
    this.vx = make();
    this.vy = make();
    this.fx = make();
    this.fy = make();
    this.lr = make();
    this.lg = make();
    this.lb = make();
    this.scratch = new Float32Array(this.count * 3);
  }

  /** The resting position of a node, in CSS px. Row 0 and column 0 sit just off screen. */
  homeX(i: number, j: number) {
    return (i - 1) * this.spacing + (j & 1 ? this.spacing / 2 : 0);
  }

  homeY(j: number) {
    return (j - 1) * this.rowHeight;
  }

  get awake() {
    return this.i0 <= this.i1;
  }

  /** Grows the active window to include a circle, in CSS px. */
  touch(x: number, y: number, radius: number) {
    const margin = 3;
    const i0 = Math.max(0, Math.floor((x - radius) / this.spacing) - margin + 1);
    const i1 = Math.min(this.cols - 1, Math.ceil((x + radius) / this.spacing) + margin + 1);
    const j0 = Math.max(0, Math.floor((y - radius) / this.rowHeight) - margin + 1);
    const j1 = Math.min(this.rows - 1, Math.ceil((y + radius) / this.rowHeight) + margin + 1);
    if (!this.awake) {
      this.i0 = i0;
      this.i1 = i1;
      this.j0 = j0;
      this.j1 = j1;
      return;
    }
    this.i0 = Math.min(this.i0, i0);
    this.i1 = Math.max(this.i1, i1);
    this.j0 = Math.min(this.j0, j0);
    this.j1 = Math.max(this.j1, j1);
  }

  /**
   * Visits every node within `radius` of a point, with its distance and
   * direction. Wakes the area first.
   */
  forEachNear(x: number, y: number, radius: number, visit: (index: number, distance: number, ux: number, uy: number) => void) {
    this.touch(x, y, radius);
    const jFrom = Math.max(0, Math.floor((y - radius) / this.rowHeight) + 1);
    const jTo = Math.min(this.rows - 1, Math.ceil((y + radius) / this.rowHeight) + 1);
    const iFrom = Math.max(0, Math.floor((x - radius) / this.spacing));
    const iTo = Math.min(this.cols - 1, Math.ceil((x + radius) / this.spacing) + 2);
    const r2 = radius * radius;
    for (let j = jFrom; j <= jTo; j += 1) {
      const hy = this.homeY(j);
      for (let i = iFrom; i <= iTo; i += 1) {
        const index = j * this.cols + i;
        const px = this.homeX(i, j) + this.dx[index] - x;
        const py = hy + this.dy[index] - y;
        const d2 = px * px + py * py;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        visit(index, d, d > 1e-3 ? px / d : 0, d > 1e-3 ? py / d : 0);
      }
    }
  }

  /** A radial kick: the start of a ripple. */
  impulse(x: number, y: number, radius: number, speed: number) {
    this.forEachNear(x, y, radius, (index, d, ux, uy) => {
      const falloff = (1 - d / radius) ** 2;
      this.vx[index] += ux * speed * falloff;
      this.vy[index] += uy * speed * falloff;
    });
    // Leave room for the wave to travel.
    this.touch(x, y, radius * 6);
  }

  /** A directional shove, for things moving through the field. */
  push(x: number, y: number, radius: number, vx: number, vy: number, part = 0.6) {
    this.forEachNear(x, y, radius, (index, d, ux, uy) => {
      const falloff = 1 - d / radius;
      // Nodes both part sideways and get carried along a little.
      this.vx[index] += (vx * 0.35 + ux * Math.hypot(vx, vy) * part) * falloff;
      this.vy[index] += (vy * 0.35 + uy * Math.hypot(vx, vy) * part) * falloff;
    });
    this.touch(x, y, radius * 4);
  }

  /** Adds light of a colour (0..1 per channel) around a point. */
  addLight(x: number, y: number, radius: number, r: number, g: number, b: number, amount: number) {
    this.forEachNear(x, y, radius, (index, d) => {
      const falloff = 1 - d / radius;
      const k = amount * falloff * falloff;
      this.lr[index] = Math.min(1.2, this.lr[index] + r * k);
      this.lg[index] = Math.min(1.2, this.lg[index] + g * k);
      this.lb[index] = Math.min(1.2, this.lb[index] + b * k);
    });
  }

  /** Light along the outside of a rectangle: the paper around something glowing. */
  addRectLight(
    left: number,
    top: number,
    width: number,
    height: number,
    reach: number,
    colourAt: (x: number, y: number) => readonly [number, number, number],
    amount: number,
  ) {
    const right = left + width;
    const bottom = top + height;
    const cx = left + width / 2;
    const cy = top + height / 2;
    const radius = Math.hypot(width / 2 + reach, height / 2 + reach);
    this.forEachNear(cx, cy, radius, (index) => {
      const j = Math.floor(index / this.cols);
      const i = index - j * this.cols;
      const x = this.homeX(i, j);
      const y = this.homeY(j);
      const ox = Math.max(left - x, 0, x - right);
      const oy = Math.max(top - y, 0, y - bottom);
      const outside = Math.hypot(ox, oy);
      if (outside > reach) return;
      // Brightest at the edge, fading outward; dim under the thing itself.
      const inside = ox === 0 && oy === 0;
      const k = amount * (inside ? 0.18 : (1 - outside / reach) ** 1.6);
      const [r, g, b] = colourAt(x, y);
      this.lr[index] = Math.min(1.2, this.lr[index] + r * k);
      this.lg[index] = Math.min(1.2, this.lg[index] + g * k);
      this.lb[index] = Math.min(1.2, this.lb[index] + b * k);
    });
  }

  /** Advances the membrane. Returns false once everything has settled. */
  step(dt: number): boolean {
    if (!this.awake) return false;
    const { home, coupling, damping, diffusion, decay } = this.tuning;
    const substeps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / substeps;
    const cols = this.cols;
    const { dx, dy, vx, vy, fx, fy } = this;
    let i0 = this.i0;
    let i1 = this.i1;
    let j0 = this.j0;
    let j1 = this.j1;

    for (let s = 0; s < substeps; s += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const odd = j & 1;
        for (let i = i0; i <= i1; i += 1) {
          const index = j * cols + i;
          let sx = 0;
          let sy = 0;
          let n = 0;
          // Six neighbours on a staggered grid. Missing neighbours are fixed at rest.
          if (i > 0) {
            sx += dx[index - 1];
            sy += dy[index - 1];
          }
          if (i < cols - 1) {
            sx += dx[index + 1];
            sy += dy[index + 1];
          }
          const a = odd ? i : i - 1;
          const b = odd ? i + 1 : i;
          if (j > 0) {
            if (a >= 0) {
              sx += dx[index - cols - i + a];
              sy += dy[index - cols - i + a];
            }
            if (b < cols) {
              sx += dx[index - cols - i + b];
              sy += dy[index - cols - i + b];
            }
          }
          if (j < this.rows - 1) {
            if (a >= 0) {
              sx += dx[index + cols - i + a];
              sy += dy[index + cols - i + a];
            }
            if (b < cols) {
              sx += dx[index + cols - i + b];
              sy += dy[index + cols - i + b];
            }
          }
          n = 6;
          const ax = -home * dx[index] + coupling * (sx - n * dx[index]) - damping * vx[index] + fx[index];
          const ay = -home * dy[index] + coupling * (sy - n * dy[index]) - damping * vy[index] + fy[index];
          vx[index] += ax * h;
          vy[index] += ay * h;
        }
      }
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          const index = j * cols + i;
          dx[index] += vx[index] * h;
          dy[index] += vy[index] * h;
        }
      }
    }

    // Light: spread to neighbours, then fade.
    this.diffuseLight(dt * diffusion, Math.exp(-decay * dt));

    // Shrink the window to what still carries energy, with room to spread.
    let ni0 = Infinity;
    let ni1 = -Infinity;
    let nj0 = Infinity;
    let nj1 = -Infinity;
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const index = j * cols + i;
        fx[index] = 0;
        fy[index] = 0;
        const energy = vx[index] * vx[index] + vy[index] * vy[index] + (dx[index] * dx[index] + dy[index] * dy[index]) * 40;
        const light = this.lr[index] + this.lg[index] + this.lb[index];
        if (energy > SLEEP_ENERGY || light > SLEEP_LIGHT) {
          if (i < ni0) ni0 = i;
          if (i > ni1) ni1 = i;
          if (j < nj0) nj0 = j;
          if (j > nj1) nj1 = j;
        } else {
          dx[index] = 0;
          dy[index] = 0;
          vx[index] = 0;
          vy[index] = 0;
          this.lr[index] = 0;
          this.lg[index] = 0;
          this.lb[index] = 0;
        }
      }
    }
    if (ni0 === Infinity) {
      this.i0 = 1;
      this.i1 = 0;
      this.j0 = 1;
      this.j1 = 0;
      return false;
    }
    const margin = 2;
    i0 = Math.max(0, ni0 - margin);
    i1 = Math.min(cols - 1, ni1 + margin);
    j0 = Math.max(0, nj0 - margin);
    j1 = Math.min(this.rows - 1, nj1 + margin);
    this.i0 = i0;
    this.i1 = i1;
    this.j0 = j0;
    this.j1 = j1;
    return true;
  }

  private diffuseLight(rate: number, keep: number) {
    const k = Math.min(0.5, rate);
    const cols = this.cols;
    const scratch = this.scratch;
    const channels = [this.lr, this.lg, this.lb];
    for (let c = 0; c < 3; c += 1) {
      const light = channels[c];
      const base = c * this.count;
      for (let j = this.j0; j <= this.j1; j += 1) {
        for (let i = this.i0; i <= this.i1; i += 1) {
          const index = j * cols + i;
          const left = i > 0 ? light[index - 1] : 0;
          const right = i < cols - 1 ? light[index + 1] : 0;
          const up = j > 0 ? light[index - cols] : 0;
          const down = j < this.rows - 1 ? light[index + cols] : 0;
          const average = (left + right + up + down) / 4;
          scratch[base + index] = (light[index] + (average - light[index]) * k) * keep;
        }
      }
      for (let j = this.j0; j <= this.j1; j += 1) {
        for (let i = this.i0; i <= this.i1; i += 1) {
          const index = j * cols + i;
          light[index] = scratch[base + index];
        }
      }
    }
  }
}
