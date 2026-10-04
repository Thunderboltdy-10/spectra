import { FieldLattice, FULL_TUNING, LIGHT_TUNING } from "./field-sim";
import { Mode, POINT_STRIDE, Particles, type PointSet } from "./particles";
import { spectrumAt, type Rgb } from "./spectrum";

/*
 * The life engine: the lattice, the free particles, and how events move them.
 *
 * It owns no thread. The same engine runs in a Web Worker on OffscreenCanvas
 * (the normal case) or on the main thread when OffscreenCanvas is missing.
 * Hosts send it commands and give it a way to schedule frames; it sleeps as
 * soon as nothing carries energy, so at rest it costs nothing.
 *
 * Two canvases: the back layer, under the interface, holds the lattice; the
 * front layer, above it, holds only free particles.
 */

export type LifeTier = "full" | "light";

export type Rect = { x: number; y: number; width: number; height: number };

/** A colour for light: an sRGB triple, or the spectrum flowing across the area. */
export type LightColour = Rgb | "spectrum";

export type LifeCommand =
  | { type: "resize"; width: number; height: number; ratio: number }
  | { type: "theme"; dark: boolean; ink: Rgb }
  | { type: "pointer"; x: number; y: number; inside: boolean }
  | { type: "pulse"; x: number; y: number; strength: number; colour?: LightColour }
  | { type: "wake"; x: number; y: number; vx: number; vy: number; colour?: Rgb }
  | { type: "glow"; id: number; rect: Rect; colour: LightColour; intensity: number }
  | { type: "glowMove"; id: number; rect: Rect }
  | { type: "glowStop"; id: number }
  | { type: "gather"; id: number; points: PointSet; around: Rect }
  | { type: "release"; id: number }
  | { type: "stream"; id: number; from: Rect; to: Rect; count: number; colour: LightColour }
  | { type: "dissolve"; id: number; points: PointSet; vx: number; vy: number; spread: number }
  | { type: "condense"; id: number; from: number; points: PointSet; around: Rect; duration: number }
  | {
      type: "emit";
      x: number;
      y: number;
      dx: number;
      dy: number;
      spread: number;
      count: number;
      colour: LightColour;
    };

export type LifeEvent = { type: "settled"; id: number } | { type: "asleep" } | { type: "awake" };

export type LifeSurface = {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
};

type Glow = { rect: Rect; colour: LightColour; intensity: number; age: number };
type Pending = { group: number; deadline: number; kind: "condense" | "stream"; total: number; arrived: number };

const REVEAL_RADIUS = 120;
const POINTER_RADIUS = 44;

export class LifeEngine {
  private lattice: FieldLattice;
  private particles: Particles;
  private width = 0;
  private height = 0;
  private ratio = 1;
  private ink: Rgb = [20, 19, 24];
  private dark = false;
  private pointer = { x: -1e4, y: -1e4, inside: false, reveal: 0, lastX: -1e4, lastY: -1e4, speed: 0 };
  private glows = new Map<number, Glow>();
  private pending = new Map<number, Pending>();
  private time = 0;
  private running = false;
  private last = 0;
  private styleCache = new Map<number, string>();
  private buckets = new Map<number, number[]>();

  constructor(
    private back: LifeSurface,
    private front: LifeSurface,
    private readonly tier: LifeTier,
    private readonly emit: (event: LifeEvent) => void,
    private readonly schedule: (frame: (now: number) => void) => void,
    private readonly now: () => number,
  ) {
    this.lattice = new FieldLattice(1, 1, tier === "full" ? FULL_TUNING : LIGHT_TUNING);
    this.particles = new Particles(tier === "full" ? 1500 : 400);
    this.wireParticles();
  }

