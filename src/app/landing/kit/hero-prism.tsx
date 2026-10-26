"use client";

import { useEffect, useRef } from "react";
import { drawPrism, PrismBody, PRISM_PALETTES, type PrismMode } from "@/features/spectra/life/prism";

/*
 * The page's one prism. It is the island's own body and drawing (the same
 * PrismBody, the same display list), only larger: in the hero it leans toward
 * the pointer, turns when touched and can be spun by dragging; as the page
 * scrolls it travels down into the island and lands on the island's prism at
 * exactly its size and pose, where the island's takes over.
 *
 * It costs a few dozen polygons a frame, and only while it moves: once the
 * body settles and the page is still, nothing runs.
 */

/** Room around the body for its turn and its status dot, as the island's. */
const ROOM = 1.6;

export type PrismSlot = { x: number; y: number; size: number };

function reducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function HeroPrism({
  slot,
  mode,
  interactive,
  turns,
}: {
  /** Where the prism is and how big, read each time the page moves. */
  slot: () => PrismSlot | null;
  mode: PrismMode;
  /** True while it is in the hero, where the pointer can touch it. */
  interactive: boolean;
  /** Each increment turns it round once. */
  turns: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef<PrismBody | null>(null);
  const wakeRef = useRef<() => void>(() => undefined);
  const slotRef = useRef(slot);
  slotRef.current = slot;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const body = (bodyRef.current ??= new PrismBody());
    body.still = reducedMotion();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    let frame = 0;
    let last = 0;
    let drawnKey = "";
    let dragFrom: { x: number; y: number; at: number } | null = null;

    const draw = (force = false) => {
      const place = slotRef.current();
      if (!place || place.size <= 0) return;
      const box = Math.round(place.size * ROOM);
      const pixels = Math.max(2, Math.round(box * ratio));
      if (canvas.width !== pixels) {
        canvas.width = pixels;
        canvas.height = pixels;
        canvas.style.width = `${box}px`;
        canvas.style.height = `${box}px`;
      }
      canvas.style.transform = `translate3d(${(place.x - box / 2).toFixed(1)}px, ${(place.y - box / 2).toFixed(1)}px, 0)`;
      const pose = body.pose();
      const key = `${pixels}|${pose.orientation.join(",")}|${pose.scale}|${pose.hue}|${pose.spectrum}|${pose.glint}|${pose.status?.size ?? 0}`;
      if (!force && key === drawnKey) return;
      drawnKey = key;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, pixels, pixels);
      drawPrism(ctx, pose, {
        x: pixels / 2,
        y: pixels / 2,
        size: place.size * ratio,
        palette: PRISM_PALETTES[document.documentElement.classList.contains("dark") ? "dark" : "light"],
        pixelRatio: ratio,
        // The island draws its 24px prism in "live" detail; match it wherever it is that small.
        detail: place.size >= 96 ? "hero" : place.size < 24 ? "mark" : "live",
      });
    };

    const tick = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      body.step(dt);
      draw();
      frame = body.isLively() ? requestAnimationFrame(tick) : 0;
      if (!frame) last = 0;
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    wakeRef.current = wake;

    // The page moving moves the prism; it redraws at its new size on the next frame.
    let moved = 0;
    const onMove = () => {
      if (moved) return;
      moved = requestAnimationFrame(() => {
        moved = 0;
        draw();
      });
    };
    window.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("resize", onMove);

    const local = (event: PointerEvent) => {
      const place = slotRef.current();
      if (!place) return null;
      return { dx: (event.clientX - place.x) / (place.size * 0.6), dy: (event.clientY - place.y) / (place.size * 0.6), place };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!interactiveRef.current) return;
      const at = local(event);
      if (!at) return;
      if (dragFrom) {
        const now = performance.now();
        body.drag((event.clientX - dragFrom.x) / (at.place.size * 0.5), (event.clientY - dragFrom.y) / (at.place.size * 0.5), Math.max(1 / 240, (now - dragFrom.at) / 1000));
        dragFrom = { x: event.clientX, y: event.clientY, at: now };
      }
      const near = Math.hypot(at.dx, at.dy) < 1.1;
      body.hover(near || Boolean(dragFrom));
      // It leans toward the pointer anywhere in the hero, a little.
      body.setLean(Math.max(-1, Math.min(1, at.dx * 0.35)), Math.max(-1, Math.min(1, at.dy * 0.35)));
      wake();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!interactiveRef.current) return;
      const at = local(event);
      if (!at || Math.hypot(at.dx, at.dy) > 1.1) return;
      dragFrom = { x: event.clientX, y: event.clientY, at: performance.now() };
      canvas.setPointerCapture?.(event.pointerId);
      body.press();
      wake();
    };
    const onPointerUp = () => {
      if (!dragFrom) return;
      dragFrom = null;
      body.release();
      wake();
    };
    const onLeave = () => {
      body.hover(false);
      body.setLean(0, 0);
      wake();
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    document.documentElement.addEventListener("pointerleave", onLeave);
    const theme = new MutationObserver(() => draw(true));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    draw(true);
    wake();
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(moved);
      window.removeEventListener("scroll", onMove);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      theme.disconnect();
    };
  }, []);

  useEffect(() => {
    bodyRef.current?.setMode(mode);
    wakeRef.current();
  }, [mode]);

  useEffect(() => {
    if (!turns) return;
    bodyRef.current?.spin(1);
    wakeRef.current();
  }, [turns]);

  return <canvas ref={canvasRef} className="landing-prism" data-interactive={interactive || undefined} aria-hidden />;
}
