"use client";

/**
 * How much motion the story is allowed.
 *
 * The landing is scroll-driven, and scroll-driven is not the same as animated:
 * moving a camera in response to a person's own gesture is what a scrollbar
 * does. So calm mode does not freeze the page. What it removes is everything
 * the page does *on its own* while the visitor is still: characters appearing
 * one at a time, an edge that shimmers, a cursor that travels between two
 * points, an object that lags the hand carrying it.
 *
 * Read as a plain mutable object rather than through React, because the things
 * that consult it run inside the frame loop and must not cost a render. It is
 * kept in step with the product's own two sources of truth: the user's stored
 * `motionLevel` preference, mirrored onto the document element, and the
 * operating system's `prefers-reduced-motion`.
 */

export const storyMotion = {
  /** Calm or off: nothing moves unless the visitor is moving it. */
  reduced: false,
  /** Off entirely: state changes are instant. */
  disabled: false,
};

function read() {
  const preference =
    typeof document === "undefined"
      ? "full"
      : (document.documentElement.dataset.spectraMotion ?? "full");
  const os =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  storyMotion.disabled = preference === "none";
  storyMotion.reduced = preference !== "full" || os;
}

let watching = false;

/**
 * Keep `storyMotion` current for as long as the story is mounted.
 *
 * Idempotent: the story root calls it, and calling it again from anywhere else
 * is free. The observer is never torn down because the landing lives for the
 * lifetime of the page.
 */
export function watchStoryMotion() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  read();
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", read);
  new MutationObserver(read).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-spectra-motion"],
  });
}
