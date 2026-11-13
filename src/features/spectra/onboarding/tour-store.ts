"use client";

import { create } from "zustand";
import { TOUR_STEPS } from "./tour-steps";
import type { Box } from "./tour-geometry";

/*
 * Where the tour is. Every page mounts its own shell, so the step lives here,
 * outside any one page, and the tour carries on as it moves the student from
 * Home to the Library and onwards. It also keeps the last box the spotlight
 * stood on, so the next page's layer starts there instead of starting over.
 */

type TourState = {
  /** The step on screen, or null when no tour is running. */
  index: number | null;
  /** The spotlight's last box, while a tour is running. */
  lastBox: Box | null;
  rememberBox: (box: Box | null) => void;
  /** From the first step, or from where it was put away. */
  start: (at?: number) => void;
  next: () => void;
  back: () => void;
  stop: () => void;
};

export const useTourStore = create<TourState>((set) => ({
  index: null,
  lastBox: null,
  rememberBox: (lastBox) => set({ lastBox }),
  start: (at = 0) => set({ index: Math.min(Math.max(0, at), TOUR_STEPS.length - 1), lastBox: null }),
  next: () => set(({ index }) => ({ index: index === null || index + 1 >= TOUR_STEPS.length ? null : index + 1 })),
  back: () => set(({ index }) => ({ index: index ? index - 1 : index })),
  stop: () => set({ index: null, lastBox: null }),
}));
