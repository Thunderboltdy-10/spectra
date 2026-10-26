"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { drawPrism, PrismBody, PRISM_PALETTES, type PrismMode } from "@/features/spectra/life/prism";
import { prefersStill } from "./use-motion";

/*
 * Spectra's prism, at any size, in the flow of the page. It is the island's
 * own body and drawing (the same PrismBody, the same display list): it leans
 * toward a pointer that comes near, turns when touched and can be spun by
 * dragging. It draws only while it moves, is on screen and the tab is
 * visible; a settled prism costs nothing.
 */

/** Room around the body for its turn and its status dot, as the island's. */
const ROOM = 1.6;

export function LivePrism({
  width,
  mode = "rest",
  turns = 0,
  interactive = false,
  palette = "auto",
  className,
  style,
  label,
  badge = false,
}: {
  /** The prism's box, as CSS (its room included); the body is drawn at width / 1.6. */
  width: string;
  mode?: PrismMode;
  /** Each increment turns it round once. */
  turns?: number;
  interactive?: boolean;
  palette?: "light" | "dark" | "auto";
  className?: string;
  style?: CSSProperties;
  label?: string;
  /** Show the app's status dot (done, working). Off on the page, where it reads as noise. */
  badge?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef<PrismBody | null>(null);
  const wakeRef = useRef<() => void>(() => undefined);
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const body = (bodyRef.current ??= new PrismBody());
    body.still = prefersStill();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    let frame = 0;
    let last = 0;
    let drawnKey = "";
    let visible = true;
    let side = box.clientWidth;
    let dragFrom: { x: number; y: number; at: number } | null = null;

    const draw = (force = false) => {
      if (side <= 0) return;
      const pixels = Math.max(2, Math.round(side * ratio));
      if (canvas.width !== pixels) {
        canvas.width = pixels;
        canvas.height = pixels;
        force = true;
      }
      const pose = body.pose();
      const key = `${pixels}|${pose.orientation.join(",")}|${pose.scale}|${pose.hue}|${pose.spectrum}|${pose.glint}|${pose.status?.size ?? 0}`;
      if (!force && key === drawnKey) return;
      drawnKey = key;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, pixels, pixels);
      const tone = paletteRef.current === "auto" ? (document.documentElement.classList.contains("dark") ? "dark" : "light") : paletteRef.current;
      const size = side / ROOM;
      drawPrism(ctx, pose, {
        x: pixels / 2,
        y: pixels / 2,
        size: size * ratio,
        palette: PRISM_PALETTES[tone],
        pixelRatio: ratio,
        detail: size >= 96 ? "hero" : size < 24 ? "mark" : "live",
      });
    };

    const tick = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      body.step(dt);
      draw();
      frame = visible && !document.hidden && body.isLively() ? requestAnimationFrame(tick) : 0;
      if (!frame) last = 0;
    };
    const wake = () => {
      if (!frame && visible && !document.hidden) frame = requestAnimationFrame(tick);
    };
    wakeRef.current = wake;

    const sized = new ResizeObserver(() => {
      side = box.clientWidth;
      draw(true);
    });
    sized.observe(box);
    const seen = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) wake();
    });
    seen.observe(box);
    const onVisibility = () => wake();
    document.addEventListener("visibilitychange", onVisibility);

    const centre = () => {
      const rect = box.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: rect.width / ROOM };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!visible) return;
      const at = centre();
      const dx = (event.clientX - at.x) / (at.size * 0.6);
      const dy = (event.clientY - at.y) / (at.size * 0.6);
      if (dragFrom) {
        const now = performance.now();
        body.drag((event.clientX - dragFrom.x) / (at.size * 0.5), (event.clientY - dragFrom.y) / (at.size * 0.5), Math.max(1 / 240, (now - dragFrom.at) / 1000));
        dragFrom = { x: event.clientX, y: event.clientY, at: now };
      }
      const distance = Math.hypot(dx, dy);
      body.hover(distance < 1.1 || Boolean(dragFrom));
      // It notices a pointer within a few of its own sizes, and leans a little.
      if (distance < 6) body.setLean(Math.max(-1, Math.min(1, dx * 0.3)), Math.max(-1, Math.min(1, dy * 0.3)));
      else body.setLean(0, 0);
      wake();
    };
    const onPointerDown = (event: PointerEvent) => {
      const at = centre();
      if (Math.hypot(event.clientX - at.x, event.clientY - at.y) > at.size * 0.66) return;
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
    if (interactive) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      canvas.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointerup", onPointerUp);
    }
    const theme = new MutationObserver(() => draw(true));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    draw(true);
    wake();
    return () => {
      cancelAnimationFrame(frame);
      sized.disconnect();
      seen.disconnect();
      theme.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [interactive]);

  useEffect(() => {
    bodyRef.current?.setMode(mode);
    if (!badge) bodyRef.current?.setStatus(null);
    wakeRef.current();
  }, [mode, badge]);

  useEffect(() => {
    if (!turns) return;
    bodyRef.current?.spin(1);
    wakeRef.current();
  }, [turns]);

  return (
    <div
      ref={boxRef}
      className={["sp-prism", className].filter(Boolean).join(" ")}
      data-interactive={interactive || undefined}
      style={{ ...style, width }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
