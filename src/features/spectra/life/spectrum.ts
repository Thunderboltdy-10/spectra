/*
 * Spectra's spectrum as one continuous loop.
 *
 * The six brand hues are interpolated in OKLab, which keeps lightness and
 * chroma even between stops, and the loop passes through a violet-to-red joint
 * so it has no seam where violet wraps back to red. Everything that shows the
 * full spectrum (the prism's light, the field's glow, AI light) samples it
 * here, so every surface agrees on the same colours.
 */

export type Rgb = readonly [number, number, number];

/** The brand stops in loop order, ending on the joint that closes the loop. */
export const SPECTRUM_STOPS = [
  "#ff647f", // red
  "#ffab4a", // orange
  "#f6d75d", // yellow
  "#48c997", // green
  "#4f9fe6", // blue
  "#9176e8", // violet
  "#d070b8", // the joint back to red
] as const;

const LUT_SIZE = 512;

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

export function rgbToOklab([r, g, b]: Rgb): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, a, b]: readonly [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const STOP_LABS = SPECTRUM_STOPS.map((hex) => rgbToOklab(hexToRgb(hex)));

/** The loop sampled once, so per-frame lookups cost an index. */
const LUT: Uint8ClampedArray = (() => {
  const lut = new Uint8ClampedArray(LUT_SIZE * 3);
  const n = STOP_LABS.length;
  for (let i = 0; i < LUT_SIZE; i += 1) {
    const position = (i / LUT_SIZE) * n;
    const index = Math.floor(position);
    const t = position - index;
    // Smoothstep inside each segment keeps each brand stop recognisable while
    // the transition through the joint stays continuous.
    const eased = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
    const from = STOP_LABS[index % n];
    const to = STOP_LABS[(index + 1) % n];
    const rgb = oklabToRgb([
      from[0] + (to[0] - from[0]) * eased,
      from[1] + (to[1] - from[1]) * eased,
      from[2] + (to[2] - from[2]) * eased,
    ]);
    lut[i * 3] = rgb[0];
    lut[i * 3 + 1] = rgb[1];
    lut[i * 3 + 2] = rgb[2];
  }
  return lut;
})();

/** The spectrum at a position on the loop. Any real number works; 0 and 1 are both red. */
export function spectrumAt(t: number): Rgb {
  const wrapped = t - Math.floor(t);
  const i = Math.min(LUT_SIZE - 1, Math.floor(wrapped * LUT_SIZE)) * 3;
  return [LUT[i], LUT[i + 1], LUT[i + 2]];
}

export function spectrumCss(t: number, alpha = 1) {
  const [r, g, b] = spectrumAt(t);
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha.toFixed(3)})`;
}

/** Adds `count` evenly spaced spectrum stops to a canvas gradient, starting at `offset` on the loop. */
export function addSpectrumStops(
  gradient: CanvasGradient,
  { offset = 0, span = 1, count = 12, alpha = 1 }: { offset?: number; span?: number; count?: number; alpha?: number } = {},
) {
  for (let i = 0; i <= count; i += 1) {
    const at = i / count;
    gradient.addColorStop(at, spectrumCss(offset + at * span, alpha));
  }
}

/** A CSS linear-gradient of the loop, for surfaces drawn in CSS (AI light, cues). */
export function spectrumCssGradient(angle = "90deg", count = 14) {
  const stops: string[] = [];
  for (let i = 0; i <= count; i += 1) stops.push(`${spectrumCss(i / count)} ${((i / count) * 100).toFixed(1)}%`);
  return `linear-gradient(${angle}, ${stops.join(", ")})`;
}
