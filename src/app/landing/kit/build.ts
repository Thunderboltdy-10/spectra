"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/*
 * A section builds once. When it is about 40% in view it plays its few steps
 * at a calm pace and then stays as it is: scrolling back finds it built, and
 * nothing on the page depends on where the scrollbar is. A visitor flying
 * past (or one who asked for less motion) gets the finished section at once.
 */

const FAST_PX_PER_MS = 3.2;

let lastY = 0;
let lastAt = 0;
let speed = 0;
function trackSpeed() {
  if (typeof window === "undefined") return;
  const now = performance.now();
  const y = window.scrollY;
  if (lastAt) speed = Math.abs(y - lastY) / Math.max(1, now - lastAt);
  lastY = y;
  lastAt = now;
}
if (typeof window !== "undefined") window.addEventListener("scroll", trackSpeed, { passive: true });

export const prefersLessMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type Build = { started: boolean; skipped: boolean };

export function useBuild(ref: RefObject<Element | null>, at = 0.4): Build {
  const [build, setBuild] = useState<Build>({ started: false, skipped: false });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const box = entry.boundingClientRect;
        // Tall sections count as in view once they fill 40% of the window.
        const seen = entry.intersectionRatio >= at || entry.intersectionRect.height >= window.innerHeight * at;
        const passed = box.bottom < 0;
        if (!seen && !passed) return;
        observer.disconnect();
        setBuild({ started: true, skipped: passed || prefersLessMotion() || speed > FAST_PX_PER_MS });
      },
      { threshold: [0, 0.1, 0.2, at, 0.6, 1] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [at, ref]);
  return build;
}

/**
 * Which step a build is on: 0 before it starts, 1 as it starts, one more as
 * each duration passes, and `durations.length + 1` once it is finished. A
 * skipped build is finished at once.
 */
export function useSteps(build: Build, durations: readonly number[]) {
  const [step, setStep] = useState(0);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    if (!build.started) return;
    if (build.skipped) {
      setStep(durations.length + 1);
      return;
    }
    let at = 0;
    setStep(1);
    durations.slice(0, -1).forEach((duration, index) => {
      at += duration;
      timers.current.push(window.setTimeout(() => setStep(index + 2), at));
    });
    const last = durations[durations.length - 1] ?? 0;
    timers.current.push(window.setTimeout(() => setStep(durations.length + 1), at + last));
    const pending = timers.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
      timers.current = [];
    };
    // A build plays once; its durations are fixed per section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build.started, build.skipped]);
  return Math.min(step, durations.length + 1);
}

/**
 * True once the element comes within about a window of the view, and from then
 * on: the app's heavier surfaces (studios, the calendar, Home) mount only as
 * the reader nears them, and stay.
 */
export function useNear(ref: RefObject<Element | null>, margin = "100% 0px") {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setNear(true);
      },
      { rootMargin: margin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [margin, near, ref]);
  return near;
}

/**
 * Runs `work` once the scroll has rested and the page is idle, so a long task
 * (building a studio) never lands in the middle of a scroll. Returns a cancel.
 */
export function atRest(work: () => void) {
  let quiet = 0;
  let idle = 0;
  const clear = () => {
    window.clearTimeout(quiet);
    if (idle && "cancelIdleCallback" in window) window.cancelIdleCallback(idle);
    idle = 0;
  };
  const run = () => {
    cancel();
    work();
  };
  const settle = () => {
    clear();
    quiet = window.setTimeout(() => {
      if ("requestIdleCallback" in window) idle = window.requestIdleCallback(run, { timeout: 900 });
      else run();
    }, 180);
  };
  const cancel = () => {
    clear();
    window.removeEventListener("scroll", settle);
  };
  window.addEventListener("scroll", settle, { passive: true });
  settle();
  return cancel;
}

/**
 * Like `useNear` for the heaviest surfaces, whose first render is a long task:
 * once within a window and a half of the view, it is built when the scroll
 * rests (`atRest`). If the reader reaches it first, it builds at once.
 */
export function useNearAtRest(ref: RefObject<Element | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    let cancel = () => {};
    const build = () => {
      observer.disconnect();
      cancel();
      window.removeEventListener("scroll", reached);
      setNear(true);
    };
    const reached = () => {
      const box = node.getBoundingClientRect();
      if (box.top < window.innerHeight && box.bottom > 0) build();
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        window.addEventListener("scroll", reached, { passive: true });
        cancel = atRest(build);
        reached();
      },
      { rootMargin: "150% 0px" },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancel();
      window.removeEventListener("scroll", reached);
    };
  }, [near, ref]);
  return near;
}

/**
 * A pinned scene: the section is taller than the window and its stage sticks
 * while the reader scrolls through it, so the scroll plays the scene instead
 * of moving the page. Its progress, 0 to 1, is written to `--p` on the section
 * as it moves (no render), and the step it has reached among `marks` is
 * returned (a render only when that changes). What happens at each step is a
 * transition with its own pace, so a fast flick still reads.
 */
export function useScrub(ref: RefObject<HTMLElement | null>, marks: readonly number[]) {
  const [step, setStep] = useState(0);
  const progress = useRef(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const box = node.getBoundingClientRect();
      const run = Math.max(1, box.height - window.innerHeight);
      const p = Math.min(1, Math.max(0, -box.top / run));
      progress.current = p;
      node.style.setProperty("--p", p.toFixed(4));
      let reached = 0;
      for (const mark of marks) if (p >= mark) reached += 1;
      setStep(reached);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
    // A scene's marks are fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  return { step, progress };
}
