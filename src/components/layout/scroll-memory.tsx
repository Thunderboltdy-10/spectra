"use client";

import { useEffect } from "react";

/*
 * Where the reader was, kept for every place in the app (a page, a Library
 * folder, a School tab): how far each of its scrolling panes was scrolled and
 * what had focus. Coming back to the place, by Back or by going there again,
 * puts both back once its content has drawn, so the reader is where they left
 * off. A pane that keeps its own position (a thread following its answer, the
 * calendar's week) opts out with data-scroll-memory="off".
 */

type Place = { panes: Record<string, number>; focus?: string; at: number };

const STORE = "spectra:scroll-memory:v1";
const MAX_PLACES = 80;
/** How long a returning place may take to draw before its scroll is put back as far as it goes. */
const RESTORE_FOR_MS = 2_500;
const LOCATION_EVENT = "spectra:location";

let places: Map<string, Place> | null = null;

function memory() {
  if (places) return places;
  places = new Map();
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORE) ?? "[]") as [string, Place][];
    for (const [key, place] of saved) places.set(key, place);
  } catch {
    // Nothing kept: places start at their top.
  }
  return places;
}

let saveTimer: number | undefined;
function persist() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      const entries = [...memory()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_PLACES);
      window.sessionStorage.setItem(STORE, JSON.stringify(entries));
    } catch {
      // Storage full or blocked: memory lasts for this page load.
    }
  }, 400);
}

/** The place as the address names it. */
function placeKey() {
  return `${window.location.pathname}${window.location.search}`;
}

function surface() {
  return document.querySelector<HTMLElement>("[data-spectra-app-surface]");
}

function optedOut(element: Element) {
  return Boolean(element.closest("[data-scroll-memory='off']"));
}

/**
 * A name for an element that stays the same when its page draws again: its
 * own key or id where it has one, else its path of class names and positions
 * from the app's surface.
 */
function describe(element: Element, root: Element): string | null {
  const own =
    element.getAttribute("data-scroll-key") ??
    (element.id ? `#${element.id}` : null) ??
    (element.getAttribute("data-node-row") ? `row:${element.getAttribute("data-node-row")}` : null);
  if (own) return own;
  const steps: string[] = [];
  let node: Element | null = element;
  while (node && node !== root) {
    const parent: Element | null = node.parentElement;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.children, node);
    const name = node.getAttribute("aria-label") ?? String(node.className || node.tagName).split(" ")[0];
    steps.unshift(`${name}@${index}`);
    node = parent;
  }
  return node === root ? steps.join(">") : null;
}

function find(description: string, root: Element): HTMLElement | null {
  if (description.startsWith("#")) return document.getElementById(description.slice(1));
  if (description.startsWith("row:"))
    return root.querySelector<HTMLElement>(`[data-node-row="${CSS.escape(description.slice(4))}"]`);
  if (!description.includes("@"))
    return root.querySelector<HTMLElement>(`[data-scroll-key="${CSS.escape(description)}"]`);
  let node: Element | null = root;
  for (const step of description.split(">")) {
    const index = Number(step.slice(step.lastIndexOf("@") + 1));
    node = node?.children[index] ?? null;
    if (!node) return null;
  }
  return node as HTMLElement | null;
}

/** Tells this memory when the address changes, however it was changed. */
function watchHistory() {
  const marked = window.history as History & { __spectraScrollMemory?: boolean };
  if (marked.__spectraScrollMemory) return;
  marked.__spectraScrollMemory = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History["pushState"]>) => {
      original(...args);
      window.dispatchEvent(new Event(LOCATION_EVENT));
    };
  }
}

export function ScrollMemory() {
  useEffect(() => {
    watchHistory();
    let current = placeKey();
    let restoring: { stop: () => void } | null = null;

    const remember = (event: Event) => {
      const root = surface();
      const target = event.target;
      if (!root || !(target instanceof HTMLElement) || !root.contains(target) || optedOut(target)) return;
      if (restoring) return;
      const description = describe(target, root);
      if (!description) return;
      const place = memory().get(current) ?? { panes: {}, at: Date.now() };
      place.panes[description] = target.scrollTop;
      place.at = Date.now();
      memory().set(current, place);
      persist();
    };

    const rememberFocus = (event: FocusEvent) => {
      const root = surface();
      const target = event.target;
      if (!root || !(target instanceof HTMLElement) || !root.contains(target) || optedOut(target)) return;
      const description = describe(target, root);
      if (!description) return;
      const place = memory().get(current) ?? { panes: {}, at: Date.now() };
      place.focus = description;
      place.at = Date.now();
      memory().set(current, place);
      persist();
    };

    const restore = (key: string) => {
      restoring?.stop();
      restoring = null;
      const place = memory().get(key);
      if (!place) return;
      const started = performance.now();
      const pending = new Map(Object.entries(place.panes).filter(([, top]) => top > 0));
      let focusPending = place.focus;
      let frame = 0;
      const stop = () => {
        window.cancelAnimationFrame(frame);
        window.removeEventListener("wheel", stop, true);
        window.removeEventListener("touchstart", stop, true);
        window.removeEventListener("keydown", stop, true);
        window.removeEventListener("pointerdown", stop, true);
        if (restoring?.stop === stop) restoring = null;
      };
      // The reader moving on their own ends the putting back.
      window.addEventListener("wheel", stop, true);
      window.addEventListener("touchstart", stop, true);
      window.addEventListener("keydown", stop, true);
      window.addEventListener("pointerdown", stop, true);
      const step = () => {
        const root = surface();
        const late = performance.now() - started > RESTORE_FOR_MS;
        if (root) {
          for (const [description, top] of pending) {
            const pane = find(description, root);
            if (!pane || optedOut(pane)) continue;
            const reach = pane.scrollHeight - pane.clientHeight;
            // Wait for the content to draw far enough, unless it never will.
            if (reach + 1 < top && !late) continue;
            pane.scrollTop = Math.min(top, reach);
            pending.delete(description);
          }
          if (focusPending && !pending.size) {
            const active = document.activeElement;
            const free = !active || active === document.body || !root.contains(active);
            const element = find(focusPending, root);
            if (element && free && !optedOut(element)) {
              element.focus({ preventScroll: true });
              focusPending = undefined;
            } else if (late || !free) focusPending = undefined;
          }
        }
        if ((pending.size || focusPending) && !late) frame = window.requestAnimationFrame(step);
        else stop();
      };
      restoring = { stop };
      frame = window.requestAnimationFrame(step);
    };

    const moved = () => {
      const next = placeKey();
      if (next === current) return;
      current = next;
      restore(next);
    };

    window.addEventListener("scroll", remember, { capture: true, passive: true });
    document.addEventListener("focusin", rememberFocus);
    window.addEventListener("popstate", moved);
    window.addEventListener(LOCATION_EVENT, moved);
    // A reload lands back where it was too.
    restore(current);
    return () => {
      restoring?.stop();
      window.removeEventListener("scroll", remember, true);
      document.removeEventListener("focusin", rememberFocus);
      window.removeEventListener("popstate", moved);
      window.removeEventListener(LOCATION_EVENT, moved);
    };
  }, []);
  return null;
}
