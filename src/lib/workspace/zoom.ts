"use client";

/* ===================================================================
   Zoom primitives — semantic zoom foundation.

   CORE PRINCIPLE (v3)
   --------------------
   ReactFlow scales natively. All node content is sized in CSS pixels.
   Semantic zoom is achieved through CONTINUOUS ZoomSignals that drive
   gradual structural adaptation — not just hide/show by tier.

   Layout is in stable world coordinates — no zoom-dependent sizing.
   Raw zoom is only for background patterns, viewport concerns, and
   screen↔world coordinate conversions (e.g. widget resize drag).

   v3 enrichments:
   - Continuous reveal calculations: every sub-element has a 0-1
     opacity/scale signal, not just binary show/hide.
   - Shape/spacing/internal adaptation: icon size, padding, body height,
     meta opacity, etc. all interpolate continuously.
   - Components consume useZoomSignals() directly for fine-grained
     control, useSemanticTier() only for coarse gating.
   =================================================================== */

import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ZoomSignals } from "@/lib/workspace/contracts";

/* ===================================================================
   Semantic Tier — discrete label derived from continuous zoom signals.

   Components that need coarse-grained reveal decisions (show/hide
   controls, simplify headers, etc.) use this instead of raw zoom.
   It DOES NOT drive layout or sizing — only visibility.
   =================================================================== */

export type SemanticTier = "glance" | "touch" | "detail";

/** Derive semantic tier from continuous zoom signals */
export function semanticTierForSignals(signals: ZoomSignals): SemanticTier {
  if (signals.contentDepth > 0.4) return "detail";
  if (signals.cardDetail > 0.3) return "touch";
  return "glance";
}

/** Reactive hook: current semantic tier */
export function useSemanticTier(): SemanticTier {
  const signals = useWorkspaceStore((s) => s.zoomSignals);
  return semanticTierForSignals(signals);
}

/* ===================================================================
   Reactive zoom hooks
   =================================================================== */

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
  /** Item card width */
  ITEM_CARD_WIDTH: 320,

  /** Item chip height at glance */
  ITEM_CHIP_HEIGHT: 64,
  /** Item card height at touch */
  ITEM_CARD_HEIGHT: 168,

  /** Title text inside item */
  ITEM_TITLE: 14,
  /** Meta / subtitle */
  ITEM_META: 11,
  /** Body preview */
  ITEM_BODY: 12.5,

  /** Workspace cartouche name */
  WS_NAME: 38,
  WS_EMOJI: 44,
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

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp a value between min and max */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
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

/* ===================================================================
   Continuous reveal calculations.

   Instead of binary show/hide driven by SemanticTier, these functions
   produce continuous 0-1 opacity/scale values that components consume
   directly. This makes semantic zoom feel gradual and alive.

   Each function takes ZoomSignals and returns a numeric value that
   can be used as CSS opacity, scale, height, etc.
   =================================================================== */

/**
 * Item-level continuous reveal.
 *
 * Returns a bag of continuous signals for every sub-element of an item card.
 * Components use these to smoothly interpolate opacity, padding, icon size,
 * body height, etc. — no more abrupt tier boundary jumps.
 */
