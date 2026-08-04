"use client";

/**
 * Effective motion level resolution (Phase 14.1 / 14.9).
 *
 * Sources, in order of authority:
 *   1. the user's explicit `motionLevel` preference, mirrored onto
 *      `document.documentElement.dataset.spectraMotion` by preference-store;
 *   2. the operating system's `prefers-reduced-motion` setting, which can only
 *      *decrease* motion (full → reduced), never increase it.
 *
 * Every animation surface in Spectra should resolve motion through
 * `useSpectraMotion` (components) or `resolveEffectiveMotion` (logic), never by
 * reading the media query alone — accessibility preferences are layered.
 */

import { useSyncExternalStore } from "react";

export type SpectraMotionLevel = "full" | "reduced" | "none";

export interface EffectiveMotion {
  level: SpectraMotionLevel;
  /** True for both "reduced" and "none". */
  reduced: boolean;
  /** True only for "none" — all animation collapses to instant. */
  disabled: boolean;
}

export function resolveEffectiveMotion(
  preference: SpectraMotionLevel,
  osReducedMotion: boolean,
): EffectiveMotion {
  const level: SpectraMotionLevel =
    preference === "none"
      ? "none"
      : osReducedMotion && preference === "full"
        ? "reduced"
        : preference;
  return {
    level,
    reduced: level !== "full",
    disabled: level === "none",
  };
}

const FALLBACK: EffectiveMotion = {
  level: "full",
  reduced: false,
  disabled: false,
};

function readPreferenceLevel(): SpectraMotionLevel {
  if (typeof document === "undefined") return "full";
  const raw = document.documentElement.dataset.spectraMotion;
  return raw === "reduced" || raw === "none" ? raw : "full";
}

function readOsReduced(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function subscribe(callback: () => void): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.attributeName === "data-spectra-motion"))
      callback();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-spectra-motion"],
  });
  media.addEventListener("change", callback);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", callback);
  };
}

let cachedRaw: string | undefined;
let cachedResult: EffectiveMotion = FALLBACK;

function getSnapshot(): EffectiveMotion {
  const raw = `${readPreferenceLevel()}:${readOsReduced()}`;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedResult = resolveEffectiveMotion(
      readPreferenceLevel(),
      readOsReduced(),
    );
  }
  return cachedResult;
}

const getServerSnapshot = () => FALLBACK;

/** Effective motion level for the current document. */
export function useSpectraMotion(): EffectiveMotion {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
