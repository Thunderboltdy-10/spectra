/**
 * The stacking contract, named (ARCHITECTURE-PLATFORM §3).
 *
 * base(0) < chrome(40) < dropdown(60) < panel(80) < modal(100)
 *     < composer-dock(120) < toast(140)
 *
 * Every floating surface names one of these layers; numeric z-index in
 * feature code is lint-banned. The classes resolve through the `--z-*`
 * tokens wired in `spectra-tokens.css`, so the number lives in exactly one
 * place.
 *
 * Choosing a layer: `modal` for dialogs, `dropdown` for menus and picklists
 * opened from page chrome, `panel` for sheets and side popovers,
 * `composer-dock` for the dock and capture surfaces that must beat it,
 * `toast` for transient notifications and tooltips. An overlay opened
 * *inside* a dialog passes the dialog's own layer — same-zone portals paint
 * in open order, so a select list at `modal` floats over its dialog.
 */
export const LAYERS = [
  "base",
  "chrome",
  "dropdown",
  "panel",
  "modal",
  "composer-dock",
  "toast",
] as const;

export type SpectraLayer = (typeof LAYERS)[number];

export const LAYER_CLASS: Record<SpectraLayer, string> = {
  base: "z-base",
  chrome: "z-chrome",
  dropdown: "z-dropdown",
  panel: "z-panel",
  modal: "z-modal",
  "composer-dock": "z-composer-dock",
  toast: "z-toast",
};
