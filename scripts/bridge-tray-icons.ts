import {
  MARK_POSE,
  PRISM_PALETTES,
  STATUS_COLOURS,
  prismSvg,
  type PrismPose,
} from "../src/features/spectra/life/prism";

/*
 * The Spectra Bridge tray and app icons, drawn by the same prism renderer as
 * the app (the static mark pose). The pure half lives here so it can be
 * tested; generate-bridge-tray-icons.ts rasterises and writes the files.
 */

/** The four tray states (docs/product/DEVICES.md): the dot says the state. */
export const TRAY_DOTS = ["none", "grey", "orange", "red"] as const;
export type TrayDot = (typeof TRAY_DOTS)[number];

/** Windows tray sizes at 100, 125, 150 and 200 percent scaling. */
export const TRAY_SIZES = [16, 20, 24, 32] as const;

/** The taskbar or menu bar the icon sits on. */
export const TRAY_THEMES = ["light", "dark"] as const;
export type TrayTheme = (typeof TRAY_THEMES)[number];

const DOT_COLOURS: Record<Exclude<TrayDot, "none">, (typeof STATUS_COLOURS)["offline"]> = {
  grey: STATUS_COLOURS.offline,
  orange: STATUS_COLOURS.needs,
  red: STATUS_COLOURS.problem,
};

export type TrayVariant = { theme: TrayTheme; dot: TrayDot; size: number };

export function trayVariants(): TrayVariant[] {
  return TRAY_THEMES.flatMap((theme) =>
    TRAY_DOTS.flatMap((dot) => TRAY_SIZES.map((size) => ({ theme, dot, size }))),
  );
}

/** The file the Bridge embeds for a variant, relative to bridge/bridge-app/icons. */
export function trayFileName({ theme, dot, size }: TrayVariant): string {
  return `tray/${theme}-${dot}-${size}.png`;
}

export function trayPose(dot: TrayDot): PrismPose {
  if (dot === "none") return MARK_POSE;
  return { ...MARK_POSE, status: { rgb: DOT_COLOURS[dot], size: 1, from: 0 } };
}

/**
 * A light taskbar takes the light palette (dark lines); a dark one takes the
 * dark palette (light lines), so the mark keeps its outline on either.
 */
export function traySvg({ theme, dot, size }: TrayVariant): string {
  return prismSvg(trayPose(dot), { size, palette: PRISM_PALETTES[theme], detail: "mark" });
}

/** The installer and window-list icon: the mark alone on a transparent square. */
export function appIconSvg(size = 1024): string {
  return prismSvg(MARK_POSE, { size, palette: PRISM_PALETTES.dark, detail: "hero" });
}

/**
 * An ICO file whose entries are PNG images (supported since Windows Vista).
 * Each image must be square and at most 256 px.
 */
export function encodeIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const header = 6;
  const entry = 16;
  let offset = header + entry * images.length;
  const total = offset + images.reduce((sum, image) => sum + image.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  images.forEach((image, index) => {
    if (image.size < 1 || image.size > 256) throw new Error(`ICO images are 1 to 256 px, not ${image.size}`);
    const at = header + entry * index;
    out[at] = image.size === 256 ? 0 : image.size;
    out[at + 1] = image.size === 256 ? 0 : image.size;
    out[at + 2] = 0;
    out[at + 3] = 0;
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, image.png.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(image.png, offset);
    offset += image.png.length;
  });
  return out;
}
