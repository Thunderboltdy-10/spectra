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
    if (visible) tallest = Math.max(tallest, rect.height);
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

function schedule() {
  if (frame) return;
  frame = window.requestAnimationFrame(publish);
}

function sharedObserver(): ResizeObserver {
  observer ??= new ResizeObserver(schedule);
  return observer;
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
