/*
 * Where the tour's spotlight and Spectra's note go. Pure geometry, so the
 * placement rules are testable without a page.
 */

export type Box = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Placement = { left: number; top: number; side: "right" | "left" | "below" | "above" | "inside" | "centre" };

/** Room around the target and from the window's edges. */
const GAP = 18;
const MARGIN = 16;
/** The spotlight breathes a little past the target's own box. */
const HALO = 6;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** The spotlight's box: the target plus its halo, kept inside the window. */
export function spotlightBox(target: Box, viewport: Size): Box {
  const left = Math.max(MARGIN / 2, target.left - HALO);
  const top = Math.max(MARGIN / 2, target.top - HALO);
  const right = Math.min(viewport.width - MARGIN / 2, target.left + target.width + HALO);
  const bottom = Math.min(viewport.height - MARGIN / 2, target.top + target.height + HALO);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * The note sits beside the target where there is room (right, then left,
 * below, above), lined up with it and kept on screen. A target too big to sit
 * beside (a whole page) holds the note in its own lower right corner; no target
 * puts it in the middle.
 */
export function placeNote(target: Box | null, note: Size, viewport: Size): Placement {
  const maxLeft = viewport.width - note.width - MARGIN;
  const maxTop = viewport.height - note.height - MARGIN;
  if (!target)
    return { left: clamp((viewport.width - note.width) / 2, MARGIN, maxLeft), top: clamp((viewport.height - note.height) / 2, MARGIN, maxTop), side: "centre" };
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const alignedTop = clamp(target.top, MARGIN, maxTop);
  const alignedLeft = clamp(target.left + target.width / 2 - note.width / 2, MARGIN, maxLeft);
  if (viewport.width - right - GAP >= note.width + MARGIN) return { left: right + GAP, top: alignedTop, side: "right" };
  if (target.left - GAP >= note.width + MARGIN) return { left: target.left - GAP - note.width, top: alignedTop, side: "left" };
  if (viewport.height - bottom - GAP >= note.height + MARGIN) return { left: alignedLeft, top: bottom + GAP, side: "below" };
  if (target.top - GAP >= note.height + MARGIN) return { left: alignedLeft, top: target.top - GAP - note.height, side: "above" };
  return {
    left: clamp(right - note.width - GAP * 2, MARGIN, maxLeft),
    top: clamp(bottom - note.height - GAP * 2, MARGIN, maxTop),
    side: "inside",
  };
}

export function sameBox(a: Box | null, b: Box | null) {
  if (!a || !b) return a === b;
  return Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}
