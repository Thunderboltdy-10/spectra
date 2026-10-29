"use client";

import { Suspense, lazy, useEffect, useRef, useState, type ComponentType } from "react";

/*
 * A scene further down the page arrives as the reader nears it, so the first
 * thing on the page (the hero) is all a visitor waits for. Once the hero has
 * settled, every scene is fetched quietly in the background; by the time the
 * reader scrolls to one it is usually already there. Until then the paper
 * keeps the scene's room, so nothing below jumps.
 */

export function later(load: () => Promise<{ default: ComponentType }>, room: number) {
  let started: Promise<{ default: ComponentType }> | null = null;
  const fetchOnce = () => (started ??= load());
  return { Scene: lazy(fetchOnce), fetch: fetchOnce, room };
}

export function LaterScene({ scene }: { scene: ReturnType<typeof later> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        setNear(true);
      },
      { rootMargin: "120% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const room = <div ref={ref} className="sp-later" style={{ ["--sp-later" as string]: `${scene.room}px` }} aria-hidden />;
  if (!near) return room;
  return (
    <Suspense fallback={room}>
      <scene.Scene />
    </Suspense>
  );
}

/** After the page's first moments, fetches the rest while the reader reads. */
export function useWarm(scenes: ReadonlyArray<ReturnType<typeof later>>, after = 2600) {
  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (run: () => void) => number }).requestIdleCallback;
    const timer = window.setTimeout(() => {
      const next = (index: number) => {
        const scene = scenes[index];
        if (!scene) return;
        void scene.fetch().finally(() => (idle ? idle(() => next(index + 1)) : window.setTimeout(() => next(index + 1), 200)));
      };
      next(0);
    }, after);
    return () => window.clearTimeout(timer);
  }, [after, scenes]);
}
