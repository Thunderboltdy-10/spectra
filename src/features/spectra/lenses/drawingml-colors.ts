import type { XmlElement } from "@ariadng/office/xml";

/*
 * How DrawingML names a colour, read the way PowerPoint paints it. A colour is
 * one element (`srgbClr`, `schemeClr`, `sysClr`, `prstClr`, `scrgbClr`,
 * `hslClr`) with modifier children (`lumMod`, `lumOff`, `tint`, `shade`,
 * `satMod`, `alpha`) applied in document order. Scheme names go through the
 * master's colour map (`tx1` → `dk1`) and then its theme. Everything a slide
 * reads (shape fills, lines, slide backgrounds, the deck's ink) comes through
 * here, so an accent is the accent and never the string "accent1".
 */

const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

export type DrawingPalette = {
  /** Theme slots (`dk1`, `lt1`, `accent1`…) as `RRGGBB`. */
  scheme: Record<string, string>;
  /** The master's colour map, `bg1` → `lt1` and the rest. */
  map: Record<string, string>;
  /** The theme's line widths in EMU, in `a:lnStyleLst` order, for `a:lnRef`. */
  lineWidths: number[];
};

/** Office's own scheme, for a deck with no theme part. */
const DEFAULT_SCHEME: Record<string, string> = {
  dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6",
  accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000",
  accent5: "5B9BD5", accent6: "70AD47", hlink: "0563C1", folHlink: "954F72",
};

const DEFAULT_MAP: Record<string, string> = {
  bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2",
  accent1: "accent1", accent2: "accent2", accent3: "accent3", accent4: "accent4",
  accent5: "accent5", accent6: "accent6", hlink: "hlink", folHlink: "folHlink",
};

/** DrawingML's preset colour names Spectra meets in real decks. */
const PRESET: Record<string, string> = {
  black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF",
  yellow: "FFFF00", gray: "808080", grey: "808080", darkGray: "A9A9A9", lightGray: "D3D3D3",
  orange: "FFA500", purple: "800080", navy: "000080", teal: "008080", silver: "C0C0C0",
};

const COLOR_ELEMENTS = new Set(["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr", "hslClr"]);

function descendants(root: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  const stack = [...root.elements()].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    result.push(node);
    for (const next of [...node.elements()].reverse()) stack.push(next);
  }
  return result;
}

function drawingChild(root: XmlElement | undefined, localName: string) {
  return root?.elements().find((node) => node.namespaceUri() === A_NS && node.localName === localName);
}

/** The theme's scheme and line widths with the master's map, defaults where the file is silent. */
export function drawingPalette(theme: XmlElement | undefined, colorMap: XmlElement | undefined): DrawingPalette {
  const scheme = { ...DEFAULT_SCHEME };
  const lineWidths: number[] = [];
  if (theme) {
    const clrScheme = descendants(theme).find((node) => node.namespaceUri() === A_NS && node.localName === "clrScheme");
    for (const slot of clrScheme?.elements() ?? []) {
      const entry = slot.elements()[0];
      const value = entry?.localName === "sysClr" ? entry.getAttribute("lastClr") : entry?.getAttribute("val");
      if (value && /^[0-9a-f]{6}$/i.test(value)) scheme[slot.localName] = value.toUpperCase();
    }
    const lines = descendants(theme).find((node) => node.namespaceUri() === A_NS && node.localName === "lnStyleLst");
    for (const line of lines?.elements() ?? []) lineWidths.push(Number(line.getAttribute("w") ?? 9525) || 9525);
  }
  const map = { ...DEFAULT_MAP };
  for (const key of Object.keys(DEFAULT_MAP)) {
    const value = colorMap?.getAttribute(key);
    if (value) map[key] = value;
  }
  return { scheme, map, lineWidths };
}

/** A slide or layout's own `p:clrMapOvr`, laid over the master's map. */
export function withColorMapOverride(palette: DrawingPalette, override: XmlElement | undefined): DrawingPalette {
  const mapping = drawingChild(override, "overrideClrMapping");
  if (!mapping) return palette;
  const map = { ...palette.map };
  for (const key of Object.keys(DEFAULT_MAP)) {
    const value = mapping.getAttribute(key);
    if (value) map[key] = value;
  }
  return { ...palette, map };
}

type Rgb = [number, number, number];

function fromHex(hex: string): Rgb {
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as Rgb;
}

function toHex(rgb: readonly number[]) {
  return rgb.map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function toHsl([red, green, blue]: Rgb): Rgb {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0) : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  hue /= 6;
  return [hue, saturation, lightness];
}

function fromHsl([hue, saturation, lightness]: Rgb): Rgb {
  const l = Math.max(0, Math.min(1, lightness));
  const s = Math.max(0, Math.min(1, saturation));
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (offset: number) => {
    let t = hue + offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(1 / 3), channel(0), channel(-1 / 3)];
}

