"use client";

import { useCallback, useEffect, useRef } from "react";
import { prismFigure, type Figure, type Point } from "../life/figure";
import { rectOf, type Rect } from "../life/life";
import { drawPrism, PrismBody, PRISM_PALETTES, type PrismMode, type PrismStatus } from "../life/prism";

/*
 * The island's prism: a PrismBody drawn on its own small canvas, stepped only
 * while it moves. It leans toward a pointer that comes near, turns once on
 * hover, and keeps its status dot. The figure helpers give the field the
 * prism's exact lines, so every morph starts and ends on it.
 */

export const PRISM_SIZE = 30;
const CANVAS = 56;
const NEAR = 160;

const isDark = () => document.documentElement.classList.contains("dark");

export type IslandPrism = ReturnType<typeof useIslandPrism>;

export function useIslandPrism({ still }: { still: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bodyRef = useRef<PrismBody | null>(null);
  const wakeRef = useRef<() => void>(() => {});
  if (!bodyRef.current) bodyRef.current = new PrismBody();

  useEffect(() => {
    bodyRef.current!.still = still;
  }, [still]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const body = bodyRef.current!;
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = CANVAS * ratio;
    canvas.height = CANVAS * ratio;
    let frame = 0;
    let last = 0;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawPrism(ctx, body.pose(), {
        x: canvas.width / 2,
        y: canvas.height / 2,
        size: PRISM_SIZE * ratio,
        palette: PRISM_PALETTES[isDark() ? "dark" : "light"],
        pixelRatio: ratio,
        detail: "live",
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
    draw();
    wake();
    // It notices a pointer that comes near and leans toward it.
    let near = false;
    const move = (event: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      const dx = event.clientX - (r.x + r.width / 2);
      const dy = event.clientY - (r.y + r.height / 2);
      const isNear = Math.hypot(dx, dy) < NEAR;
      if (!isNear && !near) return;
      near = isNear;
      body.setLean(isNear ? dx / (NEAR * 0.6) : 0, isNear ? dy / (NEAR * 0.6) : 0);
      wake();
    };
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      theme.disconnect();
      window.removeEventListener("pointermove", move);
    };
  }, []);

  const body = useCallback(() => bodyRef.current!, []);
  const wake = useCallback(() => wakeRef.current(), []);

  const centre = useCallback((): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return [window.innerWidth / 2, window.innerHeight - 40];
    const r = rectOf(canvas);
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, []);

  return {
    canvasRef,
    body,
    wake,
    centre,
    setMode: (mode: PrismMode) => {
      bodyRef.current!.setMode(mode);
      wakeRef.current();
    },
    setStatus: (status: PrismStatus | null) => {
      bodyRef.current!.setStatus(status);
      wakeRef.current();
    },
    spin: (turns: number) => {
      bodyRef.current!.spin(turns);
      wakeRef.current();
    },
    /** The prism's square on screen: what the field absorbs into. */
    rect: (): Rect => {
      const [x, y] = centre();
      return { x: x - PRISM_SIZE / 2, y: y - PRISM_SIZE / 2, width: PRISM_SIZE, height: PRISM_SIZE };
    },
    /** The prism's lines as a figure, in its current pose. */
    figure: (): Figure => {
      const [x, y] = centre();
      return prismFigure(bodyRef.current!.pose(), { x, y, size: PRISM_SIZE, palette: PRISM_PALETTES[isDark() ? "dark" : "light"] });
    },
    /** Where light leaves it: its apex. */
    apex: (): Point => {
      const [x, y] = centre();
      return [x, y - PRISM_SIZE * 0.42];
    },
  };
}
