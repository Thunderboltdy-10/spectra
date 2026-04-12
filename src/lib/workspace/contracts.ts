import type { CanonicalWorkspaceType } from "@/lib/artifact-types";

/* ─── Zoom Tiers ──────────────────────────────────────── */

/**
 * Semantic zoom tiers – designed so the user enters the canvas at a
 * "readable landscape" level and smoothly zooms into workspace detail.
 *
 * The key insight: default zoom should already feel close enough to read
 * workspace names clearly while showing the full landscape.
 * Thresholds are set so that 2-3 scroll ticks moves between tiers.
 */
export const ZOOM_TIERS = {
  /** Far out – all workspaces visible as readable cards */
  LANDSCAPE: { max: 0.52, label: "landscape" },
  /** Mid – workspace interior becomes structured and grouped */
  SUMMARY: { min: 0.52, max: 1.1, label: "summary" },
  /** Deep – content-level detail, inline editing available */
  DETAIL: { min: 1.1, label: "detail" },
} as const;

export type ZoomTier = "landscape" | "summary" | "detail";

export function zoomTierForLevel(zoom: number): ZoomTier {
  if (zoom < ZOOM_TIERS.LANDSCAPE.max) return "landscape";
  if (zoom < ZOOM_TIERS.SUMMARY.max) return "summary";
  return "detail";
}

/**
 * Returns a continuous 0-1 progress value within the current tier.
 * Useful for smooth interpolation of representation changes.
 */
export function zoomTierProgress(zoom: number): number {
  if (zoom < ZOOM_TIERS.LANDSCAPE.max) {
    return Math.max(0, Math.min(1, zoom / ZOOM_TIERS.LANDSCAPE.max));
  }
  if (zoom < ZOOM_TIERS.SUMMARY.max) {
    const range = ZOOM_TIERS.SUMMARY.max - ZOOM_TIERS.SUMMARY.min;
    return Math.max(0, Math.min(1, (zoom - ZOOM_TIERS.SUMMARY.min) / range));
  }
  const detailMax = 2.0;
  return Math.max(0, Math.min(1, (zoom - ZOOM_TIERS.DETAIL.min) / (detailMax - ZOOM_TIERS.DETAIL.min)));
}

/* ─── Viewport Constants ─────────────────────────────── */

export const VIEWPORT = {
  MIN_ZOOM: 0.18,
  MAX_ZOOM: 2.5,
  /** Start at a zoom where workspace cards are clearly readable */
  DEFAULT_ZOOM: 0.42,
  /** Zoom level that triggers auto-commit into the closest workspace */
  AUTO_ENTRY_THRESHOLD: 0.72,
  /** Zoom level below which we auto-exit a committed workspace */
  AUTO_EXIT_THRESHOLD: 0.38,
  /** Zoom speed multiplier — controls how fast the wheel zooms */
  ZOOM_SENSITIVITY: 1.3,
} as const;

/* ─── Territory Sizing ───────────────────────────────── */

export const TERRITORY = {
  /** Width of a workspace territory node */
  WIDTH: 600,
  /** Height of a workspace territory node */
  HEIGHT: 420,
  /** Spacing between workspace centers – tighter for map-like feel */
  SPACING_X: 780,
  SPACING_Y: 560,
  /** Max workspaces per row before wrapping */
  COLS: 3,
  /** Interior layout – columns of items inside a committed workspace */
  ITEM_COL_WIDTH: 340,
  ITEM_ROW_HEIGHT: 130,
  ITEMS_PER_ROW: 3,
} as const;

/* ─── View Modes ─────────────────────────────────────── */

export const VIEW_MODES = ["byType", "byTopic", "timeline"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/* ─── Workspace Item Shape ───────────────────────────── */

export type WorkspaceItemData = {
  id: string;
  workspaceId: string;
  title: string;
  preview?: string;
  itemType: CanonicalWorkspaceType;
  status: "active" | "idle" | "completed" | "archived";
  canvasX?: number;
  canvasY?: number;
  updatedAt?: number;
  meta?: string;
};

/* ─── Workspace Shape ────────────────────────────────── */

export type WorkspaceData = {
  id: string;
  name: string;
  emoji: string;
  status: "active" | "quiet" | "completed" | "archived";
  itemCount: number;
  lastActivity?: number;
  items: WorkspaceItemData[];
};

/* ─── Tint Zone Mapping ──────────────────────────────── */

import type { TintZoneVariant } from "@/components/workspace/tint-zone";

export const TYPE_TO_TINT: Record<CanonicalWorkspaceType, TintZoneVariant> = {
  note: "warm",
  visual: "accent",
  code: "cool",
  export: "muted",
  board: "neutral",
  flashcard_deck: "cool",
  quiz: "accent",
  thread: "cool",
  planner: "accent",
};

/* ─── Tint Zone Grouping Labels ──────────────────────── */

export const TYPE_GROUP_LABELS: Record<string, { label: string; types: CanonicalWorkspaceType[] }> = {
  documents: { label: "Documents", types: ["note", "export"] },
  code: { label: "Code", types: ["code"] },
  media: { label: "Media", types: ["visual", "board"] },
  study: { label: "Study", types: ["flashcard_deck", "quiz"] },
  threads: { label: "Threads", types: ["thread"] },
  planning: { label: "Planning", types: ["planner"] },
};


export type HubVisibility = "hidden" | "collapsed" | "expanded";
export type BackgroundMode = "dots" | "blank" | "grid";
export type HubEdge = "top" | "bottom" | "left" | "right";

export type HubSurfaceState = {
  id: string;
  edge: HubEdge;
  order: number;
  locked: boolean;
  expanded: boolean;
  pinned?: boolean;
};
