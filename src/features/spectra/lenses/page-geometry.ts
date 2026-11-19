/**
 * A page as Word measures it: paper and margins in twentieths of a point
 * (twips). The presets in the page menu are quick ways to set these numbers;
 * a Word file's own numbers are kept exactly, so a 2 cm margin stays 2 cm.
 */

export type PageGeometry = {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** From the paper's top edge to the header's top. */
  header: number;
  /** From the paper's bottom edge to the footer's bottom. */
  footer: number;
};

export const PAGE_GEOMETRY_KEYS = ["width", "height", "top", "right", "bottom", "left", "header", "footer"] as const;

/** Portrait paper sizes, width then height. */
export const PAGE_SIZES_TWIPS: Record<string, [number, number]> = {
  a4: [11_906, 16_838],
  letter: [12_240, 15_840],
  legal: [12_240, 20_160],
  a5: [8_391, 11_906],
};

export const MARGIN_TWIPS: Record<string, number> = { narrow: 680, normal: 1_440, wide: 2_268 };

/** Word's own distance from the paper's edge to a header or footer: 1.25 cm. */
export const CHROME_DISTANCE_TWIPS = 708;

/** The largest paper Word accepts is 22 inches on a side. */
export const MAX_PAGE_TWIPS = 31_680;

type PresetSetup = {
  size?: string;
  orientation?: "portrait" | "landscape";
  margins?: string;
  page?: Partial<PageGeometry>;
};

const whole = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PAGE_TWIPS ? Math.round(value) : fallback;

/** The page a setup describes: its exact numbers where it has them, else its presets'. */
export function pageGeometry(setup: PresetSetup | undefined): PageGeometry {
  const [portraitWidth, portraitHeight] = PAGE_SIZES_TWIPS[setup?.size?.toLowerCase() ?? ""] ?? PAGE_SIZES_TWIPS.a4!;
  const landscape = setup?.orientation === "landscape";
  const margin = MARGIN_TWIPS[setup?.margins?.toLowerCase() ?? ""] ?? MARGIN_TWIPS.normal!;
  const page = setup?.page ?? {};
  const width = whole(page.width, landscape ? portraitHeight : portraitWidth);
  const height = whole(page.height, landscape ? portraitWidth : portraitHeight);
  return {
    width: width > 0 ? width : portraitWidth,
    height: height > 0 ? height : portraitHeight,
    top: whole(page.top, margin),
    right: whole(page.right, margin),
    bottom: whole(page.bottom, margin),
    left: whole(page.left, margin),
    header: whole(page.header, CHROME_DISTANCE_TWIPS),
    footer: whole(page.footer, CHROME_DISTANCE_TWIPS),
  };
}

/** The preset nearest a page's paper, for the page menu's label. */
export function nearestPaper(geometry: Pick<PageGeometry, "width" | "height">) {
  const short = Math.min(geometry.width, geometry.height);
  const long = Math.max(geometry.width, geometry.height);
  return Object.entries(PAGE_SIZES_TWIPS).find(([, [w, h]]) => Math.abs(w - short) <= 20 && Math.abs(h - long) <= 20)?.[0];
}

/** The margin preset whose number is nearest the page's left margin. */
export function nearestMargins(left: number) {
  return Object.entries(MARGIN_TWIPS).sort(([, a], [, b]) => Math.abs(a - left) - Math.abs(b - left))[0]?.[0] ?? "normal";
}

/**
 * A setup after one preset changes: the preset's named field and the exact
 * numbers it implies, keeping every number the preset does not speak for.
 */
export function withPreset<T extends PresetSetup>(
  setup: T,
  change: { size?: string; orientation?: "portrait" | "landscape"; margins?: string },
): T & { page: PageGeometry } {
  const current = pageGeometry(setup);
  const next = { ...setup, ...change };
  const page = { ...current };
  if (change.size !== undefined || change.orientation !== undefined) {
    const named = PAGE_SIZES_TWIPS[(change.size ?? setup.size ?? "")?.toLowerCase()];
    const [w, h] = named ?? [Math.min(current.width, current.height), Math.max(current.width, current.height)];
    const landscape = (change.orientation ?? setup.orientation) === "landscape";
    page.width = landscape ? h : w;
    page.height = landscape ? w : h;
  }
  if (change.margins !== undefined) {
    const margin = MARGIN_TWIPS[change.margins.toLowerCase()] ?? MARGIN_TWIPS.normal!;
    page.top = page.right = page.bottom = page.left = margin;
  }
  return { ...next, page };
}

/**
 * A page setup an editor or the AI sent, made whole: a preset it changed
 * without touching the exact numbers (an AI asking for "narrow" margins)
 * brings the numbers that preset implies, so the page, the Word file and
 * the readback all agree. Numbers it did change are kept as sent.
 */
export function settlePageSetup<T extends PresetSetup>(before: PresetSetup | undefined, after: T): T {
  if (!before?.page || !after.page) return after;
  const change: { size?: string; orientation?: "portrait" | "landscape"; margins?: string } = {};
  if (after.size !== before.size && after.size !== undefined) change.size = after.size;
  if (after.orientation !== before.orientation && after.orientation !== undefined) change.orientation = after.orientation;
  if (after.margins !== before.margins && after.margins !== undefined) change.margins = after.margins;
  if (!Object.keys(change).length) return after;
  const sameNumbers = PAGE_GEOMETRY_KEYS.every((key) => before.page?.[key] === after.page?.[key]);
  if (!sameNumbers) return after;
  return { ...after, page: withPreset({ ...before, page: before.page }, change).page };
}

/** Twips as CSS points, which the page draws in. */
export const twipsCss = (twips: number) => `${Math.round((twips / 20) * 100) / 100}pt`;
