"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSpectraMotion } from "../motion/motion-level";
import type { LifeTier } from "./engine";
import { figureOf } from "./figure-dom";
import { life, type Formed } from "./life";
import { markNavigation } from "./use-life";

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
    // Over everything but toasts, the island included: formations hand over to
    // the element they become, wherever it sits.
    const front = layer("calc(var(--z-toast) - 1)");
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
    const dragEnd = () => {
      lastDrag = { x: 0, y: 0, t: 0 };
    };

    // Loading placeholders become ghosts while they are in the page, and release into what replaces them.
    const ghosts = new Map<Element, Formed>();
    const adopt = (element: Element) => {
      if (ghosts.has(element) || ghosts.size >= MAX_GHOSTS) return;
      const r = element.getBoundingClientRect();
      if (r.width < 8 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight) return;
      ghosts.set(element, life.ghost(figureOf(element, { bars: "[data-life-ghost-bar]", maxBars: 10 })));
    };
    const sweep = () => {
      for (const [element, formed] of ghosts) {
        if (element.isConnected && element.matches(GHOST)) continue;
        ghosts.delete(element);
        formed.release();
      }
    };
    let scanFrame = 0;
    const scan = () => {
      scanFrame = 0;
      sweep();
      document.querySelectorAll(GHOST).forEach(adopt);
    };
    const ghostObserver = new MutationObserver(() => {
      if (!scanFrame) scanFrame = requestAnimationFrame(scan);
    });
    ghostObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-life-ghost"] });
    scan();
    document.documentElement.dataset.life = "on";

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("dragover", dragOver, { passive: true });
    window.addEventListener("drop", drop, { passive: true, capture: true });
    window.addEventListener("dragend", dragEnd, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(scanFrame);
      ghostObserver.disconnect();
      for (const formed of ghosts.values()) formed.release();
      ghosts.clear();
      delete document.documentElement.dataset.life;
      window.removeEventListener("dragover", dragOver);
      window.removeEventListener("drop", drop, { capture: true });
      window.removeEventListener("dragend", dragEnd);
      cancelAnimationFrame(frame);
      themeObserver.disconnect();
      window.removeEventListener("resize", resize);
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
