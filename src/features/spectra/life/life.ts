import { LifeEngine, type LifeCommand, type LifeEvent, type LifeTier, type LightColour, type Rect } from "./engine";
import type { PointSet } from "./particles";
import type { Rgb } from "./spectrum";

/*
 * The life API the interface calls. One instance per page.
 *
 * Every call is fire-and-forget and costs a message. With no field attached
 * (server render, reduced motion, tests) every call is a no-op and every
 * promise resolves at once, so callers never branch on whether life is on.
 *
 * Coordinates are viewport CSS pixels, as from getBoundingClientRect.
 */

export type { LightColour, Rect } from "./engine";
export type { PointSet } from "./particles";

export type GlowHandle = { move(rect: Rect): void; stop(): void };
export type GatherHandle = { id: number; release(): void };

type Sink = (command: LifeCommand, transfer?: Transferable[]) => void;

class Life {
  private sink: Sink | null = null;
  private worker: Worker | null = null;
  private engine: LifeEngine | null = null;
  private nextId = 1;
  private waiting = new Map<number, () => void>();
  private activity = new Set<(awake: boolean) => void>();

  /** True while a field is attached and running. */
  get on() {
    return this.sink !== null;
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
      this.sink = (command, transfer) => worker.postMessage(command, transfer ?? []);
    } else {
      const backContext = back.getContext("2d");
      const frontContext = front.getContext("2d");
      if (!backContext || !frontContext) return () => {};
      const engine = new LifeEngine(
        { canvas: back, context: backContext },
        { canvas: front, context: frontContext },
        tier,
        receive,
        (frame) => requestAnimationFrame(frame),
        () => performance.now(),
      );
      this.engine = engine;
      this.sink = (command) => engine.handle(command);
    }
    return () => this.detach();
  }

  detach() {
    this.worker?.terminate();
    this.worker = null;
    this.engine = null;
    this.sink = null;
    for (const resolve of this.waiting.values()) resolve();
    this.waiting.clear();
  }

  /** Called with true when the field wakes and false when it sleeps. */
  onActivity(listener: (awake: boolean) => void) {
    this.activity.add(listener);
    return () => void this.activity.delete(listener);
  }

  private receive(event: LifeEvent) {
    if (event.type === "settled") {
      this.waiting.get(event.id)?.();
      this.waiting.delete(event.id);
      return;
    }
    for (const listener of this.activity) listener(event.type === "awake");
  }

  private send(command: LifeCommand, transfer?: Transferable[]) {
    this.sink?.(command, transfer);
  }

  private settled(id: number) {
    if (!this.sink) return Promise.resolve();
    return new Promise<void>((resolve) => this.waiting.set(id, resolve));
  }

  resize(width: number, height: number, ratio: number) {
    this.send({ type: "resize", width, height, ratio });
  }

  theme(dark: boolean, ink: Rgb) {
    this.send({ type: "theme", dark, ink });
  }

  pointer(x: number, y: number, inside: boolean) {
    this.send({ type: "pointer", x, y, inside });
  }

  /** A ripple from a point: presses, drops, arrivals. Strength about 0.3 (a tap) to 1.5 (a landing). */
  pulse(x: number, y: number, strength = 1, colour?: LightColour) {
    this.send({ type: "pulse", x, y, strength, colour });
  }

  /** Something moving through the field: drags, scrolling panels. Velocity in px/s. */
  wake(x: number, y: number, vx: number, vy: number, colour?: Rgb) {
    this.send({ type: "wake", x, y, vx, vy, colour });
  }

  /** Light held in the field around an area until stopped: something working, a drop target. */
  glow(rect: Rect, colour: LightColour, intensity = 1): GlowHandle {
    const id = this.nextId++;
    this.send({ type: "glow", id, rect, colour, intensity });
    return {
      move: (next) => this.send({ type: "glowMove", id, rect: next }),
      stop: () => this.send({ type: "glowStop", id }),
    };
  }

  /** Dots leave the field and hold a formation (a ghost of what is coming) until released. */
  gather(points: PointSet, around: Rect): GatherHandle {
    const id = this.nextId++;
    const copy = points.slice();
    this.send({ type: "gather", id, points: copy, around }, [copy.buffer]);
    return { id, release: () => this.send({ type: "release", id }) };
  }

  /** A stream of dots from one area to another. Resolves as the stream lands. */
  stream(from: Rect, to: Rect, { count = 40, colour = "spectrum" as LightColour } = {}) {
    const id = this.nextId++;
    this.send({ type: "stream", id, from, to, count, colour });
    return this.settled(id);
  }

  /** Turns a shape into loose dots. Returns the group, so `condense` can re-form them into something else. */
  dissolve(points: PointSet, { vx = 0, vy = 0, spread = 60 } = {}) {
    const id = this.nextId++;
    const copy = points.slice();
    this.send({ type: "dissolve", id, points: copy, vx, vy, spread }, [copy.buffer]);
    return id;
  }

  /**
   * Gathers dots into a shape: the group from `dissolve` if given, plus dots
   * from the field. Resolves when they have formed, which is when the real
   * element should appear under them.
   */
  condense(points: PointSet, around: Rect, { from = 0, duration = 0.6 } = {}) {
    const id = this.nextId++;
    const copy = points.slice();
    this.send({ type: "condense", id, from, points: copy, around, duration }, [copy.buffer]);
    return this.settled(id);
  }

  /** A short spray of dots from a point in a direction (radians of spread). */
  emit(x: number, y: number, dx: number, dy: number, { count = 8, spread = 0.8, colour = "spectrum" as LightColour } = {}) {
    this.send({ type: "emit", x, y, dx, dy, spread, count, colour });
  }
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
