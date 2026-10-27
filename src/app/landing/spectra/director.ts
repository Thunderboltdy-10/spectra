"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/*
 * Scenes play by themselves. Scrolling down, a scene's stage settles into
 * view, the page holds still for the moment it takes (never more than a few
 * seconds), the scene plays its one gesture, and the page lets go. Nothing
 * waits for the scrollbar to be nudged step by step. Scrolling back up finds
 * every scene as it was left. A visitor jumping past a scene, or one who asked
 * for less motion, gets it finished at once.
 */

export type Play = {
  /** Resolves after `ms`, or at once when the scene is being skipped. */
  wait: (ms: number) => Promise<void>;
  /** True when the scene should land in its final state without playing. */
  skipped: boolean;
  /** The scene was unmounted; stop. */
  signal: AbortSignal;
};

type Scene = {
  node: HTMLElement;
  hold: number;
  played: boolean;
  start: (skipped: boolean) => void;
};

const scenes = new Set<Scene>();
let held = false;
let lastY = 0;
let speed = 0;
let lastAt = 0;
let listening = false;

const lessMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Home", "End"]);

function block(event: Event) {
  if (!held) return;
  if (event instanceof KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (!KEYS.has(event.key) || target?.closest("input, textarea, [contenteditable='true'], select")) return;
  }
  event.preventDefault();
}

function hold(ms: number) {
  held = true;
  document.documentElement.dataset.held = "";
  window.setTimeout(() => {
    held = false;
    delete document.documentElement.dataset.held;
  }, ms);
}

/** Scrolls smoothly to `y` over `ms`, as the page settling, not jumping. */
function settle(y: number, ms: number) {
  const from = window.scrollY;
  const distance = y - from;
  if (Math.abs(distance) < 2) return;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const k = 1 - Math.pow(1 - t, 3);
    window.scrollTo(0, from + distance * k);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function check() {
  const now = performance.now();
  const y = window.scrollY;
  if (lastAt) speed = Math.abs(y - lastY) / Math.max(1, now - lastAt);
  const down = y >= lastY;
  lastY = y;
  lastAt = now;
  if (held) return;
  const height = window.innerHeight;
  for (const scene of scenes) {
    if (scene.played) continue;
    const box = scene.node.getBoundingClientRect();
    // Already above the window: it is simply there, finished.
    if (box.bottom < height * 0.3) {
      scene.played = true;
      scene.start(true);
      continue;
    }
    const arriving = box.top < height * 0.42;
    if (!arriving) continue;
    scene.played = true;
    // Flying past, or reading with less motion: no hold.
    if (!down || speed > 4 || lessMotion()) {
      scene.start(true);
      continue;
    }
    // The stage is the part that plays; bring it fully into view, then hold.
    // It settles on its heading when it marks one ([data-settle-to]), else on its own top.
    const anchor = scene.node.querySelector<HTMLElement>("[data-settle-to]") ?? scene.node;
    const offset = Number(scene.node.dataset.settle ?? 92);
    const target = Math.max(0, window.scrollY + anchor.getBoundingClientRect().top - offset);
    settle(target, 320);
    hold(scene.hold + 320);
    window.setTimeout(() => scene.start(false), 200);
  }
}

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("scroll", check, { passive: true });
  window.addEventListener("wheel", block, { passive: false });
  window.addEventListener("touchmove", block, { passive: false });
  window.addEventListener("keydown", block);
}

/**
 * Registers a scene. `run` plays it; with `skipped` it should put the scene
 * straight into its final state. `hold` is how long the page is held still
 * while it plays (keep it short: the gesture, not the whole story).
 */
export function useScene(ref: RefObject<HTMLElement | null>, run: (play: Play) => Promise<void> | void, holdMs = 1800) {
  const runRef = useRef(run);
  runRef.current = run;
  const [state, setState] = useState<"waiting" | "playing" | "done">("waiting");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    listen();
    const controller = new AbortController();
    const scene: Scene = {
      node,
      hold: holdMs,
      played: false,
      start: (skipped) => {
        setState("playing");
        const wait = (ms: number) =>
          skipped || controller.signal.aborted
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                const timer = window.setTimeout(resolve, ms);
                controller.signal.addEventListener("abort", () => {
                  window.clearTimeout(timer);
                  resolve();
                });
              });
        void Promise.resolve(runRef.current({ wait, skipped, signal: controller.signal }))
          .catch(() => undefined)
          .finally(() => {
            if (!controller.signal.aborted) setState("done");
          });
      },
    };
    scenes.add(scene);
    // A scene already on screen when the page opens (or after a reload part-way down) plays now.
    const first = window.setTimeout(check, 60);
    return () => {
      window.clearTimeout(first);
      controller.abort();
      scenes.delete(scene);
    };
  }, [holdMs, ref]);

  return state;
}