export function itemReveal(signals: ZoomSignals) {
  const { structureReveal, cardDetail, contentDepth, groupReveal } = signals;

  return {
    /** 0→1: icon container fades in as structure emerges */
    iconOpacity: clamp(groupReveal * 1.3, 0, 1),
    /** 0→1: title always visible at cardDetail>0, but fades gently at very far zoom */
    titleOpacity: clamp(structureReveal * 0.4 + 0.6, 0, 1),
    /** 0→1: status dot visibility */
    statusOpacity: clamp(structureReveal * 1.5, 0, 1),
    /** 0→1: body preview (text/code/markdown) fades in */
    bodyOpacity: clamp(cardDetail, 0, 1),
    /** 0→1: meta line (type badge, date) fades in */
    metaOpacity: clamp(cardDetail * 0.8, 0, 1),
    /** 0→1: controls (edit button, action menu) only at deep zoom */
    controlsOpacity: clamp(contentDepth * 1.2, 0, 1),

    /** Pixel height for the body section: 0 at glance, grows continuously */
    bodyHeight: lerp(0, 200, clamp(cardDetail, 0, 1)),
    /** Padding for the header row: tight at glance, relaxed at detail */
    headerPadding: lerp(STABLE.PAD_SM, STABLE.PAD_MD, clamp(cardDetail, 0, 1)),
    /** Icon container size: small at glance, full at detail */
    iconSize: lerp(STABLE.ICON_MD, STABLE.ICON_LG + 2, clamp(cardDetail, 0, 1)),
    /** Card border opacity */
    borderOpacity: lerp(0.4, 1, clamp(structureReveal, 0, 1)),
    /** Shadow intensity */
    shadowIntensity: clamp(contentDepth, 0, 1),

    /** Boolean gates for mount/unmount — avoid rendering expensive content when invisible */
    shouldMountIcon: structureReveal > 0.05,
    shouldMountBody: cardDetail > 0.05,
    shouldMountMeta: cardDetail > 0.15,
    shouldMountControls: contentDepth > 0.15,
  };
}

/**
 * Territory-level continuous reveal.
 *
 * Controls the workspace territory cartouche: emoji size, name opacity,
 * meta line, and background wash intensity.
 */
export function territoryReveal(signals: ZoomSignals) {
  const { structureReveal, identityAnchor, territoryFade } = signals;

  return {
    /** Emoji scales down as we zoom in (identity anchors to corner) */
    emojiScale: lerp(1, 0.65, identityAnchor),
    /** Name text opacity */
    nameOpacity: clamp(structureReveal * 0.5 + 0.5, 0, 1),
    /** Meta line (item count) fades in with structure */
    metaOpacity: clamp(structureReveal * 0.8, 0, 1),
    /** Background wash intensity — strong at landscape, subtle at detail */
    washOpacity: lerp(0.18, 0.04, territoryFade),
    /** Cartouche padding — generous at landscape, compact at detail */
    padding: lerp(STABLE.PAD_LG * 1.6, STABLE.PAD_LG, identityAnchor),

    /** Boolean gates */
    shouldMountMeta: structureReveal > 0.15,
  };
}

/**
 * Group label continuous reveal.
 *
 * Group headers (latitude rules) fade in with structure and
 * the count/rule opacity interpolates with cardDetail.
 */
export function groupLabelReveal(signals: ZoomSignals) {
  const { cardDetail, groupReveal } = signals;

  return {
    /** Label text always visible if groupReveal > 0 */
    labelOpacity: clamp(groupReveal, 0, 1),
    /** Rule line and count fade in with card detail */
    ruleOpacity: clamp(cardDetail * 0.9, 0, 1),
    /** Count opacity */
    countOpacity: clamp(cardDetail * 0.8, 0, 1),

    /** Boolean gates */
    shouldMountRule: cardDetail > 0.1,
  };
}

/**
 * Widget continuous reveal.
 *
 * Similar to item reveal but tailored for widgets:
 * title, close button, resize handle, and body simplification.
 */
export function widgetReveal(signals: ZoomSignals) {
  const { cardDetail, contentDepth } = signals;

  return {
    /** Widget title opacity */
    titleOpacity: clamp(cardDetail * 1.2, 0, 1),
    /** Close button only at deep zoom */
    closeBtnOpacity: clamp(contentDepth * 1.5, 0, 1),
    /** Resize handle */
    resizeOpacity: clamp(contentDepth * 1.3, 0, 1),
    /** Controls within widget body */
    controlsOpacity: clamp(contentDepth, 0, 1),
    /** Meta/secondary text */
    metaOpacity: clamp(cardDetail * 0.6, 0, 1),

    /** Boolean gates */
    shouldMountTitle: cardDetail > 0.1,
    shouldMountClose: contentDepth > 0.2,
    shouldMountResize: contentDepth > 0.3,
    shouldMountControls: contentDepth > 0.15,
  };
}
