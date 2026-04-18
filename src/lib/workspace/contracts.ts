import type { CanonicalWorkspaceType } from "@/lib/artifact-types";

/* ─── Continuous Semantic Zoom ─────────────────────────── */

/**
 * Semantic zoom is modeled as a CONTINUOUS signal, not discrete tiers.
 *
 * Instead of abrupt tier boundaries, the system exposes a set of
 * continuous interpolation signals that components read directly.
 * Each signal is a 0→1 value representing how far a particular
 * semantic layer has been revealed. Components blend these signals
 * to produce progressive structural recomposition.
 *
 * The tier labels remain for logging/debugging/workspace-commitment
 * logic, but rendering code should use the continuous signals.
 */

export const ZOOM_ANCHORS = {
  /** Below this: pure landscape identity view */
  LANDSCAPE_FULL: 0.08,
  /** Transition zone: landscape → summary begins */
  SUMMARY_ENTER: 0.12,
  /** Summary is fully established */
  SUMMARY_FULL: 0.25,
  /** Transition zone: summary → detail begins */
  DETAIL_ENTER: 0.35,
  /** Detail is fully established */
  DETAIL_FULL: 0.55,
  /** Deep editing comfort zone */
  DEEP_EDIT: 0.80,
} as const;

export const ZOOM_TIERS = {
  /** Far out – all workspaces visible as territory regions with name/emoji/count */
  LANDSCAPE: { max: 0.20, label: "landscape" },
  /** Mid – workspace interior structure and grouped items become visible */
  SUMMARY: { min: 0.20, max: 0.50, label: "summary" },
  /** Deep – content-level detail, inline editing, full item cards */
  DETAIL: { min: 0.50, label: "detail" },
} as const;

export type ZoomTier = "landscape" | "summary" | "detail";

export function zoomTierForLevel(zoom: number): ZoomTier {
  if (zoom < ZOOM_TIERS.LANDSCAPE.max) return "landscape";
  if (zoom < ZOOM_TIERS.SUMMARY.max) return "summary";
  return "detail";
}

/**
 * Hermite smoothstep: maps a value to 0-1 with smooth acceleration/deceleration.
 */
