/*
 * The page's light. Paper is quiet until something happens on it; then light
 * lands there as grain, in the colours of what is happening (a kind of work, a
 * person, the morning sun, Spectra's spectrum), and flows while it lasts.
 * Scenes describe sources of light; this module keeps them, eases them in and
 * out, and hands the drawing layer a list for each frame. Nothing here draws.
 *
 * Hues are positions on the prism's spectrum: 0 red, 1 orange, 2 yellow,
 * 3 green, 4 blue, 5 violet, and 6 the joint back to red.
 */

export const HUE = { red: 0, orange: 1, yellow: 2, green: 3, blue: 4, violet: 5 } as const;

export type Source = {
  /** An element the light sits on; its box is read every frame. */
  el?: Element | null;
  /** Where on the element (0–1 of its box), or a point in page coordinates when there is no element. */
  at?: [number, number];
  /** Page coordinates, for light that is not on an element. */
  x?: number;
  y?: number;
  /** Size of the pool in CSS pixels, across and down. With an element, defaults to its box. */
  rx?: number;
  ry?: number;
  /** How much grain, 0–1. */
  strength?: number;
  /** The hues the light moves through. */
  hues?: [number, number];
  /** How fast colour moves through the pool (0 still, 1 lively). */
  flow?: number;
  /** Fade in or out over this long (ms). */
  ease?: number;
  /** A body in the sky (the sun): a disc with an edge, rather than a pool. */
  disc?: boolean;
  /**
   * Light around an element rather than on it: it hugs the element's edges
   * (rx and ry are how far it reaches out) and goes round them through its hues.
   */
  halo?: { radius: number };
};

type Live = Required<Pick<Source, "rx" | "ry" | "strength" | "hues" | "flow" | "ease" | "disc">> &
  Pick<Source, "el" | "at" | "x" | "y" | "halo"> & {
    shown: number;
    target: number;
    sized: boolean;
    path?: { from: [number, number]; to: () => [number, number]; start: number; ms: number };
  };

export type Drawn = {
  x: number;
  y: number;
  rx: number;
  ry: number;
  strength: number;
  h0: number;
  h1: number;
  flow: number;
  /** A halo's box: half its width and height, and its corner radius. */
  box?: [number, number, number];
};

const sources = new Map<string, Live>();
const listeners = new Set<() => void>();
let counter = 0;

function wake() {
  for (const listener of listeners) listener();
}

/** Called by the drawing layer: it is told when there is light to draw. */
export function onLight(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Light on the page, or changed. Keeps whatever it is not told. */
export function shine(id: string, source: Source) {
  const was = sources.get(id);
  const next: Live = {
    rx: source.rx ?? was?.rx ?? 0,
    ry: source.ry ?? was?.ry ?? 0,
    sized: source.rx !== undefined || (was?.sized ?? false),
    strength: source.strength ?? was?.strength ?? 0.5,
    hues: source.hues ?? was?.hues ?? [0, 6],
    flow: source.flow ?? was?.flow ?? 0.5,
    ease: source.ease ?? was?.ease ?? 700,
    disc: source.disc ?? was?.disc ?? false,
    halo: source.halo ?? was?.halo,
    el: source.el === undefined ? was?.el : source.el,
    at: source.at ?? was?.at,
    x: source.x ?? was?.x,
    y: source.y ?? was?.y,
    shown: was?.shown ?? 0,
    target: source.strength ?? was?.target ?? 0.5,
    path: was?.path,
  };
  sources.set(id, next);
  wake();
}

/** Light leaves. */
export function dim(id: string, ease?: number) {
  const was = sources.get(id);
  if (!was) return;
  was.target = 0;
  if (ease !== undefined) was.ease = ease;
  wake();
}

export function dimAll(prefix: string, ease?: number) {
  for (const id of sources.keys()) if (id.startsWith(prefix)) dim(id, ease);
}

/** A short burst where something happened: it swells, then fades by itself. */
export function flash(source: Source & { hold?: number }) {
  const id = `flash-${(counter += 1)}`;
  shine(id, { ease: 260, ...source });
  window.setTimeout(() => dim(id, 1100), source.hold ?? 420);
  return id;
}

/** Light that travels from a point to an element (or a point), then settles there. */
export function travel(id: string, from: [number, number], to: Element | [number, number], source: Source & { ms?: number }) {
  const ms = source.ms ?? 900;
  const target = (): [number, number] => {
    if (Array.isArray(to)) return to;
    const box = to.getBoundingClientRect();
    const at = source.at ?? [0.5, 0.5];
    return [box.left + box.width * at[0], box.top + window.scrollY + box.height * at[1]];
  };
  shine(id, { ...source, el: null, x: from[0], y: from[1] });
  const live = sources.get(id)!;
  live.path = { from, to: target, start: performance.now(), ms };
  wake();
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Every source as it should be drawn now, in viewport coordinates, with its
 * fade advanced. Returns whether anything is still changing.
 */
export function frame(now: number, dt: number, view: { width: number; height: number; scrollY: number }) {
  const out: Drawn[] = [];
  let moving = false;
  for (const [id, live] of sources) {
    const step = dt / Math.max(16, live.ease);
    if (live.shown < live.target) live.shown = Math.min(live.target, live.shown + step);
    else if (live.shown > live.target) live.shown = Math.max(live.target, live.shown - step);
    if (live.shown !== live.target) moving = true;
    if (live.shown <= 0.001 && live.target === 0) {
      sources.delete(id);
      continue;
    }

    let x = 0;
    let y = 0;
    let rx = live.rx;
    let ry = live.ry;
    let box: Drawn["box"];
    if (live.path) {
      const t = Math.min(1, (now - live.path.start) / live.path.ms);
      const [tx, ty] = live.path.to();
      const k = smooth(t);
      x = live.path.from[0] + (tx - live.path.from[0]) * k;
      y = live.path.from[1] + (ty - live.path.from[1]) * k - view.scrollY;
      if (t < 1) moving = true;
      else {
        live.x = tx;
        live.y = ty;
        live.path = undefined;
      }
    } else if (live.el) {
      if (!live.el.isConnected) {
        live.target = 0;
        continue;
      }
      const rect = live.el.getBoundingClientRect();
      const at = live.at ?? [0.5, 0.5];
      x = rect.left + rect.width * at[0];
      y = rect.top + rect.height * at[1];
      if (live.halo) box = [rect.width / 2, rect.height / 2, live.halo.radius];
      else if (!live.sized) {
        rx = rect.width * 0.62;
        ry = rect.height * 0.62;
      }
    } else {
      x = live.x ?? 0;
      y = (live.y ?? 0) - view.scrollY;
    }
    // Light well off screen costs nothing.
    const reachX = rx * 2 + (box?.[0] ?? 0);
    const reachY = ry * 2 + (box?.[1] ?? 0);
    if (y + reachY < 0 || y - reachY > view.height || x + reachX < 0 || x - reachX > view.width) continue;
    out.push({ x, y, rx: Math.max(1, rx), ry: Math.max(1, ry), strength: live.shown * live.strength, h0: live.hues[0], h1: live.hues[1], flow: live.disc ? -Math.max(0.01, live.flow) : live.flow, box });
  }
  return { drawn: out, moving: moving || out.some((source) => source.strength > 0.001) };
}

export function anyLight() {
  return sources.size > 0;
}
