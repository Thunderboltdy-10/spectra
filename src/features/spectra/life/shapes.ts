import type { Rect } from "./engine";
import { POINT_STRIDE, type PointSet } from "./particles";
import { drawPrism, PRISM_PALETTES, type PrismPose } from "./prism";
import { spectrumAt, type Rgb } from "./spectrum";

/*
 * Shapes as dots: formations for the field to dissolve, gather and condense.
 *
 * Each sampler returns a PointSet (x, y, r, g, b, a per dot) in viewport CSS
 * pixels. Dots sit on a hex grid at `spacing`, the same rhythm as the field,
 * so a shape made of dots reads as part of it.
 */

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function scratch(width: number, height: number): Context | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height).getContext("2d");
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d", { willReadFrequently: true });
}

function pack(points: number[]): PointSet {
  return Float32Array.from(points);
}

/**
 * Draws something into a canvas the size of `rect` and reads it back as dots:
 * every grid point inside the drawing becomes a dot of the colour there.
 */
export function sampleDrawing(
  rect: Rect,
  draw: (context: Context, width: number, height: number) => void,
  { spacing = 4, threshold = 0.2, alpha = 0.9 } = {},
): PointSet {
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const context = scratch(width, height);
  if (!context) return new Float32Array(0);
  draw(context, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const out: number[] = [];
  const rowHeight = spacing * 0.866;
  for (let j = 0, y = rowHeight / 2; y < height; j += 1, y += rowHeight) {
    for (let x = (j & 1 ? spacing / 2 : 0) + spacing / 4; x < width; x += spacing) {
      const i = ((y | 0) * width + (x | 0)) * 4;
      const a = data[i + 3] / 255;
      if (a < threshold) continue;
      out.push(rect.x + x, rect.y + y, data[i], data[i + 1], data[i + 2], a * alpha);
    }
  }
  return pack(out);
}

/** The prism as dots, in its current pose. */
export function samplePrism(pose: PrismPose, rect: Rect, dark: boolean, spacing = 3): PointSet {
  return sampleDrawing(
    rect,
    (context, width, height) =>
      drawPrism(context, pose, {
        x: width / 2,
        y: height / 2,
        size: Math.min(width, height),
        palette: PRISM_PALETTES[dark ? "dark" : "light"],
        detail: "live",
      }),
    { spacing, threshold: 0.25, alpha: 1 },
  );
}

/** Text as dots, for notices that condense from the field. */
export function sampleText(
  text: string,
  rect: Rect,
  { font = "500 14px Figtree, system-ui", colour = [20, 19, 24] as Rgb, spacing = 2.5 } = {},
): PointSet {
  return sampleDrawing(
    rect,
    (context, _width, height) => {
      context.font = font;
      context.textBaseline = "middle";
      context.fillStyle = `rgb(${colour[0]} ${colour[1]} ${colour[2]})`;
      context.fillText(text, 0, height / 2);
    },
    { spacing, threshold: 0.35, alpha: 0.85 },
  );
}

/**
 * The outline of a rounded rectangle as dots: a card, a question, a panel
 * about to open. `colour` may be "spectrum" to run the loop round the edge.
 */
export function sampleOutline(
  rect: Rect,
  { radius = 12, spacing = 4, colour = [20, 19, 24] as Rgb | "spectrum", alpha = 0.7 } = {},
): PointSet {
  const r = Math.min(radius, rect.width / 2, rect.height / 2);
  const straightW = rect.width - 2 * r;
  const straightH = rect.height - 2 * r;
  const arc = (Math.PI / 2) * r;
  const perimeter = 2 * straightW + 2 * straightH + 4 * arc;
  const count = Math.max(8, Math.round(perimeter / spacing));
  const out: number[] = [];
  for (let k = 0; k < count; k += 1) {
    let d = (k / count) * perimeter;
    let x = 0;
    let y = 0;
    const segments: [number, (t: number) => [number, number]][] = [
      [straightW, (t) => [rect.x + r + t, rect.y]],
      [arc, (t) => corner(rect.x + rect.width - r, rect.y + r, -Math.PI / 2 + t / r)],
      [straightH, (t) => [rect.x + rect.width, rect.y + r + t]],
      [arc, (t) => corner(rect.x + rect.width - r, rect.y + rect.height - r, t / r)],
      [straightW, (t) => [rect.x + rect.width - r - t, rect.y + rect.height]],
      [arc, (t) => corner(rect.x + r, rect.y + rect.height - r, Math.PI / 2 + t / r)],
      [straightH, (t) => [rect.x, rect.y + rect.height - r - t]],
      [arc, (t) => corner(rect.x + r, rect.y + r, Math.PI + t / r)],
    ];
    for (const [length, at] of segments) {
      if (d <= length) {
        [x, y] = at(d);
        break;
      }
      d -= length;
    }
    const c = colour === "spectrum" ? spectrumAt(k / count) : colour;
    out.push(x, y, c[0], c[1], c[2], alpha);
  }
  return pack(out);

  function corner(cx: number, cy: number, angle: number): [number, number] {
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  }
}

/**
 * Lines of a page as dots: a document or a deck's slide skeleton, for an
 * artifact that is being written or arriving. `lines` are fractions of the width.
 */
export function sampleRows(
  rect: Rect,
  lines: number[],
  { gap = 9, spacing = 3, colour = [20, 19, 24] as Rgb, alpha = 0.5, inset = 12 } = {},
): PointSet {
  const out: number[] = [];
  let y = rect.y + inset;
  for (const fraction of lines) {
    if (y > rect.y + rect.height - inset) break;
    const length = (rect.width - inset * 2) * fraction;
    for (let x = rect.x + inset; x < rect.x + inset + length; x += spacing) out.push(x, y, colour[0], colour[1], colour[2], alpha);
    y += gap;
  }
  return pack(out);
}

/** A uniform grid of dots over an area: the stuff a dropped file or a new tile is made of. */
export function sampleArea(rect: Rect, { spacing = 6, colour = [20, 19, 24] as Rgb, alpha = 0.4 } = {}): PointSet {
  return sampleDrawing(
    rect,
    (context, width, height) => {
      context.fillStyle = `rgb(${colour[0]} ${colour[1]} ${colour[2]})`;
      context.fillRect(0, 0, width, height);
    },
    { spacing, threshold: 0.5, alpha },
  );
}

/** Number of dots in a set. */
export function pointCount(points: PointSet) {
  return points.length / POINT_STRIDE;
}
