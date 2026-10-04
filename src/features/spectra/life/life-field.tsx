"use client";

import { useEffect, useRef } from "react";
import { useSpectraMotion } from "../motion/motion-level";
import type { LifeTier } from "./engine";
import { life } from "./life";

/*
 * The field's two canvases, fixed to the viewport: the back layer under the
 * interface (the lattice, seen through open paper) and the front layer over
 * it (free particles). Mount once, in the app shell.
 *
 * It gives every press a ripple and every drag a wake by itself, so pages
 * only call `life` for their own moments. With reduced or no motion it
 * mounts nothing and every `life` call is a no-op.
 */

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
      canvas.className = `pointer-events-none fixed inset-0 h-full w-full ${z}`;
      host.append(canvas);
      return canvas;
    };
    const back = layer("z-0");
    const front = layer("z-[60]");
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

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
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
