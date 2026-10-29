"use client";

/*
 * Filing something into one of Spectra's pages on the landing: the page is
 * the app's own component, re-rendered from the story world, so what arrives
 * is a real element. These helpers keep that change calm. Before the world
 * changes, everything already on the page is marked as known; whatever
 * appears without the mark is held invisible until it is set down. Things
 * that only moved (a card pushed along the desk) glide from where they were.
 */

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

/** Marks what is on the page now, and remembers where each thing sits. */
export function snapshot(root: HTMLElement, selector: string) {
  const places = new Map<Element, DOMRect>();
  for (const element of root.querySelectorAll<HTMLElement>(selector)) {
    element.dataset.known = "";
    places.set(element, element.getBoundingClientRect());
  }
  return places;
}

/** What moved since the snapshot glides from its old place to its new one. */
export function glide(places: Map<Element, DOMRect>, ms = 520) {
  for (const [element, was] of places) {
    if (!element.isConnected) continue;
    const now = element.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    // Inside a scaled window a pixel on screen is less than a pixel of the page.
    const scale = (element as HTMLElement).offsetWidth ? now.width / (element as HTMLElement).offsetWidth : 1;
    element.animate([{ transform: `translate(${dx / scale}px, ${dy / scale}px)` }, { transform: "none" }], {
      duration: ms,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
  }
}

/** Waits (a few frames at most) for an element the world change is about to render. */
export async function arrival(root: HTMLElement, selector: string, text: string, signal?: AbortSignal, within = 2400) {
  const until = performance.now() + within;
  while (!signal?.aborted && performance.now() < until) {
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      if (element.textContent?.includes(text)) return element;
    }
    await frame();
  }
  return null;
}

/**
 * What a hand carried becomes the thing it was filed as: the copy stretches
 * onto the real element's box and fades as the element comes through it.
 */
export async function morph(copy: HTMLElement, target: HTMLElement, layer: HTMLElement, ms = 460) {
  const box = target.getBoundingClientRect();
  const stage = layer.getBoundingClientRect();
  const from = copy.getBoundingClientRect();
  const width = copy.offsetWidth || from.width;
  const height = copy.offsetHeight || from.height;
  const start = getComputedStyle(copy).transform;
  const end = `translate3d(${box.left - stage.left}px, ${box.top - stage.top}px, 0) scale(${box.width / width}, ${box.height / height})`;
  target.dataset.landing = "here";
  // Set down, it is part of the page: nothing that hides what is still coming applies to it.
  target.dataset.known = "";
  const motion = copy.animate(
    [
      { transform: start === "none" ? "none" : start, opacity: 1, filter: "blur(0px)" },
      { opacity: 0.85, filter: "blur(0.5px)", offset: 0.55 },
      { transform: end, opacity: 0, filter: "blur(5px)" },
    ],
    { duration: ms, easing: "cubic-bezier(0.5, 0, 0.2, 1)", fill: "forwards" },
  );
  await motion.finished.catch(() => undefined);
  copy.remove();
}

/** Lets go of the marks once a filing is done. */
export function settle(root: HTMLElement) {
  for (const element of root.querySelectorAll<HTMLElement>("[data-known], [data-landing]")) {
    delete element.dataset.known;
    window.setTimeout(() => delete element.dataset.landing, 900);
  }
}
