import { FieldLattice, FULL_TUNING, LIGHT_TUNING } from "./field-sim";
import { centreOfFigure, nearestOn, type Figure } from "./figure";
import { Bead, DOT, Formation } from "./formation";
import { Mode, Particles } from "./particles";
import { spectrumAt, type Rgb } from "./spectrum";

/*
 * The life engine: the field, what travels through it, and what forms from it.
 *
 * It owns no thread. The same engine runs in a Web Worker on OffscreenCanvas
 * (the normal case) or on the main thread when OffscreenCanvas is missing.
 * Hosts send it commands and give it a way to schedule frames; it sleeps as
 * soon as nothing carries energy, so at rest it costs nothing.
 *
 * Three kinds of matter:
 * - the lattice: the field itself, a membrane of dots that ripples and holds light;
 * - signals: light travelling through the lattice from one place to another,
 *   carried node to node, so travel is always through the field, never over it;
 * - formations: figures made of dots that rise out of the field (or out of
 *   something that broke apart) and fuse into lines.
 *
 * Two canvases: the back layer, under the interface, holds the lattice; the
 * front layer, above it, holds formations, loose dots, and the lattice's
 * light where something is passing through.
 */

export type LifeTier = "full" | "light";

export type Rect = { x: number; y: number; width: number; height: number };

/** A colour for light: an sRGB triple, or the spectrum flowing across the area. */
export type LightColour = Rgb | "spectrum";

type Pt = [number, number];

export type LifeCommand =
  | { type: "resize"; width: number; height: number; ratio: number }
  | { type: "theme"; dark: boolean; ink: Rgb }
  | { type: "pointer"; x: number; y: number; inside: boolean }
  | { type: "pulse"; x: number; y: number; strength: number; colour?: LightColour }
  | { type: "wake"; x: number; y: number; vx: number; vy: number; colour?: Rgb }
  | { type: "glow"; id: number; rect: Rect; colour: LightColour; intensity: number }
  | { type: "glowMove"; id: number; rect: Rect }
  | { type: "glowStop"; id: number }
  /** A figure rises out of the field around `from` (default: its centre) and fuses. */
  | { type: "form"; id: number; figure: Figure; from?: Pt; colour: LightColour; hold: boolean; shimmer?: boolean }
  /** A figure (or a formation) breaks into dots that sink into the field. */
  | { type: "unform"; id: number; figure?: Figure; formation?: number; from?: Pt }
  /** One figure flows straight into another nearby: the dots fly free between them. */
  | { type: "morph"; id: number; from: Figure | number; to: Figure; hold: boolean }
  /**
   * Something goes somewhere far: the source breaks and pours into the field,
   * travels through it as light, and forms the target (or is taken into `absorb`).
   */
  | {
      type: "travel";
      id: number;
      /** What leaves: a figure on screen, a live formation, or light from a point. */
      from: Figure | number | Pt;
      to?: Figure;
      absorb?: Rect;
      colour: LightColour;
      hold: boolean;
    }
  /** Light alone through the field, from a point to a point or into a rect. */
  | { type: "send"; id: number; from: Pt; to: Pt; absorb?: Rect; colour: LightColour; strength: number }
  /** A figure parts into dots that swell out and come back together. */
  | { type: "breathe"; id: number; figure: Figure; amount: number }
  /** Dots leave a figure's edges and sink into the field around it, lighting it. */
  | { type: "radiate"; figure: Figure; colour: LightColour; count: number; reach: number }
  /** The field around a rect draws in and is taken in at its edge. */
  | { type: "absorb"; id: number; rect: Rect; colour: LightColour; count: number }
  /** A held formation lets go: it fades as the real element takes over. */
  | { type: "release"; id: number }
  /** A held formation sinks back into the field instead. */
  | { type: "sink"; id: number };

export type LifeEvent =
  | { type: "formed"; id: number }
  | { type: "gone"; id: number }
  | { type: "arrived"; id: number }
  | { type: "asleep" }
  | { type: "awake" };

export type LifeSurface = {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
};

type Glow = { rect: Rect; colour: LightColour; intensity: number; age: number };

type Signal = {
  id: number;
  path: [number, number, number, number, number, number];
  length: number;
  t: number;
  duration: number;
  colour: LightColour;
  strength: number;
  last: Pt;
  /** Starts once this many dots of the source have sunk into the field. */
  waitFor: { formation: number; share: number; deadline: number } | null;
  /** What happens when it arrives. */
  form: Formation | null;
  absorb: Rect | null;
};

