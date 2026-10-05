"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type Ref, type RefCallback, type RefObject } from "react";
import type { LightColour, Rect } from "./engine";
import { figureOf, type ElementFigureOptions } from "./figure-dom";
import type { Point } from "./figure";
import { life } from "./life";

/*
 * Life for components: the kit's hooks onto the field, so pages get the
 * choreographies of LIFE.md without touching the engine. Every hook is a
 * no-op when the field is off (reduced motion, no canvas, tests).
 */

const rectOf = (element: Element): Rect => {
  const r = element.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
};

/** Light held in the field around an element while `active`: Spectra working on it. */
export function useLifeGlow(ref: RefObject<Element | null>, active: boolean, colour: LightColour = "spectrum", intensity = 1) {
  useEffect(() => {
    const element = ref.current;
    if (!active || !element || !life.on) return;
    const glow = life.glow(rectOf(element), colour, intensity);
    let frame = 0;
    const follow = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        glow.move(rectOf(element));
      });
    };
    const observer = new ResizeObserver(follow);
    observer.observe(element);
    window.addEventListener("scroll", follow, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", follow, { capture: true });
      glow.stop();
    };
  }, [ref, active, colour, intensity]);
}

export type EntranceOptions = ElementFigureOptions & {
  /** Where its matter comes from: a click, the prism. Defaults to its own top left. */
  from?: Point;
  enabled?: boolean;
};

/**
 * Something new forms out of the field where it appears: its outline and
 * content bars rise from the dots and fuse, and the element takes over when
 * the figure is whole.
 */
export function useLifeEntrance(ref: RefObject<HTMLElement | null>, { enabled = true, from, ...figure }: EntranceOptions = {}) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element || !life.on) return;
    const formed = life.form(figureOf(element, { bars: figure.bars, rows: figure.rows, colour: figure.colour, fill: figure.fill }), {
      from: from ?? [element.getBoundingClientRect().x + 16, element.getBoundingClientRect().y + 16],
    });
    const previous = element.style.opacity;
    element.style.opacity = "0";
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      element.style.opacity = previous;
    };
    // The element never waits on the field for long.
    const fallback = window.setTimeout(show, 1400);
    void formed.formed.then(show);
    return () => {
      window.clearTimeout(fallback);
      show();
    };
    // Mount only: an entrance happens once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Something goes away: call just before the element leaves the page. Its lines part and sink where it was. */
export function unformElement(element: Element, options: ElementFigureOptions & { from?: Point } = {}) {
  if (!life.on) return Promise.resolve();
  const { from, ...figure } = options;
  return life.unform(figureOf(element, figure), { from });
}

/**
 * Something goes somewhere else: it breaks into the field, crosses it as
 * light, and forms as `to` (or is taken in by `absorb`, like the prism
 * taking a message).
 */
export function travelElement(from: Element | Point, to: Element | { absorb: Element }, options: ElementFigureOptions & { colour?: LightColour } = {}) {
  const { colour, ...figure } = options;
  const source = Array.isArray(from) ? (from as Point) : figureOf(from as Element, figure);
  const target = "absorb" in to ? { absorb: rectOf(to.absorb) } : figureOf(to, figure);
  return life.travel(source, target, { colour });
}

/* ------------------------------------------------------------ surfaces */

let lastPress: { point: Point; at: number } | null = null;
let pressWatch = false;

/** Where the user last pressed or what they last acted on from the keyboard: the cause of what opens next. */
function watchPresses() {
  if (pressWatch || typeof window === "undefined") return;
  pressWatch = true;
  window.addEventListener(
    "pointerdown",
    (event) => {
      lastPress = { point: [event.clientX, event.clientY], at: performance.now() };
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target as Element | null;
      const r = target?.getBoundingClientRect?.();
      if (r && r.width) lastPress = { point: [r.x + r.width / 2, r.y + r.height / 2], at: performance.now() };
    },
    { capture: true, passive: true },
  );
}

/** The point the user just acted at, if within the last second. */
export function recentCause(): Point | undefined {
  watchPresses();
  return lastPress && performance.now() - lastPress.at < 1000 ? lastPress.point : undefined;
}

export type SurfaceOptions = ElementFigureOptions & {
  /**
   * Hold the surface back until its figure is whole (dialogs, sheets), or let
   * it be usable at once while its dots gather onto it (menus, popovers).
   */
  wait?: boolean;
};

const SURFACE_BARS = "h1, h2, h3, [role='heading'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='option'], label";

type SurfaceState = { formed: ReturnType<typeof life.form> | null; leaving: boolean };
const surfaces = new WeakMap<Element, SurfaceState>();

/**
 * A floating surface (dialog, sheet, popover, menu) as a callback ref: it
 * forms from its cause when it mounts, and parts back into the field where
 * it was when it unmounts. Merge it with the component's own ref; a ref
 * re-attached to the same node in the same commit is not a new surface.
 */
