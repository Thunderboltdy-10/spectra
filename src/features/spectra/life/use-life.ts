"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";
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
