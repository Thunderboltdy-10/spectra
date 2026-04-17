"use client";

/* ===================================================================
   Zoom primitives — semantic zoom foundation.

   CORE PRINCIPLE (v2)
   --------------------
   ReactFlow scales natively. All node content is sized in CSS pixels.
   Semantic zoom is achieved through CSS opacity/display transitions
   driven by ZoomSignals — progressive reveal, not counter-scaling.

   DEPRECATED: useScreenSize / useScreenSizes (anti-zoom pattern).
   These are kept for backward compatibility but should not be used
   in new code. Prefer CSS pixel values + ZoomSignal-driven transitions.
   =================================================================== */

import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ZoomSignals } from "@/lib/workspace/contracts";

/**
 * @deprecated Use CSS pixel values instead. ReactFlow scales natively.
 * Returns a world-space size that renders as `screenPx` screen pixels
 * at the current zoom. Reactive — re-renders the node when zoom changes.
 */
export function useScreenSize(screenPx: number): number {
  const zoom = useWorkspaceStore((s) => s.zoom);
  if (!zoom || zoom < 0.0001) return screenPx * 100;
  return screenPx / zoom;
}

/**
 * @deprecated Use CSS pixel values instead. ReactFlow scales natively.
 * Screen-stable helper that returns multiple sizes in one hook call.
 */
export function useScreenSizes<T extends Record<string, number>>(
  input: T,
): { [K in keyof T]: number } {
  const zoom = useWorkspaceStore((s) => s.zoom);
  const safeZoom = zoom && zoom > 0.0001 ? zoom : 0.0001;
  const result = {} as { [K in keyof T]: number };
  for (const key of Object.keys(input) as (keyof T)[]) {
    result[key] = (input[key] as number) / safeZoom;
  }
  return result;
}

/** Current zoom, reactive */
export function useZoom(): number {
  return useWorkspaceStore((s) => s.zoom);
}

/** Current continuous zoom signals, reactive */
export function useZoomSignals(): ZoomSignals {
  return useWorkspaceStore((s) => s.zoomSignals);
}

/* ===================================================================
   Canonical screen-stable sizing constants.

   These are SCREEN pixels — used directly as CSS pixel values now
   that ReactFlow scales natively. Sizes are tuned for the Atlas aesthetic:
   generous air, discrete scales, no tiny 11px text anywhere.
   =================================================================== */

export const STABLE = {
  /** Item chip width at glance */
  ITEM_CHIP_WIDTH: 240,
  /** Item card width at touch */
  ITEM_CARD_WIDTH: 320,
  /** Item detail width at deep */
  ITEM_DETAIL_WIDTH: 380,

  /** Item chip height at glance */
  ITEM_CHIP_HEIGHT: 64,
  /** Item card height at touch */
  ITEM_CARD_HEIGHT: 168,
  /** Item detail height at deep */
  ITEM_DETAIL_HEIGHT: 280,

  /** Title text inside item */
  ITEM_TITLE: 14,
  ITEM_TITLE_CARD: 15,
  /** Meta / subtitle */
  ITEM_META: 11,
  /** Body preview */
  ITEM_BODY: 12.5,

  /** Workspace cartouche name */
  WS_NAME: 38,
  WS_NAME_FAR: 56,
  WS_EMOJI: 44,
  WS_EMOJI_FAR: 96,
  WS_META: 12.5,

  /** Group header (latitude rule) */
  GROUP_LABEL: 13,
  GROUP_COUNT: 11,

  /** Padding primitives */
  PAD_SM: 8,
  PAD_MD: 14,
  PAD_LG: 20,

  /** Border radius */
  RADIUS_SM: 8,
  RADIUS_MD: 14,
  RADIUS_LG: 20,

  /** Border width */
  BORDER: 1,
  BORDER_FOCUS: 1.5,

  /** Icon size */
  ICON_SM: 12,
  ICON_MD: 16,
  ICON_LG: 22,
} as const;

export const STABLE_ITEM_SCREEN_WIDTH = STABLE.ITEM_CARD_WIDTH;
export const STABLE_LABEL_SCREEN_SIZE = STABLE.ITEM_TITLE;

/* ===================================================================
   Hermite / interpolation helpers
   =================================================================== */

export function smoothStep(value: number, edge0: number, edge1: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Pick between three canonical tier values based on continuous cardDetail +
 * contentDepth signals. Useful for text sizing that has to be different at
 * chip / card / detail density.
 */
export function tierPick<T>(
  signals: ZoomSignals,
  chip: T,
  card: T,
  detail: T,
): T {
  if (signals.contentDepth > 0.5) return detail;
  if (signals.cardDetail > 0.5) return card;
  return chip;
}