function baseColor(element: XmlElement, palette: DrawingPalette, placeholder: string | undefined): string | undefined {
  const value = element.getAttribute("val") ?? "";
  switch (element.localName) {
    case "srgbClr":
      return /^[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : undefined;
    case "sysClr": {
      const last = element.getAttribute("lastClr");
      if (last && /^[0-9a-f]{6}$/i.test(last)) return last.toUpperCase();
      return value === "window" ? "FFFFFF" : value === "windowText" ? "000000" : undefined;
    }
    case "prstClr":
      return PRESET[value];
    case "scrgbClr": {
      // Linear RGB in thousandths of a percent; gamma brings it back to sRGB.
      const channel = (name: string) => {
        const linear = Math.max(0, Math.min(1, Number(element.getAttribute(name) ?? 0) / 100_000));
        return linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
      };
      return toHex([channel("r"), channel("g"), channel("b")]);
    }
    case "hslClr":
      return toHex(fromHsl([
        Number(element.getAttribute("hue") ?? 0) / 21_600_000,
        Number(element.getAttribute("sat") ?? 0) / 100_000,
        Number(element.getAttribute("lum") ?? 0) / 100_000,
      ]));
    case "schemeClr": {
      if (value === "phClr") return placeholder;
      const slot = palette.map[value] ?? value;
      return palette.scheme[slot];
    }
    default:
      return undefined;
  }
}

/**
 * One colour element as CSS: `#RRGGBB`, or a `color-mix` toward transparent
 * when it carries alpha. `placeholder` is the colour `phClr` stands for, the
 * one a style reference (`a:fillRef`) supplies.
 */
export function drawingColor(element: XmlElement | undefined, palette: DrawingPalette, placeholder?: string): string | undefined {
  if (!element || !COLOR_ELEMENTS.has(element.localName)) return undefined;
  const base = baseColor(element, palette, placeholder?.replace(/^#/, ""));
  if (!base) return undefined;
  let rgb = fromHex(base);
  let alpha = 1;
  for (const modifier of element.elements()) {
    const amount = Number(modifier.getAttribute("val") ?? 0) / 100_000;
    if (!Number.isFinite(amount)) continue;
    switch (modifier.localName) {
      case "lumMod": { const hsl = toHsl(rgb); rgb = fromHsl([hsl[0], hsl[1], hsl[2] * amount]); break; }
      case "lumOff": { const hsl = toHsl(rgb); rgb = fromHsl([hsl[0], hsl[1], hsl[2] + amount]); break; }
      case "satMod": { const hsl = toHsl(rgb); rgb = fromHsl([hsl[0], hsl[1] * amount, hsl[2]]); break; }
      // A 40% tint is 40% of the colour over 60% white; a shade goes to black.
      case "tint": rgb = rgb.map((channel) => channel * amount + (1 - amount)) as Rgb; break;
      case "shade": rgb = rgb.map((channel) => channel * amount) as Rgb; break;
      case "alpha": alpha = Math.max(0, Math.min(1, amount)); break;
    }
  }
  const hex = `#${toHex(rgb)}`;
  return alpha < 1 ? `color-mix(in srgb, ${hex} ${Math.round(alpha * 100)}%, transparent)` : hex;
}

/** The colour element inside a fill or reference element, wherever it sits. */
export function colorIn(root: XmlElement | undefined) {
  return root?.elements().find((node) => COLOR_ELEMENTS.has(node.localName));
}

/**
 * The fill a properties element (`spPr`, `bgPr`, `ln`, `tcPr`) declares:
 * `"none"` for `a:noFill`, a colour for a solid, the first stop of a
 * gradient, the foreground of a pattern, or nothing when it declares none
 * (or only a picture fill, which a colour can't stand for).
 */
export function drawingFill(properties: XmlElement | undefined, palette: DrawingPalette, placeholder?: string): string | undefined {
  if (!properties) return undefined;
  for (const node of properties.elements()) {
    if (node.namespaceUri() !== A_NS) continue;
    if (node.localName === "noFill") return "none";
    if (node.localName === "solidFill") return drawingColor(colorIn(node), palette, placeholder);
    if (node.localName === "gradFill") {
      const stops = drawingChild(node, "gsLst")?.elements() ?? [];
      const first = [...stops].sort((left, right) => Number(left.getAttribute("pos") ?? 0) - Number(right.getAttribute("pos") ?? 0))[0];
      return drawingColor(colorIn(first), palette, placeholder);
    }
    if (node.localName === "pattFill") return drawingColor(colorIn(drawingChild(node, "fgClr")), palette, placeholder);
  }
  return undefined;
}
