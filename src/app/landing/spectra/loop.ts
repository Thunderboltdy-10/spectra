"use client";

import { useEffect, useRef, type RefObject } from "react";

/*
 * How a scene lives on the page. It never holds the scroll. When a scene is
 * well into view it opens (its loading moment, once), then plays its little
 * story round and round for as long as it stays in view. Out of view it stops
 * between two beats and picks up from there when it is back. A visitor who
 * asked for less motion gets each scene in its finished state, still.
 *
 * A scene marks itself `data-seen` the first time it is in view, so its CSS
 * entrances run then and not at page load.
 */

export type Beat = {
  /** Resolves after `ms` of the scene being in view; never while it is away. */
  wait: (ms: number) => Promise<void>;
  /** The scene was unmounted; stop. */
  signal: AbortSignal;
  /** Less motion asked for: land in the finished state and do not loop. */
  still: boolean;
  /** How many rounds have played before this one. */
  round: number;
};

const lessMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useLoop(
  ref: RefObject<HTMLElement | null>,
  {
    open,
    round,
    threshold = 0.38,
  }: {
    /** Plays once, the first time the scene is in view. */
    open?: (beat: Beat) => Promise<void> | void;
    /** Plays again and again while the scene is in view. */
    round?: (beat: Beat) => Promise<void> | void;
    threshold?: number;
  },
) {
  const openRef = useRef(open);
  const roundRef = useRef(round);
  openRef.current = open;
  roundRef.current = round;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const controller = new AbortController();
    const { signal } = controller;
    const still = lessMotion();
    let visible = false;
    let started = false;
    const waiters = new Set<() => void>();

    // A timer that only runs while the scene is in view.
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        let left = ms;
        let since = 0;
        let running = false;
        let timer = 0;
        const done = () => {
          window.clearTimeout(timer);
          waiters.delete(resume);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const pause = () => {
          if (!running) return;
          running = false;
          window.clearTimeout(timer);
          left -= performance.now() - since;
        };
        function resume() {
          if (!visible) return pause();
          if (running) return;
          running = true;
          since = performance.now();
          window.clearTimeout(timer);
          timer = window.setTimeout(done, Math.max(0, left));
        }
        signal.addEventListener("abort", done);
        waiters.add(resume);
        resume();
      });

    const play = async () => {
      started = true;
      node.dataset.seen = "";
      try {
        await openRef.current?.({ wait, signal, still, round: 0 });
        if (still) return;
        for (let count = 0; !signal.aborted && roundRef.current; count += 1) {
          await roundRef.current({ wait, signal, still, round: count });
          // A round that has nothing to wait on still yields, so a loop can never spin.
          await wait(16);
        }
      } catch {
        /* A scene that fails leaves its last frame on the page. */
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        node.dataset.visible = visible ? "true" : "false";
        for (const resume of [...waiters]) resume();
        if (visible && !started) void play();
      },
      { threshold },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [ref, threshold]);
}

/** Sleeps for real time, whatever is in view (for small things inside one beat). */
export const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
