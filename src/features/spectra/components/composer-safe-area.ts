"use client";

/**
 * One shared bottom clearance for every surface the island can cover
 * (SHELL.md, "Page anatomy").
 *
 * The island is `position: fixed`, so no layout inside a surface can know how
 * tall it is. The island registers its resting row here, and the tallest
 * visible band's height is published as `--spectra-composer-safe-area` on the
 * document root, where every surface — Library list and board, workspace
 * home, studio scrollports — consumes it with one CSS rule. When no band is
 * mounted the variable is removed and surfaces fall back to their own small
 * padding.
 */

const SAFE_AREA_VAR = "--spectra-composer-safe-area";
/** Breathing room between the band's top edge and the content above it. */
const SAFE_AREA_GAP_PX = 12;

const bands = new Set<HTMLElement>();
let observer: ResizeObserver | null = null;
let frame = 0;
let listening = false;

function publish() {
  frame = 0;
  const root = document.documentElement;
  let tallest = 0;
  for (const band of bands) {
    const rect = band.getBoundingClientRect();
    const visible =
      rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
    if (visible) tallest = Math.max(tallest, rect.bottom - overhangTop(band, rect.top));
  }
  if (tallest > 0) {
    root.style.setProperty(
      SAFE_AREA_VAR,
      `${Math.round(tallest + SAFE_AREA_GAP_PX)}px`,
    );
  } else {
    root.style.removeProperty(SAFE_AREA_VAR);
  }
}

/**
 * What a band holds above its own box (the island's tab rail stands over the
 * composer) covers the page too; it is marked `data-band-overhang`.
 */
function overhangTop(band: HTMLElement, top: number) {
  let highest = top;
  for (const part of band.querySelectorAll<HTMLElement>("[data-band-overhang]")) {
    sharedObserver().observe(part);
    const rect = part.getBoundingClientRect();
    if (rect.height > 0) highest = Math.min(highest, rect.top);
  }
  return highest;
}

function schedule() {
  if (frame) return;
  frame = window.requestAnimationFrame(publish);
}

function sharedObserver(): ResizeObserver {
  observer ??= new ResizeObserver(schedule);
  return observer;
}

/** Measures the bands again, when something above one came or went. */
export function refreshComposerBands() {
  schedule();
}

/** Registers one mounted band; the returned cleanup must run on unmount. */
export function registerComposerBand(band: HTMLElement): () => void {
  bands.add(band);
  sharedObserver().observe(band);
  // One shared window listener no matter how many bands are mounted; the
  // registry, not the route, owns the variable's lifetime.
  if (!listening) {
    window.addEventListener("resize", schedule);
    listening = true;
  }
  schedule();
  return () => {
    bands.delete(band);
    observer?.unobserve(band);
    if (bands.size === 0 && listening) {
      window.removeEventListener("resize", schedule);
      listening = false;
    }
    schedule();
  };
}
