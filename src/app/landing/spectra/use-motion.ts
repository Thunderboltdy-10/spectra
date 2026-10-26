"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/*
 * The page's small motion vocabulary. Scenes start once, when the beam's tip
 * (62% down the window) reaches them, and then play a short authored
 * sequence. Nothing loops for attention; a scene that has played stays as it
 * ended, so scrolling back finds it finished, not replaying.
 */

/** The OS setting or Spectra's own motion preference asks for stillness. */
export function prefersStill() {
  if (typeof window === "undefined") return false;
  const level = document.documentElement.dataset.spectraMotion;
  return level === "reduced" || level === "none" || Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function useStill() {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const read = () => setStill(prefersStill());
    read();
    query?.addEventListener?.("change", read);
    return () => query?.removeEventListener?.("change", read);
  }, []);
  return still;
}

/** True while the window is at least `width` wide. */
export function useWide(width = 900) {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${width}px)`);
    const read = () => setWide(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, [width]);
  return wide;
}

/**
 * Becomes true once, when the element's top passes the beam's tip. With no
 * IntersectionObserver (or reduced motion) it is true at once, so every scene
 * still shows its finished state.
 */
export function useArrived(ref: RefObject<Element | null>, margin = "0px 0px -38% 0px") {
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || arrived) return;
    if (typeof IntersectionObserver === "undefined") {
      setArrived(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setArrived(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, margin, arrived]);
  return arrived;
}

/**
 * Plays a list of timed steps once `run` is true: `step` is how many have
 * happened. Still visitors get the last step at once.
 */
export function useSteps(run: boolean, times: number[], still: boolean) {
  const [step, setStep] = useState(0);
  const timesRef = useRef(times);
  useEffect(() => {
    if (!run) return;
    if (still) {
      setStep(timesRef.current.length);
      return;
    }
    const timers = timesRef.current.map((at, index) => window.setTimeout(() => setStep((current) => Math.max(current, index + 1)), at));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [run, still]);
  return step;
}

/** Types `text` out once `run` is true, at a hand's pace. */
export function useTyped(text: string, run: boolean, still: boolean, perChar = 34) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!run) {
      setCount(0);
      return;
    }
    if (still) {
      setCount(text.length);
      return;
    }
    let index = 0;
    let timer = 0;
    const next = () => {
      index += 1;
      setCount(index);
      if (index < text.length) {
        // A little unevenness, as fingers have: longer after a space or a full stop.
        const char = text[index - 1];
        timer = window.setTimeout(next, perChar * (char === " " ? 1.6 : char === "." || char === "," ? 4 : 0.7 + ((index * 37) % 9) / 12));
      }
    };
    timer = window.setTimeout(next, perChar);
    return () => window.clearTimeout(timer);
  }, [text, run, still, perChar]);
  return text.slice(0, count);
}

/** The visitor's own week: today and the next six days' names. */
export function useWeekdays() {
  const [days, setDays] = useState<{ long: string[]; short: string[]; dates: number[]; hour: number }>({
    long: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    short: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    dates: [3, 4, 5, 6, 7, 8, 9],
    hour: 19,
  });
  useEffect(() => {
    const now = new Date();
    const long: string[] = [];
    const short: string[] = [];
    const dates: number[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      long.push(day.toLocaleDateString("en-GB", { weekday: "long" }));
      short.push(day.toLocaleDateString("en-GB", { weekday: "short" }));
      dates.push(day.getDate());
    }
    setDays({ long, short, dates, hour: now.getHours() });
  }, []);
  return days;
}

export function greetingFor(hour: number) {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
