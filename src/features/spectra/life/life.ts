import { LifeEngine, type LifeCommand, type LifeEvent, type LifeTier, type LightColour, type Rect } from "./engine";
import type { Figure, Point } from "./figure";
import type { Rgb } from "./spectrum";

/*
 * The life API the interface calls. One instance per page.
 *
 * Every call is fire-and-forget and costs a message. With no field attached
 * (server render, reduced motion, tests) every call is a no-op and every
 * promise resolves at once, so callers never branch on whether life is on.
 *
 * Coordinates are viewport CSS pixels, as from getBoundingClientRect.
 *
 * The verbs, from smallest to largest:
 * - pulse, wake, glow: the field itself answers (presses, drags, work in progress);
 * - send: light travels through the field from one place to another;
 * - form / unform: a figure rises out of the field and fuses into lines, or
 *   parts into dots that sink back;
 * - morph: one figure flows straight into another close by;
 * - travel: a figure breaks, pours into the field, travels through it as
 *   light, and forms somewhere else (or is taken in by something there);
 * - breathe, radiate, absorb: the prism's (or anything's) moments of
 *   reassembling, giving off and taking in.
 */

export type { LightColour, Rect } from "./engine";
export type { Figure, Point } from "./figure";

export type GlowHandle = { move(rect: Rect): void; stop(): void };

/** A figure the field is making (or has made). */
export type Formed = {
  id: number;
  /** Resolves when the figure is whole: show the real element under it now. */
  formed: Promise<void>;
  /** Resolves when the figure has gone (faded into the element, or sunk). */
  gone: Promise<void>;
  /** Lets go of a held figure: it fades as the element takes over. */
  release(): void;
  /** Lets a held figure sink back into the field. */
  sink(): void;
};

export type Travelled = Formed & {
  /** Resolves when the light reaches the destination (and, with `absorb`, is taken in). */
  arrived: Promise<void>;
};

type Sink = (command: LifeCommand) => void;

class Life {
  private sinkTo: Sink | null = null;
  private worker: Worker | null = null;
  private engine: LifeEngine | null = null;
  private nextId = 1;
  private waiting = new Map<string, () => void>();
  private activity = new Set<(awake: boolean) => void>();

  /** True while a field is attached and running. */
  get on() {
    return this.sinkTo !== null;
  }

  /** Attaches the field to its two canvases. Returns the detach function. */
  attach(back: HTMLCanvasElement, front: HTMLCanvasElement, tier: LifeTier): () => void {
    this.detach();
    const receive = (event: LifeEvent) => this.receive(event);
    if (typeof back.transferControlToOffscreen === "function" && typeof Worker !== "undefined") {
      const worker = new Worker(new URL("./life.worker.ts", import.meta.url), { type: "module" });
      const offBack = back.transferControlToOffscreen();
      const offFront = front.transferControlToOffscreen();
      worker.postMessage({ type: "init", back: offBack, front: offFront, tier }, [offBack, offFront]);
      worker.onmessage = (event: MessageEvent<LifeEvent>) => receive(event.data);
      this.worker = worker;
      this.sinkTo = (command) => worker.postMessage(command);
    } else {
      const backContext = back.getContext("2d");
      const frontContext = front.getContext("2d");
      if (!backContext || !frontContext) return () => {};
      this.engine = new LifeEngine(
        { canvas: back, context: backContext },
        { canvas: front, context: frontContext },
        tier,
        receive,
        (frame) => requestAnimationFrame(frame),
        () => performance.now(),
      );
      const engine = this.engine;
      this.sinkTo = (command) => engine.handle(command);
    }
    return () => this.detach();
  }

  /** Attaches an engine the host already made (the lab, tests). */
  attachEngine(engine: LifeEngine) {
    this.detach();
    this.engine = engine;
    this.sinkTo = (command) => engine.handle(command);
    return (event: LifeEvent) => this.receive(event);
  }

  detach() {
    this.worker?.terminate();
    this.worker = null;
    this.engine = null;
    this.sinkTo = null;
    for (const resolve of this.waiting.values()) resolve();
    this.waiting.clear();
  }

  /** Called with true when the field wakes and false when it sleeps. */
  onActivity(listener: (awake: boolean) => void) {
    this.activity.add(listener);
    return () => void this.activity.delete(listener);
  }

  private receive(event: LifeEvent) {
    if (event.type === "awake" || event.type === "asleep") {
      for (const listener of this.activity) listener(event.type === "awake");
      return;
    }
    const key = `${event.type}:${event.id}`;
    this.waiting.get(key)?.();
    this.waiting.delete(key);
    if (event.type === "gone") {
      // Whatever else was waiting on this figure will not happen now.
      for (const other of ["formed", "arrived"]) {
        const k = `${other}:${event.id}`;
        this.waiting.get(k)?.();
        this.waiting.delete(k);
      }
    }
  }

  private post(command: LifeCommand) {
    this.sinkTo?.(command);
  }

  private when(type: "formed" | "gone" | "arrived", id: number) {
    if (!this.sinkTo) return Promise.resolve();
    return new Promise<void>((resolve) => this.waiting.set(`${type}:${id}`, resolve));
  }

  private formed(id: number): Formed {
    return {
      id,
      formed: this.when("formed", id),
      gone: this.when("gone", id),
      release: () => this.post({ type: "release", id }),
      sink: () => this.post({ type: "sink", id }),
    };
  }

  resize(width: number, height: number, ratio: number) {
    this.post({ type: "resize", width, height, ratio });
  }

  theme(dark: boolean, ink: Rgb) {
    this.post({ type: "theme", dark, ink });
  }

