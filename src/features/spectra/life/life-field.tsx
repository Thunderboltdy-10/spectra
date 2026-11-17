"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSpectraMotion } from "../motion/motion-level";
import type { LifeTier } from "./engine";
import { figureOf, hasVisibleFrame, replacementOf } from "./figure-dom";

export { replacementOf };
import { life, type Formed } from "./life";
import { isVeiled, veil, VEIL_MAX_MS } from "./veil";
import { markNavigation, sendInto } from "./use-life";

/*
 * The field's two canvases, fixed to the viewport: the back layer under the
 * interface (the lattice, seen through open paper) and the front layer over
 * it (free particles). Mount once, in the app shell.
 *
 * It gives every press a ripple and every drag a wake by itself (native
 * drag and drop included), and turns every loading placeholder marked
 * `data-life-ghost` into a ghost of the field, so pages only call `life` for
 * their own moments. With reduced or no motion it mounts nothing and every
 * `life` call is a no-op.
 */

const GHOST = "[data-life-ghost]";
/** Placeholders that are not drawn (hidden, collapsed) never become ghosts. */
const MAX_GHOSTS = 16;

const INK_LIGHT = [20, 19, 24] as const;
const INK_DARK = [243, 241, 236] as const;

/** The lines of real content a ghost's bars flow into. */
const CONTENT_BARS = "h1, h2, h3, h4, [data-row-title], [data-row-meta], [data-card-title], [data-thread-title], p, li";

/**
 * What took a ghost's place: the largest element at its centre that sits over
 * most of it without being much bigger. Nothing there (the page changed, the
 * list came back empty) means the ghost simply fades.
 */

/** The content is hidden for a moment while the ghost's lines flow toward its frame and lines, then it is real and they fade. */
function handOver(formed: Formed, content: HTMLElement) {
  const r = content.getBoundingClientRect();
  // Content that is forming itself (a landing, an arrival) brings its own light.
  if (!r.width || r.bottom < 0 || r.top > window.innerHeight || isVeiled(content)) return formed.release();
  const reveal = veil(content);
  const morph = life.morph(formed, figureOf(content, { bars: CONTENT_BARS, maxBars: 24, frame: hasVisibleFrame(content) }));
  // The ghost's lines set off toward the content's and give way as it shows: they never stand over real text.
  const show = () => {
    reveal();
    morph.release();
  };
  void morph.formed.then(show);
  window.setTimeout(show, VEIL_MAX_MS);
}

function chooseTier(): LifeTier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 8;
  const memory = nav.deviceMemory ?? 8;
  return cores <= 4 || memory <= 4 ? "light" : "full";
}

function isDark() {
  const root = document.documentElement;
  return root.classList.contains("dark") || root.dataset.theme === "dark";
}

