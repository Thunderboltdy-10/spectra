"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type Ref, type RefCallback, type RefObject } from "react";
import type { LightColour, Rect } from "./engine";
import { figureOf, type ElementFigureOptions } from "./figure-dom";
import type { Figure, Point } from "./figure";
import { life, type GlowHandle } from "./life";

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
/** The card or row the user just opened something from: what opens next grows out of it (MOTION.md, "Shared elements"). */
let launch: { figure: Figure; at: number } | null = null;
const LAUNCHERS = "[data-spectra-card], [data-life-launch]";
const LAUNCH_BARS = "h2, h3, h4, [data-card-title], [data-row-title], [data-thread-title], p";

/** Open the next surface out of `element` (a Side panel going full, say), whatever was pressed. */
export function launchFrom(element: Element | null | undefined) {
  if (element && life.on) launch = { figure: figureOf(element, { bars: LAUNCH_BARS, maxBars: 6 }), at: performance.now() };
}

function rememberLaunch(target: EventTarget | null) {
  const launcher = (target as Element | null)?.closest?.(LAUNCHERS);
  if (launcher && life.on) launch = { figure: figureOf(launcher, { bars: LAUNCH_BARS, maxBars: 6 }), at: performance.now() };
}

/** Where the user last pressed, dropped, or acted from the keyboard: the cause of what appears next. */
function watchPresses() {
  if (pressWatch || typeof window === "undefined") return;
  pressWatch = true;
  window.addEventListener(
    "pointerdown",
    (event) => {
      lastPress = { point: [event.clientX, event.clientY], at: performance.now() };
      rememberLaunch(event.target);
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
      rememberLaunch(target);
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "drop",
    (event) => {
      lastPress = { point: [event.clientX, event.clientY], at: performance.now() };
    },
    { capture: true, passive: true },
  );
  // "Add A to B" by dragging: remember A, and once B has taken the drop, light crosses into it.
  window.addEventListener(
    "dragstart",
    (event) => {
      const source = (event.target as Element | null)?.closest?.("[draggable='true'], [data-spectra-card], [data-row-title]") ?? (event.target as Element | null);
      dragFrom = source?.getBoundingClientRect ? rectOf(source) : null;
      // Picked up (MOTION.md, "Drag and drop"): where it came from stays as a quiet hole while it is carried. After
      // the browser has taken its drag image, so the image is the whole item.
      if (source instanceof HTMLElement) requestAnimationFrame(() => dragFrom && source.setAttribute("data-life-picked", ""));
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "dragend",
    () => {
      dragFrom = null;
      document.querySelectorAll("[data-life-picked]").forEach((element) => element.removeAttribute("data-life-picked"));
    },
    { passive: true },
  );
  // Bubble phase: by now the page has handled the drop, and preventDefault says it was taken.
  window.addEventListener("drop", (event) => {
    const from = dragFrom;
    dragFrom = null;
    if (!from || !event.defaultPrevented || !life.on) return;
    const receiver = (event.target as Element | null)?.closest?.(RECEIVERS);
    sendInto(receiver ?? [event.clientX, event.clientY], from);
  });
}

let dragFrom: Rect | null = null;
/** Lists, folders and cards that take things in. Without one, a drop takes the light where it landed. */
const RECEIVERS = "[data-life-receive]";

/**
 * "Add A to B" (LIFE.md, send): light alone crosses the field from A, or from
 * where the user just acted, into B, which takes it in and pulses. A move by
 * a menu, a drop, or Spectra filing something all read the same way.
 */
/** `from` defaults to where the user just acted; `null` means it came from nowhere on screen. */
export function sendInto(target: Element | Point | null | undefined, from?: Element | Point | Rect | null) {
  if (!target || !life.on) return;
  const to = Array.isArray(target) ? (target as Point) : (target as Element).isConnected ? rectOf(target as Element) : null;
  if (!to || (!Array.isArray(to) && (!(to as Rect).width || !(to as Rect).height))) return;
  const [x, y] = Array.isArray(to) ? (to as Point) : [(to as Rect).x + (to as Rect).width / 2, (to as Rect).y + (to as Rect).height / 2];
  const origin = from === undefined ? recentCause() : from;
  const source = origin instanceof Element ? rectOf(origin) : origin;
  if (!source) {
    life.pulse(x, y, 0.7);
    return;
  }
  void life.send(source, to, { absorb: !Array.isArray(to), strength: 0.8 }).then(() => life.pulse(x, y, 0.7));
}

// Watch from the start, so the very first press is a cause too.
watchPresses();

/**
 * Something acted at `point` that was not a press: Spectra's spark working a
 * control when it drives the interface. What appears next forms from there.
 */
export function markCause(point: Point) {
  lastPress = { point, at: performance.now() };
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
  const prism = typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-island-prism]");
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
export function useLifeDeparture(ref: RefObject<HTMLElement | null>, enabled: boolean | (() => boolean) = true, figure: ElementFigureOptions = {}) {
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
      const departs = typeof enabledRef.current === "function" ? enabledRef.current() : enabledRef.current;
      if (!departs || !life.on || !element.isConnected) return;
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

/* ------------------------------------------------------------ writing front */

/** The last text with something written in it, found from the end, so a long reply costs no more than a short one. */
function lastWritten(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").trim() ? (node as Text) : null;
  for (let child = node.lastChild; child; child = child.previousSibling) {
    const found = lastWritten(child);
    if (found) return found;
  }
  return null;
}

/** Where the last written character of `root` ends, on screen. */
function writingEnd(root: Element): DOMRect | null {
  const last = lastWritten(root);
  if (!last) return null;
  const range = document.createRange();
  const length = last.length;
  range.setStart(last, Math.max(0, length - 1));
  range.setEnd(last, length);
  const rects = range.getClientRects();
  return rects.length ? rects[rects.length - 1] : null;
}

/**
 * Spectra writing in a thread (MOTION.md, "Streaming text"): a little light in
 * the field follows the writing front while words arrive, so the paper around
 * the text feels the writing, and lets go when the reply is complete.
 */
export function useWritingFront(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root || !life.on) return;
    let glow: GlowHandle | null = null;
    let last = 0;
    let frame = 0;
    const follow = (now: number) => {
      frame = requestAnimationFrame(follow);
      if (now - last < 90) return;
      last = now;
      const end = writingEnd(root);
      if (!end || (!end.width && !end.height)) return;
      const rect = { x: end.right - 36, y: end.top - 8, width: 48, height: end.height + 16 };
      if (glow) glow.move(rect);
      else glow = life.glow(rect, "spectrum", 0.55);
    };
    frame = requestAnimationFrame(follow);
    return () => {
      cancelAnimationFrame(frame);
      glow?.stop();
    };
  }, [ref, active]);
}

