"use client";

import { useEffect, type RefObject } from "react";
import { life, type Rect } from "../life/life";
import { markArrival, markWorking } from "../life/use-life";
import { barsOf, figureOf, inkOf } from "../life/figure-dom";
import { outlineFigure, rowsFigure, type Figure, type Point } from "../life/figure";

/*
 * The field in editors (LIFE.md "In editors", EDITORS.md "All editors").
 *
 * Things in a work behave as physical things made of the field:
 * - something new forms out of the field where it was made: from your
 *   pointer, or from a collaborator's (or Spectra's) cursor; your own typing
 *   and what arrives with no one making it (a save, a sync) never animate; what
 *   Spectra writes without a cursor is crossed once by the skeleton's band
 *   as it lands, the way loaded content settles;
 * - a deletion unforms where the thing was;
 * - a region Spectra is writing carries the band while it works
 *   (spectra-field.css, "the band"), never loose dots;
 * - drags leave a wake, and a drop settles with a pulse.
 *
 * Over content every figure hands over within about 600 ms (the engine's
 * formation timing). The observer does no work while the field is off, and
 * at most a few moments run per frame, so a large re-render never floods it.
 */

/** Objects of every editor, by the classes they already carry. */
export const FIELD_OBJECTS = [
  "[data-life-object]",
  ".spectra-item-rail-list > li",
  ".whiteboard-node",
  ".presentation-object",
  ".timetable-event",
  ".sheets-chart-object",
  ".foundry-skill",
  ".foundry-pair",
  ".ProseMirror > :is(table, .tableWrapper, figure, img, hr, pre, [data-type])",
].join(", ");

/** Text blocks: they form as their lines, and only when someone else wrote them. */
export const FIELD_TEXT_BLOCKS = ".ProseMirror > :is(p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol)";

const AI_REGION = '[data-ai-region="true"]';
/** Collaborators' cursors, and Spectra's spark when it drives the interface. */
const CURSORS = ".spectra-presence-cursor, .spectra-ai-spark";
/** Spectra's light in the island: where its matter comes from when it has no cursor here. */
const HOME = "[data-island-home]";

/** Mounting, switching a slide or a tab: the content arrives at once, and is not "made". */
export const WARM_UP_MS = 900;
/** An addition this soon after your own press or key is yours. */
export const LOCAL_WINDOW_MS = 600;
/** More additions than this in one batch is a re-render, not an edit. */
export const BULK_BATCH = 12;
/** At most this many moments run per frame. */
export const MAX_MOMENTS = 4;
/** How long a dropped thing takes to settle (MOTION.md --motion-slow). */
const SETTLE_MS = 360;
/** At most this many regions carry the band at once. */
export const MAX_GLOWS = 3;
/** What Spectra changed counts as seen after this long half in view (MOTION.md, "Afterwards"). */
export const SEEN_MS = 1500;
/** Without a way to tell what is in view, the tint simply fades after this long. */
export const UNSEEN_FALLBACK_MS = 4000;
/** The tint's fade, before its mark is removed (--motion-slow and a little). */
const FADE_MS = 700;
/** At most this many changed regions hold a tint. */
const MAX_UNSEEN = 24;
/** At most this many regions carry the spectral band at once. */
export const MAX_BANDS = 3;
/** The band's fade when the writing is done (--motion-slow). */
const BAND_FADE_MS = 360;

export type MomentSource =
  | { kind: "local"; point: Point }
  | { kind: "peer"; point: Point; ai: boolean }
  | { kind: "prism"; point: Point }
  | { kind: "self" };

/** Where a change's matter comes from (LIFE.md: "it rises from the field at its cause"). */
export function chooseSource({
  local,
  cursors,
  aiActive,
  prism,
  target,
}: {
  /** Your last press or caret, when it was recent. */
  local: Point | null;
  /** The people in this work, and Spectra's cursor when it acts like one. */
  cursors: readonly { point: Point; ai: boolean }[];
  aiActive: boolean;
  prism: Point | null;
  target: Rect;
}): MomentSource {
  if (local) return { kind: "local", point: local };
  const centre: Point = [target.x + target.width / 2, target.y + target.height / 2];
  let nearest: { point: Point; ai: boolean } | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const cursor of cursors) {
    const distance = Math.hypot(cursor.point[0] - centre[0], cursor.point[1] - centre[1]);
    if (distance < best) {
      best = distance;
      nearest = cursor;
    }
  }
  if (nearest) return { kind: "peer", point: nearest.point, ai: nearest.ai };
  if (aiActive && prism) return { kind: "prism", point: prism };
  return { kind: "self" };
}

