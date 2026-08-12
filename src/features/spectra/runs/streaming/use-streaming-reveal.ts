"use client";

/**
 * `useStreamingReveal` — adapts canonical streamed text to a reveal window
 * (Phase 14.2 / POLISH-004 / POLISH-005).
 *
 * The canonical string is always complete in state; the hook only returns a
 * visible prefix whose length is scheduled by the RevealScheduler. This is
 * what keeps INV-22 true: no semantic state, persistence decision or run
 * completion depends on the animation.
 *
 * Shimmer contract (POLISH-005): the hook reports `active` — surfaces use it
 * to apply the active-tail shimmer class to the *last unresolved block only*.
 */

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useSpectraMotion } from "../../motion";
import {
  RevealScheduler,
  type RevealProfileName,
  type RevealTickResult,
} from "./reveal-scheduler";

export interface StreamingRevealOptions {
  profile: RevealProfileName;
  /** false when the surface should render canonical content directly. */
  enabled?: boolean;
}

export interface StreamingRevealResult {
  visibleText: string;
  /** true while visible < canonical (apply tail shimmer to the live block) */
  active: boolean;
  /** characters still queued behind the reveal */
  queued: number;
}

function readBooleanDataset(name: string, fallback: boolean): boolean {
  if (typeof document === "undefined") return fallback;
  const raw = document.documentElement.dataset[name];
  if (raw === undefined) return fallback;
  return raw !== "false";
}

function subscribeRevealPrefs(callback: () => void): () => void {
  const observer = new MutationObserver((mutations) => {
    if (
      mutations.some(
        (m) =>
          m.attributeName === "data-spectra-streaming-reveal" ||
          m.attributeName === "data-spectra-tail-shimmer",
      )
    )
      callback();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "data-spectra-streaming-reveal",
      "data-spectra-tail-shimmer",
    ],
  });
  return () => observer.disconnect();
}

const DEFAULT_REVEAL_PREFERENCES = 0b11;

/**
 * `useSyncExternalStore` requires referentially stable snapshots. Encoding the
 * two document preferences as a primitive keeps unchanged reads stable while
 * still allowing the hook to expose the descriptive object API below.
 */
function getRevealPreferencesSnapshot(): number {
  return (
    (readBooleanDataset("spectraStreamingReveal", true) ? 0b01 : 0) |
    (readBooleanDataset("spectraTailShimmer", true) ? 0b10 : 0)
  );
}

/** User-level streaming preferences mirrored by preference-store. */
export function useRevealPreferences() {
  const snapshot = useSyncExternalStore(
    subscribeRevealPrefs,
    getRevealPreferencesSnapshot,
    () => DEFAULT_REVEAL_PREFERENCES,
  );

  return useMemo(
    () => ({
      streamingReveal: Boolean(snapshot & 0b01),
      activeTailShimmer: Boolean(snapshot & 0b10),
    }),
    [snapshot],
  );
}

export function useStreamingReveal(
  canonical: string,
  { profile, enabled = true }: StreamingRevealOptions,
): StreamingRevealResult {
  const motion = useSpectraMotion();
  const { streamingReveal } = useRevealPreferences();
  const scheduler = useMemo(() => new RevealScheduler(profile), [profile]);
  const [tickResult, setTickResult] = useState<RevealTickResult>(() => ({
    revealed: canonical.length,
    queued: 0,
    active: false,
  }));

  const reveal = enabled && streamingReveal && !motion.reduced;

  useEffect(() => {
    if (!reveal) {
      scheduler.settle(canonical.length);
      setTickResult({ revealed: canonical.length, queued: 0, active: false });
      return;
    }
    let frame = 0;
    const step = (now: number) => {
      const result = scheduler.tick(canonical.length, now);
      setTickResult((previous) =>
        previous.revealed === result.revealed &&
        previous.active === result.active
          ? previous
          : result,
      );
      if (result.active) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [canonical, reveal, scheduler]);

  return useMemo(() => {
    if (!reveal) return { visibleText: canonical, active: false, queued: 0 };
    return {
      visibleText: canonical.slice(0, tickResult.revealed),
      active: tickResult.active,
      queued: tickResult.queued,
    };
  }, [canonical, reveal, tickResult]);
}