  private wireParticles() {
    this.particles.onReturn = (x, y, r, g, b) => {
      // A particle going home leaves a breath of its light in the lattice.
      this.lattice.addLight(x, y, this.lattice.spacing * 1.4, r / 255, g / 255, b / 255, 0.1);
    };
    this.particles.onArrive = (group, x, y) => {
      const pending = this.pending.get(group);
      if (!pending) return;
      pending.arrived += 1;
      if (pending.arrived === 1) this.lattice.impulse(x, y, 30, 60);
    };
  }

  handle(command: LifeCommand) {
    switch (command.type) {
      case "resize":
        this.resize(command.width, command.height, command.ratio);
        return;
      case "theme":
        this.dark = command.dark;
        this.ink = command.ink;
        this.styleCache.clear();
        return;
      case "pointer": {
        const p = this.pointer;
        const moved = Math.hypot(command.x - p.x, command.y - p.y);
        p.x = command.x;
        p.y = command.y;
        p.inside = command.inside;
        p.speed = Math.min(2000, p.speed * 0.6 + moved * 30);
        if (command.inside && moved > 0.5) p.reveal = 1;
        break;
      }
      case "pulse": {
        const strength = command.strength;
        this.lattice.impulse(command.x, command.y, 30 + 26 * strength, 170 * strength);
        if (command.colour) {
          const [r, g, b] = this.colourAt(command.colour, command.x, command.y);
          this.lattice.addLight(command.x, command.y, 36 + 30 * strength, r, g, b, 0.55 * strength);
        }
        break;
      }
      case "wake": {
        const speed = Math.hypot(command.vx, command.vy);
        this.lattice.push(command.x, command.y, 34, command.vx * 0.5, command.vy * 0.5, 0.5);
        // A faint wake of dots trails anything moving fast enough.
        const count = speed > 120 ? Math.min(3, Math.floor(speed / 400) + 1) : 0;
        for (let i = 0; i < count; i += 1) {
          const colour = command.colour ?? this.ink;
          const index = this.particles.spawn(
            command.x + (Math.random() - 0.5) * 14,
            command.y + (Math.random() - 0.5) * 14,
            colour,
            this.dark ? 0.4 : 0.32,
          );
          if (index < 0) break;
          this.particles.vx[index] = -command.vx * 0.12 + (Math.random() - 0.5) * 30;
          this.particles.vy[index] = -command.vy * 0.12 + (Math.random() - 0.5) * 30;
          this.particles.ta[index] = this.dark ? 0.4 : 0.32;
          this.particles.life[index] = 0.45 + Math.random() * 0.3;
        }
        break;
      }
      case "glow":
        this.glows.set(command.id, { rect: command.rect, colour: command.colour, intensity: command.intensity, age: 0 });
        break;
      case "glowMove": {
        const glow = this.glows.get(command.id);
        if (glow) glow.rect = command.rect;
        break;
      }
      case "glowStop":
        this.glows.delete(command.id);
        break;
      case "gather":
        this.gather(command.id, command.points, command.around);
        break;
      case "release":
        for (const index of this.particles.members(command.id)) this.particles.release(index);
        this.pending.delete(command.id);
        break;
      case "stream":
        this.stream(command);
        break;
      case "dissolve":
        this.dissolve(command);
        break;
      case "condense":
        this.condense(command);
        break;
      case "emit":
        this.emitParticles(command);
        break;
    }
    this.wakeUp();
  }

  private resize(width: number, height: number, ratio: number) {
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    for (const surface of [this.back, this.front]) {
      surface.canvas.width = Math.max(1, Math.round(width * ratio));
      surface.canvas.height = Math.max(1, Math.round(height * ratio));
    }
    this.lattice = new FieldLattice(width, height, this.lattice.tuning);
  }

  private colourAt(colour: LightColour, x: number, y: number): [number, number, number] {
    if (colour === "spectrum") {
      const c = spectrumAt((x + y * 0.35) / 700 + this.time * 0.07);
      return [c[0] / 255, c[1] / 255, c[2] / 255];
    }
    return [colour[0] / 255, colour[1] / 255, colour[2] / 255];
  }

