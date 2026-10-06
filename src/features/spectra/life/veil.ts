/*
 * Hiding something while light forms it (LIFE.md: "it is hidden until it
 * has"). More than one moment can claim the same element at once (a row that
 * arrives where a ghost hands over), so hiding is counted: the element shows
 * when the last moment is done, exactly as it was before the first.
 */

const veiled = new WeakMap<HTMLElement, { count: number; previous: string }>();

/** Hides `element`; the returned function shows it again (once, however often it is called). */
export function veil(element: HTMLElement): () => void {
  const entry = veiled.get(element);
  if (entry) {
    entry.count += 1;
  } else {
    veiled.set(element, { count: 1, previous: element.style.opacity });
    element.style.opacity = "0";
  }
  let shown = false;
  return () => {
    if (shown) return;
    shown = true;
    const current = veiled.get(element);
    if (!current || --current.count > 0) return;
    veiled.delete(element);
    element.style.opacity = current.previous;
  };
}

/** Something is forming it right now: it brings its own light. */
export function isVeiled(element: HTMLElement): boolean {
  return veiled.has(element);
}