export function LifeField() {
  const motion = useSpectraMotion();
  const pathname = usePathname();
  // A new page settles as content; only what appears after it is an arrival.
  useEffect(() => markNavigation(), [pathname]);
  const hostRef = useRef<HTMLDivElement>(null);
  const enabled = motion.level === "full";

  useEffect(() => {
    const host = hostRef.current;
    if (!enabled || !host) return;
    // Canvases are made here, not rendered: one handed to a worker can never
    // be taken back, so each mount gets fresh ones.
    const layer = (z: string) => {
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      canvas.className = "pointer-events-none fixed inset-0 h-full w-full";
      canvas.style.zIndex = z;
      host.append(canvas);
      return canvas;
    };
    // Under everything, over only the body's paper: opaque surfaces cover it.
    const back = layer("-1");
    // Over the page and its side panels, under what floats over the page:
    // Setup and dialogs (modal), the island and its thread cards. Loading
    // formations used to draw over all of those.
    const front = layer("calc(var(--z-modal) - 1)");
    const detach = life.attach(back, front, chooseTier());

    const resize = () => life.resize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
    const theme = () => {
      const dark = isDark();
      life.theme(dark, dark ? INK_DARK : INK_LIGHT);
    };
    resize();
    theme();
    const themeObserver = new MutationObserver(theme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });

    // Pointer moves are coalesced to one message per frame.
    let pending: PointerEvent | null = null;
    let frame = 0;
    let last = { x: 0, y: 0, t: 0 };
    const flush = () => {
      frame = 0;
      const event = pending;
      pending = null;
      if (!event) return;
      life.pointer(event.clientX, event.clientY, true);
      const now = event.timeStamp;
      const dt = Math.max(8, now - last.t) / 1000;
      if (event.buttons) {
        life.wake(event.clientX, event.clientY, (event.clientX - last.x) / dt, (event.clientY - last.y) / dt);
      }
      last = { x: event.clientX, y: event.clientY, t: now };
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pending = event;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const down = (event: PointerEvent) => {
      last = { x: event.clientX, y: event.clientY, t: event.timeStamp };
      life.pulse(event.clientX, event.clientY, 0.35);
    };
    const leave = () => life.pointer(-1e4, -1e4, false);

    // Native drag and drop stops pointer events: its moves still leave a wake, and a drop ripples.
    let lastDrag = { x: 0, y: 0, t: 0 };
    const dragOver = (event: DragEvent) => {
      const now = event.timeStamp;
      if (now - lastDrag.t < 16) return;
      const dt = Math.max(8, now - lastDrag.t) / 1000;
      if (lastDrag.t) life.wake(event.clientX, event.clientY, (event.clientX - lastDrag.x) / dt, (event.clientY - lastDrag.y) / dt);
      lastDrag = { x: event.clientX, y: event.clientY, t: now };
    };
    const drop = (event: DragEvent) => {
      lastDrag = { x: 0, y: 0, t: 0 };
      life.pulse(event.clientX, event.clientY, 0.9);
    };
    const dragEnd = (event: DragEvent) => {
      // A cancelled drag flies back along its path: light from where it was let go, taken back into where it came from.
      const source = event.target instanceof Element ? event.target : null;
      if (event.dataTransfer?.dropEffect === "none" && lastDrag.t && source?.isConnected) sendInto(source, [lastDrag.x, lastDrag.y]);
      lastDrag = { x: 0, y: 0, t: 0 };
    };

    // Loading placeholders become ghosts while they are in the page, and release into what replaces them.
    // The canvas is fixed to the screen, so each frame a ghost is moved with its placeholder (a scroll, a
    // layout shift) and drawn only where the placeholder itself can be seen: inside the panes that clip it
    // and never over a menu, a popup or the island that covers it.
    type Ghost = { formed: Formed; rect: DOMRect; clippers: Element[]; clip: string };
    const ghosts = new Map<Element, Ghost>();
    const clippersOf = (element: Element) => {
      const out: Element[] = [];
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") out.push(parent);
      }
      return out;
    };
    const related = (element: Element, hit: Element | null) =>
      !hit || hit === element || element.contains(hit) || hit.contains(element);
    const visibleRect = (element: Element, ghost: Pick<Ghost, "clippers">, r: DOMRect) => {
      let left = Math.max(0, r.left);
      let top = Math.max(0, r.top);
      let right = Math.min(window.innerWidth, r.right);
      let bottom = Math.min(window.innerHeight, r.bottom);
      for (const clipper of ghost.clippers) {
        const c = clipper.getBoundingClientRect();
        left = Math.max(left, c.left);
        top = Math.max(top, c.top);
        right = Math.min(right, c.right);
        bottom = Math.min(bottom, c.bottom);
      }
      if (right - left < 2 || bottom - top < 2) return null;
      // Covered anywhere we look (a menu, a dialog, the island): the ghost waits unseen until it is clear.
      const inset = 3;
      const points: [number, number][] = [
        [(left + right) / 2, (top + bottom) / 2],
        [left + inset, top + inset],
        [right - inset, top + inset],
        [left + inset, bottom - inset],
        [right - inset, bottom - inset],
      ];
      for (const [x, y] of points) if (!related(element, document.elementFromPoint(x, y))) return null;
      return { x: left, y: top, width: right - left, height: bottom - top };
    };
    const HIDDEN = { x: 0, y: 0, width: 0, height: 0 };
    const adopt = (element: Element) => {
      if (ghosts.has(element) || ghosts.size >= MAX_GHOSTS) return;
      const r = element.getBoundingClientRect();
      if (r.width < 8 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight) return;
      const clippers = clippersOf(element);
      const clip = visibleRect(element, { clippers }, r);
      if (!clip) return;
      // One ghost per placeholder: its frame if it shows one, and its bars where the content will be, so it settles as
      // lines and releases into the real thing.
      const formed = life.ghost(figureOf(element, { bars: "[data-life-ghost-bar]", maxBars: 24, frame: hasVisibleFrame(element) }));
      life.place(formed, 0, 0, clip);
      ghosts.set(element, { formed, rect: r, clippers, clip: JSON.stringify(clip) });
    };
    const follow = () => {
      for (const [element, ghost] of ghosts) {
        if (!element.isConnected || !element.matches(GHOST)) continue;
        const now = element.getBoundingClientRect();
        if (Math.abs(now.width - ghost.rect.width) > 4 || Math.abs(now.height - ghost.rect.height) > 4) {
          // A different shape is a different figure: this one goes, and the placeholder is taken up afresh.
          ghosts.delete(element);
          life.place(ghost.formed, 0, 0, HIDDEN);
          ghost.formed.release();
          continue;
        }
        const dx = now.left - ghost.rect.left;
        const dy = now.top - ghost.rect.top;
        const clip = visibleRect(element, ghost, now) ?? HIDDEN;
        const key = JSON.stringify(clip);
        if (!dx && !dy && key === ghost.clip) continue;
        life.place(ghost.formed, dx, dy, clip);
        ghost.rect = now;
        ghost.clip = key;
      }
    };
    const sweep = () => {
      for (const [element, ghost] of ghosts) {
        if (element.isConnected && element.matches(GHOST)) continue;
        ghosts.delete(element);
        // The ghost hands over: its lines flow into the content that took its place.
        const content = element.isConnected ? (element as HTMLElement) : replacementOf(ghost.rect);
        if (content) handOver(ghost.formed, content);
        else {
          // Gone with its page: it leaves with it, not standing where the page used to be.
          life.place(ghost.formed, 0, 0, HIDDEN);
          ghost.formed.release();
        }
      }
    };
    let scanFrame = 0;
    let followFrame = 0;
    const tick = () => {
      followFrame = 0;
      follow();
      if (ghosts.size) followFrame = requestAnimationFrame(tick);
    };
    const scan = () => {
      scanFrame = 0;
      sweep();
      document.querySelectorAll(GHOST).forEach(adopt);
      if (ghosts.size && !followFrame) followFrame = requestAnimationFrame(tick);
    };
    const ghostObserver = new MutationObserver(() => {
      if (!scanFrame) scanFrame = requestAnimationFrame(scan);
    });
    ghostObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-life-ghost"] });
    scan();
    document.documentElement.dataset.life = "on";
    const rescan = () => {
      if (!scanFrame) scanFrame = requestAnimationFrame(scan);
    };

    window.addEventListener("resize", resize);
    window.addEventListener("resize", rescan);
    document.addEventListener("scroll", rescan, { passive: true, capture: true });
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("dragover", dragOver, { passive: true });
    window.addEventListener("drop", drop, { passive: true, capture: true });
    window.addEventListener("dragend", dragEnd, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(scanFrame);
      cancelAnimationFrame(followFrame);
      ghostObserver.disconnect();
      for (const { formed } of ghosts.values()) formed.release();
      ghosts.clear();
      delete document.documentElement.dataset.life;
      window.removeEventListener("dragover", dragOver);
      window.removeEventListener("drop", drop, { capture: true });
      window.removeEventListener("dragend", dragEnd);
      cancelAnimationFrame(frame);
      themeObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("resize", rescan);
      document.removeEventListener("scroll", rescan, { capture: true });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      document.documentElement.removeEventListener("pointerleave", leave);
      detach();
      back.remove();
      front.remove();
    };
  }, [enabled]);

  if (!enabled) return null;
  return <div ref={hostRef} aria-hidden className="contents" />;
}
