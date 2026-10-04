import type { Rect } from "./engine";
import { prismOps, type PrismDrawOptions, type PrismPose } from "./prism";
import { spectrumAt, type Rgb } from "./spectrum";

/*
 * Figures: what the field's dots become.
 *
 * A figure is a shape described as strokes (polylines) and an optional fill,
 * in viewport CSS pixels. The engine lays dots along every stroke; when the
 * dots arrive they fuse with their neighbours into the stroke itself, so a
 * shape is drawn by its own matter: dots first, then lines, then the real
 * element underneath takes over.
 *
 * Figures are plain data, cheap to post to the worker.
 */

export type Point = readonly [number, number];

export type Stroke = {
  /** x, y pairs. */
  points: number[];
  closed: boolean;
  /** Line width once fused, CSS px. Wide strokes read as bars (skeleton rows). */
  width: number;
  /** One colour for the stroke, or the spectrum running along it. */
  colour: Rgb | "spectrum";
  /** Per point r, g, b, overriding `colour` (the prism's spectral edges). */
  colours?: number[];
  alpha: number;
};

export type Figure = {
  strokes: Stroke[];
  /** A surface that fills in as the outline closes, so the hand-over to the element is seamless. */
  fill?: { points: number[]; colour: Rgb; alpha: number };
};

/** A rounded rectangle's outline as a closed polyline. */
export function roundedRectPoints(rect: Rect, radius: number, step = 2): number[] {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  const out: number[] = [];
  const corner = (cx: number, cy: number, from: number) => {
    const segments = Math.max(1, Math.ceil(((Math.PI / 2) * r) / step));
    for (let s = 0; s <= segments; s += 1) {
      const angle = from + (s / segments) * (Math.PI / 2);
      out.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    }
  };
  const { x, y, width: w, height: h } = rect;
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return out;
}

export type OutlineOptions = {
  radius?: number;
  colour?: Rgb | "spectrum";
  alpha?: number;
  width?: number;
  /** The surface colour, when the element has one. */
  fill?: Rgb;
  fillAlpha?: number;
};

/** A card, a panel, a question, the composer: its outline and surface. */
export function outlineFigure(rect: Rect, options: OutlineOptions = {}): Figure {
  const points = roundedRectPoints(rect, options.radius ?? 12);
  return {
    strokes: [
      {
        points,
        closed: true,
        width: options.width ?? 1.25,
        colour: options.colour ?? [20, 19, 24],
        alpha: options.alpha ?? 0.32,
      },
    ],
    fill: options.fill ? { points, colour: options.fill, alpha: options.fillAlpha ?? 1 } : undefined,
  };
}

export type RowsOptions = {
  /** Distance between rows, CSS px. */
  gap?: number;
  /** Bar thickness, CSS px. */
  thickness?: number;
  inset?: number;
  colour?: Rgb;
  alpha?: number;
};

/**
 * Lines of content as bars: a document, a message or a list being written.
 * `lines` are fractions of the width.
 */
export function rowsFigure(rect: Rect, lines: number[], options: RowsOptions = {}): Figure {
  const gap = options.gap ?? 14;
  const thickness = options.thickness ?? 6;
  const inset = options.inset ?? 14;
  const strokes: Stroke[] = [];
  let y = rect.y + inset + thickness / 2;
  for (const fraction of lines) {
    if (y > rect.y + rect.height - inset) break;
    const left = rect.x + inset + thickness / 2;
    const length = Math.max(thickness, (rect.width - inset * 2 - thickness) * fraction);
    strokes.push({
      points: [left, y, left + length, y],
      closed: false,
      width: thickness,
      colour: options.colour ?? [20, 19, 24],
      alpha: options.alpha ?? 0.09,
    });
    y += gap;
  }
  return { strokes };
}

/** A circle, for status marks, avatars and round buttons. */
export function circleFigure(cx: number, cy: number, radius: number, options: OutlineOptions = {}): Figure {
  const segments = Math.max(12, Math.ceil((Math.PI * 2 * radius) / 2));
  const points: number[] = [];
  for (let s = 0; s < segments; s += 1) {
    const angle = (s / segments) * Math.PI * 2 - Math.PI / 2;
    points.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }
  return {
    strokes: [{ points, closed: true, width: options.width ?? 1.25, colour: options.colour ?? [20, 19, 24], alpha: options.alpha ?? 0.4 }],
    fill: options.fill ? { points, colour: options.fill, alpha: options.fillAlpha ?? 1 } : undefined,
  };
}

/** Several figures as one, so they form and travel together. */
export function combine(...figures: Figure[]): Figure {
  return {
    strokes: figures.flatMap((f) => f.strokes),
    fill: figures.find((f) => f.fill)?.fill,
  };
}

/**
 * The prism as a figure: its silhouette and the spectral edges of its near
 * face, with its body as the fill. Formed from dots, this is the prism drawn
 * by its own edges; the live prism then fades in over it.
 */