export type BatchPlan = {
  forms: Element[];
  unforms: Element[];
};

/**
 * Which additions form and which removals unform. A batch bigger than a
 * person's edit is a re-render; a removal and an addition of the same kind
 * in one batch is an edit in place (the new content forms, nothing unforms);
 * your own new paragraphs never animate (typing Enter is not an event).
 */
export function planBatch({
  added,
  removed,
  local,
  isText,
}: {
  added: readonly Element[];
  removed: readonly Element[];
  local: boolean;
  isText: (element: Element) => boolean;
}): BatchPlan {
  if (added.length > BULK_BATCH || removed.length > BULK_BATCH) return { forms: [], unforms: [] };
  const forms = added.filter((element) => !(local && isText(element)));
  const replaced = new Set<Element>();
  const pending = [...added];
  for (const element of removed) {
    const twin = pending.findIndex((candidate) => candidate.tagName === element.tagName && isText(candidate) === isText(element));
    if (twin >= 0) {
      replaced.add(element);
      pending.splice(twin, 1);
    }
  }
  const unforms = removed.filter((element) => !replaced.has(element) && !isText(element));
  return { forms: forms.slice(0, MAX_MOMENTS), unforms: unforms.slice(0, MAX_MOMENTS) };
}

const rectOf = (element: Element): Rect => {
  const r = element.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
};

const centreOf = (rect: Rect | DOMRect): Point => [rect.x + rect.width / 2, rect.y + rect.height / 2];

const visible = (rect: Rect) =>
  rect.width > 1 &&
  rect.height > 1 &&
  rect.y + rect.height > 0 &&
  rect.x + rect.width > 0 &&
  rect.y < window.innerHeight &&
  rect.x < window.innerWidth;

/** The figure of new content: its frame (when it has one) and its lines of text. */
export function contentFigure(element: Element, text: boolean): Figure {
  if (text) {
    const strokes = barsOf(element).map((stroke) => ({ ...stroke, alpha: Math.max(stroke.alpha, 0.22) }));
    return { strokes };
  }
  return figureOf(element, { bars: "p, span, strong, em, h1, h2, h3, h4, li, td, th, img, i" });
}

/** A figure for something that has already left the page, from its last place. */
function ghostFigure(rect: Rect, radius: number): Figure {
  const ink = inkOf();
  const outline = outlineFigure(rect, { radius, colour: ink, alpha: 0.3 });
  const rows = rect.height > 28 ? rowsFigure(rect, [0.7, 0.45], { colour: ink }) : { strokes: [] };
  return { strokes: [...outline.strokes, ...rows.strokes] };
}

function collect(nodes: Iterable<Node>, matches: (element: Element) => boolean, into: Element[]) {
  for (const node of nodes) {
    if (!(node instanceof Element)) continue;
    if (matches(node)) {
      into.push(node);
      continue;
    }
    // A container that arrived with objects inside (a list, a section).
    for (const inner of node.querySelectorAll(`${FIELD_OBJECTS}, ${FIELD_TEXT_BLOCKS}`)) {
      into.push(inner);
      if (into.length > BULK_BATCH) return;
    }
  }
}

