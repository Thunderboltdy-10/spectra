/*
 * The island changes shape as one object (ISLAND.md): the dock stretches into
 * the pill, the pill into the composer. A frame in the island's paper starts
 * as the shape that was there and becomes the one that comes, while the old
 * contents fade and the new ones come in over it. No dots: the island is one
 * thing that extends, not a thing redrawn.
 */

export type ShapeBox = { x: number; y: number; width: number; height: number; radius: number; background: string };

export const MORPH_MS = 300;
const EASE = "cubic-bezier(0.22, 1.18, 0.36, 1)";

/** Where a shape is, how round, and in what paper. */
export function boxOf(element: Element | null | undefined): ShapeBox | null {
  const r = element?.getBoundingClientRect();
  if (!element || !r || !r.width || !r.height) return null;
  const style = getComputedStyle(element);
  const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, r.height / 2);
  return { x: r.x, y: r.y, width: r.width, height: r.height, radius, background: style.backgroundColor };
}

const frameOf = ({ x, y, width, height, radius, background }: ShapeBox) => ({
  transform: `translate(${x}px, ${y}px)`,
  width: `${width}px`,
  height: `${height}px`,
  borderRadius: `${radius}px`,
  backgroundColor: background,
});

/** Stretches `frame` from one shape to the other, then lets it go once the new shape stands in it. */
export function morphShape(frame: HTMLElement | null, from: ShapeBox | null, to: ShapeBox | null) {
  if (!frame || !from || !to || typeof frame.animate !== "function") return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  frame.getAnimations().forEach((animation) => animation.cancel());
  frame.animate(
    [
      // The stretch overshoots a little and settles; then the frame gives way to the shape standing in it.
      { ...frameOf(from), opacity: 1, easing: EASE },
      { ...frameOf(to), opacity: 1, offset: 0.8 },
      { ...frameOf(to), opacity: 0 },
    ],
    { duration: MORPH_MS + 80 },
  );
}