export function prismFigure(pose: PrismPose, options: PrismDrawOptions): Figure {
  const ops = prismOps(pose, { ...options, pixelRatio: 1 });
  const strokes: Stroke[] = [];
  const outline = [...ops].reverse().find((op) => op.kind === "stroke" && op.closed && "rgb" in op.paint)!;
  const flat = (points: readonly (readonly [number, number])[]) => points.flatMap((p) => [p[0], p[1]]);
  const extras: Stroke[] = [];
  for (const op of ops) {
    if (op.kind === "dot") {
      // The status dot forms with the prism, as a tiny ring that fills in.
      const ring = circleFigure(op.points[0][0], op.points[0][1], Math.max(0.6, op.radius * 0.55), { colour: op.rgb, alpha: op.a, width: op.radius * 1.1 });
      extras.push(...ring.strokes);
      continue;
    }
    if (op.kind !== "stroke" || op === outline || "rgb" in op.paint) continue;
    // The near face's spectral rails: colour per point from the gradient.
    const stops = op.paint.stops;
    const colours: number[] = [];
    op.points.forEach((_, i) => {
      const t = op.points.length > 1 ? i / (op.points.length - 1) : 0;
      let k = 0;
      while (k < stops.length - 2 && stops[k + 1][0] < t) k += 1;
      const [t0, c0] = stops[k];
      const [t1, c1] = stops[Math.min(stops.length - 1, k + 1)];
      const u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
      colours.push(c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u);
    });
    strokes.push({ points: flat(op.points), closed: false, width: 1.3, colour: [255, 255, 255], colours, alpha: 0.95 });
  }
  const hull = flat(outline.points);
  const palette = options.palette;
  // The silhouette first: it is what morphs into other outlines.
  strokes.unshift({ points: hull, closed: true, width: 1.4, colour: palette.edge, alpha: 0.9 });
  strokes.push(...extras);
  return { strokes, fill: { points: hull, colour: palette.bodyDeep, alpha: palette.capAlpha } };
}

/** A polyline resampled at an even spacing: where the dots of a stroke sit. */
export function resample(points: number[], closed: boolean, spacing: number): number[] {
  const n = points.length / 2;
  if (n === 0) return [];
  if (n === 1) return [points[0], points[1]];
  const segments = closed ? n : n - 1;
  let length = 0;
  for (let s = 0; s < segments; s += 1) {
    const a = s * 2;
    const b = ((s + 1) % n) * 2;
    length += Math.hypot(points[b] - points[a], points[b + 1] - points[a + 1]);
  }
  const count = Math.max(closed ? 3 : 2, Math.round(length / spacing) + (closed ? 0 : 1));
  const step = length / (closed ? count : count - 1);
  const out: number[] = [];
  let s = 0;
  let travelled = 0;
  let segLength = segLen(0);
  for (let k = 0; k < count; k += 1) {
    const want = k * step;
    while (s < segments - 1 && travelled + segLength < want) {
      travelled += segLength;
      s += 1;
      segLength = segLen(s);
    }
    const a = s * 2;
    const b = ((s + 1) % n) * 2;
    const t = segLength > 0 ? Math.min(1, (want - travelled) / segLength) : 0;
    out.push(points[a] + (points[b] - points[a]) * t, points[a + 1] + (points[b + 1] - points[a + 1]) * t);
  }
  return out;

  function segLen(index: number) {
    const a = index * 2;
    const b = ((index + 1) % n) * 2;
    return Math.hypot(points[b] - points[a], points[b + 1] - points[a + 1]);
  }
}

/** A stroke's colour at a point of it (0..1 along), for the dots that make it. */
export function strokeColourAt(stroke: Stroke, t: number, index: number, count: number): Rgb {
  if (stroke.colours && stroke.colours.length >= 3) {
    const n = stroke.colours.length / 3;
    const f = count > 1 ? (index / (count - 1)) * (n - 1) : 0;
    const k = Math.min(n - 1, Math.floor(f));
    const k1 = Math.min(n - 1, k + 1);
    const u = f - k;
    const c = stroke.colours;
    return [c[k * 3] + (c[k1 * 3] - c[k * 3]) * u, c[k * 3 + 1] + (c[k1 * 3 + 1] - c[k * 3 + 1]) * u, c[k * 3 + 2] + (c[k1 * 3 + 2] - c[k * 3 + 2]) * u];
  }
  if (stroke.colour === "spectrum") return spectrumAt(t);
  return stroke.colour;
}

/** The point of a figure nearest to another point: where something arriving touches it. */
export function nearestOn(figure: Figure, x: number, y: number): Point {
  let best: Point = [x, y];
  let bestD = Infinity;
  for (const stroke of figure.strokes) {
    for (let i = 0; i < stroke.points.length; i += 2) {
      const d = (stroke.points[i] - x) ** 2 + (stroke.points[i + 1] - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = [stroke.points[i], stroke.points[i + 1]];
      }
    }
  }
  return best;
}

/** The centre of a figure's bounding box. */
export function centreOfFigure(figure: Figure): Point {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const stroke of figure.strokes) {
    for (let i = 0; i < stroke.points.length; i += 2) {
      x0 = Math.min(x0, stroke.points[i]);
      x1 = Math.max(x1, stroke.points[i]);
      y0 = Math.min(y0, stroke.points[i + 1]);
      y1 = Math.max(y1, stroke.points[i + 1]);
    }
  }
  return x0 === Infinity ? [0, 0] : [(x0 + x1) / 2, (y0 + y1) / 2];
}
