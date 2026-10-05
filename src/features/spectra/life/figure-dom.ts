import { outlineFigure, rowsFigure, type Figure, type Stroke } from "./figure";
import type { Rgb } from "./spectrum";

/*
 * Figures read from the page: an element's outline and surface, in its own
 * colours, so the figure the field draws is exactly what the element is.
 */

let probe: CanvasRenderingContext2D | null = null;

/** Any CSS colour (oklch, color-mix, named) as sRGB and alpha, via a one-pixel canvas. */
export function cssToRgb(colour: string): { rgb: Rgb; alpha: number } | null {
  if (!colour || colour === "transparent") return null;
  if (!probe) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = colour;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  if (a === 0) return null;
  return { rgb: [r, g, b], alpha: a / 255 };
}

export type ElementFigureOptions = {
  /** Override the outline colour (default: the element's border, else the ink). */
  colour?: Rgb | "spectrum";
  alpha?: number;
  /** Fill with the element's background so the hand-over is seamless (default true). */
  fill?: boolean;
  /** Text rows inside, as fractions of the width: the content forming with its frame. */
  rows?: number[];
  /**
   * Parts of the content as bars at their real places: each text line of the
   * matched elements (or the element itself when it has no text) becomes a
   * bar, so the content forms where it will be and the text replaces it.
   */
  bars?: string;
  /** At most this many matched parts become bars (default 40): a long list forms its first rows. */
  maxBars?: number;
  ink?: Rgb;
};

/** An element as a figure: its rounded outline, its surface, and optionally rows for its content. */
export function figureOf(element: Element, options: ElementFigureOptions = {}): Figure {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;
  const ink = options.ink ?? inkOf();
  const border = Number.parseFloat(style.borderTopWidth) > 0 ? cssToRgb(style.borderTopColor) : null;
  const surface = options.fill === false ? null : cssToRgb(style.backgroundColor);
  const figure = outlineFigure(
    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    {
      radius,
      colour: options.colour ?? border?.rgb ?? ink,
      alpha: options.alpha ?? Math.max(0.28, border?.alpha ?? 0.3),
      width: 1.25,
      fill: surface?.rgb,
      fillAlpha: surface?.alpha,
    },
  );
  const strokes = [...figure.strokes];
  if (options.rows) {
    strokes.push(...rowsFigure({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }, options.rows, { colour: ink }).strokes);
  }
  if (options.bars) {
    const parts = Array.from(element.querySelectorAll(options.bars)).slice(0, options.maxBars ?? 40);
    for (const part of parts) strokes.push(...barsOf(part, ink));
  }
  return { strokes, fill: figure.fill };
}

/** An element's content as bars: one per line of text, or one for the element itself. */
export function barsOf(element: Element, ink: Rgb = inkOf()): Stroke[] {
  const style = getComputedStyle(element);
  const colour = cssToRgb(style.color)?.rgb ?? ink;
  const hasText = Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
  const boxes: DOMRect[] = [];
  if (hasText) {
    const range = document.createRange();
    range.selectNodeContents(element);
    boxes.push(...Array.from(range.getClientRects()).filter((r) => r.width > 2));
  } else {
    const background = cssToRgb(style.backgroundColor);
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      const thickness = Math.min(box.height, 10);
      return [
        {
          points: [box.x + thickness / 2, box.y + box.height / 2, box.x + box.width - thickness / 2, box.y + box.height / 2],
          closed: false,
          width: thickness,
          colour: background?.rgb ?? colour,
          alpha: (background?.alpha ?? 0.1) * Number.parseFloat(style.opacity || "1"),
        },
      ];
    }
  }
  return boxes.map((box) => {
    const thickness = Math.min(8, box.height * 0.42);
    return {
      points: [box.x + thickness / 2, box.y + box.height / 2, box.x + box.width - thickness / 2, box.y + box.height / 2],
      closed: false,
      width: thickness,
      colour,
      alpha: 0.14,
    };
  });
}

/** The page's ink colour, from the body's text colour. */
export function inkOf(): Rgb {
  return cssToRgb(getComputedStyle(document.body).color)?.rgb ?? [20, 19, 24];
}