type FormationEntry = {
  formation: Formation;
  announce: boolean;
  linger: number;
  sunk: number;
  /** Flowing into something close by: it arrives once enough has been taken in. */
  pour?: { rect: Rect; arrived: boolean };
};

const REVEAL_RADIUS = 120;
const POINTER_RADIUS = 44;
/** Formed figures hold this long before the real element takes over. */
/** Below this a dot is still loose and draws as a dot. */
const LOOSE = 0.5;
/** Wide lines draw in a few thicknesses while their dots join. */
const WIDTH_LEVELS = 4;
/** How much a dot in flight shows at least, however faint its line. */
const MATTER_ALPHA = 0.42;
const LINGER = 0.12;

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class LifeEngine {
  private lattice: FieldLattice;
  private particles: Particles;
  private width = 0;
  private height = 0;
  private ratio = 1;
  private ink: Rgb = [20, 19, 24];
  private dark = false;
  private pointer = { x: -1e4, y: -1e4, inside: false, reveal: 0, speed: 0 };
  private glows = new Map<number, Glow>();
  private formations = new Map<number, FormationEntry>();
  private signals: Signal[] = [];
  private absorbing = new Map<number, { arrived: boolean; rect: Rect }>();
  private internalId = -1;
  private time = 0;
  private running = false;
  private last = 0;
  private styleCache = new Map<number, string>();
  private buckets = new Map<number, number[]>();
  private frontBuckets = new Map<number, number[]>();

  constructor(
    private back: LifeSurface,
    private front: LifeSurface,
    private readonly tier: LifeTier,
    private readonly emit: (event: LifeEvent) => void,
    private readonly schedule: (frame: (now: number) => void) => void,
    private readonly now: () => number,
  ) {
    this.lattice = new FieldLattice(1, 1, tier === "full" ? FULL_TUNING : LIGHT_TUNING);
    this.particles = new Particles(tier === "full" ? 1200 : 300);
    this.wireParticles();
  }

  private wireParticles() {
    this.particles.onReturn = (x, y, r, g, b) => {
      // A loose dot going home leaves its light in the field where it lands.
      const node = this.lattice.nearest(x, y);
      this.lattice.receive(node, r / 255, g / 255, b / 255, 0.16, 8);
      this.lattice.show(x, y, 36, 0.7);
    };
    this.particles.onAbsorb = (group, x, y) => {
      const entry = this.absorbing.get(group);
      if (!entry) return;
      if (!entry.arrived) {
        entry.arrived = true;
        this.emit({ type: "arrived", id: group });
        const r = entry.rect;
        this.lattice.impulse(r.x + r.width / 2, r.y + r.height / 2, Math.max(r.width, r.height) / 2 + 26, 120);
      }
      void x;
      void y;
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
      case "wake":
        this.wakeTrail(command);
        break;
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
      case "form": {
        const formation = new Formation(command.id, command.figure);
        const [fx, fy] = command.from ?? centreOfFigure(command.figure);
        formation.riseFrom(this.lattice, fx, fy, this.rgbAt(command.colour, fx, fy));
        formation.hold = command.hold;
        formation.shimmer = command.shimmer ?? false;
        this.add(formation, true);
        // Where it comes from, the field stirs.
        this.lattice.impulse(fx, fy, 24, 40);
        break;
      }
      case "unform": {
        const formation = this.sourceFormation(command.formation ?? command.figure ?? null);
        if (!formation) break;
        const [fx, fy] = command.from ?? centreOfFigure(formation.figure);
        formation.breakUp(this.lattice, { kind: "field" }, fx, fy, 700);
        this.retag(formation, command.id);
        break;
      }
      case "morph": {
        const source = this.sourceFormation(command.from);
        const target = new Formation(command.id, command.to);
        if (source) {
          const used = target.takeFrom(source);
          // Lines the new shape has no use for part and sink into the field.
          const rest = new Set(source.strokes.map((_, index) => index).filter((index) => !used.has(index)));
          this.remove(source.id);
          if (rest.size > 0) {
            source.id = this.internalId--;
            source.keepOnly(rest);
            const [cx, cy] = centreOfFigure(source.figure);
            source.breakUp(this.lattice, { kind: "field" }, cx, cy, 900);
            this.add(source, false);
          }
        } else {
          const [cx, cy] = centreOfFigure(command.to);
          target.riseFrom(this.lattice, cx, cy, this.ink);
        }
        target.hold = command.hold;
        this.add(target, true);
        break;
      }
      case "travel":
        this.travel(command);
        break;
      case "send": {
        const signal = this.signal(command.id, command.from, command.to, command.colour, command.strength);
        signal.absorb = command.absorb ?? null;
        this.signals.push(signal);
        break;
      }
      case "breathe": {
        const formation = new Formation(command.id, command.figure);
        formation.showWhole();
        formation.scatter(command.amount);
        this.add(formation, true);
        break;
      }
      case "radiate":
        this.radiate(command);
        break;
      case "absorb":
        this.absorb(command.id, command.rect, command.colour, command.count, null);
        break;
      case "release": {
        const entry = this.formations.get(command.id);
        if (entry) {
          entry.formation.hold = false;
          if (entry.formation.phase === "formed") entry.formation.fade(5);
        }
        break;
      }
      case "sink": {
        const entry = this.formations.get(command.id);
        if (entry) {
          const [cx, cy] = centreOfFigure(entry.formation.figure);
          entry.formation.breakUp(this.lattice, { kind: "field" }, cx, cy, 700);
        }
        break;
      }
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
    const c = this.rgbAt(colour, x, y);
    return [c[0] / 255, c[1] / 255, c[2] / 255];
  }

  private rgbAt(colour: LightColour, x: number, y: number): Rgb {
    if (colour === "spectrum") return spectrumAt((x + y * 0.35) / 700 + this.time * 0.07);
    return colour;
  }

  private add(formation: Formation, announce: boolean) {
    this.formations.set(formation.id, { formation, announce, linger: LINGER, sunk: 0 });
  }

  private remove(id: number) {
    this.formations.delete(id);
  }

  /** Moves a formation under a new id, so its events reach whoever asked last. */
  private retag(formation: Formation, id: number) {
    const entry = this.formations.get(formation.id);
    if (!entry || formation.id === id) return;
    this.formations.delete(formation.id);
    formation.id = id;
    this.formations.set(id, entry);
  }

  /** A formation to break or morph from: a live one by id, or a figure on screen shown whole. */
  private sourceFormation(from: Figure | number | null): Formation | null {
    if (from === null) return null;
    if (typeof from === "number") return this.formations.get(from)?.formation ?? null;
    const formation = new Formation(this.internalId--, from);
    formation.showWhole();
    this.add(formation, false);
    return formation;
  }

  private signal(id: number, from: Pt, to: Pt, colour: LightColour, strength: number): Signal {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy) || 1;
    // A gentle bend, like something thrown, always to the same side for the same direction.
    const bend = length * 0.14 * (dx >= 0 ? 1 : -1);
    const cx = (from[0] + to[0]) / 2 - (dy / length) * bend;
    const cy = (from[1] + to[1]) / 2 + (dx / length) * bend;
    return {
      id,
      path: [from[0], from[1], cx, cy, to[0], to[1]],
      length,
      t: 0,
      duration: Math.min(0.85, Math.max(0.28, length / 900)),
      colour,
      strength,
      last: [from[0], from[1]],
      waitFor: null,
      form: null,
      absorb: null,
    };
  }

  private travel(command: Extract<LifeCommand, { type: "travel" }>) {
    const fromPoint = Array.isArray(command.from) ? (command.from as Pt) : null;
    const source = fromPoint ? null : this.sourceFormation(command.from as Figure | number);
    const target = command.to ? new Formation(command.id, command.to) : null;
    const aim: Pt = target
      ? [...centreOfFigure(command.to!)]
      : command.absorb
        ? [command.absorb.x + command.absorb.width / 2, command.absorb.y + command.absorb.height / 2]
        : [0, 0];
    const start: Pt = fromPoint ? [fromPoint[0], fromPoint[1]] : source ? [...nearestOn(source.figure, aim[0], aim[1])] : aim;
    let end: Pt = aim;
    if (target) end = [...nearestOn(command.to!, start[0], start[1])];
    else if (command.absorb) {
      // Arrive at the edge of what takes it in, on the side facing the start.
      const r = command.absorb;
      const dx = start[0] - aim[0];
      const dy = start[1] - aim[1];
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(r.width, r.height) / 2 + 10;
      end = [aim[0] + (dx / d) * reach, aim[1] + (dy / d) * reach];
    }
    if (source && command.absorb && !target && Math.hypot(start[0] - aim[0], start[1] - aim[1]) < 240) {
      // Close by: the matter flows straight in through the field, no signal.
      const r = command.absorb;
      source.tintTo((x, y) => this.rgbAt(command.colour, x, y));
      source.breakUp(this.lattice, { kind: "into", x: aim[0], y: aim[1], radius: Math.min(r.width, r.height) * 0.3 }, start[0], start[1], 1300);
      this.retag(source, command.id);
      const entry = this.formations.get(command.id);
      if (entry) entry.pour = { rect: r, arrived: false };
      return;
    }
    const strength = source ? Math.min(1.6, Math.max(1, source.n / 160)) : 1.2;
    if (fromPoint) {
      // Light leaves from here: the field there gives a little kick.
      const [r, g, b] = this.colourAt(command.colour, start[0], start[1]);
      this.lattice.impulse(start[0], start[1], 26, 60);
      this.lattice.addLight(start[0], start[1], 22, r, g, b, 0.4);
    }
    const signal = this.signal(command.id, start, end, command.colour, strength);
    if (source) {
      source.tintTo((x, y) => this.rgbAt(command.colour, x, y));
      source.breakUp(this.lattice, { kind: "point", x: start[0], y: start[1], radius: 16 }, start[0], start[1], 1100);
      signal.waitFor = { formation: source.id, share: 0.3, deadline: this.time + 0.55 };
    }
    if (target) {
      target.hold = command.hold;
      signal.form = target;
    }
    signal.absorb = command.absorb ?? null;
    this.signals.push(signal);
  }

  private radiate(command: Extract<LifeCommand, { type: "radiate" }>) {
    const [cx, cy] = centreOfFigure(command.figure);
    const points: number[] = [];
    for (const stroke of command.figure.strokes) points.push(...stroke.points);
    const total = points.length / 2;
    if (total === 0) return;
    for (let k = 0; k < command.count; k += 1) {
      const p = Math.floor(((k + Math.random() * 0.5) / command.count) * total) % total;
      const x = points[p * 2];
      const y = points[p * 2 + 1];
      const colour = command.colour === "spectrum" ? spectrumAt(k / command.count + this.time * 0.1) : command.colour;
      const index = this.particles.spawn(x, y, colour, this.dark ? 0.85 : 0.75);
      if (index < 0) break;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy) || 1;
      const speed = command.reach * (2.2 + Math.random() * 1.4);
      this.particles.vx[index] = (dx / d) * speed;
      this.particles.vy[index] = (dy / d) * speed;
      this.particles.a[index] = 0.9;
      this.particles.size[index] = 1.9;
      this.particles.life[index] = 0.32 + Math.random() * 0.22;
      this.particles.ta[index] = 0.8;
    }
  }

  /**
   * The field around a rect, or around a point of arrival, draws in: dots
   * leave their nodes and fall into the rect, taken in at its edge.
   */
  private absorb(id: number, rect: Rect, colour: LightColour, count: number, around: Pt | null) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const inner = Math.min(rect.width, rect.height) / 2;
    this.absorbing.set(id, { arrived: false, rect });
    for (let k = 0; k < count; k += 1) {
      let ox: number;
      let oy: number;
      if (around) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 6 + Math.random() * 22;
        ox = around[0] + Math.cos(angle) * radius;
        oy = around[1] + Math.sin(angle) * radius;
      } else {
        const angle = (k / count) * Math.PI * 2 + Math.random() * 0.3;
        const radius = inner + 34 + Math.random() * 26;
        ox = cx + Math.cos(angle) * radius;
        oy = cy + Math.sin(angle) * radius;
      }
      const node = this.lattice.nearest(ox, oy);
      const [nx, ny] = this.lattice.positionOf(node);
      const c = this.rgbAt(colour, nx, ny);
      this.lattice.lend(node, c[0] / 255, c[1] / 255, c[2] / 255, 0.1);
      const index = this.particles.spawn(nx, ny, c, this.dark ? 0.9 : 0.8, id);
      if (index < 0) break;
      this.particles.size[index] = 1.8;
      this.particles.absorbInto(index, cx, cy, inner * 0.75, (around ? 0 : 0.05) + Math.random() * 0.08);
    }
    this.lattice.attract(cx, cy, inner + 70, 1800);
    this.lattice.show(cx, cy, inner + 90, 1);
  }

  private wakeTrail(command: Extract<LifeCommand, { type: "wake" }>) {
    const speed = Math.hypot(command.vx, command.vy);
    this.lattice.push(command.x, command.y, 34, command.vx * 0.5, command.vy * 0.5, 0.5);
    if (speed > 160) {
      // Light left in the field behind anything moving fast, not dots in the air.
      const [r, g, b] = command.colour ? this.colourAt(command.colour, command.x, command.y) : [this.ink[0] / 255, this.ink[1] / 255, this.ink[2] / 255];
      this.lattice.addLight(command.x, command.y, 22, r, g, b, Math.min(0.12, speed / 9000));
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

  private stepSignals(dt: number) {
    const lattice = this.lattice;
    for (let s = this.signals.length - 1; s >= 0; s -= 1) {
      const signal = this.signals[s];
      if (signal.waitFor) {
        const entry = this.formations.get(signal.waitFor.formation);
        const share = entry ? entry.sunk / Math.max(1, entry.formation.n) : 1;
        if (share < signal.waitFor.share && this.time < signal.waitFor.deadline) {
          // Gathering at the start: the field there draws in.
          lattice.attract(signal.path[0], signal.path[1], 34, 900 * signal.strength);
          lattice.show(signal.path[0], signal.path[1], 90, 0.9);
          continue;
        }
        signal.waitFor = null;
      }
      signal.t = Math.min(1, signal.t + dt / signal.duration);
      const t = signal.t;
      const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      const [x0, y0, cx, cy, x1, y1] = signal.path;
      const u = 1 - e;
      const hx = u * u * x0 + 2 * u * e * cx + e * e * x1;
      const hy = u * u * y0 + 2 * u * e * cy + e * e * y1;
      // Light is laid along the whole step so fast stretches leave no gaps.
      const [lx, ly] = signal.last;
      const step = Math.hypot(hx - lx, hy - ly);
      const pieces = Math.max(1, Math.ceil(step / 5));
      const radius = 15 + 7 * signal.strength;
      for (let k = 1; k <= pieces; k += 1) {
        const px = lx + ((hx - lx) * k) / pieces;
        const py = ly + ((hy - ly) * k) / pieces;
        const [r, g, b] = this.colourAt(signal.colour, px, py);
        lattice.addLight(px, py, radius, r, g, b, 0.12 * signal.strength * Math.min(1.6, step / pieces / 4 + 0.4));
        lattice.raise(px, py, radius, 0.5);
      }
      // The field draws together around the light as it passes, and is
      // nudged along with it: dots carry it, they don't watch it go by.
      lattice.attract(hx, hy, radius * 1.9, 2600 * signal.strength);
      // Its head is a bright knot of light in the lattice.
      const [hr, hg, hb] = this.colourAt(signal.colour, hx, hy);
      lattice.addLight(hx, hy, 12 + 4 * signal.strength, hr, hg, hb, 0.22 * signal.strength);
      // The field surfaces around it: it is seen to move through the medium.
      lattice.show(hx, hy, 70 + 30 * signal.strength, 1);
      const vx = (hx - lx) / Math.max(dt, 1e-3);
      const vy = (hy - ly) / Math.max(dt, 1e-3);
      lattice.forEachNear(hx, hy, radius * 1.4, (index, d) => {
        const k = (1 - d / (radius * 1.4)) * 2.2;
        lattice.fx[index] += vx * k;
        lattice.fy[index] += vy * k;
      });
      signal.last = [hx, hy];
      if (t < 1) continue;
      this.signals.splice(s, 1);
      this.arrive(signal);
    }
  }

  private arrive(signal: Signal) {
    const [, , , , ex, ey] = signal.path;
    const lattice = this.lattice;
    lattice.impulse(ex, ey, 24 + 14 * signal.strength, 70 * signal.strength);
    const [r, g, b] = this.colourAt(signal.colour, ex, ey);
    lattice.addLight(ex, ey, 30, r, g, b, 0.35 * signal.strength);
    if (signal.form) {
      signal.form.riseFrom(lattice, ex, ey, this.rgbAt(signal.colour, ex, ey));
      this.add(signal.form, true);
    }
    if (signal.absorb) {
      // The light that arrived is taken in: the dots at the arrival fall into the target.
      this.absorb(signal.id, signal.absorb, signal.colour, Math.round(10 + 10 * signal.strength), [ex, ey]);
    } else this.emit({ type: "arrived", id: signal.id });
  }

  private stepFormations(dt: number) {
    for (const [id, entry] of this.formations) {
      const formation = entry.formation;
      const wasFormed = formation.phase === "formed";
      entry.sunk += formation.step(dt, this.time, this.lattice);
      if (entry.pour && !entry.pour.arrived) {
        const r = entry.pour.rect;
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        // The field around it draws in as it takes the matter.
        this.lattice.attract(cx, cy, Math.max(r.width, r.height) / 2 + 50, 900);
        if (entry.sunk >= formation.n * 0.4 || formation.done) {
          entry.pour.arrived = true;
          this.lattice.impulse(cx, cy, Math.max(r.width, r.height) / 2 + 26, 90);
          this.emit({ type: "arrived", id });
        }
      }
      if (formation.phase === "forming" || formation.phase === "breaking") this.surfaceAround(formation);
      if (formation.phase === "formed") {
        if (!wasFormed && !formation.announcedFormed) {
          formation.announcedFormed = true;
          if (entry.announce) this.emit({ type: "formed", id });
          // Settling into place sends a small ripple through the field.
          const [cx, cy] = centreOfFigure(formation.figure);
          this.lattice.impulse(cx, cy, 30, 30);
        }
        if (!formation.hold) {
          entry.linger -= dt;
          if (entry.linger <= 0) formation.fade(5);
        }
      }
      if (formation.done) {
        this.formations.delete(id);
        if (entry.announce || id >= 0) this.emit({ type: "gone", id });
      }
    }
  }

  /** Matter on the move shows the field it moves through: around each dot not yet in place. */
  private surfaceAround(formation: Formation) {
    const stride = Math.max(1, Math.floor(formation.n / 70));
    for (let i = 0; i < formation.n; i += stride) {
      if (formation.state[i] === Bead.Gone || formation.seat[i] > 0.9) continue;
      this.lattice.show(formation.x[i], formation.y[i], 46, 0.8);
    }
  }

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

    for (const glow of this.glows.values()) {
      glow.age += dt;
      const rise = Math.min(1, glow.age / 0.35);
      const { x, y, width, height } = glow.rect;
      this.lattice.addRectLight(x, y, width, height, 56, (px, py) => this.colourAt(glow.colour, px, py), glow.intensity * rise * dt * 5);
    }

    this.stepSignals(dt);
    this.stepFormations(dt);
    const latticeAwake = this.lattice.step(dt);
    this.particles.step(dt);
    for (const [id, entry] of this.absorbing) if (entry.arrived && this.particles.members(id).length === 0) this.absorbing.delete(id);

    return (
      latticeAwake ||
      this.particles.live > 0 ||
      this.glows.size > 0 ||
      p.reveal > 0 ||
      this.signals.length > 0 ||
      this.formations.size > 0
    );
  }

  private clear() {
    for (const surface of [this.back, this.front]) surface.context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
  }

  /** A cached fill or stroke style for a 12-bit colour and a 6-bit alpha. */
  private style(key: number) {
    let style = this.styleCache.get(key);
    if (style) return style;
    const alpha = (key & 63) / 63;
    const rgb = key >> 6;
    const r = ((rgb >> 8) & 15) * 17;
    const g = ((rgb >> 4) & 15) * 17;
    const b = (rgb & 15) * 17;
    style = `rgb(${r} ${g} ${b} / ${alpha.toFixed(3)})`;
    this.styleCache.set(key, style);
    return style;
  }

  private key(r: number, g: number, b: number, alpha: number) {
    return ((((r | 0) >> 4) << 8) | (((g | 0) >> 4) << 4) | ((b | 0) >> 4)) * 64 + Math.min(63, Math.max(0, Math.round(alpha * 63)));
  }

  private bucket(map: Map<number, number[]>, key: number) {
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    return list;
  }

  private flushDots(context: LifeSurface["context"], map: Map<number, number[]>) {
    const ratio = this.ratio;
    for (const [key, list] of map) {
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
    const front = this.front.context;
    front.clearRect(0, 0, this.front.canvas.width, this.front.canvas.height);
    const [ir, ig, ib] = this.ink;
    const maxInk = this.dark ? 0.5 : 0.42;
    const p = this.pointer;
    const revealAlpha = (this.dark ? 0.085 : 0.065) * p.reveal;
    const restAlpha = this.dark ? 0.17 : 0.13;
    const time = this.time;

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
        const present = 1 - lattice.taken[index];
        // Where the field has surfaced it glimmers, each dot on its own beat.
        const presence = lattice.presence[index];
        const shown = presence > 0.01 ? presence * restAlpha * (0.78 + 0.22 * Math.sin(time * 2.6 + index * 2.39)) : 0;
        const alpha = Math.min(0.95, motion + light * 1.3 + reveal + shown) * present;
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
        const size = 1.2 + Math.min(1.9, light * 2.2) + Math.min(0.5, speed * 0.004);
        // Light passing through shows above content as well, while it passes.
        const raised = lattice.lift[index] > 0.25 && light > 0.05;
        this.bucket(raised ? this.frontBuckets : this.buckets, this.key(r, g, b, alpha)).push(x, y, size);
      }
    }
    this.flushDots(back, this.buckets);
    this.flushDots(front, this.frontBuckets);

    const parts = this.particles;
    for (let i = 0; i < parts.capacity; i += 1) {
      if (parts.mode[i] === Mode.Dead || parts.delay[i] > 0) continue;
      const alpha = parts.a[i];
      if (alpha < 0.012) continue;
      this.bucket(this.frontBuckets, this.key(parts.r[i], parts.g[i], parts.b[i], alpha)).push(parts.x[i], parts.y[i], parts.size[i]);
    }
    this.flushDots(front, this.frontBuckets);

    for (const { formation } of this.formations.values()) this.drawFormation(front, formation);
  }

  /**
   * A formation: each dot reaches halfway to each seated neighbour, so dots
   * grow into segments that meet and become the line. One path per colour,
   * stroked once, so the line is clean where segments overlap.
   */
  private readonly widthMaps = Array.from({ length: WIDTH_LEVELS }, () => new Map<number, number[]>());

  private drawFormation(context: LifeSurface["context"], f: Formation) {
    const ratio = this.ratio;
    const opacity = f.opacity;
    if (opacity <= 0.003) return;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    if (f.fill && f.fillLevel > 0.01) {
      const k = f.fillLevel * opacity * f.fill.alpha;
      const pts = f.fill.points;
      context.beginPath();
      context.moveTo(pts[0] * ratio, pts[1] * ratio);
      for (let i = 2; i < pts.length; i += 2) context.lineTo(pts[i] * ratio, pts[i + 1] * ratio);
      context.closePath();
      const [r, g, b] = f.fill.colour;
      context.fillStyle = `rgb(${r | 0} ${g | 0} ${b | 0} / ${k.toFixed(3)})`;
      context.fill();
    }
    const shimmerAt = (x: number) => (f.shimmer ? 0.62 + 0.38 * Math.max(0, Math.sin(this.time * 2.6 - x * 0.012)) ** 3 : 1);
    for (const range of f.strokes) {
      let seatSum = 0;
      let seen = 0;
      let fusedCount = 0;
      let uniform = true;
      for (let k = 0; k < range.count; k += 1) {
        const i = range.start + k;
        if (!f.visible(i)) continue;
        seen += 1;
        if (f.seat[i] >= LOOSE) {
          seatSum += f.seat[i];
          fusedCount += 1;
        }
        if (f.seat[i] < 0.999) uniform = false;
      }
      if (seen === 0) continue;
      // Dots in flight are dots; only what has joined the line takes its width.
      const fused = fusedCount ? smoothstep(LOOSE, 1, seatSum / fusedCount) : 0;
      const width = (DOT + (range.width - DOT) * fused) * ratio;
      const maxGap = range.spacing * 2.6;
      const segments = new Map<number, number[]>();
      const loose = new Map<number, number[]>();
      const wide = range.width > DOT * 1.6;
      const widths = this.widthMaps;
      for (const map of widths) map.clear();
      if (uniform && range.single && seen === range.count) {
        // Whole: one exact line in the stroke's own colour.
        const i = range.start;
        if (f.shimmer) {
          // Loading: a band of light slides along the whole line.
          this.shimmerLine(context, f, range, width);
          continue;
        }
        const key = this.key(f.r[i], f.g[i], f.b[i], f.a[i] * opacity);
        const list = this.bucket(segments, key);
        for (let k = 0; k < range.count; k += 1) list.push(f.x[range.start + k], f.y[range.start + k]);
        if (range.closed) list.push(f.x[range.start], f.y[range.start]);
        this.strokeSegments(context, segments, width, true);
        continue;
      }
      for (let k = 0; k < range.count; k += 1) {
        const i = range.start + k;
        if (!f.visible(i)) continue;
        const x = f.x[i];
        const y = f.y[i];
        const prev = k > 0 ? i - 1 : range.closed ? range.start + range.count - 1 : -1;
        const next = k < range.count - 1 ? i + 1 : range.closed ? range.start : -1;
        let ax = x;
        let ay = y;
        let bx = x;
        let by = y;
        if (prev >= 0 && f.visible(prev)) {
          const reach = 0.5 * Math.min(f.seat[i], f.seat[prev]);
          if (reach > 0 && Math.abs(f.x[prev] - x) + Math.abs(f.y[prev] - y) < maxGap) {
            ax = x + (f.x[prev] - x) * reach;
            ay = y + (f.y[prev] - y) * reach;
          }
        }
        if (next >= 0 && f.visible(next)) {
          const reach = 0.5 * Math.min(f.seat[i], f.seat[next]);
          if (reach > 0 && Math.abs(f.x[next] - x) + Math.abs(f.y[next] - y) < maxGap) {
            bx = x + (f.x[next] - x) * reach;
            by = y + (f.y[next] - y) * reach;
          }
        }
        let alpha = f.a[i] * opacity * shimmerAt(x);
        if (f.seat[i] >= LOOSE) {
          if (alpha < 0.01) continue;
          // A wide line thickens as each dot joins it, not all at once.
          // A dot only thickens as far as a neighbour has joined it, so no lone discs.
          const neighbour = Math.max(prev >= 0 ? f.seat[prev] : 0, next >= 0 ? f.seat[next] : 0);
          const joined = Math.min(f.seat[i], neighbour);
          const level = wide ? Math.max(0, Math.min(WIDTH_LEVELS - 1, Math.floor(smoothstep(LOOSE, 1, joined) * WIDTH_LEVELS))) : WIDTH_LEVELS - 1;
          this.bucket(widths[level], this.key(f.r[i], f.g[i], f.b[i], alpha)).push(ax, ay, x, y, bx, by);
          continue;
        }
        // In flight a dot is matter: it keeps a visible body even when the
        // line it becomes is faint, leaning toward the ink.
        const lean = 0.4 * (1 - f.seat[i] / LOOSE);
        alpha = Math.max(alpha, MATTER_ALPHA * opacity * Math.min(1, f.a[i] * 4) * (1 - f.seat[i] / LOOSE));
        if (alpha < 0.01) continue;
        const [ir, ig, ib] = this.ink;
        this.bucket(loose, this.key(f.r[i] + (ir - f.r[i]) * lean, f.g[i] + (ig - f.g[i]) * lean, f.b[i] + (ib - f.b[i]) * lean, alpha)).push(ax, ay, x, y, bx, by);
      }
      widths.forEach((map, level) => {
        const w = wide ? DOT + (range.width - DOT) * ((level + 1) / WIDTH_LEVELS) : (DOT + (range.width - DOT) * fused);
        this.strokeSegments(context, map, w * ratio, false);
      });
      this.strokeSegments(context, loose, DOT * ratio, false);
    }
    context.restore();
  }

  private shimmerLine(context: LifeSurface["context"], f: Formation, range: { start: number; count: number; closed: boolean }, width: number) {
    const ratio = this.ratio;
    const i = range.start;
    const [r, g, b] = [f.r[i] | 0, f.g[i] | 0, f.b[i] | 0];
    const base = f.a[i] * f.opacity;
    // The band crosses the page every 1.6 s, so every line of a figure shares it.
    const span = this.width + 400;
    const head = ((this.time / 1.6) % 1) * span - 200;
    const gradient = context.createLinearGradient((head - 160) * ratio, 0, (head + 160) * ratio, 0);
    const low = `rgb(${r} ${g} ${b} / ${(base * 0.6).toFixed(3)})`;
    gradient.addColorStop(0, low);
    gradient.addColorStop(0.5, `rgb(${r} ${g} ${b} / ${Math.min(1, base * 1.25).toFixed(3)})`);
    gradient.addColorStop(1, low);
    context.strokeStyle = gradient;
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(f.x[i] * ratio, f.y[i] * ratio);
    for (let k = 1; k < range.count; k += 1) context.lineTo(f.x[i + k] * ratio, f.y[i + k] * ratio);
    if (range.closed) context.closePath();
    context.stroke();
  }

  private strokeSegments(context: LifeSurface["context"], segments: Map<number, number[]>, width: number, polyline: boolean) {
    const ratio = this.ratio;
    context.lineWidth = width;
    for (const [key, list] of segments) {
      if (list.length === 0) continue;
      context.strokeStyle = this.style(key);
      context.beginPath();
      if (polyline) {
        context.moveTo(list[0] * ratio, list[1] * ratio);
        for (let n = 2; n < list.length; n += 2) context.lineTo(list[n] * ratio, list[n + 1] * ratio);
      } else {
        for (let n = 0; n < list.length; n += 6) {
          const [ax, ay, x, y, bx, by] = [list[n], list[n + 1], list[n + 2], list[n + 3], list[n + 4], list[n + 5]];
          context.moveTo(ax * ratio, ay * ratio);
          context.lineTo(x * ratio, y * ratio);
          // A dot is a zero-length segment with a round cap.
          context.lineTo(bx * ratio + (bx === x && ax === x ? 0.01 : 0), by * ratio);
        }
      }
      context.stroke();
    }
  }
}