export function smoothStep(value: number, edge0: number, edge1: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Continuous semantic zoom signals.
 *
 * Each signal is a 0-1 value representing how revealed that semantic
 * layer is at the current zoom level. Components interpolate these
 * for progressive structural recomposition.
 */
export type ZoomSignals = {
  /** 0 = landscape identity only, 1 = items/structure fully visible */
  structureReveal: number;
  /** 0 = compact chips only, 1 = full cards with metadata */
  cardDetail: number;
  /** 0 = no content preview, 1 = full touch-tier content */
  contentDepth: number;
  /** 0 = landscape centered identity, 1 = identity anchored to corner */
  identityAnchor: number;
  /** 0 = strong territory background, 1 = subtle wash only */
  territoryFade: number;
  /** 0 = group labels hidden, 1 = fully visible */
  groupReveal: number;
  /** Raw zoom for any linear calculations */
  raw: number;
};

export function computeZoomSignals(zoom: number): ZoomSignals {
  return {
    structureReveal: smoothStep(zoom, ZOOM_ANCHORS.SUMMARY_ENTER, ZOOM_ANCHORS.SUMMARY_FULL),
    cardDetail: smoothStep(zoom, ZOOM_ANCHORS.SUMMARY_FULL, ZOOM_ANCHORS.DETAIL_ENTER),
    contentDepth: smoothStep(zoom, ZOOM_ANCHORS.DETAIL_ENTER, ZOOM_ANCHORS.DETAIL_FULL),
    identityAnchor: smoothStep(zoom, ZOOM_ANCHORS.SUMMARY_ENTER, ZOOM_ANCHORS.SUMMARY_FULL - 0.02),
    territoryFade: smoothStep(zoom, ZOOM_ANCHORS.SUMMARY_FULL, ZOOM_ANCHORS.DETAIL_FULL),
    groupReveal: smoothStep(zoom, ZOOM_ANCHORS.SUMMARY_ENTER + 0.02, ZOOM_ANCHORS.SUMMARY_FULL),
    raw: zoom,
  };
}

/**
 * Returns a continuous 0-1 progress value within the current tier.
 * Kept for backward compatibility — prefer ZoomSignals for rendering.
 */
export function zoomTierProgress(zoom: number): number {
  if (zoom < ZOOM_TIERS.LANDSCAPE.max) {
    return Math.max(0, Math.min(1, zoom / ZOOM_TIERS.LANDSCAPE.max));
  }
  if (zoom < ZOOM_TIERS.SUMMARY.max) {
    const range = ZOOM_TIERS.SUMMARY.max - ZOOM_TIERS.SUMMARY.min;
    const linearProgress = Math.max(0, Math.min(1, (zoom - ZOOM_TIERS.SUMMARY.min) / range));
    return linearProgress * linearProgress * (3 - 2 * linearProgress);
  }
  const detailMax = 1.5;
  return Math.max(0, Math.min(1, (zoom - ZOOM_TIERS.DETAIL.min) / (detailMax - ZOOM_TIERS.DETAIL.min)));
}

/* ─── Viewport Constants ─────────────────────────────── */

export const VIEWPORT = {
  MIN_ZOOM: 0.03,
  MAX_ZOOM: 3.0,
  /** Start at landscape level – all workspaces visible */
  DEFAULT_ZOOM: 0.12,
  /** Zoom level that triggers auto-commit into the closest workspace */
  AUTO_ENTRY_THRESHOLD: 0.45,
  /** Zoom level below which we auto-exit a committed workspace */
  AUTO_EXIT_THRESHOLD: 0.20,
  /** Zoom speed multiplier */
  ZOOM_SENSITIVITY: 1.3,
  /** Zoom target when navigating to a specific workspace via dock */
  WORKSPACE_FOCUS_ZOOM: 0.35,
} as const;

/* ─── Territory Sizing ───────────────────────────────── */

export const TERRITORY = {
  /** Width of a workspace territory node */
  WIDTH: 6000,
  /** Height of a workspace territory node */
  HEIGHT: 4000,
  /** Spacing between workspace centers – generous for territorial feel */
  SPACING_X: 8000,
  SPACING_Y: 7000,
  /** Max workspaces per row before wrapping */
  COLS: 3,
  /** Interior layout – columns of items inside a territory */
  ITEM_COL_WIDTH: 600,
  ITEM_ROW_HEIGHT: 280,
  ITEMS_PER_ROW: 5,
} as const;

/* ─── Workspace Envelope Computation ─────────────────── */

/**
 * Computes the bounding envelope of a workspace territory in canvas coords.
 * Used by dock navigation to fly-to the actual spatial extent of a workspace.
 */
export function computeWorkspaceEnvelope(
  workspaceIndex: number,
  itemCount: number,
): { centerX: number; centerY: number; width: number; height: number; fitZoom: number } {
  const col = workspaceIndex % TERRITORY.COLS;
  const row = Math.floor(workspaceIndex / TERRITORY.COLS);
  const originX = col * TERRITORY.SPACING_X;
  const originY = row * TERRITORY.SPACING_Y;

  // Compute actual content extent
  const contentRows = Math.ceil(Math.max(1, itemCount) / TERRITORY.ITEMS_PER_ROW);
  const contentHeight = Math.min(
    TERRITORY.HEIGHT,
    900 + contentRows * TERRITORY.ITEM_ROW_HEIGHT + 200,
  );
  const contentWidth = Math.min(
    TERRITORY.WIDTH,
    80 + TERRITORY.ITEMS_PER_ROW * TERRITORY.ITEM_COL_WIDTH + 60,
  );

  const centerX = originX + contentWidth / 2;
  const centerY = originY + contentHeight / 2;

  // Compute a zoom that fits this envelope on a ~1400×900 screen with padding
  const screenW = typeof window !== "undefined" ? window.innerWidth : 1400;
  const screenH = typeof window !== "undefined" ? window.innerHeight : 900;
  const pad = 0.8; // 80% of screen used
  const fitZoom = Math.min(
    (screenW * pad) / contentWidth,
    (screenH * pad) / contentHeight,
    VIEWPORT.WORKSPACE_FOCUS_ZOOM,
  );

  return { centerX, centerY, width: contentWidth, height: contentHeight, fitZoom: Math.max(fitZoom, 0.08) };
}

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
  topicCluster?: string;
  sourceChatId?: string;
  sourceArtifactId?: string;
  sourcePlannerItemId?: string;
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
export type BackgroundMode = "dots" | "blank" | "grid" | "contour";
export type HubEdge = "top" | "bottom" | "left" | "right";

export type HubSurfaceState = {
  id: string;
  edge: HubEdge;
  order: number;
  locked: boolean;
  expanded: boolean;
  pinned?: boolean;
};

/* ─── Navigation Mode ────────────────────────────────── */

export type NavigationMode = "canvas" | "pages";

export type PageLevel = "atlas" | "workspace" | "region";

/* ─── Widget System ──────────────────────────────────── */

export type WidgetKind =
  | "sticky"
  | "timer"
  | "countdown"
  | "clock"
  | "link"
  | "image"
  | "scratchpad"
  | "planner-strip";

export type WidgetData = {
  id: string;
  kind: WidgetKind;
  /** World coordinates (ReactFlow space) */
  x: number;
  y: number;
  /** World pixels — kept modest so widget stays reasonable on screen */
  w: number;
  h: number;
  /** Optional workspace binding — if null, widget lives in the atlas */
  workspaceId: string | null;
  createdAt: number;
  state: Record<string, unknown>;
};

/* ─── Item Move Overrides (client-side persistence) ──── */

export type ItemPositionOverride = {
  itemId: string;
  x: number;
  y: number;
  updatedAt: number;
};
