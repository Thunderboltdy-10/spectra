/*
 * Hiding something while light forms it. Light leads, it never holds content
 * back: whatever the formation is doing, the element is there within
 * VEIL_MAX_MS and fades the rest of the way in. More than one moment can
 * claim the same element at once (a row that arrives where a ghost hands
 * over), so hiding is counted: the element shows when the last moment is
 * done, or the cap passes, exactly as it was before the first.
 */

/** The longest anything is hidden for light: a split second, never a wait. */
export const VEIL_MAX_MS = 160;
const FADE_MS = 120;

type Entry = { count: number; previous: string; timer: number };
const veiled = new WeakMap<HTMLElement, Entry>();

function reveal(element: HTMLElement, entry: Entry) {
  window.clearTimeout(entry.timer);
  veiled.delete(element);
  element.style.opacity = entry.previous;
  element.animate?.([{ opacity: 0 }, { opacity: entry.previous || 1 }], { duration: FADE_MS, easing: "ease-out" });
}

/** Hides `element`; the returned function shows it again (once, however often it is called). */
export function veil(element: HTMLElement): () => void {
  let entry = veiled.get(element);
  if (entry) {
    entry.count += 1;
  } else {
    const created: Entry = { count: 1, previous: element.style.opacity, timer: 0 };
    created.timer = window.setTimeout(() => {
      if (veiled.get(element) === created) reveal(element, created);
    }, VEIL_MAX_MS);
    veiled.set(element, created);
    element.style.opacity = "0";
    entry = created;
  }
  const mine = entry;
  let shown = false;
  return () => {
    if (shown) return;
    shown = true;
    if (veiled.get(element) !== mine || --mine.count > 0) return;
    reveal(element, mine);
  };
}

/** Something is forming it right now: it brings its own light. */
export function isVeiled(element: HTMLElement): boolean {
  return veiled.has(element);
}
