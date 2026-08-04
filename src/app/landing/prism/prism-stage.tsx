"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { PrismFallback } from "./prism-fallback";
import type { PrismSceneState } from "./prism-scene";
import type { PrismQuality } from "../prism3d/Prism";

/**
 * Progressive-enhancement stage: a static SVG prism composes immediately
 * (first paint never waits on a GL context), and the real optical engine
 * crossfades in once its first frame lands. If WebGL is unavailable the SVG
 * stays — the narrative is identical either way (Phase 15.7).
 *
 * The stage reads scene targets through a ref at frame cadence, so scroll
 * choreography never re-renders React.
 */
const PrismCanvas = dynamic(() => import("../prism3d/PrismCanvas"), {
  ssr: false,
  loading: () => null,
});

function detectQuality(reduced: boolean): PrismQuality {
  if (reduced) return "low";
  if (typeof window === "undefined") return "medium";
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 620;
  if (coarse || small || cores <= 4 || memory <= 4) return "medium";
  return "high";
}

function canUseWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function PrismStage({
  scene,
  sceneRef,
  className,
}: {
  scene: PrismSceneState;
  sceneRef?: RefObject<PrismSceneState>;
  className?: string;
}) {
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  // Scene targets flow to the render loop through a ref — no React re-render
  // per scroll frame, whether the caller drives us or we read our own prop.
  const targetRef = useRef(scene.progress);
  useEffect(() => {
    if (!sceneRef) targetRef.current = scene.progress;
  }, [scene, sceneRef]);
  const progressRef = useMemo<{ current: number }>(
    () => ({
      get current() {
        return sceneRef?.current?.progress ?? targetRef.current;
      },
      set current(value: number) {
        targetRef.current = value;
      },
    }),
    [sceneRef],
  );

  useEffect(() => {
    setReduced(
      typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    setSupported(canUseWebGL());
  }, []);

  useEffect(() => {
    if (!rootRef.current || reduced) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? true),
      { rootMargin: "80px" },
    );
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [reduced]);

  const quality = useMemo(() => detectQuality(reduced), [reduced]);
  const showCanvas = supported;

  // The fallback composes from the live progress too, but polled at a calm
  // cadence into state — refs stay out of render.
  const [fallbackProgress, setFallbackProgress] = useState(scene.progress);
  useEffect(() => {
    let raf = 0;
    let last = scene.progress;
    const tick = () => {
      const p = progressRef.current;
      if (Math.abs(p - last) > 0.02) {
        last = p;
        setFallbackProgress(p);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [progressRef, scene.progress]);

  return (
    <div
      ref={rootRef}
      data-prism-stage
      aria-hidden="true"
      className={className}
    >
      <div
        className={`absolute inset-0 transition-opacity duration-1000 ${
          ready ? "opacity-0" : "opacity-100"
        }`}
      >
        <PrismFallback progress={fallbackProgress} className="h-full w-full" />
      </div>
      {showCanvas ? (
        <div
          className={`absolute inset-0 transition-opacity duration-1000 ${
            ready ? "opacity-100" : "opacity-0"
          }`}
        >
          <PrismCanvas
            progressRef={progressRef}
            quality={quality}
            reduced={reduced}
            paused={!visible}
            onFirstFrame={() => setReady(true)}
          />
        </div>
      ) : null}
      {/* Screen-reader-equivalent narrative lives in real HTML copy around the
          stage; the canvas itself is decorative. */}
    </div>
  );
}