  private rgbAt(colour: LightColour, x: number, y: number): Rgb {
    if (colour === "spectrum") return spectrumAt((x + y * 0.35) / 700 + this.time * 0.07);
    return colour;
  }

  /** A lattice node near a point, as a starting place for a particle leaving the field. */
  private fieldOrigin(x: number, y: number, scatter: number): [number, number] {
    const s = this.lattice.spacing;
    const h = this.lattice.rowHeight;
    const px = x + (Math.random() - 0.5) * scatter * 2;
    const py = y + (Math.random() - 0.5) * scatter * 2;
    const j = Math.round(py / h);
    const offset = j & 1 ? s / 2 : 0;
    const i = Math.round((px - offset) / s);
    return [i * s + offset, j * h];
  }

  private gather(group: number, points: PointSet, around: Rect) {
    const count = points.length / POINT_STRIDE;
    const scatter = Math.max(around.width, around.height) / 2 + 60;
    const cx = around.x + around.width / 2;
    const cy = around.y + around.height / 2;
    for (let k = 0; k < count; k += 1) {
      const o = k * POINT_STRIDE;
      const [sx, sy] = this.fieldOrigin(cx, cy, scatter);
      const index = this.particles.spawn(sx, sy, [points[o + 2], points[o + 3], points[o + 4]], 0, group);
      if (index < 0) break;
      this.particles.size[index] = 1.4;
      this.particles.seek(index, points[o], points[o + 1], points[o + 5], Math.random() * 0.22);
    }
  }

  private stream(command: Extract<LifeCommand, { type: "stream" }>) {
    const { from, to, count, id } = command;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    for (let k = 0; k < count; k += 1) {
      const sx = from.x + Math.random() * from.width;
      const sy = from.y + Math.random() * from.height;
      const colour = this.rgbAt(command.colour, sx, sy);
      const index = this.particles.spawn(sx, sy, colour, this.dark ? 0.85 : 0.7, id);
      if (index < 0) break;
      this.particles.a[index] = 0.2;
      this.particles.size[index] = 1.6 + Math.random() * 0.6;
      const ex = to.x + to.width * (0.2 + Math.random() * 0.6);
      const ey = to.y + to.height * (0.2 + Math.random() * 0.6);
      const bend = distance * (0.18 + Math.random() * 0.14) * (Math.random() < 0.85 ? 1 : -1);
      this.particles.streamTo(index, ex, ey, bend, 0.62 + Math.random() * 0.32, (k / count) * 0.28);
    }
    this.pending.set(id, { group: id, deadline: this.time + 2.2, kind: "stream", total: count, arrived: 0 });
  }