  pointer(x: number, y: number, inside: boolean) {
    this.post({ type: "pointer", x, y, inside });
  }

  /** A ripple from a point: presses, drops, arrivals. Strength about 0.3 (a tap) to 1.5 (a landing). */
  pulse(x: number, y: number, strength = 1, colour?: LightColour) {
    this.post({ type: "pulse", x, y, strength, colour });
  }

  /** Something moving through the field: drags, scrolling panels. Velocity in px/s. */
  wake(x: number, y: number, vx: number, vy: number, colour?: Rgb) {
    this.post({ type: "wake", x, y, vx, vy, colour });
  }

  /** Light held in the field around an area until stopped: something working, a drop target. */
  glow(rect: Rect, colour: LightColour, intensity = 1): GlowHandle {
    const id = this.nextId++;
    this.post({ type: "glow", id, rect, colour, intensity });
    return {
      move: (next) => this.post({ type: "glowMove", id, rect: next }),
      stop: () => this.post({ type: "glowStop", id }),
    };
  }

  /**
   * A figure rises out of the field and fuses into its lines: something new.
   * Dots leave the field in order of distance from `from` (where its matter
   * comes from: a click, the prism, the edge of the screen), so it draws
   * itself outward from there.
   */
  form(figure: Figure, { from, colour = "spectrum" as LightColour, hold = false } = {} as FormOptions): Formed {
    const id = this.nextId++;
    this.post({ type: "form", id, figure, from: from ? [from[0], from[1]] : undefined, colour, hold });
    return this.formed(id);
  }

  /**
   * Loading: the figure of what is coming (rows, a page, a grid) forms from
   * the field and holds, breathing light along its lines, until released.
   */
  ghost(figure: Figure, { from }: { from?: Point } = {}): Formed {
    const id = this.nextId++;
    this.post({ type: "form", id, figure, from: from ? [from[0], from[1]] : undefined, colour: "spectrum", hold: true, shimmer: true });
    return this.formed(id);
  }

  /** Something goes away: its lines part into dots that sink into the field. */
  unform(what: Figure | Formed, { from }: { from?: Point } = {}): Promise<void> {
    const id = this.nextId++;
    const isFormed = "formed" in what;
    this.post({
      type: "unform",
      id,
      figure: isFormed ? undefined : what,
      formation: isFormed ? what.id : undefined,
      from: from ? [from[0], from[1]] : undefined,
    });
    return this.when("gone", id);
  }

  /** One figure flows into another close by: the composer opening out of the prism. */
  morph(from: Figure | Formed, to: Figure, { hold = false } = {}): Formed {
    const id = this.nextId++;
    this.post({ type: "morph", id, from: "formed" in from ? from.id : from, to, hold });
    return this.formed(id);
  }

  /**
   * Something goes somewhere else: it breaks and pours into the field, travels
   * through it as light, and forms the target there, or is taken in by
   * `absorb` (the prism receiving a message).
   */
  travel(
    from: Figure | Formed | Point,
    to: Figure | { absorb: Rect },
    { colour = "spectrum" as LightColour, hold = false } = {},
  ): Travelled {
    const id = this.nextId++;
    const absorb = "absorb" in to ? to.absorb : undefined;
    this.post({
      type: "travel",
      id,
      from: isFigureOrFormed(from) ? ("formed" in from ? from.id : from) : [from[0], from[1]],
      to: "absorb" in to ? undefined : to,
      absorb,
      colour,
      hold,
    });
    return { ...this.formed(id), arrived: this.when("arrived", id) };
  }

  /** Light alone through the field, from one place to another. With `absorb`, the target takes it in. */
  send(from: Point | Rect, to: Point | Rect, { colour = "spectrum" as LightColour, strength = 1, absorb = false } = {}) {
    const id = this.nextId++;
    const target = pointOf(to);
    this.post({
      type: "send",
      id,
      from: [...pointOf(from)],
      to: [...target],
      absorb: absorb && !isPoint(to) ? to : undefined,
      colour,
      strength,
    });
    return this.when("arrived", id);
  }

  /** The figure parts into dots that swell out and come back together: a reaction. */
  breathe(figure: Figure, amount = 6): Formed {
    const id = this.nextId++;
    this.post({ type: "breathe", id, figure, amount });
    return this.formed(id);
  }

  /** Dots leave a figure's edges and sink into the field around it. */
  radiate(figure: Figure, { colour = "spectrum" as LightColour, count = 18, reach = 30 } = {}) {
    this.post({ type: "radiate", figure, colour, count, reach });
  }

  /** The field around a rect draws in and is taken in at its edge. */
  absorb(rect: Rect, { colour = "spectrum" as LightColour, count = 16 } = {}) {
    const id = this.nextId++;
    this.post({ type: "absorb", id, rect, colour, count });
    return this.when("arrived", id);
  }
}

type FormOptions = { from?: Point; colour?: LightColour; hold?: boolean };

function isPoint(value: Point | Rect): value is Point {
  return Array.isArray(value);
}

function pointOf(value: Point | Rect): Point {
  return isPoint(value) ? value : [value.x + value.width / 2, value.y + value.height / 2];
}

export const life = new Life();

/** The centre of a rect, for pulses. */
export function centreOf(rect: Rect | DOMRect): [number, number] {
  return [rect.x + rect.width / 2, rect.y + rect.height / 2];
}

export function rectOf(element: Element): Rect {
  const r = element.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function isFigureOrFormed(value: Figure | Formed | Point): value is Figure | Formed {
  return !Array.isArray(value);
}
