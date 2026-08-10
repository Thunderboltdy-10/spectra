"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { PrismFallback } from "./prism-fallback";
import { PrismBoundary } from "./prism-boundary";
import type { PrismSceneState } from "./prism-scene";
import type { PrismQuality } from "../prism3d/Prism";
import { heroState } from "../scene/heroState";
import { onStoryFrame } from "../story/story-clock";

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

/* Where the glass sits inside the fallback's 900×520 viewBox, as fractions of
   the artboard. The static renderer must land on the same slot as the engine,
   or the crossfade between them would be a jump. */
const FALLBACK_GLASS_W = 240 / 900;
const FALLBACK_GLASS_CX = 530 / 900;
const FALLBACK_GLASS_CY = 240 / 520;
const FALLBACK_ASPECT = 520 / 900;

/**
 * Story-mode placement for the static renderer.
 *
 * The engine is placed in world space by `PlacementRig`; this puts the SVG on
 * the same published slot in CSS pixels, so a machine without WebGL sees the
 * object travel through exactly the same compositions.
 */
function SlotFallback({ children }: { children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let w = -1;
    return onStoryFrame(() => {
      const node = boxRef.current;
      if (!node) return;
      const slot = heroState.slot;
      if (slot.w <= 0) {
        if (node.style.opacity !== "0") node.style.opacity = "0";
        return;
      }
      /* The box is sized only when the slot's width genuinely changes: width
         and height are layout properties, and writing them every frame would
         make the cheap renderer the expensive one. */
      const width = slot.w / FALLBACK_GLASS_W;
      if (Math.abs(width - w) > 0.5) {
        w = width;
        node.style.width = `${width}px`;
        node.style.height = `${width * FALLBACK_ASPECT}px`;
      }
      const height = w * FALLBACK_ASPECT;
      node.style.transform = `translate3d(${
        slot.x - FALLBACK_GLASS_CX * w
      }px, ${slot.y - FALLBACK_GLASS_CY * height}px, 0)`;
      if (node.style.opacity !== "1") node.style.opacity = "1";
    });
  }, []);

  return (
    <div
      ref={boxRef}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        opacity: 0,
        willChange: "transform",
      }}
    >
      {children}
    </div>
  );
}

export function PrismStage({
  scene,
  sceneRef,
  className,
  staged = false,
  active = true,
}: {
  scene: PrismSceneState;
  sceneRef?: RefObject<PrismSceneState>;
  className?: string;
  /**
   * Story mode: the object is placed by published slots rather than by the
   * scroll-derived camera curve, and the host spans the whole viewport.
   */
  staged?: boolean;
  /**
   * External render gate. A page-wide fixed canvas always intersects, so in
   * story mode the caller decides when the GPU may rest.
   */
  active?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
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
    if (!rootRef.current || reduced || staged) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? true),
      { rootMargin: "80px" },
    );
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [reduced, staged]);

  const quality = useMemo(() => detectQuality(reduced), [reduced]);
  const showCanvas = supported && !failed;
  const paused = staged ? !active : !visible;

  // The fallback composes from the live progress too, but polled at a calm
  // cadence into state — refs stay out of render. Once the engine has painted
  // the static renderer is invisible, so it stops being polled at all.
  const [fallbackProgress, setFallbackProgress] = useState(scene.progress);
  useEffect(() => {
    if (ready && !failed) return;
    let last = scene.progress;
    return onStoryFrame(() => {
      const p = progressRef.current;
      if (Math.abs(p - last) > 0.02) {
        last = p;
        setFallbackProgress(p);
      }
    });
  }, [failed, progressRef, ready, scene.progress]);

  const fallback = (
    <PrismFallback progress={fallbackProgress} className="h-full w-full" />
  );

  return (
    <div ref={rootRef} data-prism-stage aria-hidden="true" className={className}>
      <div
        className={`absolute inset-0 transition-opacity duration-1000 ${
          ready ? "opacity-0" : "opacity-100"
        }`}
      >
        {staged ? <SlotFallback>{fallback}</SlotFallback> : fallback}
      </div>
      {showCanvas ? (
        <div
          className={`absolute inset-0 transition-opacity duration-1000 ${
            ready ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* Fenced: the static renderer is already composing underneath, so a
              GL failure costs the glass and nothing else. */}
          <PrismBoundary
            fallback={null}
            onFail={() => {
              setFailed(true);
              setReady(false);
            }}
          >
            <PrismCanvas
              progressRef={progressRef}
              quality={quality}
              reduced={reduced}
              paused={paused}
              staged={staged}
              onFirstFrame={() => setReady(true)}
            />
          </PrismBoundary>
        </div>
      ) : null}
      {/* Screen-reader-equivalent narrative lives in real HTML copy around the
          stage; the canvas itself is decorative. */}
    </div>
  );
}