/* ------------------------------------------------------------ shared elements */

/** How long after the press an opening still grows from the card: works load before they open. */
const LAUNCH_WINDOW_MS = 2500;

/**
 * Something opened from a card or a row (MOTION.md, "Shared elements"): the
 * card's dots flow out of its frame and into the surface that opens, then the
 * surface is real. Call it on the opened surface, keyed by what it shows, so a
 * new key lands and the same key re-rendering does not. Without a recent
 * launch it does nothing; the surface's own entrance stands.
 */
export function useLifeLanding(ref: RefObject<HTMLElement | null>, key: string | null | undefined, figure: ElementFigureOptions = {}) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!key || !element || !life.on || !launch || performance.now() - launch.at > LAUNCH_WINDOW_MS) return;
    const from = launch.figure;
    launch = null;
    const previous = element.style.opacity;
    element.style.opacity = "0";
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      element.style.opacity = previous;
    };
    // A frame later, the surface has its final layout to grow into.
    const frame = requestAnimationFrame(() => {
      const target = figureOf(element, { bars: "h1, h2, [data-artifact-title], [data-thread-title], [data-panel-title]", maxBars: 8, ...figure });
      void life.morph(from, target).formed.then(show);
    });
    const fallback = window.setTimeout(show, 900);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
      show();
    };
    // Once per key: a landing is a moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
