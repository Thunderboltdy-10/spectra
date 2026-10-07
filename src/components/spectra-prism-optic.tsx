"use client";

import { useEffect, useRef } from "react";
import { drawPrism, PrismBody, PRISM_PALETTES, type PrismMode } from "@/features/spectra/life/prism";

/*
 * The prism in a line of the page, alive: the same body as the island's
 * (LIFE.md, "The prism"). It turns while Spectra works, faces you and warms
 * while it waits, turns twice and settles when done, and shakes and greys on
 * a problem, with its status dot beside its corner. It draws only while it
 * moves and is on screen; under reduced motion it holds still and only its
 * colours change.
 */

export type PrismOptics = "dormant" | "working" | "waiting" | "completed" | "failed";

const MODE: Record<PrismOptics, PrismMode> = {
  dormant: "rest",
  working: "working",
  waiting: "needs",
  completed: "done",
  failed: "problem",
};

/** Room around the body for its turn and its status dot. */
const ROOM = 1.6;

function reducedMotion() {
  const motion = document.documentElement.dataset.spectraMotion;
  return motion === "reduced" || motion === "none" || Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function PrismLoader({
  size = 28,
  optics = "working",
  className,
  label,
}: {
  size?: number;
  optics?: PrismOptics;
  className?: string;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef<PrismBody | null>(null);
  const box = Math.round(size * ROOM);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // One body for the element's life, so a change of state is a motion, not a new prism.
    const body = (bodyRef.current ??= new PrismBody());
    body.still = reducedMotion();
    body.setMode(MODE[optics]);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = box * ratio;
    canvas.height = box * ratio;
    let frame = 0;
    let last = 0;
    let visible = true;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawPrism(ctx, body.pose(), {
        x: canvas.width / 2,
        y: canvas.height / 2,
        size: size * ratio,
        palette: PRISM_PALETTES[document.documentElement.classList.contains("dark") ? "dark" : "light"],
        pixelRatio: ratio,
        detail: size < 24 ? "mark" : "live",
      });
    };
    const tick = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      body.step(dt);
      draw();
      frame = visible && body.isLively() ? requestAnimationFrame(tick) : 0;
      if (!frame) last = 0;
    };
    const wake = () => {
      if (!frame && visible) frame = requestAnimationFrame(tick);
    };
    draw();
    wake();
    const seen =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(([entry]) => {
            visible = Boolean(entry?.isIntersecting);
            if (visible) wake();
          })
        : null;
    seen?.observe(canvas);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      cancelAnimationFrame(frame);
      seen?.disconnect();
      theme.disconnect();
    };
  }, [box, optics, size]);

  return (
    <span
      className={className ? `spectra-prism-optic ${className}` : "spectra-prism-optic"}
      data-optics={optics}
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: size, height: size }}
    >
      <canvas ref={canvasRef} style={{ width: box, height: box, left: (size - box) / 2, top: (size - box) / 2 }} />
    </span>
  );
}

export function PrismRunMark({
  size = 18,
  optics = "working",
  slot,
}: {
  size?: number;
  optics?: PrismOptics;
  slot?: string;
}) {
  return (
    <span
      className="spectra-prism-slot"
      data-prism-slot={slot ?? "live-dock"}
      data-optics={optics}
      style={{ width: size, height: size }}
    >
      <PrismLoader size={size} optics={optics} />
    </span>
  );
}