  private dissolve(command: Extract<LifeCommand, { type: "dissolve" }>) {
    const { points, id } = command;
    const count = points.length / POINT_STRIDE;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < count; k += 1) {
      cx += points[k * POINT_STRIDE];
      cy += points[k * POINT_STRIDE + 1];
    }
    cx /= count || 1;
    cy /= count || 1;
    for (let k = 0; k < count; k += 1) {
      const o = k * POINT_STRIDE;
      const x = points[o];
      const y = points[o + 1];
      const index = this.particles.spawn(x, y, [points[o + 2], points[o + 3], points[o + 4]], points[o + 5], id);
      if (index < 0) break;
      this.particles.a[index] = points[o + 5];
      this.particles.size[index] = 1.7;
      const dx = x - cx;
      const dy = y - cy;
      const length = Math.hypot(dx, dy) || 1;
      const burst = command.spread * (0.4 + Math.random() * 0.6);
      this.particles.vx[index] = command.vx + (dx / length) * burst + (Math.random() - 0.5) * 20;
      this.particles.vy[index] = command.vy + (dy / length) * burst + (Math.random() - 0.5) * 20;
      // Dissolved matter lingers long enough to be condensed into something else.
      this.particles.life[index] = 1.4 + Math.random() * 0.6;
      this.particles.ta[index] = points[o + 5] * 0.85;
      this.particles.mode[index] = Mode.Drift;
    }
  }

  private condense(command: Extract<LifeCommand, { type: "condense" }>) {
    const { points, id, from, around } = command;
    const targets = points.length / POINT_STRIDE;
    const source = from ? this.particles.members(from) : [];
    // Pair particles and targets in the same spatial order, so the matter
    // flows coherently instead of criss-crossing.
    const keyed = source
      .map((index) => ({ index, key: this.particles.x[index] * 0.6 + this.particles.y[index] }))
      .sort((a, b) => a.key - b.key);
    const targetOrder = Array.from({ length: targets }, (_, k) => k).sort(
      (a, b) => points[a * POINT_STRIDE] * 0.6 + points[a * POINT_STRIDE + 1] - (points[b * POINT_STRIDE] * 0.6 + points[b * POINT_STRIDE + 1]),
    );
    const scatter = Math.max(around.width, around.height) / 2 + 50;
    const cx = around.x + around.width / 2;
    const cy = around.y + around.height / 2;
    const used = new Set<number>();
    for (let n = 0; n < targets; n += 1) {
      const k = targetOrder[n];
      const o = k * POINT_STRIDE;
      let index: number;
      if (keyed.length) {
        // Each target takes the source dot at the same place in the order.
        // When the target needs more dots than the source had, the extras
        // split off that dot, so all the matter flows out of what dissolved.
        const parent = keyed[Math.floor((n * keyed.length) / targets)].index;
        if (!used.has(parent)) {
          used.add(parent);
          index = parent;
          this.particles.group[index] = id;
        } else {
          index = this.particles.spawn(
            this.particles.x[parent] + (Math.random() - 0.5) * 4,
            this.particles.y[parent] + (Math.random() - 0.5) * 4,
            [this.particles.r[parent], this.particles.g[parent], this.particles.b[parent]],
            0,
            id,
          );
          if (index < 0) break;
          this.particles.vx[index] = this.particles.vx[parent];
          this.particles.vy[index] = this.particles.vy[parent];
        }
      } else {
        const [sx, sy] = this.fieldOrigin(cx, cy, scatter);
        index = this.particles.spawn(sx, sy, [points[o + 2], points[o + 3], points[o + 4]], 0, id);
        if (index < 0) break;
      }
      this.particles.tr[index] = points[o + 2];
      this.particles.tg[index] = points[o + 3];
      this.particles.tb[index] = points[o + 4];
      this.particles.size[index] = 1.6;
      this.particles.seek(index, points[o], points[o + 1], points[o + 5], (n / targets) * 0.12);
    }
    // Source dots the target didn't need go home.
    for (const { index } of keyed) if (!used.has(index)) this.particles.release(index);
    this.pending.set(id, { group: id, deadline: this.time + command.duration, kind: "condense", total: targets, arrived: 0 });
  }

  private emitParticles(command: Extract<LifeCommand, { type: "emit" }>) {
    const length = Math.hypot(command.dx, command.dy) || 1;
    const ux = command.dx / length;
    const uy = command.dy / length;
    for (let k = 0; k < command.count; k += 1) {
      const t = Math.random();
      const angle = (t - 0.5) * command.spread;
      const vx = (ux * Math.cos(angle) - uy * Math.sin(angle)) * (40 + Math.random() * 50);
      const vy = (ux * Math.sin(angle) + uy * Math.cos(angle)) * (40 + Math.random() * 50);
      const colour: Rgb = command.colour === "spectrum" ? spectrumAt(t * 0.84) : command.colour;
      const index = this.particles.spawn(command.x, command.y, colour, this.dark ? 0.7 : 0.55);
      if (index < 0) break;
      this.particles.vx[index] = vx;
      this.particles.vy[index] = vy;
      this.particles.size[index] = 1.3 + Math.random() * 0.7;
      this.particles.life[index] = 1.1 + Math.random() * 0.9;
      this.particles.ta[index] = this.dark ? 0.7 : 0.55;
    }
  }

  private wakeUp() {
    if (this.running) return;
    this.running = true;
    this.last = this.now();
    this.emit({ type: "awake" });
    this.schedule(this.frame);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(1 / 30, Math.max(1 / 240, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    const alive = this.update(dt);
    this.draw();
    if (alive) {
      this.schedule(this.frame);
      return;
    }
    this.running = false;
    this.clear();
    this.emit({ type: "asleep" });
  };

  private update(dt: number) {
    const p = this.pointer;
    p.speed *= Math.exp(-6 * dt);
    if (p.inside && p.speed > 60) {
      // The pointer parts the grain as it moves through open paper.
      this.lattice.forEachNear(p.x, p.y, POINTER_RADIUS, (index, d, ux, uy) => {
        const k = (1 - d / POINTER_RADIUS) * Math.min(1, p.speed / 900) * 1600;
        this.lattice.fx[index] += ux * k;
        this.lattice.fy[index] += uy * k;
      });
    }
    if (!p.inside || p.speed < 30) p.reveal *= Math.exp(-2.2 * dt);
    if (p.reveal < 0.01) p.reveal = 0;

    for (const [id, glow] of this.glows) {
      glow.age += dt;
      const rise = Math.min(1, glow.age / 0.35);
      const { x, y, width, height } = glow.rect;
      this.lattice.addRectLight(
        x,
        y,
        width,
        height,
        56,
        (px, py) => this.colourAt(glow.colour, px, py),
        glow.intensity * rise * dt * 5,
      );
      void id;
    }

    const latticeAwake = this.lattice.step(dt);
    this.particles.step(dt);

    for (const [id, pending] of this.pending) {
      const done =
        pending.kind === "condense"
          ? this.particles.arrival(pending.group) > 0.9 || this.time >= pending.deadline
          : pending.arrived >= pending.total * 0.9 || this.time >= pending.deadline;
      if (!done) continue;
      this.pending.delete(id);
      this.emit({ type: "settled", id });
      if (pending.kind === "condense") {
        // The real element takes over; its matter fades into it.
        for (const index of this.particles.members(pending.group)) this.particles.release(index, 0.18 + Math.random() * 0.12);
      }
    }

    return latticeAwake || this.particles.live > 0 || this.glows.size > 0 || p.reveal > 0 || this.pending.size > 0;
  }

  private clear() {
    for (const surface of [this.back, this.front]) surface.context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
  }

  private style(key: number) {
    let style = this.styleCache.get(key);
    if (style) return style;
    const alpha = (key & 15) / 15;
    const rgb = key >> 4;
    const r = ((rgb >> 8) & 15) * 17;
    const g = ((rgb >> 4) & 15) * 17;
    const b = (rgb & 15) * 17;
    style = `rgb(${r} ${g} ${b} / ${alpha.toFixed(3)})`;
    this.styleCache.set(key, style);
    return style;
  }

  private bucket(key: number) {
    let list = this.buckets.get(key);
    if (!list) {
      list = [];
      this.buckets.set(key, list);
    }
    return list;
  }

  private flush(context: LifeSurface["context"]) {
    const ratio = this.ratio;
    for (const [key, list] of this.buckets) {
      if (list.length === 0) continue;
      context.fillStyle = this.style(key);
      context.beginPath();
      for (let n = 0; n < list.length; n += 3) {
        const size = list[n + 2] * ratio;
        context.rect(list[n] * ratio - size / 2, list[n + 1] * ratio - size / 2, size, size);
      }
      context.fill();
      list.length = 0;
    }
  }

  private draw() {
    const lattice = this.lattice;
    const back = this.back.context;
    back.clearRect(0, 0, this.back.canvas.width, this.back.canvas.height);
    const [ir, ig, ib] = this.ink;
    const maxInk = this.dark ? 0.5 : 0.42;
    const p = this.pointer;
    const revealAlpha = (this.dark ? 0.085 : 0.065) * p.reveal;

    // The area to draw: the active window, plus the pointer's reveal.
    let i0 = lattice.i0;
    let i1 = lattice.i1;
    let j0 = lattice.j0;
    let j1 = lattice.j1;
    if (revealAlpha > 0.002) {
      const ri0 = Math.max(0, Math.floor((p.x - REVEAL_RADIUS) / lattice.spacing));
      const ri1 = Math.min(lattice.cols - 1, Math.ceil((p.x + REVEAL_RADIUS) / lattice.spacing) + 2);
      const rj0 = Math.max(0, Math.floor((p.y - REVEAL_RADIUS) / lattice.rowHeight));
      const rj1 = Math.min(lattice.rows - 1, Math.ceil((p.y + REVEAL_RADIUS) / lattice.rowHeight) + 2);
      if (i0 > i1) {
        i0 = ri0;
        i1 = ri1;
        j0 = rj0;
        j1 = rj1;
      } else {
        i0 = Math.min(i0, ri0);
        i1 = Math.max(i1, ri1);
        j0 = Math.min(j0, rj0);
        j1 = Math.max(j1, rj1);
      }
    }
    for (let j = j0; j <= j1; j += 1) {
      const hy = lattice.homeY(j);
      for (let i = i0; i <= i1; i += 1) {
        const index = j * lattice.cols + i;
        const x = lattice.homeX(i, j) + lattice.dx[index];
        const y = hy + lattice.dy[index];
        const speed = Math.hypot(lattice.vx[index], lattice.vy[index]);
        const offset = Math.hypot(lattice.dx[index], lattice.dy[index]);
        const lr = lattice.lr[index];
        const lg = lattice.lg[index];
        const lb = lattice.lb[index];
        const light = Math.max(lr, lg, lb);
        let reveal = 0;
        if (revealAlpha > 0.002) {
          const d = Math.hypot(x - p.x, y - p.y);
          if (d < REVEAL_RADIUS) reveal = revealAlpha * (1 - d / REVEAL_RADIUS) ** 1.5;
        }
        const motion = Math.min(maxInk, speed * 0.0042 + offset * 0.09);
        const alpha = Math.min(0.92, motion + light * 0.85 + reveal);
        if (alpha < 0.012) continue;
        let r = ir;
        let g = ig;
        let b = ib;
        if (light > 0.02) {
          // Light colours the dot; the stronger the light, the more it shows.
          const k = Math.min(1, light * 1.8);
          const scale = 255 / Math.max(light, 1e-3);
          r = r + (Math.min(255, lr * scale) - r) * k;
          g = g + (Math.min(255, lg * scale) - g) * k;
          b = b + (Math.min(255, lb * scale) - b) * k;
        }
        const size = 1.2 + Math.min(0.9, light * 0.9) + Math.min(0.5, speed * 0.004);
        const key = (((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)) * 16 + Math.min(15, Math.round(alpha * 15));
        const list = this.bucket(key);
        list.push(x, y, size);
      }
    }
    this.flush(back);

    const front = this.front.context;
    front.clearRect(0, 0, this.front.canvas.width, this.front.canvas.height);
    const parts = this.particles;
    for (let i = 0; i < parts.capacity; i += 1) {
      if (parts.mode[i] === Mode.Dead || parts.delay[i] > 0) continue;
      const alpha = parts.a[i];
      if (alpha < 0.012) continue;
      const key =
        ((((parts.r[i] | 0) >> 4) << 8) | (((parts.g[i] | 0) >> 4) << 4) | ((parts.b[i] | 0) >> 4)) * 16 +
        Math.min(15, Math.round(alpha * 15));
      this.bucket(key).push(parts.x[i], parts.y[i], parts.size[i]);
    }
    this.flush(front);
  }
}
