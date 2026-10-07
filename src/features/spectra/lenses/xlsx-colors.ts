import type { Workbook } from "@ariadng/office/xlsx";
import type { XmlElement } from "@ariadng/office/xml";

/*
 * How SpreadsheetML names a colour, read the way Excel paints it: `rgb` as
 * ARGB, `theme` through the workbook's colour scheme (with `tint`), and
 * `indexed` through the legacy 64-colour palette. Everything Spectra reads
 * out of a workbook (tab colours, conditional fills, data bars) goes through
 * here, so a theme accent is the accent and never the string "4".
 */

const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const THEME_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
const OFFICE_DOCUMENT_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

/** Excel's legacy indexed palette (ECMA-376 §18.8.27), indexes 0–63. */
const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

/** Office's default scheme, for a workbook with no theme part. */
const DEFAULT_THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];

/**
 * The scheme in SpreadsheetML's index order. Excel swaps the light and dark
 * pairs relative to the theme part: `theme="0"` is lt1, `theme="1"` is dk1.
 */
const SCHEME_ORDER = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

export type ExcelPalette = { theme: readonly string[] };

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

const palettes = new WeakMap<Workbook, Promise<ExcelPalette>>();

/** The workbook's theme colours, read once per open workbook. */
export function workbookPalette(workbook: Workbook): Promise<ExcelPalette> {
  let palette = palettes.get(workbook);
  if (!palette) {
    palette = (async () => {
      const pkg = workbook.office.package;
      const book = pkg.getPartsByRelationshipType(OFFICE_DOCUMENT_REL)[0] ?? pkg.getPart("/xl/workbook.xml");
      const relationship = book?.relationships().byType(THEME_REL)[0];
      const part = book && relationship ? pkg.relatedPart(book, relationship.id) : undefined;
      if (!part) return { theme: DEFAULT_THEME };
      try {
        const root = (await workbook.office.xml(part.name)).root;
        const scheme = descendants(root).find((node) => node.namespaceUri() === A_NS && node.localName === "clrScheme");
        if (!scheme) return { theme: DEFAULT_THEME };
        return {
          theme: SCHEME_ORDER.map((slot, index) => {
            const entry = scheme.elements().find((node) => node.localName === slot)?.elements()[0];
            const value = entry?.localName === "sysClr" ? entry.getAttribute("lastClr") : entry?.getAttribute("val");
            return value && /^[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : DEFAULT_THEME[index]!;
          }),
        };
      } catch {
        return { theme: DEFAULT_THEME };
      }
    })();
    palettes.set(workbook, palette);
  }
  return palette;
}

function hexToRgb(hex: string) {
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
}

function rgbToHex(rgb: readonly number[]) {
  return rgb.map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Excel's tint: lightens toward white (positive) or darkens toward black (negative) in HSL. */
export function applyExcelTint(hex: string, tint: number) {
  if (!tint || !Number.isFinite(tint)) return hex.toUpperCase();
  const [red, green, blue] = hexToRgb(hex);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  let hue = 0;
  let saturation = 0;
  let lightness = (max + min) / 2;
  if (max !== min) {
    const delta = max - min;
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0) : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
    hue /= 6;
  }
  lightness = tint < 0 ? lightness * (1 + tint) : lightness * (1 - tint) + tint;
  if (!saturation) return rgbToHex([lightness, lightness, lightness]);
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (offset: number) => {
    let t = hue + offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex([channel(1 / 3), channel(0), channel(-1 / 3)]);
}

/** A stored colour value (`FFAABBCC`, `AABBCC` or `#AABBCC`) as `#AABBCC`, or nothing. */
export function normalizeExcelColorValue(value: string | undefined) {
  const hex = value?.trim().replace(/^#/, "") ?? "";
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(2).toUpperCase()}`;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toUpperCase()}`;
  return undefined;
}

/** One `<color>`-shaped element (`color`, `fgColor`, `bgColor`, `tabColor`) as `#RRGGBB`. */
export function excelColor(element: XmlElement | undefined, palette: ExcelPalette): string | undefined {
  if (!element || element.getAttribute("auto") === "1") return undefined;
  const tint = Number(element.getAttribute("tint") ?? 0);
  const rgb = normalizeExcelColorValue(element.getAttribute("rgb"));
  if (rgb) return `#${applyExcelTint(rgb.slice(1), tint)}`;
  const theme = element.getAttribute("theme");
  if (theme !== undefined) {
    const base = palette.theme[Number(theme)];
    return base ? `#${applyExcelTint(base, tint)}` : undefined;
  }
  const indexed = element.getAttribute("indexed");
  if (indexed !== undefined) {
    const base = INDEXED[Number(indexed)];
    return base ? `#${applyExcelTint(base, tint)}` : undefined;
  }
  return undefined;
}
