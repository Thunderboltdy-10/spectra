"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type Ref, type RefCallback, type RefObject } from "react";
import type { LightColour, Rect } from "./engine";
import { figureOf, hasVisibleFrame, replacementOf, type ElementFigureOptions } from "./figure-dom";
import { isVeiled, veil } from "./veil";
import { outlineFigure, rowsFigure, type Figure, type Point } from "./figure";
import { life, type Formed, type GlowHandle } from "./life";
import { STATUS_COLOURS } from "./prism";

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
    const show = veil(element);
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
let launch: { figure: Figure | Formed; at: number } | null = null;
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

/** What ticks something off: a task's done control, a checklist item in a work. */
export const DONE_TICKS = "[data-life-done], li[data-type='taskItem']";

/** Something was ticked off here: the paper answers with a pulse in the done colour (LIFE.md, pulse). */
function doneAt(element: Element) {
  if (!life.on) return;
  const r = element.getBoundingClientRect();
  if (!r.width) return;
  life.pulse(r.left + r.width / 2, r.top + r.height / 2, 0.8, STATUS_COLOURS.done);
}

/** Where the user last pressed, dropped, or acted from the keyboard: the cause of what appears next. */
function watchPresses() {
  if (pressWatch || typeof window === "undefined") return;
  pressWatch = true;
  // A checkbox that became checked, or a done control pressed while it was not done yet.
  window.addEventListener(
    "change",
    (event) => {
      const box = event.target as HTMLInputElement | null;
      if (box?.type === "checkbox" && box.checked && box.closest(DONE_TICKS)) doneAt(box);
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "click",
    (event) => {
      const control = (event.target as Element | null)?.closest?.("button[data-life-done], [role='checkbox'][data-life-done]");
      if (!control || control.matches(":disabled")) return;
      const state = control.getAttribute("aria-checked") ?? control.getAttribute("aria-pressed");
      if (state !== "true") doneAt(control);
    },
    { capture: true, passive: true },
  );
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

/* ------------------------------------------------------------ creation */

export type Creation = {
  /**
   * It exists now: what it becomes (the surface that opens, or the item that
   * arrives) grows out of the gathered dots. `key`, for an item: the arrival
   * key of exactly what was made, so only it claims them.
   */
  land(key?: string): void;
  /** It was not made: the dots part where they gathered. */
  cancel(): void;
};

export type CreationOptions = {
  /** Where the dots gather. Defaults to the last press. */
  from?: Point;
  /**
   * What it becomes: a `surface` that opens (a work's studio, landing through
   * `useLifeLanding`), or an `item` that arrives in a list (an event, a
   * comment, arriving through `useLifeArrival` as "human").
   */
  into?: "surface" | "item";
};

const NO_CREATION: Creation = { land() {}, cancel() {} };

/** A gathered item waiting for the row it becomes: the one under `key`, or without one the next made by hand. */
let seeded: { figure: Formed; at: number; key?: string } | null = null;

function takeSeed(key: string, kind: ArrivalKind | undefined): Formed | null {
  if (!seeded || performance.now() - seeded.at > LAUNCH_WINDOW_MS) return null;
  if (seeded.key ? seeded.key !== key : kind !== "human") return null;
  const { figure } = seeded;
  seeded = null;
  return figure;
}

/**
 * Making something by hand (LIFE.md, "Create by hand"): while the request is
 * on its way, dots gather where the user acted into the outline of what is
 * being made, breathing light. When it exists, what it becomes morphs out of
 * them; if it fails, they part.
 */
export function beginCreation({ from, into = "surface" }: CreationOptions = {}): Creation {
  if (!life.on) return NO_CREATION;
  const [x, y] = from ?? recentCause() ?? [window.innerWidth / 2, window.innerHeight / 2];
  const [width, height] = into === "surface" ? [128, 88] : [112, 40];
  const rect = { x: x - width / 2, y: y - height / 2, width, height };
  const outline = outlineFigure(rect, { radius: into === "surface" ? 12 : 8 });
  const rows = rowsFigure(rect, into === "surface" ? [0.62, 0.86, 0.48] : [0.7]);
  const seed = life.ghost({ strokes: [...outline.strokes, ...rows.strokes] }, { from: [x, y] });
  let settled = false;
  return {
    land(key) {
      if (settled) return;
      settled = true;
      const at = performance.now();
      if (into === "surface") launch = { figure: seed, at };
      else seeded = { figure: seed, at, key };
      // Nothing grew from it in time: the dots go back to the field.
      window.setTimeout(() => {
        if (launch?.figure === seed) launch = null;
        if (seeded?.figure === seed) seeded = null;
        seed.release();
      }, LAUNCH_WINDOW_MS);
    },
    cancel() {
      if (settled) return;
      settled = true;
      void life.unform(seed);
    },
  };
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
        const show = wait ? veil(node) : () => {};
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
    const back = takeReturn(key);
    if (back) {
      arrived.add(key);
      return foldInto(element, back, figure);
    }
    const moved = takeDeparture(key);
    if (moved) {
      arrived.add(key);
      return moveInto(element, moved, figure);
    }
    if (arrived.has(key)) return;
    arrived.add(key);
    if (!life.on) return;
    // Made by hand just now: it grows out of the dots that gathered while it was on its way.
    const seed = takeSeed(key, kind);
    if (!seed) {
      if (!kind) return;
      const settling = performance.now() - navigatedAt < 1600;
      if (settling && kind !== "ai") return;
    }
    const show = veil(element);
    const shape = figureOf(element, { bars: "h2, h3, h4, [data-card-title], p", maxBars: 6, ...figure });
    if (seed) {
      void life.morph(seed, shape).formed.then(show);
    } else if (kind === "ai") {
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
/** Something that left this frame, as it looked: an arrival under the same key means it moved. */
type Departure = { key?: string; shape: Figure; rect: Rect; leave: () => void };

/** The lines of whatever takes a place over. */
const TAKEOVER_BARS = "h1, h2, h3, h4, [data-row-title], [data-card-title], p, li";
let departures: Departure[] = [];
let departureFrame = 0;
/** Moves travelled this frame. More than a few at once is a re-sort, which simply lands. */
let movesThisFrame = 0;
const MOVE_BATCH = 4;

function flushDepartures() {
  departureFrame = 0;
  movesThisFrame = 0;
  const batch = departures;
  departures = [];
  if (batch.length > DEPARTURE_BATCH || performance.now() - navigatedAt < 400) return;
  for (const departure of batch) departure.leave();
}

/** The departure under `key` from this frame, taken so it no longer parts: the thing moved, it did not go. */
function takeDeparture(key: string): Departure | null {
  const index = departures.findIndex((departure) => departure.key === key);
  return index < 0 ? null : departures.splice(index, 1)[0];
}

/**
 * Something moved (LIFE.md, travel): to another column, another day, a
 * folder. Its old shape breaks into the field, crosses it as light and forms
 * as it is now; it is hidden until it has. A move in place, or one of many at
 * once (a re-sort), just lands.
 */
function moveInto(element: HTMLElement, from: Departure, figure: ElementFigureOptions) {
  const r = element.getBoundingClientRect();
  if (!life.on || ++movesThisFrame > MOVE_BATCH || !r.width || replaced(from.rect, r)) return;
  const show = veil(element);
  const frame = requestAnimationFrame(() => {
    if (!element.isConnected) return show();
    const shape = figureOf(element, { bars: "h2, h3, h4, [data-card-title], [data-row-title], p", maxBars: 6, ...figure });
    void life.travel(from.shape, shape, { colour: "spectrum" }).formed.then(show);
  });
  const fallback = window.setTimeout(show, 1100);
  return () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(fallback);
    show();
  };
}

/**
 * Something removed from a list or a board parts where it was (LIFE.md,
 * "Delete"): its outline and lines break into dots that fall back into the
 * field. It is measured while it is still there, and it only parts if it
 * really left the page: not when the page changed, not when React mounts it
 * again, and not when a whole view changes at once.
 */
/** `key` names what it shows: if the same key arrives elsewhere in the same commit, it moved, and travels there instead. */
export function useLifeDeparture(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean | (() => boolean) = true,
  figure: ElementFigureOptions = {},
  key?: string,
) {
  useDeparture(ref, enabled, figure, key, false);
}

/**
 * Something that stands in until there is content (LIFE.md, Hand over): an
 * empty state, a "nothing yet" line. When it goes and something takes its
 * place, its dots flow into that and become its lines; with nothing there,
 * it parts like any departure.
 */
export function useLifeHandover(ref: RefObject<HTMLElement | null>, figure: ElementFigureOptions = {}) {
  useDeparture(ref, true, figure, undefined, true);
}

function useDeparture(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean | (() => boolean),
  figure: ElementFigureOptions,
  key: string | undefined,
  handover: boolean,
) {
  const keyRef = useRef(key);
  const enabledRef = useRef(enabled);
  const figureRef = useRef(figure);
  useEffect(() => {
    enabledRef.current = enabled;
    figureRef.current = figure;
    keyRef.current = key;
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
      departures.push({
        key: keyRef.current,
        shape,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        leave: () => {
          if (element.isConnected || window.location.pathname + window.location.search !== where) return;
          const content = handover ? replacementOf(new DOMRect(r.x, r.y, r.width, r.height)) : null;
          // Whatever arrives there may be forming itself (hidden until it has): then it brings its own light.
          if (content && !isVeiled(content)) {
            void life.morph(shape, figureOf(content, { bars: TAKEOVER_BARS, maxBars: 12, frame: hasVisibleFrame(content) }));
          } else {
            void life.unform(shape);
          }
        },
      });
      if (!departureFrame) departureFrame = requestAnimationFrame(flushDepartures);
    };
  }, [ref, handover]);
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

/** Replies whose light has already come out of the prism. */
const writingFromPrism = new WeakSet<Element>();
/** The writing front never waits on the crossing for longer than this. */
export const WRITING_ARRIVAL_MS = 900;

/**
 * Spectra writing in a thread (MOTION.md, "Streaming text"; LIFE.md, travel):
 * when a reply starts, light leaves the prism and crosses the field to where
 * the words begin. From there a little light follows the writing front while
 * words arrive, so the paper around the text feels the writing. When the reply
 * is complete it lets go, and the paper pulses softly where the words settled.
 */
export function useWritingFront(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root || !life.on) return;
    let glow: GlowHandle | null = null;
    let last = 0;
    let frame = 0;
    let settledAt: DOMRect | null = null;
    let arrived = true;
    let fallback = 0;
    if (!writingFromPrism.has(root)) {
      writingFromPrism.add(root);
      const start = root.getBoundingClientRect();
      if (start.width) {
        arrived = false;
        const land = () => {
          arrived = true;
          window.clearTimeout(fallback);
        };
        fallback = window.setTimeout(land, WRITING_ARRIVAL_MS);
        void life.send(prismPoint(), [start.left + 12, start.top + 12], { colour: "spectrum", strength: 0.6 }).then(land);
      }
    }
    const follow = (now: number) => {
      frame = requestAnimationFrame(follow);
      if (!arrived || now - last < 90) return;
      last = now;
      const end = writingEnd(root);
      if (!end || (!end.width && !end.height)) return;
      settledAt = end;
      const rect = { x: end.right - 36, y: end.top - 8, width: 48, height: end.height + 16 };
      if (glow) glow.move(rect);
      else glow = life.glow(rect, "spectrum", 0.55);
    };
    frame = requestAnimationFrame(follow);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
      glow?.stop();
      // Still on the page: the reply is complete, not gone.
      if (settledAt && root.isConnected && life.on) life.pulse(settledAt.right, settledAt.top + settledAt.height / 2, 0.35, "spectrum");
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
    const show = veil(element);
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

/** How long after a work closes its card may still appear to take it back: the page it returns to loads first. */
const RETURN_WINDOW_MS = 1600;
let returning: { key: string; figure: Figure; at: number } | null = null;

function takeReturn(key: string): Figure | null {
  if (!returning || returning.key !== key || performance.now() - returning.at > RETURN_WINDOW_MS) return null;
  const { figure } = returning;
  returning = null;
  return figure;
}

/** The card is hidden while the closing work's dots flow back into its frame, and is real when they have. */
function foldInto(element: HTMLElement, from: Figure, figure: ElementFigureOptions = {}) {
  const show = veil(element);
  const frame = requestAnimationFrame(() => {
    const r = element.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > window.innerHeight) return show();
    void life.morph(from, figureOf(element, { bars: LAUNCH_BARS, maxBars: 6, ...figure })).formed.then(show);
  });
  const fallback = window.setTimeout(show, 900);
  return () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(fallback);
    show();
  };
}

/** Two rects mostly over each other: another surface took this one's place. */
function replaced(a: Rect, b: DOMRect) {
  const w = Math.min(a.x + a.width, b.right) - Math.max(a.x, b.left);
  const h = Math.min(a.y + a.height, b.bottom) - Math.max(a.y, b.top);
  return w > 0 && h > 0 && w * h > 0.5 * a.width * a.height;
}

/**
 * The reverse of a landing (MOTION.md, "Shared elements"): when an opened
 * surface closes, its dots flow back into the card it shows, if that card is
 * on the page, or into the card as it appears on the page the user returns to.
 * A surface replaced by another in the same place (switching tabs) does not
 * fold.
 */
/** `replacedBy` names the surfaces that can take this one's place. */
export function useLifeReturn(ref: RefObject<HTMLElement | null>, key: string | null | undefined, replacedBy: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!key || !element) return;
    return () => {
      if (!life.on || !element.isConnected) return;
      const r = element.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const from = figureOf(element, { bars: "h1, h2, [data-artifact-title]", maxBars: 6 });
      const rect = rectOf(element);
      const at = performance.now();
      requestAnimationFrame(() => {
        if (element.isConnected) return;
        for (const other of document.querySelectorAll(replacedBy)) {
          if (replaced(rect, other.getBoundingClientRect())) return;
        }
        const card = document.querySelector<HTMLElement>(`[data-life-key="${key.replace(/["\\]/g, "\\$&")}"]`);
        if (card?.isConnected) {
          foldInto(card, from);
          return;
        }
        returning = { key, figure: from, at };
      });
    };
  }, [ref, key, replacedBy]);
}