export function useEditorFieldMoments(rootRef: RefObject<HTMLElement | null>, { enabled = true }: { enabled?: boolean } = {}) {
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root || typeof MutationObserver === "undefined") return;
    const mountedAt = performance.now();
    const inContent = (element: Element) => Boolean(element.closest(".spectra-artifact-main")) && !element.closest("[inert], [aria-hidden='true']");
    const isText = (element: Element) => element.matches(FIELD_TEXT_BLOCKS);
    const isObject = (element: Element) => element.matches(FIELD_OBJECTS) || isText(element);

    /* Your own last act: where your matter comes from. */
    let localAt = -Infinity;
    let localPoint: Point | null = null;
    const markLocal = (point: Point | null) => {
      localAt = performance.now();
      localPoint = point;
    };
    const caretPoint = (): Point | null => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return null;
      const box = selection.getRangeAt(0).getBoundingClientRect();
      return box.width || box.height ? [box.x, box.y + box.height / 2] : null;
    };
    // Yours by timing alone: a caret on a fresh empty line has no box, and that Enter is still yours.
    const isLocal = () => performance.now() - localAt < LOCAL_WINDOW_MS;
    const recentLocal = (): Point | null => {
      if (!isLocal()) return null;
      const box = root.getBoundingClientRect();
      return localPoint ?? caretPoint() ?? [box.x + box.width / 2, box.y + 40];
    };

    /* Last places of what is on screen, so a deletion can unform where it was. */
    const lastPlace = new WeakMap<Element, { rect: Rect; radius: number }>();
    let rememberedAt = -Infinity;
    const remember = (force = false) => {
      const now = performance.now();
      // Typing changes the page every key; the places only need to be fresh.
      if (!force && now - rememberedAt < 250) return;
      rememberedAt = now;
      for (const element of root.querySelectorAll(FIELD_OBJECTS)) {
        if (!inContent(element)) continue;
        const rect = rectOf(element);
        if (!visible(rect)) continue;
        const previous = lastPlace.get(element);
        lastPlace.set(element, {
          rect,
          radius: previous?.radius ?? (Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 6),
        });
      }
    };

    const sourceFor = (target: Rect): MomentSource => {
      const cursors: { point: Point; ai: boolean }[] = [];
      for (const cursor of document.querySelectorAll(CURSORS)) {
        const box = cursor.getBoundingClientRect();
        if (box.width || box.height) cursors.push({ point: [box.x, box.y], ai: cursor.getAttribute("data-ai") === "true" || cursor.classList.contains("spectra-ai-spark") });
      }
      const prismElement = document.querySelector(HOME);
      const prismBox = prismElement?.getBoundingClientRect();
      return chooseSource({
        local: recentLocal(),
        cursors,
        aiActive: Boolean(root.querySelector(AI_REGION)) || root.hasAttribute("data-ai-lifecycle"),
        prism: prismBox && prismBox.width ? centreOf(prismBox) : null,
        target,
      });
    };

    let formedThisFrame = new Set<Element>();
    const formHere = (element: Element) => {
      if (formedThisFrame.has(element)) return;
      formedThisFrame.add(element);
      const rect = rectOf(element);
      if (!visible(rect)) return;
      const figure = contentFigure(element, isText(element));
      if (!figure.strokes.length) return;
      const source = sourceFor(rect);
      // Nobody made it here: a save coming back, a sync or a re-render. It simply is there.
      if (source.kind === "self") return;
      if (source.kind === "prism") {
        markArrival(element);
      } else {
        life.form(figure, {
          from: source.point,
          // Yours and a person's are ink; Spectra's is its light.
          colour: source.kind === "peer" && source.ai ? "spectrum" : inkOf(),
        });
      }
    };

    const unformThere = (element: Element) => {
      const place = lastPlace.get(element);
      if (!place || !visible(place.rect)) return;
      const local = recentLocal();
      void life.unform(ghostFigure(place.rect, place.radius), { from: local ?? centreOf(place.rect) });
    };

    /* The band across what Spectra is writing. */
    const glows = new Map<Element, () => void>();
    const syncGlows = (justMarked: readonly Element[]) => {
      for (const [element, release] of glows) {
        if (!element.isConnected || element.getAttribute("data-ai-region") !== "true") {
          release();
          glows.delete(element);
        }
      }
      for (const element of justMarked) {
        if (glows.size >= MAX_GLOWS || glows.has(element) || !inContent(element)) continue;
        const rect = rectOf(element);
        if (!visible(rect)) continue;
        glows.set(element, markWorking(element));
        // The writing arrives from its source and gathers into the region's lines.
        formHere(element);
      }
    };

    /* Afterwards: what Spectra changed keeps a faint tint until you have seen it, then it fades (CSS, [data-ai-unseen]). */
    const writing = new Set<Element>();
    const unseen = new Map<Element, ReturnType<typeof setTimeout> | null>();
    const fade = (element: Element) => {
      const timer = unseen.get(element);
      if (timer) clearTimeout(timer);
      unseen.delete(element);
      seenObserver?.unobserve(element);
      element.setAttribute("data-ai-unseen", "fading");
      setTimeout(() => {
        if (element.getAttribute("data-ai-unseen") === "fading") element.removeAttribute("data-ai-unseen");
      }, FADE_MS);
    };
    const seenObserver =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!unseen.has(entry.target)) continue;
                const timer = unseen.get(entry.target);
                if (timer) clearTimeout(timer);
                const inView = entry.isIntersecting && document.visibilityState === "visible";
                unseen.set(entry.target, inView ? setTimeout(() => fade(entry.target), SEEN_MS) : null);
              }
            },
            { threshold: 0.5 },
          );
    const markUnseen = (element: Element) => {
      if (unseen.has(element) || unseen.size >= MAX_UNSEEN) return;
      element.setAttribute("data-ai-unseen", "true");
      if (seenObserver) {
        unseen.set(element, null);
        seenObserver.observe(element);
      } else {
        unseen.set(element, setTimeout(() => fade(element), UNSEEN_FALLBACK_MS));
      }
    };
    /*
     * The spectral band (MOTION.md, "Spectra writing"): light sweeps across
     * each region Spectra is writing. Prose has its band in CSS; any other
     * region (a card face, an option, an event, a field, even an input) gets
     * a band that follows it in a layer over the work, clipped to the work.
     * CSS moves the light, so it runs while the field is off, and reduced
     * motion leaves only the tint.
     */
    const bands = new Map<Element, HTMLElement>();
    let bandLayer: HTMLElement | null = null;
    let bandFrame = 0;
    const working = () => /^(creating|updating)$/.test(root.getAttribute("data-ai-state") ?? "");
    const dropBand = (element: Element) => {
      const band = bands.get(element);
      bands.delete(element);
      if (!band) return;
      band.classList.add("is-leaving");
      setTimeout(() => band.remove(), BAND_FADE_MS);
    };
    const placeBands = () => {
      bandFrame = 0;
      if (!working()) for (const element of [...bands.keys()]) dropBand(element);
      if (!bands.size || !bandLayer) return;
      const base = root.getBoundingClientRect();
      const main = root.querySelector(".spectra-artifact-main")?.getBoundingClientRect();
      if (main) {
        bandLayer.style.clipPath = `inset(${main.top - base.top}px ${base.right - main.right}px ${base.bottom - main.bottom}px ${main.left - base.left}px)`;
      }
      for (const [element, band] of bands) {
        const r = element.getBoundingClientRect();
        band.style.transform = `translate(${r.left - base.left}px, ${r.top - base.top}px)`;
        band.style.width = `${r.width}px`;
        band.style.height = `${r.height}px`;
      }
      bandFrame = requestAnimationFrame(placeBands);
    };
    const addBand = (element: Element) => {
      if (bands.has(element) || bands.size >= MAX_BANDS || !working()) return;
      if (!bandLayer) {
        bandLayer = document.createElement("div");
        bandLayer.className = "spectra-ai-band-layer";
        bandLayer.setAttribute("aria-hidden", "true");
      }
      if (!bandLayer.isConnected) root.append(bandLayer);
      const band = document.createElement("div");
      band.className = "spectra-ai-band";
      const radius = getComputedStyle(element).borderRadius;
      if (radius && radius !== "0px") band.style.borderRadius = radius;
      band.append(document.createElement("i"));
      bandLayer.append(band);
      bands.set(element, band);
      if (!bandFrame) bandFrame = requestAnimationFrame(placeBands);
    };

    const syncWriting = (justMarked: readonly Element[]) => {
      // Rich text keeps its own tint as decorations (editor/ai-region-decoration.ts): ProseMirror owns its DOM.
      for (const element of justMarked) {
        if (!inContent(element) || element.closest(".ProseMirror")) continue;
        writing.add(element);
        addBand(element);
      }
      for (const element of writing) {
        if (element.isConnected && element.getAttribute("data-ai-region") === "true") continue;
        writing.delete(element);
        dropBand(element);
        if (element.isConnected) markUnseen(element);
      }
    };

    let added: Element[] = [];
    let removed: Element[] = [];
    let marked: Element[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = { added, removed, marked };
      formedThisFrame = new Set();
      added = [];
      removed = [];
      marked = [];
      // The tint is CSS: it stays even while the field is off.
      syncWriting(batch.marked);
      if (!life.on) {
        for (const release of glows.values()) release();
        glows.clear();
        return;
      }
      if (performance.now() - mountedAt >= WARM_UP_MS) {
        const plan = planBatch({
          added: batch.added.filter((element) => element.isConnected && inContent(element)),
          removed: batch.removed,
          local: isLocal(),
          isText,
        });
        for (const element of plan.unforms) unformThere(element);
        for (const element of plan.forms) formHere(element);
      }
      syncGlows(batch.marked);
      remember(batch.added.length + batch.removed.length > 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(flush);
    };

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          const element = record.target as Element;
          if (element.getAttribute("data-ai-region") === "true") marked.push(element);
          continue;
        }
        collect(record.addedNodes, isObject, added);
        // A removed node has left its parent, so selectors like "list > li"
        // no longer match it: what was on screen is known by its last place.
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          if (lastPlace.has(node)) {
            removed.push(node);
            continue;
          }
          const inner = node.getElementsByTagName("*");
          for (let index = 0; index < inner.length && index < 400; index += 1) {
            if (lastPlace.has(inner[index])) removed.push(inner[index]);
          }
        }
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            if (node.matches(AI_REGION)) marked.push(node);
            else marked.push(...node.querySelectorAll(AI_REGION));
          }
        }
      }
      schedule();
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-ai-region"] });

    /* Drags leave a wake; a drop settles. */
    let drag: { x: number; y: number; t: number; moved: boolean; live: boolean; element: Element } | null = null;
    let wakeFrame = 0;
    let pendingWake: [number, number, number, number] | null = null;
    const onPointerDown = (event: PointerEvent) => {
      markLocal([event.clientX, event.clientY]);
      const target = event.target instanceof Element ? event.target : null;
      // Working on what Spectra changed is seeing it.
      const tinted = target?.closest("[data-ai-unseen='true']");
      if (tinted && unseen.has(tinted)) fade(tinted);
      const grabbable = target?.closest(`${FIELD_OBJECTS}, [draggable="true"], [data-spectra-part]`);
      drag =
        grabbable && inContent(grabbable)
          ? { x: event.clientX, y: event.clientY, t: event.timeStamp, moved: false, live: true, element: grabbable }
          : null;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag?.live || !(event.buttons & 1) || !life.on) return;
      const dt = Math.max(1, event.timeStamp - drag.t);
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      if (!drag.moved) {
        // Picked up: it lifts off the page while it is carried (CSS, [data-lifted]).
        drag.element.setAttribute("data-lifted", "true");
      }
      drag.moved = true;
      pendingWake = [event.clientX, event.clientY, (dx / dt) * 1000, (dy / dt) * 1000];
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.t = event.timeStamp;
      if (!wakeFrame) {
        wakeFrame = requestAnimationFrame(() => {
          wakeFrame = 0;
          if (pendingWake) life.wake(...pendingWake);
          pendingWake = null;
        });
      }
    };
    const drop = (x: number, y: number) => {
      if (!drag) return;
      // Put down: it settles, and the field answers where it landed.
      const element = drag.element;
      if (element.hasAttribute("data-lifted")) {
        element.removeAttribute("data-lifted");
        element.setAttribute("data-settling", "true");
        window.setTimeout(() => element.removeAttribute("data-settling"), SETTLE_MS);
      }
      if (drag.moved && life.on) life.pulse(x, y, 0.55);
      drag = null;
    };
    const onPointerUp = (event: PointerEvent) => drop(event.clientX, event.clientY);
    // A native drag (the item rails) ends with dragend, not pointerup.
    const onDragEnd = (event: DragEvent) => {
      if (drag) drag.moved = true;
      drop(event.clientX, event.clientY);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.length === 1 || event.key === "Enter" || event.key === "Backspace" || event.key === "Delete") markLocal(null);
    };
    let scrollFrame = 0;
    const onScroll = () => {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        remember(true);
      });
    };
    root.addEventListener("pointerdown", onPointerDown, true);
    root.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp, true);
    root.addEventListener("dragend", onDragEnd, true);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    remember(true);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(wakeFrame);
      cancelAnimationFrame(scrollFrame);
      for (const release of glows.values()) release();
      glows.clear();
      seenObserver?.disconnect();
      cancelAnimationFrame(bandFrame);
      bands.clear();
      bandLayer?.remove();
      for (const [element, timer] of unseen) {
        if (timer) clearTimeout(timer);
        element.removeAttribute("data-ai-unseen");
      }
      unseen.clear();
      root.removeEventListener("pointerdown", onPointerDown, true);
      root.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp, true);
      root.removeEventListener("dragend", onDragEnd, true);
      drag?.element.removeAttribute("data-lifted");
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, [enabled, rootRef]);
}