export function useLifeSurface<T extends HTMLElement>({ wait = false, bars = SURFACE_BARS, maxBars = 14, ...figure }: SurfaceOptions = {}) {
  watchPresses();
  return useCallback(
    (node: T | null) => {
      if (!node || !life.on) return;
      const known = surfaces.get(node);
      if (known) {
        // Re-attached in the same commit: still here.
        known.leaving = false;
      } else {
        const state: SurfaceState = { formed: null, leaving: false };
        surfaces.set(node, state);
        const from = recentCause();
        const previous = node.style.opacity;
        let shown = !wait;
        if (wait) node.style.opacity = "0";
        const show = () => {
          if (shown) return;
          shown = true;
          node.style.opacity = previous;
        };
        // Measured after layout, so the figure is where the surface really is.
        requestAnimationFrame(() => {
          if (!node.isConnected) return show();
          state.formed = life.form(figureOf(node, { bars, maxBars, ...figure }), { from });
          void state.formed.formed.then(show);
        });
        window.setTimeout(show, wait ? 520 : 0);
      }
      return () => {
        const state = surfaces.get(node);
        if (!state) return;
        state.leaving = true;
        // Read while it is still in the page; part it only if React really let it go.
        const leaving = node.isConnected && node.getBoundingClientRect().width > 0 ? figureOf(node, { bars, maxBars: 6, ...figure }) : null;
        queueMicrotask(() => {
          if (!state.leaving) return;
          surfaces.delete(node);
          if (leaving) void life.unform(leaving);
          else state.formed?.release();
        });
      };
    },
    // Options are read once per surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}

/** One callback ref from several: a component's forwarded ref and its own. */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node: T | null) => {
    const undo: Array<() => void> = [];
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") {
        const cleanup = ref(node);
        undo.push(typeof cleanup === "function" ? cleanup : () => ref(null));
      } else {
        (ref as RefObject<T | null>).current = node;
        undo.push(() => {
          (ref as RefObject<T | null>).current = null;
        });
      }
    }
    return () => undo.forEach((step) => step());
  };
}

/* ------------------------------------------------------------ arrivals */

let navigatedAt = 0;
const arrived = new Set<string>();

/** The page changed: what appears in the next moment is the page, not arrivals. */
export function markNavigation() {
  navigatedAt = typeof performance === "undefined" ? 0 : performance.now();
}

/** Where the prism is, for light that leaves it. */
export function prismPoint(): Point {
  const prism = typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-island] canvas");
  const r = prism?.getBoundingClientRect();
  return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2] : [window.innerWidth / 2, window.innerHeight - 40];
}

export type ArrivalKind = "ai" | "human";

/**
 * Something new in a list or a board (LIFE.md, "Create by hand" and
 * "Spectra creates an artifact"): the first time `key` appears after the page
 * has settled, it forms there, from what the user did, or, when Spectra made
 * it, from light that leaves the prism and crosses the field to it. What was
 * there when the page opened is simply content, and a key forms only once
 * per visit, so scrolling a long list never replays it.
 */
export function useLifeArrival(ref: RefObject<HTMLElement | null>, key: string | undefined, kind: ArrivalKind | undefined, figure: ElementFigureOptions = {}) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!key || !element) return;
    if (arrived.has(key)) return;
    arrived.add(key);
    if (!kind || !life.on) return;
    const settling = performance.now() - navigatedAt < 1600;
    if (settling && kind !== "ai") return;
    const previous = element.style.opacity;
    element.style.opacity = "0";
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      element.style.opacity = previous;
    };
    const shape = figureOf(element, { bars: "h2, h3, h4, [data-card-title], p", maxBars: 6, ...figure });
    if (kind === "ai") {
      const trip = life.travel(prismPoint(), shape, { colour: "spectrum" });
      void trip.formed.then(() => {
        show();
        const r = element.getBoundingClientRect();
        life.pulse(r.left + r.width / 2, r.top + r.height / 2, 0.7, "spectrum");
      });
    } else {
      void life.form(shape, { from: recentCause() }).formed.then(show);
    }
    const fallback = window.setTimeout(show, kind === "ai" ? 1700 : 800);
    return () => {
      window.clearTimeout(fallback);
      show();
    };
    // Once per key: an arrival is a moment, not a state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/* ------------------------------------------------------------ departures */

/** More leaving at once than this is a change of view (a filter, a folder), not things being removed. */
const DEPARTURE_BATCH = 4;
let departures: Array<() => void> = [];
let departureFrame = 0;

function flushDepartures() {
  departureFrame = 0;
  const batch = departures;
  departures = [];
  if (batch.length > DEPARTURE_BATCH || performance.now() - navigatedAt < 400) return;
  for (const leave of batch) leave();
}

/**
 * Something removed from a list or a board parts where it was (LIFE.md,
 * "Delete"): its outline and lines break into dots that fall back into the
 * field. It is measured while it is still there, and it only parts if it
 * really left the page: not when the page changed, not when React mounts it
 * again, and not when a whole view changes at once.
 */
export function useLifeDeparture(ref: RefObject<HTMLElement | null>, enabled = true, figure: ElementFigureOptions = {}) {
  const enabledRef = useRef(enabled);
  const figureRef = useRef(figure);
  useEffect(() => {
    enabledRef.current = enabled;
    figureRef.current = figure;
  });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return () => {
      if (!enabledRef.current || !life.on || !element.isConnected) return;
      const r = element.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > window.innerHeight) return;
      const shape = figureOf(element, { bars: "h2, h3, h4, [data-card-title], [data-row-title], p", maxBars: 6, ...figureRef.current });
      const where = window.location.pathname + window.location.search;
      departures.push(() => {
        if (element.isConnected || window.location.pathname + window.location.search !== where) return;
        void life.unform(shape);
      });
      if (!departureFrame) departureFrame = requestAnimationFrame(flushDepartures);
    };
  }, [ref]);
}
