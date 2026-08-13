"use client";

/**
 * The field at environment scale.
 *
 * `SurfaceField` draws the field with CSS, which is the right answer for a card
 * or a panel: a few hundred dots, no context, no loop. This is the same field
 * when the surface is the size of the window and the grain has to be fine
 * enough to read as material — tens of thousands of dots, each one displaced by
 * what is happening near it. That is a GPU job, so this mounts one small WebGL
 * program and hands it the same vocabulary the CSS field uses.
 *
 * Mood and influences are read through refs at frame cadence. React renders
 * this component once and then never again, no matter how much the field moves.
 *
 * If WebGL is unavailable, or the visitor asked for reduced motion, the CSS
 * lattice underneath is what they see. The page is quieter, and correct.
 */

import { useEffect, useRef } from "react";
import {
  createGrainRenderer,
  type GrainInfluence,
  type GrainMood,
  type GrainRenderer,
} from "./grain-renderer";

export type GrainSource = {
  mood: { current: GrainMood };
  influences: { current: readonly GrainInfluence[] };
};

/** Frames the field keeps drawing after everything has gone still. */
const COAST_FRAMES = 90;

export function GrainField({
  source,
  subscribe,
  className,
  maxDpr,
  children,
}: {
  source: GrainSource;
  /**
   * External heartbeat. Pass the host's existing clock so the page keeps one
   * loop; omit it and the field runs its own, idling when nothing moves.
   */
  subscribe?: (listener: () => void) => () => void;
  className?: string;
  maxDpr?: number;
  /** The CSS lattice, rendered underneath as the fallback. */
  children?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: GrainRenderer | null = null;
    try {
      renderer = createGrainRenderer(canvas, { maxDpr: reduced ? 1 : maxDpr });
    } catch {
      renderer = null;
    }
    if (!renderer) return;
    const engine = renderer;

    const host = canvas.parentElement ?? canvas;
    let onScreen = true;
    let coast = COAST_FRAMES;
    let painted = false;
    /* Reduced motion keeps the field: it is texture, and removing it would
       change the page's material rather than its motion. What it loses is the
       drift, so the noise is sampled at one fixed instant forever. */
    const started = performance.now();

    const size = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      engine.resize(box.width, box.height);
      coast = COAST_FRAMES;
    });
    size.observe(host);
    engine.resize(host.clientWidth, host.clientHeight);

    const view = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? true;
        if (onScreen) coast = COAST_FRAMES;
      },
      { rootMargin: "120px" },
    );
    view.observe(host);

    let last: {
      mood: GrainMood;
      influences: readonly GrainInfluence[];
    } | null = null;

    const draw = () => {
      if (!onScreen || document.hidden) return;
      const mood = source.mood.current;
      const influences = source.influences.current;
      /* The lattice flows on its own, so an unchanged mood does not mean an
         unchanged picture and the frame cannot be skipped on that basis. The
         one case where it can is reduced motion: there the flow is frozen, and
         redrawing an identical field is pure cost. */
      if (reduced) {
        const same =
          last !== null &&
          moodEqual(last.mood, mood) &&
          influencesEqual(last.influences, influences);
        if (same) {
          if (coast <= 0) return;
          coast -= 1;
        } else {
          coast = COAST_FRAMES;
        }
        last = {
          mood: { ...mood },
          influences: influences.map((one) => ({ ...one })),
        };
      }
      const time = reduced ? 0 : (performance.now() - started) / 1000;
      engine.frame(mood, influences, time);
      /* The crossfade waits for a real frame, not for a context. A canvas that
         faded in empty would be a flash of nothing over a field that was
         already there. */
      if (!painted) {
        painted = true;
        canvas.dataset.live = "true";
        host.dataset.gpu = "true";
      }
    };

    const teardown = () => {
      size.disconnect();
      view.disconnect();
      engine.dispose();
      delete host.dataset.gpu;
    };

    if (subscribe) {
      const stop = subscribe(draw);
      return () => {
        stop();
        teardown();
      };
    }

    let frame = requestAnimationFrame(function loop() {
      frame = requestAnimationFrame(loop);
      draw();
    });
    return () => {
      cancelAnimationFrame(frame);
      teardown();
    };
  }, [maxDpr, source, subscribe]);

  return (
    <>
      {children}
      <canvas
        ref={canvasRef}
        className={
          className ? `spectra-grain-canvas ${className}` : "spectra-grain-canvas"
        }
        aria-hidden="true"
      />
    </>
  );
}

function moodEqual(a: GrainMood, b: GrainMood): boolean {
  return (
    Math.abs(a.rest - b.rest) < 0.0008 &&
    Math.abs(a.spacing - b.spacing) < 0.05 &&
    Math.abs(a.wash - b.wash) < 0.0015 &&
    Math.abs(a.wave - b.wave) < 0.004 &&
    Math.abs(a.pulse - b.pulse) < 0.004 &&
    Math.abs(a.clip - b.clip) < 0.002 &&
    Math.abs(a.bias[0] - b.bias[0]) < 0.002 &&
    Math.abs(a.bias[1] - b.bias[1]) < 0.002 &&
    Math.abs(a.bias[2] - b.bias[2]) < 0.004 &&
    a.clipRect[0] === b.clipRect[0] &&
    a.clipRect[1] === b.clipRect[1] &&
    a.clipRect[2] === b.clipRect[2] &&
    a.clipRect[3] === b.clipRect[3] &&
    a.ink[0] === b.ink[0] &&
    a.ink[1] === b.ink[1] &&
    a.ink[2] === b.ink[2] &&
    a.tint[0] === b.tint[0] &&
    a.tint[1] === b.tint[1] &&
    a.tint[2] === b.tint[2]
  );
}

function influencesEqual(
  a: readonly GrainInfluence[],
  b: readonly GrainInfluence[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (
      Math.abs(left.x - right.x) > 0.4 ||
      Math.abs(left.y - right.y) > 0.4 ||
      Math.abs(left.radius - right.radius) > 0.6 ||
      Math.abs(left.strength - right.strength) > 0.004 ||
      left.color[0] !== right.color[0] ||
      left.color[1] !== right.color[1] ||
      left.color[2] !== right.color[2]
    )
      return false;
  }
  return true;
}
